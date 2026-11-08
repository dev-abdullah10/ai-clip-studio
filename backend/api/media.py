"""Local media streaming and preview-frame endpoints."""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from backend.core.config import get_storage
from backend.core.exceptions import NotFoundError, ValidationError
from backend.database.models import Clip, Project
from backend.database.session import session_scope
from backend.services.video.thumbnail import generate_thumbnail

logger = logging.getLogger(__name__)
router = APIRouter(tags=["media"])


def _file_response(path_value: str | None, *, download_name: str | None = None) -> FileResponse:
    if not path_value or not Path(path_value).is_file():
        raise NotFoundError("This file is no longer on disk.")
    path = Path(path_value)
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=download_name,
        headers={"Cache-Control": "private, max-age=0, must-revalidate"},
    )


@router.get("/media/projects/{project_id}/source")
def project_source(project_id: str):
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        path = project.source_path
    return _file_response(path)


@router.get("/media/projects/{project_id}/thumbnail")
def project_thumbnail(project_id: str):
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        path = project.thumbnail_path
    return _file_response(path)


@router.get("/media/clips/{clip_id}/video")
def clip_video(clip_id: str):
    with session_scope() as session:
        clip = session.get(Clip, clip_id)
        if clip is None:
            raise NotFoundError("This clip no longer exists.")
        path = clip.render_path
    return _file_response(path)


@router.get("/media/clips/{clip_id}/thumbnail")
def clip_thumbnail(clip_id: str):
    with session_scope() as session:
        clip = session.get(Clip, clip_id)
        if clip is None:
            raise NotFoundError("This clip no longer exists.")
        path = clip.thumbnail_path
        if not path:
            project = session.get(Project, clip.project_id)
            path = project.source_path if project else None
            fallback = True
        else:
            fallback = False
        if fallback:
            # No stored thumbnail: generate one from the source at the clip midpoint.
            if not path or not Path(path).is_file():
                raise NotFoundError("No thumbnail exists for this clip.")
            directory = get_storage().root / "temp" / "thumbs"
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / f"clip_{clip.id}.jpg"
            if not target.is_file():
                try:
                    generate_thumbnail(
                        Path(path),
                        target,
                        timestamp=clip.start + max(0.4, (clip.end - clip.start) / 2),
                        width=640,
                    )
                except Exception as exc:
                    logger.debug("Fallback clip thumbnail failed", exc_info=True)
                    raise NotFoundError("No thumbnail exists for this clip.") from exc
            path = str(target)
    return _file_response(path)


@router.get("/media/projects/{project_id}/frame")
def project_frame(
    project_id: str,
    t: float = Query(default=0.0, ge=0.0),
    width: int = Query(default=480, ge=160, le=1280),
):
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        source = project.source_path
        duration = project.duration or 0.0
    if not source or not Path(source).is_file():
        raise NotFoundError("The source video file is missing from local storage.")
    if duration and t > duration + 0.5:
        raise ValidationError("That timestamp is past the end of the video.")
    timestamp = max(0.0, min(t, max(0.0, duration - 0.05)))
    directory = get_storage().root / "temp" / "previews"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{project_id}_{timestamp:.2f}_{width}.jpg"
    if not target.is_file() or target.stat().st_size == 0:
        try:
            generate_thumbnail(Path(source), target, timestamp=timestamp, width=width, timeout=90)
        except Exception as exc:
            raise NotFoundError("A preview frame could not be generated at that time.") from exc
    return FileResponse(
        target,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )
