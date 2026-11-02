"""Workbench workflow execution engine.

Handles the main execution loop: node traversal, block execution,
signal routing, and status broadcasting.
"""

import asyncio
import functools
from dataclasses import dataclass
from typing import Any

from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import node_helpers as _wb_node_helpers
from wavecore.api.services.workbench._common import (
    STOP_REASON_SHUTDOWN,
    STOP_REASON_USER,
    BlockAttempt,
    NodeStep,
    WorkbenchStatus,
    _add_execution_log,
    _complete_step_over,
    _notify_terminal,
    _push_variable_changes,
    _settle_interrupted_blocks,
    _settle_running_blocks,
    _workbench_sessions,
    logger,
    run_debug_block,
)
from wavecore.api.services.workbench.block_status import skip_rest
from wavecore.api.services.workbench.for_each import _execute_for_each_body
from wavecore.api.services.workbench.for_loop import _execute_for_loop_body, _LoopParams
from wavecore.api.services.workbench.graph import (
    _build_adjacency_list,
    _collect_reachable_nodes,
    _ensure_output_variables,
    _find_entry_points,
)
from wavecore.api.services.workbench.node_helpers import (
    _enqueue_children,
    _extract_node_fields,
)
from wavecore.api.services.workbench.plugins import (
    _inject_namespace_variables,
    _inject_profile_variables,
)
from wavecore.api.services.workbench.remote_exec import AdhocPlace, run_adhoc_in_body
from wavecore.api.services.workbench.signals import (
    _apply_halt_status,
    _assign_output_bindings,
    _determine_block_status,
    _enqueue_branch_successors,
    _extract_engine_signals,
    _handle_halt_cleanup,
    announced_writes,
)
from wavecore.api.services.workbench.switch_case import _execute_switch_paths
from wavecore.api.services.workbench.try_catch import _execute_try_catch_paths
from wavecore.api.services.workbench.wait_until import WaitSpec, _execute_wait_until_body
from wavecore.api.services.workbench.while_loop import _execute_while_loop_body
from wavecore.core.functions.references import iter_blocks, nested_function_workflows
from wavecore.core.secrets import masking_settings
from wavecore.core.variables.declared_types import declared_type_scope


async def _broadcast_event(session_id: str, event: dict[str, Any]) -> None:
    """Delegate to _common._broadcast_event via the module so tests can patch it."""
    await _wb_common._broadcast_event(session_id, event)


def _scrub_error_text(session: dict[str, Any], text: str) -> str:
    """Value-scrub an error message with the session's secret registry."""
    registry = session.get("secret_registry")
    if registry is None:
        return text
    from wavecore.core.secrets.masking import mask_text

    return mask_text(text, registry.scan_values())


async def _execute_node(*args: Any, **kwargs: Any) -> Any:
    """Delegate to node_helpers._execute_node via the module so tests can patch it."""
    return await _wb_node_helpers._execute_node(*args, **kwargs)


def _library_body_nodes(data: dict[str, Any]) -> list[dict[str, Any]]:
    """The body Blocks of a Function Block that runs a library version; none when it is gone."""
    from wavecore.api.services.workbench.functions import _load_function_definition

    try:
        definition = _load_function_definition(data)
    except RuntimeError:
        return []
    workflow = definition.get("workflow")
    nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
    return nodes if isinstance(nodes, list) else []


def _collect_revealing_blocks(
    nodes: list[dict[str, Any]], seen: frozenset[tuple[str, str]] = frozenset()
) -> list[str]:
    """Names of plugin blocks whose effective run-output is revealing, in document
    order, recursing into Function bodies. Control nodes never reveal."""
    names: list[str] = []
    for node in iter_blocks({"nodes": nodes}):
        data = node.get("data") or {}
        if data.get("nodeType") == "plugin":
            setting = (data.get("config") or {}).get("secret_masking", "system")
            if masking_settings.resolve_block_reveal(setting):
                names.append(data.get("label", "Unknown"))
        elif data.get("nodeType") == "function" and not nested_function_workflows(node):
            key = (str(data.get("functionId") or ""), str(data.get("functionVersion") or ""))
            if key not in seen:
                names.extend(_collect_revealing_blocks(_library_body_nodes(data), seen | {key}))
    return names


def _run_start_reveal_warning(nodes: list[dict[str, Any]]) -> str | None:
    """The run-start WARN naming every revealing block, or None. Suppressed when
    run output is revealed system-wide (every block is already exposed)."""
    if masking_settings.is_run_output_revealed():
        return None
    names = _collect_revealing_blocks(nodes)
    if not names:
        return None
    return (
        f"Secret masking bypassed for {len(names)} block(s): {', '.join(names)}. "
        "Secret values appear in cleartext in this run's logs and reports."
    )


def _log_skip(
    session_id: str,
    session: dict[str, Any],
    node_id: str,
    block_name: str,
    is_disabled: bool,
) -> None:
    """Log a disabled or skipped node.

    For nodes that were cascaded as part of a parent's skip-block (recorded
    in ``session["_cascaded_skip_node_ids"]``), the per-node console log is
    suppressed: the parent's "Skipping <Parent>" entry already conveys the
    decision, and per-child noise crowds the console.
    """
    skip_reason = "disabled" if is_disabled else "skipped"
    cascaded: set[str] = session.get("_cascaded_skip_node_ids") or set()
    if node_id in cascaded:
        return
    _add_execution_log(
        session_id,
        "INFO",
        f"Skipping '{block_name}' ({skip_reason})",
        "SYSTEM",
        block_id=node_id,
    )


async def _handle_block_failure(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    block_name: str,
    error: Exception,
) -> None:
    """Handle a block execution failure: log, broadcast, and update session."""
    logger.error("Block %s failed: %s", node_id, error)
    error_text = _scrub_error_text(session, str(error))
    session["status"] = WorkbenchStatus.FAILED.value
    session["error"] = error_text
    session["block_states"][node_id] = "failed"

    _add_execution_log(
        session_id,
        "ERROR",
        f"Block '{block_name}' failed: {error}",
        "SYSTEM",
        block_id=node_id,
    )
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": node_id,
            "block_name": block_name,
            "status": "failed",
            "progress": session["progress"],
        },
    )
    await _broadcast_event(
        session_id,
        {
            "type": "execution_completed",
            "status": "failed",
            "error": error_text,
        },
    )
    _notify_terminal(session_id, "failed")


async def _broadcast_final_status(
    session: dict[str, Any],
    session_id: str,
    test_name: str,
) -> None:
    """Determine and broadcast the final execution status after the main loop.

    Test-level log lines ("Test 'X' completed successfully" etc) are
    suppressed for ad-hoc runs (``session["_is_adhoc"]``); the per-block
    "Completed 'Y'" entries already cover the user-facing outcome and the
    test-level wording would mislabel a single-block poke as a fresh run.
    """
    status = session.get("status")
    is_adhoc = bool(session.get("_is_adhoc"))

    if status == WorkbenchStatus.RUNNING.value:
        if session.get("scope_failed"):
            session["status"] = WorkbenchStatus.FAILED.value
            if not is_adhoc:
                _add_execution_log(
                    session_id,
                    "ERROR",
                    f"Test '{test_name}' failed: assertion failure(s)",
                    "SYSTEM",
                    variant="error",
                )
            await _broadcast_event(
                session_id,
                {"type": "execution_completed", "status": "failed"},
            )
            _notify_terminal(session_id, "failed")
        else:
            session["status"] = WorkbenchStatus.PASSED.value
            if not is_adhoc:
                _add_execution_log(
                    session_id,
                    "INFO",
                    f"Test '{test_name}' completed successfully",
                    "SYSTEM",
                    variant="success",
                )
            await _broadcast_event(
                session_id,
                {"type": "execution_completed", "status": "passed"},
            )
            _notify_terminal(session_id, "passed")
        return

    _TERMINAL_LOG: dict[str, tuple[str, str]] = {
        WorkbenchStatus.PASSED.value: ("INFO", "success"),
        WorkbenchStatus.SKIPPED.value: ("WARN", "warning"),
        WorkbenchStatus.FAILED.value: ("ERROR", "error"),
    }
    terminal_status = status if isinstance(status, str) else ""
    log_entry = _TERMINAL_LOG.get(terminal_status)
    if log_entry:
        level, variant = log_entry
        if not is_adhoc:
            _add_execution_log(
                session_id,
                level,
                f"Test '{test_name}' halted with status: {terminal_status}",
                "SYSTEM",
                variant=variant,
            )
        await _broadcast_event(
            session_id,
            {"type": "execution_completed", "status": terminal_status},
        )
        _notify_terminal(session_id, terminal_status, session.get("halt_scope"))


async def _paint_settled_blocks(session_id: str, settled: list[tuple[str, str]]) -> None:
    """Paint each settled Block on the live canvas."""
    for node_id, _block_name in settled:
        await _broadcast_event(
            session_id,
            {
                "type": "block_status_changed",
                "block_id": node_id,
                "block_name": "",
                "status": "stopped",
            },
        )


async def _mark_running_body_nodes_stopped(
    session: dict[str, Any],
    session_id: str,
    reason: str,
    node_map: dict[str, dict[str, Any]],
    except_node_id: str,
) -> None:
    """Mark every still-running body node stopped after a container cut its work short."""
    settled = _settle_running_blocks(session, session_id, reason, node_map, except_node_id)
    await _paint_settled_blocks(session_id, settled)


async def _handle_loop_timeout(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    label: str,
    elapsed: float | None,
    node_map: dict[str, dict[str, Any]],
) -> None:
    """Clean up after a loop timeout: mark running body nodes as stopped."""
    _add_execution_log(
        session_id,
        "ERROR",
        f"[{label}] Loop timed out after {elapsed}s",
        "SYSTEM",
        block_id=node_id,
    )
    await _mark_running_body_nodes_stopped(
        session,
        session_id,
        f"Stopped by {label.lower()} loop timeout after {elapsed}s",
        node_map,
        node_id,
    )
    session["status"] = WorkbenchStatus.FAILED.value


@dataclass
class _WaitDispatch:
    """Everything the wait route needs from the walker."""

    signals: dict[str, Any]
    node_id: str
    adj: dict[str, list[tuple[str, str | None]]]
    node_map: dict[str, dict[str, Any]]
    variables: dict[str, Any]
    session: dict[str, Any]
    session_id: str
    executed: set[str]
    exec_queue: list[str]
    output_bindings: dict[str, str]
    environment_id: str


def _build_loop_coro(
    signals: dict[str, Any],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    output_bindings: dict[str, str],
    environment_id: str,
) -> Any:
    """Build the coroutine for the appropriate loop type (For, ForEach, or While)."""
    if signals["for_loop"]:
        return _execute_for_loop_body(
            node_id,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            exec_queue,
            _LoopParams(
                loop_start=signals["loop_start"] or 0,
                loop_end=signals["loop_end"] or 0,
                loop_step=signals["loop_step"] or 1,
                loop_variable=signals["loop_variable"] or "index",
                output_bindings=output_bindings,
                environment_id=environment_id,
            ),
        )
    if signals.get("while_loop"):
        return _execute_while_loop_body(
            node_id,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            exec_queue,
            mode=signals.get("while_mode") or "while-do",
            conditions=signals.get("condition") or [],
            max_iterations=signals.get("max_iterations"),
            output_bindings=output_bindings,
            environment_id=environment_id,
        )
    return _execute_for_each_body(
        node_id,
        adj,
        node_map,
        variables,
        session,
        session_id,
        executed,
        exec_queue,
        collection=signals["collection"] or [],
        item_variable=signals["item_variable"] or "item",
        index_variable=signals["index_variable"] or "index",
        output_bindings=output_bindings,
        environment_id=environment_id,
    )


async def _dispatch_loop(
    signals: dict[str, Any],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    output_bindings: dict[str, str],
    environment_id: str,
) -> str:
    """Dispatch and run a loop control with an optional timeout. Returns block status."""
    timeout = signals["timeout"]
    coro = _build_loop_coro(
        signals,
        node_id,
        adj,
        node_map,
        variables,
        session,
        session_id,
        executed,
        exec_queue,
        output_bindings,
        environment_id,
    )
    try:
        if timeout is not None:
            loop_error = await asyncio.wait_for(coro, timeout=timeout)
        else:
            loop_error = await coro
    except TimeoutError:
        if signals.get("while_loop"):
            label = "WHILE"
        elif signals.get("for_each"):
            label = "FOR-EACH"
        else:
            label = "FOR"
        await _handle_loop_timeout(session, session_id, node_id, label, timeout, node_map)
        return "failed"

    if not loop_error:
        return "passed"
    # The verdict belongs to the body failure, not to whatever is wired after the loop.
    session["status"] = WorkbenchStatus.FAILED.value
    return "failed"


async def _run_and_route_node(
    nf: dict[str, Any],
    variables: dict[str, Any],
    session_id: str,
    session: dict[str, Any],
    node_id: str,
    block_name: str,
    output_bindings: dict[str, str],
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    executed: set[str],
    exec_queue: list[str],
    environment_id: str,
) -> str:
    """Execute a single node, process signals, route successors.

    Returns the block_status string ("passed", "failed", "warning").
    """
    # Remote Execution is an engine-dispatched container (not a plugin/control):
    # it runs its body sub-flow on a remote host over an open SSH session.
    if nf["element_type"] == "remote-execution":
        from wavecore.api.services.workbench.remote_exec import execute_remote_container

        await execute_remote_container(
            node_id,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            exec_queue,
            environment_id,
        )
        await _settle_container_signals(
            node_id=node_id,
            adj=adj,
            node_map=node_map,
            session=session,
            session_id=session_id,
            executed=executed,
            exec_queue=exec_queue,
            keep_parent_signal=True,
        )
        return "passed"

    vars_before = variables.copy()

    result = await _execute_node(nf, variables, session_id, node_id)

    signals = _extract_engine_signals(result)

    block_status = _determine_block_status(
        signals, session, nf["node_type"], nf["element_type"], result
    )

    if signals["halt"]:
        block_status = _apply_halt_status(signals, session)

    written = _assign_output_bindings(
        result, output_bindings, variables, session_id, block_name, node_id
    )

    await _push_variable_changes(session_id, vars_before, variables, announced_writes(nf, written))

    return await _route_after_node(
        signals=signals,
        block_status=block_status,
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        output_bindings=output_bindings,
        environment_id=environment_id,
    )


async def _settle_container_signals(
    *,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    keep_parent_signal: bool,
) -> None:
    """Clear a container's own loop signal and run any halt it left behind.

    ``keep_parent_signal`` leaves a break/continue that targets an ENCLOSING
    loop in place, so it survives the container and reaches its own loop.
    """
    if keep_parent_signal:
        if not session.get("_loop_signal_target"):
            session.pop("_loop_signal", None)
    else:
        session.pop("_loop_signal", None)
        session.pop("_loop_signal_target", None)
    if session.pop("_halt", None):
        await _handle_halt_cleanup(
            node_id, adj, node_map, session, session_id, executed, exec_queue
        )


async def _route_try_catch(
    *,
    signals: dict[str, Any],
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    output_bindings: dict[str, str],
    environment_id: str,
) -> None:
    """Run the try/catch/finally paths, then settle its signals."""
    await _execute_try_catch_paths(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        enable_catch=signals["enable_catch"],
        enable_finally=signals["enable_finally"],
        output_bindings=output_bindings,
        environment_id=environment_id,
    )
    await _settle_container_signals(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        keep_parent_signal=False,
    )


async def _route_switch(
    *,
    signals: dict[str, Any],
    block_status: str,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    environment_id: str,
) -> str:
    """Run the matching case chains, then settle signals. Failing chains fail the node."""
    switch_error = await _execute_switch_paths(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        branches=signals.get("switch_branches") or [],
        environment_id=environment_id,
    )
    await _settle_container_signals(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        keep_parent_signal=True,
    )
    return "failed" if switch_error else block_status


async def _route_parallel(
    *,
    signals: dict[str, Any],
    block_status: str,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    environment_id: str,
) -> str:
    """Fork the branch lanes, release the join, then settle signals."""
    from wavecore.api.services.workbench.parallel import execute_parallel_branches

    parallel_error = await execute_parallel_branches(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        branches=signals.get("parallel_branches") or [],
        join_mode=signals.get("join_mode") or "all",
        time_limit=signals.get("parallel_time_limit"),
        environment_id=environment_id,
    )
    await _settle_container_signals(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        keep_parent_signal=True,
    )
    return "failed" if parallel_error else block_status


async def _route_wait_until(ctx: _WaitDispatch) -> str:
    """Run the wait rounds, then settle signals. Never routes through _dispatch_loop."""
    status = await _execute_wait_until_body(
        ctx.node_id,
        ctx.adj,
        ctx.node_map,
        ctx.variables,
        ctx.session,
        ctx.session_id,
        ctx.executed,
        ctx.exec_queue,
        WaitSpec.from_signals(ctx.signals, ctx.output_bindings),
        ctx.environment_id,
    )
    await _settle_container_signals(
        node_id=ctx.node_id,
        adj=ctx.adj,
        node_map=ctx.node_map,
        session=ctx.session,
        session_id=ctx.session_id,
        executed=ctx.executed,
        exec_queue=ctx.exec_queue,
        keep_parent_signal=True,
    )
    return "failed" if status == "error" else status


async def _route_after_node(
    *,
    signals: dict[str, Any],
    block_status: str,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, dict[str, Any]],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    output_bindings: dict[str, str],
    environment_id: str,
) -> str:
    """Route a node's successors from its signals, returning the block status."""
    if signals["halt"]:
        await _handle_halt_cleanup(
            node_id, adj, node_map, session, session_id, executed, exec_queue
        )
    elif signals["try_catch"]:
        await _route_try_catch(
            signals=signals,
            node_id=node_id,
            adj=adj,
            node_map=node_map,
            variables=variables,
            session=session,
            session_id=session_id,
            executed=executed,
            exec_queue=exec_queue,
            output_bindings=output_bindings,
            environment_id=environment_id,
        )
    elif signals.get("switch"):
        block_status = await _route_switch(
            signals=signals,
            block_status=block_status,
            node_id=node_id,
            adj=adj,
            node_map=node_map,
            variables=variables,
            session=session,
            session_id=session_id,
            executed=executed,
            exec_queue=exec_queue,
            environment_id=environment_id,
        )
    elif signals.get("parallel"):
        block_status = await _route_parallel(
            signals=signals,
            block_status=block_status,
            node_id=node_id,
            adj=adj,
            node_map=node_map,
            variables=variables,
            session=session,
            session_id=session_id,
            executed=executed,
            exec_queue=exec_queue,
            environment_id=environment_id,
        )
    elif signals.get("wait_until"):
        block_status = await _route_wait_until(
            _WaitDispatch(
                signals=signals,
                node_id=node_id,
                adj=adj,
                node_map=node_map,
                variables=variables,
                session=session,
                session_id=session_id,
                executed=executed,
                exec_queue=exec_queue,
                output_bindings=output_bindings,
                environment_id=environment_id,
            )
        )
    elif signals["for_loop"] or signals["for_each"] or signals.get("while_loop"):
        block_status = await _dispatch_loop(
            signals,
            node_id,
            adj,
            node_map,
            variables,
            session,
            session_id,
            executed,
            exec_queue,
            output_bindings,
            environment_id,
        )
        await _settle_container_signals(
            node_id=node_id,
            adj=adj,
            node_map=node_map,
            session=session,
            session_id=session_id,
            executed=executed,
            exec_queue=exec_queue,
            keep_parent_signal=True,
        )
    else:
        _enqueue_branch_successors(node_id, adj, signals["branch"], executed, exec_queue)

    return block_status


async def _start_block_execution(
    session_id: str,
    session: dict[str, Any],
    node_id: str,
    block_name: str,
    nf: dict[str, Any],
    current: int,
    total_blocks: int,
) -> None:
    """Set up session state and broadcast block start event."""
    session["current_block"] = {"block_id": node_id, "block_name": block_name}
    session["progress"] = {
        "current": current,
        "total": total_blocks,
        "percentage": (current / total_blocks * 100) if total_blocks > 0 else 0,
    }
    session["block_states"][node_id] = "running"

    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": node_id,
            "block_name": block_name,
            "status": "running",
            "progress": session["progress"],
        },
    )
    _add_execution_log(
        session_id,
        "DEBUG",
        f"Executing '{block_name}' ({nf['node_type']}/{nf['element_type']})",
        "SYSTEM",
        block_id=node_id,
    )


async def _complete_block_execution(
    session_id: str,
    session: dict[str, Any],
    node_id: str,
    block_name: str,
    block_status: str,
    current: int,
    total_blocks: int,
) -> None:
    """Update session state and broadcast block completion event."""
    session["progress"]["current"] = current
    session["progress"]["percentage"] = (current / total_blocks * 100) if total_blocks > 0 else 100
    session["block_states"][node_id] = block_status

    _add_execution_log(session_id, "DEBUG", f"Completed '{block_name}'", "SYSTEM", block_id=node_id)
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": node_id,
            "block_name": block_name,
            "status": block_status,
            "progress": session["progress"],
        },
    )


async def _handle_workflow_cancellation(
    session: dict[str, Any], session_id: str, test_name: str
) -> None:
    """Handle workflow cancellation.

    User-initiated stops land here with ``session["stop_reason"] ==
    "user"`` (tagged by ``workbench.stop_workbench_run``). Anything else
    is a backend shutdown canceling asyncio tasks wholesale -
    surfaced as FATAL so the execution detail console makes the
    distinction clear.
    """
    session["status"] = WorkbenchStatus.STOPPED.value
    stopped_by_user = session.get("stop_reason") == "user"
    settled = _settle_interrupted_blocks(
        session, session_id, STOP_REASON_USER if stopped_by_user else STOP_REASON_SHUTDOWN
    )
    await _paint_settled_blocks(session_id, settled)

    is_adhoc = bool(session.get("_is_adhoc"))
    if stopped_by_user:
        if not is_adhoc:
            _add_execution_log(
                session_id,
                "WARN",
                f"Test '{test_name}' execution stopped by user",
                "SYSTEM",
                variant="warning",
            )
    elif not is_adhoc:
        _add_execution_log(
            session_id,
            "FATAL",
            f"Test '{test_name}' canceled by backend shutdown",
            "SYSTEM",
            variant="error",
        )
    await _broadcast_event(session_id, {"type": "execution_completed", "status": "stopped"})
    _notify_terminal(session_id, "stopped")


async def _handle_workflow_error(
    session: dict[str, Any], session_id: str, test_name: str, error: Exception
) -> None:
    """Handle unexpected workflow execution error."""
    logger.exception("Workflow execution failed: %s", error)
    error_text = _scrub_error_text(session, str(error))
    session["status"] = WorkbenchStatus.FAILED.value
    session["error"] = error_text
    if not session.get("_is_adhoc"):
        _add_execution_log(
            session_id,
            "ERROR",
            f"Test '{test_name}' execution failed: {error}",
            "SYSTEM",
            variant="error",
        )
    await _broadcast_event(
        session_id,
        {"type": "execution_completed", "status": "failed", "error": error_text},
    )
    _notify_terminal(session_id, "failed")


@dataclass
class _MainStep(NodeStep):
    """A node on the main flow, which routes its successors into the run queue."""

    exec_queue: list[str]
    current: int
    total_blocks: int

    async def skip(self) -> bool:
        """Skip a disabled or skipped node, log it and queue its children; True when it was."""
        if not await super().skip():
            return False
        is_disabled = bool(self.nf["node_data"].get("disabled", False))
        _log_skip(self.session_id, self.session, self.node_id, self.nf["block_name"], is_disabled)
        _enqueue_children(self.node_id, self.adj or {}, self.executed or set(), self.exec_queue)
        return True

    async def run(self, attempt: BlockAttempt) -> str:
        """Start the block, run it and route its successors into the attempt's queue."""
        nf, session_id, node_id = self.nf, self.session_id, self.node_id
        block_name = nf["block_name"]
        await _start_block_execution(
            session_id, self.session, node_id, block_name, nf, self.current, self.total_blocks
        )
        profile_bindings = nf["node_data"].get("config", {}).get("profileBindings", [])
        if profile_bindings:
            _inject_profile_variables(
                profile_bindings, self.variables, self.environment_id or "", session_id, block_name
            )
        return await _run_and_route_node(
            nf=nf,
            variables=self.variables,
            session_id=session_id,
            session=self.session,
            node_id=node_id,
            block_name=block_name,
            output_bindings=nf["output_bindings"],
            adj=self.adj or {},
            node_map=self.node_map,
            executed=attempt.executed,
            exec_queue=attempt.queue,
            environment_id=self.environment_id or "",
        )


async def _process_workflow_node(
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    node_map: dict[str, Any],
    adj: dict[str, list[tuple[str, str | None]]],
    executed: set[str],
    exec_queue: list[str],
    variables: dict[str, Any],
    environment_id: str,
    current: int,
    total_blocks: int,
) -> int:
    """Process a single workflow node. Returns updated current count, or -1 if stopped."""
    node = node_map.get(node_id)
    if not node or node.get("type") != "workflowNode":
        executed.add(node_id)
        _enqueue_children(node_id, adj, executed, exec_queue)
        return current

    await asyncio.sleep(0.001)
    if session.get("status") == WorkbenchStatus.STOPPED.value:
        return -1

    nf = _extract_node_fields(node)
    step = _MainStep(
        node_id,
        node,
        nf,
        node_map,
        variables,
        session,
        session_id,
        executed,
        environment_id,
        adj,
        exec_queue,
        current,
        total_blocks,
    )
    executed.add(node_id)
    block = step.debug_block(queue=exec_queue)
    attempt = await run_debug_block(block)
    if attempt is None:
        return -1 if session.get("status") == WorkbenchStatus.STOPPED.value else current + 1
    if attempt.error is not None:
        raise attempt.error

    await _complete_block_execution(
        session_id, session, node_id, nf["block_name"], attempt.status, current + 1, total_blocks
    )
    await asyncio.sleep(0)
    return current + 1


async def _execute_workflow(
    session_id: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    variables: dict[str, Any],
    environment_id: str = "",
    skipped_node_ids: list[str] | None = None,
    start_node_id: str | None = None,
    single_node_id: str | None = None,
) -> None:
    """Execute workflow nodes asynchronously by traversing from Start node.

    ``start_node_id`` overrides the engine's natural entry-point set with
    a single seed (the chosen node). Traversal then proceeds normally
    through every reachable downstream node until the graph drains.

    ``single_node_id`` additionally prunes the adjacency list to the
    target's structural sub-tree (computed via ``_compute_subtree_boundary``)
    so outgoing edges that leave the sub-tree never enqueue successors.
    The two are mutually exclusive at the route/service layer.
    """
    session = _workbench_sessions.get(session_id)
    if not session:
        return

    with declared_type_scope(session.get("variable_types") or {}):
        session["skipped_node_ids"] = list(skipped_node_ids) if skipped_node_ids else []
        # Publish the live variables dict on the session so the terminal
        # callback (and sequential driver) can capture the end-of-run snapshot
        # for the Historical Test Canvas payload. Shared by reference - the
        # engine mutates this dict in place as plugins run.
        session["variables"] = variables

        is_adhoc = start_node_id is not None or single_node_id is not None
        # Stashed on the session so terminal helpers (`_broadcast_final_status`,
        # `_handle_workflow_cancellation`, `_handle_workflow_error`) can suppress
        # the test-level "execution started / completed / stopped" log lines that
        # would otherwise misframe an ad-hoc poke as a fresh full-test run.
        session["_is_adhoc"] = is_adhoc
        test_name = session.get("test_name", "Test")

        # Setup runs inside the boundary so a setup failure fails the run loudly, not a silent hang.
        try:
            full_adj = _build_adjacency_list(edges)
            node_map = {n["id"]: n for n in nodes}
            adj = _wb_common.entry_adjacency(single_node_id, full_adj, node_map)
            if single_node_id is not None:
                entry_points = [single_node_id]
            elif start_node_id is not None:
                entry_points = [start_node_id]
            else:
                node_id_set = {n["id"] for n in nodes}
                entry_points = _find_entry_points(edges, node_id_set)
            # Publish the live adjacency + node lookup so the skip-block service can
            # consult the paused node's element type and cascade non-'then' successors
            # when skipping a single-egress control parent.
            session["_adj"] = adj
            session["_node_map"] = node_map
            executable_nodes = _collect_reachable_nodes(entry_points, adj, node_map)
            total_blocks = len(executable_nodes)

            if not is_adhoc:
                _add_execution_log(
                    session_id,
                    "INFO",
                    f"Test '{test_name}' execution started ({total_blocks} blocks)",
                    "SYSTEM",
                    variant="success",
                )
                reveal_warning = _run_start_reveal_warning(nodes)
                if reveal_warning is not None:
                    _add_execution_log(
                        session_id, "WARN", reveal_warning, "SYSTEM", variant="warning"
                    )

            _ensure_output_variables(executable_nodes, variables)
            _inject_namespace_variables(
                variables,
                test_id=session.get("test_id", ""),
                suite_id=session.get("suite_id"),
                regression_id=session.get("regression_id"),
                registry=session.get("secret_registry"),
            )

            adhoc_start = single_node_id or start_node_id
            # The body membership reads the whole graph: a Run Current sub-tree drops the body edge.
            await run_adhoc_in_body(
                (
                    []
                    if adhoc_start is None
                    else [AdhocPlace(adhoc_start, full_adj, node_map, variables)]
                ),
                session,
                session_id,
                functools.partial(
                    _drain_and_finish,
                    session,
                    session_id,
                    list(entry_points),
                    node_map,
                    adj,
                    variables,
                    environment_id,
                    total_blocks,
                ),
            )

        except asyncio.CancelledError:
            await _handle_workflow_cancellation(session, session_id, test_name)
            raise
        except Exception as e:
            await _handle_workflow_error(session, session_id, test_name, e)


async def _drain_and_finish(
    session: dict[str, Any],
    session_id: str,
    entry_points: list[str],
    node_map: dict[str, dict[str, Any]],
    adj: dict[str, list[tuple[str, str | None]]],
    variables: dict[str, Any],
    environment_id: str,
    total_blocks: int,
) -> None:
    """Drain the run from its entry points, then broadcast its final status."""
    await _drain_workflow_queue(
        session,
        session_id,
        entry_points,
        set(),
        node_map,
        adj,
        variables,
        environment_id,
        0,
        total_blocks,
    )
    await _broadcast_final_status(session, session_id, session.get("test_name", "Test"))


async def _drain_workflow_queue(
    session: dict[str, Any],
    session_id: str,
    exec_queue: list[str],
    executed: set[str],
    node_map: dict[str, dict[str, Any]],
    adj: dict[str, list[tuple[str, str | None]]],
    variables: dict[str, Any],
    environment_id: str,
    current: int,
    total_blocks: int,
) -> None:
    """Drain the workflow queue, processing each node until empty or stopped.

    Per-iteration responsibilities:
      1. Skip nodes already in ``executed`` (duplicate enqueue).
      2. Delegate to ``_process_workflow_node``; route any exception to
         ``_handle_block_failure``.
      3. Honor the stopped sentinel (``current < 0``).
      4. Run the post-Step-Over completion hook so the engine re-pauses at
         the sibling-after when the stepped-over node finishes.
    """
    while exec_queue:
        node_id = exec_queue.pop(0)
        if node_id in executed:
            continue
        try:
            current = await _process_workflow_node(
                session,
                session_id,
                node_id,
                node_map,
                adj,
                executed,
                exec_queue,
                variables,
                environment_id,
                current,
                total_blocks,
            )
        except Exception as e:
            node = node_map.get(node_id)
            block_name = _extract_node_fields(node)["block_name"] if node else node_id
            # Settled before the failure reports the run ended, so history stores it too.
            executed.add(node_id)
            left_behind = [*exec_queue, *(child for child, _handle in adj.get(node_id, []))]
            await skip_rest(left_behind, adj, node_map, session, session_id, executed)
            await _handle_block_failure(session, session_id, node_id, block_name, e)
            return

        if current < 0:
            break

        _complete_step_over(session, node_id)
