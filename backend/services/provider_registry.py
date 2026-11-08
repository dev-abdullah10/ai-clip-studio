"""Provider registry: turns settings + secure secrets into provider instances."""

from __future__ import annotations

import logging

from backend.core.exceptions import ProviderAuthError, ProviderError
from backend.core.secrets import get_secret_store
from backend.providers.base import LLMProvider, ProviderInfo, ProviderTestResult, SpeechProvider
from backend.providers.llm.ollama import INFO as OLLAMA_INFO
from backend.providers.llm.ollama import OllamaLLMProvider
from backend.providers.llm.openai_compat import (
    LLM_INFO as OPENAI_LLM_INFO,
    OpenAICompatibleLLMProvider,
)
from backend.providers.speech.gemini import (
    LLM_INFO as GEMINI_LLM_INFO,
    SPEECH_INFO as GEMINI_SPEECH_INFO,
    VISION_INFO as GEMINI_VISION_INFO,
    GeminiLLMProvider,
    GeminiSpeechProvider,
    GeminiVisionProvider,
)
from backend.providers.speech.groq import (
    LLM_INFO as GROQ_LLM_INFO,
    SPEECH_INFO as GROQ_SPEECH_INFO,
    GroqLLMProvider,
    GroqSpeechProvider,
)
from backend.providers.speech.local_whisper import (
    INFO as LOCAL_WHISPER_INFO,
    LocalWhisperProvider,
)
from backend.services.settings_service import get_app_settings

logger = logging.getLogger(__name__)

SPEECH_INFO_BY_ID = {
    "gemini": GEMINI_SPEECH_INFO,
    "groq": GROQ_SPEECH_INFO,
    "local_whisper": LOCAL_WHISPER_INFO,
    "openai_compatible": {
        **OPENAI_LLM_INFO.__dict__,
        "id": "openai_compatible",
        "name": "OpenAI-compatible speech server",
        "kind": "speech",
        "default_model": "whisper-1",
    },
}
LLM_INFO_BY_ID = {
    "gemini": GEMINI_LLM_INFO,
    "groq": GROQ_LLM_INFO,
    "ollama": OLLAMA_INFO,
    "openai_compatible": OPENAI_LLM_INFO,
}
LOCAL_LLM_INFO = {
    "id": "local",
    "name": "Built-in transcript heuristics",
    "kind": "llm",
    "description": "No AI model. Uses local scoring over the transcript so the app still works offline.",
    "requires_key": False,
    "free_tier": "Free — fully local.",
    "default_model": "",
    "models": [],
    "docs_url": "",
    "capabilities": {"local": True},
}


def _secret(provider_id: str) -> str | None:
    return get_secret_store().get(provider_id)


def get_speech_provider(
    provider_id: str | None = None, model: str | None = None
) -> SpeechProvider:
    settings = get_app_settings()
    providers = settings.providers
    provider_id = provider_id or providers.speech_provider
    if provider_id == "gemini":
        key = _secret("gemini")
        if not key:
            raise ProviderAuthError(
                "No Gemini API key is configured. Add one in Settings → AI Providers, "
                "or choose Local Whisper / another provider."
            )
        return GeminiSpeechProvider(key, model or providers.gemini_speech_model)
    if provider_id == "groq":
        key = _secret("groq")
        if not key:
            raise ProviderAuthError(
                "No Groq API key is configured. Add one in Settings → AI Providers."
            )
        return GroqSpeechProvider(key, model or providers.groq_speech_model)
    if provider_id == "local_whisper":
        return LocalWhisperProvider(
            model or providers.local_whisper_model,
            providers.local_whisper_device,
            providers.local_whisper_compute_type,
        )
    if provider_id == "openai_compatible":
        return OpenAICompatibleSpeechProvider(
            _secret("openai_compatible") or "",
            model or providers.openai_compatible_speech_model,
            providers.openai_compatible_base_url,
        )
    raise ProviderError(f"Unknown speech provider: {provider_id}")


def get_llm_provider(provider_id: str | None = None, model: str | None = None) -> LLMProvider:
    settings = get_app_settings()
    providers = settings.providers
    provider_id = provider_id or providers.llm_provider
    if provider_id == "gemini":
        key = _secret("gemini")
        if not key:
            raise ProviderAuthError(
                "No Gemini API key is configured. Add one in Settings → AI Providers, "
                "or switch to local heuristics / Ollama."
            )
        return GeminiLLMProvider(key, model or providers.gemini_llm_model)
    if provider_id == "groq":
        key = _secret("groq")
        if not key:
            raise ProviderAuthError("No Groq API key is configured. Add one in Settings.")
        return GroqLLMProvider(key, model or providers.groq_llm_model)
    if provider_id == "ollama":
        return OllamaLLMProvider(providers.ollama_base_url, model or providers.ollama_model)
    if provider_id == "openai_compatible":
        return OpenAICompatibleLLMProvider(
            _secret("openai_compatible") or "",
            model or providers.openai_compatible_llm_model,
            providers.openai_compatible_base_url,
        )
    raise ProviderError("The local heuristic analyzer does not use an LLM provider.")


def get_vision_provider():
    settings = get_app_settings()
    providers = settings.providers
    if providers.visual_provider == "gemini":
        key = _secret("gemini")
        if not key:
            raise ProviderAuthError("No Gemini API key is configured for visual analysis.")
        return GeminiVisionProvider(key, providers.gemini_vision_model)
    raise ProviderError("The local vision analyzer is used by default.")


def provider_catalog() -> dict:
    settings = get_app_settings()
    providers = settings.providers
    secrets = get_secret_store()
    from backend.providers.speech.local_whisper import local_whisper_available

    def info_dict(info: ProviderInfo | dict, has_key: bool, configured: bool) -> dict:
        data = info if isinstance(info, dict) else info.__dict__
        return {
            "id": data["id"],
            "name": data["name"],
            "kind": data["kind"],
            "description": data["description"],
            "requires_key": data["requires_key"],
            "free_tier": data["free_tier"],
            "default_model": data["default_model"],
            "models": data.get("models", []),
            "docs_url": data.get("docs_url", ""),
            "capabilities": data.get("capabilities", {}),
            "has_key": has_key,
            "configured": configured,
        }

    speech = [
        info_dict(GEMINI_SPEECH_INFO, secrets.has("gemini"), secrets.has("gemini")),
        info_dict(GROQ_SPEECH_INFO, secrets.has("groq"), secrets.has("groq")),
        info_dict(
            LOCAL_WHISPER_INFO,
            local_whisper_available(),
            local_whisper_available(),
        ),
        info_dict(
            SPEECH_INFO_BY_ID["openai_compatible"],
            secrets.has("openai_compatible"),
            bool(providers.openai_compatible_base_url),
        ),
    ]
    llm = [
        info_dict(GEMINI_LLM_INFO, secrets.has("gemini"), secrets.has("gemini")),
        info_dict(GROQ_LLM_INFO, secrets.has("groq"), secrets.has("groq")),
        info_dict(OLLAMA_INFO, True, True),
        info_dict(LOCAL_LLM_INFO, True, True),
        info_dict(
            OPENAI_LLM_INFO,
            secrets.has("openai_compatible"),
            bool(providers.openai_compatible_base_url),
        ),
    ]
    return {
        "speech": speech,
        "llm": llm,
        "vision": [
            {
                "id": "local",
                "name": "Local OpenCV analysis",
                "kind": "vision",
                "description": "Scene changes and face detection computed locally. No frames leave the device.",
                "requires_key": False,
                "free_tier": "Free — fully local.",
                "default_model": "",
                "models": [],
                "docs_url": "",
                "capabilities": {"local": True},
                "has_key": True,
                "configured": True,
            },
            info_dict(
                GEMINI_VISION_INFO,
                secrets.has("gemini"),
                secrets.has("gemini"),
            ),
        ],
        "active": {
            "speech_provider": providers.speech_provider,
            "llm_provider": providers.llm_provider,
            "visual_provider": providers.visual_provider,
            "speech_model": _active_speech_model(providers),
            "llm_model": _active_llm_model(providers),
        },
    }


def _active_speech_model(providers) -> str:
    return {
        "gemini": providers.gemini_speech_model,
        "groq": providers.groq_speech_model,
        "local_whisper": providers.local_whisper_model,
        "openai_compatible": providers.openai_compatible_speech_model,
    }.get(providers.speech_provider, "")


def _active_llm_model(providers) -> str:
    return {
        "gemini": providers.gemini_llm_model,
        "groq": providers.groq_llm_model,
        "ollama": providers.ollama_model,
        "openai_compatible": providers.openai_compatible_llm_model,
        "local": "",
    }.get(providers.llm_provider, "")


def test_provider(provider_id: str, kind: str) -> ProviderTestResult:
    try:
        if kind == "speech":
            provider = get_speech_provider(provider_id)
            return provider.test()
        if kind == "llm":
            if provider_id == "local":
                return ProviderTestResult(
                    ok=True, message="Built-in local heuristics are always available."
                )
            provider = get_llm_provider(provider_id)
            return provider.test()
        if kind == "vision":
            if provider_id == "local":
                return ProviderTestResult(
                    ok=True, message="Local OpenCV vision analysis is available."
                )
            provider = GeminiVisionProvider(
                _secret("gemini") or "", get_app_settings().providers.gemini_vision_model
            )
            return provider.test()
    except (ProviderAuthError, ProviderError) as exc:
        return ProviderTestResult(ok=False, message=exc.message)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Provider test failed")
        return ProviderTestResult(ok=False, message=f"Provider test failed: {exc}")
    return ProviderTestResult(ok=False, message="Unknown provider type.")


def list_provider_models(provider_id: str, kind: str) -> list[str]:
    try:
        if kind == "speech":
            return get_speech_provider(provider_id).list_models()
        if kind == "llm":
            if provider_id == "local":
                return []
            return get_llm_provider(provider_id).list_models()
        if kind == "vision":
            if provider_id == "gemini":
                result = GeminiLLMProvider(
                    _secret("gemini") or "",
                    get_app_settings().providers.gemini_vision_model,
                ).test()
                return [m for m in result.models if "flash" in m or "pro" in m]
    except (ProviderAuthError, ProviderError):
        return []
    return []
