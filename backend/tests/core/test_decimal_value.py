"""Tests for the exact-precision Decimal value module (REQ-3.1.3.14).

``Decimal`` is the canonical float representation end-to-end. This
module is the single source of "parse/render a float exactly": the
``WaveDecimal`` arithmetic subclass (coerces lower-precision operands so
mixed arithmetic stays exact), ``to_wave_decimal`` (exact parse/normalize),
``decimal_to_str`` (plain fixed-point rendering, never ``E`` notation), and
``decimal_context`` (the 28-significant-digit evaluation context).
"""

from __future__ import annotations

from decimal import Decimal, getcontext

import pytest

from wavecore.core.variables.decimal_value import (
    PRECISION,
    WaveDecimal,
    decimal_context,
    decimal_to_str,
    to_wave_decimal,
)


class TestPrecisionConstant:
    """The uniform 28-significant-digit bound."""

    def test_precision_is_28(self) -> None:
        assert PRECISION == 28


class TestWaveDecimalIsDecimal:
    """``WaveDecimal`` is a ``Decimal`` subclass that preserves exact value."""

    def test_is_decimal_subclass(self) -> None:
        assert issubclass(WaveDecimal, Decimal)

    def test_constructs_exact_from_string(self) -> None:
        value = WaveDecimal("-2123.123213123123699999")
        assert isinstance(value, WaveDecimal)
        assert value == Decimal("-2123.123213123123699999")

    def test_constructs_exact_from_dotless_string(self) -> None:
        value = WaveDecimal("123")
        assert value == Decimal("123")


class TestWaveDecimalAddition:
    """Addition coerces every operand mix and returns ``WaveDecimal``."""

    def test_decimal_plus_decimal(self) -> None:
        result = WaveDecimal("0.1") + WaveDecimal("0.2")
        assert result == Decimal("0.3")
        assert isinstance(result, WaveDecimal)

    def test_decimal_plus_int(self) -> None:
        result = WaveDecimal("1.1") + 1
        assert result == Decimal("2.1")
        assert isinstance(result, WaveDecimal)

    def test_decimal_plus_float_recovers_literal_intent(self) -> None:
        # The whole point: 0.1 + 0.2 in float is 0.30000000000000004.
        result = WaveDecimal("0.1") + 0.2
        assert result == Decimal("0.3")
        assert isinstance(result, WaveDecimal)

    def test_float_plus_decimal_via_radd(self) -> None:
        result = 0.2 + WaveDecimal("0.1")
        assert result == Decimal("0.3")
        assert isinstance(result, WaveDecimal)

    def test_int_plus_decimal_via_radd(self) -> None:
        result = 1 + WaveDecimal("0.1")
        assert result == Decimal("1.1")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalSubtraction:
    """Subtraction coerces operands and returns ``WaveDecimal``."""

    def test_decimal_minus_float(self) -> None:
        result = WaveDecimal("0.3") - 0.1
        assert result == Decimal("0.2")
        assert isinstance(result, WaveDecimal)

    def test_float_minus_decimal_via_rsub(self) -> None:
        result = 2.0 - WaveDecimal("0.5")
        assert result == Decimal("1.5")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalMultiplication:
    """Multiplication coerces operands and returns ``WaveDecimal``."""

    def test_decimal_times_float_is_exact(self) -> None:
        result = WaveDecimal("19.99") * 1.08
        assert result == Decimal("21.5892")
        assert isinstance(result, WaveDecimal)

    def test_float_times_decimal_via_rmul(self) -> None:
        result = 1.08 * WaveDecimal("19.99")
        assert result == Decimal("21.5892")
        assert isinstance(result, WaveDecimal)

    def test_decimal_times_int(self) -> None:
        result = WaveDecimal("0.1") * 10
        assert result == Decimal("1.0")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalDivision:
    """True division, floor division, and modulo coerce and stay exact."""

    def test_true_division_uses_28_digit_context(self) -> None:
        result = WaveDecimal("1") / WaveDecimal("3")
        assert result == Decimal("1") / Decimal("3")
        assert isinstance(result, WaveDecimal)

    def test_true_division_by_float(self) -> None:
        result = WaveDecimal("1") / 4.0
        assert result == Decimal("0.25")
        assert isinstance(result, WaveDecimal)

    def test_float_divided_by_decimal_via_rtruediv(self) -> None:
        result = 1.0 / WaveDecimal("4")
        assert result == Decimal("0.25")
        assert isinstance(result, WaveDecimal)

    def test_floor_division(self) -> None:
        result = WaveDecimal("7") // WaveDecimal("2")
        assert result == Decimal("3")
        assert isinstance(result, WaveDecimal)

    def test_floor_division_by_float(self) -> None:
        result = WaveDecimal("7.5") // 2.0
        assert result == Decimal("3")
        assert isinstance(result, WaveDecimal)

    def test_float_floordiv_decimal_via_rfloordiv(self) -> None:
        result = 7.0 // WaveDecimal("2")
        assert result == Decimal("3")
        assert isinstance(result, WaveDecimal)

    def test_modulo(self) -> None:
        result = WaveDecimal("5") % WaveDecimal("3")
        assert result == Decimal("2")
        assert isinstance(result, WaveDecimal)

    def test_modulo_by_float(self) -> None:
        result = WaveDecimal("5.5") % 2.0
        assert result == Decimal("1.5")
        assert isinstance(result, WaveDecimal)

    def test_float_mod_decimal_via_rmod(self) -> None:
        result = 5.5 % WaveDecimal("2")
        assert result == Decimal("1.5")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalPower:
    """Exponentiation coerces operands and returns ``WaveDecimal``."""

    def test_power_int_exponent(self) -> None:
        result = WaveDecimal("2") ** 3
        assert result == Decimal("8")
        assert isinstance(result, WaveDecimal)

    def test_power_decimal_exponent(self) -> None:
        result = WaveDecimal("2") ** WaveDecimal("3")
        assert result == Decimal("8")
        assert isinstance(result, WaveDecimal)

    def test_power_float_exponent(self) -> None:
        result = WaveDecimal("2") ** 2.0
        assert result == Decimal("4")
        assert isinstance(result, WaveDecimal)

    def test_float_base_power_decimal_via_rpow(self) -> None:
        result = 2.0 ** WaveDecimal("3")
        assert result == Decimal("8")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalDivmod:
    """``divmod`` returns a pair of ``WaveDecimal`` values."""

    def test_divmod_returns_wave_decimal_pair(self) -> None:
        quotient, remainder = divmod(WaveDecimal("7"), WaveDecimal("2"))
        assert quotient == Decimal("3")
        assert remainder == Decimal("1")
        assert isinstance(quotient, WaveDecimal)
        assert isinstance(remainder, WaveDecimal)

    def test_divmod_with_float(self) -> None:
        quotient, remainder = divmod(WaveDecimal("7.5"), 2.0)
        assert quotient == Decimal("3")
        assert remainder == Decimal("1.5")
        assert isinstance(quotient, WaveDecimal)
        assert isinstance(remainder, WaveDecimal)


class TestWaveDecimalUnary:
    """Unary negation, unary plus, and ``abs`` return ``WaveDecimal``."""

    def test_negation(self) -> None:
        result = -WaveDecimal("1.5")
        assert result == Decimal("-1.5")
        assert isinstance(result, WaveDecimal)

    def test_unary_plus(self) -> None:
        result = +WaveDecimal("1.5")
        assert result == Decimal("1.5")
        assert isinstance(result, WaveDecimal)

    def test_abs(self) -> None:
        result = abs(WaveDecimal("-1.5"))
        assert result == Decimal("1.5")
        assert isinstance(result, WaveDecimal)


class TestWaveDecimalChainedOperations:
    """Chained mixed-operand arithmetic stays ``WaveDecimal`` and exact."""

    def test_chained_mixed_operands_stay_exact(self) -> None:
        result = WaveDecimal("0.1") + 0.2 + WaveDecimal("0.3")
        assert result == Decimal("0.6")
        assert isinstance(result, WaveDecimal)

    def test_chained_add_then_multiply(self) -> None:
        result = (WaveDecimal("0.1") + 0.2) * 10
        assert result == Decimal("3")
        assert isinstance(result, WaveDecimal)


class TestToWaveDecimal:
    """``to_wave_decimal`` exact parse / normalize at every boundary."""

    def test_string_parses_exact(self) -> None:
        result = to_wave_decimal("-2123.123213123123699999")
        assert result == Decimal("-2123.123213123123699999")
        assert isinstance(result, Decimal)

    def test_dotless_string(self) -> None:
        result = to_wave_decimal("123")
        assert result == Decimal("123")
        assert isinstance(result, Decimal)

    def test_float_uses_str_to_recover_literal_intent(self) -> None:
        # Decimal(0.1) would be 0.1000000000000000055...; Decimal(str(0.1)) is exact.
        result = to_wave_decimal(0.1)
        assert result == Decimal("0.1")
        assert isinstance(result, Decimal)

    def test_float_with_more_digits(self) -> None:
        result = to_wave_decimal(1.08)
        assert result == Decimal("1.08")
        assert isinstance(result, Decimal)

    def test_decimal_passes_through(self) -> None:
        source = Decimal("9.9")
        result = to_wave_decimal(source)
        assert result == Decimal("9.9")
        assert isinstance(result, Decimal)

    def test_int_passes_through(self) -> None:
        result = to_wave_decimal(5)
        assert result == 5
        assert isinstance(result, int)

    def test_non_numeric_string_passes_through(self) -> None:
        assert to_wave_decimal("abc") == "abc"

    def test_none_passes_through(self) -> None:
        assert to_wave_decimal(None) is None

    def test_list_passes_through(self) -> None:
        assert to_wave_decimal([1, 2]) == [1, 2]


class TestDecimalToStr:
    """``decimal_to_str`` renders plain fixed-point, never ``E`` notation."""

    def test_positive_exponent_expands_to_plain(self) -> None:
        # str(Decimal('1E+3')) would be '1E+3'.
        assert decimal_to_str(Decimal("1E+3")) == "1000"

    def test_negative_exponent_expands_to_plain(self) -> None:
        # str(Decimal('1E-7')) would be '1E-7'.
        assert decimal_to_str(Decimal("1E-7")) == "0.0000001"

    def test_simple_decimal(self) -> None:
        assert decimal_to_str(Decimal("1.08")) == "1.08"

    def test_negative_value(self) -> None:
        assert decimal_to_str(Decimal("-2123.123213123123699999")) == "-2123.123213123123699999"

    def test_zero(self) -> None:
        assert decimal_to_str(Decimal("0")) == "0"

    def test_dotless_value(self) -> None:
        assert decimal_to_str(Decimal("123")) == "123"

    def test_never_emits_exponent_marker(self) -> None:
        for source in ("1E+3", "1E-7", "1.23E+10", "9.99E-12"):
            rendered = decimal_to_str(Decimal(source))
            assert "E" not in rendered
            assert "e" not in rendered

    def test_28_significant_digits_round_trip(self) -> None:
        original = "1.234567890123456789012345678"
        assert decimal_to_str(Decimal(original)) == original


class TestWaveDecimalText:
    """A ``WaveDecimal`` writes itself in plain digits, as every surface does (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        ("source", "text"),
        [
            ("1E-7", "0.0000001"),
            ("0.0000001", "0.0000001"),
            ("1E+21", "1000000000000000000000"),
            ("1.50", "1.50"),
            ("-2.5", "-2.5"),
            ("NaN", "NaN"),
        ],
    )
    def test_str_is_plain_digits(self, source: str, text: str) -> None:
        assert str(WaveDecimal(source)) == text

    def test_an_f_string_writes_plain_digits(self) -> None:
        assert f"tiny={WaveDecimal('0.0000001')}" == "tiny=0.0000001"

    def test_a_format_spec_still_formats(self) -> None:
        assert f"{WaveDecimal('2.5'):.3f}" == "2.500"
        assert format(WaveDecimal("0.0000001"), "e") == "1e-7"

    def test_plain_text_reads_back_as_the_same_number(self) -> None:
        value = WaveDecimal("0.0000001")
        assert WaveDecimal(str(value)) == value


class TestDecimalContext:
    """``decimal_context`` is a 28-significant-digit local context."""

    def test_context_sets_precision_to_28(self) -> None:
        with decimal_context():
            assert getcontext().prec == 28

    def test_context_restores_after_exit(self) -> None:
        outer = getcontext().prec
        with decimal_context():
            pass
        assert getcontext().prec == outer

    def test_division_inside_context_keeps_28_digits(self) -> None:
        with decimal_context():
            result = Decimal("1") / Decimal("3")
        assert result == Decimal("0.3333333333333333333333333333")


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
