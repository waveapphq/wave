"""The one number rule every numeric field shares (REQ-3.1.3.14)."""

from __future__ import annotations

import math
import re
from decimal import Decimal
from typing import Any, Literal, cast

from wavecore.core.variables.decimal_value import WaveDecimal, decimal_to_str

NumberType = Literal["integer", "float"]
NumberProblem = Literal["type", "integer-cap", "float-cap"]

MAX_INTEGER_DIGITS = 19
MAX_FLOAT_SIG_DIGITS = 28

_MAX_SAFE_INTEGER = 2**53 - 1
# re.ASCII: only the digits 0-9, never another script's digits.
_PLAIN_INTEGER = re.compile(r"-?\d+", re.ASCII)
_PLAIN_FLOAT = re.compile(r"-?\d+(?:\.\d+)?", re.ASCII)


def is_integer_value(value: Any) -> bool:
    """A run value that is an integer: a Python ``int``, never a ``bool``."""
    return isinstance(value, int) and not isinstance(value, bool)


def is_number_value(value: Any) -> bool:
    """A run value that is a number: a finite int, float or Decimal, never a bool."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return math.isfinite(value)
    return isinstance(value, Decimal) and value.is_finite()


def not_finite_name(value: float | Decimal) -> str:
    """NaN, Infinity or -Infinity: how a message names a float that is not a number."""
    if math.isnan(value) if isinstance(value, float) else value.is_nan():
        return "NaN"
    return "-Infinity" if value < 0 else "Infinity"


def _as_decimal(value: int | float | Decimal) -> Decimal:
    """A number as an exact ``Decimal``; a float through ``repr`` so its typed literal is kept."""
    if isinstance(value, float):
        return Decimal(repr(value))
    return Decimal(value)


def plain_number_text(value: int | float | Decimal) -> str:
    """A number in plain digits, never exponent notation."""
    if isinstance(value, int):
        return str(value)
    return decimal_to_str(_as_decimal(value))


def integer_digit_count(value: int | str) -> int:
    """The digits of an integer, the sign aside."""
    text = str(abs(value)) if isinstance(value, int) else value.removeprefix("-")
    return len(text)


def float_significant_digits(value: str | int | float | Decimal) -> int:
    """Significant digits of a float: sign, dot and leading zeros dropped; trailing zeros count."""
    if isinstance(value, str):
        return len(value.removeprefix("-").replace(".", "", 1).lstrip("0"))
    number = _as_decimal(value)
    if number.is_zero():
        return 0
    parts = number.as_tuple()
    return len(parts.digits) + max(cast(int, parts.exponent), 0)


def _text_problem(text: str, declared: NumberType) -> NumberProblem | None:
    if declared == "integer":
        if _PLAIN_INTEGER.fullmatch(text) is None:
            return "type"
        return "integer-cap" if integer_digit_count(text) > MAX_INTEGER_DIGITS else None
    if _PLAIN_FLOAT.fullmatch(text) is None:
        return "type"
    return "float-cap" if float_significant_digits(text) > MAX_FLOAT_SIG_DIGITS else None


def number_problem(value: Any, declared: NumberType) -> NumberProblem | None:
    """Why a typed value is not a valid ``declared`` number, or None when it is."""
    if isinstance(value, str):
        return _text_problem(value, declared)
    if declared == "integer":
        if not is_integer_value(value):
            return "type"
        return "integer-cap" if abs(value) >= 10**MAX_INTEGER_DIGITS else None
    if not is_number_value(value):
        return "type"
    if isinstance(value, int):
        return "float-cap" if abs(value) >= 10**MAX_FLOAT_SIG_DIGITS else None
    return "float-cap" if float_significant_digits(value) > MAX_FLOAT_SIG_DIGITS else None


def _refusal(value: Any, declared: NumberType, problem: NumberProblem) -> str:
    if problem == "integer-cap":
        return (
            f"An integer allows at most {MAX_INTEGER_DIGITS} digits, "
            f"got {integer_digit_count(value)}"
        )
    if problem == "float-cap":
        return (
            f"A float allows at most {MAX_FLOAT_SIG_DIGITS} significant digits, "
            f"got {float_significant_digits(value)}"
        )
    return f"Not a valid {declared}: {value!r}"


def parse_number(value: Any, declared: NumberType) -> int | WaveDecimal:
    """A typed value as its exact number: an ``int`` or a ``WaveDecimal``; ValueError otherwise."""
    problem = number_problem(value, declared)
    if problem is not None:
        raise ValueError(_refusal(value, declared, problem))
    if declared == "integer":
        return int(value)
    return WaveDecimal(value if isinstance(value, str) else _as_decimal(value))


def wire_number(value: int | float | Decimal) -> int | float | str:
    """A JSON number only when every receiver reads back each digit in plain notation, else text."""
    if isinstance(value, int):
        return value if abs(value) <= _MAX_SAFE_INTEGER else str(value)
    text = plain_number_text(value)
    if _PLAIN_INTEGER.fullmatch(text) is not None:
        whole = int(text)
        return whole if abs(whole) <= _MAX_SAFE_INTEGER and str(whole) == text else text
    if _PLAIN_FLOAT.fullmatch(text) is None:
        return text
    candidate = float(text)
    # A whole float reads back without its ".0" in JavaScript, so it travels as text.
    return candidate if repr(candidate) == text and not candidate.is_integer() else text
