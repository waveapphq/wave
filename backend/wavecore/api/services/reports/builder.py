"""Canonical report model builder (REQ-3.7.2.2 .. REQ-3.7.2.7).

Builds one canonical dict per report from the on-disk execution record
(tracked executions) or the in-memory session state (workbench runs). Both
the JSON artifact and the HTML renderer consume this model unchanged.
"""

from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any

from wavecore.api.exceptions import ConflictException, NotFoundException
from wavecore.api.services.executions import _storage
from wavecore.api.services.executions import service as executions_service
from wavecore.api.services.executions._storage import TERMINAL_STATUSES
from wavecore.api.services.workbench import functions as workbench_functions
from wavecore.core.functions.references import iter_blocks, iter_function_references
from wavecore.core.secrets.owed import (
    OwedSecret,
    owed_fields,
    owed_in_function,
    owed_in_test,
    owed_variables,
)
from wavecore.core.variables.usage import block_namespace_reads

SCHEMA_VERSION = 1

_ERROR_LEVELS = ("ERROR", "FATAL")

_EXCERPT_LEVELS = ("WARN", "ERROR", "FATAL")

_COUNT_KEYS = ("total", "passed", "failed", "skipped", "stopped", "excluded", "pending")

_MAX_FUNCTION_DEPTH = 8


def build_execution_report(
    execution_id: str,
    on_run_processed: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Build the canonical report model for a terminal tracked execution."""
    detail = executions_service.get_execution(execution_id)
    if detail is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")

    composition = _storage._load_composition(execution_id)
    runs_state = (_storage._get_runtime_state(execution_id) or {}).get("runs", {})
    run_meta = _composition_run_meta(composition)
    merged_logs = _storage._load_merged_logs(execution_id)

    runs: list[dict[str, Any]] = []
    for order, dispatch in enumerate(_dispatched_runs(execution_id), start=1):
        run_id = dispatch.get("run_id") or ""
        meta = run_meta.get(run_id, {})
        state = runs_state.get(run_id, {})
        snapshot = _storage._load_snapshot(execution_id, run_id) or {}
        runs.append(
            {
                "order": order,
                "run_id": run_id,
                "test_id": meta.get("test_id", dispatch.get("test_id")),
                "test_name": meta.get("test_name", ""),
                "suite_id": meta.get("suite_id", dispatch.get("suite_id")),
                "suite_name": meta.get("suite_name", ""),
                "status": state.get("status", "pending"),
                "started_at": state.get("started_at"),
                "ended_at": state.get("ended_at"),
                "duration": state.get("duration"),
                "variables": snapshot.get("variables") or {},
            }
        )
        if on_run_processed is not None:
            on_run_processed()

    blocks: list[dict[str, Any]] = []
    if detail.get("entity_type") == "test":
        cover_run_id = detail.get("run_id")
        snapshot = (
            _storage._load_snapshot(execution_id, cover_run_id) if cover_run_id else None
        ) or {}
        blocks = _build_block_rows(
            detail.get("workflow_snapshot") or {},
            snapshot.get("block_states") or {},
            merged_logs,
        )

    counts = detail.get("counts") or {}
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "execution": _execution_identity(detail),
        "summary": {
            "status": detail.get("status"),
            "duration": detail.get("duration"),
            "counts": {key: counts.get(key, 0) for key in _COUNT_KEYS},
        },
        "timeline": {"runs": runs, "blocks": blocks},
        "errors": _extract_errors(execution_id, detail, composition, run_meta, merged_logs),
        "logs": merged_logs,
    }


_OWED_FIX = "A person must fill it in before dependent definitions can run"


def owed_secret_finding(
    name: str, *, step: str, field: bool = False, environment: str | None = None
) -> dict[str, Any]:
    """The one wording of a secret a person still owes: a variable, else a profile field."""
    if not field:
        return {
            "step": step,
            "code": "NO_VALUE_VARIABLE",
            "problem": f"Secret variable '{name}' holds no value",
            "fix": _OWED_FIX,
        }
    where = f" for environment '{environment}'" if environment else ""
    return {
        "step": step,
        "code": "NO_VALUE_SECRET",
        "problem": f"Secret field '{name}' holds no value{where}",
        "fix": _OWED_FIX,
    }


def _test_rows(composition: dict[str, Any]) -> list[dict[str, Any]]:
    """Distinct test rows across the composition's suites, first occurrence wins."""
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for suite in composition.get("suites", []):
        for row in suite.get("tests", []):
            test_id = str(row.get("id") or "")
            if test_id and test_id not in seen:
                seen.add(test_id)
                rows.append(row)
    return rows


class _PendingItems:
    """The owed secrets of every definition one execution runs with, each read once."""

    def __init__(self, environment_id: str) -> None:
        self.items: list[dict[str, Any]] = []
        self._environment_id = environment_id
        self._profiles: set[str] = set()
        self._functions: set[tuple[str, str | None]] = set()
        self._system_reads: set[str] = set()

    def add(self, owner: Mapping[str, Any], owed: Iterable[OwedSecret]) -> None:
        self.items.extend(
            {
                **owner,
                **owed_secret_finding(
                    item.name, step=item.step, field=item.field, environment=item.environment
                ),
            }
            for item in owed
        )

    def uses(self, workflow: Any) -> None:
        """Follow what a workflow's blocks use: profiles, System variables, library Functions."""
        for block in iter_blocks(workflow):
            config = (block.get("data") or {}).get("config") or {}
            for binding in config.get("profileBindings") or []:
                self.profile(str((binding or {}).get("profileId") or ""))
            self._system_reads.update(block_namespace_reads(block, "system"))
        for reference in iter_function_references(workflow):
            self.function(reference.function_id, reference.version)

    def test(self, row: Mapping[str, Any]) -> None:
        from wavecore.api.services.functions.service import secret_input_names
        from wavecore.api.services.tests import service as tests_service

        definition = tests_service.get_test(str(row["id"]))
        if definition is None:
            return
        owner = {"test_id": str(row["id"]), "test_name": row.get("name")}
        self.add(owner, owed_in_test(definition, secret_inputs=secret_input_names))
        self.uses(definition.get("workflow") or {})

    def variables(self, owner: Mapping[str, Any], entity: Mapping[str, Any] | None) -> None:
        if entity is not None:
            self.add(owner, owed_variables(entity.get("variables")))

    def profile(self, profile_id: str) -> None:
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.api.services.profiles._common import secret_field_names

        if not profile_id or profile_id in self._profiles:
            return
        self._profiles.add(profile_id)
        profile = profile_service.get_profile(profile_id)
        if profile is None:
            return
        owner = {"profile_id": profile_id, "profile_name": profile.get("name")}
        fields = secret_field_names(str(profile.get("type") or ""))
        self.add(owner, owed_fields(profile.get("config"), fields, prefix="config"))
        # Only the run's environment holds values this execution used.
        values = (profile.get("environment_values") or {}).get(self._environment_id)
        if not values:
            return
        environment = environment_service.get_environment(self._environment_id) or {}
        name = str(environment.get("name") or self._environment_id)
        prefix = f"environment_values.{name}"
        self.add(owner, owed_fields(values, fields, prefix=prefix, environment=name))

    def function(self, function_id: str, version: str | None) -> None:
        from wavecore.api.services.functions import _storage as function_storage
        from wavecore.api.services.functions.service import secret_input_names

        if (function_id, version) in self._functions:
            return
        self._functions.add((function_id, version))
        try:
            definition = (
                function_storage.load_version(function_id, version)
                if version
                else function_storage.load_function(function_id)[0]
            )
        except LookupError:
            return
        owner = {
            "function_id": function_id,
            "function_name": definition.get("name"),
            "function_version": definition.get("version"),
        }
        self.add(owner, owed_in_function(definition, secret_inputs=secret_input_names))
        self.uses(definition.get("workflow") or {})

    def system(self) -> None:
        from wavecore.api.services import variable_service

        stored = variable_service.get_system_variables_raw().get("variables") or {}
        read = {name: stored[name] for name in sorted(self._system_reads) if name in stored}
        self.add({}, owed_variables(read, prefix="system"))


def _pending_action_items(
    composition: dict[str, Any], detail: Mapping[str, Any] | None = None
) -> list[dict[str, Any]]:
    """What a person owes across the execution's definitions, per current defs: its Tests,
    Suites and Regression, the profiles and library Functions they use, and the System
    variables they read (REQ-5.2.7.11)."""
    from wavecore.api.services.regressions import service as regression_service
    from wavecore.api.services.suites import service as suite_service

    detail = detail or {}
    pending = _PendingItems(str(detail.get("environment_id") or ""))
    for row in _test_rows(composition):
        pending.test(row)
    for suite in composition.get("suites", []):
        if suite.get("id"):
            owner = {"suite_id": suite["id"], "suite_name": suite.get("name")}
            pending.variables(owner, suite_service.get_suite(str(suite["id"])))
    if detail.get("entity_type") == "regression":
        regression = regression_service.get_regression(str(detail.get("entity_id")))
        owner = {
            "regression_id": detail.get("entity_id"),
            "regression_name": (regression or {}).get("name"),
        }
        pending.variables(owner, regression)
    pending.system()
    return pending.items


def build_failure_report(execution_id: str) -> dict[str, Any]:
    """Structured failure projection over persisted records.

    Masking is inherited from the at-rest records; no live runtime state is read.
    """
    detail = executions_service.get_execution(execution_id)
    if detail is None:
        raise NotFoundException(f"Execution with ID '{execution_id}' not found")
    if detail.get("status") not in TERMINAL_STATUSES:
        raise ConflictException(
            f"Execution '{execution_id}' is still running; "
            "the failure report is available when it finishes"
        )

    composition = _storage._load_composition(execution_id)
    runs_state = (_storage._get_runtime_state(execution_id) or {}).get("runs", {})

    failed_tests: list[dict[str, Any]] = []
    for suite in composition.get("suites", []):
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if not run_id:
                continue
            run_state = runs_state.get(run_id) or {}
            if run_state.get("status") != "failed":
                continue
            failed_tests.append(_failed_test_row(execution_id, detail, run_id, test))

    counts = detail.get("counts") or {}
    return {
        "execution": {
            "id": detail.get("id"),
            "name": detail.get("name"),
            "entity_type": detail.get("entity_type"),
            "status": detail.get("status"),
            "triggered_by": detail.get("triggered_by"),
            "started_at": detail.get("started_at"),
            "ended_at": detail.get("ended_at"),
        },
        "outcome": detail.get("status"),
        "counts": {key: counts.get(key, 0) for key in _COUNT_KEYS},
        "failed_tests": failed_tests,
        "pending_action_items": _pending_action_items(composition, detail),
    }


def _failed_test_row(
    execution_id: str,
    detail: dict[str, Any],
    run_id: str,
    test: dict[str, Any],
) -> dict[str, Any]:
    """One failed run's blocks + WARN-and-above log excerpt from persisted records."""
    snapshot = _storage._load_snapshot(execution_id, run_id) or {}
    workflow = snapshot.get("workflow") or detail.get("workflow_snapshot") or {}
    path_map = dict(_block_entries(workflow))
    labels = {
        node.get("id"): (node.get("data") or {}).get("label") or node.get("id")
        for node in workflow.get("nodes", [])
    }
    logs = _storage._load_test_logs(execution_id, run_id)

    failed_blocks: list[dict[str, Any]] = []
    for block_id, block_status in (snapshot.get("block_states") or {}).items():
        if block_status != "failed":
            continue
        error = next(
            (
                entry.get("message")
                for entry in logs
                if entry.get("blockId") == block_id and entry.get("level") in _ERROR_LEVELS
            ),
            None,
        )
        failed_blocks.append(
            {
                "block_id": block_id,
                "label": labels.get(block_id, block_id),
                "path": path_map.get(block_id, block_id),
                "error": error,
            }
        )

    return {
        "run_id": run_id,
        "test_id": test.get("id"),
        "name": test.get("name", ""),
        "status": "failed",
        "failed_blocks": failed_blocks,
        "log_excerpt": [entry for entry in logs if entry.get("level") in _EXCERPT_LEVELS],
    }


def build_session_report(
    session: dict[str, Any],
    logs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the canonical report model for a finished workbench session."""
    status = session.get("status")
    block_states: dict[str, Any] = session.get("block_states") or {}
    workflow = _session_workflow(session)
    if workflow is not None:
        blocks = _build_block_rows(workflow, block_states, logs)
        path_map = dict(_block_entries(workflow))
    else:
        path_map = {}
        timing = _block_timing(logs)
        blocks = []
        for order, (block_id, block_status) in enumerate(block_states.items(), start=1):
            started_at, ended_at = timing.get(block_id, (None, None))
            blocks.append(
                {
                    "order": order,
                    "block_id": block_id,
                    "block_path": block_id,
                    "status": block_status,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "duration": _seconds_between(started_at, ended_at),
                }
            )

    errors = [
        {
            "run_id": None,
            "test_id": session.get("test_id"),
            "test_name": session.get("test_name"),
            "suite_name": None,
            "block_path": _log_block_path(entry, path_map),
            "level": entry.get("level"),
            "message": entry.get("message"),
            "timestamp": entry.get("timestamp"),
        }
        for entry in logs
        if entry.get("level") in _ERROR_LEVELS
    ]

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "session": {
            "session_id": session.get("session_id"),
            "test_id": session.get("test_id"),
            "test_name": session.get("test_name"),
            "environment_id": session.get("environment_id"),
            "status": status,
            "started_at": session.get("started_at"),
        },
        "summary": {
            "status": status,
            "duration": None,
            "counts": _session_counts(status),
        },
        "timeline": {"runs": [], "blocks": blocks},
        "errors": errors,
        "logs": list(logs),
    }


def count_dispatched_runs(execution_id: str) -> int:
    """Number of runs the report builder will process (job progress total)."""
    return len(_dispatched_runs(execution_id))


def _dispatched_runs(execution_id: str) -> list[dict[str, Any]]:
    """Dispatched runs in dispatch order; test-type executions write no
    runs.yaml, so fall back to the single composition entry."""
    dispatched = _storage._load_runs(execution_id)
    if dispatched:
        return dispatched
    execution = (
        _storage._execution_storage.get(execution_id) or _storage._load_execution(execution_id)
    ) or {}
    if execution.get("entity_type") != "test":
        return []
    composition = _storage._load_composition(execution_id)
    return [
        {"run_id": test.get("run_id"), "test_id": test.get("id"), "suite_id": suite.get("id")}
        for suite in composition.get("suites", [])
        for test in suite.get("tests", [])
        if test.get("run_id")
    ]


def _composition_run_meta(composition: dict[str, Any]) -> dict[str, dict[str, Any]]:
    meta: dict[str, dict[str, Any]] = {}
    for suite in composition.get("suites", []):
        for test in suite.get("tests", []):
            run_id = test.get("run_id")
            if run_id:
                meta[run_id] = {
                    "test_id": test.get("id"),
                    "test_name": test.get("name", ""),
                    "suite_id": suite.get("id"),
                    "suite_name": suite.get("name", ""),
                }
    return meta


def _execution_identity(detail: dict[str, Any]) -> dict[str, Any]:
    environment = detail.get("environment") or {}
    identity: dict[str, Any] = {
        "id": detail.get("id"),
        "name": detail.get("name"),
        "entity_type": detail.get("entity_type"),
        "entity_id": detail.get("entity_id"),
        "environment": environment.get("name"),
        "triggered_by": detail.get("triggered_by"),
        "status": detail.get("status"),
        "started_at": detail.get("started_at"),
        "ended_at": detail.get("ended_at"),
        "duration": detail.get("duration"),
    }
    if detail.get("profile_id") is not None:
        identity["profile_id"] = detail["profile_id"]
    if detail.get("entity_version") is not None:
        identity["entity_version"] = detail["entity_version"]
    return identity


def _workflow_maps(workflow: dict[str, Any]) -> tuple[dict[str, str], dict[str, str]]:
    """Return (node names, child -> container parent) for a canvas workflow.

    An edge marks containment when its sourceHandle is non-None and not
    "then" (the after-egress); plain sequential edges carry a None handle.
    """
    nodes = [node for node in workflow.get("nodes", []) if node.get("type") == "workflowNode"]
    node_ids = {node.get("id") for node in nodes}
    names = {node["id"]: (node.get("data") or {}).get("label") or node["id"] for node in nodes}
    parents: dict[str, str] = {}
    for edge in workflow.get("edges", []):
        handle = edge.get("sourceHandle")
        if handle is None or handle == "then":
            continue
        source = edge.get("source")
        target = edge.get("target")
        if source in node_ids and target in node_ids:
            parents[target] = source
    return names, parents


def _block_path(node_id: str, names: dict[str, str], parents: dict[str, str]) -> str:
    segments: list[str] = []
    seen: set[str] = set()
    current: str | None = node_id
    while current is not None and current not in seen:
        seen.add(current)
        segments.append(names.get(current, current))
        current = parents.get(current)
    return " / ".join(reversed(segments))


def _block_timing(logs: list[dict[str, Any]]) -> dict[str, tuple[str, str]]:
    """First observed start and last observed end per blockId."""
    spans: dict[str, tuple[str, str]] = {}
    for entry in logs:
        block_id = entry.get("blockId")
        timestamp = entry.get("timestamp")
        if not block_id or not timestamp:
            continue
        span = spans.get(block_id)
        if span is None:
            spans[block_id] = (timestamp, timestamp)
        else:
            spans[block_id] = (min(span[0], timestamp), max(span[1], timestamp))
    return spans


def _seconds_between(started_at: str | None, ended_at: str | None) -> float | None:
    if not started_at or not ended_at:
        return None
    start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    end = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
    return round((end - start).total_seconds(), 3)


def _build_block_rows(
    workflow: dict[str, Any],
    block_states: dict[str, Any],
    logs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """One row per canvas node regardless of iterations. Nodes the
    run never reached carry no recorded state and are rendered accordingly."""
    timing = _block_timing(logs)
    rows: list[dict[str, Any]] = []
    for order, (node_id, block_path) in enumerate(_block_entries(workflow), start=1):
        started_at, ended_at = timing.get(node_id, (None, None))
        rows.append(
            {
                "order": order,
                "block_id": node_id,
                "block_path": block_path,
                "status": block_states.get(node_id, "pending"),
                "started_at": started_at,
                "ended_at": ended_at,
                "duration": _seconds_between(started_at, ended_at),
            }
        )
    return rows


def _block_entries(
    workflow: dict[str, Any], prefix: str = "", depth: int = 0
) -> list[tuple[str, str]]:
    """(block_id, block_path) pairs in execution order, with Function bodies
    spliced in after their Function node under a path prefix."""
    names, parents = _workflow_maps(workflow)
    entries: list[tuple[str, str]] = []
    for node in _structural_nodes(workflow):
        node_id = node["id"]
        path = prefix + _block_path(node_id, names, parents)
        entries.append((node_id, path))
        body = _function_body_workflow(node, depth)
        if body is not None:
            entries.extend(_block_entries(body, prefix=f"{path} / ", depth=depth + 1))
    return entries


def _structural_nodes(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    """Workflow nodes in engine traversal order: depth-first along edges with
    container bodies before the then-continuation. The canvas nodes array is
    insertion-ordered, not execution-ordered, so it cannot be used directly."""
    nodes = workflow.get("nodes", [])
    by_id = {node.get("id"): node for node in nodes}
    targets_with_incoming: set[str] = set()
    body_children: dict[str, list[str]] = {}
    next_children: dict[str, list[str]] = {}
    for edge in workflow.get("edges", []):
        source = edge.get("source")
        target = edge.get("target")
        if target not in by_id:
            continue
        targets_with_incoming.add(target)
        bucket = next_children if edge.get("sourceHandle") in (None, "then") else body_children
        bucket.setdefault(source, []).append(target)

    visited: set[str] = set()
    ordered: list[dict[str, Any]] = []
    # Entry points first (array order), then every node as a fallback root so
    # disconnected or cyclic fragments still appear.
    roots = [n["id"] for n in nodes if n["id"] not in targets_with_incoming]
    roots.extend(n["id"] for n in nodes)
    for root in roots:
        stack = [root]
        while stack:
            node_id = stack.pop()
            if node_id in visited:
                continue
            visited.add(node_id)
            ordered.append(by_id[node_id])
            children = body_children.get(node_id, []) + next_children.get(node_id, [])
            stack.extend(reversed(children))
    return [node for node in ordered if node.get("type") == "workflowNode"]


def _function_body_workflow(node: dict[str, Any], depth: int) -> dict[str, Any] | None:
    """Resolve a Function node's body workflow; None when not expandable."""
    data = node.get("data") or {}
    if data.get("nodeType") != "function" or depth >= _MAX_FUNCTION_DEPTH:
        return None
    try:
        definition = workbench_functions._load_function_definition(data)
    except Exception:
        return None
    body = definition.get("workflow")
    return body if isinstance(body, dict) else None


def _extract_errors(
    execution_id: str,
    detail: dict[str, Any],
    composition: dict[str, Any],
    run_meta: dict[str, dict[str, Any]],
    merged_logs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """ERROR/FATAL entries from the merged stream, in chronological order."""
    suite_names = {suite.get("id"): suite.get("name") for suite in composition.get("suites", [])}
    maps_cache: dict[str, dict[str, str]] = {}
    errors: list[dict[str, Any]] = []
    for entry in merged_logs:
        if entry.get("level") not in _ERROR_LEVELS:
            continue
        base = {
            "level": entry.get("level"),
            "message": entry.get("message"),
            "timestamp": entry.get("timestamp"),
        }
        if entry.get("scope_kind") == "test":
            run_id = entry.get("run_id") or ""
            meta = run_meta.get(run_id, {})
            errors.append(
                {
                    "run_id": run_id,
                    "test_id": meta.get("test_id"),
                    "test_name": meta.get("test_name"),
                    "suite_name": meta.get("suite_name") or None,
                    "block_path": _error_block_path(
                        execution_id, detail, run_id, entry.get("blockId"), maps_cache
                    ),
                    **base,
                }
            )
        else:
            errors.append(
                {
                    "run_id": None,
                    "test_id": None,
                    "test_name": None,
                    "suite_name": suite_names.get(entry.get("suite_id")),
                    "block_path": None,
                    **base,
                }
            )
    return errors


def _error_block_path(
    execution_id: str,
    detail: dict[str, Any],
    run_id: str,
    block_id: str | None,
    maps_cache: dict[str, dict[str, str]],
) -> str | None:
    if not block_id:
        return None
    if run_id not in maps_cache:
        snapshot = _storage._load_snapshot(execution_id, run_id) or {}
        workflow = snapshot.get("workflow") or detail.get("workflow_snapshot") or {}
        maps_cache[run_id] = dict(_block_entries(workflow))
    return maps_cache[run_id].get(block_id, block_id)


def _session_workflow(session: dict[str, Any]) -> dict[str, Any] | None:
    """Reconstruct the executed workflow from the engine's published node map
    and adjacency; None for sessions that never ran (legacy id-only rows)."""
    node_map = session.get("_node_map")
    if not isinstance(node_map, dict) or not node_map:
        return None
    adjacency: dict[str, list[tuple[str, str | None]]] = session.get("_adj") or {}
    edges = [
        {"source": source, "target": target, "sourceHandle": handle}
        for source, children in adjacency.items()
        for target, handle in children
    ]
    return {"nodes": list(node_map.values()), "edges": edges}


def _log_block_path(entry: dict[str, Any], path_map: dict[str, str]) -> str | None:
    block_id = entry.get("blockId")
    if not block_id:
        return None
    return path_map.get(str(block_id), str(block_id))


def _session_counts(status: Any) -> dict[str, int]:
    counts = dict.fromkeys(_COUNT_KEYS, 0)
    counts["total"] = 1
    if status in ("passed", "failed", "skipped", "stopped"):
        counts[str(status)] = 1
    return counts
