"""
PPE Safety Monitor — FastAPI backend
Run: uvicorn backend.main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from backend.database import init_db, AsyncSessionLocal
from backend.models import User, Camera, AlertRule
from backend.auth import hash_password
from backend.monitor_bridge import camera_manager, set_infer_every_n, get_infer_every_n_override, _gpu_infer_ms_per_frame, _dynamic_infer_every_n, set_stream_fps, get_stream_fps_override, STREAM_FPS_MAX
from backend.routers import auth, cameras, violations, stats, ws, users, alert_rules

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def seed_db():
    """Insert default admin user, demo cameras and alert rule if DB is empty."""
    async with AsyncSessionLocal() as db:
        # Default admin user
        result = await db.execute(select(User).where(User.email == "admin@ppe.local"))
        if not result.scalar_one_or_none():
            db.add(User(
                email="admin@ppe.local",
                name="관리자",
                hashed_password=hash_password("admin1234"),
                role="admin",
            ))
            db.add(User(
                email="safety@ppe.local",
                name="안전담당자",
                hashed_password=hash_password("safety1234"),
                role="safety_officer",
            ))

        # Demo cameras — insert any that don't exist yet
        DEMO_CAMERAS = [
            ("cam-01",  "정문 입구",      "A구역"),
            ("cam-02",  "작업현장 북쪽",  "B구역"),
            ("cam-03",  "자재창고",       "C구역"),
            ("cam-04",  "작업현장 남쪽",  "B구역"),
            ("cam-05",  "비계 구역",      "D구역"),
            ("cam-06",  "중장비 주차장",  "E구역"),
            ("cam-07",  "후문 출입구",    "A구역"),
            ("cam-08",  "철근 야적장",    "C구역"),
            ("cam-09",  "엘리베이터 홀",  "F구역"),
            ("cam-10",  "지하 굴착",      "G구역"),
            ("cam-11",  "콘크리트 타설",  "B구역"),
            ("cam-12",  "전기 작업실",    "H구역"),
            ("cam-13",  "고소 작업대",    "D구역"),
            ("cam-14",  "용접 구역",      "E구역"),
            ("cam-15",  "안전 관리실",    "A구역"),
            ("cam-16",  "옥상 출입구",    "F구역"),
        ]
        for cam_id, name, zone in DEMO_CAMERAS:
            exists = await db.get(Camera, cam_id)
            if not exists:
                db.add(Camera(id=cam_id, name=name, zone=zone, source="demo"))

        # Default alert rule
        result = await db.execute(select(AlertRule))
        if not result.scalars().all():
            db.add(AlertRule(
                name="기본 알림 규칙",
                violation_type="any",
                min_duration_seconds=3,
                cameras="",
                channels="in_app",
                escalation_minutes=10,
            ))

        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await seed_db()

    # Auto-start demo cameras
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Camera))
        cams = result.scalars().all()
        for cam in cams:
            try:
                await camera_manager.start_camera(cam)
                cam.status = "online"
            except Exception as exc:
                logger.warning("Could not start camera %s: %s", cam.id, exc)
        await db.commit()

    logger.info("PPE Monitor backend started")
    yield

    # Shutdown
    await camera_manager.stop_all()
    logger.info("PPE Monitor backend stopped")


app = FastAPI(title="PPE Safety Monitor API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(cameras.router)
app.include_router(violations.router)
app.include_router(stats.router)
app.include_router(users.router)
app.include_router(alert_rules.router)
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── System settings ────────────────────────────────────────────────────────────
class SystemSettingsPatch(BaseModel):
    infer_every_n: Optional[int] = None  # None = auto
    auto: bool = False                   # if True, reset infer to auto
    stream_fps: Optional[int] = None     # None = keep current, 0 = reset to default

@app.get("/api/system")
async def get_system():
    from backend.monitor_bridge import _gpu_infer_ms_per_frame, _dynamic_infer_every_n
    override = get_infer_every_n_override()
    fps_override = get_stream_fps_override()
    return {
        "infer_every_n_override": override,
        "infer_every_n_effective": _dynamic_infer_every_n(),
        "gpu_ms_per_frame": round(_gpu_infer_ms_per_frame, 1),
        "mode": "manual" if override is not None else "auto",
        "stream_fps_override": fps_override,
        "stream_fps_effective": fps_override if fps_override is not None else STREAM_FPS_MAX,
        "stream_fps_default": STREAM_FPS_MAX,
    }

@app.patch("/api/system")
async def patch_system(body: SystemSettingsPatch):
    if body.auto or body.infer_every_n is None:
        set_infer_every_n(None)
    else:
        set_infer_every_n(max(1, body.infer_every_n))
    if body.stream_fps is not None:
        set_stream_fps(None if body.stream_fps == 0 else max(1, min(60, body.stream_fps)))
    return await get_system()
