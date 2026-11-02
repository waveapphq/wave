"""An ad-hoc run started inside a Remote Execution body runs as the full run does (REQ-3.4.1.3).

Run Current, Run from Here and Run Scope started inside a body use the innermost enclosing
container's Execution Host session, open one worker there when the run first reaches a block that
runs on the remote host, hold it for the rest of the ad-hoc run and route every remotable block
through it; a closed session fails the run at that block. Driven through the real engine with the
worker patched.
"""

import asyncio
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
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
    make_session,
    parallel_node,
)
from tests.api.services.workbench.slot_harness import for_node
from tests.api.services.workbench.test_remote_exec_body_contents import (
    HOST,
    HOST_SESSION,
    INNER_HOST,
    INNER_SESSION,
    http_node,
    rex_node,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import remote_exec as _remote_exec
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench.execution import _execute_workflow
from wavecore.core.remote_exec import worker_registry as _worker_registry
from wavecore.core.ssh.session_registry import SSHSessionRegistry
from wavecore.plugins.http_client import HTTPClientPlugin

Nodes = list[dict[str, Any]]
Edges = list[dict[str, Any]]
TEST_ID = "adhoc-remote-test"
CLOSED_REASON = (
    "This block runs on a remote host, but its SSH session '{session}' is closed or not "
    "connected. Open it first (Run Current on the SSH Session Open block), then run this block."
)


@pytest.fixture(autouse=True)
def _remotable_plugin(engine_registries: Any) -> Iterator[None]:  # noqa: F811
    from wavecore.core.plugin_registry import register_plugin

    register_plugin(HTTPClientPlugin())
    workbench_service._user_active_session.clear()
    yield
    workbench_service._user_active_session.clear()


@dataclass
class _Hosts:
    """Two remote hosts, each answering on its own patched worker."""

    live: tuple[str, ...] = (HOST_SESSION, INNER_SESSION)
    hold_path: str | None = None
    session_id: str | None = None
    events: list[str] = field(default_factory=list)
    served: list[tuple[str, str]] = field(default_factory=list)
    logged_at_open: list[list[str]] = field(default_factory=list)
    open_worker: AsyncMock = field(default_factory=AsyncMock)
    local_http: AsyncMock = field(default_factory=AsyncMock)

    def registry(self) -> SSHSessionRegistry:
        registry = SSHSessionRegistry()
        for session_ref, host in ((HOST_SESSION, HOST), (INNER_SESSION, INNER_HOST)):
            if session_ref in self.live:
                connection = MagicMock()
                connection.host = host
                registry.register(
                    session_ref, connection, None, host, None, None, connect_timeout=30
                )
        return registry

    def paths_on(self, host: str) -> list[str]:
        return [path for served_host, path in self.served if served_host == host]

    @contextmanager
    def patched(self) -> Iterator[None]:
        async def _open(connection: Any) -> Any:
            # Yield first so concurrent lanes reach the open together.
            await asyncio.sleep(0)
            worker = MagicMock()
            worker.host = connection.host
            self.events.append(f"open:{worker.host}")
            if self.session_id is not None:
                self.logged_at_open.append(log_messages(self.session_id))
            return worker

        async def _close(worker: Any) -> None:
            self.events.append(f"close:{worker.host}")

        async def _answer(
            worker: Any,
            _plugin: str,
            params: dict[str, Any],
            _vars: dict[str, Any],
            _trust: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            path = str(params["url"]).removeprefix("http://target.local")
            self.served.append((worker.host, path))
            self.events.append(f"run:{worker.host}:{path}")
            if path == self.hold_path:
                await asyncio.sleep(3600)
            return {
                "return_value": {"status_code": 200, "body": path},
                "logs": [],
                "status": "passed",
            }

        self.open_worker = AsyncMock(side_effect=_open)
        with (
            patch.object(_remote_exec, "open_worker", self.open_worker),
            patch.object(_remote_exec, "run_on_worker", AsyncMock(side_effect=_answer)),
            patch.object(_remote_exec, "close_worker", AsyncMock(side_effect=_close)),
            patch.object(HTTPClientPlugin, "execute", self.local_http),
        ):
            yield


@dataclass
class _Outcome:
    session: dict[str, Any]
    messages: list[str]
    hosts: _Hosts

    @property
    def states(self) -> dict[str, str]:
        return dict(self.session["block_states"])


def _new_session(hosts: _Hosts) -> tuple[str, dict[str, Any]]:
    session_id = f"adhoc-rex-{uuid.uuid4().hex[:12]}"
    session = make_session(session_id)
    session["ssh_session_registry"] = hosts.registry()
    _wb_common._workbench_sessions[session_id] = session
    hosts.session_id = session_id
    return session_id, session


async def _run_adhoc(
    graph: tuple[Nodes, Edges],
    hosts: _Hosts,
    *,
    single: str | None = None,
    start: str | None = None,
) -> _Outcome:
    """Run Current (``single``) or Run from Here (``start``) on the graph."""
    nodes, edges = graph
    session_id, session = _new_session(hosts)
    with hosts.patched():
        await asyncio.wait_for(
            _execute_workflow(
                session_id, nodes, edges, {}, single_node_id=single, start_node_id=start
            ),
            timeout=10,
        )
    return _Outcome(session, log_messages(session_id), hosts)


def _seed_earlier_run(hosts: _Hosts) -> None:
    """A finished run of the Test that left its SSH sessions open."""
    earlier = f"earlier-{uuid.uuid4().hex[:8]}"
    _wb_common._workbench_sessions[earlier] = {
        "session_id": earlier,
        "test_id": TEST_ID,
        "user_id": _wb_common.DEFAULT_USER_ID,
        "status": "passed",
        "started_at": "2026-09-15T10:00:00+00:00",
        "variables": {},
        "block_states": {},
        "ssh_session_registry": hosts.registry(),
    }
    workbench_service._user_active_session[_wb_common.DEFAULT_USER_ID] = earlier


async def _run_scope(
    graph: tuple[Nodes, Edges], hosts: _Hosts, function_id: str, *, earlier_run: bool = True
) -> _Outcome:
    """Run Scope while drilled into the Function instance ``function_id``."""
    nodes, edges = graph
    if earlier_run:
        _seed_earlier_run(hosts)
    record = {"id": TEST_ID, "name": "Adhoc", "workflow": {"nodes": nodes, "edges": edges}}
    with (
        patch.object(workbench_service.test_service, "get_test", return_value=record),
        patch.object(
            workbench_service.environment_service,
            "get_environment",
            return_value={"id": "env-1", "name": "Env"},
        ),
        hosts.patched(),
    ):
        started = workbench_service._start_scoped_function_run(
            test_id=TEST_ID,
            environment_id="env-1",
            user_id=_wb_common.DEFAULT_USER_ID,
            scope=workbench_service.ScopedRunOptions(mode="function", function_node_id=function_id),
            session_id=None,
        )
        session_id = started["session_id"]
        await asyncio.wait_for(_wb_common._active_tasks[session_id], timeout=10)
    return _Outcome(_wb_common._workbench_sessions[session_id], log_messages(session_id), hosts)


def _loop_in_body() -> tuple[Nodes, Edges]:
    """rex body: pre -> For `inner` (body: in -> note) -then-> post; rex then -> after-rex."""
    nodes = [
        rex_node("rex", HOST_SESSION, "rsid"),
        http_node("pre", "/pre"),
        for_node("inner", 2),
        http_node("in", "/in"),
        log_node("note", "Note", "'on wave'"),
        http_node("post", "/post"),
        log_node("after-rex", "After Remote Execution", "'after'"),
    ]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "pre", "body"),
        edge("pre", "inner"),
        edge("inner", "in", "body"),
        edge("in", "note"),
        edge("inner", "post", "then"),
        edge("rex", "after-rex", "then"),
    ]
    return nodes, edges


def _body_in_body() -> tuple[Nodes, Edges]:
    """Outer rex (remote host) body: pre -> inner rex (inner remote host; body: in) -then-> post."""
    nodes = [
        rex_node("outer", HOST_SESSION, "rsid"),
        http_node("pre", "/pre"),
        rex_node("inner", INNER_SESSION, "rsid_inner"),
        http_node("in", "/in"),
        http_node("in-2", "/in-2"),
        http_node("post", "/post"),
    ]
    edges = [
        edge("start-node", "outer"),
        edge("outer", "pre", "body"),
        edge("pre", "inner"),
        edge("inner", "in", "body"),
        edge("in", "in-2"),
        edge("inner", "post", "then"),
    ]
    return nodes, edges


def _wave_blocks_before_remote() -> tuple[Nodes, Edges]:
    """rex body: first (Log) -> wave-loop (For; body: looped Log) -then-> remote -> last (Log)."""
    nodes = [
        rex_node("rex", HOST_SESSION, "rsid"),
        log_node("first", "First", "'first on wave'"),
        for_node("wave-loop", 2),
        log_node("looped", "Looped", "'looped on wave'"),
        http_node("remote", "/remote"),
        log_node("last", "Last", "'last on wave'"),
    ]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "first", "body"),
        edge("first", "wave-loop"),
        edge("wave-loop", "looped", "body"),
        edge("wave-loop", "remote", "then"),
        edge("remote", "last"),
    ]
    return nodes, edges


def _lanes_in_body() -> tuple[Nodes, Edges]:
    """rex body: Parallel `lanes` with one remotable block in each of its two lanes."""
    nodes = [
        rex_node("rex", HOST_SESSION, "rsid"),
        parallel_node("lanes", [branch("branch_1", "one"), branch("branch_2", "two")]),
        http_node("lane-1", "/lane-1"),
        http_node("lane-2", "/lane-2"),
    ]
    edges = [
        edge("start-node", "rex"),
        edge("rex", "lanes", "body"),
        edge("lanes", "lane-1", "branch_1"),
        edge("lanes", "lane-2", "branch_2"),
    ]
    return nodes, edges


def _function_in_body(in_loop: bool) -> tuple[Nodes, Edges]:
    """rex body holds the Function instance `fn` (directly, or inside a For in the body)."""
    body = [http_node("fn-in", "/fn-in"), log_node("fn-note", "Fn note", "'fn on wave'")]
    definition = local_definition(
        "BodyFunction", body, [edge("start-node", "fn-in"), edge("fn-in", "fn-note")]
    )
    nodes = [rex_node("rex", HOST_SESSION, "rsid"), function_node("fn", definition)]
    edges = [edge("start-node", "rex")]
    if in_loop:
        nodes.append(for_node("loop", 1))
        edges += [edge("rex", "loop", "body"), edge("loop", "fn", "body")]
    else:
        edges.append(edge("rex", "fn", "body"))
    return nodes, edges


class TestRunCurrentOnAContainerInTheBody:
    """Run Current on a For Loop in a body runs its remotable blocks on the body's remote host."""

    async def test_the_remotable_blocks_run_on_the_remote_host(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), single="inner")

        assert outcome.hosts.served == [(HOST, "/in"), (HOST, "/in")], outcome.messages
        outcome.hosts.local_http.assert_not_awaited()
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_one_worker_opens_for_the_run_and_closes_after(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), single="inner")

        assert outcome.hosts.events == [
            f"open:{HOST}",
            f"run:{HOST}:/in",
            f"run:{HOST}:/in",
            f"close:{HOST}",
        ]

    async def test_a_non_remotable_block_in_the_loop_runs_on_wave(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), single="inner")

        assert outcome.messages.count("on wave") == 2, outcome.messages
        assert outcome.states.get("note") == "passed", outcome.states

    async def test_nothing_outside_the_container_runs(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), single="inner")

        for node_id in ("rex", "pre", "post", "after-rex"):
            assert node_id not in outcome.states, outcome.states


class TestRunFromHereOnABlockInTheBody:
    """Run from Here on a body block runs it and the body blocks after it on the remote host."""

    async def test_the_downstream_body_blocks_run_on_the_remote_host(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), start="pre")

        assert outcome.hosts.paths_on(HOST) == ["/pre", "/in", "/in", "/post"], outcome.messages
        outcome.hosts.local_http.assert_not_awaited()
        assert outcome.session["status"] == "passed", outcome.messages
        assert "after-rex" not in outcome.states, outcome.states

    async def test_one_worker_serves_the_whole_run(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), start="pre")

        assert outcome.hosts.events[0] == f"open:{HOST}", outcome.hosts.events
        assert outcome.hosts.events.count(f"open:{HOST}") == 1, outcome.hosts.events
        assert outcome.hosts.events[-1] == f"close:{HOST}", outcome.hosts.events


@pytest.mark.parametrize("in_loop", [False, True], ids=["in-the-body", "in-a-loop-in-the-body"])
class TestRunScopeOfAFunctionInTheBody:
    """Run Scope of a Function whose instance sits in a body routes its remotable blocks."""

    async def test_the_function_body_runs_on_the_remote_host(self, in_loop: bool) -> None:
        outcome = await _run_scope(_function_in_body(in_loop), _Hosts(), "fn")

        assert outcome.hosts.served == [(HOST, "/fn-in")], outcome.messages
        outcome.hosts.local_http.assert_not_awaited()
        assert "fn on wave" in outcome.messages, outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_the_worker_opens_for_the_run_and_closes_after(self, in_loop: bool) -> None:
        outcome = await _run_scope(_function_in_body(in_loop), _Hosts(), "fn")

        assert outcome.hosts.events == [f"open:{HOST}", f"run:{HOST}:/fn-in", f"close:{HOST}"]


class TestTheInnermostBodyNamesTheRemoteHost:
    """A block in a body inside another body runs on the inner body's remote host."""

    async def test_run_current_on_a_block_uses_the_inner_remote_host(self) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(), single="in")

        assert outcome.hosts.served == [(INNER_HOST, "/in")], outcome.messages
        assert outcome.hosts.events == [
            f"open:{INNER_HOST}",
            f"run:{INNER_HOST}:/in",
            f"close:{INNER_HOST}",
        ]

    async def test_run_from_here_on_a_block_uses_the_inner_remote_host(self) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(), start="in")

        assert outcome.hosts.served == [(INNER_HOST, "/in"), (INNER_HOST, "/in-2")]
        outcome.hosts.local_http.assert_not_awaited()
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_only_the_inner_session_is_needed(self) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(live=(INNER_SESSION,)), single="in")

        assert outcome.hosts.served == [(INNER_HOST, "/in")], outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_run_current_on_the_inner_container_opens_only_the_inner_worker(self) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(live=(INNER_SESSION,)), single="inner")

        assert outcome.hosts.events == [
            f"open:{INNER_HOST}",
            f"run:{INNER_HOST}:/in",
            f"run:{INNER_HOST}:/in-2",
            f"close:{INNER_HOST}",
        ]
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_run_from_here_on_the_inner_container_opens_the_outer_worker_after_it(
        self,
    ) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(), start="inner")

        assert outcome.hosts.events == [
            f"open:{INNER_HOST}",
            f"run:{INNER_HOST}:/in",
            f"run:{INNER_HOST}:/in-2",
            f"close:{INNER_HOST}",
            f"open:{HOST}",
            f"run:{HOST}:/post",
            f"close:{HOST}",
        ]
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_run_current_on_a_container_outside_any_body_opens_only_its_own_worker(
        self,
    ) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(), single="rex")

        assert outcome.hosts.events.count(f"open:{HOST}") == 1, outcome.hosts.events
        assert outcome.hosts.paths_on(HOST) == ["/pre", "/in", "/in", "/post"]
        assert outcome.session["status"] == "passed", outcome.messages


class TestTheWorkerOpensAtTheFirstRemoteHostBlock:
    """The ad-hoc worker opens when the run first reaches a block that runs on the remote host."""

    async def test_run_current_on_a_wave_block_with_a_closed_session_passes(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(live=()), single="note")

        assert outcome.session["status"] == "passed", outcome.messages
        assert outcome.states == {"note": "passed"}
        assert "on wave" in outcome.messages, outcome.messages
        outcome.hosts.open_worker.assert_not_awaited()

    async def test_run_current_on_a_container_with_no_remotable_block_opens_no_worker(
        self,
    ) -> None:
        outcome = await _run_adhoc(
            _wave_blocks_before_remote(), _Hosts(live=()), single="wave-loop"
        )

        assert outcome.session["status"] == "passed", outcome.messages
        assert outcome.messages.count("looped on wave") == 2, outcome.messages
        outcome.hosts.open_worker.assert_not_awaited()
        assert outcome.hosts.events == []

    async def test_run_from_here_opens_the_worker_at_the_first_remote_host_block(self) -> None:
        outcome = await _run_adhoc(_wave_blocks_before_remote(), _Hosts(), start="first")

        assert outcome.hosts.events == [f"open:{HOST}", f"run:{HOST}:/remote", f"close:{HOST}"]
        (logged,) = outcome.hosts.logged_at_open
        assert "first on wave" in logged, logged
        assert logged.count("looped on wave") == 2, logged
        assert "last on wave" not in logged, logged
        assert "last on wave" in outcome.messages, outcome.messages
        assert outcome.session["status"] == "passed", outcome.messages

    async def test_lanes_that_reach_the_remote_host_together_share_one_worker(self) -> None:
        outcome = await _run_adhoc(_lanes_in_body(), _Hosts(), single="lanes")

        assert outcome.hosts.events.count(f"open:{HOST}") == 1, outcome.hosts.events
        assert sorted(outcome.hosts.paths_on(HOST)) == ["/lane-1", "/lane-2"]
        assert outcome.hosts.events[-1] == f"close:{HOST}", outcome.hosts.events
        assert outcome.session["status"] == "passed", outcome.messages


class TestAClosedSessionFailsTheRun:
    """A closed Execution Host session fails the ad-hoc run at its first remote-host block."""

    async def test_run_current_on_a_container_fails_at_its_first_remote_host_block(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(live=()), single="inner")

        reason = CLOSED_REASON.format(session=HOST_SESSION)
        assert f"Block 'HTTP /in' failed: {reason}" in outcome.messages, outcome.messages
        assert outcome.session["status"] == "failed"
        assert outcome.states["in"] == "failed", outcome.states
        assert outcome.states["inner"] == "failed", outcome.states

    async def test_run_current_on_a_container_runs_nothing_after_the_failed_block(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(live=()), single="inner")

        assert outcome.hosts.events == []
        outcome.hosts.local_http.assert_not_awaited()
        assert "on wave" not in outcome.messages, outcome.messages

    async def test_run_from_here_fails_at_the_remote_host_block_after_the_wave_blocks_ran(
        self,
    ) -> None:
        outcome = await _run_adhoc(_wave_blocks_before_remote(), _Hosts(live=()), start="first")

        reason = CLOSED_REASON.format(session=HOST_SESSION)
        assert f"Block 'HTTP /remote' failed: {reason}" in outcome.messages, outcome.messages
        assert outcome.session["error"] == reason
        assert outcome.session["status"] == "failed"
        assert outcome.states["first"] == "passed", outcome.states
        assert outcome.states["wave-loop"] == "passed", outcome.states
        assert outcome.states["remote"] == "failed", outcome.states
        assert outcome.states["last"] == "skipped", outcome.states
        assert outcome.messages.count("looped on wave") == 2, outcome.messages
        assert outcome.hosts.events == []
        outcome.hosts.local_http.assert_not_awaited()

    async def test_run_from_here_runs_nothing(self) -> None:
        outcome = await _run_adhoc(_loop_in_body(), _Hosts(live=()), start="pre")

        assert outcome.states == {
            "pre": "failed",
            "inner": "skipped",
            "in": "skipped",
            "note": "skipped",
            "post": "skipped",
        }
        assert outcome.hosts.events == []
        outcome.hosts.local_http.assert_not_awaited()

    async def test_a_closed_inner_session_fails_even_when_the_outer_one_is_open(self) -> None:
        outcome = await _run_adhoc(_body_in_body(), _Hosts(live=(HOST_SESSION,)), single="in")

        reason = CLOSED_REASON.format(session=INNER_SESSION)
        assert f"Block 'HTTP /in' failed: {reason}" in outcome.messages, outcome.messages
        assert outcome.hosts.events == []
        outcome.hosts.local_http.assert_not_awaited()

    async def test_run_scope_fails_at_the_remote_host_block_in_the_function(self) -> None:
        outcome = await _run_scope(_function_in_body(False), _Hosts(live=()), "fn")

        reason = CLOSED_REASON.format(session=HOST_SESSION)
        assert f"Block 'HTTP /fn-in' failed: {reason}" in outcome.messages, outcome.messages
        assert outcome.session["status"] == "failed"
        assert outcome.states["fn"] == "failed", outcome.states
        assert outcome.hosts.events == []
        assert "fn on wave" not in outcome.messages, outcome.messages

    async def test_run_scope_with_no_earlier_run_fails_with_the_reason(self) -> None:
        graph_nodes, graph_edges = _function_in_body(False)
        graph_nodes[0]["data"]["expressionFields"] = ["session_id"]
        graph_nodes[0]["data"]["config"]["values"]["session_id"] = "ssh_sid"

        outcome = await _run_scope((graph_nodes, graph_edges), _Hosts(), "fn", earlier_run=False)

        reason = CLOSED_REASON.format(session="ssh_sid")
        assert f"Block 'HTTP /fn-in' failed: {reason}" in outcome.messages, outcome.messages
        assert outcome.hosts.events == []


class TestAStopEndsTheAdhocWorker:
    """A Stop during an ad-hoc run inside a body stops the remote host, then closes the worker."""

    @staticmethod
    async def _stop_while_served(
        graph: tuple[Nodes, Edges], hosts: _Hosts, **target: str
    ) -> list[str]:
        stopped: list[str] = []
        with patch.object(_worker_registry, "stop_worker", lambda _w: stopped.append("stop")):
            task = asyncio.create_task(_run_adhoc(graph, hosts, **target))
            for _ in range(500):
                await asyncio.sleep(0.01)
                if hosts.served:
                    break
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        return stopped

    async def test_the_worker_is_stopped_and_closed(self) -> None:
        hosts = _Hosts(hold_path="/in")

        stopped = await self._stop_while_served(_loop_in_body(), hosts, single="inner")

        assert stopped == ["stop"], stopped
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/in", f"close:{HOST}"]

    async def test_a_worker_opened_after_wave_blocks_is_stopped_and_closed(self) -> None:
        hosts = _Hosts(hold_path="/remote")

        stopped = await self._stop_while_served(_wave_blocks_before_remote(), hosts, start="first")

        assert stopped == ["stop"], stopped
        assert hosts.events == [f"open:{HOST}", f"run:{HOST}:/remote", f"close:{HOST}"]
