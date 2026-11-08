"""Universal intelligent reframing analysis.

The engine samples a source clip, detects subjects with locally available
OpenCV models, classifies the content, smooths the resulting tracking path and
produces a cacheable crop plan. Rendering can use that plan for a dynamic,
per-frame crop instead of a single static subject offset.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class ReframePlan:
    content_type: str = "general"
    confidence: float = 0.0
    layout: str = "smart_crop"
    crop_mode: str = "smart"
    target_aspect: str = "9:16"
    sample_fps: float = 4.0
    keyframes: list[dict[str, float]] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)
    quality: dict[str, Any] = field(default_factory=dict)
    samples: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = ""

    @property
    def center_x(self) -> float:
        if not self.keyframes:
            return 0.5
        return sum(float(k.get("x", 0.5)) for k in self.keyframes) / len(self.keyframes)

    @property
    def center_y(self) -> float:
        if not self.keyframes:
            return 0.5
        return sum(float(k.get("y", 0.5)) for k in self.keyframes) / len(self.keyframes)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if not data.get("created_at"):
            from backend.database.base import utcnow_iso

            data["created_at"] = utcnow_iso()
        self.created_at = data["created_at"]
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "ReframePlan | None":
        if not isinstance(data, dict):
            return None
        try:
            return cls(**{key: value for key, value in data.items() if key in cls.__dataclass_fields__})
        except (TypeError, ValueError):
            return None


def _load_cv2():
    try:
        import cv2  # type: ignore

        return cv2
    except Exception:
        logger.info("OpenCV is not available; reframing analysis disabled")
        return None


def _cascade(cv2, name: str):
    try:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        return None if cascade.empty() else cascade
    except Exception:
        return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        if math.isfinite(result):
            return result
    except (TypeError, ValueError):
        pass
    return default


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _resize(frame, max_side: int = 480):
    import cv2

    height, width = frame.shape[:2]
    if max(width, height) <= max_side:
        return frame, 1.0
    scale = max_side / max(width, height)
    return cv2.resize(frame, (int(width * scale), int(height * scale))), scale


def _detect_faces(cv2, gray, cascades) -> list[tuple[float, float, float, float]]:
    boxes: list[tuple[float, float, float, float]] = []
    min_size = max(20, int(gray.shape[1] * 0.06))
    for cascade in cascades:
        if cascade is None:
            continue
        try:
            found = cascade.detectMultiScale(
                gray, scaleFactor=1.12, minNeighbors=4, minSize=(min_size, min_size)
            )
        except Exception:
            continue
        for x, y, w, h in found:
            boxes.append((float(x), float(y), float(w), float(h)))
    # Merge overlapping boxes and keep distinct faces.
    merged: list[tuple[float, float, float, float]] = []
    for box in sorted(boxes, key=lambda item: item[2] * item[3], reverse=True):
        if any(
            abs(box[0] - other[0]) < box[2] * 0.5
            and abs(box[1] - other[1]) < box[3] * 0.5
            for other in merged
        ):
            continue
        merged.append(box)
    return merged


def _motion_center(cv2, previous_gray, gray) -> tuple[float, float, float]:
    if previous_gray is None:
        return 0.5, 0.5, 0.0
    try:
        diff = cv2.absdiff(previous_gray, gray)
        _, mask = cv2.threshold(diff, 24, 255, cv2.THRESH_BINARY)
        mask = cv2.medianBlur(mask, 5)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    except Exception:
        return 0.5, 0.5, 0.0
    total_area = 0.0
    weighted_x = 0.0
    weighted_y = 0.0
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < max(25.0, gray.shape[0] * gray.shape[1] * 0.0008):
            continue
        moments = cv2.moments(contour)
        if moments["m00"] <= 0:
            continue
        total_area += area
        weighted_x += (moments["m10"] / moments["m00"]) * area
        weighted_y += (moments["m01"] / moments["m00"]) * area
    if total_area <= 0:
        return 0.5, 0.5, 0.0
    return (
        _clamp(weighted_x / (total_area * gray.shape[1])),
        _clamp(weighted_y / (total_area * gray.shape[0])),
        _clamp(total_area / (gray.shape[0] * gray.shape[1]), 0.0, 1.0),
    )


def _saliency_center(cv2, frame, gray) -> tuple[float, float, float]:
    factory = getattr(cv2, "saliency", None)
    create = getattr(factory, "StaticSaliencySpectralResidual_create", None) if factory else None
    if create is None:
        # Fall back to a simple edge/contrast centroid.
        try:
            edges = cv2.Canny(gray, 80, 160)
            moments = cv2.moments(edges)
            if moments["m00"] > 0:
                return (
                    _clamp(moments["m10"] / (moments["m00"] * gray.shape[1])),
                    _clamp(moments["m01"] / (moments["m00"] * gray.shape[0])),
                    _clamp(moments["m00"] / (gray.shape[0] * gray.shape[1] * 255.0), 0.0, 1.0),
                )
        except Exception:
            pass
        return 0.5, 0.5, 0.0
    try:
        saliency = create()
        ok, saliency_map = saliency.computeSaliency(frame)
        if not ok or saliency_map is None:
            return 0.5, 0.5, 0.0
        saliency_map = cv2.normalize(saliency_map, None, 0, 255, cv2.NORM_MINMAX).astype("uint8")
        _, binary = cv2.threshold(saliency_map, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        moments = cv2.moments(binary)
        score = float(binary.mean() / 255.0)
        if moments["m00"] <= 0:
            return 0.5, 0.5, score
        return (
            _clamp(moments["m10"] / (moments["m00"] * gray.shape[1])),
            _clamp(moments["m01"] / (moments["m00"] * gray.shape[0])),
            _clamp(score, 0.0, 1.0),
        )
    except Exception:
        return 0.5, 0.5, 0.0


def _text_center(cv2, gray) -> tuple[float, float, float]:
    try:
        mser = cv2.MSER_create()
        regions, _ = mser.detectRegions(gray)
    except Exception:
        return 0.5, 0.5, 0.0
    boxes = []
    for region in regions:
        if len(region) < 20:
            continue
        x, y, w, h = cv2.boundingRect(region)
        if w < 8 or h < 8:
            continue
        aspect = w / max(1, h)
        if aspect < 0.2 or aspect > 12:
            continue
        boxes.append((x, y, w, h))
    if not boxes:
        return 0.5, 0.5, 0.0
    total_area = sum(w * h for _, _, w, h in boxes)
    if total_area <= 0:
        return 0.5, 0.5, 0.0
    cx = sum((x + w / 2.0) * w * h for x, _, w, h in boxes) / total_area
    cy = sum((y + h / 2.0) * w * h for _, y, w, h in boxes) / total_area
    area_ratio = total_area / (gray.shape[0] * gray.shape[1])
    return _clamp(cx / gray.shape[1]), _clamp(cy / gray.shape[0]), _clamp(area_ratio, 0.0, 1.0)


def _classify(metrics: dict[str, float]) -> tuple[str, float]:
    face_presence = metrics.get("face_presence", 0.0)
    face_area = metrics.get("face_area", 0.0)
    motion = metrics.get("motion", 0.0)
    text = metrics.get("text", 0.0)
    edge = metrics.get("edge", 0.0)
    multi_face = metrics.get("multi_face", 0.0)

    if face_presence >= 0.45:
        if multi_face >= 1.35:
            return "podcast", min(0.95, 0.55 + face_presence * 0.35)
        if motion >= 0.12:
            return "vlog", min(0.92, 0.5 + motion * 0.8 + face_presence * 0.2)
        if text >= 0.06:
            return "interview", min(0.9, 0.5 + face_presence * 0.3 + text * 0.5)
        return "talking", min(0.92, 0.55 + face_presence * 0.35)
    if motion >= 0.14:
        if text >= 0.08 or edge >= 0.12:
            return "gaming", min(0.88, 0.45 + motion * 0.8)
        return "entertainment", min(0.82, 0.4 + motion * 0.9)
    if text >= 0.08 or edge >= 0.14:
        return "screen", min(0.86, 0.45 + max(text, edge) * 1.2)
    return "general", 0.55


def _weights(content_type: str, mode: str) -> dict[str, float]:
    base = {
        "talking": {"face": 0.72, "motion": 0.08, "saliency": 0.14, "text": 0.06},
        "podcast": {"face": 0.62, "motion": 0.08, "saliency": 0.18, "text": 0.12},
        "interview": {"face": 0.60, "motion": 0.08, "saliency": 0.16, "text": 0.16},
        "vlog": {"face": 0.46, "motion": 0.34, "saliency": 0.14, "text": 0.06},
        "gaming": {"face": 0.05, "motion": 0.42, "saliency": 0.23, "text": 0.30},
        "entertainment": {"face": 0.18, "motion": 0.42, "saliency": 0.28, "text": 0.12},
        "screen": {"face": 0.05, "motion": 0.15, "saliency": 0.20, "text": 0.60},
        "general": {"face": 0.24, "motion": 0.26, "saliency": 0.34, "text": 0.16},
    }.get(content_type, {"face": 0.25, "motion": 0.25, "saliency": 0.30, "text": 0.20})

    mode_weights = {
        "face": {"face": 0.82, "motion": 0.05, "saliency": 0.10, "text": 0.03},
        "speaker": {"face": 0.70, "motion": 0.12, "saliency": 0.12, "text": 0.06},
        "motion": {"face": 0.10, "motion": 0.62, "saliency": 0.18, "text": 0.10},
        "gameplay": {"face": 0.03, "motion": 0.40, "saliency": 0.22, "text": 0.35},
        "screen": {"face": 0.03, "motion": 0.12, "saliency": 0.18, "text": 0.67},
    }
    if mode in mode_weights:
        return mode_weights[mode]
    return base


def _smooth_keyframes(points: list[dict[str, float]], smoothing: float, fps: float) -> list[dict[str, float]]:
    if not points:
        return [{"t": 0.0, "x": 0.5, "y": 0.5}]
    smoothing = _clamp(smoothing, 0.0, 0.98)
    alpha = 0.12 + (1.0 - smoothing) * 0.45
    max_speed = 0.04 + (1.0 - smoothing) * 0.22
    max_step = max_speed / max(1.0, fps)
    result: list[dict[str, float]] = []
    x = float(points[0]["x"])
    y = float(points[0]["y"])
    last_t = float(points[0]["t"])
    for point in points:
        t = float(point["t"])
        if t < last_t:
            continue
        dt = max(1e-6, t - last_t) if result else 0.0
        target_x = float(point["x"])
        target_y = float(point["y"])
        if result:
            allowed = max_step * max(1.0, dt * fps)
            x = _clamp(x + _clamp(target_x - x, -allowed, allowed) * alpha)
            y = _clamp(y + _clamp(target_y - y, -allowed, allowed) * alpha)
        else:
            x, y = target_x, target_y
        if result and abs(x - result[-1]["x"]) < 0.003 and abs(y - result[-1]["y"]) < 0.003:
            last_t = t
            continue
        result.append({"t": round(t, 3), "x": round(x, 4), "y": round(y, 4)})
        last_t = t
    if not result:
        result.append({"t": 0.0, "x": round(x, 4), "y": round(y, 4)})
    if points and result[-1]["t"] < float(points[-1]["t"]):
        result.append({"t": round(float(points[-1]["t"]), 3), "x": result[-1]["x"], "y": result[-1]["y"]})
    return result


def _cache_path(storage_root: Path, key: str) -> Path:
    directory = storage_root / "reframing_cache"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{key}.json"


def analyze_reframe(
    video_path: str | Path,
    *,
    start: float = 0.0,
    end: float | None = None,
    target_aspect: str = "9:16",
    mode: str = "auto",
    smoothing: float = 0.78,
    sample_fps: float = 4.0,
    cancel_event: threading.Event | None = None,
    storage_root: str | Path | None = None,
) -> ReframePlan:
    """Analyze a clip range and return a cacheable crop plan."""
    path = Path(video_path)
    if not path.is_file():
        return ReframePlan(content_type="general", confidence=0.0, layout="center", crop_mode="center")

    cv2 = _load_cv2()
    if cv2 is None:
        return ReframePlan(content_type="general", confidence=0.0, layout="center", crop_mode="center")

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        capture.release()
        return ReframePlan(content_type="general", confidence=0.0, layout="center", crop_mode="center")

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 30.0)
        frame_count = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        total_duration = frame_count / fps if fps > 0 and frame_count > 0 else 0.0
        clip_end = float(end) if end and end > start else total_duration
        if clip_end <= start:
            clip_end = total_duration if total_duration > start else start + 1.0
        duration = max(0.1, clip_end - start)

        stat = path.stat()
        cache_key = hashlib.sha256(
            f"{path.resolve()}|{stat.st_size}|{int(stat.st_mtime)}|{start:.3f}|{clip_end:.3f}|"
            f"{target_aspect}|{mode}|{smoothing:.3f}|{sample_fps:.3f}".encode("utf-8")
        ).hexdigest()[:24]
        storage_path = Path(storage_root) if storage_root else path.parent
        # Keep cache in a dedicated folder under the provided root when possible.
        if storage_root is None:
            try:
                from backend.core.config import get_storage

                storage_path = get_storage().root
            except Exception:
                storage_path = path.parent
        cache_file = _cache_path(storage_path, cache_key)
        if cache_file.is_file():
            try:
                cached = ReframePlan.from_dict(json.loads(cache_file.read_text(encoding="utf-8")))
                if cached is not None:
                    return cached
            except (OSError, json.JSONDecodeError, TypeError):
                pass

        sample_fps = _clamp(sample_fps, 1.0, 8.0)
        count = max(8, min(120, int(duration * sample_fps)))
        usable_start = start + duration * 0.04
        usable_end = clip_end - duration * 0.04
        if usable_end <= usable_start:
            usable_start, usable_end = start, clip_end
        step = (usable_end - usable_start) / max(1, count - 1)

        frontal = _cascade(cv2, "haarcascade_frontalface_default.xml")
        profile = _cascade(cv2, "haarcascade_profileface.xml")
        cascades = [c for c in (frontal, profile) if c is not None]

        frames: list[dict[str, Any]] = []
        previous_gray = None
        for index in range(count):
            if cancel_event is not None and cancel_event.is_set():
                break
            timestamp = min(clip_end - 0.02, usable_start + index * step)
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000.0)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            small, scale = _resize(frame, 480)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)

            boxes = _detect_faces(cv2, gray, cascades)
            if boxes:
                areas = [w * h for _, _, w, h in boxes]
                total_area = sum(areas) or 1.0
                face_cx = sum((x + w / 2.0) * (w * h) for x, _, w, h in boxes) / total_area
                face_cy = sum((y + h / 2.0) * (w * h) for _, y, _, h in boxes) / total_area
                face_center = (_clamp(face_cx / gray.shape[1]), _clamp(face_cy / gray.shape[0]))
                face_area_ratio = min(1.0, (max(areas) / (gray.shape[0] * gray.shape[1])) * 4.0)
                multi_face = len(boxes)
            else:
                face_center = None
                face_area_ratio = 0.0
                multi_face = 0

            motion_x, motion_y, motion_area = _motion_center(cv2, previous_gray, gray)
            saliency_x, saliency_y, saliency_score = _saliency_center(cv2, small, gray)
            text_x, text_y, text_area = _text_center(cv2, gray)

            previous_gray = gray
            frame_record = {
                "t": round(max(0.0, timestamp - start), 3),
                "faces": len(boxes),
                "face_center": face_center,
                "face_area": round(face_area_ratio, 4),
                "motion_center": (motion_x, motion_y),
                "motion_area": round(motion_area, 4),
                "saliency_center": (saliency_x, saliency_y),
                "saliency": round(saliency_score, 4),
                "text_center": (text_x, text_y),
                "text_area": round(text_area, 4),
            }
            frames.append(frame_record)

        if not frames:
            return ReframePlan(content_type="general", confidence=0.0, layout="center", crop_mode="center")

        metrics = {
            "face_presence": sum(1 for f in frames if f["faces"] > 0) / len(frames),
            "face_area": sum(f["face_area"] for f in frames) / len(frames),
            "motion": sum(f["motion_area"] for f in frames) / len(frames),
            "text": sum(f["text_area"] for f in frames) / len(frames),
            "saliency": sum(f["saliency"] for f in frames) / len(frames),
            "multi_face": sum(f["faces"] for f in frames) / len(frames),
            "edge": 0.0,
        }
        # Edge density from a sample of frames (already captured indirectly by MSER/text).
        try:
            edge_samples = [f.get("text_area", 0.0) for f in frames]
            metrics["edge"] = sum(edge_samples) / len(edge_samples) if edge_samples else 0.0
        except Exception:
            metrics["edge"] = 0.0

        content_type, confidence = _classify(metrics)
        weights = _weights(content_type, mode if mode != "auto" else "auto")
        # Normalize weights to available modalities.
        for key in list(weights):
            weights[key] = max(0.0, float(weights[key]))

        raw_points: list[dict[str, float]] = []
        for frame in frames:
            components = {
                "face": frame["face_center"],
                "motion": frame["motion_center"],
                "saliency": frame["saliency_center"],
                "text": frame["text_center"],
            }
            total_weight = 0.0
            x = 0.0
            y = 0.0
            for name, weight in weights.items():
                center = components.get(name)
                if center is None:
                    continue
                x += center[0] * weight
                y += center[1] * weight
                total_weight += weight
            if total_weight <= 0:
                x, y = 0.5, 0.5
            else:
                x /= total_weight
                y /= total_weight
            # Gaming/screen content should not zoom into faces unless explicitly requested.
            if content_type in {"gaming", "screen"} and mode == "auto":
                x = _clamp(0.5 + (x - 0.5) * 0.35)
                y = _clamp(0.5 + (y - 0.5) * 0.35)
            raw_points.append({"t": frame["t"], "x": _clamp(x), "y": _clamp(y)})

        # Layout selection.
        requested = (mode or "auto").lower()
        if requested in {"fit", "blur", "original"}:
            layout = "fit"
        elif requested == "center":
            layout = "center"
        elif content_type in {"gaming", "screen"} and requested == "auto":
            layout = "fit" if metrics["motion"] < 0.18 else "smart_crop"
        else:
            layout = "smart_crop"

        keyframes = _smooth_keyframes(raw_points, smoothing, sample_fps) if layout == "smart_crop" else [{"t": 0.0, "x": 0.5, "y": 0.5}]
        # Reduce keyframes to a manageable number while preserving turns.
        if len(keyframes) > 24:
            reduced = [keyframes[0]]
            for point in keyframes[1:-1]:
                prev = reduced[-1]
                if abs(point["x"] - prev["x"]) >= 0.015 or abs(point["y"] - prev["y"]) >= 0.015:
                    reduced.append(point)
            reduced.append(keyframes[-1])
            keyframes = reduced[:40]

        # Quality report.
        face_visibility = 0.0
        if metrics["face_presence"] > 0:
            face_frames = [f for f in frames if f["faces"] > 0]
            visible = 0
            for frame in face_frames:
                center = frame["face_center"]
                if center is None:
                    continue
                # Estimate horizontal crop window for a 9:16 output from a 16:9 source.
                window = 0.55
                crop_left = _clamp(frame and 0.0)
                # Use average keyframe center nearest in time.
                nearest = min(keyframes, key=lambda k: abs(k["t"] - frame["t"])) if keyframes else {"x": 0.5}
                center_x = nearest["x"]
                left = _clamp(center_x - window / 2.0)
                right = left + window
                if left <= center[0] <= right:
                    visible += 1
            face_visibility = visible / len(face_frames) if face_frames else 0.0

        xs = [k["x"] for k in keyframes]
        ys = [k["y"] for k in keyframes]
        stability = 1.0 - min(1.0, ( (max(xs) - min(xs)) + (max(ys) - min(ys)) ) * 1.8)
        caption_overlap = 0.0
        if keyframes:
            bottom_hits = sum(1 for k in keyframes if k["y"] > 0.72)
            caption_overlap = bottom_hits / len(keyframes)
        subject_visibility = 1.0 - min(1.0, (1.0 - metrics["face_presence"]) * 0.35 + (1.0 - metrics["saliency"]) * 0.25)
        score = 0.0
        score += subject_visibility * 35.0
        score += (face_visibility if metrics["face_presence"] > 0 else 0.7) * 25.0
        score += stability * 20.0
        score += (1.0 - caption_overlap) * 10.0
        score += min(1.0, metrics["motion"] * 3.0) * 5.0
        score += confidence * 5.0
        score = _clamp(score, 0.0, 100.0)

        if score >= 82:
            recommendation = "Composition looks stable; smart crop is suitable."
        elif layout == "fit":
            recommendation = "A fitted layout is safer for this content."
        elif stability < 0.55:
            recommendation = "Tracking is unstable; increase smoothing or use a fitted layout."
        else:
            recommendation = "Review the preview before rendering."

        crop_mode = "original" if layout == "fit" else ("smart" if layout == "smart_crop" else "center")
        plan = ReframePlan(
            content_type=content_type,
            confidence=round(confidence, 4),
            layout=layout,
            crop_mode=crop_mode,
            target_aspect=target_aspect,
            sample_fps=sample_fps,
            keyframes=keyframes,
            metrics={key: round(float(value), 4) for key, value in metrics.items()},
            quality={
                "score": round(score, 1),
                "face_visibility": round(face_visibility, 3),
                "subject_visibility": round(subject_visibility, 3),
                "stability": round(stability, 3),
                "caption_overlap_risk": round(caption_overlap, 3),
                "recommendation": recommendation,
            },
            samples=[
                {
                    "t": frame["t"],
                    "faces": frame["faces"],
                    "motion": frame["motion_area"],
                    "text": frame["text_area"],
                }
                for frame in frames[:40]
            ],
        )
        plan.created_at = plan.to_dict()["created_at"]
        try:
            cache_file.write_text(json.dumps(plan.to_dict(), indent=2), encoding="utf-8")
        except OSError:
            logger.debug("Could not write reframe cache", exc_info=True)
        return plan
    except Exception:
        logger.debug("Reframing analysis failed", exc_info=True)
        return ReframePlan(content_type="general", confidence=0.0, layout="center", crop_mode="center")
    finally:
        capture.release()
