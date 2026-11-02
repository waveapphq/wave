"""
Tests for assertion evaluator module.

Tests the pure logic module that evaluates typed assertions with interleaved
AND/OR operators and AND-before-OR precedence.
"""

import re
from decimal import Decimal

import pytest

from wavecore.controls.assertion_evaluator import (
    AssertionResult,
    _coerce_to_float,
    _coerce_value,
    _compare_array,
    _compare_boolean,
    _compare_map,
    _compare_string,
    evaluate_assertions,
)
from wavecore.core.expressions.errors import (
    BlockedExpressionError,
    InvalidExpressionError,
    NullValueError,
)
from wavecore.core.table import Table
from wavecore.core.variables.decimal_value import WaveDecimal

# ============================================================================
# Literal Assertions - Integer Type
# ============================================================================


class TestLiteralIntegerAssertions:
    """Test integer comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object,
        value_type: str = "integer",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_integer_equals_pass(self) -> None:
        items = [self._make_literal("x", "equals", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True
        assert len(result.details) == 1
        assert result.details[0]["passed"] is True

    def test_integer_equals_fail(self) -> None:
        items = [self._make_literal("x", "equals", 10)]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is False
        assert len(result.details) == 1
        assert result.details[0]["passed"] is False
        assert result.details[0]["actual_value"] == 5

    def test_integer_not_equals_pass(self) -> None:
        items = [self._make_literal("x", "not_equals", 10)]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is True

    def test_integer_not_equals_fail(self) -> None:
        items = [self._make_literal("x", "not_equals", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is False

    def test_integer_less_than_pass(self) -> None:
        items = [self._make_literal("x", "less_than", 10)]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is True

    def test_integer_less_than_fail(self) -> None:
        items = [self._make_literal("x", "less_than", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is False

    def test_integer_greater_than_pass(self) -> None:
        items = [self._make_literal("x", "greater_than", 10)]
        result = evaluate_assertions(items, {"x": 15})
        assert result.passed is True

    def test_integer_greater_than_fail(self) -> None:
        items = [self._make_literal("x", "greater_than", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is False

    def test_integer_less_or_equal_pass_equal(self) -> None:
        items = [self._make_literal("x", "less_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True

    def test_integer_less_or_equal_pass_less(self) -> None:
        items = [self._make_literal("x", "less_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is True

    def test_integer_less_or_equal_fail(self) -> None:
        items = [self._make_literal("x", "less_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 11})
        assert result.passed is False

    def test_integer_greater_or_equal_pass_equal(self) -> None:
        items = [self._make_literal("x", "greater_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True

    def test_integer_greater_or_equal_pass_greater(self) -> None:
        items = [self._make_literal("x", "greater_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 15})
        assert result.passed is True

    def test_integer_greater_or_equal_fail(self) -> None:
        items = [self._make_literal("x", "greater_or_equal", 10)]
        result = evaluate_assertions(items, {"x": 9})
        assert result.passed is False

    def test_integer_type_coercion_from_string(self) -> None:
        """String variable coerced to int for integer comparison."""
        items = [self._make_literal("x", "equals", 10)]
        result = evaluate_assertions(items, {"x": "10"})
        assert result.passed is True

    def test_integer_reference_coercion_from_string(self) -> None:
        """String reference value coerced to int for integer comparison."""
        items = [self._make_literal("x", "equals", "10")]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True


# ============================================================================
# Literal Assertions - Float Type
# ============================================================================


class TestLiteralFloatAssertions:
    """Test float comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object,
        value_type: str = "float",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_float_equals_pass(self) -> None:
        items = [self._make_literal("x", "equals", 3.14)]
        result = evaluate_assertions(items, {"x": 3.14})
        assert result.passed is True

    def test_float_equals_fail(self) -> None:
        items = [self._make_literal("x", "equals", 3.14)]
        result = evaluate_assertions(items, {"x": 2.71})
        assert result.passed is False

    def test_float_not_equals(self) -> None:
        items = [self._make_literal("x", "not_equals", 3.14)]
        result = evaluate_assertions(items, {"x": 2.71})
        assert result.passed is True

    def test_float_less_than(self) -> None:
        items = [self._make_literal("x", "less_than", 3.14)]
        result = evaluate_assertions(items, {"x": 2.0})
        assert result.passed is True

    def test_float_greater_than(self) -> None:
        items = [self._make_literal("x", "greater_than", 3.14)]
        result = evaluate_assertions(items, {"x": 4.0})
        assert result.passed is True

    def test_float_less_or_equal(self) -> None:
        items = [self._make_literal("x", "less_or_equal", 3.14)]
        result = evaluate_assertions(items, {"x": 3.14})
        assert result.passed is True

    def test_float_greater_or_equal(self) -> None:
        items = [self._make_literal("x", "greater_or_equal", 3.14)]
        result = evaluate_assertions(items, {"x": 3.14})
        assert result.passed is True

    def test_float_type_coercion_from_int(self) -> None:
        """Int variable coerced to float for float comparison."""
        items = [self._make_literal("x", "equals", 3.0)]
        result = evaluate_assertions(items, {"x": 3})
        assert result.passed is True

    def test_float_type_coercion_from_string(self) -> None:
        """String variable coerced to float for float comparison."""
        items = [self._make_literal("x", "equals", 3.14)]
        result = evaluate_assertions(items, {"x": "3.14"})
        assert result.passed is True


# ============================================================================
# Literal Assertions - String Type
# ============================================================================


class TestLiteralStringAssertions:
    """Test string comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object,
        value_type: str = "string",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_string_equals_pass(self) -> None:
        items = [self._make_literal("name", "equals", "hello")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_equals_fail(self) -> None:
        items = [self._make_literal("name", "equals", "hello")]
        result = evaluate_assertions(items, {"name": "world"})
        assert result.passed is False

    def test_string_not_equals(self) -> None:
        items = [self._make_literal("name", "not_equals", "hello")]
        result = evaluate_assertions(items, {"name": "world"})
        assert result.passed is True

    def test_string_contains_pass(self) -> None:
        items = [self._make_literal("name", "contains", "ell")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_contains_fail(self) -> None:
        items = [self._make_literal("name", "contains", "xyz")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is False

    def test_string_does_not_contain_pass(self) -> None:
        items = [self._make_literal("name", "does_not_contain", "xyz")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_does_not_contain_fail(self) -> None:
        items = [self._make_literal("name", "does_not_contain", "ell")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is False

    def test_string_starts_with_pass(self) -> None:
        items = [self._make_literal("name", "starts_with", "he")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_starts_with_fail(self) -> None:
        items = [self._make_literal("name", "starts_with", "wor")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is False

    def test_string_ends_with_pass(self) -> None:
        items = [self._make_literal("name", "ends_with", "llo")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_ends_with_fail(self) -> None:
        items = [self._make_literal("name", "ends_with", "xyz")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is False

    def test_string_matches_regex_pass(self) -> None:
        items = [self._make_literal("name", "matches_regex", r"^h\w+o$")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is True

    def test_string_matches_regex_fail(self) -> None:
        items = [self._make_literal("name", "matches_regex", r"^x\w+$")]
        result = evaluate_assertions(items, {"name": "hello"})
        assert result.passed is False

    def test_string_type_coercion(self) -> None:
        """Non-string variable coerced to string for string comparison."""
        items = [self._make_literal("x", "equals", "42")]
        result = evaluate_assertions(items, {"x": 42})
        assert result.passed is True


# ============================================================================
# Literal Assertions - Boolean Type
# ============================================================================


class TestLiteralBooleanAssertions:
    """Test boolean comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object = None,
        value_type: str = "boolean",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_boolean_is_true_pass(self) -> None:
        items = [self._make_literal("flag", "is_true")]
        result = evaluate_assertions(items, {"flag": True})
        assert result.passed is True

    def test_boolean_is_true_fail(self) -> None:
        items = [self._make_literal("flag", "is_true")]
        result = evaluate_assertions(items, {"flag": False})
        assert result.passed is False

    def test_boolean_is_false_pass(self) -> None:
        items = [self._make_literal("flag", "is_false")]
        result = evaluate_assertions(items, {"flag": False})
        assert result.passed is True

    def test_boolean_is_false_fail(self) -> None:
        items = [self._make_literal("flag", "is_false")]
        result = evaluate_assertions(items, {"flag": True})
        assert result.passed is False

    def test_boolean_type_coercion_from_string_true(self) -> None:
        """String 'true' coerced to bool True."""
        items = [self._make_literal("flag", "is_true")]
        result = evaluate_assertions(items, {"flag": "true"})
        assert result.passed is True

    def test_boolean_type_coercion_from_string_false(self) -> None:
        """String 'false' coerced to bool False."""
        items = [self._make_literal("flag", "is_false")]
        result = evaluate_assertions(items, {"flag": "false"})
        assert result.passed is True


# ============================================================================
# Literal Assertions - Array Type
# ============================================================================


class TestLiteralArrayAssertions:
    """Test array comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object = None,
        value_type: str = "array",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_array_contains_pass(self) -> None:
        items = [self._make_literal("items", "contains", 3)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is True

    def test_array_contains_fail(self) -> None:
        items = [self._make_literal("items", "contains", 5)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is False

    def test_array_does_not_contain_pass(self) -> None:
        items = [self._make_literal("items", "does_not_contain", 5)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is True

    def test_array_does_not_contain_fail(self) -> None:
        items = [self._make_literal("items", "does_not_contain", 3)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is False

    def test_array_is_empty_pass(self) -> None:
        items = [self._make_literal("items", "is_empty")]
        result = evaluate_assertions(items, {"items": []})
        assert result.passed is True

    def test_array_is_empty_fail(self) -> None:
        items = [self._make_literal("items", "is_empty")]
        result = evaluate_assertions(items, {"items": [1]})
        assert result.passed is False

    def test_array_is_not_empty_pass(self) -> None:
        items = [self._make_literal("items", "is_not_empty")]
        result = evaluate_assertions(items, {"items": [1]})
        assert result.passed is True

    def test_array_is_not_empty_fail(self) -> None:
        items = [self._make_literal("items", "is_not_empty")]
        result = evaluate_assertions(items, {"items": []})
        assert result.passed is False

    def test_array_length_equals_pass(self) -> None:
        items = [self._make_literal("items", "length_equals", 3)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is True

    def test_array_length_equals_fail(self) -> None:
        items = [self._make_literal("items", "length_equals", 5)]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is False

    def test_array_length_equals_reads_a_text_reference_as_a_number(self) -> None:
        items = [self._make_literal("items", "length_equals", "3")]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is True

    def test_an_expression_length_that_is_not_a_whole_number_is_refused(self) -> None:
        items = [self._make_literal("items", "length_equals", "2.5", reference_is_expression=True)]

        with pytest.raises(ValueError, match=r"^'length equals' needs a whole number, got '2.5'$"):
            evaluate_assertions(items, {"items": [1, 2, 3]})

    @pytest.mark.parametrize("reference", ["abc", "2.5"])
    def test_array_length_equals_refuses_a_reference_that_is_not_a_whole_number(
        self, reference: str
    ) -> None:
        items = [self._make_literal("items", "length_equals", reference)]
        # Either error class fails the block; the message is the contract.
        with pytest.raises(
            (TypeError, ValueError),
            match=rf"^'length equals' needs a whole number, got {re.escape(repr(reference))}$",
        ):
            evaluate_assertions(items, {"items": [1, 2, 3]})

    @pytest.mark.parametrize(
        ("collection", "reference"),
        [
            pytest.param([1, 2, 3], "3", id="integer-list"),
            pytest.param([WaveDecimal("1.5"), WaveDecimal("2.5")], "2.5", id="float-list"),
            pytest.param([1.5, 2.5], "2.5", id="python-float-list"),
        ],
    )
    def test_array_contains_reads_a_text_reference_as_the_item_type(
        self, collection: list, reference: str
    ) -> None:
        items = [self._make_literal("items", "contains", reference)]
        result = evaluate_assertions(items, {"items": collection})
        assert result.passed is True

    @pytest.mark.parametrize(
        ("collection", "reference"),
        [
            pytest.param([1, 2, 3], "3", id="integer-list"),
            pytest.param([WaveDecimal("1.5"), WaveDecimal("2.5")], "2.5", id="float-list"),
        ],
    )
    def test_array_does_not_contain_reads_a_text_reference_as_the_item_type(
        self, collection: list, reference: str
    ) -> None:
        items = [self._make_literal("items", "does_not_contain", reference)]
        result = evaluate_assertions(items, {"items": collection})
        assert result.passed is False

    @pytest.mark.parametrize(
        ("reference", "expected"),
        [
            pytest.param("3", True, id="text-reference-matches-text-item"),
            pytest.param(3, False, id="integer-reference-differs-from-text-item"),
        ],
    )
    def test_array_contains_on_a_text_list_compares_typed_values(
        self, reference: object, expected: bool
    ) -> None:
        items = [self._make_literal("items", "contains", reference)]
        result = evaluate_assertions(items, {"items": ["1", "2", "3"]})
        assert result.passed is expected

    def test_array_contains_keeps_a_text_reference_that_does_not_convert(self) -> None:
        items = [self._make_literal("items", "contains", "abc")]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is False


# ============================================================================
# Literal Assertions - Map Type
# ============================================================================


class TestLiteralMapAssertions:
    """Test map comparison operators."""

    def _make_literal(
        self,
        variable: str,
        operator: str,
        reference_value: object = None,
        value_type: str = "map",
        reference_is_expression: bool = False,
    ) -> dict:
        return {
            "type": "literal",
            "variable": variable,
            "value_type": value_type,
            "operator": operator,
            "reference_value": reference_value,
            "reference_is_expression": reference_is_expression,
        }

    def test_map_has_key_pass(self) -> None:
        items = [self._make_literal("data", "has_key", "name")]
        result = evaluate_assertions(items, {"data": {"name": "Alice", "age": 30}})
        assert result.passed is True

    def test_map_has_key_fail(self) -> None:
        items = [self._make_literal("data", "has_key", "email")]
        result = evaluate_assertions(items, {"data": {"name": "Alice", "age": 30}})
        assert result.passed is False

    def test_map_does_not_have_key_pass(self) -> None:
        items = [self._make_literal("data", "does_not_have_key", "email")]
        result = evaluate_assertions(items, {"data": {"name": "Alice"}})
        assert result.passed is True

    def test_map_does_not_have_key_fail(self) -> None:
        items = [self._make_literal("data", "does_not_have_key", "name")]
        result = evaluate_assertions(items, {"data": {"name": "Alice"}})
        assert result.passed is False

    def test_map_is_empty_pass(self) -> None:
        items = [self._make_literal("data", "is_empty")]
        result = evaluate_assertions(items, {"data": {}})
        assert result.passed is True

    def test_map_is_empty_fail(self) -> None:
        items = [self._make_literal("data", "is_empty")]
        result = evaluate_assertions(items, {"data": {"a": 1}})
        assert result.passed is False

    def test_map_is_not_empty_pass(self) -> None:
        items = [self._make_literal("data", "is_not_empty")]
        result = evaluate_assertions(items, {"data": {"a": 1}})
        assert result.passed is True

    def test_map_is_not_empty_fail(self) -> None:
        items = [self._make_literal("data", "is_not_empty")]
        result = evaluate_assertions(items, {"data": {}})
        assert result.passed is False


# ============================================================================
# Expression Assertions
# ============================================================================


class TestExpressionAssertions:
    """Test expression-based assertions."""

    def test_simple_expression_passes(self) -> None:
        items = [{"type": "expression", "expression": "x > 5"}]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True

    def test_simple_expression_fails(self) -> None:
        items = [{"type": "expression", "expression": "x > 5"}]
        result = evaluate_assertions(items, {"x": 3})
        assert result.passed is False

    def test_complex_expression_with_variables(self) -> None:
        items = [{"type": "expression", "expression": "x + y > 10 and name == 'Alice'"}]
        result = evaluate_assertions(items, {"x": 7, "y": 5, "name": "Alice"})
        assert result.passed is True

    def test_expression_with_function_calls(self) -> None:
        items = [{"type": "expression", "expression": "len(items) > 2"}]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is True

    def test_expression_with_len_fails(self) -> None:
        items = [{"type": "expression", "expression": "len(items) > 5"}]
        result = evaluate_assertions(items, {"items": [1, 2, 3]})
        assert result.passed is False

    def test_expression_result_detail(self) -> None:
        items = [{"type": "expression", "expression": "x == 10"}]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is False
        assert result.details[0]["passed"] is False


# ============================================================================
# Secrets are RAW during evaluation (masking is display-only)
# ============================================================================


class TestSecretsAreRawDuringEvaluation:
    """Invariant: assertion/expression evaluation runs against the RAW variable
    values the backend holds. Secret masking is a display/persistence concern and
    never touches the eval path, so reading a sub-key of a secret-carrying map
    resolves the real value - a non-secret sibling stays readable and even a
    careless literal comparison against the secret itself evaluates."""

    _SCOPE = {
        "resp_headers": {
            "content-type": "application/json",
            "x-request-id": "req-abcdef123456",
            "set-cookie": "session=SUPER_SECRET_TOKEN",
        }
    }

    def test_non_secret_sibling_key_is_readable(self) -> None:
        items = [
            {
                "type": "expression",
                "expression": "resp_headers['content-type'] == 'application/json'",
            }
        ]
        assert evaluate_assertions(items, self._SCOPE).passed is True

    def test_secret_value_evaluates_against_the_raw_bytes(self) -> None:
        items = [
            {
                "type": "expression",
                "expression": "resp_headers['set-cookie'] == 'session=SUPER_SECRET_TOKEN'",
            }
        ]
        assert evaluate_assertions(items, self._SCOPE).passed is True

    def test_subkey_of_a_secret_map_resolves_to_the_real_value(self) -> None:
        items = [
            {
                "type": "expression",
                "expression": "resp_headers['x-request-id'] == 'req-abcdef123456'",
            }
        ]
        assert evaluate_assertions(items, self._SCOPE).passed is True


# ============================================================================
# Interleaved AND/OR Operators
# ============================================================================


class TestInterleavedAndOrOperators:
    """Test interleaved AND/OR combining logic with AND-before-OR precedence."""

    def _make_expr(self, expression: str) -> dict:
        return {"type": "expression", "expression": expression}

    def _op(self, value: str) -> dict:
        return {"type": "operator", "value": value}

    def test_and_all_pass(self) -> None:
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is True

    def test_and_one_fails(self) -> None:
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": -1})
        assert result.passed is False

    def test_or_all_fail(self) -> None:
        items = [
            self._make_expr("x > 100"),
            self._op("or"),
            self._make_expr("y > 100"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is False

    def test_or_one_passes(self) -> None:
        items = [
            self._make_expr("x > 100"),
            self._op("or"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is True

    def test_and_all_fail(self) -> None:
        items = [
            self._make_expr("x > 100"),
            self._op("and"),
            self._make_expr("y > 100"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is False

    def test_or_all_pass(self) -> None:
        items = [
            self._make_expr("x > 0"),
            self._op("or"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is True

    def test_and_short_circuits_on_first_false(self) -> None:
        """AND stops evaluating after first false - only 1 detail recorded."""
        items = [
            self._make_expr("x > 100"),
            self._op("and"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is False
        assert len(result.details) == 1  # second assertion never evaluated

    def test_or_short_circuits_on_first_true(self) -> None:
        """OR stops evaluating after first true - only 1 detail recorded."""
        items = [
            self._make_expr("x > 0"),
            self._op("or"),
            self._make_expr("y > 100"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is True
        assert len(result.details) == 1  # second assertion never evaluated

    def test_and_evaluates_all_when_all_pass(self) -> None:
        """AND evaluates all items when all pass - all details recorded."""
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            self._make_expr("y > 0"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is True
        assert len(result.details) == 2

    def test_or_evaluates_all_when_all_fail(self) -> None:
        """OR evaluates all items when all fail - all details recorded."""
        items = [
            self._make_expr("x > 100"),
            self._op("or"),
            self._make_expr("y > 100"),
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is False
        assert len(result.details) == 2


# ============================================================================
# AND-before-OR Precedence
# ============================================================================


class TestAndBeforeOrPrecedence:
    """Test AND has higher precedence than OR (standard boolean logic)."""

    def _make_expr(self, expression: str) -> dict:
        return {"type": "expression", "expression": expression}

    def _op(self, value: str) -> dict:
        return {"type": "operator", "value": value}

    def test_a_or_b_and_c_precedence(self) -> None:
        """A OR B AND C = A OR (B AND C).

        A=false, B=true, C=true -> false OR (true AND true) = true
        """
        items = [
            self._make_expr("x > 100"),  # A: false
            self._op("or"),
            self._make_expr("y > 0"),  # B: true
            self._op("and"),
            self._make_expr("z > 0"),  # C: true
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 20})
        assert result.passed is True

    def test_a_or_b_and_c_all_false(self) -> None:
        """A OR B AND C where A=false, B=true, C=false -> false OR false = false."""
        items = [
            self._make_expr("x > 100"),  # A: false
            self._op("or"),
            self._make_expr("y > 0"),  # B: true
            self._op("and"),
            self._make_expr("z > 100"),  # C: false
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 20})
        assert result.passed is False

    def test_a_and_b_or_c_and_d(self) -> None:
        """A AND B OR C AND D = (A AND B) OR (C AND D).

        A=true, B=false, C=true, D=true -> false OR true = true
        """
        items = [
            self._make_expr("a > 0"),  # A: true
            self._op("and"),
            self._make_expr("b > 100"),  # B: false
            self._op("or"),
            self._make_expr("c > 0"),  # C: true
            self._op("and"),
            self._make_expr("d > 0"),  # D: true
        ]
        result = evaluate_assertions(items, {"a": 5, "b": 10, "c": 15, "d": 20})
        assert result.passed is True

    def test_a_and_b_or_c_and_d_or_e(self) -> None:
        """A AND B OR C AND D OR E = (A AND B) OR (C AND D) OR (E).

        A=true, B=false, C=false, D=true, E=false -> false OR false OR false = false
        """
        items = [
            self._make_expr("a > 0"),  # A: true
            self._op("and"),
            self._make_expr("b > 100"),  # B: false
            self._op("or"),
            self._make_expr("c > 100"),  # C: false
            self._op("and"),
            self._make_expr("d > 0"),  # D: true
            self._op("or"),
            self._make_expr("e > 100"),  # E: false
        ]
        result = evaluate_assertions(items, {"a": 5, "b": 10, "c": 5, "d": 20, "e": 5})
        assert result.passed is False

    def test_or_short_circuit_across_segments(self) -> None:
        """OR short-circuits on first true segment.

        A OR B AND C: A=true -> stops, doesn't evaluate B or C.
        """
        items = [
            self._make_expr("x > 0"),  # A: true (first segment passes)
            self._op("or"),
            self._make_expr("y > 0"),  # B: never evaluated
            self._op("and"),
            self._make_expr("z > 0"),  # C: never evaluated
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 20})
        assert result.passed is True
        assert len(result.details) == 1  # only A evaluated

    def test_and_short_circuit_within_segment(self) -> None:
        """AND short-circuits within a segment.

        A AND B AND C: A=false -> stops, doesn't evaluate B or C.
        Falls through to next OR segment (if any).
        """
        items = [
            self._make_expr("x > 100"),  # A: false (short-circuit in first segment)
            self._op("and"),
            self._make_expr("y > 0"),  # B: never evaluated
            self._op("or"),
            self._make_expr("z > 0"),  # C: true (second segment)
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 20})
        assert result.passed is True
        assert len(result.details) == 2  # A evaluated (failed), C evaluated (passed)

    def test_precedence_with_explicit_group(self) -> None:
        """(A OR B) AND C using explicit group.

        Group(A OR B)=true, C=false -> true AND false = false
        Without group: A OR B AND C = A OR (B AND C) = true
        """
        items = [
            {
                "type": "group",
                "items": [
                    self._make_expr("a > 100"),  # A: false
                    self._op("or"),
                    self._make_expr("b > 0"),  # B: true
                ],
            },
            self._op("and"),
            self._make_expr("c > 100"),  # C: false
        ]
        result = evaluate_assertions(items, {"a": 5, "b": 10, "c": 5})
        # Group passes (B is true), but AND with C fails
        assert result.passed is False


# ============================================================================
# Nested Groups
# ============================================================================


class TestNestedGroups:
    """Test nested group assertions with interleaved operators."""

    def _make_expr(self, expression: str) -> dict:
        return {"type": "expression", "expression": expression}

    def _op(self, value: str) -> dict:
        return {"type": "operator", "value": value}

    def test_and_containing_or_group(self) -> None:
        """(x > 0) AND (y > 100 OR z > 100) -> passes when x > 0 and z > 100."""
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            {
                "type": "group",
                "items": [
                    self._make_expr("y > 100"),
                    self._op("or"),
                    self._make_expr("z > 100"),
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 50, "z": 200})
        assert result.passed is True

    def test_and_containing_or_group_fails(self) -> None:
        """AND at root, OR group fails because neither y nor z > 100."""
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            {
                "type": "group",
                "items": [
                    self._make_expr("y > 100"),
                    self._op("or"),
                    self._make_expr("z > 100"),
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 50, "z": 50})
        assert result.passed is False

    def test_or_containing_and_group(self) -> None:
        """(x > 100) OR (y > 0 AND z > 0) -> passes because AND group passes."""
        items = [
            self._make_expr("x > 100"),
            self._op("or"),
            {
                "type": "group",
                "items": [
                    self._make_expr("y > 0"),
                    self._op("and"),
                    self._make_expr("z > 0"),
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 20})
        assert result.passed is True

    def test_deep_nesting_three_levels(self) -> None:
        """3 levels deep: root AND -> OR group -> AND group.

        Root AND:
          - x > 0 (passes)
          - OR group:
            - y > 100 (fails)
            - AND group:
              - z > 0 (passes)
              - w > 0 (passes)
            -> OR passes because inner AND passes
        -> Root AND passes
        """
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            {
                "type": "group",
                "items": [
                    self._make_expr("y > 100"),
                    self._op("or"),
                    {
                        "type": "group",
                        "items": [
                            self._make_expr("z > 0"),
                            self._op("and"),
                            self._make_expr("w > 0"),
                        ],
                    },
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 50, "z": 10, "w": 20})
        assert result.passed is True

    def test_deep_nesting_fails(self) -> None:
        """3 levels deep, inner AND group fails causing cascade failure."""
        items = [
            self._make_expr("x > 0"),
            self._op("and"),
            {
                "type": "group",
                "items": [
                    self._make_expr("y > 100"),
                    self._op("or"),
                    {
                        "type": "group",
                        "items": [
                            self._make_expr("z > 0"),
                            self._op("and"),
                            self._make_expr("w > 0"),
                        ],
                    },
                ],
            },
        ]
        # w = -1 fails the inner AND, y = 50 fails the first OR branch
        # so OR group fails, so root AND fails
        result = evaluate_assertions(items, {"x": 5, "y": 50, "z": 10, "w": -1})
        assert result.passed is False

    def test_nested_group_with_operators_inside(self) -> None:
        """Group with mixed AND/OR operators inside uses precedence."""
        items = [
            {
                "type": "group",
                "items": [
                    self._make_expr("a > 100"),  # false
                    self._op("or"),
                    self._make_expr("b > 0"),  # true
                    self._op("and"),
                    self._make_expr("c > 0"),  # true
                ],
            },
        ]
        # Inside group: a OR (b AND c) = false OR true = true
        result = evaluate_assertions(items, {"a": 5, "b": 10, "c": 20})
        assert result.passed is True


# ============================================================================
# Reference Value as Expression
# ============================================================================


class TestReferenceValueExpression:
    """Test reference_is_expression=True evaluating reference as expression."""

    def test_reference_expression_evaluated(self) -> None:
        """When reference_is_expression=True, reference_value is evaluated as expression."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": "y + 1",
                "reference_is_expression": True,
            }
        ]
        result = evaluate_assertions(items, {"x": 11, "y": 10})
        assert result.passed is True

    def test_reference_expression_fails(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": "y + 1",
                "reference_is_expression": True,
            }
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert result.passed is False

    def test_reference_expression_with_function(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "count",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": "len(items)",
                "reference_is_expression": True,
            }
        ]
        result = evaluate_assertions(items, {"count": 3, "items": [1, 2, 3]})
        assert result.passed is True


# ============================================================================
# Error Cases
# ============================================================================


class TestErrorCases:
    """Test error propagation - errors should NOT be caught by evaluator."""

    def test_unknown_variable_in_literal_raises(self) -> None:
        """Referencing unknown variable raises an error (not caught)."""
        items = [
            {
                "type": "literal",
                "variable": "nonexistent",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        with pytest.raises(KeyError, match="nonexistent"):
            evaluate_assertions(items, {"x": 5})

    def test_unknown_variable_in_expression_raises(self) -> None:
        """Referencing unknown variable in expression raises InvalidExpressionError."""
        items = [{"type": "expression", "expression": "nonexistent > 5"}]
        with pytest.raises(InvalidExpressionError):
            evaluate_assertions(items, {"x": 5})

    def test_invalid_expression_syntax_raises(self) -> None:
        """Invalid expression syntax raises InvalidExpressionError."""
        items = [{"type": "expression", "expression": "x >>>> 5"}]
        with pytest.raises(InvalidExpressionError):
            evaluate_assertions(items, {"x": 5})

    def test_unknown_operator_raises_value_error(self) -> None:
        """Unknown operator raises ValueError."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "not_a_real_operator",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        with pytest.raises(
            ValueError,
            match=r"^Unknown operator 'not_a_real_operator' for type 'integer'$",
        ):
            evaluate_assertions(items, {"x": 5})

    def test_unknown_item_type_raises_value_error(self) -> None:
        """Unknown assertion item type raises ValueError."""
        items = [{"type": "unknown_type"}]
        with pytest.raises(
            ValueError,
            match=r"^Unknown assertion item type: 'unknown_type'$",
        ):
            evaluate_assertions(items, {"x": 5})

    def test_unknown_value_type_raises_value_error(self) -> None:
        """Unknown value_type raises ValueError."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "complex_number",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        with pytest.raises(
            ValueError,
            match=r"^Unknown value type: 'complex_number'$",
        ):
            evaluate_assertions(items, {"x": 5})

    def test_invalid_regex_raises(self) -> None:
        """Invalid regex pattern raises re.error."""
        items = [
            {
                "type": "literal",
                "variable": "name",
                "value_type": "string",
                "operator": "matches_regex",
                "reference_value": "[invalid",
                "reference_is_expression": False,
            }
        ]
        with pytest.raises(re.error):
            evaluate_assertions(items, {"name": "hello"})

    def test_type_coercion_failure_raises(self) -> None:
        """Failed type coercion raises TypeError."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        with pytest.raises(TypeError):
            evaluate_assertions(items, {"x": "not_a_number"})


# ============================================================================
# Result Details
# ============================================================================


class TestResultDetails:
    """Test that result details contain per-assertion information."""

    def _op(self, value: str) -> dict:
        return {"type": "operator", "value": value}

    def test_each_assertion_has_detail_entry(self) -> None:
        items = [
            {"type": "expression", "expression": "x > 0"},
            self._op("and"),
            {"type": "expression", "expression": "y > 0"},
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10})
        assert len(result.details) == 2
        for detail in result.details:
            assert "passed" in detail
            assert "assertion" in detail

    def test_failed_assertion_has_detail(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is False
        detail = result.details[0]
        assert detail["passed"] is False
        assert detail["assertion"]["variable"] == "x"

    def test_passed_assertion_has_detail(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": 10})
        assert result.passed is True
        detail = result.details[0]
        assert detail["passed"] is True
        assert "message" not in detail

    def test_group_details_are_flattened(self) -> None:
        """Details from nested groups should be included in the flat details list."""
        items = [
            {"type": "expression", "expression": "x > 0"},
            self._op("and"),
            {
                "type": "group",
                "items": [
                    {"type": "expression", "expression": "y > 0"},
                    self._op("and"),
                    {"type": "expression", "expression": "z > 0"},
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5, "y": 10, "z": 15})
        # All 3 assertions should have detail entries
        assert len(result.details) == 3


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def _op(self, value: str) -> dict:
        return {"type": "operator", "value": value}

    def test_empty_items_passes(self) -> None:
        """Empty items list passes (vacuous truth)."""
        result = evaluate_assertions([], {})
        assert result.passed is True
        assert result.details == []

    def test_none_variable_value_integer_comparison(self) -> None:
        """A null integer holds nothing, so equals answers false (REQ-3.1.3.25)."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 10,
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": None})
        assert result.passed is False

    def test_none_variable_value_string_comparison(self) -> None:
        """A null string holds nothing, so equals answers false (REQ-3.1.3.25)."""
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "string",
                "operator": "equals",
                "reference_value": "hello",
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": None})
        assert result.passed is False

    def test_assertion_result_dataclass(self) -> None:
        """AssertionResult is a proper dataclass with expected fields."""
        r = AssertionResult(passed=True, details=[{"assertion": "test", "passed": True}])
        assert r.passed is True
        assert len(r.details) == 1

    def test_single_item_no_operators(self) -> None:
        """Single item with no operators evaluates directly."""
        items = [{"type": "expression", "expression": "x > 0"}]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is True

    def test_single_item_fails(self) -> None:
        """Single item that fails."""
        items = [{"type": "expression", "expression": "x > 100"}]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is False

    def test_many_items_and_one_fails(self) -> None:
        """Many items under AND, only the last fails."""
        items = [
            {"type": "expression", "expression": "a > 0"},
            self._op("and"),
            {"type": "expression", "expression": "b > 0"},
            self._op("and"),
            {"type": "expression", "expression": "c > 0"},
            self._op("and"),
            {"type": "expression", "expression": "d > 0"},
            self._op("and"),
            {"type": "expression", "expression": "e > 100"},
        ]
        result = evaluate_assertions(items, {"a": 1, "b": 2, "c": 3, "d": 4, "e": 5})
        assert result.passed is False
        # All 5 should have details
        assert len(result.details) == 5

    def test_empty_group_passes(self) -> None:
        """Empty group passes (vacuous truth)."""
        items = [{"type": "group", "items": []}]
        result = evaluate_assertions(items, {})
        assert result.passed is True

    def test_group_with_id_field_ignored(self) -> None:
        """Groups may have an id field from the frontend - ignored."""
        items = [
            {
                "type": "group",
                "id": "group-abc-123",
                "items": [
                    {"type": "expression", "expression": "x > 0"},
                ],
            },
        ]
        result = evaluate_assertions(items, {"x": 5})
        assert result.passed is True


# ============================================================================
# Type Coercion - Direct Tests for Error Paths
# ============================================================================


class TestCoercionErrorPaths:
    """Test _coerce_value error paths not reached through evaluate_assertions."""

    def test_bool_to_integer_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce boolean to integer$"):
            _coerce_value(True, "integer")

    def test_float_with_fraction_to_integer_raises(self) -> None:
        with pytest.raises(
            TypeError, match=r"^Cannot coerce 3\.5 to integer \(has fractional part\)$"
        ):
            _coerce_value(3.5, "integer")

    def test_float_without_fraction_to_integer(self) -> None:
        assert _coerce_value(3.0, "integer") == 3

    def test_list_to_integer_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce list to integer$"):
            _coerce_value([1, 2], "integer")

    def test_bool_to_float_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce boolean to float$"):
            _coerce_value(True, "float")

    def test_string_to_float_invalid_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce 'abc' to float$"):
            _coerce_value("abc", "float")

    def test_list_to_float_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce list to float$"):
            _coerce_value([1], "float")

    def test_invalid_string_to_boolean_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce 'maybe' to boolean$"):
            _coerce_value("maybe", "boolean")

    def test_int_to_boolean_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Cannot coerce int to boolean$"):
            _coerce_value(42, "boolean")

    def test_int_to_array_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Expected array, got int$"):
            _coerce_value(42, "array")

    def test_list_to_map_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Expected map, got list$"):
            _coerce_value([1], "map")

    def test_unknown_value_type_raises(self) -> None:
        with pytest.raises(ValueError, match=r"^Unknown value type: 'complex_number'$"):
            _coerce_value(42, "complex_number")

    def test_int_to_table_raises(self) -> None:
        with pytest.raises(TypeError, match=r"^Expected table, got int$"):
            _coerce_value(42, "table")


# ============================================================================
# Unknown Operator Error Paths - Direct Tests
# ============================================================================


class TestUnknownOperatorPaths:
    """Test unknown operator error paths for each type's comparison function."""

    def test_unknown_string_operator_raises(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Unknown operator 'bad_op' for type 'string'$",
        ):
            _compare_string("hello", "bad_op", "world")

    def test_unknown_boolean_operator_raises(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Unknown operator 'bad_op' for type 'boolean'$",
        ):
            _compare_boolean(True, "bad_op")

    def test_unknown_array_operator_raises(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Unknown operator 'bad_op' for type 'array'$",
        ):
            _compare_array([1, 2], "bad_op", 1)

    def test_unknown_map_operator_raises(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Unknown operator 'bad_op' for type 'map'$",
        ):
            _compare_map({"a": 1}, "bad_op", "a")


class TestFloatCoercionExactPrecision:
    """Float comparisons are evaluated in the exact-precision domain so a
    difference beyond double precision is not silently lost (REQ-3.1.3.14)."""

    def test_coerce_string_to_exact_decimal(self) -> None:
        result = _coerce_to_float("1.0000000000000000001")
        assert result == Decimal("1.0000000000000000001")
        assert isinstance(result, Decimal)

    def test_coerce_decimal_input_returns_decimal(self) -> None:
        result = _coerce_to_float(Decimal("1.5"))
        assert result == Decimal("1.5")
        assert isinstance(result, Decimal)

    def test_coerce_int_returns_decimal(self) -> None:
        result = _coerce_to_float(5)
        assert result == Decimal("5")
        assert isinstance(result, Decimal)

    def test_coerce_negative_float_string(self) -> None:
        result = _coerce_to_float("-2123.123213123123699999")
        assert result == Decimal("-2123.123213123123699999")
        assert isinstance(result, Decimal)

    def test_coerce_boolean_still_rejected(self) -> None:
        with pytest.raises(TypeError, match="^Cannot coerce boolean to float$"):
            _coerce_to_float(True)

    def test_equals_distinguishes_values_beyond_double_precision(self) -> None:
        # Both inputs round to the same IEEE-754 double, so a float-based
        # comparison would WRONGLY report equality; exact precision must not.
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "float",
                "operator": "equals",
                "reference_value": "1.0000000000000000002",
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": "1.0000000000000000001"})
        assert result.passed is False

    def test_equals_passes_for_exact_high_precision_match(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "x",
                "value_type": "float",
                "operator": "equals",
                "reference_value": "1.0000000000000000001",
                "reference_is_expression": False,
            }
        ]
        result = evaluate_assertions(items, {"x": "1.0000000000000000001"})
        assert result.passed is True


def _literal_row(
    value_type: str, operator: str, reference: object, *, variable: str = "x"
) -> dict[str, object]:
    return {
        "type": "literal",
        "variable": variable,
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference,
        "reference_is_expression": False,
    }


class TestLiteralCompareToFollowsTheNumberRule:
    """A literal compare-to value of a number row is read by the one number rule; the
    checked value keeps its run-time conversion (REQ-3.1.3.14)."""

    @pytest.mark.parametrize(
        ("value_type", "reference", "actual"),
        [
            ("integer", "30", 30),
            ("integer", "-7", -7),
            ("integer", "1234567890123456789", 1234567890123456789),
            ("float", "2.50", Decimal("2.5")),
            ("float", "30", 30),
        ],
        ids=["digits", "negative", "19-digits", "float-text", "whole-float-text"],
    )
    def test_digit_text_is_the_number_it_stands_for(
        self, value_type: str, reference: str, actual: object
    ) -> None:
        items = [_literal_row(value_type, "equals", reference)]

        assert evaluate_assertions(items, {"x": actual}).passed is True

    @pytest.mark.parametrize(
        ("value_type", "reference", "said"),
        [
            ("integer", " 30", "is not a valid integer"),
            ("integer", "+30", "is not a valid integer"),
            ("integer", "1_000", "is not a valid integer"),
            ("integer", "12345678901234567890", "allows at most 19 digits, got 20"),
            ("float", "1e3", "is not a valid float"),
            ("float", "NaN", "is not a valid float"),
            (
                "float",
                "1.2345678901234567890123456789",
                "allows at most 28 significant digits, got 29",
            ),
        ],
        ids=["space", "plus", "underscore", "20-digits", "exponent", "nan", "29-digits"],
    )
    def test_a_literal_that_breaks_the_rule_stops_the_check(
        self, value_type: str, reference: str, said: str
    ) -> None:
        items = [_literal_row(value_type, "less_than", reference)]

        with pytest.raises(TypeError, match=f"^The value compared with 'x' {re.escape(said)}$"):
            evaluate_assertions(items, {"x": 1})

    def test_a_filter_names_the_cell(self) -> None:
        items = [_literal_row("integer", "equals", "1e3", variable="_cell")]

        with pytest.raises(
            TypeError, match=r"^The value compared with the cell is not a valid integer$"
        ):
            evaluate_assertions(items, {"_cell": 1})

    def test_a_length_past_19_digits_stops_the_check(self) -> None:
        items = [_literal_row("array", "length_equals", "12345678901234567890")]

        with pytest.raises(
            TypeError, match=r"^The value compared with 'x' allows at most 19 digits, got 20$"
        ):
            evaluate_assertions(items, {"x": [1]})

    def test_the_checked_value_keeps_its_conversion(self) -> None:
        items = [_literal_row("integer", "equals", "30")]

        assert evaluate_assertions(items, {"x": " 30 "}).passed is True

    def test_an_expression_compare_to_keeps_its_conversion(self) -> None:
        items = [{**_literal_row("integer", "equals", "limit"), "reference_is_expression": True}]

        assert evaluate_assertions(items, {"x": 30, "limit": " 30 "}).passed is True


class TestAssertionsAreReadOnly:
    """An assertion is a read: it may not change the data it inspects.

    Covers the Assert block's expression items and the reference expression of
    a literal item, which is also every If, Switch, While and Wait Until
    condition.
    """

    def test_expression_assertion_that_changes_a_list_is_refused(self) -> None:
        rows = [1]
        items = [{"type": "expression", "expression": "rows.append(5) or True"}]

        with pytest.raises(BlockedExpressionError) as exc_info:
            evaluate_assertions(items, {"rows": rows})

        assert str(exc_info.value) == (
            "The append method changes data. An expression can only read data, "
            "not change it. To change a variable, add a Variable Setter Block. "
            "Expression: rows.append(5) or True"
        )
        assert rows == [1]

    def test_literal_reference_expression_that_changes_a_list_is_refused(self) -> None:
        rows = [1]
        items = [
            {
                "type": "literal",
                "variable": "count",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": "rows.append(6) or 1",
                "reference_is_expression": True,
            }
        ]

        with pytest.raises(BlockedExpressionError):
            evaluate_assertions(items, {"count": 1, "rows": rows})

        assert rows == [1]

    def test_literal_reference_expression_that_changes_a_map_is_refused(self) -> None:
        seen = {"x": 1}
        items = [
            {
                "type": "literal",
                "variable": "count",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": 'seen.update({"y": 2}) or 1',
                "reference_is_expression": True,
            }
        ]

        with pytest.raises(BlockedExpressionError):
            evaluate_assertions(items, {"count": 1, "seen": seen})

        assert seen == {"x": 1}

    def test_expression_assertion_that_only_reads_still_passes(self) -> None:
        items = [{"type": "expression", "expression": "len(rows) == 2"}]

        assert evaluate_assertions(items, {"rows": [1, 2]}).passed is True

    def test_literal_reference_expression_that_only_reads_still_passes(self) -> None:
        items = [
            {
                "type": "literal",
                "variable": "count",
                "value_type": "integer",
                "operator": "equals",
                "reference_value": "len(rows)",
                "reference_is_expression": True,
            }
        ]

        assert evaluate_assertions(items, {"count": 2, "rows": [1, 2]}).passed is True


# ============================================================================
# Null holds nothing (REQ-3.1.3.25)
# ============================================================================


def _null_rule_check(
    operator: str,
    value_type: str,
    reference_value: object = None,
    reference_is_expression: bool = False,
) -> dict:
    return {
        "type": "literal",
        "variable": "x",
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference_value,
        "reference_is_expression": reference_is_expression,
    }


def _table_with_rows(count: int) -> Table:
    if count == 0:
        return Table(columns=["name"])
    return Table.from_list([{"name": f"row-{index}"} for index in range(count)])


_NUMERIC_BINARY = (
    "equals",
    "not_equals",
    "less_than",
    "greater_than",
    "less_or_equal",
    "greater_or_equal",
)
_STRING_BINARY = (
    "equals",
    "not_equals",
    "contains",
    "does_not_contain",
    "starts_with",
    "ends_with",
    "matches_regex",
)

_HOLDS_NOTHING_ROWS = [
    *[
        (numeric, operator, reference, expected)
        for numeric in ("integer", "float")
        for operator, reference, expected in (
            ("not_equals", 0, True),
            ("is_null", None, True),
            ("equals", 0, False),
            ("less_than", 0, False),
            ("greater_than", 0, False),
            ("less_or_equal", 0, False),
            ("greater_or_equal", 0, False),
            ("is_not_null", None, False),
        )
    ],
    ("string", "not_equals", "done", True),
    ("string", "not_equals", "", True),
    ("string", "does_not_contain", "a", True),
    ("string", "is_null", None, True),
    ("string", "equals", "done", False),
    ("string", "equals", "", False),
    ("string", "contains", "a", False),
    ("string", "starts_with", "a", False),
    ("string", "ends_with", "a", False),
    ("string", "matches_regex", "a", False),
    ("string", "matches_regex", "^$", False),
    ("string", "is_not_null", None, False),
    ("boolean", "is_null", None, True),
    ("boolean", "is_true", None, False),
    ("boolean", "is_false", None, False),
    ("boolean", "is_not_null", None, False),
    ("array", "does_not_contain", 1, True),
    ("array", "is_empty", None, True),
    ("array", "length_equals", 0, True),
    ("array", "is_null", None, True),
    ("array", "contains", 1, False),
    ("array", "is_not_empty", None, False),
    ("array", "length_equals", 2, False),
    ("array", "is_not_null", None, False),
    ("map", "does_not_have_key", "a", True),
    ("map", "is_empty", None, True),
    ("map", "is_null", None, True),
    ("map", "has_key", "a", False),
    ("map", "is_not_empty", None, False),
    ("map", "is_not_null", None, False),
    ("table", "is_null", None, True),
    ("table", "is_empty", None, True),
    ("table", "is_not_null", None, False),
    ("table", "is_not_empty", None, False),
]

_HELD_VALUES = [
    pytest.param("integer", 0, id="integer-zero"),
    pytest.param("float", WaveDecimal("0.0"), id="float-zero"),
    pytest.param("string", "", id="string-empty"),
    pytest.param("boolean", False, id="boolean-false"),
    pytest.param("array", [], id="array-empty"),
    pytest.param("map", {}, id="map-empty"),
    pytest.param("table", _table_with_rows(0), id="table-no-rows"),
]

_BINARY_ROWS_ON_A_HELD_VALUE = [
    *[("integer", operator, 5) for operator in _NUMERIC_BINARY],
    *[("float", operator, WaveDecimal("1.5")) for operator in _NUMERIC_BINARY],
    *[("string", operator, "abc") for operator in _STRING_BINARY],
    *[
        ("array", operator, [1, 2])
        for operator in ("contains", "does_not_contain", "length_equals")
    ],
    *[("map", operator, {"a": 1}) for operator in ("has_key", "does_not_have_key")],
]


class TestNullHoldsNothing:
    """A check reads null as a value that holds nothing, the same for every type."""

    @pytest.mark.parametrize(
        ("value_type", "operator", "reference", "expected"),
        [pytest.param(*row, id=f"{row[0]}-{row[1]}-{row[2]!r}") for row in _HOLDS_NOTHING_ROWS],
    )
    def test_a_null_value_answers_by_the_holds_nothing_rule(
        self, value_type: str, operator: str, reference: object, expected: bool
    ) -> None:
        items = [_null_rule_check(operator, value_type, reference)]

        result = evaluate_assertions(items, {"x": None})

        assert result.passed is expected
        assert result.details[0]["passed"] is expected

    @pytest.mark.parametrize(("value_type", "value"), _HELD_VALUES)
    def test_is_null_is_false_on_a_held_value(self, value_type: str, value: object) -> None:
        items = [_null_rule_check("is_null", value_type)]

        assert evaluate_assertions(items, {"x": value}).passed is False

    @pytest.mark.parametrize(("value_type", "value"), _HELD_VALUES)
    def test_is_not_null_is_true_on_a_held_value(self, value_type: str, value: object) -> None:
        items = [_null_rule_check("is_not_null", value_type)]

        assert evaluate_assertions(items, {"x": value}).passed is True

    @pytest.mark.parametrize(
        ("rows", "operator", "expected"),
        [
            pytest.param(0, "is_empty", True, id="no-rows-is-empty"),
            pytest.param(0, "is_not_empty", False, id="no-rows-is-not-empty"),
            pytest.param(2, "is_empty", False, id="two-rows-is-empty"),
            pytest.param(2, "is_not_empty", True, id="two-rows-is-not-empty"),
        ],
    )
    def test_a_table_is_empty_when_it_has_no_rows(
        self, rows: int, operator: str, expected: bool
    ) -> None:
        items = [_null_rule_check(operator, "table")]

        assert evaluate_assertions(items, {"x": _table_with_rows(rows)}).passed is expected

    @pytest.mark.parametrize("operator", ["equals", "not_equals"])
    def test_a_table_check_offers_no_other_operator(self, operator: str) -> None:
        items = [_null_rule_check(operator, "table", "anything")]

        with pytest.raises(ValueError, match=rf"^Unknown operator '{operator}' for type 'table'$"):
            evaluate_assertions(items, {"x": _table_with_rows(2)})

    @pytest.mark.parametrize(
        ("operator", "expected"),
        [("is_null", False), ("is_not_null", True)],
    )
    def test_a_wrong_typed_value_answers_the_null_operators_without_coercion(
        self, operator: str, expected: bool
    ) -> None:
        items = [_null_rule_check(operator, "integer")]

        assert evaluate_assertions(items, {"x": "abc"}).passed is expected

    @pytest.mark.parametrize(
        ("value_type", "operator", "held"),
        [pytest.param(*row, id=f"{row[0]}-{row[1]}") for row in _BINARY_ROWS_ON_A_HELD_VALUE],
    )
    def test_a_null_compare_to_value_fails_and_names_the_variable(
        self, value_type: str, operator: str, held: object
    ) -> None:
        items = [_null_rule_check(operator, value_type, None)]

        with pytest.raises(NullValueError, match=r"^The value compared with 'x' is null$"):
            evaluate_assertions(items, {"x": held})

    def test_a_compare_to_expression_giving_null_fails_and_names_the_variable(self) -> None:
        items = [_null_rule_check("equals", "integer", "nothing", reference_is_expression=True)]

        with pytest.raises(NullValueError, match=r"^The value compared with 'x' is null$"):
            evaluate_assertions(items, {"x": 5, "nothing": None})

    @pytest.mark.parametrize(
        ("value_type", "operator", "held", "expected"),
        [
            pytest.param("boolean", "is_true", True, True, id="boolean-is_true"),
            pytest.param("boolean", "is_false", False, True, id="boolean-is_false"),
            pytest.param("array", "is_empty", [1], False, id="array-is_empty"),
            pytest.param("map", "is_not_empty", {"a": 1}, True, id="map-is_not_empty"),
            pytest.param("integer", "is_null", 5, False, id="integer-is_null"),
            pytest.param("string", "is_not_null", "a", True, id="string-is_not_null"),
        ],
    )
    def test_a_unary_operator_ignores_a_null_compare_to_value(
        self, value_type: str, operator: str, held: object, expected: bool
    ) -> None:
        items = [_null_rule_check(operator, value_type, None)]

        assert evaluate_assertions(items, {"x": held}).passed is expected

    def test_a_not_null_guard_short_circuits_the_comparison_after_it(self) -> None:
        items = [
            _null_rule_check("is_not_null", "string"),
            {"type": "operator", "value": "and"},
            _null_rule_check("equals", "string", "a"),
        ]

        result = evaluate_assertions(items, {"x": None})

        assert result.passed is False
        assert [detail["assertion"]["operator"] for detail in result.details] == ["is_not_null"]

    def test_an_operator_the_type_does_not_offer_is_refused_on_a_null_value(self) -> None:
        items = [_null_rule_check("is_empty", "integer")]

        with pytest.raises(ValueError, match=r"^Unknown operator 'is_empty' for type 'integer'$"):
            evaluate_assertions(items, {"x": None})

    @pytest.mark.parametrize(
        ("operator", "value", "expected"),
        [
            pytest.param("is_null", None, True, id="is_null-on-null"),
            pytest.param("is_null", 5, False, id="is_null-on-a-value"),
            pytest.param("is_not_null", None, False, id="is_not_null-on-null"),
            pytest.param("is_not_null", "a", True, id="is_not_null-on-a-value"),
        ],
    )
    def test_an_untyped_null_check_answers_on_null_and_on_a_value(
        self, operator: str, value: object, expected: bool
    ) -> None:
        row = _null_rule_check(operator, "string")
        del row["value_type"]

        assert evaluate_assertions([row], {"x": value}).passed is expected

    def test_an_untyped_row_with_another_operator_is_refused(self) -> None:
        row = _null_rule_check("equals", "string", "a")
        del row["value_type"]

        with pytest.raises(ValueError, match=r"^Unknown value type: ''$"):
            evaluate_assertions([row], {"x": "a"})

    def test_the_operators_that_take_no_compare_to_value_are_named_once(self) -> None:
        from wavecore.controls import assertion_evaluator

        unary = assertion_evaluator.UNARY_OPERATORS

        assert isinstance(unary, frozenset)
        assert unary == frozenset(
            {"is_true", "is_false", "is_empty", "is_not_empty", "is_null", "is_not_null"}
        )
