from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(30), default="safety_officer")  # viewer|safety_officer|site_manager|admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Camera(Base):
    __tablename__ = "cameras"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    zone: Mapped[str] = mapped_column(String(100), default="")
    source: Mapped[str] = mapped_column(String(500), nullable=False)  # RTSP URL, camera index, video path
    status: Mapped[str] = mapped_column(String(20), default="offline")  # online|offline|error
    conf_helmet: Mapped[float] = mapped_column(Float, default=0.65)
    conf_vest: Mapped[float] = mapped_column(Float, default=0.70)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    violations: Mapped[list["Violation"]] = relationship("Violation", back_populates="camera")


class Violation(Base):
    __tablename__ = "violations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(String(50), ForeignKey("cameras.id"), nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[str] = mapped_column(String(30), nullable=False)  # no_helmet|no_vest|no_helmet_no_vest
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    snapshot_path: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(20), default="unacknowledged")  # unacknowledged|acknowledged|escalated
    acknowledged_by: Mapped[str] = mapped_column(String(100), default="")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")

    camera: Mapped["Camera"] = relationship("Camera", back_populates="violations")


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), default="Default Rule")
    violation_type: Mapped[str] = mapped_column(String(30), default="any")
    min_duration_seconds: Mapped[int] = mapped_column(Integer, default=3)
    cameras: Mapped[str] = mapped_column(Text, default="")  # comma-separated camera IDs, empty=all
    channels: Mapped[str] = mapped_column(Text, default="in_app")  # comma-separated
    escalation_minutes: Mapped[int] = mapped_column(Integer, default=10)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
