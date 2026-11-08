"""Execution service for WAVE backend.

Handles the lifecycle of tracked executions (test / suite / regression) and
serves the Execution Detail + Historical Test Canvas views against the
append-only storage layout defined in ``_storage.py``.
"""

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import yaml

from wavecore.api.exceptions import ConflictException, NotFoundException, ValidationException
from wavecore.api.services import artifact_service
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.executions import orchestrator
from wavecore.api.services.executions._storage import (
    _TZ_UTC_SUFFIX,
    TERMINAL_STATUSES,
    VALID_ENTITY_TYPES,
    _check_entity_validation,
    _compute_live_duration,
    _delete_execution_files,
    _ensure_cache_loaded,
    _execution_file,
    _execution_storage,
    _execution_variables,
    _filter_executions,
    _forget_execution,
    _get_entity,
    _get_runtime_state,
    _init_runtime_state,
    _load_execution,
    _load_runs,
    _load_snapshot,
    _load_test_logs,
    _load_variables,
    _record_run_transition,
    _save_composition,
    _save_execution,
    _save_variables,
    _sort_executions,
    _update_execution_status,
    _validate_state_transition,
)
from wavecore.api.services.shared import export_file_stem
from wavecore.api.services.workbench._common import (
    DEFAULT_USER_ID,
    register_terminal_callback,
)
from wavecore.core.artifacts import log_writer

logger = logging.getLogger(__name__)

_CAUSAL_LEVELS = ("ERROR", "FATAL")


# ===========================================================================
# Composition building
# ===========================================================================


def _build_composition_for_execution(
    entity_type: str,
    entity: dict[str, Any],
    selected_tests: list[str] | list[dict[str, str]] | None,
    execution_id: str | None = None,
) -> tuple[dict[str, Any], set[str]]:
    """Return ``(composition, selected_run_ids)`` for the given entity.

    Test-type executions reuse ``execution_id`` as the ``run_id`` so the
    Historical Canvas URL ``/executions/history/{id}`` resolves whether
    the caller passes an execution_id or a run_id. Suite and regression
    children mint fresh UUIDs because the same test_id can run more
    than once under one execution.
    """
    if entity_type == "test":
        return _build_test_composition(entity, execution_id)
    if entity_type == "suite":
        return _build_suite_composition_for_execution(entity, selected_tests)
    return _build_regression_composition_for_execution(entity, selected_tests)


def _build_test_composition(
    entity: dict[str, Any], execution_id: str | None
) -> tuple[dict[str, Any], set[str]]:
    run_id = execution_id or str(uuid.uuid4())
    composition = {
        "suites": [
            {
                "id": None,
                "name": "",
                "tests": [
                    {
                        "id": entity.get("id"),
                        "name": entity.get("name", ""),
                        "run_id": run_id,
                    }
                ],
            }
        ]
    }
    return composition, {run_id}


def _build_suite_composition_for_execution(
    entity: dict[str, Any],
    selected_tests: list[str] | list[dict[str, str]] | None,
) -> tuple[dict[str, Any], set[str]]:
    from wavecore.api.services.tests import service as test_service

    test_lookup: dict[str, dict[str, Any]] = {}
    for tid in entity.get("tests") or []:
        fetched = test_service.get_test(tid)
        test_lookup[tid] = fetched or {"id": tid, "name": tid}
    return orchestrator.build_suite_composition(
        entity,
        selected_test_ids=selected_tests,  # type: ignore[arg-type]
        test_lookup=test_lookup,
    )


def _build_regression_composition_for_execution(
    entity: dict[str, Any],
    selected_tests: list[str] | list[dict[str, str]] | None,
) -> tuple[dict[str, Any], set[str]]:
    from wavecore.api.services.suites import service as suite_service
    from wavecore.api.services.tests import service as test_service

    suite_lookup: dict[str, dict[str, Any]] = {}
    reg_test_lookup: dict[str, dict[str, Any]] = {}
    for sid in entity.get("suites") or []:
        suite = suite_service.get_suite(sid)
        if suite is None:
            continue
        suite_lookup[sid] = suite
        for tid in suite.get("tests") or []:
            if tid not in reg_test_lookup:
                fetched = test_service.get_test(tid)
                reg_test_lookup[tid] = fetched or {"id": tid, "name": tid}
    return orchestrator.build_regression_composition(
        entity,
        selected_pairs=selected_tests,  # type: ignore[arg-type]
        suite_lookup=suite_lookup,
        test_lookup=reg_test_lookup,
    )


# ===========================================================================
# CRUD / lifecycle
# ===========================================================================


def start_execution(
    entity_type: str,
    entity_id: str,
    environment_id: str,
    variables: dict[str, Any] | None = None,
    profile_id: str | None = None,
    version: str | None = None,
    selected_tests: list[str] | list[dict[str, str]] | None = None,
    triggered_by: str | None = None,
) -> dict[str, Any]:
    """Start a new tracked execution for an entity.

    Writes ``execution.yaml`` + ``composition.yaml`` once, seeds runtime
    state in memory, then launches the workbench (test) or sequential
    driver (suite / regression).
    """
    _ensure_cache_loaded()

    entity = _resolve_start_inputs(entity_type, entity_id, environment_id, selected_tests)

    execution_id = str(uuid.uuid4())
    started_at = datetime.now(UTC).isoformat()

    composition, selected_run_ids = _build_composition_for_execution(
        entity_type, entity, selected_tests, execution_id=execution_id
    )
    # Test-type executions reuse execution_id as the run_id (pinned by
    # ``_build_composition_for_execution``) so the Historical Test
    # Canvas URL resolves with the execution's own id. Suite and
    # regression children generate their own run_ids.
    test_run_id = next(iter(selected_run_ids)) if entity_type == "test" else None

    execution = _build_execution_record(
        execution_id=execution_id,
        entity_type=entity_type,
        entity_id=entity_id,
        entity=entity,
        environment_id=environment_id,
        started_at=started_at,
        test_run_id=test_run_id,
        profile_id=profile_id,
        version=version,
        selected_tests=selected_tests,
        triggered_by=triggered_by,
    )
    # One isolated artifact dir per execution record; suite/regression
    # child runs share it.
    execution["artifact_dir"] = artifact_service.allocate_execution_artifact_dir(execution_id)

    _persist_new_execution(
        execution=execution,
        composition=composition,
        selected_run_ids=selected_run_ids,
        started_at=started_at,
        variables=variables,
    )

    try:
        _launch_execution_runner(
            entity_type=entity_type,
            entity_id=entity_id,
            execution_id=execution_id,
            environment_id=environment_id,
            test_run_id=test_run_id,
            variables=variables,
        )
    except Exception:
        _discard_unlaunched_execution(execution_id)
        raise

    return execution


def _discard_unlaunched_execution(execution_id: str) -> None:
    """A start the runner refused leaves no record, log route or artifact dir behind."""
    from wavecore.api.services import log_streaming_service

    log_streaming_service.unregister_log_sink(execution_id)
    _erase_execution(execution_id)


def _erase_execution(execution_id: str) -> None:
    _forget_execution(execution_id)
    _delete_execution_files(execution_id)
    artifact_service.purge_execution_artifact_dir(execution_id)


def _resolve_start_inputs(
    entity_type: str,
    entity_id: str,
    environment_id: str,
    selected_tests: list[str] | list[dict[str, str]] | None,
) -> dict[str, Any]:
    """Validate start_execution inputs and return the resolved entity."""
    if entity_type not in VALID_ENTITY_TYPES:
        raise ValidationException(
            f"Invalid entity type '{entity_type}': "
            f"valid types are {', '.join(VALID_ENTITY_TYPES)}"
        )

    entity = _get_entity(entity_type, entity_id)
    if entity is None:
        raise LookupError(f"{entity_type.capitalize()} with ID '{entity_id}' not found")

    environment = environment_service.get_environment(environment_id)
    if environment is None:
        raise LookupError(f"Environment with ID '{environment_id}' not found")

    _check_entity_validation(entity_type, entity_id)
    _check_entity_is_populated(entity_type, entity)
    _validate_selected_tests(entity_type, entity, entity_id, selected_tests)
    return entity


_MEMBERSHIP_FIELDS: dict[str, tuple[str, str]] = {
    "suite": ("tests", "test"),
    "regression": ("suites", "suite"),
}


def _check_entity_is_populated(entity_type: str, entity: dict[str, Any]) -> None:
    """An empty suite or regression would report a vacuous pass, so refuse it."""
    membership = _MEMBERSHIP_FIELDS.get(entity_type)
    if membership is None:
        return
    field, member = membership
    if not entity.get(field):
        raise ValidationException(
            f"Cannot start execution: {entity_type} must reference at least one {member}"
        )


def _build_execution_record(
    *,
    execution_id: str,
    entity_type: str,
    entity_id: str,
    entity: dict[str, Any],
    environment_id: str,
    started_at: str,
    test_run_id: str | None,
    profile_id: str | None,
    version: str | None,
    selected_tests: list[str] | list[dict[str, str]] | None,
    triggered_by: str | None = None,
) -> dict[str, Any]:
    """Assemble the execution.yaml record, including the optional fields."""
    execution: dict[str, Any] = {
        "id": execution_id,
        "name": entity.get("name", ""),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "environment_id": environment_id,
        "triggered_by": triggered_by or DEFAULT_USER_ID,
        "status": "running",
        "started_at": started_at,
    }
    if test_run_id is not None:
        execution["run_id"] = test_run_id
    if profile_id:
        execution["profile_id"] = profile_id
    if version:
        execution["entity_version"] = version
    if selected_tests is not None:
        execution["selected_tests"] = selected_tests
    if entity_type == "test":
        snapshot_workflow = entity.get("workflow")
        if snapshot_workflow is not None:
            execution["workflow_snapshot"] = snapshot_workflow
    return execution


def _persist_new_execution(
    *,
    execution: dict[str, Any],
    composition: dict[str, Any],
    selected_run_ids: set[str],
    started_at: str,
    variables: dict[str, Any] | None,
) -> None:
    """Write execution.yaml + composition.yaml, seed runtime state, persist variables."""
    execution_id = execution["id"]
    _save_execution(execution)
    _execution_storage[execution_id] = execution
    _save_composition(execution_id, composition)
    _init_runtime_state(execution_id, started_at, composition, selected_run_ids)

    exec_vars = variables.copy() if variables else {}
    _execution_variables[execution_id] = exec_vars
    _save_variables(execution_id, exec_vars)


def _launch_execution_runner(
    *,
    entity_type: str,
    entity_id: str,
    execution_id: str,
    environment_id: str,
    test_run_id: str | None,
    variables: dict[str, Any] | None = None,
) -> None:
    """Dispatch the entity-specific runner: workbench session for tests,
    sequential driver for suite/regression."""
    if entity_type == "test":
        from wavecore.api.services import log_streaming_service
        from wavecore.api.services.workbench import service as workbench_service

        # session_id equals execution_id so the Workbench can open the same
        # session as a viewer. Logs land in logs/<run_id>.yaml.
        log_streaming_service.register_log_sink(
            execution_id,
            execution_id,
            run_id=test_run_id or execution_id,
            test_id=entity_id,
        )
        workbench_service.start_workbench_run(
            test_id=entity_id,
            environment_id=environment_id,
            session_id=execution_id,
            lineage=workbench_service.RunLineage(execution_id=execution_id),
            overrides=variables,
        )
        return

    from wavecore.api.services.executions import _sequential

    _sequential.start_sequential_execution(
        execution_id=execution_id,
        environment_id=environment_id,
        overrides=variables,
    )


def _validate_selected_tests(
    entity_type: str,
    entity: dict[str, Any],
    entity_id: str,
    selected_tests: list[str] | list[dict[str, str]] | None,
) -> None:
    if selected_tests is None:
        return
    if entity_type == "test":
        raise ValidationException("selected_tests is only valid for suite or regression entities")
    if len(selected_tests) == 0:
        raise ValidationException("selected_tests must contain at least one entry when provided")
    if entity_type == "suite":
        _validate_suite_selected_tests(entity, entity_id, selected_tests)
    else:
        _validate_regression_selected_tests(entity, entity_id, selected_tests)


def _validate_suite_selected_tests(
    entity: dict[str, Any],
    entity_id: str,
    selected_tests: list[str] | list[dict[str, str]],
) -> None:
    suite_test_ids = set(entity.get("tests") or [])
    for item in selected_tests:
        if not isinstance(item, str):
            raise ValidationException("selected_tests entries for suite must be test_id strings")
        if item not in suite_test_ids:
            raise ValidationException(f"Test '{item}' is not part of suite '{entity_id}'")


def _validate_regression_selected_tests(
    entity: dict[str, Any],
    entity_id: str,
    selected_tests: list[str] | list[dict[str, str]],
) -> None:
    from wavecore.api.services.suites import service as suite_service

    regression_suite_ids = set(entity.get("suites") or [])
    for item in selected_tests:
        if not (isinstance(item, dict) and "suite_id" in item and "test_id" in item):
            raise ValidationException(
                "selected_tests entries for regression must be {suite_id, test_id} pairs"
            )
        sid = item["suite_id"]
        tid = item["test_id"]
        if sid not in regression_suite_ids:
            raise ValidationException(f"Suite '{sid}' is not part of regression '{entity_id}'")
        suite = suite_service.get_suite(sid)
        suite_test_ids = set((suite or {}).get("tests") or [])
        if tid not in suite_test_ids:
            raise ValidationException(
                f"Test '{tid}' is not part of suite '{sid}' in regression '{entity_id}'"
            )


# ===========================================================================
# Enrichment (detail view)
# ===========================================================================


def get_execution(execution_id: str) -> dict[str, Any] | None:
    """Return the Execution Detail payload for ``execution_id``.

    Fast path: reads ``runtime_state`` from memory. Disk is only touched
    for terminal executions loaded after a restart.
    """
    _ensure_cache_loaded()

    execution = _execution_storage.get(execution_id)
    if execution is not None and not _execution_file(execution_id).exists():
        _forget_execution(execution_id)
        execution = None
    if execution is None:
        execution = _load_execution(execution_id)
        if execution:
            _execution_storage[execution_id] = execution

    if execution is None:
        return None

    state = _get_runtime_state(execution_id)
    # Recompute for terminal executions too, so a finished run never reports the
    # last mid-run snapshot (suite and regression runs froze at 0%).
    execution["progress"] = _compute_progress(state)

    return _enrich_execution_for_detail(execution, state)


def _compute_progress(state: dict[str, Any] | None) -> dict[str, Any]:
    """Return ``{current, total, percentage}`` progress from runtime state."""
    if state is None:
        return {"current": 0, "total": 1, "percentage": 0.0}
    runs = state.get("runs", {})
    total = sum(1 for r in runs.values() if r.get("status") != "excluded")
    completed = sum(
        1
        for r in runs.values()
        if r.get("status") in TERMINAL_STATUSES and r.get("status") != "excluded"
    )
    if total == 0:
        return {"current": 0, "total": 1, "percentage": 0.0}
    return {
        "current": completed,
        "total": total,
        "percentage": (completed / total) * 100.0,
    }


def _run_row(
    test_id: str,
    run_id: str | None,
    run_state: dict[str, Any] | None,
    test_entity: dict[str, Any] | None,
    live_now: datetime,
) -> dict[str, Any]:
    """Build a single test-row dict from runtime state + live entity."""
    tags: list[str]
    name = ""
    if test_entity is not None:
        name = test_entity.get("name", "")
        tags = list(test_entity.get("metadata", {}).get("tags") or test_entity.get("tags") or [])
    else:
        tags = []

    if run_state is None:
        return {
            "id": test_id,
            "name": name,
            "status": "pending",
            "duration": None,
            "tags": tags,
            "run_id": run_id,
        }

    duration = run_state.get("duration")
    if run_state.get("status") == "running" and duration is None:
        duration = _compute_live_duration(run_state.get("started_at"), live_now)

    return {
        "id": test_id,
        "name": name,
        "status": run_state.get("status", "pending"),
        "duration": duration,
        "tags": tags,
        "run_id": run_id,
    }


def _aggregate_suite_status(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "pending"
    if any(r["status"] == "stopped" for r in rows):
        return "stopped"
    if any(r["status"] == "failed" for r in rows):
        return "failed"
    if any(r["status"] in ("pending", "running") for r in rows):
        return "running"
    return "passed"


def _enrich_execution_for_detail(
    execution: dict[str, Any], state: dict[str, Any] | None
) -> dict[str, Any]:
    """Attach tests / suites / environment / counts / metadata."""
    from wavecore.api.services.executions._storage import _load_composition

    enriched = dict(execution)
    composition = _load_composition(execution["id"])
    runs_map = (state or {}).get("runs", {})
    live_now = datetime.now(UTC)

    tests_flat, suites_list = _flatten_composition_for_detail(
        execution, composition, runs_map, live_now
    )
    _apply_test_type_live_overrides(enriched, tests_flat, live_now)

    enriched["tests"] = tests_flat
    enriched["suites"] = suites_list
    enriched["counts"] = _compute_counts(tests_flat, suites_list)
    enriched["environment"] = _resolve_environment(enriched.get("environment_id"))

    _attach_entity_metadata(enriched)

    if enriched.get("status") == "running":
        enriched["duration"] = _compute_live_duration(enriched.get("started_at"), live_now)
    return enriched


def _flatten_composition_for_detail(
    execution: dict[str, Any],
    composition: dict[str, Any],
    runs_map: dict[str, dict[str, Any]],
    live_now: datetime,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Walk composition.suites, building the per-row rows and routing
    them to either the flat ``tests`` array or the nested ``suites``
    list depending on the execution's entity_type.

    Test-type executions use a single synthetic wrapper suite with
    id=None. Suite-type executions carry their real suite_id on the
    single suite in the composition; the Components table on the detail
    page expects a flat ``tests`` array at the top level for both
    cases. Regression-type executions keep the nested ``suites[].tests[]``
    shape so the FE can render the expandable tree.
    """
    tests_flat: list[dict[str, Any]] = []
    suites_list: list[dict[str, Any]] = []
    flatten_into_tests = execution.get("entity_type") in ("test", "suite")
    for suite in composition.get("suites", []):
        rows = _build_suite_rows(suite, runs_map, live_now)
        if flatten_into_tests:
            tests_flat.extend(rows)
        else:
            suites_list.append(_build_suite_summary(suite, rows))
    return tests_flat, suites_list


def _build_suite_rows(
    suite: dict[str, Any],
    runs_map: dict[str, dict[str, Any]],
    live_now: datetime,
) -> list[dict[str, Any]]:
    """Materialize one row per composition test, merging live entity
    metadata with the per-run runtime state."""
    from wavecore.api.services.tests import service as test_service

    rows: list[dict[str, Any]] = []
    for test in suite.get("tests", []):
        run_id = test.get("run_id")
        test_id = test.get("id") or ""
        run_state = runs_map.get(run_id)
        live_entity = test_service.get_test(test_id) if test_id else None
        if live_entity is None:
            live_entity = {"id": test_id, "name": test.get("name", "")}
        rows.append(_run_row(test_id, run_id, run_state, live_entity, live_now))
    return rows


def _build_suite_summary(suite: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Wrap a suite's rows in the nested-components payload shape."""
    # Per-run durations are already 3-decimal floats, but summing
    # IEEE-754 floats leaks artifacts like 9.902000000000001. Round
    # here so the sum is a clean 3-decimal value before it hits any
    # consumer (FE, CLI, export).
    raw_sum = sum((r.get("duration") or 0) for r in rows if r.get("duration"))
    suite_duration = round(raw_sum, 3) if raw_sum else None
    return {
        "id": suite.get("id", ""),
        "name": suite.get("name", ""),
        "status": _aggregate_suite_status(rows),
        "duration": suite_duration,
        "tests": rows,
        "tags": [],
        "_passed_count": sum(1 for r in rows if r["status"] == "passed"),
        "_total_count": len(rows),
    }


def _apply_test_type_live_overrides(
    enriched: dict[str, Any],
    tests_flat: list[dict[str, Any]],
    live_now: datetime,
) -> None:
    """For test-type executions, show the execution's own live status so a
    freshly-started test reads 'running' immediately. Once terminal the run's
    recorded duration stands, so per-test precision matches a suite's rows."""
    if enriched.get("entity_type") != "test" or not tests_flat:
        return
    tests_flat[0]["status"] = enriched.get("status", tests_flat[0]["status"])
    if enriched.get("status") == "running":
        tests_flat[0]["duration"] = _compute_live_duration(enriched.get("started_at"), live_now)


def _attach_entity_metadata(enriched: dict[str, Any]) -> None:
    """Merge entity-level tags, description, and regression-only
    duplicate_tests into the detail payload."""
    entity = _get_entity(enriched.get("entity_type", ""), enriched.get("entity_id") or "")
    if entity is None:
        return
    enriched.setdefault(
        "tags",
        entity.get("tags") or (entity.get("metadata", {}) or {}).get("tags") or [],
    )
    enriched.setdefault("description", entity.get("description") or "")
    if enriched.get("entity_type") == "regression":
        enriched.setdefault("duplicate_tests", entity.get("duplicate_tests") or {})


def _compute_counts(
    tests_flat: list[dict[str, Any]], suites_list: list[dict[str, Any]]
) -> dict[str, int]:
    all_tests = list(tests_flat)
    for suite in suites_list:
        all_tests.extend(suite["tests"])
    return {
        "total": len(all_tests),
        "passed": sum(1 for t in all_tests if t["status"] == "passed"),
        "failed": sum(1 for t in all_tests if t["status"] == "failed"),
        "pending": sum(1 for t in all_tests if t["status"] == "pending"),
        "skipped": sum(1 for t in all_tests if t["status"] == "skipped"),
        "excluded": sum(1 for t in all_tests if t["status"] == "excluded"),
        "stopped": sum(1 for t in all_tests if t["status"] == "stopped"),
    }


def _resolve_environment(env_id: str | None) -> dict[str, str] | None:
    if not env_id:
        return None
    env = environment_service.get_environment(env_id)
    return {"id": env_id, "name": env.get("name", env_id) if env else env_id}


# ===========================================================================
# Listing / filtering
# ===========================================================================


def list_executions(
    status: list[str] | None = None,
    entity_type: list[str] | None = None,
    triggered_by: list[str] | None = None,
    entity_id: str | None = None,
    search: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
    page: int = 1,
    per_page: int = 20,
    sort: str = "started_at",
    order: str = "desc",
) -> dict[str, Any]:
    _ensure_cache_loaded()
    items = list(_execution_storage.values())
    items = _filter_executions(
        items, status, entity_type, triggered_by, entity_id, search, from_date, to_date
    )
    _sort_executions(items, sort, order)
    total = len(items)
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    start = (page - 1) * per_page
    end = start + per_page
    return {
        "executions": items[start:end],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    }


def list_execution_users() -> list[str]:
    _ensure_cache_loaded()
    users: set[str] = set()
    for execution in _execution_storage.values():
        triggered = execution.get("triggered_by")
        if triggered:
            users.add(triggered)
    return sorted(users)


# ===========================================================================
# Pause / resume / stop / delete
# ===========================================================================


def pause_execution(execution_id: str) -> dict[str, Any] | None:
    _ensure_cache_loaded()
    execution = _execution_storage.get(execution_id)
    if execution is None:
        return None
    _validate_state_transition(execution["status"], "paused", "pause")
    _update_execution_status(execution_id, "paused")
    return _execution_storage[execution_id]


def resume_execution(execution_id: str) -> dict[str, Any] | None:
    _ensure_cache_loaded()
    execution = _execution_storage.get(execution_id)
    if execution is None:
        return None
    _validate_state_transition(execution["status"], "running", "resume")
    _update_execution_status(execution_id, "running")
    return _execution_storage[execution_id]


def stop_execution(execution_id: str) -> dict[str, Any] | None:
    from wavecore.api.services.executions import _sequential
    from wavecore.api.services.workbench import service as workbench_service

    _ensure_cache_loaded()
    execution = _execution_storage.get(execution_id)
    if execution is None:
        return None
    _validate_state_transition(execution["status"], "stopped", "stop")

    entity_type = execution.get("entity_type", "")
    if entity_type in ("suite", "regression"):
        _sequential.request_stop(execution_id)
        _sequential.stop_active_child(execution_id)
        return _execution_storage[execution_id]

    try:
        workbench_service.stop_workbench_run(execution_id)
    except LookupError:
        _update_execution_status(execution_id, "stopped")
    return _execution_storage[execution_id]


def delete_execution(execution_id: str) -> bool:
    _ensure_cache_loaded()
    execution = _execution_storage.get(execution_id)
    if execution is None:
        return False
    current_status = execution.get("status", "")
    if current_status in ("running", "paused"):
        raise ConflictException(
            f"Cannot delete execution in '{current_status}' state. Stop the execution first."
        )
    _erase_execution(execution_id)
    return True


# ===========================================================================
# Workbench terminal callback (test-type executions)
# ===========================================================================


def _on_workbench_session_terminated(
    session_id: str, status: str, halt_scope: str | None = None
) -> None:
    """Persist a workbench terminal event for a tracked execution.

    Sequential child sessions go through ``_sequential.dispatch_child_terminal``
    instead. For test-type executions, the session_id equals the execution_id
    and we write ``snapshots/<run_id>.yaml`` with the workbench session's
    end-of-run state.
    """
    from wavecore.api.services.executions._sequential import (
        _child_sessions,
        dispatch_child_terminal,
    )

    child_record = _child_sessions.get(session_id)
    if dispatch_child_terminal(session_id, status, halt_scope):
        _capture_child_failure(child_record, status)
        return

    _ensure_cache_loaded()
    execution = _execution_storage.get(session_id)
    if execution is None:
        return
    if execution.get("status") in TERMINAL_STATUSES:
        _store_unwound_stop(session_id, execution, status)
        return

    run_id = execution.get("run_id") or session_id
    ended_iso = datetime.now(UTC).isoformat()
    duration: float | None = None
    started_at = execution.get("started_at")
    if started_at:
        start = datetime.fromisoformat(started_at.replace("Z", _TZ_UTC_SUFFIX))
        end = datetime.fromisoformat(ended_iso.replace("Z", _TZ_UTC_SUFFIX))
        duration = round((end - start).total_seconds(), 3)

    # CRITICAL STATE TRANSITION: flip the execution record to the terminal
    # status FIRST, before any best-effort persistence of plugin-authored
    # data. A badly-typed variable from a user plugin must never be able
    # to stall the execution-record state machine by blowing up a YAML
    # dump later in this function.
    _record_run_transition(
        session_id,
        run_id,
        status=status,
        # A test-type run starts with its execution, so the row carries the same
        # start time a suite child's row does.
        started_at=started_at,
        ended_at=ended_iso,
        duration=duration,
    )
    _update_execution_status(session_id, status)

    _persist_terminal_snapshot(session_id, execution, status)

    # Last so an artifact-write error aborts nothing; the record is terminal.
    if status == "failed" and execution.get("artifact_dir"):
        _write_failure_artifact(execution)
    log_writer.write_execution_logs(execution)


def _store_unwound_stop(session_id: str, execution: dict[str, Any], status: str) -> None:
    """A stopped run notifies again once it unwinds; store what it bound and logged since."""
    from wavecore.api.services.workbench._common import _get_session

    same_run = (_get_session(session_id) or {}).get("execution_id") == session_id
    if not same_run or status != "stopped" or execution.get("status") != "stopped":
        return
    _persist_terminal_snapshot(session_id, execution, status)
    log_writer.write_execution_logs(execution)


def _get_session_secret_registry(session_id: str) -> Any:
    """The run's SecretRegistry from the live workbench session, or None."""
    from wavecore.api.services.workbench._common import _get_session

    return (_get_session(session_id) or {}).get("secret_registry")


def _persist_terminal_snapshot(session_id: str, execution: dict[str, Any], status: str) -> None:
    """Best-effort persistence of the session's snapshot + variables.

    These write paths go through yaml.safe_dump, which rejects any type it
    doesn't exactly recognize (str subclasses from lxml, numpy scalars,
    custom classes, etc.). ``_yaml_safe`` in ``_storage.py`` coerces to safe
    types at the write boundary, but if a write still raises for any
    reason we swallow it here - the execution record is already terminal,
    and persisting variables is a nice-to-have for the historical canvas.
    """
    from wavecore.api.services.executions._storage import _save_snapshot
    from wavecore.api.services.workbench._common import get_session_snapshot

    run_id = execution.get("run_id") or session_id
    snapshot_source = get_session_snapshot(session_id) or {}
    registry = _get_session_secret_registry(session_id)
    variables = {
        k: v
        for k, v in (snapshot_source.get("variables") or {}).items()
        if not _is_namespace_object(v)
    }
    snapshot: dict[str, Any] = {
        "run_id": run_id,
        "test_id": execution.get("entity_id"),
        "status": status,
        "block_states": dict(snapshot_source.get("block_states") or {}),
        "variables": variables,
    }
    workflow = execution.get("workflow_snapshot")
    if workflow is not None:
        snapshot["workflow"] = workflow
    try:
        _save_snapshot(session_id, run_id, snapshot, registry=registry)
    except Exception:  # noqa: BLE001 - never stall a terminal transition
        logger.exception(
            "snapshot persistence failed for terminal execution %s; "
            "execution record was already flipped to %s",
            session_id,
            status,
        )

    if variables:
        _execution_variables[session_id] = dict(variables)
        try:
            _save_variables(session_id, _execution_variables[session_id], registry=registry)
        except Exception:  # noqa: BLE001 - never stall a terminal transition
            logger.exception(
                "variable persistence failed for terminal execution %s; "
                "execution record was already flipped to %s",
                session_id,
                status,
            )


def _capture_child_failure(child_record: dict[str, Any] | None, status: str) -> None:
    """Refresh the parent execution's causal error.json on a failed child."""
    if child_record is None or status != "failed":
        return
    parent = _execution_storage.get(child_record["parent_id"])
    if parent is not None and parent.get("artifact_dir"):
        _write_failure_artifact(parent)


def _write_failure_artifact(execution: dict[str, Any]) -> None:
    """Write the per-execution causal error.json (REQ-3.7.1.1).

    Aggregates the ERROR/FATAL log entries of the execution into one structured
    failure summary, each entry projected to its causal block and scope.
    """
    from wavecore.api.services.executions._storage import _load_composition, _load_merged_logs
    from wavecore.api.services.storage_paths import get_artifacts_storage_path
    from wavecore.core.artifacts import store

    execution_id = execution["id"]
    scope_by_run = _scope_paths_by_run(_load_composition(execution_id))
    failures = [
        {
            "block_id": entry.get("blockId"),
            "scope_path": scope_by_run.get(entry.get("run_id") or "", ""),
            "level": entry.get("level"),
            "message": entry.get("message"),
            "timestamp": entry.get("timestamp"),
        }
        for entry in _load_merged_logs(execution_id)
        if entry.get("level") in _CAUSAL_LEVELS
    ]
    directory = get_artifacts_storage_path() / execution["artifact_dir"]
    store.write_json(directory, "error", {"execution_id": execution_id, "failures": failures})


def _scope_paths_by_run(composition: dict[str, Any]) -> dict[str, str]:
    """Map each run_id to its ``<suite>/<test>`` scope path (test name alone
    when the test has no suite)."""
    scopes: dict[str, str] = {}
    for suite in composition.get("suites", []):
        suite_name = suite.get("name") or ""
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                continue
            test_name = test.get("name") or ""
            scopes[run_id] = f"{suite_name}/{test_name}" if suite_name else test_name
    return scopes


def _is_namespace_object(value: Any) -> bool:
    from wavecore.core.namespace_base import NamespaceObjectBase

    return isinstance(value, NamespaceObjectBase)


register_terminal_callback(_on_workbench_session_terminated)


# ===========================================================================
# Progress / variables / historical canvas / statistics
# ===========================================================================


def get_execution_progress(execution_id: str) -> dict[str, Any] | None:
    _ensure_cache_loaded()
    if execution_id not in _execution_storage:
        return None
    return _compute_progress(_get_runtime_state(execution_id))


def get_execution_variables(execution_id: str) -> dict[str, Any] | None:
    """Serve the persisted variables exactly as masked on write (no re-guessing)."""
    _ensure_cache_loaded()
    if execution_id not in _execution_storage:
        return None
    return _load_variables(execution_id)


def get_historical_test_run(run_id: str) -> dict[str, Any] | None:
    """Return the Historical Test Canvas payload for a single test run.

    The response carries TWO variable views so the redesigned Variable
    Manager panel's eye toggle is meaningful in read-only history mode:

    - ``variable_definitions`` is the test's declared variables (type,
      initial value, ``isExpression`` / ``secret`` flags). The eye-OFF
      ("definition") view renders these so a reviewer sees what the test
      actually defined - the literal initial value for plain variables,
      the expression text for ``isExpression``. Falls back to ``{}`` when
      the source test was deleted after the run.
    - ``variables`` is the end-of-run runtime snapshot (secrets masked).
      The eye-ON ("runtime") view renders these so a reviewer sees the
      actual evaluated outcome.
    """
    from wavecore.api.services.tests import service as test_service

    _ensure_cache_loaded()
    resolved = _locate_run(run_id)
    if resolved is None:
        return None
    execution, suite_id = resolved
    execution_id = execution["id"]

    snapshot = _load_snapshot(execution_id, run_id) or {}
    state = _get_runtime_state(execution_id)
    run_state = (state or {}).get("runs", {}).get(run_id, {})

    variables = snapshot.get("variables") or {}
    workflow = snapshot.get("workflow") or execution.get("workflow_snapshot")
    logs = [{**e, "run_id": run_id} for e in _load_test_logs(execution_id, run_id)]
    env_record = _resolve_environment(execution.get("environment_id"))

    test_id = snapshot.get("test_id") or run_state.get("test_id")
    variable_definitions: dict[str, Any] = {}
    if test_id:
        variable_definitions = test_service.get_test_variables(test_id) or {}

    return {
        "run_id": run_id,
        "execution_id": execution_id,
        "test_id": test_id,
        "suite_id": suite_id,
        "status": snapshot.get("status") or run_state.get("status"),
        "started_at": run_state.get("started_at") or execution.get("started_at"),
        "ended_at": run_state.get("ended_at") or execution.get("ended_at"),
        "workflow": workflow,
        "block_states": snapshot.get("block_states") or {},
        "variables": variables,
        "variable_definitions": variable_definitions,
        "logs": logs,
        "environment_id": execution.get("environment_id"),
        "environment_name": env_record["name"] if env_record else None,
    }


def _locate_run(run_id: str) -> tuple[dict[str, Any], str | None] | None:
    """Find ``(execution, suite_id)`` for ``run_id`` across all executions."""
    _ensure_cache_loaded()
    for ex in _execution_storage.values():
        if ex.get("entity_type") == "test" and ex.get("run_id") == run_id:
            return ex, None
    for exec_id, ex in _execution_storage.items():
        if ex.get("entity_type") == "test":
            continue
        for entry in _load_runs(exec_id):
            if entry.get("run_id") == run_id:
                return ex, entry.get("suite_id")
    return None


def get_execution_statistics(
    entity_type: str | None = None,
    entity_id: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> dict[str, Any]:
    _ensure_cache_loaded()
    items = list(_execution_storage.values())
    items = _filter_executions(
        items,
        status=None,
        entity_type=[entity_type] if entity_type else None,
        triggered_by=None,
        entity_id=entity_id,
        search=None,
        from_date=from_date,
        to_date=to_date,
    )
    total = len(items)
    passed = sum(1 for e in items if e.get("status") == "passed")
    failed = sum(1 for e in items if e.get("status") == "failed")
    success_rate = passed / total if total > 0 else 0.0
    failure_rate = failed / total if total > 0 else 0.0
    durations: list[int] = []
    for e in items:
        if e.get("started_at") and e.get("ended_at"):
            start = datetime.fromisoformat(e["started_at"].replace("Z", _TZ_UTC_SUFFIX))
            end = datetime.fromisoformat(e["ended_at"].replace("Z", _TZ_UTC_SUFFIX))
            durations.append(int((end - start).total_seconds() * 1000))
    average_duration_ms = sum(durations) / len(durations) if durations else 0
    return {
        "total_executions": total,
        "success_rate": success_rate,
        "failure_rate": failure_rate,
        "average_duration_ms": average_duration_ms,
    }


# ===========================================================================
# Export
# ===========================================================================


def _slugify_execution_name(name: str) -> str:
    return export_file_stem(name, "execution")


def _assemble_test_slice(execution_id: str, test_record: dict[str, Any]) -> dict[str, Any]:
    test_id = test_record.get("id", "")
    test_status = test_record.get("status", "pending")
    test_name = test_record.get("name", "")
    if test_status == "pending":
        return {"id": test_id, "name": test_name, "status": "pending"}

    run_id = test_record.get("run_id")
    snapshot = _load_snapshot(execution_id, run_id) if run_id else None
    logs = _load_test_logs(execution_id, run_id) if run_id else []
    # Snapshots are masked on write; exports carry them verbatim.
    variables = (snapshot or {}).get("variables") or {}
    return {
        "id": test_id,
        "name": test_name,
        "status": test_status,
        "duration": test_record.get("duration"),
        "run_id": run_id,
        "logs": logs,
        "block_states": (snapshot or {}).get("block_states") or {},
        "variables": variables,
    }


def _select_export_tests(
    execution: dict[str, Any], test_ids: list[str] | None
) -> list[dict[str, Any]]:
    tests: list[dict[str, Any]] = list(execution.get("tests") or [])
    for suite in execution.get("suites") or []:
        tests.extend(suite.get("tests") or [])
    if test_ids is None:
        return tests
    test_index = {t.get("id"): t for t in tests if isinstance(t, dict)}
    selected: list[dict[str, Any]] = []
    for requested_id in test_ids:
        record = test_index.get(requested_id)
        if record is None:
            raise NotFoundException(f"Test not found in execution: {requested_id}")
        selected.append(record)
    return selected


def export_execution(
    execution_id: str,
    test_ids: list[str] | None,
    format: str,
) -> tuple[str, str] | None:
    _ensure_cache_loaded()
    raw = _execution_storage.get(execution_id)
    if raw is None:
        raw = _load_execution(execution_id)
        if raw is None:
            return None
    state = _get_runtime_state(execution_id)
    execution = _enrich_execution_for_detail(raw, state)
    selected_tests = _select_export_tests(execution, test_ids)
    test_slices = [_assemble_test_slice(execution_id, t) for t in selected_tests]
    export_data: dict[str, Any] = {
        "id": execution.get("id", execution_id),
        "name": execution.get("name", ""),
        "entity_type": execution.get("entity_type", ""),
        "entity_id": execution.get("entity_id", ""),
        "environment_id": execution.get("environment_id", ""),
        "status": execution.get("status", ""),
        "counts": execution.get("counts", {}),
        "started_at": execution.get("started_at"),
        "completed_at": execution.get("completed_at") or execution.get("ended_at"),
        "duration": execution.get("duration"),
        "triggered_by": execution.get("triggered_by"),
        "tags": execution.get("tags", []),
        "description": execution.get("description", ""),
        "tests": test_slices,
    }
    if format == "json":
        content = json.dumps(export_data, indent=2, default=str)
    else:
        content = yaml.dump(export_data, default_flow_style=False, sort_keys=False)
    ext = "json" if format == "json" else "yaml"
    filename = f"{_slugify_execution_name(export_data['name'])}.{ext}"
    return (content, filename)


def export_executions_batch(
    execution_ids: list[str], fmt: str = "json"
) -> list[tuple[str, str, str]]:
    """Export multiple executions.

    Args:
        execution_ids: List of execution UUIDs
        fmt: Output format

    Returns:
        List of (execution_id, content_string, filename) tuples

    Raises:
        NotFoundException: If any execution is not found
    """
    results: list[tuple[str, str, str]] = []
    seen_filenames: set[str] = set()

    for execution_id in execution_ids:
        exported = export_execution(execution_id, None, fmt)
        if exported is None:
            raise NotFoundException(f"Execution not found: {execution_id}")

        content, filename = exported
        # Disambiguate duplicate filenames
        base_filename = filename
        counter = 2
        while filename in seen_filenames:
            name_part, ext_part = base_filename.rsplit(".", 1)
            filename = f"{name_part}-{counter}.{ext_part}"
            counter += 1
        seen_filenames.add(filename)

        results.append((execution_id, content, filename))

    return results


# ===========================================================================
# Log pagination (served by the WS layer; helpers exposed here for tests /
# other callers that want a synchronous read against the new storage.)
# ===========================================================================


def paginate_execution_logs(
    execution_id: str,
    before: tuple[int, int | None] | None,
    limit: int,
) -> dict[str, Any] | None:
    """Return a page of merged console entries in chronological order.

    ``before`` is the opaque cursor ``(chronology_index, child_seq |
    None)``; the caller wraps it as ``"<idx>:<seq|x>"`` on the wire.
    """
    from wavecore.api.services import log_streaming_service

    _ensure_cache_loaded()
    if execution_id not in _execution_storage:
        return None
    entries, prev_cursor = log_streaming_service.fetch_execution_logs(execution_id, before, limit)
    return {
        "entries": entries,
        "prev_cursor": _format_cursor(prev_cursor),
    }


def _format_cursor(cursor: tuple[int, int | None] | None) -> str | None:
    if cursor is None:
        return None
    idx, child_seq = cursor
    return f"{idx}:{'x' if child_seq is None else child_seq}"
