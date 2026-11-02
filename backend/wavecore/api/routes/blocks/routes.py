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
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.shared import validate_uuid
from wavecore.api.services.blocks import service as block_service

# Create router for block endpoints
router = APIRouter(tags=["Blocks"], prefix="/blocks")


def validate_block_name(name: str) -> None:
    """Validate block name format and length.

    Args:
        name: Block name to validate

    Raises:
        ValueError: If name is invalid
    """
    if not name or len(name) > 255:
        raise ValueError("Block name must be between 1 and 255 characters")

    if not re.match(r"^[a-zA-Z0-9 _-]+$", name):
        raise ValueError(
            f"Block name '{name}' violates naming convention: must contain only "
            "alphanumeric characters, spaces, hyphens, and underscores"
        )


def _generate_etag(block: dict[str, Any]) -> str:
    """Generate ETag for a block.

    Args:
        block: Block data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{block.get('id')}{block.get('version')}{block.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


@router.get("", response_model=None)
async def list_blocks(
    response: Response,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Results per page")] = 20,
    search: Annotated[str | None, Query(description="Text search query")] = None,
    plugin_id: Annotated[str | None, Query(description="Filter by plugin ID")] = None,
    tags: Annotated[list[str] | None, Query(description="Filter by tags")] = None,
) -> dict[str, Any] | JSONResponse:
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
        try:
            validate_uuid(plugin_id, "plugin_id")
        except (ValueError, ValidationException) as e:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "success": False,
                    "error": {"message": str(e), "code": "INVALID_PARAMETER"},
                },
            )

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
async def create_block(request: Request, response: Response) -> dict[str, Any] | JSONResponse:
    """Create a new block.

    Validates block definition including naming conventions, plugin references,
    and circular dependency detection.

    Args:
        request: HTTP request with block data
        response: HTTP response for setting headers

    Returns:
        Created block with metadata
    """
    try:
        body = await request.json()

        if "name" not in body:
            raise ValueError("Field 'name' is required")
        if "plugin_id" not in body:
            raise ValueError("Field 'plugin_id' is required")

        validate_block_name(body["name"])
        validate_uuid(body["plugin_id"], "plugin_id")

        block = block_service.create_block(body)

        response.headers["X-Cache-Invalidated"] = "blocks_list"

        return {"success": True, "data": block}

    except (ValueError, ValidationException) as e:
        error_message = str(e)

        if "already exists" in error_message:
            status_code = status.HTTP_409_CONFLICT
        elif "Circular dependency" in error_message:
            status_code = status.HTTP_400_BAD_REQUEST
        elif "not found" in error_message:
            status_code = status.HTTP_400_BAD_REQUEST
        else:
            status_code = status.HTTP_400_BAD_REQUEST

        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {"message": error_message, "code": "VALIDATION_ERROR"},
            },
        )
    except Exception:
        correlation_id = str(uuid.uuid4())
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "message": "Internal server error",
                    "code": "INTERNAL_ERROR",
                    "correlation_id": correlation_id,
                },
            },
        )


@router.get("/{block_id}", response_model=None)
async def get_block(block_id: str, response: Response) -> dict[str, Any] | JSONResponse:
    """Get block by ID.

    Args:
        block_id: Block UUID
        response: HTTP response for setting headers

    Returns:
        Block details with metadata
    """
    try:
        validate_uuid(block_id, "block_id")

        block = block_service.get_block(block_id)

        if block is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Block with ID '{block_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        response.headers["ETag"] = _generate_etag(block)

        return {"success": True, "data": block}

    except (ValueError, ValidationException) as e:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "success": False,
                "error": {"message": str(e), "code": "INVALID_PARAMETER"},
            },
        )


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
    try:
        validate_uuid(block_id, "block_id")

        if if_match:
            block = block_service.get_block(block_id)
            if block:
                current_etag = _generate_etag(block)
                if if_match != current_etag:
                    raise ValueError("Precondition failed: resource has been modified")

        deleted = block_service.delete_block(block_id, cascade=cascade)

        if not deleted:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={
                    "success": False,
                    "error": {
                        "message": f"Block with ID '{block_id}' not found",
                        "code": "NOT_FOUND",
                    },
                },
            )

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except (ValueError, ValidationException) as e:
        error_message = str(e)

        if "Precondition failed" in error_message:
            status_code = status.HTTP_412_PRECONDITION_FAILED
        elif "Cannot delete" in error_message:
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
