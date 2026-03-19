from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from backend.database import get_db
from backend.models import Violation, Camera, User
from backend.auth import get_current_user, require_role
from backend.schemas import ViolationOut, AcknowledgeRequest

router = APIRouter(prefix="/api/violations", tags=["violations"])


def _enrich(v: Violation, cam: Optional[Camera] = None) -> ViolationOut:
    out = ViolationOut.model_validate(v)
    if cam:
        out.camera_name = cam.name
        out.zone = cam.zone
    return out


@router.get("", response_model=list[ViolationOut])
async def list_violations(
    camera_id: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Violation).order_by(Violation.started_at.desc())
    if camera_id:
        q = q.where(Violation.camera_id == camera_id)
    if type:
        q = q.where(Violation.type == type)
    if status:
        q = q.where(Violation.status == status)
    if from_dt:
        q = q.where(Violation.started_at >= from_dt)
    if to_dt:
        q = q.where(Violation.started_at <= to_dt)

    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    violations = result.scalars().all()

    cam_ids = {v.camera_id for v in violations}
    cams_result = await db.execute(select(Camera).where(Camera.id.in_(cam_ids)))
    cams = {c.id: c for c in cams_result.scalars().all()}

    return [_enrich(v, cams.get(v.camera_id)) for v in violations]


@router.get("/{violation_id}", response_model=ViolationOut)
async def get_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    v = await db.get(Violation, violation_id)
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")
    cam = await db.get(Camera, v.camera_id)
    return _enrich(v, cam)


@router.get("/{violation_id}/snapshot")
async def get_snapshot(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    v = await db.get(Violation, violation_id)
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")
    if not v.snapshot_path:
        raise HTTPException(status_code=404, detail="No snapshot available")
    return FileResponse(v.snapshot_path, media_type="image/jpeg")


@router.put("/{violation_id}/acknowledge", response_model=ViolationOut)
async def acknowledge(
    violation_id: int,
    body: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("safety_officer", "site_manager", "admin")),
):
    v = await db.get(Violation, violation_id)
    if not v:
        raise HTTPException(status_code=404, detail="Violation not found")
    v.status = "acknowledged"
    v.acknowledged_by = user.name
    v.acknowledged_at = datetime.utcnow()
    v.note = body.note
    await db.commit()
    await db.refresh(v)
    cam = await db.get(Camera, v.camera_id)
    return _enrich(v, cam)


