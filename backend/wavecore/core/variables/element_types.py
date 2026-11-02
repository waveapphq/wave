"""Declared element types of array and map values and the one realizer (REQ-3.1.3.19)."""

import json
from collections.abc import Collection, Iterable, Mapping
from decimal import Decimal
from typing import Any, cast

from wavecore.core.number_rule import NumberType, number_problem, parse_number
from wavecore.core.table_values import as_table
from wavecore.core.variables.decimal_value import WaveDecimal, to_wave_decimal

ELEMENT_TYPES: tuple[str, ...] = ("string", "integer", "float", "boolean", "array", "map")
_STRUCTURED = ("array", "map")
_LISTED_TYPES = ", ".join(sorted(ELEMENT_TYPES))


def _structure(text: str) -> Any:
    """Verbatim JSON list / map text as its structure (exact floats), else the text."""
    try:
        return json.loads(text.strip(), parse_float=WaveDecimal)
    except ValueError:
        return text


def _shaped_element(value: Any) -> Any:
    """An element with no declared type: typed by its stored shape."""
    if isinstance(value, str) and value.strip()[:1] in ("[", "{"):
        return _structure(value)
    return value


def _declared_element(value: Any, declared: Any) -> Any:
    """One array item / map value realized as its declared element type; null fits any."""
    if declared not in ELEMENT_TYPES:
        return _shaped_element(value)
    if value is None:
        return None
    if declared in _STRUCTURED:
        return _structure(value) if isinstance(value, str) else value
    return realize_declared_value(value, declared)


def realize_declared_value(value: Any, declared_type: str, element_types: Any = None) -> Any:
    """A stored value as its declared type: exact ints / Decimals, tables, typed elements."""
    if declared_type == "table":
        realized = as_table(value)
        return value if realized is None else realized
    if declared_type in ("array", "map"):
        return _realize_elements(value, declared_type, element_types)
    return _realize_scalar(value, declared_type)


def realize_computed_value(value: Any, declared_type: str) -> Any:
    """An Expression's result as its declared type; array and map items are run-time values."""
    if declared_type in _STRUCTURED:
        return value
    return realize_declared_value(value, declared_type)


def _realize_scalar(value: Any, declared_type: str) -> Any:
    if declared_type in ("integer", "float") and isinstance(value, str):
        # Text is a number only when it follows the one number rule (REQ-3.1.3.14).
        number_type = cast(NumberType, declared_type)
        return value if number_problem(value, number_type) else parse_number(value, number_type)
    if declared_type == "float":
        # A whole number declared float is a float too (REQ-3.1.3.14).
        whole = isinstance(value, int) and not isinstance(value, bool)
        return WaveDecimal(value) if whole else to_wave_decimal(value)
    return value


def _realize_elements(value: Any, declared_type: str, element_types: Any) -> Any:
    """An array's items or a map's values, each as its declared element type."""
    if declared_type == "array" and isinstance(value, list):
        item_types: list[Any] = element_types if isinstance(element_types, list) else []
        return [
            _declared_element(item, item_types[index] if index < len(item_types) else None)
            for index, item in enumerate(value)
        ]
    if declared_type == "map" and isinstance(value, dict):
        key_types: dict[str, Any] = element_types if isinstance(element_types, dict) else {}
        return {key: _declared_element(item, key_types.get(key)) for key, item in value.items()}
    return value


def element_types_problem(declared_type: str | None, element_types: Any) -> str | None:
    """Why a stored element-type sidecar does not fit its value's declared type, or None."""
    if element_types is None:
        return None
    if declared_type == "map":
        if not isinstance(element_types, dict):
            return "the element types of a map must map each key to a type"
        return _unknown_element_type(element_types.items(), "key '{}'")
    if declared_type == "array":
        if not isinstance(element_types, list):
            return "the element types of an array must list one type per item"
        return _unknown_element_type(enumerate(element_types), "item {}")
    return "element types apply only to an array or a map"


def _unknown_element_type(entries: Iterable[tuple[Any, Any]], label: str) -> str | None:
    """The first entry whose type is not an element type, described; None when all are."""
    for where, element_type in entries:
        if element_type not in ELEMENT_TYPES:
            return (
                f"unknown element type '{element_type}' for {label.format(where)} "
                f"(must be one of: {_LISTED_TYPES})"
            )
    return None


def _runtime_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float | Decimal):
        return "float"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "map"
    return "string"


def runtime_element_types(value: Any) -> list[str] | dict[str, str] | None:
    """The real types of a run-time array's items or map's values; None for anything else."""
    if isinstance(value, list):
        return [_runtime_type(item) for item in value]
    if isinstance(value, dict):
        return {key: _runtime_type(item) for key, item in value.items()}
    return None


def to_platform_numbers(value: Any) -> Any:
    """Exact Decimals as platform floats at any depth, for a plugin call (REQ-3.1.3.14)."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [to_platform_numbers(item) for item in value]
    if isinstance(value, dict):
        return {key: to_platform_numbers(item) for key, item in value.items()}
    return value


def realize_typed_settings(
    values: dict[str, Any],
    element_types: Mapping[str, Any] | None,
    expression_fields: Collection[str],
) -> dict[str, Any]:
    """Block settings, declared entries realized exactly; expression entries keep their source."""
    if not element_types:
        return values
    realized = dict(values)
    for name, types in element_types.items():
        setting = values.get(name)
        if name in expression_fields:
            continue
        if isinstance(setting, dict) and isinstance(types, dict):
            realized[name] = {
                key: _typed_entry(item, types.get(key), f"{name}.{key}" in expression_fields)
                for key, item in setting.items()
            }
        elif isinstance(setting, list) and isinstance(types, list):
            realized[name] = [
                _typed_entry(
                    item,
                    types[index] if index < len(types) else None,
                    f"{name}.{index}" in expression_fields,
                )
                for index, item in enumerate(setting)
            ]
    return realized


def _typed_entry(item: Any, declared: Any, is_expression: bool) -> Any:
    if is_expression or declared not in ELEMENT_TYPES:
        return item
    return _declared_element(item, declared)
