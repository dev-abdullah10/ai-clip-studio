"""Domain exceptions with user-facing messages."""

from __future__ import annotations


class AICSException(Exception):
    """Base application error with a safe, user-facing message."""

    code = "application_error"
    http_status = 400

    def __init__(self, message: str, *, details: str | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details
        if code:
            self.code = code

    def to_dict(self) -> dict:
        payload = {"error": {"code": self.code, "message": self.message}}
        if self.details:
            payload["error"]["details"] = self.details
        return payload


class ValidationError(AICSException):
    code = "validation_error"
    http_status = 422


class NotFoundError(AICSException):
    code = "not_found"
    http_status = 404


class ConflictError(AICSException):
    code = "conflict"
    http_status = 409


class ProviderError(AICSException):
    code = "provider_error"
    http_status = 502


class ProviderAuthError(ProviderError):
    code = "provider_auth_error"


class ProviderRateLimitError(ProviderError):
    code = "provider_rate_limited"


class ProviderUnavailableError(ProviderError):
    code = "provider_unavailable"


class TranscriptionError(AICSException):
    code = "transcription_failed"
    http_status = 502


class AnalysisError(AICSException):
    code = "analysis_failed"
    http_status = 502


class FFmpegError(AICSException):
    code = "ffmpeg_failed"
    http_status = 500

    def __init__(self, message: str, *, details: str | None = None):
        super().__init__(message, details=details, code="ffmpeg_failed")


class MediaError(AICSException):
    code = "media_error"
    http_status = 422


class StorageError(AICSException):
    code = "storage_error"
    http_status = 500


class JobCancelled(Exception):
    """Raised internally when a job is cancelled. Not returned to clients."""


class UrlImportError(AICSException):
    code = "url_import_failed"
    http_status = 400
