"""Report generation endpoints (REQ-3.7.2.1, REQ-5.2.4.13).

POST /executions/{execution_id}/report ensures the report of the requested
format exists (200 when already on disk, 202 when a generation job was
started or is in flight); GET polls the job. POST /workbench/session/report
does the same synchronously for the active session. GET /reports lists one
row per reportable execution joined with report artifact metadata.
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.executions.shared import _create_success_response, _parse_datetime
from wavecore.api.routes.shared import validate_uuid
from wavecore.api.services.reports import service as report_service

router = APIRouter(tags=["Reports"])


def _parse_csv(raw: str | None) -> list[str] | None:
    values = [part.strip() for part in raw.split(",") if part.strip()] if raw else None
    return values or None


def _parse_filter_date(value: str | None, param: str) -> datetime | None:
    if not value:
        return None
    try:
        return _parse_datetime(value)
    except ValueError:
        raise ValidationException(
            f"Invalid {param} '{value}': expected an ISO 8601 datetime"
        ) from None


def _job_response(data: dict[str, object]) -> JSONResponse:
    """200 when the artifact already exists (completed, no job); 202 otherwise."""
    code = status.HTTP_200_OK if data["status"] == "completed" else status.HTTP_202_ACCEPTED
    return _create_success_response(data, status_code=code)


@router.post("/executions/{execution_id}/report", status_code=status.HTTP_202_ACCEPTED)
async def start_execution_report(execution_id: str, format: str = "html") -> JSONResponse:
    """Ensure the execution's report of the requested format exists."""
    validate_uuid(execution_id, "execution_id")
    return _job_response(report_service.start_execution_report(execution_id, format))


@router.get("/executions/{execution_id}/report")
async def get_execution_report_status(execution_id: str, format: str = "html") -> JSONResponse:
    """Poll the report generation job for an execution."""
    validate_uuid(execution_id, "execution_id")
    return _create_success_response(
        report_service.get_execution_report_status(execution_id, format)
    )


@router.get("/reports")
async def list_reports(
    search: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query(description="Filter by status (comma-separated)")] = None,
    type: Annotated[
        str | None, Query(description="Filter by entity type (comma-separated)")
    ] = None,
    triggered_by: Annotated[
        str | None, Query(description="Filter by user (comma-separated)")
    ] = None,
    from_date: Annotated[str | None, Query()] = None,
    to_date: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
    sort: Annotated[str, Query()] = "started_at",
    order: Annotated[str, Query()] = "desc",
) -> JSONResponse:
    """List reportable executions joined with report artifact metadata.

    Filter values are validated strictly with exact messages, unlike the
    lenient executions list.
    """
    result = report_service.list_report_rows(
        status=_parse_csv(status),
        entity_type=_parse_csv(type),
        triggered_by=_parse_csv(triggered_by),
        search=search,
        from_date=_parse_filter_date(from_date, "from_date"),
        to_date=_parse_filter_date(to_date, "to_date"),
        page=page,
        per_page=per_page,
        sort=sort,
        order=order,
    )
    return _create_success_response(
        data=result["rows"],
        pagination={
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
    )


@router.post("/workbench/session/report")
async def generate_session_report(format: str = "html") -> JSONResponse:
    """Ensure the active workbench session's report of the requested format exists."""
    return _create_success_response(report_service.generate_session_report(format))
