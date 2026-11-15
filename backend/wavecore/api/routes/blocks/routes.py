"""Block core CRUD endpoints (REQ-5.2.4.2).

This module implements core block management endpoints providing lifecycle
operations for reusable block entities including listing, creation,
retrieval, and deletion.

Endpoints:
- GET /blocks: List all blocks with filtering and pagination
- POST /blocks: Create a new block
- GET /blocks/{block_id}: Get block by ID
- DELETE /blocks/{block_id}: Delete block
"""

import re
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response, status

from wavecore.api.exceptions import NotFoundException, ValidationException
from wavecore.api.routes.shared import (
    entity_etag,
    read_json_object,
    refuse_stale_etag,
    validate_uuid,
)
from wavecore.api.services.blocks import service as block_service

# Create router for block endpoints
router = APIRouter(tags=["Blocks"], prefix="/blocks")


def validate_block_name(name: Any) -> None:
    """Validate block name format and length.

    Args:
        name: Block name to validate

    Raises:
        ValidationException: If name is invalid
    """
    if not isinstance(name, str):
        raise ValidationException("Field 'name' must be a string")
    if not name or len(name) > 255:
        raise ValidationException("Block name must be between 1 and 255 characters")

    if not re.match(r"^[a-zA-Z0-9 _-]+$", name):
        raise ValidationException(
            f"Block name '{name}' violates naming convention: must contain only "
            "alphanumeric characters, spaces, hyphens, and underscores"
        )


def block_not_found(block_id: str) -> NotFoundException:
    """The 404 for a block ID that matches no block."""
    return NotFoundException(f"Block with ID '{block_id}' not found")


@router.get("", response_model=None)
async def list_blocks(
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    plugin_id: Annotated[str | None, Query(description="Filter by plugin ID")] = None,
    tags: Annotated[list[str] | None, Query(description="Filter by tags")] = None,
) -> dict[str, Any]:
    """List all blocks with filtering and pagination.

    Args:
        response: HTTP response for setting cache headers
        page: Page number (1-based)
        per_page: Number of results per page (1-100)
        search: Text search across names and descriptions
        plugin_id: Filter by plugin reference
        tags: Filter by tags

    Returns:
        Paginated list of blocks with metadata
    """
    response.headers["Cache-Control"] = "max-age=60"

    if plugin_id:
        validate_uuid(plugin_id, "plugin_id")

    result = block_service.list_blocks(
        page=page,
        per_page=per_page,
        search=search,
        plugin_id=plugin_id,
        tags=tags,
    )

    return {
        "success": True,
        "data": result["blocks"],
        "pagination": {
            "total": result["total"],
            "page": result["page"],
            "per_page": result["per_page"],
            "total_pages": result["total_pages"],
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED, response_model=None)
async def create_block(request: Request, response: Response) -> dict[str, Any]:
    """Create a new block.

    Validates block definition including naming conventions, plugin references,
    and circular dependency detection.

    Args:
        request: HTTP request with block data
        response: HTTP response for setting headers

    Returns:
        Created block with metadata
    """
    body = await read_json_object(request)

    if "name" not in body:
        raise ValidationException("Field 'name' is required")
    if "plugin_id" not in body:
        raise ValidationException("Field 'plugin_id' is required")

    validate_block_name(body["name"])
    validate_uuid(body["plugin_id"], "plugin_id")

    block = block_service.create_block(body)

    response.headers["X-Cache-Invalidated"] = "blocks_list"

    return {"success": True, "data": block}


@router.get("/{block_id}", response_model=None)
async def get_block(block_id: str, response: Response) -> dict[str, Any]:
    """Get block by ID.

    Args:
        block_id: Block UUID
        response: HTTP response for setting headers

    Returns:
        Block details with metadata
    """
    validate_uuid(block_id, "block_id")

    block = block_service.get_block(block_id)

    if block is None:
        raise block_not_found(block_id)

    response.headers["ETag"] = entity_etag(block)

    return {"success": True, "data": block}


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(
    block_id: str,
    cascade: Annotated[bool, Query(description="Cascade delete dependents")] = False,
    if_match: Annotated[str | None, Header()] = None,
) -> Response:
    """Delete block.

    Enforces dependency checking to prevent orphaned references.
    Use cascade=true for cascade deletion.

    Args:
        block_id: Block UUID
        cascade: Cascade delete dependents
        if_match: ETag for optimistic concurrency control

    Returns:
        Empty response with 204 status code
    """
    validate_uuid(block_id, "block_id")
    refuse_stale_etag(if_match, block_service.get_block, block_id)

    if not block_service.delete_block(block_id, cascade=cascade):
        raise block_not_found(block_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
