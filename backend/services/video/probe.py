"""Video metadata extraction with FFprobe."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

from backend.core.exceptions import MediaError
from backend.utils.ffmpeg import parse_rate, probe_json


@dataclass
class VideoMetadata:
    duration: float
    width: int
    height: int
    fps: float | None
    has_audio: bool
    video_codec: str | None
    audio_codec: str | None
    container: str | None
    file_size: int
    rotation: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def probe_video(path: str | Path) -> VideoMetadata:
    path = Path(path)
    if not path.is_file():
        raise MediaError("The uploaded video file could not be found.")
    data = probe_json(path)
    streams = data.get("streams") or []
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video_stream is None:
        raise MediaError(
            "This file has no video stream. Upload a video file rather than an audio-only file."
        )

    fmt = data.get("format") or {}
    duration = _to_float(fmt.get("duration")) or _to_float(video_stream.get("duration")) or 0.0
    if duration <= 0:
        raise MediaError("The video duration could not be determined. The file may be corrupt.")

    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    if width <= 0 or height <= 0:
        raise MediaError("The video resolution could not be determined.")

    rotation = _rotation(video_stream)
    if abs(rotation) in (90, 270):
        width, height = height, width

    fps = parse_rate(video_stream.get("avg_frame_rate")) or parse_rate(
        video_stream.get("r_frame_rate")
    )

    return VideoMetadata(
        duration=round(duration, 3),
        width=width,
        height=height,
        fps=fps,
        has_audio=audio_stream is not None,
        video_codec=video_stream.get("codec_name"),
        audio_codec=(audio_stream or {}).get("codec_name"),
        container=fmt.get("format_name"),
        file_size=path.stat().st_size,
        rotation=rotation,
    )


def _rotation(stream: dict) -> int:
    for item in stream.get("side_data_list") or []:
        if "rotation" in item:
            try:
                return int(float(item["rotation"]))
            except (TypeError, ValueError):
                pass
    rotate = (stream.get("tags") or {}).get("rotate")
    try:
        return int(float(rotate)) if rotate is not None else 0
    except (TypeError, ValueError):
        return 0


def _to_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
