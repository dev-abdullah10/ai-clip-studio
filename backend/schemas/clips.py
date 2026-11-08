"""Clip, subtitle, render and analysis schemas."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator, model_validator

ASPECT_RATIOS = ("9:16", "16:9", "1:1", "4:5", "original")
CROP_MODES = (
    "center",
    "face",
    "manual",
    "original",
    "smart",
    "motion",
    "speaker",
    "gameplay",
    "screen",
    "fit",
)

HEX_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")

DISCOVERY_MODES: dict[str, dict[str, str]] = {
    "best": {
        "label": "Best Overall Moments",
        "instruction": "Find the strongest, most shareable standalone moments overall.",
    },
    "interesting": {
        "label": "Most Interesting Moments",
        "instruction": "Find moments with surprising facts, unusual ideas, or genuinely interesting information.",
    },
    "educational": {
        "label": "Educational Moments",
        "instruction": "Find clear explanations, lessons, tutorials, or insights that teach something useful.",
    },
    "funny": {
        "label": "Funny Moments",
        "instruction": "Find the funniest, most entertaining moments: jokes, banter, punchlines, and comedic stories.",
    },
    "surprising": {
        "label": "Surprising Moments",
        "instruction": "Find moments with unexpected reveals, counter-intuitive claims, or shocking information.",
    },
    "motivational": {
        "label": "Motivational Moments",
        "instruction": "Find inspiring, motivating moments with strong emotional payoff and actionable advice.",
    },
    "important": {
        "label": "Important Information",
        "instruction": "Find the most important factual information, warnings, or key takeaways.",
    },
    "podcast": {
        "label": "Podcast Highlights",
        "instruction": "Find compelling podcast highlights: strong stories, hot takes, debates, and memorable exchanges.",
    },
    "interview": {
        "label": "Interview Highlights",
        "instruction": "Find the best interview answers: revealing, quotable, and self-contained responses.",
    },
    "gaming": {
        "label": "Gaming Highlights",
        "instruction": "Find exciting gameplay moments: clutch plays, funny reactions, and high-energy highlights.",
    },
    "storytelling": {
        "label": "Storytelling Moments",
        "instruction": "Find complete, self-contained stories with a setup, conflict, and payoff.",
    },
    "qa": {
        "label": "Question & Answer Highlights",
        "instruction": "Find complete question-and-answer exchanges where a question is asked and answered clearly.",
    },
    "custom": {
        "label": "Custom AI Instructions",
        "instruction": "Follow the user's custom instructions precisely.",
    },
}


class AnalysisSettings(BaseModel):
    discovery_mode: str = "best"
    custom_instructions: str = ""
    clip_count: int = Field(default=5, ge=1, le=50)
    min_duration: float = Field(default=20.0, ge=5.0, le=300.0)
    max_duration: float = Field(default=60.0, ge=10.0, le=600.0)
    speech_provider: str = "gemini"
    speech_model: str | None = None
    llm_provider: str = "gemini"
    llm_model: str | None = None
    language: str = "auto"
    visual_analysis: bool = False
    use_faces: bool = True
    allow_llm_fallback: bool = True
    scoring_weights: dict[str, float] = Field(
        default_factory=lambda: {
            "interesting": 0.20,
            "hook": 0.20,
            "standalone": 0.20,
            "value": 0.15,
            "emotion": 0.10,
            "payoff": 0.10,
            "clarity": 0.05,
        }
    )

    @model_validator(mode="after")
    def _check(self) -> "AnalysisSettings":
        if self.max_duration <= self.min_duration:
            raise ValueError("Maximum clip duration must be greater than minimum duration")
        if self.discovery_mode not in DISCOVERY_MODES:
            self.discovery_mode = "best"
        self.custom_instructions = (self.custom_instructions or "").strip()[:4000]
        # Normalize weights to 1.0 when the user supplies custom values.
        total = sum(max(0.0, float(v)) for v in self.scoring_weights.values())
        if total > 0:
            self.scoring_weights = {
                k: max(0.0, float(v)) / total for k, v in self.scoring_weights.items()
            }
        return self


class SubtitleSettings(BaseModel):
    preset: str = "bold_creator"
    font_family: str = "Arial"
    font_size: int = Field(default=64, ge=16, le=200)
    font_weight: str = "bold"
    primary_color: str = "#FFFFFF"
    highlight_color: str = "#FFD400"
    outline_color: str = "#000000"
    outline_width: float = Field(default=3.0, ge=0, le=12)
    shadow: float = Field(default=2.0, ge=0, le=12)
    background_color: str = "#000000"
    background_opacity: float = Field(default=0.0, ge=0, le=1)
    position: str = "bottom"
    alignment: str = "center"
    margin_v: int = Field(default=100, ge=0, le=700)
    margin_h: int = Field(default=60, ge=0, le=400)
    uppercase: bool = False
    highlight_words: bool = True
    max_words_per_line: int = Field(default=5, ge=1, le=14)
    max_chars_per_line: int = Field(default=32, ge=8, le=80)
    animation: str = "none"

    @field_validator("primary_color", "highlight_color", "outline_color", "background_color")
    @classmethod
    def _validate_color(cls, value: str) -> str:
        if not HEX_COLOR.match(value):
            raise ValueError("Colors must be #RRGGBB or #RRGGBBAA")
        return value.upper()

    @field_validator("position")
    @classmethod
    def _validate_position(cls, value: str) -> str:
        return value if value in {"bottom", "center", "top"} else "bottom"

    @field_validator("alignment")
    @classmethod
    def _validate_alignment(cls, value: str) -> str:
        return value if value in {"left", "center", "right"} else "center"

    @field_validator("animation")
    @classmethod
    def _validate_animation(cls, value: str) -> str:
        return value if value in {"none", "pop", "fade", "slide"} else "none"


class RenderSettings(BaseModel):
    aspect_ratio: str = "9:16"
    resolution: str = "1080p"
    crop_mode: str = "center"
    crop_offset: float = Field(default=0.5, ge=0.0, le=1.0)
    fps: int = Field(default=30, ge=15, le=60)
    quality: str = "high"
    audio_normalize: bool = True
    fade: bool = False
    subtitles: bool = True
    subtitle_settings: SubtitleSettings = Field(default_factory=SubtitleSettings)
    music_path: str | None = None
    music_volume: float = Field(default=0.15, ge=0.0, le=1.0)
    video_codec: str = "h264"
    reframe_plan: dict | None = None

    @field_validator("aspect_ratio")
    @classmethod
    def _validate_aspect(cls, value: str) -> str:
        return value if value in ASPECT_RATIOS else "9:16"

    @field_validator("crop_mode")
    @classmethod
    def _validate_crop(cls, value: str) -> str:
        return value if value in CROP_MODES else "center"

    @field_validator("quality")
    @classmethod
    def _validate_quality(cls, value: str) -> str:
        return value if value in {"draft", "standard", "high", "max"} else "high"


class ExportSettings(RenderSettings):
    filename_pattern: str = "{project}_Clip_{index:02d}"
    create_zip: bool = True
    output_format: str = "mp4"


class ClipCandidateLLM(BaseModel):
    """Structured output requested from an LLM. Invalid clips are filtered."""

    start: float
    end: float
    title: str = ""
    description: str = ""
    reason: str = ""
    score: float = Field(default=50.0, ge=0, le=100)
    category: str = "general"
    hook: str = ""
    transcript: str = ""

    @model_validator(mode="after")
    def _check(self) -> "ClipCandidateLLM":
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        if self.end - self.start < 2.0:
            raise ValueError("clip is too short")
        self.title = (self.title or "").strip()[:200] or "Untitled moment"
        self.description = (self.description or "").strip()[:2000]
        self.reason = (self.reason or "").strip()[:2000]
        self.hook = (self.hook or "").strip()[:500]
        self.transcript = (self.transcript or "").strip()[:8000]
        self.category = (self.category or "general").strip().lower()[:40] or "general"
        return self


class LLMClipResponse(BaseModel):
    clips: list[ClipCandidateLLM] = Field(default_factory=list)


class ClipUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    start: float | None = None
    end: float | None = None
    aspect_ratio: str | None = None
    crop_mode: str | None = None
    crop_offset: float | None = Field(default=None, ge=0, le=1)
    subtitle_enabled: bool | None = None
    subtitle_settings: SubtitleSettings | None = None
    category: str | None = Field(default=None, max_length=60)
    status: str | None = None

    @field_validator("aspect_ratio")
    @classmethod
    def _aspect(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value not in ASPECT_RATIOS:
            raise ValueError("Unsupported aspect ratio")
        return value

    @field_validator("crop_mode")
    @classmethod
    def _crop(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value not in CROP_MODES:
            raise ValueError("Unsupported crop mode")
        return value


class ReframeAnalyzeRequest(BaseModel):
    mode: str = "auto"
    smoothing: float = Field(default=0.78, ge=0.0, le=0.98)
    sample_fps: float = Field(default=4.0, ge=1.0, le=8.0)
    target_aspect: str | None = None


class ClipRenderRequest(BaseModel):
    aspect_ratio: str = "9:16"
    resolution: str = "1080p"
    crop_mode: str = "center"
    crop_offset: float = Field(default=0.5, ge=0, le=1)
    fps: int = Field(default=30, ge=15, le=60)
    quality: str = "high"
    audio_normalize: bool = True
    fade: bool = False
    subtitles: bool = True
    subtitle_settings: SubtitleSettings = Field(default_factory=SubtitleSettings)
    reframe_plan: dict | None = None


class ExportRequest(BaseModel):
    clip_ids: list[str] = Field(min_length=1, max_length=200)
    settings: ExportSettings = Field(default_factory=ExportSettings)
