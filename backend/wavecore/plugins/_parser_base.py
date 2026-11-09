"""
Query Parser Base Class

Shared base class for query-based parser plugins (JSON, XML, etc.).
Provides common validation methods for queries, output modes, query output types,
and type coercion methods for converting parsed values to WAVE types.
"""

import sys
from decimal import Decimal
from typing import Any

from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.core.variables.decimal_value import WaveDecimal, to_wave_decimal
from wavecore.core.variables.print_form import value_text
from wavecore.plugins.base import PluginBase

OUTPUT_MODE_PARAM: dict[str, Any] = {
    "name": "output_mode",
    "type": "string",
    "trim": True,
    "required": False,
    "default": "combined",
    "enum_values": ["combined", "individual"],
    "description": (
        "Output mode: 'combined' returns all results in a single map, "
        "'individual' returns each query result as a separate output "
        "variable with optional type coercion. Default: 'combined'."
    ),
}

QUERY_OUTPUT_TYPES_PARAM: dict[str, Any] = {
    "name": "query_output_types",
    "type": "map",
    "required": False,
    "description": (
        "Map of query names to expected output types for type coercion "
        "in individual mode. Supported types: string, integer, float, "
        "boolean. Default type is 'string' (no coercion). A null entry is skipped."
    ),
}

PARSER_OUTPUT_SCHEMA: list[dict[str, str]] = [
    {"name": "success", "type": "boolean"},
    {"name": "errors", "type": "array"},
    {"name": "results", "type": "map"},
]


def _whole_number(value: float | Decimal | str) -> int | None:
    """The exact int a finite whole number names, or None (REQ-3.1.3.14)."""
    number = to_wave_decimal(value)
    if not isinstance(number, Decimal) or not number.is_finite():
        return None
    # A number Python could not print as an int is not converted.
    if number.adjusted() >= sys.int_info.default_max_str_digits:
        return None
    whole = int(number)
    return whole if whole == number else None


def queries_param(expression_kind: str) -> dict[str, Any]:
    """Build the shared 'queries' map parameter for `expression_kind` (JSONPath/XPath)."""
    return {
        "name": "queries",
        "type": "map",
        "required": True,
        "description": (
            f"Map of query names to {expression_kind} expressions. "
            "Each query result is returned in the results map with the query name "
            "as key. At least one query is required; a null entry fails the run."
        ),
    }


class QueryParserBase(PluginBase):
    """
    Abstract base class for query-based parser plugins.

    Provides shared validation and type coercion infrastructure used by
    JSON Parser (JSONPath) and XML Parser (XPath) plugins. Subclasses
    must still implement metadata, execute, and validate (which may call
    the shared validation helpers).
    """

    # ------------------------------------------------------------------
    # Shared validation helpers
    # ------------------------------------------------------------------

    def _validate_queries(self, params: dict[str, Any], *, query_type: str) -> None:
        """Validate the required 'queries' parameter and its entries."""
        if "queries" not in params:
            raise ValueError("Missing required parameter: queries")
        queries = params["queries"]
        if not isinstance(queries, dict):
            raise TypeError(f"Parameter 'queries' must be a dict, got {type(queries).__name__}")
        if not queries:
            raise ValueError(
                f"Parameter 'queries' cannot be empty - at least one {query_type} query required"
            )
        check_entry_nulls("queries", queries)
        for query_name, query_expr in queries.items():
            if not isinstance(query_expr, str):
                raise TypeError(
                    f"Query '{query_name}' must be a string, got {type(query_expr).__name__}"
                )

    def _validate_output_mode(self, params: dict[str, Any]) -> None:
        """Validate the optional 'output_mode' parameter."""
        if "output_mode" not in params:
            return
        output_mode = params["output_mode"]
        if not isinstance(output_mode, str):
            raise TypeError(
                f"Parameter 'output_mode' must be a string, got {type(output_mode).__name__}"
            )
        if output_mode not in ("combined", "individual"):
            raise ValueError("Parameter 'output_mode' must be 'combined' or 'individual'")

    def _validate_query_output_types(self, params: dict[str, Any]) -> None:
        """Validate the optional 'query_output_types' parameter."""
        if "query_output_types" not in params:
            return
        query_output_types = params["query_output_types"]
        if not isinstance(query_output_types, dict):
            raise TypeError(
                f"Parameter 'query_output_types' must be a dict, "
                f"got {type(query_output_types).__name__}"
            )
        for key, val in query_output_types.items():
            if val is not None and not isinstance(val, str):
                raise TypeError(
                    f"Query output type for '{key}' must be a string, got {type(val).__name__}"
                )

    # ------------------------------------------------------------------
    # Shared result building / storage
    # ------------------------------------------------------------------

    def _store_query_result(
        self,
        results: dict[str, Any],
        errors: list[dict[str, str]],
        query_name: str,
        converted: dict[str, Any],
        output_mode: str,
        query_output_types: dict[str, str],
    ) -> None:
        """Store a single query result, applying type coercion in individual mode."""
        if output_mode != "individual":
            results[query_name] = converted
            return

        # A null output type is skipped, so the query reads as text.
        expected_type = query_output_types.get(query_name)
        if expected_type is None:
            expected_type = "string"
        try:
            results[query_name] = self._coerce_value(converted["value"], expected_type)
        except (ValueError, TypeError) as e:
            errors.append({"query": query_name, "error": str(e)})

    @staticmethod
    def _build_result(
        results: dict[str, Any], errors: list[dict[str, str]], output_mode: str
    ) -> dict[str, Any]:
        """Build the final result dict from accumulated results and errors."""
        result: dict[str, Any] = {
            "success": len(errors) == 0,
            "errors": errors,
        }
        if output_mode == "combined":
            result["results"] = results
        else:
            result.update(results)
        return result

    # ------------------------------------------------------------------
    # Shared type coercion
    # ------------------------------------------------------------------

    def _coerce_value(self, value: Any, expected_type: str) -> Any:
        """
        Coerce a query result value to the expected type.

        Used in individual output mode to convert query results to the type
        specified in query_output_types.

        Args:
            value: The value to coerce
            expected_type: Target type (string, integer, float, boolean)

        Returns:
            The coerced value; a null stays null under every type

        Raises:
            ValueError: If the value cannot be converted to the expected type
            TypeError: If the value type is incompatible with the expected type
        """
        if value is None:
            return None
        coercers: dict[str, Any] = {
            "string": self._coerce_to_string,
            "integer": self._coerce_to_integer,
            "float": self._coerce_to_float,
            "boolean": self._coerce_to_boolean,
        }
        coercer = coercers.get(expected_type)
        if coercer is None:
            return value
        return coercer(value)

    @staticmethod
    def _reject_array(value: Any, target_type: str) -> None:
        """Raise TypeError if value is a list."""
        if isinstance(value, list):
            raise TypeError(f"Cannot convert array to {target_type}")

    def _coerce_to_string(self, value: Any) -> str:
        """Coerce value to string; a map or a float is written in WAVE's print form."""
        self._reject_array(value, "string")
        if isinstance(value, dict | float):
            return value_text(value)
        return str(value)

    def _coerce_to_integer(self, value: Any) -> int:
        """Coerce value to an exact integer; a fractional value is refused."""
        self._reject_array(value, "integer")
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, int):
            return value
        if isinstance(value, float | Decimal | str):
            whole = _whole_number(value)
            if whole is None:
                raise ValueError(f"Cannot convert '{value}' to integer")
            return whole
        raise TypeError(f"Cannot convert {type(value).__name__} to integer")

    def _coerce_to_float(self, value: Any) -> Decimal:
        """Coerce value to an exact float (REQ-3.1.3.14)."""
        self._reject_array(value, "float")
        if isinstance(value, int):
            return WaveDecimal(value)
        if isinstance(value, float | Decimal | str):
            number = to_wave_decimal(value)
            if isinstance(number, Decimal) and number.is_finite():
                return number
            raise ValueError(f"Cannot convert '{value}' to float")
        raise TypeError(f"Cannot convert {type(value).__name__} to float")

    def _coerce_to_boolean(self, value: Any) -> bool:
        """Coerce value to boolean."""
        self._reject_array(value, "boolean")
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return self._string_to_boolean(value)
        if isinstance(value, int | float | Decimal):
            return bool(value)
        raise TypeError(f"Cannot convert {type(value).__name__} to boolean")

    @staticmethod
    def _string_to_boolean(value: str) -> bool:
        """Convert a string to boolean, raising ValueError for unrecognized strings."""
        _TRUE_STRINGS = ("true", "1", "yes")
        _FALSE_STRINGS = ("false", "0", "no", "")
        lower = value.lower()
        if lower in _TRUE_STRINGS:
            return True
        if lower in _FALSE_STRINGS:
            return False
        raise ValueError(f"Cannot convert '{value}' to boolean")

    # ------------------------------------------------------------------
    # Shared type detection
    # ------------------------------------------------------------------

    def _detect_type(self, value: Any) -> dict[str, Any]:
        """
        Detect the WAVE type for a parsed value.

        Args:
            value: A Python value from parsed content

        Returns:
            dict: Map with 'type' and 'value' fields
        """
        if value is None:
            return {"type": "null", "value": None}

        # Check bool before int (bool is subclass of int in Python)
        if isinstance(value, bool):
            return {"type": "boolean", "value": value}

        if isinstance(value, int):
            return {"type": "integer", "value": value}

        if isinstance(value, float | Decimal):
            whole = _whole_number(value)
            if whole is None:
                return {"type": "float", "value": value}
            return {"type": "integer", "value": whole}

        if isinstance(value, str):
            return {"type": "string", "value": value}

        if isinstance(value, dict):
            return {"type": "map", "value": value}

        if isinstance(value, list):
            return {"type": "array", "value": value}

        # Fallback for unexpected types
        return {"type": "string", "value": str(value)}  # pragma: no cover
