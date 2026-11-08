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

import re
import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi import status as http_status
from fastapi.responses import JSONResponse

from wavecore.api.routes.shared import read_json_object
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.regressions import version_service as _reg_version_svc

# Create router for regression version endpoints
router = APIRouter(tags=["Regressions"])

# Semantic version pattern
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")

# Reusable string constants
_CACHE_CONTROL_60 = "max-age=60"
_ERR_PRECONDITION = "Precondition failed"


def validate_uuid(value: str, field_name: str = "regression_id") -> str:
    """Validate UUID format."""
    try:
        uuid.UUID(value)
        return value
    except ValueError as e:
        id_type = field_name.replace("_id", " ID").replace("_", " ")
        raise ValueError(f"Invalid {id_type} format: '{value}' is not a valid UUID") from e


@router.get("/regressions/{regression_id}/versions", response_model=None)
async def list_regression_versions(regression_id: str) -> dict[str, Any] | JSONResponse:
    """List all versions for a regression.

    Args:
        regression_id: Regression UUID

    Returns:
        List of version info
    """
    try:
        validate_uuid(regression_id, "regression_id")

        versions = _reg_version_svc.list_regression_versions(regression_id)

        if versions is None:
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

        return {"success": True, "data": versions}

    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post(
    "/regressions/{regression_id}/versions",
    status_code=http_status.HTTP_201_CREATED,
    response_model=None,
)
async def add_regression_version(
    regression_id: str, request: Request
) -> dict[str, Any] | JSONResponse:
    """Add a new version to a regression.

    Args:
        regression_id: Regression UUID
        request: HTTP request with version data

    Returns:
        Created regression version
    """
    try:
        validate_uuid(regression_id, "regression_id")

        body = await read_json_object(request)

        result = _reg_version_svc.add_regression_version(regression_id, body)

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

        return {"success": True, "data": result}

    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.get("/regressions/{regression_id}/versions/{version}", response_model=None)
async def get_regression_version(
    regression_id: str, version: str, response: Response
) -> dict[str, Any] | JSONResponse:
    """Get specific regression version.

    Args:
        regression_id: Regression UUID
        version: Semantic version string
        response: HTTP response for setting cache headers

    Returns:
        Regression version details
    """
    try:
        validate_uuid(regression_id, "regression_id")

        if not SEMVER_PATTERN.match(version):
            raise ValueError(f"Invalid version format: '{version}' must follow semantic versioning")

        result = _reg_version_svc.get_regression_version(regression_id, version)

        if result is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": (
                            f"Regression version '{version}' not found "
                            f"for regression '{regression_id}'"
                        ),
                        "code": "NOT_FOUND",
                    },
                },
            )

        current = regression_service.get_regression(regression_id)
        if current and result.get("version") != current.get("version"):
            response.headers["Cache-Control"] = "max-age=3600"
        else:
            response.headers["Cache-Control"] = _CACHE_CONTROL_60

        return {"success": True, "data": result}

    except ValueError as e:
        return JSONResponse(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.put("/regressions/{regression_id}/versions/{version}", response_model=None)
async def update_regression_version(
    regression_id: str,
    version: str,
    request: Request,
) -> dict[str, Any] | JSONResponse:
    """Update specific regression version metadata.

    Args:
        regression_id: Regression UUID
        version: Semantic version string
        request: HTTP request with update data

    Returns:
        Updated regression version
    """
    try:
        validate_uuid(regression_id, "regression_id")

        body = await read_json_object(request)

        result = _reg_version_svc.update_regression_version(regression_id, version, body)

        if result is None:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": (
                            f"Version '{version}' not found for regression '{regression_id}'"
                        ),
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except ValueError as e:
        error_message = str(e)

        if _ERR_PRECONDITION in error_message:
            status_code = http_status.HTTP_412_PRECONDITION_FAILED
        else:
            status_code = http_status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )


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
    try:
        validate_uuid(regression_id, "regression_id")

        deleted = _reg_version_svc.delete_regression_version(regression_id, version)

        if not deleted:
            return JSONResponse(
                status_code=http_status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": (
                            f"Version '{version}' not found for regression '{regression_id}'"
                        ),
                        "code": "NOT_FOUND",
                    },
                },
            )

        return Response(status_code=http_status.HTTP_204_NO_CONTENT)

    except ValueError as e:
        error_message = str(e)

        if "Cannot delete" in error_message:
            status_code = http_status.HTTP_409_CONFLICT
        else:
            status_code = http_status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "CONFLICT"},
            },
        )
