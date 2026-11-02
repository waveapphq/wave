"""
Excel Parser Plugin

Converts between spreadsheet workbooks and the WAVE table type: Read
(workbook -> table) and Write (table -> workbook). Unlike the text converters
it owns its file access, resolving the workbook path through the shared plugin
path resolver.
"""

import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Any, cast

import openpyxl
from openpyxl.utils import coordinate_to_tuple, get_column_letter, range_boundaries

from wavecore.core.table import ColumnType, Table
from wavecore.core.variables.decimal_value import to_wave_decimal
from wavecore.plugins._file_paths import resolve_plugin_path, scheme_basename
from wavecore.plugins._table_parser_base import (
    TRANSFORM_PARAMETERS,
    TYPING_PARAMETERS,
    TableParserBase,
)

_MAX_COMPRESSED_BYTES = 50 * 1024 * 1024
_MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
_MAX_CELLS = 5_000_000

_SUPPORTED_SUFFIXES = (".xlsx", ".xlsm")
_RANGE_PATTERN = re.compile(r"^[A-Za-z]{1,3}\d+:[A-Za-z]{1,3}\d+$")
_CELL_PATTERN = re.compile(r"^[A-Za-z]{1,3}\d+$")

_UNCOMPUTED_FORMULA_ERROR = (
    "formula has no stored result - open and save the workbook in a spreadsheet application"
)


@dataclass(frozen=True)
class _Grid:
    """The rectangle a read covers, and where its header and data rows sit."""

    min_col: int
    max_col: int
    header_row: int | None
    span_first_row: int
    first_row: int
    last_row: int


class ExcelParserPlugin(TableParserBase):
    """Spreadsheet workbook <-> WAVE table converter."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "excel-parser",
            "name": "Excel Parser",
            "version": "1.0.0",
            "category": "data",
            "description": (
                "Reads a worksheet into a WAVE table and writes a table back into a "
                "workbook. Supports sheet and range selection, header-row addressing, "
                "automatic or schema-driven column typing, empty-cell and type-mismatch "
                "policy, declarative sort/filter transforms, and non-destructive writes."
            ),
            "parameters": [
                {
                    "name": "operation",
                    "type": "string",
                    "required": False,
                    "default": "read",
                    "enum_values": ["read", "write"],
                    "description": "read (workbook -> table) or write (table -> workbook).",
                },
                {
                    "name": "workbook",
                    "type": "string",
                    "required": True,
                    "description": (
                        "Workbook path: artifact://, testdata:// or an absolute or relative path."
                    ),
                },
                {
                    "name": "sheet",
                    "type": "string",
                    "required": False,
                    "description": "Sheet name, or its 1-based position. Blank picks the first.",
                },
                {
                    "name": "range",
                    "type": "string",
                    "required": False,
                    "description": "Cell range in A1 notation. Blank reads the used area.",
                },
                {
                    "name": "has_header",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": "Take column names from a header row.",
                },
                {
                    "name": "header_row",
                    "type": "integer",
                    "required": False,
                    "default": 1,
                    "description": "1-based sheet row holding the column names.",
                },
                *TYPING_PARAMETERS,
                *TRANSFORM_PARAMETERS,
                {
                    "name": "table",
                    "type": "table",
                    "required": False,
                    "variable_ref": True,
                    "description": "Table to write into the workbook.",
                },
                {
                    "name": "write_header",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": "Write the column names as the first row.",
                },
                {
                    "name": "start_cell",
                    "type": "string",
                    "required": False,
                    "default": "A1",
                    "description": "Top-left cell the table is written from, in A1 notation.",
                },
                {
                    "name": "if_exists",
                    "type": "string",
                    "required": False,
                    "default": "keep_sheets",
                    "enum_values": ["keep_sheets", "replace_file"],
                    "description": "Whether an existing workbook keeps its other sheets.",
                },
            ],
            "return_type": "map",
            "output_schema": [
                {"name": "table", "type": "table", "description": "Table read from the sheet."},
                {
                    "name": "row_count",
                    "type": "integer",
                    "description": "Rows in the table that was read.",
                },
                {"name": "schema", "type": "array", "description": "Column name/type descriptors."},
                {"name": "sheets", "type": "array", "description": "Every sheet in the workbook."},
                {"name": "file", "type": "string", "description": "Path of the workbook written."},
                {"name": "success", "type": "boolean", "description": "True when no cell errors."},
                {"name": "errors", "type": "array", "description": "Per-cell read errors."},
            ],
            "author": "WAVE Framework",
            "tags": ["excel", "xlsx", "xlsm", "spreadsheet", "table", "data"],
        }

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate plugin parameters, raising exact-message errors."""
        operation = self._validate_operation(params)
        workbook = self._validate_workbook(params)
        self._validate_format(workbook)
        if operation == "read":
            self._validate_read_params(params)
        else:
            self._validate_write_params(params)

    def _validate_operation(self, params: dict[str, Any]) -> str:
        if "operation" not in params:
            raise ValueError("Missing required parameter: operation")
        operation = params["operation"]
        if not isinstance(operation, str):
            raise TypeError(
                f"Parameter 'operation' must be a string, got {type(operation).__name__}"
            )
        if operation not in ("read", "write"):
            raise ValueError(f"Invalid operation: {operation!r}. Supported operations: read, write")
        return operation

    def _validate_workbook(self, params: dict[str, Any]) -> str:
        if "workbook" not in params:
            raise ValueError("Missing required parameter: workbook")
        workbook = params["workbook"]
        if not isinstance(workbook, str):
            raise TypeError(f"Parameter 'workbook' must be a string, got {type(workbook).__name__}")
        return workbook

    @staticmethod
    def _validate_format(workbook: str) -> None:
        name = scheme_basename(workbook)
        if not name.lower().endswith(_SUPPORTED_SUFFIXES):
            raise ValueError(
                f"Unsupported workbook format: {name}. "
                "Excel supports .xlsx and .xlsm - save the file as .xlsx"
            )

    def _validate_read_params(self, params: dict[str, Any]) -> None:
        self.validate_typing_params(params)
        if "schema_source" in params:
            self._require_table(params["schema_source"], "schema_source")
        if "header_row" in params and params["header_row"] < 1:
            raise ValueError("Parameter 'header_row' must be 1 or greater")
        if "range" in params and not _RANGE_PATTERN.match(params["range"]):
            raise ValueError("Parameter 'range' must be a cell range in A1 notation, e.g. A1:F200")

    def _validate_write_params(self, params: dict[str, Any]) -> None:
        if "table" not in params:
            raise ValueError("Missing required parameter: table")
        self._require_table(params["table"], "table")
        if "start_cell" in params and not _CELL_PATTERN.match(params["start_cell"]):
            raise ValueError("Parameter 'start_cell' must be a single cell in A1 notation, e.g. A1")
        if "if_exists" in params and params["if_exists"] not in ("keep_sheets", "replace_file"):
            raise ValueError("Parameter 'if_exists' must be one of: keep_sheets, replace_file")

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Dispatch read or write."""
        params = context["parameters"]
        await self.validate(params)
        if params["operation"] == "read":
            return self.read_workbook(params, context)
        return self._execute_write(params, context)

    @staticmethod
    def _resolve_workbook(params: dict[str, Any], context: dict[str, Any], *, read: bool) -> Path:
        return resolve_plugin_path(
            params["workbook"],
            context.get("artifacts_dir"),
            context.get("testdata_dirs"),
            read_only_ok=read,
        )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def read_workbook(self, params: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Read a workbook into the Read operation's outputs."""
        path = self._resolve_workbook(params, context, read=True)
        if not path.is_file():
            raise ValueError(f"Workbook not found: {params['workbook']}")

        values_wb, formulas_wb = self._open_workbook(path)
        try:
            sheets = list(values_wb.sheetnames)
            worksheet = self._select_sheet(values_wb, str(params.get("sheet") or ""))
            grid = self._resolve_grid(worksheet, params)
            self._guard_cell_count(grid)
            names = self._header_names(worksheet, grid)
            rows, errors = self._read_rows(worksheet, formulas_wb[worksheet.title], grid, names)
        finally:
            values_wb.close()
            formulas_wb.close()

        table, cell_errors = self._build_table(names, rows, params)
        table = self.apply_transforms(
            table,
            params.get("sorts", []),
            params.get("filters", []),
            context.get("variables", {}),
        )
        errors = errors + cell_errors
        return {
            "table": table,
            "row_count": table.row_count(),
            "schema": [
                {"name": name, "type": ctype}
                for name, ctype in zip(table.col_names(), table.col_types(), strict=True)
            ],
            "sheets": sheets,
            "success": not errors,
            "errors": errors,
        }

    @staticmethod
    def _open_workbook(path: Path) -> tuple[Any, Any]:
        """Open the workbook twice: stored results, and formulas for detection."""
        size = path.stat().st_size
        if size > _MAX_COMPRESSED_BYTES:
            raise ValueError(
                f"Workbook too large: {size} bytes exceeds the {_MAX_COMPRESSED_BYTES} bytes limit"
            )
        try:
            with zipfile.ZipFile(path) as archive:
                expanded = sum(info.file_size for info in archive.infolist())
        except zipfile.BadZipFile:
            raise ValueError(
                f"Cannot read workbook: {path.name} is not a valid .xlsx/.xlsm file"
            ) from None
        if expanded > _MAX_UNCOMPRESSED_BYTES:
            raise ValueError(
                f"Workbook content too large: {expanded} bytes exceeds "
                f"the {_MAX_UNCOMPRESSED_BYTES} bytes limit"
            )
        return (
            openpyxl.load_workbook(path, data_only=True),
            openpyxl.load_workbook(path, data_only=False),
        )

    @staticmethod
    def _select_sheet(workbook: Any, sheet: str) -> Any:
        """Pick the sheet by name, by 1-based position, or the first one."""
        if not sheet:
            return workbook.worksheets[0]
        if sheet in workbook.sheetnames:
            return workbook[sheet]
        count = len(workbook.sheetnames)
        if sheet.isdigit():
            position = int(sheet)
            if not 1 <= position <= count:
                raise ValueError(
                    f"Sheet position {position} is out of range - "
                    f"the workbook has {count} sheet(s)"
                )
            return workbook.worksheets[position - 1]
        raise ValueError(
            f"Sheet not found: {sheet}. Available sheets: {', '.join(workbook.sheetnames)}"
        )

    @staticmethod
    def _resolve_grid(worksheet: Any, params: dict[str, Any]) -> _Grid:
        """Resolve the read rectangle from the range (or used area) and the header row."""
        used_min_col, used_max_col = worksheet.min_column, worksheet.max_column
        used_min_row, used_max_row = worksheet.min_row, worksheet.max_row

        raw_range = params.get("range")
        if raw_range:
            min_col, min_row, max_col, max_row = cast(
                tuple[int, int, int, int], range_boundaries(raw_range.upper())
            )
            if (
                min_col > used_max_col
                or max_col < used_min_col
                or min_row > used_max_row
                or max_row < used_min_row
            ):
                used = (
                    f"{get_column_letter(used_min_col)}{used_min_row}:"
                    f"{get_column_letter(used_max_col)}{used_max_row}"
                )
                raise ValueError(
                    f"Range {raw_range} is outside the sheet's data (used area {used})"
                )
        else:
            min_col, max_col = used_min_col, used_max_col
            min_row, max_row = used_min_row, used_max_row

        header_row = None
        first_row = min_row
        if params.get("has_header", True):
            header_row = params.get("header_row", 1)
            if header_row > used_max_row:
                raise ValueError(
                    f"Header row {header_row} is outside the sheet (rows 1-{used_max_row})"
                )
            first_row = max(min_row, header_row + 1)
        return _Grid(min_col, max_col, header_row, min_row, first_row, max_row)

    @staticmethod
    def _guard_cell_count(grid: _Grid) -> None:
        cells = (grid.max_col - grid.min_col + 1) * (grid.last_row - grid.span_first_row + 1)
        if cells > _MAX_CELLS:
            raise ValueError(
                f"Workbook content too large: {cells} cells exceed the {_MAX_CELLS} limit"
            )

    @staticmethod
    def _header_names(worksheet: Any, grid: _Grid) -> list[str]:
        """Column names from the header row, falling back to spreadsheet letters."""
        columns = list(range(grid.min_col, grid.max_col + 1))
        letters = [get_column_letter(col) for col in columns]
        if grid.header_row is None:
            return letters
        names = []
        for offset, col in enumerate(columns):
            raw = worksheet.cell(row=grid.header_row, column=col).value
            names.append(letters[offset] if raw is None else str(raw))
        return names

    def _read_rows(
        self, worksheet: Any, formula_sheet: Any, grid: _Grid, names: list[str]
    ) -> tuple[list[list[Any]], list[dict[str, Any]]]:
        """Read the data cells, reporting formulas that carry no stored result."""
        rows: list[list[Any]] = []
        errors: list[dict[str, Any]] = []
        for row_idx, row_no in enumerate(range(grid.first_row, grid.last_row + 1)):
            row: list[Any] = []
            for offset, col in enumerate(range(grid.min_col, grid.max_col + 1)):
                value = self._normalize(worksheet.cell(row=row_no, column=col).value)
                if value is None and formula_sheet.cell(row=row_no, column=col).data_type == "f":
                    errors.append(
                        {
                            "row": row_idx,
                            "column": names[offset],
                            "error": _UNCOMPUTED_FORMULA_ERROR,
                        }
                    )
                row.append(value)
            rows.append(row)
        return rows, errors

    @staticmethod
    def _normalize(value: Any) -> Any:
        """Dates and times become ISO 8601 text - WAVE has no date type."""
        if isinstance(value, datetime | time):
            return value.isoformat()
        return value

    def _build_table(
        self, names: list[str], rows: list[list[Any]], params: dict[str, Any]
    ) -> tuple[Table, list[dict[str, Any]]]:
        """Type the cells that were read, per the column-typing mode."""
        empty_cells = params.get("empty_cells", "none")
        column_types = params.get("column_types", "auto")
        if column_types == "schema":
            schema = self._require_table(params["schema_source"], "schema_source")
            mapping = self._schema_mapping(names, schema, params.get("has_header", True))
            return self.conform_to_schema(
                rows, schema, mapping, empty_cells, params.get("on_mismatch", "fail")
            )

        if column_types == "string":
            col_types = [ColumnType.STRING] * len(names)
        else:
            col_types = [self._column_type([row[i] for row in rows]) for i in range(len(names))]
        table = Table(columns=list(zip(names, [t.value for t in col_types], strict=True)))
        for row in rows:
            table.add_row(
                [self._cell_value(row[i], col_types[i], empty_cells) for i in range(len(names))]
            )
        return table, []

    @staticmethod
    def _schema_mapping(names: list[str], schema: Table, has_header: bool) -> list[int]:
        """Source column feeding each schema column: by name with a header, else by position."""
        if has_header:
            index = {name: i for i, name in enumerate(names)}
            return [index[name] for name in schema.col_names()]
        return list(range(schema.col_count()))

    def _column_type(self, values: list[Any]) -> ColumnType:
        """Widen a column's stored cell types to the narrowest type that fits every cell."""
        kinds = {self._classify(value) for value in values if value is not None}
        if not kinds:
            return ColumnType.STRING
        if kinds == {"boolean"}:
            return ColumnType.BOOLEAN
        if kinds == {"integer"}:
            return ColumnType.INTEGER
        if kinds <= {"integer", "float"}:
            return ColumnType.FLOAT
        return ColumnType.STRING

    @staticmethod
    def _classify(value: Any) -> str:
        """Classify a stored cell. bool before int - bool is a subclass of int."""
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, int):
            return "integer"
        if isinstance(value, float):
            return "float"
        return "string"

    def _cell_value(self, raw: Any, col_type: ColumnType, empty_cells: str) -> Any:
        """Render a stored cell as its column's type."""
        if raw is None:
            return self.empty_value(col_type, empty_cells)
        if col_type == ColumnType.FLOAT:
            return to_wave_decimal(str(raw))
        if col_type == ColumnType.STRING:
            return self._display_text(raw)
        return raw

    @staticmethod
    def _display_text(raw: Any) -> str:
        """The cell as the spreadsheet displays it."""
        if isinstance(raw, bool):
            return "TRUE" if raw else "FALSE"
        return str(raw)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def _execute_write(self, params: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        path = self._resolve_workbook(params, context, read=False)
        table = self.apply_transforms(
            self._require_table(params["table"], "table"),
            params.get("sorts", []),
            params.get("filters", []),
            context.get("variables", {}),
        )
        title = str(params.get("sheet") or "") or "Sheet1"

        worksheet: Any
        if path.is_file() and params.get("if_exists", "keep_sheets") == "keep_sheets":
            workbook = openpyxl.load_workbook(path)
            worksheet = self._sheet_for_write(workbook, title)
        else:
            workbook = openpyxl.Workbook()
            worksheet = workbook.active
            worksheet.title = title

        self._write_table(worksheet, table, params)
        path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(path)
        workbook.close()
        return {"file": str(path), "success": True, "errors": []}

    @staticmethod
    def _sheet_for_write(workbook: Any, title: str) -> Any:
        """Add the sheet, or replace one of the same name in place."""
        if title in workbook.sheetnames:
            position = workbook.sheetnames.index(title)
            del workbook[title]
            return workbook.create_sheet(title, position)
        return workbook.create_sheet(title)

    @staticmethod
    def _write_table(worksheet: Any, table: Table, params: dict[str, Any]) -> None:
        """Stream the table into the sheet from the start cell."""
        row_no, col_no = coordinate_to_tuple(str(params.get("start_cell", "A1")).upper())
        if params.get("write_header", True):
            for offset, name in enumerate(table.col_names()):
                worksheet.cell(row=row_no, column=col_no + offset, value=name)
            row_no += 1
        for row in table:
            for offset, value in enumerate(row.to_list()):
                worksheet.cell(row=row_no, column=col_no + offset, value=value)
            row_no += 1
