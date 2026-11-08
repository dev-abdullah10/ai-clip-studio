"""Subtitle cue construction and ASS / SRT / VTT output."""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from backend.schemas.clips import SubtitleSettings
from backend.schemas.transcript import TranscriptData
from backend.utils.time import format_ass_time, format_srt_time, format_vtt_time

logger = logging.getLogger(__name__)


@dataclass
class CueWord:
    start: float
    end: float
    word: str


@dataclass
class Cue:
    start: float
    end: float
    text: str
    words: list[CueWord] = field(default_factory=list)


def build_cues(
    transcript: TranscriptData,
    clip_start: float,
    clip_end: float,
    settings: SubtitleSettings,
) -> list[Cue]:
    duration = max(0.1, clip_end - clip_start)
    sliced = transcript.slice(clip_start, clip_end)
    raw_words = sliced.all_words()
    words = [
        CueWord(start=w.start, end=w.end, word=w.word)
        for w in raw_words
        if w.word.strip() and w.end > 0
    ]
    if not words:
        # Fall back to distributing each segment's text across its duration.
        for segment in sliced.segments:
            tokens = segment.text.split()
            if not tokens:
                continue
            step = max(0.08, (segment.end - segment.start) / len(tokens))
            for index, token in enumerate(tokens):
                words.append(
                    CueWord(
                        start=segment.start + index * step,
                        end=min(segment.end, segment.start + (index + 1) * step),
                        word=token,
                    )
                )
    words.sort(key=lambda w: w.start)
    if not words:
        return []

    cues: list[Cue] = []
    current: list[CueWord] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        text = " ".join(w.word for w in current).strip()
        start = max(0.0, current[0].start - 0.04)
        end = min(duration, max(current[-1].end + 0.12, start + 0.25))
        if cues and start < cues[-1].end:
            cues[-1].end = max(cues[-1].start + 0.15, start - 0.03)
            start = cues[-1].end + 0.02
        cues.append(Cue(start=start, end=end, text=text, words=list(current)))
        current = []

    for word in words:
        if current:
            prev = current[-1]
            joined_len = len(" ".join(w.word for w in current)) + 1 + len(word.word)
            gap = word.start - prev.end
            ends_sentence = prev.word[-1] in ".!?…," if prev.word else False
            too_long = len(current) >= settings.max_words_per_line or joined_len > settings.max_chars_per_line
            too_slow = (word.end - current[0].start) > 4.5
            if too_long or gap > 0.9 or (ends_sentence and len(current) >= 2) or too_slow:
                flush()
        current.append(word)
    flush()

    # Drop cues that start beyond the clip, and clamp to the clip.
    result: list[Cue] = []
    for cue in cues:
        if cue.start >= duration:
            continue
        cue.start = max(0.0, cue.start)
        cue.end = min(duration, max(cue.start + 0.1, cue.end))
        if cue.text.strip():
            result.append(cue)
    return result


def _hex_to_ass(value: str, *, alpha: float = 0.0) -> str:
    value = value.lstrip("#")
    if len(value) == 8:
        rr, gg, bb, aa = value[0:2], value[2:4], value[4:6], value[6:8]
        alpha = 1.0 - int(aa, 16) / 255.0
    elif len(value) == 6:
        rr, gg, bb = value[0:2], value[2:4], value[4:6]
    else:
        rr = gg = bb = "FF"
    alpha_byte = max(0, min(255, round(alpha * 255)))
    return f"&H{alpha_byte:02X}{bb.upper()}{gg.upper()}{rr.upper()}"


def _escape_ass(text: str) -> str:
    return (
        (text or "")
        .replace("\\", "\\\\")
        .replace("{", "（")
        .replace("}", "）")
        .replace("\n", "\\N")
    )


def _alignment(settings: SubtitleSettings) -> int:
    base = {"bottom": 2, "center": 5, "top": 8}[settings.position]
    if settings.alignment == "left":
        base -= 1
    elif settings.alignment == "right":
        base += 1
    return base


def _font_scale(target_w: int, target_h: int) -> float:
    return max(0.35, min(target_w / 1080.0, target_h / 1920.0))


def write_ass(
    cues: list[Cue],
    settings: SubtitleSettings,
    path: Path,
    *,
    target_w: int,
    target_h: int,
) -> Path:
    scale = _font_scale(target_w, target_h)
    font_size = max(12, round(settings.font_size * scale))
    outline = max(0.0, settings.outline_width * scale)
    shadow = max(0.0, settings.shadow * scale)
    margin_v = max(0, round(settings.margin_v * scale))
    margin_h = max(0, round(settings.margin_h * scale))

    primary = _hex_to_ass(settings.primary_color)
    highlight = _hex_to_ass(settings.highlight_color)
    outline_colour = _hex_to_ass(settings.outline_color)
    if settings.background_opacity > 0:
        back = _hex_to_ass(settings.background_color, alpha=1.0 - settings.background_opacity)
        border_style = 3
        box_padding = max(1.0, outline or 2.0)
    else:
        back = _hex_to_ass("#000000", alpha=0.55)
        border_style = 1
        box_padding = outline
    bold = -1 if settings.font_weight in ("bold", "semibold", "700", "800", "900") else 0
    alignment = _alignment(settings)

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {target_w}",
        f"PlayResY: {target_h}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        (
            f"Style: Default,{settings.font_family},{font_size},{primary},{highlight},{outline_colour},{back},"
            f"{bold},0,0,0,100,100,0,0,{border_style},{box_padding:.1f},{shadow:.1f},{alignment},"
            f"{margin_h},{margin_h},{margin_v},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    animation = _animation_prefix(settings)
    for cue in cues:
        text = cue.text.upper() if settings.uppercase else cue.text
        if not settings.highlight_words or not cue.words:
            body = _escape_ass(text)
            lines.append(
                f"Dialogue: 0,{format_ass_time(cue.start)},{format_ass_time(cue.end)},Default,,0,0,0,,{animation}{body}"
            )
            continue
        prepared = [w.word.upper() if settings.uppercase else w.word for w in cue.words]
        for index, word in enumerate(cue.words):
            start = cue.start if index == 0 else max(cue.start, word.start)
            end = cue.end if index + 1 >= len(cue.words) else cue.words[index + 1].start
            if end <= start:
                end = min(cue.end, start + 0.08)
            if end <= start:
                continue
            pieces = []
            for other_index, token in enumerate(prepared):
                escaped = _escape_ass(token)
                if other_index == index:
                    pieces.append(f"{{\\c{highlight}\\b1}}{escaped}{{\\c{primary}\\b{bold}}}")
                else:
                    pieces.append(escaped)
            body = " ".join(pieces)
            prefix = animation if index == 0 else ""
            lines.append(
                f"Dialogue: 0,{format_ass_time(start)},{format_ass_time(end)},Default,,0,0,0,,{prefix}{body}"
            )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _animation_prefix(settings: SubtitleSettings) -> str:
    if settings.animation == "fade":
        return "{\\fad(70,70)}"
    if settings.animation == "pop":
        return "{\\fscx90\\fscy90\\t(0,90,\\fscx100\\fscy100)}"
    if settings.animation == "slide":
        return "{\\fad(50,80)}"
    return ""


def write_srt(cues: list[Cue], path: Path) -> Path:
    blocks = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(
            f"{index}\n{format_srt_time(cue.start)} --> {format_srt_time(cue.end)}\n{cue.text}\n"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(blocks), encoding="utf-8")
    return path


def write_vtt(cues: list[Cue], path: Path) -> Path:
    blocks = ["WEBVTT\n"]
    for cue in cues:
        blocks.append(
            f"{format_vtt_time(cue.start)} --> {format_vtt_time(cue.end)}\n{cue.text}\n"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(blocks), encoding="utf-8")
    return path


FONT_CANDIDATES: dict[str, list[str]] = {
    "Arial": ["arial.ttf", "arialbd.ttf"],
    "Arial Black": ["ariblk.ttf"],
    "Segoe UI": ["segoeui.ttf", "seguisb.ttf", "segoeuib.ttf"],
    "Impact": ["impact.ttf"],
    "Verdana": ["verdana.ttf", "verdanab.ttf"],
    "Tahoma": ["tahoma.ttf", "tahomabd.ttf"],
    "Georgia": ["georgia.ttf", "georgiab.ttf"],
    "Trebuchet MS": ["trebuc.ttf", "trebucbd.ttf"],
    "Calibri": ["calibri.ttf", "calibrib.ttf"],
    "Consolas": ["consola.ttf", "consolab.ttf"],
}


def ensure_fonts(destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    windows_fonts = Path("C:/Windows/Fonts")
    if windows_fonts.is_dir():
        for files in FONT_CANDIDATES.values():
            for filename in files:
                source = windows_fonts / filename
                target = destination / filename
                if source.is_file() and not target.exists():
                    try:
                        shutil.copy2(source, target)
                    except OSError:
                        logger.debug("Could not copy font %s", filename)
    return destination


def preview_payload(
    cues: list[Cue],
    settings: SubtitleSettings,
    *,
    target_w: int,
    target_h: int,
    clip_duration: float,
) -> dict:
    return {
        "cues": [
            {
                "start": round(cue.start, 3),
                "end": round(cue.end, 3),
                "text": cue.text.upper() if settings.uppercase else cue.text,
                "words": [
                    {
                        "start": round(word.start, 3),
                        "end": round(word.end, 3),
                        "word": word.word.upper() if settings.uppercase else word.word,
                    }
                    for word in cue.words
                ],
            }
            for cue in cues
        ],
        "settings": settings.model_dump(),
        "target_width": target_w,
        "target_height": target_h,
        "clip_duration": clip_duration,
    }
