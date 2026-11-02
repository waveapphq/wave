"""
CSV Parser Plugin

Pure format converter between delimited text and the WAVE table type:
Parse (text -> table) and Serialize (table -> text). Performs no file I/O.
"""

import csv
import io
import re
from decimal import Decimal, InvalidOperation
from typing import Any

from wavecore.core.table import ColumnType, Table
from wavecore.core.variables.decimal_value import decimal_to_str, to_wave_decimal
from wavecore.plugins._table_parser_base import (
    TRANSFORM_PARAMETERS,
    TYPING_PARAMETERS,
    TableParserBase,
)


class CSVParserPlugin(TableParserBase):
    """CSV/TSV text <-> WAVE table converter with typing and transform config."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "csv-parser",
            "name": "CSV Parser",
            "version": "1.0.0",
            "category": "data",
            "description": (
                "Converts delimited text to a WAVE table and back. Supports "
                "delimiter and header controls, automatic or schema-driven column "
                "typing, empty-cell and type-mismatch policy, and declarative "
                "sort/filter transforms."
            ),
            "parameters": [
                {
                    "name": "operation",
                    "type": "string",
                    "required": False,
                    "default": "parse",
                    "enum_values": ["parse", "serialize"],
                    "description": "parse (text -> table) or serialize (table -> text).",
                },
                {
                    "name": "csv_content",
                    "type": "string",
                    "required": False,
                    "description": "Delimited text to parse (parse operation).",
                },
                {
                    "name": "table",
                    "type": "table",
                    "required": False,
                    "variable_ref": True,
                    "description": "Table to serialize (serialize operation).",
                },
                {
                    "name": "delimiter",
                    "type": "string",
                    "required": False,
                    "default": ",",
                    "description": "Single-character field delimiter.",
                },
                {
                    "name": "has_header",
                    "type": "boolean",
                    "required": False,
                    "default": True,
                    "description": (
                        "Treat the first row as column names (parse) / write it (serialize)."
                    ),
                },
                *TYPING_PARAMETERS,
                *TRANSFORM_PARAMETERS,
            ],
            "return_type": "map",
            "output_schema": [
                {"name": "table", "type": "table", "description": "Parsed table."},
                {
                    "name": "row_count",
                    "type": "integer",
                    "description": "Rows in the parsed table.",
                },
                {"name": "schema", "type": "array", "description": "Column name/type descriptors."},
                {"name": "csv_content", "type": "string", "description": "Serialized text."},
                {"name": "success", "type": "boolean", "description": "True when no cell errors."},
                {
                    "name": "errors",
                    "type": "array",
                    "description": "Per-cell type-mismatch errors.",
                },
            ],
            "author": "WAVE Framework",
            "tags": ["csv", "tsv", "table", "data", "parsing"],
        }

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate plugin parameters, raising exact-message errors."""
        operation = self._validate_operation(params)
        self._validate_delimiter(params)
        if operation == "parse":
            self._validate_parse_params(params)
        else:
            self._validate_serialize_params(params)

    def _validate_operation(self, params: dict[str, Any]) -> str:
        if "operation" not in params:
            raise ValueError("Missing required parameter: operation")
        operation = params["operation"]
        if not isinstance(operation, str):
            raise TypeError(
                f"Parameter 'operation' must be a string, got {type(operation).__name__}"
            )
        if operation not in ("parse", "serialize"):
            raise ValueError(
                f"Invalid operation: {operation!r}. Supported operations: parse, serialize"
            )
        return operation

    def _validate_delimiter(self, params: dict[str, Any]) -> None:
        if "delimiter" in params:
            delimiter = params["delimiter"]
            if not isinstance(delimiter, str) or len(delimiter) != 1:
                raise ValueError("Parameter 'delimiter' must be a single character")

    def _validate_parse_params(self, params: dict[str, Any]) -> None:
        self._validate_csv_content(params)
        self.validate_typing_params(params)

    def _validate_csv_content(self, params: dict[str, Any]) -> None:
        if "csv_content" not in params:
            raise ValueError("Missing required parameter: csv_content")
        csv_content = params["csv_content"]
        if not isinstance(csv_content, str):
            raise TypeError(
                f"Parameter 'csv_content' must be a string, got {type(csv_content).__name__}"
            )

    def _validate_serialize_params(self, params: dict[str, Any]) -> None:
        if "table" not in params:
            raise ValueError("Missing required parameter: table")

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Dispatch parse or serialize."""
        params = context["parameters"]
        await self.validate(params)
        variables = context.get("variables", {})
        if params["operation"] == "parse":
            return self._execute_parse(params, variables)
        return self._execute_serialize(params, variables)

    def _execute_parse(self, params: dict[str, Any], variables: dict[str, Any]) -> dict[str, Any]:
        csv_content = params["csv_content"]
        delimiter = params.get("delimiter", ",")
        has_header = params.get("has_header", True)
        column_types = params.get("column_types", "auto")
        empty_cells = params.get("empty_cells", "none")

        lines = list(csv.reader(io.StringIO(csv_content), delimiter=delimiter))
        header, data_rows = self._header_and_data(lines, has_header)

        if column_types == "schema":
            table, errors = self._parse_with_schema(
                header,
                data_rows,
                self._require_table(params["schema_source"], "schema_source"),
                has_header,
                empty_cells,
                params.get("on_mismatch", "fail"),
            )
        else:
            table, errors = self._parse_inferred(
                header, data_rows, column_types == "string", empty_cells
            )

        table = self.apply_transforms(
            table, params.get("sorts", []), params.get("filters", []), variables
        )
        return {
            "table": table,
            "row_count": table.row_count(),
            "schema": [
                {"name": name, "type": ctype}
                for name, ctype in zip(table.col_names(), table.col_types(), strict=True)
            ],
            "success": not errors,
            "errors": errors,
        }

    def _execute_serialize(
        self, params: dict[str, Any], variables: dict[str, Any]
    ) -> dict[str, Any]:
        table = self.apply_transforms(
            self._require_table(params["table"], "table"),
            params.get("sorts", []),
            params.get("filters", []),
            variables,
        )
        delimiter = params.get("delimiter", ",")
        has_header = params.get("has_header", True)

        output = io.StringIO()
        writer = csv.writer(output, delimiter=delimiter, lineterminator="\n")
        if has_header:
            writer.writerow(table.col_names())
        for row in table:
            writer.writerow([self._serialize_cell(value) for value in row])
        return {"csv_content": output.getvalue(), "success": True, "errors": []}

    # ------------------------------------------------------------------
    # Parse helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _header_and_data(
        lines: list[list[str]], has_header: bool
    ) -> tuple[list[str], list[list[str]]]:
        """Split raw CSV lines into a header row and the data rows."""
        if has_header:
            rows = iter(lines)
            return next(rows, []), list(rows)
        ncols = max((len(row) for row in lines), default=0)
        return [f"Column {i}" for i in range(ncols)], lines

    @staticmethod
    def _pad(row: list[str], width: int) -> list[str]:
        """Pad (or truncate) a row to exactly `width` string cells."""
        return (list(row) + [""] * width)[:width]

    def _parse_inferred(
        self,
        header: list[str],
        data_rows: list[list[str]],
        force_string: bool,
        empty_cells: str,
    ) -> tuple[Table, list[dict[str, Any]]]:
        """Parse with auto-inferred column types (or all-string when forced)."""
        ncols = len(header)
        padded = [self._pad(row, ncols) for row in data_rows]
        if force_string:
            col_types = [ColumnType.STRING] * ncols
        else:
            col_types = [self._infer_column_type([row[i] for row in padded]) for i in range(ncols)]
        table = Table(columns=list(zip(header, [t.value for t in col_types], strict=True)))
        for row in padded:
            table.add_row(
                [self._coerce_cell(row[i], col_types[i], empty_cells) for i in range(ncols)]
            )
        return table, []

    def _parse_with_schema(
        self,
        header: list[str],
        data_rows: list[list[str]],
        schema: Table,
        has_header: bool,
        empty_cells: str,
        on_mismatch: str,
    ) -> tuple[Table, list[dict[str, Any]]]:
        """Conform parsed rows to a supplied schema table, enforcing declared types."""
        names = schema.col_names()
        if has_header:
            header_index = {name: i for i, name in enumerate(header)}
            mapping = [header_index[name] for name in names]
        else:
            mapping = list(range(len(names)))
        width = max(mapping, default=-1) + 1

        rows = [self._pad(raw_row, width) for raw_row in data_rows]
        return self.conform_to_schema(rows, schema, mapping, empty_cells, on_mismatch)

    def _coerce_cell(self, raw: str, col_type: ColumnType, empty_cells: str) -> Any:
        """Coerce a raw string cell already classified as compatible with its column type."""
        if raw == "":
            return self.empty_value(col_type, empty_cells)
        if col_type == ColumnType.STRING:
            return raw
        if col_type == ColumnType.INTEGER:
            return int(raw)
        if col_type == ColumnType.FLOAT:
            return to_wave_decimal(raw)
        return raw.lower() == "true"

    def _infer_column_type(self, cells: list[str]) -> ColumnType:
        """Widen a column's non-empty cells to a single type (int -> float -> string)."""
        types = {self._classify_cell(cell) for cell in cells if cell != ""}
        if not types:
            return ColumnType.STRING
        if types == {"boolean"}:
            return ColumnType.BOOLEAN
        if types <= {"integer"}:
            return ColumnType.INTEGER
        if types <= {"integer", "float"}:
            return ColumnType.FLOAT
        return ColumnType.STRING

    def _classify_cell(self, cell: str) -> str:
        """Classify a non-empty cell as boolean / integer / float / string."""
        if cell.lower() in ("true", "false"):
            return "boolean"
        if cell.startswith("+"):
            return "string"
        core = cell[1:] if cell.startswith("-") else cell
        if len(core) > 1 and core[0] == "0" and core[1].isdigit():
            return "string"
        if re.fullmatch(r"-?\d+", cell):
            return "integer"
        try:
            if Decimal(cell).is_finite():
                return "float"
        except InvalidOperation:
            pass
        return "string"

    @staticmethod
    def _serialize_cell(value: Any) -> Any:
        """Render a table cell as a CSV field."""
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, Decimal):
            return decimal_to_str(value)
        return value
