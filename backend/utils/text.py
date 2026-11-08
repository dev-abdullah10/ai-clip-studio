"""Text analysis helpers (sentence boundaries, scoring signals, JSON repair)."""

from __future__ import annotations

import json
import re

FILLERS = {
    "um",
    "uh",
    "erm",
    "er",
    "ah",
    "mm",
    "hmm",
    "like",
    "you know",
    "i mean",
    "sort of",
    "kind of",
}

HOOK_WORDS = {
    "how",
    "why",
    "what",
    "never",
    "stop",
    "secret",
    "truth",
    "biggest",
    "worst",
    "best",
    "most",
    "nobody",
    "everyone",
    "this",
    "here",
    "imagine",
    "listen",
    "actually",
    "surprising",
    "crazy",
    "insane",
    "mistake",
    "warning",
}
EMOTION_WORDS = {
    "love",
    "hate",
    "amazing",
    "terrible",
    "incredible",
    "shocking",
    "unbelievable",
    "crazy",
    "insane",
    "hilarious",
    "funny",
    "scary",
    "afraid",
    "excited",
    "angry",
    "sad",
    "happy",
    "mind-blowing",
}
FACT_WORDS = {
    "study",
    "research",
    "scientists",
    "data",
    "percent",
    "million",
    "billion",
    "actually",
    "fact",
    "according",
    "discovered",
    "found",
    "experiment",
    "history",
}
PAYOFF_WORDS = {
    "so",
    "therefore",
    "that's why",
    "the point",
    "which means",
    "in the end",
    "finally",
    "the result",
    "bottom line",
    "lesson",
}
REFERENCE_WORDS = {
    "earlier",
    "before",
    "as i said",
    "previously",
    "like i mentioned",
    "last time",
    "that thing",
}


def split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = re.split(r"(?<=[.!?…])\s+|\n+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9']+", text or "")


def filler_ratio(text: str) -> float:
    tokens = [w.lower() for w in words(text)]
    if not tokens:
        return 0.0
    lowered = (text or "").lower()
    filler_count = sum(1 for token in tokens if token in FILLERS)
    filler_count += sum(lowered.count(phrase) for phrase in FILLERS if " " in phrase)
    return min(1.0, filler_count / max(1, len(tokens)))


def keyword_hits(text: str, vocabulary: set[str]) -> int:
    lowered = (text or "").lower()
    return sum(1 for word in vocabulary if re.search(rf"\b{re.escape(word)}\b", lowered))


def extract_json_object(text: str) -> dict:
    """Extract the first JSON object from an LLM response, tolerating code fences."""
    if not text:
        raise ValueError("Empty model response")
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
        if isinstance(value, list):
            return {"clips": value}
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    if start == -1:
        raise ValueError("Model response did not contain a JSON object")
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(cleaned)):
        char = cleaned[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
        else:
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(cleaned[start : index + 1])
    raise ValueError("Model response contained incomplete JSON")


def normalize_title(text: str, *, max_len: int = 120) -> str:
    value = re.sub(r"\s+", " ", (text or "").strip().strip(" \"'`"))
    value = value.split("\n")[0].strip()
    if not value:
        value = "Untitled clip"
    if len(value) > max_len:
        value = value[: max_len - 1].rstrip() + "…"
    return value
