"""The one number rule for every numeric field (REQ-3.1.3.14).

Integer: a whole number, as text ``-?[0-9]+``, at most 19 digits. Float: a decimal number,
as text ``-?[0-9]+(\\.[0-9]+)?``, at most 28 significant digits. NaN and infinities are
never numbers; a boolean is never a number.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.number_rule import (
    MAX_FLOAT_SIG_DIGITS,
    MAX_INTEGER_DIGITS,
    NumberType,
    float_significant_digits,
    integer_digit_count,
    is_integer_value,
    is_number_value,
    not_finite_name,
    number_problem,
    parse_number,
    plain_number_text,
    wire_number,
)
from wavecore.core.variables.decimal_value import WaveDecimal

_NINETEEN = "1234567890123456789"
_TWENTY = "12345678901234567890"
_TWENTY_EIGHT = "1.234567890123456789012345678"
_TWENTY_NINE = "1.2345678901234567890123456789"


class TestCaps:
    def test_an_integer_holds_at_most_19_digits(self) -> None:
        assert MAX_INTEGER_DIGITS == 19

    def test_a_float_holds_at_most_28_significant_digits(self) -> None:
        assert MAX_FLOAT_SIG_DIGITS == 28


class TestRunValuePredicates:
    @pytest.mark.parametrize(
        "value",
        [0, -7, 10**30],
        ids=["zero", "negative", "past-the-cap"],
    )
    def test_a_python_int_is_an_integer(self, value: int) -> None:
        assert is_integer_value(value) is True

    @pytest.mark.parametrize(
        "value",
        [True, False, 3.0, Decimal("3"), "3", None],
        ids=["true", "false", "whole-float", "whole-decimal", "digit-text", "null"],
    )
    def test_anything_else_is_not_an_integer(self, value: Any) -> None:
        assert is_integer_value(value) is False

    @pytest.mark.parametrize(
        "value",
        [3, 2.5, -0.0, Decimal("2.50"), WaveDecimal("-1.5")],
        ids=["int", "float", "negative-zero", "decimal", "wave-decimal"],
    )
    def test_a_finite_number_is_a_number(self, value: Any) -> None:
        assert is_number_value(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            float("nan"),
            float("inf"),
            float("-inf"),
            Decimal("NaN"),
            Decimal("sNaN"),
            Decimal("Infinity"),
            Decimal("-Infinity"),
            True,
            False,
            "2.5",
            None,
            [1],
        ],
        ids=[
            "float-nan",
            "float-infinity",
            "float-minus-infinity",
            "decimal-nan",
            "decimal-signaling-nan",
            "decimal-infinity",
            "decimal-minus-infinity",
            "true",
            "false",
            "digit-text",
            "null",
            "list",
        ],
    )
    def test_a_non_finite_or_non_number_value_is_not_a_number(self, value: Any) -> None:
        assert is_number_value(value) is False


class TestNotFiniteName:
    @pytest.mark.parametrize(
        ("value", "name"),
        [
            (float("nan"), "NaN"),
            (float("inf"), "Infinity"),
            (float("-inf"), "-Infinity"),
            (Decimal("sNaN"), "NaN"),
            (Decimal("Infinity"), "Infinity"),
            (Decimal("-Infinity"), "-Infinity"),
        ],
    )
    def test_a_float_that_is_not_a_number_is_named_by_its_value(
        self, value: Any, name: str
    ) -> None:
        assert not_finite_name(value) == name


class TestDigitCounts:
    @pytest.mark.parametrize(
        ("value", "count"),
        [("123", 3), ("-123", 3), ("007", 3), (_TWENTY, 20), (0, 1), (-45, 2), (10**19, 20)],
        ids=["text", "negative-text", "leading-zeros", "twenty", "zero", "negative-int", "big"],
    )
    def test_an_integer_counts_its_digits_without_the_sign(
        self, value: int | str, count: int
    ) -> None:
        assert integer_digit_count(value) == count

    @pytest.mark.parametrize(
        ("value", "count"),
        [
            ("3.14", 3),
            ("-0.000099", 2),
            ("100", 3),
            ("2.50", 3),
            ("0", 0),
            (_TWENTY_NINE, 29),
            (1.5, 2),
            (123, 3),
            (0, 0),
            (1e-7, 1),
            (1e21, 22),
            (Decimal("12.30"), 4),
            (Decimal("0.0012"), 2),
            (Decimal("1E+2"), 3),
            (Decimal("0.000"), 0),
            (Decimal("-0E+5"), 0),
        ],
        ids=[
            "text",
            "leading-zeros-dropped",
            "trailing-zeros-count",
            "trailing-fraction-zero-counts",
            "zero-text",
            "twenty-nine",
            "float",
            "int",
            "zero-int",
            "small-float-in-plain-digits",
            "large-float-in-plain-digits",
            "decimal-trailing-zero",
            "decimal-leading-zeros",
            "decimal-exponent",
            "decimal-zero",
            "decimal-zero-exponent",
        ],
    )
    def test_a_float_counts_its_significant_digits(
        self, value: str | int | float | Decimal, count: int
    ) -> None:
        assert float_significant_digits(value) == count


class TestPlainNumberText:
    @pytest.mark.parametrize(
        ("value", "text"),
        [
            (30, "30"),
            (-7, "-7"),
            (1.5, "1.5"),
            (30.0, "30.0"),
            (1e-7, "0.0000001"),
            (1.5e-7, "0.00000015"),
            (1e21, "1000000000000000000000"),
            (-1.5e21, "-1500000000000000000000"),
            (Decimal("2.50"), "2.50"),
            (Decimal("1E+3"), "1000"),
            (Decimal("-1E-3"), "-0.001"),
        ],
        ids=[
            "int",
            "negative-int",
            "float",
            "whole-float",
            "small-float",
            "small-float-with-fraction",
            "large-float",
            "negative-large-float",
            "decimal",
            "decimal-exponent",
            "negative-decimal-exponent",
        ],
    )
    def test_a_number_prints_in_plain_digits(self, value: int | float | Decimal, text: str) -> None:
        assert plain_number_text(value) == text


class TestNumberProblemOfText:
    @pytest.mark.parametrize(
        ("text", "declared"),
        [
            ("30", "integer"),
            ("-30", "integer"),
            ("007", "integer"),
            ("-0", "integer"),
            (_NINETEEN, "integer"),
            (f"-{_NINETEEN}", "integer"),
            ("30", "float"),
            ("2.50", "float"),
            ("-0.000099", "float"),
            (_TWENTY_EIGHT, "float"),
            (f"-{_TWENTY_EIGHT}", "float"),
        ],
    )
    def test_digit_text_that_keeps_the_rule_is_that_number(
        self, text: str, declared: NumberType
    ) -> None:
        assert number_problem(text, declared) is None

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "-",
            "+30",
            " 30",
            "30 ",
            "30\n",
            "1_000",
            "3.0",
            "1e3",
            "0x10",
            "٣٠",
            "30.",
            "abc",
        ],
        ids=[
            "empty",
            "lone-minus",
            "plus-sign",
            "leading-space",
            "trailing-space",
            "trailing-newline",
            "underscore",
            "dot",
            "exponent",
            "hex",
            "arabic-indic-digits",
            "trailing-dot",
            "words",
        ],
    )
    def test_text_that_breaks_the_integer_form_is_not_an_integer(self, text: str) -> None:
        assert number_problem(text, "integer") == "type"

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "-",
            "+2.5",
            " 2.5",
            "2.5\n",
            ".5",
            "5.",
            "1e5",
            "1.5E-3",
            "1_0.5",
            "1.2.3",
            "NaN",
            "Infinity",
            "-Infinity",
            "٣.٥",
        ],
        ids=[
            "empty",
            "lone-minus",
            "plus-sign",
            "leading-space",
            "trailing-newline",
            "no-whole-part",
            "no-fraction",
            "exponent",
            "upper-exponent",
            "underscore",
            "two-dots",
            "nan",
            "infinity",
            "minus-infinity",
            "arabic-indic-digits",
        ],
    )
    def test_text_that_breaks_the_float_form_is_not_a_float(self, text: str) -> None:
        assert number_problem(text, "float") == "type"

    @pytest.mark.parametrize(
        "text", [_TWENTY, f"-{_TWENTY}", "0" * 20], ids=["plain", "neg", "zeros"]
    )
    def test_integer_text_past_19_digits_is_over_the_cap(self, text: str) -> None:
        assert number_problem(text, "integer") == "integer-cap"

    @pytest.mark.parametrize(
        "text",
        [_TWENTY_NINE, f"-{_TWENTY_NINE}", "1" * 29, f"0.{'1' * 29}"],
        ids=["plain", "negative", "whole", "fraction"],
    )
    def test_float_text_past_28_significant_digits_is_over_the_cap(self, text: str) -> None:
        assert number_problem(text, "float") == "float-cap"

    def test_leading_zeros_do_not_count_toward_the_float_cap(self) -> None:
        assert number_problem(f"0.000{'1' * 28}", "float") is None


class TestNumberProblemOfNumbers:
    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            (30, "integer"),
            (-(10**19) + 1, "integer"),
            (30, "float"),
            (2.5, "float"),
            (1e-7, "float"),
            (Decimal("2.50"), "float"),
            (WaveDecimal(_TWENTY_EIGHT), "float"),
            (10**28 - 1, "float"),
        ],
        ids=[
            "int",
            "nineteen-digit-int",
            "int-for-float",
            "float",
            "small-float",
            "decimal",
            "twenty-eight-digit-decimal",
            "twenty-eight-digit-int-for-float",
        ],
    )
    def test_a_number_that_keeps_the_rule_has_no_problem(
        self, value: Any, declared: NumberType
    ) -> None:
        assert number_problem(value, declared) is None

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            (True, "integer"),
            (False, "float"),
            (30.0, "integer"),
            (Decimal("30"), "integer"),
            (float("nan"), "float"),
            (float("inf"), "float"),
            (float("-inf"), "float"),
            (Decimal("NaN"), "float"),
            (Decimal("sNaN"), "float"),
            (Decimal("Infinity"), "float"),
            (None, "integer"),
            (None, "float"),
            ([1], "integer"),
            ({"a": 1}, "float"),
        ],
        ids=[
            "true-for-integer",
            "false-for-float",
            "whole-float-for-integer",
            "decimal-for-integer",
            "float-nan",
            "float-infinity",
            "float-minus-infinity",
            "decimal-nan",
            "decimal-signaling-nan",
            "decimal-infinity",
            "null-for-integer",
            "null-for-float",
            "list-for-integer",
            "map-for-float",
        ],
    )
    def test_a_value_that_is_not_that_number_is_of_the_wrong_type(
        self, value: Any, declared: NumberType
    ) -> None:
        assert number_problem(value, declared) == "type"

    @pytest.mark.parametrize("value", [10**19, -(10**19), 10**30], ids=["cap", "negative", "big"])
    def test_an_int_past_19_digits_is_over_the_integer_cap(self, value: int) -> None:
        assert number_problem(value, "integer") == "integer-cap"

    @pytest.mark.parametrize(
        "value",
        [10**28, 1e30, Decimal(_TWENTY_NINE), Decimal("1E+28")],
        ids=["int", "large-float", "decimal", "decimal-exponent"],
    )
    def test_a_number_past_28_significant_digits_is_over_the_float_cap(self, value: Any) -> None:
        assert number_problem(value, "float") == "float-cap"


class TestParseNumber:
    @pytest.mark.parametrize(
        ("value", "number"),
        [("30", 30), ("-007", -7), (_NINETEEN, int(_NINETEEN)), (42, 42)],
        ids=["text", "leading-zeros", "nineteen-digits", "int"],
    )
    def test_an_integer_parses_to_the_exact_int(self, value: Any, number: int) -> None:
        parsed = parse_number(value, "integer")

        assert type(parsed) is int
        assert parsed == number

    @pytest.mark.parametrize(
        ("value", "text"),
        [
            ("2.50", "2.50"),
            (_TWENTY_EIGHT, _TWENTY_EIGHT),
            ("30", "30"),
            (30, "30"),
            (0.1, "0.1"),
            (1e-7, "0.0000001"),
            (Decimal("1.50"), "1.50"),
        ],
        ids=["text", "twenty-eight-digits", "whole-text", "int", "float", "small-float", "decimal"],
    )
    def test_a_float_parses_to_the_exact_decimal(self, value: Any, text: str) -> None:
        parsed = parse_number(value, "float")

        assert type(parsed) is WaveDecimal
        assert str(parsed) == text

    @pytest.mark.parametrize(
        ("value", "declared", "message"),
        [
            ("3.5", "integer", "Not a valid integer: '3.5'"),
            (True, "integer", "Not a valid integer: True"),
            ("1e5", "float", "Not a valid float: '1e5'"),
            (float("nan"), "float", "Not a valid float: nan"),
            (_TWENTY, "integer", "An integer allows at most 19 digits, got 20"),
            (-(10**20), "integer", "An integer allows at most 19 digits, got 21"),
            (_TWENTY_NINE, "float", "A float allows at most 28 significant digits, got 29"),
            (10**28, "float", "A float allows at most 28 significant digits, got 29"),
        ],
        ids=[
            "fraction-for-integer",
            "boolean",
            "exponent-for-float",
            "nan",
            "integer-text-past-the-cap",
            "int-past-the-cap",
            "float-text-past-the-cap",
            "int-past-the-float-cap",
        ],
    )
    def test_a_value_that_breaks_the_rule_is_refused(
        self, value: Any, declared: NumberType, message: str
    ) -> None:
        with pytest.raises(ValueError) as raised:
            parse_number(value, declared)

        assert str(raised.value) == message


class TestWireNumber:
    @pytest.mark.parametrize(
        ("value", "wire"),
        [
            (30, 30),
            (-(2**53 - 1), -(2**53 - 1)),
            (2**53 - 1, 2**53 - 1),
            (1.5, 1.5),
            (0.1, 0.1),
            (0.0001, 0.0001),
            (Decimal("2.5"), 2.5),
            (Decimal("30"), 30),
            (WaveDecimal("-12.75"), -12.75),
        ],
        ids=[
            "int",
            "lowest-safe-int",
            "highest-safe-int",
            "float",
            "tenth",
            "small-plain-float",
            "decimal",
            "whole-decimal",
            "wave-decimal",
        ],
    )
    def test_a_number_that_keeps_every_digit_travels_as_a_json_number(
        self, value: int | float | Decimal, wire: int | float
    ) -> None:
        sent = wire_number(value)

        assert type(sent) is type(wire)
        assert sent == wire

    @pytest.mark.parametrize(
        ("value", "wire"),
        [
            (2**53, "9007199254740992"),
            (-(2**53), "-9007199254740992"),
            (int(_TWENTY), _TWENTY),
            (Decimal("2.50"), "2.50"),
            (Decimal(_TWENTY_EIGHT), _TWENTY_EIGHT),
            (Decimal("-0"), "-0"),
            (Decimal("9007199254740993"), "9007199254740993"),
            (30.0, "30.0"),
            (1e-7, "0.0000001"),
            (-0.000099, "-0.000099"),
            (1e16, "10000000000000000"),
            (1e21, "1000000000000000000000"),
            (float("nan"), "NaN"),
            (float("inf"), "Infinity"),
            (Decimal("sNaN"), "sNaN"),
        ],
        ids=[
            "int-past-safe",
            "below-safe-int",
            "twenty-digits",
            "trailing-zero",
            "twenty-eight-digits",
            "negative-zero",
            "whole-decimal-past-safe-int",
            "whole-float",
            "small-float",
            "float-python-prints-with-exponent",
            "whole-float-python-prints-with-exponent",
            "float-past-1e21",
            "nan",
            "infinity",
            "signaling-nan",
        ],
    )
    def test_any_other_number_travels_as_its_exact_plain_text(
        self, value: int | float | Decimal, wire: str
    ) -> None:
        assert wire_number(value) == wire
