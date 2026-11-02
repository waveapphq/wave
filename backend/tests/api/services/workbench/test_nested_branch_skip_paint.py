"""The branches a nested branching control did not take paint skipped on the canvas (REQ-3.5.1.15).

"A branching control in the body routes exactly as it does at test level. The branches
not taken paint skipped". The same rule holds for If/Else, split Assert and Switch/Case in every
nested walker. Driven through the real engine; the canvas is read from the status events.
"""

import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    edge,
    engine_registries,
    log_node,
    run_graph,
)
from tests.api.services.workbench.slot_harness import (
    FALSE,
    TRUE,
    Edges,
    Nodes,
    assert_split_node,
    case,
    if_else_node,
    in_slot,
    switch_node,
)

pytestmark = pytest.mark.usefixtures("engine_registries")


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


def last_painted(events: list[dict[str, Any]], block_id: str) -> str | None:
    """The status the canvas last received for ``block_id``."""
    painted = [str(e["status"]) for e in events if e.get("block_id") == block_id]
    return painted[-1] if painted else None


SLOTS = ["for-body", "for-each-body", "while-body", "wait-until-body", "try-path", "function-body"]


@dataclass(frozen=True)
class _Branching:
    nodes: Nodes
    edges: Edges
    untaken: tuple[str, ...]


def _if_else() -> _Branching:
    nodes = [
        if_else_node("br"),
        log_node("taken", "Taken", "'TAKEN'"),
        log_node("untaken", "Untaken", "'NEVER'"),
        log_node("rejoin", "Rejoin", "'REJOIN'"),
    ]
    edges = [
        edge("br", "taken", "branch_0"),
        edge("br", "untaken", "branch_1"),
        edge("taken", "rejoin"),
        edge("untaken", "rejoin"),
    ]
    return _Branching(nodes, edges, ("untaken",))


def _assert_split() -> _Branching:
    nodes = [
        assert_split_node("br"),
        log_node("taken", "Taken", "'TAKEN'"),
        log_node("untaken", "Untaken", "'NEVER'"),
        log_node("rejoin", "Rejoin", "'REJOIN'"),
    ]
    edges = [
        edge("br", "taken", "pass"),
        edge("br", "untaken", "fail"),
        edge("taken", "rejoin"),
        edge("untaken", "rejoin"),
    ]
    return _Branching(nodes, edges, ("untaken",))


def _switch_case() -> _Branching:
    branches = [case("case_hit", TRUE), case("case_miss", FALSE), {"id": "dflt", "type": "default"}]
    nodes = [
        switch_node("br", branches),
        log_node("taken", "Taken", "'TAKEN'"),
        log_node("untaken", "Untaken", "'NEVER'"),
        log_node("untaken-default", "Untaken Default", "'NEVER'"),
        log_node("rejoin", "Rejoin", "'REJOIN'"),
    ]
    edges = [
        edge("br", "taken", "case_hit"),
        edge("br", "untaken", "case_miss"),
        edge("br", "untaken-default", "dflt"),
        edge("br", "rejoin", "then"),
    ]
    return _Branching(nodes, edges, ("untaken", "untaken-default"))


BRANCHING = {"if-else": _if_else, "assert-split": _assert_split, "switch-case": _switch_case}


async def _run(slot: str, kind: str) -> tuple[dict[str, Any], _Branching]:
    branching = BRANCHING[kind]()
    graph = in_slot(slot, branching.nodes, branching.edges, "br", "rejoin")
    session = await run_graph(
        f"skip-paint-{slot}-{kind}-{uuid.uuid4().hex[:8]}",
        graph.nodes,
        graph.edges,
        graph.variables,
    )
    return session, branching


@pytest.mark.parametrize("kind", sorted(BRANCHING))
@pytest.mark.parametrize("slot", SLOTS)
class TestAnUntakenBranchInANestedWalker:
    async def test_the_untaken_blocks_paint_skipped(
        self, slot: str, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        session, branching = await _run(slot, kind)

        painted = {block: last_painted(status_events, block) for block in branching.untaken}
        assert painted == dict.fromkeys(branching.untaken, "skipped"), status_events
        assert session["status"] == "passed", session.get("error")

    async def test_the_taken_branch_and_the_rejoin_keep_their_result(
        self, slot: str, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        await _run(slot, kind)

        assert last_painted(status_events, "taken") == "passed", status_events
        assert last_painted(status_events, "rejoin") == "passed", status_events

    async def test_the_skip_is_named_after_the_block(
        self, slot: str, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        _, branching = await _run(slot, kind)

        names = {e["block_id"]: e["block_name"] for e in status_events if e["status"] == "skipped"}
        expected = {"untaken": "Untaken", "untaken-default": "Untaken Default"}
        assert {block: names.get(block) for block in branching.untaken} == {
            block: expected[block] for block in branching.untaken
        }, status_events
