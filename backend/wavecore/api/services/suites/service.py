"""Suite service layer for business logic (REQ-5.2.4.4).

This module provides the service layer for suite management operations.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.shared import (
    batch_clone,
    batch_delete,
    bump_version_and_record,
    mask_secret_variables,
    read_secret_variables,
    refuse_unknown_members,
    restore_masked_secrets,
)
from wavecore.api.services.suites import _storage
from wavecore.api.services.suites._storage import (
    _SUITE_SORT_KEY_MAP,
    _add_computed_fields,
    _apply_suite_field_updates,
    _batch_suite_execution_info,
    _batch_suite_test_counts,
    _delete_suite_files,
    _filter_suites,
    _list_all_suites,
    _load_suite,
    _load_versions,
    _paginate_suites,
    _save_suite,
    _save_versions,
    _test_exists,
    _validate_suite_update,
)
from wavecore.api.services.variable_service import refuse_value_problems

__all__ = ["_list_all_suites"]

# ===========================================================================
# CRUD
# ===========================================================================


def list_suites(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    status: list[str] | None = None,
    tags: list[str] | None = None,
    sort_by: str | None = None,
    sort_order: str | None = None,
) -> dict[str, Any]:
    """List suites with filtering and pagination."""
    exec_info = _batch_suite_execution_info()
    test_counts = _batch_suite_test_counts()
    filtered_suites = [_add_computed_fields(s, exec_info, test_counts) for s in _list_all_suites()]
    filtered_suites = _filter_suites(filtered_suites, search, status, tags)

    if sort_by:
        key_fn = _SUITE_SORT_KEY_MAP.get(sort_by, lambda s: "")
        filtered_suites.sort(key=key_fn, reverse=(sort_order or "asc") == "desc")

    paginated, total, total_pages = _paginate_suites(filtered_suites, page, per_page)

    return {
        "suites": paginated,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def create_suite(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new suite."""
    name = data.get("name", "")
    for suite in _list_all_suites():
        if suite.get("name") == name:
            raise ConflictException(f"Suite with name '{name}' already exists")

    suite_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()

    tests = data.get("tests", [])
    refuse_unknown_members(tests, (), "Test", _test_exists)
    variables = data.get("variables", {})
    refuse_value_problems(variables)
    _check_test_membership_collisions(suite_id, variables, tests)

    suite = {
        "id": suite_id,
        "name": name,
        "version": "1.0.0",
        "description": data.get("description", ""),
        "tests": tests,
        "tags": data.get("tags", []),
        "variables": variables,
        "metadata": data.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }

    stored_suite = suite.copy()
    _save_suite(stored_suite)
    suite["variables"] = mask_secret_variables(stored_suite["variables"])

    _save_versions(
        suite_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": "Initial version",
            }
        ],
    )

    # Update relation index for initial tests
    from wavecore.api.services.relations import service as relation_service

    for test_id in suite.get("tests", []):
        relation_service.on_test_added_to_suite(suite_id, name, test_id)

    return suite


def get_suite(suite_id: str) -> dict[str, Any] | None:
    """Get suite by ID."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None

    result = suite.copy()
    result["variables"] = read_secret_variables(suite.get("variables", {}))
    result = _add_computed_fields(result)
    return result


def list_suite_documents() -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    """Every stored suite in stored form, each with its history rows."""
    return [(suite, _load_versions(suite["id"])) for suite in _list_all_suites()]


def persist_suite_document(suite_data: dict[str, Any], history: list[dict[str, Any]]) -> None:
    """Write a whole suite and its history rows as given."""
    suite_id = suite_data["id"]
    is_new = not _storage._get_suite_dir(suite_id).exists()
    try:
        _storage._save_suite(suite_data)
        _storage._save_versions(suite_id, history)
    except Exception:
        if is_new:
            _delete_suite_files(suite_id)
        raise


def _raise_collision(
    collisions: list[dict[str, str]],
    extra_details: dict[str, Any] | None = None,
) -> None:
    """Raise ConflictException with formatted collision message."""
    collision_details = "; ".join(
        f"variable '{c['variable']}' is '{c['this_type']}' here but "
        f"'{c['other_type']}' in suite '{c['other_suite']}'"
        for c in collisions
    )
    details: dict[str, Any] = {"collisions": collisions}
    if extra_details:
        details.update(extra_details)
    raise ConflictException(
        f"Variable type collision: {collision_details}",
        details=details,
    )


def _check_variable_collisions(
    suite: dict[str, Any], suite_id: str, proposed_vars: dict[str, Any], kept_test_ids: list[str]
) -> None:
    """Check the variables whose type changes against the other Suites of the kept Tests."""
    from wavecore.api.services.suites.variable_validation import (
        check_variable_collisions_for_tests,
        compute_variable_delta,
    )

    delta = compute_variable_delta(suite.get("variables", {}), proposed_vars)
    collisions = check_variable_collisions_for_tests(
        exclude_suite_id=suite_id,
        test_ids=kept_test_ids,
        proposed_variables={name: proposed_vars[name] for name in delta},
    )
    if collisions:
        _raise_collision(collisions)


def _check_test_membership_collisions(
    suite_id: str, suite_vars: dict[str, Any], new_test_ids: list[str]
) -> None:
    """Check the Suite's variables against the other Suites of the Tests it gains."""
    from wavecore.api.services.relations import service as relation_service
    from wavecore.api.services.suites.variable_validation import (
        check_variable_collisions_for_tests,
    )

    if not new_test_ids or not suite_vars:
        return

    collisions = check_variable_collisions_for_tests(
        exclude_suite_id=suite_id,
        test_ids=new_test_ids,
        proposed_variables=suite_vars,
    )
    if not collisions:
        return

    conflicting_suite_ids = {c["other_suite_id"] for c in collisions}
    conflicting_test_ids: list[str] = []
    for tid in new_test_ids:
        for entry in relation_service.get_suites_for_test(tid):
            if entry["id"] in conflicting_suite_ids:
                conflicting_test_ids.append(tid)
                break
    _raise_collision(collisions, {"conflicting_test_ids": sorted(set(conflicting_test_ids))})


def _check_update_collisions(
    suite: dict[str, Any],
    suite_id: str,
    data: dict[str, Any],
    old_tests: set[str],
) -> None:
    """Check the proposed Tests and variables for type collisions before an update is applied."""
    proposed_tests = data.get("tests", suite.get("tests", []))
    proposed_vars = data.get("variables", suite.get("variables", {}))
    _check_variable_collisions(
        suite,
        suite_id,
        proposed_vars,
        [test_id for test_id in proposed_tests if test_id in old_tests],
    )
    _check_test_membership_collisions(
        suite_id,
        proposed_vars,
        [test_id for test_id in proposed_tests if test_id not in old_tests],
    )


def update_suite(
    suite_id: str, data: dict[str, Any], etag: str | None = None
) -> dict[str, Any] | None:
    """Update suite."""
    from wavecore.api.services.relations import service as relation_service

    suite = _load_suite(suite_id)
    if suite is None:
        return None

    old_name = suite.get("name", "")
    old_tests = set(suite.get("tests", []))

    # Restore masked secrets against the stored (sealed) values before persisting.
    if "variables" in data:
        data = {
            **data,
            "variables": restore_masked_secrets(data["variables"], suite.get("variables", {})),
        }

    _validate_suite_update(suite, suite_id, data, etag)
    if "tests" in data:
        refuse_unknown_members(data["tests"], old_tests, "Test", _test_exists)
    if "variables" in data:
        refuse_value_problems(data["variables"])
    _check_update_collisions(suite, suite_id, data, old_tests)
    _apply_suite_field_updates(suite, data)

    bump_version_and_record(
        entity=suite,
        entity_id=suite_id,
        change_description=data.get("description", "Update"),
        save_entity=_save_suite,
        load_versions=_load_versions,
        save_versions=_save_versions,
    )

    # Update relation index
    new_name = suite.get("name", "")
    if new_name != old_name:
        relation_service.on_suite_renamed(suite_id, new_name)

    new_tests = set(suite.get("tests", []))
    if new_tests != old_tests:
        for test_id in new_tests - old_tests:
            relation_service.on_test_added_to_suite(suite_id, new_name, test_id)
        for test_id in old_tests - new_tests:
            relation_service.on_test_removed_from_suite(suite_id, test_id)

    result = suite.copy()
    result["variables"] = mask_secret_variables(suite.get("variables", {}))
    return result


def delete_suite(suite_id: str) -> bool:
    """Delete suite.

    Rejects with ``ConflictException`` when a suite-type tracked execution is
    still ``running`` or ``paused``. On success the suite is removed from every
    regression that references it so no dangling suite IDs remain, and the
    relation index is updated to drop the suite's test-membership entries.
    """
    from wavecore.api.services.executions import _storage as _exec_storage
    from wavecore.api.services.regressions import service as regression_service
    from wavecore.api.services.relations import service as relation_service

    suite = _load_suite(suite_id)
    if suite is None:
        return False

    blocking = _exec_storage.get_active_tracked_executions("suite", suite_id)
    if blocking:
        raise ConflictException(
            f"Cannot delete suite '{suite_id}': execution is running or paused",
            details={"execution_ids": blocking},
        )

    # Cascade: remove this suite from every regression that references it.
    # Snapshot the ids first because remove_suite_from_regression mutates the
    # underlying index that get_regressions_for_suite returned.
    referencing_regression_ids = [
        entry["id"] for entry in relation_service.get_regressions_for_suite(suite_id)
    ]
    for regression_id in referencing_regression_ids:
        regression_service.remove_suite_from_regression(regression_id, suite_id)

    # Update relation index (remove this suite from all test entries + drop
    # this suite's regression-membership list).
    relation_service.on_suite_deleted(suite_id)

    _delete_suite_files(suite_id)
    return True


def batch_delete_suites(suite_ids: list[Any]) -> dict[str, Any]:
    """Delete multiple suites in a batch."""
    return batch_delete(suite_ids, delete_suite, "Suite")


def batch_clone_suites(suite_ids: list[Any]) -> dict[str, Any]:
    """Clone multiple suites in a batch."""
    from wavecore.api.services.suites import version_service

    return batch_clone(suite_ids, version_service.clone_suite, "Suite")


def get_suite_variables(suite_id: str) -> dict[str, Any] | None:
    """Get suite variables."""
    suite = _load_suite(suite_id)
    if suite is None:
        return None
    return read_secret_variables(suite.get("variables", {}))


def get_suite_variables_raw(suite_id: str) -> dict[str, Any] | None:
    """Suite variables without masking, for engine injection only.

    The masked getter stays the API-facing read; the engine must receive
    real values so secret-flagged ones can register with the run registry.
    """
    suite = _load_suite(suite_id)
    if suite is None:
        return None
    return {
        name: dict(var_info) if isinstance(var_info, dict) else var_info
        for name, var_info in suite.get("variables", {}).items()
    }


def get_suite_tests(suite_id: str) -> list[dict[str, Any]] | None:
    """Get tests belonging to a suite with full metadata.

    Returns the same fields as the tests list endpoint so the suite detail
    page can display consistent columns (status, tags, timestamps, etc.).
    """
    from wavecore.api.services.tests import service as test_service

    suite = _load_suite(suite_id)
    if suite is None:
        return None
    test_ids = suite.get("tests", [])
    if not test_ids:
        return []

    results: list[dict[str, Any]] = []
    for tid in test_ids:
        test = test_service.get_test(tid)
        if test:
            results.append(
                {
                    "id": test["id"],
                    "name": test.get("name", ""),
                    "version": test.get("version", ""),
                    "created_at": test.get("created_at", ""),
                    "updated_at": test.get("updated_at", ""),
                    "tags": test.get("tags", []),
                    "metadata": test.get("metadata", {}),
                }
            )
    return results


def list_all_tags() -> list[str]:
    """Get all unique tags from all suites."""
    tags_set: set[str] = set()
    for suite in _list_all_suites():
        tags_set.update(suite.get("tags", []))
    return sorted(tags_set)


def list_suite_names() -> list[dict[str, str]]:
    """Get all suites with minimal data for dropdowns."""
    suites = _list_all_suites()
    result = [{"id": s["id"], "name": s["name"]} for s in suites]
    result.sort(key=lambda s: s["name"].lower())
    return result
