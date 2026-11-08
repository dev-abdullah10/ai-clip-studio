"""Transcript schemas shared by every speech provider."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class Word(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    word: str
    speaker: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "Word":
        if self.end < self.start:
            self.end = self.start
        self.word = self.word.strip()
        return self


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    speaker: str | None = None
    words: list[Word] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self) -> "Segment":
        if self.end < self.start:
            self.end = self.start
        self.text = " ".join(self.text.split())
        return self


class TranscriptData(BaseModel):
    language: str | None = None
    duration: float = 0.0
    provider: str = "unknown"
    model: str | None = None
    segments: list[Segment] = Field(default_factory=list)
    text: str = ""
    speakers: list[str] = Field(default_factory=list)

    def rebuild_text(self) -> None:
        self.text = " ".join(seg.text for seg in self.segments if seg.text).strip()

    @property
    def word_count(self) -> int:
        return sum(len((seg.text or "").split()) for seg in self.segments)

    def all_words(self) -> list[Word]:
        output: list[Word] = []
        for segment in self.segments:
            if segment.words:
                output.extend(segment.words)
            else:
                tokens = segment.text.split()
                if not tokens:
                    continue
                step = (segment.end - segment.start) / max(1, len(tokens))
                for index, token in enumerate(tokens):
                    output.append(
                        Word(
                            start=segment.start + index * step,
                            end=segment.start + (index + 1) * step,
                            word=token,
                            speaker=segment.speaker,
                        )
                    )
        return output

    def slice(self, start: float, end: float) -> "TranscriptData":
        segments: list[Segment] = []
        for segment in self.segments:
            if segment.end < start or segment.start > end:
                continue
            s = max(segment.start, start)
            e = min(segment.end, end)
            if e <= s:
                continue
            words = [
                Word(start=max(w.start, s) - start, end=min(w.end, e) - start, word=w.word, speaker=w.speaker)
                for w in segment.words
                if w.end > start and w.start < end
            ]
            segments.append(
                Segment(
                    start=s - start,
                    end=e - start,
                    text=segment.text,
                    speaker=segment.speaker,
                    words=words,
                )
            )
        sliced = TranscriptData(
            language=self.language,
            duration=max(0.0, end - start),
            provider=self.provider,
            model=self.model,
            segments=segments,
            speakers=self.speakers,
        )
        sliced.rebuild_text()
        return sliced


class TranscriptUpload(BaseModel):
    language: str | None = None
