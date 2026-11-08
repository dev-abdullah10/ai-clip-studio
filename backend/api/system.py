"""System health, environment and maintenance endpoints."""

from __future__ import annotations

import os
import platform
import shutil
import sys
import threading
from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import text

from backend import __version__
from backend.core.config import get_settings, get_storage
from backend.core.exceptions import ConflictError, NotFoundError, StorageError
from backend.database.session import get_engine
from backend.schemas.api import OpenPathRequest
from backend.services.jobs import get_job_manager
from backend.utils.ffmpeg import inspect_tools, require_ffmpeg

router = APIRouter(tags=["system"])


def _database_ok() -> tuple[bool, str | None]:
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
        return True, None
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"[:500]


def _dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                continue
    return total


@router.get("/health")
def health() -> dict:
    database_ok, database_error = _database_ok()
    tools = inspect_tools()
    return {
        "status": "ok" if database_ok and tools["ffmpeg"].available else "degraded",
        "version": __version__,
        "database_ok": database_ok,
        "database_error": database_error,
        "ffmpeg_available": tools["ffmpeg"].available,
        "ffprobe_available": tools["ffprobe"].available,
    }


@router.get("/system/info")
def system_info() -> dict:
    settings = get_settings()
    storage = get_storage()
    tools = inspect_tools()
    try:
        usage = shutil.disk_usage(settings.storage_dir)
        disk = {
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "percent_used": round(usage.used / usage.total * 100, 1) if usage.total else 0,
        }
    except OSError:
        disk = None
    source_bytes = _dir_size(settings.storage_dir / "uploads")
    export_bytes = _dir_size(settings.storage_dir / "exports")
    clip_bytes = _dir_size(settings.storage_dir / "clips")
    ffmpeg_path = tools["ffmpeg"].path if tools["ffmpeg"].available else settings.ffmpeg
    ffprobe_path = tools["ffprobe"].path if tools["ffprobe"].available else settings.ffprobe
    return {
        "version": __version__,
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "host": settings.host,
        "port": settings.port,
        "storage_dir": str(settings.storage_dir),
        "database_path": str(settings.database_path),
        "database_bytes": settings.database_path.stat().st_size
        if settings.database_path.is_file()
        else 0,
        "media": {
            "source_bytes": source_bytes,
            "clip_bytes": clip_bytes,
            "export_bytes": export_bytes,
            "app_bytes": source_bytes + clip_bytes + export_bytes,
        },
        "disk": disk,
        "ffmpeg": {
            "available": tools["ffmpeg"].available,
            "path": ffmpeg_path,
            "version": tools["ffmpeg"].version,
            "ass": tools["ffmpeg"].has_ass,
            "drawtext": tools["ffmpeg"].has_drawtext,
            "nvenc": tools["ffmpeg"].has_nvenc,
        },
        "ffprobe": {
            "available": tools["ffprobe"].available,
            "path": ffprobe_path,
            "version": tools["ffprobe"].version,
        },
        "max_upload_mb": settings.max_upload_mb,
        "temp_retention_days": settings.temp_retention_days,
    }


@router.get("/system/logs")
def read_logs(lines: int = 250) -> dict:
    settings = get_settings()
    path = settings.storage_dir / "logs" / "app.log"
    if not path.is_file():
        return {"path": str(path), "lines": [], "text": ""}
    lines = max(10, min(2000, int(lines)))
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            tail = handle.readlines()[-lines:]
    except OSError as exc:
        raise StorageError("The log file could not be read.") from exc
    return {"path": str(path), "lines": [line.rstrip() for line in tail], "text": "".join(tail)}


@router.post("/system/cleanup-temp")
def cleanup_temp() -> dict:
    manager = get_job_manager()
    if manager.list(status="running", limit=1):
        raise ConflictError("Wait for running jobs to finish before clearing temporary files.")
    storage = get_storage()
    temp_root = storage.root / "temp"
    freed = 0
    removed = 0
    if temp_root.exists():
        for child in list(temp_root.iterdir()):
            try:
                if child.is_dir():
                    freed += _dir_size(child)
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    freed += child.stat().st_size
                    child.unlink(missing_ok=True)
                removed += 1
            except OSError:
                continue
    temp_root.mkdir(parents=True, exist_ok=True)
    return {"removed": removed, "freed_bytes": freed}


@router.post("/system/open-folder")
def open_folder(payload: OpenPathRequest) -> dict:
    settings = get_settings()
    storage = get_storage()
    targets = {
        "storage": settings.storage_dir,
        "logs": settings.storage_dir / "logs",
        "exports": settings.storage_dir / "exports",
        "clips": settings.storage_dir / "clips",
        "uploads": storage.root / "uploads",
    }
    path = targets.get(payload.target)
    if path is None:
        raise NotFoundError("Unknown folder.")
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        return {"opened": False, "path": str(path)}
    try:
        os.startfile(str(path))  # type: ignore[attr-defined]
    except OSError as exc:
        raise StorageError("Windows could not open that folder.") from exc
    return {"opened": True, "path": str(path)}


@router.post("/system/check-ffmpeg")
def check_ffmpeg() -> dict:
    require_ffmpeg()
    tools = inspect_tools(force=True)
    return {
        "ffmpeg": {
            "path": tools["ffmpeg"].path,
            "version": tools["ffmpeg"].version,
            "ass": tools["ffmpeg"].has_ass,
            "nvenc": tools["ffmpeg"].has_nvenc,
        },
        "ffprobe": {"path": tools["ffprobe"].path, "version": tools["ffprobe"].version},
    }
