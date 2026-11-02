"""Nested control dispatch for workbench workflow engine.

Enables arbitrary nesting of control structures (For, ForEach, TryCatch,
IfElse, Halt, Break, Continue) inside try-catch paths and loop bodies.

Signal propagation uses session-level transient keys:
- session["_loop_signal"]: "break" or "continue" (consumed by enclosing loop)
- session["_halt"]: True (propagated until main execution handles it)
"""

from typing import Any

from wavecore.api.services.workbench.signals import (
    _apply_halt_status,
)


def _find_branch_target(outgoing: list[tuple[str, str | None]], branch_key: str) -> str | None:
    """Find the child node matching the given branch handle.

    Prefers an exact ``sourceHandle == branch_key`` match; falls back to a
    null-handle edge so the body walker routes the same way the root engine
    does (``_enqueue_branch_successors`` treats ``handle is None`` as matching
    the chosen branch). An If/Else branch edge that lost its handle therefore
    still routes correctly inside a Function body.
    """
    fallback: str | None = None
    for child_id, handle in outgoing:
        if handle == branch_key:
            return child_id
        if handle is None and fallback is None:
            fallback = child_id
    return fallback


def _pending_loop_signal(session: dict[str, Any]) -> str | None:
    """The break/continue still traveling to an enclosing loop, left for that loop to consume."""
    if not session.get("_loop_signal_target"):
        return None
    return session.get("_loop_signal")


async def _dispatch_nested_branch(
    signals: dict[str, Any],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a branch signal (if-else, assert-split) inside a nested context."""
    from wavecore.api.services.workbench.block_status import skip_lanes_not_run
    from wavecore.api.services.workbench.for_loop import (
        _execute_body_chain_iteration,
        _trace_body_chain,
    )

    branch_key = signals["branch"]
    outgoing = adj.get(node_id, [])

    branch_target = _find_branch_target(outgoing, branch_key)
    # Same-handle children fan out from the taken branch; the skip stops where they merge.
    taken = {child for child, handle in outgoing if handle == branch_key or child == branch_target}
    await skip_lanes_not_run(
        [child for child, _handle in outgoing if child not in taken],
        taken,
        adj,
        node_map,
        session,
        session_id,
        executed,
    )
    # Cleared trace, so a branch skipped on an earlier pass of a loop runs whole on this one.
    branch_chain = (
        _trace_body_chain(branch_target, adj, node_map, executed) if branch_target else []
    )

    if not branch_target or not branch_chain:
        return "ok"

    result = await _execute_body_chain_iteration(
        branch_chain,
        node_map,
        variables,
        session,
        session_id,
        executed,
        environment_id,
        adj=adj,
    )
    if result in ("break", "continue", "error"):
        return result
    if session.get("_halt"):
        return "halt"
    return "ok"


async def _dispatch_nested_loop(
    signals: dict[str, Any],
    node_id: str,
    nf: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a nested loop (For/ForEach/While) and propagate failure/halt/loop-signal."""
    from wavecore.api.services.workbench.execution import _dispatch_loop

    local_queue: list[str] = []
    block_status = await _dispatch_loop(
        signals=signals,
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=local_queue,
        output_bindings=nf["output_bindings"],
        environment_id=environment_id or "",
    )
    # The loop's own verdict outranks a pending halt, so a stop cannot repaint a failure.
    if block_status == "failed":
        return "error"
    if session.get("_halt"):
        return "halt"
    return _pending_loop_signal(session) or "ok"


async def _dispatch_nested_wait_until(
    signals: dict[str, Any],
    node_id: str,
    nf: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a nested Wait Until and propagate its status, halt and loop signals."""
    from wavecore.api.services.workbench.wait_until import (
        WaitSpec,
        _execute_wait_until_body,
    )

    status = await _execute_wait_until_body(
        node_id,
        adj,
        node_map,
        variables,
        session,
        session_id,
        executed,
        [],
        WaitSpec.from_signals(signals, nf["output_bindings"]),
        environment_id,
    )
    # The wait's own verdict outranks a pending halt, so a stop cannot repaint a failure.
    if status == "error":
        return "error"
    pending = _pending_loop_signal(session)
    if pending:
        return pending
    # The walker paints the node from this, after its own resolve step.
    session["_wait_status"] = status
    return "halt" if session.get("_halt") else "ok"


async def _dispatch_nested_remote_execution(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Run a nested Remote Execution; its failure raises, halt and loop signals propagate."""
    from wavecore.api.services.workbench.remote_exec import execute_remote_container

    # The surrounding walker's chain already carries the container's `then` successor.
    await execute_remote_container(
        node_id, adj, node_map, variables, session, session_id, executed, [], environment_id
    )
    if session.get("_halt"):
        return "halt"
    return _pending_loop_signal(session) or "ok"


async def _dispatch_nested_try_catch(
    node_id: str,
    nf: dict[str, Any],
    signals: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a nested try-catch and propagate halt/failure/loop-signal."""
    from wavecore.api.services.workbench._common import WorkbenchStatus
    from wavecore.api.services.workbench.try_catch import _execute_try_catch_paths

    await _execute_try_catch_paths(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=[],
        enable_catch=signals["enable_catch"],
        enable_finally=signals["enable_finally"],
        output_bindings=nf["output_bindings"],
        environment_id=environment_id,
    )
    if session.get("_halt"):
        return "halt"
    if session.get("status") == WorkbenchStatus.FAILED.value:
        return "error"
    return _pending_loop_signal(session) or "ok"


async def _dispatch_nested_switch(
    node_id: str,
    signals: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a nested Switch and propagate halt/loop-signal/failure."""
    from wavecore.api.services.workbench.switch_case import _execute_switch_paths

    switch_error = await _execute_switch_paths(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=[],
        branches=signals.get("switch_branches") or [],
        environment_id=environment_id,
    )
    if session.get("_halt"):
        return "halt"
    return _pending_loop_signal(session) or ("error" if switch_error else "ok")


async def _dispatch_nested_parallel(
    node_id: str,
    signals: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str:
    """Dispatch a nested Parallel and propagate halt/loop-signal/failure."""
    from wavecore.api.services.workbench.parallel import execute_parallel_branches

    parallel_error = await execute_parallel_branches(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=[],
        branches=signals.get("parallel_branches") or [],
        join_mode=signals.get("join_mode") or "all",
        time_limit=signals.get("parallel_time_limit"),
        environment_id=environment_id,
    )
    if session.get("_halt"):
        return "halt"
    return _pending_loop_signal(session) or ("error" if parallel_error else "ok")


async def dispatch_nested_signals(
    signals: dict[str, Any],
    node_id: str,
    nf: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
) -> str | None:
    """Dispatch control signals from a node executed in a nested context.

    Returns:
    - None: simple node, no control dispatch needed
    - "halt": halt signal (session status + _halt flag set)
    - "break": break signal (session["_loop_signal"] set)
    - "continue": continue signal (session["_loop_signal"] set)
    - "ok": control dispatched successfully (try-catch or loop handled)
    - "error": control dispatch encountered an error
    """
    if signals["halt"]:
        _apply_halt_status(signals, session)
        session["_halt"] = True
        return "halt"

    if signals["loop_break"]:
        session["_loop_signal"] = "break"
        session["_loop_signal_target"] = signals.get("break_target")
        return "break"
    if signals["loop_continue"]:
        session["_loop_signal"] = "continue"
        session["_loop_signal_target"] = signals.get("continue_target")
        return "continue"

    if signals.get("remote_execution"):
        return await _dispatch_nested_remote_execution(
            node_id, adj, node_map, variables, session, session_id, executed, environment_id
        )

    # Try-catch checked before branch (try-catch sets __branch internally)
    if signals["try_catch"]:
        return await _dispatch_nested_try_catch(
            node_id,
            nf,
            signals,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    if signals.get("switch"):
        return await _dispatch_nested_switch(
            node_id,
            signals,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    if signals.get("parallel"):
        return await _dispatch_nested_parallel(
            node_id,
            signals,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    if signals["branch"] is not None:
        return await _dispatch_nested_branch(
            signals,
            node_id,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    if signals.get("wait_until"):
        return await _dispatch_nested_wait_until(
            signals,
            node_id,
            nf,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    if signals["for_loop"] or signals["for_each"] or signals.get("while_loop"):
        return await _dispatch_nested_loop(
            signals,
            node_id,
            nf,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
        )

    return None


def has_session_signal(session: dict[str, Any]) -> bool:
    """Check if a propagating session signal is active."""
    return bool(session.get("_halt") or session.get("_loop_signal"))
