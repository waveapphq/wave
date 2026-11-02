"""PostgreSQL through pg8000 (REQ-3.4.1.6, REQ-5.1.4)."""

import socket
import struct
from typing import TYPE_CHECKING, Any

from wavecore.connectivity.sql.dialects._common import PROGRAM_NAME, tls_context

if TYPE_CHECKING:
    from wavecore.connectivity.sql.dialects import Handle

NAME = "PostgreSQL"
DEFAULT_PORT = 5432
SQLGLOT = "postgres"
TLS_DEFAULT = False
_CANCEL_REQUEST_CODE = 80877102


def placeholder(index: int) -> str:
    return f"${index}"


def connect(rows: dict[str, Any], connect_timeout: int) -> Any:
    import pg8000.dbapi

    arguments = {
        "user": rows["username"],
        "host": rows["host"],
        "database": rows["database"],
        "port": rows["port"],
        "password": rows["password"],
        # False, not None: pg8000 sends no SSLRequest, so TLS off is a plain connection.
        "ssl_context": tls_context(rows, rows["server_name"]) or False,
        "timeout": connect_timeout,
        "application_name": PROGRAM_NAME,
    }
    connection = pg8000.dbapi.connect(**{**arguments, **rows["driver_options"]})
    # pg8000 applies its timeout to every read; the block's Timeout bounds statements instead.
    connection._usock.settimeout(None)
    return connection


def autocommit(connection: Any, on: bool) -> None:
    connection.autocommit = on


def server_version(connection: Any) -> str:
    return str(connection.parameter_statuses["server_version"])


def execute(cursor: Any, statement: str, binds: Any) -> None:
    """`$n` binds go through pg8000's unnamed statement; its paramstyle scan refuses a bare `%`."""
    if binds is None:
        cursor.execute(statement)
        return
    connection = cursor._c
    if not connection._in_transaction and not connection.autocommit:
        connection.execute_simple("begin transaction")
    cursor._context = connection.execute_unnamed(statement, vals=binds)
    rows = cursor._context.rows
    cursor._row_iter = None if rows is None else iter(rows)


def cancel(handle: "Handle") -> None:
    """PostgreSQL's CancelRequest on a new socket, carrying the session's backend key."""
    if handle.connection is None:
        return
    key = handle.connection._backend_key_data
    address = (handle.rows["host"], handle.rows["port"])
    with socket.create_connection(address, timeout=handle.connect_timeout) as channel:
        channel.sendall(struct.pack("!ii", 8 + len(key), _CANCEL_REQUEST_CODE) + key)
