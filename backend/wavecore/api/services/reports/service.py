"""Report generation orchestration (REQ-3.7.2.1).

Generation is on demand and per format: a request returns the existing
artifact of the requested format when one exists, and only otherwise
generates it - asynchronously for tracked executions (job keyed by
execution_id + format), synchronously for workbench sessions. Regeneration
is explicit: delete the artifact, then request again.
"""

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services import artifact_service, log_streaming_service
from wavecore.api.services.executions import _storage
from wavecore.api.services.storage_paths import get_artifacts_storage_path
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.core.artifacts import store

from . import builder, jobs
from . import html as report_html

VALID_REPORT_FORMATS = ("html", "json")

_IN_PROGRESS_STATUSES = ("running", "paused")
_ACTIVE_JOB_STATUSES = ("pending", "running")

_VALID_LIST_STATUSES = ("passed", "failed", "stopped")
_VALID_LIST_TYPES = ("test", "suite", "regression")
_VALID_LIST_SORTS = ("started_at", "name", "status", "triggered_by", "type", "duration")
_VALID_LIST_ORDERS = ("asc", "desc")

_ROW_EXECUTION_FIELDS = (
    "id",
    "name",
    "entity_type",
    "entity_id",
    "status",
    "triggered_by",
    "started_at",
    "ended_at",
    "duration",
)


def list_report_rows(
    *,
    status: list[str] | None,
    entity_type: list[str] | None,
    triggered_by: list[str] | None,
    search: str | None,
    from_date: datetime | None,
    to_date: datetime | None,
    page: int,
    per_page: int,
    sort: str,
    order: str,
) -> dict[str, Any]:
    """One row per reportable execution (not running/paused) joined with the
    latest report artifact metadata per format for the returned page only."""
    _validate_list_filters(status, entity_type, sort, order)
    _storage._ensure_cache_loaded()
    items = [
        execution
        for execution in _storage._execution_storage.values()
        if execution.get("status") not in _IN_PROGRESS_STATUSES
    ]
    items = _storage._filter_executions(
        items, status, entity_type, triggered_by, None, search, from_date, to_date
    )
    _storage._sort_executions(items, sort, order)
    total = len(items)
    start = (page - 1) * per_page
    return {
        "rows": [_report_row(execution) for execution in items[start : start + per_page]],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


def _validate_list_filters(
    status: list[str] | None, entity_type: list[str] | None, sort: str, order: str
) -> None:
    for value in status or []:
        if value not in _VALID_LIST_STATUSES:
            raise ValidationException(
                f"Invalid status '{value}': "
                f"valid statuses are {', '.join(_VALID_LIST_STATUSES)}"
            )
    for value in entity_type or []:
        if value not in _VALID_LIST_TYPES:
            raise ValidationException(
                f"Invalid type '{value}': valid types are {', '.join(_VALID_LIST_TYPES)}"
            )
    if sort not in _VALID_LIST_SORTS:
        raise ValidationException(
            f"Invalid sort '{sort}': valid sorts are {', '.join(_VALID_LIST_SORTS)}"
        )
    if order not in _VALID_LIST_ORDERS:
        raise ValidationException(
            f"Invalid order '{order}': valid orders are {', '.join(_VALID_LIST_ORDERS)}"
        )


def _report_row(execution: dict[str, Any]) -> dict[str, Any]:
    """Trimmed execution summary + per-format report slots (no snapshot leak)."""
    reports: dict[str, Any] = {"json": None, "html": None}
    artifact_dir = execution.get("artifact_dir")
    if artifact_dir:
        directory = get_artifacts_storage_path() / str(artifact_dir)
        for report_format in VALID_REPORT_FORMATS:
            reports[report_format] = _report_info(directory, str(artifact_dir), report_format)
    return {
        "execution": {field: execution.get(field) for field in _ROW_EXECUTION_FIELDS},
        "reports": reports,
    }


def _report_info(directory: Path, dir_name: str, report_format: str) -> dict[str, Any] | None:
    """Metadata of the unversioned report.<format> in the directory, if any."""
    artifact = _find_latest_report(directory, report_format)
    if artifact is None:
        return None
    stat = artifact.stat()
    return {
        "artifact_id": f"{dir_name}/{artifact.name}",
        "size_bytes": stat.st_size,
        "generated_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
    }


def start_execution_report(execution_id: str, report_format: str = "html") -> dict[str, Any]:
    """Ensure the report of the requested format exists: return the in-flight
    job view, the existing artifact as a completed view, or start a job."""
    _require_valid_format(report_format)
    execution = _require_execution(execution_id)
    status = execution.get("status")
    if status in _IN_PROGRESS_STATUSES:
        raise ConflictException(
            f"Cannot generate report for execution in '{status}' state. "
            "Wait for the execution to finish."
        )
    if not execution.get("artifact_dir"):
        raise ConflictException(f"Execution '{execution_id}' has no artifact directory")

    existing_job = jobs.get_job(execution_id, report_format)
    if existing_job is not None and existing_job["status"] in _ACTIVE_JOB_STATUSES:
        return jobs.job_view(existing_job)

    artifact_dir = str(execution["artifact_dir"])
    artifact = _find_latest_report(get_artifacts_storage_path() / artifact_dir, report_format)
    if artifact is not None:
        return _existing_artifact_view(
            execution_id, report_format, f"{artifact_dir}/{artifact.name}"
        )

    job = jobs.create_job(
        execution_id, report_format, runs_total=builder.count_dispatched_runs(execution_id)
    )
    jobs.set_task(
        execution_id, report_format, asyncio.create_task(_run_report_job(execution_id, job))
    )
    return jobs.job_view(job)


def get_execution_report_status(execution_id: str, report_format: str = "html") -> dict[str, Any]:
    """Current job view for an execution's report generation."""
    _require_valid_format(report_format)
    _require_execution(execution_id)
    job = jobs.get_job(execution_id, report_format)
    if job is None:
        raise NotFoundException(f"No report generation job for execution '{execution_id}'")
    return jobs.job_view(job)


def generate_session_report(
    report_format: str = "html", user_id: str = DEFAULT_USER_ID
) -> dict[str, Any]:
    """Synchronously ensure the active workbench session's report exists."""
    from wavecore.api.services.workbench import service as workbench_service

    _require_valid_format(report_format)
    session = workbench_service._require_active_session(user_id)
    status = session.get("status")
    if status in _IN_PROGRESS_STATUSES:
        raise ConflictException(
            f"Cannot generate report for workbench session in '{status}' state. "
            "Wait for the run to finish."
        )
    tracked_execution_id = session.get("execution_id")
    if tracked_execution_id:
        raise ConflictException(
            f"Workbench session belongs to tracked execution '{tracked_execution_id}'. "
            "Generate the report from the execution endpoint."
        )

    session_id = str(session["session_id"])
    artifacts_dir = session.get("artifacts_dir")
    if artifacts_dir:
        directory = Path(artifacts_dir)
    else:
        directory = artifact_service.session_artifacts_dir(session_id)
        directory.mkdir(parents=True, exist_ok=True)
        session["artifacts_dir"] = str(directory)

    existing = _find_latest_report(directory, report_format)
    if existing is not None and _session_report_is_fresh(existing, session):
        return {"path": existing.name, "format": report_format, "session_id": session_id}

    report = builder.build_session_report(session, log_streaming_service.get_logs(session_id))
    path = _write_report(directory, report_format, report)
    return {"path": path.name, "format": report_format, "session_id": session_id}


async def _run_report_job(execution_id: str, job: dict[str, Any]) -> None:
    """Build and persist the requested format; record the outcome on the job."""
    job["status"] = "running"

    def _on_run_processed() -> None:
        job["progress"]["runs_processed"] += 1

    try:
        report = await asyncio.to_thread(
            builder.build_execution_report, execution_id, _on_run_processed
        )
        execution = _require_execution(execution_id)
        artifact_dir = str(execution["artifact_dir"])
        path = _write_report(get_artifacts_storage_path() / artifact_dir, job["format"], report)
        job["artifact_id"] = f"{artifact_dir}/{path.name}"
        job["status"] = "completed"
    except Exception as exc:
        job["status"] = "failed"
        job["error"] = str(exc)
    job["ended_at"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _write_report(directory: Path, report_format: str, report: dict[str, Any]) -> Path:
    if report_format == "json":
        return store.write_json(directory, "report", report)
    return store.write_text(directory, "report.html", report_html.render_report_html(report))


def _find_latest_report(directory: Path, report_format: str) -> Path | None:
    """The unversioned report.<format> in the directory, if present."""
    if not directory.is_dir():
        return None
    candidate = directory / f"report.{report_format}"
    return candidate if candidate.is_file() else None


def _existing_artifact_view(
    execution_id: str, report_format: str, artifact_id: str
) -> dict[str, Any]:
    """Completed-style view for an artifact that already exists (no job ran)."""
    runs_total = builder.count_dispatched_runs(execution_id)
    return {
        "execution_id": execution_id,
        "format": report_format,
        "status": "completed",
        "progress": {"runs_processed": runs_total, "runs_total": runs_total},
        "artifact_id": artifact_id,
        "error": None,
        "started_at": None,
        "ended_at": None,
    }


def _session_report_is_fresh(path: Path, session: dict[str, Any]) -> bool:
    """A session report counts as existing only if written during this run;
    older files carried over from a predecessor session are stale."""
    started = datetime.fromisoformat(str(session["started_at"]).replace("Z", "+00:00"))
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    return modified >= started


def _require_valid_format(report_format: str) -> None:
    if report_format not in VALID_REPORT_FORMATS:
        raise ValidationException(
            f"Invalid format '{report_format}': "
            f"valid formats are {', '.join(VALID_REPORT_FORMATS)}"
        )


def _require_execution(execution_id: str) -> dict[str, Any]:
    _storage._ensure_cache_loaded()
    execution = _storage._execution_storage.get(execution_id) or _storage._load_execution(
        execution_id
    )
    if execution is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")
    return execution
