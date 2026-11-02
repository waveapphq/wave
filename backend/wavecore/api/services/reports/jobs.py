"""In-memory report generation job registry keyed by (execution_id, format).

Jobs live in process memory only and are lost on restart; the client simply
re-POSTs, which returns the persisted artifact when it exists. Asyncio task
refs are tracked alongside so callers and tests can await completion
(mirrors the workbench ``_active_tasks`` pattern).
"""

import asyncio
import copy
from datetime import UTC, datetime
from typing import Any

_jobs: dict[tuple[str, str], dict[str, Any]] = {}
_tasks: dict[tuple[str, str], "asyncio.Task[None]"] = {}


def create_job(execution_id: str, report_format: str, runs_total: int) -> dict[str, Any]:
    """Register a fresh pending job for the format slot, replacing any prior."""
    job: dict[str, Any] = {
        "execution_id": execution_id,
        "format": report_format,
        "status": "pending",
        "progress": {"runs_processed": 0, "runs_total": runs_total},
        "artifact_id": None,
        "error": None,
        "started_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "ended_at": None,
    }
    _jobs[(execution_id, report_format)] = job
    return job


def get_job(execution_id: str, report_format: str) -> dict[str, Any] | None:
    return _jobs.get((execution_id, report_format))


def set_task(execution_id: str, report_format: str, task: "asyncio.Task[None]") -> None:
    _tasks[(execution_id, report_format)] = task


def get_task(execution_id: str, report_format: str) -> "asyncio.Task[None] | None":
    return _tasks.get((execution_id, report_format))


def job_view(job: dict[str, Any]) -> dict[str, Any]:
    """JSON-safe copy of a job for API responses."""
    return copy.deepcopy(job)


def clear_jobs() -> None:
    """Test isolation utility: drop all jobs and task refs."""
    _jobs.clear()
    _tasks.clear()
