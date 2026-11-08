"""Local multi-signal clip scoring (works with or without an LLM)."""

from __future__ import annotations

import re

from backend.schemas.transcript import Segment
from backend.utils.text import (
    EMOTION_WORDS,
    FACT_WORDS,
    HOOK_WORDS,
    PAYOFF_WORDS,
    REFERENCE_WORDS,
    filler_ratio,
    keyword_hits,
    split_sentences,
    words,
)

DEFAULT_WEIGHTS = {
    "interesting": 0.20,
    "hook": 0.20,
    "standalone": 0.20,
    "value": 0.15,
    "emotion": 0.10,
    "payoff": 0.10,
    "clarity": 0.05,
}


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


def score_components(
    text: str,
    segments: list[Segment],
    *,
    start: float,
    end: float,
) -> dict[str, float]:
    sentences = split_sentences(text)
    first = sentences[0] if sentences else (text[:200] or "")
    last = sentences[-1] if sentences else (text[-200:] or "")
    tokens = words(text)
    token_count = max(1, len(tokens))
    duration = max(0.5, end - start)

    number_hits = len(re.findall(r"\b\d[\d,.%$]*\b", text))
    fact_hits = keyword_hits(text, FACT_WORDS)
    emotion_hits = keyword_hits(text, EMOTION_WORDS)
    hook_hits = keyword_hits(first, HOOK_WORDS)
    unique_ratio = len({t.lower() for t in tokens}) / token_count
    words_per_second = token_count / duration

    # 1. Interesting content: facts, numbers, lexical variety, information density.
    interesting = 34.0 + fact_hits * 9 + min(18, number_hits * 6) + unique_ratio * 28
    interesting += min(15, words_per_second * 12)
    interesting = _clamp(interesting)

    # 2. Hook strength: a strong first sentence.
    hook = 30.0
    if first.strip().endswith("?"):
        hook += 22
    if re.match(
        r"(?i)^(how|why|what|stop|never|the truth|nobody|everyone|this|here|imagine|listen|actually|most|biggest)",
        first.strip(),
    ):
        hook += 22
    hook += min(18, hook_hits * 12)
    if len(first.split()) <= 18:
        hook += 12
    if number_hits:
        hook += 6
    if "!" in first:
        hook += 6
    hook = _clamp(hook)

    # 3. Standalone context: starts cleanly, no back-references.
    reference_hits = keyword_hits(text, REFERENCE_WORDS)
    standalone = 76.0
    if segments:
        first_seg = segments[0].text.strip()
        if re.match(r"(?i)^(and|but|so|because|then|also|which|that|it)\b", first_seg):
            standalone -= 22
        if first_seg[:1].isupper():
            standalone += 8
    standalone -= reference_hits * 20
    if len(sentences) >= 2:
        standalone += 8
    standalone = _clamp(standalone)

    # 4. Information / entertainment value.
    value = 30.0 + fact_hits * 10 + min(24, number_hits * 7) + emotion_hits * 5
    if re.search(r"(?i)\b(tip|advice|lesson|learn|remember|important|key|step|mistake)\b", text):
        value += 12
    if re.search(r"(?i)\b(funny|hilarious|laugh|joke|punchline)\b", text):
        value += 10
    value = _clamp(value)

    # 5. Emotional engagement.
    emphasis = text.count("!") * 6
    caps = len(re.findall(r"\b[A-Z]{3,}\b", text)) * 4
    emotion = 24.0 + emotion_hits * 12 + emphasis + caps
    if re.search(r"(?i)\[(laughs?|laughter)\]", text):
        emotion += 18
    emotion = _clamp(emotion)

    # 6. Ending / payoff.
    payoff = 44.0
    if last.strip().endswith((".", "!", "?")):
        payoff += 18
    payoff += min(24, keyword_hits(last, PAYOFF_WORDS) * 12)
    if len(last.split()) >= 4:
        payoff += 8
    if last.strip().endswith((",", "and", "but", "so", "because")):
        payoff -= 25
    payoff = _clamp(payoff)

    # 7. Clarity: low filler ratio, comfortable pacing.
    filler = filler_ratio(text)
    clarity = 100.0 - filler * 260
    if 1.6 <= words_per_second <= 3.6:
        clarity += 8
    elif words_per_second > 4.8:
        clarity -= 20
    avg_sentence = token_count / max(1, len(sentences))
    if avg_sentence > 30:
        clarity -= 12
    clarity = _clamp(clarity)

    return {
        "interesting": round(interesting, 1),
        "hook": round(hook, 1),
        "standalone": round(standalone, 1),
        "value": round(value, 1),
        "emotion": round(emotion, 1),
        "payoff": round(payoff, 1),
        "clarity": round(clarity, 1),
    }


def local_score(
    text: str,
    segments: list[Segment],
    *,
    start: float,
    end: float,
    weights: dict[str, float] | None = None,
) -> tuple[float, dict[str, float]]:
    components = score_components(text, segments, start=start, end=end)
    weights = weights or DEFAULT_WEIGHTS
    total_weight = sum(max(0.0, weights.get(key, 0.0)) for key in components) or 1.0
    score = sum(
        components[key] * max(0.0, weights.get(key, 0.0)) for key in components
    ) / total_weight
    return round(_clamp(score), 1), components


def combine_scores(local: float, llm: float | None) -> float:
    if llm is None:
        return round(_clamp(local), 1)
    # The model understands meaning; local signals keep it grounded and resist
    # hallucinated "great moments" that are not actually distinctive.
    return round(_clamp(0.7 * llm + 0.3 * local), 1)
