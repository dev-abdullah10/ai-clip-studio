"""Safe FFmpeg/FFprobe process execution with cancellation and real progress."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.core.config import get_settings
from backend.core.exceptions import FFmpegError, JobCancelled, MediaError

logger = logging.getLogger(__name__)

CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


@dataclass
class ToolInfo:
    available: bool
    path: str
    version: str | None = None
    has_ass: bool = False
    has_drawtext: bool = False
    has_nvenc: bool = False


_tool_cache: dict[str, ToolInfo] = {}


def _run_capture(cmd: list[str], timeout: float = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )


def inspect_tools(force: bool = False) -> dict[str, ToolInfo]:
    settings = get_settings()
    if _tool_cache and not force:
        return _tool_cache
    info: dict[str, ToolInfo] = {}
    for name, path in (("ffmpeg", settings.ffmpeg), ("ffprobe", settings.ffprobe)):
        resolved = shutil.which(path) or (path if Path(path).is_file() else None)
        tool = ToolInfo(available=bool(resolved), path=path)
        if resolved:
            try:
                result = _run_capture([resolved, "-version"], timeout=15)
                tool.version = (result.stdout or result.stderr).splitlines()[0] if (result.stdout or result.stderr) else None
            except (OSError, subprocess.SubprocessError):
                tool.available = False
        info[name] = tool

    ffmpeg = info["ffmpeg"]
    if ffmpeg.available:
        try:
            filters = _run_capture([ffmpeg.path, "-hide_banner", "-filters"], timeout=20)
            text = (filters.stdout or "") + (filters.stderr or "")
            ffmpeg.has_ass = " ass " in text or " ass\n" in text
            ffmpeg.has_drawtext = "drawtext" in text
            encoders = _run_capture([ffmpeg.path, "-hide_banner", "-encoders"], timeout=20)
            et = (encoders.stdout or "") + (encoders.stderr or "")
            ffmpeg.has_nvenc = "h264_nvenc" in et
        except (OSError, subprocess.SubprocessError):
            pass
    _tool_cache.clear()
    _tool_cache.update(info)
    return info


def ffmpeg_ready() -> bool:
    return inspect_tools()["ffmpeg"].available and inspect_tools()["ffprobe"].available


def require_ffmpeg() -> None:
    tools = inspect_tools()
    if not tools["ffmpeg"].available:
        raise FFmpegError(
            "FFmpeg was not found. Install FFmpeg and add it to PATH, or place it in tools/ffmpeg/bin, then restart the app."
        )
    if not tools["ffprobe"].available:
        raise FFmpegError(
            "FFprobe was not found. Install FFmpeg (which includes FFprobe), then restart the app."
        )


def run_ffmpeg(
    args: list[str],
    *,
    cwd: str | Path | None = None,
    cancel_event: threading.Event | None = None,
    timeout: float | None = None,
    total_duration: float | None = None,
    on_progress: Callable[[float], None] | None = None,
    ffmpeg_path: str | None = None,
) -> str:
    """Run FFmpeg. Returns stderr tail. Raises FFmpegError / JobCancelled."""
    settings = get_settings()
    executable = ffmpeg_path or settings.ffmpeg
    cmd = [executable, "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    logger.info("ffmpeg run: %s", " ".join(cmd[:12]) + (" ..." if len(cmd) > 12 else ""))

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(cwd) if cwd else None,
            creationflags=CREATE_NO_WINDOW,
        )
    except FileNotFoundError as exc:
        raise FFmpegError("FFmpeg could not be started. Check the FFmpeg path in Settings.") from exc

    stderr_tail: deque[str] = deque(maxlen=120)
    progress_state = {"seconds": 0.0, "speed": ""}
    last_emit = {"t": 0.0, "pct": -1.0}

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for line in proc.stderr:
            line = line.rstrip()
            if line:
                stderr_tail.append(line)

    def _drain_stdout() -> None:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    raw = float(line.split("=", 1)[1])
                    value = raw / 1_000_000 if line.startswith("out_time_us=") else raw / 1_000_000
                    if value >= 0:
                        progress_state["seconds"] = value
                except ValueError:
                    continue
            elif line.startswith("speed="):
                progress_state["speed"] = line.split("=", 1)[1]
            if on_progress and total_duration and total_duration > 0:
                now = time.monotonic()
                pct = max(0.0, min(100.0, progress_state["seconds"] / total_duration * 100.0))
                if now - last_emit["t"] > 0.5 or abs(pct - last_emit["pct"]) > 2:
                    last_emit["t"] = now
                    last_emit["pct"] = pct
                    try:
                        on_progress(pct)
                    except Exception:  # progress callbacks must never kill the render
                        logger.debug("progress callback failed", exc_info=True)

    t_out = threading.Thread(target=_drain_stdout, daemon=True)
    t_err = threading.Thread(target=_drain_stderr, daemon=True)
    t_out.start()
    t_err.start()

    started = time.monotonic()
    cancelled = False
    try:
        while proc.poll() is None:
            if cancel_event is not None and cancel_event.is_set():
                cancelled = True
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                break
            if timeout is not None and time.monotonic() - started > timeout:
                proc.kill()
                raise FFmpegError("FFmpeg timed out while processing this file.")
            time.sleep(0.2)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        t_out.join(timeout=2)
        t_err.join(timeout=2)

    if cancelled:
        raise JobCancelled("Job cancelled")

    stderr_text = "\n".join(stderr_tail)
    if proc.returncode != 0:
        message = "FFmpeg failed to process this video."
        lowered = stderr_text.lower()
        if "no such file" in lowered:
            message = "The source video file could not be found."
        elif "invalid data" in lowered or "moov atom" in lowered:
            message = "The video appears to be corrupt or incomplete."
        elif "no space left" in lowered or "disk full" in lowered:
            message = "There is not enough free disk space to write the output."
        elif "permission denied" in lowered:
            message = "Windows denied access to a file. Check folder permissions."
        elif "unknown filter" in lowered or "no such filter" in lowered:
            message = "This FFmpeg build is missing a required filter."
        raise FFmpegError(message, details=stderr_text[-4000:])
    return stderr_text


def probe_json(path: str | Path, *, timeout: float = 60) -> dict:
    settings = get_settings()
    require_ffmpeg()
    cmd = [
        settings.ffprobe,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    try:
        result = _run_capture(cmd, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise MediaError("Timed out while reading the video metadata.") from exc
    if result.returncode != 0:
        detail = (result.stderr or "").strip()[-2000:]
        raise MediaError(
            "This file could not be read as a video. It may be corrupt or unsupported.",
            details=detail,
        )
    try:
        return json.loads(result.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise MediaError("FFprobe returned unreadable metadata.") from exc


def parse_rate(value: str | None) -> float | None:
    if not value or value in {"0/0", "N/A"}:
        return None
    try:
        if "/" in value:
            num, den = value.split("/", 1)
            den_f = float(den)
            return round(float(num) / den_f, 3) if den_f else None
        return round(float(value), 3)
    except (ValueError, ZeroDivisionError):
        return None
