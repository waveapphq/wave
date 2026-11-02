"""Workbench service for ephemeral test execution (V-CANVAS-14 / REQ-3.2.1.1).

This module provides the service layer for ephemeral Workbench execution.
Workbench runs are designed for rapid iteration during test development:
- They do NOT create Execution entities (no persistence)
- State exists only in the current browser session
- Real-time updates via WebSocket

Key differences from tracked Executions:
- Uses session_id instead of execution_id
- Does NOT call execution_service.start_execution()
- WebSocket topic format: workbench:{session_id}
"""

import asyncio
import functools
import logging
import re
import uuid
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from wavecore.api.exceptions import (
    ConflictException,
    NotFoundException,
    UnprocessableEntityException,
    ValidationException,
)
from wavecore.api.services import artifact_service, file_tree, shared, storage_paths
from wavecore.api.services.block_schema import block_schema
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.network import proxy as network_proxy
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.workbench import _common
from wavecore.api.services.workbench._common import (
    DEFAULT_USER_ID,
    WorkbenchStatus,
    _active_tasks,
    _add_execution_log,
    _drain_ssh_sessions,
    _get_session,
    _get_test_profiles,
    _infer_variable_type,
    _terminate_session,
    _user_active_session,
    _workbench_sessions,
    current_instance_path,
    function_instance,
)
from wavecore.api.services.workbench.execution import _execute_workflow, _scrub_error_text
from wavecore.api.services.workbench.functions import (
    FunctionCanvas,
    _log_unused_parameters,
    declared_secret_names,
    locate_function_instance,
    new_instance_scope,
    record_instance_scope,
    resolve_function_canvases,
    resumed_instance_scope,
)
from wavecore.api.services.workbench.graph import _build_adjacency_list
from wavecore.api.services.workbench.lazy_variables import LazyVariables
from wavecore.api.services.workbench.node_helpers import _extract_node_fields
from wavecore.api.services.workbench.remote_exec import AdhocPlace, run_adhoc_in_body
from wavecore.api.services.workbench.signals import (
    _cascade_skip_under_parent,
    _is_diverging_parent,
    _normalize_element_type,
)
from wavecore.core.execution.plugin_executor import VALUE_TYPE_CHECKS, resolve_block_fields
from wavecore.core.expressions.errors import ExpressionEvaluationError
from wavecore.core.functions.declarations import declared_value_of
from wavecore.core.functions.executor import BodyEntry, ScopedStart
from wavecore.core.namespace_base import is_engine_injected
from wavecore.core.secrets import masking_settings
from wavecore.core.secrets.masking import mask_structure, structural_mask
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.sealing import (
    collect_setter_secret_names,
    iter_function_secret_items,
    iter_plugin_credential_secret_items,
    restore_masked_workflow_secrets,
    unseal_all,
    unseal_workflow_node_secrets,
)
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.core.table import Table
from wavecore.core.table_values import is_table_value
from wavecore.core.variables.declared_types import types_of_declarations, types_of_function
from wavecore.core.variables.declared_values import declared_start
from wavecore.core.variables.element_types import realize_declared_value, runtime_element_types
from wavecore.core.variables.usage import (
    block_reads,
    block_writes,
    cycle_message,
    cycle_path,
    sources_graph,
)
from wavecore.core.variables.value_checks import ValueProblem, declared_value_problem
from wavecore.core.variables.wire_form import wire_scalar

logger = logging.getLogger(__name__)


def _log_task_exception(task: asyncio.Task[None]) -> None:
    """Surface any exception that escaped a fire-and-forget run task's own
    error boundary, so a crash is logged instead of a GC-time 'Task exception
    was never retrieved'."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Run task crashed outside its error boundary: %s", exc, exc_info=exc)


# ===========================================================================
# Public API
# ===========================================================================


def check_profile_completeness(
    test_id: str,
    environment_id: str,
) -> list[dict[str, Any]]:
    """Check if all profiles have values for the selected environment."""
    warnings: list[dict[str, Any]] = []
    profiles = _get_test_profiles(test_id)

    for profile in profiles:
        env_values = profile.get("environment_values", {})
        if environment_id not in env_values:
            warnings.append(
                {
                    "type": "INCOMPLETE_PROFILE",
                    "profile_name": profile.get("name", "Unknown"),
                    "message": f"Profile '{profile.get('name')}' has no value for this environment",
                }
            )

    return warnings


def get_active_session_for_user(user_id: str = DEFAULT_USER_ID) -> str | None:
    """Get the active workbench session for a user."""
    session_id = _user_active_session.get(user_id)
    if session_id:
        session = _workbench_sessions.get(session_id)
        if session and session.get("status") == WorkbenchStatus.RUNNING.value:
            return session_id
    return None


def get_session_for_user(user_id: str = DEFAULT_USER_ID) -> dict[str, Any] | None:
    """Get the API-safe view of the active session for a user (session recovery).

    The internal session dict carries non-JSON-serializable runtime objects
    (e.g. ``SystemObject`` inside ``variables``) used by the execution engine.
    Returning the full dict crashes JSON serialization, so the recovery
    endpoint receives only the fields the frontend consumes.
    """
    session_id = _user_active_session.get(user_id)
    if not session_id:
        return None

    session = _workbench_sessions.get(session_id)
    if not session:
        return None

    return {
        "session_id": session.get("session_id"),
        "status": session.get("status"),
        "test_id": session.get("test_id"),
        "test_name": session.get("test_name"),
        "environment_id": session.get("environment_id"),
        "environment_name": session.get("environment_name"),
        "websocket_topic": session.get("websocket_topic"),
        "current_block": session.get("current_block"),
        "progress": session.get("progress"),
        "block_states": session.get("block_states", {}),
        "execution_id": session.get("execution_id"),
        "parent_execution_id": session.get("parent_execution_id"),
        "error": session.get("error"),
    }


def clear_session_for_user(user_id: str = DEFAULT_USER_ID) -> dict[str, Any]:
    """Clear/reset the session for a user."""
    session_id = _user_active_session.get(user_id)
    if not session_id:
        return {"cleared": False}

    task = _active_tasks.get(session_id)
    if task and not task.done():
        task.cancel()

    # Test Close / reset closes any SSH sessions the run left open (the escape
    # hatch, since Immediate Stop and ad-hoc runs now leave them open).
    _drain_ssh_sessions(session_id)

    # Wipe-by-id only touches sessions/; tracked execution dirs stay.
    artifact_service.wipe_session_artifacts(session_id)

    if session_id in _workbench_sessions:
        del _workbench_sessions[session_id]
    if session_id in _active_tasks:
        del _active_tasks[session_id]
    if user_id in _user_active_session:
        del _user_active_session[user_id]

    return {"cleared": True}


def _guard_no_active_session(user_id: str) -> None:
    """Raise ConflictException when the user already has a live session."""
    active_session = get_active_session_for_user(user_id)
    if not active_session:
        return
    session_data = _workbench_sessions.get(active_session) or {}
    kind = "tracked execution" if session_data.get("execution_id") else "workbench"
    raise ConflictException(
        f"User already has an active {kind} session: {active_session}. "
        "Stop the current workbench or tracked execution before starting a new one."
    )


def _validate_run_preconditions(
    test_id: str,
    environment_id: str,
    user_id: str,
    in_memory_workflow: dict[str, Any] | None = None,
    in_memory_variables: dict[str, Any] | None = None,
    draft_block_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate preconditions for starting a workbench run.

    When ``in_memory_workflow`` is supplied (run-current), the run gate
    validates that dirty body instead of the on-disk test - the on-disk
    validate-by-id path cannot see unsaved edits."""
    _guard_no_active_session(user_id)

    test = test_service.get_test(test_id)
    if test is None:
        raise LookupError(f"Test with ID '{test_id}' not found")

    if in_memory_workflow is not None:
        in_memory_test = test_service.unsaved_test(
            test_id, test, in_memory_workflow, in_memory_variables
        )
        _raise_for_run_validation(
            test_service._validate_test_data(in_memory_test, context="run"),
            _draft_block(in_memory_workflow, draft_block_id),
        )
    else:
        _validate_test_for_run(test_id, _draft_block(test.get("workflow") or {}, draft_block_id))

    environment = environment_service.get_environment(environment_id)
    if environment is None:
        raise LookupError(f"Environment with ID '{environment_id}' not found")

    return test, environment


_VARIABLE_FINDING = re.compile(r"^variables\.([^.\[]+)")


def _draft_block(workflow: dict[str, Any], node_id: str | None) -> dict[str, Any] | None:
    """The block an editor Run executes, as the body being validated holds it (PYRUN-21)."""
    if node_id is None:
        return None
    nodes = workflow.get("nodes")
    candidates = nodes if isinstance(nodes, list) else []
    return next(
        (n for n in candidates if isinstance(n, dict) and n.get("id") == node_id),
        {"id": node_id},
    )


def _stops_block_draft(error: dict[str, Any], block: dict[str, Any]) -> bool:
    """True for the block's own findings and those on a variable it reads or binds (PYRUN-21)."""
    if error.get("node_id") == block["id"]:
        return True
    match = _VARIABLE_FINDING.match(str(error.get("path") or ""))
    return match is not None and match.group(1) in block_reads(block) | block_writes(block)


def _raise_for_run_validation(
    validation: dict[str, Any] | None, draft_block: dict[str, Any] | None = None
) -> None:
    """Raise the run-gate ValidationException for a validation result, or no-op."""
    if validation is None:
        return
    val_errors = validation.get("errors", [])
    if validation.get("fatal"):
        fatal_msgs = [e["message"] for e in val_errors if e.get("message")]
        raise ValidationException(
            f"Cannot run test: fatal validation errors: {'; '.join(fatal_msgs)}"
        )
    if draft_block is not None:
        val_errors = [e for e in val_errors if _stops_block_draft(e, draft_block)]
    if val_errors:
        error_msgs = [e["message"] for e in val_errors if e.get("message")]
        raise ValidationException(f"Cannot run test: validation errors: {'; '.join(error_msgs)}")


def _validate_test_for_run(test_id: str, draft_block: dict[str, Any] | None = None) -> None:
    """Validate test before running (same strictness as Save)."""
    _raise_for_run_validation(test_service.validate_test(test_id, context="run"), draft_block)


def _flatten_variables(
    raw_variables: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, tuple[str, str]], dict[str, str]]:
    """Flatten structured variable entries into literals, expression, and
    template maps. A template renders lazily on reference (REQ-3.1.3.15)."""

    variables: dict[str, Any] = {}
    expr_map: dict[str, tuple[str, str]] = {}
    tmpl_map: dict[str, str] = {}

    for var_name, var_entry in raw_variables.items():
        if not isinstance(var_entry, dict):
            variables[var_name] = var_entry
            continue
        try:
            start = declared_start(var_entry)
        except ValueError as exc:
            raise ValidationException(str(exc)) from exc
        if start.kind == "expression":
            expr_map[var_name] = (start.value, start.var_type)
        elif start.kind == "template":
            tmpl_map[var_name] = start.value
        else:
            variables[var_name] = start.value

    return variables, expr_map, tmpl_map


def _collect_secret_variable_names(raw_variables: dict[str, Any]) -> list[str]:
    """Names whose declaration carries secret: true (literal or expression)."""
    return [
        var_name
        for var_name, var_entry in raw_variables.items()
        if isinstance(var_entry, dict) and var_entry.get("secret")
    ]


def _collect_run_secret_names(
    raw_variables: dict[str, Any], nodes: list[dict[str, Any]]
) -> list[str]:
    """Every secret name a run must flag: declared secret variables plus names a
    Variable Setter row marks secret (which the Variable Manager may declare plain)."""
    names = set(_collect_secret_variable_names(raw_variables))
    names |= collect_setter_secret_names({"nodes": nodes})
    return list(names)


def _validate_expression_variable_dependencies(
    expr_map: dict[str, tuple[str, str]],
    tmpl_map: dict[str, str] | None = None,
) -> None:
    """Refuse a loop among the computed variables at session start, before any block reads one."""
    expressions = {name: source for name, (source, _type) in expr_map.items()}
    loop = cycle_path(sources_graph(expressions, tmpl_map or {}))
    if loop is not None:
        raise ValidationException(cycle_message(loop))


_BLOCKED_AD_HOC_ELEMENT_TYPES = frozenset({"break", "continue", "note"})

_TERMINAL_STATUSES = frozenset(
    {
        WorkbenchStatus.PASSED.value,
        WorkbenchStatus.FAILED.value,
        WorkbenchStatus.STOPPED.value,
        WorkbenchStatus.SKIPPED.value,
    }
)


def _validate_adhoc_target(
    nodes: list[dict[str, Any]],
    start_node_id: str | None,
    single_node_id: str | None,
) -> None:
    """Validate that any ad-hoc target exists and (for ``single_node_id``) is runnable.

    Raises ``LookupError`` for an unknown node id and
    ``ValidationException`` when ``single_node_id`` points at a Break /
    Continue / Note.
    """
    target_node_id = single_node_id if single_node_id is not None else start_node_id
    if target_node_id is None:
        return
    target_node = next((n for n in nodes if n.get("id") == target_node_id), None)
    if target_node is None:
        raise LookupError("block not found in workflow")
    if single_node_id is None:
        return
    element_type = (target_node.get("data", {}) or {}).get("elementType")
    if element_type in _BLOCKED_AD_HOC_ELEMENT_TYPES:
        raise ValidationException("single_node_id targets a non-runnable block type")


def _inheritable_session(user_id: str, test_id: str) -> dict[str, Any] | None:
    """The finished session of ``test_id`` an ad-hoc run starts from, or None (REQ-3.2.1.5).

    Every ad-hoc run - Run/Debug Current, Run/Debug from Here and Run/Debug Scope, at the
    Test level or inside a Function body - starts from what the user's session holds now:
    the Test's variables and block states, the live SSH sessions, and each Function
    instance's last runtime scope. Reset removes the session, so the next run starts clean.
    """
    previous_session_id = _user_active_session.get(user_id)
    if not previous_session_id:
        return None
    # ``_user_active_session`` and ``_workbench_sessions`` are kept in lockstep:
    # every entry into one writes the other, every exit (clear_session_for_user
    # / _clear_sessions_sync) wipes both. Direct lookup is safe here.
    previous = _workbench_sessions[previous_session_id]
    if previous.get("test_id") != test_id:
        return None
    if previous.get("status") not in _TERMINAL_STATUSES:
        return None
    return previous


@dataclass(frozen=True)
class _CarriedState:
    """What a run carries from the session it starts from; nothing for a full run."""

    variables: dict[str, Any] | None = None
    variable_seeds: dict[str, Any] = field(default_factory=dict)
    given_variables: frozenset[str] = frozenset()
    evaluated_sources: dict[str, Any] = field(default_factory=dict)
    stale_variables: frozenset[str] = frozenset()
    given_expressions: dict[str, tuple[str, str]] = field(default_factory=dict)
    given_templates: dict[str, str] = field(default_factory=dict)
    block_states: dict[str, str] = field(default_factory=dict)
    function_scopes: dict[tuple[str, ...], dict[str, Any]] = field(default_factory=dict)
    function_scope_types: dict[tuple[str, ...], dict[str, str]] = field(default_factory=dict)
    ssh_session_registry: Any = None
    secret_registry: Any = None
    secret_variable_names: list[str] = field(default_factory=list)


def _carried_state(previous: dict[str, Any] | None) -> _CarriedState:
    """The state an ad-hoc run takes over from ``previous``, or an empty one."""
    if previous is None:
        return _CarriedState()
    held = previous.get("variables")
    store = held if isinstance(held, LazyVariables) else LazyVariables()
    return _CarriedState(
        variables=dict(held or {}),
        variable_seeds=dict(previous.get("variable_seeds") or {}),
        given_variables=store.written_names(),
        evaluated_sources=store.evaluated_sources(),
        stale_variables=store.stale_names(),
        given_expressions=dict(previous.get("given_expressions") or {}),
        given_templates=dict(previous.get("given_templates") or {}),
        block_states=dict(previous.get("block_states") or {}),
        function_scopes=dict(previous.get("function_scopes") or {}),
        function_scope_types=dict(previous.get("function_scope_types") or {}),
        ssh_session_registry=previous.get("ssh_session_registry"),
        secret_registry=previous.get("secret_registry"),
        secret_variable_names=list(previous.get("secret_variable_names") or []),
    )


def _unstarted_seed(previous: Mapping[str, Any] | None) -> dict[tuple[str, ...], dict[str, Any]]:
    """The Current values a session holds for Function instances its run never started."""
    if previous is None:
        return {}
    started = previous.get("started_scopes") or set()
    return {
        path: dict(entries)
        for path, entries in (previous.get("function_seed") or {}).items()
        if path not in started
    }


def _given_values(carried: _CarriedState | None) -> dict[str, Any] | None:
    """The values the session gave its variables, or None for a run that carries nothing.

    A literal the session only seeded from its definition is not one of them: it has no
    value of its own, so the next ad-hoc run reads its definition again (REQ-3.2.1.5).
    """
    if carried is None or carried.variables is None:
        return None
    seeds = carried.variable_seeds
    return {
        name: value
        for name, value in carried.variables.items()
        if name in carried.given_variables
        or name not in seeds
        or not (value is seeds[name] or value == seeds[name])
    }


@dataclass(frozen=True)
class _VariableMaps:
    """A run's starting variables: realized literals, pending sources, definition seeds,
    the names among the literals that hold a value the session gave, and the source of
    each evaluated result among them."""

    literals: dict[str, Any]
    expressions: dict[str, Any]
    templates: dict[str, str]
    seeds: dict[str, Any]
    given: frozenset[str] = frozenset()
    evaluated: dict[str, Any] = field(default_factory=dict)


def _prepare_variable_maps(
    raw_variables: Any, carried: _CarriedState | None = None
) -> _VariableMaps:
    literals, expr_map, tmpl_map = _flatten_variables(raw_variables)
    _validate_expression_variable_dependencies(expr_map, tmpl_map)
    given = _given_values(carried)
    if carried is None or given is None:
        return _VariableMaps(literals, expr_map, tmpl_map, dict(literals))
    in_force = {**expr_map, **tmpl_map, **carried.given_expressions, **carried.given_templates}
    evaluated = _kept_results(carried, given, literals, in_force)
    given = {
        name: value
        for name, value in given.items()
        if name in evaluated or name not in carried.evaluated_sources
    }
    # A value the session gave wins; then a source a Current-mode edit set (REQ-3.2.1.6).
    held = given.keys() | carried.given_expressions.keys() | carried.given_templates.keys()
    seeds = {name: value for name, value in literals.items() if name not in held}
    return _VariableMaps(
        literals={**seeds, **given},
        expressions=_pending_sources(expr_map, carried.given_expressions, held, given),
        templates=_pending_sources(tmpl_map, carried.given_templates, held, given),
        seeds=seeds,
        given=frozenset(given),
        evaluated=evaluated,
    )


_NO_TEST_VARIABLES = _VariableMaps({}, {}, {}, {})


@dataclass(frozen=True)
class _TestVariables:
    """The Test variables a Function-body run holds: maps, declared types and secret names."""

    maps: _VariableMaps = _NO_TEST_VARIABLES
    types: Mapping[str, str] = field(default_factory=dict)
    secret_names: tuple[str, ...] = ()


def _kept_results(
    carried: _CarriedState,
    given: dict[str, Any],
    literals: dict[str, Any],
    in_force: dict[str, Any],
) -> dict[str, Any]:
    """The evaluated results an ad-hoc run keeps, with their sources (REQ-3.2.1.5).

    A result is due again when its source is no longer the one in force, when a
    Current-mode edit marked it, or when it reads a variable that is due again or whose
    definition changed while it followed that definition.
    """
    evaluated = carried.evaluated_sources
    reads = _reads(evaluated, carried.variable_seeds.keys())
    due = {name for name, source in evaluated.items() if in_force.get(name) != source}
    due |= carried.stale_variables
    due |= {
        name
        for name in set().union(*reads.values()) - given.keys() - evaluated.keys()
        if _redefined(literals, name, carried.variable_seeds[name])
    }
    due = _with_readers(due, reads)
    return {name: source for name, source in evaluated.items() if name not in due}


def _reads(evaluated: dict[str, Any], others: Collection[str]) -> dict[str, set[str]]:
    """For each evaluated result, the names it reads among the results and ``others``."""
    expressions = {name: src[0] for name, src in evaluated.items() if not isinstance(src, str)}
    templates = {name: src for name, src in evaluated.items() if isinstance(src, str)}
    known = set(others) | evaluated.keys()
    return {name: read & known for name, read in sources_graph(expressions, templates).items()}


def _with_readers(changed: set[str], reads: dict[str, set[str]]) -> set[str]:
    """``changed`` plus every result that reads one of them, directly or through another."""
    while True:
        readers = {name for name, read in reads.items() if name not in changed and read & changed}
        if not readers:
            return changed
        changed = changed | readers


def _redefined(literals: dict[str, Any], name: str, seed: Any) -> bool:
    """True when ``name`` is no longer a literal holding the value it was seeded with."""
    if name not in literals:
        return True
    value = literals[name]
    return value is not seed and _serialize_runtime_value(value) != _serialize_runtime_value(seed)


def _pending_sources(
    declared: dict[str, Any],
    given_sources: dict[str, Any],
    held: Collection[str],
    given: dict[str, Any],
) -> dict[str, Any]:
    """Definition sources no session state replaces, plus the Current-mode sources still pending."""
    pending = {name: source for name, source in declared.items() if name not in held}
    pending.update({name: src for name, src in given_sources.items() if name not in given})
    return pending


@dataclass(frozen=True)
class DebugRunOptions:
    """Bundle of debug-mode parameters for ``start_workbench_run``."""

    breakpoints: list[str] | None = None
    options: dict[str, bool] | None = None


@dataclass(frozen=True)
class ScopedRunOptions:
    """Bundle of scope-routing parameters for ``start_workbench_run``."""

    mode: str = "test"
    function_node_id: str | None = None
    # Function instance ids from the Test canvas to the canvas that holds the run's target.
    function_path: tuple[str, ...] = ()


@dataclass(frozen=True)
class RunLineage:
    """Tracked-execution lineage for ``start_workbench_run``. All None = ephemeral."""

    execution_id: str | None = None
    parent_execution_id: str | None = None
    suite_id: str | None = None
    regression_id: str | None = None


@dataclass(frozen=True)
class RunTarget:
    """What ``start_workbench_run`` walks: the whole test, or the part an ad-hoc run bounds.

    ``start_node_id`` moves the engine entry-point so traversal begins at the chosen node
    and continues through every reachable downstream node. ``single_node_id`` bounds
    traversal to the target's structural sub-tree (atomic node only / single-egress
    composite body / branching sub-trees). The two are mutually exclusive; both ``None``
    = full traversal from Start. ``block_draft`` marks the editor's Run of the
    ``single_node_id`` block's unsaved draft: the run gate then refuses only that block's
    findings and those on the variables it uses.
    """

    start_node_id: str | None = None
    single_node_id: str | None = None
    block_draft: bool = False

    @property
    def is_adhoc(self) -> bool:
        """True when the run is bounded to part of the canvas instead of the whole test."""
        return self.start_node_id is not None or self.single_node_id is not None

    @property
    def draft_block_id(self) -> str | None:
        """The block whose unsaved draft the run gate judges, or None."""
        return self.single_node_id if self.block_draft else None


def _validate_run_target(target: RunTarget) -> None:
    """Refuse both bounds at once, and a draft run with no block to bound it."""
    if target.start_node_id is not None and target.single_node_id is not None:
        raise ValidationException("start_node_id and single_node_id are mutually exclusive")
    if target.block_draft and target.single_node_id is None:
        raise ValidationException("block_draft requires single_node_id")


def _announce_run_state(session_id: str, lineage: RunLineage, session_data: dict[str, Any]) -> None:
    """Announce a mirrorable run on the ownership slot; child sessions never announce."""
    if lineage.execution_id != session_id and lineage != RunLineage():
        return
    from wavecore.api.services.workbench import ownership

    ownership.set_run_state(
        {
            "session_id": session_id,
            "test_id": session_data["test_id"],
            "test_name": session_data["test_name"],
            "environment_id": session_data["environment_id"],
            "environment_name": session_data["environment_name"],
            "status": "running",
        }
    )


def _resolve_tracked_artifacts_dir(execution_id: str) -> str | None:
    """Resolve a tracked execution's artifact dir from its record."""
    from wavecore.api.services.executions import _storage as exec_storage

    record = exec_storage._execution_storage.get(execution_id) or exec_storage._load_execution(
        execution_id
    )
    artifact_dir = (record or {}).get("artifact_dir")
    if artifact_dir:
        return str(storage_paths.get_artifacts_storage_path() / artifact_dir)
    return None


def _prepare_session_artifacts(
    session_id: str,
    lineage: RunLineage,
    previous_session_id: str | None,
    inherit: bool,
) -> str | None:
    """Compute the session's artifacts_dir by the artifact lifecycle.

    Tracked sessions (and sequential children) resolve to the execution's
    artifact dir. Ephemeral sessions get ``{root}/sessions/{session_id}``;
    run-without-reset inheritance moves the previous session's dir there,
    while replacement without inheritance wipes it.
    """
    if previous_session_id is not None and not inherit:
        artifact_service.wipe_session_artifacts(previous_session_id)
    tracked_execution_id = lineage.execution_id or lineage.parent_execution_id
    if tracked_execution_id is not None:
        return _resolve_tracked_artifacts_dir(tracked_execution_id)
    new_dir = artifact_service.session_artifacts_dir(session_id)
    if previous_session_id is not None and inherit:
        artifact_service.move_session_artifacts(previous_session_id, session_id)
    new_dir.mkdir(parents=True, exist_ok=True)
    return str(new_dir)


def _run_load_workflow(workflow: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    """The body a run executes with its secrets open; a read masks Function secrets, so a
    placeholder takes the value stored at its place."""
    return unseal_workflow_node_secrets(restore_masked_workflow_secrets(workflow, stored))


def _restore_and_unseal_run_inputs(
    variables: dict[str, Any] | None,
    workflow: dict[str, Any] | None,
    raw_disk_variables: dict[str, Any],
    raw_disk_workflow: dict[str, Any] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Restore masked secrets against the stored values, then unseal; either may be None."""
    if variables is not None:
        variables = shared.restore_masked_secrets(variables, raw_disk_variables)
    if workflow is not None:
        workflow = _run_load_workflow(workflow, raw_disk_workflow)
    return variables, workflow


def _resolve_run_body(
    test: dict[str, Any],
    workflow: dict[str, Any] | None,
    variables: dict[str, Any] | None,
    raw_disk_variables: dict[str, Any],
    raw_disk_workflow: dict[str, Any] | None = None,
) -> tuple[list[Any], list[Any], dict[str, Any]]:
    """Pick the executable body: in-memory run-current override or on-disk.

    Variables always come from a RAW source - ``get_test`` is a masked read,
    so seeding literals from it would run saved secrets as the placeholder. The
    on-disk workflow is unsealed here so its secrets run as real values."""
    if workflow is not None:
        raw_variables = variables if variables is not None else raw_disk_variables
        return workflow.get("nodes", []), workflow.get("edges", []), raw_variables
    disk = _run_load_workflow(test.get("workflow", {}), raw_disk_workflow)
    return disk.get("nodes", []), disk.get("edges", []), raw_disk_variables


_TYPED_FORM_KEYS = frozenset({"type", "value", "secret", "elementTypes"})


def _apply_run_overrides(
    raw_variables: dict[str, Any], overrides: dict[str, Any]
) -> dict[str, Any]:
    """Layer per-run values over the declared ones, keeping each declaration's
    type, secrecy and kind. Overriding an undeclared name is refused."""
    merged = dict(raw_variables)
    for name, submitted in overrides.items():
        if name not in merged:
            raise ValidationException(f"Variable '{name}' is not declared by this test")
        declaration = merged[name]
        value = _override_value(declaration, submitted)
        if isinstance(declaration, dict):
            merged[name] = {**declaration, "value": value}
        else:
            merged[name] = value
    return merged


def _override_value(declaration: Any, submitted: Any) -> Any:
    """The value an override gives: a map is the typed form only when its ``type`` is the
    declared type and its other keys belong to that form; any other map is the value."""
    declared_type = declaration.get("type") if isinstance(declaration, dict) else None
    if (
        isinstance(submitted, dict)
        and declared_type is not None
        and submitted.get("type") == declared_type
        and submitted.keys() <= _TYPED_FORM_KEYS
    ):
        return submitted.get("value")
    return submitted


def _seed_of(
    function_variables: Iterable[Mapping[str, Any]] | None, root: tuple[str, ...] = ()
) -> dict[tuple[str, ...], dict[str, Any]]:
    """The run request's staged Current values by instance path, each path under ``root``."""
    seed: dict[tuple[str, ...], dict[str, Any]] = {}
    for entry in function_variables or ():
        path = (*root, *(entry.get("function_path") or ()))
        seed.setdefault(path, {}).update(entry.get("variables") or {})
    return seed


def _instance_definition(
    workflow: dict[str, Any], path: tuple[str, ...], owner_id: str
) -> dict[str, Any] | None:
    """The definition of the Function instance at ``path``; None when no instance is there."""
    try:
        return resolve_function_canvases(workflow, path, owner_id)[-1].definition
    except LookupError:
        return None


def _checked_seed(
    workflow: dict[str, Any], seed: Mapping[tuple[str, ...], Mapping[str, Any]], owner_id: str
) -> dict[tuple[str, ...], dict[str, Any]]:
    """The run's staged instance values, each held to its declaration as a Current edit is."""
    checked: dict[tuple[str, ...], dict[str, Any]] = {}
    for path, variables in seed.items():
        definition = _instance_definition(workflow, path, owner_id)
        if definition is None:
            continue
        scope = ScopeAt(None, types_of_function(definition, every_input=True), "function")
        secret = declared_secret_names(definition)
        checked[path] = {
            name: _checked_entry(scope, name, entry, secret) for name, entry in variables.items()
        }
    return checked


def _checked_entry(
    scope: "ScopeAt", name: str, entry: Mapping[str, Any], secret: Collection[str]
) -> dict[str, Any]:
    _check_declared(scope, name, str(entry.get("type")))
    try:
        declared_start(entry)
    except ValueError as exc:
        raise ValidationException(str(exc)) from exc
    _refuse_value_problem(name, declared_value_of(entry, "value"))
    return {**entry, "secret": True} if name in secret else dict(entry)


def _run_seed(
    workflow: dict[str, Any],
    staged: Mapping[tuple[str, ...], Mapping[str, Any]],
    carried: Mapping[tuple[str, ...], Mapping[str, Any]],
    owner_id: str,
) -> dict[tuple[str, ...], dict[str, Any]]:
    """Staged values over the carried ones that still fit this body; a staged value wins."""
    seed = _fitting_seed(workflow, carried, owner_id)
    for path, entries in _checked_seed(workflow, staged, owner_id).items():
        seed.setdefault(path, {}).update(entries)
    return seed


def _fitting_seed(
    workflow: dict[str, Any], carried: Mapping[tuple[str, ...], Mapping[str, Any]], owner_id: str
) -> dict[tuple[str, ...], dict[str, Any]]:
    """The carried values whose instance and declared type are unchanged; the rest drop."""
    fitting: dict[tuple[str, ...], dict[str, Any]] = {}
    for path, entries in carried.items():
        definition = _instance_definition(workflow, path, owner_id)
        if definition is None:
            continue
        types = types_of_function(definition, every_input=True)
        secret = declared_secret_names(definition)
        kept = {
            name: _with_secrecy(entry, name in secret)
            for name, entry in entries.items()
            if types.get(name) == entry.get("type")
        }
        if kept:
            fitting[path] = kept
    return fitting


def _with_secrecy(entry: Mapping[str, Any], secret: bool) -> dict[str, Any]:
    plain = {key: value for key, value in entry.items() if key != "secret"}
    return {**plain, "secret": True} if secret else plain


def _register_staged_secrets(
    registry: SecretRegistry, seed: Mapping[tuple[str, ...], Mapping[str, Any]]
) -> None:
    """Mask a staged value marked secret wherever the run shows it (REQ-3.1.3.5)."""
    for entries in seed.values():
        for name, entry in entries.items():
            if not entry.get("secret"):
                continue
            registry.mark_name(name)
            start = declared_start(entry)
            if start.kind == "literal":
                registry.register_value(start.value, "staged")


def _sources_in_force(
    given_sources: dict[str, Any], pending: dict[str, Any], evaluated: dict[str, Any]
) -> dict[str, Any]:
    """The Current-mode sources the new run still follows: pending, or behind a result it keeps."""
    return {
        name: source
        for name, source in given_sources.items()
        if name in pending or evaluated.get(name) == source
    }


def _push_in_current_instance(session_id: str, name: str, value: Any) -> None:
    """Push a value of the Function instance the caller runs in; the Test's outside one."""
    _schedule_variable_change_push(session_id, name, value, current_instance_path())


def _build_lazy_variables(
    session_id: str,
    literals: dict[str, Any],
    expr_map: dict[str, Any],
    tmpl_map: dict[str, str],
    secret_registry: SecretRegistry | None = None,
    *,
    evaluated: dict[str, Any] | None = None,
) -> Any:
    """Wrap variables for lazy expression / template evaluation, pushing each
    realization. ``evaluated`` names the source of each carried result (REQ-3.2.1.5)."""
    return LazyVariables(
        literals,
        expr_map=expr_map,
        tmpl_map=tmpl_map,
        on_evaluated=functools.partial(
            _schedule_variable_change_push, session_id, function_path=()
        ),
        secret_registry=secret_registry,
        evaluated=evaluated,
    )


def _with_proxy_passwords(registry: SecretRegistry) -> SecretRegistry:
    """Register the proxy passwords in force, so no run output shows one (REQ-4.7.14)."""
    for password in network_proxy.passwords_in_force():
        registry.register_value(password, "proxy")
    return registry


def _build_run_secret_registry(
    secret_names: list[str],
    literals: dict[str, Any],
    nodes: list[dict[str, Any]] | None = None,
    *,
    given: Collection[str] = (),
    carried: _CarriedState | None = None,
) -> SecretRegistry:
    """Create the per-run registry, seeded with declared literal secret values (REQ-3.1.3.5)
    and plugin-declared credential literals from node config (REQ-3.1.3.18).
    ``given`` names the literals that hold a value the session gave (REQ-3.2.1.5)."""
    # A secret with no value starts null, which registers no scan form.
    registry = _with_proxy_passwords(SecretRegistry())
    for name in secret_names:
        registry.mark_name(name)
        if name in literals:
            registry.register(name, literals[name], "declared")
    for param_name, value in iter_plugin_credential_secret_items({"nodes": nodes or []}):
        registry.register_value(value, f"credential:{param_name}")
    for name, value in iter_function_secret_items({"nodes": nodes or []}):
        registry.register_value(value, f"function:{name}")
    _keep_run_time_secrets(registry, literals, given, carried)
    return registry


def _keep_run_time_secrets(
    registry: SecretRegistry,
    literals: dict[str, Any],
    given: Collection[str],
    carried: _CarriedState | None,
) -> None:
    """A variable an earlier run marked secret as it ran stays secret with the value it carries."""
    if carried is None or carried.secret_registry is None:
        return
    for name in given:
        marked = carried.secret_registry.is_secret_name(name)
        if marked and name not in carried.secret_variable_names:
            registry.register(name, literals[name], "carried")


def _session_registry(inherited_registry: Any, session_id: str) -> SSHSessionRegistry:
    """Reuse the ad-hoc run's inherited live SSH registry, or build a fresh one."""
    if inherited_registry is not None:
        return cast(SSHSessionRegistry, inherited_registry)
    return SSHSessionRegistry(
        push_variable=functools.partial(_push_in_current_instance, session_id)
    )


def start_workbench_run(
    test_id: str,
    environment_id: str,
    user_id: str = DEFAULT_USER_ID,
    session_id: str | None = None,
    skipped_node_ids: list[str] | None = None,
    debug: DebugRunOptions | None = None,
    lineage: RunLineage | None = None,
    target: RunTarget | None = None,
    scope: ScopedRunOptions | None = None,
    workflow: dict[str, Any] | None = None,
    variables: dict[str, Any] | None = None,
    overrides: dict[str, Any] | None = None,
    function_variables: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Start a workbench run for a test."""
    target = target or RunTarget()
    _validate_run_target(target)

    scope = scope or ScopedRunOptions()
    debug = debug or DebugRunOptions()
    lineage = lineage or RunLineage()
    if _runs_in_function_body(scope, target):
        return _start_scoped_function_run(
            test_id=test_id,
            environment_id=environment_id,
            user_id=user_id,
            scope=scope,
            session_id=session_id,
            debug=debug,
            workflow=workflow,
            variables=variables,
            adhoc=BodyEntry(
                single_node_id=target.single_node_id, start_node_id=target.start_node_id
            ),
            function_variables=function_variables,
        )

    # Run load is the unseal boundary: literals, restore, and registry need real values
    raw_disk_variables = unseal_all(test_service.get_test_variables_raw(test_id) or {})
    raw_disk_workflow = test_service.get_test_workflow_raw(test_id)
    variables, workflow = _restore_and_unseal_run_inputs(
        variables, workflow, raw_disk_variables, raw_disk_workflow
    )

    test, environment = _validate_run_preconditions(
        test_id,
        environment_id,
        user_id,
        in_memory_workflow=workflow,
        in_memory_variables=variables,
        draft_block_id=target.draft_block_id,
    )

    nodes, edges, raw_variables = _resolve_run_body(
        test, workflow, variables, raw_disk_variables, raw_disk_workflow
    )
    if overrides:
        raw_variables = _apply_run_overrides(raw_variables, overrides)
    previous = _inheritable_session(user_id, test_id) if target.is_adhoc else None
    seed = _run_seed(
        {"nodes": nodes, "edges": edges},
        _seed_of(function_variables),
        _unstarted_seed(previous),
        test_id,
    )

    _validate_adhoc_target(nodes, target.start_node_id, target.single_node_id)

    executable_blocks = [n for n in nodes if n.get("type") == "workflowNode"]
    if not executable_blocks:
        raise ValidationException("Test must have at least one workflow block defined")

    warnings = check_profile_completeness(test_id, environment_id)

    carried = _carried_state(previous)
    previous_session_id = _user_active_session.get(user_id)

    # Lazy-evaluation for expression variables (REQ-3.1.3.13): never
    # pre-evaluate up front. Expressions stay pending until a node
    # actually reads them, so unused expressions never run and never
    # surface in the Variable Manager panel as evaluated values.
    maps = _prepare_variable_maps(raw_variables, carried)

    if session_id is None:
        session_id = str(uuid.uuid4())
    websocket_topic = f"workbench:{session_id}"
    log_topic = f"log:{session_id}"

    artifacts_dir = _prepare_session_artifacts(
        session_id,
        lineage,
        previous_session_id,
        inherit=carried.variables is not None,
    )

    secret_names = _collect_run_secret_names(raw_variables, nodes)
    secret_registry = _build_run_secret_registry(
        secret_names, maps.literals, nodes, given=maps.given, carried=carried
    )
    _register_staged_secrets(secret_registry, seed)

    # Build the lazy variables wrapper now that session_id is fixed.
    variables = _build_lazy_variables(
        session_id,
        maps.literals,
        maps.expressions,
        maps.templates,
        secret_registry=secret_registry,
        evaluated=maps.evaluated,
    )

    test_name = test.get("name", test_id)

    breakpoint_list = list(debug.breakpoints) if debug.breakpoints is not None else []
    session_data: dict[str, Any] = {
        "session_id": session_id,
        "status": WorkbenchStatus.RUNNING.value,
        "test_id": test_id,
        "test_name": test_name,
        "environment_id": environment_id,
        "environment_name": environment.get("name"),
        "user_id": user_id,
        "websocket_topic": websocket_topic,
        "log_topic": log_topic,
        "warnings": warnings,
        "current_block": None,
        "progress": {"current": 0, "total": len(executable_blocks), "percentage": 0.0},
        "started_at": datetime.now(UTC).isoformat(),
        "block_states": dict(carried.block_states),
        "function_scopes": dict(carried.function_scopes),
        "function_scope_types": dict(carried.function_scope_types),
        "function_seed": seed,
        "run_body": {"nodes": nodes, "edges": edges},
        "scope_failed": False,
        "breakpoints": set(breakpoint_list),
        "debug_options": debug.options,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "execution_id": lineage.execution_id,
        "parent_execution_id": lineage.parent_execution_id,
        "suite_id": lineage.suite_id,
        "regression_id": lineage.regression_id,
        "artifacts_dir": artifacts_dir,
        "testdata_dirs": [str(storage_paths.get_test_testdata_path(test_id))],
        "secret_variable_names": secret_names,
        "secret_registry": secret_registry,
        "ssh_session_registry": _session_registry(carried.ssh_session_registry, session_id),
        "variable_types": types_of_declarations(raw_variables),
        "variable_seeds": maps.seeds,
        "given_expressions": _sources_in_force(
            carried.given_expressions, maps.expressions, maps.evaluated
        ),
        "given_templates": _sources_in_force(
            carried.given_templates, maps.templates, maps.evaluated
        ),
    }
    _workbench_sessions[session_id] = session_data
    _user_active_session[user_id] = session_id

    _announce_run_state(session_id, lineage, session_data)

    from wavecore.api.services import log_streaming_service

    log_streaming_service.register_secret_registry(session_id, secret_registry)

    # LazyVariables is a MutableMapping that intentionally does not subclass
    # dict (see lazy_variables.py docstring re: CPython eval routing). Cast
    # at this single boundary so the workflow executor keeps its narrower
    # dict[str, Any] signature without cascading MutableMapping through
    # every helper in the workbench service.
    task = asyncio.create_task(
        _execute_workflow(
            session_id,
            nodes,
            edges,
            cast(dict[str, Any], variables),
            environment_id=environment_id,
            skipped_node_ids=skipped_node_ids,
            start_node_id=target.start_node_id,
            single_node_id=target.single_node_id,
        )
    )
    task.add_done_callback(_log_task_exception)
    _active_tasks[session_id] = task

    # Build a JSON-serializable response. The live session dict holds runtime
    # objects (asyncio.Event, set[str]) that the route cannot return directly.
    return {
        "session_id": session_id,
        "status": session_data["status"],
        "test_id": test_id,
        "test_name": test_name,
        "environment_id": environment_id,
        "user_id": user_id,
        "websocket_topic": websocket_topic,
        "log_topic": log_topic,
        "warnings": warnings,
        "current_block": None,
        "progress": session_data["progress"],
        "started_at": session_data["started_at"],
        "block_states": dict(session_data["block_states"]),
        "breakpoints": breakpoint_list,
        "debug_options": debug.options,
        "paused_node_id": None,
        "execution_id": lineage.execution_id,
        "parent_execution_id": lineage.parent_execution_id,
        "suite_id": lineage.suite_id,
        "regression_id": lineage.regression_id,
    }


def _runs_in_function_body(scope: ScopedRunOptions, target: RunTarget) -> bool:
    """Run Scope, or a Run Current / Run from Here whose target sits inside a Function body."""
    if scope.mode == "function":
        return True
    return bool(scope.function_path) and target.is_adhoc


_CLEAN_SCOPE_ADVISORY: dict[str, Any] = {
    "type": "SCOPED_RUN_ADVISORY",
    "message": (
        "Clean scope state - the Function ran with declared default "
        "values for its inputs (no prior Test run to inherit from)."
    ),
}


def _scoped_run_warnings(test_id: str, environment_id: str, clean: bool) -> list[dict[str, Any]]:
    """Profile-completeness warnings plus a clean-scope advisory when the Function
    starts from declared defaults (no earlier run in the session to start from)."""
    warnings: list[dict[str, Any]] = list(check_profile_completeness(test_id, environment_id))
    if clean:
        warnings.append(dict(_CLEAN_SCOPE_ADVISORY))
    return warnings


@dataclass(frozen=True)
class _FunctionRun:
    """A run of one Function instance's body: where the instance sits and where the run starts.

    ``canvases`` go from the Test canvas to the canvas holding ``target_id``; ``path`` is the
    instance path of the Function whose body runs. ``entry`` None runs the whole body (Run
    Scope, painted on the instance); otherwise the run starts at a node inside the body.
    """

    canvases: list[FunctionCanvas]
    instance: dict[str, Any]
    path: tuple[str, ...]
    target_id: str
    entry: BodyEntry | None = None
    definition: dict[str, Any] | None = None


def _plan_function_run(
    canvases: list[FunctionCanvas], scope: ScopedRunOptions, adhoc: BodyEntry, test_id: str
) -> _FunctionRun:
    """Locate the run's target on the innermost canvas: Run Scope's instance or the ad-hoc node."""
    innermost = canvases[-1]
    if scope.mode == "function":
        target_id = scope.function_node_id or ""
        instance = locate_function_instance(innermost.nodes, target_id, test_id)
        return _FunctionRun(canvases, instance, (*scope.function_path, target_id), target_id)
    _validate_adhoc_target(innermost.nodes, adhoc.start_node_id, adhoc.single_node_id)
    return _FunctionRun(
        canvases,
        cast(dict[str, Any], innermost.instance),
        scope.function_path,
        cast(str, adhoc.single_node_id or adhoc.start_node_id),
        adhoc,
        innermost.definition,
    )


def _function_start(
    run: _FunctionRun, previous: dict[str, Any] | None, test_variables: dict[str, Any] | None
) -> ScopedStart:
    """What the session gave the instance's scope, else whether the flow holding it ran."""
    if previous is None:
        return ScopedStart(scope=new_instance_scope())
    scopes = previous.get("function_scopes") or {}
    recorded = scopes.get(run.path)
    if recorded is not None:
        return ScopedStart(scope=resumed_instance_scope(recorded), restored=True)
    outer = test_variables if len(run.path) == 1 else scopes.get(run.path[:-1])
    return ScopedStart(scope=new_instance_scope(), outer_ran=outer is not None)


def _in_session(start: ScopedStart, session_id: str, path: tuple[str, ...]) -> ScopedStart:
    """The start moved to a scope that masks and pushes under ``path``, keeping what it held."""
    scope = new_instance_scope(session_id, path)
    cast(LazyVariables, scope).adopt(cast(LazyVariables, start.scope))
    return start.changed(scope=scope)


def _staged_start(start: ScopedStart, staged: Mapping[str, Mapping[str, Any]]) -> ScopedStart:
    """Seed the run-alone instance with the Current values set before the run (REQ-3.1.2.10)."""
    starts = {name: declared_start(entry) for name, entry in staged.items()}
    return start.changed(
        input_values={name: held.value for name, held in starts.items() if held.kind == "literal"},
        staged=staged,
    )


def _outer_variables(run: _FunctionRun, start: ScopedStart, session: dict[str, Any]) -> Any:
    """The last state of the flow holding the instance: for a top-level instance the session's
    own Test variables, so a computed variable nothing read yet is evaluated (REQ-3.2.1.5)."""
    if not start.outer_ran:
        return None
    if len(run.path) == 1:
        return session["variables"]
    return session["function_scopes"][run.path[:-1]]


def _set_fields(node_fields: Mapping[str, Any]) -> dict[str, Any]:
    """The fields a Function Block holds; a blank expression holds nothing."""
    expressions = node_fields["expression_fields"]
    return {
        name: value
        for name, value in node_fields["config_values"].items()
        if not (name in expressions and isinstance(value, str) and not value.strip())
    }


def _resolved_start(
    run: _FunctionRun, start: ScopedStart, outer: Any, session_id: str
) -> ScopedStart:
    """The values a run alone starts its inputs from: the Function Block's fields resolved over
    the outer flow's last state, under the Current values set before the run (REQ-3.1.2.10).

    An input neither gives starts on its declared default when the Function flow starts.
    """
    node_fields = _extract_node_fields(run.instance)
    values = {**(_set_fields(node_fields) if outer is not None else {}), **start.input_values}
    if not values:
        return start
    current = set(start.input_values)
    fields = [
        field
        for field in block_schema(run.instance.get("data") or {}).fields
        if field["name"] in values
    ]
    try:
        resolved = resolve_block_fields(
            values,
            fields,
            expression_fields={
                key for key in node_fields["expression_fields"] if key.split(".")[0] not in current
            },
            template_fields={
                key for key in node_fields["template_fields"] if key.split(".")[0] not in current
            },
            element_types={},
            variables=outer if outer is not None else {},
            session_id=session_id,
            exact_numbers=True,
        )
    except (ExpressionEvaluationError, ValueError) as exc:
        return start.changed(refusal=str(exc))
    return start.changed(input_values=resolved)


def _place_variables(session: dict[str, Any], path: tuple[str, ...]) -> Any:
    """The scope an ad-hoc place reads; none for an instance the session never entered."""
    try:
        return _scope_at(session, path).variables
    except LookupError:
        return {}


def _adhoc_places(session: dict[str, Any], run: _FunctionRun) -> list[AdhocPlace]:
    """Where the run starts on each canvas, from the innermost out to the Test canvas."""
    places: list[AdhocPlace] = []
    node_id = run.target_id
    for depth in range(len(run.canvases) - 1, -1, -1):
        canvas = run.canvases[depth]
        places.append(
            AdhocPlace(
                node_id,
                _build_adjacency_list(canvas.edges),
                {node["id"]: node for node in canvas.nodes},
                _place_variables(session, run.path[:depth]),
            )
        )
        node_id = run.path[depth - 1] if depth else node_id
    return places


def _stage_scoped_function_session(
    *,
    test_id: str,
    test_name: str,
    environment_id: str,
    user_id: str,
    run: _FunctionRun,
    start: ScopedStart,
    warnings: list[dict[str, Any]],
    session_id: str | None,
    debug: DebugRunOptions | None,
    previous: dict[str, Any] | None = None,
    in_test: bool = True,
    test_variables: _TestVariables | None = None,
    seed: Mapping[tuple[str, ...], Mapping[str, Mapping[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Register a ``scope_mode='function'`` session and spawn its run task."""
    test_variables = test_variables or _TestVariables()
    maps = test_variables.maps
    seed = seed or {}
    if session_id is None:
        session_id = str(uuid.uuid4())
    websocket_topic = f"workbench:{session_id}"
    log_topic = f"log:{session_id}"
    carried = _carried_state(previous)

    artifacts_dir = _prepare_session_artifacts(
        session_id,
        RunLineage(),
        _user_active_session.get(user_id),
        inherit=previous is not None,
    )

    # Scoped Debug honors the same breakpoint + debug-option payload the
    # whole-test Debug uses, so breakpoints set inside the body still trigger.
    breakpoint_list = list(debug.breakpoints) if debug and debug.breakpoints else []
    debug_options = debug.options if debug else None
    if carried.secret_registry is not None:
        secret_registry = _with_proxy_passwords(carried.secret_registry)
        secret_names = list(carried.secret_variable_names)
    else:
        secret_names = list(test_variables.secret_names)
        secret_registry = _build_run_secret_registry(secret_names, maps.literals)
    _register_staged_secrets(secret_registry, seed)

    session_data: dict[str, Any] = {
        "session_id": session_id,
        "status": WorkbenchStatus.RUNNING.value,
        "test_id": test_id,
        "test_name": test_name,
        "environment_id": environment_id,
        "user_id": user_id,
        "websocket_topic": websocket_topic,
        "log_topic": log_topic,
        "warnings": warnings,
        "current_block": {"block_id": run.target_id, "block_name": "Function"},
        "progress": {"current": 0, "total": 1, "percentage": 0.0},
        "started_at": datetime.now(UTC).isoformat(),
        "block_states": dict(carried.block_states),
        "scope_failed": False,
        "breakpoints": set(breakpoint_list),
        "debug_options": debug_options,
        "pause_event": asyncio.Event(),
        "paused_node_id": None,
        "execution_id": None,
        "parent_execution_id": None,
        "suite_id": None,
        "regression_id": None,
        "variables": _build_lazy_variables(
            session_id,
            maps.literals,
            maps.expressions,
            maps.templates,
            secret_registry,
            evaluated=maps.evaluated,
        ),
        "variable_seeds": dict(maps.seeds),
        "given_expressions": _sources_in_force(
            carried.given_expressions, maps.expressions, maps.evaluated
        ),
        "given_templates": _sources_in_force(
            carried.given_templates, maps.templates, maps.evaluated
        ),
        "function_scopes": dict(carried.function_scopes),
        "function_scope_types": dict(carried.function_scope_types),
        "function_seed": dict(seed),
        "run_body": {"nodes": run.canvases[0].nodes, "edges": run.canvases[0].edges},
        "variable_types": dict(test_variables.types),
        "root_path": () if in_test else run.path,
        "scope_mode": "function",
        "scoped_function_node_id": run.path[-1],
        "artifacts_dir": artifacts_dir,
        "testdata_dirs": ([str(storage_paths.get_test_testdata_path(test_id))] if in_test else []),
        "secret_registry": secret_registry,
        "secret_variable_names": secret_names,
        "ssh_session_registry": _session_registry(carried.ssh_session_registry, session_id),
        "_is_adhoc": in_test,
    }
    _workbench_sessions[session_id] = session_data
    _user_active_session[user_id] = session_id

    from wavecore.api.services import log_streaming_service

    log_streaming_service.register_secret_registry(session_id, session_data["secret_registry"])

    start = _resolved_start(
        run,
        _in_session(start, session_id, run.path),
        _outer_variables(run, start, session_data),
        session_id,
    )
    task = asyncio.create_task(_run_scoped_function(session_id, run, start))
    task.add_done_callback(_log_task_exception)
    _active_tasks[session_id] = task

    return {
        "session_id": session_id,
        "status": session_data["status"],
        "test_id": test_id,
        "test_name": test_name,
        "environment_id": environment_id,
        "user_id": user_id,
        "websocket_topic": websocket_topic,
        "log_topic": log_topic,
        "warnings": warnings,
        "current_block": session_data["current_block"],
        "progress": session_data["progress"],
        "started_at": session_data["started_at"],
        "block_states": dict(session_data["block_states"]),
        "breakpoints": breakpoint_list,
        "debug_options": debug_options,
        "paused_node_id": None,
        "execution_id": None,
        "parent_execution_id": None,
        "suite_id": None,
        "regression_id": None,
        "scope_mode": "function",
        "scoped_function_node_id": run.path[-1],
    }


def _start_scoped_function_run(
    *,
    test_id: str,
    environment_id: str,
    user_id: str,
    scope: ScopedRunOptions,
    session_id: str | None,
    debug: DebugRunOptions | None = None,
    workflow: dict[str, Any] | None = None,
    variables: dict[str, Any] | None = None,
    adhoc: BodyEntry | None = None,
    function_variables: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Start a drilled-in run of one Function instance, at any depth (REQ-3.2.1.1, REQ-3.2.1.5)."""
    _guard_no_active_session(user_id)

    test = test_service.get_test(test_id)
    if test is None:
        raise LookupError(f"Test with ID '{test_id}' not found")

    environment = environment_service.get_environment(environment_id)
    if environment is None:
        raise LookupError(f"Environment with ID '{environment_id}' not found")

    source = _run_load_workflow(
        workflow if workflow is not None else (test.get("workflow") or {}),
        test_service.get_test_workflow_raw(test_id),
    )
    canvases = resolve_function_canvases(source, scope.function_path, test_id)
    run = _plan_function_run(canvases, scope, adhoc or BodyEntry(), test_id)
    previous = _inheritable_session(user_id, test_id)
    seed = _run_seed(source, _seed_of(function_variables), _unstarted_seed(previous), test_id)
    test_variables = _test_variables_of_function_run(test_id, workflow, variables, previous)
    held = previous is not None and previous.get("variables") is not None
    start = _function_start(run, previous, test_variables.maps.literals if held else None)
    start = _staged_start(start, seed.get(run.path) or {})
    clean = start.clean

    return _stage_scoped_function_session(
        test_id=test_id,
        test_name=test.get("name", test_id),
        environment_id=environment_id,
        user_id=user_id,
        run=run,
        start=start,
        warnings=_scoped_run_warnings(test_id, environment_id, clean),
        session_id=session_id,
        debug=debug,
        previous=previous,
        test_variables=test_variables,
        seed=seed,
    )


def _test_variables_of_function_run(
    test_id: str,
    workflow: dict[str, Any] | None,
    variables: dict[str, Any] | None,
    previous: dict[str, Any] | None,
) -> _TestVariables:
    """The Test variables a Function-body run starts from, declared types kept (REQ-3.2.1.5)."""
    declared = unseal_all(test_service.get_test_variables_raw(test_id) or {})
    if workflow is not None and variables is not None:
        declared = shared.restore_masked_secrets(variables, declared)
    maps = _NO_TEST_VARIABLES
    if previous is not None:
        maps = _prepare_variable_maps(declared, _carried_state(previous))
    return _TestVariables(
        maps=maps,
        types=types_of_declarations(declared),
        secret_names=tuple(_collect_secret_variable_names(declared)),
    )


_STANDALONE_FUNCTION_NODE_ID = "fn-standalone"


def start_standalone_function_run(
    *,
    function_def: dict[str, Any],
    function_name: str,
    function_id: str,
    environment_id: str,
    session_id: str | None = None,
    debug: DebugRunOptions | None = None,
    user_id: str = DEFAULT_USER_ID,
    variables: Mapping[str, Any] | None = None,
    function_variables: Iterable[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run a single Function in isolation (library-View standalone run)."""
    _guard_no_active_session(user_id)

    function_node: dict[str, Any] = {
        "id": _STANDALONE_FUNCTION_NODE_ID,
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": dict(function_def),
            "label": function_name,
        },
    }
    root = (_STANDALONE_FUNCTION_NODE_ID,)
    staged = _seed_of([{"variables": variables}, *(function_variables or ())], root)
    seed = _checked_seed({"nodes": [function_node]}, staged, function_id)
    run = _FunctionRun(
        [FunctionCanvas([function_node], [])], function_node, root, _STANDALONE_FUNCTION_NODE_ID
    )
    start = _staged_start(ScopedStart(), seed.get(root) or {})
    return _stage_scoped_function_session(
        test_id=function_id,
        test_name=function_name,
        environment_id=environment_id,
        user_id=user_id,
        run=run,
        start=start,
        warnings=[dict(_CLEAN_SCOPE_ADVISORY)] if start.clean else [],
        session_id=session_id,
        debug=debug,
        in_test=False,
        seed=seed,
    )


def clear_standalone_function_session(session_id: str) -> None:
    """Best-effort teardown of a standalone-run session (library-View sweep).

    Idempotent: an unknown session id is a no-op.
    """
    _active_tasks.pop(session_id, None)
    _workbench_sessions.pop(session_id, None)
    if _user_active_session.get(DEFAULT_USER_ID) == session_id:
        del _user_active_session[DEFAULT_USER_ID]


async def _run_scoped_function(session_id: str, run: _FunctionRun, start: ScopedStart) -> None:
    """Background task body for ``scope_mode='function'`` runs."""
    from wavecore.api.services.workbench.functions import _load_function_definition

    session = _workbench_sessions.get(session_id)
    if session is None:
        return

    try:
        function_def = run.definition or _load_function_definition(run.instance.get("data") or {})
    except RuntimeError as exc:
        session["status"] = WorkbenchStatus.FAILED.value
        session["error"] = str(exc)
        from wavecore.api.services.workbench._common import (
            _broadcast_event,
            _notify_terminal,
        )

        await _broadcast_event(
            session_id,
            {
                "type": "execution_completed",
                "status": WorkbenchStatus.FAILED.value,
                "error": str(exc),
            },
        )
        _notify_terminal(session_id, WorkbenchStatus.FAILED.value)
        return

    record_instance_scope(
        session_id, run.path, start.scope, types_of_function(function_def, every_input=True)
    )
    await run_adhoc_in_body(
        _adhoc_places(session, run),
        session,
        session_id,
        functools.partial(_invoke_scoped_function, session, session_id, run, function_def, start),
    )


async def _invoke_scoped_function(
    session: dict[str, Any],
    session_id: str,
    run: _FunctionRun,
    function_def: dict[str, Any],
    start: ScopedStart,
) -> None:
    """Run the Function body, record its result and broadcast the end of the run."""
    from wavecore.core.functions.executor import execute_scoped_function

    if run.entry is None:
        _log_unused_parameters(session_id, function_def, run.target_id)
    with function_instance(run.path):
        result = await execute_scoped_function(
            function_def=function_def, start=start, session_id=session_id, entry=run.entry
        )

    passed = result.status == "passed"
    if run.entry is None:
        session["block_states"][run.target_id] = "passed" if passed else "failed"
    session["status"] = WorkbenchStatus.PASSED.value if passed else WorkbenchStatus.FAILED.value
    session["scoped_result"] = {
        "status": result.status,
        "outputs": dict(result.outputs),
        "advisory": result.advisory,
    }
    event: dict[str, Any] = {"type": "execution_completed", "status": session["status"]}
    if result.error is not None:
        session["error"] = event["error"] = _scrub_error_text(session, result.error)
    # A block run inside the body logs its own failure; a run refused before the body has none.
    if result.error is not None and (run.entry is None or result.stopped_before_body):
        label = (run.instance.get("data") or {}).get("label") or run.path[-1]
        _add_execution_log(
            session_id,
            "ERROR",
            f"Block '{label}' failed: {session['error']}",
            "SYSTEM",
            block_id=run.path[-1],
        )
    from wavecore.api.services.workbench._common import (
        _broadcast_event,
        _notify_terminal,
    )

    # Without this broadcast the FE's WS subscriber never sees end-of-run,
    # so the action bar stays in the "running" state with Stop visible
    # even though the scoped invocation has completed.
    await _broadcast_event(session_id, event)
    _notify_terminal(session_id, session["status"])


def update_skipped_nodes(session_id: str, skipped_node_ids: list[str]) -> dict[str, Any]:
    """Update the skipped node IDs for a running workbench session."""
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    if session.get("status") != WorkbenchStatus.RUNNING.value:
        raise ConflictException(
            f"Cannot update skipped blocks: session is '{session.get('status')}', not running"
        )

    session["skipped_node_ids"] = skipped_node_ids

    return {
        "session_id": session_id,
        "skipped_node_ids": skipped_node_ids,
    }


_LIVE_DEBUG_STATUSES = (WorkbenchStatus.RUNNING.value, WorkbenchStatus.PAUSED.value)


def update_breakpoints(session_id: str, breakpoints: list[str]) -> dict[str, Any]:
    """Replace the live breakpoint set on a running or paused session."""
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status not in _LIVE_DEBUG_STATUSES:
        raise ConflictException(
            f"Cannot update breakpoints: session is '{current_status}', not running"
        )

    session["breakpoints"] = set(breakpoints)
    return {
        "session_id": session_id,
        "breakpoints": list(breakpoints),
    }


def update_debug_options(
    session_id: str,
    pause_on_first_block: bool | None = None,
    pause_on_errors: bool | None = None,
) -> dict[str, Any]:
    """Patch the live debug-options on a running or paused session.

    Either flag may be omitted to keep its current value. The canvas
    right-click toggles use this so flipping one flag (e.g., Pause on
    Error) does not reset the other.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status not in _LIVE_DEBUG_STATUSES:
        raise ConflictException(
            f"Cannot update debug options: session is '{current_status}', not running"
        )

    debug_options = dict(session.get("debug_options") or {})
    if pause_on_first_block is not None:
        debug_options["pause_on_first_block"] = pause_on_first_block
    if pause_on_errors is not None:
        debug_options["pause_on_errors"] = pause_on_errors
    session["debug_options"] = debug_options

    return {
        "session_id": session_id,
        "debug_options": debug_options,
    }


def continue_session(session_id: str) -> dict[str, Any]:
    """Resume a paused session: the engine runs the paused node, or proceeds from its result."""
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status != WorkbenchStatus.PAUSED.value:
        raise ConflictException(f"Cannot continue: session is '{current_status}', not paused")

    session["paused_node_id"] = None
    pause_event = session.get("pause_event")
    if pause_event is not None:
        pause_event.set()

    return {
        "session_id": session_id,
        "status": WorkbenchStatus.RUNNING.value,
    }


def step_over(session_id: str) -> dict[str, Any]:
    """Step over the paused node: run it (or keep its result) then re-pause.

    Sets ``step_over_from_node`` to the current paused node id so
    ``_maybe_pause_before_node`` suppresses every pause while the engine
    executes inside that node's sub-graph. The main execution loop clears
    the flag after the stepped node finishes and arms ``pause_at_next_node``
    so the engine re-pauses BEFORE the sibling-after successor.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status != WorkbenchStatus.PAUSED.value:
        raise ConflictException(f"Cannot step-over: session is '{current_status}', not paused")

    paused_node_id = session.get("paused_node_id")
    session["step_over_from_node"] = paused_node_id

    pause_event = session.get("pause_event")
    if pause_event is not None:
        pause_event.set()

    return {
        "session_id": session_id,
        "status": WorkbenchStatus.RUNNING.value,
    }


def step_into(session_id: str) -> dict[str, Any]:
    """Step into the paused node: run it and re-pause at the immediate next node.

    Standard debugger semantics: on a control-flow parent the next node is
    the first body node; on a leaf plugin it is the immediate successor
    (identical to step-over). Sets the shared ``pause_at_next_node`` flag
    so the engine re-pauses on the very next ``_maybe_pause_before_node``
    call regardless of whether that node sits inside a body or after a
    'then' egress.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status != WorkbenchStatus.PAUSED.value:
        raise ConflictException(f"Cannot step-into: session is '{current_status}', not paused")

    session["pause_at_next_node"] = True

    pause_event = session.get("pause_event")
    if pause_event is not None:
        pause_event.set()

    return {
        "session_id": session_id,
        "status": WorkbenchStatus.RUNNING.value,
    }


# A substituted script body runs in Source mode for that one execution (PYRUN-21).
_REPEAT_OVERRIDE_IMPLIES: dict[str, dict[str, Any]] = {"script": {"script_type": "source"}}


def _repeat_override_values(override: dict[str, Any]) -> dict[str, Any]:
    """The parameter values one repeat substitutes, plus whatever that parameter implies."""
    parameter = str(override.get("parameter"))
    return {parameter: override.get("value"), **_REPEAT_OVERRIDE_IMPLIES.get(parameter, {})}


def repeat_step(session_id: str, override: dict[str, Any] | None = None) -> dict[str, Any]:
    """Re-execute the currently paused node in place without advancing.

    Sets the ``repeat_step_requested`` one-shot flag and releases the
    pause event. ``_pause_for_debug``'s wait-loop consumes the flag,
    re-runs the block, keeps that run as the block's result, and re-enters
    ``pause_event.wait()`` so the session stays paused on the same node.

    An ``override`` of ``{"node_id", "parameter", "value"}`` substitutes that one
    parameter for that one execution only; the stored workflow keeps its saved value
    and a following repeat without an override runs it again.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status != WorkbenchStatus.PAUSED.value:
        raise ConflictException(f"Cannot repeat: session is '{current_status}', not paused")

    paused_node_id = session.get("paused_node_id")
    if paused_node_id is None:
        raise LookupError("Cannot repeat: no currently paused block")

    if override is not None and override.get("node_id") != paused_node_id:
        raise ConflictException("Cannot repeat: override targets a block that is not paused")

    session["repeat_step_override"] = (
        None if override is None else _repeat_override_values(override)
    )
    session["repeat_step_requested"] = True

    pause_event = session.get("pause_event")
    if pause_event is not None:
        pause_event.set()

    return {
        "session_id": session_id,
        "status": WorkbenchStatus.PAUSED.value,
        "repeated_node_id": paused_node_id,
    }


def _resolve_paused_node(session: dict[str, Any], paused_node_id: str) -> dict[str, Any] | None:
    """Look up the paused node record from the session.

    Tests can prime ``session["_debug_node_records"]`` with a minimal node
    record to exercise the diverging-parent rejection path without spinning
    up a full workflow. The live engine populates ``session["_node_map"]``
    in ``_execute_workflow``.
    """
    debug_records: dict[str, dict[str, Any]] = session.get("_debug_node_records") or {}
    if paused_node_id in debug_records:
        return debug_records[paused_node_id]
    node_map: dict[str, dict[str, Any]] = session.get("_node_map") or {}
    return node_map.get(paused_node_id)


def skip_current_block(session_id: str) -> dict[str, Any]:
    """Skip the paused node and re-pause before the next one.

    Behavior depends on the paused node's element_type:
      - Diverging parents (if-else, assert-split) raise 409: there is no
        single fall-through path past the sub-graph, so the user must step
        into a branch and skip a leaf instead.
      - Single-egress control parents (for, while, for-each, try-catch,
        parallel, switch, assert-single) cascade ``skipped`` to every
        non-'then' descendant and re-pause BEFORE the 'then' successor runs.
      - Leaf plugins keep the existing single-node skip behavior.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    current_status = session.get("status")
    if current_status != WorkbenchStatus.PAUSED.value:
        raise ConflictException(f"Cannot skip: session is '{current_status}', not paused")

    paused_node_id = session.get("paused_node_id")
    if paused_node_id is None:
        raise ConflictException(f"Cannot skip: session is '{current_status}', not paused")

    paused_node = _resolve_paused_node(session, paused_node_id)
    node_data = (paused_node or {}).get("data", {}) or {}
    node_type = node_data.get("nodeType")
    element_type = _normalize_element_type(paused_node)

    if _is_diverging_parent(node_type, element_type):
        raise ConflictException(
            f"Cannot skip branching block '{element_type}': "
            "step into a branch and skip a leaf instead"
        )

    skipped_node_ids = list(session.get("skipped_node_ids") or [])
    if paused_node_id not in skipped_node_ids:
        skipped_node_ids.append(paused_node_id)
    session["skipped_node_ids"] = skipped_node_ids
    session["block_states"][paused_node_id] = "skipped"

    # Single-egress control parents cascade their non-'then' sub-graph.
    if node_type == "control":
        adj = session.get("_adj") or {}
        outgoing = adj.get(paused_node_id, [])
        if any(handle and handle != "then" for _id, handle in outgoing):
            _cascade_skip_under_parent(session, adj, paused_node_id)

    # One-shot intent: the engine's next ``_maybe_pause_before_node`` consumes
    # this flag and re-pauses before the next node.
    session["pause_at_next_node"] = True

    pause_event = session.get("pause_event")
    if pause_event is not None:
        pause_event.set()

    return {
        "session_id": session_id,
        "status": WorkbenchStatus.PAUSED.value,
        "skipped_node_id": paused_node_id,
    }


_LIVE_SESSION_STATUSES = frozenset({WorkbenchStatus.RUNNING.value, WorkbenchStatus.PAUSED.value})


def sessions_running_test(test_id: str) -> list[str]:
    """Ids of the sessions running or paused on the test (the workbench running guard)."""
    return [
        session_id
        for session_id, session in _workbench_sessions.items()
        if session.get("test_id") == test_id and session.get("status") in _LIVE_SESSION_STATUSES
    ]


def _require_active_session(user_id: str) -> dict[str, Any]:
    """Return the user's active session or raise 404 (artifact API)."""
    session_id = _user_active_session.get(user_id)
    session = _workbench_sessions.get(session_id) if session_id else None
    if session is None:
        raise NotFoundException("No active workbench session")
    return session


def list_session_artifacts(user_id: str = DEFAULT_USER_ID) -> dict[str, Any]:
    """List the active session's artifact files sorted by path.

    No session, or a session with nowhere to write, holds no artifacts: both
    answer an empty list rather than a 404 every caller would discard.
    """
    session_id = _user_active_session.get(user_id)
    session = _workbench_sessions.get(session_id) if session_id else None
    artifacts_dir = session.get("artifacts_dir") if session else None
    if not artifacts_dir:
        return {"items": []}
    return {
        "items": [
            {
                "path": entry["path"],
                "size_bytes": entry["size_bytes"],
                "created_at": entry["modified_at"],
            }
            for entry in file_tree.walk_entries(Path(artifacts_dir))
            if entry["kind"] == "file"
        ]
    }


def _resolve_session_artifact(session: dict[str, Any], relative_path: str) -> Path:
    """Validate the relative path (400) and resolve it to an existing file (404)."""
    if not file_tree.is_safe_relative_path(relative_path):
        raise ValidationException(f"Invalid artifact path: {relative_path}")
    artifacts_dir = session.get("artifacts_dir")
    path = Path(artifacts_dir) / relative_path if artifacts_dir else None
    if path is None or not path.is_file():
        raise NotFoundException(f"Session artifact {relative_path} not found")
    return path


def session_artifact_path(relative_path: str, user_id: str = DEFAULT_USER_ID) -> Path:
    """The on-disk path of one artifact file in the active session's directory."""
    return _resolve_session_artifact(_require_active_session(user_id), relative_path)


def delete_session_artifact(relative_path: str, user_id: str = DEFAULT_USER_ID) -> None:
    """Hard-delete one artifact file from the active ephemeral session."""
    session = _require_active_session(user_id)
    # Tracked sessions point into the permanent store; deleting there would
    # bypass the artifact browser's audited soft-delete model.
    if session.get("execution_id") or session.get("parent_execution_id"):
        raise ConflictException("Tracked execution artifacts are managed in the Artifacts page")
    _resolve_session_artifact(session, relative_path).unlink()


def stop_workbench_run(session_id: str) -> dict[str, Any]:
    """Stop a running workbench session.

    Tags the session as user-initiated so the cancellation handler can
    tell a deliberate stop apart from a backend-shutdown cancel.
    """
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    session["stop_reason"] = "user"
    return _terminate_session(session_id)


def get_workbench_status(session_id: str) -> dict[str, Any] | None:
    """Get current status of a workbench session."""
    session = _get_session(session_id)
    if session is None:
        return None

    return {
        "session_id": session["session_id"],
        "status": session["status"],
        "current_block": session.get("current_block"),
        "progress": session.get("progress"),
        "warnings": list(session.get("warnings") or []),
        "scoped_result": session.get("scoped_result"),
    }


def _serialize_runtime_value(value: Any) -> Any:
    """Table instances serialize to their {columns, rows} dict and a number takes its wire
    form (REQ-3.1.3.14); a nested array / map / table recurses so a number at ANY depth is
    serialized (table cells, nested array / map values), all else passes through."""
    if isinstance(value, Table):
        return _serialize_runtime_value(value.to_dict())
    if isinstance(value, list):
        return [_serialize_runtime_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize_runtime_value(item) for key, item in value.items()}
    return wire_scalar(value)


@dataclass(frozen=True)
class ScopeAt:
    """The scope a Function path names: its live store, declared types and kind."""

    variables: Any
    declared_types: Mapping[str, str]
    kind: str


def _scope_at(session: dict[str, Any], path: Sequence[str]) -> ScopeAt:
    """The scope at ``path``, instance ids from the session's root canvas inward (REQ-3.2.1.6)."""
    full_path = (*(session.get("root_path") or ()), *path)
    if not full_path:
        return ScopeAt(session.get("variables"), session.get("variable_types") or {}, "test")
    scopes = session.get("function_scopes") or {}
    if full_path not in scopes:
        raise LookupError(
            f"Function scope '{'/'.join(path)}' not found in workbench session "
            f"'{session.get('session_id')}'"
        )
    types = (session.get("function_scope_types") or {}).get(full_path) or {}
    return ScopeAt(scopes[full_path], types, "function")


def _is_masked_name(session: dict[str, Any], name: str) -> bool:
    registry = session.get("secret_registry")
    return name in set(session.get("secret_variable_names") or []) or (
        registry is not None and registry.is_secret_name(name)
    )


def get_session_variables(
    session_id: str, names: list[str] | None = None, function_path: Sequence[str] = ()
) -> dict[str, Any]:
    """Return one session scope's realized runtime variables, secrets masked (REQ-3.2.2.18)."""
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")
    scope = _scope_at(session, function_path)

    # dict() over LazyVariables iterates realized entries only - pending
    # expressions are never indexed, so the copy cannot force evaluation.
    realized = {
        name: value
        for name, value in dict(scope.variables or {}).items()
        if not is_engine_injected(name, value)
    }
    if names is not None:
        realized = {name: realized[name] for name in names if name in realized}

    registry = session.get("secret_registry")
    variables: dict[str, Any] = {}
    for name, value in realized.items():
        var_type = "table" if isinstance(value, Table) else _infer_variable_type(value)
        masked = _is_masked_name(session, name)
        entry: dict[str, Any] = {
            "value": _mask_session_value(value, masked, registry),
            "type": var_type,
        }
        element_types = None if masked else runtime_element_types(value)
        if element_types is not None:
            entry["elementTypes"] = element_types
        variables[name] = entry
    return {"variables": variables}


def _mask_session_value(value: Any, masked_name: bool, registry: Any) -> Any:
    """Display masking: flagged names collapse to the placeholder; other
    values scrub registered secret bytes (verbatim copies stay hidden). The
    system ``test_variables`` reveal flag (the workbench Variable Manager panel)
    exposes the raw value instead."""
    if masking_settings.is_test_variables_revealed():
        return _serialize_runtime_value(value)
    serialized = _serialize_runtime_value(value)
    if masked_name:
        return structural_mask(serialized)
    if registry is None:
        return serialized
    return mask_structure(serialized, registry)


# A literal table may also be its stored {columns, rows} form.
_LITERAL_TYPE_PREDICATES: dict[str, Callable[[Any], bool]] = {
    **VALUE_TYPE_CHECKS,
    "table": is_table_value,
}


def _refuse_value_problem(name: str, problem: ValueProblem | None) -> None:
    """A Current value that breaks the one number rule is refused (REQ-3.1.3.14)."""
    if problem is not None:
        raise UnprocessableEntityException(problem.describe(f"Value for variable '{name}'"))


def _validate_coerced_literal(name: str, value: Any, declared_type: str) -> None:
    """Reject a literal that does not match its declared type after coercion."""
    predicate = _LITERAL_TYPE_PREDICATES.get(declared_type)
    if predicate is not None and not predicate(value):
        raise UnprocessableEntityException(
            f"Value for variable '{name}' is not a valid {declared_type}"
        )


def _note_current_edit(
    session: dict[str, Any], name: str, source: tuple[str, str] | str | None = None
) -> None:
    """Keep ``name``'s Current-edit source and mark its readers stale (REQ-3.2.1.5)."""
    variables = session["variables"]
    reads = _reads(variables.evaluated_sources(), {name})
    variables.mark_stale(_with_readers({name}, reads))
    expressions = session.setdefault("given_expressions", {})
    templates = session.setdefault("given_templates", {})
    expressions.pop(name, None)
    templates.pop(name, None)
    if isinstance(source, tuple):
        expressions[name] = source
    elif source is not None:
        templates[name] = source


def _schedule_variable_change_push(
    session_id: str, name: str, value: Any, function_path: Sequence[str]
) -> None:
    """Schedule the ``variable_changed`` push for the scope at ``function_path``, if a loop runs."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(
        _common._push_single_variable_change(session_id, name, value, tuple(function_path))
    )


def _check_declared(scope: ScopeAt, name: str, declared_type: str) -> None:
    """A Current edit names a variable its scope declares, with the declared type."""
    declared = scope.declared_types.get(name)
    if declared is None:
        owner = "test" if scope.kind == "test" else "Function"
        raise ValidationException(f"Variable '{name}' is not declared by this {owner}")
    if declared != declared_type:
        raise ValidationException(
            f"Type mismatch for variable '{name}': expected '{declared}', got '{declared_type}'"
        )


@dataclass(frozen=True)
class _UnstartedInstance:
    """A Function instance on the run's body that this run has not started yet."""

    path: tuple[str, ...]
    definition: dict[str, Any]


def _unstarted_instance(
    session: dict[str, Any], function_path: Sequence[str]
) -> _UnstartedInstance | None:
    """The instance at ``function_path`` if it is on the run's body and not yet started."""
    full_path = (*(session.get("root_path") or ()), *function_path)
    if not full_path or full_path in (session.get("started_scopes") or set()):
        return None
    definition = _instance_definition(
        session.get("run_body") or {}, full_path, str(session.get("test_id"))
    )
    return None if definition is None else _UnstartedInstance(full_path, definition)


def _seed_entry(
    value: Any,
    expression: str | None,
    template: str | None,
    declared_type: str,
    element_types: list[str] | dict[str, str] | None,
) -> dict[str, Any]:
    """A Current edit as the seed entry a staged value is: the declaration's typed form."""
    if expression is not None:
        return {"type": declared_type, "value": expression, "isExpression": True}
    if template is not None:
        return {"type": declared_type, "value": template, "isTemplate": True}
    entry: dict[str, Any] = {"type": declared_type, "value": value}
    if element_types is not None:
        entry["elementTypes"] = element_types
    return entry


def _seed_unstarted(
    session: dict[str, Any], instance: _UnstartedInstance, name: str, entry: dict[str, Any]
) -> dict[str, Any]:
    """Hold the value for the instance's start, checked as a value staged before a run is."""
    scope = ScopeAt(None, types_of_function(instance.definition, every_input=True), "function")
    checked = _checked_entry(scope, name, entry, declared_secret_names(instance.definition))
    start = declared_start(checked)
    if start.kind == "literal" and start.value is not None:
        _validate_coerced_literal(name, start.value, start.var_type)
    registry = session.get("secret_registry")
    if registry is not None:
        _register_staged_secrets(registry, {instance.path: {name: checked}})
    session.setdefault("function_seed", {}).setdefault(instance.path, {})[name] = checked
    if start.kind != "literal":
        return {"name": name, "value": None, "pending": True}
    masked = bool(checked.get("secret"))
    return {
        "name": name,
        "value": _mask_session_value(start.value, masked, registry),
        "pending": False,
    }


def _hold_for_unstarted(
    session: dict[str, Any], function_path: Sequence[str], name: str, entry: dict[str, Any]
) -> dict[str, Any] | None:
    """Reply for a Current edit to an unstarted instance; None when the live write applies."""
    unstarted = _unstarted_instance(session, function_path)
    if unstarted is None:
        return None
    held = _seed_unstarted(session, unstarted, name, entry)
    return None if unstarted.path in (session.get("function_scopes") or {}) else held


def set_variable_override(
    session_id: str,
    name: str,
    *,
    value: Any | None = None,
    value_given: bool = False,
    expression: str | None = None,
    template: str | None = None,
    declared_type: str,
    element_types: list[str] | dict[str, str] | None = None,
    function_path: Sequence[str] = (),
) -> dict[str, Any]:
    """Apply a transient runtime override to one session variable (REQ-3.2.1.6)."""
    session = _get_session(session_id)
    if session is None:
        raise LookupError(f"Workbench session '{session_id}' not found")

    if session.get("status") == WorkbenchStatus.RUNNING.value:
        raise ConflictException(f"Cannot override variable '{name}' while the session is running")

    provided = [value_given, expression is not None, template is not None]
    if sum(provided) != 1:
        raise ValueError(
            "Override request must provide exactly one of 'value', 'expression', or 'template'"
        )

    held = _hold_for_unstarted(
        session,
        function_path,
        name,
        _seed_entry(value, expression, template, declared_type, element_types),
    )
    if held is not None:
        return held
    scope = _scope_at(session, function_path)
    _check_declared(scope, name, declared_type)
    variables = scope.variables

    if expression is not None or template is not None:
        source = (expression, declared_type) if expression is not None else cast(str, template)
        variables.give_source(name, source)
        if scope.kind == "test":
            _note_current_edit(session, name, source)
        return {"name": name, "value": None, "pending": True}

    coerced = None
    if value is not None:
        _refuse_value_problem(name, declared_value_problem(value, declared_type, element_types))
        coerced = realize_declared_value(value, declared_type, element_types)
        _validate_coerced_literal(name, coerced, declared_type)
    variables[name] = coerced
    if scope.kind == "test":
        _note_current_edit(session, name)
    full_path = (*(session.get("root_path") or ()), *function_path)
    _schedule_variable_change_push(session_id, name, coerced, full_path)

    registry = session.get("secret_registry")
    masked = _is_masked_name(session, name)
    return {"name": name, "value": _mask_session_value(coerced, masked, registry), "pending": False}
