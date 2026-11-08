"""Global application settings schemas."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from backend.schemas.clips import ASPECT_RATIOS, SubtitleSettings
from backend.schemas.subtitle_presets import preset_values


class VideoDefaults(BaseModel):
    aspect_ratio: str = "9:16"
    resolution: str = "1080p"
    fps: int = Field(default=30, ge=15, le=60)
    quality: str = "high"
    clip_count: int = Field(default=5, ge=1, le=50)
    min_duration: float = Field(default=20.0, ge=5.0, le=300.0)
    max_duration: float = Field(default=60.0, ge=10.0, le=600.0)

    @field_validator("aspect_ratio")
    @classmethod
    def _aspect(cls, value: str) -> str:
        return value if value in ASPECT_RATIOS else "9:16"


class PerformanceSettings(BaseModel):
    max_concurrent_jobs: int = Field(default=1, ge=1, le=4)
    prefer_gpu_encoding: bool = False
    ffmpeg_threads: int = Field(default=0, ge=0, le=64)


class ProviderSettings(BaseModel):
    speech_provider: str = "gemini"
    llm_provider: str = "gemini"

    gemini_speech_model: str = "gemini-3.5-transcribe"
    gemini_llm_model: str = "gemini-3.8-flash"

    groq_speech_model: str = "whisper-large-v3-turbo"
    groq_llm_model: str = "llama-3.3-70b-versatile"

    local_whisper_model: str = "small"
    local_whisper_device: str = "auto"
    local_whisper_compute_type: str = "int8"

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "llama3.2"

    openai_compatible_base_url: str = ""
    openai_compatible_speech_model: str = "whisper-1"
    openai_compatible_llm_model: str = ""

    visual_provider: str = "local"
    gemini_vision_model: str = "gemini-3.8-flash"

    @field_validator("speech_provider")
    @classmethod
    def _speech(cls, value: str) -> str:
        return value if value in {"gemini", "groq", "local_whisper", "openai_compatible"} else "gemini"

    @field_validator("llm_provider")
    @classmethod
    def _llm(cls, value: str) -> str:
        allowed = {"gemini", "groq", "ollama", "openai_compatible", "local"}
        return value if value in allowed else "gemini"


class AppSettingsModel(BaseModel):
    theme: str = "dark"
    language: str = "en"
    startup_behavior: str = "browser"
    default_export_dir: str = ""
    visual_analysis_default: bool = False
    video: VideoDefaults = Field(default_factory=VideoDefaults)
    subtitles: SubtitleSettings = Field(
        default_factory=lambda: SubtitleSettings(**preset_values("bold_creator"))
    )
    performance: PerformanceSettings = Field(default_factory=PerformanceSettings)
    providers: ProviderSettings = Field(default_factory=ProviderSettings)


class SecretUpdate(BaseModel):
    api_key: str = Field(default="", max_length=500)


class ProviderSelectionUpdate(BaseModel):
    speech_provider: str | None = None
    llm_provider: str | None = None
