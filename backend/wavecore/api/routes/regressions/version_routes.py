"""Regression version management endpoints.

This module implements version management endpoints for regression entities,
providing CRUD operations on regression version history.

Endpoints:
- GET /regressions/{regression_id}/versions: List regression versions
- POST /regressions/{regression_id}/versions: Add new version
- GET /regressions/{regression_id}/versions/{version}: Get specific version
- PUT /regressions/{regression_id}/versions/{version}: Update specific version
- DELETE /regressions/{regression_id}/versions/{version}: Delete specific version
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response
from fastapi import status as http_status

from wavecore.api.exceptions import NotFoundException
from wavecore.api.routes.regressions.routes import regression_not_found
from wavecore.api.routes.shared import read_json_object, refuse_stale_etag, validate_uuid
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.regressions import version_service as _reg_version_svc
from wavecore.api.services.shared import validate_semantic_version

# Create router for regression version endpoints
router = APIRouter(tags=["Regressions"])

# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"


def _no_version(regression_id: str, version: str) -> NotFoundException:
    """The 404 for a version the regression does not have."""
    return NotFoundException(f"Version '{version}' not found for regression '{regression_id}'")


@router.get("/regressions/{regression_id}/versions", response_model=None)
async def list_regression_versions(regression_id: str) -> dict[str, Any]:
    """List all versions for a regression.

    Args:
        regression_id: Regression UUID

    Returns:
        List of version info
    """
    validate_uuid(regression_id, "regression_id")

    versions = _reg_version_svc.list_regression_versions(regression_id)

    if versions is None:
        raise regression_not_found(regression_id)

    return {"success": True, "data": versions}


@router.post(
    "/regressions/{regression_id}/versions",
    status_code=http_status.HTTP_201_CREATED,
    response_model=None,
)
async def add_regression_version(regression_id: str, request: Request) -> dict[str, Any]:
    """Add a new version to a regression.

    Args:
        regression_id: Regression UUID
        request: HTTP request with version data

    Returns:
        Created regression version
    """
    validate_uuid(regression_id, "regression_id")

    body = await read_json_object(request)

    result = _reg_version_svc.add_regression_version(regression_id, body)

    if result is None:
        raise regression_not_found(regression_id)

    return {"success": True, "data": result}


@router.get("/regressions/{regression_id}/versions/{version}", response_model=None)
async def get_regression_version(
    regression_id: str, version: str, response: Response
) -> dict[str, Any]:
    """Get specific regression version.

    Args:
        regression_id: Regression UUID
        version: Semantic version string
        response: HTTP response for setting cache headers

    Returns:
        Regression version details
    """
    validate_uuid(regression_id, "regression_id")
    validate_semantic_version(version)

    result = _reg_version_svc.get_regression_version(regression_id, version)

    if result is None:
        raise NotFoundException(
            f"Regression version '{version}' not found for regression '{regression_id}'"
        )

    current = regression_service.get_regression(regression_id)
    if current and result.get("version") != current.get("version"):
        response.headers["Cache-Control"] = "max-age=3600"
    else:
        response.headers["Cache-Control"] = _CACHE_CONTROL_60

    return {"success": True, "data": result}


@router.put("/regressions/{regression_id}/versions/{version}", response_model=None)
async def update_regression_version(
    regression_id: str,
    version: str,
    request: Request,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update specific regression version metadata.

    Args:
        regression_id: Regression UUID
        version: Semantic version string
        request: HTTP request with update data
        if_match: ETag for optimistic concurrency control

    Returns:
        Updated regression version
    """
    validate_uuid(regression_id, "regression_id")
    refuse_stale_etag(if_match, regression_service.get_regression, regression_id)

    body = await read_json_object(request)

    result = _reg_version_svc.update_regression_version(regression_id, version, body)

    if result is None:
        raise _no_version(regression_id, version)

    return {"success": True, "data": result}


@router.delete(
    "/regressions/{regression_id}/versions/{version}",
    status_code=http_status.HTTP_204_NO_CONTENT,
)
async def delete_regression_version(regression_id: str, version: str) -> Response:
    """Delete specific regression version.

    Args:
        regression_id: Regression UUID
        version: Semantic version string

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(regression_id, "regression_id")

    if not _reg_version_svc.delete_regression_version(regression_id, version):
        raise _no_version(regression_id, version)

    return Response(status_code=http_status.HTTP_204_NO_CONTENT)
