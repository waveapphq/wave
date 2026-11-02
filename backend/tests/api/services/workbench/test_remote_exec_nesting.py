"""A Remote Execution container inside a sub-flow runs as it does on the main flow (REQ-3.4.1.3).

Covers REMEX-1 and REMEX-4: Try/Catch paths, a Parallel lane, a Switch/Case branch,
loop bodies and a Function body, driven through the real engine with the worker patched.
"""

import asyncio
import re
import uuid
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
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.http_client import HTTPClientPlugin

HOST = "prod-host"
HOST_SESSION = "host-sess-1"
RSID_LINE = re.compile(r"^RSID=[0-9a-f]{32}$")

Graph = tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]


@pytest.fixture(autouse=True)
def _remotable_plugin(engine_registries: Any) -> None:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())


def _container_nodes() -> list[dict[str, Any]]:
    """The container, its remotable body block and a `then` Log reading Remote Session ID."""
    return [
        make_node(
            "rex",
            label="Remote Execution",
            element_type="remote-execution",
            node_type="plugin",
            config_values={"session_id": HOST_SESSION},
            output_bindings={"remote_session_id": "rsid"},
        ),
        make_node(
            "http",
            label="HTTP",
            element_type="http-client",
            node_type="plugin",
            config_values={"method": "GET", "url": "http://target.local/health"},
        ),
        log_node("after-rex", "After Remote Execution", "'RSID=' + rsid"),
    ]


def _container_edges(source: str, handle: str | None) -> list[dict[str, Any]]:
    return [
        edge(source, "rex", handle),
        edge("rex", "http", "body"),
        edge("rex", "after-rex", "then"),
    ]


def _passing_result() -> dict[str, Any]:
    return {
        "return_value": {"status_code": 200, "body": "ok"},
        "logs": [{"level": "INFO", "message": "HTTP 200"}],
        "status": "passed",
        "error": None,
    }


@dataclass
class _Outcome:
    session: dict[str, Any]
    variables: dict[str, Any]
    messages: list[str]
    connection: Any
    open_worker: AsyncMock
    run_on_worker: AsyncMock
    close_worker: AsyncMock
    local_http: AsyncMock


async def _run_with_worker(graph: Graph, run_on_worker: AsyncMock) -> _Outcome:
    """Run the graph over one open SSH session with the remote worker patched."""
    nodes, edges, variables = graph
    session_id = f"rex-nest-{uuid.uuid4().hex[:12]}"
    connection = MagicMock()
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, connection, None, HOST, None, None, connect_timeout=30)
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session

    worker = MagicMock()
    worker.host = HOST
    open_worker = AsyncMock(return_value=worker)
    close_worker = AsyncMock()
    local_http = AsyncMock()
    with (
        patch.object(_remote_exec, "open_worker", open_worker),
        patch.object(_remote_exec, "run_on_worker", run_on_worker),
        patch.object(_remote_exec, "close_worker", close_worker),
        patch.object(HTTPClientPlugin, "execute", local_http),
    ):
        await asyncio.wait_for(
            _execute_workflow(session_id, nodes, edges, variables),
            timeout=10.0,
        )
    return _Outcome(
        session=session,
        variables=variables,
        messages=log_messages(session_id),
        connection=connection,
        open_worker=open_worker,
        run_on_worker=run_on_worker,
        close_worker=close_worker,
        local_http=local_http,
    )


class _NestedContainerContract:
    """What a container guarantees wherever a For Loop can sit; subclasses supply the graph."""

    runs = 1
    binds_in_test_scope = True

    def _graph(self) -> Graph:
        raise NotImplementedError

    async def _run(self) -> _Outcome:
        return await _run_with_worker(self._graph(), AsyncMock(return_value=_passing_result()))

    async def test_the_run_passes_and_the_container_paints_passed(self) -> None:
        outcome = await self._run()

        assert outcome.session["block_states"].get("rex") == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_the_worker_opens_on_the_execution_host_and_closes(self) -> None:
        outcome = await self._run()

        opened = [call.args for call in outcome.open_worker.await_args_list]
        assert opened == [(outcome.connection,)] * self.runs, outcome.messages
        assert outcome.close_worker.await_count == self.runs, outcome.messages

    async def test_the_body_block_runs_on_the_worker_once_per_container_run(self) -> None:
        outcome = await self._run()

        element_types = [call.args[1] for call in outcome.run_on_worker.await_args_list]
        assert element_types == ["http-client"] * self.runs, outcome.messages
        outcome.local_http.assert_not_awaited()

    async def test_remote_session_id_binds(self) -> None:
        outcome = await self._run()

        rsid_lines = [m for m in outcome.messages if m.startswith("RSID=")]
        assert len(rsid_lines) == self.runs, outcome.messages
        assert all(RSID_LINE.match(line) for line in rsid_lines), rsid_lines
        if self.binds_in_test_scope:
            assert re.match(r"^[0-9a-f]{32}$", str(outcome.variables["rsid"])), outcome.variables

    async def test_the_then_successor_runs_inside_the_sub_flow(self) -> None:
        outcome = await self._run()

        assert outcome.session["block_states"].get("after-rex") == "passed", (
            outcome.session["block_states"],
            outcome.messages,
        )

    async def test_the_container_is_never_looked_up_as_a_plugin(self) -> None:
        outcome = await self._run()

        leaked = [m for m in outcome.messages if "Plugin remote-execution" in m]
        assert leaked == [], leaked


class TestInsideATryPath(_NestedContainerContract):
    def _graph(self) -> Graph:
        nodes = [try_catch_node("tc"), *_container_nodes(), log_node("catch-log", "Catch", "'C'")]
        edges = [
            edge("start-node", "tc"),
            *_container_edges("tc", "try"),
            edge("tc", "catch-log", "catch"),
        ]
        return nodes, edges, {}


class TestInsideACatchPath(_NestedContainerContract):
    def _graph(self) -> Graph:
        nodes = [try_catch_node("tc"), log_node("boom", "Boom", "1/0"), *_container_nodes()]
        edges = [
            edge("start-node", "tc"),
            edge("tc", "boom", "try"),
            *_container_edges("tc", "catch"),
        ]
        return nodes, edges, {}


class TestInsideAFinallyPath(_NestedContainerContract):
    def _graph(self) -> Graph:
        nodes = [
            try_catch_node("tc", enable_catch=False, enable_finally=True),
            log_node("try-log", "Try", "'T'"),
            *_container_nodes(),
        ]
        edges = [
            edge("start-node", "tc"),
            edge("tc", "try-log", "try"),
            *_container_edges("tc", "finally"),
        ]
        return nodes, edges, {}


class TestInsideAParallelLane(_NestedContainerContract):
    def _graph(self) -> Graph:
        nodes = [
            parallel_node("par", [branch("branch_1", "remote"), branch("branch_2", "local")]),
            *_container_nodes(),
            log_node("local", "Local", "'L'"),
            log_node("join", "Join", "'J'"),
        ]
        edges = [
            edge("start-node", "par"),
            *_container_edges("par", "branch_1"),
            edge("par", "local", "branch_2"),
            edge("par", "join", "then"),
        ]
        return nodes, edges, {}


class TestInsideASwitchCaseBranch(_NestedContainerContract):
    def _graph(self) -> Graph:
        case = {
            "id": "branch_0",
            "type": "case",
            "label": "",
            "conditions": [{"type": "expression", "expression": "True"}],
            "break": True,
        }
        nodes = [
            make_node(
                "sw",
                label="Switch/Case",
                element_type="switch-case",
                config_values={"branches": [case]},
            ),
            *_container_nodes(),
            log_node("after-sw", "After Switch", "'S'"),
        ]
        edges = [
            edge("start-node", "sw"),
            *_container_edges("sw", "branch_0"),
            edge("sw", "after-sw", "then"),
        ]
        return nodes, edges, {}


class TestInsideAForLoopBody(_NestedContainerContract):
    runs = 2

    def _graph(self) -> Graph:
        nodes = [
            make_node(
                "for",
                label="For Loop",
                element_type="for",
                config_values={"mode": "count", "count": 2},
                output_bindings={"index": "i"},
            ),
            *_container_nodes(),
        ]
        return nodes, [edge("start-node", "for"), *_container_edges("for", "body")], {"i": None}


class TestInsideAForEachBody(_NestedContainerContract):
    runs = 2

    def _graph(self) -> Graph:
        nodes = [for_each_node("fe", ["a", "b"]), *_container_nodes()]
        edges = [edge("start-node", "fe"), *_container_edges("fe", "body")]
        return nodes, edges, {"fe_item": None, "fe_idx": None}


class TestInsideAWhileBody(_NestedContainerContract):
    runs = 2

    def _graph(self) -> Graph:
        nodes = [
            make_node(
                "wl",
                label="While Loop",
                element_type="while",
                config_values={
                    "mode": "while-do",
                    "conditions": [{"type": "expression", "expression": "counter < 2"}],
                },
                output_bindings={"index": "idx"},
            ),
            *_container_nodes(),
            setter_node("bump", "Bump", {"counter": "counter + 1"}, expressions=True),
        ]
        edges = [
            edge("start-node", "wl"),
            *_container_edges("wl", "body"),
            edge("after-rex", "bump"),
        ]
        return nodes, edges, {"idx": None, "counter": 0}


class TestInsideAFunctionBody(_NestedContainerContract):
    binds_in_test_scope = False

    def _graph(self) -> Graph:
        definition = local_definition(
            "RemoteHolder", _container_nodes(), _container_edges("start-node", None)
        )
        nodes = [function_node("fn", definition), log_node("after-fn", "After Function", "'F'")]
        edges = [edge("start-node", "fn"), edge("fn", "after-fn")]
        return nodes, edges, {}


class TestAFailureInsideTheBody:
    """A failing body block follows the surrounding control."""

    @staticmethod
    def _failing_worker() -> AsyncMock:
        return AsyncMock(side_effect=RuntimeError("boom"))

    async def test_the_surrounding_try_catch_catches_it(self) -> None:
        catcher = try_catch_node("tc")
        catcher["data"]["config"]["outputBindings"] = {"error": "tc_err"}
        nodes = [catcher, *_container_nodes(), log_node("catch-log", "Catch", "'CAUGHT'")]
        edges = [
            edge("start-node", "tc"),
            *_container_edges("tc", "try"),
            edge("tc", "catch-log", "catch"),
        ]

        outcome = await _run_with_worker((nodes, edges, {"tc_err": None}), self._failing_worker())

        assert outcome.run_on_worker.await_count == 1, outcome.messages
        assert outcome.close_worker.await_count == 1, outcome.messages
        assert (
            outcome.variables["tc_err"]["message"]
            == f"Remote Execution failed on host '{HOST}': boom"
        ), outcome.variables["tc_err"]
        assert outcome.session["block_states"]["catch-log"] == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_it_fails_its_parallel_lane(self) -> None:
        nodes = [
            parallel_node("par", [branch("branch_1", "remote"), branch("branch_2", "local")]),
            *_container_nodes(),
            log_node("local", "Local", "'L'"),
            log_node("join", "Join", "'JOIN'"),
        ]
        edges = [
            edge("start-node", "par"),
            *_container_edges("par", "branch_1"),
            edge("par", "local", "branch_2"),
            edge("par", "join", "then"),
        ]

        outcome = await _run_with_worker((nodes, edges, {}), self._failing_worker())

        assert outcome.run_on_worker.await_count == 1, outcome.messages
        assert outcome.close_worker.await_count == 1, outcome.messages
        assert (
            f"Block 'Remote Execution' failed: Remote Execution failed on host '{HOST}': boom"
            in outcome.messages
        ), outcome.messages
        assert "Branch 'remote' failed" in outcome.messages, outcome.messages
        assert outcome.session["status"] == "failed", outcome.messages
        assert outcome.session["block_states"]["join"] == "skipped", outcome.session["block_states"]
