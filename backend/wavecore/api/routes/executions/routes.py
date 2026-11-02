"""Execution control and monitoring API endpoints (REQ-5.2.4.6).

This module provides REST API endpoints for execution control and monitoring including:
- Lifecycle Management: Create, get, list, delete executions
- State Transitions: Pause, resume, stop operations
- Progress Tracking: Current position, percentage completion
- Runtime Variable Snapshot: Current variable state with secret masking
- Log Retrieval: Timestamped entries with severity filtering
- Timeline Analysis: Per-block timing and durations
- Statistics Aggregation: Success rates, duration metrics
- SSE Events: Real-time execution updates
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from wavecore.api.exceptions import (
    NotFoundException,
    ValidationException,
)
from wavecore.api.routes.executions.shared import (
    _create_success_response,
    _parse_datetime,
)
from wavecore.api.routes.shared import validate_uuid
from wavecore.api.services import shared as shared_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.file_tree import content_disposition

router = APIRouter(prefix="/executions", tags=["Executions"])

VALID_EXPORT_FORMATS = {"yaml", "json"}


def _invalid_test_id_response(bad_value: str) -> JSONResponse:
    """Return the standardized 400 body for an invalid test_id entry."""
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "success": False,
            "error": {
                "code": "INVALID_UUID",
                "message": f"Invalid test_id: '{bad_value}'",
            },
        },
    )


def _parse_test_ids_csv(raw: str) -> tuple[list[str] | None, JSONResponse | None]:
    """Parse a ``test_ids`` CSV into a list of UUID strings.

    Returns a tuple of (parsed_list, error_response). Exactly one of the
    two is not None. Whitespace around each element is trimmed before
    validation; empty elements (from ``a,,b``) are treated as invalid
    test_ids rather than skipped.
    """
    entries = [part.strip() for part in raw.split(",")]
    parsed: list[str] = []
    for entry in entries:
        try:
            uuid.UUID(entry)
        except ValueError:
            return None, _invalid_test_id_response(entry)
        parsed.append(entry)
    return parsed, None


class StartExecutionRequest(BaseModel):
    """Request model for starting execution.

    ``selected_tests`` scopes a suite or regression run to a subset:
    - For a suite: a list of test_id strings drawn from the suite's tests.
    - For a regression: a list of ``{"suite_id", "test_id"}`` dicts so the
      same test id can be independently selected per-suite context.
    Omit the field to run the whole entity. It is not valid for tests.
    """

    type: str | None = None
    id: str | None = None
    environment_id: str
    version: str | None = None
    profile: str | None = None
    variables: dict[str, Any] | None = None
    selected_tests: list[str] | list[dict[str, str]] | None = None


@router.get("/users")
async def list_execution_users() -> Response:
    """Get all unique triggered_by values from executions.

    Returns:
        Sorted list of unique user identifiers.
    """
    users = execution_service.list_execution_users()
    return _create_success_response(data=users)


@router.get("")
async def list_executions(
    status: Annotated[str | None, Query()] = None,
    type: Annotated[str | None, Query()] = None,
    triggered_by: Annotated[
        str | None, Query(description="Filter by user (comma-separated)")
    ] = None,
    entity_id: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    from_date: Annotated[str | None, Query()] = None,
    to_date: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=100)] = 20,
    sort: Annotated[str, Query()] = "started_at",
    order: Annotated[str, Query()] = "desc",
) -> Response:
    """List executions with filtering and pagination.

    Args:
        status: Filter by execution status.
        type: Filter by entity type.
        entity_id: Filter by specific entity ID.
        from_date: Filter executions after this date.
        to_date: Filter executions before this date.
        page: Page number (1-based).
        per_page: Items per page.

    Returns:
        Paginated list of executions.
    """
    from_dt = _parse_datetime(from_date) if from_date else None
    to_dt = _parse_datetime(to_date) if to_date else None

    status_list = [s.strip() for s in status.split(",") if s.strip()] if status else None
    type_list = [t.strip() for t in type.split(",") if t.strip()] if type else None
    user_list = [u.strip() for u in triggered_by.split(",") if u.strip()] if triggered_by else None

    result = execution_service.list_executions(
        status=status_list,
        entity_type=type_list,
        triggered_by=user_list,
        entity_id=entity_id,
        search=search,
        from_date=from_dt,
        to_date=to_dt,
        page=page,
        per_page=per_page,
        sort=sort,
        order=order,
    )

    return _create_success_response(
        data=result["executions"],
        pagination={
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
    )


@router.get("/statistics")
async def get_execution_statistics(
    entity_type: Annotated[str | None, Query()] = None,
    entity_id: Annotated[str | None, Query()] = None,
    from_date: Annotated[str | None, Query()] = None,
    to_date: Annotated[str | None, Query()] = None,
) -> Response:
    """Get aggregate execution statistics.

    Args:
        entity_type: Filter by entity type.
        entity_id: Filter by specific entity ID.
        from_date: Filter executions after this date.
        to_date: Filter executions before this date.

    Returns:
        Statistics including counts, rates, and durations.
    """
    from_dt = _parse_datetime(from_date) if from_date else None
    to_dt = _parse_datetime(to_date) if to_date else None

    result = execution_service.get_execution_statistics(
        entity_type=entity_type,
        entity_id=entity_id,
        from_date=from_dt,
        to_date=to_dt,
    )

    return _create_success_response(data=result)


@router.post("", status_code=status.HTTP_201_CREATED)
async def start_execution(request: StartExecutionRequest) -> Response:
    """Start a new execution.

    Args:
        request: Execution start request with entity type and ID.

    Returns:
        Created execution details.
    """
    # Validate required fields
    if not request.type:
        raise ValidationException("Field 'type' is required")

    if not request.id:
        raise ValidationException("Field 'id' is required")

    try:
        result = execution_service.start_execution(
            entity_type=request.type,
            entity_id=request.id,
            environment_id=request.environment_id,
            variables=request.variables,
            profile_id=request.profile,
            version=request.version,
            selected_tests=request.selected_tests,
        )

        return _create_success_response(data=result, status_code=201)

    except LookupError as e:
        raise NotFoundException(str(e)) from e


@router.post("/export")
async def export_executions_bulk(request: Request) -> Response:
    """Export multiple executions as single file or ZIP archive.

    Args:
        request: HTTP request with ``execution_ids`` and optional ``format``.

    Returns:
        Single file download for one id, ZIP archive for two or more.
    """
    body = await request.json()
    execution_ids = body.get("execution_ids", [])
    fmt = body.get("format", "json")

    if not execution_ids:
        raise ValidationException("execution_ids must be a non-empty list")

    if fmt not in VALID_EXPORT_FORMATS:
        raise ValidationException(f"Invalid format: '{fmt}'. Must be 'yaml' or 'json'")

    for execution_id in execution_ids:
        try:
            uuid.UUID(execution_id)
        except ValueError as err:
            raise ValidationException(
                f"Invalid UUID format for execution_id: '{execution_id}'"
            ) from err

    # NotFoundException propagates to middleware if any execution not found
    results = execution_service.export_executions_batch(execution_ids, fmt)

    if len(results) == 1:
        _eid, content, filename = results[0]
        content_type = "application/json" if fmt == "json" else "application/x-yaml"
        return StreamingResponse(
            iter([content]),
            media_type=content_type,
            headers={"Content-Disposition": content_disposition("attachment", filename)},
        )

    archive = shared_service.build_export_zip(
        [(filename, content) for _eid, content, filename in results]
    )

    return StreamingResponse(
        iter([archive]),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="executions-export.zip"'},
    )


@router.get("/{execution_id}")
async def get_execution(execution_id: str) -> Response:
    """Get execution details by ID.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Execution details including progress for running executions.
    """
    validate_uuid(execution_id, "execution_id")

    result = execution_service.get_execution(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.delete("/{execution_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_execution(execution_id: str) -> Response:
    """Delete an execution permanently.

    Only terminal executions (passed, failed, stopped) can be deleted.
    Running or paused executions must be stopped first.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        204 No Content on success.
    """
    # ConflictException propagates to middleware from service
    result = execution_service.delete_execution(execution_id)

    if not result:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{execution_id}/pause")
async def pause_execution(execution_id: str) -> Response:
    """Pause a running execution.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Paused execution details.
    """
    validate_uuid(execution_id, "execution_id")

    # ConflictException propagates to middleware from service
    result = execution_service.pause_execution(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.put("/{execution_id}/resume")
async def resume_execution(execution_id: str) -> Response:
    """Resume a paused execution.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Resumed execution details.
    """
    validate_uuid(execution_id, "execution_id")

    # ConflictException propagates to middleware from service
    result = execution_service.resume_execution(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.put("/{execution_id}/stop")
async def stop_execution(execution_id: str) -> Response:
    """Gracefully stop an execution.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Stopped execution details.
    """
    validate_uuid(execution_id, "execution_id")

    # ConflictException propagates to middleware from service
    result = execution_service.stop_execution(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.get("/{execution_id}/logs")
async def get_execution_logs(
    execution_id: str,
    before: Annotated[
        str | None,
        Query(description="Cursor '<chronology_index>:<child_seq|x>' from prior page"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> Response:
    """Merged-console log pagination for the Execution Detail page.

    Walks ``logs.yaml`` (scope chronology) in reverse, expanding each
    ``type: test`` reference into its per-run ``logs/<run_id>.yaml``
    file. Returns ``{entries, prev_cursor}`` with ``prev_cursor ==
    null`` when the start of history is reached. Live log pushes arrive
    over the ``log:<execution_id>`` WebSocket topic.
    """
    validate_uuid(execution_id, "execution_id")

    cursor: tuple[int, int | None] | None = None
    if before:
        try:
            idx_part, child_part = before.rsplit(":", 1)
            child_seq = None if child_part == "x" else int(child_part)
            cursor = (int(idx_part), child_seq)
        except (ValueError, TypeError) as exc:
            raise ValidationException(
                f"Invalid cursor '{before}'. Expected '<chronology_index>:<child_seq|x>'."
            ) from exc

    result = execution_service.paginate_execution_logs(execution_id, cursor, limit)
    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")
    return _create_success_response(data=result)


@router.get("/{execution_id}/progress")
async def get_execution_progress(execution_id: str) -> Response:
    """Get execution progress.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Progress information with current position and percentage.
    """
    validate_uuid(execution_id, "execution_id")

    result = execution_service.get_execution_progress(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.get("/{execution_id}/variables")
async def get_execution_variables(execution_id: str) -> Response:
    """Get runtime variables with secrets masked.

    Args:
        execution_id: Execution identifier (UUID).

    Returns:
        Variables dictionary with secrets masked.
    """
    validate_uuid(execution_id, "execution_id")

    result = execution_service.get_execution_variables(execution_id)

    if result is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    return _create_success_response(data=result)


@router.get("/history/{run_id}")
async def get_historical_test_run(run_id: str) -> Response:
    """Get the painted-snapshot payload for a single test run.

    ``run_id`` is the opaque identifier assigned per test run - either
    per-rollup (suite / regression children) or equal to the execution
    id for test-type runs. Routing by run_id keeps the URL unambiguous
    when the same test_id appears more than once in a regression (one
    run per suite).

    Args:
        run_id: Test-run identifier (UUID).

    Returns:
        ``{ run_id, execution_id, test_id, suite_id, status, started_at,
        ended_at, workflow, block_states, variables, logs,
        environment_id, environment_name }`` - the payload the
        Historical Test Canvas needs to paint the snapshot and wire
        the Back link back to the parent execution page.
    """
    validate_uuid(run_id, "run_id")

    result = execution_service.get_historical_test_run(run_id)

    if result is None:
        raise NotFoundException(f"Historical canvas for run '{run_id}' not found")

    return _create_success_response(data=result)


@router.get("/{execution_id}/export")
async def export_execution(
    execution_id: str,
    test_ids: Annotated[
        str | None,
        Query(description="Optional CSV of test UUIDs to slice the export"),
    ] = None,
    format: Annotated[str, Query(description="Export format (json or yaml)")] = "json",
) -> Response:
    """Export an execution (whole, per-test, or mass-test) as a download.

    Execution snapshots are masked at write time, so exports carry no
    secrets choice.

    Args:
        execution_id: Execution identifier (UUID).
        test_ids: Optional CSV of test UUIDs. Absent means whole execution.
        format: Output format, one of ``json`` or ``yaml``.

    Returns:
        Streaming file download with ``Content-Disposition: attachment``.
    """
    try:
        uuid.UUID(execution_id)
    except ValueError:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "code": "INVALID_UUID",
                    "message": f"Invalid UUID format for execution_id: '{execution_id}'",
                },
            },
        )

    if format not in VALID_EXPORT_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {
                    "code": "INVALID_PARAMETER",
                    "message": f"Invalid format: '{format}'. Must be 'yaml' or 'json'",
                },
            },
        )

    parsed_test_ids: list[str] | None
    if test_ids is None:
        parsed_test_ids = None
    else:
        parsed_test_ids, error_response = _parse_test_ids_csv(test_ids)
        if error_response is not None:
            return error_response

    try:
        result = execution_service.export_execution(execution_id, parsed_test_ids, format)
    except NotFoundException as exc:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {"code": "NOT_FOUND", "message": str(exc)},
            },
        )

    if result is None:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {
                    "code": "NOT_FOUND",
                    "message": f"Execution not found: {execution_id}",
                },
            },
        )

    content_val, filename = result
    content_type = "application/json" if format == "json" else "application/x-yaml"

    return StreamingResponse(
        iter([content_val]),
        media_type=content_type,
        headers={"Content-Disposition": content_disposition("attachment", filename)},
    )
