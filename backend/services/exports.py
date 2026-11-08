"""Export filename handling and ZIP packaging."""

from __future__ import annotations

import logging
import re
import zipfile
from datetime import datetime
from pathlib import Path

from backend.database.models import Clip, Project

logger = logging.getLogger(__name__)

_INVALID = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def sanitize_component(value: str, *, fallback: str = "clip", max_len: int = 90) -> str:
    text = _INVALID.sub(" ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip(" .")
    if not text:
        text = fallback
    return text[:max_len].rstrip(" .") or fallback


def build_filename(
    pattern: str,
    project: Project,
    clip: Clip,
    index: int,
) -> str:
    """Expand a filename pattern and guarantee a safe ``.mp4`` name."""
    values = {
        "project": sanitize_component(project.name, fallback="Project"),
        "index": index,
        "title": sanitize_component(clip.title, fallback="Clip"),
        "score": int(round(clip.score)),
        "category": sanitize_component(clip.category, fallback="general", max_len=30),
        "aspect": sanitize_component(clip.aspect_ratio.replace(":", "x"), fallback="vertical"),
        "date": datetime.now().strftime("%Y-%m-%d"),
    }
    try:
        name = (pattern or "{project}_Clip_{index:02d}").format_map(values)
    except (KeyError, ValueError, IndexError):
        name = f"{values['project']}_Clip_{index:02d}"
    name = sanitize_component(name, fallback=f"{values['project']}_Clip_{index:02d}", max_len=160)
    if not name.lower().endswith(".mp4"):
        name += ".mp4"
    return name


def unique_path(directory: Path, filename: str) -> Path:
    path = directory / filename
    if not path.exists():
        return path
    stem = path.stem
    suffix = path.suffix
    counter = 2
    while True:
        candidate = directory / f"{stem}_{counter}{suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


def create_zip(files: list[Path], zip_path: Path) -> Path:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    temp = zip_path.with_suffix(".zip.part")
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            used: set[str] = set()
            for file in files:
                if not file.is_file():
                    continue
                name = file.name
                counter = 2
                while name in used:
                    name = f"{file.stem}_{counter}{file.suffix}"
                    counter += 1
                used.add(name)
                archive.write(file, arcname=name)
        temp.replace(zip_path)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    return zip_path


def cleanup_work_dir(path: Path) -> None:
    import shutil

    try:
        shutil.rmtree(path, ignore_errors=True)
    except OSError:
        logger.debug("Could not delete work directory %s", path)
