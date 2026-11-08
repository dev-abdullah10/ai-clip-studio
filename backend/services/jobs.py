"""Persistent background job manager and processing pipelines."""

from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from backend.core.config import get_settings, get_storage
from backend.core.exceptions import (
    AICSException,
    FFmpegError,
    JobCancelled,
    MediaError,
    NotFoundError,
    ProviderAuthError,
    ProviderError,
    TranscriptionError,
)
from backend.database.base import utcnow_iso
from backend.database.models import Clip, ExportRecord, Job, Project, new_id
from backend.database.session import session_scope
from backend.schemas.clips import AnalysisSettings, ExportSettings, RenderSettings, SubtitleSettings
from backend.schemas.transcript import TranscriptData
from backend.services.ai_analysis.analyzer import analyze_transcript
from backend.services.audio.extract import extract_audio
from backend.services.exports import (
    build_filename,
    cleanup_work_dir,
    create_zip,
    unique_path,
)
from backend.services.projects import set_analysis_settings
from backend.services.provider_registry import get_llm_provider, get_speech_provider
from backend.services.rendering import render_clip
from backend.services.settings_service import get_app_settings
from backend.services.transcription.service import (
    load_transcript,
    save_transcript,
    transcribe_audio_file,
)
from backend.services.video.faces import FaceAnalysis, analyze_faces, suggest_crop_mode
from backend.services.video.scenes import detect_scene_times
from backend.services.video.thumbnail import generate_thumbnail

logger = logging.getLogger(__name__)

JOB_KINDS = {"process", "analyze", "render_clip", "export"}
ACTIVE_STATUSES = ("queued", "running")


@dataclass
class JobContext:
    manager: "JobManager"
    job_id: str
    cancel_event: threading.Event
    result: dict[str, Any] | None = None

    def __post_init__(self) -> None:
        self._progress = 0.0
        self._message = ""
        self._stage = ""
        self._last_write = 0.0
        self._lock = threading.Lock()

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise JobCancelled("Job cancelled")

    def update(
        self,
        progress: float | None = None,
        message: str | None = None,
        *,
        stage: str | None = None,
        force: bool = False,
    ) -> None:
        with self._lock:
            if progress is not None:
                try:
                    value = float(progress)
                except (TypeError, ValueError):
                    value = self._progress
                self._progress = max(self._progress, min(100.0, max(0.0, value)))
            if message:
                self._message = str(message)[:600]
            if stage and stage != self._stage:
                self._stage = str(stage)[:100]
                force = True
            now = time.monotonic()
            if not force and (now - self._last_write) < 0.6:
                return
            self._flush(now)

    def _flush(self, now: float) -> None:
        self._last_write = now
        try:
            with session_scope() as session:
                job = session.get(Job, self.job_id)
                if job is None or job.status != "running":
                    return
                job.progress = round(self._progress, 2)
                job.message = self._message
                if self._stage:
                    job.stage = self._stage
                if job.cancel_requested:
                    self.cancel_event.set()
        except Exception:
            logger.debug("Could not persist job progress", exc_info=True)


def _mark_job(
    job_id: str,
    status: str,
    *,
    message: str | None = None,
    error: str | None = None,
    result: dict | None = None,
    stage: str | None = None,
    progress: float | None = None,
) -> None:
    try:
        with session_scope() as session:
            job = session.get(Job, job_id)
            if job is None:
                return
            job.status = status
            if message is not None:
                job.message = message
            if error is not None:
                job.error = error
            if result is not None:
                try:
                    job.result_json = json.dumps(result, default=str)
                except (TypeError, ValueError):
                    job.result_json = json.dumps({"ok": True})
            if stage is not None:
                job.stage = stage
            if progress is not None:
                job.progress = round(max(0.0, min(100.0, float(progress))), 2)
            if status in {"completed", "failed", "cancelled"}:
                job.finished_at = utcnow_iso()
    except Exception:
        logger.exception("Could not update job %s", job_id)


class JobManager:
    def __init__(self, max_workers: int | None = None):
        settings = get_settings()
        workers = max_workers or max(1, min(4, settings.max_concurrent_jobs))
        self._executor = ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="aics-job"
        )
        self._lock = threading.RLock()
        self._events: dict[str, threading.Event] = {}
        self._futures: dict[str, Any] = {}

    def recover_interrupted(self) -> int:
        count = 0
        try:
            with session_scope() as session:
                jobs = (
                    session.query(Job)
                    .filter(Job.status.in_(ACTIVE_STATUSES))
                    .all()
                )
                for job in jobs:
                    job.status = "failed"
                    job.error = (
                        "The app was closed while this job was running. Start the job again."
                    )
                    job.message = "Interrupted by app restart."
                    job.finished_at = utcnow_iso()
                    count += 1
        except Exception:
            logger.exception("Could not recover interrupted jobs")
        if count:
            logger.warning("Marked %s interrupted job(s) as failed", count)
        return count

    def create(
        self, kind: str, project_id: str | None, params: dict | None = None
    ) -> dict:
        if kind not in JOB_KINDS:
            raise ValueError(f"Unknown job kind: {kind}")
        with session_scope() as session:
            if project_id is not None and session.get(Project, project_id) is None:
                raise NotFoundError("This project no longer exists.")
            job = Job(
                id=new_id(),
                project_id=project_id,
                kind=kind,
                status="queued",
                stage="Queued",
                progress=0.0,
                message="Waiting to start…",
                params_json=json.dumps(params or {}, default=str),
            )
            session.add(job)
            session.flush()
            job_id = job.id
        event = threading.Event()
        with self._lock:
            self._events[job_id] = event
            self._futures[job_id] = self._executor.submit(
                self._run, job_id, kind, project_id, params or {}, event
            )
        return self.get(job_id) or {"id": job_id, "kind": kind, "status": "queued"}

    def _run(
        self,
        job_id: str,
        kind: str,
        project_id: str | None,
        params: dict,
        event: threading.Event,
    ) -> None:
        try:
            with session_scope() as session:
                job = session.get(Job, job_id)
                if job is None:
                    return
                if job.cancel_requested or event.is_set():
                    _mark_job(job_id, "cancelled", message="Cancelled before it started.")
                    return
                job.status = "running"
                job.started_at = utcnow_iso()
                job.stage = "Starting"
                job.message = "Starting…"
                job.progress = 0.0
            ctx = JobContext(self, job_id, event)
            handler = HANDLERS.get(kind)
            if handler is None:
                raise AICSException(f"Unknown job kind: {kind}")
            result = handler(ctx, project_id or "", params)
            ctx.update(100.0, "Completed.", stage="Finished", force=True)
            _mark_job(
                job_id,
                "completed",
                message="Completed.",
                result=result,
                stage="Finished",
                progress=100.0,
            )
        except JobCancelled:
            _mark_job(
                job_id,
                "cancelled",
                message="Cancelled.",
                stage="Cancelled",
            )
        except AICSException as exc:
            logger.warning("Job %s failed: %s", job_id, exc.message, exc_info=True)
            _mark_job(job_id, "failed", message=exc.message, error=exc.message)
            if project_id and kind in {"process", "analyze"}:
                _set_project_error(project_id, exc.message)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Job %s crashed", job_id)
            _mark_job(
                job_id,
                "failed",
                message="An unexpected error stopped this job.",
                error=f"{type(exc).__name__}: {exc}"[:2000],
            )
            if project_id and kind in {"process", "analyze"}:
                _set_project_error(
                    project_id, "An unexpected error stopped processing. Check the logs."
                )
        finally:
            with self._lock:
                self._events.pop(job_id, None)
                self._futures.pop(job_id, None)

    def cancel(self, job_id: str) -> dict:
        with session_scope() as session:
            job = session.get(Job, job_id)
            if job is None:
                raise NotFoundError("This job no longer exists.")
            if job.status not in ACTIVE_STATUSES:
                return {"id": job_id, "status": job.status}
            job.cancel_requested = True
            status = job.status
        event = self._events.get(job_id)
        if event is not None:
            event.set()
        future = self._futures.get(job_id)
        if status == "queued" and future is not None and future.cancel():
            _mark_job(job_id, "cancelled", message="Cancelled before it started.")
            with self._lock:
                self._events.pop(job_id, None)
                self._futures.pop(job_id, None)
        return {"id": job_id, "status": "cancelling" if status == "running" else "cancelled"}

    def get(self, job_id: str) -> dict | None:
        with session_scope() as session:
            job = session.get(Job, job_id)
            if job is None:
                return None
            return _job_to_dict(job)

    def list(
        self,
        *,
        project_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict]:
        with session_scope() as session:
            query = session.query(Job)
            if project_id:
                query = query.filter(Job.project_id == project_id)
            if status:
                query = query.filter(Job.status == status)
            jobs = query.order_by(Job.created_at.desc()).limit(max(1, min(200, limit))).all()
            return [_job_to_dict(job) for job in jobs]

    def has_active(self, project_id: str) -> bool:
        with session_scope() as session:
            count = (
                session.query(Job)
                .filter(Job.project_id == project_id, Job.status.in_(ACTIVE_STATUSES))
                .count()
            )
            return count > 0

    def shutdown(self) -> None:
        with self._lock:
            for event in self._events.values():
                event.set()
        self._executor.shutdown(wait=False, cancel_futures=True)


def _set_project_error(project_id: str, message: str) -> None:
    try:
        with session_scope() as session:
            project = session.get(Project, project_id)
            if project is not None and project.status == "processing":
                project.status = "error"
                project.error = message[:2000]
    except Exception:
        logger.debug("Could not update project error state", exc_info=True)


def _job_to_dict(job: Job) -> dict:
    def _parse(value: str | None):
        if not value:
            return None
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None

    return {
        "id": job.id,
        "project_id": job.project_id,
        "kind": job.kind,
        "status": job.status,
        "stage": job.stage,
        "progress": round(job.progress or 0.0, 2),
        "message": job.message or "",
        "error": job.error,
        "params": _parse(job.params_json),
        "result": _parse(job.result_json),
        "cancel_requested": bool(job.cancel_requested),
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


# ---------------------------------------------------------------------------
# Pipelines
# ---------------------------------------------------------------------------


def _snapshot_project(project_id: str) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        return {
            "id": project.id,
            "name": project.name,
            "source_path": project.source_path,
            "duration": project.duration or 0.0,
            "width": project.width or 0,
            "height": project.height or 0,
            "has_audio": bool(project.has_audio),
            "transcript_path": project.transcript_path,
            "scenes_json": project.scenes_json,
            "status": project.status,
        }


def _scene_times_from(value: str | None) -> list[float]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    return [float(item) for item in data if isinstance(item, (int, float))]


def _reuse_transcript(project: dict) -> TranscriptData | None:
    path = project.get("transcript_path")
    if not path or not Path(path).is_file():
        return None
    try:
        transcript = load_transcript(Path(path))
    except Exception:
        return None
    if abs(transcript.duration - project["duration"]) > 3.0:
        return None
    return transcript


def _ensure_audio(ctx: JobContext, project: dict, storage) -> Path:
    audio_path = storage.audio_dir(project["id"]) / "audio.mp3"
    if audio_path.is_file() and audio_path.stat().st_size > 512:
        return audio_path
    if not project["has_audio"]:
        raise MediaError(
            "This video has no audio track, so there is no speech to transcribe. "
            "Import a video with audio or add a subtitle file manually."
        )
    ctx.update(2.0, "Extracting audio locally…", stage="Extracting audio", force=True)
    extract_audio(
        Path(project["source_path"]),
        audio_path,
        duration=project["duration"],
        cancel_event=ctx.cancel_event,
        on_progress=lambda p: ctx.update(2.0 + p * 0.05, "Extracting audio locally…"),
    )
    return audio_path


def _transcribe(
    ctx: JobContext,
    project: dict,
    analysis: AnalysisSettings,
    audio_path: Path,
    storage,
) -> TranscriptData:
    ctx.update(8.0, "Starting transcription…", stage="Transcribing", force=True)
    provider = get_speech_provider(analysis.speech_provider, analysis.speech_model)
    transcript = transcribe_audio_file(
        audio_path,
        project["duration"],
        provider,
        language=None if analysis.language in {"", "auto"} else analysis.language,
        work_dir=storage.temp_dir(ctx.job_id),
        cancel_event=ctx.cancel_event,
        on_progress=lambda p, message: ctx.update(8.0 + p * 0.47, message),
    )
    path = storage.transcript_path(project["id"])
    save_transcript(transcript, path)
    with session_scope() as session:
        row = session.get(Project, project["id"])
        if row is not None:
            row.transcript_path = str(path)
            row.language = transcript.language
            row.status = "processing"
            row.error = None
    ctx.update(56.0, "Transcript saved.", stage="Transcribing", force=True)
    return transcript


def _detect_scenes(ctx: JobContext, project: dict, storage) -> list[float]:
    cached = _scene_times_from(project.get("scenes_json"))
    if cached:
        return cached
    ctx.update(57.0, "Detecting visual scene changes locally…", stage="Visual analysis", force=True)
    times = detect_scene_times(
        Path(project["source_path"]),
        duration=project["duration"],
        cancel_event=ctx.cancel_event,
    )
    with session_scope() as session:
        row = session.get(Project, project["id"])
        if row is not None:
            row.scenes_json = json.dumps(times)
    ctx.update(60.0, f"Found {len(times)} scene changes.", stage="Visual analysis", force=True)
    return times


def _llm_for(analysis: AnalysisSettings) -> tuple[Any, str | None]:
    if analysis.llm_provider == "local":
        return None, None
    try:
        return get_llm_provider(analysis.llm_provider, analysis.llm_model), None
    except (ProviderAuthError, ProviderError) as exc:
        if analysis.allow_llm_fallback:
            return None, f"{exc.message} Local transcript analysis was used instead."
        raise


def _dominant_speaker(transcript: TranscriptData, start: float, end: float) -> str | None:
    counts: dict[str, int] = {}
    for segment in transcript.segments:
        if segment.speaker and segment.end > start and segment.start < end:
            counts[segment.speaker] = counts.get(segment.speaker, 0) + len(segment.text.split())
    if not counts:
        return None
    return max(counts.items(), key=lambda item: item[1])[0]


def _analysis_summary(result, analysis: AnalysisSettings, warnings: list[str]) -> dict:
    return {
        "created_at": utcnow_iso(),
        "used_llm": result.used_llm,
        "provider": result.llm_provider,
        "model": result.llm_model,
        "chunk_count": result.chunk_count,
        "warnings": warnings + result.warnings,
        "discovery_mode": analysis.discovery_mode,
        "candidates": [
            {
                "start": candidate.start,
                "end": candidate.end,
                "title": candidate.title,
                "score": candidate.final_score,
                "llm_score": candidate.llm_score,
                "local_score": candidate.local_score,
                "components": candidate.components,
                "source": candidate.source,
            }
            for candidate in result.candidates
        ],
    }


def _apply_analysis(
    ctx: JobContext,
    project: dict,
    transcript: TranscriptData,
    analysis: AnalysisSettings,
    scene_times: list[float],
    *,
    progress_start: float,
    progress_end: float,
    replace: bool,
) -> dict:
    storage = get_storage()
    app_settings = get_app_settings()
    provider, provider_warning = _llm_for(analysis)
    warnings: list[str] = [provider_warning] if provider_warning else []

    ctx.update(
        progress_start,
        "Finding the best moments…" if provider else "Analyzing the transcript locally…",
        stage="AI analysis",
        force=True,
    )
    span = max(1.0, progress_end - progress_start)
    analysis_result = analyze_transcript(
        transcript,
        analysis,
        llm_provider=provider,
        scene_times=scene_times,
        cancel_event=ctx.cancel_event,
        on_progress=lambda p, message: ctx.update(
            progress_start + span * 0.68 * (p / 100.0), message
        ),
    )
    candidates = analysis_result.candidates
    if not candidates:
        raise ProviderError("No valid clip candidates were produced.")

    # Prepare clip assets outside the database transaction.
    old_clips: list[dict] = []
    if replace:
        with session_scope() as session:
            row = session.get(Project, project["id"])
            if row is not None:
                old_clips = [
                    {
                        "id": clip.id,
                        "render_path": clip.render_path,
                        "thumbnail_path": clip.thumbnail_path,
                    }
                    for clip in row.clips
                ]
        for old in old_clips:
            for value in (old["render_path"], old["thumbnail_path"]):
                if value:
                    try:
                        Path(value).unlink(missing_ok=True)
                    except OSError:
                        pass
            try:
                storage.clip_path(old["id"]).unlink(missing_ok=True)
            except OSError:
                pass

    prepared: list[dict] = []
    total = len(candidates)
    asset_base = progress_start + span * 0.72
    asset_span = span * 0.27
    for index, candidate in enumerate(candidates):
        ctx.check_cancelled()
        if total:
            ctx.update(
                asset_base + asset_span * (index / total),
                f"Framing clip {index + 1} of {total}…",
                stage="Preparing clips",
            )
        face = FaceAnalysis()
        if analysis.use_faces:
            face = analyze_faces(
                Path(project["source_path"]),
                start=candidate.start,
                end=candidate.end,
                samples=5,
                cancel_event=ctx.cancel_event,
            )
        crop_mode, crop_offset = suggest_crop_mode(face)
        clip_id = new_id()
        thumbnail_path: Path | None = None
        try:
            thumbnail_path = generate_thumbnail(
                Path(project["source_path"]),
                storage.clip_thumbnail(clip_id),
                timestamp=min(
                    candidate.end - 0.1,
                    candidate.start + max(0.5, min(2.0, candidate.duration / 3.0)),
                ),
                width=640,
                cancel_event=ctx.cancel_event,
            )
        except Exception:
            logger.debug("Clip thumbnail failed", exc_info=True)
        prepared.append(
            {
                "id": clip_id,
                "candidate": candidate,
                "face": face,
                "crop_mode": crop_mode,
                "crop_offset": crop_offset,
                "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
                "speaker": _dominant_speaker(transcript, candidate.start, candidate.end),
            }
        )

    with session_scope() as session:
        row = session.get(Project, project["id"])
        if row is None:
            raise NotFoundError("This project no longer exists.")
        if replace:
            for clip in list(row.clips):
                session.delete(clip)
            session.flush()
        start_order = (
            max((c.order_index for c in row.clips), default=-1) + 1 if not replace else 0
        )
        for index, item in enumerate(prepared):
            candidate = item["candidate"]
            clip = Clip(
                id=item["id"],
                project_id=row.id,
                order_index=start_order + index,
                title=candidate.title,
                description=candidate.description,
                reason=candidate.reason,
                hook=candidate.hook,
                category=candidate.category,
                score=candidate.final_score,
                start=candidate.start,
                end=candidate.end,
                transcript_text=candidate.transcript,
                speaker=item["speaker"],
                aspect_ratio=app_settings.video.aspect_ratio,
                crop_mode=item["crop_mode"],
                crop_offset=item["crop_offset"],
                crop_confidence=item["face"].confidence,
                subtitle_enabled=True,
                subtitle_json=json.dumps(app_settings.subtitles.model_dump()),
                thumbnail_path=item["thumbnail_path"],
                status="suggested",
            )
            session.add(clip)
        row.status = "ready"
        row.error = None
        row.analysis_json = json.dumps(
            _analysis_summary(analysis_result, analysis, warnings), indent=2
        )
        set_analysis_settings(row, analysis)

    ctx.update(
        progress_end,
        f"Created {len(prepared)} clips.",
        stage="Preparing clips",
        force=True,
    )
    return {
        "clip_count": len(prepared),
        "used_llm": analysis_result.used_llm,
        "llm_provider": analysis_result.llm_provider,
        "llm_model": analysis_result.llm_model,
        "warnings": warnings + analysis_result.warnings,
    }


def run_process(ctx: JobContext, project_id: str, params: dict) -> dict:
    storage = get_storage()
    project = _snapshot_project(project_id)
    if not project["source_path"] or not Path(project["source_path"]).is_file():
        raise MediaError("The source video file is missing from local storage.")
    payload = params.get("analysis") or {}
    analysis = AnalysisSettings(**payload)
    reuse = bool(params.get("reuse_transcript", True))
    force = bool(params.get("force_transcribe", False))

    ctx.update(1.0, "Checking the source video…", stage="Preparing", force=True)
    with session_scope() as session:
        row = session.get(Project, project_id)
        if row is not None:
            row.status = "processing"
            row.error = None

    transcript = None
    if reuse and not force:
        transcript = _reuse_transcript(project)
    if transcript is not None:
        ctx.update(56.0, "Reusing the saved transcript.", stage="Transcribing", force=True)
    else:
        audio = _ensure_audio(ctx, project, storage)
        transcript = _transcribe(ctx, project, analysis, audio, storage)

    scene_times = _detect_scenes(ctx, project, storage)
    result = _apply_analysis(
        ctx,
        project,
        transcript,
        analysis,
        scene_times,
        progress_start=62.0,
        progress_end=99.0,
        replace=True,
    )
    result["transcript_provider"] = transcript.provider
    result["transcript_model"] = transcript.model
    return result


def run_analyze(ctx: JobContext, project_id: str, params: dict) -> dict:
    storage = get_storage()
    project = _snapshot_project(project_id)
    transcript = _reuse_transcript(project)
    if transcript is None:
        raise TranscriptionError(
            "No saved transcript was found. Run the full processing pipeline first."
        )
    analysis = AnalysisSettings(**(params.get("analysis") or {}))
    scene_times = _detect_scenes(ctx, project, storage)
    with session_scope() as session:
        row = session.get(Project, project_id)
        if row is not None:
            row.status = "processing"
            row.error = None
    result = _apply_analysis(
        ctx,
        project,
        transcript,
        analysis,
        scene_times,
        progress_start=4.0,
        progress_end=99.0,
        replace=bool(params.get("replace", True)),
    )
    result["transcript_provider"] = transcript.provider
    return result


def _resolve_render_settings(clip: Clip, payload: dict, app_settings) -> RenderSettings:
    data = dict(payload or {})
    data.setdefault("aspect_ratio", clip.aspect_ratio)
    data.setdefault("crop_mode", clip.crop_mode)
    data.setdefault("crop_offset", clip.crop_offset)
    data.setdefault("subtitles", clip.subtitle_enabled)
    if "subtitle_settings" not in data:
        stored = None
        if clip.subtitle_json:
            try:
                stored = json.loads(clip.subtitle_json)
            except (json.JSONDecodeError, TypeError):
                stored = None
        data["subtitle_settings"] = stored or app_settings.subtitles.model_dump()
    if isinstance(data.get("subtitle_settings"), SubtitleSettings):
        data["subtitle_settings"] = data["subtitle_settings"].model_dump()
    return RenderSettings(**data)


def run_render_clip(ctx: JobContext, project_id: str, params: dict) -> dict:
    storage = get_storage()
    clip_id = params.get("clip_id")
    if not clip_id:
        raise MediaError("No clip was selected for rendering.")
    app_settings = get_app_settings()
    with session_scope() as session:
        project = session.get(Project, project_id)
        clip = session.get(Clip, clip_id)
        if project is None or clip is None or clip.project_id != project_id:
            raise NotFoundError("This clip no longer exists.")
        settings = _resolve_render_settings(clip, params.get("settings") or {}, app_settings)
        source_path = project.source_path
        width = project.width or 0
        height = project.height or 0
        has_audio = bool(project.has_audio)
        transcript_path = project.transcript_path
        start, end = clip.start, clip.end
        clip.aspect_ratio = settings.aspect_ratio
        clip.crop_mode = settings.crop_mode
        clip.crop_offset = settings.crop_offset
        clip.subtitle_enabled = settings.subtitles
        clip.subtitle_json = json.dumps(settings.subtitle_settings.model_dump())
        clip.render_status = "rendering"

    if not source_path or not Path(source_path).is_file():
        raise MediaError("The source video file is missing from local storage.")
    transcript = None
    if settings.subtitles:
        try:
            transcript = load_transcript(Path(transcript_path)) if transcript_path else None
        except Exception:
            transcript = None

    work_dir = storage.temp_dir(ctx.job_id)
    output = storage.clip_path(clip_id)
    try:
        ctx.update(1.0, "Starting render…", stage="Rendering", force=True)
        result = render_clip(
            Path(source_path),
            output,
            start=start,
            end=end,
            source_width=width,
            source_height=height,
            has_audio=has_audio,
            render=settings,
            transcript=transcript,
            work_dir=work_dir,
            cancel_event=ctx.cancel_event,
            prefer_gpu=get_app_settings().performance.prefer_gpu_encoding,
            on_progress=lambda p: ctx.update(1.0 + p * 0.95, "Rendering video…"),
            on_stage=lambda stage: ctx.update(stage=stage, force=True),
        )
    except Exception:
        with session_scope() as session:
            row = session.get(Clip, clip_id)
            if row is not None:
                row.render_status = "failed"
        raise
    finally:
        cleanup_work_dir(work_dir)

    with session_scope() as session:
        row = session.get(Clip, clip_id)
        if row is not None:
            row.render_path = str(result.output)
            row.render_status = "ready"
            row.render_updated_at = utcnow_iso()
            row.thumbnail_path = str(result.thumbnail) if result.thumbnail else row.thumbnail_path
    ctx.update(98.0, "Render complete.", stage="Finished", force=True)
    return {
        "clip_id": clip_id,
        "path": str(result.output),
        "size_bytes": result.output.stat().st_size,
        "width": result.width,
        "height": result.height,
        "duration": round(result.duration, 3),
        "has_subtitles": result.has_subtitles,
        "encoded_with": result.encoded_with,
    }


def run_export(ctx: JobContext, project_id: str, params: dict) -> dict:
    storage = get_storage()
    clip_ids = list(params.get("clip_ids") or [])
    if not clip_ids:
        raise MediaError("Select at least one clip to export.")
    export_settings = ExportSettings(**(params.get("settings") or {}))
    explicit_subtitles = "subtitle_settings" in (params.get("settings") or {})
    use_clip_subtitles = bool(params.get("use_clip_subtitles", True))
    app_settings = get_app_settings()

    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        source_path = project.source_path
        width = project.width or 0
        height = project.height or 0
        has_audio = bool(project.has_audio)
        transcript_path = project.transcript_path
        project_name = project.name
        plan = []
        for index, clip_id in enumerate(clip_ids, start=1):
            clip = session.get(Clip, clip_id)
            if clip is None or clip.project_id != project_id:
                continue
            filename = build_filename(
                export_settings.filename_pattern, project, clip, index
            )
            plan.append(
                {
                    "clip_id": clip.id,
                    "title": clip.title,
                    "start": clip.start,
                    "end": clip.end,
                    "filename": filename,
                    "subtitle_json": clip.subtitle_json,
                }
            )
    if not plan:
        raise NotFoundError("None of the selected clips exist any more.")

    transcript = None
    if export_settings.subtitles:
        try:
            transcript = load_transcript(Path(transcript_path)) if transcript_path else None
        except Exception:
            transcript = None

    export_dir = storage.export_dir(project_id)
    work_dir = storage.temp_dir(ctx.job_id)
    exported: list[dict] = []
    failures: list[dict] = []
    total = len(plan)
    try:
        for index, item in enumerate(plan):
            ctx.check_cancelled()
            base = (index / total) * 95.0
            ctx.update(
                base,
                f"Exporting clip {index + 1} of {total}…",
                stage="Exporting",
                force=True,
            )
            output = unique_path(export_dir, item["filename"])
            payload = export_settings.model_dump()
            # ExportSettings is a superset of RenderSettings; drop export-only keys.
            for key in ("filename_pattern", "create_zip", "output_format"):
                payload.pop(key, None)
            if use_clip_subtitles and not explicit_subtitles and item["subtitle_json"]:
                try:
                    payload["subtitle_settings"] = json.loads(item["subtitle_json"])
                except (json.JSONDecodeError, TypeError):
                    pass
            render_settings = RenderSettings(**payload)
            try:
                result = render_clip(
                    Path(source_path),
                    output,
                    start=item["start"],
                    end=item["end"],
                    source_width=width,
                    source_height=height,
                    has_audio=has_audio,
                    render=render_settings,
                    transcript=transcript,
                    work_dir=work_dir,
                    cancel_event=ctx.cancel_event,
                    prefer_gpu=app_settings.performance.prefer_gpu_encoding,
                    on_progress=lambda p, base=base: ctx.update(
                        base + (p / 100.0) * (95.0 / total),
                        "Exporting video…",
                    ),
                    on_stage=lambda stage: ctx.update(stage=stage, force=True),
                )
            except JobCancelled:
                raise
            except Exception as exc:
                logger.warning("Export failed for clip %s: %s", item["clip_id"], exc)
                failures.append({"clip_id": item["clip_id"], "error": str(exc)[:500]})
                continue
            size = result.output.stat().st_size
            exported.append(
                {
                    "clip_id": item["clip_id"],
                    "title": item["title"],
                    "filename": result.output.name,
                    "path": str(result.output),
                    "size_bytes": size,
                }
            )
            with session_scope() as session:
                session.add(
                    ExportRecord(
                        project_id=project_id,
                        job_id=ctx.job_id,
                        clip_id=item["clip_id"],
                        filename=result.output.name,
                        path=str(result.output),
                        size_bytes=size,
                        settings_json=json.dumps(render_settings.model_dump()),
                    )
                )

        if not exported:
            detail = failures[0]["error"] if failures else "No clips were rendered."
            raise FFmpegError(f"Every selected clip failed to export. {detail}")

        zip_path: Path | None = None
        if export_settings.create_zip and exported:
            ctx.update(96.0, "Creating ZIP archive…", stage="Packaging", force=True)
            zip_name = f"{_safe_zip_name(project_name)}_{len(exported)}_clips.zip"
            zip_path = create_zip([Path(item["path"]) for item in exported], export_dir / zip_name)
            with session_scope() as session:
                records = (
                    session.query(ExportRecord)
                    .filter(ExportRecord.job_id == ctx.job_id)
                    .all()
                )
                for record in records:
                    record.zip_path = str(zip_path)
            ctx.update(99.0, "ZIP archive created.", stage="Packaging", force=True)

        return {
            "files": exported,
            "failures": failures,
            "zip_path": str(zip_path) if zip_path else None,
            "export_dir": str(export_dir),
        }
    finally:
        cleanup_work_dir(work_dir)


def _safe_zip_name(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in " -_()" else " " for ch in name).strip()
    return cleaned[:80] or "Project"


HANDLERS: dict[str, Callable[[JobContext, str, dict], dict]] = {
    "process": run_process,
    "analyze": run_analyze,
    "render_clip": run_render_clip,
    "export": run_export,
}


_manager: JobManager | None = None
_manager_lock = threading.Lock()


def get_job_manager() -> JobManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            try:
                workers = get_app_settings().performance.max_concurrent_jobs
            except Exception:
                workers = get_settings().max_concurrent_jobs
            _manager = JobManager(max_workers=workers)
        return _manager


def shutdown_job_manager() -> None:
    global _manager
    with _manager_lock:
        if _manager is not None:
            _manager.shutdown()
            _manager = None
