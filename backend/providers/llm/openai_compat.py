"""Generic OpenAI-compatible providers (LM Studio, LocalAI, self-hosted servers, etc.)."""

from __future__ import annotations

import threading
import time
from pathlib import Path

from backend.core.exceptions import ProviderError
from backend.providers.base import (
    LLMProvider,
    ProviderInfo,
    ProviderTestResult,
    request_json,
)
from backend.providers.speech.common import group_words, synthesize_words
from backend.providers.speech.groq import GroqLLMProvider, GroqSpeechProvider
from backend.schemas.transcript import Segment, TranscriptData, Word

SPEECH_INFO = ProviderInfo(
    id="openai_compatible",
    name="OpenAI-compatible server",
    kind="speech",
    description=(
        "Connect any server that implements the OpenAI audio transcription endpoint "
        "(for example a self-hosted Whisper server on localhost). No paid service is required."
    ),
    requires_key=False,
    free_tier="Depends on your own server. Nothing is sent to a third party when the server is local.",
    default_model="whisper-1",
    models=["whisper-1"],
    docs_url="https://platform.openai.com/docs/api-reference/audio",
    capabilities={"word_timestamps": True, "cloud": False, "custom_base_url": True},
)

LLM_INFO = ProviderInfo(
    id="openai_compatible",
    name="OpenAI-compatible server",
    kind="llm",
    description=(
        "Connect any OpenAI-compatible chat completions server, such as LM Studio, LocalAI, "
        "vLLM, or a self-hosted gateway."
    ),
    requires_key=False,
    free_tier="Depends on your own server.",
    default_model="",
    models=[],
    docs_url="https://platform.openai.com/docs/api-reference/chat",
    capabilities={"json_mode": True, "cloud": False, "custom_base_url": True},
)


class OpenAICompatibleSpeechProvider(GroqSpeechProvider):
    info = SPEECH_INFO

    def __init__(self, api_key: str, model: str, base_url: str):
        super().__init__(api_key or "local", model or "whisper-1")
        self.base_url = (base_url or "").rstrip("/")
        if not self.base_url:
            raise ProviderError("Set the OpenAI-compatible base URL in Settings first.")
        if not self.base_url.startswith(("http://", "https://")):
            raise ProviderError("The OpenAI-compatible base URL must start with http:// or https://")

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else None,
                timeout=20,
                retries=1,
            )
            models = [m.get("id", "") for m in payload.get("data", []) if m.get("id")]
            return ProviderTestResult(
                ok=True,
                message="Connected to the OpenAI-compatible server.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models,
            )
        except Exception as exc:
            return ProviderTestResult(
                ok=False, message=f"Could not connect to {self.base_url}: {exc}"
            )


class OpenAICompatibleLLMProvider(GroqLLMProvider):
    info = LLM_INFO

    def __init__(self, api_key: str, model: str, base_url: str):
        super().__init__(api_key or "local", model)
        self.base_url = (base_url or "").rstrip("/")
        if not self.base_url:
            raise ProviderError("Set the OpenAI-compatible base URL in Settings first.")
        if not self.base_url.startswith(("http://", "https://")):
            raise ProviderError("The OpenAI-compatible base URL must start with http:// or https://")

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{self.base_url}/models",
                headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else None,
                timeout=20,
                retries=1,
            )
            models = [m.get("id", "") for m in payload.get("data", []) if m.get("id")]
            return ProviderTestResult(
                ok=True,
                message="Connected to the OpenAI-compatible server.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models,
            )
        except Exception as exc:
            return ProviderTestResult(
                ok=False, message=f"Could not connect to {self.base_url}: {exc}"
            )
