"""
Tests for the Excel Parser plugin (REQ-3.4.1.13, REQ-3.4.3.1, REQ-3.4.3.2,
REQ-3.4.3.3).

The plugin converts between spreadsheet workbooks and WAVE's table type:
Read (workbook -> table) and Write (table -> workbook). Unlike the text
parsers it owns its file access, resolving a workbook path through the shared
plugin path resolver.

The read fixtures were authored by LibreOffice Calc, not by our own writer -
see fixtures/README.md. Reading a workbook we produced could only prove we read
back what we emit; these carry a shared-string table, cached formula results,
one formula with no cached result, an error value, serial-encoded dates, and a
merged title.
"""

import re
import shutil
import zipfile
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from wavecore.core.expressions.errors import NullValueError
from wavecore.core.table import Table
from wavecore.plugins import excel_parser as excel_module
from wavecore.plugins.excel_parser import ExcelParserPlugin

FIXTURES = Path(__file__).parent / "fixtures"
SAMPLE = FIXTURES / "sample_workbook.xlsx"
MACRO_BOOK = FIXTURES / "macro_book.xlsm"

SHEET_NAMES = ["People", "Offset", "Formulas", "Dates", "Empty"]

UNCOMPUTED_FORMULA_ERROR = (
    "formula has no stored result - open and save the workbook in a spreadsheet application"
)


def make_context(params: dict[str, Any], **extra: Any) -> dict[str, Any]:
    """Build an execution context dict (mirrors the plugin harness)."""
    context: dict[str, Any] = {"parameters": params, "variables": {}}
    context.update(extra)
    return context


def read_sample(**params: Any) -> dict[str, Any]:
    """Read the checked-in sample workbook with the given extra parameters."""
    return {"operation": "read", "workbook": str(SAMPLE), **params}


def exact(message: str) -> str:
    """Anchored, regex-escaped matcher for an exact error message."""
    return f"^{re.escape(message)}$"


def rows_of(result: dict[str, Any]) -> list[dict[str, Any]]:
    """Read the returned table as a list of row maps."""
    table = result["table"]
    assert isinstance(table, Table)
    return table.to_list()


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


class TestExcelParserMetadata:
    """Metadata descriptor: identity, parameter contract, outputs."""

    def test_core_fields(self) -> None:
        meta = ExcelParserPlugin().metadata

        assert meta["id"] == "excel-parser"
        assert meta["name"] == "Excel Parser"
        assert meta["version"] == "1.0.0"
        assert meta["category"] == "data"
        assert meta["return_type"] == "map"

    def test_parameter_order(self) -> None:
        names = [p["name"] for p in ExcelParserPlugin().metadata["parameters"]]

        assert names == [
            "operation",
            "workbook",
            "sheet",
            "range",
            "has_header",
            "header_row",
            "column_types",
            "schema_source",
            "empty_cells",
            "on_mismatch",
            "sorts",
            "filters",
            "table",
            "write_header",
            "start_cell",
            "if_exists",
        ]

    @pytest.mark.parametrize(
        ("name", "ptype", "required", "default"),
        [
            ("operation", "string", False, "read"),
            ("workbook", "string", True, None),
            ("sheet", "string", False, None),
            ("range", "string", False, None),
            ("has_header", "boolean", False, True),
            ("header_row", "integer", False, 1),
            ("column_types", "string", False, "auto"),
            ("schema_source", "table", False, None),
            ("empty_cells", "string", False, "none"),
            ("on_mismatch", "string", False, "fail"),
            ("sorts", "array", False, None),
            ("filters", "array", False, None),
            ("table", "table", False, None),
            ("write_header", "boolean", False, True),
            ("start_cell", "string", False, "A1"),
            ("if_exists", "string", False, "keep_sheets"),
        ],
    )
    def test_parameter_type_required_and_default(
        self, name: str, ptype: str, required: bool, default: Any
    ) -> None:
        params = {p["name"]: p for p in ExcelParserPlugin().metadata["parameters"]}
        param = params[name]

        assert param["type"] == ptype
        assert param["required"] is required
        assert param.get("default") == default

    @pytest.mark.parametrize(
        ("name", "values"),
        [
            ("operation", ["read", "write"]),
            ("column_types", ["auto", "string", "schema"]),
            ("empty_cells", ["none", "default"]),
            ("on_mismatch", ["fail", "skip_row", "replace_default"]),
            ("if_exists", ["keep_sheets", "replace_file"]),
        ],
    )
    def test_enum_values(self, name: str, values: list[str]) -> None:
        params = {p["name"]: p for p in ExcelParserPlugin().metadata["parameters"]}

        assert params[name]["enum_values"] == values

    @pytest.mark.parametrize("name", ["schema_source", "table"])
    def test_table_parameters_are_variable_references(self, name: str) -> None:
        params = {p["name"]: p for p in ExcelParserPlugin().metadata["parameters"]}

        assert params[name]["variable_ref"] is True

    def test_output_schema(self) -> None:
        outputs = ExcelParserPlugin().metadata["output_schema"]

        assert [(o["name"], o["type"]) for o in outputs] == [
            ("table", "table"),
            ("row_count", "integer"),
            ("schema", "array"),
            ("sheets", "array"),
            ("file", "string"),
            ("success", "boolean"),
            ("errors", "array"),
        ]


# =============================================================================
# Validation (exact messages)
# =============================================================================


class TestExcelParserValidation:
    """Every rejection path, with its exact message."""

    async def test_missing_operation(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: operation")):
            await ExcelParserPlugin().validate({"workbook": str(SAMPLE)})

    async def test_operation_not_a_string(self) -> None:
        with pytest.raises(
            TypeError, match=exact("Parameter 'operation' must be a string, got int")
        ):
            await ExcelParserPlugin().validate({"operation": 1, "workbook": str(SAMPLE)})

    async def test_operation_not_read_or_write(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Invalid operation: 'parse'. Supported operations: read, write"),
        ):
            await ExcelParserPlugin().validate({"operation": "parse", "workbook": str(SAMPLE)})

    async def test_missing_workbook(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: workbook")):
            await ExcelParserPlugin().validate({"operation": "read"})

    async def test_workbook_not_a_string(self) -> None:
        with pytest.raises(
            TypeError, match=exact("Parameter 'workbook' must be a string, got int")
        ):
            await ExcelParserPlugin().validate({"operation": "read", "workbook": 7})

    async def test_invalid_column_types(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Parameter 'column_types' must be one of: auto, string, schema"),
        ):
            await ExcelParserPlugin().validate(
                read_sample(column_types="guess"),
            )

    async def test_schema_mode_without_schema_source(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Column types 'schema' requires a schema table in 'schema_source'"),
        ):
            await ExcelParserPlugin().validate(read_sample(column_types="schema"))

    async def test_invalid_empty_cells(self) -> None:
        with pytest.raises(
            ValueError, match=exact("Parameter 'empty_cells' must be one of: none, default")
        ):
            await ExcelParserPlugin().validate(read_sample(empty_cells="blank"))

    async def test_invalid_on_mismatch(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Parameter 'on_mismatch' must be one of: fail, skip_row, replace_default"),
        ):
            await ExcelParserPlugin().validate(read_sample(on_mismatch="ignore"))

    @pytest.mark.parametrize("header_row", [0, -1])
    async def test_header_row_below_one(self, header_row: int) -> None:
        with pytest.raises(ValueError, match=exact("Parameter 'header_row' must be 1 or greater")):
            await ExcelParserPlugin().validate(read_sample(header_row=header_row))

    @pytest.mark.parametrize("bad_range", ["A1", "1:5", "A1-F200", "hello", "A1:", ":F200"])
    async def test_invalid_range(self, bad_range: str) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Parameter 'range' must be a cell range in A1 notation, e.g. A1:F200"),
        ):
            await ExcelParserPlugin().validate(read_sample(**{"range": bad_range}))

    @pytest.mark.parametrize("good_range", ["A1:F200", "a1:f200", "B3:D6", "AA10:AB20"])
    async def test_valid_range_accepted(self, good_range: str) -> None:
        await ExcelParserPlugin().validate(read_sample(**{"range": good_range}))

    @pytest.mark.parametrize("bad_cell", ["A1:B2", "1A", "hello", "", "A"])
    async def test_invalid_start_cell(self, bad_cell: str) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Parameter 'start_cell' must be a single cell in A1 notation, e.g. A1"),
        ):
            await ExcelParserPlugin().validate(
                {
                    "operation": "write",
                    "workbook": str(SAMPLE),
                    "table": Table(),
                    "start_cell": bad_cell,
                }
            )

    @pytest.mark.parametrize("good_cell", ["A1", "b3", "AA10"])
    async def test_valid_start_cell_accepted(self, good_cell: str) -> None:
        await ExcelParserPlugin().validate(
            {
                "operation": "write",
                "workbook": str(SAMPLE),
                "table": Table(),
                "start_cell": good_cell,
            }
        )

    async def test_invalid_if_exists(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Parameter 'if_exists' must be one of: keep_sheets, replace_file"),
        ):
            await ExcelParserPlugin().validate(
                {
                    "operation": "write",
                    "workbook": str(SAMPLE),
                    "table": Table(),
                    "if_exists": "append",
                }
            )

    async def test_write_without_table(self) -> None:
        with pytest.raises(ValueError, match=exact("Missing required parameter: table")):
            await ExcelParserPlugin().validate({"operation": "write", "workbook": str(SAMPLE)})

    @pytest.mark.parametrize(
        ("value", "type_name"),
        [("orders", "str"), (42, "int"), ([1, 2, 3], "list"), ({"a": 1}, "dict")],
    )
    async def test_write_table_not_table_shaped(self, value: Any, type_name: str) -> None:
        with pytest.raises(
            TypeError, match=exact(f"Parameter 'table' must be a table, got {type_name}")
        ):
            await ExcelParserPlugin().validate(
                {"operation": "write", "workbook": str(SAMPLE), "table": value}
            )

    @pytest.mark.parametrize(
        ("value", "type_name"), [("schema_tab", "str"), (7, "int"), (["a", "b"], "list")]
    )
    async def test_schema_source_not_table_shaped(self, value: Any, type_name: str) -> None:
        with pytest.raises(
            TypeError,
            match=exact(f"Parameter 'schema_source' must be a table, got {type_name}"),
        ):
            await ExcelParserPlugin().validate(
                read_sample(column_types="schema", schema_source=value)
            )

    async def test_read_accepts_a_stored_form_schema_source(self) -> None:
        """A schema table declared in the Variable Manager is table-shaped."""
        schema = Table(columns=[("name", "string")]).to_dict()

        await ExcelParserPlugin().validate(read_sample(column_types="schema", schema_source=schema))

    async def test_write_accepts_a_stored_form_table(self) -> None:
        await ExcelParserPlugin().validate(
            {"operation": "write", "workbook": str(SAMPLE), "table": [{"a": 1}]}
        )

    @pytest.mark.parametrize(
        ("workbook", "name"),
        [
            ("/data/legacy.xls", "legacy.xls"),
            ("artifact://reports/legacy.XLS", "legacy.XLS"),
            ("/data/export.csv", "export.csv"),
            ("/data/book", "book"),
            ("testdata://sheet.ods", "sheet.ods"),
        ],
    )
    async def test_unsupported_format_rejected(self, workbook: str, name: str) -> None:
        with pytest.raises(
            ValueError,
            match=exact(
                f"Unsupported workbook format: {name}. "
                "Excel supports .xlsx and .xlsm - save the file as .xlsx"
            ),
        ):
            await ExcelParserPlugin().validate({"operation": "read", "workbook": workbook})

    @pytest.mark.parametrize(
        "workbook",
        [
            "/data/book.xlsx",
            "/data/book.XLSX",
            "/data/book.xlsm",
            "/data/book.XlsM",
            "artifact://out.xlsx",
        ],
    )
    async def test_supported_formats_accepted(self, workbook: str) -> None:
        await ExcelParserPlugin().validate({"operation": "read", "workbook": workbook})

    async def test_default_operation_is_read(self) -> None:
        """Read is the default, so a bare workbook validates."""
        await ExcelParserPlugin().validate({"operation": "read", "workbook": str(SAMPLE)})


# =============================================================================
# Read: shape of the result
# =============================================================================


class TestExcelParserReadResult:
    """The Read outputs: table, row_count, schema, sheets, success, errors."""

    async def test_reads_the_first_sheet_by_default(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["table"].col_names() == ["name", "age", "score", "active", "notes"]

    async def test_row_count(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["row_count"] == 3

    async def test_schema_is_name_and_type_pairs(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["schema"] == [
            {"name": "name", "type": "string"},
            {"name": "age", "type": "integer"},
            {"name": "score", "type": "float"},
            {"name": "active", "type": "boolean"},
            {"name": "notes", "type": "string"},
        ]

    async def test_sheets_lists_every_sheet_in_workbook_order(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["sheets"] == SHEET_NAMES

    async def test_success_and_no_errors_on_a_clean_read(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["success"] is True
        assert result["errors"] == []

    async def test_read_returns_no_file_output(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert "file" not in result

    async def test_reads_a_macro_enabled_workbook(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(MACRO_BOOK)})
        )

        assert result["sheets"] == ["Inventory"]
        assert rows_of(result) == [{"part": "bolt", "count": 12}, {"part": "nut", "count": 34}]


# =============================================================================
# Read: automatic column typing
# =============================================================================


class TestExcelParserAutoTyping:
    """Auto typing maps each cell's stored type and widens a mixed column."""

    async def test_column_types(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["table"].col_types() == [
            "string",
            "integer",
            "float",
            "boolean",
            "string",
        ]

    async def test_rows(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert rows_of(result) == [
            {
                "name": "Ada",
                "age": 36,
                "score": Decimal("91.5"),
                "active": True,
                "notes": None,
            },
            {
                "name": "Grace",
                "age": 45,
                "score": Decimal("88.25"),
                "active": False,
                "notes": None,
            },
            {
                "name": "Linus",
                "age": 29,
                "score": Decimal("77"),
                "active": True,
                "notes": None,
            },
        ]

    async def test_whole_numbers_are_integers(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert all(isinstance(value, int) for value in result["table"].col("age"))

    async def test_fractional_numbers_are_exact_decimals_never_binary_floats(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B3:D6"}))
        )

        prices = result["table"].col("price")
        assert all(isinstance(value, Decimal) for value in prices)
        assert prices == [Decimal("9.99"), Decimal("14.5"), Decimal("3")]

    async def test_mixed_whole_and_fractional_column_widens_to_float(self) -> None:
        """score holds 91.5, 88.25 and 77 - every cell arrives as a Decimal."""
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        scores = result["table"].col("score")
        assert all(isinstance(value, Decimal) for value in scores)

    async def test_entirely_empty_column_resolves_to_text(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["schema"][4] == {"name": "notes", "type": "string"}
        assert result["table"].col("notes") == [None, None, None]

    async def test_booleans_stay_boolean(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["table"].col("active") == [True, False, True]

    async def test_empty_cell_inside_a_number_column_is_missing(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B3:D6"}))
        )

        assert result["table"].col("qty") == [3, 7, None]
        assert result["table"].col_types()[1] == "integer"


# =============================================================================
# Read: dates and times
# =============================================================================


class TestExcelParserDatesAndTimes:
    """Dates, date-times and times become ISO 8601 text - WAVE has no date type."""

    async def test_date_columns_are_text(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Dates")))

        assert result["table"].col_types() == ["string", "string", "string"]

    async def test_iso_8601_values(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Dates")))

        assert rows_of(result) == [
            {
                "joined": "2024-01-15T00:00:00",
                "last_seen": "2024-03-01T09:30:00",
                "shift": "14:30:00",
            },
            {
                "joined": "2023-11-02T00:00:00",
                "last_seen": "2023-12-24T18:05:30",
                "shift": "06:00:00",
            },
        ]


# =============================================================================
# Read: formulas and error values
# =============================================================================


class TestExcelParserFormulas:
    """A formula reads as its stored result; a missing result is reported."""

    async def test_computed_formula_reads_its_result(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["table"].col("doubled")[:2] == [20, 42]

    async def test_uncomputed_formula_is_reported_not_returned_as_empty(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["errors"] == [
            {"row": 2, "column": "doubled", "error": UNCOMPUTED_FORMULA_ERROR}
        ]

    async def test_uncomputed_formula_fails_the_operation(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["success"] is False

    async def test_uncomputed_formula_cell_is_missing(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["table"].col("doubled")[2] is None

    async def test_rows_are_still_returned(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["row_count"] == 3

    async def test_error_value_reads_as_its_displayed_text(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert result["table"].col("broken") == ["#DIV/0!", None, None]
        assert result["table"].col_types()[3] == "string"

    async def test_error_value_is_not_an_errors_entry(self) -> None:
        """A cell whose value IS an error is data, not a read failure."""
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Formulas")))

        assert [e["column"] for e in result["errors"]] == ["doubled"]


# =============================================================================
# Read: sheet selection
# =============================================================================


class TestExcelParserSheetSelection:
    """A sheet is chosen by name or by 1-based position; blank reads the first."""

    async def test_blank_sheet_reads_the_first(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="")))

        assert result["table"].col_names()[0] == "name"

    async def test_sheet_by_name(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Dates")))

        assert result["table"].col_names() == ["joined", "last_seen", "shift"]

    async def test_sheet_by_position(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="2", header_row=3, **{"range": "B3:D6"}))
        )

        assert result["table"].col_names() == ["sku", "qty", "price"]

    async def test_first_position_is_one_not_zero(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="1")))

        assert result["table"].col_names()[0] == "name"

    async def test_unknown_sheet_name_lists_the_available_sheets(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact(
                "Sheet not found: Ghost. Available sheets: People, Offset, Formulas, "
                "Dates, Empty"
            ),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample(sheet="Ghost")))

    async def test_position_beyond_the_last_sheet(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Sheet position 9 is out of range - the workbook has 5 sheet(s)"),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample(sheet="9")))

    async def test_position_zero_is_out_of_range(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Sheet position 0 is out of range - the workbook has 5 sheet(s)"),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample(sheet="0")))

    async def test_empty_sheet_yields_no_rows(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(sheet="Empty")))

        assert result["row_count"] == 0
        assert result["success"] is True


# =============================================================================
# Read: range and header row
# =============================================================================


class TestExcelParserRangeAndHeaderRow:
    """The range restricts the read; the header row is addressed independently."""

    async def test_range_restricts_columns_and_rows(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B3:D6"}))
        )

        assert result["table"].col_names() == ["sku", "qty", "price"]
        assert result["row_count"] == 3

    async def test_range_rows(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B3:D6"}))
        )

        assert rows_of(result) == [
            {"sku": "A-1", "qty": 3, "price": Decimal("9.99")},
            {"sku": "B-2", "qty": 7, "price": Decimal("14.5")},
            {"sku": "C-3", "qty": None, "price": Decimal("3")},
        ]

    async def test_single_data_row_still_names_its_columns(self) -> None:
        """The loop-then-read-row-N pattern: one row, columns from the header above."""
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B5:D5"}))
        )

        assert rows_of(result) == [{"sku": "B-2", "qty": 7, "price": Decimal("14.5")}]

    async def test_range_is_case_insensitive(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "b3:d6"}))
        )

        assert result["table"].col_names() == ["sku", "qty", "price"]

    async def test_header_row_above_the_range_is_still_used(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B4:D6"}))
        )

        assert result["table"].col_names() == ["sku", "qty", "price"]
        assert result["row_count"] == 3

    async def test_rows_above_the_header_row_are_not_data(self) -> None:
        """Without a range the read starts below the header, not at row 1."""
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3))
        )

        assert result["row_count"] == 3
        assert result["table"].col("sku") == ["A-1", "B-2", "C-3"]

    async def test_empty_header_cell_falls_back_to_its_column_letter(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3))
        )

        assert result["table"].col_names() == ["A", "sku", "qty", "price"]

    async def test_merged_title_belongs_to_its_top_left_cell(self) -> None:
        """The covered cells of a merge read as empty."""
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", has_header=False, **{"range": "A1:D1"}))
        )

        assert rows_of(result) == [{"A": "Quarterly Report", "B": None, "C": None, "D": None}]

    async def test_range_outside_the_used_area(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact("Range Z90:AA95 is outside the sheet's data (used area A1:E4)"),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample(**{"range": "Z90:AA95"})))

    async def test_range_extending_past_the_used_area_reads_empty_cells(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(**{"range": "A1:G4"})))

        assert result["table"].col_names() == [
            "name",
            "age",
            "score",
            "active",
            "notes",
            "F",
            "G",
        ]
        assert result["table"].col("G") == [None, None, None]

    async def test_header_row_outside_the_sheet(self) -> None:
        with pytest.raises(
            ValueError, match=exact("Header row 99 is outside the sheet (rows 1-4)")
        ):
            await ExcelParserPlugin().execute(make_context(read_sample(header_row=99)))


# =============================================================================
# Read: no header row
# =============================================================================


class TestExcelParserNoHeader:
    """Without a header row, columns take their spreadsheet letters."""

    async def test_columns_are_spreadsheet_letters(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(has_header=False)))

        assert result["table"].col_names() == ["A", "B", "C", "D", "E"]

    async def test_the_header_row_becomes_data(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(has_header=False)))

        assert result["row_count"] == 4
        assert result["table"].col("A") == ["name", "Ada", "Grace", "Linus"]

    async def test_a_mixed_column_widens_to_text(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(has_header=False)))

        assert result["table"].col_types() == ["string"] * 5

    async def test_letters_follow_the_ranges_own_columns(self) -> None:
        """The user is looking at the same sheet, where the column is called B."""
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", has_header=False, **{"range": "B4:D6"}))
        )

        assert result["table"].col_names() == ["B", "C", "D"]
        assert result["row_count"] == 3

    async def test_header_row_is_ignored_without_a_header(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(has_header=False, header_row=3))
        )

        assert result["table"].col_names() == ["A", "B", "C", "D", "E"]
        assert result["row_count"] == 4


# =============================================================================
# Read: text mode
# =============================================================================


class TestExcelParserStringMode:
    """column_types='string' keeps every column text, as the sheet displays it."""

    async def test_every_column_is_text(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(column_types="string")))

        assert result["table"].col_types() == ["string"] * 5

    async def test_rendered_values(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(column_types="string")))

        assert rows_of(result) == [
            {"name": "Ada", "age": "36", "score": "91.5", "active": "TRUE", "notes": None},
            {
                "name": "Grace",
                "age": "45",
                "score": "88.25",
                "active": "FALSE",
                "notes": None,
            },
            {"name": "Linus", "age": "29", "score": "77", "active": "TRUE", "notes": None},
        ]

    async def test_dates_are_still_iso_8601(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Dates", column_types="string"))
        )

        assert result["table"].col("joined") == ["2024-01-15T00:00:00", "2023-11-02T00:00:00"]


# =============================================================================
# Read: schema mode and the mismatch policy
# =============================================================================


class TestExcelParserSchemaMode:
    """column_types='schema' conforms the read data to a supplied table."""

    @staticmethod
    def _schema(*columns: tuple[str, str]) -> Table:
        return Table(columns=list(columns))

    async def test_maps_by_header_name(self) -> None:
        schema = self._schema(("age", "integer"), ("name", "string"))

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(column_types="schema", schema_source=schema))
        )

        assert result["table"].col_names() == ["age", "name"]
        assert result["table"].col_types() == ["integer", "string"]

    async def test_columns_outside_the_schema_are_dropped(self) -> None:
        schema = self._schema(("name", "string"))

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(column_types="schema", schema_source=schema))
        )

        assert rows_of(result) == [{"name": "Ada"}, {"name": "Grace"}, {"name": "Linus"}]

    async def test_maps_by_position_without_a_header(self) -> None:
        schema = self._schema(("first", "string"), ("second", "string"))

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(has_header=False, column_types="schema", schema_source=schema))
        )

        assert result["table"].col_names() == ["first", "second"]
        assert result["table"].col("first")[0] == "name"

    async def test_accepts_a_stored_form_schema(self) -> None:
        schema = self._schema(("name", "string"), ("age", "integer")).to_dict()

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(column_types="schema", schema_source=schema))
        )

        assert result["table"].col_names() == ["name", "age"]
        assert result["table"].col_types() == ["string", "integer"]

    async def test_a_declared_type_that_fits_is_applied(self) -> None:
        schema = self._schema(("age", "string"))

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(column_types="schema", schema_source=schema))
        )

        assert result["table"].col("age") == ["36", "45", "29"]

    async def test_mismatch_fail_aborts_with_the_exact_message(self) -> None:
        schema = self._schema(("name", "integer"))

        with pytest.raises(
            ValueError,
            match=exact("Type mismatch in column 'name': 'Ada' is not a valid integer"),
        ):
            await ExcelParserPlugin().execute(
                make_context(
                    read_sample(column_types="schema", schema_source=schema, on_mismatch="fail")
                )
            )

    async def test_mismatch_fail_is_the_default(self) -> None:
        schema = self._schema(("name", "integer"))

        with pytest.raises(
            ValueError,
            match=exact("Type mismatch in column 'name': 'Ada' is not a valid integer"),
        ):
            await ExcelParserPlugin().execute(
                make_context(read_sample(column_types="schema", schema_source=schema))
            )

    async def test_mismatch_skip_row_drops_the_offending_rows(self) -> None:
        schema = self._schema(("name", "integer"))

        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(column_types="schema", schema_source=schema, on_mismatch="skip_row")
            )
        )

        assert result["row_count"] == 0
        assert result["success"] is False
        assert [e["row"] for e in result["errors"]] == [0, 1, 2]

    async def test_mismatch_replace_default_substitutes_the_type_default(self) -> None:
        schema = self._schema(("name", "integer"))

        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    column_types="schema",
                    schema_source=schema,
                    on_mismatch="replace_default",
                )
            )
        )

        assert result["table"].col("name") == [0, 0, 0]
        assert result["success"] is False

    async def test_mismatch_error_entries_name_the_cell(self) -> None:
        schema = self._schema(("name", "integer"))

        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    column_types="schema",
                    schema_source=schema,
                    on_mismatch="replace_default",
                )
            )
        )

        assert result["errors"][0] == {
            "row": 0,
            "column": "name",
            "error": "'Ada' is not a valid integer",
        }


# =============================================================================
# Read: empty-cell policy
# =============================================================================


class TestExcelParserEmptyCells:
    """An empty cell is missing by default, or the column type's default."""

    async def test_none_is_the_default_policy(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["table"].col("notes") == [None, None, None]

    async def test_default_policy_substitutes_the_type_default(self) -> None:
        result = await ExcelParserPlugin().execute(make_context(read_sample(empty_cells="default")))

        assert result["table"].col("notes") == ["", "", ""]

    async def test_default_policy_on_a_number_column(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    sheet="Offset",
                    header_row=3,
                    empty_cells="default",
                    **{"range": "B3:D6"},
                )
            )
        )

        assert result["table"].col("qty") == [3, 7, 0]


# =============================================================================
# Read: declarative transform
# =============================================================================


class TestExcelParserTransform:
    """Sorts and filters saved by the config window shape the read table (CSV-12)."""

    async def test_sort_descending(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sorts=[sort_key(by_name("age"), "desc")]))
        )

        assert result["table"].col("name") == ["Grace", "Ada", "Linus"]

    async def test_sort_ascending_is_the_default_direction(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sorts=[{"id": "csv-sort-1", "column": by_name("age")}]))
        )

        assert result["table"].col("name") == ["Linus", "Ada", "Grace"]

    async def test_read_runs_a_filter_saved_by_the_config_window(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    filters=[
                        {
                            "id": "csv-filter-1",
                            "column": {"mode": "name", "value": "age"},
                            "asType": "integer",
                            "conditions": [
                                {
                                    "id": "csv-filter-cond-1",
                                    "type": "literal",
                                    "variable": "_cell",
                                    "value_type": "integer",
                                    "operator": "greater_than",
                                    "reference_value": "30",
                                    "reference_is_expression": False,
                                }
                            ],
                        }
                    ]
                )
            )
        )

        assert result["table"].col("name") == ["Ada", "Grace"]
        assert result["row_count"] == 2

    async def test_filter_then_sort_are_both_applied(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    sorts=[sort_key(by_name("age"), "desc")],
                    filters=[
                        filter_block(by_name("age"), "integer", [literal_row("greater_than", "30")])
                    ],
                )
            )
        )

        assert result["table"].col("name") == ["Grace", "Ada"]

    async def test_row_count_reflects_the_transformed_table(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    filters=[
                        filter_block(
                            by_name("name"), "string", [literal_row("equals", "Ada", "string")]
                        )
                    ]
                )
            )
        )

        assert result["row_count"] == 1

    @pytest.mark.parametrize(
        ("operator", "reference", "kept"),
        [
            pytest.param("is_null", "", ["C-3"], id="is_null"),
            pytest.param("not_equals", "3", ["B-2", "C-3"], id="not_equals"),
        ],
    )
    async def test_read_keeps_a_null_cell_the_filter_row_holds_true_for(
        self, operator: str, reference: str, kept: list[str]
    ) -> None:
        """REQ-3.1.3.25: the Offset sheet's C-3 row has no qty."""
        result = await ExcelParserPlugin().execute(
            make_context(
                read_sample(
                    sheet="Offset",
                    header_row=3,
                    filters=[
                        filter_block(by_name("qty"), "integer", [literal_row(operator, reference)])
                    ],
                    **{"range": "B3:D6"},
                )
            )
        )

        assert result["table"].col("sku") == kept


# =============================================================================
# Read: path resolution
# =============================================================================


class TestExcelParserPathResolution:
    """The workbook path goes through the shared plugin path resolver."""

    async def test_artifact_scheme(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                {"operation": "read", "workbook": "artifact://sample_workbook.xlsx"},
                artifacts_dir=str(FIXTURES),
            )
        )

        assert result["sheets"] == SHEET_NAMES

    async def test_testdata_scheme(self) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                {"operation": "read", "workbook": "testdata://sample_workbook.xlsx"},
                testdata_dirs=[str(FIXTURES)],
            )
        )

        assert result["sheets"] == SHEET_NAMES

    async def test_an_artifact_beside_the_artifacts_folder_is_read(self, tmp_path) -> None:
        artifacts = tmp_path / "artifacts"
        artifacts.mkdir()
        shutil.copy(SAMPLE, tmp_path / "outside.xlsx")

        result = await ExcelParserPlugin().execute(
            make_context(
                {"operation": "read", "workbook": "artifact://../outside.xlsx"},
                artifacts_dir=str(artifacts),
            )
        )

        assert result["sheets"] == SHEET_NAMES

    async def test_a_relative_workbook_is_read_from_the_server_users_home(
        self, tmp_path, monkeypatch, server_home
    ) -> None:
        (server_home / "books").mkdir()
        shutil.copy(SAMPLE, server_home / "books" / "in.xlsx")
        monkeypatch.chdir(tmp_path)

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": "books/in.xlsx"})
        )

        assert result["sheets"] == SHEET_NAMES

    async def test_a_relative_workbook_is_written_under_the_server_users_home(
        self, tmp_path, monkeypatch, server_home
    ) -> None:
        monkeypatch.chdir(tmp_path)

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": "out.xlsx", "table": _people_table()})
        )

        assert result["file"] == str(server_home / "out.xlsx")
        assert (server_home / "out.xlsx").is_file()
        assert not (tmp_path / "out.xlsx").exists()

    async def test_artifact_scheme_without_an_artifacts_directory(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact(
                "artifact:// scheme requires artifacts directory, but none configured in context"
            ),
        ):
            await ExcelParserPlugin().execute(
                make_context({"operation": "read", "workbook": "artifact://a.xlsx"})
            )

    async def test_testdata_scheme_without_test_data_directories(self) -> None:
        with pytest.raises(
            ValueError,
            match=exact(
                "testdata:// scheme requires test data directories, "
                "but none configured in context"
            ),
        ):
            await ExcelParserPlugin().execute(
                make_context({"operation": "read", "workbook": "testdata://a.xlsx"})
            )

    async def test_missing_workbook_names_the_path_as_typed(self, tmp_path) -> None:
        with pytest.raises(ValueError, match=exact("Workbook not found: artifact://absent.xlsx")):
            await ExcelParserPlugin().execute(
                make_context(
                    {"operation": "read", "workbook": "artifact://absent.xlsx"},
                    artifacts_dir=str(tmp_path),
                )
            )

    async def test_missing_absolute_workbook(self, tmp_path) -> None:
        target = tmp_path / "absent.xlsx"

        with pytest.raises(ValueError, match=exact(f"Workbook not found: {target}")):
            await ExcelParserPlugin().execute(
                make_context({"operation": "read", "workbook": str(target)})
            )

    async def test_a_file_that_is_not_a_workbook(self, tmp_path) -> None:
        impostor = tmp_path / "notes.xlsx"
        impostor.write_text("this is not a workbook\n")

        with pytest.raises(
            ValueError,
            match=exact("Cannot read workbook: notes.xlsx is not a valid .xlsx/.xlsm file"),
        ):
            await ExcelParserPlugin().execute(
                make_context({"operation": "read", "workbook": str(impostor)})
            )


# =============================================================================
# Resource guards
# =============================================================================


class TestExcelParserResourceGuards:
    """Bounds on what the plugin will open, so a hostile file cannot exhaust it."""

    def test_limits_are_module_level_constants(self) -> None:
        assert excel_module._MAX_COMPRESSED_BYTES == 50 * 1024 * 1024
        assert excel_module._MAX_UNCOMPRESSED_BYTES == 500 * 1024 * 1024
        assert excel_module._MAX_CELLS == 5_000_000

    async def test_compressed_size_guard(self, monkeypatch) -> None:
        monkeypatch.setattr(excel_module, "_MAX_COMPRESSED_BYTES", 100)
        size = SAMPLE.stat().st_size

        with pytest.raises(
            ValueError,
            match=exact(f"Workbook too large: {size} bytes exceeds the 100 bytes limit"),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample()))

    async def test_uncompressed_size_guard(self, monkeypatch) -> None:
        monkeypatch.setattr(excel_module, "_MAX_UNCOMPRESSED_BYTES", 100)
        with zipfile.ZipFile(SAMPLE) as archive:
            expanded = sum(info.file_size for info in archive.infolist())

        with pytest.raises(
            ValueError,
            match=exact(
                f"Workbook content too large: {expanded} bytes exceeds the 100 bytes limit"
            ),
        ):
            await ExcelParserPlugin().execute(make_context(read_sample()))

    async def test_cell_count_guard(self, monkeypatch) -> None:
        monkeypatch.setattr(excel_module, "_MAX_CELLS", 4)

        with pytest.raises(
            ValueError, match=exact("Workbook content too large: 20 cells exceed the 4 limit")
        ):
            await ExcelParserPlugin().execute(make_context(read_sample()))

    async def test_cell_count_guard_measures_the_range_not_the_sheet(self, monkeypatch) -> None:
        monkeypatch.setattr(excel_module, "_MAX_CELLS", 15)

        result = await ExcelParserPlugin().execute(
            make_context(read_sample(sheet="Offset", header_row=3, **{"range": "B3:D6"}))
        )

        assert result["row_count"] == 3

    async def test_a_workbook_at_the_limit_still_reads(self, monkeypatch) -> None:
        monkeypatch.setattr(excel_module, "_MAX_CELLS", 20)

        result = await ExcelParserPlugin().execute(make_context(read_sample()))

        assert result["row_count"] == 3


# =============================================================================
# Write
# =============================================================================


def _people_table() -> Table:
    table = Table(columns=[("name", "string"), ("age", "integer"), ("score", "float")])
    table.add_row(["Ada", 36, Decimal("91.5")])
    table.add_row(["Grace", 45, Decimal("88.25")])
    return table


class TestExcelParserWriteTransforms:
    """Write shapes the table on its way out with the sorts and filters the config window saves."""

    async def test_write_applies_declarative_sort(self, tmp_path) -> None:
        target = tmp_path / "sorted.xlsx"
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table(),
                    "sorts": [sort_key(by_name("age"), "desc")],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("name") == ["Grace", "Ada"]

    async def test_write_applies_filter(self, tmp_path) -> None:
        target = tmp_path / "filtered.xlsx"
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table(),
                    "filters": [
                        filter_block(by_name("age"), "integer", [literal_row("greater_than", "40")])
                    ],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("name") == ["Grace"]
        assert result["row_count"] == 1

    async def test_write_transforms_do_not_mutate_the_source_table(self, tmp_path) -> None:
        target = tmp_path / "sorted.xlsx"
        table = _people_table()
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": table,
                    "sorts": [sort_key(by_name("age"), "desc")],
                }
            )
        )

        assert table.col("name") == ["Ada", "Grace"]

    async def test_write_runs_a_filter_and_sort_saved_by_the_config_window(self, tmp_path) -> None:
        target = tmp_path / "shaped.xlsx"
        table = Table(columns=[("name", "string"), ("age", "integer")])
        for name, age in [("Ada", 36), ("Grace", 45), ("Alan", 41), ("Edsger", 30)]:
            table.add_row([name, age])
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": table,
                    "sorts": [
                        {
                            "id": "csv-sort-1",
                            "column": {"mode": "name", "value": "age"},
                            "direction": "desc",
                        }
                    ],
                    "filters": [
                        {
                            "id": "csv-filter-1",
                            "column": {"mode": "name", "value": "age"},
                            "asType": "integer",
                            "conditions": [
                                {
                                    "id": "csv-filter-cond-1",
                                    "type": "literal",
                                    "variable": "_cell",
                                    "value_type": "integer",
                                    "operator": "greater_than",
                                    "reference_value": "35",
                                    "reference_is_expression": False,
                                }
                            ],
                        }
                    ],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("name") == ["Grace", "Alan", "Ada"]

    async def test_write_applies_a_multi_key_sort(self, tmp_path) -> None:
        target = tmp_path / "multikey.xlsx"
        table = Table(columns=[("region", "string"), ("amount", "integer")])
        for region, amount in [("west", 10), ("east", 20), ("west", 30), ("east", 5)]:
            table.add_row([region, amount])
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": table,
                    "sorts": [
                        sort_key(by_name("region"), "asc"),
                        sort_key(by_name("amount"), "desc", sort_id="csv-sort-2"),
                    ],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].to_list() == [
            {"region": "east", "amount": 20},
            {"region": "east", "amount": 5},
            {"region": "west", "amount": 30},
            {"region": "west", "amount": 10},
        ]

    async def test_write_applies_two_filter_blocks_conjunctively(self, tmp_path) -> None:
        target = tmp_path / "two-filters.xlsx"
        table = Table(columns=[("region", "string"), ("amount", "integer")])
        for region, amount in [("west", 10), ("east", 20), ("west", 30)]:
            table.add_row([region, amount])
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": table,
                    "filters": [
                        filter_block(
                            by_name("region"), "string", [literal_row("equals", "west", "string")]
                        ),
                        filter_block(
                            by_name("amount"),
                            "integer",
                            [literal_row("greater_than", "20")],
                            block_id="csv-filter-2",
                        ),
                    ],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].to_list() == [{"region": "west", "amount": 30}]

    async def test_write_shapes_a_stored_form_table(self, tmp_path) -> None:
        target = tmp_path / "stored-form.xlsx"
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": [{"sku": "B", "qty": 7}, {"sku": "A", "qty": 3}],
                    "sorts": [sort_key(by_name("sku"), "asc")],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("sku") == ["A", "B"]

    async def test_write_filter_resolves_a_variable_in_its_condition(self, tmp_path) -> None:
        target = tmp_path / "filtered.xlsx"
        context = make_context(
            {
                "operation": "write",
                "workbook": str(target),
                "table": _people_table(),
                "filters": [
                    filter_block(
                        by_name("age"),
                        "integer",
                        [literal_row("greater_than", "cutoff", is_expression=True)],
                    )
                ],
            }
        )
        context["variables"] = {"cutoff": 40}
        await ExcelParserPlugin().execute(context)

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("name") == ["Grace"]

    @pytest.mark.parametrize(
        ("operator", "reference", "kept"),
        [
            pytest.param("is_null", "", ["Grace"], id="is_null"),
            pytest.param("not_equals", "36", ["Grace", "Alan"], id="not_equals"),
        ],
    )
    async def test_write_keeps_a_null_cell_the_filter_row_holds_true_for(
        self, tmp_path, operator: str, reference: str, kept: list[str]
    ) -> None:
        """REQ-3.1.3.25: Grace's age is null."""
        target = tmp_path / "null-cell.xlsx"
        table = Table(columns=[("name", "string"), ("age", "integer")])
        for name, age in [("Ada", 36), ("Grace", None), ("Alan", 41)]:
            table.add_row([name, age])
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": table,
                    "filters": [
                        filter_block(by_name("age"), "integer", [literal_row(operator, reference)])
                    ],
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col("name") == kept


class TestExcelParserWrite:
    """Write places a table into a named sheet of a workbook."""

    async def test_creates_a_new_workbook(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        assert target.exists()
        assert result["success"] is True
        assert result["errors"] == []
        assert result["file"] == str(target)

    async def test_write_returns_no_table_output(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        assert "table" not in result

    async def test_round_trips_through_a_read(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"
        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert rows_of(result) == [
            {"name": "Ada", "age": 36, "score": Decimal("91.5")},
            {"name": "Grace", "age": 45, "score": Decimal("88.25")},
        ]

    async def test_values_keep_their_native_types(self, tmp_path) -> None:
        target = tmp_path / "typed.xlsx"
        table = Table(columns=[("n", "integer"), ("f", "float"), ("b", "boolean")])
        table.add_row([7, Decimal("1.25"), True])
        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": table})
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )

        assert result["table"].col_types() == ["integer", "float", "boolean"]
        assert rows_of(result) == [{"n": 7, "f": Decimal("1.25"), "b": True}]

    async def test_default_sheet_name(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert result["sheets"] == ["Sheet1"]

    async def test_named_sheet(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "sheet": "Report",
                    "table": _people_table(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert result["sheets"] == ["Report"]

    async def test_header_row_is_written_by_default(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"
        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target), "has_header": False})
        )

        assert result["table"].col("A")[0] == "name"

    async def test_write_header_false_omits_the_column_names(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table(),
                    "write_header": False,
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target), "has_header": False})
        )

        assert result["row_count"] == 2
        assert result["table"].col("A") == ["Ada", "Grace"]

    async def test_start_cell_places_the_table(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table(),
                    "start_cell": "B3",
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "read",
                    "workbook": str(target),
                    "header_row": 3,
                    "range": "B3:D5",
                }
            )
        )

        assert result["table"].col_names() == ["name", "age", "score"]
        assert result["row_count"] == 2

    async def test_creates_missing_parent_directories(self, tmp_path) -> None:
        target = tmp_path / "reports" / "q1" / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": _people_table()})
        )

        assert target.exists()

    async def test_writes_into_the_artifacts_directory(self, tmp_path) -> None:
        result = await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": "artifact://reports/out.xlsx",
                    "table": _people_table(),
                },
                artifacts_dir=str(tmp_path),
            )
        )

        assert (tmp_path / "reports" / "out.xlsx").exists()
        assert result["file"] == str(tmp_path / "reports" / "out.xlsx")

    async def test_writing_to_testdata_is_refused(self, tmp_path) -> None:
        with pytest.raises(
            ValueError,
            match=exact(
                "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
            ),
        ):
            await ExcelParserPlugin().execute(
                make_context(
                    {
                        "operation": "write",
                        "workbook": "testdata://out.xlsx",
                        "table": _people_table(),
                    },
                    testdata_dirs=[str(tmp_path)],
                )
            )

    async def test_an_absolute_target_inside_test_data_is_refused(self, tmp_path) -> None:
        """The refusal is about where the file lands, not about the scheme it was named with."""
        testdata = tmp_path / "testdata"
        testdata.mkdir()

        with pytest.raises(
            ValueError,
            match=exact(
                "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
            ),
        ):
            await ExcelParserPlugin().execute(
                make_context(
                    {
                        "operation": "write",
                        "workbook": str(testdata / "out.xlsx"),
                        "table": _people_table(),
                    },
                    testdata_dirs=[str(testdata)],
                )
            )

    async def test_a_nested_absolute_target_inside_test_data_is_refused(self, tmp_path) -> None:
        testdata = tmp_path / "testdata"
        (testdata / "sheets").mkdir(parents=True)

        with pytest.raises(
            ValueError,
            match=exact(
                "testdata:// paths are read-only. Cannot write, move, or delete testdata files."
            ),
        ):
            await ExcelParserPlugin().execute(
                make_context(
                    {
                        "operation": "write",
                        "workbook": str(testdata / "sheets" / "out.xlsx"),
                        "table": _people_table(),
                    },
                    testdata_dirs=[str(testdata)],
                )
            )

    async def test_a_target_beside_the_test_data_folder_is_written(self, tmp_path) -> None:
        testdata = tmp_path / "testdata"
        testdata.mkdir()
        target = tmp_path / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context(
                {"operation": "write", "workbook": str(target), "table": _people_table()},
                testdata_dirs=[str(testdata)],
            )
        )

        assert target.exists()

    async def test_an_empty_table_writes_only_its_header(self, tmp_path) -> None:
        target = tmp_path / "empty.xlsx"
        table = Table(columns=[("name", "string"), ("age", "integer")])

        await ExcelParserPlugin().execute(
            make_context({"operation": "write", "workbook": str(target), "table": table})
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert result["table"].col_names() == ["name", "age"]
        assert result["row_count"] == 0


class TestExcelParserWriteExistingWorkbook:
    """Writing into a workbook that already exists is non-destructive by default."""

    @pytest.fixture
    def existing(self, tmp_path) -> Path:
        target = tmp_path / "existing.xlsx"
        shutil.copy(SAMPLE, target)
        return target

    async def test_keep_sheets_adds_the_new_sheet(self, existing) -> None:
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(existing),
                    "sheet": "Extra",
                    "table": _people_table(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(existing)})
        )
        assert result["sheets"] == [*SHEET_NAMES, "Extra"]

    async def test_keep_sheets_is_the_default(self, existing) -> None:
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(existing),
                    "sheet": "Extra",
                    "table": _people_table(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(existing), "sheet": "Dates"})
        )
        assert result["table"].col_names() == ["joined", "last_seen", "shift"]

    async def test_keep_sheets_leaves_the_other_sheets_untouched(self, existing) -> None:
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(existing),
                    "sheet": "Extra",
                    "table": _people_table(),
                    "if_exists": "keep_sheets",
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "read",
                    "workbook": str(existing),
                    "sheet": "Offset",
                    "header_row": 3,
                    "range": "B3:D6",
                }
            )
        )
        assert result["table"].col("sku") == ["A-1", "B-2", "C-3"]

    async def test_a_sheet_of_the_same_name_is_replaced(self, existing) -> None:
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(existing),
                    "sheet": "People",
                    "table": _people_table(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(existing), "sheet": "People"})
        )
        assert result["table"].col_names() == ["name", "age", "score"]
        assert result["sheets"] == SHEET_NAMES

    async def test_replace_file_discards_the_other_sheets(self, existing) -> None:
        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(existing),
                    "sheet": "Only",
                    "table": _people_table(),
                    "if_exists": "replace_file",
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(existing)})
        )
        assert result["sheets"] == ["Only"]

    async def test_two_writes_assemble_a_multi_sheet_workbook(self, tmp_path) -> None:
        target = tmp_path / "report.xlsx"
        for sheet in ("First", "Second"):
            await ExcelParserPlugin().execute(
                make_context(
                    {
                        "operation": "write",
                        "workbook": str(target),
                        "sheet": sheet,
                        "table": _people_table(),
                    }
                )
            )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert result["sheets"] == ["First", "Second"]


class TestExcelParserWriteStoredFormTable:
    """Write accepts either runtime form of its table parameter."""

    async def test_stored_list_form(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table().to_list(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert result["table"].col_names() == ["name", "age", "score"]
        assert result["row_count"] == 2

    async def test_stored_dict_form(self, tmp_path) -> None:
        target = tmp_path / "out.xlsx"

        await ExcelParserPlugin().execute(
            make_context(
                {
                    "operation": "write",
                    "workbook": str(target),
                    "table": _people_table().to_dict(),
                }
            )
        )

        result = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(target)})
        )
        assert rows_of(result) == [
            {"name": "Ada", "age": 36, "score": Decimal("91.5")},
            {"name": "Grace", "age": 45, "score": Decimal("88.25")},
        ]

    async def test_both_forms_produce_the_same_workbook_content(self, tmp_path) -> None:
        live_target = tmp_path / "live.xlsx"
        stored_target = tmp_path / "stored.xlsx"
        for target, table in (
            (live_target, _people_table()),
            (stored_target, _people_table().to_list()),
        ):
            await ExcelParserPlugin().execute(
                make_context({"operation": "write", "workbook": str(target), "table": table})
            )

        live = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(live_target)})
        )
        stored = await ExcelParserPlugin().execute(
            make_context({"operation": "read", "workbook": str(stored_target)})
        )
        assert rows_of(stored) == rows_of(live)


# =============================================================================
# Null entries
# =============================================================================


AGE_SORT = sort_key(by_name("age"), "desc")
AGE_FILTER = filter_block(by_name("age"), "integer", [literal_row("greater_than", "40")])


class TestExcelParserNullEntries:
    """A sort key and a filter block are records: a null one fails naming its row
    (REQ-3.1.3.21)."""

    @pytest.mark.parametrize(
        ("setting", "entries", "row"),
        [
            pytest.param("sorts", [None], 1, id="sorts-first-row"),
            pytest.param("sorts", [AGE_SORT, None], 2, id="sorts-second-row"),
            pytest.param("filters", [None], 1, id="filters-first-row"),
            pytest.param("filters", [AGE_FILTER, None], 2, id="filters-second-row"),
        ],
    )
    async def test_read_refuses_a_null_entry_by_its_row(
        self, setting: str, entries: list[Any], row: int
    ) -> None:
        context = make_context(read_sample(**{setting: entries}))

        with pytest.raises(NullValueError, match=exact(f"Row {row} in '{setting}' is null")):
            await ExcelParserPlugin().execute(context)

    @pytest.mark.parametrize("setting", ["sorts", "filters"])
    async def test_write_refuses_a_null_entry_by_its_row(self, tmp_path, setting: str) -> None:
        target = tmp_path / "out.xlsx"
        table = Table(columns=[("name", "string"), ("age", "integer")])
        table.add_row(["Ada", 36])
        params = {"operation": "write", "workbook": str(target), "table": table, setting: [None]}

        with pytest.raises(NullValueError, match=exact(f"Row 1 in '{setting}' is null")):
            await ExcelParserPlugin().execute(make_context(params))

        assert not target.exists()
