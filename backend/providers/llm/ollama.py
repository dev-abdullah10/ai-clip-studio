"""Local Ollama provider (no API key, runs on your machine)."""

from __future__ import annotations

import threading
import time

from backend.core.exceptions import ProviderError, ProviderUnavailableError
from backend.providers.base import LLMProvider, ProviderInfo, ProviderTestResult, request_json

OLLAMA_MODELS = ["llama3.2", "llama3.1", "qwen2.5", "mistral", "gemma3"]

INFO = ProviderInfo(
    id="ollama",
    name="Ollama (local)",
    kind="llm",
    description=(
        "Runs a local LLM through Ollama. No API key, no cloud requests, completely free. "
        "Requires Ollama to be installed and running."
    ),
    requires_key=False,
    free_tier="Free — uses your own hardware.",
    default_model="llama3.2",
    models=OLLAMA_MODELS,
    docs_url="https://ollama.com",
    capabilities={"json_mode": True, "local": True},
)


class OllamaLLMProvider(LLMProvider):
    info = INFO

    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "llama3.2"):
        self.base_url = (base_url or "http://127.0.0.1:11434").rstrip("/")
        self.model = model or "llama3.2"

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
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.35, "num_predict": max_tokens},
        }
        try:
            payload = request_json(
                "POST",
                f"{self.base_url}/api/chat",
                json_body=body,
                timeout=600,
                retries=1,
                cancel_event=cancel_event,
            )
        except ProviderUnavailableError as exc:
            raise ProviderUnavailableError(
                "Could not reach Ollama. Make sure Ollama is running, then check the base URL in Settings.",
                details=exc.details,
            ) from exc
        if payload.get("error"):
            raise ProviderError(f"Ollama error: {payload['error']}")
        content = (payload.get("message") or {}).get("content", "")
        if not content.strip():
            raise ProviderError("Ollama returned an empty response. Try a different local model.")
        return content

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET", f"{self.base_url}/api/tags", timeout=12, retries=1
            )
            models = [m.get("name", "") for m in payload.get("models", []) if m.get("name")]
            if not models:
                return ProviderTestResult(
                    ok=False,
                    message="Ollama is running but has no models installed. Run `ollama pull llama3.2`.",
                    models=[],
                )
            return ProviderTestResult(
                ok=True,
                message="Connected to local Ollama.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models,
            )
        except Exception as exc:  # ProviderUnavailableError and network errors
            return ProviderTestResult(
                ok=False,
                message=f"Could not reach Ollama at {self.base_url}. Is it running?",
            )

    def list_models(self) -> list[str]:
        result = self.test()
        return result.models or list(OLLAMA_MODELS)
