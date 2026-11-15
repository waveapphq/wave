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

from wavecore.api.exceptions import NotFoundException
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.routes.tests.routes import missing_test
from wavecore.api.services.tests import service as test_service

# Create router for test version endpoints
router = APIRouter(tags=["Tests"])


@router.post("/tests/{test_id}/versions", status_code=status.HTTP_201_CREATED)
async def add_test_version(test_id: str, request: Request) -> dict[str, Any]:
    """Add a new version to a test.

    Args:
        test_id: Test UUID
        request: HTTP request with version data

    Returns:
        Created test version
    """
    validate_uuid(test_id, "test_id")

    body = await read_json_object(request)

    result = test_service.add_test_version(test_id, body)

    if result is None:
        raise missing_test(test_id)

    return {"success": True, "data": result}


@router.delete("/tests/{test_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_version(test_id: str, version: str) -> Response:
    """Delete specific test version.

    Args:
        test_id: Test UUID
        version: Semantic version string

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(test_id, "test_id")

    # ConflictException propagates to the error handler for a referenced version
    if not test_service.delete_test_version(test_id, version):
        raise NotFoundException(f"Version '{version}' not found for test '{test_id}'")

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/tests/{test_id}/history")
async def get_test_history(test_id: str) -> dict[str, Any]:
    """Get complete version history for a test.

    Provides version audit trail with change descriptions.

    Args:
        test_id: Test UUID

    Returns:
        Version history
    """
    validate_uuid(test_id, "test_id")

    result = test_service.get_test_history(test_id)

    if result is None:
        raise missing_test(test_id)

    return {"success": True, "data": result, "versions": result["versions"]}


@router.post("/tests/{test_id}/restore/{version}")
async def restore_test_version(test_id: str, version: str) -> dict[str, Any]:
    """Restore test to a specific version.

    Creates a new version from historical snapshot.

    Args:
        test_id: Test UUID
        version: Version to restore to

    Returns:
        Test with new version created from restore
    """
    validate_uuid(test_id, "test_id")

    # NotFoundException propagates to the error handler for a missing version
    result = test_service.restore_test_version(test_id, version)

    if result is None:
        raise missing_test(test_id)

    return {"success": True, "data": result}
