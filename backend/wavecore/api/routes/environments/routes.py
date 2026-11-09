"""Environment endpoints (REQ-5.2.1.42).

This module implements environment endpoints providing lifecycle operations
for environment management enabling creation, modification, duplication,
listing, and deletion with usage protection.

Endpoints:
- GET /environments: List all environments with pagination
- POST /environments: Create environment
- GET /environments/tags: List all tags
- GET /environments/names: List environment names for dropdowns
- GET /{environment_id}: Get environment
- PUT /{environment_id}: Update environment
- DELETE /{environment_id}: Delete environment
- POST /{environment_id}/duplicate: Duplicate environment
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    ValidationException,
)
from wavecore.api.routes.shared import build_response_meta, read_json_object, validate_uuid
from wavecore.api.services.environments import service as environment_service

# Create router for environment endpoints
router = APIRouter(prefix="/environments", tags=["Environments"])

# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"

# Valid sort fields for environments
VALID_SORT_FIELDS = {"name", "description", "created_at", "updated_at", "tags", "usage"}
VALID_SORT_DIRECTIONS = {"asc", "desc"}


def _parse_sort_param(sort: str | None) -> tuple[str | None, str | None]:
    """Parse sort parameter into field and direction.

    Args:
        sort: Sort parameter in format "field:direction"

    Returns:
        Tuple of (sort_by, sort_direction)

    Raises:
        ValueError: If sort format is invalid
    """
    if sort is None:
        return None, None

    # Split and handle malformed input gracefully
    parts = sort.split(":")
    field = parts[0] if parts else ""
    direction = parts[1] if len(parts) > 1 else ""

    if field not in VALID_SORT_FIELDS:
        raise ValidationException(
            f"Invalid sort field: '{field}'. Valid fields: {', '.join(sorted(VALID_SORT_FIELDS))}"
        )

    if direction not in VALID_SORT_DIRECTIONS:
        raise ValidationException(
            f"Invalid sort direction: '{direction}'. Valid directions: asc, desc"
        )

    return field, direction


def _generate_etag(environment: dict[str, Any]) -> str:
    """Generate ETag for an environment.

    Args:
        environment: Environment data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{environment.get('id')}{environment.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


# =============================================================================
# Collection routes (no path params after /environments)
# =============================================================================


@router.get("/tags")
async def list_tags_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all unique tags from all environments."""
    result = environment_service.list_all_tags()
    response.headers["Cache-Control"] = _CACHE_CONTROL_60
    return {
        "success": True,
        "data": result,
        "meta": {"request_id": request.headers.get("X-Request-ID", "")},
    }


@router.get("/names")
async def list_environment_names_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all environments with minimal data for dropdowns."""
    result = environment_service.list_environment_names()
    response.headers["Cache-Control"] = _CACHE_CONTROL_60
    return {
        "success": True,
        "data": result,
        "meta": {"request_id": request.headers.get("X-Request-ID", "")},
    }


@router.get("")
async def list_environments(
    request: Request,
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Items per page")] = 20,
    search: Annotated[str | None, Query(description="Search term")] = None,
    tags: Annotated[str | None, Query(description="Filter by tags (comma-separated)")] = None,
    sort: Annotated[str | None, Query(description="Sort field:direction")] = None,
) -> dict[str, Any]:
    """List all environments with pagination."""
    tags_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    sort_by, sort_direction = _parse_sort_param(sort)

    if sort_by is not None:
        result = environment_service.list_environments(
            page=page,
            per_page=per_page,
            search=search,
            tags=tags_list,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    else:
        result = environment_service.list_environments(
            page=page,
            per_page=per_page,
            search=search,
            tags=tags_list,
        )

    response.headers["Cache-Control"] = _CACHE_CONTROL_60
    return {
        "success": True,
        "data": result["environments"],
        "pagination": {
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
        "meta": build_response_meta(request),
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_environment(request: Request, response: Response) -> dict[str, Any]:
    """Create a new environment."""
    body = await read_json_object(request)
    if "name" not in body:
        raise ValidationException("Field 'name' is required")

    result = environment_service.create_environment(
        name=body["name"],
        description=body.get("description"),
        tags=body.get("tags"),
    )
    response.headers["X-Cache-Invalidated"] = "environments"
    return {"success": True, "data": result, "meta": build_response_meta(request)}


# =============================================================================
# Parameterized routes (these match anything, so must come AFTER specific routes)
# =============================================================================


@router.post("/{environment_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_environment(
    environment_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Duplicate an existing environment."""
    validate_uuid(environment_id, "environment_id")
    result = environment_service.duplicate_environment(environment_id)
    if result is None:
        raise NotFoundException(f"Environment with ID '{environment_id}' not found")
    response.headers["X-Cache-Invalidated"] = "environments"
    return {"success": True, "data": result, "meta": build_response_meta(request)}


@router.get("/{environment_id}")
async def get_environment(
    environment_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Get an environment by ID."""
    validate_uuid(environment_id, "environment_id")
    result = environment_service.get_environment(environment_id)
    if result is None:
        raise NotFoundException(f"Environment with ID '{environment_id}' not found")
    response.headers["Cache-Control"] = _CACHE_CONTROL_60
    response.headers["ETag"] = _generate_etag(result)
    return {"success": True, "data": result, "meta": build_response_meta(request)}


@router.put("/{environment_id}")
async def update_environment(
    environment_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update an environment."""
    validate_uuid(environment_id, "environment_id")
    body = await read_json_object(request)

    if "name" not in body and "description" not in body and "tags" not in body:
        raise ValidationException("At least one field (name, description, or tags) is required")

    update_kwargs: dict[str, Any] = {
        "environment_id": environment_id,
        "name": body.get("name"),
        "description": body.get("description"),
        "tags": body.get("tags"),
    }
    if if_match:
        update_kwargs["etag"] = if_match

    result = environment_service.update_environment(**update_kwargs)
    if result is None:
        raise NotFoundException(f"Environment with ID '{environment_id}' not found")

    response.headers["X-Cache-Invalidated"] = "environments"
    response.headers["ETag"] = _generate_etag(result)
    return {"success": True, "data": result, "meta": build_response_meta(request)}


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(
    environment_id: str,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete an environment."""
    validate_uuid(environment_id, "environment_id")

    if if_match:
        env = environment_service.get_environment(environment_id)
        if env:
            current_etag = _generate_etag(env)
            if if_match != current_etag:
                exc = ConflictException("Precondition failed: resource has been modified")
                exc.status_code = 412
                exc.error_code = "PRECONDITION_FAILED"
                raise exc

    deleted = environment_service.delete_environment(environment_id)
    if not deleted:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {
                    "message": f"Environment with ID '{environment_id}' not found",
                    "code": "NOT_FOUND",
                },
            },
        )

    response.status_code = status.HTTP_204_NO_CONTENT
    response.headers["X-Cache-Invalidated"] = "environments"
    return response
