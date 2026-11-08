"""Request schemas for the HTTP API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from backend.schemas.clips import AnalysisSettings, ExportSettings, RenderSettings


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def _clean(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Project name cannot be empty")
        return value


class UrlImportRequest(BaseModel):
    url: str = Field(min_length=8, max_length=4000)
    name: str | None = Field(default=None, max_length=200)

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = value.strip()
        if not value.lower().startswith(("http://", "https://")):
            raise ValueError("Only direct http:// or https:// video URLs are supported")
        return value


class ProcessRequest(BaseModel):
    analysis: AnalysisSettings = Field(default_factory=AnalysisSettings)
    reuse_transcript: bool = True
    force_transcribe: bool = False


class AnalyzeRequest(BaseModel):
    analysis: AnalysisSettings = Field(default_factory=AnalysisSettings)
    replace: bool = True


class RenderClipRequest(BaseModel):
    settings: RenderSettings = Field(default_factory=RenderSettings)


class ExportJobRequest(BaseModel):
    clip_ids: list[str] = Field(min_length=1, max_length=200)
    settings: ExportSettings = Field(default_factory=ExportSettings)
    use_clip_subtitles: bool = True


class TranscriptImportRequest(BaseModel):
    text: str = Field(min_length=1, max_length=20_000_000)
    language: str | None = Field(default=None, max_length=20)


class ProviderTestRequest(BaseModel):
    provider_id: str = Field(min_length=1, max_length=60)
    kind: str = Field(pattern="^(speech|llm|vision)$")


class OpenPathRequest(BaseModel):
    target: str = Field(default="storage", max_length=40)
