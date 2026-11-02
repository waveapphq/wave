"""For-each body execution for workbench workflow engine.

REQ-3.5.1.16: For-Each loop with typed envelope iteration
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
from wavecore.api.services.workbench.for_loop import (
    LoopLanes,
    _execute_body_chain_iteration,
    _finish_loop,
    _handle_iteration_result,
    _trace_body_chain,
)
from wavecore.controls.loop import _wrap_item


async def _push_for_each_variables(
    session_id: str,
    item_var_name: str,
    index_var_name: str,
    variables: dict[str, Any],
    envelope: dict[str, Any],
    iteration: int,
) -> None:
    """Push item and index variable updates for the current iteration."""
    if item_var_name:
        variables[item_var_name] = envelope
        await _push_single_variable_change(session_id, item_var_name, envelope)
    if index_var_name:
        variables[index_var_name] = iteration
        await _push_single_variable_change(session_id, index_var_name, iteration)


async def _run_for_each_iteration_loop(
    collection: list[Any],
    item_variable: str,
    index_variable: str,
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
    """Run the for-each iterations. Returns True if an error occurred."""
    total = len(collection)
    _add_execution_log(
        session_id,
        "INFO",
        f"[FOR-EACH] Starting loop ({total} iterations)",
        "SYSTEM",
        block_id=node_id,
    )

    item_var_name = output_bindings.get(item_variable, "")
    index_var_name = output_bindings.get(index_variable, "")

    for iteration, raw_item in enumerate(collection):
        await asyncio.sleep(0.001)
        if session.get("status") == WorkbenchStatus.STOPPED.value:
            break

        envelope = _wrap_item(raw_item)
        await _push_for_each_variables(
            session_id, item_var_name, index_var_name, variables, envelope, iteration
        )

        _add_execution_log(
            session_id,
            "DEBUG",
            f"[FOR-EACH] Iteration {iteration + 1}/{total}",
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
            environment_id,
            log_prefix="For-each",
            adj=adj,
        )
        action = _handle_iteration_result(result, node_id, node_map, session, session_id)
        if action == "error":
            return True
        if action == "break":
            break

    return False


async def _execute_for_each_body(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    collection: list[Any],
    item_variable: str,
    index_variable: str,
    output_bindings: dict[str, str],
    environment_id: str | None,
) -> bool:
    """Execute a for-each loop: iterate body chain, then queue egress.

    Returns True if an error occurred (body failure).
    """
    lanes = LoopLanes.of(node_id, adj)
    body_chain = _trace_body_chain(lanes.body, adj, node_map, executed) if lanes.body else []

    error_occurred = await _run_for_each_iteration_loop(
        collection=collection,
        item_variable=item_variable,
        index_variable=index_variable,
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
