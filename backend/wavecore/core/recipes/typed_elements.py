"""Recipe form of declared element types: check, store and read back (REQ-3.1.3.19)."""

import json
import math
from decimal import Decimal
from typing import Any

from wavecore.core.number_rule import (
    MAX_FLOAT_SIG_DIGITS,
    MAX_INTEGER_DIGITS,
    NumberProblem,
    NumberType,
    float_significant_digits,
    integer_digit_count,
    number_problem,
)
from wavecore.core.variables.decimal_value import decimal_to_str, to_wave_decimal
from wavecore.core.variables.element_types import ELEMENT_TYPES, element_types_problem

_NUMBER_TYPES: dict[str, NumberType] = {"integer": "integer", "float": "float"}


def native_element_type(item: Any) -> str:
    """The element type a YAML value has."""
    if isinstance(item, bool):
        return "boolean"
    if isinstance(item, int):
        return "integer"
    if isinstance(item, float | Decimal):
        return "float"
    if isinstance(item, list):
        return "array"
    if isinstance(item, dict):
        return "map"
    return "string"


def _json_kind(text: str) -> str | None:
    try:
        parsed = json.loads(text)
    except ValueError:
        return None
    if isinstance(parsed, list):
        return "array"
    return "map" if isinstance(parsed, dict) else None


def stored_element_type(item: Any) -> str:
    """The type a stored element with no declaration reads as (its stored shape)."""
    if isinstance(item, str) and item.strip()[:1] in ("[", "{"):
        return _json_kind(item.strip()) or "string"
    return native_element_type(item)


def number_cap_words(problem: NumberProblem, value: Any) -> str:
    """The cap a number breaks, in words: ``allows at most 19 digits, got 20``."""
    if problem == "integer-cap":
        return f"allows at most {MAX_INTEGER_DIGITS} digits, got {integer_digit_count(value)}"
    return (
        f"allows at most {MAX_FLOAT_SIG_DIGITS} significant digits, "
        f"got {float_significant_digits(value)}"
    )


def _fits(declared: str, item: Any) -> bool:
    if declared in ("array", "map") and isinstance(item, str):
        return _json_kind(item.strip()) == declared
    if declared == "boolean" or isinstance(item, bool):
        return declared == "boolean" and isinstance(item, bool)
    return declared == native_element_type(item)


def _written(item: Any) -> str:
    if isinstance(item, float | Decimal) and not math.isfinite(item):
        return "a non-finite number"
    return native_element_type(item)


def _element_problem(declared: str, item: Any, where: str, numbers: bool) -> str | None:
    """Why a written element does not fit its declared type (a number by the one number rule,
    its exact text included); a null element fits any type (REQ-3.1.3.19)."""
    if item is None:
        return None
    number_type = _NUMBER_TYPES.get(declared)
    if number_type is not None:
        if not numbers:
            return None
        problem = number_problem(item, number_type)
        if problem is None:
            return None
        if problem != "type":
            return f"{where} {number_cap_words(problem, item)}"
    elif _fits(declared, item):
        return None
    return f"{where} expects {declared}, got {_written(item)}"


def element_problems(value: Any, element_types: Any, *, numbers: bool = True) -> list[str]:
    """What is wrong with a recipe map / list and its `element_types` (None: all YAML types);
    ``numbers`` off leaves number elements to the shared field check."""
    kind = "map" if isinstance(value, dict) else "array"
    problem = element_types_problem(kind, element_types)
    if problem is not None:
        return [problem]
    if isinstance(value, dict):
        declared: dict[str, Any] = element_types or {}
        missing = [key for key in declared if key not in value]
        problems = [
            f"element_types names '{key}', which the value does not have" for key in missing
        ]
        types = {key: declared.get(key) or native_element_type(item) for key, item in value.items()}
        found = (
            _element_problem(types[key], item, f"key '{key}'", numbers)
            for key, item in value.items()
        )
        return problems + [problem for problem in found if problem is not None]
    if element_types is not None and len(element_types) != len(value):
        return [f"element_types lists {len(element_types)} types for {len(value)} items"]
    item_types = element_types or [native_element_type(item) for item in value]
    listed = (
        _element_problem(declared_type, item, f"item {index}", numbers)
        for index, (declared_type, item) in enumerate(zip(item_types, value, strict=True))
    )
    return [problem for problem in listed if problem is not None]


def _key_text(key: Any) -> str:
    if isinstance(key, str):
        return key
    if isinstance(key, Decimal):
        return decimal_to_str(key)
    return json.dumps(key) if key is None or isinstance(key, int | float) else str(key)


def _json_text(value: Any) -> str:
    """A YAML structure as JSON text, every number in its exact digits (REQ-3.1.3.14); a key
    JSON cannot write and a value JSON has no form for (a YAML date) as its text."""
    if isinstance(value, dict):
        members = (
            f"{json.dumps(_key_text(key), ensure_ascii=False)}: {_json_text(item)}"
            for key, item in value.items()
        )
        return "{" + ", ".join(members) + "}"
    if isinstance(value, list):
        return "[" + ", ".join(_json_text(item) for item in value) + "]"
    if isinstance(value, Decimal):
        return decimal_to_str(value)
    if value is None or isinstance(value, str | int | float):
        return json.dumps(value, ensure_ascii=False)
    return json.dumps(str(value), ensure_ascii=False)


def _stored_element(item: Any, declared: str) -> Any:
    """One written element in its stored form: numbers as exact text, structures as JSON text."""
    if item is None:
        return None
    if declared in ("array", "map") and not isinstance(item, str):
        return _json_text(item)
    if declared == "float" and isinstance(item, float | Decimal):
        return decimal_to_str(to_wave_decimal(item))
    if declared in ("integer", "float") and isinstance(item, int) and not isinstance(item, bool):
        return str(item)
    return item


def stored_elements(value: Any, element_types: Any) -> tuple[Any, Any]:
    """A recipe map / list and its element types as the stored value and complete sidecar."""
    if isinstance(value, dict):
        declared = element_types if isinstance(element_types, dict) else {}
        types = {key: declared.get(key) or native_element_type(item) for key, item in value.items()}
        return {key: _stored_element(item, types[key]) for key, item in value.items()}, types
    declared_list = element_types if isinstance(element_types, list) else []
    item_types = [
        declared_list[index] if index < len(declared_list) else native_element_type(item)
        for index, item in enumerate(value)
    ]
    return [
        _stored_element(item, item_types[index]) for index, item in enumerate(value)
    ], item_types


def readback_element_types(value: Any, element_types: Any) -> Any:
    """The complete `element_types` a readback writes for a stored map / list."""
    if isinstance(value, dict):
        declared = element_types if isinstance(element_types, dict) else {}
        return {key: _declared_or_stored(declared.get(key), item) for key, item in value.items()}
    declared_list = element_types if isinstance(element_types, list) else []
    return [
        _declared_or_stored(declared_list[index] if index < len(declared_list) else None, item)
        for index, item in enumerate(value)
    ]


def _declared_or_stored(declared: Any, item: Any) -> str:
    return declared if declared in ELEMENT_TYPES else stored_element_type(item)
