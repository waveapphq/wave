"""Regression core CRUD endpoints (REQ-5.2.4.5).

This module implements core regression management endpoints providing lifecycle
operations for regressions including listing, creation, retrieval, update,
and deletion.

Endpoints:
- GET /regressions/tags: Get all unique tags
- GET /regressions: List all regressions with filtering and pagination
- POST /regressions: Create a new regression
- GET /regressions/{regression_id}: Get regression by ID
- PUT /regressions/{regression_id}: Update regression
- DELETE /regressions/{regression_id}: Delete regression
"""

import re
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse

from wavecore import __version__
from wavecore.api.exceptions import WaveException
from wavecore.api.routes.shared import (
    read_json_object,
    validate_computed_expression,
    validate_variable_types,
)
from wavecore.api.services.regressions import service as regression_service

# Create router for regression endpoints
router = APIRouter(tags=["Regressions"])

# Semantic version pattern
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")

# Name pattern: alphanumeric, spaces, hyphens, underscores, periods, parentheses
NAME_PATTERN = re.compile(r"^[a-zA-Z0-9 ._()-]+$")


def validate_uuid(value: str, field_name: str = "regression_id") -> str:
    """Validate UUID format."""
    try:
        uuid.UUID(value)
        return value
    except ValueError as e:
        id_type = field_name.replace("_id", " ID").replace("_", " ")
        raise ValueError(f"Invalid {id_type} format: '{value}' is not a valid UUID") from e


def validate_regression_name(name: str) -> None:
    """Validate regression name format and length."""
    if not name or len(name) > 255:
        raise ValueError("Regression name must be between 1 and 255 characters")

    if not NAME_PATTERN.match(name):
        raise ValueError(
            f"Regression name '{name}' violates naming convention: must contain only "
            "alphanumeric characters, spaces, hyphens, underscores, periods, and parentheses"
        )


def _generate_etag(regression: dict[str, Any]) -> str:
    """Generate ETag for a regression."""
    import hashlib

    content = f"{regression.get('id')}{regression.get('version')}{regression.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"
_ERR_ALREADY_EXISTS = "already exists"
_ERR_PRECONDITION = "Precondition failed"

# Valid status values for filtering
VALID_STATUS_VALUES = ["passed", "failed", "never_run"]

# Valid sort fields
VALID_SORT_FIELDS = ["name", "version", "status", "last_run", "suites_count", "tests_count"]


def _parse_status_filter(status_param: str | None) -> list[str] | None:
    """Parse and validate the comma-separated status filter parameter."""
    if not status_param:
        return None
    status_list = [s.strip() for s in status_param.split(",") if s.strip()]
    for s in status_list:
        if s not in VALID_STATUS_VALUES:
            raise ValueError(
                f"Invalid status filter: '{s}' must be one of: {', '.join(VALID_STATUS_VALUES)}"
            )
    return status_list


def _parse_sort_param(sort_param: str | None) -> tuple[str | None, str | None]:
    """Parse and validate the sort parameter (field:direction)."""
    if not sort_param:
        return None, None
    sort_parts = sort_param.split(":")
    if len(sort_parts) > 2:
        raise ValueError(f"Invalid sort format: '{sort_param}'. Use 'field:direction'")
    sort_by = sort_parts[0]
    if sort_by not in VALID_SORT_FIELDS:
        raise ValueError(
            f"Invalid sort field: '{sort_by}' must be one of: {', '.join(VALID_SORT_FIELDS)}"
        )
    if len(sort_parts) > 1:
        sort_direction = sort_parts[1]
        if sort_direction not in ("asc", "desc"):
            raise ValueError(f"Invalid sort direction: '{sort_direction}' must be 'asc' or 'desc'")
    else:
        sort_direction = "asc"
    return sort_by, sort_direction


@router.get("/regressions/tags")
async def list_tags_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all unique tags from all regressions."""
    result = regression_service.list_all_tags()
    response.headers["Cache-Control"] = _CACHE_CONTROL_60
    return {
        "success": True,
        "data": result,
        "meta": {"request_id": request.headers.get("X-Request-ID", "")},
    }


@router.get("/regressions", response_model=None)
async def list_regressions(
    request: Request,
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    status: Annotated[str | None, Query(description="Filter by status (comma-separated)")] = None,
    tags: Annotated[
        str | None, Query(description="Filter by tags (comma-separated, all must match)")
    ] = None,
    sort: Annotated[str | None, Query(description="Sort field:direction (e.g., name:asc)")] = None,
) -> dict[str, Any] | JSONResponse:
    """List all regressions with filtering and pagination."""
    try:
        status_list = _parse_status_filter(status)
        tags_list: list[str] | None = (
            [t.strip() for t in tags.split(",") if t.strip()] if tags else None
        )
        sort_by, sort_direction = _parse_sort_param(sort)

        response.headers["Cache-Control"] = _CACHE_CONTROL_60

        result = regression_service.list_regressions(
            page=page,
            per_page=per_page,
            search=search,
            status=status_list,
            tags=tags_list,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )

        from datetime import UTC, datetime

        return {
            "success": True,
            "data": result["regressions"],
            "meta": {
                "request_id": str(uuid.uuid4()),
                "path": str(request.url.path),
                "timestamp": datetime.now(UTC).isoformat(),
                "version": __version__,
            },
            "pagination": {
                "total": result["total"],
                "page": result["page"],
                "per_page": result["per_page"],
                "total_pages": result["total_pages"],
            },
        }
    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={"success": False, "error": {"message": str(e), "code": "VALIDATION_ERROR"}},
        )


@router.post("/regressions", status_code=http_status.HTTP_201_CREATED, response_model=None)
async def create_regression(request: Request, response: Response) -> dict[str, Any] | JSONResponse:
    """Create a new regression."""
    try:
        body = await read_json_object(request)
        if "name" not in body:
            raise ValueError("Field 'name' is required")
        validate_regression_name(body["name"])

        if "variables" in body:
            validate_variable_types(body["variables"])
            for var_name, var_info in body["variables"].items():
                if isinstance(var_info, dict) and var_info.get("computed"):
                    expression = var_info.get("expression", "")
                    validate_computed_expression(var_name, expression)

        regression = regression_service.create_regression(body)
        response.headers["X-Cache-Invalidated"] = "regressions_list"
        return {"success": True, "data": regression}

    except ValueError as e:
        error_message = str(e)
        if _ERR_ALREADY_EXISTS in error_message:
            status_code = http_status.HTTP_409_CONFLICT
        else:
            status_code = http_status.HTTP_400_BAD_REQUEST
        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )
    except WaveException:
        raise
    except Exception:
        correlation_id = str(uuid.uuid4())
        return JSONResponse(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "message": "Internal server error",
                    "code": "INTERNAL_ERROR",
                    "correlation_id": correlation_id,
                },
            },
        )


@router.get("/regressions/{regression_id}", response_model=None)
async def get_regression(
    regression_id: str, request: Request, response: Response
) -> dict[str, Any] | JSONResponse:
    """Get regression by ID."""
    try:
        validate_uuid(regression_id, "regression_id")
        regression = regression_service.get_regression(regression_id)
        if regression is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Regression with ID '{regression_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )
        response.headers["ETag"] = _generate_etag(regression)
        response.headers["Cache-Control"] = _CACHE_CONTROL_60

        from datetime import UTC, datetime

        return {
            "success": True,
            "data": regression,
            "meta": {
                "request_id": str(uuid.uuid4()),
                "path": str(request.url.path),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        }
    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={"success": False, "error": {"message": str(e), "code": "INVALID_PARAMETER"}},
        )


@router.put("/regressions/{regression_id}", response_model=None)
async def update_regression(
    regression_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any] | JSONResponse:
    """Update regression."""
    try:
        validate_uuid(regression_id, "regression_id")
        if if_match:
            existing = regression_service.get_regression(regression_id)
            if existing:
                current_etag = _generate_etag(existing)
                if if_match != current_etag:
                    raise ValueError("Precondition failed: resource has been modified")
        body = await read_json_object(request)
        if "name" in body:
            validate_regression_name(body["name"])
        result = regression_service.update_regression(regression_id, body)
        if result is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Regression with ID '{regression_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )
        response.headers["ETag"] = _generate_etag(result)
        response.headers["X-Cache-Invalidated"] = f"regression_{regression_id},regressions_list"
        return {"success": True, "data": result}
    except ValueError as e:
        error_message = str(e)
        if _ERR_PRECONDITION in error_message:
            status_code = http_status.HTTP_412_PRECONDITION_FAILED
        elif _ERR_ALREADY_EXISTS in error_message:
            status_code = http_status.HTTP_409_CONFLICT
        else:
            status_code = http_status.HTTP_400_BAD_REQUEST
        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )


@router.delete("/regressions/{regression_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_regression(
    regression_id: str,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete regression."""
    try:
        if if_match:
            regression = regression_service.get_regression(regression_id)
            if regression:
                current_etag = _generate_etag(regression)
                if if_match != current_etag:
                    raise ValueError("Precondition failed: resource has been modified")
        deleted = regression_service.delete_regression(regression_id)
        if not deleted:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Regression with ID '{regression_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )
        response.headers["X-Cache-Invalidated"] = "regressions_list"
        return Response(
            status_code=http_status.HTTP_204_NO_CONTENT,
            headers={"X-Cache-Invalidated": "regressions_list"},
        )
    except ValueError as e:
        error_message = str(e)
        if _ERR_PRECONDITION in error_message:
            status_code = http_status.HTTP_412_PRECONDITION_FAILED
        else:
            status_code = http_status.HTTP_400_BAD_REQUEST
        return JSONResponse(
            status_code=status_code,
            content={"success": False, "error": {"message": error_message, "code": "CONFLICT"}},
        )
