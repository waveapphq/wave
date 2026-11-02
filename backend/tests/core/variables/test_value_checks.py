"""Unit tests for the one number rule applied to a typed value (REQ-3.1.3.14, REQ-3.1.3.19).

Requirements tested:
- REQ-3.1.3.14: a typed integer / float value follows the one number rule, digit text included
- REQ-3.1.3.19: array items, map values and table cells follow the rule by their declared types
- REQ-3.1.3.14: a save stores each valid typed number in its wire form
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.number_rule import NumberType, plain_number_text
from wavecore.core.variables.value_checks import (
    ValueProblem,
    declared_value_problem,
    number_value_problem,
    stored_number,
    text_as_number,
    typed_value_numbers,
)

_SEALED = "wave:enc:v1:bm9uY2VjaXBoZXJ0ZXh0"
_MASKED = "********"


def _stored(value: Any, declared_type: str, element_types: Any = None) -> Any:
    return typed_value_numbers(value, declared_type, element_types, stored_number)


def _said(problem: ValueProblem | None, subject: str = "Value for variable 'x'") -> str | None:
    return None if problem is None else problem.describe(subject)


class TestNumberValueProblem:
    """One value against one number type: the type, then the digit cap."""

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            ("30", "integer"),
            (30, "integer"),
            ("-1234567890123456789", "integer"),
            ("2.50", "float"),
            (2.5, "float"),
            (30, "float"),
            (Decimal("1.5"), "float"),
        ],
        ids=["digits", "int", "19-digits", "float-text", "float", "int-for-float", "decimal"],
    )
    def test_a_valid_number_has_no_problem(self, value: Any, declared: NumberType) -> None:
        assert number_value_problem(value, declared) is None

    @pytest.mark.parametrize(
        ("value", "declared", "said", "fix"),
        [
            ("abc", "integer", "is not a valid integer", "Provide an integer value"),
            ("1e5", "float", "is not a valid float", "Provide a float value"),
            (" 30", "integer", "is not a valid integer", "Provide an integer value"),
            (True, "integer", "is not a valid integer", "Provide an integer value"),
            (float("nan"), "float", "is not a valid float", "Provide a float value"),
            (
                "12345678901234567890",
                "integer",
                "allows at most 19 digits, got 20",
                "Provide at most 19 digits",
            ),
            (
                10**19,
                "integer",
                "allows at most 19 digits, got 20",
                "Provide at most 19 digits",
            ),
            (
                "1.2345678901234567890123456789",
                "float",
                "allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
            ),
        ],
        ids=[
            "text",
            "exponent",
            "space",
            "boolean",
            "nan",
            "20-digit-text",
            "20-digit-int",
            "29-digit-float",
        ],
    )
    def test_a_value_that_breaks_the_rule_names_how(
        self, value: Any, declared: NumberType, said: str, fix: str
    ) -> None:
        problem = number_value_problem(value, declared)

        assert problem is not None
        assert (problem.reason, problem.fix) == (said, fix)

    def test_the_place_goes_between_the_subject_and_the_reason(self) -> None:
        problem = number_value_problem("x", "integer", "item 2")

        assert _said(problem) == "Value for variable 'x' at item 2 is not a valid integer"


class TestDeclaredValueProblem:
    """A declared value: a number, the typed elements of a list or map, or typed table cells."""

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            (None, "integer"),
            (_SEALED, "integer"),
            (_MASKED, "float"),
            ("anything", "string"),
            ("yes", "boolean"),
            ([1, "x"], "array"),
            ({"a": "x"}, "map"),
            ([{"a": "x"}], "table"),
        ],
        ids=[
            "null",
            "sealed",
            "masked",
            "string",
            "boolean",
            "untyped-list",
            "untyped-map",
            "row-maps",
        ],
    )
    def test_a_value_the_rule_does_not_read_has_no_problem(self, value: Any, declared: str) -> None:
        assert declared_value_problem(value, declared) is None

    def test_a_scalar_is_read_by_its_type(self) -> None:
        assert _said(declared_value_problem("3.5", "integer")) == (
            "Value for variable 'x' is not a valid integer"
        )

    def test_a_list_item_is_read_by_its_element_type_and_counted_from_one(self) -> None:
        problem = declared_value_problem(["1", None, "two", "3"], "array", ["integer"] * 4)

        assert _said(problem) == "Value for variable 'x' at item 3 is not a valid integer"

    def test_a_list_item_past_the_declared_types_is_not_read(self) -> None:
        assert declared_value_problem(["1", "two"], "array", ["integer"]) is None

    def test_a_map_value_is_read_by_its_key_type(self) -> None:
        problem = declared_value_problem(
            {"name": "x", "big": "12345678901234567890"},
            "map",
            {"name": "string", "big": "integer"},
        )

        assert _said(problem) == (
            "Value for variable 'x' at key 'big' allows at most 19 digits, got 20"
        )

    def test_typed_elements_that_follow_the_rule_have_no_problem(self) -> None:
        assert declared_value_problem({"a": "2.5", "b": 3}, "map", {"a": "float"}) is None
        assert declared_value_problem([1, "2"], "array", ["integer", "integer"]) is None

    def test_a_list_or_map_without_its_element_types_is_not_read(self) -> None:
        assert declared_value_problem(["x"], "array", {"0": "integer"}) is None
        assert declared_value_problem({"a": "x"}, "map", ["integer"]) is None

    def test_a_table_cell_is_read_by_its_column_type(self) -> None:
        table = {
            "columns": [{"name": "id", "type": "integer"}, {"name": "ratio", "type": "float"}],
            "rows": [["1", "0.5"], [None, "1e3"]],
        }

        assert _said(declared_value_problem(table, "table")) == (
            "Value for variable 'x' at row 2, column 'ratio' is not a valid float"
        )

    def test_a_table_whose_cells_follow_the_rule_has_no_problem(self) -> None:
        table = {
            "columns": [{"name": "id", "type": "integer"}, {"name": "label", "type": "string"}],
            "rows": [["1", "a"], [2, None]],
        }

        assert declared_value_problem(table, "table") is None

    @pytest.mark.parametrize(
        "table",
        [
            {"columns": "id", "rows": [["x"]]},
            {"columns": [{"name": "id", "type": "integer"}], "rows": "x"},
            {"columns": [{"name": "id", "type": "integer"}], "rows": ["x"]},
            {"columns": ["id"], "rows": [["x"]]},
            {"columns": [{"name": "id", "type": "integer"}], "rows": [[]]},
        ],
        ids=["columns-text", "rows-text", "row-text", "column-name-only", "short-row"],
    )
    def test_a_table_of_another_shape_is_left_to_its_own_check(self, table: Any) -> None:
        assert declared_value_problem(table, "table") is None


class TestStoredNumber:
    """A valid number of a declared number type is stored in its wire form (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        ("value", "declared", "stored"),
        [
            (1e-07, ("float",), "0.0000001"),
            (0.00001, ("float",), "0.00001"),
            (1234567890123456789, ("integer",), "1234567890123456789"),
            (30.0, ("float",), "30.0"),
            (2.5, ("float",), 2.5),
            (30, ("integer",), 30),
            (30, ("float",), 30),
            (Decimal("1.50"), ("float",), "1.50"),
            (12345678901234567890, ("float",), "12345678901234567890"),
            (1234567890123456789, ("string", "integer"), "1234567890123456789"),
            (1e-07, ("integer", "float"), "0.0000001"),
        ],
        ids=[
            "tiny-float",
            "small-float",
            "big-integer",
            "whole-float",
            "plain-float",
            "integer",
            "integer-for-float",
            "decimal",
            "20-digits-for-float",
            "number-in-a-text-or-integer-field",
            "second-declared-type",
        ],
    )
    def test_a_valid_number_takes_its_wire_form(
        self, value: Any, declared: tuple[str, ...], stored: Any
    ) -> None:
        assert stored_number(value, declared) == stored
        assert type(stored_number(value, declared)) is type(stored)

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            ("1234567890123456789", ("integer",)),
            ("0.0000001", ("float",)),
            (True, ("integer",)),
            (2.5, ("integer",)),
            (30.0, ("integer",)),
            (12345678901234567890, ("integer",)),
            (float("nan"), ("float",)),
            (1e-07, ("string",)),
            (1e-07, ()),
            (None, ("float",)),
            ([1e-07], ("float",)),
        ],
        ids=[
            "integer-text",
            "float-text",
            "boolean",
            "fraction-for-integer",
            "whole-float-for-integer",
            "20-digits-for-integer",
            "nan",
            "no-number-type",
            "no-type",
            "null",
            "list",
        ],
    )
    def test_text_and_a_value_the_type_refuses_stay_as_given(
        self, value: Any, declared: tuple[str, ...]
    ) -> None:
        assert stored_number(value, declared) is value


class TestStoredValue:
    """A declared value stores each number in the places ``declared_value_problem`` reads."""

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            (None, "float"),
            (_SEALED, "integer"),
            (_MASKED, "float"),
            (1e-07, "string"),
            ([1e-07], "array"),
            ({"a": 1e-07}, "map"),
            ([1e-07], "table"),
        ],
        ids=[
            "null",
            "sealed",
            "masked",
            "string",
            "untyped-list",
            "untyped-map",
            "row-maps",
        ],
    )
    def test_a_value_the_rule_does_not_read_stays_as_given(self, value: Any, declared: str) -> None:
        assert _stored(value, declared) is value

    def test_a_scalar_takes_the_wire_form_of_its_type(self) -> None:
        assert _stored(1e-07, "float") == "0.0000001"
        assert _stored(1234567890123456789, "integer") == "1234567890123456789"

    def test_a_list_item_takes_the_wire_form_of_its_element_type(self) -> None:
        stored = _stored(
            [1e-07, 1234567890123456789, 30.0, 2.5, 1e-07],
            "array",
            ["float", "integer", "float", "float"],
        )

        assert stored == ["0.0000001", "1234567890123456789", "30.0", 2.5, 1e-07]

    def test_a_map_value_takes_the_wire_form_of_its_key_type(self) -> None:
        stored = _stored(
            {"rate": 1e-07, "label": 1e-07, "free": 30.0},
            "map",
            {"rate": "float", "label": "string"},
        )

        assert stored == {"rate": "0.0000001", "label": 1e-07, "free": 30.0}

    def test_a_list_or_map_without_its_element_types_stays_as_given(self) -> None:
        listed = [1e-07]
        mapped = {"a": 1e-07}

        assert _stored(listed, "array", {"0": "float"}) is listed
        assert _stored(mapped, "map", ["float"]) is mapped

    def test_a_table_cell_takes_the_wire_form_of_its_column_type(self) -> None:
        table = {
            "columns": [
                {"name": "id", "type": "integer"},
                "untyped",
                {"name": "ratio", "type": "float"},
            ],
            "rows": [[1234567890123456789, 1e-07, 1e-07], [30, 30.0], "not-a-row"],
        }

        assert _stored(table, "table") == {
            "columns": table["columns"],
            "rows": [["1234567890123456789", 1e-07, "0.0000001"], [30, 30.0], "not-a-row"],
        }

    @pytest.mark.parametrize(
        "table",
        [
            {"columns": "id", "rows": [[1e-07]]},
            {"columns": [{"name": "id", "type": "float"}], "rows": "x"},
        ],
        ids=["columns-text", "rows-text"],
    )
    def test_a_table_of_another_shape_stays_as_given(self, table: Any) -> None:
        assert _stored(table, "table") is table


class TestTextAsNumber:
    """Digit text valid for a declared number type reads back as the exact number it is."""

    @pytest.mark.parametrize(
        ("text", "declared", "number"),
        [
            ("30", ("integer",), 30),
            ("1234567890123456789", ("integer",), 1234567890123456789),
            ("30", ("float",), 30),
            ("2.50", ("float",), Decimal("2.50")),
            ("0.0000001", ("float",), Decimal("0.0000001")),
            ("30.0", ("float",), Decimal("30.0")),
            ("-7", ("integer", "float"), -7),
        ],
        ids=[
            "integer",
            "19-digits",
            "whole-for-float",
            "trailing-zero",
            "tiny",
            "whole-float",
            "neg",
        ],
    )
    def test_digit_text_reads_back_as_its_number(
        self, text: str, declared: tuple[str, ...], number: Any
    ) -> None:
        read = text_as_number(text, declared)

        assert (read, type(read).__name__, plain_number_text(read)) == (
            number,
            "int" if isinstance(number, int) else "WaveDecimal",
            text,
        )

    @pytest.mark.parametrize(
        ("value", "declared"),
        [
            ("1e5", ("integer",)),
            ("12345678901234567890", ("integer",)),
            ("2.5", ("integer",)),
            ("30", ("string", "integer")),
            ("30", ("string",)),
            ("30", ()),
            (30, ("integer",)),
            (2.5, ("float",)),
            (None, ("float",)),
        ],
        ids=[
            "exponent",
            "20-digits",
            "fraction-for-integer",
            "text-field",
            "string",
            "no-type",
            "number",
            "float",
            "null",
        ],
    )
    def test_other_values_stay_as_given(self, value: Any, declared: tuple[str, ...]) -> None:
        assert text_as_number(value, declared) is value

    def test_typed_entries_read_back_by_their_types(self) -> None:
        table = {"columns": [{"name": "id", "type": "integer"}], "rows": [["7"], ["x"]]}

        assert [
            typed_value_numbers(["7", "2.50"], "array", ["integer", "float"], text_as_number),
            typed_value_numbers({"k": "30", "z": "02134"}, "map", {"k": "integer"}, text_as_number),
            typed_value_numbers(table, "table", None, text_as_number)["rows"],
        ] == [[7, Decimal("2.50")], {"k": 30, "z": "02134"}, [[7], ["x"]]]
