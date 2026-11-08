"""Clip rendering: aspect conversion, subtitles, audio processing and encoding."""

from __future__ import annotations

import logging
import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.core.config import get_settings
from backend.core.exceptions import FFmpegError, MediaError
from backend.schemas.clips import RenderSettings
from backend.schemas.transcript import TranscriptData
from backend.services.cropping import (
    build_audio_chain,
    build_crop_chain,
    build_dynamic_crop_chain,
    compute_crop,
    target_dimensions,
)
from backend.services.reframing.engine import ReframePlan, analyze_reframe
from backend.services.settings_service import get_app_settings
from backend.services.subtitles.service import (
    FONT_CANDIDATES,
    build_cues,
    write_ass,
)
from backend.services.video.thumbnail import generate_thumbnail
from backend.utils.ffmpeg import inspect_tools, run_ffmpeg

logger = logging.getLogger(__name__)

QUALITY_CRF = {"draft": 30, "standard": 25, "high": 21, "max": 18}
QUALITY_PRESET = {"draft": "veryfast", "standard": "medium", "high": "slow", "max": "veryslow"}
NVENC_CQ = {"draft": 32, "standard": 27, "high": 22, "max": 18}
NVENC_PRESET = {"draft": "p2", "standard": "p4", "high": "p5", "max": "p7"}


@dataclass
class RenderResult:
    output: Path
    width: int
    height: int
    duration: float
    has_subtitles: bool
    subtitle_path: Path | None
    encoded_with: str
    thumbnail: Path | None = None


def _copy_fonts(font_family: str, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    filenames: set[str] = set(FONT_CANDIDATES.get(font_family, []))
    filenames.update(FONT_CANDIDATES.get("Arial", []))
    windows_fonts = Path("C:/Windows/Fonts")
    if windows_fonts.is_dir():
        for filename in filenames:
            source = windows_fonts / filename
            target = destination / filename
            if source.is_file() and not target.exists():
                try:
                    shutil.copy2(source, target)
                except OSError:
                    logger.debug("Could not copy font %s", filename)
    return destination


def _validate_music(path: str | None) -> Path | None:
    if not path:
        return None
    candidate = Path(path).expanduser()
    if not candidate.is_file():
        raise MediaError(f"The selected music file does not exist: {candidate.name}")
    return candidate


def render_clip(
    source: Path,
    output: Path,
    *,
    start: float,
    end: float,
    source_width: int,
    source_height: int,
    has_audio: bool,
    render: RenderSettings,
    transcript: TranscriptData | None,
    work_dir: Path,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_stage: Callable[[str], None] | None = None,
    prefer_gpu: bool | None = None,
) -> RenderResult:
    """Render a single clip with real FFmpeg progress. Raises on failure."""
    if not Path(source).is_file():
        raise MediaError("The source video is missing from local storage.")
    duration = max(0.05, float(end) - float(start))
    target_w, target_h = target_dimensions(
        render.aspect_ratio, render.resolution, source_width, source_height
    )
    smart_modes = {"smart", "motion", "speaker", "gameplay", "screen"}
    plan_dict = getattr(render, "reframe_plan", None)
    if plan_dict is None and render.crop_mode in smart_modes:
        plan_obj = analyze_reframe(
            source,
            start=start,
            end=end,
            target_aspect=render.aspect_ratio,
            mode=render.crop_mode,
            storage_root=get_settings().storage_dir,
        )
        plan_dict = plan_obj.to_dict()
        render.reframe_plan = plan_dict
    plan = ReframePlan.from_dict(plan_dict) if isinstance(plan_dict, dict) else None
    if plan is not None and plan.layout in {"fit", "original", "blur"}:
        render.crop_mode = "original"

    geometry = compute_crop(
        source_width,
        source_height,
        target_w,
        target_h,
        mode=render.crop_mode,
        subject_offset=render.crop_offset,
    )
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_output = output.parent / f"{output.stem}.rendering.mp4"

    subtitle_label: str | None = None
    subtitle_path: Path | None = None
    if render.subtitles and transcript is not None and transcript.segments:
        if on_stage:
            on_stage("Building subtitles…")
        cues = build_cues(transcript, float(start), float(end), render.subtitle_settings)
        if cues:
            ass_path = work_dir / "subs.ass"
            write_ass(
                cues,
                render.subtitle_settings,
                ass_path,
                target_w=target_w,
                target_h=target_h,
            )
            _copy_fonts(render.subtitle_settings.font_family, work_dir / "fonts")
            # Relative paths avoid Windows drive-letter and comma escaping issues.
            subtitle_label = "ass=filename=subs.ass:fontsdir=fonts"
            subtitle_path = ass_path

    if plan is not None and plan.layout == "smart_crop" and plan.keyframes:
        video_graph = build_dynamic_crop_chain(
            geometry,
            keyframes=plan.keyframes,
            fps=render.fps,
            subtitle_label=subtitle_label,
        )
    else:
        video_graph = build_crop_chain(geometry, fps=render.fps, subtitle_label=subtitle_label)
    music = _validate_music(render.music_path)
    audio_graph = build_audio_chain(
        duration=duration,
        has_audio=has_audio,
        normalize=render.audio_normalize,
        fade=render.fade,
        music_input=1 if music else None,
        music_volume=render.music_volume,
    )
    graph = video_graph + (";" + audio_graph if audio_graph else "")

    settings = get_settings()
    tools = inspect_tools()
    gpu = prefer_gpu if prefer_gpu is not None else settings.prefer_gpu_encoding
    codec = "h264_nvenc" if gpu and tools["ffmpeg"].has_nvenc else "libx264"
    quality = render.quality if render.quality in QUALITY_CRF else "high"

    def build_args(video_codec: str) -> list[str]:
        args: list[str] = ["-ss", f"{max(0.0, float(start)):.3f}", "-i", str(source)]
        if music:
            args += ["-stream_loop", "-1", "-i", str(music)]
        args += ["-filter_complex", graph, "-map", "[vout]"]
        if audio_graph:
            args += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
        else:
            args += ["-an"]
        args += ["-c:v", video_codec, "-pix_fmt", "yuv420p"]
        if video_codec == "h264_nvenc":
            args += [
                "-preset",
                NVENC_PRESET[quality],
                "-rc",
                "vbr",
                "-cq",
                str(NVENC_CQ[quality]),
                "-b:v",
                "0",
            ]
        else:
            args += [
                "-preset",
                QUALITY_PRESET[quality],
                "-crf",
                str(QUALITY_CRF[quality]),
            ]
        try:
            threads = get_app_settings().performance.ffmpeg_threads
        except Exception:
            threads = settings.ffmpeg_threads
        if threads:
            args += ["-threads", str(threads)]
        args += [
            "-t",
            f"{duration:.3f}",
            "-movflags",
            "+faststart",
            "-max_muxing_queue_size",
            "2048",
            str(temp_output),
        ]
        return args

    temp_output.unlink(missing_ok=True)
    try:
        if on_stage:
            on_stage("Rendering video…")

        def _progress(value: float) -> None:
            if on_progress:
                on_progress(max(0.0, min(99.0, value)))

        try:
            run_ffmpeg(
                build_args(codec),
                cwd=work_dir,
                cancel_event=cancel_event,
                total_duration=duration,
                on_progress=_progress,
                timeout=max(600.0, duration * 12.0),
            )
        except FFmpegError:
            if codec != "h264_nvenc":
                raise
            logger.warning("NVENC render failed; retrying with libx264", exc_info=True)
            temp_output.unlink(missing_ok=True)
            codec = "libx264"
            if on_stage:
                on_stage("GPU encoding failed; using CPU…")
            run_ffmpeg(
                build_args(codec),
                cwd=work_dir,
                cancel_event=cancel_event,
                total_duration=duration,
                on_progress=_progress,
                timeout=max(600.0, duration * 12.0),
            )

        if not temp_output.exists() or temp_output.stat().st_size < 1024:
            raise FFmpegError("The render finished but produced no usable video file.")
        os.replace(temp_output, output)
    except Exception:
        temp_output.unlink(missing_ok=True)
        raise

    if on_progress:
        on_progress(99.0)
    thumbnail: Path | None = None
    try:
        from backend.core.config import get_storage

        thumb_dir = get_storage().root / "thumbnails"
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumbnail = thumb_dir / f"render_{output.stem}.jpg"
        generate_thumbnail(
            output,
            thumbnail,
            timestamp=min(1.0, max(0.0, duration / 3.0)),
            width=640,
            cancel_event=cancel_event,
        )
    except Exception:
        logger.debug("Rendered clip thumbnail failed", exc_info=True)
        thumbnail = None

    if on_progress:
        on_progress(100.0)
    return RenderResult(
        output=output,
        width=target_w,
        height=target_h,
        duration=duration,
        has_subtitles=bool(subtitle_label),
        subtitle_path=subtitle_path,
        encoded_with=codec,
        thumbnail=thumbnail,
    )
