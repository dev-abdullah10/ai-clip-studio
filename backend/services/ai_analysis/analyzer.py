"""AI moment detection with validation, merging, ranking and offline fallback."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Callable

from pydantic import ValidationError as PydanticValidationError

from backend.core.exceptions import (
    JobCancelled,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
)
from backend.providers.base import LLMProvider, sleep_cancellable
from backend.schemas.clips import DISCOVERY_MODES, AnalysisSettings, ClipCandidateLLM
from backend.schemas.transcript import Segment, TranscriptData
from backend.services.ai_analysis.chunking import TranscriptChunk, build_chunks
from backend.services.ai_analysis.scoring import combine_scores, local_score
from backend.utils.text import extract_json_object, normalize_title, split_sentences

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert short-form video editor who finds moments that work as standalone clips.

You must return a single JSON object with this exact shape:
{
  "clips": [
    {
      "start": 125.5,
      "end": 168.2,
      "title": "An Unexpected Discovery",
      "description": "One or two sentences explaining what happens and why it is compelling.",
      "reason": "Why this moment works as a standalone clip.",
      "score": 94,
      "category": "educational",
      "hook": "The opening sentence that attracts attention",
      "transcript": "The relevant transcript excerpt"
    }
  ]
}

Rules:
- Timestamps are ABSOLUTE seconds in the full source video and must come from the transcript timestamps.
- A clip must start at the beginning of a thought and end after the payoff, never mid-sentence.
- Prefer self-contained moments that make sense with no outside context.
- Do not invent content that is not in the transcript.
- Avoid overlapping clips. Avoid silence-heavy openings or endings.
- Score each clip 0-100 for short-form potential.
- Return between 1 and 6 clips for the supplied chunk. If nothing is genuinely strong, return {"clips": []}.
- Return JSON only, with no markdown fences or commentary.
"""


@dataclass
class Candidate:
    start: float
    end: float
    title: str
    description: str
    reason: str
    hook: str
    category: str
    transcript: str
    llm_score: float | None = None
    local_score: float = 50.0
    components: dict[str, float] = field(default_factory=dict)
    source: str = "llm"
    final_score: float = 50.0

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class AnalysisResult:
    candidates: list[Candidate]
    warnings: list[str] = field(default_factory=list)
    used_llm: bool = False
    llm_provider: str | None = None
    llm_model: str | None = None
    chunk_count: int = 0


def analyze_transcript(
    transcript: TranscriptData,
    settings: AnalysisSettings,
    *,
    llm_provider: LLMProvider | None = None,
    scene_times: list[float] | None = None,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[float, str], None] | None = None,
) -> AnalysisResult:
    if not transcript.segments:
        raise ProviderError("The transcript is empty, so no clips can be detected.")

    warnings: list[str] = []
    llm_candidates: list[Candidate] = []
    chunk_count = 0
    used_llm = False

    if llm_provider is not None:
        chunks = build_chunks(transcript.segments, max_chars=8500, overlap_segments=2)
        chunk_count = len(chunks)
        if len(chunks) > 1:
            warnings.append(
                f"Transcript was split into {len(chunks)} chunks with overlap; duplicate moments were merged."
            )
        for index, chunk in enumerate(chunks):
            if cancel_event is not None and cancel_event.is_set():
                raise JobCancelled("Job cancelled")
            if on_progress:
                on_progress(
                    index / max(1, len(chunks)) * 100.0,
                    f"Analyzing transcript chunk {index + 1} of {len(chunks)}…",
                )
            try:
                response = llm_provider.complete_json(
                    system=SYSTEM_PROMPT,
                    user=_build_user_prompt(chunk, settings, transcript.duration),
                    cancel_event=cancel_event,
                    max_tokens=6000,
                )
                parsed = _parse_candidates(response, chunk, transcript.duration)
                if not parsed:
                    warnings.append(f"Chunk {index + 1} returned no valid clips.")
                llm_candidates.extend(parsed)
                used_llm = True
            except JobCancelled:
                raise
            except (ProviderAuthError, ProviderRateLimitError, ProviderError) as exc:
                warnings.append(f"AI analysis stopped: {exc.message}")
                break
            except Exception as exc:  # malformed provider response
                logger.warning("Chunk analysis failed: %s", exc)
                warnings.append(f"Chunk {index + 1} could not be analyzed.")
            if index + 1 < len(chunks):
                sleep_cancellable(0.8, cancel_event)
        if on_progress:
            on_progress(100.0, "AI analysis complete.")

    heuristic = _heuristic_candidates(transcript, settings)
    all_candidates = llm_candidates + heuristic

    # Score, snap, and validate every candidate against the real transcript.
    processed: list[Candidate] = []
    for candidate in all_candidates:
        snapped = _snap_and_validate(candidate, transcript, settings, scene_times)
        if snapped is None:
            continue
        local, components = local_score(
            snapped.transcript,
            _segments_between(transcript.segments, snapped.start, snapped.end),
            start=snapped.start,
            end=snapped.end,
            weights=settings.scoring_weights,
        )
        if settings.visual_analysis and scene_times:
            alignment = _scene_alignment(snapped.start, snapped.end, scene_times)
            components["visual_alignment"] = round(alignment * 100.0, 1)
            local = min(100.0, local + alignment * 4.0)
        snapped.local_score = local
        snapped.components = components
        snapped.final_score = combine_scores(local, snapped.llm_score)
        processed.append(snapped)

    if not processed:
        if settings.allow_llm_fallback or llm_provider is None:
            raise ProviderError(
                "No valid clip candidates could be produced. The transcript may be too short or contain no clear moments."
            )
        raise ProviderError("AI analysis produced no valid clips. Try a different provider or clip settings.")

    selected = _merge_and_select(processed, settings, transcript.duration)
    if not selected:
        raise ProviderError("No non-overlapping clips could be selected with the current duration settings.")

    selected.sort(key=lambda c: c.final_score, reverse=True)
    if on_progress:
        on_progress(100.0, f"Selected {len(selected)} clip candidates.")

    return AnalysisResult(
        candidates=selected,
        warnings=warnings,
        used_llm=used_llm,
        llm_provider=llm_provider.info.id if llm_provider else None,
        llm_model=getattr(llm_provider, "model", None) if llm_provider else None,
        chunk_count=chunk_count,
    )


def _build_user_prompt(chunk: TranscriptChunk, settings: AnalysisSettings, duration: float) -> str:
    mode = DISCOVERY_MODES.get(settings.discovery_mode, DISCOVERY_MODES["best"])
    custom = ""
    if settings.discovery_mode == "custom" and settings.custom_instructions:
        custom = f"\nCUSTOM INSTRUCTIONS FROM THE CREATOR:\n{settings.custom_instructions}\n"
    elif settings.custom_instructions:
        custom = f"\nExtra creator guidance:\n{settings.custom_instructions}\n"
    return f"""Source video duration: {duration:.1f} seconds.
This chunk covers {chunk.start:.1f}s to {chunk.end:.1f}s.
Discovery mode: {mode["label"]}
Mode instruction: {mode["instruction"]}
{custom}
Clip duration preference: {settings.min_duration:.0f}-{settings.max_duration:.0f} seconds (a strong moment may
run slightly longer, but never longer than {settings.max_duration * 1.2:.0f} seconds).
Return up to 6 clips from this chunk, ranked by short-form potential.

Transcript (timestamps are absolute seconds; lines are [start-end] text):
{chunk.render()}

Return only the JSON object described in the system message."""


def _parse_candidates(response: str, chunk: TranscriptChunk, duration: float) -> list[Candidate]:
    try:
        payload = extract_json_object(response)
    except Exception as exc:
        raise ProviderError("The AI returned malformed JSON.") from exc
    items = payload.get("clips") or payload.get("moments") or []
    if not isinstance(items, list):
        return []
    output: list[Candidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_item_keys(item)
        try:
            parsed = ClipCandidateLLM.model_validate(normalized)
        except (PydanticValidationError, ValueError, TypeError):
            continue
        if parsed.start >= duration or parsed.end > duration + 5:
            continue
        # Guard against the model returning chunk-relative rather than absolute times.
        intersects = parsed.start < chunk.end + 8 and parsed.end > chunk.start - 8
        if not intersects and parsed.end <= (chunk.end - chunk.start + 5):
            parsed.start += chunk.start
            parsed.end += chunk.start
            if not (parsed.start < chunk.end + 8 and parsed.end > chunk.start - 8):
                continue
        output.append(
            Candidate(
                start=parsed.start,
                end=min(parsed.end, duration),
                title=normalize_title(parsed.title),
                description=parsed.description,
                reason=parsed.reason,
                hook=parsed.hook,
                category=parsed.category,
                transcript=parsed.transcript,
                llm_score=parsed.score,
                source="llm",
            )
        )
    return output


def _normalize_item_keys(item: dict) -> dict:
    aliases = {
        "start_time": "start",
        "start_seconds": "start",
        "startTime": "start",
        "end_time": "end",
        "end_seconds": "end",
        "endTime": "end",
        "clip_start": "start",
        "clip_end": "end",
        "text": "transcript",
        "summary": "description",
        "why": "reason",
        "hook_text": "hook",
    }
    output = dict(item)
    for alias, target in aliases.items():
        if alias in output and target not in output:
            output[target] = output.pop(alias)
    score = output.get("score")
    if isinstance(score, str):
        digits = "".join(ch for ch in score if ch.isdigit() or ch == ".")
        try:
            output["score"] = float(digits) if digits else 50.0
        except ValueError:
            output["score"] = 50.0
    for key in ("start", "end"):
        value = output.get(key)
        if isinstance(value, str):
            try:
                output[key] = float(value.replace("s", "").replace(",", "."))
            except ValueError:
                pass
    return output


def _segments_between(segments: list[Segment], start: float, end: float) -> list[Segment]:
    return [s for s in segments if s.end > start and s.start < end]


def _snap_and_validate(
    candidate: Candidate,
    transcript: TranscriptData,
    settings: AnalysisSettings,
    scene_times: list[float] | None,
) -> Candidate | None:
    duration = transcript.duration
    start = max(0.0, min(candidate.start, duration - 1.0))
    end = max(start + 1.0, min(candidate.end, duration))
    segments = transcript.segments

    start = _snap_start(segments, start, scene_times)
    end = _snap_end(segments, end, scene_times)

    # Avoid starting on a conjunction when the previous sentence is very close.
    first = next((s for s in segments if s.start >= start - 0.05), None)
    if first and first.start > start + 0.05:
        start = first.start
    if first and first is not segments[0]:
        previous = segments[segments.index(first) - 1]
        if (
            previous.text
            and previous.text.strip()[:1].islower()
            and start - previous.end < 1.2
            and (end - previous.start) <= settings.max_duration * 1.15
        ):
            start = previous.start

    # Trim leading/trailing silence using word timings, keeping a small pad.
    words_in = [
        w
        for s in _segments_between(segments, start, end)
        for w in s.words
        if w.start >= start - 0.2 and w.end <= end + 0.2
    ]
    if words_in:
        if words_in[0].start - start > 0.45:
            start = max(0.0, words_in[0].start - 0.12)
        if end - words_in[-1].end > 0.75:
            end = min(duration, words_in[-1].end + 0.35)

    clip_segments = _segments_between(segments, start, end)
    if not clip_segments:
        return None
    text = " ".join(s.text for s in clip_segments).strip()
    if len(text.split()) < 5:
        return None

    # Duration policy: preferences are flexible, but avoid tiny or huge clips.
    min_duration = settings.min_duration
    max_duration = settings.max_duration * 1.2
    if end - start < min_duration:
        extended_end = _extend_end(segments, end, start + min_duration, max_duration)
        end = min(duration, max(end, extended_end))
    if end - start > max_duration:
        trimmed = _trim_end(segments, start, end, max_duration)
        end = max(start + min_duration * 0.8, trimmed)
    if end - start < max(3.0, min_duration * 0.35):
        return None

    clip_segments = _segments_between(segments, start, end)
    text = " ".join(s.text for s in clip_segments).strip()
    if not text:
        return None

    sentences = split_sentences(text)
    hook = candidate.hook or (sentences[0] if sentences else text[:160])
    title = normalize_title(candidate.title or (sentences[0] if sentences else "Highlight"))
    description = candidate.description or text[:320]
    reason = candidate.reason or "Strong opening, self-contained context, and a clear payoff."

    return Candidate(
        start=round(start, 3),
        end=round(end, 3),
        title=title,
        description=description,
        reason=reason,
        hook=hook[:400],
        category=candidate.category or settings.discovery_mode,
        transcript=text,
        llm_score=candidate.llm_score,
        local_score=candidate.local_score,
        components=candidate.components,
        source=candidate.source,
    )


def _snap_start(segments: list[Segment], value: float, scene_times: list[float] | None) -> float:
    candidates = [s.start for s in segments if abs(s.start - value) <= 2.5]
    if scene_times:
        candidates += [t for t in scene_times if abs(t - value) <= 1.2]
    if not candidates:
        return value
    earlier = [c for c in candidates if c <= value + 0.4]
    return max(earlier) if earlier else min(candidates, key=lambda c: abs(c - value))


def _snap_end(segments: list[Segment], value: float, scene_times: list[float] | None) -> float:
    candidates = [s.end for s in segments if abs(s.end - value) <= 2.5]
    if scene_times:
        candidates += [t for t in scene_times if abs(t - value) <= 1.2]
    if not candidates:
        return value
    later = [c for c in candidates if c >= value - 0.4]
    return min(later) if later else min(candidates, key=lambda c: abs(c - value))


def _extend_end(
    segments: list[Segment], end: float, desired_end: float, hard_end: float
) -> float:
    boundaries = [s.end for s in segments if s.end > end and s.end <= hard_end]
    for boundary in sorted(boundaries):
        if boundary >= desired_end:
            return boundary
    return min(hard_end, segments[-1].end if segments else end)


def _trim_end(segments: list[Segment], start: float, end: float, hard_end: float) -> float:
    limit = start + hard_end
    boundaries = [s.end for s in segments if start < s.end <= limit]
    if not boundaries:
        return min(end, limit)
    return max(boundaries)


def _heuristic_candidates(
    transcript: TranscriptData, settings: AnalysisSettings
) -> list[Candidate]:
    """Sliding-window generator that keeps the app useful without an LLM."""
    segments = transcript.segments
    if not segments:
        return []
    target = max(settings.min_duration, (settings.min_duration + settings.max_duration) / 2)
    hard_max = settings.max_duration
    output: list[Candidate] = []
    count = len(segments)
    step = 1
    for i in range(0, count, step):
        if len(output) >= max(settings.clip_count * 6, 30):
            break
        start = segments[i].start
        end = segments[i].end
        j = i + 1
        while j < count and (end - start) < target:
            end = segments[j].end
            j += 1
        # Finish on a sentence boundary if possible.
        while j < count and (end - start) < settings.min_duration:
            end = segments[j].end
            j += 1
        if end - start > hard_max * 1.1:
            continue
        clip_text = " ".join(s.text for s in segments[i:j]).strip()
        if len(clip_text.split()) < 8:
            continue
        score, _components = local_score(
            clip_text,
            segments[i:j],
            start=start,
            end=end,
            weights=settings.scoring_weights,
        )
        sentences = split_sentences(clip_text)
        output.append(
            Candidate(
                start=start,
                end=end,
                title=normalize_title(sentences[0] if sentences else "Highlight"),
                description=clip_text[:320],
                reason="Local transcript analysis: distinctive wording, self-contained flow, and a clear ending.",
                hook=(sentences[0] if sentences else clip_text[:160])[:400],
                category=settings.discovery_mode if settings.discovery_mode != "custom" else "general",
                transcript=clip_text,
                llm_score=None,
                local_score=score,
                source="local",
            )
        )
    return output


def _scene_alignment(start: float, end: float, scene_times: list[float]) -> float:
    """Score 0-1 for how well a clip lands on visual scene cuts."""
    if not scene_times:
        return 0.0
    start_hit = any(abs(t - start) <= 1.5 for t in scene_times)
    end_hit = any(abs(t - end) <= 1.5 for t in scene_times)
    return (1.0 if start_hit else 0.0) * 0.5 + (1.0 if end_hit else 0.0) * 0.5


def _overlap_ratio(a: Candidate, b: Candidate) -> float:
    overlap = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    smallest = max(0.001, min(a.duration, b.duration))
    return overlap / smallest


def _merge_and_select(
    candidates: list[Candidate], settings: AnalysisSettings, duration: float
) -> list[Candidate]:
    # Drop exact/overlap duplicates, keeping the strongest.
    ordered = sorted(candidates, key=lambda c: c.final_score, reverse=True)
    kept: list[Candidate] = []
    for candidate in ordered:
        duplicate = False
        for existing in kept:
            if _overlap_ratio(candidate, existing) > 0.55:
                duplicate = True
                break
            if abs(candidate.start - existing.start) < 1.5 and abs(candidate.end - existing.end) < 1.5:
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)

    max_supported = max(1, int(duration / max(8.0, settings.min_duration * 0.75)))
    limit = min(settings.clip_count, max_supported, len(kept))
    return kept[:limit]
