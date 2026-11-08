"""Background job status and cancellation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query

from backend.core.exceptions import NotFoundError
from backend.services.jobs import get_job_manager

router = APIRouter(tags=["jobs"])


@router.get("/jobs")
def list_jobs(
    project_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    manager = get_job_manager()
    jobs = manager.list(project_id=project_id, status=status, limit=limit)
    return {"items": jobs, "total": len(jobs)}


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = get_job_manager().get(job_id)
    if job is None:
        raise NotFoundError("This job no longer exists.")
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    return get_job_manager().cancel(job_id)
