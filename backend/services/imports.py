"""Video import helpers: streamed uploads and direct HTTP downloads."""

from __future__ import annotations

import logging
import re
import threading
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import httpx

from backend.core.exceptions import MediaError, StorageError, UrlImportError

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".avi",
    ".m4v",
    ".mpg",
    ".mpeg",
    ".ts",
    ".mts",
    ".m2ts",
    ".wmv",
    ".flv",
}
CHUNK_SIZE = 1024 * 1024


def safe_suffix(filename: str | None, default: str = ".mp4") -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return suffix
    return default


def safe_stem(filename: str | None, fallback: str = "Imported video") -> str:
    stem = Path(filename or "").stem
    stem = re.sub(r"[\\/:*?\"<>|]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    return (stem or fallback)[:120]


async def save_upload(
    upload,
    destination: Path,
    *,
    max_bytes: int,
    cancel_event: threading.Event | None = None,
) -> int:
    """Stream an UploadFile to disk while enforcing the size limit."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    temp = destination.with_suffix(destination.suffix + ".part")
    try:
        with temp.open("wb") as handle:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise MediaError("Upload cancelled.")
                chunk = await upload.read(CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise StorageError(
                        f"The file is larger than the {max_bytes // (1024 * 1024)} MB import limit."
                    )
                handle.write(chunk)
        if total == 0:
            raise MediaError("The uploaded file was empty.")
        temp.replace(destination)
        return total
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def download_direct_url(
    url: str,
    destination: Path,
    *,
    max_bytes: int,
    cancel_event: threading.Event | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    timeout: float = 60.0,
) -> int:
    """Download a *direct* video URL. Platform pages (YouTube etc.) are rejected."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise UrlImportError("Enter a direct http:// or https:// video URL.")
    suffix = safe_suffix(parsed.path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(suffix + ".part")
    total = 0
    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(timeout, connect=20.0),
            headers={"User-Agent": "AI-Clip-Studio/1.0"},
        ) as client:
            with client.stream("GET", url) as response:
                if response.status_code >= 400:
                    raise UrlImportError(
                        f"The server returned HTTP {response.status_code} for this URL."
                    )
                content_type = (response.headers.get("content-type") or "").lower()
                if "text/html" in content_type:
                    raise UrlImportError(
                        "This URL is a web page, not a direct video file. "
                        "Platform links such as YouTube are not downloaded. "
                        "Download the video first, then upload the file."
                    )
                length_header = response.headers.get("content-length")
                expected = int(length_header) if length_header and length_header.isdigit() else 0
                if expected and expected > max_bytes:
                    raise StorageError(
                        f"The remote file is larger than the {max_bytes // (1024 * 1024)} MB limit."
                    )
                with temp.open("wb") as handle:
                    for chunk in response.iter_bytes(CHUNK_SIZE):
                        if cancel_event is not None and cancel_event.is_set():
                            raise UrlImportError("Download cancelled.")
                        total += len(chunk)
                        if total > max_bytes:
                            raise StorageError(
                                f"The remote file is larger than the {max_bytes // (1024 * 1024)} MB limit."
                            )
                        handle.write(chunk)
                        if on_progress:
                            on_progress(total, expected)
        if total == 0:
            raise UrlImportError("The URL returned an empty response.")
        temp.replace(destination)
        return total
    except httpx.HTTPError as exc:
        raise UrlImportError(
            "Could not download this URL. Check the link and your connection."
        ) from exc
    except Exception:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
