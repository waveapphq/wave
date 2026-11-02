"""Functions and Remote Execution combined at more than one level (REQ-3.4.1.3, REMEX-5, REMEX-6).

A remotable block reached through one or more Function levels inside a body runs on the innermost
enclosing container's worker; a Remote Execution inside a Function opens its own worker on the host
its session input names. Driven through the real engine with the worker patched.
"""

import asyncio
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    edge,
    engine_registries,
    function_node,
    local_definition,
    log_messages,
    log_node,
    make_node,
    make_session,
    parallel_node,
    try_catch_node,
)
from tests.api.services.workbench.slot_harness import for_node
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.http_client import HTTPClientPlugin

HOST = "outer-host"
HOST_SESSION = "outer-sess-1"
INNER_HOST = "inner-host"
INNER_SESSION = "inner-sess-1"
LOCAL_BODY = "ran-on-wave"

Graph = tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]


@pytest.fixture(autouse=True)
def _remotable_plugin(engine_registries: Any) -> None:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())


@dataclass
class _Served:
    worker: str
    host: str
    path: str


@dataclass
class _Outcome:
    session: dict[str, Any]
    variables: dict[str, Any]
    messages: list[str]
    served: list[_Served]
    events: list[str]
    local_http: AsyncMock

    def paths_by_worker(self) -> dict[str, list[str]]:
        grouped: dict[str, list[str]] = {}
        for record in self.served:
            grouped.setdefault(record.worker, []).append(record.path)
        return grouped

    def opened(self) -> list[str]:
        return [event.split(":", 1)[1] for event in self.events if event.startswith("open:")]

    def closed(self) -> list[str]:
        return [event.split(":", 1)[1] for event in self.events if event.startswith("close:")]


def probe(node_id: str, path: str, binds: str | None = None) -> dict[str, Any]:
    """A remotable HTTP block; the worker answers with its own name and the path it was sent."""
    return make_node(
        node_id,
        label="HTTP",
        element_type="http-client",
        node_type="plugin",
        config_values={"method": "GET", "url": f"http://target.local{path}"},
        output_bindings={"body": binds} if binds else None,
        name=f"HTTP {path}",
    )


def rex_node(node_id: str, session_ref: str, expression: bool = False) -> dict[str, Any]:
    """A Remote Execution container whose Execution Host is ``session_ref``."""
    node = make_node(
        node_id,
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": session_ref},
        output_bindings={"remote_session_id": f"{node_id.replace('-', '_')}_rsid"},
    )
    if expression:
        node["data"]["expressionFields"] = ["session_id"]
    return node


def fn_block(
    node_id: str,
    definition: dict[str, Any],
    inputs: dict[str, str] | None = None,
    outputs: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A Function Block whose inputs are expressions, with its output bindings."""
    node = function_node(node_id, definition)
    node["data"]["config"]["values"] = dict(inputs or {})
    node["data"]["expressionFields"] = list(inputs or {})
    node["data"]["config"]["outputBindings"] = dict(outputs or {})
    return node


def definition(
    name: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    inputs: tuple[str, ...] = (),
    outputs: tuple[str, ...] = (),
) -> dict[str, Any]:
    """A Local Function definition declaring string inputs and outputs."""
    body = local_definition(name, nodes, edges)
    body["inputs"] = [{"name": n, "type": "string", "required": True} for n in inputs]
    body["outputs"] = [{"name": n, "type": "string"} for n in outputs]
    return body


async def _run(graph: Graph) -> _Outcome:
    """Run the graph over two open SSH sessions; every worker opened gets its own name."""
    nodes, edges, variables = graph
    session_id = f"rex-fn-levels-{uuid.uuid4().hex[:12]}"
    registry = SSHSessionRegistry()
    connections = {HOST: MagicMock(), INNER_HOST: MagicMock()}
    registry.register(HOST_SESSION, connections[HOST], None, HOST, None, None, connect_timeout=30)
    registry.register(
        INNER_SESSION, connections[INNER_HOST], None, INNER_HOST, None, None, connect_timeout=30
    )
    host_of = {id(connection): host for host, connection in connections.items()}
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session

    served: list[_Served] = []
    events: list[str] = []

    async def _open(connection: Any) -> Any:
        worker = MagicMock()
        worker.name = f"w{len([e for e in events if e.startswith('open:')]) + 1}"
        worker.host = host_of[id(connection)]
        events.append(f"open:{worker.name}")
        return worker

    async def _close(worker: Any) -> None:
        events.append(f"close:{worker.name}")

    async def _answer(
        worker: Any,
        _plugin: str,
        params: dict[str, Any],
        _vars: dict[str, Any],
        _trust: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        path = str(params["url"]).removeprefix("http://target.local")
        served.append(_Served(worker.name, worker.host, path))
        events.append(f"run:{worker.name}:{path}")
        if path.endswith("-fail"):
            raise RuntimeError("no such file on the host")
        body = f"{worker.name}@{worker.host}:{path}"
        return {"return_value": {"status_code": 200, "body": body}, "logs": [], "status": "passed"}

    local_http = AsyncMock(return_value={"status_code": 200, "body": LOCAL_BODY})
    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(side_effect=_open)),
        patch.object(_remote_exec, "run_on_worker", AsyncMock(side_effect=_answer)),
        patch.object(_remote_exec, "close_worker", AsyncMock(side_effect=_close)),
        patch.object(HTTPClientPlugin, "execute", local_http),
    ):
        await asyncio.wait_for(_execute_workflow(session_id, nodes, edges, variables), timeout=10)
    return _Outcome(
        session=session,
        variables=variables,
        messages=log_messages(session_id),
        served=served,
        events=events,
        local_http=local_http,
    )


def _in_body(body: list[dict[str, Any]], body_edges: list[dict[str, Any]], head: str) -> Graph:
    """rex body: pre -> <head ... tail links to post> -> post; rex then -> after-rex."""
    nodes = [
        rex_node("rex", HOST_SESSION),
        probe("pre", "/pre", "pid_before"),
        *body,
        probe("post", "/post", "pid_after"),
        log_node("after-rex", "After Remote Execution", "'after'"),
    ]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "pre", "body"),
        edge("pre", head),
        *body_edges,
        edge("rex", "after-rex", "then"),
    ]
    return nodes, edges, {"rex_rsid": None, "pid_before": None, "pid_after": None}


def _passed_everywhere(outcome: _Outcome) -> None:
    states = outcome.session["block_states"]
    assert outcome.session["status"] == "passed", outcome.messages
    assert states.get("after-rex") == "passed", states
    assert [nid for nid, state in states.items() if state == "running"] == [], states


class TestAFunctionInAFunctionInTheBody:
    """Body > Function > Function > remotable block: the body worker runs it, the Test reads it."""

    @staticmethod
    def _graph() -> Graph:
        inner = definition(
            "Inner",
            [probe("deep", "/deep", "deep_out")],
            [edge("start-node", "deep")],
            outputs=("deep_out",),
        )
        outer_body = [fn_block("fn-inner", inner, outputs={"deep_out": "deep_out"})]
        outer = definition(
            "Outer", outer_body, [edge("start-node", "fn-inner")], outputs=("deep_out",)
        )
        nodes, edges, variables = _in_body(
            [fn_block("fn-outer", outer, outputs={"deep_out": "deep_out"})],
            [edge("fn-outer", "post")],
            "fn-outer",
        )
        return nodes, edges, {**variables, "deep_out": "seed"}

    async def test_the_deep_block_runs_on_the_body_worker(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.paths_by_worker() == {"w1": ["/pre", "/deep", "/post"]}, outcome.served
        assert {record.host for record in outcome.served} == {HOST}, outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_one_worker_opens_for_the_body_and_closes_last(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.opened() == ["w1"], outcome.events
        assert outcome.events[-1] == "close:w1", outcome.events

    async def test_the_deep_output_reaches_the_test_through_both_functions(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.variables["deep_out"] == f"w1@{HOST}:/deep", outcome.messages
        assert outcome.variables["pid_after"] == f"w1@{HOST}:/post", outcome.messages
        _passed_everywhere(outcome)


class TestARemoteExecutionInAFunctionInTheBody:
    """Body > Function > Remote Execution (session a Function input): its own worker, then outer."""

    @staticmethod
    def _graph() -> Graph:
        fn_body = [rex_node("rex-inner", "sid", expression=True), probe("in", "/in", "in_out")]
        fn_def = definition(
            "RemoteInside",
            fn_body,
            [edge("start-node", "rex-inner"), edge("rex-inner", "in", "body")],
            inputs=("sid",),
            outputs=("in_out",),
        )
        block = fn_block("fn", fn_def, inputs={"sid": "inner_sid"}, outputs={"in_out": "in_out"})
        nodes, edges, variables = _in_body([block], [edge("fn", "post")], "fn")
        return nodes, edges, {**variables, "inner_sid": INNER_SESSION, "in_out": "seed"}

    async def test_the_inner_body_runs_on_its_own_worker_on_its_own_host(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.served == [
            _Served("w1", HOST, "/pre"),
            _Served("w2", INNER_HOST, "/in"),
            _Served("w1", HOST, "/post"),
        ], outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_the_inner_worker_closes_before_the_outer_body_resumes(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.events == [
            "open:w1",
            "run:w1:/pre",
            "open:w2",
            "run:w2:/in",
            "close:w2",
            "run:w1:/post",
            "close:w1",
        ]

    async def test_every_worker_opened_is_closed_and_the_output_binds(self) -> None:
        outcome = await _run(self._graph())

        assert Counter(outcome.opened()) == Counter(outcome.closed()), outcome.events
        assert outcome.variables["in_out"] == f"w2@{INNER_HOST}:/in", outcome.messages
        _passed_everywhere(outcome)


class TestContainersInAFunctionInTheBody:
    """Body > Function > For Loop, Parallel lanes, Try/Catch failing on the host: one worker."""

    @staticmethod
    def _graph() -> Graph:
        fn_nodes = [
            for_node("fn-loop", 2),
            probe("loop", "/loop"),
            parallel_node("fn-par", [branch("branch_1", "one"), branch("branch_2", "two")]),
            probe("lane-1", "/lane-1"),
            probe("lane-2", "/lane-2"),
            try_catch_node("fn-try"),
            probe("try-read", "/try-fail"),
            probe("catch", "/catch"),
            log_node("fn-end", "Function end", "'end'"),
        ]
        fn_edges = [
            edge("start-node", "fn-loop"),
            edge("fn-loop", "loop", "body"),
            edge("fn-loop", "fn-par", "then"),
            edge("fn-par", "lane-1", "branch_1"),
            edge("fn-par", "lane-2", "branch_2"),
            edge("fn-par", "fn-try", "then"),
            edge("fn-try", "try-read", "try"),
            edge("fn-try", "catch", "catch"),
            edge("fn-try", "fn-end", "then"),
        ]
        block = fn_block("fn", definition("Containers", fn_nodes, fn_edges))
        nodes, edges, variables = _in_body([block], [edge("fn", "post")], "fn")
        return nodes, edges, {**variables, "i": None}

    async def test_every_remotable_block_runs_on_the_body_worker(self) -> None:
        outcome = await _run(self._graph())

        expected = Counter(
            ["/pre", "/loop", "/loop", "/lane-1", "/lane-2", "/try-fail", "/catch", "/post"]
        )
        assert set(outcome.paths_by_worker()) == {"w1"}, outcome.served
        assert Counter(outcome.paths_by_worker()["w1"]) == expected, outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_the_catch_path_runs_and_the_run_passes(self) -> None:
        outcome = await _run(self._graph())

        paths = [record.path for record in outcome.served]
        assert paths.index("/try-fail") < paths.index("/catch"), paths
        assert outcome.opened() == ["w1"], outcome.events
        _passed_everywhere(outcome)


class TestOneFunctionCalledInsideAndOutsideTheBody:
    """The same Function runs its remotable block on the body worker inside, and on WAVE outside."""

    @staticmethod
    def _graph() -> Graph:
        shared = definition(
            "Shared",
            [probe("fn-probe", "/probe", "probe_out")],
            [edge("start-node", "fn-probe")],
            outputs=("probe_out",),
        )
        inside = fn_block("fn-in", shared, outputs={"probe_out": "in_out"})
        outside = fn_block("fn-out", shared, outputs={"probe_out": "out_out"})
        nodes, edges, variables = _in_body([inside], [edge("fn-in", "post")], "fn-in")
        nodes = [*nodes, outside]
        edges = [*[e for e in edges if e["target"] != "after-rex"], edge("rex", "fn-out", "then")]
        edges.append(edge("fn-out", "after-rex"))
        return nodes, edges, {**variables, "in_out": "seed", "out_out": "seed"}

    async def test_the_call_inside_runs_on_the_body_worker(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.paths_by_worker() == {"w1": ["/pre", "/probe", "/post"]}, outcome.served
        assert outcome.variables["in_out"] == f"w1@{HOST}:/probe", outcome.messages

    async def test_the_call_outside_runs_on_wave(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.local_http.await_count == 1, outcome.messages
        assert outcome.variables["out_out"] == LOCAL_BODY, outcome.messages
        _passed_everywhere(outcome)


class TestAFunctionHoldingARemoteExecutionCalledFromALoopAndALane:
    """Each call of a Function whose body holds a Remote Execution opens a worker and closes it."""

    @staticmethod
    def _graph() -> Graph:
        fn_def = definition(
            "RemoteCall",
            [rex_node("fn-rex", "sid", expression=True), probe("fn-probe", "/probe")],
            [edge("start-node", "fn-rex"), edge("fn-rex", "fn-probe", "body")],
            inputs=("sid",),
        )
        nodes = [
            for_node("loop", 2),
            fn_block("fn-loop", fn_def, inputs={"sid": "ssh_sid"}),
            parallel_node("par", [branch("branch_1", "one"), branch("branch_2", "two")]),
            fn_block("fn-lane", fn_def, inputs={"sid": "ssh_sid"}),
            log_node("lane-2", "Lane 2", "'lane 2'"),
            log_node("after-rex", "After", "'after'"),
        ]
        edges = [
            edge("start-node", "loop"),
            edge("loop", "fn-loop", "body"),
            edge("loop", "par", "then"),
            edge("par", "fn-lane", "branch_1"),
            edge("par", "lane-2", "branch_2"),
            edge("par", "after-rex", "then"),
        ]
        return nodes, edges, {"ssh_sid": HOST_SESSION, "i": None}

    async def test_every_call_runs_its_probe_on_its_own_worker(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.paths_by_worker() == {
            "w1": ["/probe"],
            "w2": ["/probe"],
            "w3": ["/probe"],
        }, outcome.served
        assert {record.host for record in outcome.served} == {HOST}, outcome.served
        outcome.local_http.assert_not_awaited()

    async def test_each_worker_closes_before_the_next_call_opens_one(self) -> None:
        outcome = await _run(self._graph())

        lifecycle = [e for e in outcome.events if not e.startswith("run:")]
        assert lifecycle == ["open:w1", "close:w1", "open:w2", "close:w2", "open:w3", "close:w3"]
        _passed_everywhere(outcome)


class TestASessionPassedThroughTwoFunctionInputs:
    """Test > outer Function input > inner Function input > Remote Execution Execution Host."""

    @staticmethod
    def _graph() -> Graph:
        inner = definition(
            "InnerRemote",
            [rex_node("rex", "sid_inner", expression=True), probe("deep", "/deep", "deep_out")],
            [edge("start-node", "rex"), edge("rex", "deep", "body")],
            inputs=("sid_inner",),
            outputs=("deep_out",),
        )
        outer = definition(
            "OuterPass",
            [
                fn_block(
                    "fn-inner",
                    inner,
                    inputs={"sid_inner": "sid_mid"},
                    outputs={"deep_out": "deep_out"},
                )
            ],
            [edge("start-node", "fn-inner")],
            inputs=("sid_mid",),
            outputs=("deep_out",),
        )
        nodes = [
            fn_block(
                "fn-outer", outer, inputs={"sid_mid": "ssh_sid"}, outputs={"deep_out": "deep_out"}
            ),
            log_node("after-rex", "After", "'after'"),
        ]
        edges = [edge("start-node", "fn-outer"), edge("fn-outer", "after-rex")]
        return nodes, edges, {"ssh_sid": INNER_SESSION, "deep_out": "seed"}

    async def test_the_inner_body_runs_on_the_host_the_session_names(self) -> None:
        outcome = await _run(self._graph())

        assert outcome.served == [_Served("w1", INNER_HOST, "/deep")], outcome.served
        assert outcome.variables["deep_out"] == f"w1@{INNER_HOST}:/deep", outcome.messages
        assert outcome.events[-1] == "close:w1", outcome.events
        outcome.local_http.assert_not_awaited()
        _passed_everywhere(outcome)
