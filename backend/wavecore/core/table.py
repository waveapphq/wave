"""
Table class for structured data with mutable operations (REQ-3.5.5.1-4).

Provides:
- Two-dimensional structured data with named, typed columns
- Mutable operations: add/insert/remove rows and columns
- Column types: string, integer, float, boolean (None allowed for any)
- Default column naming: "Column N" where N is 0-based index
- Negative indexing support
"""

from __future__ import annotations

import operator
from collections.abc import Iterator, Sequence
from decimal import Decimal
from enum import Enum
from typing import Any

from wavecore.core.secrets.masking import mask_text
from wavecore.core.secrets.render_scope import active_scan_values
from wavecore.core.variables.decimal_value import decimal_to_str, to_wave_decimal
from wavecore.core.variables.print_form import value_text


class ColumnType(Enum):
    """Column data types."""

    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"


# Display limits for the human-readable rendering (str(table)).
MAX_DISPLAY_ROWS = 10
MAX_DISPLAY_COLS = 12
MAX_CELL_DISPLAY = 200
MAX_COL_WIDTH = 40

_COLUMN_GAP = "  "
_ELLIPSIS = "..."


def _render_cell(value: Any, scan_values: Sequence[str]) -> str:
    """A cell is masked before it is measured or cut, so no layout can disclose a
    protected value's length and no cut can strand an unmaskable prefix."""
    rendered = mask_text(value_text(value), scan_values)
    if len(rendered) > MAX_CELL_DISPLAY:
        return f"a {len(rendered)}-character value"
    return rendered


def _fit(text: str, width: int, right: bool, last: bool) -> str:
    """One column field: cut with an ellipsis when over width, then aligned."""
    if len(text) > width:
        text = text[: width - len(_ELLIPSIS)] + _ELLIPSIS
    if right:
        return text.rjust(width)
    if last:
        return text
    return text.ljust(width)


def _coerce_table_cell(value: Any, idx: int, float_cols: set[int], int_cols: set[int]) -> Any:
    """Realize a stored cell to its column's runtime type: a float cell to an exact
    Decimal, an integer digit-string to an exact (arbitrary-precision) int. A value
    that does not parse passes through unchanged for cell validation to flag."""
    if idx in float_cols:
        return to_wave_decimal(value)
    if idx in int_cols and isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return value
    return value


class TableRowView:
    """
    Read-only view of a table row.

    Supports reading via index, column name, or iteration, but raises
    TypeError on any attempt to modify.
    """

    __slots__ = ("_data", "_column_names")

    _data: list[Any]
    _column_names: list[str]

    def __init__(self, data: list[Any], column_names: list[str]) -> None:
        object.__setattr__(self, "_data", data)
        object.__setattr__(self, "_column_names", column_names)

    def __getitem__(self, key: int | str) -> Any:
        """
        Get cell value by index or column name.

        Args:
            key: Column index (int, supports negative) or column name (str)

        Returns:
            Cell value

        Raises:
            IndexError: If column index out of range
            KeyError: If column name not found
        """
        if isinstance(key, str):
            if key not in self._column_names:
                raise KeyError(f"Column '{key}' not found")
            idx = self._column_names.index(key)
            return self._data[idx]
        else:
            # Handle negative indexing
            if key < -len(self._data) or key >= len(self._data):
                raise IndexError(f"Column index {key} out of range (0 to {len(self._data) - 1})")
            return self._data[key]

    def __setitem__(self, key: int | str, value: Any) -> None:
        """Raise error on assignment attempt."""
        raise TypeError(
            "Cannot assign via t[row][col] = value. Use t.set_cell(value, row, col) instead."
        )

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self) -> Iterator[Any]:
        return iter(self._data)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, list | TableRowView):
            return list(self._data) == list(other)
        return False

    def __repr__(self) -> str:
        return f"TableRowView({self._data})"

    def __setattr__(self, name: str, value: Any) -> None:
        raise TypeError("TableRowView is read-only")

    def to_list(self) -> list[Any]:
        """Convert to plain list."""
        return list(self._data)


class Table:
    """
    Mutable table with typed columns.

    Provides structured 2D data with:
    - Named columns with enforced types
    - Row and column manipulation
    - Cell access by index or name
    """

    def __init__(
        self,
        columns: list[str] | list[tuple[str, str]] | None = None,
    ) -> None:
        """
        Initialize table with optional column definitions.

        Args:
            columns: Column definitions, either:
                - List of names: ['a', 'b'] (type defaults to STRING)
                - List of (name, type) tuples: [('a', 'integer'), ('b', 'string')]

        Examples:
            Table()  # Empty table
            Table(columns=['name', 'age'])  # String columns
            Table(columns=[('name', 'string'), ('age', 'integer')])
        """
        self._column_names: list[str] = []
        self._column_types: list[ColumnType] = []
        self._rows: list[list[Any]] = []

        if columns:
            for col in columns:
                if isinstance(col, tuple):
                    name, type_str = col
                    self._column_names.append(name)
                    self._column_types.append(ColumnType(type_str))
                else:
                    self._column_names.append(col)
                    self._column_types.append(ColumnType.STRING)

    # =========================================================================
    # Column and Row Counts
    # =========================================================================

    def __len__(self) -> int:
        """Get number of rows."""
        return len(self._rows)

    def row_count(self) -> int:
        """Get number of rows."""
        return len(self._rows)

    def col_count(self) -> int:
        """Get number of columns."""
        return len(self._column_names)

    def cell_count(self) -> int:
        """Get total number of cells (rows * columns)."""
        return len(self._rows) * len(self._column_names)

    def col_names(self) -> list[str]:
        """Get list of column names."""
        return list(self._column_names)

    def col_types(self) -> list[str]:
        """Get list of column types as strings."""
        return [ct.value for ct in self._column_types]

    # =========================================================================
    # Read Access
    # =========================================================================

    def __getitem__(self, row_idx: int) -> TableRowView:
        """
        Get row by index as a read-only view.

        Args:
            row_idx: Row index (supports negative indexing)

        Returns:
            TableRowView for reading (raises on assignment)

        Raises:
            IndexError: If row index out of range
        """
        self._validate_row_index(row_idx)
        return TableRowView(self._rows[row_idx], self._column_names)

    def row(self, row_idx: int) -> TableRowView:
        """
        Get row by index as a read-only view.

        Args:
            row_idx: Row index (supports negative indexing)

        Returns:
            TableRowView for reading (raises on assignment)
        """
        return self[row_idx]

    def col(self, col: str | int) -> list[Any]:
        """
        Get entire column as a list.

        Args:
            col: Column name (str) or column index (int)

        Returns:
            List of values in the column

        Raises:
            KeyError: If column name not found
            IndexError: If column index out of range
        """
        col_idx = self._resolve_col_index(col)
        return [row[col_idx] for row in self._rows]

    def cell(self, row_idx: int, col: str | int) -> Any:
        """
        Get single cell value.

        Args:
            row_idx: Row index (supports negative indexing)
            col: Column name (str) or column index (int)

        Returns:
            Cell value
        """
        self._validate_row_index(row_idx)
        col_idx = self._resolve_col_index(col)
        return self._rows[row_idx][col_idx]

    def __iter__(self) -> Iterator[TableRowView]:
        """Iterate over rows as read-only views."""
        for row in self._rows:
            yield TableRowView(row, self._column_names)

    def __bool__(self) -> bool:
        """Table is truthy if it has rows."""
        return len(self._rows) > 0

    # =========================================================================
    # Write Access
    # =========================================================================

    def set_cell(self, value: Any, row_idx: int, col: str | int) -> None:
        """
        Set single cell value.

        Args:
            value: Value to set (must match column type, or None)
            row_idx: Row index (supports negative indexing)
            col: Column name (str) or column index (int)

        Raises:
            IndexError: If row index out of range
            KeyError: If column name not found
            TypeError: If value doesn't match column type
        """
        self._validate_row_index(row_idx)
        col_idx = self._resolve_col_index(col)
        validated = self._validate_cell_value(value, col_idx)
        self._rows[row_idx][col_idx] = validated

    def set_row(self, values: list[Any], row_idx: int) -> None:
        """
        Set row values starting from column 0.

        If values list is shorter than column count, remaining columns unchanged.
        If values list is longer, extra values are ignored.

        Args:
            values: List of values to set
            row_idx: Row index (supports negative indexing)

        Raises:
            IndexError: If row index out of range
            TypeError: If any value doesn't match column type
        """
        self._validate_row_index(row_idx)
        for i, value in enumerate(values):
            if i >= len(self._column_names):
                break
            validated = self._validate_cell_value(value, i)
            self._rows[row_idx][i] = validated

    def clear(self) -> None:
        """Remove all rows, keep column schema."""
        self._rows = []

    # =========================================================================
    # Row Operations
    # =========================================================================

    def add_row(self, values: list[Any] | None = None) -> None:
        """
        Append a row to the table.

        Args:
            values: Row values. If shorter than column count, remaining
                    columns filled with None. If None, all columns are None.

        Raises:
            TypeError: If any value doesn't match column type
        """
        row = self._build_row(values)
        self._rows.append(row)

    def insert_row(self, values: list[Any] | None, row_idx: int) -> None:
        """
        Insert a row at specified index.

        Args:
            values: Row values (None fills with None)
            row_idx: Index to insert at (supports negative indexing)
                    -1 inserts before last row, -2 before second-to-last, etc.

        Raises:
            IndexError: If row index out of valid insert range
            TypeError: If any value doesn't match column type
        """
        # Handle negative indexing like Python's list.insert()
        # -1 means before last element, -2 before second-to-last, etc.
        if row_idx < 0:
            row_idx = len(self._rows) + row_idx
            if row_idx < 0:
                row_idx = 0
        if row_idx > len(self._rows):
            raise IndexError(f"Row index {row_idx} out of range for insert")

        row = self._build_row(values)
        self._rows.insert(row_idx, row)

    def remove_row(self, row_idx: int) -> None:
        """
        Remove row at specified index.

        Args:
            row_idx: Row index (supports negative indexing)

        Raises:
            IndexError: If row index out of range
        """
        self._validate_row_index(row_idx)
        del self._rows[row_idx]

    # =========================================================================
    # Column Operations
    # =========================================================================

    def add_col(
        self,
        values: list[Any] | None = None,
        name: str | None = None,
        col_type: str = "string",
    ) -> None:
        """
        Append a column to the table.

        Args:
            values: Column values. If shorter than row count, remaining
                    rows filled with None. If None, all rows get None.
            name: Column name. If None, defaults to "Column N".
            col_type: Column type (string, integer, float, boolean)

        Raises:
            TypeError: If any value doesn't match column type
            ValueError: If column name already exists
        """
        if name is None:
            name = f"Column {len(self._column_names)}"

        if name in self._column_names:
            raise ValueError(f"Column '{name}' already exists")

        ctype = ColumnType(col_type)
        self._column_names.append(name)
        self._column_types.append(ctype)

        # Add values to existing rows
        col_idx = len(self._column_names) - 1
        for i, row in enumerate(self._rows):
            value = values[i] if values and i < len(values) else None
            validated = self._validate_cell_value(value, col_idx)
            row.append(validated)

    def insert_col(
        self,
        values: list[Any] | None,
        col_idx: int,
        name: str | None = None,
        col_type: str = "string",
    ) -> None:
        """
        Insert a column at specified index.

        Args:
            values: Column values (None fills with None)
            col_idx: Index to insert at (supports negative indexing)
            name: Column name. If None, defaults to "Column N".
            col_type: Column type (string, integer, float, boolean)

        Raises:
            IndexError: If column index out of valid insert range
            TypeError: If any value doesn't match column type
            ValueError: If column name already exists
        """
        # Handle negative indexing like Python's list.insert()
        if col_idx < 0:
            col_idx = len(self._column_names) + col_idx
            if col_idx < 0:
                col_idx = 0
        if col_idx > len(self._column_names):
            raise IndexError(f"Column index {col_idx} out of range for insert")

        if name is None:
            name = f"Column {col_idx}"

        if name in self._column_names:
            raise ValueError(f"Column '{name}' already exists")

        ctype = ColumnType(col_type)
        self._column_names.insert(col_idx, name)
        self._column_types.insert(col_idx, ctype)

        # Insert values into existing rows
        for i, row in enumerate(self._rows):
            value = values[i] if values and i < len(values) else None
            validated = self._validate_cell_value(value, col_idx)
            row.insert(col_idx, validated)

    def remove_col(self, col: str | int) -> None:
        """
        Remove column by name or index.

        Args:
            col: Column name (str) or column index (int)

        Raises:
            KeyError: If column name not found
            IndexError: If column index out of range
        """
        col_idx = self._resolve_col_index(col)

        del self._column_names[col_idx]
        del self._column_types[col_idx]

        for row in self._rows:
            del row[col_idx]

    # =========================================================================
    # Query Operations (non-mutating)
    # =========================================================================

    def filter(self, column: str | int) -> ColumnFilter:
        """Name a column to compare; the returned step's operators select the rows.

        Non-mutating and chainable (chained filters AND together). A None cell
        answers by the check rule: it holds nothing (REQ-3.1.3.25).
        """
        return ColumnFilter(self, self._resolve_col_index(column))

    def _rows_matching(self, col_idx: int, operator: str, value: Any) -> Table:
        """Return a new table of the rows whose cell in `col_idx` satisfies `operator`."""
        col_type = self._column_types[col_idx]
        result = self._clone()
        result._rows = [
            row for row in result._rows if cell_matches(row[col_idx], col_type, operator, value)
        ]
        return result

    def order_by(self, *keys: tuple[str | int, str] | str | int) -> Table:
        """Return a new table sorted by one or more column keys in priority order.

        Each key is a bare column (ascending) or a (column, direction) tuple; the
        first key is the most significant. Stable; missing cells (None) sort last
        regardless of direction. Non-mutating.
        """
        parsed: list[tuple[int, str]] = []
        for key in keys:
            column, direction = _split_order_key(key)
            parsed.append((self._resolve_col_index(column), direction))
        result = self._clone()
        rows = result._rows
        for col_idx, direction in reversed(parsed):
            present = [row for row in rows if row[col_idx] is not None]
            missing = [row for row in rows if row[col_idx] is None]
            present.sort(key=operator.itemgetter(col_idx), reverse=direction == "desc")
            rows = present + missing
        result._rows = rows
        return result

    def _clone(self) -> Table:
        """Deep-copy into a new table (rows copied per-row to avoid view aliasing)."""
        new = Table()
        new._column_names = list(self._column_names)
        new._column_types = list(self._column_types)
        new._rows = [list(row) for row in self._rows]
        return new

    # =========================================================================
    # Serialization
    # =========================================================================

    def to_list(self) -> list[dict[str, Any]]:
        """
        Convert table to list of row dictionaries.

        Returns:
            List of dictionaries with column names as keys
        """
        return [{name: row[i] for i, name in enumerate(self._column_names)} for row in self._rows]

    def to_dict(self) -> dict[str, Any]:
        """
        Serialize table to dictionary for storage.

        Returns:
            Dictionary with columns (schema) and rows (data)
        """
        return {
            "columns": [
                {"name": name, "type": ctype.value}
                for name, ctype in zip(self._column_names, self._column_types, strict=True)
            ],
            # Float cells are exact Decimals; render them as plain decimal strings
            # so storage never carries E notation (REQ-3.1.3.14).
            "rows": [
                [decimal_to_str(cell) if isinstance(cell, Decimal) else cell for cell in row]
                for row in self._rows
            ],
        }

    @classmethod
    def from_list(cls, data: list[dict[str, Any]]) -> Table:
        """
        Create table from list of row dictionaries, inferring schema.

        Args:
            data: List of dictionaries with consistent keys

        Returns:
            New Table instance

        Note:
            Column types are inferred from first row values.
            Column order matches first row's key order.
        """
        if not data:
            return cls()

        # Infer columns from first row
        first_row = data[0]
        columns: list[tuple[str, str]] = []
        for key, value in first_row.items():
            col_type = cls._infer_type(value)
            columns.append((key, col_type.value))

        table = cls(columns=columns)

        # Add rows
        for row_dict in data:
            values = [row_dict.get(name) for name in table._column_names]
            table.add_row(values)

        return table

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Table:
        """
        Deserialize table from dictionary.

        Args:
            data: Dictionary with 'columns' and 'rows' keys

        Returns:
            New Table instance
        """
        columns_data = data.get("columns", [])
        columns = [(c["name"], c["type"]) for c in columns_data]

        table = cls(columns=columns)

        # The web UI carries float cells as plain-decimal strings and integer
        # cells as exact digit-strings (precision past double / 2^53). Coerce both
        # back so cell validation (Decimal- / int-typed) accepts them; a value that
        # does not parse passes through for validation to flag.
        float_cols = {
            idx for idx, (_, ctype) in enumerate(columns) if ctype == ColumnType.FLOAT.value
        }
        int_cols = {
            idx for idx, (_, ctype) in enumerate(columns) if ctype == ColumnType.INTEGER.value
        }
        for row_values in data.get("rows", []):
            coerced = [
                _coerce_table_cell(value, idx, float_cols, int_cols)
                for idx, value in enumerate(row_values)
            ]
            table.add_row(coerced)

        return table

    # =========================================================================
    # Internal Helpers
    # =========================================================================

    def _validate_row_index(self, row_idx: int) -> None:
        """Validate row index is in range."""
        if not self._rows:
            raise IndexError("Table has no rows")
        if row_idx < -len(self._rows) or row_idx >= len(self._rows):
            raise IndexError(f"Row index {row_idx} out of range (0 to {len(self._rows) - 1})")

    def _resolve_col_index(self, col: str | int) -> int:
        """Resolve column name or index to index."""
        if isinstance(col, str):
            if col not in self._column_names:
                raise KeyError(f"Column '{col}' not found")
            return self._column_names.index(col)
        else:
            if not self._column_names:
                raise IndexError("Table has no columns")
            # Handle negative indexing
            if col < 0:
                col = len(self._column_names) + col
            if col < 0 or col >= len(self._column_names):
                raise IndexError(
                    f"Column index {col} out of range (0 to {len(self._column_names) - 1})"
                )
            return col

    def _validate_cell_value(self, value: Any, col_idx: int) -> Any:
        """Validate and return cell value for column type."""
        if value is None:
            return None

        col_type = self._column_types[col_idx]

        if col_type == ColumnType.STRING:
            if not isinstance(value, str):
                raise TypeError(
                    f"Column '{self._column_names[col_idx]}' expects string, "
                    f"got {type(value).__name__}"
                )
        elif col_type == ColumnType.INTEGER:
            if not isinstance(value, int) or isinstance(value, bool):
                raise TypeError(
                    f"Column '{self._column_names[col_idx]}' expects integer, "
                    f"got {type(value).__name__}"
                )
        elif col_type == ColumnType.FLOAT:
            if not isinstance(value, int | float | Decimal) or isinstance(value, bool):
                raise TypeError(
                    f"Column '{self._column_names[col_idx]}' expects float, "
                    f"got {type(value).__name__}"
                )
        elif col_type == ColumnType.BOOLEAN and not isinstance(value, bool):
            raise TypeError(
                f"Column '{self._column_names[col_idx]}' expects boolean, "
                f"got {type(value).__name__}"
            )

        return value

    def _build_row(self, values: list[Any] | None) -> list[Any]:
        """Build a complete row, padding with None as needed."""
        row: list[Any] = []
        for i in range(len(self._column_names)):
            value = values[i] if values and i < len(values) else None
            validated = self._validate_cell_value(value, i)
            row.append(validated)
        return row

    @staticmethod
    def _infer_type(value: Any) -> ColumnType:
        """Infer column type from value."""
        if isinstance(value, bool):
            return ColumnType.BOOLEAN
        elif isinstance(value, int):
            return ColumnType.INTEGER
        elif isinstance(value, float | Decimal):
            return ColumnType.FLOAT
        else:
            return ColumnType.STRING

    # =========================================================================
    # String Representation
    # =========================================================================

    def __repr__(self) -> str:
        """String representation."""
        cols = ", ".join(self._column_names) if self._column_names else "no columns"
        return f"Table([{cols}], {len(self._rows)} rows)"

    def __str__(self) -> str:
        """Aligned human-readable rendering, built as a slice: rows and columns
        past their caps are never rendered, and every cap announces itself."""
        if not self._column_names:
            return "Table (empty)"

        shown_cols = min(len(self._column_names), MAX_DISPLAY_COLS)
        names = self._column_names[:shown_cols]
        types = [ctype.value for ctype in self._column_types[:shown_cols]]
        rights = [
            ctype in (ColumnType.INTEGER, ColumnType.FLOAT)
            for ctype in self._column_types[:shown_cols]
        ]
        scan_values = active_scan_values()
        cells = [
            [_render_cell(row[idx], scan_values) for idx in range(shown_cols)]
            for row in self._rows[:MAX_DISPLAY_ROWS]
        ]
        widths = [
            min(
                MAX_COL_WIDTH,
                max([len(names[idx]), len(types[idx])] + [len(row[idx]) for row in cells]),
            )
            for idx in range(shown_cols)
        ]

        lines = [f"Table ({self.row_count()} rows x {self.col_count()} columns)"]
        lines.append(self._render_line(names, widths, rights))
        lines.append(self._render_line(types, widths, rights))
        lines.append(_COLUMN_GAP.join("-" * width for width in widths))
        lines.extend(self._render_line(row, widths, rights) for row in cells)

        if len(self._rows) > MAX_DISPLAY_ROWS:
            lines.append(f"... and {len(self._rows) - MAX_DISPLAY_ROWS} more rows")
        if len(self._column_names) > shown_cols:
            lines.append(f"... and {len(self._column_names) - shown_cols} more columns")

        return "\n".join(lines)

    @staticmethod
    def _render_line(fields: list[str], widths: list[int], rights: list[bool]) -> str:
        last = len(widths) - 1
        return _COLUMN_GAP.join(
            _fit(field, widths[idx], rights[idx], idx == last) for idx, field in enumerate(fields)
        )


class ColumnFilter:
    """One column of a table, awaiting the comparison that selects its rows.

    Every operator returns a new table, so filters chain conjunctively and flow
    on into further filtering or ordering.
    """

    def __init__(self, table: Table, col_idx: int) -> None:
        self._table = table
        self._col_idx = col_idx

    def _apply(self, operator: str, value: Any = None) -> Table:
        col_type = self._table.col_types()[self._col_idx]
        if not operator_available(ColumnType(col_type), operator):
            name = self._table.col_names()[self._col_idx]
            raise ValueError(
                f"Operator {operator!r} is not available for {col_type} column {name!r}"
            )
        return self._table._rows_matching(self._col_idx, operator, value)

    def equals(self, value: Any) -> Table:
        """Rows whose cell equals `value`."""
        return self._apply("equals", value)

    def not_equals(self, value: Any) -> Table:
        """Rows whose cell differs from `value`."""
        return self._apply("not_equals", value)

    def less_than(self, value: Any) -> Table:
        """Rows whose cell orders before `value`."""
        return self._apply("less_than", value)

    def greater_than(self, value: Any) -> Table:
        """Rows whose cell orders after `value`."""
        return self._apply("greater_than", value)

    def less_or_equal(self, value: Any) -> Table:
        """Rows whose cell orders before `value` or equals it."""
        return self._apply("less_or_equal", value)

    def greater_or_equal(self, value: Any) -> Table:
        """Rows whose cell orders after `value` or equals it."""
        return self._apply("greater_or_equal", value)

    def contains(self, value: Any) -> Table:
        """Rows whose cell contains `value` as text."""
        return self._apply("contains", value)

    def does_not_contain(self, value: Any) -> Table:
        """Rows whose cell does not contain `value` as text."""
        return self._apply("does_not_contain", value)

    def starts_with(self, value: Any) -> Table:
        """Rows whose cell starts with `value`."""
        return self._apply("starts_with", value)

    def ends_with(self, value: Any) -> Table:
        """Rows whose cell ends with `value`."""
        return self._apply("ends_with", value)

    def matches_regex(self, value: Any) -> Table:
        """Rows whose cell matches the regular expression `value`."""
        return self._apply("matches_regex", value)

    def is_true(self) -> Table:
        """Rows whose cell is true."""
        return self._apply("is_true")

    def is_false(self) -> Table:
        """Rows whose cell is false."""
        return self._apply("is_false")

    def is_empty(self) -> Table:
        """Rows whose cell has no value."""
        return self._apply("is_empty")

    def is_not_empty(self) -> Table:
        """Rows whose cell has a value."""
        return self._apply("is_not_empty")

    def is_null(self) -> Table:
        """Rows whose cell is null."""
        return self._apply("is_null")

    def is_not_null(self) -> Table:
        """Rows whose cell holds a value."""
        return self._apply("is_not_null")


# =============================================================================
# Filter / order helpers (shared by Table.filter and the CSV Transform builder)
# =============================================================================

_EMPTY_FILTER_OPERATORS = frozenset({"is_empty", "is_not_empty"})


def _check_row_operators(col_type: ColumnType) -> frozenset[str]:
    """The operators a check offers for the column's type, is null and not null included."""
    from wavecore.controls.assertion_evaluator import CHECK_OPERATORS, NULL_OPERATORS

    return CHECK_OPERATORS[col_type.value] | NULL_OPERATORS


def operator_available(col_type: ColumnType, operator: str) -> bool:
    """Whether `operator` is a `Table.filter()` operator for `col_type`."""
    return operator in _check_row_operators(col_type) or operator in _EMPTY_FILTER_OPERATORS


def validate_filter_operator(col_type: ColumnType, operator: str) -> None:
    """Raise ValueError if a literal filter row on a `col_type` column may not use `operator`."""
    if operator not in _check_row_operators(col_type):
        raise ValueError(f"Unknown filter operator: {operator!r}")


def cell_matches(cell: Any, col_type: ColumnType, operator: str, value: Any) -> bool:
    """Return whether `cell` satisfies a (pre-validated) typed filter operator.

    A null cell holds nothing, so it answers by the check rule (REQ-3.1.3.25).
    """
    if operator in ("is_empty", "is_null"):
        return cell is None
    if operator in ("is_not_empty", "is_not_null"):
        return cell is not None
    from wavecore.controls.assertion_evaluator import (
        HOLDS_ON_NULL,
        _compare_boolean,
        _compare_numeric,
        _compare_string,
    )

    if cell is None:
        return operator in HOLDS_ON_NULL
    if col_type in (ColumnType.INTEGER, ColumnType.FLOAT):
        return _compare_numeric(cell, operator, value, col_type.value)
    if col_type == ColumnType.STRING:
        return _compare_string(cell, operator, value)
    return _compare_boolean(cell, operator)


def _split_order_key(key: tuple[str | int, str] | str | int) -> tuple[str | int, str]:
    """Split an order_by key into (column, direction), validating direction."""
    if isinstance(key, tuple):
        column, direction = key
    else:
        column, direction = key, "asc"
    if direction not in ("asc", "desc"):
        raise ValueError(f"Sort direction must be 'asc' or 'desc', got {direction!r}")
    return column, direction
