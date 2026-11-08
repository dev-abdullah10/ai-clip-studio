"""Provider interfaces and shared HTTP helpers."""

from __future__ import annotations

import json
import logging
import random
import threading
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from backend.core.exceptions import (
    JobCancelled,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderUnavailableError,
)
from backend.schemas.transcript import TranscriptData

logger = logging.getLogger(__name__)


@dataclass
class ProviderTestResult:
    ok: bool
    message: str
    latency_ms: float | None = None
    models: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderInfo:
    id: str
    name: str
    kind: str  # speech | llm | vision
    description: str
    requires_key: bool
    free_tier: str
    default_model: str
    models: list[str] = field(default_factory=list)
    docs_url: str = ""
    capabilities: dict[str, Any] = field(default_factory=dict)


class SpeechProvider(ABC):
    info: ProviderInfo
    max_chunk_seconds: float = 1200.0

    @abstractmethod
    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        word_timestamps: bool = True,
        duration_hint: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> TranscriptData:
        """Transcribe a single audio file. Timestamps must be relative to that file."""

    @abstractmethod
    def test(self) -> ProviderTestResult:
        ...

    def list_models(self) -> list[str]:
        return list(self.info.models)


class LLMProvider(ABC):
    info: ProviderInfo

    @abstractmethod
    def complete_json(
        self,
        *,
        system: str,
        user: str,
        cancel_event: threading.Event | None = None,
        max_tokens: int = 4096,
    ) -> str:
        """Return the raw model response (expected to contain JSON)."""

    @abstractmethod
    def test(self) -> ProviderTestResult:
        ...

    def list_models(self) -> list[str]:
        return list(self.info.models)


class VisionProvider(ABC):
    info: ProviderInfo

    @abstractmethod
    def describe_frames(self, frames: list[Path], *, cancel_event: threading.Event | None = None) -> str:
        ...

    @abstractmethod
    def test(self) -> ProviderTestResult:
        ...


def sleep_cancellable(seconds: float, cancel_event: threading.Event | None) -> None:
    end = time.monotonic() + max(0.0, seconds)
    while time.monotonic() < end:
        if cancel_event is not None and cancel_event.is_set():
            raise JobCancelled("Job cancelled")
        time.sleep(min(0.2, max(0.0, end - time.monotonic())))


def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
    content: bytes | None = None,
    timeout: float = 120.0,
    retries: int = 3,
    cancel_event: threading.Event | None = None,
) -> dict:
    """Perform an HTTP request with uniform, safe error mapping and retries."""
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        if cancel_event is not None and cancel_event.is_set():
            raise JobCancelled("Job cancelled")
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout, connect=min(30.0, timeout))) as client:
                response = client.request(
                    method,
                    url,
                    headers=headers,
                    json=json_body,
                    data=data,
                    files=files,
                    content=content,
                )
            if response.status_code in (200, 201, 202):
                if not response.content:
                    return {}
                try:
                    return response.json()
                except json.JSONDecodeError:
                    return {"text": response.text}
            body = response.text[:1500]
            if response.status_code in (401, 403):
                raise ProviderAuthError(
                    "The provider rejected the API key or the request is not authorized. Check the key and model access."
                )
            if response.status_code == 429:
                retry_after = _parse_retry_after(response.headers.get("retry-after"))
                if attempt < retries:
                    sleep_cancellable(
                        retry_after or min(30.0, 2.0 * (attempt + 1) + random.random()),
                        cancel_event,
                    )
                    continue
                raise ProviderRateLimitError(
                    "The provider rate limit was reached. Wait a moment, reduce clip count, or switch providers."
                )
            if response.status_code in (404, 400) and "model" in body.lower():
                raise ProviderError(
                    "The selected model is unavailable for this provider/key. Refresh the model list in Settings and try again.",
                    details=body,
                )
            if response.status_code in (500, 502, 503, 504) or response.status_code >= 500:
                if attempt < retries:
                    sleep_cancellable(min(30.0, 2.0**attempt + random.random()), cancel_event)
                    last_error = ProviderUnavailableError("The AI provider is temporarily unavailable.")
                    continue
                raise ProviderUnavailableError(
                    "The AI provider is temporarily unavailable. Check your connection and try again.",
                    details=body,
                )
            raise ProviderError(
                f"The provider returned an unexpected response (HTTP {response.status_code}).",
                details=body,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_error = exc
            if attempt < retries:
                sleep_cancellable(min(20.0, 2.0**attempt + random.random()), cancel_event)
                continue
            raise ProviderUnavailableError(
                "Could not reach the AI provider. Check your internet connection, or use a local provider."
            ) from exc
    if isinstance(last_error, ProviderError):
        raise last_error
    raise ProviderUnavailableError("The AI provider request failed after several attempts.")


def _parse_retry_after(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def make_multipart_file(path: Path, mime: str = "audio/mpeg") -> dict:
    """Build an httpx files payload without reading the file into RAM twice."""
    handle = path.open("rb")
    return {"file": (path.name, handle, mime)}


def parse_time_offset(value: Any) -> float:
    """Parse provider timestamp formats: 1.25, '1.25s', '1250ms'."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return max(0.0, float(value))
    text = str(value).strip().lower()
    if not text:
        return 0.0
    try:
        if text.endswith("ms"):
            return max(0.0, float(text[:-2]) / 1000.0)
        if text.endswith("s"):
            return max(0.0, float(text[:-1]))
        if ":" in text:
            parts = [float(p) for p in text.split(":")]
            seconds = 0.0
            for part in parts:
                seconds = seconds * 60 + part
            return seconds
        return max(0.0, float(text))
    except ValueError:
        return 0.0
