"""
Assertion evaluator module for the Assert control.

Pure logic module that evaluates typed assertions with interleaved AND/OR operators.
Takes an interleaved assertion list and a variable context, evaluates each assertion,
and returns structured results.

Format: [assertion, operator, assertion, operator, assertion]
- Assertion items: literal, expression, or group
- Operator items: {"type": "operator", "value": "and"|"or"}
- Group items: {"type": "group", "items": [...]} where items is the same interleaved format

AND has higher precedence than OR (standard boolean logic).

Error handling contract:
- Assertion failure (comparison returns False) = controlled outcome, passed=False
- Evaluation error (Python exception) = raises exception, NOT caught here
  The Assert control handles these differently at a higher level.

A null checked value holds nothing: every operator answers it without an error
(REQ-3.1.3.25); only a null compare-to value fails the check (REQ-3.1.3.21).
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, cast

from wavecore.core.execution.plugin_executor import evaluate_expression
from wavecore.core.expressions.errors import NullValueError
from wavecore.core.number_rule import NumberType
from wavecore.core.table import Table
from wavecore.core.table_values import as_table
from wavecore.core.variables.decimal_value import WaveDecimal, to_wave_decimal
from wavecore.core.variables.print_form import value_text
from wavecore.core.variables.value_checks import (
    NUMBER_TYPES,
    NumberForm,
    ValueProblem,
    number_value_problem,
)

NULL_OPERATORS = frozenset({"is_null", "is_not_null"})
UNARY_OPERATORS = frozenset({"is_true", "is_false", "is_empty", "is_not_empty", *NULL_OPERATORS})

_NUMERIC_OPERATORS = frozenset(
    {"equals", "not_equals", "less_than", "greater_than", "less_or_equal", "greater_or_equal"}
)

# The operators of each value type, besides is_null / is_not_null, which every type offers.
CHECK_OPERATORS: dict[str, frozenset[str]] = {
    "integer": _NUMERIC_OPERATORS,
    "float": _NUMERIC_OPERATORS,
    "string": frozenset(
        {
            "equals",
            "not_equals",
            "contains",
            "does_not_contain",
            "starts_with",
            "ends_with",
            "matches_regex",
        }
    ),
    "boolean": frozenset({"is_true", "is_false"}),
    "array": frozenset(
        {"contains", "does_not_contain", "is_empty", "is_not_empty", "length_equals"}
    ),
    "map": frozenset({"has_key", "does_not_have_key", "is_empty", "is_not_empty"}),
    "table": frozenset({"is_empty", "is_not_empty"}),
}

# The operators of a number, text or boolean that hold on a null value; every other one is false.
HOLDS_ON_NULL = frozenset({"not_equals", "does_not_contain"})

# A CSV / Excel filter condition tests the cell under it, bound as `_cell`.
_FILTER_CELL = "_cell"


def _compared_number_type(row: Mapping[str, Any]) -> NumberType | None:
    """The number type a literal row's compare-to value is held to, or None."""
    operator = row.get("operator")
    if row.get("reference_is_expression") or operator in UNARY_OPERATORS:
        return None
    value_type = row.get("value_type")
    if value_type in NUMBER_TYPES:
        return cast(NumberType, value_type)
    if value_type == "array" and operator == "length_equals":
        return "integer"
    return None


def compare_to_problem(row: Mapping[str, Any]) -> ValueProblem | None:
    """How a literal row's typed compare-to value breaks the one number rule, or None."""
    reference = row.get("reference_value")
    declared = _compared_number_type(row)
    if reference is None or declared is None:
        return None
    return number_value_problem(reference, declared)


def compare_to_number(row: Mapping[str, Any], form: NumberForm) -> Any:
    """A literal row's compare-to value, a number of its type written by ``form``."""
    declared = _compared_number_type(row)
    reference = row.get("reference_value")
    return reference if declared is None else form(reference, (declared,))


def compared_subject(row: Mapping[str, Any]) -> str:
    """What a row's compare-to value is named by in a message."""
    variable = row.get("variable")
    shown = "the cell" if variable == _FILTER_CELL else f"'{variable}'"
    return f"The value compared with {shown}"


@dataclass
class AssertionResult:
    """Result of evaluating an assertion tree.

    Attributes:
        passed: Overall pass/fail for the entire assertion tree
        details: Per-assertion results, each containing:
            - assertion: dict describing which assertion was evaluated
            - passed: bool for this individual assertion
    """

    passed: bool
    details: list[dict[str, Any]] = field(default_factory=list)


# ============================================================================
# Type coercion
# ============================================================================

_BOOLEAN_TRUE_STRINGS = {"true", "1", "yes"}
_BOOLEAN_FALSE_STRINGS = {"false", "0", "no"}


def _coerce_to_integer(value: Any) -> int:
    """Coerce a value to integer type."""
    if isinstance(value, bool):
        raise TypeError("Cannot coerce boolean to integer")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        i = int(value)
        if value != i:
            raise TypeError(f"Cannot coerce {value!r} to integer (has fractional part)")
        return i
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError as e:
            raise TypeError(f"Cannot coerce {value!r} to integer") from e
    raise TypeError(f"Cannot coerce {type(value).__name__} to integer")


def _coerce_to_float(value: Any) -> Decimal:
    """Coerce a value to an exact-precision Decimal for float comparison.

    Comparisons run in the exact domain so a difference beyond double precision
    is not silently lost (REQ-3.1.3.14).
    """
    if isinstance(value, bool):
        raise TypeError("Cannot coerce boolean to float")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return WaveDecimal(str(value))
    if isinstance(value, str):
        coerced = to_wave_decimal(value)
        if isinstance(coerced, Decimal):
            return coerced
        raise TypeError(f"Cannot coerce {value!r} to float")
    raise TypeError(f"Cannot coerce {type(value).__name__} to float")


def _coerce_to_boolean(value: Any) -> bool:
    """Coerce a value to boolean type."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        low = value.strip().lower()
        if low in _BOOLEAN_TRUE_STRINGS:
            return True
        if low in _BOOLEAN_FALSE_STRINGS:
            return False
        raise TypeError(f"Cannot coerce {value!r} to boolean")
    raise TypeError(f"Cannot coerce {type(value).__name__} to boolean")


def _coerce_to_array(value: Any) -> list[Any]:
    """Coerce a value to array type (validates type only)."""
    if not isinstance(value, list):
        raise TypeError(f"Expected array, got {type(value).__name__}")
    return value


def _coerce_to_map(value: Any) -> dict[str, Any]:
    """Coerce a value to map type (validates type only)."""
    if not isinstance(value, dict):
        raise TypeError(f"Expected map, got {type(value).__name__}")
    return value


def _coerce_to_table(value: Any) -> Table:
    """Realize a table in either runtime form (validates type only)."""
    table = as_table(value)
    if table is None:
        raise TypeError(f"Expected table, got {type(value).__name__}")
    return table


_COERCION_DISPATCH: dict[str, Any] = {
    "integer": _coerce_to_integer,
    "float": _coerce_to_float,
    "string": lambda value: str(value),
    "boolean": _coerce_to_boolean,
    "array": _coerce_to_array,
    "map": _coerce_to_map,
    "table": _coerce_to_table,
}


def _coerce_value(value: Any, value_type: str) -> Any:
    """Coerce a held (non-null) value to the declared type for comparison.

    Args:
        value: The raw value to coerce
        value_type: Target type string (integer, float, string, boolean, array, map, table)

    Returns:
        The coerced value

    Raises:
        TypeError: If the value cannot be coerced to the target type
    """
    coercion_fn = _COERCION_DISPATCH.get(value_type)
    if coercion_fn is None:
        raise ValueError(f"Unknown value type: '{value_type}'")

    return coercion_fn(value)


# ============================================================================
# Comparison operators by type
# ============================================================================


def _compare_numeric(
    actual: int | float | Decimal,
    operator: str,
    reference: int | float | Decimal,
    value_type: str,
) -> bool:
    """Apply numeric comparison operator.

    Raises:
        ValueError: If operator is unknown for the given type
    """
    if operator == "equals":
        return actual == reference
    if operator == "not_equals":
        return actual != reference
    if operator == "less_than":
        return actual < reference
    if operator == "greater_than":
        return actual > reference
    if operator == "less_or_equal":
        return actual <= reference
    if operator == "greater_or_equal":
        return actual >= reference
    raise ValueError(f"Unknown operator '{operator}' for type '{value_type}'")


def _compare_string(actual: str, operator: str, reference: str) -> bool:
    """Apply string comparison operator.

    Raises:
        ValueError: If operator is unknown for string type
        re.error: If regex pattern is invalid
    """
    if operator == "equals":
        return actual == reference
    if operator == "not_equals":
        return actual != reference
    if operator == "contains":
        return reference in actual
    if operator == "does_not_contain":
        return reference not in actual
    if operator == "starts_with":
        return actual.startswith(reference)
    if operator == "ends_with":
        return actual.endswith(reference)
    if operator == "matches_regex":
        return bool(re.search(reference, actual))
    raise ValueError(f"Unknown operator '{operator}' for type 'string'")


def _compare_boolean(actual: bool, operator: str) -> bool:
    """Apply boolean comparison operator.

    Raises:
        ValueError: If operator is unknown for boolean type
    """
    if operator == "is_true":
        return actual is True
    if operator == "is_false":
        return actual is False
    raise ValueError(f"Unknown operator '{operator}' for type 'boolean'")


def _not_a_length(reference: Any) -> ValueError:
    return ValueError(f"'length equals' needs a whole number, got '{value_text(reference)}'")


def _whole_number(reference: Any) -> int:
    """A 'length equals' compare-to value read as a whole number."""
    try:
        return _coerce_to_integer(reference)
    except TypeError:
        raise _not_a_length(reference) from None


def _as_item_type(reference: str, item: Any) -> Any:
    """A text compare-to value read as a number item's type when it converts, else the text."""
    if isinstance(item, bool) or not isinstance(item, int | float | Decimal):
        return reference
    try:
        if isinstance(item, int):
            return int(reference)
        return _coerce_to_float(reference) if isinstance(item, Decimal) else float(reference)
    except (TypeError, ValueError):
        return reference


def _array_holds(actual: list[Any], reference: Any) -> bool:
    """Whether the list holds the compare-to value, a text value read as each item's type."""
    if not isinstance(reference, str):
        return reference in actual
    return any(item == _as_item_type(reference, item) for item in actual)


def _compare_array(actual: list[Any], operator: str, reference: Any) -> bool:
    """Apply array comparison operator.

    Raises:
        ValueError: If operator is unknown for array type, or a length is not a whole number
    """
    if operator == "contains":
        return _array_holds(actual, reference)
    if operator == "does_not_contain":
        return not _array_holds(actual, reference)
    if operator == "is_empty":
        return len(actual) == 0
    if operator == "is_not_empty":
        return len(actual) > 0
    if operator == "length_equals":
        return len(actual) == _whole_number(reference)
    raise ValueError(f"Unknown operator '{operator}' for type 'array'")


def _compare_map(actual: dict[str, Any], operator: str, reference: Any) -> bool:
    """Apply map comparison operator.

    Raises:
        ValueError: If operator is unknown for map type
    """
    if operator == "has_key":
        return reference in actual
    if operator == "does_not_have_key":
        return reference not in actual
    if operator == "is_empty":
        return len(actual) == 0
    if operator == "is_not_empty":
        return len(actual) > 0
    raise ValueError(f"Unknown operator '{operator}' for type 'map'")


def _compare_table(actual: Table, operator: str) -> bool:
    """A table is empty when it has no rows."""
    if operator == "is_empty":
        return actual.row_count() == 0
    if operator == "is_not_empty":
        return actual.row_count() > 0
    raise ValueError(f"Unknown operator '{operator}' for type 'table'")


_EMPTY_COLLECTIONS: dict[str, Any] = {
    "array": list,
    "map": dict,
    "table": lambda: Table(columns=[]),
}


# ============================================================================
# Core evaluation logic
# ============================================================================


def _evaluate_literal(assertion: dict[str, Any], variables: dict[str, Any]) -> bool:
    """Evaluate a single literal assertion.

    Args:
        assertion: Literal assertion dict with variable, value_type, operator,
                   reference_value, reference_is_expression
        variables: Variable context for lookups

    Returns:
        True if the assertion passes, False otherwise

    Raises:
        KeyError: If variable not found in context
        NullValueError: If a binary operator's compare-to value is null
        TypeError: If type coercion fails
        ValueError: If operator or value_type is unknown
        re.error: If regex pattern is invalid
    """
    operator = assertion["operator"]

    # Look up variable - KeyError propagates if not found
    actual_raw = variables[assertion["variable"]]

    # Answered before the type is read, so a wrong-typed or untyped value never raises.
    if operator in NULL_OPERATORS:
        is_null = actual_raw is None
        return is_null if operator == "is_null" else not is_null

    value_type = assertion.get("value_type", "")
    if value_type not in CHECK_OPERATORS:
        raise ValueError(f"Unknown value type: '{value_type}'")

    reference = None if operator in UNARY_OPERATORS else _compare_to_value(assertion, variables)
    if actual_raw is None:
        return _answer_on_null(value_type, operator, reference)
    return _compare(_coerce_value(actual_raw, value_type), value_type, operator, reference)


def _compare_to_value(assertion: dict[str, Any], variables: dict[str, Any]) -> Any:
    """A binary row's compare-to value, which is a setting and may not be null."""
    reference = assertion.get("reference_value")
    if assertion.get("reference_is_expression", False) and isinstance(reference, str):
        reference = evaluate_expression(reference, variables)
    elif (problem := compare_to_problem(assertion)) is not None:
        if assertion.get("value_type") == "array" and problem.problem == "type":
            raise _not_a_length(reference)
        raise TypeError(problem.describe(compared_subject(assertion)))
    if reference is None:
        raise NullValueError(f"The value compared with '{assertion['variable']}' is null")
    return reference


def _answer_on_null(value_type: str, operator: str, reference: Any) -> bool:
    """A null value holds nothing: a null collection answers as an empty one."""
    empty = _EMPTY_COLLECTIONS.get(value_type)
    if empty is not None:
        return _compare(empty(), value_type, operator, reference)
    if operator not in CHECK_OPERATORS[value_type]:
        raise ValueError(f"Unknown operator '{operator}' for type '{value_type}'")
    return operator in HOLDS_ON_NULL


def _compare(actual: Any, value_type: str, operator: str, reference: Any) -> bool:
    """Apply the operator of a known value type to a held value."""
    if value_type in ("integer", "float", "string"):
        # A unary operator brings no compare-to value; the compare refuses it by name.
        typed: Any = reference if reference is None else _coerce_value(reference, value_type)
        if value_type == "string":
            return _compare_string(actual, operator, typed)
        return _compare_numeric(actual, operator, typed, value_type)
    if value_type == "boolean":
        return _compare_boolean(actual, operator)
    if value_type == "array":
        return _compare_array(actual, operator, reference)
    if value_type == "map":
        return _compare_map(actual, operator, reference)
    return _compare_table(actual, operator)


def _evaluate_expression_assertion(assertion: dict[str, Any], variables: dict[str, Any]) -> bool:
    """Evaluate a single expression assertion.

    Args:
        assertion: Expression assertion dict with expression field
        variables: Variable context for expression evaluation

    Returns:
        True if the assertion passes, False otherwise

    Raises:
        InvalidExpressionError: If expression has syntax errors or undefined variables
        BlockedExpressionError: If expression contains blocked patterns
    """
    expression = assertion["expression"]
    result = evaluate_expression(expression, variables)
    return bool(result)


def _evaluate_single_item(
    item: dict[str, Any], variables: dict[str, Any]
) -> tuple[bool, list[dict[str, Any]]]:
    """Evaluate a single assertion item (literal, expression, or group).

    Args:
        item: Assertion item dict
        variables: Variable context

    Returns:
        Tuple of (passed, details_list)

    Raises:
        ValueError: If item type is unknown
        Various exceptions from literal/expression evaluation
    """
    item_type = item["type"]

    if item_type == "literal":
        # Capture actual value for diagnostic logging
        var_name = item["variable"]
        actual_value = variables[var_name]
        passed = _evaluate_literal(item, variables)
        detail = {"assertion": item, "passed": passed, "actual_value": actual_value}
        return passed, [detail]

    if item_type == "expression":
        passed = _evaluate_expression_assertion(item, variables)
        detail = {"assertion": item, "passed": passed}
        return passed, [detail]

    if item_type == "group":
        group_items = item["items"]
        return _evaluate_assertion_list(group_items, variables)

    raise ValueError(f"Unknown assertion item type: '{item_type}'")


def _split_interleaved(
    items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Separate assertions and operators from an interleaved list.

    Args:
        items: Interleaved list of assertion and operator items.

    Returns:
        Tuple of (assertions, operators)
    """
    assertions: list[dict[str, Any]] = []
    operators: list[str] = []
    for item in items:
        if item.get("type") == "operator":
            operators.append(item["value"])
        else:
            assertions.append(item)
    return assertions, operators


def _build_and_segments(operators: list[str]) -> list[list[int]]:
    """Split assertion indices into AND-segments at OR boundaries.

    Args:
        operators: List of operator strings ("and" or "or")

    Returns:
        List of segments, where each segment is a list of assertion indices
    """
    segments: list[list[int]] = [[0]]
    for i, op in enumerate(operators):
        if op == "or":
            segments.append([i + 1])
        else:
            segments[-1].append(i + 1)
    return segments


def _evaluate_and_segment(
    segment: list[int],
    assertions: list[dict[str, Any]],
    variables: dict[str, Any],
) -> tuple[bool, list[dict[str, Any]]]:
    """Evaluate a single AND-connected segment with short-circuit.

    Args:
        segment: List of assertion indices in this segment
        assertions: All assertions
        variables: Variable context

    Returns:
        Tuple of (segment_passed, details)
    """
    details: list[dict[str, Any]] = []
    for idx in segment:
        passed, item_details = _evaluate_single_item(assertions[idx], variables)
        details.extend(item_details)
        if not passed:
            return False, details
    return True, details


def _evaluate_assertion_list(
    items: list[dict[str, Any]], variables: dict[str, Any]
) -> tuple[bool, list[dict[str, Any]]]:
    """Evaluate an interleaved assertion list with AND/OR precedence.

    AND has higher precedence than OR (standard boolean logic):
    - A OR B AND C = A OR (B AND C)

    Algorithm:
    1. Separate assertion items and operator items from the interleaved list
    2. Split into AND-segments at OR boundaries
    3. For each segment: evaluate with AND (short-circuit on first false)
    4. OR across segments (short-circuit on first true)

    Args:
        items: Interleaved list of assertion and operator items.
               Format: [assertion, operator, assertion, operator, ...]
        variables: Variable context

    Returns:
        Tuple of (overall_passed, all_details)
    """
    if not items:
        return True, []

    assertions, operators = _split_interleaved(items)

    # Single assertion - no operators
    if not operators:
        return _evaluate_single_item(assertions[0], variables)

    segments = _build_and_segments(operators)

    # Evaluate segments with OR across them, AND within each
    all_details: list[dict[str, Any]] = []
    for segment in segments:
        segment_passed, segment_details = _evaluate_and_segment(segment, assertions, variables)
        all_details.extend(segment_details)
        if segment_passed:
            return True, all_details  # OR short-circuit across segments

    return False, all_details


# ============================================================================
# Public API
# ============================================================================


def evaluate_assertions(
    items: list[dict[str, Any]],
    variables: dict[str, Any],
) -> AssertionResult:
    """Evaluate an interleaved assertion list and return structured results.

    Main entry point for the assertion evaluator. Takes an interleaved list
    of assertion items and operator items, evaluates them against the provided
    variable context using AND-before-OR precedence.

    Args:
        items: Interleaved list of assertion and operator items:
            - Literal: {type: "literal", variable, value_type, operator,
                       reference_value, reference_is_expression}
            - Expression: {type: "expression", expression}
            - Group: {type: "group", items: [...]} (items is interleaved too)
            - Operator: {type: "operator", value: "and"|"or"}
        variables: Variable context dict for lookups and expression evaluation

    Returns:
        AssertionResult with overall passed/failed and per-assertion details

    Raises:
        KeyError: If a referenced variable is not in the context
        TypeError: If type coercion fails
        ValueError: If an operator or value_type is unknown
        InvalidExpressionError: If an expression has syntax errors or undefined variables
        BlockedExpressionError: If an expression contains blocked patterns
        re.error: If a regex pattern is invalid
    """
    passed, details = _evaluate_assertion_list(items, variables)
    return AssertionResult(passed=passed, details=details)
