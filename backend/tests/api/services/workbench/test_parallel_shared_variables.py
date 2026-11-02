"""Branches share the test's live variables (REQ-3.2.3.3).

No copy at the fork and no merge at the join: a value written by one branch is
visible to any read a sibling performs afterwards, and what a branch wrote is
simply the variable's value after the section. Cross-branch coordination
rests on that property - a Wait Until in Watch mode inside one branch is
satisfied by what another branch writes.
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
    wait_node,
)

pytestmark = pytest.mark.usefixtures("engine_registries")


class TestSiblingWritesAreVisible:
    """A later read in one branch sees an earlier write from another."""

    async def test_a_sibling_write_reaches_a_later_read(self) -> None:
        """Branch 2 reads the value branch 1 produced, not a fork-time copy."""
        session_id = "par-shared-visible"
        nodes = [
            parallel_node(
                "par-1", [branch("branch_1", "producer"), branch("branch_2", "consumer")]
            ),
            setter_node("br-a", "Produce", {"produced": "ready"}),
            wait_node("br-b-1", "produced == 'ready'", "Await Producer"),
            setter_node("br-b-2", "Consume", {"consumed": "produced"}, expressions=True),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"produced": "", "consumed": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["consumed"] == "ready", variables

    async def test_a_slow_producer_is_still_observed_by_its_consumer(self) -> None:
        """The consumer waits on the live value, not on a snapshot."""
        # Guard: a fork-time copy would leave the consumer waiting forever.
        session_id = "par-shared-slow-producer"
        nodes = [
            parallel_node(
                "par-1", [branch("branch_1", "producer"), branch("branch_2", "consumer")]
            ),
            delay_node("br-a-1", 150, "Producer Work"),
            setter_node("br-a-2", "Produce", {"produced": "ready"}),
            wait_node("br-b-1", "produced == 'ready'", "Await Producer"),
            setter_node("br-b-2", "Consume", {"consumed": "produced"}, expressions=True),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a-1", "branch_1"),
            edge("br-a-1", "br-a-2"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"produced": "", "consumed": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["consumed"] == "ready", variables
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_a_wait_until_in_watch_mode_is_satisfied_by_a_sibling(self) -> None:
        """REQ-3.2.3.3: cross-branch coordination is Wait Until plus a sibling write."""
        session_id = "par-shared-watch"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "setter"), branch("branch_2", "watcher")]),
            delay_node("br-a-1", 120, "Setter Work"),
            setter_node("br-a-2", "Open Gate", {"gate": "open"}),
            wait_node(
                "br-b",
                "gate == 'open'",
                "Watch Gate",
                output_bindings={"passed": "wait_passed", "elapsed": "wait_elapsed"},
            ),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a-1", "branch_1"),
            edge("br-a-1", "br-a-2"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"gate": "closed", "wait_passed": False, "wait_elapsed": 0}
        session = await run_graph(session_id, nodes, edges, variables)

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert variables["wait_passed"] is True, variables
        assert session["block_states"]["br-b"] == "passed", session["block_states"]
        assert messages.count("AFTER") == 1, messages


class TestWritesSurviveTheJoin:
    """There is no branch-local copy, so writes are simply the value after."""

    async def test_every_branch_write_is_readable_past_the_exit_lane(self) -> None:
        """Blocks after the join read branch writes like any other write."""
        session_id = "par-shared-survive"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            setter_node("br-a", "Set A", {"from_a": "a"}),
            setter_node("br-b", "Set B", {"from_b": "b"}),
            setter_node("after", "Read Both", {"seen": "from_a + from_b"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"from_a": "", "from_b": "", "seen": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["from_a"] == "a", variables
        assert variables["from_b"] == "b", variables
        assert variables["seen"] == "ab", variables

    async def test_a_compound_value_written_in_a_branch_survives_whole(self) -> None:
        """REQ-3.2.3.4: a table written in a branch is never seen half-replaced."""
        session_id = "par-shared-compound"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            setter_node("br-a", "Set Rows", {"rows": "[1, 2, 3]"}, expressions=True),
            setter_node("br-b", "Set Flag", {"flag": "set"}),
            setter_node("after", "Count Rows", {"row_count": "len(rows)"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"rows": [], "flag": "", "row_count": 0}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["rows"] == [1, 2, 3], variables
        assert variables["row_count"] == 3, variables

    async def test_the_last_write_to_one_variable_wins(self) -> None:
        """Concurrent writes to one variable are last-write-wins, never merged."""
        session_id = "par-shared-last-write"
        nodes = [
            parallel_node("par-1", [branch("branch_1", "early"), branch("branch_2", "late")]),
            setter_node("br-a", "Write Early", {"shared": "early"}),
            delay_node("br-b-1", 120, "Late Work"),
            setter_node("br-b-2", "Write Late", {"shared": "late"}),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"shared": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["shared"] == "late", variables

    async def test_variables_declared_before_the_section_keep_their_identity(self) -> None:
        """Nothing about a variable changes because a branch touched it."""
        session_id = "par-shared-identity"
        nodes = [
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            setter_node("br-a", "Bump", {"counter": "counter + 1"}, expressions=True),
            log_node("br-b", "Branch B", "'B'"),
            setter_node("after", "Bump Again", {"counter": "counter + 1"}, expressions=True),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"counter": 0}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["counter"] == 2, variables
