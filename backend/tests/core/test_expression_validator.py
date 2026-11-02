"""
Tests for AST-based expression validator.

Tests requirements:
- Proper Python syntax validation
- Comprehension scope handling (loop variables are local)
- Lambda parameter handling
- Blocked pattern detection
- Undefined variable detection
"""

import pytest

from wavecore.core.expressions.validator import (
    ValidationIssue,
    ValidationResult,
    validate_expression,
)


class TestValidateExpression:
    """Tests for validate_expression function."""

    def test_simple_variable_valid(self) -> None:
        """Valid simple variable reference."""
        result = validate_expression("username", {"username"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_simple_variable_undefined(self) -> None:
        """Undefined simple variable generates warning."""
        result = validate_expression("unknown", {"username"})

        assert result.valid is True  # Warnings don't make it invalid
        assert len(result.issues) == 1
        assert result.issues[0].code == "undefined_variable"
        assert "unknown" in result.issues[0].message

    def test_arithmetic_expression(self) -> None:
        """Valid arithmetic expression."""
        result = validate_expression("count + 1", {"count"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_method_call(self) -> None:
        """Valid method call on variable."""
        result = validate_expression("username.upper()", {"username"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_chained_method_calls(self) -> None:
        """Valid chained method calls."""
        result = validate_expression("username.strip().upper().replace('A', 'B')", {"username"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_builtin_function(self) -> None:
        """Valid builtin function call."""
        result = validate_expression("len(items)", {"items"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_syntax_error(self) -> None:
        """Invalid Python syntax generates error."""
        result = validate_expression("username +", {"username"})

        assert result.valid is False
        assert len(result.issues) == 1
        assert result.issues[0].type == "error"
        assert result.issues[0].code == "syntax_error"


class TestComprehensionScopes:
    """Tests for list/dict/set comprehension scope handling."""

    def test_list_comprehension_loop_var_is_local(self) -> None:
        """Loop variable in list comprehension should be local."""
        result = validate_expression(
            "[x * x for x in range(5)]", set()  # No external variables needed
        )

        assert result.valid is True
        assert len(result.issues) == 0

    def test_list_comprehension_with_external_var(self) -> None:
        """List comprehension can reference external variables."""
        result = validate_expression("[x * multiplier for x in items]", {"items", "multiplier"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_list_comprehension_missing_external_var(self) -> None:
        """Missing external variable in list comprehension generates warning."""
        result = validate_expression(
            "[x * multiplier for x in items]", {"items"}  # missing 'multiplier'
        )

        assert result.valid is True  # Warnings don't fail
        assert len(result.issues) == 1
        assert result.issues[0].code == "undefined_variable"
        assert "multiplier" in result.issues[0].message

    def test_list_comprehension_with_condition(self) -> None:
        """List comprehension with if clause."""
        result = validate_expression("[x for x in items if x > threshold]", {"items", "threshold"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_dict_comprehension(self) -> None:
        """Dict comprehension with key-value unpacking."""
        result = validate_expression("{k: v.upper() for k, v in data.items()}", {"data"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_dict_comprehension_with_condition(self) -> None:
        """Dict comprehension with if clause to cover line 131."""
        result = validate_expression(
            "{k: v for k, v in items.items() if v > threshold}", {"items", "threshold"}
        )

        assert result.valid is True
        assert len(result.issues) == 0

    def test_set_comprehension(self) -> None:
        """Set comprehension."""
        result = validate_expression("{x * 2 for x in numbers}", {"numbers"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_generator_expression(self) -> None:
        """Generator expression."""
        result = validate_expression("sum(x * x for x in numbers)", {"numbers"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_nested_comprehension(self) -> None:
        """Nested comprehensions with multiple loop variables."""
        result = validate_expression("[x + y for x in range(3) for y in range(3)]", set())

        assert result.valid is True
        assert len(result.issues) == 0

    def test_comprehension_tuple_unpacking(self) -> None:
        """Tuple unpacking in comprehension loop."""
        result = validate_expression("[a + b for a, b in pairs]", {"pairs"})

        assert result.valid is True
        assert len(result.issues) == 0


class TestLambdaScopes:
    """Tests for lambda expression scope handling."""

    def test_lambda_parameter_is_local(self) -> None:
        """Lambda parameter should be local."""
        result = validate_expression("list(map(lambda x: x * 2, items))", {"items"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_lambda_multiple_params(self) -> None:
        """Lambda with multiple parameters."""
        result = validate_expression("sorted(pairs, key=lambda x, y: x + y)", {"pairs"})

        # Note: This is actually invalid Python (sorted key takes 1 arg)
        # but syntactically valid, and that's what we're testing
        assert result.valid is True

    def test_lambda_captures_external(self) -> None:
        """Lambda can capture external variables."""
        result = validate_expression(
            "list(filter(lambda x: x > threshold, items))", {"items", "threshold"}
        )

        assert result.valid is True
        assert len(result.issues) == 0

    def test_lambda_positional_only_args(self) -> None:
        """Lambda with positional-only arguments (Python 3.8+)."""
        result = validate_expression("(lambda a, /, b: a + b)(1, 2)", set())

        assert result.valid is True
        assert len(result.issues) == 0

    def test_lambda_keyword_only_args(self) -> None:
        """Lambda with keyword-only arguments."""
        result = validate_expression("(lambda *, a, b: a + b)(a=1, b=2)", set())

        assert result.valid is True
        assert len(result.issues) == 0

    def test_lambda_varargs(self) -> None:
        """Lambda with *args."""
        result = validate_expression("(lambda *args: sum(args))(1, 2, 3)", set())

        assert result.valid is True
        assert len(result.issues) == 0

    def test_lambda_kwargs(self) -> None:
        """Lambda with **kwargs."""
        result = validate_expression("(lambda **kwargs: len(kwargs))(a=1, b=2)", set())

        assert result.valid is True
        assert len(result.issues) == 0


class TestBlockedPatterns:
    """Tests for blocked pattern detection."""

    def test_blocked_dunder(self) -> None:
        """Dunder patterns are blocked."""
        result = validate_expression("obj.__class__", {"obj"})

        assert result.valid is False
        assert len(result.issues) == 1
        assert result.issues[0].code == "blocked_pattern"
        assert "__" in result.issues[0].message

    def test_blocked_import(self) -> None:
        """Import pattern is blocked."""
        result = validate_expression("__import__('os')", set())

        assert result.valid is False
        assert result.issues[0].code == "blocked_pattern"

    def test_blocked_eval(self) -> None:
        """Eval is blocked."""
        result = validate_expression("eval('code')", set())

        assert result.valid is False
        assert result.issues[0].code == "blocked_pattern"

    def test_blocked_exec(self) -> None:
        """Exec is blocked."""
        result = validate_expression("exec('code')", set())

        assert result.valid is False
        assert result.issues[0].code == "blocked_pattern"

    def test_blocked_open(self) -> None:
        """Open is blocked."""
        result = validate_expression("open('file.txt')", set())

        assert result.valid is False
        assert result.issues[0].code == "blocked_pattern"


class TestStatementPatterns:
    """Tests for statement pattern detection (assignment, walrus operator)."""

    def test_assignment_statement_blocked(self) -> None:
        """Assignment statements are blocked."""
        result = validate_expression("x = 1", set())

        assert result.valid is False
        assert len(result.issues) == 1
        assert result.issues[0].code == "statement_not_allowed"
        assert "Assignment statements" in result.issues[0].message
        assert "Variable Setter" in result.issues[0].message

    def test_assignment_with_variable_blocked(self) -> None:
        """Assignment with variable reference is blocked."""
        result = validate_expression("count = count + 1", {"count"})

        assert result.valid is False
        assert result.issues[0].code == "statement_not_allowed"

    def test_walrus_operator_blocked(self) -> None:
        """Walrus operator := is blocked."""
        result = validate_expression("(x := 5)", set())

        assert result.valid is False
        assert result.issues[0].code == "statement_not_allowed"
        assert ":=" in result.issues[0].message
        assert "Variable Setter" in result.issues[0].message

    def test_equality_comparison_allowed(self) -> None:
        """Equality comparison == is allowed (not assignment)."""
        result = validate_expression("x == 1", {"x"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_inequality_comparison_allowed(self) -> None:
        """Inequality comparison != is allowed."""
        result = validate_expression("x != 1", {"x"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_comparison_operators_allowed(self) -> None:
        """Comparison operators <=, >= are allowed."""
        result = validate_expression("x <= 1 and y >= 2", {"x", "y"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_keyword_argument_allowed(self) -> None:
        """Keyword arguments in function calls are allowed."""
        result = validate_expression("sorted(items, key=lambda x: x)", {"items"})

        assert result.valid is True
        assert len(result.issues) == 0

    def test_keyword_argument_with_value_allowed(self) -> None:
        """Keyword arguments with values are allowed."""
        result = validate_expression("dict(a=1, b=2)", set())

        assert result.valid is True
        assert len(result.issues) == 0


class TestValidationResultSerialization:
    """Tests for ValidationResult serialization."""

    def test_to_dict(self) -> None:
        """ValidationResult serializes correctly."""
        result = ValidationResult(
            valid=False,
            issues=[
                ValidationIssue(
                    type="error",
                    code="syntax_error",
                    message="Test error",
                    line=1,
                    column=5,
                    end_column=10,
                )
            ],
        )

        data = result.to_dict()

        assert data["valid"] is False
        assert len(data["issues"]) == 1
        assert data["issues"][0]["type"] == "error"
        assert data["issues"][0]["code"] == "syntax_error"
        assert data["issues"][0]["message"] == "Test error"
        assert data["issues"][0]["line"] == 1
        assert data["issues"][0]["column"] == 5
        assert data["issues"][0]["end_column"] == 10


class TestFieldExpressionMutationBlocking:
    """Tests for is_field_expression=True mutation blocking."""

    def test_blocks_list_append(self) -> None:
        """list.append() is blocked in field expressions."""
        result = validate_expression("my_list.append(1)", {"my_list"}, is_field_expression=True)
        assert result.valid is False
        assert len(result.issues) == 1
        assert result.issues[0].code == "mutation_not_allowed"
        assert "append" in result.issues[0].message

    def test_blocks_list_sort(self) -> None:
        """list.sort() is blocked in field expressions."""
        result = validate_expression("my_list.sort()", {"my_list"}, is_field_expression=True)
        assert result.valid is False
        assert result.issues[0].code == "mutation_not_allowed"
        assert "sort" in result.issues[0].message

    def test_blocks_list_clear(self) -> None:
        """list.clear() is blocked in field expressions."""
        result = validate_expression("my_list.clear()", {"my_list"}, is_field_expression=True)
        assert result.valid is False
        assert result.issues[0].code == "mutation_not_allowed"

    def test_blocks_dict_update(self) -> None:
        """dict.update() is blocked in field expressions."""
        result = validate_expression(
            "my_dict.update(my_dict)", {"my_dict"}, is_field_expression=True
        )
        assert result.valid is False
        assert result.issues[0].code == "mutation_not_allowed"
        assert "update" in result.issues[0].message

    def test_blocks_dict_pop(self) -> None:
        """dict.pop() is blocked in field expressions."""
        result = validate_expression('my_dict.pop("key")', {"my_dict"}, is_field_expression=True)
        assert result.valid is False
        assert "pop" in result.issues[0].message

    def test_blocks_set_add(self) -> None:
        """set.add() is blocked in field expressions."""
        result = validate_expression("my_set.add(1)", {"my_set"}, is_field_expression=True)
        assert result.valid is False
        assert "add" in result.issues[0].message

    def test_blocks_list_constructor(self) -> None:
        """list() constructor is blocked in field expressions."""
        result = validate_expression("list(my_str)", {"my_str"}, is_field_expression=True)
        assert result.valid is False
        assert result.issues[0].code == "mutation_not_allowed"
        assert "list" in result.issues[0].message
        assert "mutable data" in result.issues[0].message

    def test_blocks_dict_constructor(self) -> None:
        """dict() constructor is blocked in field expressions."""
        result = validate_expression("dict()", is_field_expression=True)
        assert result.valid is False
        assert "dict" in result.issues[0].message

    def test_blocks_set_constructor(self) -> None:
        """set() constructor is blocked in field expressions."""
        result = validate_expression("set(my_list)", {"my_list"}, is_field_expression=True)
        assert result.valid is False
        assert "set" in result.issues[0].message

    def test_allows_str_upper(self) -> None:
        """Non-mutating str.upper() is allowed in field expressions."""
        result = validate_expression("my_str.upper()", {"my_str"}, is_field_expression=True)
        assert result.valid is True
        assert len(result.issues) == 0

    def test_allows_str_split(self) -> None:
        """Non-mutating str.split() is allowed in field expressions."""
        result = validate_expression('my_str.split(",")', {"my_str"}, is_field_expression=True)
        assert result.valid is True

    def test_allows_dict_keys(self) -> None:
        """Non-mutating dict.keys() is allowed in field expressions."""
        result = validate_expression("my_dict.keys()", {"my_dict"}, is_field_expression=True)
        assert result.valid is True

    def test_allows_str_constructor(self) -> None:
        """str() constructor is allowed (not mutable)."""
        result = validate_expression("str(123)", is_field_expression=True)
        assert result.valid is True

    def test_allows_int_constructor(self) -> None:
        """int() constructor is allowed (not mutable)."""
        result = validate_expression('int("42")', is_field_expression=True)
        assert result.valid is True

    def test_allows_mutations_when_not_field(self) -> None:
        """Mutations are allowed when is_field_expression=False."""
        result = validate_expression("my_list.append(1)", {"my_list"}, is_field_expression=False)
        assert result.valid is True

    def test_allows_mutations_by_default(self) -> None:
        """Mutations are allowed by default (is_field_expression not set)."""
        result = validate_expression("my_list.append(1)", {"my_list"})
        assert result.valid is True

    def test_blocks_table_mutating_methods(self) -> None:
        """Table mutating methods are blocked in field expressions."""
        result = validate_expression(
            'my_table.set_cell(0, "col", "val")', {"my_table"}, is_field_expression=True
        )
        assert result.valid is False
        assert "set_cell" in result.issues[0].message

    def test_blocks_table_add_row(self) -> None:
        """Table.add_row() is blocked in field expressions."""
        result = validate_expression(
            'my_table.add_row({"a": 1})', {"my_table"}, is_field_expression=True
        )
        assert result.valid is False
        assert "add_row" in result.issues[0].message

    @pytest.mark.parametrize(
        "expression,method",
        [
            ('my_table.add_col(["x"], "extra")', "add_col"),
            ('my_table.insert_col(["x"], 0, "extra")', "insert_col"),
            ('my_table.remove_col("qty")', "remove_col"),
            ('my_table.set_row(["a", 1], 0)', "set_row"),
            ('my_table.insert_row(["a", 1], 0)', "insert_row"),
            ("my_table.remove_row(0)", "remove_row"),
            ("my_table.clear()", "clear"),
        ],
    )
    def test_blocks_every_table_mutator(self, expression: str, method: str) -> None:
        """Every method that mutates a table in place is blocked in field expressions."""
        result = validate_expression(expression, {"my_table"}, is_field_expression=True)
        assert result.valid is False
        assert result.issues[0].code == "mutation_not_allowed"
        assert method in result.issues[0].message

    @pytest.mark.parametrize(
        "expression",
        [
            'my_table.filter("qty").greater_than(5)',
            'my_table.order_by("sku")',
            'my_table.filter("qty").greater_than(5).order_by("sku")',
            "my_table.row_count()",
            'my_table.col("sku")',
        ],
    )
    def test_allows_table_query_methods(self, expression: str) -> None:
        """The non-mutating query operations stay callable in field expressions."""
        result = validate_expression(expression, {"my_table"}, is_field_expression=True)
        assert result.valid is True
