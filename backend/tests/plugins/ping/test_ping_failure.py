"""Ping under Fail the block and Record and continue, resolution and the Timeout bound.

Covers REQ-3.4.1.9 and the block's run-time failure contract; the execute() wiring covers
REQ-3.3.4.4, since the block's outputs are what the run binds to variables.
"""

import asyncio
import errno
import socket
from collections.abc import Callable
from typing import Any

import pytest

from tests.plugins.ping.conftest import (
    LOOPBACK,
    TARGET,
    FakeClock,
    FakeSocket,
    LogRecorder,
    columns,
    exact,
    fire_timers_early,
    opener_for,
    outputs,
    ping_context,
    ping_params,
    reply,
    resolve_to,
    row_map,
    rows,
)
from wavecore.core.table import Table
from wavecore.plugins import ping as ping_module
from wavecore.plugins._ping_core import EchoSocket, run
from wavecore.plugins.ping import PingPlugin

HOST = "target.internal"
UNRESOLVED = f"Cannot resolve host '{HOST}'"
TIMED_OUT = "Ping did not finish within 2 seconds"
START_LINE = f"PING {HOST} ({TARGET}) 56(84) bytes of data."
STATS_HEADER = f"--- {HOST} ping statistics ---"
SUMMARY_COLUMNS = [
    ("sent", "integer"),
    ("received", "integer"),
    ("loss_percent", "float"),
    ("rtt_min_ms", "float"),
    ("rtt_avg_ms", "float"),
    ("rtt_max_ms", "float"),
    ("rtt_mdev_ms", "float"),
]
REPLY_COLUMNS = [
    ("seq", "integer"),
    ("source", "string"),
    ("bytes", "integer"),
    ("ttl", "integer"),
    ("time_ms", "float"),
    ("status", "string"),
]

Setup = Callable[[pytest.MonkeyPatch, FakeClock], tuple[dict[str, Any], FakeSocket]]


def envelope(spec: list[tuple[str, str]], row: list[Any]) -> dict[str, Any]:
    return {
        "__wave_type": "table",
        "columns": [{"name": column, "type": kind} for column, kind in spec],
        "rows": [row],
    }


def unresolved(
    monkeypatch: pytest.MonkeyPatch, clock: FakeClock
) -> tuple[dict[str, Any], FakeSocket]:
    """A Host the resolver refuses, so the failure lands before the socket is opened."""
    resolve_to(monkeypatch, error=socket.gaierror(-2, "Name or service not known"))
    return ping_params(count=1), FakeSocket(clock=clock)


def past_the_bound(
    monkeypatch: pytest.MonkeyPatch, clock: FakeClock
) -> tuple[dict[str, Any], FakeSocket]:
    """One request answered and one still unanswered when Timeout runs out."""
    resolve_to(monkeypatch, TARGET)
    return ping_params(count=2, interval=1, timeout=2), FakeSocket([reply(1)], clock=clock)


FAILURES = [
    pytest.param(unresolved, UNRESOLVED, "Unresolved", id="unresolved"),
    pytest.param(past_the_bound, TIMED_OUT, "Timeout", id="timeout"),
]


class TestOnError:
    """Fail the block raises the message; Record and continue keeps what was measured."""

    @pytest.mark.parametrize(
        "on_error",
        [
            pytest.param({}, id="absent"),
            pytest.param({"on_error": None}, id="none"),
            pytest.param({"on_error": "fail"}, id="fail"),
        ],
    )
    @pytest.mark.parametrize(("setup", "message", "reason"), FAILURES)
    async def test_the_message_is_the_block_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        setup: Setup,
        message: str,
        reason: str,
        on_error: dict[str, Any],
    ) -> None:
        params, sock = setup(monkeypatch, clock)

        with pytest.raises(ValueError, match=exact(message)):
            await run({**params, **on_error}, log, opener=opener_for(sock), clock=clock)

        assert log.at("WARN") == []

    @pytest.mark.parametrize(("setup", "message", "reason"), FAILURES)
    async def test_a_recorded_failure_carries_the_reason_and_the_measurement(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        setup: Setup,
        message: str,
        reason: str,
    ) -> None:
        params, sock = setup(monkeypatch, clock)

        out = outputs(
            await run({**params, "on_error": "record"}, log, opener=opener_for(sock), clock=clock)
        )

        assert (out["success"], out["error"], out["reason"]) == (False, message, reason)
        assert out["__block_warning"] is True
        assert columns(out["summary"]) == SUMMARY_COLUMNS
        assert columns(out["replies"]) == REPLY_COLUMNS
        assert log.at("WARN") == [f"Ping failed ({reason}): {message}"]


class TestResolution:
    """A Host that does not resolve, and a resolver that never answers (REQ-3.4.1.9)."""

    @pytest.mark.parametrize(
        "fault",
        [
            pytest.param({"error": socket.gaierror(-2, "Name or service not known")}, id="refused"),
            pytest.param({}, id="no-address"),
        ],
    )
    async def test_a_host_that_does_not_resolve_fails_before_the_socket_opens(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        fault: dict[str, Any],
    ) -> None:
        resolve_to(monkeypatch, **fault)
        sock = FakeSocket([reply(1)], clock=clock)
        params = ping_params(count=1, on_error="record")

        out = outputs(await run(params, log, opener=opener_for(sock), clock=clock))

        assert (out["success"], out["error"], out["reason"]) == (False, UNRESOLVED, "Unresolved")
        assert (sock.family, sock.connected, sock.sent) == (None, None, [])

    async def test_a_resolver_that_hangs_past_timeout_fails_the_same_way(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, hang=True)
        sock = FakeSocket([reply(1)], clock=clock)
        params = ping_params(count=1, timeout=0.05)

        # The outer bound keeps a core that ignores Timeout from hanging the suite.
        with pytest.raises(ValueError, match=exact(UNRESOLVED)):
            await asyncio.wait_for(
                run(params, log, opener=opener_for(sock), clock=clock), timeout=5
            )

        assert (sock.family, sock.sent) == (None, [])


class TestWholeBlockTimeout:
    """Timeout is the hard bound on the block, and what was measured still reports (PING-6)."""

    async def test_an_unanswered_request_at_the_bound_fails_with_what_was_measured(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        params, sock = past_the_bound(monkeypatch, clock)

        out = outputs(
            await run({**params, "on_error": "record"}, log, opener=opener_for(sock), clock=clock)
        )

        assert (out["error"], out["reason"]) == (TIMED_OUT, "Timeout")
        answered = row_map(out["replies"], 0)
        assert answered["time_ms"] > 0
        assert {name: value for name, value in answered.items() if name != "time_ms"} == {
            "seq": 1,
            "source": TARGET,
            "bytes": 64,
            "ttl": 57,
            "status": "answered",
        }
        assert row_map(out["replies"], 1) == {
            "seq": 2,
            "source": "",
            "bytes": 0,
            "ttl": 0,
            "time_ms": 0.0,
            "status": "timed out",
        }
        summary = row_map(out["summary"])
        assert (summary["sent"], summary["received"], summary["loss_percent"]) == (2, 1, 50.0)
        assert summary["rtt_mdev_ms"] == 0.0

    async def test_a_request_the_bound_left_unsent_has_no_row(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1)], clock=clock)
        params = ping_params(count=4, interval=1, timeout=2, on_error="record")

        out = outputs(await run(params, log, opener=opener_for(sock), clock=clock))

        assert (out["error"], out["reason"]) == (TIMED_OUT, "Timeout")
        sent = len(sock.sent)
        assert 1 <= sent < 4
        listed = rows(out["replies"])
        assert [row[0] for row in listed] == list(range(1, sent + 1))
        assert [row[5] for row in listed] == ["answered"] + ["timed out"] * (sent - 1)
        summary = row_map(out["summary"])
        assert (summary["sent"], summary["received"]) == (sent, 1)

    async def test_a_loop_timer_that_fires_early_still_ends_the_block_at_the_bound(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, peer: socket.socket
    ) -> None:
        resolve_to(monkeypatch, LOOPBACK)
        fire_timers_early(monkeypatch)
        raw = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        echo = EchoSocket(raw)
        monkeypatch.setattr(echo, "connect", lambda _address: raw.connect(peer.getsockname()))
        params = ping_params(count=4, interval=0.02, timeout=0.04, on_error="record")

        out = outputs(await run(params, log, opener=lambda _family: echo))

        assert (out["error"], out["reason"]) == (
            "Ping did not finish within 0.04 seconds",
            "Timeout",
        )
        assert 1 <= len(rows(out["replies"])) < 4

    @pytest.mark.parametrize(
        ("on_error", "raises"),
        [
            pytest.param({}, True, id="fail"),
            pytest.param({"on_error": "record"}, False, id="record"),
        ],
    )
    async def test_the_socket_is_closed_even_when_the_run_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        on_error: dict[str, Any],
        raises: bool,
    ) -> None:
        params, sock = past_the_bound(monkeypatch, clock)
        call = run({**params, **on_error}, log, opener=opener_for(sock), clock=clock)

        if raises:
            with pytest.raises(ValueError, match=exact(TIMED_OUT)):
                await call
        else:
            await call

        assert sock.closed is True


class TestARefusedSend:
    """Only a packet the path refuses is a block failure; another refusal is not disguised."""

    @pytest.mark.parametrize(
        "on_error",
        [pytest.param({}, id="fail"), pytest.param({"on_error": "record"}, id="record")],
    )
    async def test_the_operating_system_error_reaches_the_caller_unchanged(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        clock: FakeClock,
        on_error: dict[str, Any],
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        refusal = OSError(errno.ENETUNREACH, "Network is unreachable")
        sock = FakeSocket([reply(1)], clock=clock, send_error=refusal)
        params = {**ping_params(count=1), **on_error}

        with pytest.raises(OSError) as raised:
            await run(params, log, opener=opener_for(sock), clock=clock)

        assert raised.value is refusal
        assert (sock.closed, log.at("WARN")) == (True, [])
        assert STATS_HEADER in log.at("INFO")


class TestAReplyAtTheBound:
    """A reply that lands exactly on Timeout still counts, and the block passes (PING-6)."""

    async def test_the_run_passes_with_the_reply_it_measured(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder, clock: FakeClock
    ) -> None:
        resolve_to(monkeypatch, TARGET)
        sock = FakeSocket([reply(1, after=0.5)], clock=clock)
        params = ping_params(count=1, timeout=0.5)

        out = outputs(await run(params, log, opener=opener_for(sock), clock=clock))

        assert (out["success"], out["error"]) == (True, "")
        assert row_map(out["replies"]) == {
            "seq": 1,
            "source": TARGET,
            "bytes": 64,
            "ttl": 57,
            "time_ms": 500.0,
            "status": "answered",
        }
        assert sock.waits == pytest.approx([0.5])


class TestExecuteWiring:
    """execute() runs the core with the block's logger and binds its outputs (REQ-3.3.4.4)."""

    async def test_the_core_outputs_are_materialized_and_the_logger_is_passed_through(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        seen: list[dict[str, Any]] = []
        summary = envelope(SUMMARY_COLUMNS, [1, 1, 0.0, 10.0, 10.0, 10.0, 0.0])
        replies = envelope(REPLY_COLUMNS, [1, TARGET, 64, 57, 10.0, "answered"])

        async def fake_run(
            params: dict[str, Any], write: Callable[[str, str], None], **options: Any
        ) -> dict[str, Any]:
            seen.append(params)
            write("INFO", START_LINE)
            return {
                "__wave_type": "result",
                "outputs": {
                    "summary": summary,
                    "replies": replies,
                    "success": True,
                    "error": "",
                    "reason": "",
                },
                "secrets": [],
            }

        monkeypatch.setattr(ping_module._ping_core, "run", fake_run)
        params = ping_params(count=1)

        out = await PingPlugin().execute(ping_context(params, log))

        assert seen == [params]
        assert isinstance(out["summary"], Table) and isinstance(out["replies"], Table)
        assert out["summary"].col_names() == [name for name, _ in SUMMARY_COLUMNS]
        assert out["replies"].col_types() == [kind for _, kind in REPLY_COLUMNS]
        assert out["replies"].row_count() == 1
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert log.at("INFO") == [START_LINE]
