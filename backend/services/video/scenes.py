"""Local scene-change detection using OpenCV frame sampling (no cloud)."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Callable

logger = logging.getLogger(__name__)


def detect_scene_times(
    video_path: Path,
    *,
    duration: float | None = None,
    max_samples: int = 1400,
    threshold: float = 0.52,
    cancel_event: threading.Event | None = None,
) -> list[float]:
    """Sample frames evenly across the video and detect histogram discontinuities.

    Sampling (rather than full-frame decoding) keeps long videos practical on CPU.
    """
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        logger.info("OpenCV not available; skipping scene detection")
        return []

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        return []
    fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    total = duration or (frame_count / fps if fps and frame_count else 0)
    capture.release()
    if total <= 1:
        return []

    sample_count = max(8, min(max_samples, int(total)))  # ~1 sample/sec, capped
    step = total / sample_count
    capture = cv2.VideoCapture(str(video_path))
    previous_hist = None
    scenes: list[float] = []
    last_scene = -10.0
    try:
        for index in range(sample_count):
            if cancel_event is not None and cancel_event.is_set():
                break
            timestamp = min(total - 0.05, index * step)
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            frame = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, [24, 24], [0, 180, 0, 256])
            cv2.normalize(hist, hist, 0, 1, cv2.NORM_MINMAX)
            if previous_hist is not None:
                correlation = float(cv2.compareHist(previous_hist, hist, cv2.HISTCMP_CORREL))
                if correlation < threshold and (timestamp - last_scene) >= 2.0:
                    scenes.append(round(float(timestamp), 3))
                    last_scene = timestamp
            previous_hist = hist
    except Exception:
        logger.debug("Scene detection failed", exc_info=True)
    finally:
        capture.release()
    return scenes
