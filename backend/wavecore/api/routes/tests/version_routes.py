"""Test version management endpoints.

This module implements version management endpoints for test entities,
providing CRUD operations on test version history.

Endpoints:
- POST /tests/{test_id}/versions: Add new test version
- DELETE /tests/{test_id}/versions/{version}: Delete specific version
- GET /tests/{test_id}/history: Get version history
- POST /tests/{test_id}/restore/{version}: Restore to version
"""

from typing import Any

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.tests import service as test_service

# Create router for test version endpoints
router = APIRouter(tags=["Tests"])


@router.post("/tests/{test_id}/versions", status_code=status.HTTP_201_CREATED, response_model=None)
async def add_test_version(test_id: str, request: Request) -> dict[str, Any] | JSONResponse:
    """Add a new version to a test.

    Args:
        test_id: Test UUID
        request: HTTP request with version data

    Returns:
        Created test version
    """
    try:
        validate_uuid(test_id, "test_id")

        body = await read_json_object(request)

        result = test_service.add_test_version(test_id, body)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "VALIDATION_ERROR"},
            },
        )


@router.delete("/tests/{test_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_version(test_id: str, version: str) -> Response:
    """Delete specific test version.

    Args:
        test_id: Test UUID
        version: Semantic version string

    Returns:
        Empty response with 204 status code
    """
    try:
        validate_uuid(test_id, "test_id")

        deleted = test_service.delete_test_version(test_id, version)

        if not deleted:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Version '{version}' not found for test '{test_id}'",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except (ValueError, ValidationException) as e:
        error_message = str(e)

        if "Cannot delete" in error_message:
            status_code = status.HTTP_409_CONFLICT
        else:
            status_code = status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "CONFLICT"},
            },
        )


@router.get("/tests/{test_id}/history", response_model=None)
async def get_test_history(test_id: str) -> dict[str, Any] | JSONResponse:
    """Get complete version history for a test.

    Provides version audit trail with change descriptions.

    Args:
        test_id: Test UUID

    Returns:
        Version history
    """
    try:
        validate_uuid(test_id, "test_id")

        result = test_service.get_test_history(test_id)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result, "versions": result["versions"]}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


@router.post("/tests/{test_id}/restore/{version}", response_model=None)
async def restore_test_version(test_id: str, version: str) -> dict[str, Any] | JSONResponse:
    """Restore test to a specific version.

    Creates a new version from historical snapshot.

    Args:
        test_id: Test UUID
        version: Version to restore to

    Returns:
        Test with new version created from restore
    """
    try:
        validate_uuid(test_id, "test_id")

        result = test_service.restore_test_version(test_id, version)

        if result is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Test with ID '{test_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return {"success": True, "data": result}

    except (ValueError, ValidationException) as e:
        error_message = str(e)

        if "not found" in error_message.lower():
            status_code = status.HTTP_404_NOT_FOUND
        else:
            status_code = status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )
