"""While-loop body execution for workbench workflow engine.

REQ-3.5.1.17: While loop with condition
REQ-3.5.1.2: Break hook points
REQ-3.5.1.3: Continue hook points
"""

import asyncio
from typing import Any

from wavecore.api.services.workbench._common import (
    WorkbenchStatus,
    _add_execution_log,
    _broadcast_event,
    _push_single_variable_change,
)
from wavecore.api.services.workbench.block_source import node_source
from wavecore.api.services.workbench.for_loop import (
    LoopLanes,
    _consume_if_local_signal,
    _execute_body_chain_iteration,
    _finish_loop,
    _trace_body_chain,
)
from wavecore.controls.assertion_evaluator import evaluate_assertions


def _evaluate_while_condition(
    conditions: list[dict[str, Any]],
    variables: dict[str, Any],
) -> bool:
    """Evaluate the while-loop condition using the assertion evaluator.

    Empty conditions list evaluates to False (loop does not execute).
    """
    if not conditions:
        return False
    result = evaluate_assertions(conditions, variables)
    return result.passed


def _should_check_condition(is_do_while: bool, iteration: int) -> bool:
    """Determine if the condition should be checked this iteration."""
    return not is_do_while or iteration > 0


def _check_max_iterations(
    max_iterations: int | None,
    iteration: int,
    session: dict[str, Any],
    session_id: str,
    node_id: str,
) -> bool:
    """Check if max iterations reached. Returns True if limit hit (session fails)."""
    if max_iterations is None or iteration < max_iterations:
        return False
    _add_execution_log(
        session_id,
        "ERROR",
        f"[WHILE] Max iterations ({max_iterations}) reached - session fails",
        "SYSTEM",
        block_id=node_id,
    )
    session["status"] = WorkbenchStatus.FAILED.value
    return True


async def _update_index_variable(
    session_id: str,
    index_var_name: str,
    variables: dict[str, Any],
    iteration: int,
) -> None:
    """Update the index output variable if bound."""
    if index_var_name:
        variables[index_var_name] = iteration
        await _push_single_variable_change(session_id, index_var_name, iteration)


async def _run_body_and_check(
    body_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]] | None,
) -> str:
    """Execute body chain and return outcome: 'ok', 'error', 'break', 'continue', or 'stopped'."""
    if not body_chain:
        return "ok"
    result = await _execute_body_chain_iteration(
        body_chain,
        node_map,
        variables,
        session,
        session_id,
        executed,
        environment_id,
        log_prefix="While-loop",
        adj=adj,
    )
    if result in ("error", "break", "continue", "stopped"):
        return result
    return "ok"


def _handle_while_body_outcome(
    outcome: str,
    node_id: str,
    node_map: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
) -> str:
    """Process body outcome. Returns 'error', 'break', 'stopped', 'continue_parent', or 'ok'."""
    if outcome == "error":
        return "error"
    if outcome == "break":
        source = node_source(node_map.get(node_id, {}))
        _add_execution_log(session_id, "INFO", "Break - loop exited", source, block_id=node_id)
        return "break"
    if outcome == "stopped":
        return "stopped"
    if outcome == "continue":
        signal_target = session.get("_loop_signal_target")
        if signal_target and signal_target != node_id:
            return "continue_parent"
    return "ok"


async def _run_while_iteration_loop(
    mode: str,
    conditions: list[dict[str, Any]],
    max_iterations: int | None,
    output_bindings: dict[str, str],
    body_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    node_id: str,
    environment_id: str | None,
    adj: dict[str, list[tuple[str, str | None]]] | None = None,
) -> bool:
    """Run the while-loop iterations. Returns True if an error occurred."""
    _add_execution_log(
        session_id,
        "INFO",
        f"[WHILE] Starting loop (mode={mode})",
        "SYSTEM",
        block_id=node_id,
    )

    index_var_name = output_bindings.get("index", "")
    iteration = 0
    is_do_while = mode == "do-while"

    while True:
        await asyncio.sleep(0.001)
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            break

        if _should_check_condition(is_do_while, iteration):
            if not _evaluate_while_condition(conditions, variables):
                break

        if _check_max_iterations(max_iterations, iteration, session, session_id, node_id):
            return True

        await _update_index_variable(session_id, index_var_name, variables, iteration)

        _add_execution_log(
            session_id,
            "DEBUG",
            f"[WHILE] Iteration {iteration + 1} (index={iteration})",
            "SYSTEM",
            block_id=node_id,
        )
        await _broadcast_event(
            session_id,
            {
                "type": "loop_iteration",
                "block_id": node_id,
                "iteration": iteration + 1,
                "total": 0,
            },
        )

        outcome = await _run_body_and_check(
            body_chain,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
            adj,
        )
        action = _handle_while_body_outcome(outcome, node_id, node_map, session, session_id)
        if action == "error":
            return True
        if action in ("break", "stopped", "continue_parent"):
            break
        _consume_if_local_signal(outcome, node_id, session)

        iteration += 1

    await _update_index_variable(session_id, index_var_name, variables, iteration)

    return False


async def _execute_while_loop_body(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    mode: str,
    conditions: list[dict[str, Any]],
    max_iterations: int | None,
    output_bindings: dict[str, str],
    environment_id: str | None,
) -> bool:
    """Execute a while-loop: iterate body chain, then queue egress.

    Returns True if an error occurred (body failure or max_iterations hit).
    """
    lanes = LoopLanes.of(node_id, adj)
    body_chain = _trace_body_chain(lanes.body, adj, node_map, executed) if lanes.body else []

    error_occurred = await _run_while_iteration_loop(
        mode=mode,
        conditions=conditions,
        max_iterations=max_iterations,
        output_bindings=output_bindings,
        body_chain=body_chain,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        node_id=node_id,
        environment_id=environment_id,
        adj=adj,
    )

    return await _finish_loop(
        node_id, lanes, error_occurred, adj, node_map, session, session_id, executed, exec_queue
    )
