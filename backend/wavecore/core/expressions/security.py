"""
Expression Security Configuration

Centralized security configuration for expression evaluation in WAVE.

Security Model:
--------------
Expression evaluation uses TWO layers of protection:

1. BLACKLIST (string patterns) - Defense in depth
   - Fast rejection of obviously dangerous patterns
   - Clear error messages for users
   - Catches attempts before eval() is called

2. WHITELIST (safe_builtins) - Primary security boundary
   - Only these functions exist in the eval() context
   - Even if blacklist is bypassed, dangerous functions don't exist
   - This is the actual sandbox

Why both?
---------
- Blacklist alone is bypassable (string obfuscation, chr() tricks)
- Whitelist alone works but gives cryptic "NameError" messages
- Together: clear errors + bulletproof security

Attack vectors blocked:
-----------------------
- __import__('os').system('...') -> blocked by "__" and "import"
- eval("malicious") -> blocked by "eval", and eval not in whitelist
- open('/etc/passwd') -> blocked by "open", and open not in whitelist
- obj.__class__.__bases__ -> blocked by "__"
- getattr(obj, '__class__') -> blocked by "getattr" and "__"
- "{0.__class__}".format(x) -> blocked by "__"

Maintenance:
-----------
When adding functions to SAFE_BUILTINS:
1. Verify it cannot be used to escape the sandbox
2. Verify it cannot access the filesystem or network
3. Verify it cannot execute arbitrary code
4. Add the name to EXPRESSION_SAFE_NAMES in
   frontend/src/features/workbench/lib/expression-sandbox.ts, which also mirrors
   BLOCKED_SUBSTRINGS, BLOCKED_FUNCTION_NAMES, FIELD_BLOCKED_CONSTRUCTORS and
   MUTATING_METHOD_NAMES (tests/core/test_expression_security.py fails until each pair matches)
"""

from typing import Any

# Import Table types for SAFE_BUILTINS
# These are safe: read-only access and structured data operations
from wavecore.core.table import ColumnType, Table, TableRowView

# =============================================================================
# BLACKLIST - Dangerous patterns blocked in expression strings
# =============================================================================
# These patterns are rejected BEFORE eval() is called.
# Provides clear error messages and defense in depth.

# Patterns that must use substring matching (dangerous in any context)
BLOCKED_SUBSTRINGS: tuple[str, ...] = (
    "__",  # Dunder access: __import__, __class__, __dict__, __builtins__, etc.
)

# Patterns that should only block function calls, not variable names
# These are blocked as word boundaries to allow variables like 'file_path', 'exit_code'
BLOCKED_FUNCTION_NAMES: tuple[str, ...] = (
    # Code execution
    "import",
    "exec",
    "eval",
    "compile",
    # File/IO operations
    "open",
    "file",
    "input",
    # Namespace introspection
    "globals",  # globals()
    "locals",  # locals()
    "vars",  # vars()
    # Dynamic attribute access
    "getattr",  # getattr()
    "setattr",  # setattr()
    "delattr",  # delattr()
    # Debugger/termination
    "breakpoint",  # breakpoint()
    # Note: exit/quit are NOT blocked - they're not in SAFE_BUILTINS whitelist,
    # so they can't be called anyway. Blocking would prevent variable names.
)


# =============================================================================
# WHITELIST - Functions available in eval() context
# =============================================================================
# This is the PRIMARY security boundary.
# Only these functions can be called in expressions.
# If a function is not here, it simply doesn't exist in the eval context.

SAFE_BUILTINS: dict[str, Any] = {
    # Type conversion and inspection
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "type": type,
    # Collections
    "list": list,
    "dict": dict,
    "set": set,
    # Table types
    "Table": Table,
    "TableRowView": TableRowView,
    "ColumnType": ColumnType,
    # Math
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    # Sequence operations
    "len": len,
    "sorted": sorted,
    "reversed": reversed,
    "range": range,
    "map": map,
    "filter": filter,
    "slice": slice,
    # Logic
    "any": any,
    "all": all,
    # String formatting
    "format": format,
    # Constants
    "True": True,
    "False": False,
    "None": None,
}

# =============================================================================
# FIELD EXPRESSION RESTRICTIONS - Mutation blocking for read-only contexts
# =============================================================================
# Field expressions (parameter values in element configs) must be read-only.
# They cannot mutate variables - only Python plugin and var setter can do that.
# These sets define what is blocked when is_field_expression=True.

# Constructors that create mutable data - blocked in field expressions
FIELD_BLOCKED_CONSTRUCTORS: set[str] = {"list", "dict", "set"}

# Methods that mutate data in-place - blocked in field expressions
MUTATING_METHOD_NAMES: set[str] = {
    # list mutating methods
    "append",
    "extend",
    "insert",
    "remove",
    "pop",
    "clear",
    "sort",
    "reverse",
    # dict mutating methods
    "update",
    "setdefault",
    "popitem",
    # set mutating methods
    "add",
    "discard",
    # Note: dict.pop and set.pop are covered by "pop" above
    # Note: dict.clear and set.clear are covered by "clear" above
    # Table mutating methods (names must match wavecore.core.table.Table)
    "set_cell",
    "set_row",
    "add_row",
    "insert_row",
    "remove_row",
    "add_col",
    "insert_col",
    "remove_col",
}

# =============================================================================
# REFUSAL MESSAGES - what an author reads when an expression is not allowed
# =============================================================================
# Shared by every read-only expression surface; BlockedExpressionError appends the expression.

_PYTHON_BLOCK_HINT = "To run code that needs more than an expression, use a Python Block."

_LITERAL_HINTS: dict[str, str] = {
    "list": "To build a list, write the items out like [a, b].",
    "dict": 'To build a map, write the entries out like {"a": 1}.',
    "set": "To build a set, write the items out like {a, b}.",
}


def mutating_method_message(method_name: str) -> str:
    """Refusal text for a method that would change data."""
    return (
        f"The {method_name} method changes data. An expression can only read data, "
        "not change it. To change a variable, add a Variable Setter Block."
    )


def blocked_constructor_message(name: str) -> str:
    """Refusal text for list/dict/set called inside an expression."""
    return f"The {name} function is not available in an expression. {_LITERAL_HINTS[name]}"


def blocked_pattern_message(pattern: str) -> str:
    """Refusal text for a dangerous name or function found by ``is_blocked``."""
    if pattern in BLOCKED_SUBSTRINGS:
        opening = "An expression cannot use names that contain two underscores."
    else:
        opening = f"The {pattern} function is not available in an expression."
    return f"{opening} {_PYTHON_BLOCK_HINT}"


# =============================================================================
# Known but unsupported functions (for clearer error messages)
# =============================================================================
# These are valid Python builtins that users might try to use,
# but are not supported in WAVE expression context.
# When a NameError occurs for one of these, we provide a clearer message.
UNSUPPORTED_BUILTINS: set[str] = {
    # Removed as noise - not useful in expression context
    "tuple",
    "pow",
    "divmod",
    "enumerate",
    "zip",
    "chr",
    "ord",
    "bin",
    "hex",
    "oct",
    "ascii",
    "repr",
    # Never supported - security/introspection
    "eval",
    "exec",
    "compile",
    "open",
    "input",
    "file",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "breakpoint",
    "print",
    "id",
    "hash",
    "iter",
    "next",
    "isinstance",
    "hasattr",
    "callable",
    "bytes",
    "dir",
}


def is_blocked(expression: str) -> str | None:
    """
    Check if expression contains blocked patterns.

    Uses two types of matching:
    1. Substring matching for patterns dangerous in any context (e.g., "__")
    2. Word-boundary matching for function names to allow variable names
       like 'file_path', 'exit_code', 'open_connection'

    Args:
        expression: The expression string to check

    Returns:
        The blocked pattern if found, None if expression is allowed
    """
    import re

    lower_expr = expression.lower()

    # Check substring patterns (dangerous in any context)
    for pattern in BLOCKED_SUBSTRINGS:
        if pattern in lower_expr:
            return pattern

    # Check function names with word boundaries
    # This allows 'file_path' but blocks 'file(' or standalone 'file'
    for name in BLOCKED_FUNCTION_NAMES:
        # Match: word boundary + name + word boundary (standalone or with parens)
        # \b ensures we don't match 'file' in 'file_path'
        if re.search(rf"\b{name}\s*\(", lower_expr):
            return name

    return None


def get_safe_eval_context(
    local_vars: dict[str, Any] | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Get the globals and locals dicts for safe eval().

    Args:
        local_vars: Variables to make available in the expression

    Returns:
        Tuple of (globals_dict, locals_dict) for eval()
    """
    globals_dict = {"__builtins__": SAFE_BUILTINS}
    locals_dict = local_vars or {}
    return globals_dict, locals_dict


def format_name_error(error: NameError, expression: str) -> str:
    """
    Format a NameError with a clearer, user-friendly message.

    Args:
        error: The NameError exception
        expression: The expression that caused the error

    Returns:
        A formatted error message
    """
    # Extract the undefined name from the error message
    # NameError format: "name 'xyz' is not defined"
    import re

    match = re.search(r"name '(\w+)' is not defined", str(error))
    if not match:
        # Fallback for unexpected error format
        return f"Expression evaluation failed for '{expression}': {error}"

    name = match.group(1)

    # Check if it's a known but unsupported function
    if name in UNSUPPORTED_BUILTINS:
        return f"Function '{name}' is not supported in expression context"

    # Check if it looks like a function call in the expression
    if re.search(rf"\b{name}\s*\(", expression):
        return f"Function '{name}' is not recognized"

    # Unknown variable
    return f"Variable '{name}' is not defined"


def format_null_error(error: Exception) -> str | None:
    """WAVE's text for a failure Python reports on a null value, or None when null is not named."""
    text = str(error)
    if "NoneType" not in text:
        return None
    return f"A value is null: {text.replace('NoneType', 'null')}"
