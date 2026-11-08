"""Groq providers (free tier).

Verified against Groq docs (2026): OpenAI-compatible Whisper transcription
(25 MB free-tier upload limit, 20 requests/min), and Llama/GPT-OSS chat models.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

import httpx

from backend.core.exceptions import (
    JobCancelled,
    ProviderAuthError,
    ProviderError,
    ProviderUnavailableError,
)
from backend.providers.base import (
    LLMProvider,
    ProviderInfo,
    ProviderTestResult,
    SpeechProvider,
    request_json,
    sleep_cancellable,
)
from backend.providers.speech.common import group_words, synthesize_words
from backend.schemas.transcript import Segment, TranscriptData, Word

logger = logging.getLogger(__name__)

GROQ_BASE = "https://api.groq.com/openai/v1"
GROQ_SPEECH_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"]
GROQ_LLM_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
]

SPEECH_INFO = ProviderInfo(
    id="groq",
    name="Groq",
    kind="speech",
    description=(
        "Whisper Large v3 / Turbo on Groq. Fast OpenAI-compatible transcription with "
        "word timestamps. Free tier: 25 MB per request, 20 requests/min, 2,000 requests/day."
    ),
    requires_key=True,
    free_tier="Free tier: 25 MB uploads, 20 RPM, 2,000 requests/day, 7,200 audio sec/hour.",
    default_model="whisper-large-v3-turbo",
    models=GROQ_SPEECH_MODELS,
    docs_url="https://console.groq.com/docs/speech-to-text",
    capabilities={
        "word_timestamps": True,
        "diarization": False,
        "language_detection": True,
        "max_file_seconds": 1800,
        "max_upload_mb": 25,
        "cloud": True,
    },
)

LLM_INFO = ProviderInfo(
    id="groq",
    name="Groq",
    kind="llm",
    description=(
        "Llama / GPT-OSS models on Groq with very low latency. Free tier is rate limited. "
        "Only transcript text is sent for analysis."
    ),
    requires_key=True,
    free_tier="Free tier with per-model RPM/RPD limits (varies by model, subject to change).",
    default_model="llama-3.3-70b-versatile",
    models=GROQ_LLM_MODELS,
    docs_url="https://console.groq.com/docs/models",
    capabilities={"json_mode": True, "cloud": True},
)


def _mime_for(path: Path) -> str:
    return {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
        ".webm": "audio/webm",
    }.get(path.suffix.lower(), "audio/mpeg")


class GroqSpeechProvider(SpeechProvider):
    info = SPEECH_INFO
    base_url = GROQ_BASE
    max_chunk_seconds = 600.0

    def __init__(self, api_key: str, model: str = "whisper-large-v3-turbo"):
        self.api_key = api_key
        self.model = model or "whisper-large-v3-turbo"

    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        word_timestamps: bool = True,
        duration_hint: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> TranscriptData:
        data = {
            "model": self.model,
            "response_format": "verbose_json",
            "temperature": "0",
        }
        if word_timestamps:
            data["timestamp_granularities[]"] = "word"
        if language and language.lower() not in ("auto", ""):
            data["language"] = language.split("-")[0].lower()
        try:
            payload = request_json(
                "POST",
                f"{self.base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                data=data,
                files={"file": (audio_path.name, audio_path.read_bytes(), _mime_for(audio_path))},
                timeout=600,
                retries=3,
                cancel_event=cancel_event,
            )
        except ProviderAuthError:
            raise
        except ProviderError as exc:
            if "model" in (exc.details or "").lower():
                raise ProviderError(
                    "That Groq speech model is unavailable for this key. Refresh models in Settings.",
                    details=exc.details,
                ) from exc
            raise

        words_payload = payload.get("words") or []
        words: list[Word] = []
        for item in words_payload:
            token = str(item.get("word") or item.get("text") or "").strip()
            if not token:
                continue
            start = float(item.get("start") or 0.0)
            end = float(item.get("end") or start)
            words.append(Word(start=max(0.0, start), end=max(start, end), word=token))

        if words:
            segments = group_words(words)
            duration = float(payload.get("duration") or (words[-1].end if words else 0.0))
        else:
            segments = []
            for item in payload.get("segments") or []:
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                segments.append(
                    Segment(
                        start=float(item.get("start") or 0.0),
                        end=float(item.get("end") or 0.0),
                        text=text,
                    )
                )
            synthesize_words(segments)
            duration = float(payload.get("duration") or (segments[-1].end if segments else 0.0))

        if not segments:
            text = str(payload.get("text") or "").strip()
            if not text:
                raise ProviderError("Groq returned an empty transcript. The audio may contain no speech.")
            duration = duration or (duration_hint or 0.0)
            segments = [Segment(start=0.0, end=max(0.1, duration), text=text)]
            synthesize_words(segments)

        transcript = TranscriptData(
            language=payload.get("language"),
            duration=max(duration, duration_hint or 0.0),
            provider="groq",
            model=self.model,
            segments=segments,
        )
        transcript.rebuild_text()
        return transcript

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30,
                retries=1,
            )
            models = [m.get("id", "") for m in payload.get("data", []) if m.get("id")]
            return ProviderTestResult(
                ok=True,
                message="Connected to Groq.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models[:200],
            )
        except (ProviderAuthError, ProviderError) as exc:
            return ProviderTestResult(ok=False, message=exc.message)

    def list_models(self) -> list[str]:
        result = self.test()
        if result.ok and result.models:
            whisper = [m for m in result.models if "whisper" in m]
            return whisper or list(GROQ_SPEECH_MODELS)
        return list(GROQ_SPEECH_MODELS)


class GroqLLMProvider(LLMProvider):
    info = LLM_INFO
    base_url = GROQ_BASE

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.api_key = api_key
        self.model = model or "llama-3.3-70b-versatile"

    def complete_json(
        self,
        *,
        system: str,
        user: str,
        cancel_event: threading.Event | None = None,
        max_tokens: int = 4096,
    ) -> str:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.35,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        try:
            payload = request_json(
                "POST",
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json_body=body,
                timeout=300,
                retries=3,
                cancel_event=cancel_event,
            )
        except ProviderError as exc:
            if "response_format" in (exc.details or "").lower():
                body.pop("response_format", None)
                payload = request_json(
                    "POST",
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json_body=body,
                    timeout=300,
                    retries=3,
                    cancel_event=cancel_event,
                )
            else:
                raise
        choices = payload.get("choices") or []
        if not choices:
            raise ProviderError("Groq returned no response.")
        message = choices[0].get("message") or {}
        content = message.get("content")
        if not content:
            raise ProviderError("Groq returned an empty response. Try another model.")
        return content

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30,
                retries=1,
            )
            models = [m.get("id", "") for m in payload.get("data", []) if m.get("id")]
            return ProviderTestResult(
                ok=True,
                message="Connected to Groq.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models[:200],
            )
        except (ProviderAuthError, ProviderError) as exc:
            return ProviderTestResult(ok=False, message=exc.message)

    def list_models(self) -> list[str]:
        result = self.test()
        if result.ok and result.models:
            chat = [m for m in result.models if "whisper" not in m and "tts" not in m]
            return chat or list(GROQ_LLM_MODELS)
        return list(GROQ_LLM_MODELS)
