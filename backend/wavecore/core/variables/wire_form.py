"""The form a run value takes on its way to the browser or a stored run (REQ-3.1.3.14)."""

from decimal import Decimal
from typing import Any

from wavecore.core.number_rule import wire_number
from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import decimal_to_str


def wire_scalar(value: Any) -> Any:
    """An exact Decimal as plain text, an int or float by the one wire rule, anything else as is."""
    if isinstance(value, bool):
        return value
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if isinstance(value, int | float):
        return wire_number(value)
    return value


_BRANCHES = (list, tuple, dict, Table)

_Pending = list[tuple[Any, Any, Any]]


def wire_values(value: Any) -> Any:
    """``wire_scalar`` at any depth of a list, map or table; a tuple travels as a list and a
    table as its column-schema shape, named typed columns plus rows (REQ-3.5.5.1)."""
    if not isinstance(value, _BRANCHES):
        return wire_scalar(value)
    # A stack, not recursion, so a value nested at any depth converts.
    root: list[Any] = [None]
    stack: _Pending = [(value, root, 0)]
    while stack:
        item, target, slot = stack.pop()
        if isinstance(item, Table):
            item = item.to_dict()
        target[slot] = _wire_map(item, stack) if isinstance(item, dict) else _wire_list(item, stack)
    return root[0]


def _wire_map(item: dict[Any, Any], stack: _Pending) -> dict[Any, Any]:
    """A map's scalars converted; each list, map or table in it waits on the stack."""
    converted: dict[Any, Any] = {}
    for key, child in item.items():
        if isinstance(child, _BRANCHES):
            converted[key] = None
            stack.append((child, converted, key))
        else:
            converted[key] = wire_scalar(child)
    return converted


def _wire_list(item: Any, stack: _Pending) -> list[Any]:
    """A list's or tuple's scalars converted; each list, map or table in it waits on the stack."""
    converted: list[Any] = []
    for index, child in enumerate(item):
        if isinstance(child, _BRANCHES):
            converted.append(None)
            stack.append((child, converted, index))
        else:
            converted.append(wire_scalar(child))
    return converted
