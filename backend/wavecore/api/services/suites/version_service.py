"""Version management, test composition, and clone operations for suites."""

import uuid
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException, ValidationException
from wavecore.api.services.shared import (
    bump_version_and_record,
    mask_secret_variables,
    next_semantic_version,
)
from wavecore.api.services.suites._storage import (
    _load_suite,
    _load_versions,
    _save_suite,
    _save_versions,
    _test_exists,
)


def list_suite_versions(suite_id: str) -> list[str] | None:
    """List all versions for a suite."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None

    versions = _load_versions(suite_id)
    return [v["version"] for v in versions]


def add_suite_version(suite_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Add a new version to a suite."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None

    versions = _load_versions(suite_id)

    version_bump = data.get("version_bump", "minor")
    new_version = next_semantic_version(str(suite.get("version", "1.0.0")), version_bump)

    now = datetime.now(UTC).isoformat()
    suite["version"] = new_version
    suite["updated_at"] = now
    if "description" in data:
        suite["description"] = data["description"]

    _save_suite(suite)

    versions.append(
        {
            "version": new_version,
            "created_at": now,
            "created_by": "system",
            "changes": data.get("description", "Version update"),
        }
    )
    _save_versions(suite_id, versions)

    result = suite.copy()
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def get_suite_version(suite_id: str, version: str) -> dict[str, Any] | None:
    """Get specific suite version."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None

    versions = _load_versions(suite_id)
    version_exists = any(v["version"] == version for v in versions)
    if not version_exists:
        return None

    result = suite.copy()
    result["version"] = version
    result["is_latest"] = version == suite.get("version")
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def update_suite_version(
    suite_id: str, version: str, data: dict[str, Any]
) -> dict[str, Any] | None:
    """Update specific suite version metadata."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None

    versions = _load_versions(suite_id)
    version_entry = next((v for v in versions if v["version"] == version), None)
    if version_entry is None:
        return None

    if version_entry.get("published"):
        raise ConflictException(
            f"Cannot modify published version '{version}'. Published versions are immutable."
        )

    now = datetime.now(UTC).isoformat()
    if "description" in data:
        suite["description"] = data["description"]
    suite["updated_at"] = now

    _save_suite(suite)

    result = suite.copy()
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def delete_suite_version(suite_id: str, version: str) -> bool:
    """Delete specific suite version."""
    suite = _load_suite(suite_id)
    if suite is None:
        return False

    versions = _load_versions(suite_id)
    version_idx = next((i for i, v in enumerate(versions) if v["version"] == version), None)
    if version_idx is None:
        return False

    version_entry = versions[version_idx]
    refs = version_entry.get("regression_refs", 0)
    if refs > 0:
        raise ConflictException(
            f"Cannot delete version '{version}': {refs} regressions reference this version"
        )

    versions.pop(version_idx)
    _save_versions(suite_id, versions)
    return True


def add_test_to_suite(
    suite_id: str, test_id: str, order: int | None = None
) -> dict[str, Any] | None:
    """Add a test to a suite.

    After adding the test, checks for variable type collisions across all
    suites that now share tests with this suite.  If collisions are found
    the add is rolled back and a ConflictException is raised.
    """
    from wavecore.api.services.relations import service as relation_service
    from wavecore.api.services.suites.variable_validation import (
        check_variable_type_collisions,
    )

    if not _test_exists(test_id):
        raise ValidationException(f"Test with ID '{test_id}' not found")

    suite = _load_suite(suite_id)
    if suite is None:
        return None

    tests = suite.get("tests", [])
    if order is not None and 0 <= order <= len(tests):
        tests.insert(order, test_id)
    else:
        tests.append(test_id)
    suite["tests"] = tests

    bump_version_and_record(
        entity=suite,
        entity_id=suite_id,
        change_description=f"Added test {test_id}",
        save_entity=_save_suite,
        load_versions=_load_versions,
        save_versions=_save_versions,
    )

    # Update relation index
    relation_service.on_test_added_to_suite(suite_id, suite.get("name", ""), test_id)

    # Check for variable type collisions with the newly expanded test set
    suite_vars = suite.get("variables", {})
    all_var_names = list(suite_vars.keys())
    if all_var_names:
        collisions = check_variable_type_collisions(suite_id, all_var_names, suite_vars)
        if collisions:
            # Rollback: remove the test we just added
            tests.remove(test_id)
            suite["tests"] = tests
            _save_suite(suite)
            relation_service.on_test_removed_from_suite(suite_id, test_id)
            collision_details = "; ".join(
                f"variable '{c['variable']}' is '{c['this_type']}' here but "
                f"'{c['other_type']}' in suite '{c['other_suite']}'"
                for c in collisions
            )
            raise ConflictException(
                f"Variable type collision: {collision_details}",
                details={"collisions": collisions},
            )

    result = suite.copy()
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def remove_test_from_suite(suite_id: str, test_id: str) -> dict[str, Any] | None:
    """Remove a test from a suite."""
    from wavecore.api.services.relations import service as relation_service

    suite = _load_suite(suite_id)
    if suite is None:
        return None

    tests = suite.get("tests", [])
    if test_id not in tests:
        return None

    tests.remove(test_id)
    suite["tests"] = tests

    bump_version_and_record(
        entity=suite,
        entity_id=suite_id,
        change_description=f"Removed test {test_id}",
        save_entity=_save_suite,
        load_versions=_load_versions,
        save_versions=_save_versions,
    )

    # Update relation index
    relation_service.on_test_removed_from_suite(suite_id, test_id)

    result = suite.copy()
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def clone_suite(
    suite_id: str, new_name: str | None = None, new_version: str | None = None
) -> dict[str, Any] | None:
    """Clone a suite with a new name."""
    source = _load_suite(suite_id)
    if source is None:
        return None

    if new_name is None:
        new_name = f"{source.get('name', 'Suite')} (Copy)"

    now = datetime.now(UTC).isoformat()
    clone_id = str(uuid.uuid4())

    clone = source.copy()
    clone["id"] = clone_id
    clone["name"] = new_name
    clone["version"] = new_version or "1.0.0"
    clone["created_at"] = now
    clone["updated_at"] = now
    clone["metadata"] = {**source.get("metadata", {}), "cloned_from": suite_id}
    clone["variables"] = source.get("variables", {}).copy()
    clone["tags"] = source.get("tags", []).copy() if source.get("tags") else []

    _save_suite(clone)
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

    result = clone.copy()
    result["variables"] = mask_secret_variables(clone.get("variables", {}))
    return result
