"""Shared helpers for turning provider word lists into transcript segments."""

from __future__ import annotations

from backend.schemas.transcript import Segment, Word


def segment_from_words(words: list[Word]) -> Segment:
    text = " ".join(w.word for w in words).strip()
    text = (
        text.replace(" ,", ",")
        .replace(" .", ".")
        .replace(" ?", "?")
        .replace(" !", "!")
        .replace(" ;", ";")
        .replace(" :", ":")
    )
    speakers = {w.speaker for w in words if w.speaker}
    return Segment(
        start=words[0].start,
        end=max(words[-1].end, words[0].start + 0.1),
        text=text,
        speaker=words[0].speaker if len(speakers) <= 1 else None,
        words=list(words),
    )


def group_words(
    words: list[Word],
    *,
    max_segment_seconds: float = 12.0,
    max_chars: int = 110,
    gap_seconds: float = 1.2,
) -> list[Segment]:
    segments: list[Segment] = []
    current: list[Word] = []
    for word in words:
        if not current:
            current.append(word)
            continue
        prev = current[-1]
        gap = word.start - prev.end
        speaker_change = bool(word.speaker and prev.speaker and word.speaker != prev.speaker)
        ends_sentence = bool(prev.word and prev.word[-1] in ".!?…")
        too_long = (
            (word.end - current[0].start) > max_segment_seconds
            or len(" ".join(w.word for w in current)) > max_chars
        )
        if speaker_change or gap > gap_seconds or (ends_sentence and gap > 0.35) or too_long:
            segments.append(segment_from_words(current))
            current = []
        current.append(word)
    if current:
        segments.append(segment_from_words(current))
    return segments


def synthesize_words(segments: list[Segment]) -> None:
    """Fill missing word timings by distributing time across tokens."""
    for segment in segments:
        if segment.words:
            continue
        tokens = segment.text.split()
        if not tokens:
            continue
        duration = max(0.05, segment.end - segment.start)
        total_chars = sum(max(1, len(t)) for t in tokens)
        cursor = segment.start
        distributed: list[Word] = []
        for token in tokens:
            share = max(1, len(token)) / total_chars
            word_duration = max(0.04, duration * share)
            distributed.append(
                Word(
                    start=round(cursor, 3),
                    end=round(min(segment.end, cursor + word_duration), 3),
                    word=token,
                    speaker=segment.speaker,
                )
            )
            cursor += word_duration
        segment.words = distributed
