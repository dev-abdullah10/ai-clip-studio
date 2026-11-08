"""Application settings persistence (non-secret values live in SQLite)."""

from __future__ import annotations

import json
import logging
import threading

from sqlalchemy.orm import Session

from backend.core.secrets import get_secret_store
from backend.database.models import AppSetting
from backend.database.session import session_scope
from backend.schemas.settings import AppSettingsModel

logger = logging.getLogger(__name__)

SETTINGS_KEY = "app_settings"
_lock = threading.RLock()


def _defaults() -> dict:
    return AppSettingsModel().model_dump()


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def get_app_settings() -> AppSettingsModel:
    with _lock:
        try:
            with session_scope() as session:
                row = session.get(AppSetting, SETTINGS_KEY)
                stored = json.loads(row.value_json) if row and row.value_json else {}
        except Exception:
            logger.exception("Could not read app settings; using defaults")
            stored = {}
    merged = _deep_merge(_defaults(), stored if isinstance(stored, dict) else {})
    try:
        return AppSettingsModel(**merged)
    except Exception:
        logger.warning("Stored settings were invalid; resetting to defaults")
        return AppSettingsModel()


def save_app_settings(payload: dict | AppSettingsModel) -> AppSettingsModel:
    model = payload if isinstance(payload, AppSettingsModel) else AppSettingsModel(**payload)
    with _lock:
        with session_scope() as session:
            row = session.get(AppSetting, SETTINGS_KEY)
            if row is None:
                row = AppSetting(key=SETTINGS_KEY)
                session.add(row)
            row.value_json = json.dumps(model.model_dump(), indent=2)
    return model


def update_app_settings(partial: dict) -> AppSettingsModel:
    current = get_app_settings().model_dump()
    merged = _deep_merge(current, partial or {})
    return save_app_settings(AppSettingsModel(**merged))


def resolve_speech_config() -> tuple[str, str]:
    providers = get_app_settings().providers
    provider = providers.speech_provider
    model_map = {
        "gemini": providers.gemini_speech_model,
        "groq": providers.groq_speech_model,
        "local_whisper": providers.local_whisper_model,
        "openai_compatible": providers.openai_compatible_speech_model,
    }
    return provider, model_map.get(provider, "")


def resolve_llm_config() -> tuple[str, str]:
    providers = get_app_settings().providers
    provider = providers.llm_provider
    model_map = {
        "gemini": providers.gemini_llm_model,
        "groq": providers.groq_llm_model,
        "ollama": providers.ollama_model,
        "openai_compatible": providers.openai_compatible_llm_model,
        "local": "",
    }
    return provider, model_map.get(provider, "")


def provider_statuses() -> list[dict]:
    """Configuration status for the dashboard (no network calls, no secrets)."""
    settings = get_app_settings()
    providers = settings.providers
    secrets = get_secret_store()
    has_gemini = secrets.has("gemini")
    has_groq = secrets.has("groq")
    has_openai = secrets.has("openai_compatible")

    from backend.providers.speech.local_whisper import local_whisper_available

    def entry(
        pid: str,
        kind: str,
        name: str,
        active: bool,
        configured: bool,
        model: str,
        note: str,
    ) -> dict:
        return {
            "id": pid,
            "kind": kind,
            "name": name,
            "active": active,
            "configured": configured,
            "model": model,
            "note": note,
        }

    return [
        entry(
            "gemini",
            "speech",
            "Google Gemini Transcribe",
            providers.speech_provider == "gemini",
            has_gemini,
            providers.gemini_speech_model,
            "Free tier · cloud",
        ),
        entry(
            "groq",
            "speech",
            "Groq Whisper",
            providers.speech_provider == "groq",
            has_groq,
            providers.groq_speech_model,
            "Free tier · 25 MB/request",
        ),
        entry(
            "local_whisper",
            "speech",
            "Local Whisper",
            providers.speech_provider == "local_whisper",
            local_whisper_available(),
            providers.local_whisper_model,
            "Local · optional install",
        ),
        entry(
            "openai_compatible",
            "speech",
            "OpenAI-compatible speech",
            providers.speech_provider == "openai_compatible",
            bool(providers.openai_compatible_base_url),
            providers.openai_compatible_speech_model,
            "Self-hosted · local",
        ),
        entry(
            "gemini",
            "llm",
            "Google Gemini Flash",
            providers.llm_provider == "gemini",
            has_gemini,
            providers.gemini_llm_model,
            "Free tier · cloud",
        ),
        entry(
            "groq",
            "llm",
            "Groq LLM",
            providers.llm_provider == "groq",
            has_groq,
            providers.groq_llm_model,
            "Free tier · rate limited",
        ),
        entry(
            "ollama",
            "llm",
            "Ollama (local)",
            providers.llm_provider == "ollama",
            True,
            providers.ollama_model,
            "Local · no key",
        ),
        entry(
            "local",
            "llm",
            "Built-in transcript heuristics",
            providers.llm_provider == "local",
            True,
            "",
            "Offline · no AI required",
        ),
    ]
