"""Blocks that ran inside a nested branch keep their result in the stored block states.

A block that fails or passes inside an If/Else or split Assert branch nested in a sub-flow walker
is stored with the status the canvas received; only the blocks that never ran are stored skipped.
The stored states are what a page reload, the session API and the run report read.
"""

import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    log_messages,
    log_node,
    loop_signal_node,
    parallel_node,
    run_graph,
)
from tests.api.services.workbench.slot_harness import (
    LOOP_OUTPUTS,
    TRUE,
    Edges,
    Graph,
    Nodes,
    assert_split_node,
    case,
    if_else_node,
    in_slot,
    switch_node,
)
from wavecore.api.services import log_streaming_service
from wavecore.api.services.reports.builder import build_session_report

pytestmark = pytest.mark.usefixtures("engine_registries")

SLOTS = [
    "for-body",
    "for-each-body",
    "while-body",
    "wait-until-body",
    "try-path",
    "function-body",
    "parallel-lane",
    "switch-case",
]
BRANCH_HANDLES = {"if-else": ("branch_0", "branch_1"), "assert-split": ("fail", "pass")}


@pytest.fixture
def status_events(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Every block status event the run broadcast to the canvas, in order."""
    from wavecore.api.app import app

    events: list[dict[str, Any]] = []

    class _Recorder:
        async def broadcast_to_topic(self, _topic: str, envelope: dict[str, Any]) -> None:
            payload = envelope["payload"]
            if payload.get("type") == "block_status_changed":
                events.append(payload)

    monkeypatch.setattr(app.state, "ws_manager", _Recorder(), raising=False)
    return events


@dataclass(frozen=True)
class _Shape:
    nodes: Nodes
    edges: Edges
    expected: dict[str, str]


def _branching(kind: str) -> dict[str, Any]:
    # The split Assert fails so it leaves by its fail branch.
    return if_else_node("br") if kind == "if-else" else assert_split_node("br", "False")


def _failing_in_branch(kind: str) -> _Shape:
    taken, untaken = BRANCH_HANDLES[kind]
    nodes = [
        log_node("before", "Before", "'BEFORE'"),
        _branching(kind),
        log_node("first", "First", "'FIRST'"),
        log_node("boom", "Boom", "1/0"),
        log_node("never", "Never", "'NEVER'"),
        log_node("other", "Other", "'OTHER'"),
    ]
    edges = [
        edge("before", "br"),
        edge("br", "first", taken),
        edge("br", "other", untaken),
        edge("first", "boom"),
        edge("boom", "never"),
    ]
    expected = {
        "before": "passed",
        "first": "passed",
        "boom": "failed",
        "never": "skipped",
        "other": "skipped",
    }
    return _Shape(nodes, edges, expected)


def _failing_after_rejoin(kind: str) -> _Shape:
    taken, untaken = BRANCH_HANDLES[kind]
    nodes = [
        log_node("before", "Before", "'BEFORE'"),
        _branching(kind),
        log_node("taken", "Taken", "'TAKEN'"),
        log_node("other", "Other", "'OTHER'"),
        log_node("rejoin", "Rejoin", "'REJOIN'"),
        log_node("boom", "Boom", "1/0"),
        log_node("never", "Never", "'NEVER'"),
    ]
    edges = [
        edge("before", "br"),
        edge("br", "taken", taken),
        edge("br", "other", untaken),
        edge("taken", "rejoin"),
        edge("other", "rejoin"),
        edge("rejoin", "boom"),
        edge("boom", "never"),
    ]
    expected = {
        "before": "passed",
        "taken": "passed",
        "rejoin": "passed",
        "boom": "failed",
        "never": "skipped",
        "other": "skipped",
    }
    return _Shape(nodes, edges, expected)


SHAPES = {"fails-in-branch": _failing_in_branch, "fails-after-rejoin": _failing_after_rejoin}


def _placed(slot: str, shape: _Shape) -> Graph:
    """``in_slot`` plus a Parallel lane and a Switch case holding the sub-flow."""
    if slot == "parallel-lane":
        lanes = [branch("branch_1", "lane"), branch("branch_2", "sibling")]
        extra_nodes = [parallel_node("outer", lanes), log_node("sibling", "Sibling", "'SIB'")]
        extra_edges = [edge("outer", "before", "branch_1"), edge("outer", "sibling", "branch_2")]
    elif slot == "switch-case":
        extra_nodes = [switch_node("outer", [case("case_hit", TRUE)])]
        extra_edges = [edge("outer", "before", "case_hit")]
    else:
        return in_slot(slot, shape.nodes, shape.edges, "before", "never", then=False)
    edges = [edge("start-node", "outer"), *extra_edges, *shape.edges]
    return Graph([*extra_nodes, *shape.nodes], edges, dict(LOOP_OUTPUTS))


async def _run(slot: str, kind: str, shape_name: str) -> tuple[dict[str, Any], _Shape]:
    shape = SHAPES[shape_name](kind)
    graph = _placed(slot, shape)
    session = await run_graph(
        f"branch-final-{slot}-{kind}-{shape_name}-{uuid.uuid4().hex[:8]}",
        graph.nodes,
        graph.edges,
        graph.variables,
    )
    return session, shape


@pytest.mark.parametrize("shape_name", sorted(SHAPES))
@pytest.mark.parametrize("kind", sorted(BRANCH_HANDLES))
@pytest.mark.parametrize("slot", SLOTS)
class TestABlockThatRanInANestedBranch:
    async def test_its_stored_state_is_its_result(
        self, slot: str, kind: str, shape_name: str
    ) -> None:
        session, shape = await _run(slot, kind, shape_name)

        stored = {block: session["block_states"].get(block) for block in shape.expected}
        assert stored == shape.expected, session["block_states"]

    async def test_its_stored_state_matches_what_the_canvas_last_received(
        self, slot: str, kind: str, shape_name: str, status_events: list[dict[str, Any]]
    ) -> None:
        session, shape = await _run(slot, kind, shape_name)

        ran = [block for block, state in shape.expected.items() if state != "skipped"]
        painted = {
            block: [e["status"] for e in status_events if e["block_id"] == block][-1]
            for block in ran
        }
        stored = {block: session["block_states"].get(block) for block in ran}
        assert stored == painted, status_events


@pytest.mark.parametrize("kind", sorted(BRANCH_HANDLES))
class TestABreakInANestedBranch:
    async def test_the_break_keeps_its_result_and_the_untaken_branch_is_skipped(
        self, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        taken, untaken = BRANCH_HANDLES[kind]
        nodes = [
            log_node("before", "Before", "'BEFORE'"),
            _branching(kind),
            loop_signal_node("brk", "break", "outer"),
            log_node("other", "Other", "'OTHER'"),
        ]
        edges = [edge("before", "br"), edge("br", "brk", taken), edge("br", "other", untaken)]
        graph = in_slot("for-body", nodes, edges, "before", "brk")
        session = await run_graph(
            f"branch-break-{kind}-{uuid.uuid4().hex[:8]}", graph.nodes, graph.edges, graph.variables
        )

        painted = [e["status"] for e in status_events if e["block_id"] == "brk"][-1]
        stored = {block: session["block_states"].get(block) for block in ("before", "brk", "other")}
        assert (painted, stored) == (
            "passed",
            {"before": "passed", "brk": "passed", "other": "skipped"},
        ), status_events
        assert session["status"] == "passed", session.get("error")


@pytest.mark.parametrize("slot", ["for-body", "try-path"])
class TestTheSessionReport:
    async def test_it_lists_each_block_that_ran_with_its_result(self, slot: str) -> None:
        session, shape = await _run(slot, "if-else", "fails-in-branch")

        report = build_session_report(
            session, log_streaming_service.get_logs(session["session_id"])
        )

        rows = {row["block_id"]: row["status"] for row in report["timeline"]["blocks"]}
        assert {block: rows.get(block) for block in shape.expected} == shape.expected, log_messages(
            session["session_id"]
        )
