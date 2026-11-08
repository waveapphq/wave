"""Try/catch/finally path execution for workbench workflow engine."""

import asyncio
from datetime import UTC, datetime
from typing import Any

from wavecore.api.services.log_streaming_service import scrub_message
from wavecore.api.services.workbench._common import (
    BlockAttempt,
    NodeStep,
    WorkbenchStatus,
    _add_execution_log,
    _broadcast_event,
    _complete_step_over,
    _push_single_variable_change,
    _push_variable_changes,
    logger,
    park_while_held,
    run_debug_block,
)
from wavecore.api.services.workbench.block_status import (
    leave_by_then,
    skip_lanes_not_run,
    skip_rest,
)
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.api.services.workbench.plugins import (
    _inject_profile_variables,
)

_CONTROL_HANDLES = frozenset({"body", "try", "catch", "finally", "retry", "then"})


def _has_control_handles(children: list[tuple[str, str | None]]) -> bool:
    """Check if children list contains control structure handles."""
    return any(h in _CONTROL_HANDLES for _, h in children if h is not None)


def _find_next_chain_node(
    children: list[tuple[str, str | None]],
    is_control: bool,
    executed: set[str],
    visited: set[str],
) -> str | None:
    """Find the next node to trace, following egress for control nodes."""
    if is_control:
        for child_id, handle in children:
            if handle == "then" and child_id not in executed and child_id not in visited:
                return child_id
    else:
        for child_id, _handle in children:
            if child_id not in executed and child_id not in visited:
                return child_id
    return None


def _trace_path_chain(
    start_node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    executed: set[str],
) -> list[str]:
    """Trace a dead-end chain from a starting node.

    When a control node with structured handles (body/try/catch/then) is
    encountered, the chain follows the "then" (egress) handle only - the
    control's dispatch logic handles its other children at execution time.
    """
    chain: list[str] = []
    current: str | None = start_node_id
    visited: set[str] = set()
    while current and current not in visited:
        visited.add(current)
        node = node_map.get(current)
        if not node or node.get("type") != "workflowNode":
            break
        chain.append(current)
        children = adj.get(current, [])
        if not children:
            break
        current = _find_next_chain_node(children, _has_control_handles(children), executed, visited)
    return chain


def _strip_engine_keys(result: Any) -> None:
    """Remove engine-consumed keys from a result dict (in-place)."""
    if not result or not isinstance(result, dict):
        return
    for key in (
        "__branch",
        "__scope_failed",
        "__test_failed",
        "__halt",
        "__halt_scope",
        "__halt_status",
        "__halt_message",
        "__try_catch",
        "__block_warning",
        "__enable_catch",
        "__enable_finally",
        "__for_loop",
        "__loop_start",
        "__loop_end",
        "__loop_step",
        "__loop_variable",
        "__break",
        "__break_target",
        "__continue",
        "__continue_target",
        "__for_each",
        "__collection",
        "__item_variable",
        "__index_variable",
        "__timeout",
        "__switch",
        "__switch_branches",
        "__parallel",
        "__branches",
        "__join",
        "__time_limit",
        "__remote_execution",
    ):
        result.pop(key, None)


def _apply_path_output_bindings(
    result: Any,
    output_bindings: dict[str, str],
    variables: dict[str, Any],
) -> set[str]:
    """Apply output bindings from a path node result; returns the names written."""
    written: set[str] = set()
    if not result or not isinstance(result, dict) or not output_bindings:
        return written
    for out_name, var_name in output_bindings.items():
        if var_name and out_name in result:
            variables[var_name] = result[out_name]
            written.add(var_name)
    return written


async def _mark_node_running(
    session: dict[str, Any],
    session_id: str,
    path_node_id: str,
    block_name: str,
    executed: set[str],
) -> None:
    executed.add(path_node_id)
    session["block_states"][path_node_id] = "running"
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": path_node_id,
            "block_name": block_name,
            "status": "running",
        },
    )


async def _record_node_failure(
    session: dict[str, Any],
    session_id: str,
    path_node_id: str,
    block_name: str,
    exc: BaseException,
    walker: str = "Try-catch path",
) -> None:
    """Mark the node failed, log the failure and paint it."""
    message = scrub_message(session_id, str(exc), "SYSTEM", block_id=path_node_id)
    logger.error("%s node %s failed: %s", walker, path_node_id, message)
    session["block_states"][path_node_id] = "failed"
    _add_execution_log(
        session_id,
        "ERROR",
        f"Block '{block_name}' failed: {exc}",
        "SYSTEM",
        block_id=path_node_id,
    )
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": path_node_id,
            "block_name": block_name,
            "status": "failed",
        },
    )


class _PathStep(NodeStep):
    """A node on a Try/Catch path, a Parallel lane, a Switch case or a Function body."""

    async def run(self, attempt: BlockAttempt) -> str:
        return await _run_path_node(self, attempt.executed)


async def _execute_single_path_node(
    path_node_id: str,
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
) -> Exception | None:
    """Execute one path node. Returns exception on failure, None on success.

    When adj is provided, control nodes (For, ForEach, TryCatch, Halt, etc.)
    are dispatched recursively, enabling arbitrary nesting.
    """
    node = node_map.get(path_node_id)
    if not node:
        return None

    nf = _extract_node_fields(node)
    step = _PathStep(
        path_node_id,
        node,
        nf,
        node_map,
        variables,
        session,
        session_id,
        executed,
        environment_id,
        adj,
    )
    block = step.debug_block()
    attempt = await run_debug_block(block)
    if attempt is None or attempt.error is None:
        return None
    await _record_node_failure(session, session_id, path_node_id, nf["block_name"], attempt.error)
    return attempt.error


async def _run_path_node(step: _PathStep, executed: set[str]) -> str:
    """Run a path node past its debugger gate and return its status; raises when it fails."""
    from wavecore.api.services.workbench.nested import dispatch_nested_signals
    from wavecore.api.services.workbench.signals import (
        _assign_output_bindings,
        _extract_engine_signals,
        announced_writes,
        consume_wait_status,
        resolve_nested_final_status,
    )

    path_node_id, nf, adj = step.node_id, step.nf, step.adj
    session, session_id, variables = step.session, step.session_id, step.variables
    block_name = nf["block_name"]
    await _mark_node_running(session, session_id, path_node_id, block_name, executed)

    profile_bindings = nf["node_data"].get("config", {}).get("profileBindings", [])
    if profile_bindings:
        _inject_profile_variables(
            profile_bindings, variables, step.environment_id or "", session_id, block_name
        )
    vars_before = variables.copy()
    result = await _execute_node(nf, variables, session_id, path_node_id)

    if adj is not None:
        signals = _extract_engine_signals(result)
        written = _assign_output_bindings(
            result, nf["output_bindings"], variables, session_id, block_name, path_node_id
        )
        await _push_variable_changes(
            session_id, vars_before, variables, announced_writes(nf, written)
        )
        dispatch_result = await dispatch_nested_signals(
            signals,
            path_node_id,
            nf,
            adj,
            step.node_map,
            variables,
            session,
            session_id,
            executed,
            step.environment_id,
        )
        if dispatch_result == "error":
            raise RuntimeError(f"Nested control in '{block_name}' failed")
        final_status = resolve_nested_final_status(
            signals, session, nf["node_type"], nf["element_type"], result
        )
    else:
        _strip_engine_keys(result)
        written = _apply_path_output_bindings(result, nf["output_bindings"], variables)
        await _push_variable_changes(
            session_id, vars_before, variables, announced_writes(nf, written)
        )
        final_status = consume_wait_status(session) or "passed"

    session["block_states"][path_node_id] = final_status
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": path_node_id,
            "block_name": block_name,
            "status": final_status,
        },
    )
    await asyncio.sleep(0)
    return str(final_status)


async def _execute_path_nodes(
    chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
) -> Exception | None:
    """Execute a list of nodes in sequence. Returns the first exception or None."""
    from wavecore.api.services.workbench.nested import has_session_signal

    for index, path_node_id in enumerate(chain):
        # A bare yield, no timer: every Parallel lane reaches its first block (REQ-3.2.3.1).
        await asyncio.sleep(0)
        await park_while_held(session)

        if session.get("status") == WorkbenchStatus.STOPPED.value:
            break
        if has_session_signal(session):
            # A halt, break or continue from the block before cuts off the rest of the path.
            await skip_rest(chain[index:], adj or {}, node_map, session, session_id, executed)
            break
        if path_node_id in executed:
            continue

        error = await _execute_single_path_node(
            path_node_id,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
            adj=adj,
        )
        if error is not None:
            await skip_rest(chain[index + 1 :], adj or {}, node_map, session, session_id, executed)
            return error

        _complete_step_over(session, path_node_id)

    return None


def _map_handle_targets(
    outgoing: list[tuple[str, str | None]],
) -> dict[str, str]:
    """Map handle name to first target node ID for each outgoing edge."""
    handle_targets: dict[str, str] = {}
    for child_id, handle in outgoing:
        if handle and handle not in handle_targets:
            handle_targets[handle] = child_id
    return handle_targets


def _trace_handle_chain(
    handle_name: str,
    handle_targets: dict[str, str],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    executed: set[str],
    enabled: bool = True,
) -> list[str]:
    """Trace a dead-end chain for a given handle, if present and enabled.

    Clears stale executed state for traced nodes so they can re-execute
    when this try-catch runs inside a loop body across multiple iterations.
    """
    if handle_name not in handle_targets or not enabled:
        return []
    target = handle_targets[handle_name]
    preliminary = _trace_path_chain(target, adj, node_map, set())
    for nid in preliminary:
        executed.discard(nid)
    return _trace_path_chain(target, adj, node_map, executed)


def _build_error_object(
    try_error: Exception,
    try_chain: list[str],
    session: dict[str, Any],
    node_map: dict[str, Any],
) -> dict[str, Any]:
    """Build a structured error object from a try-path failure."""
    import traceback as tb_mod

    from wavecore.core.errors.error_handling import ErrorClassifier

    classifier = ErrorClassifier()
    category = classifier.classify(try_error)

    failed_node_id = None
    for nid in try_chain:
        if session.get("block_states", {}).get(nid) == "failed":
            failed_node_id = nid
            break

    failed_node = node_map.get(failed_node_id or "") or {}
    failed_data = failed_node.get("data", {})

    return {
        "type": type(try_error).__name__,
        "message": str(try_error),
        "node": failed_data.get("label", ""),
        "node_id": failed_node_id or "",
        "element_type": failed_data.get("elementType", ""),
        "timestamp": datetime.now(UTC).isoformat(),
        "is_retryable": category.is_retryable,
        "category": category.value,
        "stack_trace": tb_mod.format_exception(try_error),
    }


def _apply_try_catch_outcome(
    catch_error: Exception | None,
    finally_error: Exception | None,
    session: dict[str, Any],
    session_id: str,
    node_id: str,
) -> None:
    """Apply the session outcome from try/catch/finally execution."""
    if catch_error:
        session["status"] = WorkbenchStatus.FAILED.value
        session["error"] = str(catch_error)
        _add_execution_log(
            session_id,
            "ERROR",
            f"Catch path failed: {catch_error}",
            "SYSTEM",
            block_id=node_id,
        )
    elif finally_error:
        session["status"] = WorkbenchStatus.FAILED.value
        session["error"] = str(finally_error)
        _add_execution_log(
            session_id,
            "ERROR",
            f"Finally path failed (success converted to failure): {finally_error}",
            "SYSTEM",
            block_id=node_id,
        )


async def _run_catch_chain(
    catch_chain: list[Any],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]],
) -> Exception | None:
    if not catch_chain:
        return None
    return await _execute_path_nodes(
        catch_chain,
        node_map,
        variables,
        session,
        session_id,
        executed,
        environment_id,
        adj=adj,
    )


async def _run_finally_chain(
    finally_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]],
) -> Exception | None:
    """Run the finally path with any Break or Continue held back until it ends cleanly."""
    from wavecore.api.services.workbench.nested import has_session_signal

    if not finally_chain:
        return None
    parked = None
    if session.get("_loop_signal"):
        parked = (session.pop("_loop_signal"), session.pop("_loop_signal_target", None))
    finally_error = await _execute_path_nodes(
        finally_chain, node_map, variables, session, session_id, executed, environment_id, adj=adj
    )
    if session.get("status") == WorkbenchStatus.STOPPED.value:
        session.pop("_loop_signal", None)
        session.pop("_loop_signal_target", None)
        return finally_error
    # A failure, a Halt or the path's own Break / Continue replaces the held signal.
    if parked and finally_error is None and not has_session_signal(session):
        session["_loop_signal"], session["_loop_signal_target"] = parked
    return finally_error


async def _apply_try_catch_output_bindings(
    output_bindings: dict[str, str],
    variables: dict[str, Any],
    session_id: str,
    error_obj: dict[str, Any] | None,
    caught: bool,
) -> None:
    if not output_bindings:
        return
    error_var = output_bindings.get("error")
    if error_var:
        variables[error_var] = error_obj
        await _push_single_variable_change(session_id, error_var, error_obj)
    caught_var = output_bindings.get("caught")
    if caught_var:
        variables[caught_var] = caught
        await _push_single_variable_change(session_id, caught_var, caught)


async def _skip_paths_not_run(
    chains: list[list[str]],
    then_target: str | None,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Store and paint skipped the catch / finally paths a Try/Catch did not run."""
    heads = [chain[0] for chain in chains if chain]
    await skip_lanes_not_run(heads, [then_target], adj, node_map, session, session_id, executed)


async def _execute_try_catch_paths(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    enable_catch: bool,
    enable_finally: bool,
    output_bindings: dict[str, str],
    environment_id: str | None,
) -> None:
    """Execute try/catch/finally scoped paths, then queue egress."""
    handle_targets = _map_handle_targets(adj.get(node_id, []))

    try_chain = _trace_handle_chain("try", handle_targets, adj, node_map, executed)
    catch_chain = _trace_handle_chain(
        "catch", handle_targets, adj, node_map, executed, enable_catch
    )
    finally_chain = _trace_handle_chain(
        "finally", handle_targets, adj, node_map, executed, enable_finally
    )

    status_before_try = session.get("status", WorkbenchStatus.RUNNING.value)

    try_error = await _execute_path_nodes(
        try_chain, node_map, variables, session, session_id, executed, environment_id, adj=adj
    )

    halted = bool(session.get("_halt"))
    caught = try_error is not None
    error_obj: dict[str, Any] | None = None
    catch_error: Exception | None = None

    if try_error is not None:
        error_obj = _build_error_object(try_error, try_chain, session, node_map)
        _add_execution_log(
            session_id, "WARN", f"Try-path error caught: {try_error}", "SYSTEM", block_id=node_id
        )

    # REQ-3.2.2.6: handlers inspect these outputs, so bind before any handler runs.
    await _apply_try_catch_output_bindings(
        output_bindings, variables, session_id, error_obj, caught
    )

    then_target = handle_targets.get("then")

    if halted:
        await _skip_paths_not_run(
            [catch_chain, finally_chain], then_target, adj, node_map, session, session_id, executed
        )
        await leave_by_then(
            then_target, False, exec_queue, adj, node_map, session, session_id, executed
        )
        return

    if error_obj is not None:
        # Restoring below the halt return keeps the status a Halt set in the try path.
        session["status"] = status_before_try
        catch_error = await _run_catch_chain(
            catch_chain, node_map, variables, session, session_id, executed, environment_id, adj
        )
    else:
        await _skip_paths_not_run(
            [catch_chain], then_target, adj, node_map, session, session_id, executed
        )

    if caught and session.get("_halt"):
        await _skip_paths_not_run(
            [finally_chain], then_target, adj, node_map, session, session_id, executed
        )
        skip_then = catch_error is not None
        await leave_by_then(
            then_target, skip_then, exec_queue, adj, node_map, session, session_id, executed
        )
        return

    finally_error = await _run_finally_chain(
        finally_chain, node_map, variables, session, session_id, executed, environment_id, adj
    )

    skip_then = catch_error is not None or finally_error is not None
    if not session.get("_halt"):
        _apply_try_catch_outcome(catch_error, finally_error, session, session_id, node_id)
    await leave_by_then(
        then_target, skip_then, exec_queue, adj, node_map, session, session_id, executed
    )
