"""
Unit tests for expression errors module.

Tests requirements:
- Expression evaluation failures raise appropriate exceptions
- Errors contain detailed context for debugging
- Errors integrate with try-catch control system
"""

import pytest

from wavecore.core.expressions import errors
from wavecore.core.expressions.errors import (
    BlockedExpressionError,
    ExpressionEvaluationError,
    InvalidExpressionError,
    UndefinedVariableError,
)


class TestExpressionEvaluationError:
    """Test suite for base ExpressionEvaluationError."""

    def test_base_error_stores_expression(self):
        """Test that base error stores the expression."""
        error = ExpressionEvaluationError(
            "Test error",
            expression="my_var.upper()",
            reason="test_reason",
        )

        assert error.expression == "my_var.upper()"

    def test_base_error_stores_reason(self):
        """Test that base error stores the reason code."""
        error = ExpressionEvaluationError(
            "Test error",
            expression="my_var",
            reason="custom_reason",
        )

        assert error.reason == "custom_reason"

    def test_base_error_message_is_accessible(self):
        """Test that error message is accessible."""
        error = ExpressionEvaluationError(
            "This is the error message",
            expression="expr",
            reason="reason",
        )

        assert str(error) == "This is the error message"

    def test_base_error_is_exception(self):
        """Test that base error is an Exception."""
        error = ExpressionEvaluationError("Test", expression="expr", reason="reason")

        assert isinstance(error, Exception)


class TestUndefinedVariableError:
    """Test suite for UndefinedVariableError."""

    def test_error_includes_variable_name_in_message(self):
        """Test that error message includes the variable name."""
        error = UndefinedVariableError(
            variable_name="my_undefined_var",
            expression="my_undefined_var",
        )

        assert "my_undefined_var" in str(error)

    def test_error_includes_expression_in_message(self):
        """Test that error message includes the expression."""
        error = UndefinedVariableError(
            variable_name="base_var",
            expression="base_var.upper()",
        )

        assert "base_var.upper()" in str(error)

    def test_error_stores_variable_name(self):
        """Test that variable_name is stored as attribute."""
        error = UndefinedVariableError(
            variable_name="test_var",
            expression="test_var",
        )

        assert error.variable_name == "test_var"

    def test_error_has_correct_reason(self):
        """Test that reason is set to 'undefined_variable'."""
        error = UndefinedVariableError(
            variable_name="var",
            expression="var",
        )

        assert error.reason == "undefined_variable"

    def test_error_stores_expression(self):
        """Test that expression is stored as attribute."""
        error = UndefinedVariableError(
            variable_name="var",
            expression="var.strip().lower()",
        )

        assert error.expression == "var.strip().lower()"

    def test_error_inherits_from_base(self):
        """Test that UndefinedVariableError inherits from ExpressionEvaluationError."""
        error = UndefinedVariableError(
            variable_name="var",
            expression="var",
        )

        assert isinstance(error, ExpressionEvaluationError)


class TestInvalidExpressionError:
    """Test suite for InvalidExpressionError."""

    def test_error_stores_message(self):
        """Test that custom message is stored."""
        error = InvalidExpressionError(
            message="Method 'nonexistent' not found",
            expression="var.nonexistent()",
        )

        assert "Method 'nonexistent' not found" in str(error)

    def test_error_stores_expression(self):
        """Test that expression is stored as attribute."""
        error = InvalidExpressionError(
            message="Test error",
            expression="invalid_expr()",
        )

        assert error.expression == "invalid_expr()"

    def test_error_has_correct_reason(self):
        """Test that reason is set to 'invalid_expression'."""
        error = InvalidExpressionError(
            message="Test",
            expression="expr",
        )

        assert error.reason == "invalid_expression"

    def test_error_inherits_from_base(self):
        """Test that InvalidExpressionError inherits from ExpressionEvaluationError."""
        error = InvalidExpressionError(
            message="Test",
            expression="expr",
        )

        assert isinstance(error, ExpressionEvaluationError)


class TestBlockedExpressionError:
    """Test suite for BlockedExpressionError."""

    def test_error_reads_as_one_plain_sentence_then_the_expression(self):
        """The explanation comes first, the expression last, quotes never nest."""
        error = BlockedExpressionError(
            explanation="The append method changes data.",
            expression="rows.append(9)",
        )

        assert str(error) == "The append method changes data. Expression: rows.append(9)"

    def test_error_includes_expression_in_message(self):
        """Test that error message includes the expression."""
        error = BlockedExpressionError(
            explanation="The eval function is not available in an expression.",
            expression="eval('code')",
        )

        assert "eval('code')" in str(error)

    def test_error_stores_explanation(self):
        """Test that the explanation is stored without the expression text."""
        error = BlockedExpressionError(
            explanation="The list function is not available in an expression.",
            expression="list(range(3))",
        )

        assert error.explanation == "The list function is not available in an expression."

    def test_error_stores_expression(self):
        """Test that expression is stored as attribute."""
        error = BlockedExpressionError(
            explanation="The pop method changes data.",
            expression="rows.pop()",
        )

        assert error.expression == "rows.pop()"

    def test_error_has_correct_reason(self):
        """Test that reason is set to 'blocked_expression'."""
        error = BlockedExpressionError(
            explanation="The open function is not available in an expression.",
            expression="open('file')",
        )

        assert error.reason == "blocked_expression"

    def test_error_inherits_from_base(self):
        """Test that BlockedExpressionError inherits from ExpressionEvaluationError."""
        error = BlockedExpressionError(
            explanation="An expression cannot use names that contain two underscores.",
            expression="x.__class__",
        )

        assert isinstance(error, ExpressionEvaluationError)


class TestNullValueError:
    """One error class and one message builder for a value that is null where it may not be
    (REQ-3.1.3.21, REQ-3.1.3.22)."""

    def test_error_inherits_from_base(self):
        """A null failure is an expression failure, so every catch of one refuses it."""
        assert issubclass(errors.NullValueError, ExpressionEvaluationError)

    @pytest.mark.parametrize(
        ("setting", "where", "message"),
        [
            pytest.param("local_port", {}, "'local_port' is null", id="whole-setting"),
            pytest.param(
                "url", {"expression": "user_id"}, "'{{ user_id }}' in 'url' is null", id="piece"
            ),
            pytest.param(
                "headers", {"key": "X-Trace"}, "'X-Trace' in 'headers' is null", id="named-entry"
            ),
            pytest.param("arguments", {"row": 2}, "Row 2 in 'arguments' is null", id="list-row"),
        ],
    )
    def test_message_names_what_is_null(self, setting, where, message):
        """The message names the setting and, where there is one, the piece, entry or row."""
        assert errors.null_failure_message(setting, **where) == message


class TestExpressionErrorIntegration:
    """Test suite for expression errors via evaluate_expression/resolve_parameters."""

    def test_undefined_variable_error_in_evaluate_expression(self):
        """Test that undefined variable raises InvalidExpressionError."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="nonexistent_var"):
            evaluate_expression("nonexistent_var", {})

    def test_invalid_method_call_raises_error(self):
        """Test that invalid method call raises InvalidExpressionError."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="bad_method"):
            evaluate_expression("existing_var.bad_method()", {"existing_var": "hello"})

    def test_undefined_variable_in_method_chain_fails(self):
        """Test that undefined variable used in method chain raises error."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="missing"):
            evaluate_expression("missing.upper()", {})

    def test_invalid_function_call_fails(self):
        """Test that invalid function calls raise error."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        # nonexistent_func is not in SAFE_BUILTINS
        with pytest.raises(InvalidExpressionError, match="nonexistent_func"):
            evaluate_expression("nonexistent_func(x)", {"x": "test"})

    def test_error_contains_expression_context(self):
        """Test that error contains full expression for debugging."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="complex_var"):
            evaluate_expression("complex_var", {})

    def test_blocked_expression_error_raised(self):
        """Test that BlockedExpressionError is raised for dangerous patterns."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError, match="eval"):
            evaluate_expression("eval('code')", {})

    def test_blocked_dunder_method_raises_error(self):
        """Test that dunder method calls like __class__() are blocked."""
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import BlockedExpressionError

        with pytest.raises(BlockedExpressionError, match="__"):
            evaluate_expression("var.__class__()", {"var": "test"})

    def test_generic_expression_exception_caught(self):
        """Test that generic exceptions during expression eval are caught.

        ZeroDivisionError triggers the generic Exception handler in _evaluate_expression.
        """
        from wavecore.core.execution.plugin_executor import evaluate_expression
        from wavecore.core.expressions.errors import InvalidExpressionError

        with pytest.raises(InvalidExpressionError, match="division by zero"):
            evaluate_expression("1 / 0", {})
