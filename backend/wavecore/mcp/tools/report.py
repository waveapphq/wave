"""Report tool handlers: failure projection + generated report retrieval."""

import json
from typing import Any

from wavecore.api.exceptions import InternalServerException
from wavecore.api.services.reports import builder, jobs
from wavecore.api.services.reports import service as reports_service
from wavecore.api.services.storage_paths import get_artifacts_storage_path


def get_failure_report(execution_id: str) -> dict[str, Any]:
    """Structured failure report for a terminal execution."""
    return builder.build_failure_report(execution_id)


async def get_run_report(execution_id: str, format: str = "json") -> dict[str, Any] | str:
    """Ensure the generated report exists via the reports job flow, then return it."""
    view = reports_service.start_execution_report(execution_id, format)
    if view["status"] in ("pending", "running"):
        task = jobs.get_task(execution_id, format)
        if task is not None:
            await task
        job = jobs.get_job(execution_id, format)
        view = jobs.job_view(job) if job is not None else view
    if view["status"] == "failed":
        raise InternalServerException(view.get("error") or "Report generation failed")

    artifact_id = str(view["artifact_id"])
    content = (get_artifacts_storage_path() / artifact_id).read_text(encoding="utf-8")
    if format == "json":
        parsed: dict[str, Any] = json.loads(content)
        return parsed
    return content
