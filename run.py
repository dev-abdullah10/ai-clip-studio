"""Local launcher for the AI Clip Studio backend.

Runs uvicorn bound to 127.0.0.1 only. Use start.bat for the full app.
"""

from __future__ import annotations

import argparse

import uvicorn

from backend import __version__
from backend.core.config import get_settings
from backend.core.logging import configure_logging


def main() -> None:
    settings = get_settings()
    configure_logging()
    parser = argparse.ArgumentParser(description="AI Clip Studio backend")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--reload", action="store_true", help="Developer auto-reload")
    args = parser.parse_args()

    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit(
            "AI Clip Studio only binds to localhost. It is not designed to be exposed to a network."
        )
    print(f"AI Clip Studio {__version__} → http://{args.host}:{args.port}")
    print(f"Storage: {settings.storage_dir}")
    uvicorn.run(
        "backend.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level=settings.log_level.lower(),
        access_log=False,
    )


if __name__ == "__main__":
    main()
