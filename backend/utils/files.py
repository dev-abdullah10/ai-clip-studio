"""Safe filesystem helpers."""

from __future__ import annotations

import re
import shutil
import unicodedata
from pathlib import Path

ALLOWED_VIDEO_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".webm",
    ".m4v",
    ".wmv",
    ".flv",
    ".mpeg",
    ".mpg",
    ".ts",
    ".ogv",
}

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str, *, fallback: str = "video") -> str:
    name = unicodedata.normalize("NFKC", name or "").strip()
    name = _ILLEGAL.sub("_", name).strip(" .")
    name = re.sub(r"\s+", " ", name)
    if not name:
        name = fallback
    return name[:180]


def slugify(name: str, *, fallback: str = "project") -> str:
    value = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    value = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_")
    return (value or fallback)[:80]


def ensure_within(path: Path, root: Path) -> Path:
    """Resolve path and guarantee it stays inside root (symlink/traversal safe)."""
    resolved = path.resolve()
    root_resolved = root.resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise ValueError("Path escapes the storage directory")
    return resolved


def human_size(num_bytes: int | float) -> str:
    value = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} TB"


def dir_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def safe_unlink(path: str | Path | None) -> None:
    if not path:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def remove_tree(path: Path) -> None:
    try:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass
