"""Unit tests for the save-time row checks of what a Block keeps outside its field list.

Requirements tested:
- REQ-3.1.3.14: a literal Variable Setter row, compare-to value and column index follows
  the one number rule at Save, and a save stores each of their numbers in its wire form
- REQ-3.4.1.14: a Variable Setter row is held to the declared type of the variable it writes
- REQ-3.5.1.5: every condition item is checked at Save and named by its full place
- REQ-3.4.1.12, REQ-3.4.1.13: a CSV / Excel filter item names the cell and is held to the
  operators its column's type offers, with the run's own text
- REQ-3.5.0.3: the structure rules of a registered control are reported at Save
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.execution import row_checks
from wavecore.core.execution.field_checks import FieldFinding
from wavecore.core.secrets.masking import MASK_PLACEHOLDER
from wavecore.core.variables.value_checks import stored_number, text_as_number

Seen = tuple[str, str, str | None, str]

_SETTER = "variable-setter"
_SEALED = "wave:enc:v1:bm9uY2VjaXBoZXJ0ZXh0"
_AND = {"type": "operator", "value": "and"}


def _findings(
    data: dict[str, Any], declared_types: dict[str, str] | None = None
) -> list[FieldFinding]:
    return row_checks.block_row_findings(data, declared_types or {})


def _stored_rows(
    data: dict[str, Any], declared_types: dict[str, str] | None = None
) -> dict[str, Any]:
    return row_checks.literal_row_numbers(data, stored_number, declared_types or {})


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


def _item(**fields: Any) -> dict[str, Any]:
    """A complete literal condition item on a text variable, with the given keys replaced."""
    return {
        "id": "c1",
        "type": "literal",
        "variable": "host",
        "value_type": "string",
        "operator": "equals",
        "reference_value": "web-1",
        **fields,
    }


def _without(item: dict[str, Any], key: str) -> dict[str, Any]:
    return {name: value for name, value in item.items() if name != key}


def _filter(conditions: list[Any], as_type: str = "integer") -> dict[str, Any]:
    column = {"mode": "name", "value": "amount"}
    return {"id": "flt-1", "column": column, "asType": as_type, "conditions": conditions}


def _lane(lane_id: str, name: str, **fields: Any) -> dict[str, Any]:
    return {"id": lane_id, "name": name, **fields}


_COMPARE_FORMS = [
    pytest.param({}, id="literal"),
    pytest.param({"reference_is_expression": True}, id="expression"),
    pytest.param({"reference_is_template": True}, id="template"),
]

_FLAGGED_COMPARE_FORMS = _COMPARE_FORMS[1:]

_NO_VALUE_OPERATORS = [
    pytest.param("integer", "is_null", id="is_null"),
    pytest.param("integer", "is_not_null", id="is_not_null"),
    pytest.param("boolean", "is_true", id="is_true"),
    pytest.param("boolean", "is_false", id="is_false"),
    pytest.param("array", "is_empty", id="is_empty"),
    pytest.param("array", "is_not_empty", id="is_not_empty"),
]


class TestSetterRows:
    """A literal Variable Setter row is held to the declared type of the variable it writes."""

    def test_a_literal_row_that_breaks_the_rule_is_refused(self) -> None:
        data = _node(
            {"variables": {"n": "1e3", "big": "12345678901234567890", "ok": "30"}},
            elementType=_SETTER,
        )
        declared = {"n": "integer", "big": "integer", "ok": "integer"}

        assert _seen(_findings(data, declared)) == [
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
            elementType=_SETTER,
            elementTypes={"variables.limits": {"max": "float"}},
        )

        assert _seen(_findings(data, {"limits": "map"})) == [
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
            elementType=_SETTER,
            expressionFields=["variables.e"],
            templateFields=["variables.t"],
        )

        assert _findings(data, {"e": "integer", "t": "string"}) == []

    @pytest.mark.parametrize(
        ("declared", "value", "message", "fix"),
        [
            pytest.param(
                "boolean",
                "yes",
                "Setting 'variables.row' of block 'variable-setter' expects boolean, got string",
                "Provide a boolean value",
                id="text-on-boolean",
            ),
            pytest.param(
                "array",
                "web-1",
                "Setting 'variables.row' of block 'variable-setter' expects array, got string",
                "Provide an array value",
                id="text-on-array",
            ),
            pytest.param(
                "map",
                "x",
                "Setting 'variables.row' of block 'variable-setter' expects map, got string",
                "Provide a map value",
                id="text-on-map",
            ),
            pytest.param(
                "table",
                "orders.csv",
                "Setting 'variables.row' of block 'variable-setter' expects table, got string",
                "Provide a table value",
                id="text-on-table",
            ),
            pytest.param(
                "string",
                5,
                "Setting 'variables.row' of block 'variable-setter' expects string, got integer",
                "Provide a string value",
                id="number-on-string",
            ),
            pytest.param(
                "string",
                ["a"],
                "Setting 'variables.row' of block 'variable-setter' expects string, got array",
                "Provide a string value",
                id="list-on-string",
            ),
        ],
    )
    def test_a_literal_row_that_no_longer_fits_its_retyped_variable_is_refused(
        self, declared: str, value: Any, message: str, fix: str
    ) -> None:
        data = _node(
            {"variables": {"row": value, "check": "count > 1"}},
            elementType=_SETTER,
            expressionFields=["variables.check"],
        )

        assert _seen(_findings(data, {"row": declared, "check": declared})) == [
            ("INVALID_SETTING_TYPE", message, fix, "variables.row")
        ]

    def test_a_stored_table_fits_a_table_variable(self) -> None:
        orders = {"columns": [{"name": "id", "type": "integer"}], "rows": [["1"]]}
        data = _node({"variables": {"orders": orders}}, elementType=_SETTER)

        assert _findings(data, {"orders": "table"}) == []

    def test_a_retyped_number_row_keeps_the_number_rule_text(self) -> None:
        data = _node({"variables": {"n": ["1"], "ratio": {"a": 1}}}, elementType=_SETTER)

        assert _seen(_findings(data, {"n": "integer", "ratio": "float"})) == [
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'n' is not a valid integer",
                "Provide an integer value",
                "variables.n",
            ),
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'ratio' is not a valid float",
                "Provide a float value",
                "variables.ratio",
            ),
        ]

    @pytest.mark.parametrize(
        "value",
        [None, _SEALED, MASK_PLACEHOLDER],
        ids=["null", "sealed-secret", "mask-placeholder"],
    )
    def test_a_row_that_holds_no_literal_fits_any_declared_type(self, value: Any) -> None:
        data = _node({"variables": {"ready": value, "hosts": value}}, elementType=_SETTER)

        assert _findings(data, {"ready": "boolean", "hosts": "array"}) == []

    def test_a_typed_item_of_a_literal_list_row_is_held_to_its_type(self) -> None:
        data = _node(
            {"variables": {"ports": ["80", "x"]}},
            elementType=_SETTER,
            elementTypes={"variables.ports": ["integer", "integer"]},
        )

        assert _seen(_findings(data, {"ports": "array"})) == [
            (
                "INVALID_VARIABLE_VALUE",
                "Value for variable 'ports' at item 2 is not a valid integer",
                "Provide an integer value",
                "variables.ports",
            )
        ]

    def test_a_flagged_entry_is_not_a_literal_to_check(self) -> None:
        data = _node(
            {"variables": {"limits": {"max": "base * 2", "min": "1"}, "ports": ["80", "port"]}},
            elementType=_SETTER,
            expressionFields=["variables.limits.max", "variables.ports.1"],
            elementTypes={
                "variables.limits": {"max": "float", "min": "float"},
                "variables.ports": ["integer", "integer"],
            },
        )

        assert _findings(data, {"limits": "map", "ports": "array"}) == []

    def test_a_template_row_on_a_variable_that_is_not_text_is_refused(self) -> None:
        data = _node(
            {"variables": {"ready": "{{ answer }}", "attempts": "{{ answer }}"}},
            elementType=_SETTER,
            templateFields=["variables.ready", "variables.attempts"],
        )

        assert _seen(_findings(data, {"ready": "boolean", "attempts": "integer"})) == [
            (
                "TEMPLATE_NOT_STRING",
                "Row 'ready' sets a boolean variable; a template builds text, "
                "so it needs a string variable",
                None,
                "variables.ready",
            ),
            (
                "TEMPLATE_NOT_STRING",
                "Row 'attempts' sets an integer variable; a template builds text, "
                "so it needs a string variable",
                None,
                "variables.attempts",
            ),
        ]

    def test_a_template_entry_on_an_entry_type_that_is_not_text_is_refused(self) -> None:
        data = _node(
            {
                "variables": {
                    "limits": {"max": "{{ top }}", "min": "1"},
                    "tags": {"env": "{{ stage }}"},
                    "ports": ["80", "{{ port }}"],
                }
            },
            elementType=_SETTER,
            templateFields=["variables.limits.max", "variables.tags.env", "variables.ports.1"],
            elementTypes={
                "variables.limits": {"max": "float", "min": "float"},
                "variables.tags": {"env": "string"},
                "variables.ports": ["integer", "integer"],
            },
        )

        declared = {"limits": "map", "tags": "map", "ports": "array"}
        assert _seen(_findings(data, declared)) == [
            (
                "TEMPLATE_NOT_STRING",
                "Entry 'max' of row 'limits' is float; a template builds text, "
                "so it needs element type string",
                None,
                "variables.limits.max",
            ),
            (
                "TEMPLATE_NOT_STRING",
                "Entry '1' of row 'ports' is integer; a template builds text, "
                "so it needs element type string",
                None,
                "variables.ports.1",
            ),
        ]


class TestConditionRows:
    """A literal compare-to value of a number row follows the rule, at any depth."""

    def test_an_assert_row_is_refused_by_its_place(self) -> None:
        expression = {"type": "expression", "expression": "count > 1"}
        data = _node({"assertions": [_row("integer", "1e3"), _AND, expression]})

        assert _seen(_findings(data)) == [
            _compare("assertions.0.reference_value", "is not a valid integer")
        ]

    def test_a_row_inside_a_group_is_refused_by_its_place(self) -> None:
        group = {"type": "group", "items": [_row("integer", "5"), _AND, _row("float", "1e3")]}
        data = _node({"conditions": [group]})

        assert _seen(_findings(data)) == [
            _compare(
                "conditions.0.items.2.reference_value",
                "is not a valid float",
                "Provide a float value",
            )
        ]

    def test_a_branch_row_is_refused_by_its_place(self) -> None:
        data = _node({"branches": [{"conditions": []}, {"conditions": [_row("integer", "x")]}]})

        assert _seen(_findings(data)) == [
            _compare("branches.1.conditions.0.reference_value", "is not a valid integer")
        ]

    def test_a_filter_row_names_the_cell(self) -> None:
        row = _row("float", "1.2345678901234567890123456789", variable="_cell")
        data = _node({"filters": [{"column": {"mode": "name", "value": "a"}, "conditions": [row]}]})

        assert _seen(_findings(data)) == [
            (
                "INVALID_COMPARE_VALUE",
                "The value compared with the cell allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                "filters.0.conditions.0.reference_value",
            )
        ]

    def test_a_length_is_a_whole_number(self) -> None:
        data = _node({"assertions": [_row("array", "2.5", operator="length_equals")]})

        assert _seen(_findings(data)) == [
            _compare("assertions.0.reference_value", "is not a valid integer")
        ]

    @pytest.mark.parametrize(
        "row",
        [
            _row("integer", "30"),
            _row("float", "2.50"),
            _row("integer", "limit + 1", expression=True),
            _row("integer", "x", operator="is_null"),
            _row("string", "1e3"),
            _row("array", "x", operator="contains"),
            {"type": "expression", "expression": "count > 1"},
        ],
        ids=[
            "digits",
            "float-text",
            "expression",
            "unary",
            "text-row",
            "array-contains",
            "expression-row",
        ],
    )
    def test_a_row_that_is_not_a_number_literal_or_follows_the_rule_passes(
        self, row: dict[str, Any]
    ) -> None:
        assert _findings(_node({"assertions": [row]})) == []


class TestConditionItems:
    """Every condition item is checked at Save and named by its full place."""

    def test_an_item_with_no_type_is_missing(self) -> None:
        data = _node({"assertions": [_without(_item(), "type")]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'assertions.0.type' is missing",
                None,
                "assertions.0.type",
            )
        ]

    def test_an_unknown_item_type_is_refused(self) -> None:
        data = _node({"assertions": [{"id": "c1", "type": "clause"}]})

        assert _seen(_findings(data)) == [
            (
                "INVALID_CONDITION",
                "Unknown assertion item type: 'clause'",
                None,
                "assertions.0.type",
            )
        ]

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param({"id": "c1", "type": "expression"}, id="absent"),
            pytest.param({"id": "c1", "type": "expression", "expression": None}, id="null"),
        ],
    )
    def test_an_expression_item_with_no_expression_is_missing(self, item: dict[str, Any]) -> None:
        data = _node({"assertions": [item]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'assertions.0.expression' is missing",
                None,
                "assertions.0.expression",
            )
        ]

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "spaces"])
    def test_a_blank_expression_is_empty(self, text: str) -> None:
        data = _node({"assertions": [{"id": "c1", "type": "expression", "expression": text}]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'assertions.0.expression' is empty",
                None,
                "assertions.0.expression",
            )
        ]

    def test_a_group_with_no_items_is_empty(self) -> None:
        data = _node({"conditions": [_item(), _AND, {"id": "g1", "type": "group", "items": []}]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'conditions.2.items' is empty",
                None,
                "conditions.2.items",
            )
        ]

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param(_without(_item(), "variable"), id="absent"),
            pytest.param(_item(variable=None), id="null"),
        ],
    )
    def test_a_literal_with_no_variable_is_missing(self, item: dict[str, Any]) -> None:
        data = _node({"assertions": [item]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'assertions.0.variable' is missing",
                None,
                "assertions.0.variable",
            )
        ]

    @pytest.mark.parametrize("variable", ["", "   "], ids=["empty", "spaces"])
    def test_a_blank_variable_is_empty(self, variable: str) -> None:
        branch = {
            "id": "b0",
            "type": "if",
            "conditions": [_item(), _AND, _item(id="c2", variable=variable)],
        }
        data = _node({"branches": [branch]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'branches.0.conditions.2.variable' is empty",
                None,
                "branches.0.conditions.2.variable",
            )
        ]

    @pytest.mark.parametrize(
        "item",
        [
            pytest.param(_without(_item(), "operator"), id="absent"),
            pytest.param(_item(operator=None), id="null"),
        ],
    )
    def test_a_literal_with_no_operator_is_missing(self, item: dict[str, Any]) -> None:
        data = _node({"assertions": [item]})

        assert _seen(_findings(data)) == [
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'assertions.0.operator' is missing",
                None,
                "assertions.0.operator",
            )
        ]

    def test_an_unknown_value_type_is_refused(self) -> None:
        # is null / is not null answer before the value type is read, so they never refuse it.
        items = [
            _item(value_type="decimal"),
            _AND,
            _item(id="c2", value_type="decimal", operator="is_null"),
        ]

        assert _seen(_findings(_node({"assertions": items}))) == [
            ("INVALID_CONDITION", "Unknown value type: 'decimal'", None, "assertions.0.value_type")
        ]

    @pytest.mark.parametrize(
        ("value_type", "operator", "reference", "message"),
        [
            pytest.param(
                "integer",
                "starts_with",
                "5",
                "Unknown operator 'starts_with' for type 'integer'",
                id="integer-starts-with",
            ),
            pytest.param(
                "boolean",
                "equals",
                "true",
                "Unknown operator 'equals' for type 'boolean'",
                id="boolean-equals",
            ),
        ],
    )
    def test_an_operator_the_type_does_not_offer_is_refused(
        self, value_type: str, operator: str, reference: str, message: str
    ) -> None:
        offered = {"variable": "count", "value_type": value_type, "operator": "is_not_null"}
        items = [
            _item(
                variable="count",
                value_type=value_type,
                operator=operator,
                reference_value=reference,
            ),
            _AND,
            _item(id="c2", **offered),
        ]

        assert _seen(_findings(_node({"assertions": items}))) == [
            ("INVALID_CONDITION", message, None, "assertions.0.operator")
        ]

    def test_both_flags_on_one_compare_to_are_refused(self) -> None:
        item = _item(
            reference_value="{{ name }}",
            reference_is_expression=True,
            reference_is_template=True,
        )

        assert _seen(_findings(_node({"assertions": [item]}))) == [
            (
                "INVALID_CONDITION",
                "The value compared with 'host' cannot be both an expression and a template",
                None,
                "assertions.0.reference_value",
            )
        ]

    @pytest.mark.parametrize(
        ("variable", "value_type", "operator", "message"),
        [
            pytest.param(
                "count",
                "integer",
                "equals",
                "The value compared with 'count' is integer; a template builds text, "
                "so it needs type string",
                id="integer",
            ),
            pytest.param(
                "ratio",
                "float",
                "less_than",
                "The value compared with 'ratio' is float; a template builds text, "
                "so it needs type string",
                id="float",
            ),
            pytest.param(
                "items",
                "array",
                "length_equals",
                "The value compared with 'items' is integer; a template builds text, "
                "so it needs type string",
                id="array-length",
            ),
        ],
    )
    def test_a_template_on_a_number_compare_to_is_refused(
        self, variable: str, value_type: str, operator: str, message: str
    ) -> None:
        item = _item(
            variable=variable,
            value_type=value_type,
            operator=operator,
            reference_value="{{ limit }}",
            reference_is_template=True,
        )

        assert _seen(_findings(_node({"assertions": [item]}))) == [
            ("TEMPLATE_NOT_STRING", message, None, "assertions.0.reference_value")
        ]

    @pytest.mark.parametrize(
        ("value_type", "operator"),
        [
            pytest.param("string", "starts_with", id="string"),
            pytest.param("array", "contains", id="array-contains"),
            pytest.param("map", "has_key", id="map-has-key"),
        ],
    )
    def test_a_template_on_a_text_compare_to_is_allowed(
        self, value_type: str, operator: str
    ) -> None:
        item = _item(
            value_type=value_type,
            operator=operator,
            reference_value="{{ prefix }}-1",
            reference_is_template=True,
        )

        assert _findings(_node({"assertions": [item]})) == []

    @pytest.mark.parametrize("absent", [True, False], ids=["absent", "null"])
    @pytest.mark.parametrize("form", _COMPARE_FORMS)
    def test_a_missing_compare_to_is_refused_in_literal_expression_and_template_form(
        self, form: dict[str, Any], absent: bool
    ) -> None:
        item = _item(**form)
        item = _without(item, "reference_value") if absent else {**item, "reference_value": None}

        assert _seen(_findings(_node({"conditions": [item]}))) == [
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'conditions.0.reference_value' is missing",
                None,
                "conditions.0.reference_value",
            )
        ]

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "spaces"])
    @pytest.mark.parametrize("form", _FLAGGED_COMPARE_FORMS)
    def test_a_blank_compare_to_is_refused_in_expression_and_template_form(
        self, form: dict[str, Any], text: str
    ) -> None:
        item = _item(reference_value=text, **form)

        assert _seen(_findings(_node({"conditions": [item]}))) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'conditions.0.reference_value' is empty",
                None,
                "conditions.0.reference_value",
            )
        ]

    @pytest.mark.parametrize("text", ["", "   "], ids=["empty", "spaces"])
    def test_literal_text_on_a_text_compare_is_a_value(self, text: str) -> None:
        # Empty text typed on purpose compares with empty text (FIELD-4).
        assert _findings(_node({"conditions": [_item(reference_value=text)]})) == []

    def test_empty_text_on_a_number_compare_is_empty(self) -> None:
        item = _item(variable="count", value_type="integer", reference_value="")

        assert _seen(_findings(_node({"conditions": [item]}))) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'conditions.0.reference_value' is empty",
                None,
                "conditions.0.reference_value",
            )
        ]

    def test_a_fresh_literal_item_names_its_variable_and_its_compare_to(self) -> None:
        item = _without(_item(variable=""), "reference_value")

        assert _seen(_findings(_node({"assertions": [item]}))) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'assertions.0.variable' is empty",
                None,
                "assertions.0.variable",
            ),
            (
                "REQUIRED_PARAM_MISSING",
                "Required parameter 'assertions.0.reference_value' is missing",
                None,
                "assertions.0.reference_value",
            ),
        ]

    @pytest.mark.parametrize(("value_type", "operator"), _NO_VALUE_OPERATORS)
    def test_a_compare_to_under_an_operator_that_takes_none_is_never_checked(
        self, value_type: str, operator: str
    ) -> None:
        takes_none = {"variable": "count", "value_type": value_type, "operator": operator}
        items = [
            _item(
                reference_value="1e3",
                reference_is_expression=True,
                reference_is_template=True,
                **takes_none,
            ),
            _AND,
            _item(id="c2", reference_value="", **takes_none),
            _AND,
            _without(_item(id="c3", **takes_none), "reference_value"),
        ]

        assert _findings(_node({"assertions": items})) == []

    def test_an_item_three_groups_deep_is_named_by_its_full_place(self) -> None:
        inner = {
            "id": "g2",
            "type": "group",
            "items": [
                _item(id="c3"),
                _AND,
                _item(id="c4", reference_value="", reference_is_expression=True),
            ],
        }
        outer = {"id": "g1", "type": "group", "items": [inner]}
        branch = {"id": "b0", "type": "if", "conditions": [_item(), _AND, outer]}

        assert _seen(_findings(_node({"branches": [branch]}))) == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Required parameter 'branches.0.conditions.2.items.0.items.2.reference_value'"
                " is empty",
                None,
                "branches.0.conditions.2.items.0.items.2.reference_value",
            )
        ]

    @pytest.mark.parametrize(
        ("item", "seen"),
        [
            pytest.param(
                _item(
                    variable="_cell",
                    value_type="integer",
                    operator="greater_than",
                    reference_value="{{ floor }}",
                    reference_is_template=True,
                ),
                (
                    "TEMPLATE_NOT_STRING",
                    "The value compared with the cell is integer; a template builds text, "
                    "so it needs type string",
                    None,
                    "filters.0.conditions.0.reference_value",
                ),
                id="template-on-a-number",
            ),
            pytest.param(
                _item(
                    variable="_cell",
                    reference_value="{{ name }}",
                    reference_is_expression=True,
                    reference_is_template=True,
                ),
                (
                    "INVALID_CONDITION",
                    "The value compared with the cell cannot be both an expression and a template",
                    None,
                    "filters.0.conditions.0.reference_value",
                ),
                id="both-flags",
            ),
        ],
    )
    def test_a_filter_item_names_the_cell(self, item: dict[str, Any], seen: Seen) -> None:
        data = _node({"filters": [_filter([item], item["value_type"])]})

        assert _seen(_findings(data)) == [seen]

    def test_a_filter_item_is_held_to_the_operators_of_its_column_type(self) -> None:
        conditions = [
            _item(
                variable="_cell",
                value_type="integer",
                operator="starts_with",
                reference_value="5",
            ),
            _AND,
            _item(id="c2", variable="_cell", value_type="decimal"),
        ]
        check_places = [finding.field for finding in _findings(_node({"assertions": conditions}))]

        assert _seen(_findings(_node({"filters": [_filter(conditions)]}))) == [
            (
                "INVALID_CONDITION",
                "Unknown filter operator: 'starts_with'",
                None,
                "filters.0.conditions.0.operator",
            )
        ]
        assert check_places == ["assertions.0.operator", "assertions.2.value_type"]

    @pytest.mark.parametrize(
        ("as_type", "operator"),
        [
            pytest.param("integer", "contains", id="contains-on-integer"),
            pytest.param("float", "matches_regex", id="regex-on-float"),
            pytest.param("string", "greater_than", id="greater-on-string"),
            pytest.param("boolean", "equals", id="equals-on-boolean"),
            pytest.param("integer", "bogus", id="unknown-word"),
        ],
    )
    def test_a_filter_operator_its_column_type_does_not_offer_is_refused_with_the_run_text(
        self, as_type: str, operator: str
    ) -> None:
        from wavecore.core.table import ColumnType, validate_filter_operator

        item = _item(variable="_cell", value_type=as_type, operator=operator, reference_value="1")
        with pytest.raises(ValueError) as refused:
            validate_filter_operator(ColumnType(as_type), operator)

        assert _seen(_findings(_node({"filters": [_filter([item], as_type)]}))) == [
            ("INVALID_CONDITION", str(refused.value), None, "filters.0.conditions.0.operator")
        ]
        assert str(refused.value) == f"Unknown filter operator: '{operator}'"

    def test_a_filter_item_inside_a_group_is_held_to_its_column_type(self) -> None:
        inner = _item(variable="_cell", value_type="integer", operator="contains")
        group = {"id": "g1", "type": "group", "items": [inner]}

        assert _seen(_findings(_node({"filters": [_filter([group])]}))) == [
            (
                "INVALID_CONDITION",
                "Unknown filter operator: 'contains'",
                None,
                "filters.0.conditions.0.items.0.operator",
            )
        ]

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null"])
    def test_a_null_check_is_offered_on_every_column_type(self, operator: str) -> None:
        item = _without(_item(variable="_cell", operator=operator), "reference_value")

        assert _findings(_node({"filters": [_filter([item], "boolean")]})) == []

    @pytest.mark.parametrize("as_type", ["decimal", None], ids=["unknown-type", "no-type"])
    def test_a_filter_with_no_known_column_type_leaves_its_operators_alone(
        self, as_type: str | None
    ) -> None:
        item = _item(
            variable="_cell", value_type="integer", operator="contains", reference_value="1"
        )
        holder = {**_filter([item]), "asType": as_type}

        assert _findings(_node({"filters": [holder]})) == []


_OR = {"type": "operator", "value": "or"}
_STRAY_JOIN = "'and' and 'or' go between two conditions"


def _not_joined(place: str, item: str) -> Seen:
    message = f"Condition items in '{place}' must be joined by 'and' or 'or'"
    return ("INVALID_CONDITION", message, None, item)


def _stray_join(item: str) -> Seen:
    return ("INVALID_CONDITION", _STRAY_JOIN, None, item)


def _cell_item(item_id: str) -> dict[str, Any]:
    return _item(
        id=item_id,
        variable="_cell",
        value_type="integer",
        operator="greater_than",
        reference_value="5",
    )


class TestConditionJoins:
    """A condition list alternates item, and / or, item at every group depth (REQ-3.5.1.5)."""

    @pytest.mark.parametrize(
        ("values", "seen"),
        [
            pytest.param(
                {"conditions": [_item(), _item(id="c2"), _item(id="c3")]},
                _not_joined("conditions", "conditions.1"),
                id="side-by-side",
            ),
            pytest.param(
                {
                    "assertions": [
                        _item(),
                        _AND,
                        {"id": "g1", "type": "group", "items": [_item(id="c2"), _item(id="c3")]},
                    ]
                },
                _not_joined("assertions.2.items", "assertions.2.items.1"),
                id="side-by-side-in-a-group",
            ),
            pytest.param(
                {"branches": [{"id": "b0", "type": "if", "conditions": [_item(), _item(id="c2")]}]},
                _not_joined("branches.0.conditions", "branches.0.conditions.1"),
                id="side-by-side-in-a-branch",
            ),
            pytest.param(
                {"filters": [_filter([_cell_item("c1"), _cell_item("c2")])]},
                _not_joined("filters.0.conditions", "filters.0.conditions.1"),
                id="side-by-side-in-a-filter",
            ),
            pytest.param(
                {"conditions": [_AND, _item()]},
                _stray_join("conditions.0"),
                id="marker-first",
            ),
            pytest.param(
                {"conditions": [_item(), _OR]},
                _stray_join("conditions.1"),
                id="marker-last",
            ),
            pytest.param(
                {"conditions": [_item(), _AND, _OR, _item(id="c2")]},
                _stray_join("conditions.2"),
                id="marker-doubled",
            ),
        ],
    )
    def test_a_list_out_of_order_is_refused_once_at_its_first_break(
        self, values: dict[str, Any], seen: Seen
    ) -> None:
        assert _seen(_findings(_node(values))) == [seen]

    def test_a_list_joined_at_every_depth_is_clean(self) -> None:
        group = {"id": "g1", "type": "group", "items": [_item(id="c2"), _OR, _item(id="c3")]}
        expression = {"id": "e1", "type": "expression", "expression": "count > 1"}
        values = {
            "assertions": [_item(), _AND, group, _OR, expression],
            "filters": [_filter([_cell_item("c4"), _AND, _cell_item("c5")])],
        }

        assert _findings(_node(values)) == []


class TestControlStructureRows:
    """The structure rules of the registered control join the one row walk."""

    def setup_method(self) -> None:
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    @pytest.mark.parametrize(
        ("element_type", "values", "data", "expected"),
        [
            pytest.param(
                "if-else",
                {
                    "branches": [
                        {"id": "b0", "type": "if", "label": "", "conditions": []},
                        {"id": "b1", "type": "else", "label": "", "conditions": []},
                    ]
                },
                {},
                [
                    (
                        "REQUIRED_PARAM_EMPTY",
                        "if branch must have conditions",
                        None,
                        "branches.0.conditions",
                    )
                ],
                id="if-else-empty-if",
            ),
            pytest.param(
                "switch-case",
                {"branches": [{"id": "d0", "type": "default", "label": "", "conditions": []}]},
                {},
                [
                    (
                        "INVALID_CONTROL_STRUCTURE",
                        "at least one case branch is required",
                        None,
                        "branches",
                    )
                ],
                id="switch-no-case",
            ),
            pytest.param(
                "parallel",
                {"branches": [_lane("l0", "A")], "join": "all"},
                {},
                [
                    (
                        "INVALID_CONTROL_STRUCTURE",
                        "Parallel requires at least 2 branches",
                        None,
                        "branches",
                    )
                ],
                id="parallel-one-lane",
            ),
            pytest.param(
                "parallel",
                {
                    "branches": [_lane("l0", "A", time_limit=500), _lane("l1", "B", time_limit=0)],
                    "join": "all",
                },
                {},
                [
                    (
                        "INVALID_SETTING_VALUE",
                        "Parallel branch time limit must be a positive integer",
                        None,
                        "branches.1.time_limit",
                    )
                ],
                id="parallel-lane-limit-zero",
            ),
            pytest.param(
                "parallel",
                {
                    "branches": [_lane("l0", "A"), _lane("l1", "B", time_limit="")],
                    "join": "all",
                },
                {"expressionFields": ["branches.1.time_limit"]},
                [
                    (
                        "REQUIRED_PARAM_EMPTY",
                        "Required parameter 'branches.1.time_limit' is empty",
                        None,
                        "branches.1.time_limit",
                    )
                ],
                id="parallel-blank-expression-lane-limit",
            ),
            pytest.param(
                "for",
                {"mode": "count", "count": 3, "step": 0},
                {},
                [("INVALID_SETTING_VALUE", "step must not be zero", None, "step")],
                id="for-step-zero",
            ),
            pytest.param(
                "for",
                {"mode": "count", "count": -1, "step": 1},
                {},
                [],
                id="for-count-floor-is-a-field-finding",
            ),
            pytest.param(
                "while",
                {
                    "mode": "while-do",
                    "conditions": [
                        _item(variable="count", value_type="integer", reference_value=3)
                    ],
                    "max_iterations": 0,
                },
                {},
                [],
                id="while-max-iterations-floor-is-a-field-finding",
            ),
            pytest.param(
                "parallel",
                {
                    "branches": [_lane("l0", "A"), _lane("l1", "B")],
                    "join": "all",
                    "time_limit": 0,
                },
                {},
                [],
                id="parallel-section-floor-is-a-field-finding",
            ),
        ],
    )
    def test_the_registered_control_rules_are_reported_with_codes_and_places(
        self,
        element_type: str,
        values: dict[str, Any],
        data: dict[str, Any],
        expected: list[Seen],
    ) -> None:
        node = _node(values, elementType=element_type, version="1.0.0", **data)

        assert _seen(_findings(node)) == expected

    @pytest.mark.parametrize(
        ("element_type", "values", "data"),
        [
            pytest.param(
                "for",
                {"mode": "count", "count": 3, "step": "0"},
                {"expressionFields": ["step"]},
                id="for-step-expression",
            ),
            pytest.param(
                "for",
                {"mode": "count", "count": 3, "step": "{{ zero }}"},
                {"templateFields": ["step"]},
                id="for-step-template",
            ),
            pytest.param(
                "parallel",
                {
                    "branches": [_lane("l0", "A"), _lane("l1", "B", time_limit="0")],
                    "join": "all",
                },
                {"expressionFields": ["branches.1.time_limit"]},
                id="lane-limit-expression",
            ),
            pytest.param(
                "parallel",
                {
                    "branches": [_lane("l0", "A"), _lane("l1", "B", time_limit="{{ ms }}")],
                    "join": "all",
                },
                {"templateFields": ["branches.1.time_limit"]},
                id="lane-limit-template",
            ),
        ],
    )
    def test_a_flagged_place_is_skipped_by_every_rule(
        self, element_type: str, values: dict[str, Any], data: dict[str, Any]
    ) -> None:
        node = _node(values, elementType=element_type, version="1.0.0", **data)

        assert _findings(node) == []

    @pytest.mark.parametrize(
        ("element_type", "version"),
        [
            pytest.param("csv-parser", "1.0.0", id="plugin"),
            pytest.param("not-a-block", "1.0.0", id="unknown-type"),
            pytest.param("if-else", "9.9.9", id="unregistered-version"),
        ],
    )
    def test_a_block_that_is_no_registered_control_has_no_structure_rows(
        self, element_type: str, version: str
    ) -> None:
        values = {"branches": [{"id": "b0", "type": "else", "label": "", "conditions": []}]}
        node = _node(values, elementType=element_type, version=version)

        assert _findings(node) == []


_LITERAL_KEYS = (
    "id, operator, reference_is_expression, reference_is_template, reference_value, type, "
    "value_type, variable"
)


def _unknown_key(block_id: str, place: str, keys: str) -> Seen:
    return (
        "UNKNOWN_SETTING",
        f"Block '{block_id}' has no setting '{place}'",
        f"Valid keys: {keys}",
        place,
    )


class TestUnknownShapeKeys:
    """A condition item, branch or lane holds only its shape's keys, at any depth; the save
    refuses any other one, as it refuses an unknown setting (REQ-3.5.0.3, REQ-3.5.1.5)."""

    def setup_method(self) -> None:
        from wavecore.controls.registry import _registry, register_all_core_controls

        _registry.clear()
        register_all_core_controls(_registry)

    @pytest.mark.parametrize(
        ("element_type", "values", "seen"),
        [
            pytest.param(
                "assert",
                {"assertions": [_item(shade="blue")]},
                _unknown_key("assert", "assertions.0.shade", _LITERAL_KEYS),
                id="literal-item",
            ),
            pytest.param(
                "while",
                {
                    "conditions": [
                        {"id": "g1", "type": "group", "items": [_item(), _AND, _item(id="c2")]},
                        _AND,
                        {"id": "e1", "type": "expression", "expression": "n > 1", "note": "x"},
                    ]
                },
                _unknown_key("while", "conditions.2.note", "expression, id, type"),
                id="expression-item",
            ),
            pytest.param(
                "while",
                {
                    "conditions": [
                        {"id": "g1", "type": "group", "items": [_item(), _AND, _item(open=True)]}
                    ]
                },
                _unknown_key("while", "conditions.0.items.2.open", _LITERAL_KEYS),
                id="item-in-a-group",
            ),
            pytest.param(
                "while",
                {"conditions": [{"id": "g1", "type": "group", "items": [_item()], "open": 1}]},
                _unknown_key("while", "conditions.0.open", "id, items, type"),
                id="group",
            ),
            pytest.param(
                "assert",
                {
                    "assertions": [
                        _item(),
                        {"id": "j1", "type": "operator", "value": "and"},
                        _item(),
                    ]
                },
                _unknown_key("assert", "assertions.1.id", "type, value"),
                id="join",
            ),
            pytest.param(
                "if-else",
                {
                    "branches": [
                        {"id": "b0", "type": "if", "label": "", "conditions": [_item()], "x": 1},
                        {"id": "b1", "type": "else", "label": ""},
                    ]
                },
                _unknown_key("if-else", "branches.0.x", "break, conditions, id, label, type"),
                id="branch",
            ),
            pytest.param(
                "parallel",
                {"branches": [_lane("l0", "A", shade=1), _lane("l1", "B")], "join": "all"},
                _unknown_key("parallel", "branches.0.shade", "id, name, time_limit"),
                id="lane",
            ),
            pytest.param(
                "csv-parser",
                {"filters": [_filter([_item(variable="_cell", reference_value="1", x=0)])]},
                _unknown_key("csv-parser", "filters.0.conditions.0.x", _LITERAL_KEYS),
                id="filter-item",
            ),
        ],
    )
    def test_a_key_its_shape_does_not_hold_is_refused_at_its_place(
        self, element_type: str, values: dict[str, Any], seen: Seen
    ) -> None:
        node = _node(values, elementType=element_type, version="1.0.0")

        assert _seen(_findings(node, {"host": "string"})) == [seen]

    def test_the_shapes_the_windows_write_are_clean(self) -> None:
        literal = _item(reference_is_expression=False, reference_is_template=False)
        group = {"id": "g1", "type": "group", "items": [literal, _AND, _item(id="c2")]}
        expression = {"id": "e1", "type": "expression", "expression": "n > 1"}
        switch = {
            "branches": [
                {"id": "c0", "type": "case", "label": "", "conditions": [literal], "break": True},
                {"id": "d0", "type": "default", "label": ""},
            ]
        }
        lanes = {"branches": [_lane("l0", "A", time_limit=500), _lane("l1", "B")], "join": "all"}

        assert (
            _findings(_node({"conditions": [group, _AND, expression]}, elementType="while")) == []
        )
        assert _findings(_node(switch, elementType="switch-case")) == []
        assert _findings(_node(lanes, elementType="parallel")) == []

    def test_an_item_of_an_unknown_type_is_named_by_its_type_only(self) -> None:
        values = {"assertions": [{"id": "c1", "type": "clause", "shade": 1}]}

        assert [seen[0] for seen in _seen(_findings(_node(values)))] == ["INVALID_CONDITION"]


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

        assert _seen(_findings(data)) == [
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

        assert _findings(data) == []


def test_a_block_with_no_values_has_no_literal_rows() -> None:
    assert _findings({}) == []


class TestStoredSetterRows:
    """A literal setter row stores its number by the declared type of its variable."""

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
            elementType=_SETTER,
            elementTypes={"variables.limits": {"max": "float"}},
            expressionFields=["variables.e"],
        )
        declared = {
            "rate": "float",
            "big": "integer",
            "whole": "float",
            "limits": "map",
            "e": "float",
        }

        assert _stored_rows(data, declared)["variables"] == {
            "rate": "0.0000001",
            "big": "1234567890123456789",
            "whole": "30.0",
            "limits": {"max": "0.0000001"},
            "e": 1e-07,
            "free": 1e-07,
        }

    def test_rows_of_another_shape_stay_as_given(self) -> None:
        data = _node({"variables": [1e-07]}, elementType=_SETTER)

        assert _stored_rows(data) == {"variables": [1e-07]}


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
            _row("string", 1e-07),
            _row("array", 1e-07, operator="contains"),
        ],
        ids=["expression", "text-row", "array-contains"],
    )
    def test_a_row_that_holds_no_typed_number_stays_as_given(self, row: dict[str, Any]) -> None:
        assert _stored_rows(_node({"assertions": [row]})) == {"assertions": [row]}

    @pytest.mark.parametrize(("value_type", "operator"), _NO_VALUE_OPERATORS)
    @pytest.mark.parametrize("form", [text_as_number, stored_number], ids=["read", "stored"])
    def test_a_row_on_an_operator_that_takes_no_value_keeps_no_compare_to_value(
        self, value_type: str, operator: str, form: Any
    ) -> None:
        def given() -> dict[str, Any]:
            row = _row(value_type, "", operator=operator, expression=True)
            return {**row, "reference_is_template": False}

        kept = {
            "type": "literal",
            "variable": "count",
            "value_type": value_type,
            "operator": operator,
        }
        values = {
            "assertions": [given()],
            "conditions": [{"type": "group", "items": [given()]}],
            "branches": [{"conditions": [given()]}],
            "filters": [{"conditions": [given()]}],
        }

        assert row_checks.literal_row_numbers(_node(values), form, {}) == {
            "assertions": [kept],
            "conditions": [{"type": "group", "items": [kept]}],
            "branches": [{"conditions": [kept]}],
            "filters": [{"conditions": [kept]}],
        }

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
        elementType=_SETTER,
    )

    read = row_checks.literal_row_numbers(data, text_as_number, {"n": "integer"})

    assert [
        read["variables"],
        read["assertions"][0]["reference_value"],
        read["sorts"][0]["column"]["value"],
    ] == [{"n": 30, "free": "30"}, Decimal("2.50"), 2]
