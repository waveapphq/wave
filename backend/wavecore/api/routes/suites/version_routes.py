"""Suite version management endpoints.

This module implements version management endpoints for suite entities,
providing CRUD operations on suite version history.

Endpoints:
- GET /suites/{suite_id}/versions: List suite versions
- POST /suites/{suite_id}/versions: Add new suite version
- GET /suites/{suite_id}/versions/{version}: Get specific version
- PUT /suites/{suite_id}/versions/{version}: Update specific version
- DELETE /suites/{suite_id}/versions/{version}: Delete specific version
"""

from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi import status as status_module
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.suites import version_service as _suite_version_svc

# Create router for suite version endpoints
router = APIRouter(tags=["Suites"])

# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"


@router.get("/suites/{suite_id}/versions", response_model=None)
async def list_suite_versions(suite_id: str) -> dict[str, Any] | JSONResponse:
    """List all versions for a suite.

    Args:
        suite_id: Suite UUID

    Returns:
        List of version strings
    """
    try:
        validate_uuid(suite_id, "suite_id")

        versions = _suite_version_svc.list_suite_versions(suite_id)

        if versions is None:
            return JSONResponse(
                status_code=status_module.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Suite with ID '{suite_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": versions}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status_module.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post("/suites/{suite_id}/versions", status_code=status_module.HTTP_201_CREATED)
async def add_suite_version(suite_id: str, request: Request) -> dict[str, Any]:
    """Add a new version to a suite.

    Args:
        suite_id: Suite UUID
        request: HTTP request with version data

    Returns:
        Created suite version
    """
    validate_uuid(suite_id, "suite_id")

    body = await read_json_object(request)

    result = _suite_version_svc.add_suite_version(suite_id, body)

    if result is None:
        raise NotFoundException(f"Suite with ID '{suite_id}' not found")

    return {"success": True, "data": result}


@router.get("/suites/{suite_id}/versions/{version}")
async def get_suite_version(suite_id: str, version: str, response: Response) -> dict[str, Any]:
    """Get specific suite version.

    Args:
        suite_id: Suite UUID
        version: Semantic version string
        response: HTTP response for setting cache headers

    Returns:
        Suite version details
    """
    validate_uuid(suite_id, "suite_id")

    result = _suite_version_svc.get_suite_version(suite_id, version)

    if result is None:
        raise NotFoundException(f"Suite version '{version}' not found for suite '{suite_id}'")

    # Set cache headers based on whether this is latest version
    if result.get("is_latest") is False:
        response.headers["Cache-Control"] = "max-age=3600"
    else:
        response.headers["Cache-Control"] = _CACHE_CONTROL_60

    return {"success": True, "data": result}


@router.put("/suites/{suite_id}/versions/{version}")
async def update_suite_version(
    suite_id: str,
    version: str,
    request: Request,
) -> dict[str, Any]:
    """Update specific suite version metadata.

    Args:
        suite_id: Suite UUID
        version: Semantic version string
        request: HTTP request with update data

    Returns:
        Updated suite version
    """
    validate_uuid(suite_id, "suite_id")

    body = await read_json_object(request)

    # ConflictException propagates to middleware for published versions
    result = _suite_version_svc.update_suite_version(suite_id, version, body)

    if result is None:
        raise NotFoundException(f"Version '{version}' not found for suite '{suite_id}'")

    return {"success": True, "data": result}


@router.delete(
    "/suites/{suite_id}/versions/{version}", status_code=status_module.HTTP_204_NO_CONTENT
)
async def delete_suite_version(suite_id: str, version: str) -> Response:
    """Delete specific suite version.

    Args:
        suite_id: Suite UUID
        version: Semantic version string

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(suite_id, "suite_id")

    # ConflictException propagates to middleware for referenced versions
    deleted = _suite_version_svc.delete_suite_version(suite_id, version)

    if not deleted:
        raise NotFoundException(f"Version '{version}' not found for suite '{suite_id}'")

    return Response(status_code=status_module.HTTP_204_NO_CONTENT)
