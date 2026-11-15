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

from wavecore import __version__
from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import (
    entity_etag,
    read_json_object,
    refuse_stale_etag,
    validate_computed_expression,
    validate_uuid,
    validate_variable_types,
)
from wavecore.api.services.regressions import service as regression_service

# Create router for regression endpoints
router = APIRouter(tags=["Regressions"])

# Name pattern: alphanumeric, spaces, hyphens, underscores, periods, parentheses
NAME_PATTERN = re.compile(r"^[a-zA-Z0-9 ._()-]+$")


def validate_regression_name(name: Any) -> None:
    """Validate regression name format and length."""
    if not isinstance(name, str):
        raise ValidationException("Field 'name' must be a string")
    if not name or len(name) > 255:
        raise ValidationException("Regression name must be between 1 and 255 characters")

    if not NAME_PATTERN.match(name):
        raise ValidationException(
            f"Regression name '{name}' violates naming convention: must contain only "
            "alphanumeric characters, spaces, hyphens, underscores, periods, and parentheses"
        )


def regression_not_found(regression_id: str) -> NotFoundException:
    """The 404 for a regression ID that matches no regression."""
    return NotFoundException(f"Regression with ID '{regression_id}' not found")


# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"

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
            raise ValidationException(
                f"Invalid status filter: '{s}' must be one of: {', '.join(VALID_STATUS_VALUES)}"
            )
    return status_list


def _parse_sort_param(sort_param: str | None) -> tuple[str | None, str | None]:
    """Parse and validate the sort parameter (field:direction)."""
    if not sort_param:
        return None, None
    sort_parts = sort_param.split(":")
    if len(sort_parts) > 2:
        raise ValidationException(f"Invalid sort format: '{sort_param}'. Use 'field:direction'")
    sort_by = sort_parts[0]
    if sort_by not in VALID_SORT_FIELDS:
        raise ValidationException(
            f"Invalid sort field: '{sort_by}' must be one of: {', '.join(VALID_SORT_FIELDS)}"
        )
    if len(sort_parts) > 1:
        sort_direction = sort_parts[1]
        if sort_direction not in ("asc", "desc"):
            raise ValidationException(
                f"Invalid sort direction: '{sort_direction}' must be 'asc' or 'desc'"
            )
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
) -> dict[str, Any]:
    """List all regressions with filtering and pagination."""
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


@router.post("/regressions", status_code=http_status.HTTP_201_CREATED, response_model=None)
async def create_regression(request: Request, response: Response) -> dict[str, Any]:
    """Create a new regression."""
    body = await read_json_object(request)
    if "name" not in body:
        raise ValidationException("Field 'name' is required")
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


@router.get("/regressions/{regression_id}", response_model=None)
async def get_regression(
    regression_id: str, request: Request, response: Response
) -> dict[str, Any]:
    """Get regression by ID."""
    validate_uuid(regression_id, "regression_id")
    regression = regression_service.get_regression(regression_id)
    if regression is None:
        raise regression_not_found(regression_id)
    response.headers["ETag"] = entity_etag(regression)
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


@router.put("/regressions/{regression_id}", response_model=None)
async def update_regression(
    regression_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update regression."""
    validate_uuid(regression_id, "regression_id")
    refuse_stale_etag(if_match, regression_service.get_regression, regression_id)
    body = await read_json_object(request)
    if "name" in body:
        validate_regression_name(body["name"])
    result = regression_service.update_regression(regression_id, body)
    if result is None:
        raise regression_not_found(regression_id)
    response.headers["ETag"] = entity_etag(result)
    response.headers["X-Cache-Invalidated"] = f"regression_{regression_id},regressions_list"
    return {"success": True, "data": result}


@router.delete("/regressions/{regression_id}", status_code=http_status.HTTP_204_NO_CONTENT)
async def delete_regression(
    regression_id: str,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete regression."""
    validate_uuid(regression_id, "regression_id")
    refuse_stale_etag(if_match, regression_service.get_regression, regression_id)
    if not regression_service.delete_regression(regression_id):
        raise regression_not_found(regression_id)
    response.headers["X-Cache-Invalidated"] = "regressions_list"
    return Response(
        status_code=http_status.HTTP_204_NO_CONTENT,
        headers={"X-Cache-Invalidated": "regressions_list"},
    )
