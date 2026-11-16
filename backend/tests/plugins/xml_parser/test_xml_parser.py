"""
Tests for XML Parser Plugin

Implements comprehensive test coverage for requirement:
- REQ-3.4.1.11: XML processing with XPath support

Following TDD approach with exact error messages and 100% coverage requirement.
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.expressions.errors import NullValueError
from wavecore.core.variables.decimal_value import WaveDecimal
from wavecore.plugins.xml_parser import XMLParserPlugin


class TestXMLParserPluginMetadata:
    """Test plugin metadata declaration."""

    def test_output_mode_declares_trim(self):
        """output_mode is an enum selection - it declares trim=True."""
        params = {p["name"]: p for p in XMLParserPlugin().metadata["parameters"]}
        assert params["output_mode"].get("trim") is True

    def test_output_mode_is_a_choice_list_defaulting_to_combined(self):
        """output_mode offers combined / individual, combined by default (REQ-6.2.1)."""
        params = {p["name"]: p for p in XMLParserPlugin().metadata["parameters"]}

        assert params["output_mode"]["enum_values"] == ["combined", "individual"]
        assert params["output_mode"]["default"] == "combined"

    def test_xml_content_preserves_whitespace(self):
        """The XML document is whitespace-significant - it must never be trimmed."""
        params = {p["name"]: p for p in XMLParserPlugin().metadata["parameters"]}
        assert not params["xml_content"].get("trim")

    def test_metadata_structure(self):
        """Test that metadata contains all required fields."""
        plugin = XMLParserPlugin()
        metadata = plugin.metadata

        assert metadata["id"] == "xml-parser"
        assert metadata["name"] == "XML Parser"
        assert metadata["version"] == "1.0.0"
        assert metadata["category"] == "data"
        assert "description" in metadata
        assert "parameters" in metadata
        assert metadata["return_type"] == "map"

    def test_metadata_parameters(self):
        """Test that all required parameters are defined in metadata."""
        plugin = XMLParserPlugin()
        metadata = plugin.metadata
        params = {p["name"]: p for p in metadata["parameters"]}

        # Required parameters
        assert "xml_content" in params
        assert params["xml_content"]["type"] == "string"
        assert params["xml_content"]["required"] is True

        assert "queries" in params
        assert params["queries"]["type"] == "map"
        assert params["queries"]["required"] is True

        # Optional parameters
        assert "output_mode" in params
        assert params["output_mode"]["type"] == "string"
        assert params["output_mode"]["required"] is False

        assert "query_output_types" in params
        assert params["query_output_types"]["type"] == "map"
        assert params["query_output_types"]["required"] is False

    def test_metadata_output_schema(self):
        """Test that output schema includes success, errors, and results."""
        plugin = XMLParserPlugin()
        metadata = plugin.metadata
        outputs = {o["name"]: o for o in metadata["output_schema"]}

        assert "success" in outputs
        assert outputs["success"]["type"] == "boolean"

        assert "errors" in outputs
        assert outputs["errors"]["type"] == "array"

        assert "results" in outputs
        assert outputs["results"]["type"] == "map"


class TestXMLParserPluginValidation:
    """Test parameter validation."""

    @pytest.mark.asyncio
    async def test_validate_missing_xml_content(self):
        """Test validation fails when xml_content parameter is missing."""
        plugin = XMLParserPlugin()
        params = {"queries": {"result": "//root/item"}}

        with pytest.raises(ValueError, match="^Missing required parameter: xml_content$"):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_missing_queries(self):
        """Test validation fails when queries parameter is missing."""
        plugin = XMLParserPlugin()
        params = {"xml_content": "<root><item>test</item></root>"}

        with pytest.raises(ValueError, match="^Missing required parameter: queries$"):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_xml_content_not_string(self):
        """Test validation fails when xml_content is not a string."""
        plugin = XMLParserPlugin()
        params = {"xml_content": 123, "queries": {"result": "//item"}}

        with pytest.raises(
            TypeError,
            match="^Parameter 'xml_content' must be a string, got int$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_queries_not_map(self):
        """Test validation fails when queries is not a map."""
        plugin = XMLParserPlugin()
        params = {"xml_content": "<root/>", "queries": "not a map"}

        with pytest.raises(
            TypeError,
            match="^Parameter 'queries' must be a dict, got str$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_empty_queries(self):
        """Test validation fails when queries map is empty."""
        plugin = XMLParserPlugin()
        params = {"xml_content": "<root/>", "queries": {}}

        with pytest.raises(
            ValueError,
            match="^Parameter 'queries' cannot be empty - at least one XPath query required$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_query_value_not_string(self):
        """Test validation fails when query value is not a string."""
        plugin = XMLParserPlugin()
        params = {"xml_content": "<root/>", "queries": {"result": 123}}

        with pytest.raises(
            TypeError,
            match="^Query 'result' must be a string, got int$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_output_mode_not_string(self):
        """Test validation fails when output_mode is not a string."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root/>",
            "queries": {"result": "//item"},
            "output_mode": 123,
        }

        with pytest.raises(
            TypeError,
            match="^Parameter 'output_mode' must be a string, got int$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_output_mode_invalid_value(self):
        """Test validation fails when output_mode has an invalid value."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root/>",
            "queries": {"result": "//item"},
            "output_mode": "invalid",
        }

        with pytest.raises(
            ValueError,
            match="^Parameter 'output_mode' must be 'combined' or 'individual'$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_query_output_types_not_map(self):
        """Test validation fails when query_output_types is not a map."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root/>",
            "queries": {"result": "//item"},
            "query_output_types": "not a map",
        }

        with pytest.raises(
            TypeError,
            match="^Parameter 'query_output_types' must be a dict, got str$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_query_output_types_value_not_string(self):
        """Test validation fails when query_output_types value is not a string."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root/>",
            "queries": {"result": "//item"},
            "query_output_types": {"result": 123},
        }

        with pytest.raises(
            TypeError,
            match="^Query output type for 'result' must be a string, got int$",
        ):
            await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_valid_params(self):
        """Test validation passes with valid parameters."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root><item>test</item></root>",
            "queries": {"result": "//item/text()"},
        }

        # Should not raise
        await plugin.validate(params)

    @pytest.mark.asyncio
    async def test_validate_valid_params_with_all_options(self):
        """Test validation passes with all optional parameters."""
        plugin = XMLParserPlugin()
        params = {
            "xml_content": "<root/>",
            "queries": {"result": "//item"},
            "output_mode": "individual",
            "query_output_types": {"result": "integer"},
        }

        # Should not raise
        await plugin.validate(params)


class TestXMLParserPluginExecution:
    """Test plugin execution."""

    @pytest.mark.asyncio
    async def test_execute_simple_xpath_text(self):
        """Test executing simple XPath query for text content."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>Hello World</item></root>",
                "queries": {"result": "//item/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert "results" in result
        assert "result" in result["results"]
        assert result["results"]["result"]["type"] == "string"
        assert result["results"]["result"]["value"] == "Hello World"

    @pytest.mark.asyncio
    async def test_execute_multiple_queries(self):
        """Test executing multiple XPath queries on same document."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>foo</item><count>42</count></root>",
                "queries": {"item_text": "//item/text()", "count_value": "//count/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["item_text"]["value"] == "foo"
        assert result["results"]["count_value"]["value"] == "42"

    @pytest.mark.asyncio
    async def test_execute_xpath_number_integer(self):
        """Test executing XPath query that returns an integer number."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>1</item><item>2</item><item>3</item></root>",
                "queries": {"count": "count(//item)"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["count"]["type"] == "int"
        assert result["results"]["count"]["value"] == 3

    @pytest.mark.asyncio
    async def test_execute_xpath_number_float(self):
        """Test executing XPath query that returns a floating point number."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>10</item><item>3</item></root>",
                "queries": {"avg": "sum(//item) div count(//item)"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["avg"]["type"] == "float"
        assert (
            abs(result["results"]["avg"]["value"] - 6.5) < 0.001
        )  # Allow for floating point precision

    @pytest.mark.asyncio
    async def test_execute_xpath_boolean(self):
        """Test executing XPath query that returns a boolean."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"has_item": "boolean(//item)"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["has_item"]["type"] == "bool"
        assert result["results"]["has_item"]["value"] is True

    @pytest.mark.asyncio
    async def test_execute_xpath_nodeset_multiple_text(self):
        """Test executing XPath query that returns multiple text nodes."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>A</item><item>B</item><item>C</item></root>",
                "queries": {"items": "//item/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["items"]["type"] == "array"
        assert result["results"]["items"]["value"] == ["A", "B", "C"]

    @pytest.mark.asyncio
    async def test_execute_xpath_nodeset_elements(self):
        """Test executing XPath query that returns element nodes."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item id='1'>A</item><item id='2'>B</item></root>",
                "queries": {"items": "//item"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["items"]["type"] == "array"
        # Should return array of element text content
        assert len(result["results"]["items"]["value"]) == 2
        assert "A" in result["results"]["items"]["value"]
        assert "B" in result["results"]["items"]["value"]

    @pytest.mark.asyncio
    async def test_execute_xpath_empty_result(self):
        """Test executing XPath query that returns no results."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"missing": "//nonexistent/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["missing"]["type"] == "array"
        assert result["results"]["missing"]["value"] == []

    @pytest.mark.asyncio
    async def test_execute_auto_extracts_namespaces(self):
        """Test that namespace declarations are auto-extracted from XML root element."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": '<root xmlns:ex="http://example.com"><ex:item>auto</ex:item></root>',
                "queries": {"result": "//ex:item/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["results"]["result"]["type"] == "string"
        assert result["results"]["result"]["value"] == "auto"

    @pytest.mark.asyncio
    async def test_execute_malformed_xml(self):
        """Test execution fails with malformed XML (fatal error)."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>unclosed",
                "queries": {"result": "//item"},
            },
            "logger": None,
        }

        with pytest.raises(ValueError, match="^Failed to parse XML:"):
            await plugin.execute(context)

    @pytest.mark.asyncio
    async def test_execute_invalid_xpath_collected_as_error(self):
        """Test that invalid XPath is collected in errors array, not raised."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"bad": "//[invalid xpath syntax"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad"
        assert len(result["errors"][0]["error"]) > 0

    @pytest.mark.asyncio
    async def test_execute_per_query_error_collection(self):
        """Test that bad queries collect errors while good queries succeed."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {
                    "good": "//item/text()",
                    "bad": "//[invalid",
                    "also_good": "count(//item)",
                },
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        # Good queries still have results
        assert result["results"]["good"]["value"] == "test"
        assert result["results"]["also_good"]["value"] == 1
        # Bad query in errors
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad"

    @pytest.mark.asyncio
    async def test_execute_unresolved_namespace_collected_as_error(self):
        """Test that unresolved namespace prefix is collected as error."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"result": "//ns:item"},
                # Missing namespace definition for 'ns' prefix
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "result"

    @pytest.mark.asyncio
    async def test_execute_xpath_with_attribute(self):
        """Test executing XPath query that selects attributes."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item id='123'>test</item></root>",
                "queries": {"id": "//item/@id"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["id"]["type"] == "string"
        assert result["results"]["id"]["value"] == "123"

    @pytest.mark.asyncio
    async def test_execute_complex_xpath(self):
        """Test executing complex XPath with predicates."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": """
                    <root>
                        <item priority='high'>A</item>
                        <item priority='low'>B</item>
                        <item priority='high'>C</item>
                    </root>
                """,
                "queries": {"high_priority": "//item[@priority='high']/text()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["high_priority"]["type"] == "array"
        assert result["results"]["high_priority"]["value"] == ["A", "C"]

    @pytest.mark.asyncio
    async def test_execute_xpath_string_function(self):
        """Test executing XPath string() function that returns direct string."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"str_result": "string(//item)"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["str_result"]["type"] == "string"
        assert result["results"]["str_result"]["value"] == "test"

    @pytest.mark.asyncio
    async def test_execute_xpath_element_with_no_text(self):
        """Test executing XPath query on element with no text content."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><empty/><item></item></root>",
                "queries": {"empty_elements": "//empty | //item"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        # Should return array of empty strings for elements with no text
        assert result["results"]["empty_elements"]["type"] == "array"
        assert all(val == "" for val in result["results"]["empty_elements"]["value"])

    @pytest.mark.asyncio
    async def test_execute_xpath_comment_nodes(self):
        """Test executing XPath query that returns comment nodes."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><!-- comment1 --><item>test</item><!-- comment2 --></root>",
                "queries": {"comments": "//comment()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["comments"]["type"] == "array"
        # Comment nodes should be converted to strings
        assert len(result["results"]["comments"]["value"]) == 2
        assert " comment1 " in result["results"]["comments"]["value"]
        assert " comment2 " in result["results"]["comments"]["value"]

    @pytest.mark.asyncio
    async def test_execute_xpath_processing_instruction(self):
        """Test executing XPath query that returns processing instruction nodes."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" '
                'href="style.xsl"?><root><item>test</item></root>',
                "queries": {"pi": "//processing-instruction()"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        # Processing instructions should be handled (converted to strings)
        assert "pi" in result["results"]
        # Should return array or string depending on how many PIs
        assert result["results"]["pi"]["type"] in ["string", "array"]

    @pytest.mark.asyncio
    async def test_execute_with_logger(self):
        """Test execution logs appropriately when logger is provided."""
        plugin = XMLParserPlugin()

        # Mock logger
        class MockLogger:
            def __init__(self):
                self.messages = []

            def debug(self, msg):
                self.messages.append(("debug", msg))

            def info(self, msg):
                self.messages.append(("info", msg))

        logger = MockLogger()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"result": "//item/text()"},
            },
            "logger": logger,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        # Should have debug logs for parsing and query execution
        assert len(logger.messages) > 0
        assert any("Parsing XML" in msg for level, msg in logger.messages)


class TestXMLParserPluginIndividualMode:
    """Test individual output mode and type coercion."""

    @pytest.mark.asyncio
    async def test_individual_mode_basic(self):
        """Test individual mode returns results as top-level keys."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><status>COMPLETED</status></root>",
                "queries": {"order_status": "//status/text()"},
                "output_mode": "individual",
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        # Individual mode: no 'results' key, values are top-level
        assert "results" not in result
        assert result["order_status"] == "COMPLETED"

    @pytest.mark.asyncio
    async def test_individual_mode_default_type_string(self):
        """Test individual mode defaults to string type (no coercion needed)."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><count>42</count></root>",
                "queries": {"count_str": "//count/text()"},
                "output_mode": "individual",
                # No query_output_types - defaults to "string"
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["count_str"] == "42"  # String, not coerced

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_to_integer(self):
        """Test type coercion: string to integer in individual mode."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><count>42</count></root>",
                "queries": {"item_count": "//count/text()"},
                "output_mode": "individual",
                "query_output_types": {"item_count": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["item_count"] == 42
        assert isinstance(result["item_count"], int)

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_to_float(self):
        """Test type coercion: string to float in individual mode."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><price>19.99</price></root>",
                "queries": {"price": "//price/text()"},
                "output_mode": "individual",
                "query_output_types": {"price": "float"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert abs(result["price"] - 19.99) < 0.001
        assert isinstance(result["price"], WaveDecimal)

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_to_boolean_true(self):
        """Test type coercion: string 'true' to boolean True."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><active>true</active></root>",
                "queries": {"is_active": "//active/text()"},
                "output_mode": "individual",
                "query_output_types": {"is_active": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["is_active"] is True

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_to_boolean_false(self):
        """Test type coercion: string 'false' to boolean False."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><active>false</active></root>",
                "queries": {"is_active": "//active/text()"},
                "output_mode": "individual",
                "query_output_types": {"is_active": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["is_active"] is False

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_boolean_from_xpath_boolean(self):
        """Test that XPath boolean() result passes through boolean coercion."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"exists": "boolean(//item)"},
                "output_mode": "individual",
                "query_output_types": {"exists": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["exists"] is True

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_integer_from_xpath_count(self):
        """Test that XPath count() result (int) passes through integer coercion."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item/><item/><item/></root>",
                "queries": {"num": "count(//item)"},
                "output_mode": "individual",
                "query_output_types": {"num": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["num"] == 3
        assert isinstance(result["num"], int)

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_float_from_xpath_count(self):
        """Test coercing XPath count() (int) result to float."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item/><item/></root>",
                "queries": {"num": "count(//item)"},
                "output_mode": "individual",
                "query_output_types": {"num": "float"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["num"] == 2.0
        assert isinstance(result["num"], WaveDecimal)

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_string_from_int(self):
        """Test coercing XPath int result to string."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item/><item/></root>",
                "queries": {"num_str": "count(//item)"},
                "output_mode": "individual",
                "query_output_types": {"num_str": "string"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["num_str"] == "2"

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_string_from_bool(self):
        """Test coercing XPath boolean result to string."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"bool_str": "boolean(//item)"},
                "output_mode": "individual",
                "query_output_types": {"bool_str": "string"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["bool_str"] == "True"

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_integer_from_bool(self):
        """Test coercing XPath boolean result to integer."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"bool_int": "boolean(//item)"},
                "output_mode": "individual",
                "query_output_types": {"bool_int": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["bool_int"] == 1

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_float_from_bool(self):
        """Test coercing XPath boolean result to float."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>test</item></root>",
                "queries": {"bool_float": "boolean(//item)"},
                "output_mode": "individual",
                "query_output_types": {"bool_float": "float"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["bool_float"] == 1.0
        assert isinstance(result["bool_float"], WaveDecimal)

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_boolean_from_int(self):
        """Test coercing XPath integer result to boolean."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item/><item/></root>",
                "queries": {"has_items": "count(//item)"},
                "output_mode": "individual",
                "query_output_types": {"has_items": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["has_items"] is True

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_boolean_empty_string(self):
        """Test coercing empty string to boolean False."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><empty></empty></root>",
                "queries": {"is_set": "//empty/text()"},
                "output_mode": "individual",
                "query_output_types": {"is_set": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        # empty/text() returns empty array, which gets coerced
        # Since //empty/text() on <empty></empty> returns [], array->bool fails
        # Actually _convert_xpath_result returns {"type": "array", "value": []}
        # and _coerce_value([], "boolean") -> TypeError
        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "array to boolean" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_integer_failure(self):
        """Test integer coercion failure adds error instead of raising."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><status>not_a_number</status></root>",
                "queries": {"val": "//status/text()"},
                "output_mode": "individual",
                "query_output_types": {"val": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "val"
        assert "Cannot convert 'not_a_number' to integer" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_float_failure(self):
        """Test float coercion failure adds error instead of raising."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><val>abc</val></root>",
                "queries": {"num": "//val/text()"},
                "output_mode": "individual",
                "query_output_types": {"num": "float"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert 'abc' to float" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_boolean_failure(self):
        """Test boolean coercion failure for invalid string."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><val>maybe</val></root>",
                "queries": {"flag": "//val/text()"},
                "output_mode": "individual",
                "query_output_types": {"flag": "boolean"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert 'maybe' to boolean" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_array_to_string_fails(self):
        """Test that array results cannot be coerced to string."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>A</item><item>B</item></root>",
                "queries": {"items": "//item/text()"},
                "output_mode": "individual",
                "query_output_types": {"items": "string"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert array to string" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_array_to_integer_fails(self):
        """Test that array results cannot be coerced to integer."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>1</item><item>2</item></root>",
                "queries": {"items": "//item/text()"},
                "output_mode": "individual",
                "query_output_types": {"items": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert "Cannot convert array to integer" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_array_to_float_fails(self):
        """Test that array results cannot be coerced to float."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>1</item><item>2</item></root>",
                "queries": {"items": "//item/text()"},
                "output_mode": "individual",
                "query_output_types": {"items": "float"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert "Cannot convert array to float" in result["errors"][0]["error"]

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_integer_from_float_value(self):
        """A fractional XPath number asked for as an integer is refused, never truncated."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><item>10</item><item>3</item></root>",
                "queries": {"avg": "sum(//item) div count(//item)"},
                "output_mode": "individual",
                "query_output_types": {"avg": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert result["errors"] == [{"query": "avg", "error": "Cannot convert '6.5' to integer"}]
        assert "avg" not in result

    @pytest.mark.asyncio
    async def test_individual_mode_unknown_type_passthrough(self):
        """Test that unknown expected type passes value through unchanged."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><val>test</val></root>",
                "queries": {"val": "//val/text()"},
                "output_mode": "individual",
                "query_output_types": {"val": "custom_type"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["val"] == "test"

    @pytest.mark.asyncio
    async def test_individual_mode_mixed_success_and_errors(self):
        """Test individual mode with both successful and failed queries."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><val>42</val><name>Alice</name></root>",
                "queries": {
                    "count": "//val/text()",
                    "bad_xpath": "//[invalid",
                    "name": "//name/text()",
                },
                "output_mode": "individual",
                "query_output_types": {"count": "integer", "name": "string"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is False
        assert result["count"] == 42
        assert result["name"] == "Alice"
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad_xpath"

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_boolean_yes_no(self):
        """Test boolean coercion from 'yes'/'no' strings."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><a>yes</a><b>no</b><c>1</c><d>0</d></root>",
                "queries": {
                    "a": "//a/text()",
                    "b": "//b/text()",
                    "c": "//c/text()",
                    "d": "//d/text()",
                },
                "output_mode": "individual",
                "query_output_types": {
                    "a": "boolean",
                    "b": "boolean",
                    "c": "boolean",
                    "d": "boolean",
                },
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["a"] is True
        assert result["b"] is False
        assert result["c"] is True
        assert result["d"] is False

    @pytest.mark.asyncio
    async def test_individual_mode_coerce_integer_from_float_string(self):
        """Test coercing string '3.0' to integer via float conversion."""
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><val>3.0</val></root>",
                "queries": {"num": "//val/text()"},
                "output_mode": "individual",
                "query_output_types": {"num": "integer"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["num"] == 3
        assert isinstance(result["num"], int)


class TestXMLParserPluginNullOutputs:
    """XPath yields no null of its own; the output coercion the XML block shares with the JSON
    block keeps a null as null, and an empty element stays empty text (REQ-3.1.3.23)."""

    @pytest.mark.parametrize("expected_type", ["string", "integer", "float", "boolean"])
    def test_a_null_result_stays_null_with_no_error(self, expected_type):
        plugin = XMLParserPlugin()
        results = {}
        errors = []

        plugin._store_query_result(
            results,
            errors,
            "v",
            {"type": "null", "value": None},
            "individual",
            {"v": expected_type},
        )

        assert (results, errors) == ({"v": None}, [])

    @pytest.mark.asyncio
    async def test_an_empty_element_stays_empty_text(self):
        plugin = XMLParserPlugin()
        context = {
            "parameters": {
                "xml_content": "<root><empty/></root>",
                "queries": {"v": "//empty"},
                "output_mode": "individual",
                "query_output_types": {"v": "string"},
            },
            "logger": None,
        }

        result = await plugin.execute(context)

        assert result == {"success": True, "errors": [], "v": ""}


class TestXMLParserPluginLifecycle:
    """Test plugin lifecycle methods."""

    @pytest.mark.asyncio
    async def test_initialize_no_op(self):
        """Test initialize method (should be no-op)."""
        plugin = XMLParserPlugin()
        context = {"parameters": {}}

        # Should not raise
        await plugin.initialize(context)

    @pytest.mark.asyncio
    async def test_cleanup_no_op(self):
        """Test cleanup method (should be no-op)."""
        plugin = XMLParserPlugin()

        # Should not raise
        await plugin.cleanup()


class TestXMLParserPluginGetModel:
    """Test get_plugin_model method."""

    def test_get_plugin_model(self):
        """Test that get_plugin_model returns valid Plugin model."""
        plugin = XMLParserPlugin()
        model = plugin.get_plugin_model()

        assert model.id == "xml-parser"
        assert model.name == "XML Parser"
        assert model.version == "1.0.0"
        assert model.category == "data"
        assert len(model.parameters) >= 2  # xml_content, queries, and optional params


async def _run_block(params: dict[str, Any]) -> dict[str, Any]:
    """One XML Parser in the engine's order: validate, then execute."""
    plugin = XMLParserPlugin()
    await plugin.validate(params)
    result: dict[str, Any] = await plugin.execute({"parameters": params, "logger": None})
    return result


class TestXMLParserPluginNullEntries:
    """A null query fails naming its key; a null output type is skipped, so the query reads
    as text (REQ-3.1.3.21)."""

    @pytest.mark.asyncio
    async def test_a_null_query_fails_naming_its_key(self) -> None:
        params = {
            "xml_content": "<root><status>DONE</status></root>",
            "queries": {"status": "//status/text()", "q": None},
        }

        with pytest.raises(NullValueError, match=r"^'q' in 'queries' is null$"):
            await _run_block(params)

    @pytest.mark.asyncio
    async def test_a_null_output_type_reads_the_query_as_text(self) -> None:
        params = {
            "xml_content": "<root><count>42</count><open>true</open></root>",
            "queries": {"count": "//count/text()", "open": "//open/text()"},
            "output_mode": "individual",
            "query_output_types": {"count": None, "open": "boolean"},
        }

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "count": "42", "open": True}


def _individual(xml_content: str, queries: dict[str, str], types: dict[str, str]) -> dict:
    """Individual-mode parameters with one output type per query."""
    return {
        "xml_content": xml_content,
        "queries": queries,
        "output_mode": "individual",
        "query_output_types": types,
    }


class TestXMLParserPluginExactNumbers:
    """A number keeps every digit, and a fractional value asked for as an integer is refused
    (REQ-3.1.3.14)."""

    @pytest.mark.asyncio
    async def test_a_long_integer_text_asked_for_as_an_integer_keeps_every_digit(self) -> None:
        params = _individual(
            "<root><id>9007199254740993</id></root>", {"id": "//id/text()"}, {"id": "integer"}
        )

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "id": 9007199254740993}

    @pytest.mark.asyncio
    async def test_a_long_fraction_asked_for_as_a_float_keeps_every_digit(self) -> None:
        params = _individual(
            "<root><v>-2123.123213123123699999</v></root>", {"v": "//v/text()"}, {"v": "float"}
        )

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "v": Decimal("-2123.123213123123699999")}
        assert isinstance(result["v"], WaveDecimal)

    @pytest.mark.asyncio
    async def test_a_fraction_asked_for_as_an_integer_is_refused(self) -> None:
        params = _individual(
            "<root><v>10.5</v></root>",
            {"text": "//v/text()", "number": "//v div 4"},
            {"text": "integer", "number": "integer"},
        )

        result = await _run_block(params)

        assert result == {
            "success": False,
            "errors": [
                {"query": "text", "error": "Cannot convert '10.5' to integer"},
                {"query": "number", "error": "Cannot convert '2.625' to integer"},
            ],
        }

    @pytest.mark.asyncio
    async def test_an_xpath_number_asked_for_as_a_float_is_exact(self) -> None:
        params = _individual("<root><v>0.1</v></root>", {"v": "number(//v)"}, {"v": "float"})

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "v": Decimal("0.1")}
        assert isinstance(result["v"], WaveDecimal)

    @pytest.mark.asyncio
    async def test_an_xpath_number_that_is_not_a_number_asked_for_as_a_float_is_refused(
        self,
    ) -> None:
        params = _individual("<root/>", {"v": "0 div 0"}, {"v": "float"})

        result = await _run_block(params)

        assert result == {
            "success": False,
            "errors": [{"query": "v", "error": "Cannot convert 'nan' to float"}],
        }

    @pytest.mark.asyncio
    async def test_a_small_xpath_number_reads_as_plain_digits(self) -> None:
        params = _individual("<root><v>1</v></root>", {"v": "//v div 10000000"}, {"v": "string"})

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "v": "0.0000001"}

    @pytest.mark.asyncio
    async def test_an_infinite_xpath_number_asked_for_as_an_integer_is_refused(self) -> None:
        params = _individual("<root/>", {"v": "1 div 0"}, {"v": "integer"})

        result = await _run_block(params)

        assert result == {
            "success": False,
            "errors": [{"query": "v", "error": "Cannot convert 'inf' to integer"}],
        }
