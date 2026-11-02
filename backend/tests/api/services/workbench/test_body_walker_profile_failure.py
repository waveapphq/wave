"""A sub-flow Block whose profile cannot load fails at that Block, like any Block failure.

Driven through the real engine for every sub-flow walker slot: the Block paints failed, logs one
"Block '<name>' failed" line, and its container ends the way a plain Block failure ends it.
"""

import asyncio
import uuid
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_messages,
    log_node,
    make_session,
)
from tests.api.services.workbench.slot_harness import (
    Graph,
    assert_split_node,
    if_else_node,
    in_slot,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service

pytestmark = pytest.mark.usefixtures("engine_registries")

PROFILE_ERROR = "cannot unseal profile p1"


def _pair(profile: bool) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    failing = log_node("a", "A", "'A-RAN'" if profile else "'A-RAN' if 1 / flag else ''")
    if profile:
        failing["data"]["config"]["profileBindings"] = [{"profileId": "p1", "alias": "api"}]
    return [failing, log_node("b", "B", "'B-RAN'")], [edge("a", "b")]


def _graph(slot: str, profile: bool) -> Graph:
    pair, pair_edges = _pair(profile)
    if slot in ("if-branch", "assert-branch"):
        branching = if_else_node("br") if slot == "if-branch" else assert_split_node("br")
        taken, untaken = ("branch_0", "branch_1") if slot == "if-branch" else ("pass", "fail")
        nodes = [branching, *pair, log_node("other", "Other", "'OTHER'")]
        edges = [edge("br", "a", taken), edge("br", "other", untaken), *pair_edges]
        return in_slot("for-body", nodes, edges, "br", "b")
    return in_slot(slot, pair, pair_edges, "a", "b")


@dataclass
class _Outcome:
    status: str
    block_states: dict[str, Any]
    failure_lines: list[str]
    ran_after: int


async def _run(slot: str, profile: bool) -> _Outcome:
    graph = _graph(slot, profile)
    session_id = f"profile-failure-{slot}-{uuid.uuid4().hex[:8]}"
    _wb_common._workbench_sessions[session_id] = make_session(session_id)
    with patch(
        "wavecore.api.services.profiles.service.get_profile_config_for_execution",
        MagicMock(side_effect=RuntimeError(PROFILE_ERROR)),
    ):
        await asyncio.wait_for(
            workbench_service._execute_workflow(
                session_id, graph.nodes, graph.edges, {**graph.variables, "flag": 0}
            ),
            timeout=5,
        )
    session = _wb_common._workbench_sessions[session_id]
    messages = log_messages(session_id)
    return _Outcome(
        status=session["status"],
        block_states=dict(session["block_states"]),
        failure_lines=[m for m in messages if m.startswith("Block 'A' failed:")],
        ran_after=messages.count("AFTER"),
    )


PAINTED_SLOTS = [
    "for-body",
    "for-each-body",
    "while-body",
    "wait-until-body",
    "try-path",
    "function-body",
]
SUB_FLOW_SLOTS = [*PAINTED_SLOTS, "if-branch", "assert-branch"]


@pytest.mark.parametrize("slot", PAINTED_SLOTS)
async def test_the_block_paints_failed(slot: str) -> None:
    outcome = await _run(slot, profile=True)

    assert outcome.block_states.get("a") == "failed", outcome


@pytest.mark.parametrize("slot", SUB_FLOW_SLOTS)
class TestProfileFailureInASubFlowWalker:
    async def test_the_block_logs_one_failure_line_and_nothing_stays_running(
        self, slot: str
    ) -> None:
        outcome = await _run(slot, profile=True)

        assert outcome.failure_lines == [f"Block 'A' failed: {PROFILE_ERROR}"], outcome
        assert "running" not in outcome.block_states.values(), outcome

    async def test_the_container_ends_as_it_does_for_any_block_failure(self, slot: str) -> None:
        profile = await _run(slot, profile=True)
        plain = await _run(slot, profile=False)

        assert len(plain.failure_lines) == 1, plain
        assert (profile.status, profile.block_states, profile.ran_after) == (
            plain.status,
            plain.block_states,
            plain.ran_after,
        )
