"""Shared SQL block test furniture: the fake dialect seam, a log recorder and param builders."""

import re
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from tests.connectivity.sql.fakes import FakeConnection, sqlite_file

__all__ = ["sqlite_file"]

PASSWORD = "s3cr3t-pass"
# Every row default the block declares, by wire name.
BLOCK_DEFAULTS: dict[str, Any] = {
    "operation": "run_sql",
    "database_type": "postgresql",
    "script_type": "source",
    "parameters": {},
    "stop_on_error": True,
    "arguments": {},
    "out_arguments": [],
    "mode": "add",
    "commit_each_batch": False,
    "timeout": 300,
    "verify_ssl": True,
    "connect_timeout": 30,
    "max_rows": 10000,
    "driver_options": {},
    "batch_size": 1000,
    "on_error": "fail",
}
_CONSTANTS = ("NAME", "DEFAULT_PORT", "SQLGLOT", "TLS_DEFAULT", "placeholder")


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


def sql_params(**overrides: Any) -> dict[str, Any]:
    """A PostgreSQL Run SQL block on db:5432 as wave, which `overrides` reshape."""
    base = {"host": "db", "database": "wave", "username": "wave", "password": PASSWORD}
    return {**base, "sql": "SELECT 1", **overrides}


def sqlite_params(path: Path, **overrides: Any) -> dict[str, Any]:
    """A SQLite Run SQL block on the file at `path`, which `overrides` reshape."""
    return {"database_type": "sqlite", "file": str(path), "sql": "SELECT 1", **overrides}


def sql_context(params: dict[str, Any], logger: Any = None, **optional: Any) -> dict[str, Any]:
    """execute()'s context plus only the optional keys given (ssh_session_registry, ...)."""
    logger = MagicMock() if logger is None else logger
    return {"parameters": params, "variables": {}, "logger": logger, **optional}


def fake_dialect(database_type: str, connection: FakeConnection, **faults: Any) -> Any:
    """The real dialect's constants over a scripted connection (faults: connect_error=)."""
    from wavecore.connectivity.sql import dialects

    real = dialects.dialect(database_type)
    fake = SimpleNamespace(**{name: getattr(real, name) for name in _CONSTANTS})
    fake.connects = []
    fake.cancels = []
    fake.executes = []

    def connect(rows: dict[str, Any], connect_timeout: int) -> FakeConnection:
        fake.connects.append((dict(rows), connect_timeout))
        if faults.get("connect_error") is not None:
            raise faults["connect_error"]
        return connection

    def cancel(handle: Any) -> None:
        fake.cancels.append(handle)
        connection.cancel()

    def execute(cursor: Any, statement: str, binds: Any) -> None:
        fake.executes.append((statement, binds))
        cursor.execute(statement, binds)

    fake.connect = connect
    fake.cancel = cancel
    fake.execute = execute
    fake.autocommit = lambda conn, on: conn.autocommit_calls.append(on)
    fake.server_version = lambda conn: conn.version
    fake.implicit_results = lambda cursor: cursor.getimplicitresults()
    return fake


@pytest.fixture
def use_fake(monkeypatch: pytest.MonkeyPatch) -> Callable[..., Any]:
    """Install a fake dialect for one database type in the registry the core reads."""
    from wavecore.connectivity.sql import dialects

    def install(database_type: str, connection: FakeConnection, **faults: Any) -> Any:
        fake = fake_dialect(database_type, connection, **faults)
        monkeypatch.setitem(dialects.DIALECTS, database_type, fake)
        return fake

    return install


class FakeTimer:
    """Stands in for the core's DEADLINE timer; the test fires it."""

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
    """Swap the core's deadline timer for FakeTimer; FakeTimer.made lists the timers armed."""
    from wavecore.plugins import _held_run

    FakeTimer.made = []
    monkeypatch.setattr(_held_run, "DEADLINE", FakeTimer)
    return FakeTimer


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
