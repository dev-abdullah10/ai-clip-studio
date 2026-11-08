"""Provider-agnostic transcription: chunking, offsetting, validation, storage."""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Callable

from backend.core.exceptions import JobCancelled, ProviderError, TranscriptionError
from backend.providers.base import SpeechProvider
from backend.providers.speech.common import synthesize_words
from backend.schemas.transcript import Segment, TranscriptData, Word
from backend.services.audio.extract import detect_silences, plan_chunks, split_audio

logger = logging.getLogger(__name__)


def transcribe_audio_file(
    audio_path: Path,
    duration: float,
    provider: SpeechProvider,
    *,
    language: str | None = None,
    work_dir: Path,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[float, str], None] | None = None,
) -> TranscriptData:
    max_chunk = max(60.0, float(provider.max_chunk_seconds or 1200.0))
    ranges = [(0.0, duration)]
    chunks_dir = work_dir / "audio_chunks"
    chunk_paths: list[Path] = []

    if duration > max_chunk:
        if on_progress:
            on_progress(0.0, "Finding safe split points in the audio…")
        silences = detect_silences(audio_path)
        ranges = plan_chunks(duration, max_chunk, silences)
        if len(ranges) > 1:
            if on_progress:
                on_progress(0.0, f"Splitting audio into {len(ranges)} chunks…")
            chunks = split_audio(audio_path, chunks_dir, ranges, cancel_event=cancel_event)
            chunk_paths = [c.path for c in chunks if c.path != audio_path]
        else:
            chunks = []
    else:
        chunks = []

    if not chunks:
        from backend.services.audio.extract import AudioChunk

        chunks = [AudioChunk(path=audio_path, offset=0.0, duration=duration)]

    merged_segments: list[Segment] = []
    detected_language: str | None = None
    speakers: set[str] = set()
    failures = 0

    try:
        for index, chunk in enumerate(chunks):
            if cancel_event is not None and cancel_event.is_set():
                raise JobCancelled("Job cancelled")
            if on_progress:
                base = index / len(chunks) * 100.0
                on_progress(base, f"Transcribing audio chunk {index + 1} of {len(chunks)}…")
            try:
                result = provider.transcribe(
                    chunk.path,
                    language=language or None,
                    word_timestamps=True,
                    duration_hint=chunk.duration,
                    cancel_event=cancel_event,
                )
            except JobCancelled:
                raise
            except ProviderError as exc:
                lowered = (exc.message or "").lower()
                if "empty transcript" in lowered or "no speech" in lowered:
                    logger.warning("Chunk %s contained no speech", index)
                    failures += 1
                    continue
                raise
            if detected_language is None and result.language:
                detected_language = result.language

            chunk_speakers: dict[str, str] = {}
            for segment in result.segments:
                if cancel_event is not None and cancel_event.is_set():
                    raise JobCancelled("Job cancelled")
                start = segment.start + chunk.offset
                end = segment.end + chunk.offset
                speaker = segment.speaker
                if speaker:
                    if speaker not in chunk_speakers:
                        chunk_speakers[speaker] = f"Speaker {len(chunk_speakers) + 1}"
                    speaker = chunk_speakers[speaker]
                    speakers.add(speaker)
                words = [
                    Word(
                        start=max(0.0, word.start + chunk.offset),
                        end=max(0.0, word.end + chunk.offset),
                        word=word.word,
                        speaker=chunk_speakers.get(word.speaker or "", word.speaker),
                    )
                    for word in segment.words
                ]
                if not words and segment.text.strip():
                    temp = Segment(
                        start=start,
                        end=end,
                        text=segment.text,
                        speaker=speaker,
                    )
                    synthesize_words([temp])
                    words = temp.words
                merged_segments.append(
                    Segment(
                        start=round(max(0.0, start), 3),
                        end=round(max(start + 0.05, end), 3),
                        text=segment.text.strip(),
                        speaker=speaker,
                        words=words,
                    )
                )
            if on_progress:
                on_progress((index + 1) / len(chunks) * 100.0, f"Transcribed chunk {index + 1} of {len(chunks)}.")
    finally:
        for path in chunk_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            if chunks_dir.exists() and not any(chunks_dir.iterdir()):
                chunks_dir.rmdir()
        except OSError:
            pass

    if not merged_segments:
        raise TranscriptionError(
            "No speech was detected in this video. Check that the video has an audio track with audible speech."
        )

    merged_segments.sort(key=lambda s: s.start)
    cleaned: list[Segment] = []
    for segment in merged_segments:
        if segment.end <= segment.start:
            segment.end = segment.start + 0.1
        if segment.start >= duration:
            continue
        segment.end = min(segment.end, duration)
        cleaned.append(segment)

    transcript = TranscriptData(
        language=detected_language,
        duration=duration,
        provider=provider.info.id,
        model=getattr(provider, "model", None)
        or (getattr(provider, "model_size", None) if hasattr(provider, "model_size") else None),
        segments=cleaned,
        speakers=sorted(speakers),
    )
    transcript.rebuild_text()
    return transcript


def save_transcript(transcript: TranscriptData, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(transcript.model_dump_json(indent=2), encoding="utf-8")
    temp.replace(path)
    return path


def load_transcript(path: Path) -> TranscriptData:
    if not path.is_file():
        raise TranscriptionError("No transcript exists for this project yet.")
    try:
        return TranscriptData.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise TranscriptionError("The saved transcript is unreadable and must be regenerated.") from exc


_SRT_BLOCK = re.compile(
    r"(?:(?P<index>\d+)\s*)?(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})(?P<rest>.*)",
    re.DOTALL,
)


def parse_subtitle_text(text: str) -> TranscriptData:
    """Import SRT or WebVTT as a transcript (works fully offline)."""
    from backend.utils.time import parse_srt_time

    normalized = text.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    timing = re.compile(
        r"(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*"
        r"(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})"
    )
    segments: list[Segment] = []
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        match = timing.search(line)
        if not match:
            index += 1
            continue
        try:
            start = parse_srt_time(match.group("start"))
            end = parse_srt_time(match.group("end"))
        except ValueError:
            index += 1
            continue
        index += 1
        cue_lines: list[str] = []
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate:
                break
            if timing.search(candidate):
                break
            if not re.match(r"^\d+$", candidate) or cue_lines:
                if not re.match(r"^[a-zA-Z]+:\S", candidate):
                    cue_lines.append(candidate)
            index += 1
        content = " ".join(cue_lines).strip()
        if content and end > start:
            segments.append(Segment(start=start, end=end, text=content))

    if not segments:
        raise TranscriptionError(
            "No subtitle cues were found. Upload a valid .srt or .vtt file."
        )
    synthesize_words(segments)
    duration = max(s.end for s in segments)
    transcript = TranscriptData(
        language=None,
        duration=duration,
        provider="imported",
        model="subtitle file",
        segments=segments,
    )
    transcript.rebuild_text()
    return transcript
