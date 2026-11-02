"""
Shared table-conversion behavior for the converter plugins.

Column defaults, the empty-cell policy, declared-type coercion, schema
conformance with the mismatch policy, declarative sorts and filters, and the
validation of the typing parameters are identical for every source format, so
they live here rather than once per converter.
"""

from typing import Any

from wavecore.core.execution.plugin_executor import check_entry_nulls
from wavecore.core.number_rule import parse_number
from wavecore.core.table import ColumnType, Table, validate_filter_operator
from wavecore.core.table_values import as_table
from wavecore.core.variables.decimal_value import to_wave_decimal
from wavecore.core.variables.value_checks import number_value_problem
from wavecore.plugins.base import PluginBase

TYPING_PARAMETERS: list[dict[str, Any]] = [
    {
        "name": "column_types",
        "type": "string",
        "required": False,
        "default": "auto",
        "enum_values": ["auto", "string", "schema"],
        "description": "How the columns are typed.",
    },
    {
        "name": "schema_source",
        "type": "table",
        "required": False,
        "variable_ref": True,
        "description": "Schema table whose columns drive typing when column_types=schema.",
    },
    {
        "name": "empty_cells",
        "type": "string",
        "required": False,
        "default": "none",
        "enum_values": ["none", "default"],
        "description": "Map an empty cell to null (none) or the column type default (default).",
    },
    {
        "name": "on_mismatch",
        "type": "string",
        "required": False,
        "default": "fail",
        "enum_values": ["fail", "skip_row", "replace_default"],
        "description": "Behavior when a cell violates a declared type.",
    },
]

TRANSFORM_PARAMETERS: list[dict[str, Any]] = [
    {
        "name": "sorts",
        "type": "array",
        "required": False,
        "description": (
            "Sort keys in priority order, each {id, column: {mode: 'name' | 'index', value},"
            " direction: 'asc' | 'desc'}; an index is 0-based. A null entry fails the run."
        ),
    },
    {
        "name": "filters",
        "type": "array",
        "required": False,
        "description": (
            "Filter blocks a kept row passes, each {id, column: {mode: 'name' | 'index', value},"
            " asType: 'string' | 'integer' | 'float' | 'boolean', conditions: [check condition"
            " items on the variable _cell, joined by and / or operator items]}. A null entry"
            " fails the run."
        ),
    },
]

_COLUMN_DEFAULTS: dict[ColumnType, Any] = {
    ColumnType.STRING: "",
    ColumnType.INTEGER: 0,
    ColumnType.FLOAT: to_wave_decimal("0"),
    ColumnType.BOOLEAN: False,
}


def _is_empty(raw: Any) -> bool:
    """A cell with no content: an absent spreadsheet cell or an empty field."""
    return raw is None or raw == ""


def _column_ref(ref: dict[str, Any]) -> str | int:
    """A stored column reference: a name, or a 0-based index kept as text."""
    value = ref["value"]
    if ref["mode"] != "index":
        return str(value)
    problem = number_value_problem(value, "integer")
    if problem is not None:
        raise ValueError(problem.describe(f"Column index '{value}'"))
    return int(parse_number(value, "integer"))


class TableParserBase(PluginBase):
    """Behavior shared by the format converters that produce a WAVE table."""

    # ------------------------------------------------------------------
    # Table-shaped parameters
    # ------------------------------------------------------------------

    @staticmethod
    def _require_table(value: Any, param_name: str) -> Table:
        """Realize a table-shaped parameter in either runtime form, or reject it."""
        table = as_table(value)
        if table is None:
            raise TypeError(f"Parameter {param_name!r} must be a table, got {type(value).__name__}")
        return table

    # ------------------------------------------------------------------
    # Cells
    # ------------------------------------------------------------------

    @staticmethod
    def empty_value(col_type: ColumnType, empty_cells: str) -> Any:
        """None for the 'none' policy, else the column type's default value."""
        if empty_cells == "none":
            return None
        return _COLUMN_DEFAULTS[col_type]

    def coerce_declared(self, raw: Any, col_type: ColumnType, empty_cells: str) -> Any:
        """Coerce a raw cell to a declared column type, raising TypeError on a mismatch."""
        if _is_empty(raw):
            return self.empty_value(col_type, empty_cells)
        from wavecore.controls.assertion_evaluator import _coerce_value

        return _coerce_value(raw, col_type.value)

    # ------------------------------------------------------------------
    # Schema conformance
    # ------------------------------------------------------------------

    def conform_to_schema(
        self,
        rows: list[list[Any]],
        schema: Table,
        mapping: list[int],
        empty_cells: str,
        on_mismatch: str,
    ) -> tuple[Table, list[dict[str, Any]]]:
        """Conform source rows to a schema table, applying the mismatch policy.

        ``mapping[i]`` is the source column index feeding schema column ``i``.
        """
        names = schema.col_names()
        types = [ColumnType(t) for t in schema.col_types()]
        table = Table(columns=list(zip(names, [t.value for t in types], strict=True)))
        errors: list[dict[str, Any]] = []
        for row_idx, row in enumerate(rows):
            values, skip = self._conform_row(
                row, mapping, names, types, empty_cells, on_mismatch, row_idx, errors
            )
            if not skip:
                table.add_row(values)
        return table, errors

    def _conform_row(
        self,
        row: list[Any],
        mapping: list[int],
        names: list[str],
        types: list[ColumnType],
        empty_cells: str,
        on_mismatch: str,
        row_idx: int,
        errors: list[dict[str, Any]],
    ) -> tuple[list[Any], bool]:
        """Coerce one row to the schema; returns (values, skip)."""
        values: list[Any] = []
        for out_idx, src_idx in enumerate(mapping):
            raw = row[src_idx] if 0 <= src_idx < len(row) else None
            target = types[out_idx]
            try:
                values.append(self.coerce_declared(raw, target, empty_cells))
            except TypeError:
                name = names[out_idx]
                if on_mismatch == "fail":
                    raise ValueError(
                        f"Type mismatch in column {name!r}: {raw!r} is not a valid {target.value}"
                    ) from None
                errors.append(
                    {
                        "row": row_idx,
                        "column": name,
                        "error": f"{raw!r} is not a valid {target.value}",
                    }
                )
                if on_mismatch == "skip_row":
                    return values, True
                values.append(self.empty_value(target, "default"))
        return values, False

    # ------------------------------------------------------------------
    # Declarative transforms
    # ------------------------------------------------------------------

    def apply_transforms(
        self,
        table: Table,
        sorts: list[dict[str, Any]],
        filters: list[dict[str, Any]],
        variables: dict[str, Any],
    ) -> Table:
        """Apply the stored sort keys, then the per-column filter blocks (CSV-12); a null
        sort key or filter block fails naming its row (REQ-3.1.3.21)."""
        check_entry_nulls("sorts", sorts)
        check_entry_nulls("filters", filters)
        if sorts:
            table = table.order_by(
                *[(_column_ref(key["column"]), key.get("direction", "asc")) for key in sorts]
            )
        for block in filters:
            table = self._apply_filter_block(table, block, variables)
        return table

    def _apply_filter_block(
        self, table: Table, block: dict[str, Any], variables: dict[str, Any]
    ) -> Table:
        """Keep the rows whose cell, bound as ``_cell``, passes the block's check conditions."""
        from wavecore.controls.assertion_evaluator import evaluate_assertions

        conditions = block["conditions"]
        col_type = ColumnType(block["asType"])
        for row in conditions:
            if row["type"] == "literal":
                validate_filter_operator(col_type, row["operator"])
        cells = table.col(_column_ref(block["column"]))
        keep = [
            i
            for i, cell in enumerate(cells)
            if evaluate_assertions(conditions, {**variables, "_cell": cell}).passed
        ]
        result = Table(columns=list(zip(table.col_names(), table.col_types(), strict=True)))
        for i in keep:
            result.add_row(table.row(i).to_list())
        return result

    # ------------------------------------------------------------------
    # Shared parameter validation
    # ------------------------------------------------------------------

    def validate_typing_params(self, params: dict[str, Any]) -> None:
        """Validate the column-typing, empty-cell and mismatch parameters."""
        self._validate_column_types(params)
        self._validate_empty_cells(params)
        self._validate_on_mismatch(params)

    def _validate_column_types(self, params: dict[str, Any]) -> None:
        if "column_types" not in params:
            return
        column_types = params["column_types"]
        if column_types not in ("auto", "string", "schema"):
            raise ValueError("Parameter 'column_types' must be one of: auto, string, schema")
        if column_types == "schema" and "schema_source" not in params:
            raise ValueError("Column types 'schema' requires a schema table in 'schema_source'")

    def _validate_empty_cells(self, params: dict[str, Any]) -> None:
        if "empty_cells" in params and params["empty_cells"] not in ("none", "default"):
            raise ValueError("Parameter 'empty_cells' must be one of: none, default")

    def _validate_on_mismatch(self, params: dict[str, Any]) -> None:
        if "on_mismatch" in params and params["on_mismatch"] not in (
            "fail",
            "skip_row",
            "replace_default",
        ):
            raise ValueError(
                "Parameter 'on_mismatch' must be one of: fail, skip_row, replace_default"
            )
