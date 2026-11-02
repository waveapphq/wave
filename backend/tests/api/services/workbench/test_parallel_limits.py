"""Per-branch and per-section time limits (REQ-3.2.3.7).

Two independent optional limits. A branch that exceeds its own limit
stops at its next block boundary and ends failed, which ends the section under
the failure rule. When the section limit expires every branch still running
stops and the section ends failed; branches that already finished keep the
outcome they reached.
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


def _two_slow_branches(
    branches: list[dict[str, Any]],
    section_limit: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Both branches hold a slow body followed by a tail; one exit lane."""
    nodes = [
        parallel_node("par-1", branches, time_limit=section_limit),
        delay_node("br-a-1", 300, "Body A"),
        log_node("br-a-2", "Tail A", "'A-TAIL'"),
        delay_node("br-b-1", 300, "Body B"),
        log_node("br-b-2", "Tail B", "'B-TAIL'"),
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
    return nodes, edges


def _single_block_branches(
    section_limit: int | None = None,
    exit_lane: bool = True,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Two lanes of exactly one slow block each, under one section limit."""
    nodes = [
        parallel_node(
            "par-1",
            [branch("branch_1", "ingest"), branch("branch_2", "probe")],
            time_limit=section_limit,
        ),
        delay_node("br-a", 300, "Body A"),
        delay_node("br-b", 300, "Body B"),
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


class TestNoLimits:
    """Both limits are optional."""

    async def test_a_section_with_no_limits_is_unbounded(self) -> None:
        """Neither limit set means nothing is cut short."""
        session_id = "par-limit-none"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest"), branch("branch_2", "probe")]
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "A-TAIL" in messages, messages
        assert "B-TAIL" in messages, messages
        assert session["block_states"]["after"] == "passed", session["block_states"]

    async def test_a_branch_under_its_limit_is_unaffected(self) -> None:
        """A limit larger than the branch's work changes nothing."""
        session_id = "par-limit-slack"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 5000), branch("branch_2", "probe")]
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "A-TAIL" in messages, messages
        assert session["block_states"]["br-a-1"] == "passed", session["block_states"]

    async def test_a_section_under_its_limit_is_unaffected(self) -> None:
        """A section limit larger than the whole region changes nothing."""
        session_id = "par-limit-section-slack"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest"), branch("branch_2", "probe")],
            section_limit=5000,
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "passed", session.get("status")
        assert "A-TAIL" in messages, messages
        assert "B-TAIL" in messages, messages


class TestBranchTimeLimit:
    """A branch that exceeds its own limit ends failed."""

    async def test_the_expired_branch_stops_and_its_tail_is_skipped(self) -> None:
        """5.10.3: the in-flight block paints stopped, unreached nodes skipped."""
        session_id = "par-limit-branch-stops"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 60), branch("branch_2", "probe")]
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-a-1"] == "stopped", session["block_states"]
        assert session["block_states"]["br-a-2"] == "skipped", session["block_states"]
        assert "A-TAIL" not in messages, messages

    async def test_the_section_fails_and_skips_the_exit_lane(self) -> None:
        """An expired branch is a failed branch, which ends the section."""
        session_id = "par-limit-branch-fails"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 60), branch("branch_2", "probe")]
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["par-1"] == "failed", session["block_states"]
        assert session["block_states"]["after"] == "skipped", session["block_states"]
        assert "AFTER" not in messages, messages

    async def test_the_sibling_stops_too(self) -> None:
        """The failure rule stops the running sibling at its next boundary."""
        session_id = "par-limit-branch-sibling"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 60), branch("branch_2", "probe")]
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert "B-TAIL" not in messages, messages

    async def test_the_expiry_names_the_branch_and_the_limit(self) -> None:
        """5.10.2 reporting: the run log says which limit expired and where."""
        session_id = "par-limit-branch-log"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 60), branch("branch_2", "probe")]
        )

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Branch 'ingest' exceeded its time limit of 60 ms" in messages, messages

    async def test_a_limit_written_as_its_digits_bounds_the_branch(self) -> None:
        """REQ-3.1.3.14: the canvas sends a limit no JS number holds as its digit text."""
        session_id = "par-limit-branch-digits"
        limited = {**branch("branch_1", "ingest"), "time_limit": "060"}
        nodes, edges = _two_slow_branches([limited, branch("branch_2", "probe")])

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-a-1"] == "stopped", session["block_states"]
        assert "Branch 'ingest' exceeded its time limit of 60 ms" in messages, messages

    async def test_only_the_limited_branch_is_bounded(self) -> None:
        """An unlimited sibling is bounded by nothing of its own."""
        # Guard: a per-branch limit must not act as a section limit.
        session_id = "par-limit-branch-scope"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "quick", 5000), branch("branch_2", "probe")],
            ),
            setter_node("br-a", "Set A", {"a": "done"}),
            delay_node("br-b-1", 200, "Body B"),
            setter_node("br-b-2", "Set B", {"b": "done"}),
            log_node("after", "After", "'AFTER'"),
        ]
        edges = [
            edge("start-node", "par-1"),
            edge("par-1", "br-a", "branch_1"),
            edge("par-1", "br-b-1", "branch_2"),
            edge("br-b-1", "br-b-2"),
            edge("par-1", "after", "then"),
        ]

        variables: dict[str, Any] = {"a": "", "b": ""}
        session = await run_graph(session_id, nodes, edges, variables)

        assert session["status"] == "passed", session.get("status")
        assert variables["a"] == "done", variables
        assert variables["b"] == "done", variables


class TestAnExpiredSectionLimitOnOneBlockLanes:
    """5.10.2: an expired limit settles every lane, however short."""

    async def test_no_block_is_left_running(self) -> None:
        """The section is over, so nothing may still read running."""
        session_id = "par-limit-single-block-running"
        nodes, edges = _single_block_branches(section_limit=60)

        session = await run_graph(session_id, nodes, edges, {})

        still_running = [
            node_id for node_id, state in session["block_states"].items() if state == "running"
        ]
        assert still_running == [], session["block_states"]
        assert session["block_states"]["br-a"] == "stopped", session["block_states"]
        assert session["block_states"]["br-b"] == "stopped", session["block_states"]

    async def test_the_run_fails_without_an_exit_lane(self) -> None:
        """A section that blew its own limit fails the run with nothing wired after it."""
        session_id = "par-limit-single-block-no-exit"
        nodes, edges = _single_block_branches(section_limit=60, exit_lane=False)

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert "Test 'Parallel Test' completed successfully" not in messages, messages


class TestSectionTimeLimit:
    """The section limit bounds the whole concurrent region."""

    async def test_every_running_branch_stops(self) -> None:
        """5.10.2: an expired section limit stops each branch still working."""
        session_id = "par-limit-section-stops"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest"), branch("branch_2", "probe")],
            section_limit=60,
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["block_states"]["br-a-1"] == "stopped", session["block_states"]
        assert session["block_states"]["br-b-1"] == "stopped", session["block_states"]
        assert session["block_states"]["br-a-2"] == "skipped", session["block_states"]
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]
        assert "A-TAIL" not in messages, messages
        assert "B-TAIL" not in messages, messages

    async def test_the_section_fails_and_skips_the_exit_lane(self) -> None:
        """5.10.2: the section ends failed when its limit expires."""
        session_id = "par-limit-section-fails"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest"), branch("branch_2", "probe")],
            section_limit=60,
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["par-1"] == "failed", session["block_states"]
        assert session["block_states"]["after"] == "skipped", session["block_states"]
        assert "AFTER" not in messages, messages

    async def test_the_expiry_names_the_section_limit(self) -> None:
        """5.10.2 reporting: the section limit is distinguishable from a branch limit."""
        session_id = "par-limit-section-log"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest"), branch("branch_2", "probe")],
            section_limit=60,
        )

        await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert "Parallel section exceeded its time limit of 60 ms" in messages, messages

    async def test_a_branch_that_already_finished_keeps_its_outcome(self) -> None:
        """5.10.2: the limit stops running branches; a finished one is left alone."""
        session_id = "par-limit-section-finished"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "quick"), branch("branch_2", "probe")],
                time_limit=120,
            ),
            log_node("br-a", "Quick Body", "'QUICK'"),
            delay_node("br-b-1", 400, "Body B"),
            log_node("br-b-2", "Tail B", "'B-TAIL'"),
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

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert session["block_states"]["br-a"] == "passed", session["block_states"]
        assert "QUICK" in messages, messages
        assert session["block_states"]["br-b-2"] == "skipped", session["block_states"]

    async def test_both_limits_together_report_the_one_that_expired_first(self) -> None:
        """The limits are independent; the branch limit fires before the section's."""
        session_id = "par-limit-both"
        nodes, edges = _two_slow_branches(
            [branch("branch_1", "ingest", 60), branch("branch_2", "probe")],
            section_limit=5000,
        )

        session = await run_graph(session_id, nodes, edges, {})

        messages = log_messages(session_id)
        assert session["status"] == "failed", session.get("status")
        assert "Branch 'ingest' exceeded its time limit of 60 ms" in messages, messages
        assert "Parallel section exceeded its time limit of 5000 ms" not in messages, messages


class TestABranchRecordWithoutALimit:
    """A stored branch record that is not an object carries no limit."""

    async def test_a_bare_branch_id_runs_unbounded(self) -> None:
        """A hand-authored branch list of plain ids still forks and joins."""
        session_id = "par-limit-bare-record"
        nodes = [
            parallel_node("par-1", ["branch_1", "branch_2"]),
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
        assert "A" in messages and "B" in messages, messages
        assert messages.count("AFTER") == 1, messages
        assert "Branch 1" in " ".join(messages), messages
