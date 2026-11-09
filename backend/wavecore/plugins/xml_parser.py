"""
XML Parser Plugin

Implements requirement:
- REQ-3.4.1.11: XML processing with XPath support

Provides comprehensive XML document parsing, querying, and transformation
capabilities through XPath expressions, enabling workflows to extract data
from XML responses, validate XML structure, and manipulate XML content.
"""

from typing import Any

from lxml import etree

from wavecore.plugins._parser_base import (
    OUTPUT_MODE_PARAM,
    PARSER_OUTPUT_SCHEMA,
    QUERY_OUTPUT_TYPES_PARAM,
    QueryParserBase,
    queries_param,
)


class XMLParserPlugin(QueryParserBase):
    """
    XML Parser Plugin.

    Executes XML parsing and XPath queries with support for:
    - XML well-formedness validation
    - XPath expression evaluation
    - Namespace-aware parsing and querying (auto-extracted from document)
    - Multiple XPath queries on same document
    - Type conversion (text, number, boolean, node-sets to WAVE types)

    Namespace declarations (xmlns:prefix="uri") on the root element are
    auto-extracted so XPath queries can reference them without explicit
    configuration.

    Parameters:
        xml_content (string): XML content to parse and query (required)
        queries (map): Map of query_name -> XPath_expression (required)

    Returns:
        map: Execution result with success flag and results map containing
             each query's result with type and value
    """

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "xml-parser",
            "name": "XML Parser",
            "version": "1.0.0",
            "category": "data",
            "description": (
                "Parses XML documents and executes XPath queries to extract data. "
                "Namespace declarations on the root element are auto-extracted for "
                "use in XPath queries. Supports multiple queries and automatic "
                "type conversion of XPath results to WAVE types (string, float, bool, array)."
            ),
            "parameters": [
                {
                    "name": "xml_content",
                    "type": "string",
                    "required": True,
                    "description": (
                        "XML content to parse and query. Must be well-formed XML. "
                        "Can contain namespaces."
                    ),
                },
                queries_param("XPath"),
                OUTPUT_MODE_PARAM,
                QUERY_OUTPUT_TYPES_PARAM,
            ],
            "return_type": "map",
            "output_schema": PARSER_OUTPUT_SCHEMA,
            "author": "WAVE Framework",
            "tags": ["xml", "xpath", "data", "parsing"],
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
        self._validate_xml_content(params)
        self._validate_queries(params, query_type="XPath")
        self._validate_output_mode(params)
        self._validate_query_output_types(params)

    def _validate_xml_content(self, params: dict[str, Any]) -> None:
        """Validate the required 'xml_content' parameter."""
        if "xml_content" not in params:
            raise ValueError("Missing required parameter: xml_content")
        xml_content = params["xml_content"]
        if not isinstance(xml_content, str):
            raise TypeError(
                f"Parameter 'xml_content' must be a string, got {type(xml_content).__name__}"
            )

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """
        Execute XML parsing and XPath queries.

        Args:
            context: Execution context containing parameters, logger

        Returns:
            dict: Execution result with success flag, errors array, and results.
                  In combined mode, results are in a 'results' map.
                  In individual mode, each query result is a top-level key.

        Raises:
            ValueError: On XML parse errors (fatal - no document to query)
        """
        params = context["parameters"]
        logger = context.get("logger")

        xml_content = params["xml_content"]
        queries = params["queries"]
        output_mode = params.get("output_mode", "combined")
        query_output_types = params.get("query_output_types", {})

        doc = self._parse_xml(xml_content, logger)
        namespaces = self._resolve_namespaces(doc)

        results, errors = self._execute_queries(
            doc, queries, namespaces, output_mode, query_output_types, logger
        )

        return self._build_result(results, errors, output_mode)

    def _parse_xml(self, xml_content: str, logger: Any) -> etree._Element:
        """Parse XML content, raising ValueError on failure."""
        if logger:
            logger.debug(f"Parsing XML document ({len(xml_content)} bytes)")
        try:
            return etree.fromstring(xml_content.encode("utf-8"))
        except etree.XMLSyntaxError as e:
            raise ValueError(f"Failed to parse XML: {e}") from e

    @staticmethod
    def _resolve_namespaces(doc: etree._Element) -> dict[str, str]:
        """The prefixed namespace declarations of the root element."""
        return {k: v for k, v in doc.nsmap.items() if k is not None}

    def _execute_queries(
        self,
        doc: etree._Element,
        queries: dict[str, str],
        namespaces: dict[str, str],
        output_mode: str,
        query_output_types: dict[str, str],
        logger: Any,
    ) -> tuple[dict[str, Any], list[dict[str, str]]]:
        """Execute all XPath queries, collecting results and errors."""
        results: dict[str, Any] = {}
        errors: list[dict[str, str]] = []

        for query_name, query_expr in queries.items():
            if logger:
                logger.debug(f"Executing XPath query '{query_name}': {query_expr}")

            try:
                xpath_result = doc.xpath(query_expr, namespaces=namespaces)
            except etree.XPathError as e:
                errors.append({"query": query_name, "error": str(e)})
                continue

            converted = self._convert_xpath_result(xpath_result)

            if logger:
                logger.debug(f"Query '{query_name}' returned type: {converted['type']}")

            self._store_query_result(
                results, errors, query_name, converted, output_mode, query_output_types
            )

        return results, errors

    def _convert_xpath_result(self, xpath_result: Any) -> dict[str, Any]:
        """
        Convert XPath result to WAVE-compatible type.

        Args:
            xpath_result: Result from XPath evaluation

        Returns:
            dict: Map with 'type' and 'value' fields
        """
        if isinstance(xpath_result, bool):
            return {"type": "bool", "value": xpath_result}

        if isinstance(xpath_result, float):
            return self._convert_numeric(xpath_result)

        if isinstance(xpath_result, str):
            # lxml XPath text() predicates return `_ElementUnicodeResult`,
            # a `str` subclass that yaml.safe_dump refuses to represent. Coerce
            # to a plain str so the value survives the variable-snapshot write
            # at the end of a tracked execution.
            return {"type": "string", "value": str(xpath_result)}

        if isinstance(xpath_result, list):
            return self._convert_node_set(xpath_result)

        # Fallback for unexpected types - should not occur with XPath 1.0
        # XPath only returns: node-set (list), boolean, number, or string
        # This is defensive programming for future XPath versions or lxml changes
        return {"type": "string", "value": str(xpath_result)}  # pragma: no cover

    @staticmethod
    def _convert_numeric(value: float) -> dict[str, Any]:
        """Convert an XPath number, an IEEE float by the spec, preferring int for whole numbers."""
        if value.is_integer():
            return {"type": "int", "value": int(value)}
        return {"type": "float", "value": value}

    @staticmethod
    def _node_to_string(node: Any) -> str:
        """Extract the string value from a single XPath node.

        Always returns a plain ``str``: lxml's node.text is
        ``_ElementUnicodeResult`` (a ``str`` subclass), which yaml.safe_dump
        cannot represent and which breaks the terminal-callback snapshot
        write of a tracked execution.
        """
        if isinstance(node, str):
            return str(node)
        if isinstance(node, etree._Element):
            return str(node.text) if node.text else ""
        return str(node)  # pragma: no cover

    def _convert_node_set(self, nodes: list[Any]) -> dict[str, Any]:
        """Convert an XPath node-set (list) to a WAVE-typed result."""
        if not nodes:
            return {"type": "array", "value": []}

        values = [self._node_to_string(node) for node in nodes]

        if len(values) == 1:
            return {"type": "string", "value": values[0]}

        return {"type": "array", "value": values}
