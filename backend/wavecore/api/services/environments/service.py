"""Environment service for managing environment lifecycle operations.

REQ-5.2.1.42: Settings and preferences screen - Environments management
REQ-6.1.6: File-based YAML storage persistence

This module provides CRUD operations for environments including:
- Create/Read/Update/Delete operations
- Duplicate environment functionality
- Usage calculation (profile count)
- Delete protection when in use
- File-based YAML persistence
"""

import copy
import json
import logging
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services.entity_cache import DirectoryCache
from wavecore.api.services.shared import (
    export_file_stem,
    first_free_name,
    parse_file,
    parse_zip_file,
)
from wavecore.api.services.storage_paths import (
    entity_dir,
    get_environments_storage_path,
    is_entity_id,
)

logger = logging.getLogger(__name__)

_ENVIRONMENT_FILENAME = "environment.yaml"

# In-memory cache for environments. The storage directory is the record; this
# cache is reconciled against it on every listing.
_environments: dict[str, dict[str, Any]] = {}
_cache_loaded: bool = False

_environment_directory = DirectoryCache(
    label="environment",
    filename=_ENVIRONMENT_FILENAME,
    storage_dir=get_environments_storage_path,
    cache=lambda: _environments,
    logger=logger,
)

# String constants to avoid repetition
_TZ_UTC_SUFFIX = "+00:00"


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_environments_storage_path().mkdir(parents=True, exist_ok=True)


def _get_env_dir(env_id: str) -> Path:
    """Get directory path for an environment."""
    return entity_dir(get_environments_storage_path(), env_id)


def _load_environment(env_id: str) -> dict[str, Any] | None:
    """Load environment from file storage, forgetting the cached entry when gone."""
    if not is_entity_id(env_id):
        return None
    env_file = _get_env_dir(env_id) / _ENVIRONMENT_FILENAME
    if not env_file.exists():
        _environment_directory.forget(env_id)
        return None
    with open(env_file, encoding="utf-8") as f:
        data: dict[str, Any] | None = yaml.safe_load(f)
        return data


def _save_environment(env: dict[str, Any]) -> None:
    """Save environment to file storage."""
    _ensure_storage_dir()
    env_dir = _get_env_dir(env["id"])
    env_dir.mkdir(parents=True, exist_ok=True)
    env_file = env_dir / _ENVIRONMENT_FILENAME
    with open(env_file, "w", encoding="utf-8") as f:
        yaml.dump(env, f, default_flow_style=False, sort_keys=False)


def _delete_environment_files(env_id: str) -> None:
    """Delete all files for an environment."""
    env_dir = _get_env_dir(env_id)
    if env_dir.exists():
        shutil.rmtree(env_dir)


def _reconcile_cache() -> None:
    """Sync the in-memory cache with the storage directory, which is the record."""
    global _cache_loaded
    _environment_directory.reconcile()
    _cache_loaded = True


def _ensure_cache_loaded() -> None:
    """Ensure in-memory cache is loaded from disk.

    Every read goes through here, including one per recent execution on a
    dashboard build, so it must not scan the directory once the cache is warm.
    """
    if not _cache_loaded:
        _reconcile_cache()


def _cached_environment(environment_id: str) -> dict[str, Any] | None:
    """The cached environment, or None once its file is gone (dropping the entry)."""
    _ensure_cache_loaded()
    env = _environments.get(environment_id)
    if env is None:
        return None
    if not _environment_directory.exists(environment_id):
        _environment_directory.forget(environment_id)
        return None
    return env


def _clear_in_memory_cache() -> None:
    """Clear in-memory cache without touching disk storage.

    Used to simulate service restart by clearing in-memory state.
    """
    global _cache_loaded
    _environment_directory.clear()
    _cache_loaded = False


def _clear_storage() -> None:
    """Clear all environments from storage. Test utility."""
    global _cache_loaded
    _environment_directory.clear()
    _cache_loaded = True  # Mark as loaded (empty)
    # Clear files on disk; write paths recreate the dir on demand
    storage_dir = get_environments_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)


def _count_profile_usage(environment_id: str) -> int:
    """Count profiles referencing this environment.

    Args:
        environment_id: The environment ID to check usage for.

    Returns:
        Number of profiles that have values defined for this environment.
    """
    # Import here to avoid circular imports
    from wavecore.api.services.profiles import _common as _profile_common

    count = 0
    for profile in _profile_common._profile_storage.values():
        # Check if this environment has values in environment_values dict
        env_values = profile.get("environment_values", {})
        if environment_id in env_values:
            count += 1
    return count


def _generate_copy_names(original_name: str) -> list[str]:
    """Generate candidate copy names in order of preference.

    Args:
        original_name: The original environment name.

    Returns:
        List of candidate names: ["Name (Copy)", "Name (Copy 2)", "Name (Copy 3)", ...]
    """
    # Start with base copy name
    candidates = [f"{original_name} (Copy)"]
    # Add numbered versions (limited to reasonable number)
    candidates.extend(f"{original_name} (Copy {i})" for i in range(2, 100))
    return candidates


def _generate_unique_copy_name(original_name: str) -> str:
    """Generate a unique name for a copied environment.

    Args:
        original_name: The original environment name.

    Returns:
        A unique copy name like "name (Copy)" or "name (Copy 2)".
    """
    _reconcile_cache()
    existing_names = {env["name"] for env in _environments.values()}
    candidates = _generate_copy_names(original_name)
    return next(name for name in candidates if name not in existing_names)


def _validate_tags(tags: list[str] | None) -> list[str]:
    """Validate and normalize tags.

    Args:
        tags: List of tag strings to validate.

    Returns:
        Validated and trimmed list of tags.

    Raises:
        ValueError: If tags is not a list or contains invalid values.
    """
    if tags is None:
        return []

    if not isinstance(tags, list):
        raise ValidationException("Field 'tags' must be a list of strings")

    validated = []
    for tag in tags:
        if not isinstance(tag, str):
            raise ValidationException("Field 'tags' must contain only strings")
        trimmed = tag.strip()
        if not trimmed:
            raise ValidationException("Tags cannot contain empty or whitespace-only strings")
        validated.append(trimmed)

    return validated


def _generate_etag(environment: dict[str, Any]) -> str:
    """Generate ETag for an environment.

    Args:
        environment: Environment data

    Returns:
        ETag string (quoted hex hash)
    """
    import hashlib

    content = f"{environment.get('id')}{environment.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def create_environment(
    name: str,
    description: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a new environment.

    Args:
        name: Environment name (required, 1-255 chars).
        description: Optional description.
        tags: Optional list of tags for categorization.

    Returns:
        Created environment dict with id, name, description, tags, timestamps.

    Raises:
        ValueError: If name is empty, too long, duplicate, or tags invalid.
    """
    _reconcile_cache()

    # Trim whitespace
    name = name.strip() if name else ""

    # Validate name
    if not name:
        raise ValidationException("Environment name is required and cannot be empty")

    if len(name) > 255:
        raise ValidationException("Environment name must be between 1 and 255 characters")

    # Validate tags
    validated_tags = _validate_tags(tags)

    # Check for duplicate name
    for env in _environments.values():
        if env["name"] == name:
            raise ConflictException(f"Environment with name '{name}' already exists")

    # Create environment
    now = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    env_id = str(uuid.uuid4())

    environment: dict[str, Any] = {
        "id": env_id,
        "name": name,
        "tags": validated_tags,
        "created_at": now,
        "updated_at": now,
    }

    if description is not None:
        environment["description"] = description

    # Save to file storage
    _save_environment(environment)
    # Update in-memory cache
    _environments[env_id] = environment

    return environment


def get_environment(environment_id: str) -> dict[str, Any] | None:
    """Get an environment by ID.

    Args:
        environment_id: The environment UUID.

    Returns:
        Environment dict with usage count, or None if not found.
    """
    env = _cached_environment(environment_id)
    if env is None:
        # Try loading from disk in case cache is stale
        env = _load_environment(environment_id)
        if env:
            _environments[environment_id] = env

    if env is None:
        return None

    # Add usage count
    result = dict(env)
    result["usage"] = _count_profile_usage(environment_id)

    return result


def list_environments(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    tags: list[str] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> dict[str, Any]:
    """List all environments with pagination and filtering.

    Args:
        page: Page number (1-indexed).
        per_page: Items per page.
        search: Optional search term for name/description.
        tags: Optional list of tags to filter by (environments must have ALL tags).
        sort_by: Field to sort by (name, created_at, updated_at).
        sort_direction: Sort direction (asc, desc).

    Returns:
        Dict with environments list, pagination info.
    """
    _reconcile_cache()

    # Get all environments
    all_envs = list(_environments.values())

    # Apply search filter
    if search:
        search_lower = search.lower()
        all_envs = [
            env
            for env in all_envs
            if search_lower in env["name"].lower()
            or (env.get("description") and search_lower in env["description"].lower())
        ]

    # Apply tags filter (environments must have ANY of the specified tags)
    if tags:
        tags_set = set(tags)
        all_envs = [env for env in all_envs if tags_set & set(env.get("tags", []))]

    # Add usage count to each environment (needed for usage sort and response)
    all_envs = [{**env, "usage": _count_profile_usage(env["id"])} for env in all_envs]

    # Apply sorting
    if sort_by:
        reverse = sort_direction == "desc"
        if sort_by == "name":
            all_envs.sort(key=lambda e: e["name"].lower(), reverse=reverse)
        elif sort_by == "description":
            all_envs.sort(key=lambda e: (e.get("description") or "").lower(), reverse=reverse)
        elif sort_by in ("created_at", "updated_at"):
            all_envs.sort(key=lambda e: e.get(sort_by, ""), reverse=reverse)
        elif sort_by == "tags":
            all_envs.sort(
                key=lambda e: ",".join(sorted(e.get("tags", []))).lower(), reverse=reverse
            )
        elif sort_by == "usage":
            all_envs.sort(key=lambda e: e["usage"], reverse=reverse)

    # Calculate pagination
    total = len(all_envs)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0

    # Get page slice
    start = (page - 1) * per_page
    end = start + per_page
    envs_with_usage = all_envs[start:end]

    return {
        "environments": envs_with_usage,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def list_environment_documents() -> list[dict[str, Any]]:
    """A copy of every stored environment, without the computed usage count."""
    _reconcile_cache()
    return [copy.deepcopy(env) for env in _environments.values()]


def _check_etag(env: dict[str, Any], etag: str | None) -> None:
    """Raise exception if the provided ETag does not match the current resource."""
    if not etag:
        return
    current_etag = _generate_etag(env)
    if etag != current_etag:
        exc = ConflictException("Precondition failed: resource has been modified")
        exc.status_code = 412
        exc.error_code = "PRECONDITION_FAILED"
        raise exc


def _check_name_conflict(environment_id: str, name: str) -> None:
    """Raise ConflictException if another environment already uses this name."""
    for other_id, other_env in _environments.items():
        if other_id != environment_id and other_env["name"] == name:
            raise ConflictException(f"Environment with name '{name}' already exists")


def update_environment(
    environment_id: str,
    name: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    etag: str | None = None,
) -> dict[str, Any] | None:
    """Update an existing environment.

    Args:
        environment_id: The environment UUID.
        name: New name (optional).
        description: New description (optional, empty string clears).
        tags: New tags (optional, replaces existing tags).
        etag: Optional ETag for concurrency control.

    Returns:
        Updated environment dict, or None if not found.

    Raises:
        ValueError: If new name conflicts with existing environment, tags invalid,
            or ETag mismatch.
    """
    env = _cached_environment(environment_id)
    if env is None:
        return None

    _check_etag(env, etag)

    if name is not None:
        name = name.strip()
        _check_name_conflict(environment_id, name)
        env["name"] = name

    # Update description (empty string clears it)
    if description is not None:
        env["description"] = None if description == "" else description

    if tags is not None:
        env["tags"] = _validate_tags(tags)

    env["updated_at"] = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")

    _save_environment(env)

    return dict(env)


def _cascade_remove_env_from_profiles(environment_id: str) -> None:
    """Remove the env_id key from every profile's environment_values.

    Called as part of environment deletion. Profiles that had values for the
    deleted environment lose those values. Each touched profile is re-saved
    with a fresh updated_at timestamp.
    """
    from wavecore.api.services.profiles import _common as _profile_common

    now = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    for profile in _profile_common._profile_storage.values():
        env_values = profile.get("environment_values")
        if isinstance(env_values, dict) and environment_id in env_values:
            del env_values[environment_id]
            profile["updated_at"] = now
            _profile_common._save_profile(profile)


def delete_environment(environment_id: str) -> bool:
    """Delete an environment.

    Args:
        environment_id: The environment UUID.

    Returns:
        True if deleted, False if not found.

    When the environment is in use by profiles, their per-environment values
    for this environment are dropped (cascade). Callers are responsible for
    surfacing a confirmation flow before invoking this.
    """
    env = _cached_environment(environment_id)
    if env is None:
        return False

    # Cascade-clean the env from every profile's environment_values.
    _cascade_remove_env_from_profiles(environment_id)

    # Delete from file storage
    _delete_environment_files(environment_id)
    # Remove from in-memory cache
    del _environments[environment_id]

    return True


def duplicate_environment(environment_id: str) -> dict[str, Any] | None:
    """Create a copy of an existing environment.

    Args:
        environment_id: The source environment UUID.

    Returns:
        New environment dict, or None if source not found.
    """
    source = _cached_environment(environment_id)
    if source is None:
        return None

    # Generate unique copy name
    new_name = _generate_unique_copy_name(source["name"])

    # Create new environment
    now = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    new_id = str(uuid.uuid4())

    new_env: dict[str, Any] = {
        "id": new_id,
        "name": new_name,
        "tags": list(source.get("tags", [])),  # Copy tags
        "created_at": now,
        "updated_at": now,
    }

    # Copy description if present
    if source.get("description"):
        new_env["description"] = source["description"]

    # Save to file storage
    _save_environment(new_env)
    # Update in-memory cache
    _environments[new_id] = new_env

    return new_env


def list_all_tags() -> list[str]:
    """Get all unique tags from all environments.

    Returns:
        List of unique tag strings, sorted alphabetically
    """
    _reconcile_cache()
    tags_set: set[str] = set()
    for env in _environments.values():
        tags_set.update(env.get("tags", []))
    return sorted(tags_set)


def list_environment_names() -> list[dict[str, Any]]:
    """Get all environments with minimal data for dropdowns.

    Returns all environments without pagination, including only the fields
    needed for selection UI: id, name, and tags.

    Returns:
        List of dicts with id, name, and tags fields, sorted by name
    """
    _reconcile_cache()

    result = [
        {
            "id": env["id"],
            "name": env["name"],
            "tags": env.get("tags", []),
        }
        for env in _environments.values()
    ]

    # Sort by name for consistent ordering
    result.sort(key=lambda x: x["name"].lower())

    return result


def _sanitize_filename(name: str) -> str:
    """Sanitize a name for use as a filename."""
    return export_file_stem(name, "environment")


def _generate_unique_name(base_name: str) -> str:
    """Generate a unique name by appending (2), (3), etc."""
    _reconcile_cache()
    return first_free_name(base_name, {env["name"] for env in _environments.values()})


def export_environment(env_id: str, fmt: str = "yaml") -> tuple[str, str] | None:
    """Export a single environment as serialized content.

    Returns (content_string, filename) or None if not found.
    """
    env = _cached_environment(env_id)
    if env is None:
        return None

    # Create export data (copy without internal fields)
    export_data = dict(env)

    filename_base = _sanitize_filename(env["name"])
    if fmt == "json":
        content = json.dumps(export_data, indent=2)
        filename = f"{filename_base}.json"
    else:
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)
        filename = f"{filename_base}.yaml"

    return content, filename


def export_environments_batch(env_ids: list[str], fmt: str = "yaml") -> list[tuple[str, str, str]]:
    """Export multiple environments.

    Returns list of (env_id, content_string, filename).
    Raises ValueError if any environment not found.
    """
    _reconcile_cache()
    results: list[tuple[str, str, str]] = []
    used_filenames: set[str] = set()

    for env_id in env_ids:
        env = _environments.get(env_id)
        if env is None:
            raise NotFoundException(f"Environment not found: {env_id}")

        export_data = dict(env)
        filename_base = _sanitize_filename(env["name"])
        ext = ".json" if fmt == "json" else ".yaml"
        filename = f"{filename_base}{ext}"

        # Deduplicate filenames
        if filename in used_filenames:
            counter = 2
            while f"{filename_base}-{counter}{ext}" in used_filenames:
                counter += 1
            filename = f"{filename_base}-{counter}{ext}"
        used_filenames.add(filename)

        if fmt == "json":
            content = json.dumps(export_data, indent=2)
        else:
            content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)

        results.append((env_id, content, filename))

    return results


def validate_environment_import(content: bytes, filename: str) -> dict[str, Any]:
    """Validate file content for import without persisting.

    Returns validation result with per-environment status.
    """
    _reconcile_cache()

    lower = filename.lower()
    if lower.endswith(".zip"):
        entries = parse_zip_file(content)
        items = [data for _, data in entries]
    else:
        data = parse_file(content, filename)
        items = [data]

    existing_names: dict[str, str] = {}
    for env in _environments.values():
        existing_names[env["name"]] = env["id"]

    environments: list[dict[str, Any]] = []
    importable = 0
    blocked = 0

    for item in items:
        name = item.get("name", "")
        fatal_errors: list[dict[str, str]] = []
        fixable_errors: list[dict[str, str]] = []
        warnings: list[dict[str, str]] = []
        existing_environment_id: str | None = None

        if not name:
            fatal_errors.append({"code": "MISSING_NAME", "message": "Environment must have a name"})
            item_status = "fatal"
            blocked += 1
        elif name in existing_names:
            existing_environment_id = existing_names[name]
            item_status = "conflict"
            importable += 1
        else:
            item_status = "ok"
            importable += 1

        environments.append(
            {
                "name": name or "",
                "status": item_status,
                "fatal_errors": fatal_errors,
                "fixable_errors": fixable_errors,
                "warnings": warnings,
                "existing_environment_id": existing_environment_id,
            }
        )

    return {
        "environments": environments,
        "total": len(items),
        "importable": importable,
        "blocked": blocked,
    }


def _build_env_data(env_id: str, name: str, item: dict[str, Any]) -> dict[str, Any]:
    """Build an environment data dict for import persistence."""
    now = datetime.now(UTC).isoformat().replace(_TZ_UTC_SUFFIX, "Z")
    env_data: dict[str, Any] = {
        "id": env_id,
        "name": name,
        "tags": item.get("tags", []),
        "created_at": now,
        "updated_at": now,
    }
    if item.get("description") is not None:
        env_data["description"] = item["description"]
    return env_data


def persist_environment_document(env_data: dict[str, Any]) -> None:
    """Write a whole environment document as given and show it at once."""
    _save_environment(env_data)
    _environments[env_data["id"]] = env_data


def _import_single_item(
    item: dict[str, Any],
    existing_names: dict[str, str],
    resolutions: dict[str, str],
) -> dict[str, Any]:
    """Import a single environment item, handling conflicts.

    Returns a result dict with 'action' key ('skipped', 'overwritten', 'renamed', 'created')
    and item metadata.
    """
    name = item["name"]

    if name not in existing_names:
        env_data = _build_env_data(str(uuid.uuid4()), name, item)
        persist_environment_document(env_data)
        existing_names[name] = env_data["id"]
        return {"name": name, "id": env_data["id"], "action": "created"}

    resolution = resolutions.get(name, "rename")

    if resolution == "skip":
        return {"name": name, "reason": "skipped by user", "action": "skipped"}

    if resolution == "overwrite":
        existing_id = existing_names[name]
        env_data = _build_env_data(existing_id, name, item)
        persist_environment_document(env_data)
        return {"name": name, "id": existing_id, "action": "overwritten"}

    # rename
    new_name = _generate_unique_name(name)
    env_data = _build_env_data(str(uuid.uuid4()), new_name, item)
    persist_environment_document(env_data)
    existing_names[new_name] = env_data["id"]
    return {"name": new_name, "id": env_data["id"], "action": "renamed"}


def import_environments(
    content: bytes,
    filename: str,
    conflict_resolutions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import environments from file content.

    Returns import result with imported/skipped items.
    Raises ValueError on fatal validation errors.
    """
    _reconcile_cache()
    resolutions = conflict_resolutions or {}

    lower = filename.lower()
    if lower.endswith(".zip"):
        entries = parse_zip_file(content)
        items = [data for _, data in entries]
    else:
        data = parse_file(content, filename)
        items = [data]

    for item in items:
        if not item.get("name"):
            raise ValidationException("Fatal validation errors prevent import")

    existing_names: dict[str, str] = {env["name"]: env["id"] for env in _environments.values()}

    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for item in items:
        result = _import_single_item(item, existing_names, resolutions)
        if result["action"] == "skipped":
            skipped.append({"name": result["name"], "reason": result["reason"]})
        else:
            imported.append(result)

    return {
        "imported": imported,
        "skipped": skipped,
        "fixes_applied": [],
        "total_imported": len(imported),
        "total_skipped": len(skipped),
    }
