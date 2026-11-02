"""Parallel fork and join through the real workbench engine (REQ-3.2.3.1).

Covers the container with branch lanes plus one always-present ``then``
egress, a legal unwired branch lane, and a run log that names every branch.
Branch bodies are ordinary sub-flows
that dead-end; the flow leaves the section only through ``then``.
"""

import time
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


class TestParallelForkAndJoin:
    """Every branch body runs and the section leaves through ``then`` once."""

    async def test_every_branch_body_runs(self) -> None:
        """Both branch lanes execute their sub-flow."""
        session_id = "par-fork-both"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            log_node("br-a", "Branch A", "'A'"),
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

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["par-1"] == "passed", session["block_states"]
        assert session["block_states"]["br-a"] == "passed", session["block_states"]
        assert session["block_states"]["br-b"] == "passed", session["block_states"]
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_the_then_egress_runs_exactly_once(self) -> None:
        """The join is one point, so the exit lane runs once for the section."""
        # Guard: a per-branch continuation would run the exit lane once per branch.
        session_id = "par-then-once"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1"), branch("branch_2"), branch("branch_3")],
            ),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("br-c", "Branch C", "'C'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "br-c", "branch_3"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert messages.count("AFTER") == 1, messages

    async def test_the_then_egress_runs_after_every_branch(self) -> None:
        """With the default join, no branch is still working when ``then`` starts."""
        session_id = "par-then-last"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "fast"), branch("branch_2", "slow")]),
            log_node("br-a", "Branch A", "'A'"),
            delay_node("br-b-1", 120, "Slow Body"),
            log_node("br-b-2", "Branch B tail", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = [m for m in log_messages(session_id) if m in ("A", "B", "AFTER")]
        assert session["status"] == "passed", session.get("status")
        assert messages[-1] == "AFTER", messages
        assert set(messages) == {"A", "B", "AFTER"}, messages

    async def test_a_branch_chain_runs_every_node_in_order(self) -> None:
        """A branch is an ordinary sub-flow - its whole chain runs in author order."""
        session_id = "par-chain"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("br-a1", "A1", "'A1'"),
            log_node("br-a2", "A2", "'A2'"),
            log_node("br-a3", "A3", "'A3'"),
            log_node("br-b", "B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a1", "branch_1"),
            edge("br-a1", "br-a2"),
            edge("br-a2", "br-a3"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = [m for m in log_messages(session_id) if m in ("A1", "A2", "A3")]
        assert session["status"] == "passed", session.get("status")
        assert messages == ["A1", "A2", "A3"], messages
        for node_id in ("br-a1", "br-a2", "br-a3", "br-b", "after"):
            assert session["block_states"][node_id] == "passed", session["block_states"]

    async def test_branch_bodies_run_concurrently(self) -> None:
        """REQ-3.2.3.1: two slow branches overlap instead of running back to back."""
        # Guard: a sequential walk of the lanes would take both delays end to end.
        session_id = "par-overlap"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            delay_node("br-a", 250, "Slow A"),
            delay_node("br-b", 250, "Slow B"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        started = time.monotonic()
        session = await run_graph(session_id, nodes, edges, {})
        elapsed = time.monotonic() - started

        assert session["status"] == "passed", session.get("status")
        assert elapsed < 0.45, elapsed

    async def test_branch_writes_are_all_present_after_the_join(self) -> None:
        """Every branch's work is done by the time the exit lane runs."""
        session_id = "par-writes"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            setter_node("br-a", "Set A", {"from_a": "a"}),
            setter_node("br-b", "Set B", {"from_b": "b"}),
            setter_node("after", "Combine", {"joined": "from_a + from_b"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"from_a": "", "from_b": "", "joined": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["joined"] == "ab", variables


class TestParallelBranchBoundaries:
    """Branch bodies are scoped to the section (REQ-3.2.3.1)."""

    async def test_an_unwired_branch_lane_completes_immediately(self) -> None:
        """A lane with no edge is legal and does not hold the join."""
        session_id = "par-empty-lane"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "wired"), branch("branch_2", "empty")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "after", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["br-a"] == "passed", session["block_states"]
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_every_lane_unwired_still_reaches_the_exit(self) -> None:
        """A section with nothing wired passes straight through the join."""
        session_id = "par-all-empty"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [edge("start-node", "par-1"), edge("par-1", "after", "then")]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["par-1"] == "passed", session["block_states"]
        assert messages.count("AFTER") == 1, messages

    async def test_a_section_with_no_exit_wired_still_passes(self) -> None:
        """The exit lane may be unwired; the section is simply the end of the flow."""
        session_id = "par-no-exit"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
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
        assert session["block_states"]["br-a"] == "passed", session["block_states"]
        assert session["block_states"]["br-b"] == "passed", session["block_states"]


class TestParallelDeclaresNoOutputs:
    """The engine signal never surfaces as a bindable output."""

    async def test_engine_keys_never_reach_the_variables(self) -> None:
        """The container signal leaks none of its keys into the run's variables."""
        # Guard: nothing stands in for the deleted 'results' output.
        session_id = "par-no-outputs"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        for key in ("__parallel", "__branches", "__join", "__time_limit", "results"):
            assert key not in variables, sorted(variables)


class TestParallelBranchNaming:
    """The run log names every branch (REQ-3.2.3.1 branch identity)."""

    async def test_a_named_branch_is_announced_by_its_name(self) -> None:
        """Each branch's start line carries the author's name."""
        session_id = "par-log-names"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'ingest' started" in messages, messages
        assert "Branch 'probe' started" in messages, messages

    async def test_an_unnamed_branch_falls_back_to_its_position(self) -> None:
        """REQ-3.2.3.1: a blank name is defaulted, so every lane stays identifiable."""
        session_id = "par-log-default-names"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'Branch 1' started" in messages, messages
        assert "Branch 'Branch 2' started" in messages, messages

    async def test_a_branch_record_without_a_name_key_is_still_named(self) -> None:
        """REQ-3.2.3.1: a record that omits the name key defaults the same way."""
        session_id = "par-log-missing-name"
        nodes = [
            parallel_node("par-1", [{"id": "branch_1"}, {"id": "branch_2"}]),
            log_node("br-a", "Branch A", "'A'"),
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

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "Branch 'Branch 1' started" in messages, messages
        assert "Branch 'Branch 2' started" in messages, messages
