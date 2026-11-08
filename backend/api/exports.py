"""Export creation, history and download endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import selectinload

from backend.core.exceptions import ConflictError, NotFoundError
from backend.database.models import Clip, ExportRecord, Project
from backend.database.session import session_scope
from backend.schemas.api import ExportJobRequest
from backend.services.jobs import get_job_manager

router = APIRouter(tags=["exports"])


@router.post("/projects/{project_id}/export", status_code=202)
def export_project(project_id: str, payload: ExportJobRequest) -> dict:
    manager = get_job_manager()
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        ids = set(payload.clip_ids)
        found = {
            clip.id
            for clip in session.query(Clip.id)
            .filter(Clip.project_id == project_id, Clip.id.in_(ids))
            .all()
        }
        if not found:
            raise NotFoundError("None of the selected clips exist in this project.")
    if manager.has_active(project_id):
        raise ConflictError("A job is already running for this project.")
    return manager.create(
        "export",
        project_id,
        {
            "clip_ids": sorted(found),
            "settings": payload.settings.model_dump(),
            "use_clip_subtitles": payload.use_clip_subtitles,
        },
    )


@router.get("/exports")
def list_all_exports(limit: int = Query(default=100, ge=1, le=500)) -> dict:
    with session_scope() as session:
        records = (
            session.query(ExportRecord)
            .order_by(ExportRecord.created_at.desc())
            .limit(limit)
            .all()
        )
        project_ids = {record.project_id for record in records}
        projects = {
            project.id: project.name
            for project in session.query(Project)
            .filter(Project.id.in_(project_ids))
            .all()
        } if project_ids else {}
        items = []
        for record in records:
            exists = bool(record.path and Path(record.path).is_file())
            zip_exists = bool(record.zip_path and Path(record.zip_path).is_file())
            items.append(
                {
                    "id": record.id,
                    "project_id": record.project_id,
                    "project_name": projects.get(record.project_id, "Deleted project"),
                    "clip_id": record.clip_id,
                    "filename": record.filename,
                    "size_bytes": record.size_bytes,
                    "file_exists": exists,
                    "zip_exists": zip_exists,
                    "download_url": f"/api/exports/{record.id}/download?format=file",
                    "zip_url": f"/api/exports/{record.id}/download?format=zip"
                    if zip_exists
                    else None,
                    "created_at": record.created_at,
                }
            )
    return {"items": items, "total": len(items)}


@router.get("/projects/{project_id}/exports")
def list_exports(project_id: str) -> dict:
    with session_scope() as session:
        project = session.get(Project, project_id)
        if project is None:
            raise NotFoundError("This project no longer exists.")
        records = (
            session.query(ExportRecord)
            .filter(ExportRecord.project_id == project_id)
            .order_by(ExportRecord.created_at.desc())
            .limit(300)
            .all()
        )
        items = []
        for record in records:
            clip = session.get(Clip, record.clip_id) if record.clip_id else None
            file_exists = bool(record.path and Path(record.path).is_file())
            zip_exists = bool(record.zip_path and Path(record.zip_path).is_file())
            items.append(
                {
                    "id": record.id,
                    "job_id": record.job_id,
                    "clip_id": record.clip_id,
                    "clip_title": clip.title if clip else None,
                    "filename": record.filename,
                    "path": record.path,
                    "size_bytes": record.size_bytes,
                    "zip_path": record.zip_path,
                    "file_exists": file_exists,
                    "zip_exists": zip_exists,
                    "file_url": f"/api/exports/{record.id}/download?format=file",
                    "zip_url": f"/api/exports/{record.id}/download?format=zip"
                    if zip_exists
                    else None,
                    "download_url": f"/api/exports/{record.id}/download?format=file",
                    "created_at": record.created_at,
                }
            )
    return {"items": items, "total": len(items)}


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, format: str = Query(default="file")):
    with session_scope() as session:
        record = session.get(ExportRecord, export_id)
        if record is None:
            raise NotFoundError("This export record no longer exists.")
        path_value = record.zip_path if format == "zip" else record.path
        filename = (
            Path(record.zip_path).name if format == "zip" and record.zip_path else record.filename
        )
    if not path_value or not Path(path_value).is_file():
        raise NotFoundError("The exported file is no longer on disk. Export again to recreate it.")
    media = "application/zip" if format == "zip" else "video/mp4"
    return FileResponse(Path(path_value), media_type=media, filename=filename)


@router.delete("/exports/{export_id}")
def delete_export_record(export_id: str, delete_files: bool = Query(default=False)) -> dict:
    with session_scope() as session:
        record = session.get(ExportRecord, export_id)
        if record is None:
            raise NotFoundError("This export record no longer exists.")
        path = record.path
        zip_path = record.zip_path
        session.delete(record)
    deleted_files = False
    if delete_files:
        for value in (path, zip_path):
            if not value:
                continue
            try:
                target = Path(value)
                # Only remove files inside the app's export storage tree.
                if "exports" in target.parts:
                    target.unlink(missing_ok=True)
                    deleted_files = True
            except OSError:
                pass
    return {"deleted": True, "files_deleted": deleted_files}
