"""Block version management endpoints.

This module implements version management endpoints for block entities,
providing CRUD operations on block version history.

Endpoints:
- GET /blocks/{block_id}/versions: List block versions
- POST /blocks/{block_id}/versions: Add new block version
- GET /blocks/{block_id}/versions/{version}: Get specific version
- PUT /blocks/{block_id}/versions/{version}: Update specific version
- DELETE /blocks/{block_id}/versions/{version}: Delete specific version
- GET /blocks/{block_id}/history: Get version history
- POST /blocks/{block_id}/restore/{version}: Restore to version
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, Request, Response, status

from wavecore.api.exceptions import NotFoundException
from wavecore.api.routes.blocks.routes import block_not_found
from wavecore.api.routes.shared import read_json_object, validate_uuid
from wavecore.api.services.blocks import version_service as _block_version_svc

# Create router for block version endpoints
router = APIRouter(tags=["Blocks"], prefix="/blocks")


def _no_version(block_id: str, version: str) -> NotFoundException:
    """The 404 for a version the block does not have."""
    return NotFoundException(f"Version '{version}' not found for block '{block_id}'")


@router.get("/{block_id}/versions", response_model=None)
async def list_block_versions(block_id: str) -> dict[str, Any]:
    """List all versions for a block.

    Args:
        block_id: Block UUID

    Returns:
        List of version strings
    """
    validate_uuid(block_id, "block_id")

    versions = _block_version_svc.list_block_versions(block_id)

    if versions is None:
        raise block_not_found(block_id)

    return {"success": True, "data": versions}


@router.post("/{block_id}/versions", status_code=status.HTTP_201_CREATED, response_model=None)
async def add_block_version(block_id: str, request: Request) -> dict[str, Any]:
    """Add a new version to a block.

    Args:
        block_id: Block UUID
        request: HTTP request with version data

    Returns:
        Created block version
    """
    validate_uuid(block_id, "block_id")

    body = await read_json_object(request)

    result = _block_version_svc.add_block_version(block_id, body)

    if result is None:
        raise block_not_found(block_id)

    return {"success": True, "data": result}


@router.get("/{block_id}/versions/{version}", response_model=None)
async def get_block_version(block_id: str, version: str, response: Response) -> dict[str, Any]:
    """Get specific block version.

    Args:
        block_id: Block UUID
        version: Semantic version string
        response: HTTP response for setting cache headers

    Returns:
        Block version details
    """
    validate_uuid(block_id, "block_id")

    result = _block_version_svc.get_block_version(block_id, version)

    if result is None:
        raise _no_version(block_id, version)

    # Set cache headers based on whether this is latest version
    if result.get("is_latest") is False:
        response.headers["Cache-Control"] = "max-age=3600"
    else:
        response.headers["Cache-Control"] = "max-age=60"

    return {"success": True, "data": result}


@router.put("/{block_id}/versions/{version}", response_model=None)
async def update_block_version(
    block_id: str,
    version: str,
    request: Request,
    if_match: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Update specific block version metadata.

    Args:
        block_id: Block UUID
        version: Semantic version string
        request: HTTP request with update data
        if_match: ETag for optimistic concurrency control

    Returns:
        Updated block version
    """
    validate_uuid(block_id, "block_id")

    body = await read_json_object(request)

    result = _block_version_svc.update_block_version(block_id, version, body, etag=if_match)

    if result is None:
        raise _no_version(block_id, version)

    return {"success": True, "data": result}


@router.delete("/{block_id}/versions/{version}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block_version(block_id: str, version: str) -> Response:
    """Delete specific block version.

    Args:
        block_id: Block UUID
        version: Semantic version string

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(block_id, "block_id")

    if not _block_version_svc.delete_block_version(block_id, version):
        raise _no_version(block_id, version)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{block_id}/history", response_model=None)
async def get_block_history(block_id: str) -> dict[str, Any]:
    """Get complete version history for a block.

    Args:
        block_id: Block UUID

    Returns:
        Version history
    """
    validate_uuid(block_id, "block_id")

    result = _block_version_svc.get_block_history(block_id)

    if result is None:
        raise block_not_found(block_id)

    return result


@router.post("/{block_id}/restore/{version}", response_model=None)
async def restore_block_version(block_id: str, version: str) -> dict[str, Any]:
    """Restore block to a specific version.

    Args:
        block_id: Block UUID
        version: Version to restore to

    Returns:
        Block with new version created from restore
    """
    validate_uuid(block_id, "block_id")

    result = _block_version_svc.restore_block_version(block_id, version)

    if result is None:
        raise block_not_found(block_id)

    return {"success": True, "data": result}
