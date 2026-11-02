"""Relation index service for reverse-lookup between entities.

Maintains in-memory indexes mapping child entities to their parents:
- test_id -> [{id, name}, ...] for suite membership
- suite_id -> [{id, name}, ...] for regression membership

Lazy-initialized on first query. Updated incrementally on mutations.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# In-memory indexes
# ---------------------------------------------------------------------------

_test_to_suites: dict[str, list[dict[str, str]]] = {}
_suite_to_regressions: dict[str, list[dict[str, str]]] = {}
_initialized: bool = False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _load_all_suites() -> list[dict[str, Any]]:
    """Load all suites from storage. Isolated for testability."""
    from wavecore.api.services.suites._storage import _list_all_suites

    return _list_all_suites()


def _load_all_regressions() -> list[dict[str, Any]]:
    """Load all regressions from storage. Isolated for testability."""
    from wavecore.api.services.regressions._storage import _list_all_regressions

    return _list_all_regressions()


def _ensure_initialized() -> None:
    """Lazy-initialize the index on first query."""
    if not _initialized:
        rebuild()


# ---------------------------------------------------------------------------
# Rebuild
# ---------------------------------------------------------------------------


def rebuild() -> None:
    """Rebuild the entire index by scanning all suites and regressions."""
    global _initialized  # noqa: PLW0603

    _test_to_suites.clear()
    _suite_to_regressions.clear()

    for suite in _load_all_suites():
        suite_id = suite.get("id", "")
        suite_name = suite.get("name", "")
        for test_id in suite.get("tests", []):
            _test_to_suites.setdefault(test_id, []).append({"id": suite_id, "name": suite_name})

    for regression in _load_all_regressions():
        regression_id = regression.get("id", "")
        regression_name = regression.get("name", "")
        for suite_id in regression.get("suites", []):
            _suite_to_regressions.setdefault(suite_id, []).append(
                {"id": regression_id, "name": regression_name}
            )

    _initialized = True


# ---------------------------------------------------------------------------
# Query API - suites for a test
# ---------------------------------------------------------------------------


def get_suites_for_test(test_id: str) -> list[dict[str, str]]:
    """Return list of {id, name} dicts for suites containing this test."""
    _ensure_initialized()
    return _test_to_suites.get(test_id, [])


def get_suite_count_for_test(test_id: str) -> int:
    """Return the number of suites containing this test."""
    _ensure_initialized()
    return len(_test_to_suites.get(test_id, []))


def get_suite_names_for_test(test_id: str) -> list[str]:
    """Return list of suite names for suites containing this test."""
    _ensure_initialized()
    return [s["name"] for s in _test_to_suites.get(test_id, [])]


def get_suite_membership_bulk(
    test_ids: list[str],
) -> dict[str, list[dict[str, str]]]:
    """Return suite membership for multiple tests in one call."""
    _ensure_initialized()
    return {tid: _test_to_suites.get(tid, []) for tid in test_ids}


# ---------------------------------------------------------------------------
# Query API - regressions for a suite
# ---------------------------------------------------------------------------


def get_regressions_for_suite(suite_id: str) -> list[dict[str, str]]:
    """Return list of {id, name} dicts for regressions containing this suite."""
    _ensure_initialized()
    return _suite_to_regressions.get(suite_id, [])


def get_regression_count_for_suite(suite_id: str) -> int:
    """Return the number of regressions containing this suite."""
    _ensure_initialized()
    return len(_suite_to_regressions.get(suite_id, []))


# ---------------------------------------------------------------------------
# Mutation hooks - suite<->test
# ---------------------------------------------------------------------------


def on_test_added_to_suite(suite_id: str, suite_name: str, test_id: str) -> None:
    """Update index when a test is added to a suite."""
    _ensure_initialized()
    entries = _test_to_suites.setdefault(test_id, [])
    if not any(e["id"] == suite_id for e in entries):
        entries.append({"id": suite_id, "name": suite_name})


def on_test_removed_from_suite(suite_id: str, test_id: str) -> None:
    """Update index when a test is removed from a suite."""
    _ensure_initialized()
    entries = _test_to_suites.get(test_id)
    if entries is None:
        return
    _test_to_suites[test_id] = [e for e in entries if e["id"] != suite_id]
    if not _test_to_suites[test_id]:
        del _test_to_suites[test_id]


def on_suite_deleted(suite_id: str) -> None:
    """Update index when a suite is deleted. Removes suite from all tests and
    drops the suite's own regression-membership entry."""
    _ensure_initialized()
    to_remove: list[str] = []
    for test_id, entries in _test_to_suites.items():
        _test_to_suites[test_id] = [e for e in entries if e["id"] != suite_id]
        if not _test_to_suites[test_id]:
            to_remove.append(test_id)
    for test_id in to_remove:
        del _test_to_suites[test_id]
    _suite_to_regressions.pop(suite_id, None)


def on_suite_renamed(suite_id: str, new_name: str) -> None:
    """Update index when a suite is renamed."""
    _ensure_initialized()
    for entries in _test_to_suites.values():
        for entry in entries:
            if entry["id"] == suite_id:
                entry["name"] = new_name


def on_test_deleted(test_id: str) -> list[str]:
    """Update index when a test is deleted.

    Returns list of suite IDs that referenced this test (for cascade).
    """
    _ensure_initialized()
    entries = _test_to_suites.pop(test_id, [])
    return [e["id"] for e in entries]


# ---------------------------------------------------------------------------
# Mutation hooks - regression<->suite
# ---------------------------------------------------------------------------


def on_suite_added_to_regression(regression_id: str, regression_name: str, suite_id: str) -> None:
    """Update index when a suite is added to a regression."""
    _ensure_initialized()
    entries = _suite_to_regressions.setdefault(suite_id, [])
    if not any(e["id"] == regression_id for e in entries):
        entries.append({"id": regression_id, "name": regression_name})


def on_suite_removed_from_regression(regression_id: str, suite_id: str) -> None:
    """Update index when a suite is removed from a regression."""
    _ensure_initialized()
    entries = _suite_to_regressions.get(suite_id)
    if entries is None:
        return
    _suite_to_regressions[suite_id] = [e for e in entries if e["id"] != regression_id]
    if not _suite_to_regressions[suite_id]:
        del _suite_to_regressions[suite_id]


def on_regression_deleted(regression_id: str) -> list[str]:
    """Update index when a regression is deleted.

    Returns list of suite IDs that referenced this regression. Callers don't
    cascade on regression delete (regression is top-level) - the return value
    exists for parity with ``on_test_deleted``.
    """
    _ensure_initialized()
    affected: list[str] = []
    empties: list[str] = []
    for suite_id, entries in _suite_to_regressions.items():
        remaining = [e for e in entries if e["id"] != regression_id]
        if len(remaining) != len(entries):
            affected.append(suite_id)
        _suite_to_regressions[suite_id] = remaining
        if not remaining:
            empties.append(suite_id)
    for suite_id in empties:
        del _suite_to_regressions[suite_id]
    return affected


def on_regression_renamed(regression_id: str, new_name: str) -> None:
    """Update index when a regression is renamed."""
    _ensure_initialized()
    for entries in _suite_to_regressions.values():
        for entry in entries:
            if entry["id"] == regression_id:
                entry["name"] = new_name
