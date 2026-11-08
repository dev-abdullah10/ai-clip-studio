"""Secure local secret storage.

On Windows API keys are encrypted with DPAPI (per-user scope) so they can only
be decrypted by the same Windows account on the same machine. Secrets are
never returned by the API and never written to logs.
"""

from __future__ import annotations

import base64
import ctypes
import json
import os
import sys
import threading
from pathlib import Path

from backend.core.config import get_settings

if sys.platform == "win32":  # pragma: no cover - platform specific
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ("cbData", wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_char)),
        ]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32
    _crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        wintypes.LPCWSTR,
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    _crypt32.CryptProtectData.restype = wintypes.BOOL
    _crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        ctypes.POINTER(wintypes.LPWSTR),
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    _crypt32.CryptUnprotectData.restype = wintypes.BOOL
    _kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    _kernel32.LocalFree.restype = ctypes.c_void_p

    CRYPTPROTECT_UI_FORBIDDEN = 0x1
    CRYPTPROTECT_LOCAL_MACHINE = 0x4


def _to_blob(data: bytes):
    buffer = ctypes.create_string_buffer(data, len(data))
    blob = DATA_BLOB(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    return blob, buffer


def _dpapi_protect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("DPAPI unavailable")
    in_blob, _buf = _to_blob(data)
    out_blob = DATA_BLOB()
    if not _crypt32.CryptProtectData(
        ctypes.byref(in_blob),
        "AI Clip Studio",
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        _kernel32.LocalFree(out_blob.pbData)


def _dpapi_unprotect(data: bytes) -> bytes:
    if sys.platform != "win32":
        raise RuntimeError("DPAPI unavailable")
    in_blob, _buf = _to_blob(data)
    out_blob = DATA_BLOB()
    if not _crypt32.CryptUnprotectData(
        ctypes.byref(in_blob),
        None,
        None,
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(out_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(out_blob.pbData, out_blob.cbData)
    finally:
        _kernel32.LocalFree(out_blob.pbData)


class SecretStore:
    """Encrypted key/value store backed by a local file."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        self._cache: dict[str, str] | None = None

    def _load(self) -> dict[str, str]:
        if self._cache is not None:
            return self._cache
        if not self.path.exists():
            self._cache = {}
            return self._cache
        try:
            raw = self.path.read_bytes()
            if raw.startswith(b"DPAPI1:"):
                payload = _dpapi_unprotect(base64.b64decode(raw[len(b"DPAPI1:") :]))
            elif raw.startswith(b"PLAIN1:"):
                payload = base64.b64decode(raw[len(b"PLAIN1:") :])
            else:
                payload = b"{}"
            data = json.loads(payload.decode("utf-8") or "{}")
            self._cache = {str(k): str(v) for k, v in data.items()}
        except Exception:
            self._cache = {}
        return self._cache

    def _save(self, data: dict[str, str]) -> None:
        payload = json.dumps(data, indent=2).encode("utf-8")
        if sys.platform == "win32":
            blob = b"DPAPI1:" + base64.b64encode(_dpapi_protect(payload))
        else:  # pragma: no cover - Linux/macOS fallback
            blob = b"PLAIN1:" + base64.b64encode(payload)
        temp = self.path.with_suffix(".tmp")
        temp.write_bytes(blob)
        try:
            os.chmod(temp, 0o600)
        except OSError:
            pass
        temp.replace(self.path)
        self._cache = data

    def get(self, key: str) -> str | None:
        with self._lock:
            value = self._load().get(key)
        if value:
            return value
        # Environment fallback (advanced setups / CI)
        settings = get_settings()
        env_map = {
            "gemini": settings.gemini_api_key,
            "groq": settings.groq_api_key,
            "openai_compatible": settings.openai_compatible_api_key,
        }
        return env_map.get(key)

    def set(self, key: str, value: str) -> None:
        with self._lock:
            data = dict(self._load())
            if value:
                data[key] = value
            else:
                data.pop(key, None)
            self._save(data)

    def delete(self, key: str) -> None:
        self.set(key, "")

    def has(self, key: str) -> bool:
        return bool(self.get(key))

    def masked(self, key: str) -> str | None:
        value = self.get(key)
        if not value:
            return None
        if len(value) <= 8:
            return "*" * len(value)
        return f"{value[:4]}...{value[-4:]}"


_store: SecretStore | None = None
_store_lock = threading.Lock()


def get_secret_store() -> SecretStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = SecretStore(get_settings().storage_dir / "config" / "secrets.dat")
        return _store
