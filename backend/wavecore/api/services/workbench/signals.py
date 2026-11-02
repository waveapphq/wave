"""Engine signal extraction and routing for workbench execution."""

from collections.abc import Collection, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from wavecore.api.services.workbench._common import (
    WorkbenchStatus,
    _add_execution_log,
)
from wavecore.api.services.workbench.block_status import (
    block_name_of,
    paint_skipped,
    skip_rest,
)
from wavecore.core.variables.atomic import session_variable_access
from wavecore.core.variables.decimal_value import to_wave_decimal
from wavecore.core.variables.usage import block_writes
from wavecore.models.enums import ControlId

# The innermost Function body's mark; unset means the mark lands on the run's root Test.
_function_scope_mark: ContextVar[dict[str, bool] | None] = ContextVar(
    "function_scope_mark", default=None
)


def mark_scope_failed(session: dict[str, Any]) -> None:
    """Mark the innermost enclosing Test or Function body failed."""
    mark = _function_scope_mark.get()
    (session if mark is None else mark)["scope_failed"] = True


@contextmanager
def function_scope() -> Iterator[dict[str, bool]]:
    """Open a Function body scope; marks made inside it, lanes included, land on its mark."""
    mark = {"scope_failed": False}
    token = _function_scope_mark.set(mark)
    try:
        yield mark
    finally:
        _function_scope_mark.reset(token)


def _extract_engine_signals(result: Any) -> dict[str, Any]:
    """Pop engine-consumed keys from a result dict and return them."""
    signals: dict[str, Any] = {
        "branch": None,
        "scope_failed": None,
        "try_catch": None,
        "enable_catch": True,
        "enable_finally": False,
        "halt": None,
        "halt_status": None,
        "halt_scope": None,
        "halt_message": None,
        "function_skipped": None,
        "block_warning": None,
        "for_loop": None,
        "loop_start": None,
        "loop_end": None,
        "loop_step": None,
        "loop_variable": None,
        "loop_break": None,
        "break_target": None,
        "loop_continue": None,
        "continue_target": None,
        "for_each": None,
        "collection": None,
        "item_variable": None,
        "index_variable": None,
        "timeout": None,
        "while_loop": None,
        "condition": None,
        "while_mode": None,
        "max_iterations": None,
        "switch": None,
        "switch_branches": None,
        "parallel": None,
        "parallel_branches": None,
        "join_mode": None,
        "parallel_time_limit": None,
        "wait_until": None,
        "wait_timeout": None,
        "check_interval": None,
        "wait_message": None,
        "wait_fail_scope": None,
        "remote_execution": None,
    }
    if not result or not isinstance(result, dict):
        return signals

    signals["branch"] = result.pop("__branch", None)
    signals["scope_failed"] = result.pop("__scope_failed", None)
    signals["try_catch"] = result.pop("__try_catch", None)
    signals["enable_catch"] = result.pop("__enable_catch", True)
    signals["enable_finally"] = result.pop("__enable_finally", False)
    signals["halt"] = result.pop("__halt", None)
    signals["halt_scope"] = result.pop("__halt_scope", None)
    signals["halt_status"] = result.pop("__halt_status", None)
    signals["halt_message"] = result.pop("__halt_message", None)
    signals["function_skipped"] = result.pop("__function_skipped", None)
    signals["block_warning"] = result.pop("__block_warning", None)
    signals["for_loop"] = result.pop("__for_loop", None)
    signals["loop_start"] = result.pop("__loop_start", None)
    signals["loop_end"] = result.pop("__loop_end", None)
    signals["loop_step"] = result.pop("__loop_step", None)
    signals["loop_variable"] = result.pop("__loop_variable", None)
    signals["loop_break"] = result.pop("__break", None)
    signals["break_target"] = result.pop("__break_target", None)
    signals["loop_continue"] = result.pop("__continue", None)
    signals["continue_target"] = result.pop("__continue_target", None)
    signals["for_each"] = result.pop("__for_each", None)
    signals["collection"] = result.pop("__collection", None)
    signals["item_variable"] = result.pop("__item_variable", None)
    signals["index_variable"] = result.pop("__index_variable", None)
    signals["timeout"] = result.pop("__timeout", None)
    signals["while_loop"] = result.pop("__while_loop", None)
    signals["condition"] = result.pop("__condition", None)
    signals["while_mode"] = result.pop("__mode", None)
    signals["max_iterations"] = result.pop("__max_iterations", None)
    signals["switch"] = result.pop("__switch", None)
    signals["switch_branches"] = result.pop("__switch_branches", None)
    signals["parallel"] = result.pop("__parallel", None)
    signals["parallel_branches"] = result.pop("__branches", None)
    signals["join_mode"] = result.pop("__join", None)
    signals["parallel_time_limit"] = result.pop("__time_limit", None)
    # The wait deadline rides its own key: signals["timeout"] is the loop
    # wall-clock limit and fails the session on expiry.
    signals["wait_until"] = result.pop("__wait_until", None)
    signals["wait_timeout"] = result.pop("__wait_timeout", None)
    signals["check_interval"] = result.pop("__check_interval", None)
    signals["wait_message"] = result.pop("__wait_message", None)
    signals["wait_fail_scope"] = result.pop("__wait_fail_scope", None)
    signals["remote_execution"] = result.pop("__remote_execution", None)
    drop_zero_run_item(signals, result)
    return signals


def drop_zero_run_item(signals: Mapping[str, Any], result: Any) -> None:
    """A For Each that ran zero times produced no item, so its placeholder never reaches the
    bound variable (REQ-3.5.1.16)."""
    if signals["for_each"] and not signals["collection"] and isinstance(result, dict):
        result.pop("item", None)


def consume_wait_status(session: dict[str, Any]) -> str | None:
    """Take the status a Wait Until left for the walker that dispatched it.

    A wait's outcome is only known after its rounds run, which is after the
    walker computed the node's status from the execute() result.
    """
    status: str | None = session.pop("_wait_status", None)
    return status


def resolve_post_execute_status(
    signals: dict[str, Any],
    session: dict[str, Any],
    node_type: str | None,
    element_type: str | None,
    result: Any,
) -> str:
    """Shared scope-fail/warning status clauses for the root and body walkers."""
    wait_status = consume_wait_status(session)
    if wait_status:
        return wait_status
    if signals.get("scope_failed"):
        mark_scope_failed(session)
        return "failed"
    if signals.get("block_warning"):
        return "warning"
    if (
        node_type == "control"
        and element_type == "assert"
        and result
        and isinstance(result, dict)
        and result.get("passed") is False
    ):
        return "warning"
    return "passed"


def resolve_nested_final_status(
    signals: dict[str, Any],
    session: dict[str, Any],
    node_type: str | None,
    element_type: str | None,
    result: Any,
) -> str:
    """The painted status of a node run inside a sub-flow, shared by every nested walker."""
    status = resolve_post_execute_status(signals, session, node_type, element_type, result)
    if status != "passed":
        return status
    if signals.get("halt"):
        return _halt_block_status(signals.get("halt_status"))
    if signals.get("function_skipped"):
        return WorkbenchStatus.SKIPPED.value
    return status


def _determine_block_status(
    signals: dict[str, Any],
    session: dict[str, Any],
    node_type: str | None,
    element_type: str | None,
    result: Any,
) -> str:
    """Determine the block status based on execution result and signals."""
    status = resolve_post_execute_status(signals, session, node_type, element_type, result)
    if status == "passed" and signals.get("function_skipped"):
        # An absorbed inner Halt(function/skipped) paints SKIP; the caller continues.
        return WorkbenchStatus.SKIPPED.value
    return status


_HALT_MAP: dict[str | None, tuple[str, str]] = {
    "passed": ("passed", WorkbenchStatus.PASSED.value),
    "skipped": ("warning", WorkbenchStatus.SKIPPED.value),
}


def _halt_block_status(halt_status: str | None) -> str:
    """Return the per-node block status for a Halt with the given halt_status.

    Pure mapping helper used by both the root engine (``_apply_halt_status``)
    and the Function/TryCatch body executor so the inner Halt node renders
    with the correct color per design REQ-3.5.1.14 (passed/Green;
    skipped/Amber; failed/Red - default).
    """
    block_status, _session_status = _HALT_MAP.get(
        halt_status, ("failed", WorkbenchStatus.FAILED.value)
    )
    return block_status


def _apply_halt_status(signals: dict[str, Any], session: dict[str, Any]) -> str:
    """Apply halt signal to session and return the block_status.

    Records the halt scope on the session so the terminal notification can
    forward it to the sequential orchestrator for suite/regression fan-out.
    """
    block_status, session_status = _HALT_MAP.get(
        signals["halt_status"], ("failed", WorkbenchStatus.FAILED.value)
    )
    session["status"] = session_status
    session["halt_scope"] = signals.get("halt_scope") or "test"
    session["halt_message"] = signals.get("halt_message")
    return block_status


def announced_writes(nf: Mapping[str, Any], bound: Collection[str] | None) -> set[str]:
    """The names a block's push carries even when unchanged, since a target can already
    hold the null it writes: its bound outputs and a Variable Setter's rows (REQ-3.1.3.12)."""
    setter = nf["element_type"] == ControlId.VARIABLE_SETTER
    rows = block_writes({"data": nf["node_data"]}) if setter else set()
    return {*(bound or ()), *rows}


def _assign_output_bindings(
    result: Any,
    output_bindings: dict[str, str],
    variables: dict[str, Any],
    session_id: str,
    block_name: str,
    node_id: str,
) -> set[str]:
    """Assign output bindings to variables (REQ-3.1.3.6, REQ-3.1.3.10).

    Returns the variable names written, which the push uses to emit for a write
    that landed on the value already stored (REQ-3.1.3.12).
    """
    written: set[str] = set()
    if not result or not isinstance(result, dict) or not output_bindings:
        return written
    from wavecore.api.services.workbench._common import _get_session

    # Every execution-path store goes through the run's access layer, so
    # concurrent branches share one guard per variable.
    access = session_variable_access(_get_session(session_id), variables)
    for output_name, var_name in output_bindings.items():
        if not var_name:
            continue
        if output_name in result:
            value = result[output_name]
            # A float output re-enters the exact-precision domain on capture, as
            # it does on assignment (REQ-3.1.3.14). Only a real float: a numeric
            # STRING output stays a string, or text handling breaks downstream.
            if isinstance(value, float):
                value = to_wave_decimal(value)
            access.assign(var_name, value)
            written.add(var_name)
            _add_execution_log(
                session_id,
                "DEBUG",
                f"'{block_name}' \u2192 {var_name}",
                "SYSTEM",
                block_id=node_id,
            )
    return written


async def _handle_halt_cleanup(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
) -> None:
    """Store and paint skipped the queued nodes a halt leaves behind and all they lead to."""
    left_behind = [*exec_queue, *(child_id for child_id, _h in adj.get(node_id, []))]
    exec_queue.clear()
    await skip_rest(left_behind, adj, node_map, session, session_id, executed)


def _enqueue_branch_successors(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    branch_key: str | None,
    executed: set[str],
    exec_queue: list[str],
) -> None:
    """Enqueue successor nodes based on branching result."""
    outgoing = adj.get(node_id, [])
    if branch_key is not None:
        for child_id, handle in outgoing:
            if (handle is None or handle == branch_key) and child_id not in executed:
                exec_queue.append(child_id)
    else:
        for child_id, _h in outgoing:
            if child_id not in executed:
                exec_queue.append(child_id)


_DIVERGING_ELEMENT_TYPES = frozenset({"if-else", "assert-split"})


def _is_diverging_parent(node_type: str | None, element_type: str | None) -> bool:
    """Return True for control elements with multiple non-'then' egress branches.

    The diverging set is fixed: ``if-else``, ``assert-split``. These cannot be
    skipped at runtime because there is no single fall-through path past the
    sub-graph; the user must step into a branch and skip a leaf instead.
    """
    if node_type != "control":
        return False
    return element_type in _DIVERGING_ELEMENT_TYPES


def _normalize_element_type(node: dict[str, Any] | None) -> str | None:
    """Normalize the engine's raw ``elementType`` for diverging-parent detection.

    The engine exposes ``elementType="switch-case"`` for Switch and
    ``elementType="assert"`` (with ``config.values.mode`` set to
    ``"single"``/``"split"``) for both assert variants. Skip routing and
    rejection messages use the canonical ``switch`` / ``assert-split`` /
    ``assert-single`` synonyms; other element types pass through unchanged.
    """
    if not node or not isinstance(node, dict):
        return None
    data = node.get("data", {}) or {}
    raw = data.get("elementType")
    if raw == "switch-case":
        return "switch"
    if raw == "assert":
        mode = (data.get("config", {}) or {}).get("values", {}).get("mode")
        # A mode left out runs on the declared default, split.
        return "assert-single" if mode == "single" else "assert-split"
    return raw


def _mark_node_skipped(
    node_id: str,
    skipped_node_ids: list[str],
    skipped_set: set[str],
    block_states: dict[str, str],
) -> None:
    """Add ``node_id`` to the skipped registry and mark its block state."""
    if node_id not in skipped_set:
        skipped_node_ids.append(node_id)
        skipped_set.add(node_id)
    block_states[node_id] = "skipped"


_THEN_EGRESS_ONLY = {
    "try-catch-finally",
    "for",
    "for-each",
    "while",
    "switch",
    "wait-until",
    "parallel",
}


def _if_else_first_branch_handle(node: dict[str, Any]) -> frozenset[str]:
    branches = (
        ((node.get("data") or {}).get("config") or {}).get("values", {}).get("branches")
    ) or []
    if not branches or not isinstance(branches, list):
        return frozenset()
    first = branches[0] if isinstance(branches[0], dict) else None
    first_id = first.get("id") if first is not None else None
    return frozenset({first_id}) if first_id else frozenset()


def _disabled_pass_through_handles(node: dict[str, Any]) -> frozenset[str] | None:
    """Return the source-handle set to KEEP (not cascade-skip) when ``node``
    is disabled/skipped at runtime.

    Returns ``None`` for single-egress nodes (no cascade needed - the lone
    child enqueues normally and trivially acts as the pass-through).

    Returns an empty frozenset when no branch is the pass-through (cascade
    every non-'then' descendant). ``'then'`` is always implicitly kept by
    ``_cascade_skip_under_parent``.

    Keep this matrix in sync with the frontend mirror in
    ``frontend/src/features/workbench/common/canvas/workflow-node/use-node-actions.ts:disabledPassThroughHandles``.
    """
    node_type = (node.get("data") or {}).get("nodeType")
    if node_type != "control":
        return None
    element_type = _normalize_element_type(node)
    if element_type == "assert-split":
        return frozenset({"pass"})
    if element_type in _THEN_EGRESS_ONLY:
        return frozenset()
    if element_type == "if-else":
        return _if_else_first_branch_handle(node)
    # Single-egress control - the lone child enqueue is the pass-through.
    return None


async def skip_disabled_block(
    node: dict[str, Any],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]] | None,
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
) -> None:
    """Store and paint a disabled or runtime-skipped block skipped, with every block it mutes."""
    for block_id in [node_id, *_cascade_skip_disabled_branches(session, adj, node, node_id)]:
        await paint_skipped(session, session_id, block_id, block_name_of(node_map, block_id))


def _cascade_skip_disabled_branches(
    session: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]] | None,
    node: dict[str, Any],
    node_id: str,
) -> list[str]:
    """Disabled/skipped multi-egress short-circuit. Single source of truth
    used by both the root engine (``execution.py:_process_workflow_node``)
    and the Function / TryCatch body walker
    (``try_catch.py:_execute_single_path_node``).

    If ``node`` is a diverging or scoped control with pass-through routing,
    cascade-skip its non-pass-through descendants so they render as
    ``skipped`` instead of running. No-op for single-egress nodes (the
    caller's plain child-enqueue already provides the pass-through). Returns the cascaded ids.
    """
    if adj is None:
        return []
    keep_handles = _disabled_pass_through_handles(node)
    if keep_handles is None:
        return []
    return _cascade_skip_under_parent(session, adj, node_id, keep_handles=keep_handles)


def _cascade_skip_under_parent(
    session: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    parent_node_id: str,
    keep_handles: frozenset[str] | None = None,
) -> list[str]:
    """Mark every non-'then' descendant of ``parent_node_id`` as skipped.

    Walks the adjacency list breadth-first starting from each non-'then'
    child of the parent, transitively marking each visited node in
    ``block_states`` AND ``skipped_node_ids`` so the engine's skip path
    fires when the runtime traverses each one. The parent's ``then``
    egress is the boundary: nodes reachable only via that branch are
    NOT skipped because that is the path the engine pauses on after the
    skip resolves.

    If ``keep_handles`` is provided, children reachable via any of those
    source handles are ALSO excluded (they act as a pass-through branch
    for a disabled diverging parent - e.g. Assert(split) keeps "pass").
    Returns the cascaded ids in walk order.
    """
    skipped_node_ids = list(session.get("skipped_node_ids") or [])
    skipped_set = set(skipped_node_ids)
    block_states = session.get("block_states") or {}
    cascaded: set[str] = session.setdefault("_cascaded_skip_node_ids", set())
    visited: set[str] = {parent_node_id}
    walked: list[str] = []

    def _is_excluded(handle: str | None) -> bool:
        if handle == "then":
            return True
        if keep_handles and handle in keep_handles:
            return True
        return False

    queue: list[str] = [
        child_id
        for child_id, handle in adj.get(parent_node_id, [])
        if not _is_excluded(handle) and child_id not in visited
    ]

    while queue:
        node_id = queue.pop(0)
        if node_id in visited:
            continue
        _mark_node_skipped(node_id, skipped_node_ids, skipped_set, block_states)
        cascaded.add(node_id)
        visited.add(node_id)
        walked.append(node_id)
        queue.extend(
            grandchild_id
            for grandchild_id, _handle in adj.get(node_id, [])
            if grandchild_id not in visited
        )

    session["skipped_node_ids"] = skipped_node_ids
    session["block_states"] = block_states
    return walked
