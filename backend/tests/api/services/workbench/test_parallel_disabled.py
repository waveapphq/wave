"""A disabled Parallel passes the flow through its exit lane (REQ-3.2.3.2).

A disabled section runs nothing: its branch bodies cascade to skipped and the
flow continues through ``then``, which is how every container control behaves
when disabled. The same single fall-through path is what makes Skip-while-
paused legal on a Parallel, the gain Switch got in SWITCH-11 and Wait Until in
WAIT-9.
"""

from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    log_messages,
    log_node,
    make_session,
    parallel_node,
    run_graph,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.signals import (
    _THEN_EGRESS_ONLY,
    _disabled_pass_through_handles,
)

pytestmark = pytest.mark.usefixtures("engine_registries")


class TestParallelIsAThenEgressContainer:
    """The disabled-routing matrix classes Parallel with the other containers."""

    def test_parallel_is_registered_as_then_egress_only(self) -> None:
        """A disabled Parallel keeps no branch as a pass-through; only ``then``."""
        assert "parallel" in _THEN_EGRESS_ONLY

    def test_no_branch_lane_survives_a_disabled_section(self) -> None:
        """Every non-``then`` descendant of a disabled Parallel cascade-skips."""
        node = parallel_node("par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")])
        assert _disabled_pass_through_handles(node) == frozenset()

    def test_the_matrix_ignores_the_branch_count(self) -> None:
        """The routing is the same whether the section has two branches or five."""
        node = parallel_node("par-1", [branch(f"branch_{n}") for n in range(1, 6)])
        assert _disabled_pass_through_handles(node) == frozenset()


class TestDisabledParallelRun:
    """A disabled section skips its bodies and continues through the exit lane."""

    async def test_branch_bodies_skip_and_the_exit_lane_runs(self) -> None:
        """5.10.2: the exit is the pass-through of a disabled section."""
        session_id = "par-disabled"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "ingest"), branch("branch_2", "probe")],
                disabled=True,
            ),
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
        assert session["block_states"]["par-1"] == "skipped", session["block_states"]
        assert session["block_states"]["br-a"] == "skipped", session["block_states"]
        assert session["block_states"]["br-b"] == "skipped", session["block_states"]
        assert session["block_states"]["after"] == "passed", session["block_states"]
        assert "A" not in messages, messages
        assert "B" not in messages, messages

    async def test_whole_branch_chains_skip_not_just_their_heads(self) -> None:
        """A disabled section dims every node behind each lane."""
        # Guard: the cascade must reach a branch's tail, not stop at its head.
        session_id = "par-disabled-chain"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "ingest"), branch("branch_2", "probe")],
                disabled=True,
            ),
            log_node("br-a-1", "A1", "'A1'"),
            log_node("br-a-2", "A2", "'A2'"),
            log_node("br-b", "B", "'B'"),
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
        assert session["status"] == "passed", session.get("status")
        assert session["block_states"]["br-a-2"] == "skipped", session["block_states"]
        assert "A2" not in messages, messages
        assert messages.count("AFTER") == 1, messages

    async def test_a_disabled_section_with_a_time_limit_still_passes_through(self) -> None:
        """A disabled section runs nothing, so no limit can expire on it."""
        session_id = "par-disabled-limit"
        nodes = [
            parallel_node(
                "par-1",
                [branch("branch_1", "ingest", 1), branch("branch_2", "probe")],
                time_limit=1,
                disabled=True,
            ),
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
        assert session["block_states"]["after"] == "passed", session["block_states"]


class TestSkipWhilePausedOnAParallel:
    """Parallel is a container, not a diverging parent, so Skip is accepted."""

    @staticmethod
    def _seed_paused_parallel(session_id: str) -> dict[str, Any]:
        """A session parked on a Parallel wired to two branches and ``then``."""
        session = make_session(session_id)
        session["status"] = "paused"
        session["paused_node_id"] = "par-1"
        session["block_states"] = {"par-1": "running"}
        session["_debug_node_records"] = {
            "par-1": parallel_node(
                "par-1", [branch("branch_1", "ingest"), branch("branch_2", "probe")]
            )
        }
        session["_adj"] = {
            "par-1": [("br-a", "branch_1"), ("br-b", "branch_2"), ("after", "then")],
            "br-a": [("br-a-2", None)],
            "br-a-2": [],
            "br-b": [],
            "after": [],
        }
        _wb_common._workbench_sessions[session_id] = session
        return session

    def test_skip_is_accepted_on_a_paused_section(self) -> None:
        """The section has one fall-through path, so Skip is not refused."""
        session_id = "par-skip-accepted"
        self._seed_paused_parallel(session_id)

        result = workbench_service.skip_current_block(session_id=session_id)

        assert result["skipped_node_id"] == "par-1"
        assert result["status"] == "paused"

    def test_skip_marks_the_section_skipped(self) -> None:
        """The paused Parallel itself paints skipped."""
        session_id = "par-skip-self"
        session = self._seed_paused_parallel(session_id)

        workbench_service.skip_current_block(session_id=session_id)

        assert session["block_states"]["par-1"] == "skipped", session["block_states"]
        assert "par-1" in session["skipped_node_ids"], session["skipped_node_ids"]

    def test_skip_cascades_to_every_branch_body(self) -> None:
        """Skipping the section dims each lane's whole chain."""
        session_id = "par-skip-cascade"
        session = self._seed_paused_parallel(session_id)

        workbench_service.skip_current_block(session_id=session_id)

        for node_id in ("br-a", "br-a-2", "br-b"):
            assert session["block_states"][node_id] == "skipped", session["block_states"]

    def test_skip_leaves_the_exit_lane_alone(self) -> None:
        """``then`` is the boundary of the cascade - it is where the engine re-pauses."""
        session_id = "par-skip-exit"
        session = self._seed_paused_parallel(session_id)

        workbench_service.skip_current_block(session_id=session_id)

        assert "after" not in session["block_states"], session["block_states"]
        assert session["pause_at_next_node"] is True
