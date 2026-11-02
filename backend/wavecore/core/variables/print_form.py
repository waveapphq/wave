"""WAVE's print form: how WAVE writes a value in its own printing (REQ-3.1.3.23).

Null prints as ``null``, a boolean as ``true`` / ``false``, a number in plain digits, a string
as it is, and a list, map or table as compact JSON text with ``null`` inside.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from wavecore.core.number_rule import plain_number_text
from wavecore.core.variables.decimal_value import decimal_to_str

if TYPE_CHECKING:
    from wavecore.core.table import Table


def value_text(value: Any) -> str:
    """One value as WAVE prints it."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if _is_finite_float(value):
        return plain_number_text(value)
    table_type = _table_type()
    if isinstance(value, list | dict | table_type):
        return _encode(value, table_type, str, printing=True)
    return str(value)


def encode_typed_json(value: Any) -> str:
    """JSON text that keeps a Decimal exact, which the standard encoder refuses to write."""
    return _encode(value, _table_type(), None, printing=False)


def _is_finite_float(value: Any) -> bool:
    return isinstance(value, float) and math.isfinite(value)


def _table_type() -> type[Table]:
    # core/table.py prints its cells through this module, so Table is imported at call time.
    from wavecore.core.table import Table

    return Table


def _table_form(table: Table, printing: bool) -> dict[str, Any]:
    stored = table.to_dict()
    if not printing:
        return stored
    # The print form writes each cell as the value it is: a number cell, never its stored text.
    return {"columns": stored["columns"], "rows": [row.to_list() for row in table]}


def _encode(
    value: Any, table_type: type[Table], fallback: Callable[[Any], str] | None, *, printing: bool
) -> str:
    if isinstance(value, table_type):
        value = _table_form(value, printing)
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(
                f"{_encode(str(key), table_type, fallback, printing=printing)}:"
                f"{_encode(item, table_type, fallback, printing=printing)}"
                for key, item in value.items()
            )
            + "}"
        )
    if isinstance(value, list):
        return (
            "["
            + ",".join(_encode(item, table_type, fallback, printing=printing) for item in value)
            + "]"
        )
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if _is_finite_float(value):
        return plain_number_text(value)
    # Printing never fails: a nested value JSON cannot write prints as its str() text.
    return json.dumps(value, ensure_ascii=False, default=fallback)
