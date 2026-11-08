"""File persistence, helpers, and computed fields for suite service."""

import hashlib
import shutil
from pathlib import Path
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException
from wavecore.api.services.executions import service as execution_service
from wavecore.api.services.shared import stored_variable_values
from wavecore.api.services.storage_paths import entity_dir, get_suites_storage_path, is_entity_id
from wavecore.core.secrets.sealing import seal_variables


def _clear_storage() -> None:
    """Clear all suite storage and reset storage instance."""
    storage_dir = get_suites_storage_path()
    if storage_dir.exists():
        shutil.rmtree(storage_dir)
    storage_dir.mkdir(parents=True, exist_ok=True)


def _ensure_storage_dir() -> None:
    """Ensure storage directory exists."""
    get_suites_storage_path().mkdir(parents=True, exist_ok=True)


def _get_suite_dir(suite_id: str) -> Path:
    """Get directory path for a suite."""
    return entity_dir(get_suites_storage_path(), suite_id)


def _load_suite(suite_id: str) -> dict[str, Any] | None:
    """Load suite from file storage."""
    if not is_entity_id(suite_id):
        return None
    suite_file = _get_suite_dir(suite_id) / "suite.yaml"
    if not suite_file.exists():
        return None
    with open(suite_file, encoding="utf-8") as f:
        data: dict[str, Any] | None = yaml.safe_load(f)
        return data


def _save_suite(suite: dict[str, Any]) -> None:
    """Save suite to file storage."""
    _ensure_storage_dir()
    if "variables" in suite:
        suite["variables"] = seal_variables(stored_variable_values(suite["variables"]))
    suite_dir = _get_suite_dir(suite["id"])
    suite_dir.mkdir(parents=True, exist_ok=True)
    suite_file = suite_dir / "suite.yaml"
    with open(suite_file, "w", encoding="utf-8") as f:
        yaml.dump(suite, f, default_flow_style=False, sort_keys=False)


def _delete_suite_files(suite_id: str) -> None:
    """Delete all files for a suite."""
    suite_dir = _get_suite_dir(suite_id)
    if suite_dir.exists():
        for file in suite_dir.iterdir():
            file.unlink()
        suite_dir.rmdir()


def _load_versions(suite_id: str) -> list[dict[str, Any]]:
    """Load version history from file storage."""
    versions_file = _get_suite_dir(suite_id) / "versions.yaml"
    if not versions_file.exists():
        return []
    with open(versions_file, encoding="utf-8") as f:
        return yaml.safe_load(f) or []


def _save_versions(suite_id: str, versions: list[dict[str, Any]]) -> None:
    """Save version history to file storage."""
    _ensure_storage_dir()
    suite_dir = _get_suite_dir(suite_id)
    suite_dir.mkdir(parents=True, exist_ok=True)
    versions_file = suite_dir / "versions.yaml"
    with open(versions_file, "w", encoding="utf-8") as f:
        yaml.dump(versions, f, default_flow_style=False, sort_keys=False)


def _list_all_suites() -> list[dict[str, Any]]:
    """List all suites from file storage."""
    _ensure_storage_dir()
    suites = []
    storage_dir = get_suites_storage_path()
    if storage_dir.exists():
        for suite_dir in storage_dir.iterdir():
            if suite_dir.is_dir():
                suite = _load_suite(suite_dir.name)
                if suite:
                    suites.append(suite)
    return suites


def _generate_etag(suite: dict[str, Any]) -> str:
    """Generate ETag hash for a suite based on its content."""
    content = f"{suite.get('id')}{suite.get('version')}{suite.get('updated_at')}"
    return f'"{hashlib.sha256(content.encode()).hexdigest()}"'


def _test_exists(test_id: str) -> bool:
    """Check if a test exists by querying the test service."""
    from wavecore.api.services.tests import service as test_service

    return test_service.get_test(test_id) is not None


def _batch_suite_execution_info() -> dict[str, tuple[str, str | None]]:
    """Get status and last_run for all suites in a single execution scan.

    Returns a dict mapping suite_id -> (status, last_run). Suites with no
    executions won't appear in the result (callers default to "never_run", None).
    """
    result = execution_service.list_executions(
        entity_type=["suite"],
        page=1,
        per_page=10000,
    )
    # Group by entity_id, keep only the latest (already sorted desc by started_at)
    info: dict[str, tuple[str, str | None]] = {}
    for execution in result.get("executions", []):
        eid = execution.get("entity_id", "")
        if eid and eid not in info:
            status: str = execution.get("status", "never_run")
            last_run: str | None = execution.get("completed_at") or execution.get("started_at")
            info[eid] = (status, last_run)
    return info


def _batch_suite_test_counts() -> dict[str, int]:
    """Count tests per suite from suite.tests arrays.

    Returns a dict mapping suite_id -> test_count.
    """
    counts: dict[str, int] = {}
    for suite in _list_all_suites():
        counts[suite["id"]] = len(suite.get("tests", []))
    return counts


def _add_computed_fields(
    suite: dict[str, Any],
    execution_info: dict[str, tuple[str, str | None]] | None = None,
    test_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Add computed fields to a suite."""
    result = suite.copy()
    tests = suite.get("tests", [])
    if tests:
        result["tests_count"] = len(tests)
    elif test_counts is not None:
        result["tests_count"] = test_counts.get(suite.get("id", ""), 0)
    else:
        result["tests_count"] = _get_suite_tests_count(suite)
    if execution_info is not None:
        status, last_run = execution_info.get(suite["id"], ("never_run", None))
    else:
        # Fallback for single-suite lookups (get_suite)
        exec_result = execution_service.list_executions(
            entity_type=["suite"],
            entity_id=suite["id"],
            page=1,
            per_page=1,
        )
        execs = exec_result.get("executions", [])
        if execs:
            status = execs[0].get("status", "never_run")
            last_run = execs[0].get("completed_at") or execs[0].get("started_at")
        else:
            status, last_run = "never_run", None
    result["status"] = status
    result["last_run"] = last_run
    if "tags" not in result:
        result["tags"] = []
    return result


def _get_suite_tests_count(suite: dict[str, Any]) -> int:
    """Get count of tests in a suite."""
    return len(suite.get("tests", []))


def _filter_suites(
    suites: list[dict[str, Any]],
    search: str | None,
    status: list[str] | None,
    tags: list[str] | None,
) -> list[dict[str, Any]]:
    """Apply search, status, and tags filters to suites."""
    result = suites

    if search:
        search_lower = search.lower()
        result = [
            s
            for s in result
            if search_lower in s.get("name", "").lower()
            or search_lower in s.get("description", "").lower()
        ]

    if status:
        result = [s for s in result if s.get("status") in status]

    if tags:
        result = [s for s in result if any(tag in tags for tag in s.get("tags", []))]

    return result


_SUITE_SORT_KEY_MAP: dict[str, Any] = {
    "name": lambda s: s.get("name", "").lower(),
    "testsCount": lambda s: s.get("tests_count", 0),
    "status": lambda s: {"passed": 0, "failed": 1, "never_run": 2}.get(
        s.get("status", "never_run"), 2
    ),
    "lastRun": lambda s: s.get("last_run") or "",
    "tags": lambda s: ",".join(sorted(s.get("tags", []))).lower(),
    "createdAt": lambda s: s.get("created_at") or "",
    "updatedAt": lambda s: s.get("updated_at") or "",
}


def _paginate_suites(items: list[Any], page: int, per_page: int) -> tuple[list[Any], int, int]:
    """Apply pagination to a list, returning (page_items, total, total_pages)."""
    total = len(items)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 0
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page
    return items[start_idx:end_idx], total, total_pages


_SUITE_UPDATABLE_FIELDS = ("name", "description", "tests", "tags", "variables", "metadata")


def _validate_suite_update(
    suite: dict[str, Any], suite_id: str, data: dict[str, Any], etag: str | None
) -> None:
    """Validate ETag and name uniqueness before updating a suite."""
    if etag:
        current_etag = _generate_etag(suite)
        if etag != current_etag:
            raise ConflictException("Precondition failed: resource has been modified")

    if "name" in data:
        new_name = data["name"]
        for existing in _list_all_suites():
            if existing.get("name") == new_name and existing.get("id") != suite_id:
                raise ConflictException(f"Suite with name '{new_name}' already exists")


def _apply_suite_field_updates(suite: dict[str, Any], data: dict[str, Any]) -> None:
    """Apply updatable fields from data to suite."""
    for field in _SUITE_UPDATABLE_FIELDS:
        if field in data:
            suite[field] = data[field]
