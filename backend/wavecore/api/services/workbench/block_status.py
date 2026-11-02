"""Storing a block skipped and painting it skipped on the live canvas, as one step.

A page reload paints the canvas from the stored block states and a live run paints it from
the status events, so every skipped state the engine records goes through here.
"""

from collections.abc import Iterable, Mapping
from collections.abc import Set as AbstractSet
from typing import Any

from wavecore.api.services.workbench._common import WorkbenchStatus, _broadcast_event
from wavecore.api.services.workbench.node_helpers import _extract_node_fields


def block_name_of(node_map: Mapping[str, Any], block_id: str) -> str:
    """The name a block's status event carries."""
    node = node_map.get(block_id)
    return str(_extract_node_fields(dict(node))["block_name"]) if node else block_id


async def paint_skipped(
    session: dict[str, Any], session_id: str, block_id: str, block_name: str
) -> None:
    """Store a block skipped and paint it skipped on the live canvas."""
    status = WorkbenchStatus.SKIPPED.value
    session["block_states"][block_id] = status
    await _broadcast_event(
        session_id,
        {
            "type": "block_status_changed",
            "block_id": block_id,
            "block_name": block_name,
            "status": status,
        },
    )


async def skip_unrun(
    block_ids: Iterable[str],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Store and paint skipped each block not yet run in this pass; a run block keeps its result."""
    for block_id in block_ids:
        if block_id in executed:
            continue
        executed.add(block_id)
        await paint_skipped(session, session_id, block_id, block_name_of(node_map, block_id))


def lane_blocks(
    starts: Iterable[str | None],
    adj: Mapping[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    stop: AbstractSet[str] = frozenset(),
) -> list[str]:
    """Every block reachable from ``starts`` along any link, never entering ``stop``."""
    order: list[str] = []
    seen: set[str] = set()
    queue = [start for start in starts if start]
    while queue:
        block_id = queue.pop(0)
        if block_id in seen or block_id in stop:
            continue
        seen.add(block_id)
        node = node_map.get(block_id)
        if node is not None and node.get("type") != "workflowNode":
            continue
        order.append(block_id)
        queue.extend(child for child, _handle in adj.get(block_id, []))
    return order


async def skip_lanes_not_run(
    not_run: Iterable[str | None],
    ran: Iterable[str | None],
    adj: Mapping[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Store and paint skipped the lanes a container did not run, up to a lane that ran."""
    kept = set(lane_blocks(ran, adj, node_map))
    blocks = lane_blocks(not_run, adj, node_map, kept)
    await skip_unrun(blocks, node_map, session, session_id, executed)


async def skip_lane_never_run(
    lane: str | None,
    then_target: str | None,
    adj: Mapping[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """A body or retry lane that ran zero times paints skipped; one that ran keeps its results."""
    if not lane or lane in executed or session.get("status") == WorkbenchStatus.STOPPED.value:
        return
    await skip_lanes_not_run([lane], [then_target], adj, node_map, session, session_id, executed)


async def skip_rest(
    starts: Iterable[str | None],
    adj: Mapping[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Store and paint skipped what a cut-off lane never reached, up to a block that already ran."""
    blocks = lane_blocks(starts, adj, node_map, frozenset(executed))
    await skip_unrun(blocks, node_map, session, session_id, executed)


async def leave_by_then(
    then_target: str | None,
    skip: bool,
    exec_queue: list[str],
    adj: Mapping[str, list[tuple[str, str | None]]],
    node_map: Mapping[str, Any],
    session: dict[str, Any],
    session_id: str,
    executed: set[str],
) -> None:
    """Queue a container's `then` successor, or skip all it leads to when ``skip``."""
    if not then_target or then_target in executed:
        return
    if skip:
        await skip_rest([then_target], adj, node_map, session, session_id, executed)
    else:
        exec_queue.append(then_target)
