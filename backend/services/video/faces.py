"""Local face detection used to keep speakers framed in vertical crops.

Frames are sampled with OpenCV and the frontal-face Haar cascade. Nothing leaves
the machine. Detection is intentionally best-effort: when no face is found the
caller falls back to a centered crop.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class FaceAnalysis:
    offset_x: float = 0.5
    offset_y: float = 0.5
    confidence: float = 0.0
    frames_checked: int = 0
    frames_with_face: int = 0
    samples: list[dict] = field(default_factory=list)

    @property
    def detected(self) -> bool:
        return self.frames_with_face > 0

    def to_dict(self) -> dict:
        return {
            "offset_x": round(self.offset_x, 4),
            "offset_y": round(self.offset_y, 4),
            "confidence": round(self.confidence, 4),
            "frames_checked": self.frames_checked,
            "frames_with_face": self.frames_with_face,
            "detected": self.detected,
        }


def _load_cv2():
    try:
        import cv2  # type: ignore

        return cv2
    except Exception:  # pragma: no cover - optional dependency
        logger.info("OpenCV is not available; face detection disabled")
        return None


def _cascade(cv2):
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    return None if cascade.empty() else cascade


def analyze_faces(
    video_path: Path,
    *,
    start: float = 0.0,
    end: float | None = None,
    samples: int = 9,
    cancel_event: threading.Event | None = None,
) -> FaceAnalysis:
    """Detect the dominant face position in a clip range (normalized 0-1)."""
    cv2 = _load_cv2()
    if cv2 is None:
        return FaceAnalysis()
    if not Path(video_path).is_file():
        return FaceAnalysis()

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        return FaceAnalysis()

    try:
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        total = frame_count / fps if fps and frame_count else 0.0
        clip_end = end if end and end > start else total
        if clip_end <= start:
            return FaceAnalysis()
        cascade = _cascade(cv2)
        if cascade is None:
            return FaceAnalysis()

        count = max(3, min(15, samples))
        # Skip the very edges: fades and transitions often contain no face.
        usable_start = start + (clip_end - start) * 0.06
        usable_end = clip_end - (clip_end - start) * 0.06
        if usable_end <= usable_start:
            usable_start, usable_end = start, clip_end
        step = max(0.001, (usable_end - usable_start) / max(1, count - 1))

        result = FaceAnalysis()
        weighted_x = 0.0
        weighted_y = 0.0
        weights = 0.0
        for index in range(count):
            if cancel_event is not None and cancel_event.is_set():
                break
            timestamp = min(clip_end - 0.02, usable_start + index * step)
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            result.frames_checked += 1
            height, width = frame.shape[:2]
            if width < 32 or height < 32:
                continue
            scale = 480.0 / max(width, height) if max(width, height) > 480 else 1.0
            if scale < 1.0:
                small = cv2.resize(frame, (int(width * scale), int(height * scale)))
            else:
                small = frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)
            min_size = max(24, int(gray.shape[1] * 0.08))
            faces = cascade.detectMultiScale(
                gray, scaleFactor=1.12, minNeighbors=5, minSize=(min_size, min_size)
            )
            if len(faces) == 0:
                result.samples.append({"t": round(timestamp, 2), "faces": 0})
                continue
            result.frames_with_face += 1
            # Weight larger (closer) faces more heavily.
            best = max(faces, key=lambda box: int(box[2]) * int(box[3]))
            x, y, w, h = (float(value) for value in best)
            center_x = (x + w / 2.0) / max(1.0, gray.shape[1])
            center_y = (y + h / 2.0) / max(1.0, gray.shape[0])
            weight = float(w * h)
            weighted_x += center_x * weight
            weighted_y += center_y * weight
            weights += weight
            result.samples.append(
                {
                    "t": round(timestamp, 2),
                    "faces": int(len(faces)),
                    "x": round(center_x, 3),
                    "y": round(center_y, 3),
                }
            )
        if weights > 0:
            result.offset_x = max(0.0, min(1.0, weighted_x / weights))
            result.offset_y = max(0.0, min(1.0, weighted_y / weights))
        result.confidence = (
            result.frames_with_face / result.frames_checked if result.frames_checked else 0.0
        )
        return result
    except Exception:
        logger.debug("Face analysis failed", exc_info=True)
        return FaceAnalysis()
    finally:
        capture.release()


def suggest_crop_mode(analysis: FaceAnalysis) -> tuple[str, float]:
    """Return (crop mode, subject offset) for a clip."""
    if analysis.detected and analysis.confidence >= 0.34:
        return "face", round(analysis.offset_x, 4)
    return "center", 0.5
