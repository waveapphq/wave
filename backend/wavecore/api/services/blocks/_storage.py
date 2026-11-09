"""File persistence, validation helpers, and dependency tracking for block service."""

import hashlib
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.storage_paths import (
    entity_dir,
    get_base_path,
    get_blocks_storage_path,
    is_entity_id,
)
from wavecore.storage import FileBasedStorage

# Lazy-loaded storage instance for plugin lookups
_storage: FileBasedStorage | None = None


def _get_storage() -> FileBasedStorage:
    """Get or create the FileBasedStorage instance."""
    global _storage
    if _storage is None:
        _storage = FileBasedStorage(get_base_path())
    return _storage


def _clear_storage() -> None:
    """Clear all block storage and reset storage instance."""
    import shutil

    global _storage
    _storage = None
    storage_dir = get_blocks_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


def _get_raw_block(block_id: str) -> dict[str, Any] | None:
    """Get raw block data without any transformations."""
    return _load_block(block_id)


def _set_version_attribute(block_id: str, version: str, attr: str, value: Any) -> None:
    """Set attribute on a version entry."""
    versions = _load_versions(block_id)
    for v in versions:
        if v["version"] == version:
            v[attr] = value
            break
    _save_versions(block_id, versions)


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_blocks_storage_path().mkdir(parents=True, exist_ok=True)


def _get_block_dir(block_id: str) -> Path:
    """Get directory path for a block."""
    return entity_dir(get_blocks_storage_path(), block_id)


def _load_block(block_id: str) -> dict[str, Any] | None:
    """Load block from file storage."""
    if not is_entity_id(block_id):
        return None
    block_file = _get_block_dir(block_id) / "block.yaml"
    if not block_file.exists():
        return None
    with open(block_file, encoding="utf-8") as f:
        data: dict[str, Any] | None = yaml.safe_load(f)
        return data


def _save_block(block: dict[str, Any]) -> None:
    """Save block to file storage."""
    _ensure_storage_dir()
    block_dir = _get_block_dir(block["id"])
    block_dir.mkdir(parents=True, exist_ok=True)
    block_file = block_dir / "block.yaml"
    with open(block_file, "w", encoding="utf-8") as f:
        yaml.dump(block, f, default_flow_style=False, sort_keys=False)


def _delete_block_files(block_id: str) -> None:
    """Delete all files for a block."""
    block_dir = _get_block_dir(block_id)
    if block_dir.exists():
        for file in block_dir.iterdir():
            file.unlink()
        block_dir.rmdir()


def _load_versions(block_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = _get_block_dir(block_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def _save_versions(block_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    _ensure_storage_dir()
    block_dir = _get_block_dir(block_id)
    block_dir.mkdir(parents=True, exist_ok=True)
    versions_file = block_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def _list_all_blocks() -> list[dict[str, Any]]:
    """List all blocks from file storage."""
    _ensure_storage_dir()
    blocks = []
    storage_dir = get_blocks_storage_path()
    if storage_dir.exists():
        for block_dir in storage_dir.iterdir():
            if block_dir.is_dir():
                block = _load_block(block_dir.name)
                if block:
                    blocks.append(block)
    return blocks


def _generate_etag(block: dict[str, Any]) -> str:
    """Generate ETag hash for a block."""
    content = f"{block.get('id')}{block.get('version')}{block.get('updated_at')}"
    return hashlib.sha256(content.encode()).hexdigest()


def _check_name_unique(name: str) -> None:
    """Raise ValueError if a block with the given name already exists."""
    for block in _list_all_blocks():
        if block.get("name") == name:
            raise ConflictException(f"Block with name '{name}' already exists")


def _validate_plugin_exists(plugin_id: str) -> None:
    """Raise ValueError if the plugin ID does not exist in storage."""
    # Late import to support test patching via service module

    try:
        _get_storage().load_plugin(plugin_id)
    except FileNotFoundError as e:
        raise ValidationException(f"Plugin with ID '{plugin_id}' not found") from e


def _check_circular_dependencies(name: str, dependencies: list[str]) -> None:
    """Raise ValueError if any dependency creates a circular reference."""
    all_blocks = {b["id"]: b for b in _list_all_blocks()}
    for dep_id in dependencies:
        if dep_id not in all_blocks:
            continue
        dep_block = all_blocks[dep_id]
        if name in dep_block.get("dependencies", []):
            raise ValidationException(
                f"Circular dependency detected: {name} -> {dep_block.get('name')} -> {name}"
            )


def get_block_dependencies(block_id: str) -> dict[str, Any] | None:
    """Get block dependencies (what this block depends on)."""
    block = _load_block(block_id)
    if block is None:
        return None

    dependencies: list[dict[str, Any]] = []
    all_blocks = {b["id"]: b for b in _list_all_blocks()}
    for dep_id in block.get("dependencies", []):
        if dep_id in all_blocks:
            dep_block = all_blocks[dep_id]
            dependencies.append(
                {"id": dep_id, "type": "block", "version": dep_block.get("version", "1.0.0")}
            )

    plugin_id = block.get("plugin_id")
    if plugin_id:
        dependencies.append({"id": plugin_id, "type": "plugin", "version": "1.0.0"})

    return {"root": block_id, "dependencies": dependencies}


def get_block_dependents(block_id: str) -> dict[str, Any] | None:
    """Get what depends on this block."""
    block = _load_block(block_id)
    if block is None:
        return None

    dependent_blocks: list[str] = []
    dependent_tests: list[str] = []

    for other_block in _list_all_blocks():
        if other_block["id"] != block_id:
            if block_id in other_block.get("dependencies", []):
                dependent_blocks.append(other_block["id"])

    return {"blocks": dependent_blocks, "tests": dependent_tests}


def get_block_usage(block_id: str) -> dict[str, Any] | None:
    """Get where this block is used."""
    block = _load_block(block_id)
    if block is None:
        return None
    return {"tests": [], "workflows": []}


def _validate_required_fields(data: dict[str, Any]) -> list[str]:
    """Check that required block fields are present."""
    errors: list[str] = []
    if not data.get("name"):
        errors.append("Field 'name' is required")
    if not data.get("plugin_id"):
        errors.append("Field 'plugin_id' must be a valid UUID")
    return errors


def _validate_plugin_reference(plugin_id: str) -> list[str]:
    """Check that the plugin reference exists in storage."""

    try:
        _get_storage().load_plugin(plugin_id)
    except FileNotFoundError:
        return [f"Plugin reference '{plugin_id}' not found"]
    return []


def _validate_circular_deps(block_name: str, dependencies: list[str]) -> list[str]:
    """Check for circular dependency references."""
    errors: list[str] = []
    all_blocks = {b["id"]: b for b in _list_all_blocks()}
    for dep_id in dependencies:
        if dep_id not in all_blocks:
            continue
        dep_block = all_blocks[dep_id]
        if block_name in dep_block.get("dependencies", []):
            errors.append(
                f"Circular dependency detected: {block_name} -> "
                f"{dep_block.get('name')} -> {block_name}"
            )
    return errors


def _validate_param_bindings(plugin_id: str, params: dict[str, Any]) -> list[str]:
    """Check that all required plugin parameters are bound."""

    errors: list[str] = []
    try:
        plugin = _get_storage().load_plugin(plugin_id)
        for plugin_param in plugin.parameters:
            if plugin_param.required and plugin_param.name not in params:
                errors.append(
                    f"Parameter binding incomplete: required parameter "
                    f"'{plugin_param.name}' from plugin '{plugin_id}' is not bound"
                )
    except FileNotFoundError:
        pass
    return errors


def _check_backward_compatibility(block: dict[str, Any], data: dict[str, Any]) -> None:
    """Raise ValueError if required parameters were removed in a non-major bump."""
    old_params = block.get("parameters", {})
    new_params = data.get("parameters", old_params)

    for param_name, param_info in old_params.items():
        if isinstance(param_info, dict) and param_info.get("required"):
            if param_name not in new_params:
                raise ValidationException(
                    f"Backward compatibility violation in minor version: "
                    f"required parameter '{param_name}' was removed"
                )
