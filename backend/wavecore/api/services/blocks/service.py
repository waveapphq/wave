"""Block service layer for business logic (REQ-5.2.4.2).

This module provides the service layer for block management operations.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException, ValidationException, WaveException
from wavecore.api.services.blocks._storage import (
    _check_circular_dependencies,
    _check_name_unique,
    _delete_block_files,
    _list_all_blocks,
    _load_block,
    _save_block,
    _save_versions,
    _validate_plugin_exists,
    get_block_dependents,
)
from wavecore.api.services.shared import batch_delete, batch_object

# ===========================================================================
# CRUD
# ===========================================================================


def list_blocks(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    plugin_id: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """List blocks with filtering and pagination."""
    filtered_blocks = _list_all_blocks()

    if search:
        search_lower = search.lower()
        filtered_blocks = [
            b
            for b in filtered_blocks
            if search_lower in b.get("name", "").lower()
            or search_lower in b.get("description", "").lower()
        ]

    if plugin_id:
        filtered_blocks = [b for b in filtered_blocks if b.get("plugin_id") == plugin_id]

    if tags:
        filtered_blocks = [
            b
            for b in filtered_blocks
            if any(tag in tags for tag in b.get("metadata", {}).get("tags", []))
        ]

    total = len(filtered_blocks)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page
    paginated_blocks = filtered_blocks[start_idx:end_idx]

    return {
        "blocks": paginated_blocks,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def create_block(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new block."""
    name = data.get("name", "")
    _check_name_unique(name)

    plugin_id = data.get("plugin_id")
    if plugin_id:
        _validate_plugin_exists(plugin_id)

    dependencies = data.get("dependencies", [])
    if dependencies:
        _check_circular_dependencies(name, dependencies)

    block_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()

    block = {
        "id": block_id,
        "name": name,
        "version": "1.0.0",
        "plugin_id": plugin_id,
        "description": data.get("description", ""),
        "parameters": data.get("parameters", {}),
        "dependencies": dependencies,
        "metadata": data.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }

    _save_block(block)
    _save_versions(
        block_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": "Initial version",
            }
        ],
    )

    return block


def get_block(block_id: str) -> dict[str, Any] | None:
    """Get block by ID."""
    return _load_block(block_id)


def delete_block(block_id: str, cascade: bool = False) -> bool:
    """Delete block."""
    block = _load_block(block_id)
    if block is None:
        return False

    dependents = get_block_dependents(block_id)
    if dependents:
        dependent_blocks = dependents.get("blocks", [])
        dependent_tests = dependents.get("tests", [])
        if (dependent_blocks or dependent_tests) and not cascade:
            raise ConflictException(
                f"Cannot delete block '{block.get('name')}': "
                f"{len(dependent_blocks)} blocks and {len(dependent_tests)} tests depend on it. "
                "Use cascade=true to delete all dependents."
            )

    _delete_block_files(block_id)
    return True


def batch_create_blocks(blocks: list[Any]) -> dict[str, Any]:
    """Create multiple blocks in a batch."""
    created: list[str] = []
    failed: list[dict[str, Any]] = []
    for idx, block_data in enumerate(blocks):
        try:
            block = create_block(batch_object(block_data))
            created.append(block["id"])
        except (ValueError, WaveException) as e:
            failed.append({"index": idx, "error": str(e)})
    return {"created": created, "failed": failed}


def batch_update_blocks(updates: list[Any]) -> dict[str, Any]:
    """Update multiple blocks in a batch."""
    updated: list[str] = []
    failed: list[dict[str, Any]] = []
    for idx, item in enumerate(updates):
        try:
            update = batch_object(item)
        except ValidationException as e:
            failed.append({"index": idx, "error": str(e)})
            continue
        block_id = str(update.get("id", ""))
        update_data = update.get("update", {})
        block = _load_block(block_id)
        if block is None:
            failed.append({"index": idx, "error": f"Block with ID '{block_id}' not found"})
            continue
        for key, value in update_data.items():
            if key not in ("id", "created_at"):
                block[key] = value
        block["updated_at"] = datetime.now(UTC).isoformat()
        _save_block(block)
        updated.append(block_id)
    return {"updated": updated, "failed": failed}


def batch_delete_blocks(block_ids: list[Any]) -> dict[str, Any]:
    """Delete multiple blocks in a batch."""
    return batch_delete(block_ids, delete_block, "Block")
