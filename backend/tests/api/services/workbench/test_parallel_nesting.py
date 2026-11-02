"""Nested Parallel sections at any depth (REQ-3.2.3.5).

A section may sit inside another section's branch, inside a loop body, inside
a Try/Catch path and inside a Function body. The inner section forks and joins
within the branch that contains it: its join releases before that branch can
continue, and the containing section's join accounts only for its own direct
branches.
"""

from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    for_each_node,
    function_node,
    halt_node,
    local_definition,
    log_messages,
    log_node,
    loop_signal_node,
    parallel_node,
    run_graph,
    setter_node,
    try_catch_node,
)

pytestmark = pytest.mark.usefixtures("engine_registries")


def _nested_sections() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """An inner Parallel on the outer section's first branch."""
    return (
        [
            parallel_node("outer", [branch("branch_1", "holds"), branch("branch_2", "sibling")]),
            parallel_node("inner", [branch("branch_1", "slow"), branch("branch_2", "quick")]),
            delay_node("in-a-1", 150, "Inner Slow Body"),
            setter_node("in-a-2", "Set Inner A", {"inner_a": "a"}),
            setter_node("in-b", "Set Inner B", {"inner_b": "b"}),
            setter_node(
                "in-then", "Inner Join", {"inner_seen": "inner_a + inner_b"}, expressions=True
            ),
            setter_node("out-b", "Set Outer B", {"outer_b": "ob"}),
            setter_node(
                "out-then", "Outer Join", {"final": "inner_seen + outer_b"}, expressions=True
            ),
        ],
        [
            edge("start-node", "outer"),
            edge("outer", "inner", "branch_1"),
            edge("inner", "in-a-1", "branch_1"),
            edge("in-a-1", "in-a-2"),
            edge("inner", "in-b", "branch_2"),
            edge("inner", "in-then", "then"),
            edge("outer", "out-b", "branch_2"),
            edge("outer", "out-then", "then"),
        ],
    )


class TestParallelInsideAParallelBranch:
    """A section nested in a branch forks and joins inside that branch."""

    async def test_the_inner_join_releases_before_the_outer_branch_continues(self) -> None:
        """The inner exit lane runs with both inner branches done."""
        session_id = "par-nest-inner-join"
        nodes, edges = _nested_sections()

        variables: dict[str, Any] = {
            "inner_a": "",
            "inner_b": "",
            "inner_seen": "",
            "outer_b": "",
            "final": "",
        }
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["inner_seen"] == "ab", variables

    async def test_the_outer_join_waits_for_the_whole_nested_branch(self) -> None:
        """The outer exit lane runs only once the nested section has finished."""
        session_id = "par-nest-outer-join"
        nodes, edges = _nested_sections()

        variables: dict[str, Any] = {
            "inner_a": "",
            "inner_b": "",
            "inner_seen": "",
            "outer_b": "",
            "final": "",
        }
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["final"] == "abob", variables
        assert session["block_states"]["out-then"] == "passed", session["block_states"]

    async def test_a_failure_in_the_inner_section_fails_the_outer_one(self) -> None:
        """The failure travels outward through the section that contains it."""
        session_id = "par-nest-failure"
        nodes = [
            parallel_node("outer", [branch("branch_1", "holds"), branch("branch_2", "sibling")]),
            parallel_node("inner", [branch("branch_1", "boom"), branch("branch_2", "quiet")]),
            log_node("in-a", "Inner Boom", "1/0"),
            log_node("in-b", "Inner Quiet", "'INNER-B'"),
            log_node("in-then", "Inner Join", "'INNER-THEN'"),
            log_node("out-b", "Outer B", "'OUTER-B'"),
            log_node("out-then", "Outer Join", "'OUTER-THEN'"),
        ]
        edges = [
            edge("start-node", "outer"),
            edge("outer", "inner", "branch_1"),
            edge("inner", "in-a", "branch_1"),
            edge("inner", "in-b", "branch_2"),
            edge("inner", "in-then", "then"),
            edge("outer", "out-b", "branch_2"),
            edge("outer", "out-then", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert "INNER-THEN" not in messages, messages
        assert "OUTER-THEN" not in messages, messages
        assert session["block_states"]["out-then"] == "skipped", session["block_states"]


class TestParallelInsideAFunctionBody:
    """A Function called in a branch runs its own section to completion."""

    async def test_a_function_body_section_forks_and_joins(self) -> None:
        """Both branches inside the Function run and its exit lane follows."""
        session_id = "par-nest-function"
        body_nodes = [
            parallel_node("fn-par", [branch("branch_1"), branch("branch_2")]),
            log_node("fn-a", "Fn A", "'FN-A'"),
            log_node("fn-b", "Fn B", "'FN-B'"),
            log_node("fn-then", "Fn Join", "'FN-THEN'"),
        ]
        body_edges = [
            edge("start-node", "fn-par"),
            edge("fn-par", "fn-a", "branch_1"),
            edge("fn-par", "fn-b", "branch_2"),
            edge("fn-par", "fn-then", "then"),
        ]
        definition = local_definition("ParallelHolder", body_nodes, body_edges)
        nodes = [function_node("fn-1", definition), log_node("after", "After", "'AFTER'")]
        edges = [edge("start-node", "fn-1"), edge("fn-1", "after")]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["fn-1"] == "passed", session["block_states"]
        assert "FN-A" in messages, messages
        assert "FN-B" in messages, messages
        assert messages.count("FN-THEN") == 1, messages
        assert messages.index("FN-THEN") < messages.index("AFTER"), messages

    async def test_a_function_called_inside_a_branch_runs_its_own_section(self) -> None:
        """Nesting works across the Function boundary in both directions."""
        session_id = "par-nest-function-in-branch"
        body_nodes = [
            parallel_node("fn-par", [branch("branch_1"), branch("branch_2")]),
            log_node("fn-a", "Fn A", "'FN-A'"),
            log_node("fn-b", "Fn B", "'FN-B'"),
            log_node("fn-then", "Fn Join", "'FN-THEN'"),
        ]
        body_edges = [
            edge("start-node", "fn-par"),
            edge("fn-par", "fn-a", "branch_1"),
            edge("fn-par", "fn-b", "branch_2"),
            edge("fn-par", "fn-then", "then"),
        ]
        definition = local_definition("ParallelHolder", body_nodes, body_edges)
        nodes = [
            parallel_node("outer", [branch("branch_1", "calls"), branch("branch_2", "other")]),
            function_node("fn-1", definition),
            log_node("out-b", "Outer B", "'OUTER-B'"),
            log_node("out-then", "Outer Join", "'OUTER-THEN'"),
        ]
        edges = [
            edge("start-node", "outer"),
            edge("outer", "fn-1", "branch_1"),
            edge("outer", "out-b", "branch_2"),
            edge("outer", "out-then", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        for mark in ("FN-A", "FN-B", "OUTER-B"):
            assert mark in messages, messages
        assert messages.count("FN-THEN") == 1, messages
        assert messages.count("OUTER-THEN") == 1, messages
        assert messages.index("FN-THEN") < messages.index("OUTER-THEN"), messages


class TestParallelInsideOtherContainers:
    """A section is admissible wherever a sub-flow is."""

    async def test_a_section_inside_a_loop_body_re_runs_every_iteration(self) -> None:
        """The loop clears the whole section, not just its head."""
        # Guard: a section in a loop must fork again on each pass.
        session_id = "par-nest-loop"
        nodes = [
            for_each_node("fe-1", ["a", "b", "c"]),
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            setter_node("br-a", "Bump A", {"count_a": "count_a + 1"}, expressions=True),
            setter_node("br-b", "Bump B", {"count_b": "count_b + 1"}, expressions=True),
            log_node("par-then", "Section Join", "'JOIN'"),
            log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            edge("start-node", "fe-1"),
            edge("fe-1", "par-1", "body"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "par-then", "then"),
            edge("fe-1", "after-loop", "then"),
        ]

        variables: dict[str, Any] = {
            "fe_item": None,
            "fe_idx": None,
            "count_a": 0,
            "count_b": 0,
        }
        session = await run_graph(session_id, nodes, edges, variables)

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert variables["count_a"] == 3, variables
        assert variables["count_b"] == 3, variables
        assert messages.count("JOIN") == 3, messages
        assert session["block_states"]["after-loop"] == "passed", session["block_states"]

    async def test_a_section_inside_a_try_path_hands_control_to_its_exit(self) -> None:
        """The try chain follows the section's ``then`` handle past it."""
        session_id = "par-nest-try"
        nodes = [
            try_catch_node("tc-1"),
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("par-then", "Section Join", "'JOIN'"),
            log_node("catch-log", "Catch", "'CAUGHT'"),
            log_node("tc-then", "After Try", "'AFTER-TRY'"),
        ]
        edges = [
            edge("start-node", "tc-1"),
            edge("tc-1", "par-1", "try"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "par-then", "then"),
            edge("tc-1", "catch-log", "catch"),
            edge("tc-1", "tc-then", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "A" in messages, messages
        assert "B" in messages, messages
        assert messages.count("JOIN") == 1, messages
        assert session["block_states"]["catch-log"] == "skipped", session["block_states"]
        assert session["block_states"]["tc-then"] == "passed", session["block_states"]

    async def test_a_mid_chain_section_is_not_walked_into_its_first_branch(self) -> None:
        """A section between two nodes of a sub-flow passes control on through ``then``."""
        session_id = "par-nest-mid-chain"
        nodes = [
            try_catch_node("tc-1"),
            log_node("before", "Before", "'BEFORE'"),
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            log_node("br-a", "Branch A", "'A'"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("par-then", "Section Join", "'JOIN'"),
            log_node("catch-log", "Catch", "'CAUGHT'"),
            log_node("tc-then", "After Try", "'AFTER-TRY'"),
        ]
        edges = [
            edge("start-node", "tc-1"),
            edge("tc-1", "before", "try"),
            edge("before", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "par-then", "then"),
            edge("tc-1", "catch-log", "catch"),
            edge("tc-1", "tc-then", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = [m for m in log_messages(session_id) if m in ("BEFORE", "A", "B", "JOIN")]
        assert session["status"] == "passed", session.get("status")
        assert messages[0] == "BEFORE", messages
        assert messages[-1] == "JOIN", messages


class TestASignalRaisedInsideANestedSection:
    """A nested section reports what its branches raised to its container."""

    async def test_a_halt_inside_a_nested_section_ends_the_containing_path(self) -> None:
        """The halt leaves the section and keeps traveling outward."""
        session_id = "par-nest-halt"
        nodes = [
            try_catch_node("tc-1"),
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            halt_node("halt-1", "Halt In Branch", scope="test", status="failed"),
            log_node("br-b", "Branch B", "'B'"),
            log_node("par-then", "Section Join", "'JOIN'"),
            log_node("catch-log", "Catch", "'CAUGHT'"),
            log_node("tc-then", "After Try", "'AFTER-TRY'"),
        ]
        edges = [
            edge("start-node", "tc-1"),
            edge("tc-1", "par-1", "try"),
            edge("par-1", "halt-1", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "par-then", "then"),
            edge("tc-1", "catch-log", "catch"),
            edge("tc-1", "tc-then", "then"),
        ]

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert "JOIN" not in messages, messages
        assert "AFTER-TRY" not in messages, messages

    async def test_a_break_inside_a_nested_section_breaks_the_enclosing_loop(self) -> None:
        """A loop signal raised in a branch reaches the loop, not the section."""
        session_id = "par-nest-break"
        nodes = [
            for_each_node("fe-1", ["a", "b", "c"]),
            parallel_node("par-1", [branch("branch_1"), branch("branch_2")]),
            loop_signal_node("brk-1", "break", "fe-1", "Break In Branch"),
            setter_node("br-b", "Bump B", {"count_b": "count_b + 1"}, expressions=True),
            log_node("par-then", "Section Join", "'JOIN'"),
            log_node("after-loop", "After Loop", "'AFTER-LOOP'"),
        ]
        edges = [
            edge("start-node", "fe-1"),
            edge("fe-1", "par-1", "body"),
            edge("par-1", "brk-1", "branch_1"),
            edge("par-1", "br-b", "branch_2"),
            edge("par-1", "par-then", "then"),
            edge("fe-1", "after-loop", "then"),
        ]

        variables: dict[str, Any] = {"fe_item": None, "fe_idx": None, "count_b": 0}
        session = await run_graph(session_id, nodes, edges, variables)

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "JOIN" not in messages, messages
        assert variables["count_b"] <= 1, variables
        assert messages.count("AFTER-LOOP") == 1, messages
