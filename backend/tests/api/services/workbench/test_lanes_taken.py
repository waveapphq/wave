"""Every lane the flow enters is stored on the Block it leaves and painted on the live canvas.

A page reload and the run history read the stored lanes and a live run reads the lane events, so
the two agree. A Block keeps the lanes of its last pass: one that runs again or paints skipped
drops the lanes of the pass before.
"""

import asyncio
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    for_each_node,
    log_node,
    make_node,
    make_session,
    parallel_node,
    try_catch_node,
)
from tests.api.services.workbench.slot_harness import (
    FALSE,
    LOOP_OUTPUTS,
    TRUE,
    Edges,
    Graph,
    Nodes,
    assert_split_node,
    case,
    for_node,
    if_else_node,
    in_slot,
    retry_wait_node,
    switch_node,
    while_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.core.ssh.session_registry import SSHSessionRegistry

pytestmark = pytest.mark.usefixtures("engine_registries")

HOST = "exec-host"
HOST_SESSION = "exec-sess"


@pytest.fixture
def lane_events(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Every lane event the run broadcast to the canvas, in order."""
    from wavecore.api.app import app

    events: list[dict[str, Any]] = []

    class _Recorder:
        async def broadcast_to_topic(self, _topic: str, envelope: dict[str, Any]) -> None:
            payload = envelope["payload"]
            if payload.get("type") == "lanes_taken":
                events.append(payload)

    monkeypatch.setattr(app.state, "ws_manager", _Recorder(), raising=False)
    return events


async def _run(graph: Graph) -> dict[str, Any]:
    """Run the graph with one open SSH session and the Remote Execution worker patched."""
    session_id = f"lanes-{uuid.uuid4().hex[:12]}"
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, HOST, None, None, connect_timeout=30)
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session
    worker = MagicMock()
    worker.host = HOST
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(return_value=worker)),
        patch.object(_remote_exec, "close_worker", AsyncMock()),
    ):
        await asyncio.wait_for(
            _execute_workflow(session_id, graph.nodes, graph.edges, graph.variables), timeout=15
        )
    return session


def _painted_lanes(events: list[dict[str, Any]]) -> dict[str, list[str]]:
    """The lanes the live canvas shows: the last lane event per Block."""
    shown: dict[str, list[str]] = {}
    for event in events:
        shown[event["block_id"]] = event["lanes"]
    return shown


def _assert_lanes(
    session: dict[str, Any], events: list[dict[str, Any]], expected: dict[str, list[str]]
) -> None:
    assert session["status"] == "passed", session.get("error")
    assert session.get("lanes_taken", {}) == expected, session["block_states"]
    assert {block: _painted_lanes(events).get(block) for block in expected} == expected, events


def _graph(nodes: Nodes, edges: Edges, **variables: Any) -> Graph:
    return Graph(nodes, [edge("start-node", nodes[0]["id"]), *edges], {**LOOP_OUTPUTS, **variables})


def _route(node_id: str = "route", disabled: bool = False) -> dict[str, Any]:
    """An If/Else with an if, an else if and an else; the if branch is taken."""
    branches = [
        {"type": "if", "id": "branch_0", "conditions": TRUE},
        {"type": "else_if", "id": "branch_1", "conditions": FALSE},
        {"type": "else", "id": "branch_2"},
    ]
    return make_node(
        node_id,
        label="If/Else",
        element_type="if-else",
        config_values={"branches": branches},
        disabled=disabled,
    )


def rex_node(node_id: str) -> dict[str, Any]:
    """A Remote Execution container on the one open SSH session."""
    return make_node(
        node_id,
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": HOST_SESSION},
        output_bindings={"remote_session_id": "rsid"},
    )


class TestBranchesThatJoinOneBlock:
    async def test_only_the_branch_taken_is_stored(self, lane_events: list[dict[str, Any]]) -> None:
        graph = _graph(
            [_route(), log_node("join", "Join")],
            [
                edge("route", "join", "branch_0"),
                edge("route", "join", "branch_1"),
                edge("route", "join", "branch_2"),
            ],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"route": ["branch_0"]})

    @pytest.mark.parametrize(("expression", "lane"), [("True", "pass"), ("False", "fail")])
    async def test_a_split_assert_stores_the_lane_it_left_by(
        self, expression: str, lane: str, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [assert_split_node("gate", expression), log_node("join", "Join")],
            [edge("gate", "join", "pass"), edge("gate", "join", "fail")],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"gate": [lane]})

    async def test_a_branch_inside_a_loop_body_is_stored(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [for_node("loop", 1), _route(), log_node("join", "Join")],
            [
                edge("loop", "route", "body"),
                edge("route", "join", "branch_0"),
                edge("route", "join", "branch_2"),
            ],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"loop": ["body"], "route": ["branch_0"]})


class TestScopedLanes:
    async def test_switch_stores_every_case_that_ran(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        branches = [
            case("case_a", TRUE, break_on=False),
            case("case_b", TRUE),
            {"id": "case_default", "type": "default", "label": ""},
        ]
        graph = _graph(
            [
                switch_node("pick", branches),
                log_node("a", "A"),
                log_node("b", "B"),
                log_node("d", "D"),
                log_node("after", "After"),
            ],
            [
                edge("pick", "a", "case_a"),
                edge("pick", "b", "case_b"),
                edge("pick", "d", "case_default"),
                edge("pick", "after", "then"),
            ],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"pick": ["case_a", "case_b"]})

    async def test_parallel_stores_every_lane_it_started(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [
                parallel_node("fork", [branch("branch_1"), branch("branch_2")]),
                log_node("one", "One"),
                log_node("two", "Two"),
            ],
            [edge("fork", "one", "branch_1"), edge("fork", "two", "branch_2")],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"fork": ["branch_1", "branch_2"]})

    @pytest.mark.parametrize(
        ("message", "expected"),
        [("'OK'", ["try", "finally"]), ("1/0", ["try", "catch", "finally"])],
        ids=["try-passes", "try-fails"],
    )
    async def test_try_catch_stores_the_paths_that_ran(
        self, message: str, expected: list[str], lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [
                try_catch_node("guard", enable_catch=True, enable_finally=True),
                log_node("trier", "Trier", message),
                log_node("catcher", "Catcher"),
                log_node("closer", "Closer"),
                log_node("after", "After"),
            ],
            [
                edge("guard", "trier", "try"),
                edge("guard", "catcher", "catch"),
                edge("guard", "closer", "finally"),
                edge("guard", "after", "then"),
            ],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"guard": expected})

    @pytest.mark.parametrize(
        "slot", ["for-body", "for-each-body", "while-body", "wait-until-body", "try-path"]
    )
    async def test_a_lane_that_ran_is_stored(
        self, slot: str, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = in_slot(slot, [log_node("inner", "Inner")], [], "inner", "inner")
        handle = {"wait-until-body": "retry", "try-path": "try"}.get(slot, "body")

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"outer": [handle]})

    async def test_a_remote_execution_body_that_ran_is_stored(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [rex_node("remote"), log_node("inner", "Inner")],
            [edge("remote", "inner", "body")],
            rsid=None,
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"remote": ["body"]})


class TestALaneThatNeverRuns:
    @pytest.mark.parametrize(
        ("container", "handle"),
        [
            (for_node("loop", 0), "body"),
            (for_each_node("loop", []), "body"),
            (while_node("loop", "False"), "body"),
            (retry_wait_node("loop", "True"), "retry"),
        ],
        ids=["for-count-0", "for-each-empty", "while-false-at-the-first-check", "wait-met-at-once"],
    )
    async def test_is_never_stored(
        self, container: dict[str, Any], handle: str, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [container, log_node("body", "Body"), log_node("after", "After")],
            [edge("loop", "body", handle), edge("loop", "after", "then")],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {})
        assert session["block_states"]["body"] == "skipped"

    @pytest.mark.parametrize(
        "kind",
        [
            "switch-case-matched",
            "parallel-lane",
            "try-path",
            "catch-path",
            "while-body",
            "remote-execution-body",
        ],
    )
    async def test_a_lane_with_no_block_is_never_stored(
        self, kind: str, lane_events: list[dict[str, Any]]
    ) -> None:
        containers: dict[str, dict[str, Any]] = {
            "switch-case-matched": switch_node("box", [case("case_hit", TRUE)]),
            "parallel-lane": parallel_node("box", [branch("branch_1"), branch("branch_2")]),
            "try-path": try_catch_node("box"),
            "catch-path": try_catch_node("box"),
            "while-body": while_node("box", "idx < 1"),
            "remote-execution-body": rex_node("box"),
        }
        nodes = [containers[kind], log_node("after", "After")]
        edges = [edge("box", "after", "then")]
        if kind == "catch-path":
            nodes.append(log_node("trier", "Trier", "1/0"))
            edges.append(edge("box", "trier", "try"))
        if kind == "parallel-lane":
            nodes.append(log_node("one", "One"))
            edges.append(edge("box", "one", "branch_1"))
        graph = _graph(nodes, edges, idx=0, rsid=None)

        session = await _run(graph)

        expected = {"catch-path": {"box": ["try"]}, "parallel-lane": {"box": ["branch_1"]}}.get(
            kind, {}
        )
        _assert_lanes(session, lane_events, expected)

    async def test_an_if_else_with_no_match_stores_nothing(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [if_else_node("route", FALSE), log_node("join", "Join")],
            [edge("route", "join", "branch_0")],
        )
        graph.nodes[0]["data"]["config"]["values"]["branches"].pop()

        session = await _run(graph)

        _assert_lanes(session, lane_events, {})


class TestADisabledBlockPassesTheFlowOn:
    async def test_a_disabled_if_else_stores_its_first_branch(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [_route(disabled=True), log_node("first", "First"), log_node("other", "Other")],
            [edge("route", "first", "branch_0"), edge("route", "other", "branch_1")],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"route": ["branch_0"]})

    async def test_a_disabled_split_assert_stores_its_pass_lane(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        gate = assert_split_node("gate", "False")
        gate["data"]["disabled"] = True
        graph = _graph(
            [gate, log_node("passed", "Passed"), log_node("failed", "Failed")],
            [edge("gate", "passed", "pass"), edge("gate", "failed", "fail")],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"gate": ["pass"]})


class TestTheLastPassCounts:
    async def test_a_branch_taken_in_an_earlier_pass_is_dropped(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        route = if_else_node("route", [{"type": "expression", "expression": "i == 0"}])
        graph = _graph(
            [for_node("loop", 2), route, log_node("first", "First"), log_node("second", "Second")],
            [
                edge("loop", "route", "body"),
                edge("route", "first", "branch_0"),
                edge("route", "second", "branch_1"),
            ],
        )

        session = await _run(graph)

        _assert_lanes(session, lane_events, {"loop": ["body"], "route": ["branch_1"]})

    async def test_a_container_on_a_lane_the_last_pass_skipped_drops_its_lanes(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        route = if_else_node("route", [{"type": "expression", "expression": "i == 0"}])
        graph = _graph(
            [
                for_node("loop", 2),
                route,
                for_node("inner", 1, "j"),
                log_node("deep", "Deep"),
                log_node("second", "Second"),
            ],
            [
                edge("loop", "route", "body"),
                edge("route", "inner", "branch_0"),
                edge("inner", "deep", "body"),
                edge("route", "second", "branch_1"),
            ],
            j=None,
        )

        session = await _run(graph)

        assert session["block_states"]["inner"] == "skipped"
        _assert_lanes(session, lane_events, {"loop": ["body"], "route": ["branch_1"]})
        assert [event["block_id"] for event in lane_events].count("inner") == 1


class TestTheStoredRun:
    async def test_the_end_of_run_snapshot_holds_the_lanes(
        self, lane_events: list[dict[str, Any]]
    ) -> None:
        graph = _graph(
            [_route(), log_node("join", "Join")],
            [edge("route", "join", "branch_0"), edge("route", "join", "branch_2")],
        )

        session = await _run(graph)
        snapshot = _wb_common.get_session_snapshot(session["session_id"]) or {}

        assert snapshot["lanes_taken"] == {"route": ["branch_0"]}
        assert snapshot["lanes_taken"]["route"] is not session["lanes_taken"]["route"]
