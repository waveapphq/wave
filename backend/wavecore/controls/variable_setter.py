"""
Variable Setter control implementation.

Requirements implemented:
- REQ-3.4.1.14: Variable setter control
"""

import sys
from decimal import Decimal, InvalidOperation
from typing import Any

from wavecore.controls.base import ControlBase
from wavecore.core.number_rule import is_integer_value, is_number_value
from wavecore.core.table import Table
from wavecore.core.table_values import is_table_value
from wavecore.core.variables.decimal_value import WaveDecimal, to_wave_decimal
from wavecore.core.variables.print_form import value_text
from wavecore.models.controls.parameters import ControlParameter
from wavecore.models.enums import ControlId

# Python type -> WAVE type string
_PYTHON_TO_WAVE: list[tuple[type, str]] = [
    # bool before int because bool is a subclass of int
    (bool, "boolean"),
    (int, "integer"),
    (float, "float"),
    (str, "string"),
    (Table, "table"),
    (list, "array"),
    (dict, "map"),
]


def _infer_type(value: Any) -> str | None:
    """Infer WAVE type string from a Python value's type."""
    for py_type, wave_type in _PYTHON_TO_WAVE:
        if isinstance(value, py_type):
            return wave_type
    return None


def _is_correct_type(value: Any, expected_type: str) -> bool:
    """Check if value already matches the expected WAVE type."""
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "integer":
        return is_integer_value(value)
    if expected_type == "float":
        return is_number_value(value)
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "table":
        return is_table_value(value)
    if expected_type == "array":
        return isinstance(value, list)
    if expected_type == "map":
        return isinstance(value, dict)
    return False


def _coerce_string_to_integer(value: str, var_name: str) -> int:
    """Coerce a string value to integer exactly; a whole number written as a decimal is taken."""
    try:
        number = Decimal(value.strip())
    except InvalidOperation:
        number = Decimal("NaN")
    # A number Python could not print as an int is not converted.
    if not number.is_finite() or number.adjusted() >= sys.int_info.default_max_str_digits:
        raise TypeError(f"Variable '{var_name}': cannot convert '{value}' to integer")
    whole = int(number)
    if whole != number:
        raise TypeError(
            f"Variable '{var_name}': cannot convert '{value}' to integer (has fractional part)"
        )
    return whole


def _coerce_string_to_float(value: str, var_name: str) -> Decimal:
    """Coerce a string value to an exact-precision Decimal (REQ-3.1.3.14)."""
    coerced = to_wave_decimal(value)
    if isinstance(coerced, Decimal) and coerced.is_finite():
        return coerced
    raise TypeError(f"Variable '{var_name}': cannot convert '{value}' to float")


def _coerce_string_to_boolean(value: str, var_name: str) -> bool:
    """Coerce a string value to boolean."""
    low = value.strip().lower()
    if low in ("true", "1"):
        return True
    if low in ("false", "0"):
        return False
    raise TypeError(
        f"Variable '{var_name}': cannot convert "
        f"'{value}' to boolean (expected 'true' or 'false')"
    )


def _coerce_string_to_scalar(value: str, expected_type: str, var_name: str) -> Any:
    """Coerce a string to a scalar type (integer, float, or boolean).

    Returns the coerced value, or raises TypeError if not coercible.
    Returns None if expected_type is not a scalar that accepts string coercion,
    signaling the caller to fall through to incompatible type handling.
    """
    if expected_type == "integer":
        return _coerce_string_to_integer(value, var_name)
    if expected_type == "float":
        return _coerce_string_to_float(value, var_name)
    if expected_type == "boolean":
        return _coerce_string_to_boolean(value, var_name)
    return None


_STRING_COERCIBLE_TYPES = {"integer", "float", "boolean"}


def _to_exact_float(value: int | float | Decimal) -> Decimal:
    """Normalize an already-float-typed value to an exact Decimal (REQ-3.1.3.14)."""
    if isinstance(value, Decimal):
        return value
    return WaveDecimal(str(value))


def _coerce_value(value: Any, expected_type: str, var_name: str) -> Any:
    """Coerce a value to match the expected variable type.

    Handles the primary bug scenario where JSON/YAML deserialization
    produces strings for numeric values. Also validates that the
    incoming value is compatible with the declared type.

    Args:
        value: The incoming value to coerce.
        expected_type: WAVE type string (string, integer, float, etc.).
        var_name: Variable name for error messages.

    Returns:
        The coerced value.

    Raises:
        TypeError: If the value cannot be coerced to the expected type.
    """
    # Null is a value of every type.
    if value is None:
        return None

    # Already correct type
    if _is_correct_type(value, expected_type):
        return _to_exact_float(value) if expected_type == "float" else value

    # String to scalar coercion
    if isinstance(value, str) and expected_type in _STRING_COERCIBLE_TYPES:
        return _coerce_string_to_scalar(value, expected_type, var_name)

    # NaN and the infinities are never numbers (REQ-3.1.3.14).
    if (
        expected_type in ("integer", "float")
        and isinstance(value, float | Decimal)
        and not is_number_value(value)
    ):
        raise TypeError(f"Variable '{var_name}': cannot convert {value} to {expected_type}")

    # float to int (lossless only)
    if expected_type == "integer" and isinstance(value, float):
        i = int(value)
        if value != i:
            raise TypeError(
                f"Variable '{var_name}': cannot convert "
                f"{value!r} to integer (has fractional part)"
            )
        return i

    # Incompatible types
    actual = type(value).__name__
    raise TypeError(
        f"Variable '{var_name}': cannot assign {actual} value to {expected_type} variable"
    )


def _is_pending_expression(variable_context: Any, var_name: str) -> bool:
    """True when var_name is a still-unrealized expression in a lazy context.

    Reading such a name realizes the expression as a side effect, firing a
    deferred change push of the old value that races and clobbers this write.
    """
    pending = getattr(variable_context, "pending_expression_names", None)
    return callable(pending) and var_name in set(pending())


def _apply_variable_set(variable_context: Any, var_name: str, var_value: Any) -> tuple[str, Any]:
    """Write one variable, returning (scope, written value) for logging.

    A direct write supersedes a still-pending expression without realizing it;
    structured entries coerce by declared type; flat values are written as-is
    (type info was lost during flattening - pre-execution validation handles it).
    """
    if _is_pending_expression(variable_context, var_name):
        variable_context[var_name] = var_value
        return "test", var_value

    existing = variable_context[var_name]
    if isinstance(existing, dict) and "scope" in existing:
        expected_type = existing.get("type")
        if expected_type:
            var_value = _coerce_value(var_value, expected_type, var_name)
        existing["value"] = var_value
        return existing.get("scope", "test"), var_value

    variable_context[var_name] = var_value
    return "test", var_value


def _debug_text(value: Any) -> str:
    """A string stays quoted so it reads as a string; every other value uses the print form."""
    return repr(value) if isinstance(value, str) else value_text(value)


class VariableSetterControl(ControlBase):
    """
    Variable Setter control.

    Sets variables in the execution context. Variables are always created
    at test scope, determined by the execution engine.
    """

    CONTROL_ID = ControlId.VARIABLE_SETTER
    CONTROL_VERSION = "1.0.0"
    CONTROL_NAME = "Variable Setter"
    CONTROL_CATEGORY = "flow"

    @property
    def metadata(self) -> dict[str, Any]:
        """Return Variable Setter control metadata."""
        return {
            "id": self.CONTROL_ID,
            "version": self.CONTROL_VERSION,
            "name": self.CONTROL_NAME,
            "description": (
                "Sets variables in the execution context. "
                "Updates existing variables or creates new test-level variables. "
                "New variables are created via the frontend variable manager "
                "and are indistinguishable from manually created variables."
            ),
            "category": self.CONTROL_CATEGORY,
            "icon_name": "variable",
            "parameter_schema": [
                ControlParameter(
                    name="variables",
                    type="map",
                    required=True,
                    description=(
                        "Dictionary of variable names and values to set. "
                        "Keys are variable names, values can be any type "
                        "(string, integer, float, boolean, array, map, table, or null)."
                    ),
                ),
            ],
            "output_schema": [],
            "structure_hints": {
                "type": "sequential",
            },
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate control parameters.

        Validates:
        - 'variables' parameter is present and is a dict/map
        - Variable names are non-empty strings

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: On validation failure with descriptive error message
            TypeError: On type mismatch
        """
        # Check required 'variables' parameter
        if "variables" not in params:
            raise ValueError("Missing required parameter: variables")

        variables = params["variables"]

        # Type check: variables must be a dict/map
        if not isinstance(variables, dict):
            raise TypeError(
                "Parameter 'variables' must be a map (dictionary), "
                f"got {type(variables).__name__}"
            )

        # Validate variable names (non-empty strings)
        for var_name in variables.keys():
            if not var_name or not isinstance(var_name, str):
                raise ValueError("Variable names must be non-empty strings, " f"got: {var_name!r}")

    async def execute(self, context: dict[str, Any]) -> Any:
        """
        Execute variable setter control.

        Sets existing variables in the execution context. Variables must
        already be declared (e.g. via the variable manager). Attempting
        to set an undeclared variable is an error.

        Args:
            context: Execution context containing:
                - parameters: Control parameter values
                - variables: Variable scope (dict)
                - logger: Logger instance (optional)

        Returns:
            None (no return value)

        Raises:
            ValueError: If variables parameter is missing/empty or a
                referenced variable does not exist in the context.
        """
        params = context["parameters"]
        if "variables" not in params or not params["variables"]:
            raise ValueError("Variable Setter has no variables set")
        variables_to_set = params["variables"]
        variable_context = context.get("variables", {})
        logger = context.get("logger")

        # Set each variable - all must already exist in the context
        for var_name, var_value in variables_to_set.items():
            if var_name not in variable_context:
                raise ValueError(
                    f"Variable '{var_name}' is not declared. "
                    f"Add it in the variable manager before using it "
                    f"in a Variable Setter."
                )

            original_scope, written = _apply_variable_set(variable_context, var_name, var_value)

            if logger:
                logger.debug(
                    f"Set variable '{var_name}' = {_debug_text(written)} (scope: {original_scope})"
                )

        return None
