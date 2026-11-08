"""Structured logging without leaking secrets."""

from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler

from backend.core.config import get_settings

_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|authorization|token)([\s\"'=:]+)([A-Za-z0-9_\-]{8,})"),
    re.compile(r"(?i)(x-goog-api-key:\s*)(\S+)"),
    re.compile(r"(?i)(bearer\s+)([A-Za-z0-9_\-\.]+)"),
]


def redact(text: str) -> str:
    value = str(text)
    for pattern in _SECRET_PATTERNS:
        value = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}***", value)
    return value


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        try:
            record.msg = redact(record.getMessage())
            record.args = ()
        except Exception:  # pragma: no cover - never break logging
            pass
        return True


_configured = False


def configure_logging() -> None:
    global _configured
    if _configured:
        return
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    log_file = settings.storage_dir / "logs" / "app.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    root = logging.getLogger()
    root.setLevel(level)

    stream = logging.StreamHandler()
    stream.setFormatter(formatter)
    stream.addFilter(RedactingFilter())
    root.addHandler(stream)

    file_handler = RotatingFileHandler(
        log_file, maxBytes=5_000_000, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(RedactingFilter())
    root.addHandler(file_handler)

    logging.getLogger("uvicorn.access").addFilter(RedactingFilter())
    _configured = True
