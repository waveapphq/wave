"""Parallel join modes through the real workbench engine (REQ-3.2.3.6).

Two modes and no third: ``all`` waits for every branch to reach a terminal
state, ``first`` releases the join as soon as one branch does and stops the
rest under the cooperative rule. The stopped losers of a race are the mode
working, not the section failing.
"""

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
    run_graph,
    setter_node,
)

pytestmark = pytest.mark.usefixtures("engine_registries")


def _race_graph(join: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A fast branch and a slow two-node branch, wired to one exit lane."""
    nodes = [
        parallel_node(
            "par-1",
            [branch("branch_1", "fast"), branch("branch_2", "slow")],
            join=join,
        ),
        log_node("br-a", "Fast Body", "'FAST'"),
        delay_node("br-b-1", 300, "Slow Body"),
        log_node("br-b-2", "Slow Tail", "'SLOW-TAIL'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-a", "branch_1"),
        edge("par-1", "br-b-1", "branch_2"),
        edge("br-b-1", "br-b-2"),
        edge("par-1", "after", "then"),
    ]
    return nodes, edges


def _single_block_race_graph(
    *, exit_lane: bool = True, fast_body: str = "'FAST'"
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A fast lane and a slow lane, each exactly one block, under ``first``."""
    nodes = [
        parallel_node(
            "par-1",
            [branch("branch_1", "fast"), branch("branch_2", "slow")],
            join="first",
        ),
        log_node("br-a", "Fast Body", fast_body),
        delay_node("br-b", 300, "Slow Body"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [
        edge("start-node", "par-1"),
        edge("par-1", "br-a", "branch_1"),
        edge("par-1", "br-b", "branch_2"),
    ]
    if exit_lane:
        edges.append(edge("par-1", "after", "then"))
    return nodes, edges


class TestWaitForAllJoin:
    """``all`` is the default and releases only when every branch is done."""

    async def test_the_default_join_waits_for_every_branch(self) -> None:
        """With no join configured, the slow branch's tail runs before ``then``."""
        session_id = "par-join-default"
        nodes, edges = _race_graph(None)

        session = await run_graph(session_id, nodes, edges, {})

        marks = [m for m in log_messages(session_id) if m in ("FAST", "SLOW-TAIL", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert marks[-1] == "AFTER", marks
        assert "SLOW-TAIL" in marks, marks

    async def test_an_explicit_all_join_waits_for_every_branch(self) -> None:
        """``all`` stated explicitly behaves as the default does."""
        session_id = "par-join-all"
        nodes, edges = _race_graph("all")

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["br-b-1"] == "passed", session["block_states"]
        assert session["block_states"]["br-b-2"] == "passed", session["block_states"]
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_all_waits_for_the_slowest_of_three_branches(self) -> None:
        """The join accounts for every direct branch, not just the first two."""
        session_id = "par-join-all-three"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1"), branch("branch_2"), branch("branch_3", "slowest")],
                join="all",
            ),
            setter_node("br-a", "Set A", {"a": "done"}),
            setter_node("br-b", "Set B", {"b": "done"}),
            delay_node("br-c-1", 200, "Slowest Body"),
            setter_node("br-c-2", "Set C", {"c": "done"}),
            setter_node("after", "Snapshot", {"seen": "a + b + c"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "br-c-1", "branch_3"),
            edge("br-c-1", "br-c-2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"a": "", "b": "", "c": "", "seen": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["seen"] == "donedonedone", variables


class TestFirstToFinishJoin:
    """``first`` releases on the first branch to reach a terminal state."""

    async def test_the_exit_lane_runs_without_waiting_for_the_slow_branch(self) -> None:
        """The fast branch releases the join and ``then`` runs."""
        session_id = "par-join-first"
        nodes, edges = _race_graph("first")

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert messages.count("AFTER") == 1, messages
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_the_slow_branch_tail_is_never_reached(self) -> None:
        """Nodes the losing branch had not reached paint skipped."""
        # Guard: a released join must stop the race, not merely ignore the loser.
        session_id = "par-join-first-skips-tail"
        nodes, edges = _race_graph("first")

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert "SLOW-TAIL" not in messages, messages

    async def test_the_slow_branch_in_flight_block_paints_stopped(self) -> None:
        """5.10.3: the block the loser was executing is reported stopped, not failed."""
        session_id = "par-join-first-stops-inflight"
        nodes, edges = _race_graph("first")

        session = await run_graph(session_id, nodes, edges, {})

        assert session["block_states"]["br-b-1"] == "stopped", session["block_states"]

    async def test_the_stopped_branch_is_named_in_the_run_log(self) -> None:
        """The loser's stop line names the branch."""
        session_id = "par-join-first-log"
        nodes, edges = _race_graph("first")

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'slow' stopped" in messages, messages

    async def test_a_stopped_loser_does_not_fail_the_section(self) -> None:
        """Racing branches are the point of the mode; a stopped loser is not a failure."""
        session_id = "par-join-first-passes"
        nodes, edges = _race_graph("first")

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["par-1"] == "passed", session["block_states"]

    async def test_a_loser_of_one_block_is_not_left_running(self) -> None:
        """5.10.3: a released join stops the loser even when its lane is one block."""
        session_id = "par-join-first-single-block"
        nodes, edges = _single_block_race_graph()

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["br-b"] == "stopped", session["block_states"]

    async def test_the_winner_of_a_one_block_race_keeps_its_outcome(self) -> None:
        """Settling the losers must not repaint the branch that won."""
        # Guard: the stop sweep only touches blocks that were still in flight.
        session_id = "par-join-first-single-block-winner"
        nodes, edges = _single_block_race_graph()

        session = await run_graph(session_id, nodes, edges, {})

        assert session["block_states"]["br-a"] == "passed", session["block_states"]

    async def test_the_winning_branch_work_survives_the_join(self) -> None:
        """What the winner wrote is readable past the exit lane."""
        session_id = "par-join-first-write"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "fast"), branch("branch_2", "slow")],
                join="first",
            ),
            setter_node("br-a", "Set Winner", {"winner": "fast"}),
            delay_node("br-b", 300, "Slow Body"),
            setter_node("after", "Copy", {"seen": "winner"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"winner": "", "seen": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["seen"] == "fast", variables

    async def test_both_losing_branches_stop_when_three_branches_race(self) -> None:
        """The join releases once; every remaining branch is stopped."""
        session_id = "par-join-first-three"
        nodes = [
            parallel_node(
                "par-1",
                [
                    branch("branch_1", "fast"),
                    branch("branch_2", "slow-one"),
                    branch("branch_3", "slow-two"),
                ],
                join="first",
            ),
            log_node("br-a", "Fast Body", "'FAST'"),
            delay_node("br-b-1", 300, "Slow One"),
            log_node("br-b-2", "Slow One Tail", "'TAIL-1'"),
            delay_node("br-c-1", 300, "Slow Two"),
            log_node("br-c-2", "Slow Two Tail", "'TAIL-2'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "br-c-1", "branch_3"),
            edge("br-c-1", "br-c-2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert session["block_states"]["br-c-2"] == "skipped", session["block_states"]
        assert "TAIL-1" not in messages, messages
        assert "TAIL-2" not in messages, messages
        assert messages.count("AFTER") == 1, messages


class TestAFirstToFinishSectionWithNoExitLane:
    """The verdict follows the section, with or without an exit lane.

    Every other graph in this module wires ``then``, so this one drives the
    unconnected-egress path under ``first``.
    """

    async def test_a_race_with_no_exit_lane_still_passes(self) -> None:
        """A released join that has nowhere to go leaves the run passing."""
        session_id = "par-join-first-no-exit-lane"
        nodes, edges = _single_block_race_graph(exit_lane=False)

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["par-1"] == "passed", session["block_states"]

    async def test_the_loser_is_settled_with_no_exit_lane(self) -> None:
        """5.10.3: the loser is stopped whether or not the section has an egress."""
        session_id = "par-join-first-no-exit-lane-loser"
        nodes, edges = _single_block_race_graph(exit_lane=False)

        session = await run_graph(session_id, nodes, edges, {})

        still_running = [
            node_id for node_id, state in session["block_states"].items() if state == "running"
        ]
        assert still_running == [], session["block_states"]
        assert session["block_states"]["br-b"] == "stopped", session["block_states"]

    async def test_a_failing_lane_with_no_exit_lane_fails_the_run(self) -> None:
        """A branch failure ends the run failed even with ``then`` unconnected."""
        session_id = "par-join-first-no-exit-lane-fail"
        nodes, edges = _single_block_race_graph(exit_lane=False, fast_body="1/0")

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["par-1"] == "failed", session["block_states"]
        assert session["block_states"]["br-a"] == "failed", session["block_states"]
