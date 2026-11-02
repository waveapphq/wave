"""
Expression Evaluation Errors

Custom exception types for expression evaluation failures during variable resolution.
These exceptions provide detailed context for debugging and integrate with the
try-catch control system for proper error handling in test workflows.
"""


class ExpressionEvaluationError(Exception):
    """Base exception for expression evaluation failures.

    Attributes:
        expression: The expression that failed to evaluate
        reason: Machine-readable reason code for the failure
    """

    def __init__(self, message: str, expression: str, reason: str):
        super().__init__(message)
        self.expression = expression
        self.reason = reason


class UndefinedVariableError(ExpressionEvaluationError):
    """Raised when a referenced variable doesn't exist in the current scope.

    Attributes:
        variable_name: The name of the undefined variable
    """

    def __init__(self, variable_name: str, expression: str):
        super().__init__(
            f"Undefined variable '{variable_name}' in expression '{expression}'",
            expression=expression,
            reason="undefined_variable",
        )
        self.variable_name = variable_name


class InvalidExpressionError(ExpressionEvaluationError):
    """Raised when expression evaluation fails due to invalid syntax or runtime error."""

    def __init__(self, message: str, expression: str):
        super().__init__(
            message,
            expression=expression,
            reason="invalid_expression",
        )


class BlockedExpressionError(ExpressionEvaluationError):
    """Raised when an expression is refused on a read-only surface.

    Attributes:
        explanation: The plain-language reason, without the expression text
    """

    def __init__(self, explanation: str, expression: str):
        super().__init__(
            f"{explanation} Expression: {expression}",
            expression=expression,
            reason="blocked_expression",
        )
        self.explanation = explanation


class ExpressionTypeError(ExpressionEvaluationError):
    """Raised when expression result type doesn't match declared parameter type."""

    def __init__(self, message: str):
        super().__init__(
            message,
            expression="",
            reason="type_mismatch",
        )


class NullValueError(ExpressionEvaluationError):
    """Raised when a value is null where it may not be (REQ-3.1.3.21, REQ-3.1.3.22)."""

    def __init__(self, message: str, expression: str = ""):
        super().__init__(
            message,
            expression=expression,
            reason="null_value",
        )


def null_failure_message(
    setting: str,
    *,
    key: str | None = None,
    row: int | None = None,
    expression: str | None = None,
) -> str:
    """The text naming what is null: a `{{ }}` piece, a named entry, a list row or the setting."""
    if expression is not None:
        return f"'{{{{ {expression.strip()} }}}}' in '{setting}' is null"
    if key is not None:
        return f"'{key}' in '{setting}' is null"
    if row is not None:
        return f"Row {row} in '{setting}' is null"
    return f"'{setting}' is null"
