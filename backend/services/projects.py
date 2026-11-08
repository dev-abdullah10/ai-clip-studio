"""Project and clip serialization / cleanup helpers."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from backend.core.config import get_storage
from backend.database.models import Clip, Project
from backend.schemas.clips import AnalysisSettings
from backend.services.transcription.service import load_transcript

logger = logging.getLogger(__name__)


def _safe_json(value: str | None) -> dict | list | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return None


def _file_version(path_value: str | None) -> int:
    if not path_value:
        return 0
    try:
        return int(Path(path_value).stat().st_mtime)
    except OSError:
        return 0


def clip_to_dict(clip: Clip, *, include_transcript: bool = True) -> dict:
    has_render = bool(clip.render_path and Path(clip.render_path).is_file())
    has_thumb = bool(clip.thumbnail_path and Path(clip.thumbnail_path).is_file())
    subtitle_settings = _safe_json(clip.subtitle_json)
    version = _file_version(clip.render_path)
    return {
        "id": clip.id,
        "project_id": clip.project_id,
        "order_index": clip.order_index,
        "title": clip.title,
        "description": clip.description,
        "reason": clip.reason,
        "hook": clip.hook,
        "category": clip.category,
        "score": round(clip.score, 1),
        "start": round(clip.start, 3),
        "end": round(clip.end, 3),
        "duration": round(max(0.0, clip.end - clip.start), 3),
        "transcript_text": clip.transcript_text if include_transcript else "",
        "speaker": clip.speaker,
        "aspect_ratio": clip.aspect_ratio,
        "crop_mode": clip.crop_mode,
        "crop_offset": round(clip.crop_offset, 4),
        "crop_confidence": (
            round(clip.crop_confidence, 3) if clip.crop_confidence is not None else None
        ),
        "subtitle_enabled": clip.subtitle_enabled,
        "subtitle_settings": subtitle_settings,
        "render_status": clip.render_status,
        "has_render": has_render,
        "render_url": f"/api/media/clips/{clip.id}/video?v={version}" if has_render else None,
        "thumbnail_url": (
            f"/api/media/clips/{clip.id}/thumbnail?v={_file_version(clip.thumbnail_path) or version}"
            if has_thumb
            else None
        ),
        "status": clip.status,
        "created_at": clip.created_at,
        "updated_at": clip.updated_at,
    }


def project_to_dict(project: Project, *, include_clips: bool = False) -> dict:
    clips = sorted(project.clips, key=lambda c: c.order_index)
    thumbnail_exists = bool(
        project.thumbnail_path and Path(project.thumbnail_path).is_file()
    )
    source_exists = bool(project.source_path and Path(project.source_path).is_file())
    data = {
        "id": project.id,
        "name": project.name,
        "source_filename": project.source_filename,
        "source_url": project.source_url,
        "source_exists": source_exists,
        "duration": round(project.duration or 0.0, 3),
        "width": project.width,
        "height": project.height,
        "fps": project.fps,
        "has_audio": project.has_audio,
        "video_codec": project.video_codec,
        "audio_codec": project.audio_codec,
        "file_size": project.file_size,
        "thumbnail_url": (
            f"/api/media/projects/{project.id}/thumbnail?v={_file_version(project.thumbnail_path)}"
            if thumbnail_exists
            else None
        ),
        "status": project.status,
        "error": project.error,
        "language": project.language,
        "has_transcript": bool(
            project.transcript_path and Path(project.transcript_path).is_file()
        ),
        "analysis_settings": _safe_json(project.analysis_settings_json),
        "analysis": _safe_json(project.analysis_json),
        "clip_count": len(clips),
        "rendered_clip_count": sum(1 for c in clips if c.render_status == "ready"),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }
    if include_clips:
        data["clips"] = [clip_to_dict(clip) for clip in clips]
        data["transcript_meta"] = transcript_meta(project)
    return data


def transcript_meta(project: Project) -> dict | None:
    if not project.transcript_path or not Path(project.transcript_path).is_file():
        return None
    try:
        transcript = load_transcript(Path(project.transcript_path))
    except Exception:
        logger.debug("Could not read transcript metadata", exc_info=True)
        return None
    return {
        "language": transcript.language,
        "provider": transcript.provider,
        "model": transcript.model,
        "segment_count": len(transcript.segments),
        "word_count": transcript.word_count,
        "duration": round(transcript.duration, 2),
        "speakers": transcript.speakers,
        "text": transcript.text,
    }


def analysis_settings_for(project: Project) -> AnalysisSettings | None:
    payload = _safe_json(project.analysis_settings_json)
    if not isinstance(payload, dict):
        return None
    try:
        return AnalysisSettings(**payload)
    except Exception:
        return None


def set_analysis_settings(project: Project, settings: AnalysisSettings) -> None:
    project.analysis_settings_json = json.dumps(settings.model_dump(), indent=2)


def delete_project_files(project: Project) -> None:
    """Remove every file this project created, ignoring missing paths."""
    storage = get_storage()
    clip_ids = [clip.id for clip in project.clips]
    paths: list[Path] = []
    if project.source_path:
        paths.append(Path(project.source_path))
    if project.transcript_path:
        paths.append(Path(project.transcript_path))
    if project.thumbnail_path:
        paths.append(Path(project.thumbnail_path))
    for clip in project.clips:
        if clip.render_path:
            paths.append(Path(clip.render_path))
        if clip.thumbnail_path:
            paths.append(Path(clip.thumbnail_path))
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.debug("Could not delete %s", path)
    for directory in (
        storage.project_dir(project.id),
        storage.audio_dir(project.id),
        storage.export_dir(project.id),
    ):
        try:
            shutil.rmtree(directory, ignore_errors=True)
        except OSError:
            pass
    for clip_id in clip_ids:
        try:
            storage.clip_path(clip_id).unlink(missing_ok=True)
        except OSError:
            pass
