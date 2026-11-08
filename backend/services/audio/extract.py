"""Local audio extraction and silence-aware chunking."""

from __future__ import annotations

import logging
import math
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.core.config import get_settings
from backend.utils.ffmpeg import CREATE_NO_WINDOW, run_ffmpeg

logger = logging.getLogger(__name__)

_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")


@dataclass
class AudioChunk:
    path: Path
    offset: float
    duration: float


def extract_audio(
    source: Path,
    destination: Path,
    *,
    duration: float,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[float], None] | None = None,
    timeout: float = 3600,
) -> Path:
    """Extract a compact mono 16 kHz MP3. Audio never leaves the machine here."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-i",
        str(source),
        "-vn",
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "48k",
        str(destination),
    ]
    run_ffmpeg(
        args,
        cancel_event=cancel_event,
        total_duration=duration,
        on_progress=on_progress,
        timeout=timeout,
    )
    if not destination.exists() or destination.stat().st_size < 512:
        raise RuntimeError("Audio extraction produced no usable audio stream.")
    return destination


def detect_silences(
    audio_path: Path,
    *,
    noise_db: float = -35.0,
    min_silence: float = 0.35,
    timeout: float = 1800,
) -> list[tuple[float, float]]:
    """Return silence ranges. Failure returns an empty list (fixed splitting fallback)."""
    settings = get_settings()
    cmd = [
        settings.ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-i",
        str(audio_path),
        "-af",
        f"silencedetect=noise={noise_db}dB:d={min_silence}",
        "-f",
        "null",
        "-",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    text = (result.stderr or "") + (result.stdout or "")
    ranges: list[tuple[float, float]] = []
    current_start: float | None = None
    for line in text.splitlines():
        match = _SILENCE_START.search(line)
        if match:
            try:
                current_start = max(0.0, float(match.group(1)))
            except ValueError:
                current_start = None
            continue
        match = _SILENCE_END.search(line)
        if match and current_start is not None:
            try:
                end = max(0.0, float(match.group(1)))
            except ValueError:
                end = current_start
            if end > current_start:
                ranges.append((current_start, end))
            current_start = None
    return ranges


def plan_chunks(
    duration: float,
    max_chunk_seconds: float,
    silences: list[tuple[float, float]] | None = None,
) -> list[tuple[float, float]]:
    """Plan chunk ranges, snapping boundaries to nearby silence when possible."""
    if duration <= 0:
        return [(0.0, 0.0)]
    max_chunk = max(30.0, float(max_chunk_seconds or 1200.0))
    if duration <= max_chunk:
        return [(0.0, duration)]

    count = math.ceil(duration / max_chunk)
    desired = [i * duration / count for i in range(1, count)]
    tolerance = max(20.0, max_chunk * 0.2)
    boundaries: list[float] = []
    previous = 0.0
    for target in desired:
        candidates = [
            (s + e) / 2.0
            for s, e in (silences or [])
            if (e - s) >= 0.25 and abs((s + e) / 2.0 - target) <= tolerance
        ]
        boundary = min(candidates, key=lambda value: abs(value - target)) if candidates else target
        boundary = max(previous + 20.0, min(duration - 10.0, boundary))
        if boundary <= previous + 5:
            boundary = min(duration - 5.0, previous + max_chunk)
        boundaries.append(boundary)
        previous = boundary

    ranges: list[tuple[float, float]] = []
    cursor = 0.0
    for boundary in boundaries + [duration]:
        length = boundary - cursor
        if length > 0.25:
            ranges.append((round(cursor, 3), round(length, 3)))
        cursor = boundary
    return ranges


def split_audio(
    audio_path: Path,
    output_dir: Path,
    ranges: list[tuple[float, float]],
    *,
    cancel_event: threading.Event | None = None,
) -> list[AudioChunk]:
    output_dir.mkdir(parents=True, exist_ok=True)
    chunks: list[AudioChunk] = []
    for index, (offset, length) in enumerate(ranges):
        destination = output_dir / f"chunk_{index:03d}.mp3"
        if len(ranges) == 1:
            chunks.append(AudioChunk(path=audio_path, offset=0.0, duration=length))
            continue
        args = [
            "-ss",
            f"{offset:.3f}",
            "-i",
            str(audio_path),
            "-t",
            f"{length:.3f}",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "48k",
            str(destination),
        ]
        run_ffmpeg(args, cancel_event=cancel_event, timeout=max(300, length * 4))
        chunks.append(AudioChunk(path=destination, offset=offset, duration=length))
    return chunks
