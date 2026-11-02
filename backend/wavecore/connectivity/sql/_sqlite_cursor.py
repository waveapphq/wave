"""A DB-API style connection and cursor over WAVE's bundled SQLite (REQ-3.4.1.19)."""

from itertools import islice
from typing import Any

from wavecore.connectivity.sql._errors import VALIDATION, SqlFailure
from wavecore.connectivity.sql._split import CODE, lex

_USE_A_NAME = "write :name and add name to Parameters"
# Any other statement that writes, such as CREATE VIRTUAL TABLE, writes rows of its own making.
_ROW_CHANGING = frozenset({"INSERT", "REPLACE", "UPDATE", "DELETE", "WITH"})


def _changes_rows(statement: str) -> bool:
    """Whether the first word of a statement, past spaces and comments, is one that changes rows."""
    tokens = lex("sqlite", statement)
    first = next((statement[start:end] for kind, start, end in tokens if kind in CODE), "")
    return first.upper() in _ROW_CHANGING


def _marker_failure(exc: Exception, binds: Any) -> SqlFailure | None:
    """The failure of a statement that holds a marker its named binds give no value, else None."""
    import apsw

    if not isinstance(binds, dict):
        return None
    message = None
    if isinstance(exc, KeyError):
        # The build raises only the name; the core binds :name alone, and a number is no name.
        marker = str(exc.args[0])
        numbered = f"Numbered placeholder {marker} has no value: {_USE_A_NAME}"
        named = f"Placeholder {marker} has no value: write :{marker} and add {marker} to Parameters"
        message = numbered if marker.isdigit() else named
    elif isinstance(exc, apsw.BindingsError):
        message = f"A ? placeholder has no value: {_USE_A_NAME}"
    return None if message is None else SqlFailure(message, VALIDATION)


class Connection:
    """The bundled build's connection, with the transaction calls the SQL core makes."""

    def __init__(self, raw: Any) -> None:
        self.raw = raw
        self.autocommit = True

    def cursor(self) -> "Cursor":
        return Cursor(self)

    def commit(self) -> None:
        self._end("COMMIT")

    def rollback(self) -> None:
        self._end("ROLLBACK")

    def close(self) -> None:
        self.raw.close()

    def interrupt(self) -> None:
        self.raw.interrupt()

    def _end(self, statement: str) -> None:
        if self.raw.in_transaction:
            self.raw.execute(statement)


class _Tracer:
    """The build calls this as each statement starts, the only time its columns can be read."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection
        self.description: Any = None
        self.statement = ""

    def __call__(self, cursor: Any, statement: str, _binds: Any) -> bool:
        self.description = cursor.description or None
        self.statement = statement
        raw = self._connection.raw
        # Opened before a write only: a transaction that has read cannot wait for another writer.
        if not (self._connection.autocommit or cursor.is_readonly or raw.in_transaction):
            raw.execute("BEGIN")
        return True


class Cursor:
    """One statement at a time: its column names, its rows and the rows it changed."""

    def __init__(self, connection: Connection) -> None:
        self._connection = connection
        self._raw = connection.raw.cursor()
        # The tracer never refers to this cursor: a cycle would keep unread rows and their lock.
        self._tracer = _Tracer(connection)
        self._raw.exec_trace = self._tracer
        self.rowcount = -1

    @property
    def description(self) -> Any:
        return self._tracer.description

    def execute(self, statement: str, binds: Any = None) -> None:
        self._reset()
        raw = self._connection.raw
        before = raw.total_changes()
        try:
            self._raw.execute(statement, binds)
        except Exception as exc:
            failure = _marker_failure(exc, binds)
            if failure is None:
                raise
            raise failure from None
        # The build keeps the last count through statements that change nothing.
        if raw.total_changes() > before and _changes_rows(self._tracer.statement):
            self.rowcount = raw.changes()

    def executemany(self, statement: str, rows: Any) -> None:
        self._reset()
        self._raw.executemany(statement, rows)

    def fetchmany(self, size: int) -> list[Any]:
        return list(islice(self._raw, size))

    def fetchall(self) -> list[Any]:
        return list(self._raw)

    def _reset(self) -> None:
        self._tracer.description = None
        self._tracer.statement = ""
        self.rowcount = -1
