"""
Shared table realization.

A table reaches a consumer either as a live ``Table`` produced by a plugin or as
the stored form of a variable declared in the Variable Manager (a list of row
maps, or a ``{columns, rows}`` dict). Every consumer that accepts a table asks
here instead of hand-rolling an isinstance check.
"""

from typing import Any

from wavecore.core.table import Table


def as_table(value: Any) -> Table | None:
    """Realize a table value, or None when the value is not a table at all."""
    if isinstance(value, Table):
        return value
    if isinstance(value, list):
        if all(isinstance(row, dict) for row in value):
            return Table.from_list(value)
        return None
    if isinstance(value, dict) and "columns" in value:
        return Table.from_dict(value)
    return None


def is_table_value(value: Any) -> bool:
    """True when the value is a table in either runtime form."""
    return as_table(value) is not None


def realizes_as_table(value: Any) -> bool:
    """True when the value realizes as a table; a malformed stored form is not one (REQ-3.5.5.4)."""
    try:
        return as_table(value) is not None
    except (KeyError, TypeError, ValueError):
        return False
