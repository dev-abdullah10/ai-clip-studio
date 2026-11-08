"""Settings, provider configuration and API key endpoints."""

from __future__ import annotations

import dataclasses
import logging
from pathlib import Path

from fastapi import APIRouter, Body, Query
from pydantic import ValidationError as PydanticValidationError

from backend.core.config import get_settings, get_storage
from backend.core.exceptions import NotFoundError, ValidationError
from backend.core.secrets import get_secret_store
from backend.schemas.api import ProviderTestRequest
from backend.schemas.settings import AppSettingsModel, SecretUpdate
from backend.schemas.subtitle_presets import SUBTITLE_PRESETS
from backend.services.provider_registry import (
    list_provider_models,
    provider_catalog,
    test_provider,
)
from backend.services.settings_service import (
    get_app_settings,
    provider_statuses,
    update_app_settings,
)
from backend.services.subtitles.service import FONT_CANDIDATES
from backend.utils.ffmpeg import inspect_tools

logger = logging.getLogger(__name__)
router = APIRouter(tags=["settings"])

SECRET_PROVIDERS = {"gemini", "groq", "openai_compatible"}


def _fonts() -> list[dict]:
    windows_fonts = Path("C:/Windows/Fonts")
    output = []
    for family, files in FONT_CANDIDATES.items():
        available = any((windows_fonts / name).is_file() for name in files)
        output.append({"name": family, "available": available, "files": files})
    return output


@router.get("/settings")
def read_settings() -> dict:
    app_settings = get_app_settings()
    secrets = get_secret_store()
    tools = inspect_tools()
    return {
        "settings": app_settings.model_dump(),
        "providers": provider_catalog(),
        "statuses": provider_statuses(),
        "secrets": {
            "gemini": secrets.has("gemini"),
            "groq": secrets.has("groq"),
            "openai_compatible": secrets.has("openai_compatible"),
        },
        "subtitle_presets": SUBTITLE_PRESETS,
        "fonts": _fonts(),
        "tools": {
            "ffmpeg_available": tools["ffmpeg"].available,
            "ffmpeg_version": tools["ffmpeg"].version,
            "ass": tools["ffmpeg"].has_ass,
            "nvenc": tools["ffmpeg"].has_nvenc,
            "ffprobe_available": tools["ffprobe"].available,
        },
        "limits": {
            "max_upload_mb": get_settings().max_upload_mb,
            "max_url_download_mb": get_settings().max_url_download_mb,
        },
    }


@router.patch("/settings")
def patch_settings(payload: dict = Body(...)) -> dict:
    try:
        model = AppSettingsModel(**payload) if not _is_partial(payload) else None
    except PydanticValidationError as exc:
        raise ValidationError(_validation_message(exc)) from exc
    try:
        if model is not None:
            from backend.services.settings_service import save_app_settings

            updated = save_app_settings(model)
        else:
            updated = update_app_settings(payload)
    except PydanticValidationError as exc:
        raise ValidationError(_validation_message(exc)) from exc
    return {
        "settings": updated.model_dump(),
        "statuses": provider_statuses(),
    }


def _is_partial(payload: dict) -> bool:
    # Full documents include every top-level section; partial patches do not.
    required = {"video", "subtitles", "performance", "providers"}
    return not required.issubset(payload.keys())


def _validation_message(exc: PydanticValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "The settings could not be validated."
    first = errors[0]
    location = " → ".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "Invalid value")
    return f"{location}: {message}" if location else message


@router.get("/settings/providers")
def read_providers() -> dict:
    return {"catalog": provider_catalog(), "statuses": provider_statuses()}


@router.post("/settings/providers/test")
def test_provider_endpoint(payload: ProviderTestRequest) -> dict:
    result = test_provider(payload.provider_id, payload.kind)
    return dataclasses.asdict(result)


@router.get("/settings/providers/{provider_id}/models")
def provider_models(provider_id: str, kind: str = Query(default="llm")) -> dict:
    if kind not in {"speech", "llm", "vision"}:
        raise ValidationError("Provider kind must be speech, llm or vision.")
    models = list_provider_models(provider_id, kind)
    return {"provider_id": provider_id, "kind": kind, "models": models}


@router.put("/settings/secrets/{provider_id}")
def set_secret(provider_id: str, payload: SecretUpdate) -> dict:
    if provider_id not in SECRET_PROVIDERS:
        raise NotFoundError("Unknown provider for API keys.")
    store = get_secret_store()
    value = (payload.api_key or "").strip()
    if len(value) > 500:
        raise ValidationError("That API key is too long.")
    if value:
        store.set(provider_id, value)
    else:
        store.delete(provider_id)
    return {
        "provider_id": provider_id,
        "has_key": store.has(provider_id),
        "statuses": provider_statuses(),
    }


@router.delete("/settings/secrets/{provider_id}")
def delete_secret(provider_id: str) -> dict:
    if provider_id not in SECRET_PROVIDERS:
        raise NotFoundError("Unknown provider for API keys.")
    store = get_secret_store()
    store.delete(provider_id)
    return {"provider_id": provider_id, "has_key": False, "statuses": provider_statuses()}


@router.get("/settings/fonts")
def list_fonts() -> dict:
    return {"fonts": _fonts(), "fonts_dir": str(get_storage().fonts_dir())}


@router.get("/settings/subtitle-presets")
def subtitle_presets() -> dict:
    return {"presets": SUBTITLE_PRESETS}
