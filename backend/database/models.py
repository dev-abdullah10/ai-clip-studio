"""SQLAlchemy ORM models. Large media is stored on disk, never in SQLite."""

from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database.base import Base, utcnow_iso


def new_id() -> str:
    return uuid.uuid4().hex


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(500))
    source_path: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)

    duration: Mapped[float | None] = mapped_column(Float)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    fps: Mapped[float | None] = mapped_column(Float)
    has_audio: Mapped[bool] = mapped_column(default=False)
    video_codec: Mapped[str | None] = mapped_column(String(80))
    audio_codec: Mapped[str | None] = mapped_column(String(80))
    file_size: Mapped[int | None] = mapped_column(Integer)
    thumbnail_path: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(40), default="draft")
    error: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(String(30))
    transcript_path: Mapped[str | None] = mapped_column(Text)
    scenes_json: Mapped[str | None] = mapped_column(Text)
    analysis_json: Mapped[str | None] = mapped_column(Text)
    analysis_settings_json: Mapped[str | None] = mapped_column(Text)
    subtitle_json: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, onupdate=utcnow_iso)

    clips: Mapped[list["Clip"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Clip.order_index"
    )
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(300), default="Untitled clip")
    description: Mapped[str] = mapped_column(Text, default="")
    reason: Mapped[str] = mapped_column(Text, default="")
    hook: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="general")
    score: Mapped[float] = mapped_column(Float, default=50.0)
    start: Mapped[float] = mapped_column(Float, default=0.0)
    end: Mapped[float] = mapped_column(Float, default=0.0)
    transcript_text: Mapped[str] = mapped_column(Text, default="")
    speaker: Mapped[str | None] = mapped_column(String(80))

    aspect_ratio: Mapped[str] = mapped_column(String(20), default="9:16")
    crop_mode: Mapped[str] = mapped_column(String(30), default="center")
    crop_offset: Mapped[float] = mapped_column(Float, default=0.5)
    crop_confidence: Mapped[float | None] = mapped_column(Float)

    subtitle_enabled: Mapped[bool] = mapped_column(default=True)
    subtitle_json: Mapped[str | None] = mapped_column(Text)
    render_path: Mapped[str | None] = mapped_column(Text)
    render_status: Mapped[str] = mapped_column(String(30), default="none")
    render_updated_at: Mapped[str | None] = mapped_column(String(40))
    thumbnail_path: Mapped[str | None] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(30), default="suggested")
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, onupdate=utcnow_iso)

    project: Mapped[Project] = relationship(back_populates="clips")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40), default="analyze")
    status: Mapped[str] = mapped_column(String(40), default="queued", index=True)
    stage: Mapped[str | None] = mapped_column(String(80))
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text)
    params_json: Mapped[str | None] = mapped_column(Text)
    result_json: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)
    started_at: Mapped[str | None] = mapped_column(String(40))
    finished_at: Mapped[str | None] = mapped_column(String(40))

    project: Mapped[Project | None] = relationship(back_populates="jobs")


class ExportRecord(Base):
    __tablename__ = "exports"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    job_id: Mapped[str | None] = mapped_column(String(32))
    clip_id: Mapped[str | None] = mapped_column(String(32), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    path: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    zip_path: Mapped[str | None] = mapped_column(Text)
    settings_json: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, default="null")
    updated_at: Mapped[str] = mapped_column(String(40), default=utcnow_iso, onupdate=utcnow_iso)


Index("ix_clips_project_start", Clip.project_id, Clip.start)
Index("ix_jobs_project_status", Job.project_id, Job.status)
