"""Function invocation executor.

Implements the Function invocation pipeline:

1. The Function Block resolves its fields through the shared Block run path; the
   executor receives the filled values (``inputs``).
2. Establish a fresh runtime scope - declared inputs populated by value
   and exposed by bare name (no ``input.`` prefix), declared output
   defaults applied, fresh local-variable space.
3. Run the Function flow on the engine of the live run session, from ``start-node``.
4. Collect declared outputs into a result document and return it.

The executor never changes the outer flow. The workbench run shim
(``services/workbench/functions.py``) applies the Function Block's output
bindings after the run.
"""

from __future__ import annotations

import logging
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any, Self, cast

from wavecore.core.expressions.errors import (
    ExpressionEvaluationError,
    NullValueError,
    null_failure_message,
)
from wavecore.core.functions.declarations import is_enum_input
from wavecore.core.variables.declared_types import declared_type_scope, types_of_function
from wavecore.core.variables.declared_values import DeclaredStart, declared_start
from wavecore.core.variables.element_types import realize_declared_value
from wavecore.core.variables.usage import computed_declarations, cycle_message, cycle_path

logger = logging.getLogger(__name__)


@dataclass
class FunctionInvocationResult:
    """Result document from a Function invocation."""

    status: str  # "passed" | "failed"
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    # The run was refused before its Function flow's first Block ran (an input that cannot bind).
    stopped_before_body: bool = False
    advisory: str | None = None
    logs: list[dict[str, Any]] = field(default_factory=list)
    # Halt re-emission: populated when an inner Halt control fired during
    # the body walk. The workbench shim re-emits these as `__halt` /
    # `__halt_scope` / `__halt_status` / `__halt_message` so the parent
    # engine's halt machinery (extract_signals + apply_halt_status +
    # handle_halt_cleanup) drains the outer flow's queue. Halt is the ONLY
    # signal that crosses the Function boundary as a drain - plain block
    # failures stay block-level (Function reports failed, parent continues
    # with siblings).
    halt_scope: str | None = None
    halt_status: str | None = None
    halt_message: str | None = None


_ADVISORY_NO_PRIOR_STATE = (
    "Clean scope state - the Function ran with declared default values for "
    "its inputs (no prior Test run to inherit from)."
)


@dataclass(frozen=True)
class BodyEntry:
    """Where a body walk starts: the whole body, one node's sub-tree, or one node onward."""

    single_node_id: str | None = None
    start_node_id: str | None = None


def new_runtime_scope() -> dict[str, Any]:
    """An empty runtime scope that can hold an Expression or Template value until it is read."""
    from wavecore.api.services.workbench.lazy_variables import LazyVariables

    return cast(dict[str, Any], LazyVariables())


@dataclass(frozen=True)
class ScopedStart:
    """What a drilled-in invocation starts from (REQ-3.2.1.1, REQ-3.1.2.10, REQ-3.2.1.6).

    ``outer_ran`` says the flow holding the instance ran, so its Function Block's fields
    were resolved over that flow's last state; ``refusal`` is why resolving them, or a
    Current value, failed before the run.
    """

    scope: dict[str, Any] = field(default_factory=new_runtime_scope)
    restored: bool = False
    outer_ran: bool = False
    input_values: Mapping[str, Any] = field(default_factory=dict)
    staged: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    refusal: str | None = None

    def changed(self, **changes: Any) -> Self:
        """A copy of the start with the given fields changed."""
        return type(self)(**{**vars(self), **changes})

    @property
    def clean(self) -> bool:
        """Nothing earlier to start from: no restored scope, no outer state, no given values."""
        return not self.restored and not self.outer_ran and not self.input_values


def _declared_default(declared: Mapping[str, Any]) -> Any:
    """A parameter's declared default realized as its type (REQ-3.1.3.19)."""
    return realize_declared_value(
        declared.get("default"), str(declared.get("type") or ""), declared.get("elementTypes")
    )


def _refuses_null(declared: Mapping[str, Any]) -> bool:
    """An input takes null only when it is optional with no default (REQ-3.1.3.21)."""
    return bool(declared.get("required")) or declared.get("default") is not None


def _input_value_type(declared: Mapping[str, Any]) -> str:
    """An input holds a value of its own type; an enum input one of its allowed values."""
    return str(declared.get("type") or "")


def _build_input_namespace(
    function_def: Mapping[str, Any],
    inputs: Mapping[str, Any],
    *,
    run_alone: bool,
    held: Mapping[str, Any],
) -> dict[str, Any]:
    """The declared inputs by value for the Function flow's flat bare-name scope."""
    namespace: dict[str, Any] = {}
    for declared in function_def.get("inputs") or []:
        name = declared.get("name") if isinstance(declared, Mapping) else None
        if isinstance(name, str):
            namespace[name] = _input_value(declared, name, inputs, held, run_alone=run_alone)
    return namespace


def _input_value(
    declared: Mapping[str, Any],
    name: str,
    inputs: Mapping[str, Any],
    held: Mapping[str, Any],
    *,
    run_alone: bool,
) -> Any:
    """The value one declared input holds when the Function flow starts, or the null refusal."""
    if name not in inputs:
        takes_default = run_alone and declared.get("default") is not None
        if declared.get("required") and name not in held and not takes_default:
            raise NullValueError(null_failure_message(name))
        return _declared_default(declared)
    value = inputs[name]
    if value is None and _refuses_null(declared):
        raise NullValueError(null_failure_message(name))
    if is_enum_input(declared):
        return realize_declared_value(value, _input_value_type(declared))
    return value


def _refuse_held_nulls(
    declared_inputs: list[Mapping[str, Any]], scope: Mapping[str, Any], unbound: Collection[str]
) -> None:
    """A null the scope holds for an input that refuses null fails as a given one (REQ-3.1.3.21)."""
    realized = dict(scope)
    for declared in declared_inputs:
        name = declared.get("name") if isinstance(declared, Mapping) else None
        if isinstance(name, str) and name in unbound and realized.get(name, ...) is None:
            if _refuses_null(declared):
                raise NullValueError(null_failure_message(name))


def _is_computed(declared: Mapping[str, Any]) -> bool:
    return bool(declared.get("isExpression") or declared.get("isTemplate"))


def _initial_outputs(declared_outputs: list[Mapping[str, Any]]) -> dict[str, Any]:
    """Seed the result outputs map with declared defaults; a computed output stays pending."""
    outputs: dict[str, Any] = {}
    for declared in declared_outputs:
        if not isinstance(declared, Mapping) or _is_computed(declared):
            continue
        name = declared.get("name")
        if not isinstance(name, str):
            continue
        if "default" in declared:
            outputs[name] = _declared_default(declared)
    return outputs


def _build_adjacency(edges: list[Mapping[str, Any]]) -> dict[str, list[tuple[str, str | None]]]:
    adj: dict[str, list[tuple[str, str | None]]] = {}
    for edge in edges:
        source = str(edge.get("source", ""))
        target = str(edge.get("target", ""))
        handle = edge.get("sourceHandle")
        adj.setdefault(source, []).append((target, handle))
    return adj


def _gather_log_outputs(plugin_id: str, resolved_params: Mapping[str, Any]) -> dict[str, Any]:
    """Return synthetic outputs a plugin exposes for binding.

    The log plugin exposes the rendered message as ``line`` - it is the only
    side effect the plugin produces, and Function bodies need a way to capture
    it. Plugins whose ``output_schema`` declares named outputs surface them
    through the plugin's own return value (handled by the engine path); this
    helper just covers the log case.
    """
    if plugin_id == "log":
        message = resolved_params.get("message")
        if message is None:
            return {}
        return {"line": message}
    return {}


async def _walk_body(
    function_def: Mapping[str, Any],
    local_vars: dict[str, Any],
    input_namespace: Mapping[str, Any],
    function_outputs: dict[str, Any],
    declared_output_names: set[str],
    session_id: str,
    entry: BodyEntry | None = None,
) -> tuple[dict[str, Any] | None, bool]:
    """BFS the body graph from ``start-node`` (or ``entry``) on the run session's engine.

    Every node goes through the workbench engine's per-node executor, so the body
    supports arbitrary controls (Halt, If/Else, For, ForEach, While, TryCatch, ...)
    with their full signal contract (halt, break, continue, branch, loops), status
    broadcasts, and log streaming. A Function flow runs only on a live run session.

    Returns ``(captured_halt, body_scope_failed)``:
    - ``captured_halt`` is ``None`` unless an inner Halt control fired;
      otherwise a dict with ``halt_scope`` / ``halt_status`` /
      ``halt_message`` so the workbench shim can re-emit ``__halt`` to
      the parent engine.
    - ``body_scope_failed`` is ``True`` when a block anywhere in the body
      marked the Function's scope failed; the Function then reports failed.
    """
    from wavecore.api.services.workbench._common import _workbench_sessions

    workflow = function_def.get("workflow") or {}
    nodes = [n for n in (workflow.get("nodes") or []) if isinstance(n, Mapping)]
    edges = [e for e in (workflow.get("edges") or []) if isinstance(e, Mapping)]
    node_map: dict[str, Mapping[str, Any]] = {str(n.get("id", "")): n for n in nodes}
    return await _walk_body_with_engine(
        node_map=node_map,
        adj=_build_adjacency(edges),
        local_vars=local_vars,
        input_namespace=input_namespace,
        function_outputs=function_outputs,
        declared_output_names=declared_output_names,
        session=_workbench_sessions[session_id],
        session_id=session_id,
        entry=entry,
    )


def _is_workflow_node(node: Mapping[str, Any] | None) -> bool:
    return node is not None and node.get("type") == "workflowNode"


def _capture_halt(session: dict[str, Any]) -> dict[str, Any]:
    halt_scope = session.get("halt_scope") or "test"
    captured = {
        "halt_scope": halt_scope,
        "halt_status": session.get("status"),
        "halt_message": session.get("halt_message"),
    }
    session.pop("_halt", None)
    if halt_scope == "function":
        # Absorb at the innermost Function boundary so the halt never drains past it.
        from wavecore.api.services.workbench._common import WorkbenchStatus

        session["status"] = WorkbenchStatus.RUNNING.value
        session.pop("halt_scope", None)
        session.pop("halt_message", None)
    return captured


def _consume_loop_signal(session: dict[str, Any]) -> bool:
    """Pop a body-level break/continue signal. Returns True if one fired."""
    if session.get("_loop_signal") not in ("break", "continue"):
        return False
    session.pop("_loop_signal", None)
    session.pop("_loop_signal_target", None)
    return True


def _enqueue_unexecuted_children(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    executed: set[str],
    queue: list[str],
) -> None:
    from wavecore.api.services.workbench.try_catch import _has_control_handles

    children = adj.get(node_id, [])
    # A container runs its own lanes (zero times included); the walk goes on by its then egress.
    egress_only = _has_control_handles(children)
    for child, handle in children:
        if child not in executed and (handle == "then" or not egress_only):
            queue.append(child)


def _seed_engine_scope(
    local_vars: dict[str, Any],
    input_namespace: Mapping[str, Any],
    function_outputs: dict[str, Any],
    declared_output_names: set[str],
) -> None:
    """Expose declared inputs + outputs as top-level names in ``local_vars``.

    Inputs use their filled value; every declared output is seeded
    (its default or ``None``) so body nodes can assign it by name without the
    Var Setter tripping on "Variable 'X' is not declared". Flat scope (no
    ``input.`` namespace) matches canvas autocomplete + FE validation.
    """
    for input_name, value in input_namespace.items():
        if input_name not in local_vars:
            local_vars[input_name] = value
    for output_name in declared_output_names:
        if output_name not in local_vars:
            local_vars[output_name] = function_outputs.get(output_name)


async def _walk_body_with_engine(
    *,
    node_map: dict[str, Mapping[str, Any]],
    adj: dict[str, list[tuple[str, str | None]]],
    local_vars: dict[str, Any],
    input_namespace: Mapping[str, Any],
    function_outputs: dict[str, Any],
    declared_output_names: set[str],
    session: dict[str, Any],
    session_id: str,
    entry: BodyEntry | None = None,
) -> tuple[dict[str, Any] | None, bool]:
    """Drive each body node through the engine's per-node helper.

    Uses ``_execute_single_path_node`` from the try-catch path executor,
    which handles plugin + control dispatch, signal extraction, status
    broadcasts, and recursive nested-control support (when ``adj`` is
    passed). Branches and loops are dispatched via
    ``dispatch_nested_signals`` inside that helper.

    Returns ``(captured_halt, body_scope_failed)`` - see ``_walk_body``.
    """
    from wavecore.api.services.workbench.signals import function_scope

    _seed_engine_scope(local_vars, input_namespace, function_outputs, declared_output_names)
    session.setdefault("block_states", {})
    session.setdefault("_body_nodes", {}).update(node_map)
    with function_scope() as mark:
        captured_halt = await _drain_body_queue(
            node_map, adj, local_vars, session, session_id, entry or BodyEntry()
        )
    _collect_declared_outputs(local_vars, function_outputs, declared_output_names)
    return captured_halt, mark["scope_failed"]


async def _drain_body_queue(
    node_map: dict[str, Mapping[str, Any]],
    adj: dict[str, list[tuple[str, str | None]]],
    local_vars: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    entry: BodyEntry,
) -> dict[str, Any] | None:
    """Run the body's nodes in order; returns the captured halt, raising a node's failure."""
    from wavecore.api.services.workbench._common import _complete_step_over, entry_adjacency
    from wavecore.api.services.workbench.try_catch import (
        _execute_single_path_node,
    )

    adj = entry_adjacency(entry.single_node_id, adj, node_map)
    first = entry.single_node_id or entry.start_node_id
    # `executed` is the single source of truth for "this node has run". It
    # is shared with `_execute_single_path_node` and its nested-dispatch
    # helpers, all of which add to it. Using a separate `visited` set was
    # the source of a double-execute bug on Assert(split) inside a Function
    # body.
    queue: list[str] = (
        [first] if first is not None else [target for target, _h in adj.get("start-node", [])]
    )
    executed: set[str] = set()

    while queue:
        node_id = queue.pop(0)
        if node_id in executed:
            continue
        node = node_map.get(node_id)
        if not _is_workflow_node(node):
            executed.add(node_id)
            _enqueue_unexecuted_children(node_id, adj, executed, queue)
            continue

        error = await _execute_single_path_node(
            node_id,
            {nid: dict(n) for nid, n in node_map.items()},
            local_vars,
            session,
            session_id,
            executed,
            environment_id=session.get("environment_id") or "",
            adj=adj,
        )
        if error is not None:
            await _skip_body_rest(node_id, queue, adj, node_map, session, session_id, executed)
            raise error

        _complete_step_over(session, node_id)

        signal_outcome = _process_post_node_signals(session)
        if signal_outcome.stopped:
            return None
        if signal_outcome.halt is not None or signal_outcome.loop_terminated:
            await _skip_body_rest(node_id, queue, adj, node_map, session, session_id, executed)
            return signal_outcome.halt

        _enqueue_unexecuted_children(node_id, adj, executed, queue)
    return None


async def _skip_body_rest(
    node_id: str,
    queue: list[str],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Mapping[str, Any]],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Store and paint skipped what a failure or a signal at ``node_id`` cut off in the body."""
    from wavecore.api.services.workbench.block_status import skip_rest

    left_behind = [*queue, *(child for child, _handle in adj.get(node_id, []))]
    await skip_rest(left_behind, adj, node_map, session, session_id, executed)


@dataclass
class _PostNodeSignals:
    halt: dict[str, Any] | None
    stopped: bool
    loop_terminated: bool


def _process_post_node_signals(session: dict[str, Any]) -> _PostNodeSignals:
    from wavecore.api.services.workbench._common import WorkbenchStatus

    halt = _capture_halt(session) if session.get("_halt") else None
    stopped = session.get("status") == WorkbenchStatus.STOPPED.value
    loop_terminated = _consume_loop_signal(session)
    return _PostNodeSignals(halt=halt, stopped=stopped, loop_terminated=loop_terminated)


def _read_output(local_vars: dict[str, Any], output_name: str) -> Any:
    """An output's value; a computed one no block wrote is evaluated here (REQ-3.1.2.8)."""
    try:
        return local_vars[output_name]
    except NullValueError:
        raise
    except ExpressionEvaluationError as exc:
        raise ExpressionEvaluationError(
            f"Output '{output_name}': {exc}", exc.expression, exc.reason
        ) from exc


def _collect_declared_outputs(
    local_vars: dict[str, Any],
    function_outputs: dict[str, Any],
    declared_output_names: set[str],
) -> None:
    for output_name in declared_output_names:
        if output_name in local_vars:
            function_outputs[output_name] = _read_output(local_vars, output_name)


async def execute_function(
    *,
    function_def: Mapping[str, Any],
    inputs: Mapping[str, Any] | None,
    session_id: str,
    scope: dict[str, Any] | None = None,
    entry: BodyEntry | None = None,
    staged: Mapping[str, Mapping[str, Any]] | None = None,
    run_alone: bool = False,
) -> FunctionInvocationResult:
    """Run a Function flow once from its filled inputs (REQ-3.1.2.10)."""
    held = dict(scope or {})
    try:
        state = _prepare_invocation_state(
            function_def=function_def,
            inputs=inputs or {},
            scope=scope,
            staged=staged or {},
            run_alone=run_alone,
        )
    except (ExpressionEvaluationError, ValueError) as exc:
        return FunctionInvocationResult(
            status="failed", outputs={}, error=str(exc), stopped_before_body=True
        )

    from wavecore.api.services.workbench.functions import register_function_secrets

    register_function_secrets(session_id, function_def, state.input_namespace)
    restored = {name: value for name, value in held.items() if name not in state.given}
    await _push_initial_scope(session_id, state, restored)

    try:
        with declared_type_scope(types_of_function(function_def)):
            captured_halt, body_scope_failed = await _walk_body(
                function_def,
                state.local_vars,
                state.input_namespace,
                state.function_outputs,
                state.declared_output_names,
                session_id,
                entry,
            )
    except Exception as exc:
        logger.debug("Function '%s' body failed: %s", function_def.get("name"), exc)
        return FunctionInvocationResult(status="failed", outputs={}, error=str(exc))

    return _build_invocation_result(state.function_outputs, captured_halt, body_scope_failed)


@dataclass
class _InvocationState:
    declared_output_names: set[str]
    input_namespace: dict[str, Any]
    function_outputs: dict[str, Any]
    local_vars: dict[str, Any]
    seeded_locals: frozenset[str]
    given: frozenset[str] = frozenset()


def _arm(scope: dict[str, Any], name: str, start: DeclaredStart) -> bool:
    """Arm an Expression / Template start to evaluate at its first read; False for a literal."""
    armable = cast(Any, scope)
    if start.kind == "expression":
        armable.set_expression(name, start.value, start.var_type)
        return True
    if start.kind == "template":
        armable.set_template(name, start.value)
        return True
    return False


def _seed_local_variables(function_def: Mapping[str, Any], scope: dict[str, Any]) -> frozenset[str]:
    """Give each declared local variable ``scope`` does not hold its declared value.

    Returns the names seeded: they hold their definition's value, not one a block gave.
    """
    seeded: set[str] = set()
    for declared in function_def.get("variables") or []:
        if not isinstance(declared, Mapping):
            continue
        name = declared.get("name")
        if not isinstance(name, str) or not name or name in scope:
            continue
        seeded.add(name)
        start = declared_start(declared)
        if not _arm(scope, name, start):
            scope.setdefault(name, start.value)
    return frozenset(seeded)


def _layer_staged_values(
    function_def: Mapping[str, Any], scope: dict[str, Any], staged: Mapping[str, Mapping[str, Any]]
) -> None:
    """A Current value set before the run replaces a local's or an output's Initial value."""
    for name in _declared_names(function_def, ("variables", "outputs")):
        entry = staged.get(name)
        if entry is None:
            continue
        start = declared_start(entry)
        if not _arm(scope, name, start):
            scope[name] = start.value


def _declared_names(function_def: Mapping[str, Any], keys: tuple[str, ...]) -> list[str]:
    """The names a Function declares under ``keys``, in order; a malformed entry names none."""
    return [
        declared["name"]
        for key in keys
        for declared in function_def.get(key) or []
        if isinstance(declared, Mapping) and isinstance(declared.get("name"), str)
    ]


def _arm_computed_outputs(declared_outputs: list[Any], scope: dict[str, Any]) -> None:
    """A computed output ``scope`` does not hold waits for its first read or the return."""
    for declared in declared_outputs:
        name = declared.get("name") if isinstance(declared, Mapping) else None
        if isinstance(name, str) and name not in scope:
            _arm(scope, name, declared_start(declared, "default"))


def _given_inputs(
    declared_inputs: list[Mapping[str, Any]], values: Mapping[str, Any]
) -> dict[str, Any]:
    """The values among ``values`` that name a declared input, each as the input's type."""
    given: dict[str, Any] = {}
    for declared in declared_inputs:
        name = declared.get("name") if isinstance(declared, Mapping) else None
        if isinstance(name, str) and name in values:
            given[name] = realize_declared_value(
                values[name], str(declared.get("type") or ""), declared.get("elementTypes")
            )
    return given


def _refuse_a_cycle(function_def: Mapping[str, Any]) -> None:
    """A computed output or local that reads itself stops the run before it starts."""
    loop = cycle_path(computed_declarations(function_def))
    if loop is not None:
        raise ExpressionEvaluationError(cycle_message(loop), "", "circular_dependency")


def _prepare_invocation_state(
    *,
    function_def: Mapping[str, Any],
    inputs: Mapping[str, Any],
    scope: dict[str, Any] | None,
    staged: Mapping[str, Mapping[str, Any]],
    run_alone: bool,
) -> _InvocationState:
    _refuse_a_cycle(function_def)
    scope = new_runtime_scope() if scope is None else scope
    declared_inputs = list(function_def.get("inputs") or [])
    given = _given_inputs(declared_inputs, inputs)
    for name in given:
        scope.pop(name, None)
    held = {name for name in _input_names(declared_inputs) if name in scope}
    _refuse_held_nulls(declared_inputs, scope, held)
    input_namespace = _build_input_namespace(function_def, given, run_alone=run_alone, held=scope)
    declared_outputs = list(function_def.get("outputs") or [])
    declared_output_names: set[str] = {
        str(out.get("name"))
        for out in declared_outputs
        if isinstance(out, Mapping) and isinstance(out.get("name"), str)
    }
    _layer_staged_values(function_def, scope, staged)
    seeded_locals = _seed_local_variables(function_def, scope)
    _arm_computed_outputs(declared_outputs, scope)
    return _InvocationState(
        declared_output_names=declared_output_names,
        input_namespace=input_namespace,
        function_outputs=_initial_outputs(declared_outputs),
        local_vars=scope,
        seeded_locals=seeded_locals,
        given=frozenset(given),
    )


def _input_names(declared_inputs: list[Mapping[str, Any]]) -> list[str]:
    return [
        name
        for declared in declared_inputs
        if isinstance(declared, Mapping) and isinstance(name := declared.get("name"), str)
    ]


async def _push_initial_scope(
    session_id: str, state: _InvocationState, restored: Mapping[str, Any]
) -> None:
    """Tell a drilled-in Variable Manager the values the body starts with (REQ-3.1.3.12)."""
    initial_scope: dict[str, Any] = dict(state.input_namespace)
    for name, value in state.function_outputs.items():
        initial_scope.setdefault(name, value)
    for name, value in state.local_vars.items():
        # A local variable seeded from its definition has no value of its own to announce.
        if name not in state.seeded_locals:
            initial_scope.setdefault(name, value)
    initial_scope.update(restored)
    try:
        from wavecore.api.services.workbench._common import _push_variable_changes

        await _push_variable_changes(session_id, {}, initial_scope)
    except Exception:  # pragma: no cover - defensive: WS never blocks exec
        pass


def _build_invocation_result(
    function_outputs: dict[str, Any],
    captured_halt: dict[str, Any] | None,
    body_scope_failed: bool,
) -> FunctionInvocationResult:
    if captured_halt is not None:
        halt_status = captured_halt["halt_status"]
        block_status = "passed" if halt_status in ("passed", "skipped") else "failed"
        return FunctionInvocationResult(
            status=block_status,
            outputs=function_outputs,
            halt_scope=captured_halt["halt_scope"],
            halt_status=halt_status,
            halt_message=captured_halt["halt_message"],
        )
    if body_scope_failed:
        return FunctionInvocationResult(status="failed", outputs=function_outputs)
    return FunctionInvocationResult(status="passed", outputs=function_outputs)


async def execute_scoped_function(
    *,
    function_def: Mapping[str, Any],
    start: ScopedStart | None = None,
    session_id: str,
    entry: BodyEntry | None = None,
) -> FunctionInvocationResult:
    """Run a Function once for a drilled-in ad-hoc run (REQ-3.1.2.10, REQ-3.2.1.5)."""
    start = start or ScopedStart()
    if start.refusal is not None:
        result = FunctionInvocationResult(
            status="failed", outputs={}, error=start.refusal, stopped_before_body=True
        )
    else:
        result = await execute_function(
            function_def=function_def,
            inputs=start.input_values,
            session_id=session_id,
            scope=start.scope,
            entry=entry,
            staged=start.staged,
            run_alone=True,
        )
    if start.clean:
        result.advisory = _ADVISORY_NO_PRIOR_STATE
    return result
