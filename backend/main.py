"""FastAPI application entry point for AI Clip Studio (localhost only)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend import __version__
from backend.api import clips, dashboard, exports, jobs, media, projects, settings, system
from backend.core.config import PROJECT_ROOT, get_settings
from backend.core.exceptions import AICSException
from backend.core.logging import configure_logging
from backend.database.session import init_db
from backend.services.jobs import get_job_manager, shutdown_job_manager

logger = logging.getLogger(__name__)

configure_logging()
app_settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    get_job_manager().recover_interrupted()
    logger.info("AI Clip Studio %s ready on %s:%s", __version__, app_settings.host, app_settings.port)
    yield
    shutdown_job_manager()


app = FastAPI(
    title="AI Clip Studio",
    version=__version__,
    description="Local-first AI video clipping studio.",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.origins,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Range", "Accept-Ranges", "Content-Length"],
)


@app.exception_handler(AICSException)
async def aics_exception_handler(_request: Request, exc: AICSException) -> JSONResponse:
    return JSONResponse(status_code=exc.http_status, content=exc.to_dict())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = exc.errors()
    first = errors[0] if errors else {}
    location = " → ".join(str(part) for part in first.get("loc", ()) if part != "body")
    message = first.get("msg", "Invalid request.")
    if location:
        message = f"{location}: {message}"
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": message,
                "details": [
                    {"loc": list(item.get("loc", ())), "msg": item.get("msg", "")}
                    for item in errors[:12]
                ],
            }
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled API error")
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "An unexpected error occurred. Check the application log for details.",
            }
        },
    )


for module in (system, dashboard, projects, clips, jobs, exports, media, settings):
    app.include_router(module.router, prefix="/api")


@app.get("/api")
def api_root() -> dict:
    return {
        "name": "AI Clip Studio",
        "version": __version__,
        "docs": "/api/docs",
        "frontend": "http://localhost:5173",
    }


_FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if (_FRONTEND_DIST / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(_FRONTEND_DIST / "assets")),
        name="assets",
    )


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    if full_path.startswith("api/") or full_path == "api":
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "not_found", "message": "API route not found."}},
        )
    index = _FRONTEND_DIST / "index.html"
    if index.is_file():
        candidate = (_FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(_FRONTEND_DIST.resolve())
            if candidate.is_file() and candidate != index:
                return FileResponse(candidate)
        except (ValueError, OSError):
            pass
        return FileResponse(index)
    return JSONResponse(
        status_code=200,
        content={
            "name": "AI Clip Studio",
            "version": __version__,
            "message": "Backend is running. Start the frontend with npm run dev in the frontend folder.",
            "api_docs": "/api/docs",
        },
    )
