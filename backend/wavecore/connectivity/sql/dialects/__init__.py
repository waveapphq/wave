"""The five SQL database types, one module each (REQ-3.4.1.6, REQ-5.1.4)."""

from dataclasses import dataclass
from types import ModuleType
from typing import Any

from wavecore.connectivity.sql.dialects import mssql, mysql, oracle, postgres, sqlite

DIALECTS: dict[str, ModuleType] = {
    "postgresql": postgres,
    "mysql": mysql,
    "oracle": oracle,
    "mssql": mssql,
    "sqlite": sqlite,
}


def dialect(database_type: str) -> ModuleType:
    """The module for a database type, read from DIALECTS at call time."""
    try:
        return DIALECTS[database_type]
    except KeyError:
        raise ValueError(f"Unknown database type '{database_type}'") from None


@dataclass
class Handle:
    """The live connection of one run, for the out-of-band cancel."""

    database_type: str
    rows: dict[str, Any]
    connect_timeout: int
    connection: Any = None
