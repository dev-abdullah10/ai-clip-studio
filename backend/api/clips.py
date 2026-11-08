"""Clip editing, subtitle preview/export and clip rendering endpoints."""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from backend.core.config import get_storage
from backend.core.exceptions import MediaError, NotFoundError, ValidationError
from backend.database.models import Clip, Project, new_id
from backend.database.session import session_scope
from backend.schemas.api import RenderClipRequest
from backend.schemas.clips import ClipUpdate, ReframeAnalyzeRequest, SubtitleSettings
from backend.services.cropping import target_dimensions
from backend.services.jobs import get_job_manager
from backend.services.projects import clip_to_dict
from backend.services.settings_service import get_app_settings
from backend.services.subtitles.service import (
    build_cues,
    preview_payload,
    write_ass,
    write_srt,
    write_vtt,
)
from backend.services.transcription.service import load_transcript
from backend.services.video.faces import analyze_faces
from backend.services.reframing.engine import analyze_reframe
from backend.services.video.thumbnail import generate_thumbnail

logger = logging.getLogger(__name__)
router = APIRouter(tags=["clips"])


def _get_clip(session, clip_id: str) -> Clip:
    clip = session.get(Clip, clip_id)
    if clip is None:
        raise NotFoundError("This clip no longer exists.")
    return clip


@router.get("/clips/{clip_id}")
def get_clip(clip_id: str) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        return clip_to_dict(clip)


@router.patch("/clips/{clip_id}")
def update_clip(clip_id: str, payload: ClipUpdate) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None:
            raise NotFoundError("The project for this clip no longer exists.")
        render_affecting = False

        if payload.title is not None:
            clip.title = payload.title.strip()[:300] or "Untitled clip"
        if payload.description is not None:
            clip.description = payload.description.strip()[:4000]
        if payload.category is not None:
            clip.category = payload.category.strip().lower()[:60] or "general"
        if payload.start is not None:
            clip.start = max(0.0, float(payload.start))
            render_affecting = True
        if payload.end is not None:
            clip.end = float(payload.end)
            render_affecting = True
        duration = project.duration or 0.0
        if clip.end <= clip.start:
            raise ValidationError("The clip end must be after its start.")
        if duration and clip.end > duration + 0.25:
            raise ValidationError("The clip end cannot be later than the source video.")
        if clip.end - clip.start < 1.0:
            raise ValidationError("Clips must be at least one second long.")
        if payload.aspect_ratio is not None:
            clip.aspect_ratio = payload.aspect_ratio
            render_affecting = True
        if payload.crop_mode is not None:
            clip.crop_mode = payload.crop_mode
            render_affecting = True
        if payload.crop_offset is not None:
            clip.crop_offset = float(payload.crop_offset)
            render_affecting = True
        if payload.subtitle_enabled is not None:
            clip.subtitle_enabled = bool(payload.subtitle_enabled)
            render_affecting = True
        if payload.subtitle_settings is not None:
            clip.subtitle_json = json.dumps(payload.subtitle_settings.model_dump())
            render_affecting = True
        if payload.status is not None:
            allowed = {"suggested", "approved", "rejected"}
            if payload.status not in allowed:
                raise ValidationError("Unsupported clip status.")
            clip.status = payload.status
        if render_affecting and clip.render_path:
            clip.render_status = "stale"
        session.flush()
        return clip_to_dict(clip)


@router.post("/clips/{clip_id}/duplicate", status_code=201)
def duplicate_clip(clip_id: str) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None:
            raise NotFoundError("The project for this clip no longer exists.")
        order = max((c.order_index for c in project.clips), default=-1) + 1
        duplicate = Clip(
            id=new_id(),
            project_id=clip.project_id,
            order_index=order,
            title=f"{clip.title} (copy)"[:300],
            description=clip.description,
            reason=clip.reason,
            hook=clip.hook,
            category=clip.category,
            score=clip.score,
            start=clip.start,
            end=clip.end,
            transcript_text=clip.transcript_text,
            speaker=clip.speaker,
            aspect_ratio=clip.aspect_ratio,
            crop_mode=clip.crop_mode,
            crop_offset=clip.crop_offset,
            crop_confidence=clip.crop_confidence,
            subtitle_enabled=clip.subtitle_enabled,
            subtitle_json=clip.subtitle_json,
            status="suggested",
        )
        session.add(duplicate)
        session.flush()
        new_id_value = duplicate.id
        source_path = project.source_path
        start = duplicate.start
        end = duplicate.end
        payload = clip_to_dict(duplicate)
    thumbnail: Path | None = None
    if source_path and Path(source_path).is_file():
        try:
            thumbnail = generate_thumbnail(
                Path(source_path),
                get_storage().clip_thumbnail(new_id_value),
                timestamp=min(end - 0.1, start + 1.0),
                width=640,
            )
        except Exception:
            logger.debug("Duplicate thumbnail failed", exc_info=True)
    if thumbnail is not None:
        with session_scope() as session:
            row = session.get(Clip, new_id_value)
            if row is not None:
                row.thumbnail_path = str(thumbnail)
                payload = clip_to_dict(row)
    return payload


@router.delete("/clips/{clip_id}")
def delete_clip(clip_id: str) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        paths = [clip.render_path, clip.thumbnail_path]
        session.delete(clip)
        if project is not None:
            remaining = (
                session.query(Clip)
                .filter(Clip.project_id == project.id, Clip.id != clip_id)
                .order_by(Clip.order_index)
                .all()
            )
            for index, item in enumerate(remaining):
                item.order_index = index
    for value in paths:
        if value:
            try:
                Path(value).unlink(missing_ok=True)
            except OSError:
                pass
    return {"deleted": True, "clip_id": clip_id}


@router.post("/clips/{clip_id}/faces")
def detect_clip_faces(clip_id: str) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None or not project.source_path:
            raise NotFoundError("The source video for this clip is missing.")
        source = project.source_path
        start, end = clip.start, clip.end
    analysis = analyze_faces(Path(source), start=start, end=end, samples=11)
    mode = "face" if analysis.detected else "center"
    offset = analysis.offset_x if analysis.detected else 0.5
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        clip.crop_mode = mode
        clip.crop_offset = round(offset, 4)
        clip.crop_confidence = analysis.confidence
        clip.render_status = "stale" if clip.render_path else clip.render_status
        session.flush()
        payload = clip_to_dict(clip)
    return {"analysis": analysis.to_dict(), "clip": payload}


def _subtitle_context(clip_id: str):
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None:
            raise NotFoundError("The project for this clip no longer exists.")
        if not project.transcript_path or not Path(project.transcript_path).is_file():
            raise NotFoundError(
                "This clip has no transcript yet. Transcribe the video or import a subtitle file first."
            )
        transcript = load_transcript(Path(project.transcript_path))
        app_settings = get_app_settings()
        settings = app_settings.subtitles
        if clip.subtitle_json:
            try:
                settings = SubtitleSettings(**json.loads(clip.subtitle_json))
            except Exception:
                settings = app_settings.subtitles
        target_w, target_h = target_dimensions(
            clip.aspect_ratio,
            app_settings.video.resolution,
            project.width or 0,
            project.height or 0,
        )
        clips_data = (
            clip.id,
            clip.title,
            clip.start,
            clip.end,
            clip.aspect_ratio,
            clip.subtitle_enabled,
        )
    cues = build_cues(transcript, clips_data[2], clips_data[3], settings)
    return clips_data, cues, settings, (target_w, target_h)


@router.get("/clips/{clip_id}/subtitles")
def preview_subtitles(clip_id: str) -> dict:
    clips_data, cues, settings, (target_w, target_h) = _subtitle_context(clip_id)
    _, _title, start, end, _aspect, enabled = clips_data
    payload = preview_payload(
        cues,
        settings,
        target_w=target_w,
        target_h=target_h,
        clip_duration=end - start,
    )
    payload["enabled"] = enabled
    return payload


@router.get("/clips/{clip_id}/subtitles/download")
def download_subtitles(clip_id: str, format: str = Query(default="srt")):
    clips_data, cues, settings, (target_w, target_h) = _subtitle_context(clip_id)
    _, title, _start, _end, _aspect, _enabled = clips_data
    if not cues:
        raise NotFoundError("No subtitle cues fall inside this clip.")
    fmt = (format or "srt").lower()
    storage = get_storage()
    directory = storage.temp_dir("subtitle_exports")
    safe_title = "".join(ch if ch.isalnum() or ch in " -_()" else " " for ch in title)
    safe_title = (safe_title[:60].strip().replace(" ", "_") or "clip")
    if fmt == "ass":
        path = directory / f"{clip_id}_{int(time.time())}.ass"
        write_ass(cues, settings, path, target_w=target_w, target_h=target_h)
        media = "text/x-ssa"
    elif fmt == "vtt":
        path = directory / f"{clip_id}_{int(time.time())}.vtt"
        write_vtt(cues, path)
        media = "text/vtt"
    else:
        path = directory / f"{clip_id}_{int(time.time())}.srt"
        write_srt(cues, path)
        media = "application/x-subrip"
    return FileResponse(
        path,
        media_type=media,
        filename=f"{safe_title}.{fmt if fmt != 'ass' else 'ass'}",
    )


@router.post("/clips/{clip_id}/render", status_code=202)
def render_clip_endpoint(clip_id: str, payload: RenderClipRequest) -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None:
            raise NotFoundError("The project for this clip no longer exists.")
        if not project.source_path or not Path(project.source_path).is_file():
            raise MediaError("The source video file is missing from local storage.")
        project_id = project.id
    return manager.create(
        "render_clip",
        project_id,
        {"clip_id": clip_id, "settings": payload.settings.model_dump()},
    )


@router.post("/clips/{clip_id}/thumbnail")
def regenerate_clip_thumbnail(clip_id: str) -> dict:
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None or not project.source_path:
            raise NotFoundError("The source video for this clip is missing.")
        source = project.source_path
        start, end = clip.start, clip.end
    timestamp = min(end - 0.1, start + max(0.5, min(2.0, (end - start) / 3.0)))
    path = generate_thumbnail(
        Path(source),
        get_storage().clip_thumbnail(clip_id),
        timestamp=timestamp,
        width=640,
    )
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        clip.thumbnail_path = str(path)
        session.flush()
        payload = clip_to_dict(clip)
    return {"clip": payload}


@router.post("/clips/{clip_id}/reframe/analyze")
def analyze_clip_reframe(clip_id: str, payload: ReframeAnalyzeRequest | None = None) -> dict:
    payload = payload or ReframeAnalyzeRequest()
    with session_scope() as session:
        clip = _get_clip(session, clip_id)
        project = session.get(Project, clip.project_id)
        if project is None or not project.source_path:
            raise NotFoundError("The source video for this clip is missing.")
        source_path = project.source_path
        width = project.width or 0
        height = project.height or 0
        start, end = clip.start, clip.end
        aspect = payload.target_aspect or clip.aspect_ratio
    plan = analyze_reframe(
        Path(source_path),
        start=start,
        end=end,
        target_aspect=aspect,
        mode=payload.mode,
        smoothing=payload.smoothing,
        sample_fps=payload.sample_fps,
        storage_root=get_storage().root,
    )
    return {"clip_id": clip_id, "plan": plan.to_dict(), "source_width": width, "source_height": height}
