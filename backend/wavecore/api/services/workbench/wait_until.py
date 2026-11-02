"""Wait Until round execution for the workbench workflow engine.

Condition-gated rounds bounded by a wall-clock deadline, an optional retry
sub-flow run between checks, and an always-present 'then' egress.
"""

import asyncio
import math
import time
from dataclasses import dataclass
from typing import Any

from wavecore.api.services.workbench._common import (
    WorkbenchStatus,
    _add_execution_log,
    _push_variable_changes,
)
from wavecore.api.services.workbench.block_status import leave_by_then, skip_lane_never_run
from wavecore.api.services.workbench.for_loop import (
    _consume_loop_signals,
    _execute_body_chain_iteration,
    _handle_parent_loop_signal,
    _trace_body_chain,
)
from wavecore.api.services.workbench.signals import _assign_output_bindings
from wavecore.api.services.workbench.try_catch import _map_handle_targets
from wavecore.controls.assertion_evaluator import evaluate_assertions

# Granularity of the interruptible interval sleep: a stopped session must leave
# the wait without sitting out the whole check interval.
_STOP_POLL_SECONDS = 0.01

_DEFAULT_GIVE_UP_REASON = "condition not met"


@dataclass
class WaitSpec:
    """The configured wait, as the control's signals declare it."""

    conditions: list[dict[str, Any]]
    timeout_ms: int
    check_interval_ms: int
    message: str | None
    fail_scope: bool
    output_bindings: dict[str, str]

    @classmethod
    def from_signals(cls, signals: dict[str, Any], output_bindings: dict[str, str]) -> "WaitSpec":
        return cls(
            conditions=signals.get("condition") or [],
            timeout_ms=signals.get("wait_timeout") or 0,
            check_interval_ms=signals.get("check_interval") or 1000,
            message=signals.get("wait_message"),
            fail_scope=bool(signals.get("wait_fail_scope")),
            output_bindings=output_bindings,
        )


def _evaluate_wait_condition(
    conditions: list[dict[str, Any]],
    variables: dict[str, Any],
) -> bool:
    """Evaluate the wait condition using the assertion evaluator.

    An empty condition list evaluates False, so an unconfigured wait cannot
    pass by accident.
    """
    if not conditions:
        return False
    return evaluate_assertions(conditions, variables).passed


def _resolve_wait_targets(
    outgoing: list[tuple[str, str | None]],
) -> tuple[str | None, str | None]:
    """Return the (retry, egress) targets. Watch mode leaves by the default handle."""
    handle_targets = _map_handle_targets(outgoing)
    then_target = handle_targets.get("then")
    if then_target is None:
        then_target = next((child for child, handle in outgoing if handle is None), None)
    return handle_targets.get("retry"), then_target


def _elapsed_ms(start_monotonic: float) -> int:
    return int(math.ceil((time.monotonic() - start_monotonic) * 1000))


def _is_stopped(session: dict[str, Any]) -> bool:
    return bool(session.get("status") == WorkbenchStatus.STOPPED.value)


async def _sleep_until_next_check(
    check_interval_ms: int,
    deadline_monotonic: float,
    session: dict[str, Any],
) -> None:
    """Sleep the check interval without overrunning the deadline or a stop."""
    until = min(time.monotonic() + check_interval_ms / 1000.0, deadline_monotonic)
    while time.monotonic() < until:
        if _is_stopped(session):
            return
        await asyncio.sleep(min(_STOP_POLL_SECONDS, until - time.monotonic()))


async def _run_retry_round(
    retry_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    environment_id: str | None,
    deadline_monotonic: float,
    adj: dict[str, list[tuple[str, str | None]]] | None,
) -> str:
    """Run the retry sub-flow once, bounded by the deadline.

    A break or continue raised inside the lane always targets an enclosing
    loop - the lane hangs off a `retry` handle, which the loop-target selector
    never offers - so it ends the wait and travels on untouched.
    """
    if not retry_chain:
        return "ok"
    try:
        return await asyncio.wait_for(
            _execute_body_chain_iteration(
                retry_chain,
                node_map,
                variables,
                session,
                session_id,
                executed,
                environment_id,
                log_prefix="Wait-until",
                adj=adj,
            ),
            timeout=deadline_monotonic - time.monotonic(),
        )
    except TimeoutError:
        return "cut-short"


async def _run_wait_rounds(
    conditions: list[dict[str, Any]],
    retry_chain: list[str],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    node_id: str,
    environment_id: str | None,
    deadline_monotonic: float,
    check_interval_ms: int,
    adj: dict[str, list[tuple[str, str | None]]] | None,
) -> tuple[bool, int, str]:
    """Run the wait rounds. Returns (passed, elapsed_ms, outcome)."""
    start = time.monotonic()
    round_number = 0

    while True:
        if _is_stopped(session):
            return False, _elapsed_ms(start), "stopped"
        if _evaluate_wait_condition(conditions, variables):
            return True, _elapsed_ms(start), "ok"
        if time.monotonic() >= deadline_monotonic:
            return False, _elapsed_ms(start), "timeout"

        round_number += 1
        _add_execution_log(
            session_id,
            "DEBUG",
            f"[WAIT] Round {round_number} - condition not met",
            "SYSTEM",
            block_id=node_id,
        )

        outcome = await _run_retry_round(
            retry_chain,
            node_map,
            variables,
            session,
            session_id,
            executed,
            environment_id,
            deadline_monotonic,
            adj,
        )
        if outcome != "ok":
            return False, _elapsed_ms(start), outcome

        await _sleep_until_next_check(check_interval_ms, deadline_monotonic, session)


async def _report_wait_outcome(
    passed: bool,
    elapsed_ms: int,
    message: str | None,
    fail_scope: bool,
    session: dict[str, Any],
    session_id: str,
    node_id: str,
    node_map: dict[str, Any],
    cut_short: bool,
) -> str:
    """Write the run-log line and return the block status; a failing give-up raises."""
    if passed:
        _add_execution_log(
            session_id,
            "INFO",
            f"[WAIT] Condition met after {elapsed_ms} ms",
            "SYSTEM",
            block_id=node_id,
        )
        return "passed"

    if cut_short:
        from wavecore.api.services.workbench.execution import _mark_running_body_nodes_stopped

        await _mark_running_body_nodes_stopped(
            session,
            session_id,
            f"Stopped by the wait timeout after {elapsed_ms} ms",
            node_map,
            node_id,
        )

    reason = f"Gave up after {elapsed_ms} ms: {message or _DEFAULT_GIVE_UP_REASON}"
    if fail_scope:
        _add_execution_log(session_id, "ERROR", f"[WAIT] {reason}", "SYSTEM", block_id=node_id)
        # A block failure: the walker paints it failed and its flow stops.
        raise TimeoutError(reason)
    _add_execution_log(session_id, "WARN", f"[WAIT] {reason}", "SYSTEM", block_id=node_id)
    return "warning"


async def _bind_wait_outputs(
    passed: bool,
    elapsed_ms: int,
    output_bindings: dict[str, str],
    variables: dict[str, Any],
    session_id: str,
    block_name: str,
    node_id: str,
) -> None:
    vars_before = variables.copy()
    written = _assign_output_bindings(
        {"passed": passed, "elapsed": elapsed_ms},
        output_bindings,
        variables,
        session_id,
        block_name,
        node_id,
    )
    await _push_variable_changes(session_id, vars_before, variables, written)


async def _execute_wait_until_body(
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    spec: WaitSpec,
    environment_id: str | None,
) -> str:
    """Run a Wait Until: rounds, outcome, egress.

    Returns the node's block status, or "error" when the retry sub-flow failed.
    """
    outgoing = adj.get(node_id, [])
    retry_target, then_target = _resolve_wait_targets(outgoing)

    retry_chain: list[str] = []
    if retry_target:
        retry_chain = _trace_body_chain(retry_target, adj, node_map, executed)

    _add_execution_log(
        session_id,
        "INFO",
        f"[WAIT] Waiting for condition (timeout={spec.timeout_ms} ms, "
        f"interval={spec.check_interval_ms} ms)",
        "SYSTEM",
        block_id=node_id,
    )

    passed, elapsed_ms, outcome = await _run_wait_rounds(
        spec.conditions,
        retry_chain,
        node_map,
        variables,
        session,
        session_id,
        executed,
        node_id,
        environment_id,
        time.monotonic() + spec.timeout_ms / 1000.0,
        spec.check_interval_ms,
        adj,
    )
    error_occurred = outcome == "error"
    if error_occurred:
        # The verdict belongs to the retry sub-flow, not to whatever is wired after the wait.
        session["status"] = WorkbenchStatus.FAILED.value
    await skip_lane_never_run(
        retry_target, then_target, adj, node_map, session, session_id, executed
    )

    parent_result = await _handle_parent_loop_signal(
        node_id, then_target, adj, node_map, session, session_id, executed, error_occurred
    )
    if parent_result is not None:
        return "failed" if parent_result else "passed"

    _consume_loop_signals(session)

    block_name = (node_map.get(node_id, {}).get("data") or {}).get("label", node_id)
    if error_occurred:
        status = "error"
    elif outcome == "stopped":
        status = WorkbenchStatus.STOPPED.value
    else:
        await _bind_wait_outputs(
            passed, elapsed_ms, spec.output_bindings, variables, session_id, block_name, node_id
        )
        status = await _report_wait_outcome(
            passed,
            elapsed_ms,
            spec.message,
            spec.fail_scope,
            session,
            session_id,
            node_id,
            node_map,
            cut_short=outcome == "cut-short",
        )

    await leave_by_then(
        then_target, error_occurred, exec_queue, adj, node_map, session, session_id, executed
    )
    return status
