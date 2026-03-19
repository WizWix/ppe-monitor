from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


# ── Auth ──────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}


# ── Camera ────────────────────────────────────────────────────────────────────
class CameraCreate(BaseModel):
    id: str
    name: str
    zone: str = ""
    source: str
    conf_helmet: float = 0.65
    conf_vest: float = 0.70


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    zone: Optional[str] = None
    source: Optional[str] = None
    conf_helmet: Optional[float] = None
    conf_vest: Optional[float] = None


class ComplianceSummary(BaseModel):
    total_persons: int = 0
    compliant: int = 0
    partial: int = 0
    non_compliant: int = 0
    compliance_rate: float = 1.0


class CameraOut(BaseModel):
    id: str
    name: str
    zone: str
    source: str
    status: str
    conf_helmet: float
    conf_vest: float
    created_at: datetime
    current_summary: ComplianceSummary = ComplianceSummary()

    model_config = {"from_attributes": True}


# ── Violation ─────────────────────────────────────────────────────────────────
class ViolationOut(BaseModel):
    id: int
    camera_id: str
    camera_name: str = ""
    zone: str = ""
    track_id: int
    type: str
    started_at: datetime
    duration_seconds: float
    snapshot_path: str
    status: str
    acknowledged_by: str
    acknowledged_at: Optional[datetime]
    note: str

    model_config = {"from_attributes": True}


class AcknowledgeRequest(BaseModel):
    note: str = ""


# ── Stats ─────────────────────────────────────────────────────────────────────
class StatsSummary(BaseModel):
    compliance_rate: float
    total_violations: int
    total_violations_yesterday: int = 0
    active_violations: int
    total_persons_today: int
    cameras_online: int
    cameras_total: int


class TimelinePoint(BaseModel):
    hour: str
    violation_count: int


# ── Alert Rule ────────────────────────────────────────────────────────────────
class AlertRuleCreate(BaseModel):
    name: str = "Default Rule"
    violation_type: str = "any"
    min_duration_seconds: int = 3
    cameras: str = ""
    channels: str = "in_app"
    escalation_minutes: int = 10


class AlertRuleOut(BaseModel):
    id: int
    name: str
    violation_type: str
    min_duration_seconds: int
    cameras: str
    channels: str
    escalation_minutes: int
    is_active: bool

    model_config = {"from_attributes": True}


# ── WebSocket frame ───────────────────────────────────────────────────────────
class DetectionItem(BaseModel):
    track_id: int
    status: str  # compliant|partial|non_compliant
    helmet: bool
    vest: bool
    bbox: list[int]  # [x1, y1, x2, y2]
    confidence: float


class CameraFrame(BaseModel):
    frame_id: int
    camera_id: str
    timestamp: str
    jpeg_b64: str
    detections: list[DetectionItem]
    summary: ComplianceSummary
