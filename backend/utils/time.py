"""Timestamp formatting helpers used by subtitles and transcripts."""

from __future__ import annotations


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def format_srt_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    millis = int(round(seconds * 1000))
    hours, rem = divmod(millis, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def format_vtt_time(seconds: float) -> str:
    return format_srt_time(seconds).replace(",", ".")


def format_ass_time(seconds: float) -> str:
    """ASS uses centiseconds and a single-digit hour."""
    seconds = max(0.0, seconds)
    centis = int(round(seconds * 100))
    hours, rem = divmod(centis, 360_000)
    minutes, rem = divmod(rem, 6000)
    secs, cs = divmod(rem, 100)
    return f"{hours:d}:{minutes:02d}:{secs:02d}.{cs:02d}"


def parse_srt_time(value: str) -> float:
    value = value.strip().replace(".", ",")
    match = value.split(":")
    if len(match) != 3:
        raise ValueError(f"Invalid SRT timestamp: {value}")
    hours = int(match[0])
    minutes = int(match[1])
    secs_part = match[2].replace(",", ".")
    return hours * 3600 + minutes * 60 + float(secs_part)


def format_clock(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
