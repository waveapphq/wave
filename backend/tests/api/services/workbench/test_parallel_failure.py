"""Failure, Halt and Assert inside a Parallel branch (REQ-3.2.3.8).

A failed branch fails the section, stops its running siblings at their next
block boundary and skips the exit lane, so the run stops there. Try/Catch
inside a branch is how a failure is tolerated. A split Assert with Fail Current Scope
is not a branch failure: it marks the run failed and the flow carries on down its fail
branch. A single-mode one is a block failure and fails its branch like any other.
"""

import time
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    assert_node,
    branch,
    delay_node,
    edge,
    engine_registries,
    halt_node,
    log_messages,
    log_node,
    make_node,
    parallel_node,
    run_graph,
    setter_node,
    try_catch_node,
)
from wavecore.api.services.workbench import block_status as block_status_module
from wavecore.api.services.workbench import parallel as parallel_module
from wavecore.api.services.workbench._common import get_session_snapshot

pytestmark = pytest.mark.usefixtures("engine_registries")


def _failing_branch_graph(
    failing_node: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Branch 1 ends at ``failing_node``; branch 2 is a slow body plus a tail."""
    nodes = [
        parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
        failing_node,
        log_node("br-a-2", "Branch A Tail", "'A-TAIL'"),
        delay_node("br-b-1", 300, "Probe Body"),
        log_node("br-b-2", "Branch B Tail", "'B-TAIL'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", failing_node["id"], "branch_1"),
        edge(failing_node["id"], "br-a-2"),
        edge("par-1", "br-b-1", "branch_2"),
        edge("br-b-1", "br-b-2"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


def _single_block_lane_graph(
    *, exit_lane: bool = True
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Four lanes of exactly one block each; the first one fails at once.

    The failing lane is instant, one sibling finishes on
    its own, and the other two are still in flight when the section ends.
    """
    nodes = [
        parallel_node(
            "par-1",
            [
                branch("branch_1", "logs"),
                branch("branch_2", "get"),
                branch("branch_3", "events"),
                branch("branch_4", "top"),
            ],
        ),
        log_node("br-logs", "Boom", "1/0"),
        delay_node("br-get", 300, "Get Body"),
        log_node("br-events", "Events Body", "'EVENTS'"),
        delay_node("br-top", 300, "Top Body"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-logs", "branch_1"),
        edge("par-1", "br-get", "branch_2"),
        edge("par-1", "br-events", "branch_3"),
        edge("par-1", "br-top", "branch_4"),
    ]
    if exit_lane:
        edges.append(edge("par-1", "after", "then"))
    return nodes, edges


class TestBranchFailureEndsTheSection:
    """A failed branch fails the section and skips the exit lane."""

    async def test_the_section_and_the_session_fail(self) -> None:
        """The Parallel node paints failed and the run ends failed."""
        session_id = "par-fail-section"
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["par-1"] == "failed", session["block_states"]
        assert session["block_states"]["br-a-1"] == "failed", session["block_states"]

    async def test_the_exit_lane_is_skipped(self) -> None:
        """A failed section does not continue past the join."""
        # Guard: the run must stop at the section, not carry on through ``then``.
        session_id = "par-fail-then"
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["after"] == "skipped", session["block_states"]
        assert "AFTER" not in messages, messages

    async def test_the_rest_of_the_failing_branch_is_skipped(self) -> None:
        """Nodes behind the failure in its own branch never run."""
        session_id = "par-fail-own-tail"
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-a-2"] == "skipped", session["block_states"]
        assert "A-TAIL" not in messages, messages

    async def test_the_sibling_stops_at_its_next_block_boundary(self) -> None:
        """The sibling's in-flight block paints stopped, its tail skipped."""
        session_id = "par-fail-sibling"
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-b-1"] == "stopped", session["block_states"]
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert "B-TAIL" not in messages, messages

    async def test_the_failed_and_stopped_branches_are_named_in_the_run_log(self) -> None:
        """Both branch-scoped outcome lines name their branch."""
        session_id = "par-fail-log"
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'ingest' failed" in messages, messages
        assert "Branch 'probe' stopped" in messages, messages

    async def test_a_failure_under_first_to_finish_still_fails_the_section(self) -> None:
        """The failure rule is independent of the join mode."""
        session_id = "par-fail-first-join"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "ingest"), branch("branch_2", "probe")],
                join="first",
            ),
            log_node("br-a", "Boom", "1/0"),
            delay_node("br-b", 300, "Probe Body"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["after"] == "skipped", session["block_states"]


class TestASiblingLaneOfOneBlockIsSettled:
    """REQ-3.2.3.8: a stopped sibling is reported stopped, however short its lane."""

    async def test_no_block_is_left_running(self) -> None:
        """5.10.3: the section is over, so nothing may still read running."""
        session_id = "par-fail-single-lane-running"
        nodes, edges = _single_block_lane_graph()

        session = await run_graph(session_id, nodes, edges, {})

        still_running = [
            node_id for node_id, state in session["block_states"].items() if state == "running"
        ]
        assert still_running == [], session["block_states"]

    async def test_the_in_flight_siblings_paint_stopped(self) -> None:
        """5.10.3: the block each sibling held is stopped, not failed."""
        session_id = "par-fail-single-lane-stopped"
        nodes, edges = _single_block_lane_graph()

        session = await run_graph(session_id, nodes, edges, {})

        assert session["block_states"]["br-get"] == "stopped", session["block_states"]
        assert session["block_states"]["br-top"] == "stopped", session["block_states"]

    async def test_a_sibling_that_finished_keeps_its_own_outcome(self) -> None:
        """5.10.3: settling the section must not repaint a lane that completed."""
        # Guard: the stop sweep only touches blocks that were still in flight.
        session_id = "par-fail-single-lane-passed"
        nodes, edges = _single_block_lane_graph()

        session = await run_graph(session_id, nodes, edges, {})

        assert session["block_states"]["br-events"] == "passed", session["block_states"]
        assert session["block_states"]["br-logs"] == "failed", session["block_states"]

    async def test_each_stopped_lane_is_named_in_the_run_log(self) -> None:
        """Every lane the section cut short reports itself by name."""
        session_id = "par-fail-single-lane-log"
        nodes, edges = _single_block_lane_graph()

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'logs' failed" in messages, messages
        assert "Branch 'get' stopped" in messages, messages
        assert "Branch 'top' stopped" in messages, messages
        assert "Branch 'events' stopped" not in messages, messages

    async def test_the_stored_snapshot_carries_the_stopped_blocks(self) -> None:
        """The reopened run must read the same states the live canvas showed."""
        session_id = "par-fail-single-lane-snapshot"
        nodes, edges = _single_block_lane_graph()

        await run_graph(session_id, nodes, edges, {})

        snapshot = get_session_snapshot(session_id)
        assert snapshot is not None
        states = snapshot["block_states"]
        assert "running" not in states.values(), states
        assert states["br-get"] == "stopped", states
        assert states["br-top"] == "stopped", states


class TestEveryBranchBodyStarts:
    """REQ-3.2.3.1: every branch body starts, even beside a sibling that fails at once."""

    async def test_a_lane_reached_late_still_starts_its_block(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A pause as the engine reaches a lane must not let the failure cancel it unstarted."""
        real_walk = parallel_module._execute_path_nodes

        def late_walk(chain: list[str], *args: Any, **kwargs: Any) -> Any:
            if chain == ["br-late"]:
                time.sleep(0.005)
            return real_walk(chain, *args, **kwargs)

        monkeypatch.setattr(parallel_module, "_execute_path_nodes", late_walk)
        session_id = "par-fork-late-lane"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "boom"), branch("branch_2", "late")]),
            log_node("br-boom", "Boom", "1/0"),
            delay_node("br-late", 300, "Late Body"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-boom", "branch_1"),
            edge("par-1", "br-late", "branch_2"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["block_states"]["br-late"] == "stopped", session["block_states"]


class TestTheSettledSiblingIsNamedInItsStatusEvent:
    """5.10.3: a second observer repaints from the event, so it must name the Block."""

    async def _settled_names(
        self, session_id: str, monkeypatch: pytest.MonkeyPatch
    ) -> dict[str, str]:
        """Run the failing-branch graph and collect every status event it broadcast."""
        nodes, edges = _failing_branch_graph(log_node("br-a-1", "Boom", "1/0"))
        seen: dict[str, str] = {}

        async def record(broadcast_id: str, event: dict[str, Any]) -> None:
            if broadcast_id == session_id and event.get("type") == "block_status_changed":
                seen[str(event["block_id"])] = str(event["block_name"])

        monkeypatch.setattr(parallel_module, "_broadcast_event", record)
        monkeypatch.setattr(block_status_module, "_broadcast_event", record)
        await run_graph(session_id, nodes, edges, {})
        return seen

    async def test_the_stopped_block_is_broadcast_under_its_label(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The block the sibling held reaches the canvas by name, not as an empty string."""
        names = await self._settled_names("par-fail-stopped-event-name", monkeypatch)

        assert names["br-b-1"] == "Probe Body", names

    async def test_the_skipped_block_is_broadcast_under_its_name(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A block the lane never reached is named too, so the toast cannot read Block ''."""
        names = await self._settled_names("par-fail-skipped-event-name", monkeypatch)

        assert names["br-b-2"] == "Branch B Tail", names


class TestASectionWithNoExitLane:
    """REQ-3.2.3.8: the exit lane is where the run stops, not what makes it fail."""

    async def test_a_failed_branch_fails_the_run(self) -> None:
        """A Parallel that is the last block on the canvas still fails the run."""
        session_id = "par-fail-no-exit-lane"
        nodes, edges = _single_block_lane_graph(exit_lane=False)

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["par-1"] == "failed", session["block_states"]

    async def test_the_run_log_does_not_claim_success(self) -> None:
        """The closing line must match the verdict the section reached."""
        session_id = "par-fail-no-exit-lane-log"
        nodes, edges = _single_block_lane_graph(exit_lane=False)

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Test 'Parallel Test' completed successfully" not in messages, messages
        assert "Test 'Parallel Test' halted with status: failed" in messages, messages

    async def test_every_branch_failing_fails_the_run(self) -> None:
        """Nothing survives the section, so the run cannot report passed."""
        session_id = "par-fail-all-no-exit-lane"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            log_node("br-a", "Boom A", "1/0"),
            log_node("br-b", "Boom B", "2/0"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["br-a"] == "failed", session["block_states"]

    async def test_a_passing_section_with_no_exit_lane_still_passes(self) -> None:
        """Guard: the verdict follows the section, not the missing exit lane."""
        session_id = "par-pass-no-exit-lane"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["par-1"] == "passed", session["block_states"]


class TestTryCatchToleratesABranchFailure:
    """Try/Catch inside a branch is the way to absorb a failure."""

    async def test_a_caught_failure_leaves_the_section_passing(self) -> None:
        """The catch path absorbs the error and the section never sees a failure."""
        session_id = "par-fail-caught"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            try_catch_node("tc-1"),
            log_node("try-boom", "Boom", "1/0"),
            log_node("catch-log", "Caught", "'CAUGHT'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "tc-1", "branch_1"),
            edge("tc-1", "try-boom", "try"),
            edge("tc-1", "catch-log", "catch"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "CAUGHT" in messages, messages
        assert "B" in messages, messages
        assert messages.count("AFTER") == 1, messages
        assert session["block_states"]["par-1"] == "passed", session["block_states"]


class TestHaltInsideABranch:
    """A Halt ends the section and travels outward with its scope."""

    async def test_the_section_ends_and_the_exit_lane_is_skipped(self) -> None:
        """A Halt in a branch stops the section the way a failure does."""
        session_id = "par-halt-section"
        nodes, edges = _failing_branch_graph(halt_node("br-a-1", "Halt In Branch"))

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["after"] == "skipped", session["block_states"]
        assert "AFTER" not in messages, messages
        assert "A-TAIL" not in messages, messages

    async def test_the_sibling_stops(self) -> None:
        """5.10.3: siblings stop at their next block boundary after a Halt."""
        session_id = "par-halt-sibling"
        nodes, edges = _failing_branch_graph(halt_node("br-a-1", "Halt In Branch"))

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert "B-TAIL" not in messages, messages

    async def test_the_declared_scope_and_status_reach_the_session(self) -> None:
        """5.10.3: the Halt continues outward with the scope the author declared."""
        # Guard: the section must not swallow a suite-scoped halt.
        session_id = "par-halt-scope"
        halt = halt_node("br-a-1", "Halt In Branch", scope="suite", status="failed")
        nodes, edges = _failing_branch_graph(halt)

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["halt_scope"] == "suite", session.get("halt_scope")

    async def test_a_passing_halt_scope_still_ends_the_section(self) -> None:
        """5.10.3: a Halt with status passed ends the section and sets that status."""
        session_id = "par-halt-passed"
        halt = halt_node("br-a-1", "Halt In Branch", scope="test", status="passed")
        nodes, edges = _failing_branch_graph(halt)

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["halt_scope"] == "test", session.get("halt_scope")
        assert "AFTER" not in messages, messages


def _split_assert(node_id: str, name: str) -> dict[str, Any]:
    return make_node(
        node_id,
        label="Assert",
        element_type="assert",
        config_values={
            "assertions": [{"type": "expression", "expression": "1 == 2"}],
            "mode": "split",
            "fail_current_scope": True,
        },
        name=name,
    )


class TestAssertFailureInsideABranch:
    """5.10.3: a split Assert failure is not a branch failure; a single-mode one is."""

    async def test_the_branch_continues_and_the_exit_lane_still_runs(self) -> None:
        """A failing split Assert with fail-current-scope leaves the flow intact."""
        session_id = "par-assert-continues"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            _split_assert("br-a-1", "Failing Assert"),
            log_node("br-a-2", "Branch A Tail", "'A-TAIL'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a-1", "branch_1"),
            edge("br-a-1", "br-a-2", "fail"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "A-TAIL" in messages, messages
        assert messages.count("AFTER") == 1, messages
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_the_run_ends_failed(self) -> None:
        """A failing split Assert with fail-current-scope marks the run failed."""
        session_id = "par-assert-fails-run"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            _split_assert("br-a", "Failing Assert"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["scope_failed"] is True, session.get("scope_failed")

    async def test_a_single_mode_assert_fails_its_branch_and_ends_the_section(self) -> None:
        """A failing single-mode Assert with fail-current-scope is a block failure."""
        session_id = "par-assert-single-fails-branch"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            assert_node("br-a-1", "1 == 2", "Failing Assert"),
            log_node("br-a-2", "Branch A Tail", "'A-TAIL'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a-1", "branch_1"),
            edge("br-a-1", "br-a-2"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-a-1"] == "failed", session["block_states"]
        assert "A-TAIL" not in messages, messages
        assert "Branch 'ingest' failed" in messages, messages
        assert "AFTER" not in messages, messages
        assert session["status"] == "failed", session.get("status")

    async def test_an_informational_assert_leaves_the_run_passing(self) -> None:
        """5.10.3: without fail-current-scope a failing Assert is informational."""
        session_id = "par-assert-informational"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            assert_node("br-a", "1 == 2", "Soft Assert", fail_current_scope=False),
            setter_node("br-b", "Set B", {"b": "done"}),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"b": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert messages.count("AFTER") == 1, messages
        assert variables["b"] == "done", variables
