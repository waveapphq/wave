"""
Expressions subpackage - expression evaluation, validation, and security.

Re-exports key symbols for convenient access.
"""

from wavecore.core.expressions.errors import (
    BlockedExpressionError,
    ExpressionEvaluationError,
    ExpressionTypeError,
    InvalidExpressionError,
    UndefinedVariableError,
)
from wavecore.core.expressions.security import (
    BLOCKED_FUNCTION_NAMES,
    BLOCKED_SUBSTRINGS,
    FIELD_BLOCKED_CONSTRUCTORS,
    MUTATING_METHOD_NAMES,
    SAFE_BUILTINS,
    UNSUPPORTED_BUILTINS,
    format_name_error,
    get_safe_eval_context,
    is_blocked,
)
from wavecore.core.expressions.validator import (
    MutationDetector,
    NameCollector,
    ValidationIssue,
    ValidationResult,
    validate_expression,
)

__all__ = [
    # errors
    "BlockedExpressionError",
    "ExpressionEvaluationError",
    "ExpressionTypeError",
    "InvalidExpressionError",
    "UndefinedVariableError",
    # security
    "BLOCKED_FUNCTION_NAMES",
    "BLOCKED_SUBSTRINGS",
    "FIELD_BLOCKED_CONSTRUCTORS",
    "MUTATING_METHOD_NAMES",
    "SAFE_BUILTINS",
    "UNSUPPORTED_BUILTINS",
    "format_name_error",
    "get_safe_eval_context",
    "is_blocked",
    # validator
    "MutationDetector",
    "NameCollector",
    "ValidationIssue",
    "ValidationResult",
    "validate_expression",
]
