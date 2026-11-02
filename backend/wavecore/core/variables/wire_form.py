"""The form a run value takes on its way to the browser (REQ-3.1.3.14)."""

from decimal import Decimal
from typing import Any

from wavecore.core.number_rule import wire_number
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


def wire_values(value: Any) -> Any:
    """``wire_scalar`` at any depth of a list or map; a tuple travels as a list."""
    if isinstance(value, list | tuple):
        return [wire_values(item) for item in value]
    if isinstance(value, dict):
        return {key: wire_values(item) for key, item in value.items()}
    return wire_scalar(value)
