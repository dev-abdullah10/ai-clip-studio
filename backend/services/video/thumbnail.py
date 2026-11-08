"""Thumbnail generation."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from backend.core.exceptions import JobCancelled
from backend.utils.ffmpeg import run_ffmpeg

logger = logging.getLogger(__name__)


def generate_thumbnail(
    source: Path,
    output: Path,
    *,
    timestamp: float = 1.0,
    width: int = 640,
    cancel_event: threading.Event | None = None,
    timeout: float = 120,
) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "-ss",
        f"{max(0.0, timestamp):.3f}",
        "-i",
        str(source),
        "-frames:v",
        "1",
        "-an",
        "-vf",
        f"scale={width}:-2",
        "-q:v",
        "3",
        "-update",
        "1",
        str(output),
    ]
    try:
        run_ffmpeg(args, cancel_event=cancel_event, timeout=timeout)
    except JobCancelled:
        raise
    except Exception:
        # Retry at the very beginning; some files fail on a seek into a broken GOP.
        args[1] = "0"
        run_ffmpeg(args, cancel_event=cancel_event, timeout=timeout)
    if not output.exists() or output.stat().st_size == 0:
        raise RuntimeError("Thumbnail generation produced no output")
    return output
