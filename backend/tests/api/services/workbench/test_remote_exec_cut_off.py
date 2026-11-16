"""A remotable block cut off inside a Remote Execution body cancels only itself (REQ-3.4.1.3).

Covers REMEX-5: Parallel lanes in a body run at the same time on the body's one worker, and a
lane the section cuts off (first to finish, a lane time limit) cancels its own request on the
remote host while every later remotable block in the same body still runs there. Driven
through the real engine, the real runner and the real worker text as a local subprocess.
"""

import asyncio
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.api.services.workbench.parallel_harness import (  # noqa: F401
    branch,
    delay_node,
    edge,
    engine_registries,
    log_messages,
    log_node,
    make_node,
    make_session,
    parallel_node,
    try_catch_node,
)
from tests.core.remote_exec.worker_harness import (
    AsyncWorkerProcess,
    async_worker,
    silent_listener,
    stub_import_path,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.core.remote_exec.runner import WorkerHandle
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.http_client import HTTPClientPlugin

HOST = "prod-host"
HOST_SESSION = "host-sess-1"
RUN_TIMEOUT_S = 20.0
# Two lanes that each wait for the other prove they run at once; the bound fails a turn-taking pair.
_BARRIER_TIMEOUT_S = 5.0

Graph = tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]


@pytest.fixture(autouse=True)
def _remotable_plugin(engine_registries: Any) -> None:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())


@pytest.fixture(scope="module")
def stub_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return stub_import_path(tmp_path_factory.mktemp("worker-host"))


class _Answering(BaseHTTPRequestHandler):
    barrier: threading.Barrier | None = None

    def do_GET(self) -> None:  # noqa: N802 - the stdlib handler hook name
        if self.barrier is not None and self.path.startswith("/together"):
            self.barrier.wait(timeout=_BARRIER_TIMEOUT_S)
        body = self.path.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        return


@contextmanager
def _answering_server(barrier: threading.Barrier | None = None) -> Iterator[int]:
    handler = type("_Handler", (_Answering,), {"barrier": barrier})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield int(server.server_address[1])
    finally:
        server.shutdown()
        server.server_close()


def _http_node(node_id: str, url: str, timeout: int = 60) -> dict[str, Any]:
    return make_node(
        node_id,
        label="HTTP",
        element_type="http-client",
        node_type="plugin",
        config_values={"method": "GET", "url": url, "timeout": timeout},
        name=node_id,
    )


def _rex_node() -> dict[str, Any]:
    return make_node(
        "rex",
        label="Remote Execution",
        element_type="remote-execution",
        node_type="plugin",
        config_values={"session_id": HOST_SESSION},
        output_bindings={"remote_session_id": "rsid"},
    )


def _parallel_in_body(
    lanes: list[dict[str, Any]], par: dict[str, Any], after: dict[str, Any]
) -> Graph:
    """rex body: the Parallel (lane i starts at lanes[i]) -then-> ``after``; rex then -> a Log."""
    nodes = [_rex_node(), par, *lanes, after, log_node("after-rex", "After", "'done'")]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "par", "body"),
        *[edge("par", lane["id"], f"branch_{i + 1}") for i, lane in enumerate(lanes)],
        edge("par", after["id"], "then"),
        edge("rex", "after-rex", "then"),
    ]
    return nodes, edges, {"rsid": None}


@dataclass
class _Outcome:
    session: dict[str, Any]
    messages: list[str]


async def _run(graph: Graph, process: AsyncWorkerProcess) -> _Outcome:
    """Run the graph with the body's worker being the local worker process."""
    nodes, edges, variables = graph
    session_id = f"rex-cut-{uuid.uuid4().hex[:12]}"
    registry = SSHSessionRegistry()
    registry.register(HOST_SESSION, MagicMock(), None, HOST, None, None, connect_timeout=30)
    session = make_session(session_id)
    session["ssh_session_registry"] = registry
    _wb_common._workbench_sessions[session_id] = session

    async def _open(_connection: Any, _host: str) -> WorkerHandle:
        return WorkerHandle(process=process, host=HOST, interpreter="python3")

    with (
        patch.object(_remote_exec, "open_worker", AsyncMock(side_effect=_open)),
        patch.object(HTTPClientPlugin, "execute", AsyncMock()),
    ):
        await asyncio.wait_for(
            _execute_workflow(session_id, nodes, edges, variables), timeout=RUN_TIMEOUT_S
        )
    return _Outcome(session=session, messages=log_messages(session_id))


class TestALaneCutOffInsideTheBody:
    """A lane the Parallel cuts off cancels its own request; the body's worker keeps serving."""

    @pytest.mark.asyncio
    async def test_a_remotable_block_after_a_first_to_finish_parallel_still_runs(
        self, stub_path: Path
    ) -> None:
        with silent_listener() as listener, _answering_server() as port:
            silent = listener.getsockname()[1]
            graph = _parallel_in_body(
                [_http_node("slow", f"http://127.0.0.1:{silent}/held"), delay_node("fast", 300)],
                parallel_node(
                    "par", [branch("branch_1", "slow"), branch("branch_2", "fast")], join="first"
                ),
                _http_node("post", f"http://127.0.0.1:{port}/post"),
            )
            async with async_worker(stub_path) as process:
                outcome = await _run(graph, process)

        assert outcome.session["block_states"].get("post") == "passed", outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    @pytest.mark.asyncio
    async def test_a_remotable_block_after_a_caught_lane_time_limit_still_runs(
        self, stub_path: Path
    ) -> None:
        with silent_listener() as listener, _answering_server() as port:
            silent = listener.getsockname()[1]
            nodes, edges, variables = _parallel_in_body(
                [_http_node("slow", f"http://127.0.0.1:{silent}/held"), delay_node("fast", 10)],
                parallel_node(
                    "par",
                    [branch("branch_1", "slow", time_limit=300), branch("branch_2", "fast")],
                ),
                _http_node("post", f"http://127.0.0.1:{port}/post"),
            )
            edges = [e for e in edges if e["target"] not in ("par", "post")]
            nodes.extend([try_catch_node("tc"), log_node("caught", "Caught", "'caught'")])
            edges.extend(
                [
                    edge("rex", "tc", "body"),
                    edge("tc", "par", "try"),
                    edge("tc", "caught", "catch"),
                    edge("tc", "post", "then"),
                ]
            )
            async with async_worker(stub_path) as process:
                outcome = await _run((nodes, edges, variables), process)

        assert outcome.session["block_states"].get("post") == "passed", outcome.messages
        assert not any("worker on the host stopped" in line for line in outcome.messages)


class TestLanesShareTheWorkerAtOnce:
    """Parallel lanes in a body run at the same time on the body's one worker."""

    @pytest.mark.asyncio
    async def test_two_remotable_lanes_are_served_together(self, stub_path: Path) -> None:
        barrier = threading.Barrier(2)
        with _answering_server(barrier) as port:
            graph = _parallel_in_body(
                [
                    _http_node("one", f"http://127.0.0.1:{port}/together/1", timeout=10),
                    _http_node("two", f"http://127.0.0.1:{port}/together/2", timeout=10),
                ],
                parallel_node("par", [branch("branch_1", "one"), branch("branch_2", "two")]),
                log_node("post", "Post", "'post'"),
            )
            async with async_worker(stub_path) as process:
                outcome = await _run(graph, process)

        assert not barrier.broken, outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages
