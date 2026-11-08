"""What sits inside a Remote Execution body runs as it does anywhere else (REQ-3.4.1.3).

Covers REMEX-1 and REMEX-4 for the body itself: every container at any depth steers on WAVE,
every remotable block at any depth (a Function body called from the body included) runs on
the Execution Host through the innermost enclosing container's worker, and a Remote Execution
inside a body opens its own worker. Driven through the real engine with the worker patched.
"""

import asyncio
import re
import uuid
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    assert_node,
    branch,
    edge,
    engine_registries,
    for_each_node,
    function_node,
    halt_node,
    local_definition,
    log_messages,
    log_node,
    make_node,
    make_session,
    parallel_node,
    setter_node,
    try_catch_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.core.remote_exec import worker_registry as _worker_registry
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.http_client import HTTPClientPlugin

HOST = "prod-host"
HOST_SESSION = "host-sess-1"
INNER_HOST = "inner-host"
INNER_SESSION = "inner-sess-1"
RSID = re.compile(r"^[0-9a-f]{32}$")

Graph = tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]
LOOP_OUTPUTS: dict[str, Any] = {"i": None, "idx": None, "fe_item": None, "fe_idx": None}


@pytest.fixture(autouse=True)
def _remotable_plugin(engine_registries: Any) -> None:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())


def rex_node(node_id: str, session_ref: str, rsid_var: str, expression: bool = False) -> Any:
    """A Remote Execution container whose Execution Host is ``session_ref``."""
    node = make_node(
        node_id,
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": session_ref},
        output_bindings={"remote_session_id": rsid_var},
    )
    if expression:
        node["data"]["expressionFields"] = ["session_id"]
    return node


def http_node(node_id: str, path: str) -> dict[str, Any]:
    """A remotable HTTP block; the worker answers with the path it was sent."""
    return make_node(
        node_id,
        label="HTTP",
        element_type="http-client",
        node_type="plugin",
        config_values={"method": "GET", "url": f"http://target.local{path}"},
        name=f"HTTP {path}",
    )


def inner_setter(node_id: str = "set-inner") -> dict[str, Any]:
    return setter_node(node_id, "Set inner", {"nest_inner": "'inner'"}, expressions=True)


@dataclass
class _Outcome:
    session: dict[str, Any]
    variables: dict[str, Any]
    messages: list[str]
    workers: dict[str, Any]
    served: list[tuple[str, str]]
    events: list[str]
    open_worker: AsyncMock
    close_worker: AsyncMock
    local_http: AsyncMock

    def paths_on(self, host: str) -> list[str]:
        return [path for served_host, path in self.served if served_host == host]


@dataclass
class _Run:
    failing_paths: set[str] = field(default_factory=set)
    hold_path: str | None = None


async def _run(graph: Graph, run: _Run | None = None) -> _Outcome:
    """Run the graph over two open SSH sessions, each host answering on its own worker."""
    spec = run or _Run()
    nodes, edges, variables = graph
    session_id = f"rex-body-{uuid.uuid4().hex[:12]}"
    registry = SSHSessionRegistry()
    connections = {HOST: MagicMock(), INNER_HOST: MagicMock()}
    registry.register(HOST_SESSION, connections[HOST], None, HOST, None, None, connect_timeout=30)
    registry.register(
        INNER_SESSION, connections[INNER_HOST], None, INNER_HOST, None, None, connect_timeout=30
    )
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session

    workers: dict[str, Any] = {}
    served: list[tuple[str, str]] = []
    events: list[str] = []
    for host in (HOST, INNER_HOST):
        worker = MagicMock()
        worker.host = host
        workers[host] = worker
    by_connection = {id(connections[host]): workers[host] for host in workers}

    async def _open(connection: Any) -> Any:
        worker = by_connection[id(connection)]
        events.append(f"open:{worker.host}")
        return worker

    async def _close(worker: Any) -> None:
        events.append(f"close:{worker.host}")

    async def _answer(
        worker: Any,
        _plugin: str,
        params: dict[str, Any],
        _vars: dict[str, Any],
        _trust: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        path = str(params["url"]).removeprefix("http://target.local")
        served.append((worker.host, path))
        events.append(f"run:{worker.host}:{path}")
        if path == spec.hold_path:
            await asyncio.sleep(3600)
        if path in spec.failing_paths:
            raise RuntimeError("boom")
        return {"return_value": {"status_code": 200, "body": path}, "logs": [], "status": "passed"}

    open_worker = AsyncMock(side_effect=_open)
    close_worker = AsyncMock(side_effect=_close)
    local_http = AsyncMock()
    with (
        patch.object(_remote_exec, "open_worker", open_worker),
        patch.object(_remote_exec, "run_on_worker", AsyncMock(side_effect=_answer)),
        patch.object(_remote_exec, "close_worker", close_worker),
        patch.object(HTTPClientPlugin, "execute", local_http),
    ):
        await asyncio.wait_for(_execute_workflow(session_id, nodes, edges, variables), timeout=10)
    return _Outcome(
        session=session,
        variables=variables,
        messages=log_messages(session_id),
        workers=workers,
        served=served,
        events=events,
        open_worker=open_worker,
        close_worker=close_worker,
        local_http=local_http,
    )


def _body_around(container: list[dict[str, Any]], container_edges: list[dict[str, Any]]) -> Graph:
    """rex body: pre -> <container `inner`> -then-> post; rex then -> after-rex."""
    nodes = [
        rex_node("rex", HOST_SESSION, "rsid"),
        http_node("pre", "/pre"),
        *container,
        http_node("post", "/post"),
        log_node("after-rex", "After Remote Execution", "'after'"),
    ]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "pre", "body"),
        edge("pre", "inner"),
        *container_edges,
        edge("rex", "after-rex", "then"),
    ]
    return nodes, edges, {"rsid": None, "nest_inner": "seed", "counter": 0, **LOOP_OUTPUTS}


def _slot(slot: str, then: bool = True) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The inner slot: in -> set-inner; the container leaves by `then` to post."""
    nodes = [http_node("in", "/in"), inner_setter()]
    edges = [edge("inner", "in", slot), edge("in", "set-inner")]
    if then:
        edges.append(edge("inner", "post", "then"))
    return nodes, edges


def _for_graph() -> Graph:
    loop = make_node(
        "inner",
        label="For Loop",
        element_type="for",
        config_values={"mode": "count", "count": 2},
        output_bindings={"index": "i"},
    )
    nodes, edges = _slot("body")
    return _body_around([loop, *nodes], edges)


def _for_each_graph() -> Graph:
    loop = for_each_node("inner", ["a", "b"])
    nodes, edges = _slot("body")
    return _body_around([loop, *nodes], edges)


def _while_graph() -> Graph:
    loop = make_node(
        "inner",
        label="While Loop",
        element_type="while",
        config_values={
            "mode": "while-do",
            "conditions": [{"type": "expression", "expression": "counter < 2"}],
        },
        output_bindings={"index": "idx"},
    )
    nodes, edges = _slot("body")
    bump = setter_node("bump", "Bump", {"counter": "counter + 1"}, expressions=True)
    return _body_around([loop, *nodes, bump], [*edges, edge("set-inner", "bump")])


def _wait_until_graph() -> Graph:
    wait = make_node(
        "inner",
        label="Wait Until",
        element_type="wait-until",
        config_values={
            "conditions": [{"type": "expression", "expression": "counter >= 1"}],
            "timeout": 3000,
            "check_interval": 10,
            "mode": "retry",
        },
        output_bindings={"passed": "ok", "elapsed": "waited"},
    )
    nodes, edges = _slot("retry")
    bump = setter_node("bump", "Bump", {"counter": "counter + 1"}, expressions=True)
    return _body_around([wait, *nodes, bump], [*edges, edge("set-inner", "bump")])


def _parallel_graph() -> Graph:
    par = parallel_node("inner", [branch("branch_1", "one"), branch("branch_2", "two")])
    nodes, edges = _slot("branch_1")
    lane = http_node("lane-2", "/lane-2")
    return _body_around([par, *nodes, lane], [*edges, edge("inner", "lane-2", "branch_2")])


def _try_catch_graph() -> Graph:
    nodes, edges = _slot("try")
    return _body_around([try_catch_node("inner"), *nodes], edges)


def _switch_graph() -> Graph:
    case = {
        "id": "branch_0",
        "type": "case",
        "label": "",
        "conditions": [{"type": "expression", "expression": "True"}],
        "break": True,
    }
    switch = make_node(
        "inner", label="Switch/Case", element_type="switch-case", config_values={"branches": [case]}
    )
    nodes, edges = _slot("branch_0")
    return _body_around([switch, *nodes], edges)


def _if_else_graph() -> Graph:
    branches = [
        {
            "type": "if",
            "id": "branch_0",
            "conditions": [{"type": "expression", "expression": "True"}],
        },
        {"type": "else", "id": "branch_1"},
    ]
    if_else = make_node(
        "inner", label="If/Else", element_type="if-else", config_values={"branches": branches}
    )
    nodes, edges = _slot("branch_0", then=False)
    untaken = log_node("untaken", "Untaken", "'never'")
    rejoin = [
        edge("inner", "untaken", "branch_1"),
        edge("untaken", "post"),
        edge("set-inner", "post"),
    ]
    return _body_around([if_else, *nodes, untaken], [*edges, *rejoin])


def _function_graph() -> Graph:
    body = [http_node("in", "/in"), inner_setter()]
    definition = local_definition(
        "BodyCaller", body, [edge("start-node", "in"), edge("in", "set-inner")]
    )
    definition["outputs"] = [{"name": "nest_inner", "type": "string"}]
    fn = function_node("inner", definition)
    fn["data"]["config"]["outputBindings"] = {"nest_inner": "nest_inner"}
    return _body_around([fn], [edge("inner", "post")])


@dataclass(frozen=True)
class _Kind:
    graph: Any
    runs: int
    extra_paths: tuple[str, ...] = ()


KINDS: dict[str, _Kind] = {
    "for": _Kind(_for_graph, 2),
    "for-each": _Kind(_for_each_graph, 2),
    "while": _Kind(_while_graph, 2),
    "wait-until": _Kind(_wait_until_graph, 1),
    "parallel": _Kind(_parallel_graph, 1, ("/lane-2",)),
    "try-catch": _Kind(_try_catch_graph, 1),
    "switch-case": _Kind(_switch_graph, 1),
    "if-else": _Kind(_if_else_graph, 1),
    "function": _Kind(_function_graph, 1),
}


@pytest.mark.parametrize("kind", sorted(KINDS))
class TestAContainerInsideTheBody:
    """A container in a body steers on WAVE; its remotable blocks use the body worker."""

    async def test_the_inner_sub_flow_runs_on_the_body_worker(self, kind: str) -> None:
        spec = KINDS[kind]
        outcome = await _run(spec.graph())

        expected = Counter(["/pre", *["/in"] * spec.runs, *spec.extra_paths, "/post"])
        assert Counter(outcome.paths_on(HOST)) == expected, outcome.messages
        assert outcome.paths_on(INNER_HOST) == [], outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_one_worker_opens_for_the_body_and_closes(self, kind: str) -> None:
        outcome = await _run(KINDS[kind].graph())

        assert outcome.events[0] == f"open:{HOST}", outcome.events
        assert outcome.events.count(f"open:{HOST}") == 1, outcome.events
        assert outcome.events[-1] == f"close:{HOST}", outcome.events

    async def test_the_body_finishes_before_the_then_successor(self, kind: str) -> None:
        outcome = await _run(KINDS[kind].graph())

        assert outcome.served[-1] == (HOST, "/post"), outcome.served
        assert outcome.session["block_states"].get("inner") == "passed", outcome.messages
        assert outcome.session["block_states"].get("after-rex") == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages
        running = [
            nid for nid, state in outcome.session["block_states"].items() if state == "running"
        ]
        assert running == [], outcome.session["block_states"]

    async def test_a_variable_written_inside_reads_at_the_top(self, kind: str) -> None:
        outcome = await _run(KINDS[kind].graph())

        assert outcome.variables["nest_inner"] == "inner", outcome.messages
        assert RSID.match(str(outcome.variables["rsid"])), outcome.variables


class TestARemoteExecutionInsideTheBody:
    """An inner container opens its own worker on its own Execution Host."""

    @staticmethod
    def _graph() -> Graph:
        inner = rex_node("inner", INNER_SESSION, "rsid_inner")
        nodes, edges = _slot("body")
        return _body_around([inner, *nodes], edges)

    async def test_the_inner_body_runs_on_the_inner_host(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.paths_on(INNER_HOST) == ["/in"], outcome.served
        assert outcome.paths_on(HOST) == ["/pre", "/post"], outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_the_inner_worker_closes_before_the_outer_body_resumes(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.events == [
            f"open:{HOST}",
            f"run:{HOST}:/pre",
            f"open:{INNER_HOST}",
            f"run:{INNER_HOST}:/in",
            f"close:{INNER_HOST}",
            f"run:{HOST}:/post",
            f"close:{HOST}",
        ]

    async def test_both_remote_session_ids_bind(self) -> None:
        outcome = await _run(self._graph())

        assert RSID.match(str(outcome.variables.get("rsid_inner"))), outcome.variables
        assert RSID.match(str(outcome.variables["rsid"])), outcome.variables
        assert outcome.variables["rsid_inner"] != outcome.variables["rsid"]
        assert outcome.variables["nest_inner"] == "inner", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages


def _failing_catch_graph() -> Graph:
    nodes, edges = _slot("catch")
    boom = log_node("try-boom", "Try boom", "1/0")
    return _body_around(
        [try_catch_node("inner"), boom, *nodes], [edge("inner", "try-boom", "try"), *edges]
    )


FAILING_DEEPER: dict[str, tuple[Any, str]] = {
    "for": (_for_graph, "Nested control in 'For Loop' failed"),
    "for-each": (_for_each_graph, "Nested control in 'ForEach' failed"),
    "while": (_while_graph, "Nested control in 'While Loop' failed"),
    "parallel": (_parallel_graph, "Nested control in 'Parallel' failed"),
    "try-catch": (_failing_catch_graph, "Nested control in 'Try/Catch' failed"),
    "switch-case": (_switch_graph, "Nested control in 'Switch/Case' failed"),
    "if-else": (_if_else_graph, "Nested control in 'If/Else' failed"),
    "function": (_function_graph, "boom"),
}


class TestAFailureDeeperInTheBody:
    """The container names its host for a block that failed there at any depth."""

    @pytest.mark.parametrize("kind", sorted(FAILING_DEEPER))
    async def test_the_container_names_the_host(self, kind: str) -> None:
        graph, detail = FAILING_DEEPER[kind]
        outcome = await _run(graph(), _Run(failing_paths={"/in"}))

        line = (
            f"Block 'Remote Execution' failed: Remote Execution failed on host '{HOST}': {detail}"
        )
        assert line in outcome.messages, outcome.messages
        assert outcome.session["status"] == "failed", outcome.messages

    async def test_a_block_failing_on_wave_deeper_leaves_the_host_out(self) -> None:
        nodes, edges, variables = _for_graph()
        nodes = [*nodes, assert_node("check", "1 == 2")]
        edges = [*edges, edge("set-inner", "check")]

        outcome = await _run((nodes, edges, variables))

        line = "Block 'Remote Execution' failed: Nested control in 'For Loop' failed"
        assert line in outcome.messages, outcome.messages
        assert outcome.session["block_states"].get("check") == "failed", outcome.messages

    async def test_an_inner_container_failing_deeper_names_only_its_own_host(self) -> None:
        loop = make_node(
            "loop",
            label="For Loop",
            element_type="for",
            config_values={"mode": "count", "count": 1},
            output_bindings={"index": "i"},
        )
        nodes, edges = _slot("body", then=False)
        graph_nodes, graph_edges, variables = _body_around(
            [loop, rex_node("inner", INNER_SESSION, "rsid_inner"), *nodes],
            [edge("loop", "inner", "body"), edge("loop", "post", "then"), *edges],
        )
        graph_edges = [
            *[e for e in graph_edges if (e["source"], e["target"]) != ("pre", "inner")],
            edge("pre", "loop"),
        ]

        outcome = await _run((graph_nodes, graph_edges, variables), _Run(failing_paths={"/in"}))

        assert outcome.served == [(HOST, "/pre"), (INNER_HOST, "/in")], outcome.served
        assert (
            f"Block 'Remote Execution' failed: Remote Execution failed on host '{INNER_HOST}': boom"
            in outcome.messages
        ), outcome.messages
        line = "Block 'Remote Execution' failed: Nested control in 'For Loop' failed"
        assert line in outcome.messages, outcome.messages


class TestSignalsInsideAContainerInTheBody:
    """Failures, Halt and scope failures behave as they do in the same container elsewhere."""

    async def test_a_failing_block_fails_the_run_and_nothing_after_runs(self) -> None:
        outcome = await _run(_for_graph(), _Run(failing_paths={"/in"}))

        states = outcome.session["block_states"]
        assert outcome.paths_on(HOST) == ["/pre", "/in"], outcome.served
        assert states.get("in") == "failed", states
        assert states.get("inner") == "failed", states
        assert states.get("after-rex") != "passed", states
        assert outcome.session["status"] == "failed", outcome.messages
        assert outcome.events[-1] == f"close:{HOST}", outcome.events

    async def test_the_failing_block_reports_its_own_error(self) -> None:
        outcome = await _run(_for_graph(), _Run(failing_paths={"/in"}))

        assert "Block 'HTTP /in' failed: boom" in outcome.messages, outcome.messages
        assert not any(
            m.startswith("Block 'HTTP /in' failed: Remote Execution failed on host")
            for m in outcome.messages
        ), outcome.messages

    async def test_a_surrounding_try_catch_catches_it(self) -> None:
        nodes, edges, variables = _for_graph()
        nodes = [try_catch_node("top"), *nodes, log_node("caught", "Caught", "'caught'")]
        edges = [
            edge("start-node", "top"),
            *[e for e in edges if e["source"] != "start-node"],
            edge("top", "rex", "try"),
            edge("top", "caught", "catch"),
        ]

        outcome = await _run((nodes, edges, variables), _Run(failing_paths={"/in"}))

        states = outcome.session["block_states"]
        assert states.get("in") == "failed", states
        assert states.get("caught") == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_a_halt_ends_the_run_with_its_status(self) -> None:
        nodes, edges, variables = _for_graph()
        nodes = [*nodes, halt_node("halt", scope="test", status="failed")]
        edges = [*edges, edge("set-inner", "halt")]

        outcome = await _run((nodes, edges, variables))

        states = outcome.session["block_states"]
        assert outcome.paths_on(HOST) == ["/pre", "/in"], outcome.served
        assert states.get("halt") == "failed", states
        assert states.get("after-rex") != "passed", states
        assert outcome.session["status"] == "failed", outcome.messages

    async def test_a_single_mode_assert_failing_in_the_body_stops_the_flow(self) -> None:
        nodes = [
            rex_node("rex", HOST_SESSION, "rsid"),
            assert_node("check", "1 == 2"),
            http_node("post", "/post"),
            log_node("after-rex", "After", "'after'"),
        ]
        edges = [
            edge("start-node", "rex"),
            edge("rex", "check", "body"),
            edge("check", "post"),
            edge("rex", "after-rex", "then"),
        ]

        outcome = await _run((nodes, edges, {"rsid": None}))

        states = outcome.session["block_states"]
        assert states.get("check") == "failed", states
        assert outcome.paths_on(HOST) == [], outcome.served
        assert states.get("after-rex") != "passed", states
        assert outcome.session["status"] == "failed", outcome.messages

    async def test_a_split_assert_marking_the_test_in_the_body_keeps_the_flow_going(
        self,
    ) -> None:
        check = make_node(
            "check",
            label="Assert",
            element_type="assert",
            config_values={
                "assertions": [{"type": "expression", "expression": "1 == 2"}],
                "mode": "split",
                "fail_current_scope": True,
            },
        )
        nodes = [
            rex_node("rex", HOST_SESSION, "rsid"),
            check,
            http_node("post", "/post"),
            log_node("after-rex", "After", "'after'"),
        ]
        edges = [
            edge("start-node", "rex"),
            edge("rex", "check", "body"),
            edge("check", "post", "fail"),
            edge("rex", "after-rex", "then"),
        ]

        outcome = await _run((nodes, edges, {"rsid": None}))

        states = outcome.session["block_states"]
        assert outcome.paths_on(HOST) == ["/post"], outcome.served
        assert states.get("after-rex") == "passed", states
        assert outcome.session["status"] == "failed", outcome.messages


class TestAStopInsideAContainerInTheBody:
    """A cancel while a nested block is in flight stops the host before its session closes."""

    async def test_the_host_is_stopped_then_closed(self) -> None:
        order: list[str] = []
        with patch.object(_worker_registry, "stop_worker", lambda _w: order.append("stop")):
            task = asyncio.create_task(_run(_for_graph(), _Run(hold_path="/in")))
            for _ in range(500):
                await asyncio.sleep(0.01)
                if any(s.get("block_states", {}).get("in") == "running" for s in _sessions()):
                    break
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        assert order == ["stop"], order
        assert _sessions()[-1]["block_states"].get("in") != "passed"


def _sessions() -> list[dict[str, Any]]:
    return list(_wb_common._workbench_sessions.values())


class TestAFunctionWhoseBodyHoldsARemoteExecution:
    """A Remote Execution in a Function body runs its body on the host named by a Function input."""

    async def test_the_body_runs_on_the_host_the_input_names(self) -> None:
        body = [
            rex_node("fn-rex", "sid", "fn_rsid", expression=True),
            http_node("fn-in", "/fn-in"),
        ]
        definition = local_definition(
            "RemoteCaller", body, [edge("start-node", "fn-rex"), edge("fn-rex", "fn-in", "body")]
        )
        definition["inputs"] = [{"name": "sid", "type": "string", "required": True}]
        fn = function_node("fn", definition)
        fn["data"]["config"]["values"] = {"sid": "ssh_sid"}
        fn["data"]["expressionFields"] = ["sid"]
        nodes = [fn, log_node("after-fn", "After", "'after'")]
        edges = [edge("start-node", "fn"), edge("fn", "after-fn")]

        outcome = await _run((nodes, edges, {"ssh_sid": INNER_SESSION}))

        assert outcome.paths_on(INNER_HOST) == ["/fn-in"], outcome.served
        outcome.local_http.assert_not_awaited()
        assert outcome.session["block_states"].get("after-fn") == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages


class TestAHaltInsideANestedRemoteExecution:
    """A Halt inside an inner container's body ends the run as it does anywhere else (HALT:29)."""

    async def test_nothing_after_the_halt_runs(self) -> None:
        inner = rex_node("inner", INNER_SESSION, "rsid_inner")
        nodes, edges = _slot("body")
        graph_nodes, graph_edges, variables = _body_around([inner, *nodes], edges)
        graph_nodes = [*graph_nodes, halt_node("halt", scope="test", status="failed")]
        graph_edges = [*graph_edges, edge("set-inner", "halt")]

        outcome = await _run((graph_nodes, graph_edges, variables))

        states = outcome.session["block_states"]
        assert outcome.served == [(HOST, "/pre"), (INNER_HOST, "/in")], outcome.served
        assert states.get("halt") == "failed", states
        assert states.get("after-rex") != "passed", states
        assert outcome.session["status"] == "failed", outcome.messages
        assert outcome.events[-2:] == [f"close:{INNER_HOST}", f"close:{HOST}"], outcome.events


class TestTheNestedDispatchHandsBackWhatTheBodyLeft:
    """A nested Remote Execution hands its walker a pending loop signal, as Switch/Case does."""

    async def test_a_pending_loop_signal_comes_back(self) -> None:
        from wavecore.api.services.workbench.nested import dispatch_nested_signals
        from wavecore.api.services.workbench.signals import _extract_engine_signals

        session: dict[str, Any] = {"status": "running", "block_states": {}}

        async def _body_left_a_continue(*args: Any) -> None:
            args[4]["_loop_signal"] = "continue"
            args[4]["_loop_signal_target"] = "outer-loop"

        with patch.object(_remote_exec, "execute_remote_container", _body_left_a_continue):
            result = await dispatch_nested_signals(
                signals=_extract_engine_signals({"__remote_execution": True}),
                node_id="rex",
                nf={"output_bindings": {}},
                adj={},
                node_map={},
                variables={},
                session=session,
                session_id="rex-dispatch",
                executed=set(),
                environment_id=None,
            )

        assert result == "continue"
        assert session["_loop_signal_target"] == "outer-loop"
