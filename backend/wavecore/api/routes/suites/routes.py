"""Suite core CRUD endpoints (REQ-5.2.4.4).

This module implements core suite management endpoints providing lifecycle
operations for test suites including listing, creation, retrieval, update,
deletion, batch operations, and validation.

Endpoints:
- GET /suites/tags: Get all unique tags
- GET /suites/names: Get all suite names for dropdowns
- GET /suites: List all suites with filtering and pagination
- POST /suites: Create a new suite
- GET /suites/{suite_id}: Get suite by ID
- PUT /suites/{suite_id}: Update suite
- DELETE /suites/{suite_id}: Delete suite
"""

import re
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi import status as status_module

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import (
    read_json_object,
    validate_computed_expression,
    validate_uuid,
    validate_variable_types,
)
from wavecore.api.services.suites import service as suite_service

# Create router for suite endpoints
router = APIRouter(tags=["Suites"])

# Name pattern: alphanumeric, spaces, hyphens, underscores
NAME_PATTERN = re.compile(r"^[a-zA-Z0-9 _-]+$")


def validate_suite_name(name: str) -> None:
    """Validate suite name format and length.

    Args:
        name: Suite name to validate

    Raises:
        ValidationException: If name is invalid
    """
    if not name or len(name) > 255:
        raise ValidationException("Suite name must be between 1 and 255 characters")

    if not NAME_PATTERN.match(name):
        raise ValidationException(
            f"Suite name '{name}' violates naming convention: must contain only "
            "alphanumeric characters, spaces, hyphens, and underscores"
        )


def _generate_etag(suite: dict[str, Any]) -> str:
    """Generate ETag for a suite.

    Args:
        suite: Suite data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{suite.get('id')}{suite.get('version')}{suite.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"

# Valid sort fields for suites
VALID_SORT_FIELDS = {"name", "testsCount", "status", "lastRun", "tags", "createdAt", "updatedAt"}
VALID_SORT_ORDERS = {"asc", "desc"}


# =============================================================================
# Tags Support
# =============================================================================


@router.get("/suites/tags")
async def list_tags_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all unique tags from all suites.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        List of unique tags sorted alphabetically
    """
    result = suite_service.list_all_tags()

    # Tags change when suites are modified
    response.headers["Cache-Control"] = _CACHE_CONTROL_60

    return {
        "success": True,
        "data": result,
        "meta": {
            "request_id": request.headers.get("X-Request-ID", ""),
        },
    }


@router.get("/suites/names")
async def list_suite_names_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all suites with minimal data for dropdowns.

    Returns lightweight list of suites with only id and name fields,
    sorted alphabetically by name. Designed for dropdown population.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        List of suites with id and name only
    """
    result = suite_service.list_suite_names()

    response.headers["Cache-Control"] = _CACHE_CONTROL_60

    return {
        "success": True,
        "data": result,
        "meta": {
            "request_id": request.headers.get("X-Request-ID", ""),
        },
    }


@router.get("/suites")
async def list_suites(
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    status: Annotated[str | None, Query(description="Comma-separated status filter")] = None,
    tags: Annotated[str | None, Query(description="Comma-separated tags filter")] = None,
    sort_by: Annotated[str | None, Query(description="Sort field")] = None,
    sort_order: Annotated[str | None, Query(description="Sort direction (asc or desc)")] = None,
) -> dict[str, Any]:
    """List all suites with filtering and pagination.

    Supports page-based pagination, text search, status/tags filtering, and sorting.

    Args:
        response: HTTP response for setting cache headers
        page: Page number (1-based)
        per_page: Number of results per page (1-100)
        search: Text search across names and descriptions
        status: Comma-separated status values (passed, failed, never_run)
        tags: Comma-separated tag values (all must match)
        sort_by: Sort field (name, testsCount, status, lastRun)
        sort_order: Sort direction (asc, desc)

    Returns:
        Paginated list of suites with metadata
    """
    # Validate sort_by if provided
    if sort_by is not None and sort_by not in VALID_SORT_FIELDS:
        raise ValidationException(
            f"Invalid sort_by value '{sort_by}'. "
            f"Allowed values: {', '.join(sorted(VALID_SORT_FIELDS))}"
        )

    # Validate sort_order if provided
    if sort_order is not None and sort_order not in VALID_SORT_ORDERS:
        raise ValidationException(
            f"Invalid sort_order value '{sort_order}'. "
            f"Allowed values: {', '.join(sorted(VALID_SORT_ORDERS))}"
        )

    # Parse comma-separated filters
    status_list = [s.strip() for s in status.split(",")] if status else None
    tags_list = [t.strip() for t in tags.split(",")] if tags else None

    # Set cache control headers
    response.headers["Cache-Control"] = _CACHE_CONTROL_60

    # Get suites from service
    result = suite_service.list_suites(
        page=page,
        per_page=per_page,
        search=search,
        status=status_list,
        tags=tags_list,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    return {
        "success": True,
        "data": result["suites"],
        "pagination": {
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
    }


@router.post("/suites", status_code=status_module.HTTP_201_CREATED)
async def create_suite(request: Request, response: Response) -> dict[str, Any]:
    """Create a new suite.

    Validates suite definition including naming conventions and test references.

    Args:
        request: HTTP request with suite data
        response: HTTP response for setting headers

    Returns:
        Created suite with metadata
    """
    body = await read_json_object(request)

    # Validate required fields
    if "name" not in body:
        raise ValidationException("Field 'name' is required")

    # Validate field values
    validate_suite_name(body["name"])

    # Validate variables if provided - convert ValueError to ValidationException
    if "variables" in body:
        try:
            validate_variable_types(body["variables"])
        except ValueError as e:
            raise ValidationException(str(e)) from e

        # Validate computed variable expressions
        for var_name, var_info in body["variables"].items():
            if isinstance(var_info, dict) and var_info.get("computed"):
                expression = var_info.get("expression", "")
                try:
                    validate_computed_expression(var_name, expression)
                except ValueError as e:
                    raise ValidationException(str(e)) from e

    # Create suite - ConflictException propagates to middleware
    suite = suite_service.create_suite(body)

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = "suites_list"

    return {"success": True, "data": suite}


@router.get("/suites/{suite_id}")
async def get_suite(suite_id: str, response: Response) -> dict[str, Any]:
    """Get suite by ID.

    Args:
        suite_id: Suite UUID
        response: HTTP response for setting headers

    Returns:
        Suite details with metadata
    """
    validate_uuid(suite_id, "suite_id")

    suite = suite_service.get_suite(suite_id)

    if suite is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    # Set ETag header for concurrency control
    response.headers["ETag"] = _generate_etag(suite)

    return {"success": True, "data": suite}


@router.put("/suites/{suite_id}")
async def update_suite(
    suite_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update suite.

    Args:
        suite_id: Suite UUID
        request: HTTP request with update data
        response: HTTP response for setting headers
        if_match: ETag for optimistic concurrency control

    Returns:
        Updated suite
    """
    validate_uuid(suite_id, "suite_id")

    body = await read_json_object(request)

    # Validate name if being updated
    if "name" in body:
        validate_suite_name(body["name"])

    # ConflictException propagates to middleware for etag/name conflicts
    result = suite_service.update_suite(suite_id, body, etag=if_match)

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    # Set new ETag and cache invalidation headers
    response.headers["ETag"] = _generate_etag(result)
    response.headers["X-Cache-Invalidated"] = f"suite_{suite_id},suites_list"

    return {"success": True, "data": result}


@router.delete("/suites/{suite_id}", status_code=status_module.HTTP_204_NO_CONTENT)
async def delete_suite(
    suite_id: str,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete suite.

    Enforces dependency checking to prevent orphaned regression references.

    Args:
        suite_id: Suite UUID
        response: HTTP response for setting headers
        if_match: ETag for optimistic concurrency control

    Returns:
        Empty response with 204 status code
    """
    from wavecore.api.exceptions import ConflictException

    # Check ETag if provided
    if if_match:
        suite = suite_service.get_suite(suite_id)
        if suite:
            current_etag = _generate_etag(suite)
            if if_match != current_etag:
                raise ConflictException("Precondition failed: resource has been modified")

    # ConflictException propagates to middleware for regression references
    deleted = suite_service.delete_suite(suite_id)

    if not deleted:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = "suites_list"

    return Response(
        status_code=status_module.HTTP_204_NO_CONTENT,
        headers={"X-Cache-Invalidated": "suites_list"},
    )
