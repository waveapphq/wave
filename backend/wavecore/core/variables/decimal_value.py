"""Exact-precision Decimal value type and helpers (REQ-3.1.3.14).

The single source of "parse/render a float exactly" consumed at every float
boundary: ``WaveDecimal`` (arithmetic coerces lower-precision operands so mixed
math stays exact), ``to_wave_decimal`` (exact parse/normalize), ``decimal_to_str``
(plain fixed-point rendering, never ``E`` notation), ``decimal_context`` (the
28-significant-digit evaluation context).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Context, Decimal, InvalidOperation, localcontext
from typing import Any

PRECISION = 28


def _coerce_operand(other: Any) -> Decimal:
    """Coerce an arithmetic operand to a plain ``Decimal``.

    ``float`` goes through ``str`` so the typed literal is recovered exactly;
    ``int`` and ``Decimal`` are exact. A ``Decimal`` operand is rebuilt as a
    plain ``Decimal`` so the operation never re-dispatches through a subclass.
    """
    if isinstance(other, Decimal):
        return Decimal(other)
    if isinstance(other, float):
        return Decimal(str(other))
    return Decimal(other)


class WaveDecimal(Decimal):
    """A ``Decimal`` whose arithmetic coerces lower-precision operands so mixed
    expressions stay exact, returns ``WaveDecimal``, and respects the active
    context. Operations run on a plain ``Decimal`` copy of ``self`` to avoid
    subclass operator re-dispatch."""

    def __add__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) + _coerce_operand(other))

    def __radd__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) + Decimal(self))

    def __sub__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) - _coerce_operand(other))

    def __rsub__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) - Decimal(self))

    def __mul__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) * _coerce_operand(other))

    def __rmul__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) * Decimal(self))

    def __truediv__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) / _coerce_operand(other))

    def __rtruediv__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) / Decimal(self))

    def __floordiv__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) // _coerce_operand(other))

    def __rfloordiv__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) // Decimal(self))

    def __mod__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(Decimal(self) % _coerce_operand(other))

    def __rmod__(self, other: Any) -> WaveDecimal:
        return WaveDecimal(_coerce_operand(other) % Decimal(self))

    def __pow__(self, other: Any, modulo: Any = None) -> WaveDecimal:
        return WaveDecimal(pow(Decimal(self), _coerce_operand(other), modulo))

    def __rpow__(self, other: Any, modulo: Any = None) -> WaveDecimal:
        return WaveDecimal(pow(_coerce_operand(other), Decimal(self), modulo))

    def __divmod__(self, other: Any) -> tuple[WaveDecimal, WaveDecimal]:
        quotient, remainder = divmod(Decimal(self), _coerce_operand(other))
        return WaveDecimal(quotient), WaveDecimal(remainder)

    def __neg__(self) -> WaveDecimal:
        return WaveDecimal(-Decimal(self))

    def __pos__(self) -> WaveDecimal:
        return WaveDecimal(+Decimal(self))

    def __abs__(self) -> WaveDecimal:
        return WaveDecimal(abs(Decimal(self)))

    def __str__(self) -> str:
        return decimal_to_str(self)

    def __format__(self, spec: str, *args: Any) -> str:
        # An f-string writes plain digits, as str() does; a format spec still formats.
        if spec == "":
            return decimal_to_str(self)
        return Decimal(self).__format__(spec, *args)


def to_wave_decimal(value: Any) -> Any:
    """Normalize a float-boundary value to exact precision.

    ``str`` / ``float`` become a ``WaveDecimal`` (a non-numeric string is left
    untouched for the caller to validate); ``int`` / ``Decimal`` / everything
    else pass through unchanged.
    """
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return WaveDecimal(str(value))
    if isinstance(value, str):
        try:
            return WaveDecimal(value)
        except InvalidOperation:
            return value
    return value


def decimal_to_str(value: Decimal) -> str:
    """Render a ``Decimal`` in plain fixed-point notation, never ``E`` notation."""
    return Decimal.__format__(value, "f")


@contextmanager
def decimal_context() -> Iterator[Context]:
    """A local decimal context with the uniform 28-significant-digit precision."""
    with localcontext() as ctx:
        ctx.prec = PRECISION
        yield ctx
