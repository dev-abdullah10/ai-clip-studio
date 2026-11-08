"""Aspect-ratio geometry and FFmpeg video filter construction."""

from __future__ import annotations

from dataclasses import dataclass

RESOLUTION_SHORT_SIDE: dict[str, int] = {
    "240p": 240,
    "360p": 360,
    "480p": 480,
    "540p": 540,
    "720p": 720,
    "900p": 900,
    "1080p": 1080,
    "1440p": 1440,
    "2160p": 2160,
}


def _even(value: float) -> int:
    return max(2, int(round(value / 2.0)) * 2)


def parse_aspect(value: str, source_w: int, source_h: int) -> float:
    if value == "original" and source_w > 0 and source_h > 0:
        return source_w / source_h
    try:
        w, h = value.split(":", 1)
        ratio = float(w) / float(h)
        if ratio > 0:
            return ratio
    except (ValueError, ZeroDivisionError, AttributeError):
        pass
    return 9.0 / 16.0


def target_dimensions(
    aspect_ratio: str,
    resolution: str,
    source_w: int,
    source_h: int,
) -> tuple[int, int]:
    """Map an aspect ratio + quality label to even output dimensions.

    The resolution label describes the *short side* so that "1080p" produces
    1080x1920 for vertical and 1920x1080 for horizontal output.
    """
    short = RESOLUTION_SHORT_SIDE.get((resolution or "1080p").lower().strip(), 1080)
    ratio = parse_aspect(aspect_ratio, source_w, source_h)
    if ratio >= 1.0:
        height = short
        width = short * ratio
    else:
        width = short
        height = short / ratio
    # Keep very wide material (ultrawide) from generating absurdly large frames.
    max_side = 4096
    if max(width, height) > max_side:
        factor = max_side / max(width, height)
        width *= factor
        height *= factor
    return _even(width), _even(height)


@dataclass
class CropGeometry:
    source_width: int
    source_height: int
    target_width: int
    target_height: int
    crop_x: int = 0
    crop_y: int = 0
    crop_width: int = 0
    crop_height: int = 0
    scale_width: int = 0
    scale_height: int = 0
    mode: str = "center"

    @property
    def crops(self) -> bool:
        return self.crop_width < self.source_width or self.crop_height < self.source_height


def compute_crop(
    source_w: int,
    source_h: int,
    target_w: int,
    target_h: int,
    *,
    mode: str = "center",
    subject_offset: float = 0.5,
) -> CropGeometry:
    """Compute a crop window that places the subject at ``subject_offset``.

    ``subject_offset`` is the subject's normalized position along the axis that
    is being cropped (x for landscape sources, y for portrait sources). 0.5
    keeps the subject centered. Faces are stored as the subject position, so
    the same value works for every target aspect ratio.
    """
    source_w = max(2, int(source_w))
    source_h = max(2, int(source_h))
    target_w = max(2, int(target_w))
    target_h = max(2, int(target_h))
    offset = max(0.0, min(1.0, float(subject_offset)))
    target_ar = target_w / target_h
    source_ar = source_w / source_h

    if source_ar > target_ar:
        crop_h = source_h
        crop_w = _even(min(source_w, source_h * target_ar))
        x = (source_w - crop_w) * (offset if mode != "center" else 0.5)
        # Interpret offset as subject position, not window position.
        if mode in {"face", "manual"}:
            x = offset * source_w - crop_w / 2.0
        x = max(0, min(source_w - crop_w, int(round(x))))
        y = 0
    elif source_ar < target_ar:
        crop_w = source_w
        crop_h = _even(min(source_h, source_w / target_ar))
        y = (source_h - crop_h) * 0.5
        if mode in {"face", "manual"}:
            y = offset * source_h - crop_h / 2.0
        y = max(0, min(source_h - crop_h, int(round(y))))
        x = 0
    else:
        crop_w, crop_h = source_w, source_h
        x = y = 0

    return CropGeometry(
        source_width=source_w,
        source_height=source_h,
        target_width=target_w,
        target_height=target_h,
        crop_x=x,
        crop_y=y,
        crop_width=crop_w,
        crop_height=crop_h,
        scale_width=target_w,
        scale_height=target_h,
        mode=mode,
    )


def build_crop_chain(
    geometry: CropGeometry,
    *,
    fps: int,
    subtitle_label: str | None = None,
) -> str:
    """Return a filter chain that emits ``[vout]`` from ``[0:v]``.

    ``subtitle_label`` is a complete, pre-escaped ``ass=`` filter when burn-in
    is enabled (including any leading commas are NOT expected).
    """
    chain: list[str] = []
    if geometry.mode == "original":
        tw, th = geometry.target_width, geometry.target_height
        chain.append("[0:v]setpts=PTS-STARTPTS,split=2[bg][fg]")
        chain.append(
            f"[bg]scale={tw}:{th}:force_original_aspect_ratio=increase,"
            f"crop={tw}:{th},gblur=sigma=28,eq=brightness=-0.055[bgpad]"
        )
        chain.append(
            f"[fg]scale={tw}:{th}:force_original_aspect_ratio=decrease:flags=lanczos[fgpad]"
        )
        chain.append("[bgpad][fgpad]overlay=(W-w)/2:(H-h)/2,setsar=1[base]")
    else:
        cw, ch, cx, cy = (
            geometry.crop_width,
            geometry.crop_height,
            geometry.crop_x,
            geometry.crop_y,
        )
        chain.append(
            "[0:v]setpts=PTS-STARTPTS,"
            f"crop={cw}:{ch}:{cx}:{cy},"
            f"scale={geometry.target_width}:{geometry.target_height}:flags=lanczos[base]"
        )
    chain.append(f"[base]setsar=1,fps={max(15, int(fps))}" + (f",{subtitle_label}" if subtitle_label else "") + "[vout]")
    return ";".join(chain)


def build_audio_chain(
    *,
    duration: float,
    has_audio: bool,
    normalize: bool,
    fade: bool,
    music_input: int | None = None,
    music_volume: float = 0.15,
) -> str | None:
    """Return a filter graph ending in ``[aout]`` or None when there is no audio."""
    if not has_audio and music_input is None:
        return None
    duration = max(0.1, duration)
    parts: list[str] = []
    voice_label: str | None = None
    if has_audio:
        voice_filters = ["asetpts=PTS-STARTPTS"]
        if normalize:
            voice_filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
        if fade:
            voice_filters.append("afade=t=in:st=0:d=0.25")
            voice_filters.append(
                f"afade=t=out:st={max(0.0, duration - 0.5):.3f}:d=0.5"
            )
        parts.append("[0:a]" + ",".join(voice_filters) + "[voice]")
        voice_label = "[voice]"

    music_label: str | None = None
    if music_input is not None:
        volume = max(0.0, min(1.0, float(music_volume)))
        music_filters = [
            f"volume={volume:.3f}",
            f"atrim=0:{duration:.3f}",
            "asetpts=PTS-STARTPTS",
        ]
        if fade:
            music_filters.append("afade=t=in:st=0:d=0.4")
            music_filters.append(
                f"afade=t=out:st={max(0.0, duration - 0.6):.3f}:d=0.6"
            )
        parts.append(f"[{music_input}:a]" + ",".join(music_filters) + "[music]")
        music_label = "[music]"

    if voice_label and music_label:
        parts.append(
            f"{voice_label}{music_label}amix=inputs=2:duration=first:dropout_transition=0,"
            "volume=1.7,alimiter=limit=0.95[aout]"
        )
    elif voice_label:
        parts.append(f"{voice_label}anull[aout]")
    elif music_label:
        parts.append(f"{music_label}anull[aout]")
    else:
        return None
    return ";".join(parts)


def _piecewise_linear(points: list[tuple[float, float]]) -> str:
    """Build an FFmpeg expression that linearly interpolates ``points`` by time."""
    if not points:
        return "0.5"
    ordered = sorted(points, key=lambda item: item[0])
    unique: list[tuple[float, float]] = []
    for t, value in ordered:
        if unique and abs(t - unique[-1][0]) < 1e-6:
            unique[-1] = (t, value)
        else:
            unique.append((t, value))
    if len(unique) == 1:
        return repr(float(unique[0][1]))
    expr = repr(float(unique[-1][1]))
    for index in range(len(unique) - 2, -1, -1):
        t0, v0 = unique[index]
        t1, v1 = unique[index + 1]
        if abs(t1 - t0) < 1e-6:
            segment = repr(float(v1))
        else:
            segment = f"({v0}+({v1}-{v0})*(t-{t0})/({t1}-{t0}))"
        expr = f"if(lt(t,{t1}),{segment},{expr})"
    return expr


def build_dynamic_crop_chain(
    geometry: CropGeometry,
    *,
    keyframes: list[dict[str, float]] | None = None,
    fps: int,
    subtitle_label: str | None = None,
) -> str:
    """Like ``build_crop_chain``, but evaluates crop offsets per frame."""
    keyframes = keyframes or []
    cw = max(2, int(geometry.crop_width))
    ch = max(2, int(geometry.crop_height))
    sw = max(2, int(geometry.source_width))
    sh = max(2, int(geometry.source_height))
    tw, th = geometry.target_width, geometry.target_height
    source_ar = sw / sh
    target_ar = tw / th
    chain: list[str] = []

    if source_ar > target_ar:
        points = [(float(k.get("t", 0.0)), float(k.get("x", 0.5))) for k in keyframes]
        norm = _piecewise_linear(points)
        x_expr = (
            f"if(gt(({norm})*if(lt(in_w-{cw},1),1,in_w-{cw}),in_w-{cw}),"
            f"in_w-{cw},if(lt(({norm})*if(lt(in_w-{cw},1),1,in_w-{cw}),0),0,"
            f"({norm})*if(lt(in_w-{cw},1),1,in_w-{cw})))"
        ).replace(",", r"\,")
        chain.append(
            "[0:v]setpts=PTS-STARTPTS,"
            f"crop={cw}:{ch}:{x_expr}:0,"
            f"scale={tw}:{th}:flags=lanczos[base]"
        )
    elif source_ar < target_ar:
        points = [(float(k.get("t", 0.0)), float(k.get("y", 0.5))) for k in keyframes]
        norm = _piecewise_linear(points)
        y_expr = (
            f"if(gt(({norm})*if(lt(in_h-{ch},1),1,in_h-{ch}),in_h-{ch}),"
            f"in_h-{ch},if(lt(({norm})*if(lt(in_h-{ch},1),1,in_h-{ch}),0),0,"
            f"({norm})*if(lt(in_h-{ch},1),1,in_h-{ch})))"
        ).replace(",", r"\,")
        chain.append(
            "[0:v]setpts=PTS-STARTPTS,"
            f"crop={cw}:{ch}:0:{y_expr},"
            f"scale={tw}:{th}:flags=lanczos[base]"
        )
    else:
        chain.append("[0:v]setpts=PTS-STARTPTS,scale={}:{}:flags=lanczos[base]".format(tw, th))

    chain.append(
        f"[base]setsar=1,fps={max(15, int(fps))}"
        + (f",{subtitle_label}" if subtitle_label else "")
        + "[vout]"
    )
    return ";".join(chain)


def aspect_label(aspect_ratio: str) -> str:
    return {
        "9:16": "Vertical 9:16",
        "16:9": "Landscape 16:9",
        "1:1": "Square 1:1",
        "4:5": "Portrait 4:5",
        "original": "Original aspect",
    }.get(aspect_ratio, aspect_ratio)
