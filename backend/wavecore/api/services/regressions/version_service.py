"""Version management, suite composition, and clone operations for regressions."""

import uuid
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.regressions._storage import (
    _get_regression_tests_count,
    _list_all_regressions,
    _load_regression,
    _load_versions,
    _save_regression,
    _save_versions,
    _suite_exists,
    _version_has_dependencies,
)
from wavecore.api.services.shared import (
    bump_version_and_record,
    mask_secret_variables,
)


def _mask_regression_variables(regression: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of ``regression`` with secret variable values masked.

    Mirrors :func:`wavecore.api.services.regressions.service._mask_regression_variables`
    so every read path in the version service masks before returning.
    """
    if "variables" not in regression:
        return regression
    masked = regression.copy()
    masked["variables"] = mask_secret_variables(regression.get("variables", {}))
    return masked


def list_regression_versions(regression_id: str) -> dict[str, Any] | None:
    """List all versions for a regression."""
    regression = _load_regression(regression_id)
    if regression is None:
        return None

    versions = _load_versions(regression_id)
    return {"versions": versions, "total": len(versions)}


def add_regression_version(regression_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Add a new version to a regression."""
    regression = _load_regression(regression_id)
    if regression is None:
        return None

    if "suites" in data:
        for suite_id in data["suites"]:
            if not _suite_exists(suite_id):
                raise ValidationException(f"Suite with ID '{suite_id}' not found")

    if "description" in data:
        regression["description"] = data["description"]
    if "suites" in data:
        regression["suites"] = data["suites"]

    bump_version_and_record(
        entity=regression,
        entity_id=regression_id,
        change_description=data.get("description", "Version update"),
        save_entity=_save_regression,
        load_versions=_load_versions,
        save_versions=_save_versions,
    )

    return _mask_regression_variables(regression)


def get_regression_version(regression_id: str, version: str) -> dict[str, Any] | None:
    """Get specific regression version."""
    regression = _load_regression(regression_id)
    if regression is None:
        return None

    versions = _load_versions(regression_id)
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        return None

    result = regression.copy()
    result["version"] = version

    snapshot = version_entry.get("snapshot", {})
    if snapshot:
        if "description" in snapshot:
            result["description"] = snapshot["description"]
        if "suites" in snapshot:
            result["suites"] = snapshot["suites"]
        if "variables" in snapshot:
            result["variables"] = snapshot["variables"]

    return _mask_regression_variables(result)


def update_regression_version(
    regression_id: str, version: str, data: dict[str, Any]
) -> dict[str, Any] | None:
    """Update specific regression version metadata."""
    regression = _load_regression(regression_id)
    if regression is None:
        return None

    versions = _load_versions(regression_id)
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        return None

    if version_entry.get("published"):
        raise ConflictException(
            f"Cannot modify published version '{version}': version is immutable"
        )

    now = datetime.now(UTC).isoformat()
    if "description" in data:
        regression["description"] = data["description"]
    regression["updated_at"] = now

    _save_regression(regression)
    return _mask_regression_variables(regression)


def delete_regression_version(regression_id: str, version: str) -> bool:
    """Delete specific regression version."""
    regression = _load_regression(regression_id)
    if regression is None:
        return False

    versions = _load_versions(regression_id)
    version_idx = next((i for i, v in enumerate(versions) if v["version"] == version), None)
    if version_idx is None:
        return False

    if _version_has_dependencies(regression_id, version):
        raise ConflictException(
            f"Cannot delete version '{version}': " "scheduled executions reference this version"
        )

    versions.pop(version_idx)
    _save_versions(regression_id, versions)
    return True


def clone_regression(
    regression_id: str,
    new_name: str | None = None,
) -> dict[str, Any] | None:
    """Clone a regression with a new name."""
    source = _load_regression(regression_id)
    if source is None:
        return None

    if not new_name:
        new_name = f"{source.get('name', 'Regression')} (Copy)"

    for regression in _list_all_regressions():
        if regression.get("name") == new_name:
            raise ConflictException(f"Regression with name '{new_name}' already exists")

    clone_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()

    cloned = {
        "id": clone_id,
        "name": new_name,
        "version": "1.0.0",
        "description": source.get("description", ""),
        "suites": list(source.get("suites", [])),
        "suites_count": len(source.get("suites", [])),
        "tests_count": _get_regression_tests_count(source),
        "variables": dict(source.get("variables", {})),
        "metadata": {"cloned_from": regression_id},
        "tags": list(source.get("tags", [])),
        "status": "never_run",
        "last_run": None,
        "created_at": now,
        "updated_at": now,
    }

    _save_regression(cloned)

    _save_versions(
        clone_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": f"Cloned from regression {regression_id}",
                "snapshot": {
                    "description": cloned["description"],
                    "suites": cloned["suites"],
                    "variables": cloned["variables"],
                },
            }
        ],
    )

    return _mask_regression_variables(cloned)
