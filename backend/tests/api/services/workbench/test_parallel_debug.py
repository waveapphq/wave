"""Debug pause parks the whole Parallel section (REQ-3.2.3.9).

Debugging keeps a single cursor: the first branch to reach a pause trigger
becomes the paused block and every sibling stops advancing at its next block
boundary. Step drives the paused branch alone, Continue releases the section,
and a sibling that was itself holding at a trigger surfaces as the paused
block next.
"""

import asyncio
import contextlib
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    log_messages,
    log_node,
    parallel_node,
    setter_node,
    start_graph,
    wait_for_any_pause,
    wait_until_paused,
)
from tests.api.services.workbench.slot_harness import for_node
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

pytestmark = pytest.mark.usefixtures("engine_registries")

# Long enough that an unparked sibling would run its whole four-block chain.
_PARK_SETTLE_SECONDS = 0.3


def _parked_section_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Branch 1 holds two nodes; branch 2 holds four counter bumps."""
    nodes = [
        parallel_node("par-1", [branch("branch_1", "stepped"), branch("branch_2", "parked")]),
        setter_node("br-a-1", "A1", {"a_count": "a_count + 1"}, expressions=True),
        setter_node("br-a-2", "A2", {"a_count": "a_count + 1"}, expressions=True),
        setter_node("br-b-1", "B1", {"b_count": "b_count + 1"}, expressions=True),
        setter_node("br-b-2", "B2", {"b_count": "b_count + 1"}, expressions=True),
        setter_node("br-b-3", "B3", {"b_count": "b_count + 1"}, expressions=True),
        setter_node("br-b-4", "B4", {"b_count": "b_count + 1"}, expressions=True),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-a-1", "branch_1"),
        edge("br-a-1", "br-a-2"),
        edge("par-1", "br-b-1", "branch_2"),
        edge("br-b-1", "br-b-2"),
        edge("br-b-2", "br-b-3"),
        edge("br-b-3", "br-b-4"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


def _counters() -> dict[str, Any]:
    return {"a_count": 0, "b_count": 0}


class TestABreakpointParksTheSection:
    """The section parks around the first branch to pause."""

    async def test_the_sibling_stops_advancing_while_a_branch_is_paused(self) -> None:
        """A parked sibling advances at most to its next block boundary."""
        # Guard: without parking the sibling runs its whole chain during the pause.
        session_id = "par-debug-park"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")
        assert session["paused_node_id"] == "br-a-1", session.get("paused_node_id")

        await asyncio.sleep(_PARK_SETTLE_SECONDS)
        parked_count = variables["b_count"]

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert parked_count <= 1, parked_count

    async def test_continue_releases_every_parked_branch(self) -> None:
        """Continue resumes the paused branch and its parked siblings."""
        session_id = "par-debug-continue"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert variables["a_count"] == 2, variables
        assert variables["b_count"] == 4, variables
        assert messages.count("AFTER") == 1, messages

    async def test_the_section_node_keeps_its_running_treatment_while_parked(self) -> None:
        """The Parallel node itself is not repainted by a pause inside a branch."""
        session_id = "par-debug-node-state"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")
        parked_state = session["block_states"].get("par-1")

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert parked_state == "running", parked_state


class TestStepDrivesThePausedBranchAlone:
    """Step advances the paused branch; parked siblings stay parked."""

    async def test_step_re_pauses_inside_the_same_branch(self) -> None:
        """The cursor stays in the branch it was in."""
        session_id = "par-debug-step"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")

        workbench_service.step_into(session_id=session_id)
        await wait_until_paused(session, "br-a-2")
        stepped_to = session.get("paused_node_id")

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert stepped_to == "br-a-2", stepped_to

    async def test_step_does_not_release_the_parked_sibling(self) -> None:
        """Step is not Continue - the sibling holds where it was."""
        # Guard: a session-wide step flag must not be consumed by a parked sibling.
        session_id = "par-debug-step-sibling"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")

        workbench_service.step_into(session_id=session_id)
        await wait_until_paused(session, "br-a-2")
        await asyncio.sleep(_PARK_SETTLE_SECONDS)
        parked_count = variables["b_count"]

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert parked_count <= 1, parked_count
        assert variables["b_count"] == 4, variables


def _single_block_branch_graph() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Branch 1 holds exactly one node; branch 2 holds four counter bumps."""
    nodes, edges = _parked_section_graph()
    nodes = [node for node in nodes if node["id"] != "br-a-2"]
    edges = [e for e in edges if e["target"] != "br-a-2"]
    return nodes, edges


class TestStepOverInsideABranch:
    """A scoped path must end a Step Over the way the main walker does."""

    async def test_step_over_re_pauses_at_the_next_block_in_the_branch(self) -> None:
        """Step Over lands on the branch's next block, not on nothing."""
        session_id = "par-debug-step-over"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")

        workbench_service.step_over(session_id=session_id)
        await wait_until_paused(session, "br-a-2")
        stepped_to = session.get("paused_node_id")

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert stepped_to == "br-a-2", stepped_to
        assert session["status"] == "passed", session.get("status")
        assert variables["b_count"] == 4, variables

    async def test_stepping_off_the_last_block_of_a_branch_releases_the_section(self) -> None:
        """A branch that ends mid-step must not park its siblings forever."""
        # Guard: the stepped branch dies still holding the section, so the hold
        # has to lapse with its owner or the run deadlocks.
        session_id = "par-debug-step-over-tail"
        nodes, edges = _single_block_branch_graph()
        variables = _counters()

        session, task = start_graph(session_id, nodes, edges, variables, breakpoints={"br-a-1"})
        await wait_until_paused(session, "br-a-1")

        workbench_service.step_over(session_id=session_id)
        released_at = await wait_for_any_pause(session)
        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert released_at is not None and released_at.startswith("br-b-"), released_at
        assert session["status"] == "passed", session.get("status")
        assert variables["a_count"] == 1, variables
        assert variables["b_count"] == 4, variables


class TestSeveralBreakpointsInOneSection:
    """Breakpoints inside one section surface one after another."""

    async def test_a_second_breakpointed_branch_surfaces_after_continue(self) -> None:
        """The held sibling becomes the paused block once the section is released."""
        session_id = "par-debug-two-breakpoints"
        nodes, edges = _parked_section_graph()
        variables = _counters()

        session, task = start_graph(
            session_id,
            nodes,
            edges,
            variables,
            breakpoints={"br-a-1", "br-b-3"},
        )
        await wait_until_paused(session, "br-a-1")

        workbench_service.continue_session(session_id=session_id)
        await wait_until_paused(session, "br-b-3")
        second_pause = session.get("paused_node_id")

        workbench_service.continue_session(session_id=session_id)
        await asyncio.wait_for(task, timeout=10.0)

        assert second_pause == "br-b-3", second_pause
        assert session["status"] == "passed", session.get("status")
        assert variables["b_count"] == 4, variables


class TestParkingEndsWithTheRun:
    """A parked branch must never outlive the run it belongs to."""

    async def test_a_stopped_run_releases_a_parked_branch(self) -> None:
        """Stop is the other way out of a park, besides the holder finishing."""
        holder: asyncio.Task[None] = asyncio.create_task(asyncio.sleep(30))
        session: dict[str, Any] = {"_debug_hold": holder, "status": "stopped"}
        try:
            await asyncio.wait_for(_wb_common.park_while_held(session), timeout=2.0)
        finally:
            holder.cancel()

        assert session["_debug_hold"] is holder, session


def _loop_lane_and_breakpoint_lane() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Lane 1 runs a For whose body is a slow Delay then a Log; lane 2 holds one Log."""
    nodes = [
        parallel_node("par-1", [branch("branch_1", "looping"), branch("branch_2", "paused")]),
        for_node("loop-a", 1),
        delay_node("slow", 150, "Slow"),
        log_node("a-log", "A Log", "'A-RAN'"),
        log_node("b", "B", "'B-RAN'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "loop-a", "branch_1"),
        edge("loop-a", "slow", "body"),
        edge("slow", "a-log"),
        edge("par-1", "b", "branch_2"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


async def _poll(check: Any, ticks: int = 300) -> None:
    for _ in range(ticks):
        if check():
            return
        await asyncio.sleep(0.01)


class TestRepeatStepInConcurrentLanes:
    """Repeat Step reruns the paused block, whatever a sibling lane ran meanwhile."""

    async def test_it_reruns_only_the_paused_lane_block(self) -> None:
        session_id = "par-debug-repeat-lanes"
        nodes, edges = _loop_lane_and_breakpoint_lane()
        session, task = start_graph(session_id, nodes, edges, {"i": None}, breakpoints={"b"})
        try:
            await wait_until_paused(session, "b")
            await _poll(lambda: session["block_states"].get("loop-a") == "passed")
            assert log_messages(session_id).count("A-RAN") == 1, log_messages(session_id)

            workbench_service.repeat_step(session_id=session_id)
            await _poll(
                lambda: any(m.startswith("⟳ Repeated 'B'") for m in log_messages(session_id))
            )
            messages = log_messages(session_id)
            assert (messages.count("B-RAN"), messages.count("A-RAN")) == (1, 1), "\n".join(messages)
            assert session["paused_node_id"] == "b", messages

            workbench_service.continue_session(session_id=session_id)
            await asyncio.wait_for(task, timeout=5.0)
        finally:
            if not task.done():
                session["status"] = "stopped"
                session["pause_event"].set()
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await asyncio.wait_for(task, timeout=2)

        messages = log_messages(session_id)
        assert session["status"] == "passed", messages
        # Continue proceeds from the repeat's result without running B again (REQ-3.2.1.4).
        assert (messages.count("B-RAN"), messages.count("A-RAN")) == (1, 1), messages
        assert messages.count("AFTER") == 1, messages
