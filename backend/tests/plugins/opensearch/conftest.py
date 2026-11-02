"""Shared OpenSearch block test furniture: defaults, a log recorder, builders, clocks, fakes."""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.connectivity.opensearch.fakes import os_http, os_https
from tests.plugins.http.conftest import RecordingHTTPServer, tls_material

__all__ = ["os_http", "os_https", "tls_material"]

# Every row default the block declares, by wire name.
BLOCK_DEFAULTS: dict[str, Any] = {
    "from": "now-15m",
    "to": "now",
    "query_language": "dql",
    "query": "",
    "mode": "search",
    "fields": [{"value": "@timestamp"}],
    "max_results": 10000,
    "group_by_time": "1m",
    "group_by_field": "",
    "top_values": 10,
    "stats": [{"value": {"stat": "count"}}],
    "timeout": 300,
    "sort_by": "",
    "order": "desc",
    "verify_ssl": True,
    "time_field": "@timestamp",
    "connect_timeout": 30,
    "on_error": "fail",
}
URL = "https://opensearch.internal:9200"
INDEX = "filebeat-*"
# 2026-09-25T10:42:05.123Z: now-15m is 10:27:05.123Z, the window of the pinned log lines.
FIXED_NOW = datetime(2026, 9, 25, 10, 42, 5, 123000, tzinfo=UTC)
# The field list of the DQL translation cases, for field_caps_answer.
FIELD_TYPES: dict[str, str] = {
    "@timestamp": "date",
    "log.level": "keyword",
    "message": "text",
    "latency_ms": "long",
    "host.name": "keyword",
    "service.name": "keyword",
    "service.version": "keyword",
    "trace.id": "keyword",
    "items": "nested",
    "items.name": "keyword",
}
ACTIONS = {"search": "Search", "aggregate": "Aggregate"}
_SECONDS = re.compile(r", \d+\.\d{2} s$")


class LogRecorder(list[tuple[str, str]]):
    """The core's log(level, message), and a logger whose debug/info/warn/error record the same."""

    def __call__(self, level: str, message: str) -> None:
        self.append((level, message))

    def __getattr__(self, name: str) -> Callable[[str], None]:
        if name not in ("debug", "info", "warn", "error"):
            raise AttributeError(name)
        return lambda message: self(name.upper(), message)

    def at(self, level: str) -> list[str]:
        return [message for recorded, message in self if recorded == level]


@pytest.fixture
def log() -> LogRecorder:
    return LogRecorder()


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


def os_params(**overrides: Any) -> dict[str, Any]:
    """A Search block on filebeat-* at opensearch.internal:9200, which `overrides` reshape."""
    return {"url": URL, "index": INDEX, **overrides}


def host_of(server: RecordingHTTPServer) -> str:
    """The scripted server's 127.0.0.1:<port>."""
    return server.base_url.split("://", 1)[1]


def served(server: RecordingHTTPServer, **overrides: Any) -> dict[str, Any]:
    """os_params aimed at the scripted server; `{host}` in a given url becomes its host."""
    url = str(overrides.pop("url", server.base_url)).replace("{host}", host_of(server))
    return os_params(url=url, **overrides)


def os_context(params: dict[str, Any], logger: Any = None, **optional: Any) -> dict[str, Any]:
    """execute()'s context plus only the optional keys given (ssh_session_registry, ...)."""
    logger = MagicMock() if logger is None else logger
    return {"parameters": params, "variables": {}, "logger": logger, **optional}


class FakeTimer:
    """Stands in for the _held_run DEADLINE timer; the test fires it."""

    made: list["FakeTimer"] = []

    def __init__(self, seconds: float, callback: Callable[[], None]) -> None:
        self.seconds, self.callback = seconds, callback
        self.daemon = False
        self.started = self.canceled = False
        FakeTimer.made.append(self)

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.canceled = True

    def fire(self) -> None:
        self.callback()


@pytest.fixture
def deadline(monkeypatch: pytest.MonkeyPatch) -> type[FakeTimer]:
    """Swap _held_run.DEADLINE for FakeTimer; FakeTimer.made lists the timers armed."""
    from wavecore.plugins import _held_run

    FakeTimer.made = []
    monkeypatch.setattr(_held_run, "DEADLINE", FakeTimer)
    return FakeTimer


class FixedClock:
    """Stands in for _opensearch_core.NOW; `now` may be moved, `reads` counts the calls."""

    def __init__(self, now: datetime) -> None:
        self.now = now
        self.reads = 0

    def __call__(self) -> datetime:
        self.reads += 1
        return self.now


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> FixedClock:
    """Patch _opensearch_core.NOW to answer FIXED_NOW."""
    from wavecore.plugins import _opensearch_core

    fixed = FixedClock(FIXED_NOW)
    monkeypatch.setattr(_opensearch_core, "NOW", fixed)
    return fixed


def timed(lines: list[str]) -> list[str]:
    """Lines with each measured `0.42 s` duration replaced by `N s`."""
    return [_SECONDS.sub(", N s", line) for line in lines]


def outputs(envelope: dict[str, Any]) -> dict[str, Any]:
    """The outputs of a result envelope, checked for the envelope's own shape."""
    assert envelope["__wave_type"] == "result" and envelope["secrets"] == []
    result: dict[str, Any] = envelope["outputs"]
    return result


def columns(table: dict[str, Any]) -> list[tuple[str, str]]:
    assert table["__wave_type"] == "table"
    return [(column["name"], column["type"]) for column in table["columns"]]


def rows(table: dict[str, Any]) -> list[list[Any]]:
    assert table["__wave_type"] == "table"
    return [list(row) for row in table["rows"]]


def no_table_printed(log: LogRecorder, table: dict[str, Any]) -> None:
    """No line at any level is the Results column names, a Results row or an `... and N more`."""
    header = " | ".join(column["name"] for column in table["columns"])
    printed_rows = {
        " | ".join("" if cell is None else str(cell) for cell in row) for row in table["rows"]
    }
    shown = [
        line
        for _level, line in log
        if line == header or line in printed_rows or line.startswith("... and ")
    ]
    assert shown == []


def recorded(message: str, reason: str) -> dict[str, Any]:
    """Every output a recorded failure leaves: the empty outputs and the failed core."""
    return {
        "results": {"__wave_type": "table", "columns": [], "rows": []},
        "total_results": 0,
        "success": False,
        "error": message,
        "reason": reason,
        "__block_warning": True,
    }


def failed_line(mode: str, message: str, reason: str) -> str:
    """The WARN line a recorded failure writes, named by the block's mode."""
    return f"{ACTIONS[mode]} failed ({reason}): {message}"
