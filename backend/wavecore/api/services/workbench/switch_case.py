"""Switch/Case container dispatch for the workbench workflow engine.

Ordered condition-guarded case branches with a per-case break, an optional
trailing default, and an always-present 'then' egress.
"""

from dataclasses import dataclass
from typing import Any

from wavecore.api.services.workbench._common import (
    WorkbenchStatus,
    _add_execution_log,
)
from wavecore.api.services.workbench.block_source import node_source
from wavecore.api.services.workbench.block_status import leave_by_then, skip_lanes_not_run
from wavecore.api.services.workbench.nested import has_session_signal
from wavecore.api.services.workbench.try_catch import (
    _execute_path_nodes,
    _map_handle_targets,
    _trace_handle_chain,
)
from wavecore.controls.assertion_evaluator import evaluate_assertions


@dataclass
class _SwitchScope:
    """Everything the branch runners share for one Switch dispatch."""

    node_id: str
    adj: dict[str, list[tuple[str, str | None]]]
    node_map: dict[str, Any]
    variables: dict[str, Any]
    session: dict[str, Any]
    session_id: str
    executed: set[str]
    exec_queue: list[str]
    environment_id: str | None
    handle_targets: dict[str, str]


def _branch_display(branch: dict[str, Any], index: int) -> str:
    """The name the run log uses for a taken branch."""
    return str(branch.get("label") or f"{branch.get('type')} (branch {index + 1})")


async def _run_branch(scope: _SwitchScope, branch: dict[str, Any], index: int) -> Exception | None:
    """Log the taken branch and run its scoped sub-flow."""
    _add_execution_log(
        scope.session_id,
        "INFO",
        f"Branch taken: {_branch_display(branch, index)}",
        node_source(scope.node_map.get(scope.node_id, {})),
        block_id=scope.node_id,
    )
    # Force-clearing trace, so a Switch inside a loop re-runs its case bodies.
    chain = _trace_handle_chain(
        str(branch.get("id") or ""),
        scope.handle_targets,
        scope.adj,
        scope.node_map,
        scope.executed,
    )
    return await _execute_path_nodes(
        chain,
        scope.node_map,
        scope.variables,
        scope.session,
        scope.session_id,
        scope.executed,
        scope.environment_id,
        adj=scope.adj,
    )


async def _run_branches(scope: _SwitchScope, branches: list[dict[str, Any]]) -> tuple[bool, bool]:
    """Walk branches top-down. Returns (a branch ran, a chain errored).

    The default carries no condition, so whether it is reached by fall-through
    or by nothing having matched, reaching it means running it.
    """
    ran = False
    for index, branch in enumerate(branches):
        is_case = branch.get("type") == "case"
        # Evaluated only now: an earlier case's sub-flow may have moved the target.
        if (
            is_case
            and not evaluate_assertions(branch.get("conditions") or [], scope.variables).passed
        ):
            continue
        ran = True
        error = await _run_branch(scope, branch, index)
        if error is not None:
            return True, True
        if scope.session.get("_halt") or has_session_signal(scope.session):
            return True, False
        if not is_case or branch.get("break", True):
            return True, False
    return ran, False


async def _queue_then_egress(scope: _SwitchScope, error_occurred: bool) -> None:
    """Queue the guaranteed 'then' successor, or skip it on error/parent signal."""
    # A break/continue aimed at an enclosing loop skips this iteration's egress.
    signal_target = scope.session.get("_loop_signal_target")
    parent_signal = bool(signal_target) and signal_target != scope.node_id
    await leave_by_then(
        scope.handle_targets.get("then"),
        parent_signal or error_occurred,
        scope.exec_queue,
        scope.adj,
        scope.node_map,
        scope.session,
        scope.session_id,
        scope.executed,
    )


async def _execute_switch_paths(
    *,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    branches: list[dict[str, Any]],
    environment_id: str | None,
) -> bool:
    """Run the matching case chains, then the 'then' egress. True on error."""
    scope = _SwitchScope(
        node_id=node_id,
        adj=adj,
        node_map=node_map,
        variables=variables,
        session=session,
        session_id=session_id,
        executed=executed,
        exec_queue=exec_queue,
        environment_id=environment_id,
        handle_targets=_map_handle_targets(adj.get(node_id, [])),
    )

    ran, error_occurred = await _run_branches(scope, branches)
    if not ran:
        _add_execution_log(
            scope.session_id, "INFO", "No case matched", "SYSTEM", block_id=scope.node_id
        )

    lanes = [scope.handle_targets.get(str(branch.get("id") or "")) for branch in branches]
    # Runs after each matched chain, so a block a taken case reaches keeps its real status.
    await skip_lanes_not_run(
        [lane for lane in lanes if lane not in scope.executed],
        [*(lane for lane in lanes if lane in scope.executed), scope.handle_targets.get("then")],
        scope.adj,
        scope.node_map,
        scope.session,
        scope.session_id,
        scope.executed,
    )
    # The verdict belongs to the case chain, not to whatever is wired after it.
    if error_occurred:
        session["status"] = WorkbenchStatus.FAILED.value
    await _queue_then_egress(scope, error_occurred)
    return error_occurred
