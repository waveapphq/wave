"""Regression service layer for business logic (REQ-5.2.4.5).

This module provides the service layer for regression suite operations.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.regressions import _storage
from wavecore.api.services.regressions._storage import (
    _batch_regression_counts,
    _batch_regression_execution_info,
    _delete_regression_files,
    _enrich_regression_with_aggregates,
    _filter_regressions,
    _list_all_regressions,
    _load_regression,
    _load_versions,
    _make_regression_sort_key,
    _paginate,
    _save_regression,
    _save_versions,
    _suite_exists,
    _validate_name,
)
from wavecore.api.services.shared import (
    batch_clone,
    batch_delete,
    bump_version_and_record,
    read_secret_variables,
    refuse_unknown_members,
    resolve_entities_by_ids,
    restore_masked_secrets,
)
from wavecore.api.services.variable_service import refuse_value_problems


def _mask_regression_variables(regression: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of ``regression`` with secret variable values masked.

    Applied at the service boundary so every read path (get, list, create,
    update, clone) returns masked values without leaking secrets through
    the API. Persistence continues to store the real values.
    """
    if "variables" not in regression:
        return regression
    masked = regression.copy()
    masked["variables"] = read_secret_variables(regression.get("variables", {}))
    return masked


__all__ = ["_list_all_regressions"]

# ===========================================================================
# CRUD
# ===========================================================================


def list_regressions(
    page: int = 1,
    per_page: int = 20,
    search: str | None = None,
    status: list[str] | None = None,
    tags: list[str] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> dict[str, Any]:
    """List regressions with filtering and pagination."""
    all_regressions = _list_all_regressions()
    exec_info = _batch_regression_execution_info()
    aggregate_counts = _batch_regression_counts()
    enriched_regressions = [
        _enrich_regression_with_aggregates(r, exec_info, aggregate_counts) for r in all_regressions
    ]

    enriched_regressions = _filter_regressions(enriched_regressions, search, status, tags)

    if sort_by:
        reverse = (sort_direction or "asc") == "desc"
        enriched_regressions.sort(key=_make_regression_sort_key(sort_by, reverse), reverse=reverse)

    paginated, total, total_pages = _paginate(enriched_regressions, page, per_page)
    paginated = [_mask_regression_variables(r) for r in paginated]

    return {
        "regressions": paginated,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def create_regression(data: dict[str, Any]) -> dict[str, Any]:
    """Create a new regression."""
    from wavecore.api.services.relations import service as relation_service

    name = data.get("name", "")
    _validate_name(name)

    for regression in _list_all_regressions():
        if regression.get("name") == name:
            raise ConflictException(f"Regression with name '{name}' already exists")

    suites = data.get("suites", [])
    refuse_unknown_members(suites, (), "Suite", _suite_exists)
    variables = data.get("variables", {})
    refuse_value_problems(variables or {})

    regression_id = str(uuid.uuid4())
    now = datetime.now(UTC).isoformat()
    # A new Regression is checked as an update of an empty one.
    _check_regression_variable_collisions(
        {}, regression_id, {"suites": suites, "variables": variables}
    )

    regression = {
        "id": regression_id,
        "name": name,
        "version": "1.0.0",
        "description": data.get("description", ""),
        "suites": suites,
        "tags": data.get("tags", []),
        "variables": variables,
        "metadata": data.get("metadata", {}),
        "created_at": now,
        "updated_at": now,
    }

    _save_regression(regression)

    _save_versions(
        regression_id,
        [
            {
                "version": "1.0.0",
                "created_at": now,
                "created_by": "system",
                "changes": "Initial version",
                "snapshot": {
                    "description": regression["description"],
                    "suites": regression["suites"],
                    "variables": regression["variables"],
                },
            }
        ],
    )

    for suite_id in suites:
        relation_service.on_suite_added_to_regression(regression_id, name, suite_id)

    return _mask_regression_variables(regression)


def get_regression(regression_id: str) -> dict[str, Any] | None:
    """Get regression by ID with computed status and execution metadata.

    Enriches the raw YAML record with the same derived fields the list
    endpoint provides (status, last_run, suites_count, tests_count) so
    the detail page receives the identical shape and can render the
    metadata sidebar without branching on optional fields. Also attaches
    a duplicate_tests map the Run dialog and Execution Detail use to
    render the duplicate-test badge for tests that appear in two or more
    member suites of the regression.
    """
    regression = _load_regression(regression_id)
    if regression is None:
        return None
    exec_info = _batch_regression_execution_info()
    aggregate_counts = _batch_regression_counts()
    enriched = _enrich_regression_with_aggregates(regression, exec_info, aggregate_counts)
    enriched["duplicate_tests"] = _compute_duplicate_tests(regression.get("suites") or [])
    return _mask_regression_variables(enriched)


def list_regression_documents() -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    """Every stored regression in stored form, each with its history rows."""
    return [
        (regression, _load_versions(regression["id"])) for regression in _list_all_regressions()
    ]


def persist_regression_document(
    regression_data: dict[str, Any], history: list[dict[str, Any]]
) -> None:
    """Write a whole regression and its history rows as given."""
    regression_id = regression_data["id"]
    is_new = not _storage._get_regression_dir(regression_id).exists()
    try:
        _storage._save_regression(regression_data)
        _storage._save_versions(regression_id, history)
    except Exception:
        if is_new:
            _delete_regression_files(regression_id)
        raise


def _compute_duplicate_tests(suite_ids: list[str]) -> dict[str, list[str]]:
    """Return {test_id: [suite_id, ...]} for tests appearing in 2+ suites.

    The list-of-suites respects the regression's declared suite order so
    the frontend can render "this test runs in Suite A then Suite B".
    """
    from wavecore.api.services.suites import service as suite_service

    occurrences: dict[str, list[str]] = {}
    for suite_id in suite_ids:
        suite = suite_service.get_suite(suite_id)
        if suite is None:
            continue
        for test_id in suite.get("tests", []) or []:
            occurrences.setdefault(test_id, []).append(suite_id)
    return {test_id: suites for test_id, suites in occurrences.items() if len(suites) >= 2}


def get_regression_duplicate_tests(regression_id: str) -> dict[str, list[str]]:
    """Expose the duplicate-test map for a regression.

    Returns an empty dict when the regression does not exist, is empty, or
    has no shared tests across its suites.
    """
    regression = _load_regression(regression_id)
    if regression is None:
        return {}
    return _compute_duplicate_tests(regression.get("suites") or [])


def _raise_pair_collision(pair_collisions: list[dict[str, str]]) -> None:
    """Raise ConflictException for suite-pair collisions inside a regression."""
    conflicting_ids = list(
        {c["this_suite_id"] for c in pair_collisions}
        | {c["other_suite_id"] for c in pair_collisions}
    )
    collision_details = "; ".join(
        f"variable '{c['variable']}' is '{c['this_type']}' in suite "
        f"'{c['this_suite']}' but '{c['other_type']}' in suite '{c['other_suite']}'"
        for c in pair_collisions
    )
    raise ConflictException(
        f"Variable type collision: {collision_details}",
        details={"collisions": pair_collisions, "conflicting_suite_ids": conflicting_ids},
    )


def _raise_suite_level_collision(suite_collisions: list[dict[str, str]]) -> None:
    """Raise ConflictException for regression-vs-member-suite collisions."""
    conflicting_ids = list({c["other_suite_id"] for c in suite_collisions})
    collision_details = "; ".join(
        f"variable '{c['variable']}' is '{c['this_type']}' here but "
        f"'{c['other_type']}' in suite '{c['other_suite']}'"
        for c in suite_collisions
    )
    raise ConflictException(
        f"Variable type collision: {collision_details}",
        details={"collisions": suite_collisions, "conflicting_suite_ids": conflicting_ids},
    )


def _check_suite_pair_collisions(prospective_suite_ids: list[str]) -> None:
    """Raise if two member suites disagree on a variable type (suite-pair kind)."""
    from wavecore.api.services.regressions.variable_validation import (
        check_suite_pair_collisions,
    )

    if not prospective_suite_ids or len(prospective_suite_ids) < 2:
        return
    pair_collisions = check_suite_pair_collisions(prospective_suite_ids)
    if pair_collisions:
        _raise_pair_collision(pair_collisions)


def _compute_delta_for_collision_check(
    regression: dict[str, Any],
    data: dict[str, Any],
    proposed_vars: dict[str, Any],
) -> list[str] | None:
    """Return variable names to validate, or ``None`` to skip Checks 1 and 2.

    When the PUT body echoes variables unchanged (delta == []) we can skip
    Checks 1 and 2 ONLY if the suite membership is also unchanged. If suites
    also changed, newly-overlapping suites / regressions may conflict with
    the existing variable set, so we must still run the checks on the full
    variable set.
    """
    from wavecore.api.services.regressions.variable_validation import (
        compute_regression_variable_delta,
    )

    current_vars = regression.get("variables", {})
    suites_changed = "suites" in data and data["suites"] != regression.get("suites", [])
    if "variables" not in data:
        return list(proposed_vars.keys())
    delta = compute_regression_variable_delta(current_vars, proposed_vars)
    if delta:
        return delta
    if suites_changed:
        return list(proposed_vars.keys())
    return None


def _check_regression_variable_collisions(
    regression: dict[str, Any],
    regression_id: str,
    data: dict[str, Any],
) -> None:
    """Check for variable type collisions.

    Three levels of validation:
    1. Regression vars vs member SUITE vars (regression.env:string vs suite.env:integer)
    2. Regression vars vs OTHER REGRESSIONS sharing suites
    3. SUITE-to-SUITE within the regression (two member suites cannot declare
       the same variable name with different types)
    """
    from wavecore.api.services.regressions.variable_validation import (
        check_variable_collisions_for_regression,
        check_variable_collisions_for_suites,
    )

    prospective_suite_ids = data.get("suites", regression.get("suites", []))
    _check_suite_pair_collisions(prospective_suite_ids)

    proposed_vars = data.get("variables")
    if proposed_vars is None:
        proposed_vars = regression.get("variables", {})
        if not proposed_vars:
            return

    if not prospective_suite_ids:
        return

    delta = _compute_delta_for_collision_check(regression, data, proposed_vars)
    if delta is None:
        return

    suite_collisions = check_variable_collisions_for_regression(
        suite_ids=prospective_suite_ids,
        variable_names_to_check=delta,
        proposed_variables=proposed_vars,
    )
    if suite_collisions:
        _raise_suite_level_collision(suite_collisions)

    collisions = check_variable_collisions_for_suites(
        exclude_regression_id=regression_id,
        suite_ids=prospective_suite_ids,
        proposed_variables=proposed_vars,
    )
    if collisions:
        conflicting_ids = list({c["other_regression_id"] for c in collisions})
        _raise_regression_collision(collisions, conflicting_ids)


def _raise_regression_collision(
    collisions: list[dict[str, str]],
    conflicting_regression_ids: list[str],
) -> None:
    """Raise ConflictException with formatted collision message."""
    collision_details = "; ".join(
        f"variable '{c['variable']}' is '{c['this_type']}' here but "
        f"'{c['other_type']}' in regression '{c['other_regression']}'"
        for c in collisions
    )
    raise ConflictException(
        f"Variable type collision: {collision_details}",
        details={
            "collisions": collisions,
            "conflicting_regression_ids": conflicting_regression_ids,
        },
    )


def update_regression(regression_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Update regression."""
    regression = _load_regression(regression_id)
    if regression is None:
        return None

    # Restore masked secrets against the stored (sealed) values before persisting the
    # definition and its version snapshot.
    if "variables" in data:
        data = {
            **data,
            "variables": restore_masked_secrets(data["variables"], regression.get("variables", {})),
        }

    _validate_update_name_uniqueness(regression_id, data)
    if "suites" in data:
        refuse_unknown_members(
            data["suites"], regression.get("suites") or [], "Suite", _suite_exists
        )
    if "variables" in data:
        refuse_value_problems(data["variables"])
    _check_regression_variable_collisions(regression, regression_id, data)

    name_changed = "name" in data and data["name"] != regression.get("name")
    old_suites: set[str] = set(regression.get("suites") or [])
    suites_changed = "suites" in data

    _apply_regression_field_updates(regression, data)

    bump_version_and_record(
        entity=regression,
        entity_id=regression_id,
        change_description=data.get("description", "Update"),
        save_entity=_save_regression,
        load_versions=_load_versions,
        save_versions=_save_versions,
        extra_fields={
            "snapshot": {
                "description": regression["description"],
                "suites": regression["suites"],
                "variables": regression["variables"],
            },
        },
    )

    _propagate_regression_relation_hooks(
        regression_id,
        regression.get("name", ""),
        name_changed=name_changed,
        suites_changed=suites_changed,
        old_suites=old_suites,
        new_suites=set(regression.get("suites") or []),
    )

    return _mask_regression_variables(regression)


def _validate_update_name_uniqueness(regression_id: str, data: dict[str, Any]) -> None:
    if "name" not in data:
        return
    new_name = data["name"]
    for r in _list_all_regressions():
        if r.get("name") == new_name and r.get("id") != regression_id:
            raise ConflictException(f"Regression with name '{new_name}' already exists")


_MUTABLE_REGRESSION_FIELDS = ("name", "description", "suites", "variables", "tags", "metadata")


def _apply_regression_field_updates(regression: dict[str, Any], data: dict[str, Any]) -> None:
    for field in _MUTABLE_REGRESSION_FIELDS:
        if field in data:
            regression[field] = data[field]


def _propagate_regression_relation_hooks(
    regression_id: str,
    current_name: str,
    *,
    name_changed: bool,
    suites_changed: bool,
    old_suites: set[str],
    new_suites: set[str],
) -> None:
    from wavecore.api.services.relations import service as relation_service

    if name_changed:
        relation_service.on_regression_renamed(regression_id, current_name)
    if not suites_changed:
        return
    for suite_id in new_suites - old_suites:
        relation_service.on_suite_added_to_regression(regression_id, current_name, suite_id)
    for suite_id in old_suites - new_suites:
        relation_service.on_suite_removed_from_regression(regression_id, suite_id)


def remove_suite_from_regression(regression_id: str, suite_id: str) -> None:
    """Remove a single suite from a regression's suites list.

    Called by the suite delete cascade so each referencing regression drops
    the deleted suite id. Skipped silently if the regression no longer exists
    or does not reference the suite - both are benign on a cascade.
    """
    from wavecore.api.services.relations import service as relation_service

    regression = _load_regression(regression_id)
    if regression is None:
        return
    suites = list(regression.get("suites") or [])
    if suite_id not in suites:
        return
    regression["suites"] = [s for s in suites if s != suite_id]
    regression["updated_at"] = datetime.now(UTC).isoformat()
    _save_regression(regression)
    relation_service.on_suite_removed_from_regression(regression_id, suite_id)


def delete_regression(regression_id: str) -> bool:
    """Delete regression.

    Rejects with ``ConflictException`` carrying ``execution_ids`` when a
    regression-type tracked execution is still ``running`` or ``paused``.
    """
    from wavecore.api.services.executions import _storage as _exec_storage
    from wavecore.api.services.relations import service as relation_service

    regression = _load_regression(regression_id)
    if regression is None:
        return False

    blocking = _exec_storage.get_active_tracked_executions("regression", regression_id)
    if blocking:
        raise ConflictException(
            f"Cannot delete regression '{regression_id}': execution is running or paused",
            details={"execution_ids": blocking},
        )

    _delete_regression_files(regression_id)
    relation_service.on_regression_deleted(regression_id)
    return True


def batch_delete_regressions(regression_ids: list[Any]) -> dict[str, Any]:
    """Delete multiple regressions in a batch."""
    return batch_delete(regression_ids, delete_regression, "Regression")


def batch_clone_regressions(regression_ids: list[Any]) -> dict[str, Any]:
    """Clone multiple regressions in a batch."""
    from wavecore.api.services.regressions import version_service

    return batch_clone(regression_ids, version_service.clone_regression, "Regression")


# ===========================================================================
# Suite + test queries
# ===========================================================================


def _build_suite_with_tests(suite: dict[str, Any], test_service: Any) -> dict[str, Any]:
    """Build a suite data dict with its tests included."""
    return {
        "id": suite["id"],
        "name": suite.get("name", ""),
        "tests": _get_suite_tests(suite, test_service),
    }


def _find_suites_by_ids(
    suite_ids: list[str], suite_service: Any, test_service: Any
) -> list[dict[str, Any]]:
    """Resolve suites by their IDs and include tests."""
    result = []
    for suite_id in suite_ids:
        suite = suite_service.get_suite(suite_id)
        if suite:
            result.append(_build_suite_with_tests(suite, test_service))
    return result


def _find_suites_by_parent_regression(
    regression_name: str, suite_service: Any, test_service: Any
) -> list[dict[str, Any]]:
    """Find suites whose parent_regression metadata matches the given name."""
    if not regression_name:
        return []
    result = []
    for suite in suite_service._list_all_suites():
        parent_reg = suite.get("metadata", {}).get("parent_regression", "")
        if parent_reg == regression_name:
            result.append(_build_suite_with_tests(suite, test_service))
    return result


def get_regression_suites_with_tests(regression_id: str) -> list[dict[str, Any]] | None:
    """Get suites belonging to a regression with their tests."""
    from wavecore.api.services.suites import service as suite_service
    from wavecore.api.services.tests import service as test_service

    regression = _load_regression(regression_id)
    if regression is None:
        return None

    suite_ids = regression.get("suites", [])
    if suite_ids:
        return _find_suites_by_ids(suite_ids, suite_service, test_service)

    return _find_suites_by_parent_regression(
        regression.get("name", ""), suite_service, test_service
    )


def _get_suite_tests(suite: dict[str, Any], test_service: Any) -> list[dict[str, Any]]:
    """Get tests for a suite."""
    test_ids = suite.get("tests", [])
    if not test_ids:
        return []
    return resolve_entities_by_ids(test_ids, test_service.get_test)


def list_all_tags() -> list[str]:
    """Get all unique tags from all regressions."""
    tags_set: set[str] = set()
    for regression in _list_all_regressions():
        tags_set.update(regression.get("tags", []))
    return sorted(tags_set)
