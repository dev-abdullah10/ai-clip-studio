"""Optional local transcription with faster-whisper (no cloud, no API key)."""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from backend.core.exceptions import ProviderError, ProviderUnavailableError
from backend.providers.base import ProviderInfo, ProviderTestResult, SpeechProvider
from backend.schemas.transcript import Segment, TranscriptData, Word

logger = logging.getLogger(__name__)

LOCAL_MODELS = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"]

INFO = ProviderInfo(
    id="local_whisper",
    name="Local Whisper (faster-whisper)",
    kind="speech",
    description=(
        "Runs OpenAI Whisper locally through faster-whisper. Audio never leaves your computer. "
        "Requires the optional faster-whisper dependency and downloads the model on first use."
    ),
    requires_key=False,
    free_tier="Free — uses your own CPU/GPU. Model download requires internet once.",
    default_model="small",
    models=LOCAL_MODELS,
    docs_url="https://github.com/SYSTRAN/faster-whisper",
    capabilities={
        "word_timestamps": True,
        "diarization": False,
        "language_detection": True,
        "local": True,
    },
)

_MODEL_CACHE: dict[tuple[str, str, str], object] = {}
_CACHE_LOCK = threading.Lock()


class LocalWhisperProvider(SpeechProvider):
    info = INFO
    max_chunk_seconds = 1800.0

    def __init__(
        self,
        model_size: str = "small",
        device: str = "auto",
        compute_type: str = "int8",
    ):
        self.model_size = model_size or "small"
        self.device = device or "auto"
        self.compute_type = compute_type or "int8"

    def _load_model(self):
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except Exception as exc:
            raise ProviderUnavailableError(
                "Local Whisper is not installed. Run: "
                ".\\.venv\\Scripts\\python.exe -m pip install faster-whisper"
            ) from exc

        key = (self.model_size, self.device, self.compute_type)
        with _CACHE_LOCK:
            model = _MODEL_CACHE.get(key)
            if model is None:
                logger.info("Loading local Whisper model %s (%s)", self.model_size, self.device)
                try:
                    model = WhisperModel(
                        self.model_size,
                        device=self.device,
                        compute_type=self.compute_type,
                    )
                except Exception as exc:
                    raise ProviderUnavailableError(
                        "Could not load the local Whisper model. Check your GPU/CPU settings and available disk space.",
                        details=str(exc),
                    ) from exc
                _MODEL_CACHE[key] = model
        return model

    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        word_timestamps: bool = True,
        duration_hint: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> TranscriptData:
        model = self._load_model()
        language_arg = None
        if language and language.lower() not in ("auto", ""):
            language_arg = language.split("-")[0].lower()
        try:
            segments_iter, info = model.transcribe(
                str(audio_path),
                language=language_arg,
                word_timestamps=word_timestamps,
                vad_filter=True,
                beam_size=5,
            )
        except Exception as exc:
            raise ProviderError(
                "Local Whisper could not transcribe this audio.",
                details=str(exc),
            ) from exc

        segments: list[Segment] = []
        for item in segments_iter:
            if cancel_event is not None and cancel_event.is_set():
                from backend.core.exceptions import JobCancelled

                raise JobCancelled("Job cancelled")
            words = []
            for w in getattr(item, "words", None) or []:
                token = (w.word or "").strip()
                if not token:
                    continue
                words.append(
                    Word(start=float(w.start or 0), end=float(w.end or w.start or 0), word=token)
                )
            text = (item.text or "").strip()
            if not text:
                continue
            segments.append(
                Segment(
                    start=float(item.start or 0),
                    end=float(item.end or 0),
                    text=text,
                    words=words,
                )
            )

        if not segments:
            raise ProviderError("Local Whisper detected no speech in this audio.")

        transcript = TranscriptData(
            language=getattr(info, "language", None),
            duration=float(getattr(info, "duration", 0) or (segments[-1].end if segments else 0)),
            provider="local_whisper",
            model=self.model_size,
            segments=segments,
        )
        transcript.rebuild_text()
        return transcript

    def test(self) -> ProviderTestResult:
        try:
            import faster_whisper  # type: ignore  # noqa: F401
        except Exception:
            return ProviderTestResult(
                ok=False,
                message=(
                    "faster-whisper is not installed. Install it with: "
                    ".\\.venv\\Scripts\\python.exe -m pip install faster-whisper"
                ),
            )
        return ProviderTestResult(
            ok=True,
            message=(
                "faster-whisper is installed. The model downloads on first use "
                f"(selected: {self.model_size})."
            ),
        )


def local_whisper_available() -> bool:
    try:
        import faster_whisper  # type: ignore  # noqa: F401

        return True
    except Exception:
        return False
