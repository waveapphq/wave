"""Unit tests for the save-time number rule on a Block's literal rows.

Requirements tested:
- REQ-3.1.3.14: a literal Variable Setter row, compare-to value and column index follows
  the one number rule at Save, and a save stores each of their numbers in its wire form
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.execution.field_checks import FieldFinding
from wavecore.core.execution.row_checks import literal_row_findings, literal_row_numbers
from wavecore.core.variables.value_checks import stored_number, text_as_number

Seen = tuple[str, str, str | None, str]


def _stored_rows(data: dict[str, Any]) -> dict[str, Any]:
    return literal_row_numbers(data, stored_number)


def _seen(findings: list[FieldFinding]) -> list[Seen]:
    return [(f.code, f.message, f.fix, f.field) for f in findings]


def _node(values: dict[str, Any], **data: Any) -> dict[str, Any]:
    return {"config": {"values": values}, **data}


def _row(
    value_type: str,
    reference: Any,
    *,
    operator: str = "equals",
    variable: str = "count",
    expression: bool = False,
) -> dict[str, Any]:
    return {
        "type": "literal",
        "variable": variable,
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference,
        "reference_is_expression": expression,
    }


def _compare(field: str, said: str, fix: str = "Provide an integer value") -> Seen:
    return ("INVALID_COMPARE_VALUE", f"The value compared with 'count' {said}", fix, field)


class TestSetterRows:
    """A literal Variable Setter row is held to its target variable's type."""

    def test_a_literal_row_that_breaks_the_rule_is_refused(self) -> None:
        data = _node(
            {"variables": {"n": "1e3", "big": "12345678901234567890", "ok": "30"}},
            variableTypes={"n": "integer", "big": "integer", "ok": "integer"},
        )

        assert _seen(literal_row_findings(data)) == [
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'n' is not a valid integer",
                "Provide an integer value",
                "variables.n",
            ),
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'big' allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                "variables.big",
            ),
        ]

    def test_a_typed_element_of_a_literal_row_is_held_to_its_type(self) -> None:
        data = _node(
            {"variables": {"limits": {"max": "x"}}},
            variableTypes={"limits": "map"},
            variableElementTypes={"limits": {"max": "float"}},
        )

        assert _seen(literal_row_findings(data)) == [
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'limits' at key 'max' is not a valid float",
                "Provide a float value",
                "variables.limits",
            )
        ]

    def test_expression_template_and_untyped_rows_are_not_literals_to_check(self) -> None:
        data = _node(
            {"variables": {"e": "count + 1", "t": "{{ n }}", "free": "x"}},
            variableTypes={"e": "integer", "t": "integer"},
            variableExpressionKeys=["e"],
            variableTemplateKeys=["t"],
        )

        assert literal_row_findings(data) == []


class TestConditionRows:
    """A literal compare-to value of a number row follows the rule, at any depth."""

    def test_an_assert_row_is_refused_by_its_place(self) -> None:
        data = _node({"assertions": [_row("integer", "1e3"), {"type": "operator"}]})

        assert _seen(literal_row_findings(data)) == [
            _compare("assertions.0.reference_value", "is not a valid integer")
        ]

    def test_a_row_inside_a_group_is_refused_by_its_place(self) -> None:
        group = {"type": "group", "items": [_row("integer", "5"), _row("float", "1e3")]}
        data = _node({"conditions": [group]})

        assert _seen(literal_row_findings(data)) == [
            _compare(
                "conditions.0.items.1.reference_value",
                "is not a valid float",
                "Provide a float value",
            )
        ]

    def test_a_branch_row_is_refused_by_its_place(self) -> None:
        data = _node({"branches": [{"conditions": []}, {"conditions": [_row("integer", "x")]}]})

        assert _seen(literal_row_findings(data)) == [
            _compare("branches.1.conditions.0.reference_value", "is not a valid integer")
        ]

    def test_a_filter_row_names_the_cell(self) -> None:
        row = _row("float", "1.2345678901234567890123456789", variable="_cell")
        data = _node({"filters": [{"column": {"mode": "name", "value": "a"}, "conditions": [row]}]})

        assert _seen(literal_row_findings(data)) == [
            (
                "INVALID_COMPARE_VALUE",
                "The value compared with the cell allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                "filters.0.conditions.0.reference_value",
            )
        ]

    def test_a_length_is_a_whole_number(self) -> None:
        data = _node({"assertions": [_row("array", "2.5", operator="length_equals")]})

        assert _seen(literal_row_findings(data)) == [
            _compare("assertions.0.reference_value", "is not a valid integer")
        ]

    @pytest.mark.parametrize(
        "row",
        [
            _row("integer", "30"),
            _row("float", "2.50"),
            _row("integer", "limit + 1", expression=True),
            _row("integer", "x", operator="is_null"),
            _row("integer", None),
            _row("string", "1e3"),
            _row("array", "x", operator="contains"),
            {"type": "expression", "expression": "count > 1"},
        ],
        ids=[
            "digits",
            "float-text",
            "expression",
            "unary",
            "null",
            "text-row",
            "array-contains",
            "expression-row",
        ],
    )
    def test_a_row_that_is_not_a_number_literal_or_follows_the_rule_passes(
        self, row: dict[str, Any]
    ) -> None:
        assert literal_row_findings(_node({"assertions": [row]})) == []


class TestColumnIndexes:
    """A sort or filter column picked by index is an integer."""

    def test_an_index_that_is_not_an_integer_is_refused(self) -> None:
        data = _node(
            {
                "sorts": [
                    {"column": {"mode": "index", "value": "1"}},
                    {"column": {"mode": "index", "value": "one"}},
                ],
                "filters": [{"column": {"mode": "index", "value": 1.5}, "conditions": []}],
            }
        )

        assert _seen(literal_row_findings(data)) == [
            (
                "INVALID_COLUMN_INDEX",
                "Column index 'one' is not a valid integer",
                "Provide an integer value",
                "sorts.1.column.value",
            ),
            (
                "INVALID_COLUMN_INDEX",
                "Column index '1.5' is not a valid integer",
                "Provide an integer value",
                "filters.0.column.value",
            ),
        ]

    def test_a_column_picked_by_name_is_text(self) -> None:
        data = _node({"sorts": [{"column": {"mode": "name", "value": "one"}}, "x"]})

        assert literal_row_findings(data) == []


def test_a_block_with_no_values_has_no_literal_rows() -> None:
    assert literal_row_findings({}) == []


class TestStoredSetterRows:
    """A literal setter row stores its number by the target variable's type."""

    def test_a_literal_row_takes_the_wire_form_of_its_target_type(self) -> None:
        data = _node(
            {
                "variables": {
                    "rate": 1e-07,
                    "big": 1234567890123456789,
                    "whole": 30.0,
                    "limits": {"max": 1e-07},
                    "e": 1e-07,
                    "free": 1e-07,
                }
            },
            variableTypes={
                "rate": "float",
                "big": "integer",
                "whole": "float",
                "limits": "map",
                "e": "float",
            },
            variableElementTypes={"limits": {"max": "float"}},
            variableExpressionKeys=["e"],
        )

        assert _stored_rows(data)["variables"] == {
            "rate": "0.0000001",
            "big": "1234567890123456789",
            "whole": "30.0",
            "limits": {"max": "0.0000001"},
            "e": 1e-07,
            "free": 1e-07,
        }

    def test_rows_of_another_shape_stay_as_given(self) -> None:
        assert _stored_rows(_node({"variables": [1e-07]})) == {"variables": [1e-07]}


class TestStoredConditionRows:
    """A literal compare-to number is stored by its row type, at any depth."""

    def test_every_literal_row_takes_the_wire_form_of_its_type(self) -> None:
        group = {"type": "group", "items": [_row("float", 1e-07), "not-a-row"]}
        values = {
            "assertions": [_row("integer", 1234567890123456789), {"type": "operator"}],
            "conditions": [group],
            "branches": [{"conditions": [_row("float", 30.0)]}, {"id": "else"}],
            "filters": [{"conditions": [_row("array", 2, operator="length_equals")]}],
        }

        stored = _stored_rows(_node(values))

        assert [
            stored["assertions"][0]["reference_value"],
            stored["conditions"][0]["items"][0]["reference_value"],
            stored["conditions"][0]["items"][1],
            stored["branches"][0]["conditions"][0]["reference_value"],
            stored["branches"][1],
            stored["filters"][0]["conditions"][0]["reference_value"],
        ] == ["1234567890123456789", "0.0000001", "not-a-row", "30.0", {"id": "else"}, 2]

    @pytest.mark.parametrize(
        "row",
        [
            _row("float", 1e-07, expression=True),
            _row("float", 1e-07, operator="is_null"),
            _row("string", 1e-07),
            _row("array", 1e-07, operator="contains"),
        ],
        ids=["expression", "unary", "text-row", "array-contains"],
    )
    def test_a_row_that_holds_no_typed_number_stays_as_given(self, row: dict[str, Any]) -> None:
        assert _stored_rows(_node({"assertions": [row]})) == {"assertions": [row]}

    def test_a_row_with_no_compare_to_value_gains_none(self) -> None:
        row = {"type": "literal", "variable": "n", "value_type": "float", "operator": "equals"}

        assert _stored_rows(_node({"assertions": [row]})) == {"assertions": [row]}


class TestStoredColumnIndexes:
    """A sort or filter column picked by index stores its number as an integer."""

    def test_an_index_takes_the_integer_wire_form(self) -> None:
        values = {
            "sorts": [
                {"column": {"mode": "index", "value": 1234567890123456789}},
                {"column": {"mode": "name", "value": 30.0}},
                {"column": {"mode": "index"}},
            ],
            "filters": [{"column": {"mode": "index", "value": 2}, "conditions": []}],
        }

        assert _stored_rows(_node(values)) == {
            "sorts": [
                {"column": {"mode": "index", "value": "1234567890123456789"}},
                {"column": {"mode": "name", "value": 30.0}},
                {"column": {"mode": "index"}},
            ],
            "filters": [{"column": {"mode": "index", "value": 2}, "conditions": []}],
        }


def test_stored_rows_are_a_copy() -> None:
    data = _node({"assertions": [_row("float", 30.0)]})

    stored = _stored_rows(data)

    assert stored["assertions"][0]["reference_value"] == "30.0"
    assert data["config"]["values"]["assertions"][0]["reference_value"] == 30.0


def test_a_block_with_no_values_stores_no_rows() -> None:
    assert _stored_rows({}) == {}


def test_literal_rows_read_back_digit_text_as_numbers() -> None:
    data = _node(
        {
            "variables": {"n": "30", "free": "30"},
            "assertions": [_row("float", "2.50")],
            "sorts": [{"column": {"mode": "index", "value": "2"}}],
        },
        variableTypes={"n": "integer"},
    )

    read = literal_row_numbers(data, text_as_number)

    assert [
        read["variables"],
        read["assertions"][0]["reference_value"],
        read["sorts"][0]["column"]["value"],
    ] == [{"n": 30, "free": "30"}, Decimal("2.50"), 2]
