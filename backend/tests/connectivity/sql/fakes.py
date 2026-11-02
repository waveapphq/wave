"""A scripted DB-API connection for the SQL block tests: answers, errors, rowcounts, a record."""

import threading
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# How long a hanging statement waits for its cancel before the test harness gives up.
HANG_BOUND_S = 5.0


class FakeDriverError(Exception):
    """A driver error whose args are the (code, text) pair PyMySQL and python-tds carry."""


@dataclass
class Result:
    """One scripted answer: a result set (columns), a rowcount, an error, or a hang."""

    columns: list[str] | None = None
    rows: list[tuple[Any, ...]] = field(default_factory=list)
    rowcount: int = -1
    error: BaseException | None = None
    hang: bool = False
    more: list["Result"] = field(default_factory=list)
    # The cursors an Oracle call hands back with DBMS_SQL.RETURN_RESULT.
    implicit: list["Result"] = field(default_factory=list)


class FakeCursor:
    """The DB-API cursor subset the SQL core reads; nextset walks a result's `more` answers."""

    def __init__(self, connection: "FakeConnection") -> None:
        self.connection = connection
        self.description: list[tuple[Any, ...]] | None = None
        self.rowcount = -1
        self._sets: deque[Result] = deque()
        self._rows: deque[tuple[Any, ...]] = deque()
        self._implicit: list[Result] = []
        self.closed = False

    def _answer(self, result: Result) -> None:
        if result.hang:
            self.connection.hanging.set()
            self.connection.gate.wait(HANG_BOUND_S)
        if result.error is not None:
            raise result.error
        self._sets = deque(result.more)
        self._implicit = list(result.implicit)
        self._show(result)

    def _show(self, result: Result) -> None:
        self.description = (
            None
            if result.columns is None
            else [(name, None, None, None, None, None, None) for name in result.columns]
        )
        self.rowcount = result.rowcount
        self._rows = deque(result.rows)

    def execute(self, statement: str, binds: Any = None) -> None:
        self.connection.executed.append(("execute", statement, binds))
        self._answer(self.connection.next_result())

    def executemany(self, statement: str, rows: Any) -> None:
        self.connection.executed.append(("executemany", statement, [tuple(r) for r in rows]))
        self._answer(self.connection.next_result())

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows.popleft() if self._rows else None

    def fetchmany(self, size: int = 1) -> list[tuple[Any, ...]]:
        return [self._rows.popleft() for _ in range(min(size, len(self._rows)))]

    def fetchall(self) -> list[tuple[Any, ...]]:
        rows, self._rows = list(self._rows), deque()
        return rows

    def nextset(self) -> bool | None:
        if not self._sets:
            return None
        self._show(self._sets.popleft())
        return True

    def getimplicitresults(self) -> list["FakeCursor"]:
        """A cursor showing each implicit result of the last execute."""
        cursors = []
        for result in self._implicit:
            cursor = FakeCursor(self.connection)
            cursor._show(result)
            cursors.append(cursor)
        return cursors

    def close(self) -> None:
        self.closed = True


class FakeConnection:
    """Answers each execute with the next scripted Result (default: no rows) and records it."""

    def __init__(self, script: list[Result] | None = None, *, version: str = "16.4") -> None:
        self.script: deque[Result] = deque(script or [])
        self.version = version
        self.executed: list[tuple[str, str, Any]] = []
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.canceled = 0
        self.autocommit_calls: list[bool] = []
        # Set when a hanging statement starts waiting; `gate` releases it.
        self.hanging = threading.Event()
        self.gate = threading.Event()

    def next_result(self) -> Result:
        return self.script.popleft() if self.script else Result()

    def statements(self) -> list[str]:
        """The statement text of every execute and executemany, in order."""
        return [statement for _kind, statement, _binds in self.executed]

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True

    def cancel(self) -> None:
        """What a dialect's cancel drives: count it and release a hanging statement."""
        self.canceled += 1
        self.gate.set()


def sqlite_file(path: Path, *statements: str) -> Path:
    """A SQLite database file at `path` holding what `statements` build."""
    import apsw

    connection = apsw.Connection(str(path))
    try:
        for statement in statements:
            connection.execute(statement)
    finally:
        connection.close()
    return path
