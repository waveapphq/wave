"""Dashboard helper functions.

Provides entity count retrieval, execution statistics, recent activity,
entity name resolution, and recent execution collection for the dashboard.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.regressions import _storage as _reg_storage
from wavecore.api.services.suites import _storage as _suite_storage
from wavecore.api.services.tests import service as test_service

# ============================================================================
# Metrics
# ============================================================================


def _list_all_tests() -> list[dict[str, Any]]:
    """List all tests from storage."""
    result: list[dict[str, Any]] = test_service._list_all_tests()
    return result


def _list_all_suites() -> list[dict[str, Any]]:
    """List all suites from storage."""
    result: list[dict[str, Any]] = _suite_storage._list_all_suites()
    return result


def _list_all_regressions() -> list[dict[str, Any]]:
    """List all regressions from storage."""
    result: list[dict[str, Any]] = _reg_storage._list_all_regressions()
    return result


def list_executions(
    status: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> dict[str, Any]:
    """List executions with filtering."""
    result: dict[str, Any] = execution_service.list_executions(
        status=[status] if status else None,
        from_date=from_date,
        to_date=to_date,
        page=1,
        per_page=1000,
    )
    return result


def get_execution_progress(execution_id: str) -> dict[str, Any] | None:
    """Get execution progress."""
    result: dict[str, Any] | None = execution_service.get_execution_progress(execution_id)
    return result


def get_test_count() -> int:
    """Get count of tests."""
    return len(_list_all_tests())


def get_suite_count() -> int:
    """Get count of suites."""
    return len(_list_all_suites())


def get_regression_count() -> int:
    """Get count of regressions."""
    return len(_list_all_regressions())


def get_execution_statistics(*, time_window_hours: int = 24) -> dict[str, Any]:
    """Get execution statistics within a time window."""
    from_date = datetime.now(UTC) - timedelta(hours=time_window_hours)
    result = list_executions(from_date=from_date)
    executions = result.get("executions", [])

    running = 0
    passed = 0
    failed = 0
    for execution in executions:
        exec_status = execution.get("status", "")
        if exec_status == "running":
            running += 1
        elif exec_status == "passed":
            passed += 1
        elif exec_status == "failed":
            failed += 1

    since_days = time_window_hours // 24
    return {
        "sinceDays": since_days,
        "count": len(executions),
        "running": running,
        "passed": passed,
        "failed": failed,
    }


# ============================================================================
# Activity
# ============================================================================


def get_recent_entities(limit: int = 20) -> list[Any]:
    """Most recently modified tests, suites and regressions, newest first."""
    entities: list[Any] = []
    for entity_type in ("test", "suite", "regression"):
        try:
            items = _get_entity_lister(entity_type)()
        except Exception:
            continue
        entities.extend(SimpleNamespace(**{**item, "type": entity_type}) for item in items)
    entities.sort(key=lambda entity: str(getattr(entity, "updated_at", None) or ""), reverse=True)
    return entities[:limit]


def _compute_suite_test_counts() -> dict[str, int]:
    """Compute test counts for each suite from suite.tests arrays."""
    counts: dict[str, int] = {}
    try:
        suites = _suite_storage._list_all_suites()
        for suite in suites:
            suite_name = suite.get("name", "")
            if suite_name:
                counts[suite_name] = len(suite.get("tests", []))
    except Exception:
        pass
    return counts


def _compute_regression_test_counts(suite_test_counts: dict[str, int]) -> dict[str, int]:
    """Compute test counts for each regression by summing suite counts."""
    counts: dict[str, int] = {}
    try:
        suites = _suite_storage._list_all_suites()
        for suite in suites:
            suite_name = suite.get("name", "")
            metadata = suite.get("metadata", {})
            if isinstance(metadata, dict):
                parent_regression = metadata.get("parent_regression")
                if parent_regression:
                    suite_count = suite_test_counts.get(suite_name, 0)
                    counts[parent_regression] = counts.get(parent_regression, 0) + suite_count
    except Exception:
        pass
    return counts


def _extract_entity_timestamp(entity: Any) -> str:
    """Extract an ISO timestamp string from an entity's updated_at attribute."""
    updated_at = getattr(entity, "updated_at", None)
    if updated_at is None:
        return ""
    if isinstance(updated_at, datetime):
        return updated_at.isoformat()
    return str(updated_at)


def _add_type_specific_fields(
    item: dict[str, Any],
    entity_type: str,
    entity_id: str,
    entity_name: str,
    suite_test_counts: dict[str, int],
    regression_test_counts: dict[str, int],
    test_suite_counts: dict[str, int],
) -> None:
    """Add type-specific fields to an activity item in place."""
    if entity_type == "suite":
        item["testCount"] = suite_test_counts.get(entity_name, 0)
    elif entity_type == "regression":
        item["testCount"] = regression_test_counts.get(entity_name, 0)
    elif entity_type == "test":
        item["suiteCount"] = test_suite_counts.get(entity_id, 0)


def get_recent_activity() -> list[dict[str, Any]]:
    """Get recent activity for the dashboard."""
    from wavecore.api.services.relations import service as relation_service

    entities = get_recent_entities(limit=50)
    suite_test_counts = _compute_suite_test_counts()
    regression_test_counts = _compute_regression_test_counts(suite_test_counts)

    # Reuse the same in-memory index the Tests List uses (suite_count column);
    # `get_suite_membership_bulk` returns dict[test_id, list[{id,name}]] without
    # re-reading suites from disk.
    test_ids = [getattr(e, "id", "") for e in entities if getattr(e, "type", None) == "test"]
    test_suite_counts: dict[str, int] = {
        tid: len(members)
        for tid, members in relation_service.get_suite_membership_bulk(test_ids).items()
    }

    activity: list[dict[str, Any]] = []
    for entity in entities:
        entity_type = getattr(entity, "type", "unknown")
        entity_id = getattr(entity, "id", "")
        entity_name = getattr(entity, "name", "")

        item: dict[str, Any] = {
            "id": entity_id,
            "type": entity_type,
            "name": entity_name,
            "timestamp": _extract_entity_timestamp(entity),
        }
        _add_type_specific_fields(
            item,
            entity_type,
            entity_id,
            entity_name,
            suite_test_counts,
            regression_test_counts,
            test_suite_counts,
        )
        activity.append(item)

    return activity


def _get_entity_lister(entity_type: str) -> Any:
    """Return the list-all function for a given entity type."""
    listers: dict[str, Any] = {
        "test": test_service._list_all_tests,
        "suite": _suite_storage._list_all_suites,
        "regression": _reg_storage._list_all_regressions,
    }
    return listers.get(entity_type)


def _name_indexes(entity_types: set[str]) -> dict[str, dict[str, str]]:
    """id to name per entity type, listed once instead of once per execution."""
    indexes: dict[str, dict[str, str]] = {}
    for entity_type in entity_types:
        lister = _get_entity_lister(entity_type)
        if lister is None:
            continue
        try:
            entities = lister()
        except Exception:
            continue
        indexes[entity_type] = {
            str(entity.get("id", "")): str(entity.get("name") or entity.get("id", ""))
            for entity in entities
        }
    return indexes


def _resolve_entity_name(
    entity_id: str,
    entity_type: str,
    indexes: dict[str, dict[str, str]] | None = None,
) -> str:
    """Resolve entity_id to human-readable name."""
    if indexes is None:
        indexes = _name_indexes({entity_type})
    return indexes.get(entity_type, {}).get(entity_id) or entity_id


def _resolve_environment_name(environment_id: str) -> str:
    """Resolve environment_id to human-readable name; falls back to the id."""
    if not environment_id:
        return ""
    env = environment_service.get_environment(environment_id)
    if env is None:
        return environment_id
    return str(env.get("name", environment_id))


def _derive_selected_progress(
    selected_count: int, progress_data: dict[str, Any] | None
) -> tuple[int, int, float]:
    """Y comes from the user's explicit selection; X and % come from live state."""
    tests_done = int(progress_data.get("current", 0) or 0) if isinstance(progress_data, dict) else 0
    percentage = round((tests_done / selected_count) * 100.0, 2) if selected_count > 0 else 0.0
    return tests_done, selected_count, percentage


def _derive_stored_progress(execution: dict[str, Any]) -> tuple[int, int, float]:
    """Fallback for synthetic admin/bulk fixtures that carry stored counts.

    Y = `tests_selected` (or legacy `tests_total`). X is derived from the
    stored `progress` percentage so the displayed "X/Y" stays consistent
    with the percent shown next to it.
    """
    tests_total = int(execution.get("tests_selected", 0) or execution.get("tests_total", 0) or 0)
    raw_progress = execution.get("progress")
    percentage = round(float(raw_progress), 2) if isinstance(raw_progress, int | float) else 0.0
    tests_done = int(round((percentage / 100.0) * tests_total)) if tests_total > 0 else 0
    return tests_done, tests_total, percentage


def _derive_live_progress(
    progress_data: dict[str, Any] | None,
) -> tuple[int, int, float]:
    """Run-everything case: trust live runtime state for both X and Y."""
    if not isinstance(progress_data, dict):
        return 0, 0, 0.0
    tests_done = int(progress_data.get("current", 0) or 0)
    tests_total = int(progress_data.get("total", 0) or 0)
    percentage = round((tests_done / tests_total) * 100.0, 2) if tests_total > 0 else 0.0
    return tests_done, tests_total, percentage


def _derive_progress_fields(execution: dict[str, Any]) -> tuple[int, int, float]:
    """Pick the appropriate X/Y/% source for a single execution.

    Priority:
      1. `selected_tests` (explicit user selection) + live runtime state.
      2. Stored `tests_selected` / `tests_total` (synthetic admin/bulk
         fixtures with no runtime state).
      3. Live runtime state only (real "run everything" executions).

    Reading `execution["progress"]` directly is NEVER used for real
    executions - it is only refreshed when the detail endpoint is hit,
    so it leaks stale snapshots onto the dashboard.
    """
    selected = execution.get("selected_tests") or []
    if selected:
        return _derive_selected_progress(
            len(selected), get_execution_progress(execution.get("id", ""))
        )
    if "tests_selected" in execution or "tests_total" in execution:
        return _derive_stored_progress(execution)
    return _derive_live_progress(get_execution_progress(execution.get("id", "")))


def get_recent_executions(*, time_window_hours: int = 24) -> list[dict[str, Any]]:
    """Get recent executions for the dashboard."""
    from_date = datetime.now(UTC) - timedelta(hours=time_window_hours)
    result = list_executions(from_date=from_date)
    executions = result.get("executions", [])
    indexes = _name_indexes({str(e.get("entity_type", "")) for e in executions})

    recent: list[dict[str, Any]] = []
    for execution in executions:
        exec_id = execution.get("id", "")
        entity_type = execution.get("entity_type", "")
        entity_id = execution.get("entity_id", "")

        tests_done, tests_total, percentage = _derive_progress_fields(execution)
        entity_name = _resolve_entity_name(entity_id, entity_type, indexes)
        environment_name = _resolve_environment_name(execution.get("environment_id", ""))

        recent.append(
            {
                "id": exec_id,
                "environment": environment_name,
                "entityName": entity_name,
                "entityType": entity_type,
                "progress": percentage,
                "startedAt": execution.get("started_at", ""),
                "status": execution.get("status", "running"),
                "testsTotal": tests_total,
                "testsDone": tests_done,
            }
        )

    return recent
