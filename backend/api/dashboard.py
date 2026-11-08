"""Dashboard summary endpoint."""

from __future__ import annotations

import shutil

from fastapi import APIRouter
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from backend.core.config import get_settings
from backend.database.models import Clip, ExportRecord, Project
from backend.database.session import session_scope
from backend.services.jobs import get_job_manager
from backend.services.projects import project_to_dict
from backend.services.settings_service import provider_statuses
from backend.utils.ffmpeg import inspect_tools

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
def dashboard() -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        project_count = session.query(func.count(Project.id)).scalar() or 0
        clip_count = session.query(func.count(Clip.id)).scalar() or 0
        rendered_count = (
            session.query(func.count(Clip.id)).filter(Clip.render_status == "ready").scalar() or 0
        )
        export_count = session.query(func.count(ExportRecord.id)).scalar() or 0
        projects = (
            session.query(Project)
            .options(selectinload(Project.clips))
            .order_by(Project.updated_at.desc())
            .limit(8)
            .all()
        )
        recent = [project_to_dict(project) for project in projects]
    active = manager.list(status="running", limit=20) + manager.list(status="queued", limit=20)
    recent_jobs = manager.list(limit=10)
    try:
        usage = shutil.disk_usage(get_settings().storage_dir)
        disk_free = usage.free
        disk_total = usage.total
    except OSError:
        disk_free = disk_total = 0
    tools = inspect_tools()
    return {
        "counts": {
            "projects": project_count,
            "clips": clip_count,
            "rendered_clips": rendered_count,
            "exports": export_count,
        },
        "recent_projects": recent,
        "active_jobs": active,
        "recent_jobs": recent_jobs,
        "providers": provider_statuses(),
        "tools": {
            "ffmpeg": tools["ffmpeg"].available,
            "ffprobe": tools["ffprobe"].available,
            "ass": tools["ffmpeg"].has_ass,
            "nvenc": tools["ffmpeg"].has_nvenc,
            "ffmpeg_version": tools["ffmpeg"].version,
        },
        "storage": {
            "path": str(get_settings().storage_dir),
            "free_bytes": disk_free,
            "total_bytes": disk_total,
        },
    }
