"""What the dialects share: the plain DB-API statement call and the TLS row toggle."""

import ssl
from typing import Any

from wavecore.connectivity.tls_context import build_context

# The program name every database that accepts one receives (REQ-3.4.1.19).
PROGRAM_NAME = "WAVE"


def execute(cursor: Any, statement: str, binds: Any) -> None:
    """Run one statement, alone without binds and beside them otherwise."""
    if binds is None:
        cursor.execute(statement)
    else:
        cursor.execute(statement, binds)


def tls_context(rows: dict[str, Any], server_name: str) -> ssl.SSLContext | None:
    """A client context under `server_name` when the TLS row is on, else None."""
    return build_context(rows, server_name) if rows.get("tls") else None
