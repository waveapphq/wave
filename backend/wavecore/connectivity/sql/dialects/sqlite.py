"""SQLite on WAVE's bundled SQLite build (REQ-3.4.1.19, REQ-3.4.1.6, REQ-5.1.4)."""

import math
from typing import TYPE_CHECKING, Any

from wavecore.connectivity.sql._errors import VALIDATION, SqlFailure
from wavecore.connectivity.sql._sqlite_cursor import Connection
from wavecore.connectivity.sql.dialects._common import execute as execute

if TYPE_CHECKING:
    from wavecore.connectivity.sql.dialects import Handle

NAME = "SQLite"
DEFAULT_PORT = None
SQLGLOT = "sqlite"
TLS_DEFAULT = False
_OPTIONS = ("timeout", "cached_statements")
# The largest wait in milliseconds, and statement cache size, the build's calls take.
_LARGEST = 2**31 - 1


def placeholder(_index: int) -> str:
    return "?"


def _whole(value: Any) -> bool:
    """A whole number of zero or more; a boolean is not one."""
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _seconds(value: Any) -> bool:
    """A whole number or a finite decimal, of zero or more."""
    return _whole(value) or (isinstance(value, float) and math.isfinite(value) and value >= 0)


def _check_options(options: dict[str, Any]) -> None:
    """Refuse any other option name, then a value the two options do not take."""
    for name in options:
        if name not in _OPTIONS:
            raise SqlFailure(
                f"SQLite Driver option '{name}' is not supported: "
                "SQLite takes timeout and cached_statements",
                VALIDATION,
            )
    if "timeout" in options and not _seconds(options["timeout"]):
        raise SqlFailure(
            "SQLite Driver option timeout must be a number of seconds, "
            f"got '{options['timeout']}'",
            VALIDATION,
        )
    if "cached_statements" in options and not _whole(options["cached_statements"]):
        raise SqlFailure(
            "SQLite Driver option cached_statements must be a whole number, "
            f"got '{options['cached_statements']}'",
            VALIDATION,
        )


def connect(rows: dict[str, Any], connect_timeout: int) -> Any:
    """Read-write (created when absent), or read-only, which never creates."""
    options = rows["driver_options"]
    # Checked before the open, so a refused option leaves no file behind.
    _check_options(options)
    import apsw

    flags = (
        apsw.SQLITE_OPEN_READONLY
        if rows["file_read_only"]
        else apsw.SQLITE_OPEN_READWRITE | apsw.SQLITE_OPEN_CREATE
    )
    keywords: dict[str, Any] = {"flags": flags}
    if "cached_statements" in options:
        keywords["statementcachesize"] = min(options["cached_statements"], _LARGEST)
    raw = apsw.Connection(rows["file"], **keywords)
    seconds = min(options.get("timeout", connect_timeout), _LARGEST / 1000)
    raw.set_busy_timeout(round(seconds * 1000))
    return Connection(raw)


def autocommit(connection: Any, on: bool) -> None:
    connection.autocommit = on


def server_version(_connection: Any) -> str:
    import apsw

    return apsw.sqlite_lib_version()


def cancel(handle: "Handle") -> None:
    if handle.connection is not None:
        handle.connection.interrupt()
