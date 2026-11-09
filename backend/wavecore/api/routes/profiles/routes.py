"""Connection profile endpoints (REQ-5.2.4.8).

This module implements connection profile endpoints providing lifecycle operations
for connection profiles enabling creation, modification, type discovery, and
schema retrieval.

Endpoints:
- GET /profiles: List all profiles
- POST /profiles: Create profile
- GET /profiles/types: List profile types
- GET /profiles/types?include_descriptions=true: List types with descriptions
- GET /profiles/types/{type}/schema: Get type schema
- GET /profiles/tags: List all tags
- GET /profiles/{profile_id}: Get profile
- PUT /profiles/{profile_id}: Update profile
- DELETE /profiles/{profile_id}: Delete profile
- POST /profiles/{profile_id}/duplicate: Duplicate profile
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
from wavecore.api.services.profiles import service as profile_service

# Create router for profile endpoints
router = APIRouter(tags=["Profiles"])


def _generate_etag(profile: dict[str, Any]) -> str:
    """Generate ETag for a profile.

    Args:
        profile: Profile data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{profile.get('id')}{profile.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


# =============================================================================
# Static/specific routes MUST come BEFORE parameterized routes
# FastAPI matches routes in order of definition
# =============================================================================


@router.get("/profiles/types")
async def list_profile_types(
    request: Request,
    response: Response,
    include_descriptions: bool = False,
) -> dict[str, Any]:
    """List available profile types.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers
        include_descriptions: Include type descriptions if true

    Returns:
        List of profile types
    """
    # Types are static, set long cache
    response.headers["Cache-Control"] = "max-age=3600"

    if include_descriptions:
        return {
            "success": True,
            "data": profile_service.list_profile_types_with_descriptions(),
            "meta": build_response_meta(request),
        }

    return {
        "success": True,
        "data": profile_service.list_profile_types(),
        "meta": build_response_meta(request),
    }


@router.get("/profiles/types/{profile_type}/schema")
async def get_profile_type_schema(
    profile_type: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Get JSON Schema for a profile type.

    Args:
        profile_type: Profile type name
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        Type schema
    """
    result = profile_service.get_type_schema(profile_type)

    if result is None:
        raise NotFoundException(f"Profile type '{profile_type}' not found")

    # Schemas are static, set long cache
    response.headers["Cache-Control"] = "max-age=3600"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


# =============================================================================
# Collection routes (no path params after /profiles)
# =============================================================================


@router.get("/profiles/tags")
async def list_tags_endpoint(request: Request, response: Response) -> dict[str, Any]:
    """Get all unique tags from all profiles.

    Args:
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        List of unique tags
    """
    result = profile_service.list_all_tags()

    # Tags change when profiles are modified
    response.headers["Cache-Control"] = "max-age=60"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


def _validate_list_params(
    page: int | None,
    per_page: int | None,
    sort_order: str | None,
) -> None:
    """Validate pagination and sort parameters for list_profiles.

    Args:
        page: Page number (1-based)
        per_page: Items per page (1-100)
        sort_order: Sort order (asc, desc)

    Raises:
        ValidationException: If any parameter is invalid
    """
    if page is not None and page < 1:
        raise ValidationException("Page must be at least 1")

    if per_page is not None and (per_page < 1 or per_page > 100):
        raise ValidationException("Per page must be between 1 and 100")

    if sort_order is not None and sort_order not in ("asc", "desc"):
        raise ValidationException("Sort order must be 'asc' or 'desc'")


def _build_pagination(
    result: list[Any] | dict[str, Any],
    page: int | None,
    per_page: int | None,
    sort_by: str | None,
    actual_sort_order: str | None,
) -> tuple[list[Any], dict[str, Any]]:
    """Extract profiles and build pagination from service result.

    Args:
        result: Service result (list or dict)
        page: Requested page number
        per_page: Requested items per page
        sort_by: Sort field
        actual_sort_order: Resolved sort order

    Returns:
        Tuple of (profiles list, pagination dict)
    """
    if isinstance(result, list):
        # Legacy format from test mocks - wrap in response format
        return result, {
            "page": page if page is not None else 1,
            "per_page": per_page if per_page is not None else 20,
            "total": len(result),
            "total_pages": 1,
            "sort_by": sort_by,
            "sort_order": actual_sort_order,
        }

    # New pagination structure from real implementation
    return result["profiles"], {
        "page": result["page"],
        "per_page": result["per_page"],
        "total": result["total"],
        "total_pages": result["total_pages"],
        "sort_by": sort_by,
        "sort_order": actual_sort_order,
    }


@router.get("/profiles")
async def list_profiles(
    request: Request,
    tags: Annotated[list[str] | None, Query()] = None,
    search: str | None = None,
    type: str | None = None,
    page: int | None = None,
    per_page: int | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
) -> dict[str, Any]:
    """List all connection profiles.

    Args:
        request: HTTP request for meta info
        tags: Filter by tags (AND logic)
        search: Search filter for name
        type: Filter by profile type
        page: Page number (1-based)
        per_page: Items per page
        sort_by: Field to sort by (name, type)
        sort_order: Sort order (asc, desc)

    Returns:
        List of profiles with masked secrets, or paginated result
    """
    _validate_list_params(page, per_page, sort_order)

    # Default sort_order to 'asc' if sort_by is provided
    default_sort_order = "asc" if sort_by else None
    actual_sort_order = sort_order if sort_order else default_sort_order

    result = profile_service.list_profiles(
        tags=tags if tags else None,
        search=search,
        profile_type=type,
        page=page,
        per_page=per_page,
        sort_by=sort_by,
        sort_order=actual_sort_order,
    )

    # Handle both list (old mocks in tests) and dict (real implementation) formats
    profiles, pagination = _build_pagination(result, page, per_page, sort_by, actual_sort_order)

    return {
        "success": True,
        "data": profiles,
        "pagination": pagination,
        "meta": build_response_meta(request),
    }


def _validate_tags(tags: Any) -> list[str] | None:
    """Validate tags field.

    Args:
        tags: Tags value from request body

    Returns:
        Validated and trimmed tags list

    Raises:
        ValidationException: If tags format is invalid
    """
    if tags is None:
        return None

    if not isinstance(tags, list):
        raise ValidationException("Field 'tags' must be a list of strings")

    result: list[str] = []
    for tag in tags:
        if not isinstance(tag, str):
            raise ValidationException("Field 'tags' must contain only strings")
        # Check for empty tags first
        if tag == "":
            raise ValidationException("Tags cannot contain empty strings")
        # Check for whitespace-only tags
        trimmed = tag.strip()
        if not trimmed:
            raise ValidationException("Tags cannot contain empty or whitespace-only strings")
        result.append(trimmed)

    return result


@router.post("/profiles", status_code=status.HTTP_201_CREATED)
async def create_profile(request: Request, response: Response) -> dict[str, Any]:
    """Create a new connection profile.

    Args:
        request: HTTP request with profile data
        response: HTTP response for setting headers

    Returns:
        Created profile with masked secrets
    """
    body = await read_json_object(request)

    # Validate required fields
    if "name" not in body:
        raise ValidationException("Field 'name' is required")

    if "type" not in body:
        raise ValidationException("Field 'type' is required")

    # Validate tags if present
    tags = _validate_tags(body.get("tags"))

    result = profile_service.create_profile(
        name=body["name"],
        profile_type=body["type"],
        config=body.get("config"),
        description=body.get("description"),
        tags=tags,
        environment_values=body.get("environment_values"),
    )

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = "profiles"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


# =============================================================================
# Parameterized routes (these match anything, so must come AFTER specific routes)
# =============================================================================


@router.get("/profiles/{profile_id}")
async def get_profile(
    profile_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Get a connection profile by ID.

    Args:
        profile_id: Profile UUID
        request: HTTP request for meta info
        response: HTTP response for setting cache headers

    Returns:
        Profile with masked secrets
    """
    validate_uuid(profile_id, "profile_id")

    result = profile_service.get_profile(profile_id)

    if result is None:
        raise NotFoundException(f"Profile with ID '{profile_id}' not found")

    # Set cache header
    response.headers["Cache-Control"] = "max-age=60"

    # Set ETag header for concurrency control
    response.headers["ETag"] = _generate_etag(result)

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.put("/profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    request: Request,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update a connection profile.

    Args:
        profile_id: Profile UUID
        request: HTTP request with update data
        response: HTTP response for setting headers
        if_match: Optional ETag for concurrency control

    Returns:
        Updated profile with masked secrets
    """
    validate_uuid(profile_id, "profile_id")

    body = await read_json_object(request)

    # Build kwargs for update - only include fields if explicitly provided
    update_kwargs: dict[str, Any] = {
        "name": body.get("name"),
        "config": body.get("config"),
    }

    # Only pass tags if explicitly in body (to avoid breaking old tests)
    if "tags" in body:
        update_kwargs["tags"] = _validate_tags(body["tags"])

    # Only pass description if explicitly in body (omitting leaves it unchanged)
    if "description" in body:
        update_kwargs["description"] = body["description"]

    # Only pass environment_values if explicitly in body
    if "environment_values" in body:
        update_kwargs["environment_values"] = body["environment_values"]

    # Pass ETag for concurrency control if provided
    if if_match:
        update_kwargs["etag"] = if_match

    result = profile_service.update_profile(
        profile_id,
        **update_kwargs,
    )

    if result is None:
        raise NotFoundException(f"Profile with ID '{profile_id}' not found")

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = "profiles"

    # Set new ETag header
    response.headers["ETag"] = _generate_etag(result)

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: str,
    response: Response,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete a connection profile.

    Args:
        profile_id: Profile UUID
        response: HTTP response for setting headers
        if_match: Optional ETag for concurrency control

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(profile_id, "profile_id")

    # Check ETag if provided
    if if_match:
        profile = profile_service.get_profile(profile_id)
        if profile:
            current_etag = _generate_etag(profile)
            if if_match != current_etag:
                exc = ConflictException("Precondition failed: resource has been modified")
                exc.status_code = 412
                exc.error_code = "PRECONDITION_FAILED"
                raise exc

    deleted = profile_service.delete_profile(profile_id)

    if not deleted:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "success": False,
                "error": {
                    "message": f"Profile with ID '{profile_id}' not found",
                    "code": "NOT_FOUND",
                },
            },
        )

    # Set cache invalidation header on the response object and return it
    response.status_code = status.HTTP_204_NO_CONTENT
    response.headers["X-Cache-Invalidated"] = "profiles"

    return response


def _validate_duplicate_name(raw_name: Any) -> str:
    """Validate and normalize a duplicate profile name from request body.

    Args:
        raw_name: The new_name value from the request body

    Returns:
        Stripped name string if valid

    Raises:
        ValidationException: If name is empty or not a string
    """
    if not isinstance(raw_name, str) or not raw_name.strip():
        raise ValidationException("Name cannot be empty")
    return raw_name.strip()


async def _resolve_duplicate_name(request: Request, profile_id: str) -> str:
    """Resolve the name for a duplicated profile.

    Parses the request body for an explicit new_name, falling back to
    auto-generating one from the original profile name.

    Args:
        request: HTTP request with optional JSON body
        profile_id: ID of the profile being duplicated

    Returns:
        Resolved name string

    Raises:
        NotFoundException: If original profile not found
        ValidationException: If provided name is invalid
    """
    try:
        body = await read_json_object(request)
    except ValidationException:
        # No body, or one that is not a JSON object: generate the name
        body = {}
    if "new_name" in body:
        return _validate_duplicate_name(body["new_name"])

    original = profile_service.get_profile(profile_id)
    if original is None:
        raise NotFoundException(f"Profile with ID '{profile_id}' not found")
    return f"{original['name']} (Copy)"


@router.post("/profiles/{profile_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate_profile(
    profile_id: str,
    request: Request,
    response: Response,
) -> dict[str, Any]:
    """Duplicate a connection profile with a new name.

    Args:
        profile_id: Profile UUID to duplicate
        request: HTTP request with optional new name
        response: HTTP response for setting headers

    Returns:
        New profile with masked secrets
    """
    validate_uuid(profile_id, "profile_id")

    new_name = await _resolve_duplicate_name(request, profile_id)

    result = profile_service.duplicate_profile(profile_id, new_name=new_name)

    if result is None:
        raise NotFoundException(f"Profile with ID '{profile_id}' not found")

    # Set cache invalidation header
    response.headers["X-Cache-Invalidated"] = "profiles"

    return {
        "success": True,
        "data": result,
        "meta": build_response_meta(request),
    }
