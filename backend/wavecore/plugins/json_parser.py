"""
JSON Parser Plugin

Implements requirement:
- REQ-3.4.1.16: JSON processing with JSONPath support

Provides comprehensive JSON document parsing and querying capabilities
through JSONPath expressions, enabling workflows to extract data from
JSON responses, validate JSON structure, and manipulate JSON content.
"""

import json
from typing import Any

from jsonpath_ng import parse as jsonpath_parse

from wavecore.core.variables.decimal_value import WaveDecimal
from wavecore.plugins._parser_base import (
    OUTPUT_MODE_PARAM,
    PARSER_OUTPUT_SCHEMA,
    QUERY_OUTPUT_TYPES_PARAM,
    QueryParserBase,
    queries_param,
)


class JSONParserPlugin(QueryParserBase):
    """
    JSON Parser Plugin.

    Executes JSON parsing and JSONPath queries with support for:
    - JSON well-formedness validation
    - JSONPath expression evaluation
    - Multiple JSONPath queries on same document
    - Type conversion (JSON types to WAVE types)

    Parameters:
        json_content (string): JSON content to parse and query (required)
        queries (map): Map of query_name -> JSONPath_expression (required)
        output_mode (string): 'combined' or 'individual' (optional, default: 'combined')
        query_output_types (map): Map of query_name -> expected type (optional)

    Returns:
        map: Execution result with success flag and results map containing
             each query's result with type and value
    """

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "json-parser",
            "name": "JSON Parser",
            "version": "1.0.0",
            "category": "data",
            "description": (
                "Parses JSON documents and executes JSONPath queries to extract data. "
                "Supports multiple queries and automatic type conversion of JSON values "
                "to WAVE types (string, integer, float, boolean, array, map)."
            ),
            "parameters": [
                {
                    "name": "json_content",
                    "type": "string",
                    "required": True,
                    "description": ("JSON content to parse and query. Must be valid JSON."),
                },
                queries_param("JSONPath"),
                OUTPUT_MODE_PARAM,
                QUERY_OUTPUT_TYPES_PARAM,
            ],
            "return_type": "map",
            "output_schema": PARSER_OUTPUT_SCHEMA,
            "author": "WAVE Framework",
            "tags": ["json", "jsonpath", "data", "parsing"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """
        Validate plugin parameters.

        Args:
            params: Parameter values to validate

        Raises:
            ValueError: On validation failure with descriptive error message
            TypeError: On type mismatch
        """
        self._validate_json_content(params)
        self._validate_queries(params, query_type="JSONPath")
        self._validate_output_mode(params)
        self._validate_query_output_types(params)

    def _validate_json_content(self, params: dict[str, Any]) -> None:
        """Validate the required 'json_content' parameter."""
        if "json_content" not in params:
            raise ValueError("Missing required parameter: json_content")
        json_content = params["json_content"]
        if not isinstance(json_content, str):
            raise TypeError(
                f"Parameter 'json_content' must be a string, got {type(json_content).__name__}"
            )

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Execute JSON parsing and JSONPath queries.

        Args:
            context: Execution context containing parameters, logger

        Returns:
            dict: Execution result with success flag, errors array, and results.
                  In combined mode, results are in a 'results' map.
                  In individual mode, each query result is a top-level key.

        Raises:
            ValueError: On JSON parse errors (fatal - no document to query)
        """
        params = context["parameters"]
        logger = context.get("logger")

        json_content = params["json_content"]
        queries = params["queries"]
        output_mode = params.get("output_mode", "combined")
        query_output_types = params.get("query_output_types", {})

        data = self._parse_json(json_content, logger)

        results, errors = self._execute_queries(
            data, queries, output_mode, query_output_types, logger
        )

        return self._build_result(results, errors, output_mode)

    def _parse_json(self, json_content: str, logger: Any) -> Any:
        """Parse JSON content, raising ValueError on failure."""
        if logger:
            logger.debug(f"Parsing JSON document ({len(json_content)} bytes)")
        try:
            return json.loads(json_content, parse_float=WaveDecimal)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON: {e}") from e

    def _execute_queries(
        self,
        data: Any,
        queries: dict[str, str],
        output_mode: str,
        query_output_types: dict[str, str],
        logger: Any,
    ) -> tuple[dict[str, Any], list[dict[str, str]]]:
        """Execute all JSONPath queries, collecting results and errors."""
        results: dict[str, Any] = {}
        errors: list[dict[str, str]] = []

        for query_name, query_expr in queries.items():
            if logger:
                logger.debug(f"Executing JSONPath query '{query_name}': {query_expr}")

            try:
                jsonpath_expr = jsonpath_parse(query_expr)
                matches = jsonpath_expr.find(data)
            except Exception as e:
                errors.append({"query": query_name, "error": str(e)})
                continue

            converted = self._convert_jsonpath_result(matches)

            if logger:
                logger.debug(f"Query '{query_name}' returned type: {converted['type']}")

            self._store_query_result(
                results, errors, query_name, converted, output_mode, query_output_types
            )

        return results, errors

    def _convert_jsonpath_result(self, matches: list[Any]) -> dict[str, Any]:
        """
        Convert JSONPath match results to WAVE-compatible type.

        Args:
            matches: List of DatumInContext objects from jsonpath_ng.find()

        Returns:
            dict: Map with 'type' and 'value' fields
        """
        if not matches:
            return {"type": "array", "value": []}

        # Extract values from match objects
        values = [match.value for match in matches]

        # Single match - unwrap and detect type
        if len(values) == 1:
            return self._detect_type(values[0])

        # Multiple matches - return as array
        return {"type": "array", "value": values}
