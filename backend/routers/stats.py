import csv
import io
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from backend.database import get_db
from backend.models import Violation, Camera, User
from backend.auth import get_current_user
from backend.schemas import StatsSummary, TimelinePoint

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats/summary", response_model=StatsSummary)
async def get_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from backend.monitor_bridge import camera_manager

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    # Total violations today
    total_today_result = await db.execute(
        select(func.count()).where(Violation.started_at >= today_start)
    )
    total_violations = total_today_result.scalar() or 0

    # Total violations yesterday (same window)
    total_yesterday_result = await db.execute(
        select(func.count()).where(
            Violation.started_at >= yesterday_start,
            Violation.started_at < today_start,
        )
    )
    total_violations_yesterday = total_yesterday_result.scalar() or 0

    # Active (unacknowledged) violations
    active_result = await db.execute(
        select(func.count()).where(Violation.status == "unacknowledged")
    )
    active_violations = active_result.scalar() or 0

    # Cameras
    cams_result = await db.execute(select(Camera))
    cameras = cams_result.scalars().all()
    cameras_total = len(cameras)
    cameras_online = sum(1 for c in cameras if c.status == "online")

    # Compliance rate from live workers
    workers = camera_manager.get_all_workers()
    total_persons = 0
    compliant_sum = 0
    for w in workers:
        s = w.current_summary
        total_persons += s.total_persons
        compliant_sum += s.compliant

    compliance_rate = (compliant_sum / total_persons) if total_persons > 0 else 1.0

    return StatsSummary(
        compliance_rate=round(compliance_rate, 3),
        total_violations=total_violations,
        total_violations_yesterday=total_violations_yesterday,
        active_violations=active_violations,
        total_persons_today=total_persons,
        cameras_online=cameras_online,
        cameras_total=cameras_total,
    )


@router.get("/stats/timeline", response_model=list[TimelinePoint])
async def get_timeline(
    camera_id: str = Query(None),
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    now = datetime.utcnow()
    points = []

    for h in range(hours - 1, -1, -1):
        hour_start = (now - timedelta(hours=h)).replace(minute=0, second=0, microsecond=0)
        hour_end = hour_start + timedelta(hours=1)

        q = select(func.count()).where(
            Violation.started_at >= hour_start,
            Violation.started_at < hour_end,
        )
        if camera_id:
            q = q.where(Violation.camera_id == camera_id)

        count_result = await db.execute(q)
        violation_count = count_result.scalar() or 0

        points.append(TimelinePoint(
            hour=hour_start.strftime("%H:%M"),
            violation_count=violation_count,
        ))

    return points


@router.get("/stats/by-type")
async def get_by_type(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Violation counts broken down by PPE type for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(Violation.type, func.count().label("count"))
        .where(Violation.started_at >= since)
        .group_by(Violation.type)
    )
    counts = {r.type: r.count for r in result.all()}
    return {
        "no_helmet":          counts.get("no_helmet", 0),
        "no_vest":            counts.get("no_vest", 0),
        "no_helmet_no_vest":  counts.get("no_helmet_no_vest", 0),
    }


@router.get("/stats/heatmap")
async def get_heatmap(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Violation counts grouped by zone × hour-of-day for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(
            Camera.zone,
            func.strftime("%H", Violation.started_at).label("hour"),
            func.count().label("count"),
        )
        .join(Camera, Violation.camera_id == Camera.id)
        .where(Violation.started_at >= since)
        .group_by(Camera.zone, func.strftime("%H", Violation.started_at))
    )
    return [
        {"zone": r.zone or "미지정", "hour": int(r.hour), "count": r.count}
        for r in result.all()
    ]


@router.get("/stats/by-camera")
async def get_by_camera(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Violation counts per camera for the last N days, sorted by count desc."""
    since = datetime.utcnow() - timedelta(days=days)
    result = await db.execute(
        select(
            Camera.id,
            Camera.name,
            Camera.zone,
            func.count(Violation.id).label("count"),
        )
        .join(Violation, Camera.id == Violation.camera_id, isouter=True)
        .where((Violation.started_at >= since) | (Violation.id == None))
        .group_by(Camera.id, Camera.name, Camera.zone)
        .order_by(func.count(Violation.id).desc())
    )
    return [
        {"camera_id": r.id, "camera_name": r.name, "zone": r.zone, "count": r.count}
        for r in result.all()
        if r.count > 0
    ]


@router.get("/reports/export")
async def export_report(
    format: str = Query("csv", regex="^(csv|json)$"),
    from_dt: datetime = Query(None, alias="from"),
    to_dt: datetime = Query(None, alias="to"),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Violation).order_by(Violation.started_at.desc())
    if from_dt:
        q = q.where(Violation.started_at >= from_dt)
    if to_dt:
        q = q.where(Violation.started_at <= to_dt)

    result = await db.execute(q)
    violations = result.scalars().all()

    cam_ids = {v.camera_id for v in violations}
    cams_result = await db.execute(select(Camera).where(Camera.id.in_(cam_ids)))
    cams = {c.id: c for c in cams_result.scalars().all()}

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Camera", "Zone", "Type", "Started At", "Duration (s)", "Status", "Acknowledged By", "Note"])
        for v in violations:
            cam = cams.get(v.camera_id)
            writer.writerow([
                v.id, cam.name if cam else v.camera_id, cam.zone if cam else "",
                v.type, v.started_at.isoformat(), v.duration_seconds,
                v.status, v.acknowledged_by, v.note,
            ])
        output.seek(0)
        # UTF-8 BOM 추가 — Excel 등에서 한글 깨짐 방지
        bom = "\ufeff"
        return StreamingResponse(
            iter([bom + output.getvalue()]),
            media_type="text/csv; charset=utf-8-sig",
            headers={"Content-Disposition": "attachment; filename=violations_report.csv"},
        )
    else:
        import json
        data = []
        for v in violations:
            cam = cams.get(v.camera_id)
            data.append({
                "id": v.id, "camera": cam.name if cam else v.camera_id,
                "zone": cam.zone if cam else "", "type": v.type,
                "started_at": v.started_at.isoformat(), "duration_seconds": v.duration_seconds,
                "status": v.status,
            })
        return StreamingResponse(
            iter([json.dumps(data, ensure_ascii=False)]),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=violations_report.json"},
        )
