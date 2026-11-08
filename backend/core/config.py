"""Application configuration and filesystem layout."""

from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BUNDLED_FFMPEG_DIR = PROJECT_ROOT / "tools" / "ffmpeg" / "bin"


def _default_storage_dir() -> Path:
    env = os.environ.get("AICS_STORAGE_DIR")
    if env:
        return Path(env)
    return PROJECT_ROOT / "storage"


def _resolve_tool(name: str, configured: str | None) -> str:
    """Resolve an executable without ever invoking a shell.

    Order: explicit configuration, bundled tools, user-level tools, PATH.
    Returns the configured/name value if nothing is found so the error surfaces
    with an actionable message at runtime.
    """
    exe = f"{name}.exe" if os.name == "nt" else name
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(BUNDLED_FFMPEG_DIR / exe)
    for candidate in candidates:
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            continue
    found = shutil.which(name)
    if found:
        return found
    return configured or name


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_prefix="AICS_",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "AI Clip Studio"
    host: str = "127.0.0.1"
    port: int = 8765
    storage_dir: Path = Field(default_factory=_default_storage_dir)
    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_upload_mb: int = Field(default=8192, gt=0)
    max_url_download_mb: int = Field(default=4096, gt=0)
    max_concurrent_jobs: int = Field(default=1, ge=1, le=4)
    ffmpeg_path: str | None = None
    ffprobe_path: str | None = None
    log_level: str = "INFO"
    request_timeout_seconds: float = Field(default=120.0, gt=0)

    # Optional environment-level API keys. The UI stores keys securely instead;
    # environment values are supported for advanced/automated setups.
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    openai_compatible_api_key: str | None = None
    openai_compatible_base_url: str | None = None

    # Hardware / performance preferences
    prefer_gpu_encoding: bool = False
    ffmpeg_threads: int = 0  # 0 = let FFmpeg decide
    temp_retention_days: int = 7

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def database_path(self) -> Path:
        return self.storage_dir / "db" / "app.db"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path.as_posix()}"

    @property
    def ffmpeg(self) -> str:
        return _resolve_tool("ffmpeg", self.ffmpeg_path)

    @property
    def ffprobe(self) -> str:
        return _resolve_tool("ffprobe", self.ffprobe_path)

    def ensure_directories(self) -> None:
        for name in (
            "db",
            "config",
            "logs",
            "uploads",
            "audio",
            "transcripts",
            "thumbnails",
            "clips",
            "exports",
            "temp",
            "fonts",
        ):
            (self.storage_dir / name).mkdir(parents=True, exist_ok=True)


class StorageLayout:
    """Convenience accessors for the local storage tree."""

    def __init__(self, root: Path):
        self.root = root

    def _p(self, *parts: str) -> Path:
        path = self.root.joinpath(*parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def project_dir(self, project_id: str) -> Path:
        path = self.root / "uploads" / project_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def source_path(self, project_id: str, suffix: str) -> Path:
        return self.project_dir(project_id) / f"source{suffix}"

    def audio_dir(self, project_id: str) -> Path:
        path = self.root / "audio" / project_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def transcript_path(self, project_id: str) -> Path:
        return self.root / "transcripts" / f"{project_id}.json"

    def project_thumbnail(self, project_id: str) -> Path:
        return self.root / "thumbnails" / f"{project_id}.jpg"

    def clip_thumbnail(self, clip_id: str) -> Path:
        return self.root / "thumbnails" / f"clip_{clip_id}.jpg"

    def clip_path(self, clip_id: str) -> Path:
        return self.root / "clips" / f"{clip_id}.mp4"

    def export_dir(self, project_id: str) -> Path:
        path = self.root / "exports" / project_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def temp_dir(self, job_id: str) -> Path:
        path = self.root / "temp" / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def fonts_dir(self) -> Path:
        path = self.root / "fonts"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def secrets_path(self) -> Path:
        path = self.root / "config" / "secrets.dat"
        path.parent.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings


def get_storage() -> StorageLayout:
    return StorageLayout(get_settings().storage_dir)
