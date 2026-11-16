"""Block import, export, batch, and dependency endpoints.

This module implements block batch operations, import/export, validation,
dependency management, and clone operations.

Endpoints:
- POST /blocks/batch: Batch create blocks
- PATCH /blocks/batch: Batch update blocks
- DELETE /blocks/batch: Batch delete blocks
- POST /blocks/import: Import block from file
- POST /blocks/validate: Validate block definition
- POST /blocks/validate-dependencies: Validate block dependencies
- GET /blocks/{block_id}/dependencies: Get block dependencies
- GET /blocks/{block_id}/dependents: Get what depends on this block
- GET /blocks/{block_id}/usage: Get where this block is used
- POST /blocks/{block_id}/clone: Clone block
"""

from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Request, UploadFile, status

from wavecore.api.exceptions import ValidationException
from wavecore.api.routes.blocks.routes import block_not_found, validate_block_name
from wavecore.api.routes.shared import (
    read_json_array,
    read_json_object,
    validate_uuid,
)
from wavecore.api.services.blocks import _storage as _block_storage
from wavecore.api.services.blocks import service as block_service
from wavecore.api.services.blocks import version_service as _block_version_svc
from wavecore.api.services.shared import validate_semantic_version

# Create router for block import/export endpoints
router = APIRouter(tags=["Blocks"], prefix="/blocks")


@router.post("/batch", status_code=status.HTTP_201_CREATED)
async def batch_create_blocks(request: Request) -> dict[str, Any]:
    """Create multiple blocks in a batch.

    Args:
        request: HTTP request with list of block data

    Returns:
        Dictionary with created IDs and failed items
    """
    body = await read_json_array(request)
    result = block_service.batch_create_blocks(body)
    return result


@router.patch("/batch")
async def batch_update_blocks(request: Request) -> dict[str, Any]:
    """Update multiple blocks in a batch.

    Args:
        request: HTTP request with list of update items

    Returns:
        Dictionary with updated IDs and failed items
    """
    body = await read_json_array(request)
    result = block_service.batch_update_blocks(body)
    return result


@router.delete("/batch")
async def batch_delete_blocks(request: Request) -> dict[str, Any]:
    """Delete multiple blocks in a batch.

    Args:
        request: HTTP request with list of block IDs

    Returns:
        Dictionary with deleted IDs and failed items
    """
    body = await read_json_array(request)
    result = block_service.batch_delete_blocks(body)
    return result


@router.post("/import", status_code=status.HTTP_201_CREATED, response_model=None)
async def import_block(
    file: Annotated[UploadFile, File()],
    overwrite: Annotated[str, Form()] = "false",
) -> dict[str, Any]:
    """Import block from file.

    Args:
        file: Uploaded YAML or JSON file
        overwrite: Whether to overwrite existing block

    Returns:
        Imported block data
    """
    content = await file.read()
    overwrite_bool = overwrite.lower() == "true"

    block = _block_version_svc.import_block(content, file.filename or "", overwrite_bool)

    return {"success": True, "data": block}


@router.post("/validate")
async def validate_block(request: Request) -> dict[str, Any]:
    """Validate block definition.

    Pre-creation validation verifying structural integrity including
    component reference validation, version constraint satisfaction,
    parameter binding completeness, and circular dependency detection.

    Args:
        request: HTTP request with block definition

    Returns:
        Validation result with errors and warnings
    """
    body = await read_json_object(request)
    return _block_version_svc.validate_block(body)


@router.post("/validate-dependencies", response_model=None)
async def validate_dependencies(request: Request) -> dict[str, Any]:
    """Validate block dependencies.

    Args:
        request: HTTP request with block_id and dependencies

    Returns:
        Validation result with errors
    """
    body = await read_json_object(request)

    if "block_id" not in body:
        raise ValidationException("Field 'block_id' is required")

    if "dependencies" not in body:
        raise ValidationException("Field 'dependencies' is required")

    return _block_version_svc.validate_dependencies(body["block_id"], body["dependencies"])


@router.get("/{block_id}/dependencies", response_model=None)
async def get_block_dependencies(block_id: str) -> dict[str, Any]:
    """Get block dependencies (what this block depends on).

    Args:
        block_id: Block UUID

    Returns:
        Dependency tree
    """
    validate_uuid(block_id, "block_id")

    result = _block_storage.get_block_dependencies(block_id)

    if result is None:
        raise block_not_found(block_id)

    return result


@router.get("/{block_id}/dependents", response_model=None)
async def get_block_dependents(block_id: str) -> dict[str, Any]:
    """Get what depends on this block.

    Args:
        block_id: Block UUID

    Returns:
        Dictionary with blocks and tests that depend on this block
    """
    validate_uuid(block_id, "block_id")

    result = _block_storage.get_block_dependents(block_id)

    if result is None:
        raise block_not_found(block_id)

    return result


@router.get("/{block_id}/usage", response_model=None)
async def get_block_usage(block_id: str) -> dict[str, Any]:
    """Get where this block is used.

    Args:
        block_id: Block UUID

    Returns:
        Usage information
    """
    validate_uuid(block_id, "block_id")

    result = _block_storage.get_block_usage(block_id)

    if result is None:
        raise block_not_found(block_id)

    return result


@router.post("/{block_id}/clone", status_code=status.HTTP_201_CREATED, response_model=None)
async def clone_block(block_id: str, request: Request) -> dict[str, Any]:
    """Clone block with a new name.

    Args:
        block_id: Source block UUID
        request: HTTP request with new_name and optional new_version

    Returns:
        Cloned block
    """
    validate_uuid(block_id, "block_id")

    body = await read_json_object(request)

    if "new_name" not in body:
        raise ValidationException("Field 'new_name' is required")

    new_name = body["new_name"]
    validate_block_name(new_name)
    new_version = body.get("new_version")

    if new_version:
        validate_semantic_version(new_version)

    result = _block_version_svc.clone_block(block_id, new_name, new_version)

    if result is None:
        raise block_not_found(block_id)

    return {"success": True, "data": result}
