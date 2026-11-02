"""For-loop body execution for workbench workflow engine.

REQ-3.5.1.15: For loop with counter variable
REQ-3.5.1.2: Break hook points
REQ-3.5.1.3: Continue hook points
"""

import asyncio
from dataclasses import dataclass
from typing import Any

from wavecore.api.services.workbench._common import (
    BlockAttempt,
    NodeStep,
    WorkbenchStatus,
    _add_execution_log,
    _broadcast_event,
    _complete_step_over,
    _push_single_variable_change,
    _push_variable_changes,
    run_debug_block,
)
from wavecore.api.services.workbench.block_source import node_source
from wavecore.api.services.workbench.block_status import (
    leave_by_then,
    skip_lane_never_run,
    skip_rest,
)
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.api.services.workbench.plugins import (
    _inject_profile_variables,
)
from wavecore.api.services.workbench.try_catch import (
    _map_handle_targets,
    _record_node_failure,
    _strip_engine_keys,
    _trace_path_chain,
)


def _trace_body_chain(
    body_target: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    executed: set[str],
) -> list[str]:
    """Trace a body chain, clearing stale executed state first.

    Loop bodies re-execute on each outer iteration, but _trace_path_chain
    skips nodes already in `executed`. This helper removes body-reachable
    nodes from `executed` before tracing so the full chain is discovered.
    """
    # First pass: trace ignoring executed to find all reachable nodes
    chain = _trace_path_chain(body_target, adj, node_map, set())
    # Clear those nodes so _trace_path_chain includes them
    for node_id in chain:
        executed.discard(node_id)
    # Second pass: trace with cleaned executed set (handles edge cases)
    return _trace_path_chain(body_target, adj, node_map, executed)


async def _handle_parent_loop_signal(
    node_id: str,
    then_target: str | None,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    error_occurred: bool,
) -> bool | None:
    """Check if a break/continue signal targets a parent loop (not this one).

    Returns error_occurred if the signal targets a parent (caller should
    return early), or None if no parent-targeting signal is active.
    """
    signal_target = session.get("_loop_signal_target")
    if not signal_target or signal_target == node_id:
        return None
    await leave_by_then(then_target, True, [], adj, node_map, session, session_id, executed)
    return error_occurred


def _consume_loop_signals(session: dict[str, Any]) -> None:
    """Consume loop signal metadata that targets this loop or has no target."""
    session.pop("_loop_signal_target", None)
    session.pop("_loop_signal", None)


def _handle_iteration_result(
    result: str,
    node_id: str,
    node_map: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
) -> str:
    """Handle the result of a body chain iteration.

    Returns:
        "error" if the loop should stop with error,
        "break" if the loop should break,
        "continue" if the loop should continue to next iteration.
    """
    if result == "error":
        return "error"
    if result == "break":
        source = node_source(node_map.get(node_id, {}))
        _add_execution_log(session_id, "INFO", "Break - loop exited", source, block_id=node_id)
        return "break"
    if result == "stopped":
        return "break"
    _consume_if_local_signal(result, node_id, session)
    if result == "continue" and session.get("_loop_signal_target"):
        return "break"
    return "continue"


def _consume_if_local_signal(result: str, node_id: str, session: dict[str, Any]) -> None:
    """Consume break/continue signals targeting this loop (not parent)."""
    if result not in ("break", "continue"):
        return
    signal_target = session.get("_loop_signal_target")
    if not signal_target or signal_target == node_id:
        _consume_loop_signals(session)


async def _broadcast_block_status(
    session_id: str, block_id: str, block_name: str, status: str
) -> None:
    """Broadcast a block status change event."""
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": block_id,
            "block_name": block_name,
            "status": status,
        },
    )


def _apply_body_output_bindings(
    result: Any,
    output_bindings: dict[str, str],
    variables: dict[str, Any],
) -> set[str]:
    """Apply output bindings from a body node result; returns the names written."""
    written: set[str] = set()
    if not result or not isinstance(result, dict):
        return written
    for out_name, var_name in output_bindings.items():
        if var_name and out_name in result:
            variables[var_name] = result[out_name]
            written.add(var_name)
    return written


class _NestedControlFailure(RuntimeError):
    """A body node failed because a control nested in it failed; its failure is already painted."""


async def _resolve_dispatch_result(
    dispatch_result: str | None,
    path_node_id: str,
    session: dict[str, Any],
    session_id: str,
    block_name: str,
) -> tuple[dict[str, Any] | None, Exception | None]:
    """Convert a nested dispatch result into (raw_result, error).

    Break/continue propagate via raw_result for _check_break_continue.
    Halt propagates via session["_halt"], detected by has_session_signal.
    None means simple node (no control dispatch) - treated as success.
    """
    if dispatch_result is None or dispatch_result in ("halt", "ok"):
        return None, None
    if dispatch_result == "break":
        return {"__break": True}, None
    if dispatch_result == "continue":
        return {"__continue": True}, None
    # dispatch_result == "error"
    session["block_states"][path_node_id] = "failed"
    await _broadcast_block_status(session_id, path_node_id, block_name, "failed")
    return None, _NestedControlFailure(f"Nested control in '{block_name}' failed")


class _BodyStep(NodeStep):
    """A node in a loop body, a Wait Until retry body, a nested branch or a Remote body."""

    async def run(self, attempt: BlockAttempt) -> str:
        executed = None if self.executed is None else attempt.executed
        attempt.outcome, status = await _run_body_node(self, executed)
        return status


async def _execute_body_node(
    path_node_id: str,
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    environment_id: str | None,
    log_prefix: str = "For-loop",
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
    executed: set[str] | None = None,
) -> tuple[dict[str, Any] | None, Exception | None]:
    """Execute one body node. Returns (raw_result, error).

    Returns the raw result dict so the for-loop engine can inspect
    break/continue signals before stripping engine keys.

    When adj is provided, control nodes are dispatched recursively,
    enabling arbitrary nesting inside loop bodies.
    """
    node = node_map.get(path_node_id)
    if not node:
        return None, None

    nf = _extract_node_fields(node)
    step = _BodyStep(
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
    block_name = nf["block_name"]
    block = step.debug_block()
    attempt = await run_debug_block(block)
    if attempt is None:
        return None, None
    if attempt.error is None:
        return attempt.outcome, None
    if not isinstance(attempt.error, _NestedControlFailure):
        walker = f"{log_prefix} body"
        await _record_node_failure(
            session, session_id, path_node_id, block_name, attempt.error, walker
        )
    return None, attempt.error


async def _run_body_node(
    step: _BodyStep,
    executed: set[str] | None,
) -> tuple[dict[str, Any] | None, str]:
    """Run a body node past its debugger gate; returns (raw_result, status), raises on failure."""
    from wavecore.api.services.workbench.nested import dispatch_nested_signals
    from wavecore.api.services.workbench.signals import (
        _assign_output_bindings,
        _extract_engine_signals,
        announced_writes,
        resolve_nested_final_status,
    )

    path_node_id, nf, adj = step.node_id, step.nf, step.adj
    session, session_id, variables = step.session, step.session_id, step.variables
    block_name = nf["block_name"]

    session["block_states"][path_node_id] = "running"
    await _broadcast_block_status(session_id, path_node_id, block_name, "running")

    profile_bindings = nf["node_data"].get("config", {}).get("profileBindings", [])
    if profile_bindings:
        _inject_profile_variables(
            profile_bindings, variables, step.environment_id or "", session_id, block_name
        )
    vars_before = variables.copy()
    result = await _execute_node(nf, variables, session_id, path_node_id)

    final_status = "passed"
    if adj is not None and executed is not None:
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
        raw_result, err = await _resolve_dispatch_result(
            dispatch_result, path_node_id, session, session_id, block_name
        )
        if err is not None:
            raise err
        final_status = resolve_nested_final_status(
            signals, session, nf["node_type"], nf["element_type"], result
        )
    else:
        raw_result = dict(result) if result and isinstance(result, dict) else None
        _strip_engine_keys(result)
        written = _apply_body_output_bindings(result, nf["output_bindings"], variables)
        await _push_variable_changes(
            session_id, vars_before, variables, announced_writes(nf, written)
        )

    session["block_states"][path_node_id] = final_status
    await _broadcast_block_status(session_id, path_node_id, block_name, final_status)
    await asyncio.sleep(0)
    return raw_result, final_status


def _compute_iteration_count(
    loop_start: int,
    loop_end: int,
    loop_step: int,
) -> int:
    """Compute the number of iterations for the loop range.

    Uses ceiling division to match Python's range() semantics:
    len(range(start, end, step)).
    """
    if loop_step == 0:
        return 0
    diff = loop_end - loop_start
    if (loop_step > 0 and diff <= 0) or (loop_step < 0 and diff >= 0):
        return 0
    return max(0, -(-diff // loop_step))


@dataclass
class _ChainWalk:
    """One pass over a body chain and the run state its skipped tail is stored in."""

    chain: list[str]
    node_map: dict[str, Any]
    session: dict[str, Any]
    session_id: str
    executed: set[str]
    adj: dict[str, list[tuple[str, str | None]]] | None = None

    async def skip_from(self, block_id: str, offset: int) -> None:
        """Store and paint skipped all the chain leads to from ``block_id`` plus ``offset``."""
        start = self.chain.index(block_id) + offset
        await skip_rest(
            self.chain[start:],
            self.adj or {},
            self.node_map,
            self.session,
            self.session_id,
            self.executed,
        )


async def _check_break_continue(
    raw_result: dict[str, Any] | None,
    walk: _ChainWalk,
    body_node_id: str,
) -> str | None:
    """Check for break/continue signals. Returns 'break', 'continue', or None.

    When a target is present in raw_result (__break_target / __continue_target),
    it is stored in session["_loop_signal_target"] for the enclosing loop to
    inspect. If a session target already exists (from nested dispatch), it is
    not overwritten.
    """
    if not raw_result or not isinstance(raw_result, dict):
        return None

    session = walk.session
    for signal in ("break", "continue"):
        if not raw_result.get(f"__{signal}"):
            continue
        target = raw_result.get(f"__{signal}_target")
        if target and "_loop_signal_target" not in session:
            session["_loop_signal_target"] = target
            session["_loop_signal"] = signal
        await walk.skip_from(body_node_id, 1)
        return signal

    return None


@dataclass
class _LoopParams:
    """Grouped parameters for for-loop execution."""

    loop_start: int
    loop_end: int
    loop_step: int
    loop_variable: str
    output_bindings: dict[str, str]
    environment_id: str | None


async def _drain_session_signal(
    walk: _ChainWalk,
    body_node_id: str,
    skip_offset: int,
) -> str | None:
    """Check for session-level signals and drain them. Returns signal or None.

    Consumes both _loop_signal and _loop_signal_target from session.

    skip_offset: 0 to skip from current node, 1 to skip after current node.
    """
    signal: str | None = walk.session.pop("_loop_signal", None)
    walk.session.pop("_loop_signal_target", None)
    if signal:
        await walk.skip_from(body_node_id, skip_offset)
        return signal
    if walk.session.get("_halt"):
        await walk.skip_from(body_node_id, skip_offset)
        return "stopped"
    return None


async def _fail_body_chain(
    walk: _ChainWalk,
    body_node_id: str,
    error: Exception,
    failures: list[Exception] | None,
) -> str:
    """Record a body node's failure and skip the rest of the chain."""
    if failures is not None:
        failures.append(error)
    await walk.skip_from(body_node_id, 1)
    return "error"


async def _execute_body_chain_iteration(
    body_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    log_prefix: str = "For-loop",
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
    failures: list[Exception] | None = None,
) -> str:
    """Execute one iteration's body chain. Returns 'ok', 'error', 'break', or 'stopped'.

    ``failures`` receives the failing node's error.
    """
    for body_node_id in body_chain:
        executed.discard(body_node_id)
    walk = _ChainWalk(body_chain, node_map, session, session_id, executed, adj)
    for body_node_id in body_chain:
        await asyncio.sleep(0.001)
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            return "stopped"

        # Pre-execution: check for signals from prior nested dispatch
        sig = await _drain_session_signal(walk, body_node_id, 0)
        if sig:
            return sig
        if body_node_id in executed:
            continue

        executed.add(body_node_id)
        raw_result, error = await _execute_body_node(
            body_node_id,
            node_map,
            variables,
            session,
            session_id,
            environment_id,
            log_prefix=log_prefix,
            adj=adj,
            executed=executed,
        )

        if error is not None:
            return await _fail_body_chain(walk, body_node_id, error, failures)
        _complete_step_over(session, body_node_id)

        # Check for break/continue (from direct signals or nested dispatch)
        signal = await _check_break_continue(raw_result, walk, body_node_id)
        if signal:
            return signal

        # Post-execution: check for session-level signals from nested dispatch
        sig = await _drain_session_signal(walk, body_node_id, 1)
        if sig:
            return sig

    return "ok"


async def _execute_for_loop_body(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    params: _LoopParams,
) -> bool:
    """Execute a for-loop: iterate body chain, then queue egress.

    Returns True if an error occurred (body failure).
    """
    lanes = LoopLanes.of(node_id, adj)
    body_chain = _trace_body_chain(lanes.body, adj, node_map, executed) if lanes.body else []
    total = _compute_iteration_count(params.loop_start, params.loop_end, params.loop_step)
    var_name = params.output_bindings.get(params.loop_variable, "")

    error_occurred = await _run_iteration_loop(
        params,
        total,
        var_name,
        body_chain,
        node_map,
        variables,
        session,
        session_id,
        executed,
        node_id,
        adj=adj,
    )

    return await _finish_loop(
        node_id, lanes, error_occurred, adj, node_map, session, session_id, executed, exec_queue
    )


async def _run_iteration_loop(
    params: _LoopParams,
    total: int,
    var_name: str,
    body_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
) -> bool:
    """Run the for-loop iterations. Returns True if an error occurred."""
    _add_execution_log(
        session_id,
        "INFO",
        f"[FOR] Starting loop ({total} iterations)",
        "SYSTEM",
        block_id=node_id,
    )

    for iteration in range(total):
        await asyncio.sleep(0.001)
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            break

        current_value = params.loop_start + iteration * params.loop_step
        if var_name:
            variables[var_name] = current_value
            await _push_single_variable_change(session_id, var_name, current_value)

        _add_execution_log(
            session_id,
            "DEBUG",
            f"[FOR] Iteration {iteration + 1}/{total} ({params.loop_variable}={current_value})",
            "SYSTEM",
            block_id=node_id,
        )
        await _broadcast_event(
            session_id,
            {
                "type": "loop_iteration",
                "block_id": node_id,
                "iteration": iteration + 1,
                "total": total,
            },
        )

        if not body_chain:
            continue

        result = await _execute_body_chain_iteration(
            body_chain,
            node_map,
            variables,
            session,
            session_id,
            executed,
            params.environment_id,
            adj=adj,
        )
        action = _handle_iteration_result(result, node_id, node_map, session, session_id)
        if action == "error":
            return True
        if action == "break":
            break

    return False


@dataclass(frozen=True)
class LoopLanes:
    """A loop's body and then lanes, by their first block."""

    body: str | None
    then: str | None

    @classmethod
    def of(cls, node_id: str, adj: dict[str, list[tuple[str, str | None]]]) -> "LoopLanes":
        targets = _map_handle_targets(adj.get(node_id, []))
        return cls(body=targets.get("body"), then=targets.get("then"))


async def _finish_loop(
    node_id: str,
    lanes: LoopLanes,
    error_occurred: bool,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
) -> bool:
    """Settle a loop whose iterations ended: unrun body, parent signal, completion line, egress."""
    then_target = lanes.then
    await skip_lane_never_run(lanes.body, then_target, adj, node_map, session, session_id, executed)
    parent_result = await _handle_parent_loop_signal(
        node_id, then_target, adj, node_map, session, session_id, executed, error_occurred
    )
    if parent_result is not None:
        return parent_result

    _consume_loop_signals(session)

    if not error_occurred:
        _add_execution_log(
            session_id,
            "DEBUG",
            "Loop completed",
            node_source(node_map.get(node_id, {})),
            block_id=node_id,
        )

    await leave_by_then(
        then_target, error_occurred, exec_queue, adj, node_map, session, session_id, executed
    )
    return error_occurred
