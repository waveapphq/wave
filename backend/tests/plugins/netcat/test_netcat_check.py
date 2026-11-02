"""Netcat Check mode through the core: states, resolution, Results and console (REQ-3.3.4.3)."""

import asyncio
import errno
import re
import socket
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.netcat.conftest import (
    FAST,
    WAIT,
    Listener,
    LogRecorder,
    WriterProbe,
    free_port,
    netcat_context,
    netcat_params,
    resolve_to,
)
from wavecore.core.table import Table
from wavecore.plugins._netcat_core import run
from wavecore.plugins.netcat import NetcatPlugin

Stream = tuple[Any, Any]
Opener = Callable[[str, int], Awaitable[Stream]]
Listen = Callable[..., Awaitable[Listener]]
Entry = Callable[[dict[str, Any], LogRecorder], Awaitable[dict[str, Any]]]

CHECK_COLUMNS = [
    {"name": "port", "type": "integer"},
    {"name": "protocol", "type": "string"},
    {"name": "state", "type": "string"},
    {"name": "reason", "type": "string"},
    {"name": "time_ms", "type": "integer"},
]
UNRESOLVED = "Could not resolve host: db.example"


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    return envelope["outputs"]


async def never(host: str, port: int) -> Stream:
    return await asyncio.get_running_loop().create_future()


async def refuse(host: str, port: int) -> Stream:
    raise ConnectionRefusedError(errno.ECONNREFUSED, f"Connect call failed ('{host}', {port})")


async def gone(host: str, port: int) -> Stream:
    raise TimeoutError


class Reach:
    """A stub opener that really connects to 127.0.0.1:`target` and keeps each writer it opens."""

    def __init__(self, target: int) -> None:
        self.target, self.writers = target, list[WriterProbe]()

    async def __call__(self, address: str, port: int) -> Stream:
        reader, writer = await asyncio.open_connection("127.0.0.1", self.target)
        self.writers.append(WriterProbe(writer))
        return reader, self.writers[-1]

    def closed(self) -> list[bool]:
        return [writer.closed.is_set() for writer in self.writers]


class Dialer:
    """A stub opener: records each dial, holds it `delays[port]` s, answers per address or port."""

    def __init__(
        self,
        routes: dict[str | int, Opener] | None = None,
        delays: dict[int, float] | None = None,
        default: Opener = refuse,
        after: dict[int, int] | None = None,
    ) -> None:
        self.routes, self.delays, self.default = routes or {}, delays or {}, default
        self.after = after or {}
        self.done: dict[int, asyncio.Event] = {}
        self.calls: list[tuple[str, int]] = []
        self.finished: list[int] = []
        self.in_flight = self.peak = 0

    async def __call__(self, address: str, port: int) -> Stream:
        self.calls.append((address, port))
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            await asyncio.sleep(self.delays.get(port, 0))
            # after[port] names a port that must finish first (1 s bound)
            if port in self.after:
                event = self.done.setdefault(self.after[port], asyncio.Event())
                await asyncio.wait_for(event.wait(), 1)
        finally:
            self.in_flight -= 1
        self.finished.append(port)
        self.done.setdefault(port, asyncio.Event()).set()
        answer = self.routes.get(address) or self.routes.get(port) or self.default
        return await answer(address, port)


def span(*ports: int) -> dict[str, Any]:
    """The Range settings for `ports` written as a list."""
    return {"ports": "range", "port_range": ", ".join(str(port) for port in ports)}


def free_ports(count: int) -> list[int]:
    ports: set[int] = set()
    while len(ports) < count:
        ports.add(free_port())
    return sorted(ports)


def verdicts(out: dict[str, Any]) -> list[list[Any]]:
    """Each Results row without its time_ms cell; every Check row has exactly five cells."""
    rows = out["results"]["rows"]
    assert all(len(row) == 5 for row in rows)
    return [row[:4] for row in rows]


def row_ports(out: dict[str, Any]) -> list[int]:
    return [row[0] for row in out["results"]["rows"]]


async def run_check(
    log: LogRecorder, port: int = 0, *, opener: Opener | None = None, **overrides: Any
) -> dict[str, Any]:
    """Run a Check through the core; the default opener unless a stub is given."""
    seams = {} if opener is None else {"opener": opener}
    return outputs(await run(netcat_params(port, **overrides), log, **seams))


async def via_core(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    return outputs(await run(params, log))


async def via_execute(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    result: dict[str, Any] = await NetcatPlugin().execute(netcat_context(params, log))
    return result


ENTRIES = [pytest.param(via_core, id="core"), pytest.param(via_execute, id="execute")]


def states_of(results: Any) -> list[str]:
    """The state column of a table envelope (core) or of a materialized Table (execute)."""
    if isinstance(results, Table):
        return list(results.col("state"))
    return [row[2] for row in results["rows"]]


async def until(condition: Callable[[], object]) -> None:
    async with asyncio.timeout(1):
        while not condition():
            await asyncio.sleep(0.001)


async def assert_stopped(task: asyncio.Task[Any], bound: float) -> None:
    """Stop `task`: it must end with CancelledError within `bound` seconds (NETCAT-6)."""
    task.cancel()
    done, _ = await asyncio.wait({task}, timeout=bound)
    assert done == {task}
    with pytest.raises(asyncio.CancelledError):
        await task


class TestPortStates:
    """NETCAT-8, NETCAT-13, NETCAT-17: each state, its reason and what a Check sends."""

    @pytest.mark.parametrize(("kind", "protocol"), [("tcp-echo", "tcp"), ("udp-echo", "udp")])
    async def test_a_port_that_answers_is_open_with_an_empty_reason(
        self, listen: Listen, log: LogRecorder, kind: str, protocol: str
    ) -> None:
        port = (await listen(kind)).port
        out = await run_check(log, port, protocol=protocol)
        assert verdicts(out) == [[port, protocol, "open", ""]]
        assert out["success"] is True

    @pytest.mark.parametrize("protocol", ["tcp", "udp"])
    async def test_a_refused_port_is_closed_with_the_os_text(
        self, log: LogRecorder, protocol: str
    ) -> None:
        port = free_port()
        out = await run_check(log, port, protocol=protocol, on_error="record")
        assert verdicts(out) == [[port, protocol, "closed", "Connection refused"]]
        assert "Connect call failed" not in out["results"]["rows"][0][3]

    @pytest.mark.parametrize(
        ("opener", "timeout", "reason"),
        [
            pytest.param(never, FAST, "No answer within 0.05 seconds", id="never-answers"),
            pytest.param(gone, 10, "No answer within 10 seconds", id="integer-timeout"),
        ],
    )
    async def test_a_tcp_port_without_an_answer_times_out(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        opener: Opener,
        timeout: float,
        reason: str,
    ) -> None:
        resolve_to(monkeypatch, "127.0.0.1")
        out = await run_check(log, 7, opener=opener, timeout=timeout, on_error="record")
        assert verdicts(out) == [[7, "tcp", "timed out", reason]]

    async def test_an_empty_reply_datagram_is_open(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        """Any datagram back, even an empty one, is a reply."""
        server = await listen("udp", lambda _: [b""])
        resolve_to(monkeypatch, "127.0.0.1")
        out = await run_check(log, server.port, protocol="udp")
        assert verdicts(out) == [[server.port, "udp", "open", ""]]

    async def test_a_silent_udp_port_is_open_or_filtered(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        silent = await listen("udp-silent")
        resolve_to(monkeypatch, "127.0.0.1")
        out = await run_check(log, silent.port, protocol="udp", timeout=FAST)
        assert verdicts(out) == [
            [silent.port, "udp", "open or filtered", "No reply within 0.05 seconds"]
        ]

    @pytest.mark.parametrize(("kind", "timeout"), [("udp-silent", FAST), ("udp-echo", WAIT)])
    async def test_a_udp_check_sends_one_datagram_holding_x(
        self,
        monkeypatch: pytest.MonkeyPatch,
        listen: Listen,
        log: LogRecorder,
        kind: str,
        timeout: float,
    ) -> None:
        listener = await listen(kind)
        resolve_to(monkeypatch, "127.0.0.1")
        await run_check(log, listener.port, protocol="udp", timeout=timeout)
        assert await listener.settled(1) == [b"X"]

    async def test_a_tcp_check_sends_no_byte(self, listen: Listen, log: LogRecorder) -> None:
        echo = await listen("tcp-echo")
        await run_check(log, echo.port)
        assert await echo.settled(1) == [b""]


class TestResolution:
    """NETCAT-17: the Host resolves once within Timeout; TCP walks the addresses, UDP takes one."""

    async def test_the_host_is_resolved_once_per_block(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        asked = resolve_to(monkeypatch, "127.0.0.1")
        dialer = Dialer()
        await run_check(log, opener=dialer, host="db.example", on_error="record", **span(1, 2, 3))
        assert asked == ["db.example"]
        assert sorted(dialer.calls) == [("127.0.0.1", 1), ("127.0.0.1", 2), ("127.0.0.1", 3)]

    @pytest.mark.parametrize(
        ("fault", "timeout"),
        [
            pytest.param(
                {"error": socket.gaierror(-2, "Name or service not known")}, WAIT, id="gaierror"
            ),
            pytest.param({"hang": True}, FAST, id="overrun"),
            pytest.param({}, WAIT, id="no-address"),
            pytest.param({"error": UnicodeError("label too long")}, WAIT, id="unicode-error"),
        ],
    )
    async def test_an_unresolved_host_fails_the_block(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        fault: dict[str, Any],
        timeout: float,
    ) -> None:
        resolve_to(monkeypatch, **fault)
        dialer = Dialer()
        with pytest.raises(ValueError, match=exact(UNRESOLVED)):
            await run_check(log, 80, opener=dialer, host="db.example", timeout=timeout)
        assert dialer.calls == []

    @pytest.mark.parametrize(
        ("shape", "start"),
        [
            pytest.param(
                {"port": 80}, ("INFO", "Checking db.example port 80 over TCP"), id="single"
            ),
            pytest.param(
                {**span(1, 2, 3), "protocol": "udp"},
                ("INFO", "Checking 3 ports on db.example over UDP"),
                id="range",
            ),
        ],
    )
    async def test_an_unresolved_host_is_recorded_with_empty_results(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        shape: dict[str, Any],
        start: tuple[str, str],
    ) -> None:
        resolve_to(monkeypatch, error=socket.gaierror(-2, "Name or service not known"))
        out = await run_check(log, host="db.example", on_error="record", **shape)
        assert (out["success"], out["error"], out["reason"]) == (False, UNRESOLVED, "Unresolved")
        assert out["results"]["rows"] == []
        assert log == [start, ("WARN", f"Netcat failed (Unresolved): {UNRESOLVED}")]

    async def test_tcp_tries_the_addresses_in_resolver_order_until_one_connects(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        resolve_to(monkeypatch, "10.0.0.1", "10.0.0.2", "10.0.0.3")
        connect = Reach(echo.port)
        dialer = Dialer({"10.0.0.1": refuse, "10.0.0.2": connect, "10.0.0.3": connect})
        out = await run_check(log, 80, opener=dialer, host="db.example")
        assert dialer.calls == [("10.0.0.1", 80), ("10.0.0.2", 80)]
        assert verdicts(out) == [[80, "tcp", "open", ""]]
        assert connect.closed() == [True]

    async def test_each_address_gets_its_own_timeout(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        """NETCAT-6: Timeout bounds each connection attempt, not the whole address walk."""
        echo = await listen("tcp-echo")
        resolve_to(monkeypatch, "10.0.0.1", "10.0.0.2")
        connect = Reach(echo.port)
        dialer = Dialer({"10.0.0.1": never, "10.0.0.2": connect})
        out = await run_check(log, 80, opener=dialer, host="db.example", timeout=FAST)
        assert dialer.calls == [("10.0.0.1", 80), ("10.0.0.2", 80)]
        assert verdicts(out) == [[80, "tcp", "open", ""]]
        assert connect.closed() == [True]

    async def test_a_repeated_address_is_tried_once(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, "10.0.0.1", "10.0.0.1", "10.0.0.2")
        dialer = Dialer()
        await run_check(log, 80, opener=dialer, host="db.example", on_error="record")
        assert dialer.calls == [("10.0.0.1", 80), ("10.0.0.2", 80)]

    @pytest.mark.parametrize(
        ("first", "last", "state", "reason"),
        [
            pytest.param(gone, refuse, "closed", "Connection refused", id="refused-last"),
            pytest.param(
                refuse, gone, "timed out", "No answer within 10 seconds", id="timed-out-last"
            ),
        ],
    )
    async def test_tcp_reports_the_last_attempt(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        first: Opener,
        last: Opener,
        state: str,
        reason: str,
    ) -> None:
        resolve_to(monkeypatch, "10.0.0.1", "10.0.0.2")
        dialer = Dialer({"10.0.0.1": first, "10.0.0.2": last})
        out = await run_check(
            log, 80, opener=dialer, host="db.example", timeout=10, on_error="record"
        )
        assert dialer.calls == [("10.0.0.1", 80), ("10.0.0.2", 80)]
        assert verdicts(out) == [[80, "tcp", state, reason]]

    async def test_tcp_moves_past_a_refusing_address_on_real_sockets(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        resolve_to(monkeypatch, "127.0.0.2", "127.0.0.1")
        out = await run_check(log, echo.port, host="db.example")
        assert verdicts(out) == [[echo.port, "tcp", "open", ""]]

    @pytest.mark.parametrize(
        ("addresses", "state", "reason", "received"),
        [
            pytest.param(
                ("127.0.0.2", "127.0.0.1"), "closed", "Connection refused", [], id="first-refuses"
            ),
            pytest.param(("127.0.0.1", "127.0.0.2"), "open", "", [b"X"], id="first-answers"),
        ],
    )
    async def test_udp_uses_the_first_address_only(
        self,
        monkeypatch: pytest.MonkeyPatch,
        listen: Listen,
        log: LogRecorder,
        addresses: tuple[str, str],
        state: str,
        reason: str,
        received: list[bytes],
    ) -> None:
        echo = await listen("udp-echo")
        resolve_to(monkeypatch, *addresses)
        out = await run_check(log, echo.port, host="db.example", protocol="udp", on_error="record")
        assert verdicts(out) == [[echo.port, "udp", state, reason]]
        assert echo.received == received


class TestResults:
    """NETCAT-2, NETCAT-7, NETCAT-15: the Results table of a Check."""

    @pytest.mark.parametrize("ranged", [False, True], ids=["single", "range"])
    async def test_results_carry_the_check_columns_and_no_reply(
        self, listen: Listen, log: LogRecorder, ranged: bool
    ) -> None:
        echo = await listen("tcp-echo")
        out = await run_check(log, echo.port, **(span(echo.port) if ranged else {}))
        assert out["results"]["columns"] == CHECK_COLUMNS
        assert verdicts(out) == [[echo.port, "tcp", "open", ""]]
        assert "reply" not in out

    async def test_time_ms_of_an_open_port_is_an_integer_under_a_second(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        [[*_, time_ms]] = (await run_check(log, echo.port))["results"]["rows"]
        assert isinstance(time_ms, int) and not isinstance(time_ms, bool)
        assert 0 <= time_ms < 1000

    async def test_time_ms_spans_the_wait_up_to_the_verdict(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        resolve_to(monkeypatch, "127.0.0.1")
        out = await run_check(log, 7, opener=never, timeout=FAST, on_error="record")
        [[*_, time_ms]] = out["results"]["rows"]
        assert isinstance(time_ms, int) and not isinstance(time_ms, bool)
        assert time_ms >= 40

    async def test_a_range_dials_at_most_64_ports_at_once(self, log: LogRecorder) -> None:
        dialer = Dialer(delays=dict.fromkeys(range(1, 101), 0.001))
        out = await run_check(
            log, opener=dialer, ports="range", port_range="1-100", on_error="record"
        )
        assert dialer.peak == 64
        assert row_ports(out) == list(range(1, 101))

    async def test_results_keep_the_written_order_whatever_finishes_first(
        self, log: LogRecorder
    ) -> None:
        dialer = Dialer(after={1: 2, 3: 1})
        out = await run_check(log, opener=dialer, on_error="record", **span(3, 1, 2))
        assert dialer.finished == [2, 1, 3]
        assert row_ports(out) == [3, 1, 2]
        assert [message for level, message in log if level == "DEBUG"] == [
            f"Port {port}/tcp closed: Connection refused" for port in (3, 1, 2)
        ]


class TestConsole:
    """Start lines, per-port lines and the Range summary, in NETCAT-2 order."""

    @pytest.mark.parametrize(
        ("host", "protocol", "count", "line"),
        [
            pytest.param(
                "127.0.0.1", "tcp", 1, "Checking 127.0.0.1 port {0} over TCP", id="single-tcp"
            ),
            pytest.param(
                "127.0.0.1", "udp", 1, "Checking 127.0.0.1 port {0} over UDP", id="single-udp"
            ),
            pytest.param(
                "  127.0.0.1 ",
                "tcp",
                1,
                "Checking 127.0.0.1 port {0} over TCP",
                id="single-trimmed",
            ),
            pytest.param(
                "127.0.0.1", "tcp", 3, "Checking 3 ports on 127.0.0.1 over TCP", id="range-tcp"
            ),
            pytest.param(
                "127.0.0.1", "udp", 3, "Checking 3 ports on 127.0.0.1 over UDP", id="range-udp"
            ),
        ],
    )
    async def test_the_start_line_names_the_host_ports_and_protocol(
        self, log: LogRecorder, host: str, protocol: str, count: int, line: str
    ) -> None:
        ports = free_ports(count)
        shape = span(*ports) if count > 1 else {"port": ports[0]}
        await run_check(log, host=host, protocol=protocol, on_error="record", **shape)
        assert log[0] == ("INFO", line.format(ports[0]))

    @pytest.mark.parametrize(
        ("kind", "protocol", "timeout", "line"),
        [
            pytest.param("tcp-echo", "tcp", WAIT, "Port {0}/tcp open", id="open"),
            pytest.param(
                "closed", "tcp", WAIT, "Port {0}/tcp closed: Connection refused", id="closed"
            ),
            pytest.param(
                "udp-silent",
                "udp",
                FAST,
                "Port {0}/udp open or filtered: No reply within 0.05 seconds",
                id="open-or-filtered",
            ),
        ],
    )
    async def test_a_single_result_is_one_info_line(
        self,
        monkeypatch: pytest.MonkeyPatch,
        listen: Listen,
        log: LogRecorder,
        kind: str,
        protocol: str,
        timeout: float,
        line: str,
    ) -> None:
        port = free_port() if kind == "closed" else (await listen(kind)).port
        resolve_to(monkeypatch, "127.0.0.1")
        await run_check(log, port, protocol=protocol, timeout=timeout, on_error="record")
        assert log[1] == ("INFO", line.format(port))

    async def test_a_passing_single_check_logs_the_start_and_the_result(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        port = (await listen("tcp-echo")).port
        await run_check(log, port)
        assert log == [
            ("INFO", f"Checking 127.0.0.1 port {port} over TCP"),
            ("INFO", f"Port {port}/tcp open"),
        ]

    async def test_a_tcp_range_logs_each_port_then_the_summary(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo = await listen("tcp-echo")
        dialer = Dialer({81: Reach(echo.port), 82: refuse, 83: gone})
        await run_check(log, opener=dialer, timeout=10, **span(81, 82, 83))
        assert log == [
            ("INFO", "Checking 3 ports on 127.0.0.1 over TCP"),
            ("DEBUG", "Port 81/tcp open"),
            ("DEBUG", "Port 82/tcp closed: Connection refused"),
            ("DEBUG", "Port 83/tcp timed out: No answer within 10 seconds"),
            ("INFO", "1 open, 1 closed, 1 timed out of 3"),
        ]

    async def test_a_udp_range_logs_each_port_then_the_summary(
        self, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        echo, silent, closed = await listen("udp-echo"), await listen("udp-silent"), free_port()
        resolve_to(monkeypatch, "127.0.0.1")
        await run_check(log, protocol="udp", timeout=FAST, **span(echo.port, closed, silent.port))
        assert log == [
            ("INFO", "Checking 3 ports on 127.0.0.1 over UDP"),
            ("DEBUG", f"Port {echo.port}/udp open"),
            ("DEBUG", f"Port {closed}/udp closed: Connection refused"),
            ("DEBUG", f"Port {silent.port}/udp open or filtered: No reply within 0.05 seconds"),
            ("INFO", "1 open, 1 closed, 1 open or filtered of 3"),
        ]

    async def test_the_summary_leaves_out_zero_counts(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        first, second = await listen("tcp-echo"), await listen("tcp-echo")
        await run_check(log, **span(first.port, second.port))
        assert log == [
            ("INFO", "Checking 2 ports on 127.0.0.1 over TCP"),
            ("DEBUG", f"Port {first.port}/tcp open"),
            ("DEBUG", f"Port {second.port}/tcp open"),
            ("INFO", "2 open of 2"),
        ]


class TestSettingsInEffect:
    """NETCAT-14: a setting whose row the current Ports, Mode or Send hides is not used."""

    @pytest.mark.parametrize("entry", ENTRIES)
    async def test_check_reads_no_payload_file(
        self, entry: Entry, listen: Listen, log: LogRecorder, tmp_path: Path
    ) -> None:
        echo = await listen("tcp-echo")
        params = netcat_params(echo.port, send="file", file=str(tmp_path / "missing.bin"))
        out = await entry(params, log)
        assert (out["success"], states_of(out["results"])) == (True, ["open"])
        assert await echo.settled(1) == [b""]

    @pytest.mark.parametrize("entry", ENTRIES)
    async def test_a_udp_check_sends_x_whatever_the_talk_settings(
        self, entry: Entry, monkeypatch: pytest.MonkeyPatch, listen: Listen, log: LogRecorder
    ) -> None:
        silent = await listen("udp-silent")
        resolve_to(monkeypatch, "127.0.0.1")
        hidden = {"send": "nothing", "text": "zzz", "crlf": True}
        await entry(netcat_params(silent.port, protocol="udp", timeout=FAST, **hidden), log)
        assert await silent.settled(1) == [b"X"]

    async def test_single_ignores_the_port_range(self, listen: Listen, log: LogRecorder) -> None:
        echo = await listen("tcp-echo")
        out = await run_check(log, echo.port, port_range="not a list")
        assert verdicts(out) == [[echo.port, "tcp", "open", ""]]

    async def test_range_ignores_the_port(self, listen: Listen, log: LogRecorder) -> None:
        echo = await listen("tcp-echo")
        out = outputs(await run({**netcat_params(**span(echo.port)), "port": "abc"}, log))
        assert verdicts(out) == [[echo.port, "tcp", "open", ""]]


class TestStop:
    """NETCAT-6: Stop ends the block at once while resolving, connecting or awaiting a reply."""

    async def test_stop_while_connecting(self, log: LogRecorder) -> None:
        dialer = Dialer(default=never)
        task = asyncio.create_task(run(netcat_params(80, timeout=10), log, opener=dialer))
        await until(lambda: dialer.calls)
        await assert_stopped(task, 1.0)

    async def test_stop_while_resolving(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        asked = resolve_to(monkeypatch, hang=True)
        task = asyncio.create_task(run(netcat_params(80, host="db.example", timeout=10), log))
        await until(lambda: asked)
        await assert_stopped(task, 1.0)

    async def test_stop_while_waiting_for_a_udp_reply(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        silent = await listen("udp-silent")
        task = asyncio.create_task(run(netcat_params(silent.port, protocol="udp"), log))
        await silent.settled(1)
        await assert_stopped(task, WAIT / 4)


class TestAPortThatRaises:
    """An unexpected error on one port stops every other port before the block ends."""

    async def test_the_other_ports_stop_dialing_before_the_error_propagates(
        self, log: LogRecorder
    ) -> None:
        waiting: list[int] = []
        stopped: list[int] = []

        async def opener(address: str, port: int) -> Stream:
            if port == 1:
                await until(lambda: len(waiting) == 2)
                raise RuntimeError("stream broke")
            waiting.append(port)
            try:
                return await never(address, port)
            except asyncio.CancelledError:
                stopped.append(port)
                raise

        with pytest.raises(RuntimeError, match=exact("stream broke")):
            await run(netcat_params(timeout=10, **span(1, 2, 3)), log, opener=opener)

        assert sorted(stopped) == [2, 3]
