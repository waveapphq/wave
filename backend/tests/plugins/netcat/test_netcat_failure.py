"""Netcat under Fail the block and Record and continue, and the result it returns (REQ-3.4.1.9)."""

import re
import socket
from collections.abc import Awaitable, Callable
from typing import Any

import pytest

from tests.plugins.netcat.conftest import (
    Listener,
    LogRecorder,
    free_port,
    netcat_context,
    netcat_params,
    resolve_to,
)
from wavecore.core.table import Table
from wavecore.plugins._netcat_core import NetcatFailure, run
from wavecore.plugins.netcat import NetcatPlugin

Listen = Callable[..., Awaitable[Listener]]
Entry = Callable[[dict[str, Any], LogRecorder], Awaitable[dict[str, Any]]]

CHECK_COLUMNS = [
    {"name": "port", "type": "integer"},
    {"name": "protocol", "type": "string"},
    {"name": "state", "type": "string"},
    {"name": "reason", "type": "string"},
    {"name": "time_ms", "type": "integer"},
]
TALK_COLUMNS = [*CHECK_COLUMNS, {"name": "reply", "type": "string"}]
CORE_KEYS = {"success", "results", "error", "reason"}
TALK = {"mode": "talk", "send": "text", "text": "hello", "close_after_send": True}
PAYLOAD_MISSING = "Payload file not found: x.bin"
PAYLOAD_FAILURE = {
    "mode": "talk",
    "send": "file",
    "file": "x.bin",
    "payload_error": PAYLOAD_MISSING,
}


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    return envelope["outputs"]


async def via_core(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    return outputs(await run(params, log))


async def via_execute(params: dict[str, Any], log: LogRecorder) -> dict[str, Any]:
    result: dict[str, Any] = await NetcatPlugin().execute(netcat_context(params, log))
    return result


ENTRIES = [pytest.param(via_core, id="core"), pytest.param(via_execute, id="execute")]


def rows_of(results: Any) -> list[list[Any]]:
    """Result rows from a table envelope (core) or a materialized Table (execute)."""
    if isinstance(results, Table):
        return [row.to_list() for row in results]
    return [list(row) for row in results["rows"]]


def measured(results: Any) -> list[list[Any]]:
    """The rows without time_ms, once every time_ms is checked to be an integer."""
    rows = rows_of(results)
    assert all(isinstance(row[4], int) and not isinstance(row[4], bool) for row in rows)
    return [row[:4] + row[5:] for row in rows]


def closed_message(port: int) -> str:
    return f"Port {port} on 127.0.0.1 is closed: Connection refused"


def no_route(ports: list[int], log: Any) -> dict[int, Any]:
    raise NetcatFailure("boom", "Tunnel")


def recording(calls: list[tuple[str, int]]) -> Callable[[str, int], Awaitable[Any]]:
    """An opener that records every dial and refuses it."""

    async def opener(host: str, port: int) -> Any:
        calls.append((host, port))
        raise ConnectionRefusedError(111, f"Connect call failed ('{host}', {port})")

    return opener


class TestResultShape:
    """The result envelope, the Results table and the output keys (NETCAT-7)."""

    async def test_run_returns_the_result_envelope(self, listen: Listen, log: LogRecorder) -> None:
        echo = await listen("tcp-echo")
        envelope = await run(netcat_params(echo.port), log)
        assert set(envelope) == {"__wave_type", "outputs", "secrets"}
        results = outputs(envelope)["results"]
        assert set(results) == {"__wave_type", "columns", "rows"}
        assert (results["__wave_type"], results["columns"]) == ("table", CHECK_COLUMNS)
        assert measured(results) == [[echo.port, "tcp", "open", ""]]

    @pytest.mark.parametrize(
        ("overrides", "columns"),
        [pytest.param({}, CHECK_COLUMNS, id="check"), pytest.param(TALK, TALK_COLUMNS, id="talk")],
    )
    async def test_execute_returns_results_as_a_table(
        self,
        listen: Listen,
        log: LogRecorder,
        overrides: dict[str, Any],
        columns: list[dict[str, str]],
    ) -> None:
        echo = await listen("tcp-echo")
        results = (await via_execute(netcat_params(echo.port, **overrides), log))["results"]
        assert isinstance(results, Table)
        assert results.col_names() == [column["name"] for column in columns]
        assert results.col_types() == [column["type"] for column in columns]
        assert results.row_count() == 1

    @pytest.mark.parametrize(
        ("overrides", "keys"),
        [
            pytest.param({}, CORE_KEYS, id="check-single"),
            pytest.param(TALK, CORE_KEYS | {"reply"}, id="talk-single"),
            pytest.param({"ports": "range"}, CORE_KEYS, id="check-range"),
            pytest.param({"ports": "range", **TALK}, CORE_KEYS, id="talk-range"),
        ],
    )
    async def test_reply_is_an_output_only_for_single_talk(
        self, listen: Listen, log: LogRecorder, overrides: dict[str, Any], keys: set[str]
    ) -> None:
        echo = await listen("tcp-echo")
        params = netcat_params(echo.port, port_range=str(echo.port), **overrides)
        assert set(outputs(await run(params, log))) == keys


class TestFailTheBlock:
    """On error other than record raises the message as the block error."""

    @pytest.mark.parametrize("entry", ENTRIES)
    @pytest.mark.parametrize(
        "on_error",
        [
            pytest.param({}, id="absent"),
            pytest.param({"on_error": None}, id="none"),
            pytest.param({"on_error": "fail"}, id="fail"),
        ],
    )
    async def test_raises_the_message(
        self, log: LogRecorder, entry: Entry, on_error: dict[str, Any]
    ) -> None:
        port = free_port()
        with pytest.raises(ValueError, match=exact(closed_message(port))):
            await entry(netcat_params(port, **on_error), log)
        assert [line for line in log if line[0] == "WARN"] == []

    @pytest.mark.parametrize("entry", ENTRIES)
    async def test_the_message_names_the_trimmed_host(self, log: LogRecorder, entry: Entry) -> None:
        port = free_port()
        with pytest.raises(ValueError, match=exact(closed_message(port))):
            await entry(netcat_params(port, host="  127.0.0.1 "), log)


class TestRecordAndContinue:
    """Record and continue returns the failure and what was measured (NETCAT-7)."""

    @pytest.mark.parametrize("entry", ENTRIES)
    async def test_a_recorded_failure_carries_message_reason_and_warning(
        self, log: LogRecorder, entry: Entry
    ) -> None:
        port = free_port()
        message = closed_message(port)
        out = await entry(netcat_params(port, on_error="record"), log)
        assert set(out) == CORE_KEYS | {"__block_warning"}
        assert (out["success"], out["error"], out["reason"]) == (False, message, "Closed")
        assert out["__block_warning"] is True
        assert measured(out["results"]) == [[port, "tcp", "closed", "Connection refused"]]
        assert log == [
            ("INFO", f"Checking 127.0.0.1 port {port} over TCP"),
            ("INFO", f"Port {port}/tcp closed: Connection refused"),
            ("WARN", f"Netcat failed (Closed): {message}"),
        ]

    async def test_a_single_talk_failure_carries_an_empty_reply(self, log: LogRecorder) -> None:
        port = free_port()
        out = await via_core(netcat_params(port, on_error="record", **TALK), log)
        assert (out["success"], out["reason"], out["reply"]) == (False, "Closed", "")
        assert out["results"]["columns"] == TALK_COLUMNS
        assert measured(out["results"]) == [[port, "tcp", "closed", "Connection refused", ""]]

    async def test_a_range_all_failure_keeps_the_replies_of_the_ports_that_answered(
        self, listen: Listen, log: LogRecorder
    ) -> None:
        echo, closed = await listen("tcp-echo"), free_port()
        params = netcat_params(
            ports="range",
            port_range=f"{echo.port}, {closed}",
            pass_when="all",
            on_error="record",
            **TALK,
        )
        out = await via_core(params, log)
        message = f"1 of 2 ports on 127.0.0.1 did not succeed: {closed} closed"
        assert (out["success"], out["error"], out["reason"]) == (False, message, "NotAllSucceeded")
        assert "reply" not in out
        assert measured(out["results"]) == [
            [echo.port, "tcp", "open", "", "hello"],
            [closed, "tcp", "closed", "Connection refused", ""],
        ]


EARLY_SHAPES = [
    pytest.param({}, CHECK_COLUMNS, {}, "Checking {host} port 7 over TCP", id="check-single"),
    pytest.param(
        TALK, TALK_COLUMNS, {"reply": ""}, "Talking to {host} port 7 over TCP", id="talk-single"
    ),
    pytest.param(
        {"ports": "range", "port_range": "7, 8", **TALK},
        TALK_COLUMNS,
        {},
        "Talking to 2 ports on {host} over TCP",
        id="talk-range",
    ),
]


class TestFailureBeforeAnyDial:
    """A failure before any port is dialed leaves Results and Reply empty (NETCAT-7)."""

    @pytest.mark.parametrize(("overrides", "columns", "reply", "start"), EARLY_SHAPES)
    async def test_a_pre_dial_refusal_is_recorded_with_empty_results(
        self,
        log: LogRecorder,
        overrides: dict[str, Any],
        columns: list[dict[str, str]],
        reply: dict[str, str],
        start: str,
    ) -> None:
        calls: list[tuple[str, int]] = []
        params = netcat_params(7, on_error="record", **overrides)
        envelope = await run(params, log, opener=recording(calls), pre_dial=no_route)
        assert outputs(envelope) == {
            "results": {"__wave_type": "table", "columns": columns, "rows": []},
            **reply,
            "success": False,
            "error": "boom",
            "reason": "Tunnel",
            "__block_warning": True,
        }
        assert calls == []
        assert log == [
            ("INFO", start.format(host="127.0.0.1")),
            ("WARN", "Netcat failed (Tunnel): boom"),
        ]

    @pytest.mark.parametrize(("overrides", "columns", "reply", "start"), EARLY_SHAPES)
    async def test_an_unresolved_host_is_recorded_with_empty_results(
        self,
        monkeypatch: pytest.MonkeyPatch,
        log: LogRecorder,
        overrides: dict[str, Any],
        columns: list[dict[str, str]],
        reply: dict[str, str],
        start: str,
    ) -> None:
        resolve_to(monkeypatch, error=socket.gaierror(-2, "Name or service not known"))
        calls: list[tuple[str, int]] = []
        params = netcat_params(7, host="db.example", on_error="record", **overrides)
        envelope = await run(params, log, opener=recording(calls))
        message = "Could not resolve host: db.example"
        assert outputs(envelope) == {
            "results": {"__wave_type": "table", "columns": columns, "rows": []},
            **reply,
            "success": False,
            "error": message,
            "reason": "Unresolved",
            "__block_warning": True,
        }
        assert calls == []
        assert log == [
            ("INFO", start.format(host="db.example")),
            ("WARN", f"Netcat failed (Unresolved): {message}"),
        ]

    async def test_the_tunnel_check_comes_before_the_payload(self, log: LogRecorder) -> None:
        """The tunnel check runs after the start line and before the payload is read."""
        params = netcat_params(7, on_error="record", **PAYLOAD_FAILURE)
        out = outputs(await run(params, log, pre_dial=no_route))
        assert (out["error"], out["reason"]) == ("boom", "Tunnel")
        assert log == [
            ("INFO", "Talking to 127.0.0.1 port 7 over TCP"),
            ("WARN", "Netcat failed (Tunnel): boom"),
        ]

    async def test_the_payload_comes_before_resolving_the_host(
        self, monkeypatch: pytest.MonkeyPatch, log: LogRecorder
    ) -> None:
        """A payload failure is reported before the Host is looked up."""
        asked = resolve_to(monkeypatch, error=socket.gaierror(-2, "Name or service not known"))
        params = netcat_params(7, host="db.example", on_error="record", **PAYLOAD_FAILURE)
        out = outputs(await run(params, log))
        assert (out["error"], out["reason"]) == (PAYLOAD_MISSING, "StartFailed")
        assert asked == []
        assert log == [
            ("INFO", "Talking to db.example port 7 over TCP"),
            ("WARN", f"Netcat failed (StartFailed): {PAYLOAD_MISSING}"),
        ]

    async def test_a_pre_dial_refusal_under_fail_raises_its_message(self, log: LogRecorder) -> None:
        calls: list[tuple[str, int]] = []
        with pytest.raises(ValueError, match=exact("boom")):
            await run(netcat_params(7), log, opener=recording(calls), pre_dial=no_route)
        assert calls == []


class TestPassingBlock:
    """A passing block carries empty Error and Reason and no warning."""

    @pytest.mark.parametrize(
        "on_error",
        [
            pytest.param({}, id="absent"),
            pytest.param({"on_error": "fail"}, id="fail"),
            pytest.param({"on_error": "record"}, id="record"),
        ],
    )
    @pytest.mark.parametrize(
        "shape",
        [
            pytest.param(lambda port: netcat_params(port), id="single-open"),
            pytest.param(
                lambda port: netcat_params(ports="range", port_range=f"{port}, {free_port()}"),
                id="range-one-with-a-closed-port",
            ),
        ],
    )
    async def test_error_and_reason_are_empty(
        self,
        listen: Listen,
        log: LogRecorder,
        shape: Callable[[int], dict[str, Any]],
        on_error: dict[str, Any],
    ) -> None:
        echo = await listen("tcp-echo")
        out = await via_core({**shape(echo.port), **on_error}, log)
        assert set(out) == CORE_KEYS
        assert (out["success"], out["error"], out["reason"]) == (True, "", "")
        assert [line for line in log if line[0] == "WARN"] == []
