"""Every block a run stores skipped is painted skipped on the live canvas.

A page reload paints the canvas from the stored block states; a live run paints it from the
block status events. For every block a run stores skipped the two agree, and a block that
already showed a result is never repainted skipped in the same pass.
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    for_each_node,
    function_node,
    halt_node,
    local_definition,
    log_node,
    loop_signal_node,
    make_node,
    make_session,
    parallel_node,
    setter_node,
    try_catch_node,
)
from tests.api.services.workbench.slot_harness import (
    FALSE,
    LOOP_OUTPUTS,
    TRUE,
    Edges,
    Graph,
    Nodes,
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


async def _run(graph: Graph) -> dict[str, Any]:
    """Run the graph with one open SSH session and the Remote Execution worker patched."""
    session_id = f"skip-paint-{uuid.uuid4().hex[:12]}"
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


async def _run_unpatched(graph: Graph) -> dict[str, Any]:
    """Run the graph with one open SSH session; the caller patches the Remote Execution worker."""
    session_id = f"skip-paint-{uuid.uuid4().hex[:12]}"
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, HOST, None, None, connect_timeout=30)
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session
    with patch.object(_remote_exec, "close_worker", AsyncMock()):
        await asyncio.wait_for(
            _execute_workflow(session_id, graph.nodes, graph.edges, graph.variables), timeout=15
        )
    return session


def _unpainted_skips(session: dict[str, Any], events: list[dict[str, Any]]) -> dict[str, Any]:
    """Blocks stored skipped whose last live status is something else, or nothing."""
    last: dict[str, str] = {}
    for event in events:
        last[event["block_id"]] = event["status"]
    stored = session["block_states"]
    return {
        block: last.get(block)
        for block, state in stored.items()
        if state == "skipped" and last.get(block) != "skipped"
    }


def _repainted_skips(events: list[dict[str, Any]]) -> list[str]:
    """Blocks painted skipped after they already showed another status."""
    shown: set[str] = set()
    repainted: list[str] = []
    for event in events:
        if event["status"] != "skipped":
            shown.add(event["block_id"])
        elif event["block_id"] in shown:
            repainted.append(event["block_id"])
    return repainted


@dataclass(frozen=True)
class _Case:
    graph: Graph
    stored_skipped: frozenset[str]


def _assert_painted(case_: _Case, session: dict[str, Any], events: list[dict[str, Any]]) -> None:
    stored = session["block_states"]
    reached = {block: stored.get(block) for block in case_.stored_skipped}
    assert reached == dict.fromkeys(case_.stored_skipped, "skipped"), stored
    assert _unpainted_skips(session, events) == {}, (stored, events)
    assert _repainted_skips(events) == [], events


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


def _graph(nodes: Nodes, edges: Edges) -> Graph:
    return Graph(nodes, edges, {**LOOP_OUTPUTS, "rsid": None})


# A sub-flow that fails in its middle block: `never` is the tail the failure cuts off.
def _failing_tail() -> tuple[Nodes, Edges]:
    nodes = [
        log_node("first", "First", "'FIRST'"),
        log_node("boom", "Boom", "1/0"),
        log_node("never", "Never", "'NEVER'"),
    ]
    return nodes, [edge("first", "boom"), edge("boom", "never")]


def _tail_in_try_handler(handle: str) -> _Case:
    tail_nodes, tail_edges = _failing_tail()
    container = try_catch_node("outer", enable_catch=True, enable_finally=handle == "finally")
    nodes = [container, log_node("trier", "Trier", "1/0"), *tail_nodes]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "trier", "try"),
        edge("outer", "first", handle),
        *tail_edges,
    ]
    return _Case(_graph(nodes, edges), frozenset({"never"}))


def _tail_in_container(container: dict[str, Any], handle: str, extra: Nodes) -> _Case:
    tail_nodes, tail_edges = _failing_tail()
    nodes = [container, *extra, *tail_nodes, log_node("after", "After", "'AFTER'")]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "first", handle),
        *tail_edges,
        edge("outer", "after", "then"),
        *[edge("outer", node["id"], "branch_2") for node in extra],
    ]
    return _Case(_graph(nodes, edges), frozenset({"never", "after"}))


def _tail_in_loop_slot(slot: str) -> _Case:
    tail_nodes, tail_edges = _failing_tail()
    graph = in_slot(slot, tail_nodes, tail_edges, "first", "never")
    graph.variables["rsid"] = None
    expected = {"never", "after"} if slot != "try-path" else {"never"}
    return _Case(graph, frozenset(expected))


TAIL_CASES: dict[str, Callable[[], _Case]] = {
    "for-body": lambda: _tail_in_loop_slot("for-body"),
    "for-each-body": lambda: _tail_in_loop_slot("for-each-body"),
    "while-body": lambda: _tail_in_loop_slot("while-body"),
    "wait-until-body": lambda: _tail_in_loop_slot("wait-until-body"),
    "try-path": lambda: _tail_in_loop_slot("try-path"),
    "catch-path": lambda: _tail_in_try_handler("catch"),
    "finally-path": lambda: _tail_in_try_handler("finally"),
    "parallel-lane": lambda: _tail_in_container(
        parallel_node("outer", [branch("branch_1", "lane"), branch("branch_2", "sibling")]),
        "branch_1",
        [log_node("sibling", "Sibling", "'SIB'")],
    ),
    "switch-case": lambda: _tail_in_container(
        switch_node("outer", [case("case_hit", TRUE)]), "case_hit", []
    ),
    "remote-execution-body": lambda: _Case(
        _tail_in_container(rex_node("outer"), "body", []).graph, frozenset({"never"})
    ),
}


@pytest.mark.parametrize("slot", sorted(TAIL_CASES))
class TestTheTailAFailureCutsOff:
    async def test_it_is_painted_skipped_live(
        self, slot: str, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = TAIL_CASES[slot]()

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)


# A container `c` whose sub-flow fails, leaving by `then` to `c-then`.
def _failing_container(kind: str) -> tuple[Nodes, Edges]:
    boom = log_node("c-boom", "C Boom", "1/0")
    then = log_node("c-then", "C Then", "'C-THEN'")
    containers: dict[str, tuple[dict[str, Any], str]] = {
        "for": (for_node("c", 1, "ci"), "body"),
        "for-each": (for_each_node("c", [1]), "body"),
        "while": (while_node("c", "True", "cidx"), "body"),
        "wait-until": (retry_wait_node("c", "False", timeout=3000), "retry"),
        "parallel": (
            parallel_node("c", [branch("branch_1", "lane"), branch("branch_2", "idle")]),
            "branch_1",
        ),
        "switch": (switch_node("c", [case("case_hit", TRUE)]), "case_hit"),
        "remote-execution": (rex_node("c"), "body"),
    }
    if kind == "try-catch":
        nodes = [try_catch_node("c"), log_node("c-try", "C Try", "1/0"), boom, then]
        edges = [edge("c", "c-try", "try"), edge("c", "c-boom", "catch")]
    else:
        container, handle = containers[kind]
        nodes = [container, boom, then]
        edges = [edge("c", "c-boom", handle)]
    return nodes, [*edges, edge("c", "c-then", "then")]


CONTAINER_KINDS = [
    "for",
    "for-each",
    "while",
    "wait-until",
    "try-catch",
    "parallel",
    "switch",
    "remote-execution",
]
PLACEMENTS = ["main-flow", "for-body", "function-body"]


def _placed_container(kind: str, placement: str) -> Graph:
    nodes, edges = _failing_container(kind)
    if placement == "main-flow":
        return _graph(nodes, [edge("start-node", "c"), *edges])
    if placement == "for-body":
        graph = in_slot("for-body", nodes, edges, "c", "c-then")
    else:
        graph = in_slot("function-body", nodes, edges, "c", "c-then")
    graph.variables.update({"ci": None, "cidx": None, "rsid": None})
    return graph


@pytest.mark.parametrize("placement", PLACEMENTS)
@pytest.mark.parametrize("kind", CONTAINER_KINDS)
class TestTheExitOfAFailedContainer:
    async def test_it_is_painted_skipped_live(
        self, kind: str, placement: str, status_events: list[dict[str, Any]]
    ) -> None:
        graph = _placed_container(kind, placement)
        # A failing Remote Execution raises, so on a Test or Function flow its exit stays unset.
        stored = {"c-then"} if kind != "remote-execution" or placement == "for-body" else set()
        if placement == "for-body":
            stored.add("after")
        case_ = _Case(graph, frozenset(stored))

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)


# A container `c` in a For body whose own sub-flow breaks out of the enclosing For.
def _breaking_container(kind: str) -> Graph:
    nodes, edges = _failing_container(kind)
    brk = loop_signal_node("c-boom", "break", "outer", name="C Break")
    nodes = [brk if node["id"] == "c-boom" else node for node in nodes]
    if kind == "try-catch":
        nodes = [node for node in nodes if node["id"] != "c-try"]
        edges = [e for e in edges if e["target"] != "c-try"]
        edges = [edge("c", "c-boom", "try") if e["target"] == "c-boom" else e for e in edges]
    graph = in_slot("for-body", nodes, edges, "c", "c-then")
    graph.variables.update({"ci": None, "cidx": None, "rsid": None})
    return graph


@pytest.mark.parametrize("kind", CONTAINER_KINDS)
class TestTheExitOfAContainerABreakLeaves:
    async def test_it_is_painted_skipped_live(
        self, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = _Case(_breaking_container(kind), frozenset({"c-then"}))

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)
        assert session["status"] == "passed", session.get("error")


def _halt_on_main_flow() -> _Case:
    nodes = [
        halt_node("halt"),
        log_node("queued", "Queued", "'QUEUED'"),
        log_node("after", "After", "'AFTER'"),
    ]
    edges = [edge("start-node", "halt"), edge("start-node", "queued"), edge("halt", "after")]
    return _Case(_graph(nodes, edges), frozenset({"queued", "after"}))


def _halt_in_for_body() -> _Case:
    nodes = [halt_node("halt")]
    graph = in_slot("for-body", nodes, [], "halt", "halt")
    return _Case(graph, frozenset({"after"}))


def _try_path_passes() -> _Case:
    nodes = [
        try_catch_node("outer"),
        log_node("ok", "Ok", "'OK'"),
        log_node("handler", "Handler", "'HANDLER'"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "ok", "try"),
        edge("outer", "handler", "catch"),
    ]
    return _Case(_graph(nodes, edges), frozenset({"handler"}))


def _try_path_halts() -> _Case:
    nodes = [
        try_catch_node("outer", enable_finally=True),
        halt_node("halt", status="passed"),
        log_node("handler", "Handler", "'HANDLER'"),
        log_node("cleanup", "Cleanup", "'CLEANUP'"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "halt", "try"),
        edge("outer", "handler", "catch"),
        edge("outer", "cleanup", "finally"),
    ]
    return _Case(_graph(nodes, edges), frozenset({"handler", "cleanup"}))


def _switch_case_not_taken() -> _Case:
    nodes = [
        switch_node("outer", [case("case_hit", TRUE), case("case_miss", FALSE)]),
        log_node("hit", "Hit", "'HIT'"),
        log_node("miss", "Miss", "'MISS'"),
        log_node("miss-tail", "Miss Tail", "'MISS-TAIL'"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "hit", "case_hit"),
        edge("outer", "miss", "case_miss"),
        edge("miss", "miss-tail"),
    ]
    return _Case(_graph(nodes, edges), frozenset({"miss", "miss-tail"}))


def _disabled_container_in_try_path() -> _Case:
    inner = for_node("inner", 1, "ci")
    inner["data"]["disabled"] = True
    nodes = [
        try_catch_node("outer", enable_catch=False),
        inner,
        log_node("inner-body", "Inner Body", "'BODY'"),
        log_node("inner-then", "Inner Then", "'THEN'"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "inner", "try"),
        edge("inner", "inner-body", "body"),
        edge("inner", "inner-then", "then"),
    ]
    graph = _graph(nodes, edges)
    graph.variables["ci"] = None
    return _Case(graph, frozenset({"inner", "inner-body"}))


OTHER_CASES: dict[str, Callable[[], _Case]] = {
    "halt-on-main-flow": _halt_on_main_flow,
    "halt-in-for-body": _halt_in_for_body,
    "catch-path-after-a-passing-try": _try_path_passes,
    "catch-and-finally-after-a-halting-try": _try_path_halts,
    "switch-case-not-taken": _switch_case_not_taken,
    "body-of-a-disabled-container-in-a-try-path": _disabled_container_in_try_path,
}


@pytest.mark.parametrize("name", sorted(OTHER_CASES))
class TestABlockARunLeavesBehind:
    async def test_it_is_painted_skipped_live(
        self, name: str, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = OTHER_CASES[name]()

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)


# A container `c` whose lane never runs: `c-body` -> `c-tail`; `c` leaves by `then` to `c-then`.
def _never_run_lane(kind: str) -> tuple[Nodes, Edges, dict[str, Any]]:
    null_loop = for_each_node("c", [])
    null_loop["data"]["config"]["values"]["collection"] = None
    table_loop = for_each_node("c", [])
    table_loop["data"]["config"]["values"]["collection"] = "Table(columns=['host'])"
    table_loop["data"]["expressionFields"] = ["collection"]
    containers: dict[str, tuple[dict[str, Any], str]] = {
        "for-count-0": (for_node("c", 0, "ci"), "body"),
        "for-each-empty-list": (for_each_node("c", []), "body"),
        "for-each-null": (null_loop, "body"),
        "for-each-empty-table": (table_loop, "body"),
        "while-false-at-the-first-check": (while_node("c", "False", "cidx"), "body"),
        "wait-until-met-in-round-one": (retry_wait_node("c", "True"), "retry"),
    }
    container, handle = containers[kind]
    nodes = [
        container,
        log_node("c-body", "C Body", "'BODY'"),
        log_node("c-tail", "C Tail", "'TAIL'"),
        log_node("c-then", "C Then", "'C-THEN'"),
    ]
    edges = [edge("c", "c-body", handle), edge("c-body", "c-tail"), edge("c", "c-then", "then")]
    return nodes, edges, {}


NEVER_RUN_KINDS = [
    "for-count-0",
    "for-each-empty-list",
    "for-each-null",
    "for-each-empty-table",
    "while-false-at-the-first-check",
    "wait-until-met-in-round-one",
]


def _placed(nodes: Nodes, edges: Edges, placement: str, extra: dict[str, Any]) -> Graph:
    if placement == "main-flow":
        graph = _graph(nodes, [edge("start-node", "c"), *edges])
    else:
        graph = in_slot(placement, nodes, edges, "c", "c-then")
    graph.variables.update({"ci": None, "cidx": None, "rsid": None, **extra})
    return graph


@pytest.mark.parametrize("placement", PLACEMENTS)
@pytest.mark.parametrize("kind", NEVER_RUN_KINDS)
class TestALaneAContainerNeverRuns:
    async def test_its_blocks_are_stored_and_painted_skipped(
        self, kind: str, placement: str, status_events: list[dict[str, Any]]
    ) -> None:
        nodes, edges, extra = _never_run_lane(kind)
        case_ = _Case(_placed(nodes, edges, placement, extra), frozenset({"c-body", "c-tail"}))

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)
        assert session["block_states"]["c"] == "passed", session["block_states"]
        assert session["block_states"]["c-then"] == "passed", session["block_states"]
        assert session["status"] == "passed", session.get("error")


def _zero_pass_body_with_containers() -> _Case:
    """A For that runs zero times; its body holds an If/Else and a For with their own lanes."""
    nodes = [
        for_node("c", 0, "ci"),
        if_else_node("c-branch"),
        log_node("c-if", "C If", "'IF'"),
        log_node("c-else", "C Else", "'ELSE'"),
        for_node("c-inner", 1, "cj"),
        log_node("c-inner-body", "C Inner Body", "'INNER'"),
        log_node("c-then", "C Then", "'C-THEN'"),
    ]
    edges = [
        edge("start-node", "c"),
        edge("c", "c-branch", "body"),
        edge("c-branch", "c-if", "branch_0"),
        edge("c-branch", "c-else", "branch_1"),
        edge("c-if", "c-inner"),
        edge("c-else", "c-inner"),
        edge("c-inner", "c-inner-body", "body"),
        edge("c", "c-then", "then"),
    ]
    graph = _graph(nodes, edges)
    graph.variables.update({"ci": None, "cj": None})
    return _Case(graph, frozenset({"c-branch", "c-if", "c-else", "c-inner", "c-inner-body"}))


def _remote_body_never_opened() -> _Case:
    nodes = [rex_node("c"), log_node("c-body", "C Body", "'BODY'"), log_node("c-tail", "C Tail")]
    edges = [edge("start-node", "c"), edge("c", "c-body", "body"), edge("c-body", "c-tail")]
    return _Case(_graph(nodes, edges), frozenset({"c-body", "c-tail"}))


class TestEveryBlockOfALaneThatNeverRuns:
    async def test_a_zero_pass_body_skips_the_lanes_of_the_containers_inside_it(
        self, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = _zero_pass_body_with_containers()

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)

    async def test_a_remote_execution_body_whose_worker_never_opens_is_skipped(
        self, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = _remote_body_never_opened()

        with patch.object(_remote_exec, "open_worker", AsyncMock(side_effect=OSError("down"))):
            session = await _run_unpatched(case_.graph)

        _assert_painted(case_, session, status_events)
        assert session["block_states"]["c"] == "failed", session["block_states"]


def _lane_that_runs(kind: str) -> Graph:
    body = [log_node("c-body", "C Body", "'BODY'")]
    if kind == "for-count-2":
        return _placed(
            [for_node("c", 2, "ci"), *body], [edge("c", "c-body", "body")], "main-flow", {}
        )
    tick = setter_node("tick", "Tick", {"rounds": "rounds + 1"}, expressions=True)
    nodes = [retry_wait_node("c", "rounds >= 1"), *body, tick]
    edges = [edge("c", "c-body", "retry"), edge("c-body", "tick")]
    graph = _placed(nodes, edges, "main-flow", {})
    graph.variables["rounds"] = 0
    return graph


@pytest.mark.parametrize("kind", ["for-count-2", "wait-until-one-retry-round"])
class TestALaneThatRan:
    async def test_its_blocks_keep_their_result(
        self, kind: str, status_events: list[dict[str, Any]]
    ) -> None:
        session = await _run(_lane_that_runs(kind))

        assert session["block_states"]["c-body"] == "passed", session["block_states"]
        assert "c-body" not in {e["block_id"] for e in status_events if e["status"] == "skipped"}


def _untaken_if_branch_holding_a_loop() -> _Case:
    """An If/Else in a For body; its untaken branch holds a For with a body and rejoins."""
    nodes = [
        if_else_node("br"),
        log_node("taken", "Taken", "'TAKEN'"),
        for_node("u-for", 1, "cj"),
        log_node("u-body", "U Body", "'NEVER'"),
        log_node("rejoin", "Rejoin", "'REJOIN'"),
    ]
    edges = [
        edge("br", "taken", "branch_0"),
        edge("br", "u-for", "branch_1"),
        edge("u-for", "u-body", "body"),
        edge("taken", "rejoin"),
        edge("u-for", "rejoin", "then"),
    ]
    graph = in_slot("for-body", nodes, edges, "br", "rejoin")
    graph.variables.update({"cj": None, "rsid": None})
    return _Case(graph, frozenset({"u-for", "u-body"}))


def _untaken_case_holding_a_loop() -> _Case:
    nodes = [
        switch_node("sw", [case("case_hit", TRUE), case("case_miss", FALSE)]),
        log_node("hit", "Hit", "'HIT'"),
        for_node("m-for", 1, "cj"),
        log_node("m-body", "M Body", "'NEVER'"),
    ]
    edges = [
        edge("start-node", "sw"),
        edge("sw", "hit", "case_hit"),
        edge("sw", "m-for", "case_miss"),
        edge("m-for", "m-body", "body"),
    ]
    graph = _graph(nodes, edges)
    graph.variables["cj"] = None
    return _Case(graph, frozenset({"m-for", "m-body"}))


UNTAKEN_WITH_CONTAINERS: dict[str, Callable[[], _Case]] = {
    "if-else-in-a-for-body": _untaken_if_branch_holding_a_loop,
    "switch-case-on-the-main-flow": _untaken_case_holding_a_loop,
}


@pytest.mark.parametrize("name", sorted(UNTAKEN_WITH_CONTAINERS))
class TestAnUntakenBranchHoldingAContainer:
    async def test_the_container_and_its_lanes_are_skipped_up_to_the_rejoin(
        self, name: str, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = UNTAKEN_WITH_CONTAINERS[name]()

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)
        assert session["block_states"].get("rejoin", "passed") == "passed", session["block_states"]


# A lane cut off at `cut`; its tail holds a For `t-loop` (body `t-body`), then `t-after`.
TAIL_BLOCKS = frozenset({"t-loop", "t-body", "t-after"})


def _cut_block(kind: str, target_loop: str = "outer") -> dict[str, Any]:
    if kind == "failure":
        return log_node("cut", "Cut", "1/0")
    if kind == "halt":
        return halt_node("cut", status="passed")
    return loop_signal_node("cut", kind, target_loop, name="Cut")


def _cut_lane(kind: str, target_loop: str = "outer") -> tuple[Nodes, Edges]:
    nodes = [
        _cut_block(kind, target_loop),
        for_node("t-loop", 1, "ti"),
        log_node("t-body", "T Body", "'NEVER'"),
        log_node("t-after", "T After", "'NEVER'"),
    ]
    edges = [
        edge("cut", "t-loop"),
        edge("t-loop", "t-body", "body"),
        edge("t-loop", "t-after", "then"),
    ]
    return nodes, edges


def _cut_in_place(kind: str, placement: str) -> _Case:
    nodes, edges = _cut_lane(kind)
    if placement == "main-flow":
        graph = _graph(nodes, [edge("start-node", "cut"), *edges])
    else:
        graph = in_slot(placement, nodes, edges, "cut", "t-after")
    graph.variables.update({"ti": None, "rsid": None})
    stored = set(TAIL_BLOCKS)
    if kind in ("failure", "halt") and placement in ("for-body", "function-body"):
        stored.add("after")
    return _Case(graph, frozenset(stored))


def _signal_in_a_function_loop(kind: str) -> _Case:
    """A Break or Continue in a For body inside a Function body."""
    tail_nodes, tail_edges = _cut_lane(kind, target_loop="f-loop")
    body_nodes = [for_node("f-loop", 1, "fi"), *tail_nodes, log_node("f-after", "F After", "'F'")]
    body_edges = [
        edge("start-node", "f-loop"),
        edge("f-loop", "cut", "body"),
        *tail_edges,
        edge("f-loop", "f-after", "then"),
    ]
    graph = in_slot("function-body", body_nodes, body_edges[1:], "f-loop", "f-after")
    graph.variables.update({"ti": None, "fi": None, "rsid": None})
    return _Case(graph, TAIL_BLOCKS)


CUT_CASES: dict[str, Callable[[], _Case]] = {
    **{
        f"{kind}-{placement}": (lambda k=kind, p=placement: _cut_in_place(k, p))
        for kind in ("failure", "halt")
        for placement in ("main-flow", "for-body", "try-path", "function-body")
    },
    **{
        f"{kind}-for-body": (lambda k=kind: _cut_in_place(k, "for-body"))
        for kind in ("break", "continue")
    },
    **{
        f"{kind}-in-a-function-loop": (lambda k=kind: _signal_in_a_function_loop(k))
        for kind in ("break", "continue")
    },
}


@pytest.mark.parametrize("name", sorted(CUT_CASES))
class TestTheTailACutOffLeaves:
    async def test_it_and_the_lanes_of_containers_in_it_are_skipped(
        self, name: str, status_events: list[dict[str, Any]]
    ) -> None:
        case_ = CUT_CASES[name]()

        session = await _run(case_.graph)

        _assert_painted(case_, session, status_events)
