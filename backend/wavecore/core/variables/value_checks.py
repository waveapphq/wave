"""The one number rule applied to a typed value: a scalar, its elements or its table cells.

REQ-3.1.3.14, REQ-3.1.3.19.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Any, cast

from wavecore.core.number_rule import (
    MAX_FLOAT_SIG_DIGITS,
    MAX_INTEGER_DIGITS,
    NumberProblem,
    NumberType,
    float_significant_digits,
    integer_digit_count,
    number_problem,
)
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.variables.decimal_value import WaveDecimal
from wavecore.core.variables.wire_form import wire_scalar

NUMBER_TYPES: tuple[NumberType, ...] = ("integer", "float")


@dataclass(frozen=True)
class ValueProblem:
    """How one value breaks the number rule, and where inside a list, map or table it sits."""

    declared: NumberType
    problem: NumberProblem
    digits: int
    where: str = ""

    @property
    def reason(self) -> str:
        if self.problem == "integer-cap":
            return f"allows at most {MAX_INTEGER_DIGITS} digits, got {self.digits}"
        if self.problem == "float-cap":
            return f"allows at most {MAX_FLOAT_SIG_DIGITS} significant digits, got {self.digits}"
        return f"is not a valid {self.declared}"

    @property
    def fix(self) -> str:
        if self.problem == "integer-cap":
            return f"Provide at most {MAX_INTEGER_DIGITS} digits"
        if self.problem == "float-cap":
            return f"Provide at most {MAX_FLOAT_SIG_DIGITS} significant digits"
        return f"Provide {'an' if self.declared == 'integer' else 'a'} {self.declared} value"

    def describe(self, subject: str) -> str:
        """``subject`` (``Value for variable 'x'``) followed by where and why."""
        at = f" at {self.where}" if self.where else ""
        return f"{subject}{at} {self.reason}"


def number_value_problem(value: Any, declared: NumberType, where: str = "") -> ValueProblem | None:
    """How ``value`` breaks the rule for ``declared``, or None when it is that number."""
    problem = number_problem(value, declared)
    if problem is None:
        return None
    digits = 0
    if problem == "integer-cap":
        digits = integer_digit_count(value)
    elif problem == "float-cap":
        digits = float_significant_digits(value)
    return ValueProblem(declared, problem, digits, where)


def _first(problems: Iterable[ValueProblem | None]) -> ValueProblem | None:
    return next((problem for problem in problems if problem is not None), None)


def _element(value: Any, declared: Any, where: str) -> ValueProblem | None:
    if value is None or declared not in NUMBER_TYPES:
        return None
    return number_value_problem(value, declared, where)


def _typed_columns(value: dict[str, Any]) -> tuple[list[tuple[int, str, Any]], list[Any]] | None:
    """A table's typed columns (place, name, type) and its rows; None for another shape."""
    columns = value.get("columns")
    rows = value.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return None
    typed = [
        (index, str(column.get("name")), column.get("type"))
        for index, column in enumerate(columns)
        if isinstance(column, dict)
    ]
    return typed, rows


def _cells(value: dict[str, Any]) -> Iterator[ValueProblem | None]:
    table = _typed_columns(value)
    if table is None:
        return
    typed, rows = table
    for number, row in enumerate(rows, start=1):
        if not isinstance(row, list):
            continue
        for index, name, declared in typed:
            if index < len(row):
                yield _element(row[index], declared, f"row {number}, column '{name}'")


def _holds_no_literal(value: Any) -> bool:
    """Null, a sealed secret and the mask placeholder hold no literal to read."""
    return value is None or is_secret_envelope(value) or value == MASK_PLACEHOLDER


def declared_value_problem(
    value: Any, declared_type: str, element_types: Any = None
) -> ValueProblem | None:
    """The first way a typed literal breaks the number rule; null and a sealed secret hold none."""
    if _holds_no_literal(value):
        return None
    if declared_type in NUMBER_TYPES:
        return number_value_problem(value, cast(NumberType, declared_type))
    if declared_type == "array" and isinstance(value, list) and isinstance(element_types, list):
        return _first(
            _element(item, item_type, f"item {number}")
            for number, (item, item_type) in enumerate(
                zip(value, element_types, strict=False), start=1
            )
        )
    if declared_type == "map" and isinstance(value, dict) and isinstance(element_types, dict):
        return _first(
            _element(item, element_types.get(key), f"key '{key}'") for key, item in value.items()
        )
    if declared_type == "table" and isinstance(value, dict):
        return _first(_cells(value))
    return None


# How a number in a declared place is written: by its value and the types the place declares.
NumberForm = Callable[[Any, Iterable[Any]], Any]


def _valid_for(value: Any, declared: Iterable[Any]) -> bool:
    return any(
        item in NUMBER_TYPES and number_problem(value, cast(NumberType, item)) is None
        for item in declared
    )


def stored_number(value: Any, declared: Iterable[Any]) -> Any:
    """A number valid for one of the declared number types in its wire form, else as is."""
    if isinstance(value, str):
        return value
    return wire_scalar(value) if _valid_for(value, declared) else value


def text_as_number(value: Any, declared: Iterable[Any]) -> Any:
    """Digit text valid for a declared number type as the exact number it is, else as is."""
    types = list(declared)
    if not isinstance(value, str) or "string" in types or not _valid_for(value, types):
        return value
    return int(value) if number_problem(value, "integer") is None else WaveDecimal(value)


def _cells_written(value: dict[str, Any], form: NumberForm) -> dict[str, Any]:
    table = _typed_columns(value)
    if table is None:
        return value
    typed, rows = table
    types = {index: declared for index, _name, declared in typed}
    return {
        **value,
        "rows": [
            (
                [form(cell, (types.get(index),)) for index, cell in enumerate(row)]
                if isinstance(row, list)
                else row
            )
            for row in rows
        ],
    }


def typed_value_numbers(
    value: Any, declared_type: str, element_types: Any, form: NumberForm
) -> Any:
    """A typed literal with each number ``declared_value_problem`` reads written by ``form``."""
    if _holds_no_literal(value):
        return value
    if declared_type in NUMBER_TYPES:
        return form(value, (declared_type,))
    if declared_type == "array" and isinstance(value, list) and isinstance(element_types, list):
        return [form(item, element_types[index : index + 1]) for index, item in enumerate(value)]
    if declared_type == "map" and isinstance(value, dict) and isinstance(element_types, dict):
        return {key: form(item, (element_types.get(key),)) for key, item in value.items()}
    if declared_type == "table" and isinstance(value, dict):
        return _cells_written(value, form)
    return value
