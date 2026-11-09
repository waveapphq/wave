"""File persistence, validation helpers, and aggregate functions for regression service."""

import re
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ValidationException
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.shared import stored_variable_values
from wavecore.api.services.storage_paths import (
    entity_dir,
    get_regressions_storage_path,
    is_entity_id,
)
from wavecore.core.secrets.sealing import seal_variables

# Name validation pattern
_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9 ._()-]+$")


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_regressions_storage_path().mkdir(parents=True, exist_ok=True)


def _get_regression_dir(regression_id: str) -> Path:
    """Get directory path for a regression."""
    return entity_dir(get_regressions_storage_path(), regression_id)


def _load_regression(regression_id: str) -> dict[str, Any] | None:
    """Load regression from file storage."""
    if not is_entity_id(regression_id):
        return None
    regression_file = _get_regression_dir(regression_id) / "regression.yaml"
    if not regression_file.exists():
        return None
    with open(regression_file, encoding="utf-8") as f:
        data: dict[str, Any] | None = yaml.safe_load(f)
        return data


def _save_regression(regression: dict[str, Any]) -> None:
    """Save regression to file storage."""
    _ensure_storage_dir()
    if "variables" in regression:
        regression["variables"] = seal_variables(stored_variable_values(regression["variables"]))
    regression_dir = _get_regression_dir(regression["id"])
    regression_dir.mkdir(parents=True, exist_ok=True)
    regression_file = regression_dir / "regression.yaml"
    with open(regression_file, "w", encoding="utf-8") as f:
        yaml.dump(regression, f, default_flow_style=False, sort_keys=False)


def _delete_regression_files(regression_id: str) -> None:
    """Delete all files for a regression."""
    regression_dir = _get_regression_dir(regression_id)
    if regression_dir.exists():
        for file in regression_dir.iterdir():
            file.unlink()
        regression_dir.rmdir()


def _load_versions(regression_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = _get_regression_dir(regression_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def _save_versions(regression_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    _ensure_storage_dir()
    for entry in versions:
        snapshot = entry.get("snapshot")
        if isinstance(snapshot, dict) and "variables" in snapshot:
            snapshot["variables"] = seal_variables(stored_variable_values(snapshot["variables"]))
    regression_dir = _get_regression_dir(regression_id)
    regression_dir.mkdir(parents=True, exist_ok=True)
    versions_file = regression_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def _list_all_regressions() -> list[dict[str, Any]]:
    """List all regressions from file storage."""
    _ensure_storage_dir()
    regressions = []
    storage_dir = get_regressions_storage_path()
    if storage_dir.exists():
        for regression_dir in storage_dir.iterdir():
            if regression_dir.is_dir():
                regression = _load_regression(regression_dir.name)
                if regression:
                    regressions.append(regression)
    return regressions


def _suite_exists(suite_id: str) -> bool:
    """Check if a suite exists."""
    from wavecore.api.services.suites import service as suite_service

    return suite_service.get_suite(suite_id) is not None


def _validate_name(name: str) -> None:
    """Validate regression name."""
    if not name or not name.strip():
        raise ValidationException("Regression name is required and cannot be empty")
    if len(name) > 255:
        raise ValidationException("Regression name must be between 1 and 255 characters")
    if not _NAME_PATTERN.match(name):
        raise ValidationException(
            f"Regression name '{name}' violates naming convention: "
            "must contain only alphanumeric characters, spaces, hyphens, "
            "underscores, periods, and parentheses"
        )


def _version_has_dependencies(regression_id: str, version: str) -> bool:
    """Check if version has execution dependencies."""
    result = execution_service.list_executions(
        entity_type=["regression"],
        entity_id=regression_id,
        page=1,
        per_page=100,
    )
    for execution in result["executions"]:
        if execution.get("entity_version") == version:
            return True
    return False


# ---------------------------------------------------------------------------
# Aggregate / computed field helpers
# ---------------------------------------------------------------------------


def _get_regression_suites_count(regression: dict[str, Any]) -> int:
    """Get count of suites in a regression."""
    suites = regression.get("suites", [])
    if suites:
        return len(suites)

    from wavecore.api.services.suites import service as suite_service

    regression_name = regression.get("name", "")
    if not regression_name:
        return 0

    all_suites = suite_service._list_all_suites()
    count = 0
    for suite in all_suites:
        parent_reg = suite.get("metadata", {}).get("parent_regression", "")
        if parent_reg == regression_name:
            count += 1
    return count


def _count_tests_by_suite_ids(suite_ids: list[str], suite_service: Any) -> int:
    """Count tests across suites identified by their IDs."""
    total = 0
    for suite_id in suite_ids:
        suite = suite_service.get_suite(suite_id)
        if suite:
            total += len(suite.get("tests", []))
    return total


def _get_regression_tests_count(regression: dict[str, Any]) -> int:
    """Get total test count across all suites in a regression."""
    from wavecore.api.services.suites import service as suite_service

    suite_ids = regression.get("suites", [])
    if suite_ids:
        return _count_tests_by_suite_ids(suite_ids, suite_service)

    regression_name = regression.get("name", "")
    if not regression_name:
        return 0

    all_suites = suite_service._list_all_suites()

    total = 0
    for suite in all_suites:
        parent_reg = suite.get("metadata", {}).get("parent_regression", "")
        if parent_reg == regression_name:
            total += len(suite.get("tests", []))
    return total


def _batch_regression_counts() -> dict[str, tuple[int, int]]:
    """Compute suites_count and tests_count for all regressions in one pass.

    Returns a dict mapping regression_name -> (suites_count, tests_count).
    Loads all suites once instead of per-regression.
    """
    from wavecore.api.services.suites import service as suite_service

    all_suites = suite_service._list_all_suites()

    # Group suites by parent_regression, count suites and tests per regression
    counts: dict[str, tuple[int, int]] = {}
    for suite in all_suites:
        parent_reg = suite.get("metadata", {}).get("parent_regression", "")
        if not parent_reg:
            continue
        test_count = len(suite.get("tests", []))
        prev_suites, prev_tests = counts.get(parent_reg, (0, 0))
        counts[parent_reg] = (prev_suites + 1, prev_tests + test_count)

    return counts


def _map_regression_status(raw_status: str) -> str:
    """Map execution status to regression display status.

    A regression with an execution has run, so a non-terminal or stopped run
    reports as such rather than contradicting its own last_run timestamp."""
    if raw_status in ("completed", "passed"):
        return "passed"
    if raw_status in ("failed", "error"):
        return "failed"
    if raw_status == "stopped":
        return "stopped"
    return "running"


def _batch_regression_execution_info() -> dict[str, tuple[str, str | None]]:
    """Get status and last_run for all regressions in a single execution scan.

    Returns a dict mapping regression_id -> (status, last_run). Regressions with
    no executions won't appear in the result (callers default to "never_run", None).
    """
    result = execution_service.list_executions(
        entity_type=["regression"],
        page=1,
        per_page=10000,
    )
    info: dict[str, tuple[str, str | None]] = {}
    for execution in result.get("executions", []):
        eid = execution.get("entity_id", "")
        if eid and eid not in info:
            raw_status = execution.get("status", "never_run")
            status = _map_regression_status(raw_status)
            last_run: str | None = execution.get("completed_at") or execution.get("started_at")
            info[eid] = (status, last_run)
    return info


def _enrich_regression_with_aggregates(
    regression: dict[str, Any],
    execution_info: dict[str, tuple[str, str | None]],
    aggregate_counts: dict[str, tuple[int, int]],
) -> dict[str, Any]:
    """Enrich regression with computed aggregate fields.

    The aggregate_counts map is built from the legacy ``parent_regression``
    suite metadata. Suites no longer carry that metadata - they live
    independently and regressions reference them via ``regression.suites``.
    So when a regression has an explicit ``suites`` list we compute BOTH
    counts from it (suites_count + tests_count) rather than trusting the
    legacy aggregate.
    """
    from wavecore.api.services.suites import service as suite_service

    enriched = regression.copy()
    suites_count, tests_count = aggregate_counts.get(regression.get("name", ""), (0, 0))
    explicit_suites = regression.get("suites", [])
    if explicit_suites:
        suites_count = len(explicit_suites)
        tests_count = _count_tests_by_suite_ids(explicit_suites, suite_service)
    enriched["suites_count"] = suites_count
    enriched["tests_count"] = tests_count
    status, last_run = execution_info.get(regression["id"], ("never_run", None))
    enriched["status"] = status
    enriched["last_run"] = last_run
    if "tags" not in enriched:
        enriched["tags"] = []
    return enriched


# ---------------------------------------------------------------------------
# Filtering, sorting, pagination
# ---------------------------------------------------------------------------


def _filter_regressions(
    regressions: list[dict[str, Any]],
    search: str | None,
    status: list[str] | None,
    tags: list[str] | None,
) -> list[dict[str, Any]]:
    """Apply search, status, and tags filters to regressions."""
    result = regressions

    if search:
        search_lower = search.lower()
        result = [
            r
            for r in result
            if search_lower in r.get("name", "").lower()
            or search_lower in r.get("description", "").lower()
        ]

    if status:
        result = [r for r in result if r.get("status") in status]

    if tags:
        result = [r for r in result if any(tag in tags for tag in r.get("tags", []))]

    return result


def _make_regression_sort_key(sort_by: str, reverse: bool) -> Any:
    """Create a sort key function for regressions."""

    def sort_key(r: dict[str, Any]) -> Any:
        value = r.get(sort_by)
        if value is None:
            return ("zzz", "zzz") if not reverse else ("", "")
        return (str(value).lower(), value) if isinstance(value, str) else (value, value)

    return sort_key


def _paginate(items: list[Any], page: int, per_page: int) -> tuple[list[Any], int, int]:
    """Apply pagination to a list, returning (page_items, total, total_pages)."""
    total = len(items)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page
    return items[start_idx:end_idx], total, total_pages
