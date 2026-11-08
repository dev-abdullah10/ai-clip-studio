"""Project import, listing, transcript and deletion endpoints."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import func
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool

from backend.core.config import get_settings, get_storage
from backend.core.exceptions import (
    ConflictError,
    MediaError,
    NotFoundError,
    StorageError,
    TranscriptionError,
    ValidationError,
)
from backend.database.models import Clip, Project, new_id
from backend.database.session import session_scope
from backend.schemas.api import (
    AnalyzeRequest,
    ProcessRequest,
    ProjectUpdate,
    TranscriptImportRequest,
    UrlImportRequest,
)
from backend.schemas.clips import AnalysisSettings
from backend.services.imports import (
    download_direct_url,
    safe_stem,
    safe_suffix,
    save_upload,
)
from backend.services.jobs import get_job_manager
from backend.services.projects import (
    delete_project_files,
    project_to_dict,
    set_analysis_settings,
    transcript_meta,
)
from backend.services.transcription.service import (
    load_transcript,
    parse_subtitle_text,
    save_transcript,
)
from backend.services.video.probe import probe_video
from backend.services.video.thumbnail import generate_thumbnail
from backend.utils.time import format_srt_time, format_vtt_time

logger = logging.getLogger(__name__)
router = APIRouter(tags=["projects"])


def _active_project_ids() -> set[str]:
    jobs = get_job_manager().list(status="running", limit=200) + get_job_manager().list(
        status="queued", limit=200
    )
    return {job["project_id"] for job in jobs if job.get("project_id")}


def _finalize_import(
    *,
    project_id: str,
    source_path: Path,
    original_filename: str,
    file_size: int,
    name: str | None,
    source_url: str | None = None,
) -> dict:
    storage = get_storage()
    try:
        metadata = probe_video(source_path)
    except Exception:
        try:
            source_path.unlink(missing_ok=True)
            shutil.rmtree(source_path.parent, ignore_errors=True)
        except OSError:
            pass
        raise

    thumbnail_path: Path | None = None
    try:
        thumbnail_path = generate_thumbnail(
            source_path,
            storage.project_thumbnail(project_id),
            timestamp=min(2.0, max(0.1, metadata.duration / 3.0)),
            width=640,
        )
    except Exception:
        logger.warning("Project thumbnail generation failed", exc_info=True)

    project_name = (name or "").strip() or safe_stem(original_filename)
    project = Project(
        id=project_id,
        name=project_name[:200],
        source_filename=original_filename[:500],
        source_path=str(source_path),
        source_url=source_url,
        duration=metadata.duration,
        width=metadata.width,
        height=metadata.height,
        fps=metadata.fps,
        has_audio=metadata.has_audio,
        video_codec=metadata.video_codec,
        audio_codec=metadata.audio_codec,
        file_size=file_size,
        thumbnail_path=str(thumbnail_path) if thumbnail_path else None,
        status="draft",
    )
    with session_scope() as session:
        session.add(project)
        session.flush()
        payload = project_to_dict(project, include_clips=True)
    return payload


@router.get("/projects")
def list_projects(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    active = _active_project_ids()
    with session_scope() as session:
        total = session.query(func.count(Project.id)).scalar() or 0
        projects = (
            session.query(Project)
            .options(selectinload(Project.clips))
            .order_by(Project.updated_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        items = []
        for project in projects:
            item = project_to_dict(project)
            item["active_job"] = project.id in active
            items.append(item)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.post("/projects/upload", status_code=201)
async def upload_project(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> dict:
    settings = get_settings()
    storage = get_storage()
    if not file.filename:
        raise ValidationError("Choose a video file to import.")
    project_id = new_id()
    suffix = safe_suffix(file.filename)
    destination = storage.source_path(project_id, suffix)
    try:
        size = await save_upload(
            file,
            destination,
            max_bytes=settings.max_upload_mb * 1024 * 1024,
        )
    except Exception:
        try:
            shutil.rmtree(destination.parent, ignore_errors=True)
        except OSError:
            pass
        raise
    finally:
        try:
            await file.close()
        except Exception:
            pass

    return await run_in_threadpool(
        _finalize_import,
        project_id=project_id,
        source_path=destination,
        original_filename=file.filename,
        file_size=size,
        name=name,
    )


@router.post("/projects/url", status_code=201)
async def import_from_url(payload: UrlImportRequest) -> dict:
    settings = get_settings()
    storage = get_storage()
    project_id = new_id()
    filename = safe_stem(payload.url.rsplit("/", 1)[-1] or "video")
    suffix = safe_suffix(payload.url.rsplit("?", 1)[0])
    destination = storage.source_path(project_id, suffix)
    try:
        size = await run_in_threadpool(
            download_direct_url,
            payload.url,
            destination,
            max_bytes=settings.max_url_download_mb * 1024 * 1024,
        )
    except Exception:
        try:
            shutil.rmtree(destination.parent, ignore_errors=True)
        except OSError:
            pass
        raise
    return await run_in_threadpool(
        _finalize_import,
        project_id=project_id,
        source_path=destination,
        original_filename=filename + suffix,
        file_size=size,
        name=payload.name,
        source_url=payload.url,
    )


@router.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        project = (
            session.query(Project)
            .options(selectinload(Project.clips))
            .filter(Project.id == project_id)
            .one_or_none()
        )
        if project is None:
            raise NotFoundError("This project no longer exists.")
        payload = project_to_dict(project, include_clips=True)
        payload["active_job"] = manager.has_active(project_id)
    payload["jobs"] = manager.list(project_id=project_id, limit=10)
    return payload


@router.patch("/projects/{project_id}")
def update_project(project_id: str, payload: ProjectUpdate) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        project.name = payload.name
        session.flush()
        return project_to_dict(project)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    manager = get_job_manager()
    if manager.has_active(project_id):
        raise ConflictError(
            "This project has a running job. Wait for it to finish or cancel it first."
        )
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        delete_project_files(project)
        session.delete(project)
    return {"deleted": True, "project_id": project_id}


@router.patch("/projects/{project_id}/analysis-settings")
def update_analysis_settings(project_id: str, payload: AnalysisSettings) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        set_analysis_settings(project, payload)
        session.flush()
    return {"analysis_settings": payload.model_dump()}


@router.post("/projects/{project_id}/process", status_code=202)
def process_project(project_id: str, payload: ProcessRequest) -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        if not project.source_path or not Path(project.source_path).is_file():
            raise MediaError("The source video file is missing from local storage.")
    if manager.has_active(project_id):
        raise ConflictError("A job is already running for this project.")
    return manager.create(
        "process",
        project_id,
        {
            "analysis": payload.analysis.model_dump(),
            "reuse_transcript": payload.reuse_transcript,
            "force_transcribe": payload.force_transcribe,
        },
    )


@router.post("/projects/{project_id}/analyze", status_code=202)
def analyze_project(project_id: str, payload: AnalyzeRequest) -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        if not project.transcript_path or not Path(project.transcript_path).is_file():
            raise TranscriptionError(
                "No transcript exists yet. Run the processing pipeline or import a subtitle file first."
            )
    if manager.has_active(project_id):
        raise ConflictError("A job is already running for this project.")
    return manager.create(
        "analyze",
        project_id,
        {
            "analysis": payload.analysis.model_dump(),
            "replace": payload.replace,
        },
    )


@router.get("/projects/{project_id}/transcript")
def get_transcript(project_id: str) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        path = project.transcript_path
    if not path or not Path(path).is_file():
        raise NotFoundError("No transcript exists for this project yet.")
    transcript = load_transcript(Path(path))
    return {
        "language": transcript.language,
        "provider": transcript.provider,
        "model": transcript.model,
        "duration": transcript.duration,
        "speakers": transcript.speakers,
        "word_count": transcript.word_count,
        "text": transcript.text,
        "segments": [segment.model_dump() for segment in transcript.segments],
    }


@router.post("/projects/{project_id}/transcript")
def import_transcript(project_id: str, payload: TranscriptImportRequest) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
    transcript = parse_subtitle_text(payload.text)
    if payload.language:
        transcript.language = payload.language
    storage = get_storage()
    path = storage.transcript_path(project_id)
    save_transcript(transcript, path)
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        project.transcript_path = str(path)
        project.language = transcript.language
        project.error = None
        if project.status == "error":
            project.status = "draft"
    return {
        "imported": True,
        "segments": len(transcript.segments),
        "language": transcript.language,
        "word_count": transcript.word_count,
    }


@router.get("/projects/{project_id}/transcript/download")
def download_transcript(project_id: str, format: str = Query(default="srt")):
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        name = project.name
        path = project.transcript_path
    if not path or not Path(path).is_file():
        raise NotFoundError("No transcript exists for this project yet.")
    transcript = load_transcript(Path(path))
    fmt = (format or "srt").lower()
    if fmt == "json":
        return Response(
            content=transcript.model_dump_json(indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{_safe(name)}.json"'},
        )
    if fmt == "vtt":
        blocks = ["WEBVTT", ""]
        for segment in transcript.segments:
            blocks.append(
                f"{format_vtt_time(segment.start)} --> {format_vtt_time(segment.end)}\n{segment.text}\n"
            )
        content = "\n".join(blocks)
        media = "text/vtt"
    else:
        blocks = []
        for index, segment in enumerate(transcript.segments, start=1):
            blocks.append(
                f"{index}\n{format_srt_time(segment.start)} --> {format_srt_time(segment.end)}\n{segment.text}\n"
            )
        content = "\n".join(blocks)
        media = "application/x-subrip"
    return Response(
        content=content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{_safe(name)}.{fmt}"'},
    )


def _safe(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " -_()" else " " for ch in name).strip()
    return (cleaned[:80] or "transcript").replace(" ", "_")
