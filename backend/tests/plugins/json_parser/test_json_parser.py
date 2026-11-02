"""
Tests for JSON Parser Plugin

Implements comprehensive test coverage for requirement:
- REQ-3.4.1.16: JSON processing with JSONPath support

Following TDD approach with exact error messages and 100% coverage requirement.
"""

from typing import Any

import pytest

from wavecore.core.expressions.errors import NullValueError
from wavecore.plugins.json_parser import JSONParserPlugin

SAMPLE_JSON = """{
  "store": {
    "name": "BookShop",
    "books": [
      {"title": "Book A", "price": 10.5, "available": true},
      {"title": "Book B", "price": 20, "available": false}
    ],
    "count": 2,
    "open": true
  }
}"""


def make_context(params, logger=None):
    """Build an execution context dict from parameters and optional logger."""
    ctx = {"parameters": params}
    if logger:
        ctx["logger"] = logger
    return ctx


class TestJSONParserPluginMetadata:
    """Test plugin metadata declaration."""

    def test_output_mode_declares_trim(self):
        """output_mode is an enum selection - it declares trim=True."""
        params = {p["name"]: p for p in JSONParserPlugin().metadata["parameters"]}
        assert params["output_mode"].get("trim") is True

    def test_output_mode_is_a_choice_list_defaulting_to_combined(self):
        """output_mode offers combined / individual, combined by default (REQ-6.2.1)."""
        params = {p["name"]: p for p in JSONParserPlugin().metadata["parameters"]}

        assert params["output_mode"]["enum_values"] == ["combined", "individual"]
        assert params["output_mode"]["default"] == "combined"

    def test_json_content_preserves_whitespace(self):
        """The JSON document is whitespace-significant - it must never be trimmed."""
        params = {p["name"]: p for p in JSONParserPlugin().metadata["parameters"]}
        assert not params["json_content"].get("trim")

    def test_metadata_structure(self):
        """Test that metadata contains all required fields."""
        plugin = JSONParserPlugin()
        metadata = plugin.metadata

        assert metadata["id"] == "json-parser"
        assert metadata["name"] == "JSON Parser"
        assert metadata["version"] == "1.0.0"
        assert metadata["category"] == "data"
        assert "description" in metadata
        assert "parameters" in metadata
        assert metadata["return_type"] == "map"

    def test_metadata_parameters(self):
        """Test that all required parameters are defined in metadata."""
        plugin = JSONParserPlugin()
        metadata = plugin.metadata
        params = {p["name"]: p for p in metadata["parameters"]}

        # Required parameters
        assert "json_content" in params
        assert params["json_content"]["type"] == "string"
        assert params["json_content"]["required"] is True

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
        plugin = JSONParserPlugin()
        metadata = plugin.metadata
        outputs = {o["name"]: o for o in metadata["output_schema"]}

        assert "success" in outputs
        assert outputs["success"]["type"] == "boolean"

        assert "errors" in outputs
        assert outputs["errors"]["type"] == "array"

        assert "results" in outputs
        assert outputs["results"]["type"] == "map"

    def test_metadata_author_and_tags(self):
        """Test that metadata includes author and tags fields."""
        plugin = JSONParserPlugin()
        metadata = plugin.metadata

        assert metadata["author"] == "WAVE Framework"
        assert "tags" in metadata
        assert "json" in metadata["tags"]
        assert "jsonpath" in metadata["tags"]
        assert "data" in metadata["tags"]
        assert "parsing" in metadata["tags"]


class TestJSONParserPluginValidation:
    """Test parameter validation."""

    async def test_validate_missing_json_content(self):
        """Test validation fails when json_content parameter is missing."""
        plugin = JSONParserPlugin()
        params = {"queries": {"name": "$.store.name"}}

        with pytest.raises(ValueError, match="^Missing required parameter: json_content$"):
            await plugin.validate(params)

    async def test_validate_json_content_wrong_type(self):
        """Test validation fails when json_content is not a string."""
        plugin = JSONParserPlugin()
        params = {"json_content": 123, "queries": {"name": "$.store.name"}}

        with pytest.raises(
            TypeError,
            match="^Parameter 'json_content' must be a string, got int$",
        ):
            await plugin.validate(params)

    async def test_validate_missing_queries(self):
        """Test validation fails when queries parameter is missing."""
        plugin = JSONParserPlugin()
        params = {"json_content": "{}"}

        with pytest.raises(ValueError, match="^Missing required parameter: queries$"):
            await plugin.validate(params)

    async def test_validate_queries_wrong_type(self):
        """Test validation fails when queries is not a dict."""
        plugin = JSONParserPlugin()
        params = {"json_content": "{}", "queries": ["not", "a", "map"]}

        with pytest.raises(
            TypeError,
            match="^Parameter 'queries' must be a dict, got list$",
        ):
            await plugin.validate(params)

    async def test_validate_empty_queries(self):
        """Test validation fails when queries map is empty."""
        plugin = JSONParserPlugin()
        params = {"json_content": "{}", "queries": {}}

        with pytest.raises(
            ValueError,
            match="^Parameter 'queries' cannot be empty - at least one JSONPath query required$",
        ):
            await plugin.validate(params)

    async def test_validate_query_value_not_string(self):
        """Test validation fails when a query value is not a string."""
        plugin = JSONParserPlugin()
        params = {"json_content": "{}", "queries": {"name": 42}}

        with pytest.raises(
            TypeError,
            match="^Query 'name' must be a string, got int$",
        ):
            await plugin.validate(params)

    async def test_validate_output_mode_wrong_type(self):
        """Test validation fails when output_mode is not a string."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": "{}",
            "queries": {"name": "$.store.name"},
            "output_mode": 123,
        }

        with pytest.raises(
            TypeError,
            match="^Parameter 'output_mode' must be a string, got int$",
        ):
            await plugin.validate(params)

    async def test_validate_output_mode_invalid_value(self):
        """Test validation fails when output_mode has an invalid value."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": "{}",
            "queries": {"name": "$.store.name"},
            "output_mode": "invalid",
        }

        with pytest.raises(
            ValueError,
            match="^Parameter 'output_mode' must be 'combined' or 'individual'$",
        ):
            await plugin.validate(params)

    async def test_validate_query_output_types_wrong_type(self):
        """Test validation fails when query_output_types is not a dict."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": "{}",
            "queries": {"name": "$.store.name"},
            "query_output_types": ["not", "a", "map"],
        }

        with pytest.raises(
            TypeError,
            match="^Parameter 'query_output_types' must be a dict, got list$",
        ):
            await plugin.validate(params)

    async def test_validate_query_output_types_value_not_string(self):
        """Test validation fails when query_output_types value is not a string."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": "{}",
            "queries": {"name": "$.store.name"},
            "query_output_types": {"key": 42},
        }

        with pytest.raises(
            TypeError,
            match="^Query output type for 'key' must be a string, got int$",
        ):
            await plugin.validate(params)

    async def test_validate_valid_params_minimal(self):
        """Test validation passes with minimal valid parameters."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": SAMPLE_JSON,
            "queries": {"name": "$.store.name"},
        }

        # Should not raise
        await plugin.validate(params)

    async def test_validate_valid_params_with_all_options(self):
        """Test validation passes with all optional parameters."""
        plugin = JSONParserPlugin()
        params = {
            "json_content": SAMPLE_JSON,
            "queries": {"name": "$.store.name"},
            "output_mode": "individual",
            "query_output_types": {"name": "string"},
        }

        # Should not raise
        await plugin.validate(params)


class TestJSONParserPluginExecution:
    """Test core plugin execution."""

    async def test_execute_query_scalar_string(self):
        """Test querying a scalar string value from JSON."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert "results" in result
        assert "name" in result["results"]
        assert result["results"]["name"]["type"] == "string"
        assert result["results"]["name"]["value"] == "BookShop"

    async def test_execute_query_array_values(self):
        """Test querying array values with wildcard JSONPath."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["titles"]["type"] == "array"
        assert result["results"]["titles"]["value"] == ["Book A", "Book B"]

    async def test_execute_query_nested_object(self):
        """Test querying a nested object from JSON."""
        plugin = JSONParserPlugin()
        json_content = '{"root": {"nested": {"key": "value"}}}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"obj": "$.root.nested"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["obj"]["type"] == "map"
        assert result["results"]["obj"]["value"] == {"key": "value"}

    async def test_execute_query_integer_value(self):
        """Test querying an integer value from JSON."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"count": "$.store.count"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["count"]["type"] == "integer"
        assert result["results"]["count"]["value"] == 2

    async def test_execute_query_float_value(self):
        """Test querying a float value from JSON."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"price": "$.store.books[0].price"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["price"]["type"] == "float"
        assert abs(result["results"]["price"]["value"] - 10.5) < 0.001

    async def test_execute_query_boolean_value(self):
        """Test querying a boolean value from JSON."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"open": "$.store.open"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["open"]["type"] == "boolean"
        assert result["results"]["open"]["value"] is True

    async def test_execute_query_null_value(self):
        """Test querying a null value from JSON."""
        plugin = JSONParserPlugin()
        json_content = '{"key": null}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"val": "$.key"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["val"]["type"] == "null"
        assert result["results"]["val"]["value"] is None

    async def test_execute_multiple_queries(self):
        """Test executing multiple queries on same document."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {
                    "name": "$.store.name",
                    "count": "$.store.count",
                    "titles": "$.store.books[*].title",
                },
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["name"]["value"] == "BookShop"
        assert result["results"]["count"]["value"] == 2
        assert result["results"]["titles"]["value"] == ["Book A", "Book B"]

    async def test_execute_json_parse_error(self):
        """Test execution fails with malformed JSON (fatal error)."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": "{not valid json",
                "queries": {"name": "$.store.name"},
            }
        )

        with pytest.raises(ValueError, match="^Failed to parse JSON:"):
            await plugin.execute(context)

    async def test_execute_invalid_jsonpath_collected_as_error(self):
        """Test that invalid JSONPath is collected in errors array, not raised."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"bad": "$.[[[invalid"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad"
        assert len(result["errors"][0]["error"]) > 0

    async def test_execute_per_query_error_collection(self):
        """Test that bad queries collect errors while good queries succeed."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {
                    "good": "$.store.name",
                    "bad": "$.[[[invalid",
                    "also_good": "$.store.count",
                },
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        # Good queries still have results
        assert result["results"]["good"]["value"] == "BookShop"
        assert result["results"]["also_good"]["value"] == 2
        # Bad query in errors
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad"

    async def test_execute_empty_query_results(self):
        """Test querying a path that returns no matches."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"missing": "$.store.nonexistent"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["missing"]["type"] == "array"
        assert result["results"]["missing"]["value"] == []

    async def test_execute_query_array_of_objects(self):
        """Test querying that returns an array of objects."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"books": "$.store.books[*]"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["books"]["type"] == "array"
        assert len(result["results"]["books"]["value"]) == 2
        assert result["results"]["books"]["value"][0]["title"] == "Book A"

    async def test_execute_query_array_of_numbers(self):
        """Test querying that returns an array of numeric values."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"prices": "$.store.books[*].price"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["prices"]["type"] == "array"
        assert result["results"]["prices"]["value"] == [10.5, 20]

    async def test_execute_query_single_match_returns_scalar(self):
        """Test that a query matching exactly one value returns a scalar, not array."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"first_title": "$.store.books[0].title"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        assert result["results"]["first_title"]["type"] == "string"
        assert result["results"]["first_title"]["value"] == "Book A"

    async def test_execute_query_integer_value_whole_float(self):
        """Test that a whole-number float (e.g. 20.0 from JSON int 20) is typed as integer."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"price_int": "$.store.books[1].price"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["results"]["price_int"]["type"] == "integer"
        assert result["results"]["price_int"]["value"] == 20


class TestJSONParserPluginCombinedMode:
    """Test combined output mode (default)."""

    async def test_combined_mode_results_structure(self):
        """Test that combined mode returns results as {alias: {type, value}}."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert "results" in result
        assert "name" in result["results"]
        assert "type" in result["results"]["name"]
        assert "value" in result["results"]["name"]

    async def test_combined_mode_string_result(self):
        """Test combined mode with string result."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["name"]["type"] == "string"
        assert result["results"]["name"]["value"] == "BookShop"

    async def test_combined_mode_array_result(self):
        """Test combined mode with array result."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["titles"]["type"] == "array"
        assert result["results"]["titles"]["value"] == ["Book A", "Book B"]

    async def test_combined_mode_map_result(self):
        """Test combined mode with object/map result."""
        plugin = JSONParserPlugin()
        json_content = '{"config": {"setting": {"key": "val", "num": 1}}}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"setting": "$.config.setting"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["setting"]["type"] == "map"
        assert result["results"]["setting"]["value"] == {"key": "val", "num": 1}

    async def test_combined_mode_integer_result(self):
        """Test combined mode with integer result."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"count": "$.store.count"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["count"]["type"] == "integer"
        assert result["results"]["count"]["value"] == 2

    async def test_combined_mode_float_result(self):
        """Test combined mode with float result."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"price": "$.store.books[0].price"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["price"]["type"] == "float"
        assert abs(result["results"]["price"]["value"] - 10.5) < 0.001

    async def test_combined_mode_boolean_result(self):
        """Test combined mode with boolean result."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"open": "$.store.open"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["open"]["type"] == "boolean"
        assert result["results"]["open"]["value"] is True

    async def test_combined_mode_null_result(self):
        """Test combined mode with null result."""
        plugin = JSONParserPlugin()
        json_content = '{"val": null}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"val": "$.val"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["val"]["type"] == "null"
        assert result["results"]["val"]["value"] is None

    async def test_combined_mode_number_integer_detection(self):
        """Test that whole numbers are detected as integer type."""
        plugin = JSONParserPlugin()
        json_content = '{"val": 42}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"val": "$.val"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["val"]["type"] == "integer"
        assert result["results"]["val"]["value"] == 42

    async def test_combined_mode_number_float_detection(self):
        """Test that fractional numbers are detected as float type."""
        plugin = JSONParserPlugin()
        json_content = '{"val": 3.14}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"val": "$.val"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["val"]["type"] == "float"
        assert abs(result["results"]["val"]["value"] - 3.14) < 0.001

    async def test_combined_mode_whole_float_detected_as_integer(self):
        """Test that whole-number floats (e.g. 20.0) are detected as integer type."""
        plugin = JSONParserPlugin()
        json_content = '{"val": 20.0}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"val": "$.val"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["val"]["type"] == "integer"
        assert result["results"]["val"]["value"] == 20

    async def test_combined_mode_list_value_detected_as_array(self):
        """Test that a JSON array value accessed as a single match is typed as array."""
        plugin = JSONParserPlugin()
        json_content = '{"items": [1, 2, 3]}'
        context = make_context(
            {
                "json_content": json_content,
                "queries": {"items": "$.items"},
            }
        )

        result = await plugin.execute(context)

        assert result["results"]["items"]["type"] == "array"
        assert result["results"]["items"]["value"] == [1, 2, 3]


class TestJSONParserPluginIndividualMode:
    """Test individual output mode and type coercion."""

    async def test_individual_mode_basic(self):
        """Test individual mode returns results as top-level keys."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"store_name": "$.store.name"},
                "output_mode": "individual",
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["errors"] == []
        # Individual mode: no 'results' key, values are top-level
        assert "results" not in result
        assert result["store_name"] == "BookShop"

    async def test_individual_mode_default_type_string(self):
        """Test individual mode defaults to string type (no coercion needed)."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"count_str": "$.store.count"},
                "output_mode": "individual",
                # No query_output_types - defaults to "string"
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["count_str"] == "2"  # Coerced to string

    async def test_individual_mode_coerce_to_integer(self):
        """Test type coercion: value to integer in individual mode."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"item_count": "$.store.count"},
                "output_mode": "individual",
                "query_output_types": {"item_count": "integer"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["item_count"] == 2
        assert isinstance(result["item_count"], int)

    async def test_individual_mode_coerce_to_float(self):
        """Test type coercion: value to float in individual mode."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"price": "$.store.books[0].price"},
                "output_mode": "individual",
                "query_output_types": {"price": "float"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert abs(result["price"] - 10.5) < 0.001
        assert isinstance(result["price"], float)

    async def test_individual_mode_coerce_to_boolean_true(self):
        """Test type coercion: value to boolean True."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"is_open": "$.store.open"},
                "output_mode": "individual",
                "query_output_types": {"is_open": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["is_open"] is True

    async def test_individual_mode_coerce_to_boolean_false(self):
        """Test type coercion: value to boolean False."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"available": "$.store.books[1].available"},
                "output_mode": "individual",
                "query_output_types": {"available": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["available"] is False

    async def test_individual_mode_coerce_integer_failure(self):
        """Test integer coercion failure adds error instead of raising."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"val": "$.store.name"},
                "output_mode": "individual",
                "query_output_types": {"val": "integer"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "val"
        assert "Cannot convert 'BookShop' to integer" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_float_failure(self):
        """Test float coercion failure adds error instead of raising."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"val": "$.store.name"},
                "output_mode": "individual",
                "query_output_types": {"val": "float"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert 'BookShop' to float" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_boolean_failure(self):
        """Test boolean coercion failure for invalid string."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"flag": "$.store.name"},
                "output_mode": "individual",
                "query_output_types": {"flag": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert 'BookShop' to boolean" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_array_to_string_fails(self):
        """Test that array results cannot be coerced to string."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
                "output_mode": "individual",
                "query_output_types": {"titles": "string"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert len(result["errors"]) == 1
        assert "Cannot convert array to string" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_array_to_integer_fails(self):
        """Test that array results cannot be coerced to integer."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
                "output_mode": "individual",
                "query_output_types": {"titles": "integer"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert "Cannot convert array to integer" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_array_to_float_fails(self):
        """Test that array results cannot be coerced to float."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
                "output_mode": "individual",
                "query_output_types": {"titles": "float"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert "Cannot convert array to float" in result["errors"][0]["error"]

    async def test_individual_mode_coerce_array_to_boolean_fails(self):
        """Test that array results cannot be coerced to boolean."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"titles": "$.store.books[*].title"},
                "output_mode": "individual",
                "query_output_types": {"titles": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert "Cannot convert array to boolean" in result["errors"][0]["error"]

    async def test_individual_mode_unknown_type_passthrough(self):
        """Test that unknown expected type passes value through unchanged."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
                "output_mode": "individual",
                "query_output_types": {"name": "custom_type"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["name"] == "BookShop"

    async def test_individual_mode_mixed_success_and_errors(self):
        """Test individual mode with both successful and failed queries."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {
                    "count": "$.store.count",
                    "bad_jsonpath": "$.[[[invalid",
                    "name": "$.store.name",
                },
                "output_mode": "individual",
                "query_output_types": {"count": "integer", "name": "string"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is False
        assert result["count"] == 2
        assert result["name"] == "BookShop"
        assert len(result["errors"]) == 1
        assert result["errors"][0]["query"] == "bad_jsonpath"

    async def test_individual_mode_coerce_string_from_int(self):
        """Test coercing integer value to string in individual mode."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"count_str": "$.store.count"},
                "output_mode": "individual",
                "query_output_types": {"count_str": "string"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["count_str"] == "2"

    async def test_individual_mode_coerce_string_from_bool(self):
        """Test coercing boolean value to string in individual mode."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"open_str": "$.store.open"},
                "output_mode": "individual",
                "query_output_types": {"open_str": "string"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["open_str"] == "True"

    async def test_individual_mode_coerce_integer_from_bool(self):
        """Test coercing boolean value to integer."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"open_int": "$.store.open"},
                "output_mode": "individual",
                "query_output_types": {"open_int": "integer"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["open_int"] == 1

    async def test_individual_mode_coerce_float_from_bool(self):
        """Test coercing boolean value to float."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"open_float": "$.store.open"},
                "output_mode": "individual",
                "query_output_types": {"open_float": "float"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["open_float"] == 1.0
        assert isinstance(result["open_float"], float)

    async def test_individual_mode_coerce_float_from_int(self):
        """Test coercing integer value to float."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"count_float": "$.store.count"},
                "output_mode": "individual",
                "query_output_types": {"count_float": "float"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["count_float"] == 2.0
        assert isinstance(result["count_float"], float)

    async def test_individual_mode_coerce_integer_from_float(self):
        """Test coercing float value to integer (truncates)."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"price_int": "$.store.books[0].price"},
                "output_mode": "individual",
                "query_output_types": {"price_int": "integer"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["price_int"] == 10  # 10.5 truncated to 10
        assert isinstance(result["price_int"], int)

    async def test_individual_mode_coerce_boolean_from_int(self):
        """Test coercing integer value to boolean."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"has_items": "$.store.count"},
                "output_mode": "individual",
                "query_output_types": {"has_items": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["has_items"] is True

    async def test_individual_mode_coerce_boolean_from_float(self):
        """Test coercing float value to boolean."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"has_price": "$.store.books[0].price"},
                "output_mode": "individual",
                "query_output_types": {"has_price": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["has_price"] is True

    async def test_individual_mode_json_null_stays_null_under_every_output_type(self):
        """A JSON null bound to a string, integer, float or boolean output, or to an output with
        no declared type, stays null with no error (REQ-3.1.3.23)."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": '{"s": null, "i": null, "f": null, "b": null, "d": null}',
                "queries": {"s": "$.s", "i": "$.i", "f": "$.f", "b": "$.b", "d": "$.d"},
                "output_mode": "individual",
                "query_output_types": {"s": "string", "i": "integer", "f": "float", "b": "boolean"},
            }
        )

        result = await plugin.execute(context)

        assert result == {
            "success": True,
            "errors": [],
            "s": None,
            "i": None,
            "f": None,
            "b": None,
            "d": None,
        }


class TestJSONParserPluginTypeCoercion:
    """Test _coerce_value method directly for thorough coverage."""

    def setup_method(self):
        """Set up plugin instance for all tests."""
        self.plugin = JSONParserPlugin()

    # --- string coercion ---

    def test_coerce_string_from_string(self):
        """Test coercing string to string is identity."""
        assert self.plugin._coerce_value("hello", "string") == "hello"

    def test_coerce_string_from_int(self):
        """Test coercing int to string."""
        assert self.plugin._coerce_value(42, "string") == "42"

    def test_coerce_string_from_float(self):
        """Test coercing float to string."""
        assert self.plugin._coerce_value(3.14, "string") == "3.14"

    def test_coerce_string_from_bool(self):
        """Test coercing bool to string."""
        assert self.plugin._coerce_value(True, "string") == "True"
        assert self.plugin._coerce_value(False, "string") == "False"

    def test_coerce_string_from_none(self):
        """A null stays null under a string output, never the text 'None' (REQ-3.1.3.23)."""
        assert self.plugin._coerce_value(None, "string") is None

    def test_coerce_string_from_array_raises(self):
        """Test coercing array to string raises TypeError."""
        with pytest.raises(TypeError, match="^Cannot convert array to string$"):
            self.plugin._coerce_value(["a", "b"], "string")

    # --- integer coercion ---

    def test_coerce_integer_from_int(self):
        """Test coercing int to integer is identity."""
        assert self.plugin._coerce_value(42, "integer") == 42

    def test_coerce_integer_from_float(self):
        """Test coercing float to integer truncates."""
        assert self.plugin._coerce_value(3.7, "integer") == 3

    def test_coerce_integer_from_bool(self):
        """Test coercing bool to integer."""
        assert self.plugin._coerce_value(True, "integer") == 1
        assert self.plugin._coerce_value(False, "integer") == 0

    def test_coerce_integer_from_string_valid(self):
        """Test coercing valid numeric string to integer."""
        assert self.plugin._coerce_value("42", "integer") == 42

    def test_coerce_integer_from_string_float(self):
        """Test coercing float string to integer (via float conversion)."""
        assert self.plugin._coerce_value("3.7", "integer") == 3

    def test_coerce_integer_from_string_invalid(self):
        """Test coercing non-numeric string to integer raises ValueError."""
        with pytest.raises(ValueError, match="^Cannot convert 'abc' to integer$"):
            self.plugin._coerce_value("abc", "integer")

    def test_coerce_integer_from_array_raises(self):
        """Test coercing array to integer raises TypeError."""
        with pytest.raises(TypeError, match="^Cannot convert array to integer$"):
            self.plugin._coerce_value([1, 2], "integer")

    # --- float coercion ---

    def test_coerce_float_from_float(self):
        """Test coercing float to float is identity."""
        assert self.plugin._coerce_value(3.14, "float") == 3.14

    def test_coerce_float_from_int(self):
        """Test coercing int to float."""
        result = self.plugin._coerce_value(42, "float")
        assert result == 42.0
        assert isinstance(result, float)

    def test_coerce_float_from_bool(self):
        """Test coercing bool to float."""
        assert self.plugin._coerce_value(True, "float") == 1.0
        assert self.plugin._coerce_value(False, "float") == 0.0

    def test_coerce_float_from_string_valid(self):
        """Test coercing valid numeric string to float."""
        assert abs(self.plugin._coerce_value("3.14", "float") - 3.14) < 0.001

    def test_coerce_float_from_string_integer(self):
        """Test coercing integer string to float."""
        result = self.plugin._coerce_value("42", "float")
        assert result == 42.0
        assert isinstance(result, float)

    def test_coerce_float_from_string_invalid(self):
        """Test coercing non-numeric string to float raises ValueError."""
        with pytest.raises(ValueError, match="^Cannot convert 'abc' to float$"):
            self.plugin._coerce_value("abc", "float")

    def test_coerce_float_from_array_raises(self):
        """Test coercing array to float raises TypeError."""
        with pytest.raises(TypeError, match="^Cannot convert array to float$"):
            self.plugin._coerce_value([1.0, 2.0], "float")

    # --- boolean coercion ---

    def test_coerce_boolean_from_bool_true(self):
        """Test coercing bool True to boolean passes through."""
        assert self.plugin._coerce_value(True, "boolean") is True

    def test_coerce_boolean_from_bool_false(self):
        """Test coercing bool False to boolean passes through."""
        assert self.plugin._coerce_value(False, "boolean") is False

    def test_coerce_boolean_from_string_true(self):
        """Test coercing string 'true' to boolean True."""
        assert self.plugin._coerce_value("true", "boolean") is True

    def test_coerce_boolean_from_string_false(self):
        """Test coercing string 'false' to boolean False."""
        assert self.plugin._coerce_value("false", "boolean") is False

    def test_coerce_boolean_from_string_yes(self):
        """Test coercing string 'yes' to boolean True."""
        assert self.plugin._coerce_value("yes", "boolean") is True

    def test_coerce_boolean_from_string_no(self):
        """Test coercing string 'no' to boolean False."""
        assert self.plugin._coerce_value("no", "boolean") is False

    def test_coerce_boolean_from_string_1(self):
        """Test coercing string '1' to boolean True."""
        assert self.plugin._coerce_value("1", "boolean") is True

    def test_coerce_boolean_from_string_0(self):
        """Test coercing string '0' to boolean False."""
        assert self.plugin._coerce_value("0", "boolean") is False

    def test_coerce_boolean_from_string_empty(self):
        """Test coercing empty string to boolean False."""
        assert self.plugin._coerce_value("", "boolean") is False

    def test_coerce_boolean_from_string_invalid(self):
        """Test coercing invalid string to boolean raises ValueError."""
        with pytest.raises(ValueError, match="^Cannot convert 'maybe' to boolean$"):
            self.plugin._coerce_value("maybe", "boolean")

    def test_coerce_boolean_from_int_truthy(self):
        """Test coercing non-zero int to boolean True."""
        assert self.plugin._coerce_value(1, "boolean") is True
        assert self.plugin._coerce_value(42, "boolean") is True

    def test_coerce_boolean_from_int_falsy(self):
        """Test coercing zero int to boolean False."""
        assert self.plugin._coerce_value(0, "boolean") is False

    def test_coerce_boolean_from_float_truthy(self):
        """Test coercing non-zero float to boolean True."""
        assert self.plugin._coerce_value(3.14, "boolean") is True

    def test_coerce_boolean_from_float_falsy(self):
        """Test coercing zero float to boolean False."""
        assert self.plugin._coerce_value(0.0, "boolean") is False

    def test_coerce_boolean_from_array_raises(self):
        """Test coercing array to boolean raises TypeError."""
        with pytest.raises(TypeError, match="^Cannot convert array to boolean$"):
            self.plugin._coerce_value([True, False], "boolean")

    # --- null ---

    @pytest.mark.parametrize("expected_type", ["integer", "float", "boolean"])
    def test_coerce_none_stays_none(self, expected_type):
        """A null stays null under a number or boolean output (REQ-3.1.3.23)."""
        assert self.plugin._coerce_value(None, expected_type) is None

    # --- unknown type ---

    def test_coerce_unknown_type_passthrough(self):
        """Test that unknown expected type returns value as-is."""
        assert self.plugin._coerce_value("hello", "custom") == "hello"
        assert self.plugin._coerce_value(42, "custom") == 42
        assert self.plugin._coerce_value([1, 2], "custom") == [1, 2]


class TestJSONParserPluginLogger:
    """Test logger integration during execution."""

    async def test_logger_debug_called_during_parsing(self):
        """Test that logger.debug is called when parsing JSON document."""
        plugin = JSONParserPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def debug(self, msg):
                self.messages.append(("debug", msg))

        logger = MockLogger()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
            },
            logger=logger,
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert len(logger.messages) > 0
        assert any("Parsing JSON" in msg for level, msg in logger.messages)

    async def test_logger_debug_called_for_each_query(self):
        """Test that logger.debug is called for each query execution."""
        plugin = JSONParserPlugin()

        class MockLogger:
            def __init__(self):
                self.messages = []

            def debug(self, msg):
                self.messages.append(("debug", msg))

        logger = MockLogger()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {
                    "name": "$.store.name",
                    "count": "$.store.count",
                },
            },
            logger=logger,
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        # Should have at least one debug message per query
        query_messages = [
            msg for level, msg in logger.messages if "query" in msg.lower() or "Query" in msg
        ]
        assert len(query_messages) >= 2

    async def test_execute_without_logger(self):
        """Test execution works correctly when no logger is provided."""
        plugin = JSONParserPlugin()
        context = make_context(
            {
                "json_content": SAMPLE_JSON,
                "queries": {"name": "$.store.name"},
            }
        )

        result = await plugin.execute(context)

        assert result["success"] is True
        assert result["results"]["name"]["value"] == "BookShop"


class TestJSONParserPluginLifecycle:
    """Test plugin lifecycle methods."""

    async def test_initialize_no_op(self):
        """Test initialize method (should be no-op)."""
        plugin = JSONParserPlugin()
        context = {"parameters": {}}

        # Should not raise
        await plugin.initialize(context)

    async def test_cleanup_no_op(self):
        """Test cleanup method (should be no-op)."""
        plugin = JSONParserPlugin()

        # Should not raise
        await plugin.cleanup()


class TestJSONParserPluginGetModel:
    """Test get_plugin_model method."""

    def test_get_plugin_model(self):
        """Test that get_plugin_model returns valid Plugin model."""
        plugin = JSONParserPlugin()
        model = plugin.get_plugin_model()

        assert model.id == "json-parser"
        assert model.name == "JSON Parser"
        assert model.version == "1.0.0"
        assert model.category == "data"
        assert len(model.parameters) >= 2  # json_content, queries, and optional params


async def _run_block(params: dict[str, Any]) -> dict[str, Any]:
    """One JSON Parser in the engine's order: validate, then execute."""
    plugin = JSONParserPlugin()
    await plugin.validate(params)
    result: dict[str, Any] = await plugin.execute(make_context(params))
    return result


class TestJSONParserPluginNullEntries:
    """A null query fails naming its key; a null output type is skipped, so the query reads
    as text (REQ-3.1.3.21)."""

    async def test_a_null_query_fails_naming_its_key(self) -> None:
        params = {"json_content": SAMPLE_JSON, "queries": {"name": "$.store.name", "q": None}}

        with pytest.raises(NullValueError, match=r"^'q' in 'queries' is null$"):
            await _run_block(params)

    async def test_a_null_output_type_reads_the_query_as_text(self) -> None:
        params = {
            "json_content": SAMPLE_JSON,
            "queries": {"count": "$.store.count", "open": "$.store.open"},
            "output_mode": "individual",
            "query_output_types": {"count": None, "open": "boolean"},
        }

        result = await _run_block(params)

        assert result == {"success": True, "errors": [], "count": "2", "open": True}
