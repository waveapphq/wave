"""The output core and table envelopes the Block cores share (REQ-3.4.1.5, REQ-3.4.1.6).

The success/error/reason output core with its on_error dispatch, the Summary table
envelope the write and probe cores return, and the value-typed table the SQL and
OpenSearch cores build from rows. Standard library only: the remote bundle carries
this module beside every core that imports it.
"""

import json
from collections.abc import Callable
from datetime import date
from datetime import time as clock_time
from decimal import Decimal
from typing import Any


def block_success(outputs: dict[str, Any]) -> dict[str, Any]:
    """Append the output core for a block that succeeded."""
    return {**outputs, "success": True, "error": "", "reason": ""}


def _recorded_failure_line(action: str, message: str, reason: str | None) -> str:
    """The WARN line a recorded failure writes to the console."""
    detail = f" ({reason})" if reason else ""
    return f"{action} failed{detail}: {message}"


def block_failure(
    params: dict[str, Any],
    empty_outputs: dict[str, Any],
    message: str,
    reason: str | None,
    log: Callable[[str, str], None],
    *,
    action: str,
) -> dict[str, Any]:
    """Raise under on_error=fail; under on_error=record return the empties with the failed core."""
    if params.get("on_error", "fail") != "record":
        raise ValueError(message)
    log("WARN", _recorded_failure_line(action, message, reason))
    # __block_warning asks the engine for the amber block status; it is stripped
    # before output bindings run, so it never reaches a variable.
    return {
        **empty_outputs,
        "success": False,
        "error": message,
        "reason": reason or "",
        "__block_warning": True,
    }


def summary_table(columns: list[tuple[str, str]], rows: list[list[Any]]) -> dict[str, Any]:
    """The Summary table envelope every write verb returns; cells and types ride verbatim."""
    return {
        "__wave_type": "table",
        "columns": [{"name": name, "type": col_type} for name, col_type in columns],
        "rows": [list(cells) for cells in rows],
    }


def value_column_type(cells: list[Any]) -> str:
    """The column type the values share (SQL-9)."""
    values = [cell for cell in cells if cell is not None]
    if not values:
        return "string"
    if all(isinstance(value, bool) for value in values):
        return "boolean"
    numbers = [
        value
        for value in values
        if isinstance(value, int | float | Decimal) and not isinstance(value, bool)
    ]
    if len(numbers) < len(values):
        return "string"
    return "integer" if all(isinstance(value, int) for value in numbers) else "float"


def rendered_cell(value: Any) -> str:
    """A cell as text: exact decimals, ISO times, hex bytes, JSON documents."""
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, date | clock_time):
        return value.isoformat()
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value).hex()
    if isinstance(value, dict | list):
        return json.dumps(value, default=str)
    return str(value)


def typed_cell(value: Any, kind: str) -> Any:
    if value is None or (kind != "string" and not isinstance(value, Decimal)):
        return value
    return rendered_cell(value)


def typed_table(columns: list[str], rows: list[list[Any]]) -> dict[str, Any]:
    """Rows as a typed table envelope, each column typed by its values."""
    kinds = [value_column_type([row[index] for row in rows]) for index in range(len(columns))]
    cells = [
        [typed_cell(value, kind) for value, kind in zip(row, kinds, strict=True)] for row in rows
    ]
    return summary_table(list(zip(columns, kinds, strict=True)), cells)
