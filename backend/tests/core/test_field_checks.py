"""Unit tests for the one save-time field check every Block shares.

Requirements tested:
- REQ-3.1.1.5: every Block checks its fields one way (required, type, allowed values,
  bounds, unknown field, a blank {x} entry)
- REQ-3.4.2.2 / REQ-3.5.0.3: plugin and control parameter definitions drive the check
- REQ-3.1.2.11: allowed values are typed (String, Integer or Float)
- REQ-3.1.3.14: a save stores each literal number of a number field in its wire form
- REQ-3.1.3.19: typed list, map and table entries of a setting follow the rule by their types
"""

from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.execution.field_checks import (
    FieldFinding,
    block_value_numbers,
    check_block_fields,
    check_field_value,
    type_name,
)
from wavecore.core.table import Table
from wavecore.core.variables.value_checks import stored_number, text_as_number

Seen = tuple[str, str, str | None, str]

_SEALED = "wave:enc:v1:bm9uY2VjaXBoZXJ0ZXh0"
_MASKED = "********"


def _seen(findings: Iterable[FieldFinding]) -> list[Seen]:
    return [(f.code, f.message, f.fix, f.field) for f in findings]


def _check(
    fields: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    *,
    block_id: str = "f",
    expression_fields: Iterable[str] = (),
    template_fields: Iterable[str] = (),
    check_required: bool = True,
    element_types: Any = None,
) -> list[Seen]:
    return _seen(
        check_block_fields(
            fields,
            values,
            block_id=block_id,
            expression_fields=set(expression_fields),
            template_fields=set(template_fields),
            check_required=check_required,
            element_types=element_types,
        )
    )


def _stored_values(
    fields: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    *,
    expression_fields: Iterable[str],
    template_fields: Iterable[str],
    element_types: Any = None,
) -> dict[str, Any]:
    return block_value_numbers(
        fields,
        values,
        expression_fields=set(expression_fields),
        template_fields=set(template_fields),
        element_types=element_types,
        form=stored_number,
    )


def _value(field: Mapping[str, Any], value: Any, *, block_id: str = "f") -> list[Seen]:
    return _seen(check_field_value(field, str(field["name"]), value, block_id=block_id))


def _missing(name: str) -> Seen:
    return ("REQUIRED_PARAM_MISSING", f"Required parameter '{name}' is missing", None, name)


def _empty(name: str) -> Seen:
    return ("REQUIRED_PARAM_EMPTY", f"Required parameter '{name}' is empty", None, name)


def _wrong_type(name: str, expected: str, got: str, *, block_id: str = "f") -> Seen:
    return (
        "INVALID_SETTING_TYPE",
        f"Setting '{name}' of block '{block_id}' expects {expected}, got {got}",
        f"Provide {'an' if expected.startswith(('integer', 'array')) else 'a'} {expected} value",
        name,
    )


def _not_allowed(name: str, listed: str, *, block_id: str = "f") -> Seen:
    return (
        "INVALID_ENUM_VALUE",
        f"Setting '{name}' of block '{block_id}' must be one of: {listed}",
        "Use one of the listed values",
        name,
    )


_URL = {"name": "url", "type": "string", "required": True}
_K8S_KINDS = [
    {"name": "resource_type", "type": "string", "default": "default"},
    {
        "name": "kind",
        "type": "string",
        "required_when": {"field": "resource_type", "values": ["default"]},
    },
    {
        "name": "kind_custom",
        "type": "string",
        "required_when": {"field": "resource_type", "values": ["custom"]},
    },
]
_SCOPED_EVENTS = [
    {"name": "scoped", "type": "boolean", "default": False},
    {"name": "object_type", "type": "string", "default": "default"},
    {
        "name": "object_kind",
        "type": "string",
        "required_when_all": [
            {"field": "scoped", "values": ["true"]},
            {"field": "object_type", "values": ["default"]},
        ],
    },
]


class TestRequiredFields:
    """The Test save's required rule, the same at every depth and on every Block."""

    def test_a_required_field_left_out_is_missing(self) -> None:
        assert _check([_URL], {}) == [_missing("url")]

    def test_a_required_field_holding_null_is_missing(self) -> None:
        assert _check([_URL], {"url": None}) == [_missing("url")]

    def test_a_declared_default_fills_a_required_field_left_out(self) -> None:
        field = {**_URL, "default": "http://example.com"}

        assert _check([field], {}) == []

    def test_an_empty_text_default_counts_as_declared(self) -> None:
        field = {"name": "pattern", "type": "string", "required": True, "default": ""}

        assert _check([field], {}) == []

    def test_a_declared_default_does_not_excuse_an_empty_value(self) -> None:
        field = {**_URL, "default": "http://example.com"}

        assert _check([field], {"url": "   "}) == [_empty("url")]

    @pytest.mark.parametrize(
        ("field_type", "value"),
        [
            ("string", "   "),
            ("map", {}),
            ("array", []),
            ("table", []),
            ("table", "  "),
        ],
        ids=["blank-text", "empty-map", "empty-list", "empty-rows", "blank-table-text"],
    )
    def test_an_empty_value_of_the_field_type_is_empty(self, field_type: str, value: Any) -> None:
        field = {"name": "data", "type": field_type, "required": True}

        assert _check([field], {"data": value}) == [_empty("data")]

    @pytest.mark.parametrize(
        ("field_type", "value"),
        [
            ("string", "a"),
            ("integer", 0),
            ("float", 0.0),
            ("boolean", False),
            ("map", {"k": "v"}),
            ("array", [1]),
            ("table", [{"a": 1}]),
        ],
        ids=["text", "zero", "zero-float", "false", "map", "list", "rows"],
    )
    def test_a_value_that_is_not_empty_fills_the_field(self, field_type: str, value: Any) -> None:
        field = {"name": "data", "type": field_type, "required": True}

        assert _check([field], {"data": value}) == []

    def test_a_blank_whole_field_expression_in_a_required_field_is_empty(self) -> None:
        assert _check([_URL], {"url": "  "}, expression_fields={"url"}) == [_empty("url")]

    def test_an_expression_in_a_required_map_field_is_read_as_text(self) -> None:
        field = {"name": "headers", "type": "map", "required": True}

        assert _check([field], {"headers": "base_headers"}, expression_fields={"headers"}) == []

    def test_a_required_when_field_is_required_while_its_condition_holds(self) -> None:
        assert _check(_K8S_KINDS, {}) == [_missing("kind")]
        assert _check(_K8S_KINDS, {"resource_type": "custom"}) == [_missing("kind_custom")]
        assert _check(_K8S_KINDS, {"resource_type": "custom", "kind_custom": "widgets"}) == []

    def test_a_required_when_field_with_a_declared_default_is_not_missing(self) -> None:
        fields = [
            {**field, "default": "Pod"} if field["name"] == "kind" else field
            for field in _K8S_KINDS
        ]

        assert _check(fields, {}) == []

    def test_a_required_when_all_field_is_required_only_while_every_condition_holds(
        self,
    ) -> None:
        assert _check(_SCOPED_EVENTS, {"scoped": True}) == [_missing("object_kind")]
        assert _check(_SCOPED_EVENTS, {"scoped": True, "object_type": "custom"}) == []
        assert _check(_SCOPED_EVENTS, {}) == []

    def test_check_required_off_skips_the_required_rule_only(self) -> None:
        fields = [_URL, {"name": "method", "type": "string"}]

        assert _check(fields, {}, check_required=False) == []
        assert _check(fields, {"nope": 1}, check_required=False) == [
            (
                "UNKNOWN_SETTING",
                "Block 'f' has no setting 'nope'",
                "Valid settings: method, url",
                "nope",
            )
        ]

    def test_a_required_field_reported_empty_gets_no_further_finding(self) -> None:
        field = {"name": "kind", "type": "string", "required": True, "enum_values": ["Pod", "Job"]}

        assert _check([field], {"kind": "   "}) == [_empty("kind")]


class TestUnknownFields:
    """A stored name the Block does not declare is a save error; the run ignores it."""

    def test_a_stored_name_the_block_does_not_declare_is_refused(self) -> None:
        fields = [{"name": "url", "type": "string"}, {"name": "method", "type": "string"}]

        assert _check(fields, {"url": "http://example.com", "nope": 1}) == [
            (
                "UNKNOWN_SETTING",
                "Block 'f' has no setting 'nope'",
                "Valid settings: method, url",
                "nope",
            )
        ]

    def test_each_unknown_name_is_refused(self) -> None:
        fields = [{"name": "url", "type": "string"}]

        assert sorted(_check(fields, {"extra": "x", "other": "y"}, block_id="http-client")) == [
            (
                "UNKNOWN_SETTING",
                "Block 'http-client' has no setting 'extra'",
                "Valid settings: url",
                "extra",
            ),
            (
                "UNKNOWN_SETTING",
                "Block 'http-client' has no setting 'other'",
                "Valid settings: url",
                "other",
            ),
        ]


class TestValueTypes:
    """A literal must fit the field's type, by the run's own type table."""

    @pytest.mark.parametrize(
        ("field_type", "value", "got"),
        [
            ("integer", "3.5", "string"),
            ("integer", " 3", "string"),
            ("integer", "+3", "string"),
            ("integer", "1_000", "string"),
            ("integer", 3.0, "float"),
            ("integer", True, "boolean"),
            ("boolean", 5, "integer"),
            ("float", "1e5", "string"),
            ("float", ".5", "string"),
            ("float", "NaN", "string"),
            ("string", 5, "integer"),
            ("array", {"a": 1}, "map"),
            ("map", ["a"], "array"),
            ("table", [1, 2], "array"),
        ],
        ids=[
            "fraction-text-for-integer",
            "spaced-text-for-integer",
            "plus-text-for-integer",
            "underscore-text-for-integer",
            "whole-float-for-integer",
            "boolean-for-integer",
            "integer-for-boolean",
            "exponent-text-for-float",
            "dot-first-text-for-float",
            "nan-text-for-float",
            "integer-for-text",
            "map-for-list",
            "list-for-map",
            "plain-items-for-table",
        ],
    )
    def test_a_value_of_another_type_is_refused(
        self, field_type: str, value: Any, got: str
    ) -> None:
        field = {"name": "retries", "type": field_type}

        assert _value(field, value) == [_wrong_type("retries", field_type, got)]

    @pytest.mark.parametrize(
        ("value", "got"),
        [
            (float("nan"), "NaN"),
            (float("inf"), "Infinity"),
            (float("-inf"), "-Infinity"),
            (Decimal("NaN"), "NaN"),
            (Decimal("sNaN"), "NaN"),
            (Decimal("Infinity"), "Infinity"),
            (Decimal("-Infinity"), "-Infinity"),
        ],
        ids=[
            "nan",
            "infinity",
            "minus-infinity",
            "decimal-nan",
            "decimal-signaling-nan",
            "decimal-infinity",
            "decimal-minus-infinity",
        ],
    )
    def test_a_number_that_is_not_finite_is_refused_before_its_bounds(
        self, value: Any, got: str
    ) -> None:
        field = {"name": "ratio", "type": "float", "minimum": 0, "maximum": 1}

        assert _value(field, value) == [_wrong_type("ratio", "float", got)]

    def test_a_field_of_several_types_names_them_all(self) -> None:
        field = {"name": "from", "type": ["string", "integer"]}

        assert _value(field, ["now-1h"], block_id="opensearch") == [
            _wrong_type("from", "string or integer", "array", block_id="opensearch")
        ]

    @pytest.mark.parametrize(
        ("field_type", "value"),
        [
            ("float", Decimal("2.5")),
            ("float", 2),
            ("integer", 3),
            ("string", ""),
            ("boolean", False),
            ("array", []),
            ("map", {}),
            ("table", [{"a": 1}, {"a": 2}]),
            ("table", []),
            ("table", Table.from_list([{"a": 1}])),
            ("integer", "30"),
            ("integer", "-7"),
            ("integer", "007"),
            ("integer", "1234567890123456789"),
            ("integer", -(10**19 - 1)),
            ("float", "2.50"),
            ("float", "30"),
            ("float", "0.0000001"),
            ("float", "1.234567890123456789012345678"),
            ("float", 10**27),
        ],
        ids=[
            "decimal-float",
            "integer-for-float",
            "integer",
            "empty-text",
            "false",
            "empty-list",
            "empty-map",
            "row-maps",
            "no-rows",
            "table",
            "digit-text",
            "negative-digit-text",
            "leading-zero-text",
            "19-digit-text",
            "19-digit-integer",
            "float-text-with-trailing-zero",
            "digit-text-for-float",
            "small-float-text",
            "28-significant-digit-text",
            "28-digit-integer-for-float",
        ],
    )
    def test_a_value_of_the_field_type_is_accepted(self, field_type: str, value: Any) -> None:
        assert _value({"name": "data", "type": field_type}, value) == []

    def test_text_for_a_text_or_integer_field_is_text(self) -> None:
        field = {"name": "from", "type": ["string", "integer"], "minimum": 0}

        assert _value(field, "-5") == []


class TestDigitCaps:
    """A number past 19 digits or 28 significant digits is refused by its count."""

    @pytest.mark.parametrize(
        "value",
        ["12345678901234567890", "-12345678901234567890", 10**19, -(10**19)],
        ids=["text", "negative-text", "integer", "negative-integer"],
    )
    def test_an_integer_past_19_digits_is_refused(self, value: Any) -> None:
        field = {"name": "count", "type": "integer", "maximum": 10}

        assert _value(field, value, block_id="ping") == [
            (
                "SETTING_TOO_MANY_DIGITS",
                "Setting 'count' of block 'ping' allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                "count",
            )
        ]

    @pytest.mark.parametrize(
        "value",
        ["1.2345678901234567890123456789", Decimal("1.2345678901234567890123456789"), 10**28],
        ids=["text", "decimal", "integer"],
    )
    def test_a_float_past_28_significant_digits_is_refused(self, value: Any) -> None:
        field = {"name": "ratio", "type": "float"}

        assert _value(field, value) == [
            (
                "SETTING_TOO_MANY_DIGITS",
                "Setting 'ratio' of block 'f' allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                "ratio",
            )
        ]

    def test_a_field_of_several_types_counts_the_digits_of_its_number_type(self) -> None:
        field = {"name": "from", "type": ["string", "integer"]}

        assert _value(field, 10**19, block_id="opensearch") == [
            (
                "SETTING_TOO_MANY_DIGITS",
                "Setting 'from' of block 'opensearch' allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                "from",
            )
        ]


class TestSeveralTypes:
    """A field that takes more than one type."""

    def test_one_of_several_types_is_accepted(self) -> None:
        field = {"name": "from", "type": ["string", "integer"]}

        assert _value(field, 15) == []
        assert _value(field, "now-1h") == []


class TestAllowedValues:
    """Allowed values are typed; a value outside them is refused."""

    def test_a_text_outside_the_list_is_refused(self) -> None:
        field = {"name": "level", "type": "string", "enum_values": ["low", "high"]}

        assert _value(field, "x") == [_not_allowed("level", "low, high")]

    def test_an_integer_outside_the_list_is_refused(self) -> None:
        field = {"name": "priority", "type": "integer", "enum_values": [1, 2]}

        assert _value(field, 3) == [_not_allowed("priority", "1, 2")]

    def test_a_float_outside_the_list_is_refused(self) -> None:
        field = {"name": "ratio", "type": "float", "enum_values": [0.5, 2.5]}

        assert _value(field, 1.5) == [_not_allowed("ratio", "0.5, 2.5")]

    @pytest.mark.parametrize(
        ("field_type", "allowed", "value"),
        [
            ("string", ["low", "high"], "low"),
            ("integer", [1, 2], 2),
            ("float", [0.5, 2.5], 2.5),
        ],
        ids=["text", "integer", "float"],
    )
    def test_a_listed_value_is_accepted(
        self, field_type: str, allowed: list[Any], value: Any
    ) -> None:
        field = {"name": "choice", "type": field_type, "enum_values": allowed}

        assert _value(field, value) == []

    def test_a_value_is_never_equal_to_an_allowed_signaling_nan(self) -> None:
        field = {"name": "ratio", "type": "float", "enum_values": ["1.5", "sNaN"]}

        assert _value(field, 2.5) == [_not_allowed("ratio", "1.5, sNaN")]

    def test_a_value_of_another_type_is_refused_by_type_only(self) -> None:
        field = {"name": "priority", "type": "integer", "enum_values": [1, 2]}

        assert _value(field, "x") == [_wrong_type("priority", "integer", "string")]

    def test_digit_text_is_the_number_it_stands_for(self) -> None:
        field = {"name": "priority", "type": "integer", "enum_values": [1, 2]}

        assert _value(field, "2") == []
        assert _value(field, "3") == [_not_allowed("priority", "1, 2")]

    def test_allowed_values_compare_exactly(self) -> None:
        field = {"name": "ratio", "type": "float", "enum_values": ["2.50", 0.1]}

        assert _value(field, "2.5") == []
        assert _value(field, Decimal("0.1")) == []
        assert _value(field, "0.10000000000000000001") == [_not_allowed("ratio", "2.50, 0.1")]

    def test_an_allowed_value_that_breaks_the_rule_is_never_matched(self) -> None:
        field = {"name": "priority", "type": "integer", "enum_values": [" 7", "1e1"]}

        assert _value(field, 7) == [_not_allowed("priority", " 7, 1e1")]
        assert _value(field, 10) == [_not_allowed("priority", " 7, 1e1")]


class TestBounds:
    """A number below the minimum or above the maximum is refused."""

    def test_a_value_below_the_minimum_is_refused(self) -> None:
        field = {"name": "timeout", "type": "integer", "minimum": 1}

        assert _value(field, 0, block_id="http-client") == [
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'timeout' of block 'http-client' must be at least 1, got 0",
                "Provide a value of at least 1",
                "timeout",
            )
        ]

    def test_a_value_above_the_maximum_is_refused(self) -> None:
        field = {"name": "count", "type": "integer", "minimum": 1, "maximum": 1000}

        assert _value(field, 1001, block_id="ping") == [
            (
                "SETTING_ABOVE_MAXIMUM",
                "Setting 'count' of block 'ping' must be at most 1000, got 1001",
                "Provide a value of at most 1000",
                "count",
            )
        ]

    @pytest.mark.parametrize("value", [1, 1000], ids=["at-minimum", "at-maximum"])
    def test_a_value_on_a_bound_is_accepted(self, value: int) -> None:
        field = {"name": "count", "type": "integer", "minimum": 1, "maximum": 1000}

        assert _value(field, value, block_id="ping") == []

    def test_a_float_below_a_fractional_minimum_is_refused(self) -> None:
        field = {"name": "interval", "type": "float", "minimum": 0.2}

        assert _value(field, 0.1, block_id="ping") == [
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'interval' of block 'ping' must be at least 0.2, got 0.1",
                "Provide a value of at least 0.2",
                "interval",
            )
        ]

    def test_digit_text_is_bound_checked_as_its_number(self) -> None:
        field = {"name": "port", "type": "integer", "minimum": 1, "maximum": 65535}

        assert _value(field, "65535", block_id="netcat") == []
        assert _value(field, "0", block_id="netcat") == [
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'port' of block 'netcat' must be at least 1, got 0",
                "Provide a value of at least 1",
                "port",
            )
        ]

    def test_bounds_compare_exactly_past_double_precision(self) -> None:
        field = {"name": "interval", "type": "float", "minimum": 0.2, "maximum": 100}

        assert _value(field, "0.2", block_id="ping") == []
        assert _value(field, "0.19999999999999999999", block_id="ping") == [
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'interval' of block 'ping' must be at least 0.2, "
                "got 0.19999999999999999999",
                "Provide a value of at least 0.2",
                "interval",
            )
        ]
        assert _value(field, "100.0000000000000000000000001", block_id="ping") == [
            (
                "SETTING_ABOVE_MAXIMUM",
                "Setting 'interval' of block 'ping' must be at most 100, "
                "got 100.0000000000000000000000001",
                "Provide a value of at most 100",
                "interval",
            )
        ]

    def test_a_number_beyond_a_bound_is_named_in_plain_digits(self) -> None:
        field = {"name": "ratio", "type": "float", "maximum": 1}

        assert _value(field, Decimal("1E+3")) == [
            (
                "SETTING_ABOVE_MAXIMUM",
                "Setting 'ratio' of block 'f' must be at most 1, got 1000",
                "Provide a value of at most 1",
                "ratio",
            )
        ]

    def test_a_field_that_takes_any_type_bound_checks_only_a_number(self) -> None:
        field = {"name": "value", "type": "float", "minimum": 0, "accepts_any_type": True}

        assert _value(field, "minus five") == []
        assert _value(field, float("nan")) == []
        assert _value(field, "-1.5") == [
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'value' of block 'f' must be at least 0, got -1.5",
                "Provide a value of at least 0",
                "value",
            )
        ]

    def test_an_exact_decimal_above_the_maximum_is_refused(self) -> None:
        field = {"name": "ratio", "type": "float", "maximum": 1}

        assert _value(field, Decimal("1.5")) == [
            (
                "SETTING_ABOVE_MAXIMUM",
                "Setting 'ratio' of block 'f' must be at most 1, got 1.5",
                "Provide a value of at most 1",
                "ratio",
            )
        ]


class TestValuesTheCheckSkips:
    """Null, a picked variable name, a sealed secret and the mask are not literals to check."""

    @pytest.mark.parametrize(
        "field",
        [
            {"name": "count", "type": "integer", "minimum": 1},
            {"name": "level", "type": "string", "enum_values": ["low", "high"]},
            {"name": "rows", "type": "table"},
        ],
        ids=["bounded-integer", "choice", "table"],
    )
    def test_null_is_not_checked(self, field: dict[str, Any]) -> None:
        assert _value(field, None) == []

    def test_a_picked_table_variable_name_is_not_refused(self) -> None:
        field = {"name": "table", "type": "table", "variable_ref": True}

        assert _value(field, "orders", block_id="csv-parser") == []

    def test_a_picked_collection_variable_name_is_not_refused(self) -> None:
        field = {"name": "collection", "type": ["array", "map", "table"], "variable_ref": True}

        assert _value(field, "items", block_id="for-each") == []

    @pytest.mark.parametrize("stored", [_SEALED, _MASKED], ids=["sealed", "masked"])
    @pytest.mark.parametrize(
        "field",
        [
            {"name": "port", "type": "integer", "minimum": 1, "secret": True},
            {"name": "level", "type": "string", "enum_values": ["low"], "secret": True},
            {"name": "tokens", "type": "array", "secret": True},
        ],
        ids=["bounded-integer", "choice", "list"],
    )
    def test_a_sealed_or_masked_secret_is_not_refused(
        self, field: dict[str, Any], stored: str
    ) -> None:
        assert _value(field, stored) == []


class TestExpressionsAndTemplates:
    """An expression or template is checked at run, not as a literal."""

    def test_a_whole_field_expression_is_not_type_checked(self) -> None:
        field = {"name": "retries", "type": "integer", "minimum": 1}

        assert _check([field], {"retries": "count + 1"}, expression_fields={"retries"}) == []

    def test_a_template_is_not_checked_against_the_allowed_values(self) -> None:
        field = {"name": "level", "type": "string", "enum_values": ["low", "high"]}

        assert _check([field], {"level": "{{ lvl }}"}, template_fields={"level"}) == []

    def test_a_blank_whole_field_expression_in_an_optional_field_means_not_set(self) -> None:
        field = {"name": "headers", "type": "map", "default": {}}

        assert _check([field], {"headers": ""}, expression_fields={"headers"}) == []

    def test_every_literal_is_checked_against_its_own_field(self) -> None:
        fields = [
            {"name": "timeout", "type": "integer", "minimum": 1},
            {"name": "method", "type": "string", "enum_values": ["GET", "POST"]},
        ]

        found = _check(fields, {"timeout": 0, "method": "YEET"}, block_id="http-client")

        assert sorted(found) == [
            _not_allowed("method", "GET, POST", block_id="http-client"),
            (
                "SETTING_BELOW_MINIMUM",
                "Setting 'timeout' of block 'http-client' must be at least 1, got 0",
                "Provide a value of at least 1",
                "timeout",
            ),
        ]


class TestBlankExpressionEntries:
    """A blank {x} map value or list row has no default to fall back on, so Save refuses it."""

    _HEADERS = {"name": "headers", "type": "map"}
    _ARGUMENTS = {"name": "arguments", "type": "array"}

    @pytest.mark.parametrize("blank", ["  ", "", None], ids=["spaces", "empty", "null"])
    def test_a_blank_map_entry_expression_is_required(self, blank: str | None) -> None:
        found = _check(
            [self._HEADERS],
            {"headers": {"X-Id": blank, "X-Ok": "trace_id"}},
            expression_fields={"headers.X-Id", "headers.X-Ok"},
        )

        assert found == [
            ("REQUIRED_PARAM_EMPTY", "'X-Id' in 'headers' is required", None, "headers.X-Id")
        ]

    def test_a_blank_list_row_expression_is_required_by_its_row_number(self) -> None:
        found = _check(
            [self._ARGUMENTS],
            {"arguments": [{"value": "first"}, {"value": ""}]},
            expression_fields={"arguments.0.value", "arguments.1.value"},
        )

        assert found == [
            (
                "REQUIRED_PARAM_EMPTY",
                "Row 2 in 'arguments' is required",
                None,
                "arguments.1.value",
            )
        ]

    def test_a_blank_literal_entry_is_a_value(self) -> None:
        found = _check(
            [self._HEADERS, self._ARGUMENTS],
            {"headers": {"X-Id": ""}, "arguments": [{"value": ""}]},
        )

        assert found == []

    def test_an_entry_key_that_addresses_nothing_is_skipped(self) -> None:
        found = _check(
            [{"name": "message", "type": "string"}, self._HEADERS],
            {"message": "'hi'"},
            expression_fields={"message", "headers.0.value", "message.deep", "missing"},
        )

        assert found == []


class TestNameRules:
    """A field's name rule holds for every map key and list item, ASCII only, with its message."""

    _RULE = {"pattern": "[a-z]+", "message": "Bad name: '{name}'"}
    _NAMES_MAP = {"name": "names", "type": "map", "name_rule": _RULE}
    _NAMES_LIST = {"name": "listed", "type": "array", "name_rule": _RULE}

    def test_a_map_key_outside_the_rule_is_refused(self) -> None:
        found = _check([self._NAMES_MAP], {"names": {"ok": 1, "Bad": 2}})

        assert found == [("INVALID_NAME", "Bad name: 'Bad'", None, "names")]

    def test_a_list_item_outside_the_rule_is_refused(self) -> None:
        found = _check([self._NAMES_LIST], {"listed": ["ok", "no1"]})

        assert found == [("INVALID_NAME", "Bad name: 'no1'", None, "listed")]

    def test_a_list_item_that_is_not_text_is_named_by_its_text(self) -> None:
        found = _check([self._NAMES_LIST], {"listed": [7]})

        assert found == [("INVALID_NAME", "Bad name: '7'", None, "listed")]

    def test_every_name_outside_the_rule_is_refused_in_order(self) -> None:
        found = _check([self._NAMES_MAP], {"names": {"B": 1, "ok": 2, "C": 3}})

        assert found == [
            ("INVALID_NAME", "Bad name: 'B'", None, "names"),
            ("INVALID_NAME", "Bad name: 'C'", None, "names"),
        ]

    def test_a_word_class_in_the_rule_matches_ascii_only(self) -> None:
        field = {"name": "names", "type": "map", "name_rule": {**self._RULE, "pattern": r"\w+"}}

        found = _check([field], {"names": {"ok_1": 1, "café": 2}})

        assert found == [("INVALID_NAME", "Bad name: 'café'", None, "names")]

    def test_names_inside_the_rule_are_accepted(self) -> None:
        found = _check([self._NAMES_MAP, self._NAMES_LIST], {"names": {"a": 1}, "listed": ["b"]})

        assert found == []

    def test_a_whole_field_expression_has_no_names_to_check(self) -> None:
        found = _check([self._NAMES_MAP], {"names": "Bad"}, expression_fields={"names"})

        assert found == []

    def test_a_field_set_to_null_has_no_names_to_check(self) -> None:
        found = _check([self._NAMES_MAP], {"names": None})

        assert found == []

    def test_a_field_without_a_rule_takes_any_name(self) -> None:
        found = _check([{"name": "names", "type": "map"}], {"names": {"Any Name!": 1}})

        assert found == []


class TestBlockedNamePrefixes:
    """A name that fits the pattern is refused when it starts with a blocked prefix, with the
    prefix's own message; a name outside the pattern gets only the pattern's message."""

    _RULE = {
        "pattern": "[A-Za-z_]+",
        "message": "Bad name: '{name}'",
        "blocked_prefixes": [
            {"prefix": "SYS_", "message": "Names may not start with SYS_: '{name}'"},
            {"prefix": "OS_", "message": "Names may not start with OS_: '{name}'"},
        ],
    }
    _NAMES = {"name": "names", "type": "map", "name_rule": _RULE}

    def test_a_name_that_starts_with_a_blocked_prefix_is_refused(self) -> None:
        found = _check([self._NAMES], {"names": {"SYS_X": 1}})

        assert found == [("INVALID_NAME", "Names may not start with SYS_: 'SYS_X'", None, "names")]

    def test_each_prefix_carries_its_own_message(self) -> None:
        found = _check([self._NAMES], {"names": {"OS_X": 1}})

        assert found == [("INVALID_NAME", "Names may not start with OS_: 'OS_X'", None, "names")]

    def test_the_pattern_is_checked_before_the_prefixes(self) -> None:
        found = _check([self._NAMES], {"names": {"SYS_1": 1}})

        assert found == [("INVALID_NAME", "Bad name: 'SYS_1'", None, "names")]

    def test_a_prefix_matches_its_case_only(self) -> None:
        found = _check([self._NAMES], {"names": {"sys_x": 1, "SYSX": 2}})

        assert found == []

    def test_every_refused_name_is_reported_in_order(self) -> None:
        found = _check([self._NAMES], {"names": {"ok": 1, "SYS_A": 2, "B1": 3}})

        assert found == [
            ("INVALID_NAME", "Names may not start with SYS_: 'SYS_A'", None, "names"),
            ("INVALID_NAME", "Bad name: 'B1'", None, "names"),
        ]


class TestStoredBlockValues:
    """Each literal number of a declared number field is stored in its wire form."""

    _FIELDS = (
        {"name": "delay", "type": "float"},
        {"name": "size", "type": "integer"},
        {"name": "since", "type": ["string", "integer"]},
        {"name": "label", "type": "string"},
        {"name": "count", "type": "integer"},
    )

    def test_a_number_takes_the_wire_form_of_its_field_type(self) -> None:
        values = {"delay": 1e-07, "size": 1234567890123456789, "count": 30}

        assert _stored_values(self._FIELDS, values, expression_fields=(), template_fields=()) == {
            "delay": "0.0000001",
            "size": "1234567890123456789",
            "count": 30,
        }

    def test_a_number_in_a_text_or_number_field_is_still_a_number(self) -> None:
        values = {"since": 1234567890123456789, "label": 1e-07}

        assert _stored_values(self._FIELDS, values, expression_fields=(), template_fields=()) == {
            "since": "1234567890123456789",
            "label": 1e-07,
        }

    def test_text_stays_text(self) -> None:
        values = {"delay": "0.0000001", "since": "now-15m"}

        assert (
            _stored_values(self._FIELDS, values, expression_fields=(), template_fields=()) == values
        )

    def test_expression_template_and_undeclared_values_stay_as_given(self) -> None:
        values = {"delay": 1e-07, "size": 1234567890123456789, "x": 30.0}

        assert (
            _stored_values(
                self._FIELDS, values, expression_fields={"delay"}, template_fields={"size"}
            )
            == values
        )

    def test_the_given_values_are_not_changed(self) -> None:
        values = {"delay": 30.0}

        stored = _stored_values(self._FIELDS, values, expression_fields=(), template_fields=())

        assert (stored, values) == ({"delay": "30.0"}, {"delay": 30.0})


_IDS = {"name": "ids", "type": "array"}
_LIMITS = {"name": "limits", "type": "map"}
_ROWS = {"name": "rows", "type": "table"}


def _entry(code: str, said: str, fix: str, name: str = "ids") -> Seen:
    return (code, f"Setting '{name}' of block 'f' {said}", fix, name)


class TestTypedSettingEntries:
    """Each typed list item, map value and table cell of a literal setting follows the rule."""

    def test_a_list_item_is_held_to_its_element_type_and_counted_from_one(self) -> None:
        found = _check([_IDS], {"ids": [1, "1e5"]}, element_types={"ids": ["integer", "integer"]})

        assert found == [
            _entry(
                "INVALID_SETTING_TYPE",
                "at item 2 is not a valid integer",
                "Provide an integer value",
            )
        ]

    def test_a_map_value_past_the_digit_cap_is_refused_by_its_count(self) -> None:
        values = {"limits": {"k": "12345678901234567890", "free": "x"}}

        assert _check([_LIMITS], values, element_types={"limits": {"k": "integer"}}) == [
            _entry(
                "SETTING_TOO_MANY_DIGITS",
                "at key 'k' allows at most 19 digits, got 20",
                "Provide at most 19 digits",
                "limits",
            )
        ]

    def test_a_float_entry_past_28_significant_digits_is_refused(self) -> None:
        values = {"limits": {"k": "1.2345678901234567890123456789"}}

        assert _check([_LIMITS], values, element_types={"limits": {"k": "float"}}) == [
            _entry(
                "SETTING_TOO_MANY_DIGITS",
                "at key 'k' allows at most 28 significant digits, got 29",
                "Provide at most 28 significant digits",
                "limits",
            )
        ]

    def test_a_table_cell_is_held_to_its_column_type(self) -> None:
        table = {"columns": [{"name": "ratio", "type": "float"}], "rows": [["0.5"], ["1e3"]]}

        assert _check([_ROWS], {"rows": table}) == [
            _entry(
                "INVALID_SETTING_TYPE",
                "at row 2, column 'ratio' is not a valid float",
                "Provide a float value",
                "rows",
            )
        ]

    def test_an_expression_or_template_entry_is_source_not_a_literal(self) -> None:
        values = {"ids": ["count + 1", "{{ n }}"], "limits": {"k": "max_value"}}
        types = {"ids": ["integer", "integer"], "limits": {"k": "integer"}}

        found = _check(
            [_IDS, _LIMITS],
            values,
            element_types=types,
            expression_fields={"ids.0", "limits.k"},
            template_fields={"ids.1"},
        )

        assert found == []

    def test_a_whole_expression_setting_has_no_entries_to_check(self) -> None:
        found = _check(
            [_IDS],
            {"ids": "numbers()"},
            element_types={"ids": ["integer"]},
            expression_fields={"ids"},
        )

        assert found == []

    @pytest.mark.parametrize(
        "value",
        [None, _SEALED, _MASKED, [1, None, "30"]],
        ids=["null", "sealed", "masked", "valid-items"],
    )
    def test_a_value_with_no_entry_that_breaks_the_rule_passes(self, value: Any) -> None:
        field = {**_IDS, "type": ["array", "string"]}

        assert _check([field], {"ids": value}, element_types={"ids": ["integer"] * 3}) == []

    def test_entries_without_element_types_are_not_read(self) -> None:
        assert _check([_IDS], {"ids": ["x"]}, element_types={"other": ["integer"]}) == []
        assert _check([_IDS], {"ids": ["x"]}, element_types="not-a-map") == []
        assert _check([_IDS], {"ids": ["x"]}) == []

    def test_a_setting_of_the_wrong_type_has_only_its_type_finding(self) -> None:
        found = _check([_IDS], {"ids": {"0": "x"}}, element_types={"ids": {"0": "integer"}})

        assert found == [_wrong_type("ids", "array", "map")]

    def test_a_field_value_check_reads_the_entries_it_is_given(self) -> None:
        found = check_field_value(
            _IDS, "ids", [1, "1e5"], block_id="probe", element_types=["integer", "integer"]
        )

        assert _seen(found) == [
            (
                "INVALID_SETTING_TYPE",
                "Setting 'ids' of block 'probe' at item 2 is not a valid integer",
                "Provide an integer value",
                "ids",
            )
        ]


class TestStoredTypedSettingEntries:
    """Each valid number a typed entry holds is stored in its wire form."""

    def test_typed_entries_take_the_wire_form_of_their_types(self) -> None:
        table = {
            "columns": [{"name": "id", "type": "integer"}],
            "rows": [[1234567890123456789], [30]],
        }
        values = {
            "ids": [1e-07, 1234567890123456789, "count + 1"],
            "limits": {"k": 30.0, "free": 30.0},
            "rows": table,
        }

        stored = _stored_values(
            [_IDS, _LIMITS, _ROWS],
            values,
            expression_fields={"ids.2"},
            template_fields=(),
            element_types={"ids": ["float", "integer", "integer"], "limits": {"k": "float"}},
        )

        assert stored == {
            "ids": ["0.0000001", "1234567890123456789", "count + 1"],
            "limits": {"k": "30.0", "free": 30.0},
            "rows": {"columns": table["columns"], "rows": [["1234567890123456789"], [30]]},
        }

    def test_entries_without_element_types_stay_as_given(self) -> None:
        values = {"ids": [1e-07], "limits": {"k": 1e-07}}

        stored = _stored_values(
            [_IDS, _LIMITS], values, expression_fields=(), template_fields=(), element_types=None
        )

        assert stored == values


class TestReadBackTypedSettings:
    """Digit text in each number place of a setting reads back as that number."""

    def test_number_fields_and_typed_entries_read_back_as_numbers(self) -> None:
        fields = [
            {"name": "delay", "type": "float"},
            {"name": "label", "type": "string"},
            {"name": "since", "type": ["string", "integer"]},
            _IDS,
        ]
        values = {"delay": "2.50", "label": "30", "since": "30", "ids": ["30", "7"]}

        read = block_value_numbers(
            fields,
            values,
            expression_fields={"ids.1"},
            template_fields=set(),
            element_types={"ids": ["integer", "integer"]},
            form=text_as_number,
        )

        assert read == {"delay": Decimal("2.50"), "label": "30", "since": "30", "ids": [30, "7"]}
        assert str(read["delay"]) == "2.50"


class TestTypeNames:
    """The value-type word a finding names for a stored value."""

    @pytest.mark.parametrize(
        ("value", "word"),
        [(None, "null"), (Table(), "table"), (object(), "object"), ({"a": 1}, "map")],
        ids=["null", "table", "other", "map"],
    )
    def test_each_value_is_named_by_its_type(self, value: Any, word: str) -> None:
        assert type_name(value) == word

    def test_a_field_of_a_type_the_check_does_not_know_takes_any_value(self) -> None:
        assert _value({"name": "shape", "type": "widget"}, 30) == []
