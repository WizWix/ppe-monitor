from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models import Camera, User
from backend.auth import get_current_user, require_role
from backend.schemas import CameraCreate, CameraUpdate, CameraOut, ComplianceSummary

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


def _enrich(cam: Camera, manager=None) -> CameraOut:
    summary = ComplianceSummary()
    if manager:
        worker = manager.get_worker(cam.id)
        if worker:
            summary = worker.current_summary
    out = CameraOut.model_validate(cam)
    out.current_summary = summary
    return out


@router.get("", response_model=list[CameraOut])
async def list_cameras(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from backend.monitor_bridge import camera_manager
    result = await db.execute(select(Camera).order_by(Camera.created_at))
    cams = result.scalars().all()
    return [_enrich(c, camera_manager) for c in cams]


@router.get("/{camera_id}", response_model=CameraOut)
async def get_camera(
    camera_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from backend.monitor_bridge import camera_manager
    cam = await db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _enrich(cam, camera_manager)


@router.post("", response_model=CameraOut, status_code=201)
async def create_camera(
    body: CameraCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    existing = await db.get(Camera, body.id)
    if existing:
        raise HTTPException(status_code=400, detail="Camera ID already exists")
    cam = Camera(**body.model_dump())
    db.add(cam)
    await db.commit()
    await db.refresh(cam)
    return _enrich(cam)


@router.put("/{camera_id}", response_model=CameraOut)
async def update_camera(
    camera_id: str,
    body: CameraUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    cam = await db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(cam, field, value)
    await db.commit()
    await db.refresh(cam)
    return _enrich(cam)


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(
    camera_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    from backend.monitor_bridge import camera_manager
    cam = await db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await camera_manager.stop_camera(camera_id)
    await db.delete(cam)
    await db.commit()


@router.post("/{camera_id}/start")
async def start_camera(
    camera_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    from backend.monitor_bridge import camera_manager
    cam = await db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await camera_manager.start_camera(cam)
    cam.status = "online"
    await db.commit()
    return {"status": "started"}


@router.post("/{camera_id}/stop")
async def stop_camera(
    camera_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("site_manager", "admin")),
):
    from backend.monitor_bridge import camera_manager
    cam = await db.get(Camera, camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    await camera_manager.stop_camera(camera_id)
    cam.status = "offline"
    await db.commit()
    return {"status": "stopped"}
