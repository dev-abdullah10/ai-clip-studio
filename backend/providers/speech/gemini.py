"""Google Gemini provider (free tier).

Verified against https://ai.google.dev/gemini-api/docs (November 2026):
- gemini-3.5-transcribe: free tier, word timestamps, diarization, 30 min/file.
- gemini-3.8-flash / 3.6-flash / 3.5-flash-lite / 3.1-flash-lite: free tier text models.

Transcription uses the Interactions API + Files API. Analysis and vision use
the stable generateContent endpoint.
"""

from __future__ import annotations

import base64
import logging
import threading
import time
from pathlib import Path

import httpx

from backend.core.exceptions import (
    JobCancelled,
    ProviderAuthError,
    ProviderError,
    ProviderUnavailableError,
)
from backend.providers.base import (
    LLMProvider,
    ProviderInfo,
    ProviderTestResult,
    SpeechProvider,
    VisionProvider,
    parse_time_offset,
    request_json,
    sleep_cancellable,
)
from backend.schemas.transcript import Segment, TranscriptData, Word

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com"
GEMINI_SPEECH_MODELS = ["gemini-3.5-transcribe"]
GEMINI_LLM_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]
GEMINI_VISION_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"]

LANGUAGE_MAP = {
    "en": "en-US",
    "es": "es-ES",
    "fr": "fr-FR",
    "de": "de-DE",
    "it": "it-IT",
    "pt": "pt-BR",
    "hi": "hi-IN",
    "ar": "ar-EG",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "zh": "cmn-Hans-CN",
    "ru": "ru-RU",
    "tr": "tr-TR",
    "id": "id-ID",
    "nl": "nl-NL",
    "pl": "pl-PL",
    "sv": "sv-SE",
    "uk": "uk-UA",
    "vi": "vi-VN",
    "th": "th-TH",
    "fa": "fa-IR",
    "he": "he-IL",
    "bn": "bn-IN",
    "ta": "ta-IN",
    "te": "te-IN",
    "mr": "mr-IN",
    "gu": "gu-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "pa": "pa-IN",
    "ur": "ur-PK",
}

SPEECH_INFO = ProviderInfo(
    id="gemini",
    name="Google Gemini",
    kind="speech",
    description=(
        "Gemini 3.5 Transcribe with word-level timestamps and speaker diarization. "
        "Free tier, no credit card. Audio is uploaded to Google for transcription."
    ),
    requires_key=True,
    free_tier="Free tier available (limits vary by project and may change).",
    default_model="gemini-3.5-transcribe",
    models=GEMINI_SPEECH_MODELS,
    docs_url="https://ai.google.dev/gemini-api/docs/transcribe",
    capabilities={
        "word_timestamps": True,
        "diarization": True,
        "language_detection": True,
        "max_file_seconds": 1800,
        "cloud": True,
    },
)

LLM_INFO = ProviderInfo(
    id="gemini",
    name="Google Gemini",
    kind="llm",
    description=(
        "Gemini Flash for clip analysis. Free tier, no credit card. Only transcript text "
        "(and optionally sampled frames when visual analysis is enabled) is sent."
    ),
    requires_key=True,
    free_tier="Free tier available for Flash models (limits vary and may change).",
    default_model="gemini-3.8-flash",
    models=GEMINI_LLM_MODELS,
    docs_url="https://ai.google.dev/gemini-api/docs/pricing",
    capabilities={"json_mode": True, "multimodal": True, "cloud": True},
)

VISION_INFO = ProviderInfo(
    id="gemini",
    name="Google Gemini Vision",
    kind="vision",
    description="Optional visual context analysis using a few sampled, resized frames.",
    requires_key=True,
    free_tier="Free tier available (limits vary).",
    default_model="gemini-3.8-flash",
    models=GEMINI_VISION_MODELS,
    docs_url="https://ai.google.dev/gemini-api/docs/vision",
    capabilities={"cloud": True},
)


def _headers(key: str) -> dict[str, str]:
    return {"x-goog-api-key": key, "Content-Type": "application/json"}


def _model_path(model: str) -> str:
    return model[7:] if model.startswith("models/") else model


class GeminiSpeechProvider(SpeechProvider):
    info = SPEECH_INFO
    max_chunk_seconds = 1200.0

    def __init__(self, api_key: str, model: str = "gemini-3.5-transcribe"):
        self.api_key = api_key
        self.model = model or "gemini-3.5-transcribe"

    # ------------------------------------------------------------------ files
    def _upload(self, audio_path: Path, cancel_event: threading.Event | None) -> tuple[str, str]:
        mime = {
            ".mp3": "audio/mp3",
            ".wav": "audio/wav",
            ".m4a": "audio/m4a",
            ".ogg": "audio/ogg",
            ".flac": "audio/flac",
            ".aac": "audio/aac",
            ".webm": "audio/webm",
        }.get(audio_path.suffix.lower(), "audio/mp3")
        size = audio_path.stat().st_size
        headers = {
            "x-goog-api-key": self.api_key,
            "X-Goog-Upload-Protocol": "raw",
            "X-Goog-Upload-Header-Content-Length": str(size),
            "X-Goog-Upload-Header-Content-Type": mime,
            "Content-Type": mime,
        }
        try:
            with httpx.Client(timeout=httpx.Timeout(180.0, connect=30.0)) as client:
                with audio_path.open("rb") as handle:
                    response = client.post(
                        f"{GEMINI_BASE}/upload/v1beta/files",
                        headers=headers,
                        content=handle,
                    )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise ProviderUnavailableError(
                "Could not upload audio to Google. Check your internet connection."
            ) from exc
        if response.status_code in (401, 403):
            raise ProviderAuthError("Google rejected the Gemini API key. Check it in Settings.")
        if response.status_code != 200:
            raise ProviderError(
                f"Gemini audio upload failed (HTTP {response.status_code}).",
                details=response.text[:1200],
            )
        payload = response.json()
        file_info = payload.get("file") or payload
        uri = file_info.get("uri")
        name = file_info.get("name")
        if not uri or not name:
            raise ProviderError("Gemini did not return an uploaded file reference.")
        state = str(file_info.get("state", "ACTIVE")).upper()
        deadline = time.monotonic() + 240
        while state not in ("ACTIVE", "") and time.monotonic() < deadline:
            if cancel_event is not None and cancel_event.is_set():
                raise JobCancelled("Job cancelled")
            sleep_cancellable(2.0, cancel_event)
            probe = request_json(
                "GET",
                f"{GEMINI_BASE}/v1beta/{name}",
                headers={"x-goog-api-key": self.api_key},
                timeout=60,
                retries=2,
                cancel_event=cancel_event,
            )
            state = str((probe.get("file") or probe).get("state", "")).upper()
        if state == "FAILED":
            raise ProviderError("Gemini failed to process the uploaded audio file.")
        return uri, name

    def _delete(self, name: str) -> None:
        try:
            with httpx.Client(timeout=30) as client:
                client.delete(
                    f"{GEMINI_BASE}/v1beta/{name}",
                    headers={"x-goog-api-key": self.api_key},
                )
        except Exception:
            logger.debug("Could not delete Gemini file %s", name, exc_info=True)

    # ------------------------------------------------------------- transcribe
    def transcribe(
        self,
        audio_path: Path,
        *,
        language: str | None = None,
        word_timestamps: bool = True,
        duration_hint: float | None = None,
        cancel_event: threading.Event | None = None,
    ) -> TranscriptData:
        uri, file_name = self._upload(audio_path, cancel_event)
        try:
            transcription_config: dict = {}
            if language and language.lower() not in ("auto", ""):
                code = LANGUAGE_MAP.get(language.lower(), language)
                transcription_config["language_codes"] = [code]
            if word_timestamps:
                transcription_config["mode"] = {
                    "type": "verbatim",
                    "timestamp_granularities": ["word"],
                }
            body = {
                "model": f"models/{_model_path(self.model)}",
                "input": [{"type": "file", "file_uri": uri}],
                "generation_config": {"transcription_config": transcription_config},
            }
            payload = request_json(
                "POST",
                f"{GEMINI_BASE}/v1beta/interactions",
                headers=_headers(self.api_key),
                json_body=body,
                timeout=600,
                retries=2,
                cancel_event=cancel_event,
            )
            return self._parse(payload, duration_hint or 0.0)
        finally:
            self._delete(file_name)

    def _parse(self, payload: dict, duration_hint: float) -> TranscriptData:
        words: list[Word] = []
        output_text = payload.get("output_text") or ""
        for step in payload.get("steps") or []:
            for content in step.get("content") or []:
                text = content.get("text")
                if not text:
                    continue
                if not output_text:
                    output_text = text
                for annotation in content.get("annotations") or []:
                    if str(annotation.get("type", "")).lower() != "word_info":
                        continue
                    token = str(annotation.get("text", "")).strip()
                    if not token:
                        continue
                    start = parse_time_offset(annotation.get("start_offset"))
                    end = parse_time_offset(annotation.get("end_offset")) or start
                    words.append(
                        Word(
                            start=start,
                            end=max(start, end),
                            word=token,
                            speaker=annotation.get("speaker") or None,
                        )
                    )

        if not words and output_text.strip():
            return TranscriptData(
                language=None,
                duration=duration_hint,
                provider="gemini",
                model=self.model,
                segments=[
                    Segment(start=0.0, end=max(0.1, duration_hint), text=output_text.strip())
                ],
                text=output_text.strip(),
            )
        if not words:
            raise ProviderError("Gemini returned an empty transcript. The audio may contain no speech.")

        segments = _group_words(words)
        result = TranscriptData(
            language=None,
            duration=max(duration_hint, words[-1].end),
            provider="gemini",
            model=self.model,
            segments=segments,
            speakers=sorted({w.speaker for w in words if w.speaker}),
        )
        result.rebuild_text()
        return result

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{GEMINI_BASE}/v1beta/models",
                headers={"x-goog-api-key": self.api_key},
                timeout=30,
                retries=1,
            )
            models = [
                (m.get("name") or "").replace("models/", "")
                for m in payload.get("models", [])
                if "generateContent" in (m.get("supportedGenerationMethods") or [])
                or "transcribe" in (m.get("name") or "")
            ]
            return ProviderTestResult(
                ok=True,
                message="Connected to Google Gemini.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models[:200],
            )
        except (ProviderAuthError, ProviderError) as exc:
            return ProviderTestResult(ok=False, message=exc.message)

    def list_models(self) -> list[str]:
        result = self.test()
        if result.ok and result.models:
            transcribe = [m for m in result.models if "transcribe" in m]
            return transcribe or GEMINI_SPEECH_MODELS
        return list(GEMINI_SPEECH_MODELS)


def _group_words(words: list[Word]) -> list[Segment]:
    """Group word annotations into sentence-sized, speaker-aware segments."""
    segments: list[Segment] = []
    current: list[Word] = []
    for word in words:
        if not current:
            current.append(word)
            continue
        prev = current[-1]
        gap = word.start - prev.end
        speaker_change = bool(word.speaker and prev.speaker and word.speaker != prev.speaker)
        ends_sentence = bool(prev.word and prev.word[-1] in ".!?…")
        too_long = (word.end - current[0].start) > 12.0 or len(" ".join(w.word for w in current)) > 110
        if speaker_change or gap > 1.2 or (ends_sentence and gap > 0.35) or too_long:
            segments.append(_segment_from_words(current))
            current = []
        current.append(word)
    if current:
        segments.append(_segment_from_words(current))
    return segments


def _segment_from_words(words: list[Word]) -> Segment:
    text = " ".join(w.word for w in words).strip()
    text = text.replace(" ,", ",").replace(" .", ".").replace(" ?", "?").replace(" !", "!")
    speakers = {w.speaker for w in words if w.speaker}
    return Segment(
        start=words[0].start,
        end=max(words[-1].end, words[0].start + 0.1),
        text=text,
        speaker=words[0].speaker if len(speakers) <= 1 else None,
        words=words,
    )


class GeminiLLMProvider(LLMProvider):
    info = LLM_INFO

    def __init__(self, api_key: str, model: str = "gemini-3.8-flash"):
        self.api_key = api_key
        self.model = model or "gemini-3.8-flash"

    def complete_json(
        self,
        *,
        system: str,
        user: str,
        cancel_event: threading.Event | None = None,
        max_tokens: int = 8192,
    ) -> str:
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.35,
                "topP": 0.9,
                "maxOutputTokens": max_tokens,
                "responseMimeType": "application/json",
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
            ],
        }
        payload = request_json(
            "POST",
            f"{GEMINI_BASE}/v1beta/models/{_model_path(self.model)}:generateContent",
            headers=_headers(self.api_key),
            json_body=body,
            timeout=300,
            retries=3,
            cancel_event=cancel_event,
        )
        return _extract_gemini_text(payload)

    def test(self) -> ProviderTestResult:
        started = time.monotonic()
        try:
            payload = request_json(
                "GET",
                f"{GEMINI_BASE}/v1beta/models",
                headers={"x-goog-api-key": self.api_key},
                timeout=30,
                retries=1,
            )
            models = [
                (m.get("name") or "").replace("models/", "")
                for m in payload.get("models", [])
                if "generateContent" in (m.get("supportedGenerationMethods") or [])
            ]
            return ProviderTestResult(
                ok=True,
                message="Connected to Google Gemini.",
                latency_ms=round((time.monotonic() - started) * 1000),
                models=models[:200],
            )
        except (ProviderAuthError, ProviderError) as exc:
            return ProviderTestResult(ok=False, message=exc.message)

    def list_models(self) -> list[str]:
        result = self.test()
        if result.ok and result.models:
            preferred = [m for m in result.models if "flash" in m or "gemma" in m]
            return preferred or result.models
        return list(GEMINI_LLM_MODELS)


def _extract_gemini_text(payload: dict) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        feedback = payload.get("promptFeedback") or {}
        reason = feedback.get("blockReason")
        if reason:
            raise ProviderError(f"Gemini blocked the request ({reason}). Try different content or another provider.")
        raise ProviderError("Gemini returned no content.")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if not text.strip():
        finish = candidates[0].get("finishReason", "unknown")
        if finish == "MAX_TOKENS":
            raise ProviderError("The AI response was cut off because it exceeded the output limit. Reduce clip count or use shorter transcripts.")
        raise ProviderError(f"Gemini returned an empty response ({finish}).")
    return text


class GeminiVisionProvider(VisionProvider):
    info = VISION_INFO

    def __init__(self, api_key: str, model: str = "gemini-3.8-flash"):
        self.api_key = api_key
        self.model = model or "gemini-3.8-flash"

    def describe_frames(
        self, frames: list[Path], *, cancel_event: threading.Event | None = None
    ) -> str:
        parts: list[dict] = [
            {
                "text": (
                    "These are sampled frames from one video segment. Describe the visual setting, "
                    "the number of people, whether a face is clearly visible, and whether the visuals "
                    "add meaning. Be concise and factual."
                )
            }
        ]
        for frame in frames[:8]:
            try:
                data = base64.b64encode(frame.read_bytes()).decode("ascii")
            except OSError:
                continue
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": data}})
        payload = request_json(
            "POST",
            f"{GEMINI_BASE}/v1beta/models/{_model_path(self.model)}:generateContent",
            headers=_headers(self.api_key),
            json_body={"contents": [{"role": "user", "parts": parts}]},
            timeout=180,
            retries=2,
            cancel_event=cancel_event,
        )
        return _extract_gemini_text(payload)

    def test(self) -> ProviderTestResult:
        return GeminiLLMProvider(self.api_key, self.model).test()
