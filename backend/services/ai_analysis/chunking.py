"""Transcript chunking with overlap and absolute timestamps."""

from __future__ import annotations

from dataclasses import dataclass

from backend.schemas.transcript import Segment


@dataclass
class TranscriptChunk:
    index: int
    segments: list[Segment]
    start: float
    end: float

    def render(self) -> str:
        lines = []
        for seg in self.segments:
            speaker = f" {seg.speaker}:" if seg.speaker else ""
            lines.append(f"[{seg.start:.2f}-{seg.end:.2f}]{speaker} {seg.text}")
        return "\n".join(lines)


def build_chunks(
    segments: list[Segment],
    *,
    max_chars: int = 9000,
    overlap_segments: int = 2,
    max_chunks: int = 40,
) -> list[TranscriptChunk]:
    if not segments:
        return []
    chunks: list[TranscriptChunk] = []
    current: list[Segment] = []
    size = 0

    def flush() -> None:
        if current:
            chunks.append(
                TranscriptChunk(
                    index=len(chunks),
                    segments=list(current),
                    start=current[0].start,
                    end=current[-1].end,
                )
            )

    for segment in segments:
        line_len = len(segment.text) + 24
        if current and size + line_len > max_chars:
            flush()
            overlap = current[-overlap_segments:] if overlap_segments else []
            current = list(overlap)
            size = sum(len(s.text) + 24 for s in current)
        current.append(segment)
        size += line_len
    flush()

    if len(chunks) > max_chunks:
        # Keep even coverage across the full video instead of only the first part.
        step = len(chunks) / max_chunks
        chunks = [chunks[min(len(chunks) - 1, int(i * step))] for i in range(max_chunks)]
        for index, chunk in enumerate(chunks):
            chunk.index = index
    return chunks
