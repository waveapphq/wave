"""Parallel container dispatch for the workbench workflow engine.

Named branch lanes whose bodies run concurrently over the test's live
variables, plus an always-present 'then' egress that is the join. A branch
that fails, halts or outlives a time limit ends the section and stops its
siblings; the exit lane is skipped so the run stops there.
"""

import asyncio
import contextlib
import time
from dataclasses import dataclass
from typing import Any

from wavecore.api.services.workbench._common import (
    WorkbenchStatus,
    _add_execution_log,
    _broadcast_event,
)
from wavecore.api.services.workbench.block_status import leave_by_then, skip_rest
from wavecore.api.services.workbench.try_catch import (
    _execute_path_nodes,
    _map_handle_targets,
    _trace_handle_chain,
)
from wavecore.controls.flow import time_limit_ms

_JOIN_FIRST = "first"
# The two outcomes a lane reports about itself: each ends the section, and each
# is already logged and painted by the lane's own runner.
_SELF_REPORTED = frozenset({"failed", "expired"})


@dataclass
class _Branch:
    """One lane: its identity, its traced sub-flow and its own optional limit."""

    handle: str
    name: str
    chain: list[str]
    time_limit: int | None


@dataclass
class _ParallelScope:
    """Everything the branch runners share for one Parallel dispatch."""

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


def _branch_name(record: Any, index: int) -> str:
    """The name the run log and the lane tooltip use for a branch."""
    name = record.get("name") if isinstance(record, dict) else None
    return str(name).strip() if isinstance(name, str) and name.strip() else f"Branch {index + 1}"


def _branch_limit(record: Any) -> int | None:
    """A branch's own time limit in milliseconds, or None when unbounded."""
    if not isinstance(record, dict):
        return None
    return time_limit_ms(record.get("time_limit"))


def _trace_branches(scope: _ParallelScope, records: list[Any]) -> list[_Branch]:
    """Resolve every lane before forking, so no two runners race the trace."""
    branches: list[_Branch] = []
    for index, record in enumerate(records):
        handle = str(record.get("id") or "") if isinstance(record, dict) else str(record or "")
        branches.append(
            _Branch(
                handle=handle,
                name=_branch_name(record, index),
                # Force-clearing trace, so a section inside a loop re-runs its lanes.
                chain=_trace_handle_chain(
                    handle, scope.handle_targets, scope.adj, scope.node_map, scope.executed
                ),
                time_limit=_branch_limit(record),
            )
        )
    return branches


async def _run_branch(scope: _ParallelScope, branch: _Branch) -> str:
    """Run one lane's sub-flow. Returns done / failed / expired / halted."""
    _add_execution_log(
        scope.session_id,
        "INFO",
        f"Branch '{branch.name}' started",
        "SYSTEM",
        block_id=scope.node_id,
    )
    walk = _execute_path_nodes(
        branch.chain,
        scope.node_map,
        scope.variables,
        scope.session,
        scope.session_id,
        scope.executed,
        scope.environment_id,
        adj=scope.adj,
    )
    try:
        if branch.time_limit is None:
            error = await walk
        else:
            error = await asyncio.wait_for(walk, timeout=branch.time_limit / 1000)
    except TimeoutError:
        _add_execution_log(
            scope.session_id,
            "ERROR",
            f"Branch '{branch.name}' exceeded its time limit of {branch.time_limit} ms",
            "SYSTEM",
            block_id=scope.node_id,
        )
        await _paint_branch_stopped(scope, branch)
        return "expired"

    if error is not None:
        _add_execution_log(
            scope.session_id,
            "ERROR",
            f"Branch '{branch.name}' failed",
            "SYSTEM",
            block_id=scope.node_id,
        )
        return "failed"
    if scope.session.get("_halt"):
        return "halted"
    return "done"


async def _paint_branch_stopped(scope: _ParallelScope, branch: _Branch) -> None:
    """The lane's in-flight block paints stopped; what it never reached, skipped."""
    unreached: list[str] = []
    for node_id in branch.chain:
        state = scope.session["block_states"].get(node_id)
        if state is None:
            # A canceled block may have joined ``executed`` without ever reporting a state.
            scope.executed.discard(node_id)
            unreached.append(node_id)
            continue
        if state != "running":
            continue
        scope.executed.add(node_id)
        scope.session["block_states"][node_id] = "stopped"
        await _broadcast_event(
            scope.session_id,
            {
                "type": "block_status_changed",
                "block_id": node_id,
                "block_name": str(
                    scope.node_map.get(node_id, {}).get("data", {}).get("label", node_id)
                ),
                "status": "stopped",
            },
        )
    await skip_rest(
        unreached, scope.adj, scope.node_map, scope.session, scope.session_id, scope.executed
    )


async def _settle_branches(
    scope: _ParallelScope,
    pending: set["asyncio.Task[str]"],
    owners: dict["asyncio.Task[str]", _Branch],
) -> None:
    """Cancel each lane still working, then report every lane the section cut short.

    A lane whose walk ended before its last node - canceled here, or broken out
    of by a sibling's halt - is stopped: what it held paints stopped, what it
    never reached paints skipped.
    """
    # A Stop paints running blocks before the cancel lands; the lane still counts as cut short.
    cut_short = {task for task in pending if not task.done()}
    for task in pending:
        task.cancel()
    states = scope.session["block_states"]
    for task, branch in owners.items():
        if task in pending:
            with contextlib.suppress(asyncio.CancelledError):
                await task
            outcome = "stopped"
        else:
            outcome = task.result()
        # A node joins ``executed`` when it starts, so settle on recorded state.
        unsettled = task in cut_short or any(
            states.get(node_id) in (None, "running") for node_id in branch.chain
        )
        if outcome in _SELF_REPORTED or not unsettled:
            continue
        _add_execution_log(
            scope.session_id,
            "WARN",
            f"Branch '{branch.name}' stopped",
            "SYSTEM",
            block_id=scope.node_id,
        )
        await _paint_branch_stopped(scope, branch)


async def _join_branches(
    scope: _ParallelScope,
    branches: list[_Branch],
    join_mode: str,
    time_limit: int | None,
) -> bool:
    """Fork every lane, release the join per the mode. True when the section failed."""
    owners: dict[asyncio.Task[str], _Branch] = {
        asyncio.create_task(_run_branch(scope, branch)): branch for branch in branches
    }
    pending: set[asyncio.Task[str]] = set(owners)
    deadline = None if time_limit is None else time.monotonic() + time_limit / 1000
    failed = False

    try:
        while pending:
            timeout = None if deadline is None else max(deadline - time.monotonic(), 0.0)
            done, pending = await asyncio.wait(
                pending, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                _add_execution_log(
                    scope.session_id,
                    "ERROR",
                    f"Parallel section exceeded its time limit of {time_limit} ms",
                    "SYSTEM",
                    block_id=scope.node_id,
                )
                failed = True
                break
            failed = failed or any(task.result() in _SELF_REPORTED for task in done)
            if failed or scope.session.get("_halt") or join_mode == _JOIN_FIRST:
                break
    except asyncio.CancelledError:
        # A Stop must not leave a lane running: every lane settles before the cancel goes up.
        await _settle_branches(scope, pending, owners)
        raise

    await _settle_branches(scope, pending, owners)
    return failed


async def _queue_then_egress(scope: _ParallelScope, section_failed: bool) -> None:
    """Queue the guaranteed 'then' successor, or skip it when the section ended."""
    # A break/continue aimed at an enclosing loop skips this iteration's egress.
    signal_target = scope.session.get("_loop_signal_target")
    parent_signal = bool(signal_target) and signal_target != scope.node_id
    await leave_by_then(
        scope.handle_targets.get("then"),
        parent_signal or section_failed or bool(scope.session.get("_halt")),
        scope.exec_queue,
        scope.adj,
        scope.node_map,
        scope.session,
        scope.session_id,
        scope.executed,
    )


async def execute_parallel_branches(
    *,
    node_id: str,
    adj: dict[str, list[tuple[str, str | None]]],
    node_map: dict[str, Any],
    variables: dict[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
    exec_queue: list[str],
    branches: list[Any],
    join_mode: str,
    time_limit: int | None,
    environment_id: str | None,
) -> bool:
    """Run every branch body concurrently, then the 'then' egress. True on error."""
    scope = _ParallelScope(
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

    section_failed = await _join_branches(
        scope, _trace_branches(scope, branches), join_mode, time_limit
    )
    # The verdict belongs to the section, not to whatever is wired after it.
    if section_failed:
        session["status"] = WorkbenchStatus.FAILED.value
    await _queue_then_egress(scope, section_failed)
    return section_failed
