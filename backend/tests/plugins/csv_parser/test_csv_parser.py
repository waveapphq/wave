"""
Tests for the CSV Parser plugin (REQ-3.4.1.12, REQ-3.4.3.3).

The CSV plugin is a pure format converter between delimited text and WAVE's
table type: Parse (text -> table) and Serialize (table -> text). It performs
no file I/O. Column typing (auto / string / schema), empty-cell and type-
mismatch policy, and declarative sort/filter (backed by Table.order_by /
Table.filter) are covered here.
"""

from decimal import Decimal
from typing import Any

import pytest

from wavecore.core.expressions.errors import NullValueError
from wavecore.core.table import Table
from wavecore.plugins.csv_parser import CSVParserPlugin


def make_context(params: dict[str, Any]) -> dict[str, Any]:
    """Build an execution context dict from parameters (mirrors the plugin harness)."""
    return {"parameters": params}


def by_name(name: str) -> dict[str, str]:
    """A column picked by name, as the config window stores it."""
    return {"mode": "name", "value": name}


def literal_row(
    operator: str,
    reference: Any = "",
    value_type: str = "integer",
    *,
    is_expression: bool = False,
    row_id: str = "csv-filter-cond-1",
) -> dict[str, Any]:
    """A literal condition row on the cell, as the config window stores it."""
    return {
        "id": row_id,
        "type": "literal",
        "variable": "_cell",
        "value_type": value_type,
        "operator": operator,
        "reference_value": reference,
        "reference_is_expression": is_expression,
    }


def filter_block(
    column: dict[str, str],
    as_type: str,
    conditions: list[dict[str, Any]],
    block_id: str = "csv-filter-1",
) -> dict[str, Any]:
    """A per-column filter block, as the config window stores it."""
    return {"id": block_id, "column": column, "asType": as_type, "conditions": conditions}


def sort_key(column: dict[str, str], direction: str, sort_id: str = "csv-sort-1") -> dict[str, Any]:
    """A sort key, as the config window stores it."""
    return {"id": sort_id, "column": column, "direction": direction}


# =============================================================================
# Metadata
# =============================================================================


class TestCSVParserPluginMetadata:
    """Metadata descriptor and Pydantic model construction."""

    def test_metadata_core_fields(self) -> None:
        meta = CSVParserPlugin().metadata

        assert meta["id"] == "csv-parser"
        assert meta["name"] == "CSV Parser"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "data"
        assert meta["return_type"] == "map"

    def test_metadata_output_schema_names_and_types(self) -> None:
        meta = CSVParserPlugin().metadata
        outputs = {o["name"]: o["type"] for o in meta["output_schema"]}

        assert outputs["table"] == "table"
        assert outputs["row_count"] == "integer"
        assert outputs["schema"] == "array"
        assert outputs["csv_content"] == "string"
        assert outputs["success"] == "boolean"
        assert outputs["errors"] == "array"

    def test_operation_is_an_optional_choice_defaulting_to_parse(self) -> None:
        params = {p["name"]: p for p in CSVParserPlugin().metadata["parameters"]}
        operation = params["operation"]

        assert operation["type"] == "string"
        assert operation["required"] is False
        assert operation["default"] == "parse"
        assert operation["enum_values"] == ["parse", "serialize"]

    def test_get_plugin_model_builds(self) -> None:
        model = CSVParserPlugin().get_plugin_model()

        assert model.id == "csv-parser"
        assert model.version == "1.0.0"
        assert model.metadata.category == "data"
        assert model.return_type == "map"


# =============================================================================
# Validation
# =============================================================================


class TestCSVParserPluginValidation:
    """validate() raises exact-message errors for bad parameter sets."""

    async def test_validate_parse_happy_path(self) -> None:
        await CSVParserPlugin().validate({"operation": "parse", "csv_content": "a\n1\n"})

    async def test_validate_serialize_happy_path(self) -> None:
        await CSVParserPlugin().validate(
            {"operation": "serialize", "table": Table(columns=[("a", "string")])}
        )

    async def test_validate_missing_operation(self) -> None:
        with pytest.raises(ValueError, match="^Missing required parameter: operation$"):
            await CSVParserPlugin().validate({})

    async def test_validate_operation_wrong_type(self) -> None:
        with pytest.raises(TypeError, match="^Parameter 'operation' must be a string, got int$"):
            await CSVParserPlugin().validate({"operation": 123})

    async def test_validate_operation_invalid(self) -> None:
        with pytest.raises(
            ValueError,
            match=r"^Invalid operation: 'delete'\. Supported operations: parse, serialize$",
        ):
            await CSVParserPlugin().validate({"operation": "delete"})

    async def test_validate_parse_missing_csv_content(self) -> None:
        with pytest.raises(ValueError, match="^Missing required parameter: csv_content$"):
            await CSVParserPlugin().validate({"operation": "parse"})

    async def test_validate_parse_csv_content_wrong_type(self) -> None:
        with pytest.raises(TypeError, match="^Parameter 'csv_content' must be a string, got int$"):
            await CSVParserPlugin().validate({"operation": "parse", "csv_content": 123})

    async def test_validate_serialize_missing_table(self) -> None:
        with pytest.raises(ValueError, match="^Missing required parameter: table$"):
            await CSVParserPlugin().validate({"operation": "serialize"})

    async def test_validate_delimiter_wrong_length(self) -> None:
        with pytest.raises(ValueError, match="^Parameter 'delimiter' must be a single character$"):
            await CSVParserPlugin().validate(
                {"operation": "parse", "csv_content": "a\n1\n", "delimiter": ",,"}
            )

    async def test_validate_column_types_invalid(self) -> None:
        with pytest.raises(
            ValueError,
            match="^Parameter 'column_types' must be one of: auto, string, schema$",
        ):
            await CSVParserPlugin().validate(
                {"operation": "parse", "csv_content": "a\n1\n", "column_types": "magic"}
            )

    async def test_validate_schema_mode_without_source(self) -> None:
        with pytest.raises(
            ValueError,
            match="^Column types 'schema' requires a schema table in 'schema_source'$",
        ):
            await CSVParserPlugin().validate(
                {"operation": "parse", "csv_content": "a\n1\n", "column_types": "schema"}
            )

    async def test_validate_empty_cells_invalid(self) -> None:
        with pytest.raises(
            ValueError, match="^Parameter 'empty_cells' must be one of: none, default$"
        ):
            await CSVParserPlugin().validate(
                {"operation": "parse", "csv_content": "a\n1\n", "empty_cells": "zero"}
            )

    async def test_validate_on_mismatch_invalid(self) -> None:
        with pytest.raises(
            ValueError,
            match="^Parameter 'on_mismatch' must be one of: fail, skip_row, replace_default$",
        ):
            await CSVParserPlugin().validate(
                {"operation": "parse", "csv_content": "a\n1\n", "on_mismatch": "ignore"}
            )


# =============================================================================
# Parse - column typing
# =============================================================================


class TestCSVParserPluginParse:
    """Parse operation: header handling, delimiter/quote, auto typing + guards."""

    async def test_parse_basic_auto_typing(self) -> None:
        ctx = make_context(
            {"operation": "parse", "csv_content": "id,name,score\n1,Alice,95.5\n2,Bob,80.0\n"}
        )
        result = await CSVParserPlugin().execute(ctx)

        table = result["table"]
        assert isinstance(table, Table)
        assert table.col_names() == ["id", "name", "score"]
        assert table.col_types() == ["integer", "string", "float"]
        assert table.cell(0, "id") == 1
        assert table.cell(0, "name") == "Alice"
        assert table.cell(0, "score") == 95.5
        assert result["row_count"] == 2
        assert result["success"] is True
        assert result["errors"] == []
        assert result["schema"] == [
            {"name": "id", "type": "integer"},
            {"name": "name", "type": "string"},
            {"name": "score", "type": "float"},
        ]

    async def test_parse_no_header_default_column_names(self) -> None:
        ctx = make_context(
            {"operation": "parse", "csv_content": "1,Alice\n2,Bob\n", "has_header": False}
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["Column 0", "Column 1"]
        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "Column 0") == 1
        assert table.cell(0, "Column 1") == "Alice"
        assert result["row_count"] == 2

    async def test_parse_custom_delimiter_tab(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "a\tb\n1\t2\n", "delimiter": "\t"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["a", "b"]
        assert table.cell(0, "a") == 1
        assert table.cell(0, "b") == 2

    async def test_parse_quoted_field_with_delimiter(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": 'name,note\n"Smith, Jr.",hello\n'})
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].cell(0, "name") == "Smith, Jr."

    async def test_parse_auto_widens_int_to_float(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "v\n1\n2.5\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["float"]
        assert table.cell(0, "v") == 1
        assert table.cell(1, "v") == 2.5

    async def test_parse_auto_mixed_falls_back_to_string(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "v\n1\nabc\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["string"]
        assert table.cell(0, "v") == "1"
        assert table.cell(1, "v") == "abc"

    async def test_parse_auto_boolean(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "flag\ntrue\nfalse\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["boolean"]
        assert table.cell(0, "flag") is True
        assert table.cell(1, "flag") is False

    async def test_parse_auto_boolean_case_insensitive(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "flag\nTrue\nFALSE\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["boolean"]
        assert table.cell(0, "flag") is True
        assert table.cell(1, "flag") is False

    async def test_parse_one_and_zero_are_integers_not_boolean(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "x\n1\n0\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["integer"]
        assert table.cell(0, "x") == 1
        assert table.cell(1, "x") == 0

    async def test_parse_guard_leading_zero_stays_string(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "code\n007\n042\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["string"]
        assert table.cell(0, "code") == "007"

    async def test_parse_guard_leading_plus_stays_string(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "v\n+1\n+2\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["string"]
        assert table.cell(0, "v") == "+1"

    async def test_parse_negative_int_is_integer(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "v\n-1\n-2\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["integer"]
        assert table.cell(0, "v") == -1

    async def test_parse_guard_non_finite_stays_string(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "v\nnan\n1.5\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["string"]
        assert table.cell(0, "v") == "nan"
        assert table.cell(1, "v") == "1.5"

    async def test_parse_string_mode_keeps_everything_string(self) -> None:
        ctx = make_context(
            {"operation": "parse", "csv_content": "id,score\n1,2.5\n", "column_types": "string"}
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["string", "string"]
        assert table.cell(0, "id") == "1"
        assert table.cell(0, "score") == "2.5"

    async def test_parse_empty_cell_becomes_none(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "a,b\n1,\n,2\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.cell(0, "b") is None
        assert table.cell(1, "a") is None
        assert table.cell(0, "a") == 1
        assert table.cell(1, "b") == 2

    async def test_parse_all_empty_column_is_string(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "a,b\n1,\n2,\n"})
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "b") is None
        assert table.cell(1, "b") is None

    async def test_parse_empty_cells_default_substitutes_column_default(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "n,label\n5,a\n,b\n",
                "empty_cells": "default",
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "n") == 5
        assert table.cell(1, "n") == 0


# =============================================================================
# Parse - schema mode + type-mismatch policy
# =============================================================================


class TestCSVParserPluginSchemaMode:
    """column_types='schema': conform to a supplied schema table; enforce types."""

    async def test_parse_schema_mode_maps_by_header_name(self) -> None:
        schema = Table(columns=[("id", "integer"), ("name", "string")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,1\nBob,2\n",
                "column_types": "schema",
                "schema_source": schema,
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["id", "name"]
        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "id") == 1
        assert table.cell(0, "name") == "Alice"

    async def test_parse_schema_mode_empty_cell_follows_the_empty_policy(self) -> None:
        schema = Table(columns=[("id", "integer"), ("name", "string")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "id,name\n1,\n",
                "column_types": "schema",
                "schema_source": schema,
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].cell(0, "name") is None
        assert result["errors"] == []

    async def test_parse_schema_mode_empty_cell_takes_the_column_default(self) -> None:
        schema = Table(columns=[("id", "integer"), ("name", "string")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "id,name\n1,\n",
                "column_types": "schema",
                "schema_source": schema,
                "empty_cells": "default",
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].cell(0, "name") == ""

    async def test_parse_schema_mode_maps_by_position_when_no_header(self) -> None:
        schema = Table(columns=[("a", "integer"), ("b", "string")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "10,hello\n20,world\n",
                "has_header": False,
                "column_types": "schema",
                "schema_source": schema,
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["a", "b"]
        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "a") == 10
        assert table.cell(0, "b") == "hello"

    async def test_parse_mismatch_fail_raises(self) -> None:
        schema = Table(columns=[("age", "integer")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "age\n30\nabc\n",
                "column_types": "schema",
                "schema_source": schema,
                "on_mismatch": "fail",
            }
        )
        with pytest.raises(
            ValueError,
            match="^Type mismatch in column 'age': 'abc' is not a valid integer$",
        ):
            await CSVParserPlugin().execute(ctx)

    async def test_parse_mismatch_skip_row(self) -> None:
        schema = Table(columns=[("age", "integer")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "age\n30\nabc\n",
                "column_types": "schema",
                "schema_source": schema,
                "on_mismatch": "skip_row",
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert result["success"] is False
        assert result["row_count"] == 1
        assert table.cell(0, "age") == 30
        assert len(result["errors"]) == 1
        assert result["errors"][0]["row"] == 1
        assert result["errors"][0]["column"] == "age"

    async def test_parse_mismatch_replace_default(self) -> None:
        schema = Table(columns=[("age", "integer")])
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "age\n30\nabc\n",
                "column_types": "schema",
                "schema_source": schema,
                "on_mismatch": "replace_default",
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert result["success"] is False
        assert result["row_count"] == 2
        assert table.cell(0, "age") == 30
        assert table.cell(1, "age") == 0
        assert len(result["errors"]) == 1


# =============================================================================
# Parse - declarative sort + filter (Transform)
# =============================================================================


class TestCSVParserPluginTransform:
    """Sorts and filters saved by the config window shape the parsed table (CSV-12)."""

    async def test_parse_runs_a_sort_saved_by_the_config_window(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\n",
                "sorts": [
                    {
                        "id": "csv-sort-1",
                        "column": {"mode": "name", "value": "score"},
                        "direction": "desc",
                    }
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col("name") == ["Bob", "Alice", "Carol"]
        assert result["row_count"] == 3

    async def test_parse_runs_a_filter_saved_by_the_config_window(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\n",
                "filters": [
                    {
                        "id": "csv-filter-1",
                        "column": {"mode": "name", "value": "score"},
                        "asType": "integer",
                        "conditions": [
                            {
                                "id": "csv-filter-cond-1",
                                "type": "literal",
                                "variable": "_cell",
                                "value_type": "integer",
                                "operator": "greater_than",
                                "reference_value": "75",
                                "reference_is_expression": False,
                            }
                        ],
                    }
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Bob"]
        assert result["row_count"] == 2

    async def test_parse_filter_expression_condition_on_cell(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,\nCarol,70\n",
                "filters": [
                    filter_block(
                        by_name("score"),
                        "integer",
                        [
                            {
                                "id": "csv-filter-cond-1",
                                "type": "expression",
                                "expression": "_cell != None",
                            }
                        ],
                    )
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Carol"]

    async def test_parse_filter_two_conditions_and(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\nDave,88\n",
                "filters": [
                    filter_block(
                        by_name("score"),
                        "integer",
                        [
                            literal_row("greater_than", "75"),
                            {"type": "operator", "value": "and"},
                            literal_row("less_than", "90", row_id="csv-filter-cond-2"),
                        ],
                    )
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Dave"]

    async def test_parse_two_filter_blocks_conjunctive(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score,active\nAlice,80,true\nBob,95,false\nCarol,70,true\n",
                "filters": [
                    filter_block(by_name("score"), "integer", [literal_row("greater_than", "75")]),
                    filter_block(
                        by_name("active"),
                        "boolean",
                        [literal_row("is_true", "", "boolean")],
                        block_id="csv-filter-2",
                    ),
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice"]

    async def test_parse_filter_unknown_operator_raises(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\n",
                "filters": [filter_block(by_name("score"), "integer", [literal_row("bogus", "1")])],
            }
        )
        with pytest.raises(ValueError, match="^Unknown filter operator: 'bogus'$"):
            await CSVParserPlugin().execute(ctx)

    async def test_parse_runs_a_filter_on_a_column_picked_by_index(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\n",
                "filters": [
                    filter_block(
                        {"mode": "index", "value": "1"},
                        "integer",
                        [literal_row("greater_than", "75")],
                    )
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Bob"]

    async def test_parse_runs_a_sort_on_a_column_picked_by_index(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\n",
                "sorts": [sort_key({"mode": "index", "value": "1"}, "desc")],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Bob", "Alice", "Carol"]

    async def test_parse_runs_a_filter_whose_reference_is_an_expression(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,80\nBob,95\nCarol,70\n",
                "filters": [
                    filter_block(
                        by_name("score"),
                        "integer",
                        [literal_row("greater_than", "cutoff", is_expression=True)],
                    )
                ],
            }
        )
        ctx["variables"] = {"cutoff": 75}
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Bob"]

    async def test_parse_reads_a_text_reference_as_the_column_type(self) -> None:
        # Compared as text, "100" would sort before "75" and Alice would be dropped.
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,score\nAlice,100\nBob,80\nCarol,70\n",
                "filters": [
                    filter_block(by_name("score"), "integer", [literal_row("greater_than", "75")])
                ],
            }
        )
        result = await CSVParserPlugin().execute(ctx)

        assert result["table"].col("name") == ["Alice", "Bob"]


# =============================================================================
# Parse - a null cell in a filter row (REQ-3.1.3.25)
# =============================================================================


async def _parse_kept_names(csv_content: str, block: dict[str, Any]) -> list[str]:
    """Parse with one filter block and return the names of the rows it keeps."""
    ctx = make_context({"operation": "parse", "csv_content": csv_content, "filters": [block]})
    result = await CSVParserPlugin().execute(ctx)
    return list(result["table"].col("name"))


class TestCSVParserPluginFilterNullCells:
    """A null cell answers a filter row by the check rule; is null / not null find it."""

    @pytest.mark.parametrize(
        ("operator", "reference", "kept"),
        [
            ("equals", "80", ["Alice"]),
            ("not_equals", "80", ["Bob", "Carol"]),
            ("less_than", "80", ["Carol"]),
            ("greater_than", "70", ["Alice"]),
            ("less_or_equal", "80", ["Alice", "Carol"]),
            ("greater_or_equal", "70", ["Alice", "Carol"]),
        ],
    )
    async def test_a_null_number_cell(self, operator: str, reference: str, kept: list[str]) -> None:
        block = filter_block(by_name("score"), "integer", [literal_row(operator, reference)])

        assert await _parse_kept_names("name,score\nAlice,80\nBob,\nCarol,70\n", block) == kept

    @pytest.mark.parametrize(
        ("operator", "reference", "kept"),
        [
            ("equals", "red", ["Alice"]),
            ("not_equals", "red", ["Bob", "Carol"]),
            ("contains", "e", ["Alice", "Carol"]),
            ("does_not_contain", "r", ["Bob", "Carol"]),
            ("starts_with", "b", ["Carol"]),
            ("ends_with", "d", ["Alice"]),
            ("matches_regex", "^$", []),
        ],
    )
    async def test_a_null_text_cell(self, operator: str, reference: str, kept: list[str]) -> None:
        block = filter_block(
            by_name("team"), "string", [literal_row(operator, reference, "string")]
        )

        assert await _parse_kept_names("name,team\nAlice,red\nBob,\nCarol,blue\n", block) == kept

    @pytest.mark.parametrize(
        ("operator", "kept"),
        [("is_true", ["Alice"]), ("is_false", ["Carol"])],
    )
    async def test_a_null_boolean_cell(self, operator: str, kept: list[str]) -> None:
        block = filter_block(by_name("active"), "boolean", [literal_row(operator, "", "boolean")])

        csv_content = "name,active\nAlice,true\nBob,\nCarol,false\n"
        assert await _parse_kept_names(csv_content, block) == kept

    @pytest.mark.parametrize(
        ("operator", "kept"), [("is_null", ["Bob"]), ("is_not_null", ["Alice"])]
    )
    @pytest.mark.parametrize(
        ("as_type", "held"),
        [("integer", "1"), ("float", "1.5"), ("string", "x"), ("boolean", "true")],
    )
    async def test_is_null_and_is_not_null_on_every_column_type(
        self, as_type: str, held: str, operator: str, kept: list[str]
    ) -> None:
        block = filter_block(by_name("v"), as_type, [literal_row(operator, "", as_type)])

        assert await _parse_kept_names(f"name,v\nAlice,{held}\nBob,\n", block) == kept


# =============================================================================
# Parse - output shape
# =============================================================================


class TestCSVParserPluginParseOutput:
    """The Parse output dict contract."""

    async def test_parse_output_keys(self) -> None:
        ctx = make_context({"operation": "parse", "csv_content": "a\n1\n"})
        result = await CSVParserPlugin().execute(ctx)

        assert set(result) == {"table", "row_count", "schema", "success", "errors"}


# =============================================================================
# Serialize
# =============================================================================


class TestCSVParserPluginSerialize:
    """Serialize operation: table -> CSV text with header/delimiter controls."""

    async def test_serialize_round_trip_with_header(self) -> None:
        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, "Alice"])
        table.add_row([2, "Bob"])
        ctx = make_context({"operation": "serialize", "table": table})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "id,name\n1,Alice\n2,Bob\n"
        assert result["success"] is True
        assert result["errors"] == []

    async def test_serialize_without_header(self) -> None:
        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, "Alice"])
        table.add_row([2, "Bob"])
        ctx = make_context({"operation": "serialize", "table": table, "has_header": False})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "1,Alice\n2,Bob\n"

    async def test_serialize_none_cell_is_empty_field(self) -> None:
        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, None])
        ctx = make_context({"operation": "serialize", "table": table})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "id,name\n1,\n"

    async def test_serialize_custom_delimiter(self) -> None:
        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, "Alice"])
        ctx = make_context({"operation": "serialize", "table": table, "delimiter": "\t"})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "id\tname\n1\tAlice\n"

    async def test_serialize_boolean_cells(self) -> None:
        table = Table(columns=[("active", "boolean")])
        table.add_row([True])
        table.add_row([False])
        ctx = make_context({"operation": "serialize", "table": table})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "active\ntrue\nfalse\n"

    async def test_serialize_float_cell_renders_plain_decimal(self) -> None:
        table = Table(columns=[("price", "float")])
        table.add_row([Decimal("19.99")])
        ctx = make_context({"operation": "serialize", "table": table})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "price\n19.99\n"

    async def test_serialize_applies_declarative_sort(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        table.add_row(["Alice", 80])
        table.add_row(["Bob", 95])
        table.add_row(["Carol", 70])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "sorts": [sort_key(by_name("score"), "desc")],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nBob,95\nAlice,80\nCarol,70\n"

    async def test_serialize_applies_filter(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        table.add_row(["Alice", 80])
        table.add_row(["Bob", 95])
        table.add_row(["Carol", 70])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "filters": [
                    filter_block(by_name("score"), "integer", [literal_row("greater_than", "75")])
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nAlice,80\nBob,95\n"

    async def test_serialize_transforms_do_not_mutate_the_source_table(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        table.add_row(["Alice", 80])
        table.add_row(["Bob", 95])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "sorts": [sort_key(by_name("score"), "desc")],
            }
        )

        await CSVParserPlugin().execute(ctx)

        assert table.col("name") == ["Alice", "Bob"]

    async def test_serialize_applies_sorts_and_filters_together(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        for name, score in [("Alice", 80), ("Bob", 95), ("Carol", 70), ("Dave", 88)]:
            table.add_row([name, score])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "sorts": [sort_key(by_name("score"), "desc")],
                "filters": [
                    filter_block(by_name("score"), "integer", [literal_row("greater_than", "75")])
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nBob,95\nDave,88\nAlice,80\n"

    async def test_serialize_applies_a_multi_key_sort(self) -> None:
        table = Table(columns=[("region", "string"), ("amount", "integer")])
        for region, amount in [("west", 10), ("east", 20), ("west", 30), ("east", 5)]:
            table.add_row([region, amount])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "sorts": [
                    sort_key(by_name("region"), "asc", "csv-sort-1"),
                    sort_key(by_name("amount"), "desc", "csv-sort-2"),
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "region,amount\neast,20\neast,5\nwest,30\nwest,10\n"

    async def test_serialize_applies_two_filter_blocks_conjunctively(self) -> None:
        table = Table(columns=[("region", "string"), ("amount", "integer")])
        for region, amount in [("west", 10), ("east", 20), ("west", 30)]:
            table.add_row([region, amount])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "filters": [
                    filter_block(
                        by_name("region"),
                        "string",
                        [literal_row("equals", "west", "string")],
                        "csv-filter-1",
                    ),
                    filter_block(
                        by_name("amount"),
                        "integer",
                        [literal_row("greater_than", "20")],
                        "csv-filter-2",
                    ),
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "region,amount\nwest,30\n"

    async def test_serialize_shapes_a_stored_form_table(self) -> None:
        ctx = make_context(
            {
                "operation": "serialize",
                "table": [{"sku": "B", "qty": 7}, {"sku": "A", "qty": 3}],
                "sorts": [sort_key(by_name("sku"), "asc")],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "sku,qty\nA,3\nB,7\n"

    async def test_serialize_filter_resolves_a_variable_in_its_condition(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        table.add_row(["Alice", 80])
        table.add_row(["Carol", 70])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "filters": [
                    filter_block(
                        by_name("score"),
                        "integer",
                        [literal_row("greater_than", "cutoff", is_expression=True)],
                    )
                ],
            }
        )
        ctx["variables"] = {"cutoff": 75}

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nAlice,80\n"

    async def test_serialize_table_wrong_type(self) -> None:
        ctx = make_context({"operation": "serialize", "table": 123})

        with pytest.raises(TypeError, match="^Parameter 'table' must be a table, got int$"):
            await CSVParserPlugin().execute(ctx)

    async def test_serialize_output_keys(self) -> None:
        table = Table(columns=[("a", "string")])
        table.add_row(["x"])
        ctx = make_context({"operation": "serialize", "table": table})

        result = await CSVParserPlugin().execute(ctx)

        assert set(result) == {"csv_content", "success", "errors"}

    async def test_serialize_runs_a_filter_saved_by_the_config_window(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        for name, score in [("Alice", 80), ("Bob", 95), ("Carol", 70)]:
            table.add_row([name, score])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "filters": [
                    {
                        "id": "csv-filter-1",
                        "column": {"mode": "name", "value": "score"},
                        "asType": "integer",
                        "conditions": [
                            {
                                "id": "csv-filter-cond-1",
                                "type": "literal",
                                "variable": "_cell",
                                "value_type": "integer",
                                "operator": "greater_than",
                                "reference_value": "75",
                                "reference_is_expression": False,
                            }
                        ],
                    }
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nAlice,80\nBob,95\n"

    async def test_serialize_runs_a_sort_saved_by_the_config_window(self) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        for name, score in [("Alice", 80), ("Bob", 95), ("Carol", 70)]:
            table.add_row([name, score])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "sorts": [
                    {
                        "id": "csv-sort-1",
                        "column": {"mode": "name", "value": "score"},
                        "direction": "desc",
                    }
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "name,score\nBob,95\nAlice,80\nCarol,70\n"

    @pytest.mark.parametrize(
        ("operator", "reference", "expected"),
        [
            pytest.param("is_null", "", "name,score\nBob,\n", id="is_null"),
            pytest.param("not_equals", "80", "name,score\nBob,\nCarol,70\n", id="not_equals"),
        ],
    )
    async def test_serialize_keeps_a_null_cell_the_filter_row_holds_true_for(
        self, operator: str, reference: str, expected: str
    ) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        for name, score in [("Alice", 80), ("Bob", None), ("Carol", 70)]:
            table.add_row([name, score])
        ctx = make_context(
            {
                "operation": "serialize",
                "table": table,
                "filters": [
                    filter_block(by_name("score"), "integer", [literal_row(operator, reference)])
                ],
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == expected


# =============================================================================
# Lifecycle
# =============================================================================


class TestCSVParserPluginLifecycle:
    """initialize() / cleanup() lifecycle hooks are no-ops."""

    async def test_initialize_is_noop(self) -> None:
        assert await CSVParserPlugin().initialize(make_context({})) is None

    async def test_cleanup_is_noop(self) -> None:
        assert await CSVParserPlugin().cleanup() is None


# =============================================================================
# variable_ref input resolution (serialize table / schema_source)
# =============================================================================


class TestCSVParserVariableRefResolution:
    """The serialize `table` and schema `schema_source` inputs are variable_ref:
    a bare variable-name value resolves to the Table before execute(), through
    the same derive -> resolve pipeline the executor uses."""

    def test_metadata_marks_table_and_schema_source_as_reference(self) -> None:
        params = {p["name"]: p for p in CSVParserPlugin().metadata["parameters"]}
        assert params["table"].get("variable_ref") is True
        assert params["schema_source"].get("variable_ref") is True
        assert params["csv_content"].get("variable_ref", False) is False

    async def test_serialize_resolves_table_variable_and_runs(self) -> None:
        from wavecore.core.execution.plugin_executor import (
            derive_parameter_metadata,
            resolve_parameters,
        )

        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, "Alice"])
        ptypes, trim, refs, _ = derive_parameter_metadata(CSVParserPlugin().metadata["parameters"])
        resolved = resolve_parameters(
            {"operation": "serialize", "table": "seed_tab"},
            set(),
            {"seed_tab": table},
            ptypes,
            trim_fields=trim,
            reference_fields=refs,
        )
        result = await CSVParserPlugin().execute(make_context(resolved))

        assert result["csv_content"] == "id,name\n1,Alice\n"

    async def test_schema_source_resolves_variable_and_runs(self) -> None:
        from wavecore.core.execution.plugin_executor import (
            derive_parameter_metadata,
            resolve_parameters,
        )

        schema = Table(columns=[("id", "integer"), ("name", "string")])
        ptypes, trim, refs, _ = derive_parameter_metadata(CSVParserPlugin().metadata["parameters"])
        resolved = resolve_parameters(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,1\n",
                "column_types": "schema",
                "schema_source": "schema_tab",
            },
            set(),
            {"schema_tab": schema},
            ptypes,
            trim_fields=trim,
            reference_fields=refs,
        )
        result = await CSVParserPlugin().execute(make_context(resolved))
        table = result["table"]

        assert table.col_names() == ["id", "name"]
        assert table.cell(0, "id") == 1
        assert table.cell(0, "name") == "Alice"


# =============================================================================
# Stored-form table parameters
#
# A table parameter receives either runtime form: a Table produced upstream by
# a converter, or the stored form of a variable declared in the Variable
# Manager (a list of row maps, or a {columns, rows} dict).
# =============================================================================


class TestCSVParserStoredFormTable:
    """Serialize accepts either runtime form of its table parameter."""

    @staticmethod
    def _people() -> Table:
        table = Table(columns=[("id", "integer"), ("name", "string")])
        table.add_row([1, "Alice"])
        table.add_row([2, "Bob"])
        return table

    async def test_serialize_accepts_stored_list_form(self) -> None:
        ctx = make_context({"operation": "serialize", "table": self._people().to_list()})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "id,name\n1,Alice\n2,Bob\n"
        assert result["success"] is True

    async def test_serialize_accepts_stored_dict_form(self) -> None:
        ctx = make_context({"operation": "serialize", "table": self._people().to_dict()})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "id,name\n1,Alice\n2,Bob\n"

    async def test_stored_and_live_forms_serialize_identically(self) -> None:
        live = await CSVParserPlugin().execute(
            make_context({"operation": "serialize", "table": self._people()})
        )
        stored = await CSVParserPlugin().execute(
            make_context({"operation": "serialize", "table": self._people().to_list()})
        )

        assert stored["csv_content"] == live["csv_content"]

    async def test_serialize_stored_form_honors_has_header(self) -> None:
        ctx = make_context(
            {
                "operation": "serialize",
                "table": self._people().to_list(),
                "has_header": False,
            }
        )

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "1,Alice\n2,Bob\n"

    async def test_serialize_empty_stored_list_writes_an_empty_header(self) -> None:
        """An empty stored table has no columns - a bare header line, no rows."""
        ctx = make_context({"operation": "serialize", "table": []})

        result = await CSVParserPlugin().execute(ctx)

        assert result["csv_content"] == "\n"
        assert result["success"] is True

    async def test_serialize_string_still_rejected_with_exact_message(self) -> None:
        ctx = make_context({"operation": "serialize", "table": "id,name"})

        with pytest.raises(TypeError, match="^Parameter 'table' must be a table, got str$"):
            await CSVParserPlugin().execute(ctx)

    async def test_serialize_array_of_scalars_rejected_with_exact_message(self) -> None:
        ctx = make_context({"operation": "serialize", "table": [1, 2, 3]})

        with pytest.raises(TypeError, match="^Parameter 'table' must be a table, got list$"):
            await CSVParserPlugin().execute(ctx)

    async def test_serialize_integer_rejected_with_exact_message(self) -> None:
        ctx = make_context({"operation": "serialize", "table": 42})

        with pytest.raises(TypeError, match="^Parameter 'table' must be a table, got int$"):
            await CSVParserPlugin().execute(ctx)


class TestCSVParserStoredFormSchemaSource:
    """Schema mode accepts either runtime form of its schema source."""

    @staticmethod
    def _schema() -> Table:
        return Table(columns=[("id", "integer"), ("name", "string")])

    async def test_schema_source_accepts_stored_dict_form(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,1\n",
                "column_types": "schema",
                "schema_source": self._schema().to_dict(),
            }
        )

        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["id", "name"]
        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "id") == 1

    async def test_schema_source_accepts_stored_list_form(self) -> None:
        """A schema declared as rows infers its column names and types."""
        schema_rows = [{"id": 1, "name": "sample"}]
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,7\n",
                "column_types": "schema",
                "schema_source": schema_rows,
            }
        )

        result = await CSVParserPlugin().execute(ctx)
        table = result["table"]

        assert table.col_names() == ["id", "name"]
        assert table.col_types() == ["integer", "string"]
        assert table.cell(0, "id") == 7
        assert table.cell(0, "name") == "Alice"

    async def test_stored_and_live_schema_sources_produce_the_same_table(self) -> None:
        params = {
            "operation": "parse",
            "csv_content": "name,id\nAlice,1\nBob,2\n",
            "column_types": "schema",
        }
        live = await CSVParserPlugin().execute(
            make_context({**params, "schema_source": self._schema()})
        )
        stored = await CSVParserPlugin().execute(
            make_context({**params, "schema_source": self._schema().to_dict()})
        )

        assert stored["table"].to_list() == live["table"].to_list()
        assert stored["schema"] == live["schema"]

    async def test_schema_source_string_rejected_with_exact_message(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,1\n",
                "column_types": "schema",
                "schema_source": "schema_tab",
            }
        )

        with pytest.raises(TypeError, match="^Parameter 'schema_source' must be a table, got str$"):
            await CSVParserPlugin().execute(ctx)

    async def test_schema_source_array_of_scalars_rejected_with_exact_message(self) -> None:
        ctx = make_context(
            {
                "operation": "parse",
                "csv_content": "name,id\nAlice,1\n",
                "column_types": "schema",
                "schema_source": ["id", "name"],
            }
        )

        with pytest.raises(
            TypeError, match="^Parameter 'schema_source' must be a table, got list$"
        ):
            await CSVParserPlugin().execute(ctx)


# =============================================================================
# Null entries
# =============================================================================


SCORES = "name,score\nAlice,80\nBob,95\n"
SCORE_SORT = sort_key(by_name("score"), "desc")
SCORE_FILTER = filter_block(by_name("score"), "integer", [literal_row("greater_than", "75")])


class TestCSVParserPluginNullEntries:
    """A sort key and a filter block are records: a null one fails naming its row
    (REQ-3.1.3.21)."""

    @pytest.mark.parametrize(
        ("setting", "entries", "row"),
        [
            pytest.param("sorts", [None], 1, id="sorts-first-row"),
            pytest.param("sorts", [SCORE_SORT, None], 2, id="sorts-second-row"),
            pytest.param("filters", [None], 1, id="filters-first-row"),
            pytest.param("filters", [SCORE_FILTER, None], 2, id="filters-second-row"),
        ],
    )
    async def test_parse_refuses_a_null_entry_by_its_row(
        self, setting: str, entries: list[Any], row: int
    ) -> None:
        ctx = make_context({"operation": "parse", "csv_content": SCORES, setting: entries})

        with pytest.raises(NullValueError, match=rf"^Row {row} in '{setting}' is null$"):
            await CSVParserPlugin().execute(ctx)

    @pytest.mark.parametrize("setting", ["sorts", "filters"])
    async def test_serialize_refuses_a_null_entry_by_its_row(self, setting: str) -> None:
        table = Table(columns=[("name", "string"), ("score", "integer")])
        table.add_row(["Alice", 80])
        ctx = make_context({"operation": "serialize", "table": table, setting: [None]})

        with pytest.raises(NullValueError, match=rf"^Row 1 in '{setting}' is null$"):
            await CSVParserPlugin().execute(ctx)
