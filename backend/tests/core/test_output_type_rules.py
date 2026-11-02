"""Output type rules: the resolver and the two models that declare them.

An output whose declared type depends on other parameter values carries a
'type_when' list. The first rule whose every condition matches decides the
type; anything else falls back to the declared type (K8SREAD-6).
"""

from typing import Any

import pytest
from pydantic import ValidationError

from wavecore.models.plugins import OutputField, OutputTypeRule, resolve_output_type

_TABLE_RULE: dict[str, Any] = {
    "when": [{"field": "output_format", "values": ["table"]}],
    "type": "table",
}
_TEXT_RULE: dict[str, Any] = {
    "when": [{"field": "output_format", "values": ["json", "yaml"]}],
    "type": "string",
}
_LIST_RULE: dict[str, Any] = {
    "when": [
        {"field": "output_format", "values": ["map"]},
        {"field": "search_by", "values": ["selector", "list"]},
    ],
    "type": "array",
}

_FORMAT_PARAMS: dict[str, dict[str, Any]] = {
    "output_format": {"name": "output_format", "type": "string", "default": "map"},
    "search_by": {"name": "search_by", "type": "string", "default": "name"},
}


class TestNoRules:
    """Without rules the declared type is the answer."""

    def test_an_absent_rule_list_returns_the_declared_type(self) -> None:
        assert resolve_output_type("map", None, {}) == "map"

    def test_an_empty_rule_list_returns_the_declared_type(self) -> None:
        assert resolve_output_type("map", [], {}) == "map"


class TestRuleMatching:
    """Which rule wins, and what it takes to win."""

    def test_a_matching_single_condition_rule_returns_its_type(self) -> None:
        values = {"output_format": "table"}

        assert resolve_output_type("map", [_TABLE_RULE], values) == "table"

    def test_the_first_matching_rule_wins(self) -> None:
        first: dict[str, Any] = {
            "when": [{"field": "output_format", "values": ["table"]}],
            "type": "table",
        }
        second: dict[str, Any] = {
            "when": [{"field": "output_format", "values": ["table"]}],
            "type": "string",
        }

        assert resolve_output_type("map", [first, second], {"output_format": "table"}) == "table"

    def test_a_two_condition_rule_needs_both_conditions(self) -> None:
        both = {"output_format": "map", "search_by": "list"}
        one_only = {"output_format": "map", "search_by": "name"}

        assert resolve_output_type("map", [_LIST_RULE], both) == "array"
        assert resolve_output_type("map", [_LIST_RULE], one_only) == "map"

    def test_a_failed_condition_falls_through_to_the_next_rule(self) -> None:
        values = {"output_format": "yaml", "search_by": "list"}

        assert resolve_output_type("map", [_LIST_RULE, _TEXT_RULE], values) == "string"

    def test_a_rule_with_no_conditions_matches_unconditionally(self) -> None:
        rule: dict[str, Any] = {"when": [], "type": "table"}

        assert resolve_output_type("map", [rule], {}) == "table"

    def test_a_rule_without_a_type_key_falls_back_to_the_declared_type(self) -> None:
        rule: dict[str, Any] = {"when": [{"field": "output_format", "values": ["table"]}]}

        assert resolve_output_type("map", [rule], {"output_format": "table"}) == "map"


class TestFieldValues:
    """How an unset, empty, non-string or unmapped field compares."""

    def test_an_unset_field_resolves_through_the_parameter_default(self) -> None:
        result = resolve_output_type("map", [_LIST_RULE], {"search_by": "list"}, _FORMAT_PARAMS)

        assert result == "array"

    def test_an_unset_field_without_parameters_compares_as_empty_text(self) -> None:
        assert resolve_output_type("map", [_TABLE_RULE, _TEXT_RULE], {}, None) == "map"

    def test_a_none_value_compares_as_empty_text(self) -> None:
        values: dict[str, Any] = {"output_format": None}

        assert resolve_output_type("map", [_TABLE_RULE, _TEXT_RULE], values, None) == "map"

    def test_a_non_string_value_is_compared_as_its_string_form(self) -> None:
        rule: dict[str, Any] = {"when": [{"field": "retries", "values": ["1"]}], "type": "array"}

        assert resolve_output_type("map", [rule], {"retries": 1}) == "array"

    def test_an_expression_matches_no_rule_and_returns_the_declared_type(self) -> None:
        values = {"output_format": "${fmt}"}

        assert resolve_output_type("map", [_TABLE_RULE, _TEXT_RULE], values) == "map"

    def test_an_unmapped_literal_returns_the_declared_type(self) -> None:
        values = {"output_format": "xml"}

        assert resolve_output_type("map", [_TABLE_RULE, _TEXT_RULE], values) == "map"


class TestOutputFieldModel:
    """OutputField carries the rules and validates the types they name."""

    def test_a_rule_type_outside_the_seven_is_rejected(self) -> None:
        declaration = {
            "name": "result",
            "type": "map",
            "type_when": [
                {"when": [{"field": "output_format", "values": ["table"]}], "type": "widget"}
            ],
        }

        with pytest.raises(ValidationError):
            OutputField.model_validate(declaration)

    def test_an_output_without_rules_leaves_type_when_none(self) -> None:
        assert OutputField(name="result", type="map").type_when is None

    def test_a_rule_may_declare_no_conditions_at_all(self) -> None:
        assert OutputTypeRule(when=[], type="table").when == []
