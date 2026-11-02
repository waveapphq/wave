"""Stop and Timeout shut the live connection down, so OpenSearch ends the search.

The held cancel shuts the live socket down in both directions and never closes it bare; a
stopped run leaves at once and records nothing; the whole-block deadline is one daemon timer,
armed before the first request and canceled on every exit. REQ-5.1.2, REQ-3.4.1.15, OS-11.
"""

import asyncio
import json
import socket
import threading
import weakref
from collections.abc import Callable
from contextlib import suppress
from typing import Any

import pytest

from tests.connectivity.opensearch.fakes import (
    enqueue_json,
    enqueue_text,
    field_caps_answer,
    hit,
    port_of,
    search_answer,
    sent_json,
)
from tests.plugins.http.conftest import RecordingHTTPServer
from tests.plugins.opensearch.conftest import (
    FakeTimer,
    FixedClock,
    LogRecorder,
    exact,
    failed_line,
    os_context,
    os_params,
    outputs,
    recorded,
    served,
)
from wavecore.plugins import _held_run, _opensearch_core, _process_group
from wavecore.plugins.opensearch import OpenSearchPlugin

ON_ERROR = pytest.mark.parametrize("on_error", ["fail", "record"])
MODES = pytest.mark.parametrize("mode", ["search", "aggregate"])
SCHEMES = pytest.mark.parametrize("fixture", ["os_http", "os_https"], ids=["http", "https"])
# A scripted answer held this long proves a read that ends sooner was woken by the shutdown.
HANG_S = 2.0
WAIT_S = 1.0
FIELD_CAPS_OK = field_caps_answer({"@timestamp": "date", "log.level": "keyword"}, ["logs-1"])
NO_INDEX = field_caps_answer({}, [])
LAST_SORT = [1790332200000, "d9999"]
# A full first page (10,000 hits of 15,000), so the block asks for a second page.
FULL_PAGE = json.dumps(
    search_answer(
        [
            hit(f"d{n}", {"@timestamp": "2026-09-25T10:30:00.000Z"}, sort=[LAST_SORT[0], f"d{n}"])
            for n in range(10000)
        ],
        15000,
    )
)


@pytest.fixture(autouse=True)
def _fixed_now(clock: FixedClock) -> None:
    """Every run reads the same now."""


def timed_out(seconds: int) -> str:
    return (
        f"Timed out after {seconds} seconds; the connection was shut down, "
        "so OpenSearch ends the search"
    )


class Arrivals(list[dict[str, Any]]):
    """The server's request log; `wait_for` blocks until a count of requests arrived."""

    def __init__(self, on_arrival: Callable[[], None] | None = None) -> None:
        super().__init__()
        self.ready = threading.Condition()
        self.on_arrival = on_arrival

    def append(self, record: dict[str, Any]) -> None:
        with self.ready:
            if self.on_arrival is not None:
                self.on_arrival()
            super().append(record)
            self.ready.notify_all()

    def wait_for(self, count: int) -> bool:
        with self.ready:
            return self.ready.wait_for(lambda: len(self) >= count, WAIT_S)


def watched(server: RecordingHTTPServer, on_arrival: Callable[[], None] | None = None) -> Arrivals:
    arrivals = Arrivals(on_arrival)
    server.requests = arrivals
    return arrivals


class SocketSpy:
    """Every shutdown and close a client socket dialing `port` receives, with the calling thread."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, port: int) -> None:
        self.port = port
        self.calls: list[tuple[str, int | None, int]] = []
        self.clients: weakref.WeakSet[socket.socket] = weakref.WeakSet()
        real_shutdown, real_close = socket.socket.shutdown, socket.socket.close

        def shutdown(sock: socket.socket, how: int) -> None:
            self._record(sock, "shutdown", how)
            real_shutdown(sock, how)

        def close(sock: socket.socket) -> None:
            self._record(sock, "close", None)
            real_close(sock)

        monkeypatch.setattr(socket.socket, "shutdown", shutdown)
        monkeypatch.setattr(socket.socket, "close", close)

    def _record(self, sock: socket.socket, name: str, how: int | None) -> None:
        with suppress(OSError):
            peer = sock.getpeername()
            if isinstance(peer, tuple) and peer[1] == self.port:
                self.clients.add(sock)
        if sock in self.clients:
            self.calls.append((name, how, threading.get_ident()))

    def by(self, thread: int) -> list[tuple[str, int | None]]:
        """The calls made on the given thread."""
        return [(name, how) for name, how, ident in self.calls if ident == thread]


def hang_on_query(server: RecordingHTTPServer) -> None:
    """The field list answers; the query (Search or Aggregate) hangs past WAIT_S."""
    enqueue_json(server, FIELD_CAPS_OK)
    enqueue_json(server, search_answer([], 0), delay=HANG_S)


def hang_on_second_page(server: RecordingHTTPServer) -> None:
    """The field list and a full first page answer; the second page hangs past WAIT_S."""
    enqueue_json(server, FIELD_CAPS_OK)
    enqueue_text(server, FULL_PAGE)
    enqueue_json(server, search_answer([], 0), delay=HANG_S)


def start_core(
    params: dict[str, Any],
    log: LogRecorder,
    running: _process_group.HeldGroups | None = None,
) -> asyncio.Task[Any]:
    """The core on a worker thread, with `running` as the run's groups when given."""
    token = None if running is None else _process_group.RUNNING.set(running)
    try:
        return asyncio.create_task(asyncio.to_thread(_opensearch_core.run, params, log))
    finally:
        if token is not None:
            _process_group.RUNNING.reset(token)


def run_under(
    running: _process_group.HeldGroups, params: dict[str, Any], log: LogRecorder
) -> dict[str, Any]:
    """The core on this thread with `running` as the run's groups."""
    token = _process_group.RUNNING.set(running)
    try:
        return _opensearch_core.run(params, log)
    finally:
        _process_group.RUNNING.reset(token)


async def arrived(arrivals: Arrivals, count: int) -> bool:
    return await asyncio.to_thread(arrivals.wait_for, count)


def beyond_debug(log: LogRecorder) -> list[tuple[str, str]]:
    """Every line but the per-request DEBUG lines."""
    return [(level, message) for level, message in log if level != "DEBUG"]


def timer_states(timers: list[FakeTimer]) -> list[tuple[bool, bool, bool]]:
    return [(timer.daemon, timer.started, timer.canceled) for timer in timers]


class TestTheDeadlineShutsTheSocketDown:
    """Past Timeout the live socket is shut down; the block fails with reason Timeout (OS-11)."""

    @ON_ERROR
    @MODES
    async def test_a_fire_during_the_read_ends_the_block_with_the_timeout(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        on_error: str,
        mode: str,
    ) -> None:
        arrivals = watched(os_http)
        hang_on_query(os_http)
        spy = SocketSpy(monkeypatch, port_of(os_http))
        task = start_core(served(os_http, mode=mode, timeout=7, on_error=on_error), log)
        assert await arrived(arrivals, 2)

        deadline.made[0].fire()

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact(timed_out(7))):
                await asyncio.wait_for(task, WAIT_S)
            assert log.at("WARN") == []
        else:
            out = outputs(await asyncio.wait_for(task, WAIT_S))
            assert out == recorded(timed_out(7), "Timeout")
            assert log.at("WARN") == [failed_line(mode, timed_out(7), "Timeout")]
        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]
        assert log.at("INFO") == []

    @SCHEMES
    async def test_the_live_socket_of_either_scheme_is_shut_down_never_closed(
        self,
        fixture: str,
        request: pytest.FixtureRequest,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        server: RecordingHTTPServer = request.getfixturevalue(fixture)
        arrivals = watched(server)
        hang_on_query(server)
        spy = SocketSpy(monkeypatch, port_of(server))
        task = start_core(served(server, verify_ssl=False, on_error="record"), log)
        assert await arrived(arrivals, 2)

        deadline.made[0].fire()
        out = outputs(await asyncio.wait_for(task, WAIT_S))

        assert (out["error"], out["reason"]) == (timed_out(300), "Timeout")
        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]

    def test_a_connect_failure_after_the_fire_is_the_timeout(
        self,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def dial(*_args: Any, **_kwargs: Any) -> socket.socket:
            deadline.made[0].fire()
            raise ConnectionRefusedError(111, "Connection refused")

        monkeypatch.setattr(socket, "create_connection", dial)

        out = outputs(_opensearch_core.run(os_params(timeout=9, on_error="record"), log))

        assert out == recorded(timed_out(9), "Timeout")
        assert log.at("WARN") == [failed_line("search", timed_out(9), "Timeout")]

    async def test_a_fire_during_paging_leaves_no_partial_results(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        arrivals = watched(os_http)
        hang_on_second_page(os_http)
        spy = SocketSpy(monkeypatch, port_of(os_http))
        params = served(os_http, max_results=0, timeout=7, on_error="record")
        task = start_core(params, log)
        assert await arrived(arrivals, 3)

        deadline.made[0].fire()
        out = outputs(await asyncio.wait_for(task, WAIT_S))

        assert out == recorded(timed_out(7), "Timeout")
        assert log.at("WARN") == [failed_line("search", timed_out(7), "Timeout")]
        assert sent_json(os_http, 2)["search_after"] == LAST_SORT
        assert len(os_http.requests) == 3
        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]


class TestStopShutsTheSocketDown:
    """A stopped block shuts its live socket down on the stopping thread (REQ-3.2.2.4, OS-11)."""

    @SCHEMES
    @MODES
    async def test_stop_shuts_the_live_socket_down_on_the_loop_thread(
        self,
        fixture: str,
        mode: str,
        request: pytest.FixtureRequest,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        server: RecordingHTTPServer = request.getfixturevalue(fixture)
        arrivals = watched(server)
        hang_on_query(server)
        spy = SocketSpy(monkeypatch, port_of(server))
        params = served(server, mode=mode, verify_ssl=False)
        task = asyncio.create_task(OpenSearchPlugin().execute(os_context(params, log)))
        assert await arrived(arrivals, 2)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]

    async def test_nothing_but_request_lines_is_logged_around_the_stop(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
    ) -> None:
        arrivals = watched(os_http)
        hang_on_query(os_http)
        params = served(os_http, on_error="record")
        task = asyncio.create_task(OpenSearchPlugin().execute(os_context(params, log)))
        assert await arrived(arrivals, 2)

        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        for _ in range(3):
            await asyncio.sleep(0)

        assert beyond_debug(log) == []
        assert len(log.at("DEBUG")) <= len(os_http.requests)


class TestAStopLeavesAtOnce:
    """A stopped run raises Stopped past every handler: never recorded, nothing logged after."""

    @MODES
    async def test_a_stop_during_the_read_ends_the_run_at_once(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
        mode: str,
    ) -> None:
        arrivals = watched(os_http)
        hang_on_query(os_http)
        spy = SocketSpy(monkeypatch, port_of(os_http))
        running = _process_group.HeldGroups()
        task = start_core(served(os_http, mode=mode, on_error="record"), log, running)
        assert await arrived(arrivals, 2)

        running.stop()

        with pytest.raises(_held_run.Stopped):
            await asyncio.wait_for(task, WAIT_S)
        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]
        assert beyond_debug(log) == []
        assert timer_states(deadline.made) == [(True, True, True)]

    async def test_a_stop_during_paging_asks_for_no_later_page(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        arrivals = watched(os_http)
        hang_on_second_page(os_http)
        spy = SocketSpy(monkeypatch, port_of(os_http))
        running = _process_group.HeldGroups()
        params = served(os_http, max_results=0, on_error="record")
        task = start_core(params, log, running)
        assert await arrived(arrivals, 3)

        running.stop()

        with pytest.raises(_held_run.Stopped):
            await asyncio.wait_for(task, WAIT_S)
        assert sent_json(os_http, 2)["search_after"] == LAST_SORT
        assert len(os_http.requests) == 3
        assert beyond_debug(log) == []
        assert spy.by(threading.get_ident()) == [("shutdown", socket.SHUT_RDWR)]

    def test_a_stop_before_the_run_sends_nothing(
        self, os_http: RecordingHTTPServer, deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        enqueue_json(os_http, FIELD_CAPS_OK)
        running = _process_group.HeldGroups()
        running.stop()

        with pytest.raises(_held_run.Stopped):
            run_under(running, served(os_http, on_error="record"), log)

        assert os_http.requests == []
        assert beyond_debug(log) == []
        assert timer_states(deadline.made) == [(True, True, True)]

    def test_after_the_run_ends_a_stop_shuts_nothing_down(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        enqueue_json(os_http, NO_INDEX)
        spy = SocketSpy(monkeypatch, port_of(os_http))
        running = _process_group.HeldGroups()
        run_under(running, served(os_http), log)
        before = list(spy.calls)

        running.stop()

        assert spy.calls == before

    def test_a_run_outside_any_running_groups_still_finishes(
        self, os_http: RecordingHTTPServer, deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        enqueue_json(os_http, NO_INDEX)

        out = outputs(_opensearch_core.run(served(os_http), log))

        assert (out["success"], out["total_results"]) == (True, 0)
        assert timer_states(deadline.made) == [(True, True, True)]


class TestTheDeadlineTimer:
    """Timeout bounds the whole block with one daemon timer, canceled on every exit."""

    @pytest.mark.parametrize(
        ("overrides", "seconds"),
        [({}, 300), ({"timeout": 7}, 7), ({"timeout": None}, 300)],
        ids=["default", "set", "none"],
    )
    def test_the_timer_is_armed_with_the_timeout_seconds(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        overrides: dict[str, Any],
        seconds: int,
    ) -> None:
        enqueue_json(os_http, NO_INDEX)

        _opensearch_core.run(served(os_http, **overrides), log)

        assert [timer.seconds for timer in deadline.made] == [seconds]

    def test_the_timer_runs_as_a_daemon_from_before_the_first_request_until_the_end(
        self, os_http: RecordingHTTPServer, deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        at_first_request: list[list[tuple[bool, bool, bool]]] = []
        watched(os_http, lambda: at_first_request.append(timer_states(deadline.made)))
        enqueue_json(os_http, NO_INDEX)

        _opensearch_core.run(served(os_http), log)

        assert at_first_request == [[(True, True, False)]]
        assert timer_states(deadline.made) == [(True, True, True)]

    @ON_ERROR
    def test_the_timer_is_canceled_when_a_failure_ends_the_block(
        self,
        os_http: RecordingHTTPServer,
        deadline: type[FakeTimer],
        log: LogRecorder,
        on_error: str,
    ) -> None:
        enqueue_json(os_http, FIELD_CAPS_OK)
        enqueue_text(os_http, "", status=503, content_type=None)
        params = served(os_http, on_error=on_error)

        if on_error == "fail":
            with pytest.raises(ValueError, match=exact("HTTP 503 Service Unavailable (no body)")):
                _opensearch_core.run(params, log)
        else:
            assert outputs(_opensearch_core.run(params, log))["reason"] == "RequestFailed"

        assert timer_states(deadline.made) == [(True, True, True)]

    async def test_the_timer_is_canceled_when_the_deadline_ends_the_block(
        self, os_http: RecordingHTTPServer, deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        arrivals = watched(os_http)
        hang_on_query(os_http)
        task = start_core(served(os_http, on_error="record"), log)
        assert await arrived(arrivals, 2)

        deadline.made[0].fire()
        await asyncio.wait_for(task, WAIT_S)

        assert timer_states(deadline.made) == [(True, True, True)]

    def test_a_block_refused_before_connecting_arms_no_timer(
        self, os_http: RecordingHTTPServer, deadline: type[FakeTimer], log: LogRecorder
    ) -> None:
        out = outputs(
            _opensearch_core.run(served(os_http, url="ftp://{host}", on_error="record"), log)
        )

        assert out["reason"] == "Validation"
        assert deadline.made == []
        assert os_http.requests == []
