"""Version management, clone, import, validation, and history for blocks."""

import uuid
from datetime import UTC, datetime
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.blocks._storage import (
    _bump_version,
    _check_backward_compatibility,
    _generate_etag,
    _list_all_blocks,
    _load_block,
    _load_versions,
    _save_block,
    _save_versions,
    _validate_circular_deps,
    _validate_param_bindings,
    _validate_plugin_reference,
    _validate_required_fields,
    get_block_dependents,
)
from wavecore.api.services.shared import refuse_unencodable_file
from wavecore.core.utf8_text import load_yaml


def list_block_versions(block_id: str) -> list[str] | None:
    """List all versions for a block."""
    block = _load_block(block_id)
    if block is None:
        return None
    versions = _load_versions(block_id)
    return [v["version"] for v in versions]


def add_block_version(block_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Add a new version to a block."""
    block = _load_block(block_id)
    if block is None:
        return None

    versions = _load_versions(block_id)
    version_bump = data.get("version_bump", "minor")
    current_version = block.get("version", "1.0.0")
    new_version = _bump_version(current_version, version_bump)

    if version_bump != "major":
        _check_backward_compatibility(block, data)

    now = datetime.now(UTC).isoformat()
    block["version"] = new_version
    block["updated_at"] = now
    if "description" in data:
        block["description"] = data["description"]
    if "parameters" in data:
        block["parameters"] = data["parameters"]

    _save_block(block)

    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": data.get("description", "Version update"),
        }
    )
    _save_versions(block_id, versions)
    return block


def get_block_version(block_id: str, version: str) -> dict[str, Any] | None:
    """Get specific block version."""
    block = _load_block(block_id)
    if block is None:
        return None

    versions = _load_versions(block_id)
    version_exists = any(v["version"] == version for v in versions)
    if not version_exists:
        return None

    result = block.copy()
    result["version"] = version
    result["is_latest"] = version == block.get("version")
    return result


def update_block_version(
    block_id: str, version: str, data: dict[str, Any], etag: str | None = None
) -> dict[str, Any] | None:
    """Update specific block version metadata."""
    block = _load_block(block_id)
    if block is None:
        return None

    versions = _load_versions(block_id)
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        return None

    if version_entry.get("published"):
        raise ConflictException(
            f"Cannot modify published version '{version}'. Published versions are immutable."
        )

    if etag:
        current_etag = _generate_etag(block)
        etag_value = etag.strip('"')
        if etag_value != current_etag:
            raise ConflictException(
                f"Precondition failed: resource has been modified. "
                f"Expected ETag '{etag_value}', current ETag '{current_etag}'"
            )

    now = datetime.now(UTC).isoformat()
    if "description" in data:
        block["description"] = data["description"]
    block["updated_at"] = now

    _save_block(block)
    return block


def delete_block_version(block_id: str, version: str) -> bool:
    """Delete specific block version."""
    block = _load_block(block_id)
    if block is None:
        return False

    versions = _load_versions(block_id)
    version_idx = next((i for i, v in enumerate(versions) if v["version"] == version), None)
    if version_idx is None:
        return False

    dependents = get_block_dependents(block_id)
    if dependents and (dependents.get("blocks") or dependents.get("tests")):
        dependent_count = len(dependents.get("blocks", [])) + len(dependents.get("tests", []))
        raise ConflictException(
            f"Cannot delete version '{version}': {dependent_count} blocks reference this version"
        )

    versions.pop(version_idx)
    _save_versions(block_id, versions)
    return True


def clone_block(
    block_id: str, new_name: str, new_version: str | None = None
) -> dict[str, Any] | None:
    """Clone a block with a new name."""
    source = _load_block(block_id)
    if source is None:
        return None

    now = datetime.now(UTC).isoformat()
    clone_id = str(uuid.uuid4())

    clone = source.copy()
    clone["id"] = clone_id
    clone["name"] = new_name
    clone["version"] = new_version or "1.0.0"
    clone["created_at"] = now
    clone["updated_at"] = now
    clone["metadata"] = {**source.get("metadata", {}), "cloned_from": block_id}

    _save_block(clone)
    _save_versions(
        clone_id,
        [
            {
                "version": clone["version"],
                "created_at": now,
                "created_by": "system",
                "changes": f"Cloned from {source.get('name')}",
            }
        ],
    )
    return clone


def import_block(content: bytes, filename: str = "", overwrite: bool = False) -> dict[str, Any]:
    """Import block from file content."""
    from wavecore.api.services.blocks.service import create_block

    try:
        data = load_yaml(content)
    except yaml.YAMLError as e:
        raise ValidationException(f"Invalid YAML in '{filename}': {e!s}") from e

    refuse_unencodable_file(content, data)
    if not isinstance(data, dict):
        raise ValidationException(f"Invalid YAML in '{filename}': expected mapping")

    name = data.get("name", "")
    existing = None
    for block in _list_all_blocks():
        if block.get("name") == name:
            existing = block
            break

    if existing and not overwrite:
        raise ConflictException(f"Block '{name}' already exists. Set overwrite=true to replace.")

    if existing and overwrite:
        now = datetime.now(UTC).isoformat()
        existing.update(
            {
                "plugin_id": data.get("plugin_id", existing.get("plugin_id")),
                "description": data.get("description", existing.get("description")),
                "parameters": data.get("parameters", existing.get("parameters")),
                "version": data.get("version", existing.get("version")),
                "updated_at": now,
            }
        )
        _save_block(existing)
        return existing
    else:
        return create_block(data)


def validate_block(data: dict[str, Any]) -> dict[str, Any]:
    """Validate block definition without saving."""
    errors: list[str] = []
    warnings: list[str] = []

    errors.extend(_validate_required_fields(data))

    plugin_id = data.get("plugin_id")
    if plugin_id:
        errors.extend(_validate_plugin_reference(plugin_id))

    errors.extend(
        _validate_circular_deps(data.get("name", "unknown"), data.get("dependencies", []))
    )

    if plugin_id:
        errors.extend(_validate_param_bindings(plugin_id, data.get("parameters", {})))

    if not data.get("description"):
        warnings.append("Block has no description")

    return {
        "success": True,
        "data": {"valid": len(errors) == 0, "errors": errors, "warnings": warnings},
    }


def validate_dependencies(block_id: str, dependencies: list[str]) -> dict[str, Any]:
    """Validate block dependencies."""
    errors: list[str] = []
    all_blocks = {b["id"]: b for b in _list_all_blocks()}
    for dep_id in dependencies:
        if dep_id not in all_blocks:
            errors.append(f"Dependency '{dep_id}' not found")
            continue
        dep_block = all_blocks[dep_id]
        if block_id in dep_block.get("dependencies", []):
            errors.append("Circular dependency would be created")
    return {"valid": len(errors) == 0, "errors": errors}


def get_block_history(block_id: str) -> dict[str, Any] | None:
    """Get complete version history for a block."""
    block = _load_block(block_id)
    if block is None:
        return None
    versions = _load_versions(block_id)
    sorted_versions = sorted(versions, key=lambda v: v["version"], reverse=True)
    return {"versions": sorted_versions}


def restore_block_version(block_id: str, version: str) -> dict[str, Any] | None:
    """Restore block to a specific version."""
    block = _load_block(block_id)
    if block is None:
        return None

    versions = _load_versions(block_id)
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        raise ValidationException(f"Version '{version}' not found for block '{block_id}'")

    now = datetime.now(UTC).isoformat()
    current_version = block.get("version", "1.0.0")
    parts = [int(x) for x in current_version.split(".")]
    new_version = f"{parts[0]}.{parts[1] + 1}.0"

    block["version"] = new_version
    block["updated_at"] = now
    block["metadata"] = {**block.get("metadata", {}), "restored_from": version}

    _save_block(block)

    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": f"Restored from v{version}",
        }
    )
    _save_versions(block_id, versions)
    return block
