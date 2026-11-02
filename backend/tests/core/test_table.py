"""
Tests for Table class.

Tests the 23+ operations specified in the Table API:
1. t.col('name') - column by name
2. t.col(0) - column by index
3. t.row(0) - row as list
4. t[0] - row as list
5. t[0][1] - cell access
6. t.cell(0, 'col') - cell by name
7. t.cell(0, 0) - cell by index
8. t.row_count() - row count
9. t.col_count() - column count
10. t.cell_count() - total cells
11. t.col_names() - column names
12. t.col_types() - column types
13. t.clear() - remove all rows
14. t.add_row([]) - append row
15. t.insert_row([], 0) - insert row
16. t.add_col([], 'name') - append column with name
17. t.add_col([]) - append column with default name
18. t.insert_col([], 0, 'name') - insert column
19. t.set_cell(x, 0, 0) - set cell
20. t.set_row([x,y], 0) - set row values
21. t.remove_row(0) - delete row
22. t.remove_col('name') - delete column by name
23. t.remove_col(0) - delete column by index
24. len(t) - row count (Pythonic)
"""

from decimal import Decimal

import pytest

from wavecore.core.logging.formatter import MAX_MESSAGE_DISPLAY
from wavecore.core.secrets.registry import SecretRegistry
from wavecore.core.secrets.render_scope import render_scope
from wavecore.core.table import (
    MAX_CELL_DISPLAY,
    MAX_COL_WIDTH,
    MAX_DISPLAY_COLS,
    MAX_DISPLAY_ROWS,
    ColumnFilter,
    ColumnType,
    Table,
    TableRowView,
    validate_filter_operator,
)

# =============================================================================
# Table Creation Tests
# =============================================================================


class TestTableCreation:
    """Tests for Table creation."""

    def test_create_empty_table(self) -> None:
        """Test creating empty table."""
        table = Table()

        assert table.row_count() == 0
        assert table.col_count() == 0

    def test_create_with_column_names(self) -> None:
        """Test creating table with column names (default STRING type)."""
        table = Table(columns=["name", "city"])

        assert table.col_count() == 2
        assert table.col_names() == ["name", "city"]
        assert table.col_types() == ["string", "string"]

    def test_create_with_typed_columns(self) -> None:
        """Test creating table with typed columns."""
        table = Table(
            columns=[
                ("id", "integer"),
                ("name", "string"),
                ("score", "float"),
                ("active", "boolean"),
            ]
        )

        assert table.col_count() == 4
        assert table.col_names() == ["id", "name", "score", "active"]
        assert table.col_types() == ["integer", "string", "float", "boolean"]

    def test_from_list(self) -> None:
        """Test creating table from list of dicts (infer schema)."""
        data = [
            {"id": 1, "name": "Alice", "score": 95.5, "active": True},
            {"id": 2, "name": "Bob", "score": 87.0, "active": False},
        ]

        table = Table.from_list(data)

        assert table.row_count() == 2
        assert table.col_count() == 4
        assert table.cell(0, "name") == "Alice"
        assert table.col_types() == ["integer", "string", "float", "boolean"]

    def test_from_list_empty(self) -> None:
        """Test creating table from empty list."""
        table = Table.from_list([])

        assert table.row_count() == 0
        assert table.col_count() == 0

    def test_from_dict(self) -> None:
        """Test deserializing table from dict."""
        data = {
            "columns": [
                {"name": "x", "type": "integer"},
                {"name": "y", "type": "string"},
            ],
            "rows": [[1, "a"], [2, "b"]],
        }

        table = Table.from_dict(data)

        assert table.row_count() == 2
        assert table.col_names() == ["x", "y"]
        assert table.cell(0, 0) == 1

    def test_from_dict_coerces_digit_string_integers_and_decimal_floats(self) -> None:
        """The web UI carries int/float cells as exact strings (precision past
        2^53 / double); from_dict realizes them to int / Decimal so a big id and a
        long decimal survive verbatim and pass cell validation."""
        data = {
            "columns": [
                {"name": "id", "type": "integer"},
                {"name": "rate", "type": "float"},
            ],
            "rows": [["12345678901234567890", "0.1234567890123456789"], [7, None]],
        }

        table = Table.from_dict(data)

        assert table.cell(0, "id") == 12345678901234567890
        assert isinstance(table.cell(0, "id"), int)
        assert table.cell(0, "rate") == Decimal("0.1234567890123456789")
        assert table.cell(1, "id") == 7
        assert table.cell(1, "rate") is None

    def test_from_dict_passes_a_non_integer_string_through_to_validation(self) -> None:
        """A cell that does not parse as an integer is not silently swallowed - it
        passes through and the int column's cell validation rejects it."""
        data = {
            "columns": [{"name": "id", "type": "integer"}],
            "rows": [["not-a-number"]],
        }

        with pytest.raises(TypeError, match="expects integer"):
            Table.from_dict(data)


# =============================================================================
# Count Operations Tests
# =============================================================================


class TestCountOperations:
    """Tests for count operations."""

    def test_len(self) -> None:
        """Test len() returns row count."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        table.add_row(["z", "w"])

        assert len(table) == 2

    def test_row_count(self) -> None:
        """Test row_count()."""
        table = Table(columns=["a"])
        table.add_row(["x"])
        table.add_row(["y"])
        table.add_row(["z"])

        assert table.row_count() == 3

    def test_col_count(self) -> None:
        """Test col_count()."""
        table = Table(columns=["a", "b", "c"])

        assert table.col_count() == 3

    def test_cell_count(self) -> None:
        """Test cell_count() returns rows * cols."""
        table = Table(columns=["a", "b", "c"])
        table.add_row(["1", "2", "3"])
        table.add_row(["4", "5", "6"])

        assert table.cell_count() == 6  # 2 rows * 3 cols

    def test_cell_count_empty(self) -> None:
        """Test cell_count() on empty table."""
        table = Table(columns=["a", "b"])

        assert table.cell_count() == 0

    def test_col_names(self) -> None:
        """Test col_names()."""
        table = Table(columns=["first", "second", "third"])

        assert table.col_names() == ["first", "second", "third"]

    def test_col_types(self) -> None:
        """Test col_types()."""
        table = Table(columns=[("a", "integer"), ("b", "string")])

        assert table.col_types() == ["integer", "string"]


# =============================================================================
# Read Access Tests
# =============================================================================


class TestTableRowView:
    """Tests for TableRowView class."""

    def test_len(self) -> None:
        """Test len(row) returns number of columns."""
        table = Table(columns=[("a", "integer"), ("b", "integer"), ("c", "integer")])
        table.add_row([1, 2, 3])
        row = table[0]

        assert len(row) == 3

    def test_iter(self) -> None:
        """Test iterating over row values."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        row = table[0]

        assert list(row) == ["x", "y"]

    def test_getitem_by_index(self) -> None:
        """Test row[0] gets cell by index."""
        table = Table(columns=[("a", "integer"), ("b", "string")])
        table.add_row([42, "hello"])
        row = table[0]

        assert row[0] == 42
        assert row[1] == "hello"

    def test_getitem_by_name(self) -> None:
        """Test row['col_name'] gets cell by column name."""
        table = Table(columns=[("id", "integer"), ("name", "string"), ("score", "float")])
        table.add_row([1, "Alice", 95.5])
        row = table[0]

        assert row["id"] == 1
        assert row["name"] == "Alice"
        assert row["score"] == 95.5

    def test_getitem_negative_index(self) -> None:
        """Test row[-1] gets last cell."""
        table = Table(columns=[("a", "integer"), ("b", "integer"), ("c", "integer")])
        table.add_row([1, 2, 3])
        row = table[0]

        assert row[-1] == 3
        assert row[-2] == 2
        assert row[-3] == 1

    def test_getitem_invalid_name(self) -> None:
        """Test row['missing'] raises KeyError."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        row = table[0]

        with pytest.raises(KeyError, match="not found"):
            _ = row["missing"]

    def test_getitem_invalid_index(self) -> None:
        """Test row[99] raises IndexError."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        row = table[0]

        with pytest.raises(IndexError, match="out of range"):
            _ = row[99]

    def test_getitem_invalid_negative_index(self) -> None:
        """Test row[-99] raises IndexError."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        row = table[0]

        with pytest.raises(IndexError, match="out of range"):
            _ = row[-99]

    def test_eq_with_non_list(self) -> None:
        """Test row != non-list returns False."""
        table = Table(columns=["a"])
        table.add_row(["x"])
        row = table[0]

        assert (row == "not a list") is False
        assert (row == {"a": "x"}) is False

    def test_repr(self) -> None:
        """Test TableRowView repr."""
        table = Table(columns=[("a", "integer"), ("b", "integer")])
        table.add_row([1, 2])
        row = table[0]

        assert repr(row) == "TableRowView([1, 2])"

    def test_setattr_raises_error(self) -> None:
        """Test row.attr = x raises TypeError."""
        table = Table(columns=["a"])
        table.add_row(["x"])
        row = table[0]

        with pytest.raises(TypeError, match="read-only"):
            row.some_attr = "value"

    def test_setitem_by_name_raises_error(self) -> None:
        """Test row['col'] = x raises TypeError."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        row = table[0]

        with pytest.raises(TypeError, match="Cannot assign"):
            row["a"] = "z"

    def test_to_list(self) -> None:
        """Test row.to_list() returns a copy."""
        table = Table(columns=[("a", "integer"), ("b", "integer")])
        table.add_row([1, 2])
        row = table[0]

        result = row.to_list()
        assert result == [1, 2]
        assert isinstance(result, list)


# =============================================================================
# Read Access Tests
# =============================================================================


class TestReadAccess:
    """Tests for read access operations."""

    @pytest.fixture
    def sample_table(self) -> Table:
        """Sample table with data."""
        table = Table(
            columns=[
                ("id", "integer"),
                ("name", "string"),
                ("score", "float"),
            ]
        )
        table.add_row([1, "Alice", 95.5])
        table.add_row([2, "Bob", 87.0])
        table.add_row([3, "Charlie", 92.3])
        return table

    def test_getitem(self, sample_table: Table) -> None:
        """Test t[0] returns row as TableRowView."""
        row = sample_table[0]

        assert row == [1, "Alice", 95.5]
        assert isinstance(row, TableRowView)

    def test_getitem_negative(self, sample_table: Table) -> None:
        """Test t[-1] returns last row."""
        row = sample_table[-1]

        assert row == [3, "Charlie", 92.3]

    def test_row(self, sample_table: Table) -> None:
        """Test t.row(0) returns row as list."""
        row = sample_table.row(1)

        assert row == [2, "Bob", 87.0]

    def test_row_negative(self, sample_table: Table) -> None:
        """Test t.row(-2) works."""
        row = sample_table.row(-2)

        assert row == [2, "Bob", 87.0]

    def test_cell_subscript(self, sample_table: Table) -> None:
        """Test t[0][1] gets cell value."""
        value = sample_table[0][1]

        assert value == "Alice"

    def test_cell_by_name(self, sample_table: Table) -> None:
        """Test t.cell(row, 'col_name')."""
        value = sample_table.cell(0, "name")

        assert value == "Alice"

    def test_cell_by_index(self, sample_table: Table) -> None:
        """Test t.cell(row, col_idx)."""
        value = sample_table.cell(1, 2)

        assert value == 87.0

    def test_cell_negative_row(self, sample_table: Table) -> None:
        """Test t.cell(-1, col) with negative row index."""
        value = sample_table.cell(-1, "name")

        assert value == "Charlie"

    def test_cell_negative_col(self, sample_table: Table) -> None:
        """Test t.cell(row, -1) with negative column index."""
        value = sample_table.cell(0, -1)

        assert value == 95.5

    def test_col_by_name(self, sample_table: Table) -> None:
        """Test t.col('name') gets entire column."""
        column = sample_table.col("name")

        assert column == ["Alice", "Bob", "Charlie"]

    def test_col_by_index(self, sample_table: Table) -> None:
        """Test t.col(0) gets entire column by index."""
        column = sample_table.col(0)

        assert column == [1, 2, 3]

    def test_col_negative_index(self, sample_table: Table) -> None:
        """Test t.col(-1) with negative index."""
        column = sample_table.col(-1)

        assert column == [95.5, 87.0, 92.3]

    def test_iteration(self, sample_table: Table) -> None:
        """Test iterating over table rows."""
        rows = list(sample_table)

        assert len(rows) == 3
        assert rows[0] == [1, "Alice", 95.5]

    def test_bool_non_empty(self, sample_table: Table) -> None:
        """Test bool() on non-empty table."""
        assert bool(sample_table) is True

    def test_bool_empty(self) -> None:
        """Test bool() on empty table."""
        table = Table(columns=["a"])

        assert bool(table) is False


# =============================================================================
# Read Access Error Tests
# =============================================================================


class TestReadAccessErrors:
    """Tests for read access error conditions."""

    def test_getitem_invalid_row(self) -> None:
        """Test t[10] raises IndexError."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        with pytest.raises(IndexError, match="out of range"):
            _ = table[10]

    def test_getitem_empty_table(self) -> None:
        """Test t[0] on empty table raises IndexError."""
        table = Table(columns=["a"])

        with pytest.raises(IndexError, match="no rows"):
            _ = table[0]

    def test_col_invalid_name(self) -> None:
        """Test t.col('missing') raises KeyError."""
        table = Table(columns=["a"])

        with pytest.raises(KeyError, match="not found"):
            table.col("missing")

    def test_col_invalid_index(self) -> None:
        """Test t.col(99) raises IndexError."""
        table = Table(columns=["a"])

        with pytest.raises(IndexError, match="out of range"):
            table.col(99)

    def test_col_empty_table(self) -> None:
        """Test t.col(0) on table with no columns."""
        table = Table()

        with pytest.raises(IndexError, match="no columns"):
            table.col(0)

    def test_cell_invalid_row(self) -> None:
        """Test t.cell(99, 0) raises IndexError."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        with pytest.raises(IndexError, match="out of range"):
            table.cell(99, 0)

    def test_subscript_assignment_raises_error(self) -> None:
        """Test t[0][0] = x raises TypeError."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        with pytest.raises(TypeError, match="Cannot assign via t\\[row\\]\\[col\\]"):
            table[0][0] = "z"


# =============================================================================
# Write Access Tests
# =============================================================================


class TestWriteAccess:
    """Tests for write access operations."""

    def test_set_cell_by_index(self) -> None:
        """Test t.set_cell(value, row, col_idx)."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        table.set_cell("z", 0, 1)

        assert table.cell(0, 1) == "z"

    def test_set_cell_by_name(self) -> None:
        """Test t.set_cell(value, row, 'col_name')."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        table.set_cell("z", 0, "b")

        assert table.cell(0, "b") == "z"

    def test_set_cell_negative_index(self) -> None:
        """Test t.set_cell(value, -1, -1) with negative indices."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        table.set_cell("z", -1, -1)

        assert table.cell(0, 1) == "z"

    def test_set_cell_none(self) -> None:
        """Test setting cell to None."""
        table = Table(columns=[("a", "integer")])
        table.add_row([42])

        table.set_cell(None, 0, 0)

        assert table.cell(0, 0) is None

    def test_set_row(self) -> None:
        """Test t.set_row([values], row_idx)."""
        table = Table(columns=["a", "b", "c"])
        table.add_row(["1", "2", "3"])

        table.set_row(["x", "y"], 0)

        assert table[0] == ["x", "y", "3"]  # third column unchanged

    def test_set_row_negative(self) -> None:
        """Test t.set_row with negative index."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])
        table.add_row(["3", "4"])

        table.set_row(["x", "y"], -1)

        assert table[-1] == ["x", "y"]

    def test_clear(self) -> None:
        """Test t.clear() removes rows but keeps columns."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])
        table.add_row(["z", "w"])

        table.clear()

        assert table.row_count() == 0
        assert table.col_count() == 2
        assert table.col_names() == ["a", "b"]


# =============================================================================
# Write Access Error Tests
# =============================================================================


class TestWriteAccessErrors:
    """Tests for write access error conditions."""

    def test_set_cell_invalid_type(self) -> None:
        """Test setting cell with wrong type raises TypeError."""
        table = Table(columns=[("num", "integer")])
        table.add_row([42])

        with pytest.raises(TypeError, match="expects integer"):
            table.set_cell("not an int", 0, 0)

    def test_set_cell_invalid_row(self) -> None:
        """Test t.set_cell with invalid row raises IndexError."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        with pytest.raises(IndexError, match="out of range"):
            table.set_cell("y", 99, 0)

    def test_set_row_invalid_type(self) -> None:
        """Test set_row with wrong type raises TypeError."""
        table = Table(columns=[("a", "integer"), ("b", "string")])
        table.add_row([1, "x"])

        with pytest.raises(TypeError, match="expects integer"):
            table.set_row(["not int", "y"], 0)


# =============================================================================
# Row Operations Tests
# =============================================================================


class TestRowOperations:
    """Tests for row add/insert/remove operations."""

    def test_add_row(self) -> None:
        """Test t.add_row([values])."""
        table = Table(columns=["a", "b"])

        table.add_row(["x", "y"])

        assert table.row_count() == 1
        assert table[0] == ["x", "y"]

    def test_add_row_partial(self) -> None:
        """Test add_row with fewer values than columns (fill with None)."""
        table = Table(columns=["a", "b", "c"])

        table.add_row(["x"])

        assert table[0] == ["x", None, None]

    def test_add_row_none(self) -> None:
        """Test add_row(None) fills with None."""
        table = Table(columns=["a", "b"])

        table.add_row(None)

        assert table[0] == [None, None]

    def test_insert_row_at_start(self) -> None:
        """Test t.insert_row([values], 0)."""
        table = Table(columns=["a"])
        table.add_row(["first"])
        table.add_row(["second"])

        table.insert_row(["inserted"], 0)

        assert table[0] == ["inserted"]
        assert table[1] == ["first"]
        assert table.row_count() == 3

    def test_insert_row_at_middle(self) -> None:
        """Test insert_row in middle."""
        table = Table(columns=["a"])
        table.add_row(["first"])
        table.add_row(["second"])

        table.insert_row(["middle"], 1)

        assert table[0] == ["first"]
        assert table[1] == ["middle"]
        assert table[2] == ["second"]

    def test_insert_row_negative(self) -> None:
        """Test insert_row with negative index."""
        table = Table(columns=["a"])
        table.add_row(["first"])
        table.add_row(["second"])

        table.insert_row(["inserted"], -1)

        assert table[1] == ["inserted"]
        assert table[2] == ["second"]

    def test_remove_row(self) -> None:
        """Test t.remove_row(0)."""
        table = Table(columns=["a"])
        table.add_row(["first"])
        table.add_row(["second"])

        table.remove_row(0)

        assert table.row_count() == 1
        assert table[0] == ["second"]

    def test_remove_row_negative(self) -> None:
        """Test remove_row with negative index."""
        table = Table(columns=["a"])
        table.add_row(["first"])
        table.add_row(["second"])

        table.remove_row(-1)

        assert table.row_count() == 1
        assert table[0] == ["first"]


# =============================================================================
# Row Operations Error Tests
# =============================================================================


class TestRowOperationsErrors:
    """Tests for row operation error conditions."""

    def test_add_row_invalid_type(self) -> None:
        """Test add_row with wrong type raises TypeError."""
        table = Table(columns=[("num", "integer")])

        with pytest.raises(TypeError, match="expects integer"):
            table.add_row(["not an int"])

    def test_insert_row_out_of_range(self) -> None:
        """Test insert_row with out of range index."""
        table = Table(columns=["a"])

        with pytest.raises(IndexError, match="out of range for insert"):
            table.insert_row(["x"], 99)

    def test_remove_row_invalid(self) -> None:
        """Test remove_row with invalid index."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        with pytest.raises(IndexError, match="out of range"):
            table.remove_row(99)


# =============================================================================
# Column Operations Tests
# =============================================================================


class TestColumnOperations:
    """Tests for column add/insert/remove operations."""

    def test_add_col_with_name(self) -> None:
        """Test t.add_col([values], 'name')."""
        table = Table(columns=["a"])
        table.add_row(["x"])
        table.add_row(["y"])

        table.add_col(["1", "2"], "b")

        assert table.col_count() == 2
        assert table.col_names() == ["a", "b"]
        assert table[0] == ["x", "1"]

    def test_add_col_with_type(self) -> None:
        """Test add_col with explicit type."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        table.add_col([42], "num", col_type="integer")

        assert table.col_types() == ["string", "integer"]
        assert table.cell(0, "num") == 42

    def test_add_col_default_name(self) -> None:
        """Test add_col() without name uses 'Column N'."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        table.add_col(["y"])

        assert table.col_names() == ["a", "Column 1"]

    def test_add_col_partial(self) -> None:
        """Test add_col with fewer values than rows (fill with None)."""
        table = Table(columns=["a"])
        table.add_row(["1"])
        table.add_row(["2"])
        table.add_row(["3"])

        table.add_col(["x"], "b")

        assert table.col("b") == ["x", None, None]

    def test_insert_col_with_name(self) -> None:
        """Test t.insert_col([values], 0, 'name')."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])

        table.insert_col(["x"], 0, "first")

        assert table.col_names() == ["first", "a", "b"]
        assert table[0] == ["x", "1", "2"]

    def test_insert_col_default_name(self) -> None:
        """Test insert_col without name uses 'Column N'."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])

        table.insert_col(["x"], 1)

        assert table.col_names() == ["a", "Column 1", "b"]

    def test_insert_col_negative(self) -> None:
        """Test insert_col with negative index."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])

        table.insert_col(["x"], -1, "new")

        # -1 for insert becomes position 2 (before last, which is at end)
        assert "new" in table.col_names()

    def test_remove_col_by_name(self) -> None:
        """Test t.remove_col('name')."""
        table = Table(columns=["a", "b", "c"])
        table.add_row(["1", "2", "3"])

        table.remove_col("b")

        assert table.col_names() == ["a", "c"]
        assert table[0] == ["1", "3"]

    def test_remove_col_by_index(self) -> None:
        """Test t.remove_col(0)."""
        table = Table(columns=["a", "b", "c"])
        table.add_row(["1", "2", "3"])

        table.remove_col(0)

        assert table.col_names() == ["b", "c"]
        assert table[0] == ["2", "3"]

    def test_remove_col_negative(self) -> None:
        """Test remove_col with negative index."""
        table = Table(columns=["a", "b", "c"])
        table.add_row(["1", "2", "3"])

        table.remove_col(-1)

        assert table.col_names() == ["a", "b"]


# =============================================================================
# Column Operations Error Tests
# =============================================================================


class TestColumnOperationsErrors:
    """Tests for column operation error conditions."""

    def test_add_col_duplicate_name(self) -> None:
        """Test add_col with duplicate name raises ValueError."""
        table = Table(columns=["a"])

        with pytest.raises(ValueError, match="already exists"):
            table.add_col([], "a")

    def test_add_col_invalid_type(self) -> None:
        """Test add_col with wrong value type raises TypeError."""
        table = Table(columns=["a"])
        table.add_row(["x"])

        with pytest.raises(TypeError, match="expects integer"):
            table.add_col(["not int"], "num", col_type="integer")

    def test_insert_col_out_of_range(self) -> None:
        """Test insert_col with out of range index."""
        table = Table(columns=["a"])

        with pytest.raises(IndexError, match="out of range for insert"):
            table.insert_col([], 99, "b")

    def test_insert_col_duplicate_name(self) -> None:
        """Test insert_col with duplicate name raises ValueError."""
        table = Table(columns=["a"])

        with pytest.raises(ValueError, match="already exists"):
            table.insert_col([], 0, "a")

    def test_remove_col_not_found(self) -> None:
        """Test remove_col with non-existent name raises KeyError."""
        table = Table(columns=["a"])

        with pytest.raises(KeyError, match="not found"):
            table.remove_col("missing")

    def test_remove_col_invalid_index(self) -> None:
        """Test remove_col with invalid index raises IndexError."""
        table = Table(columns=["a"])

        with pytest.raises(IndexError, match="out of range"):
            table.remove_col(99)


# =============================================================================
# Type Validation Tests
# =============================================================================


class TestTypeValidation:
    """Tests for column type validation."""

    def test_string_column_rejects_int(self) -> None:
        """Test string column rejects integer."""
        table = Table(columns=[("name", "string")])

        with pytest.raises(TypeError, match="expects string"):
            table.add_row([42])

    def test_integer_column_rejects_string(self) -> None:
        """Test integer column rejects string."""
        table = Table(columns=[("num", "integer")])

        with pytest.raises(TypeError, match="expects integer"):
            table.add_row(["hello"])

    def test_integer_column_rejects_bool(self) -> None:
        """Test integer column rejects boolean (strict type)."""
        table = Table(columns=[("num", "integer")])

        with pytest.raises(TypeError, match="expects integer"):
            table.add_row([True])

    def test_float_column_accepts_int(self) -> None:
        """Test float column accepts integer."""
        table = Table(columns=[("score", "float")])

        table.add_row([100])

        assert table.cell(0, 0) == 100

    def test_float_column_rejects_string(self) -> None:
        """Test float column rejects string."""
        table = Table(columns=[("score", "float")])

        with pytest.raises(TypeError, match="expects float"):
            table.add_row(["high"])

    def test_boolean_column_rejects_int(self) -> None:
        """Test boolean column rejects integer."""
        table = Table(columns=[("flag", "boolean")])

        with pytest.raises(TypeError, match="expects boolean"):
            table.add_row([1])

    def test_any_column_accepts_none(self) -> None:
        """Test None is accepted for any column type."""
        table = Table(
            columns=[
                ("str", "string"),
                ("int", "integer"),
                ("flt", "float"),
                ("bool", "boolean"),
            ]
        )

        table.add_row([None, None, None, None])

        assert table[0] == [None, None, None, None]


# =============================================================================
# Serialization Tests
# =============================================================================


class TestSerialization:
    """Tests for serialization methods."""

    def test_to_list(self) -> None:
        """Test to_list() conversion."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])
        table.add_row(["3", "4"])

        result = table.to_list()

        assert result == [{"a": "1", "b": "2"}, {"a": "3", "b": "4"}]

    def test_to_dict(self) -> None:
        """Test to_dict() serialization."""
        table = Table(columns=[("x", "integer"), ("y", "string")])
        table.add_row([1, "a"])

        result = table.to_dict()

        assert result["columns"] == [
            {"name": "x", "type": "integer"},
            {"name": "y", "type": "string"},
        ]
        assert result["rows"] == [[1, "a"]]

    def test_round_trip(self) -> None:
        """Test serialization round-trip."""
        original = Table(columns=[("id", "integer"), ("name", "string")])
        original.add_row([1, "Alice"])
        original.add_row([2, "Bob"])

        data = original.to_dict()
        restored = Table.from_dict(data)

        assert restored.row_count() == 2
        assert restored.col_names() == ["id", "name"]
        assert restored[0] == [1, "Alice"]


# =============================================================================
# String Representation Tests
# =============================================================================


class TestStringRepresentation:
    """Tests for string representations."""

    def test_repr(self) -> None:
        """Test repr()."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        result = repr(table)

        assert "Table" in result
        assert "a, b" in result
        assert "1 rows" in result

    def test_repr_empty(self) -> None:
        """Test repr() on empty table."""
        table = Table()

        result = repr(table)

        assert "no columns" in result
        assert "0 rows" in result

    def test_str(self) -> None:
        """Test str() display."""
        table = Table(columns=["a", "b"])
        table.add_row(["x", "y"])

        result = str(table)

        assert "1 rows" in result
        assert "2 columns" in result

    def test_str_empty(self) -> None:
        """Test str() on empty table."""
        table = Table()

        result = str(table)

        assert "empty" in result

    def test_str_large_table(self) -> None:
        """Test str() on table with more than 10 rows."""
        table = Table(columns=["x"])
        for i in range(15):
            table.add_row([str(i)])

        result = str(table)

        assert "15 rows" in result
        assert "... and 5 more rows" in result

    def test_str_prints_cell_values_in_full(self) -> None:
        """A K8s Get table row prints every cell verbatim, with nothing cut."""
        table = Table(columns=["Images", "Selector"])
        table.add_row(["payments-api:2.4.0", "app=payments-api"])

        result = str(table)

        assert result.splitlines()[-1] == "payments-api:2.4.0  app=payments-api"

    def test_str_cell_over_display_cap_shows_length_not_content(self) -> None:
        """One character over the cap and the cell shows its length, never a prefix."""
        cell = "x" * 201
        table = Table(columns=["blob"])
        table.add_row([cell])

        result = str(table)

        assert result.splitlines()[-1] == "a 201-character value"
        assert "xxxxx" not in result

    def test_str_column_types_are_not_abbreviated(self) -> None:
        """The types line names each column type in full, under the names line."""
        columns = [("n", "integer"), ("f", "float"), ("b", "boolean"), ("s", "string")]
        table = Table(columns=columns)

        result = str(table)

        assert result.splitlines()[2] == "integer  float  boolean  string"

    def test_str_registered_secret_in_a_cell_is_masked_while_rendering(self) -> None:
        """The cell is masked before its width is measured, so the column is as
        wide as the placeholder and no prefix survives into the layout."""
        secret = "s3cr3t-" + "v" * 40
        registry = SecretRegistry()
        registry.register("token", secret, "declared")
        table = Table(columns=["Name", "Token"])
        table.add_row(["payments-api", secret])

        with render_scope(registry, "block-1"):
            result = str(table)

        assert result.splitlines()[-1] == "payments-api  ********"
        assert "s3cr3t" not in result

    def test_str_over_cap_secret_cell_leaks_no_prefix(self) -> None:
        """An over-cap cell shows only its length, so an over-cap secret leaks nothing."""
        secret = "s3cr3t-" + "v" * 300
        table = Table(columns=["Name", "Token"])
        table.add_row(["payments-api", secret])

        result = str(table)

        assert result.splitlines()[-1] == f"payments-api  a {len(secret)}-character value"
        assert "s3cr3t" not in result

    def test_str_null_cell_prints_null(self) -> None:
        """A null cell prints null in every column type (REQ-3.1.3.23)."""
        table = Table(columns=[("name", "string"), ("port", "integer")])
        table.add_row(["web-1", None])
        table.add_row([None, 8080])

        lines = str(table).splitlines()

        assert lines[-2:] == ["web-1      null", "null       8080"]

    def test_str_boolean_cell_prints_lower_case(self) -> None:
        """A boolean cell prints true / false, as WAVE writes a boolean (REQ-3.1.3.23)."""
        table = Table(columns=[("name", "string"), ("up", "boolean")])
        table.add_row(["web-1", True])
        table.add_row(["web-2", False])

        lines = str(table).splitlines()

        assert lines[-2:] == ["web-1   true", "web-2   false"]


class TestPrettyLayout:
    """str(table) lays the data out in aligned columns (two header lines, one rule)."""

    @staticmethod
    def _wide_table() -> Table:
        table = Table(
            columns=[
                "Name",
                "Ready",
                "Up-to-date",
                "Available",
                "Age",
                "Containers",
                "Images",
                "Selector",
            ]
        )
        table.add_row(
            [
                "payments-api",
                "1/1",
                "1",
                "1",
                "5h37m",
                "app,sidecar",
                "payments-api:2.4.0",
                "app=payments-api",
            ]
        )
        return table

    def test_golden_layout(self) -> None:
        """The real kubectl-shaped row renders in aligned columns."""
        expected = (
            "Table (1 rows x 8 columns)\n"
            "Name          Ready   Up-to-date  Available  Age     Containers   "
            "Images              Selector\n"
            "string        string  string      string     string  string       "
            "string              string\n"
            "------------  ------  ----------  ---------  ------  -----------  "
            "------------------  ----------------\n"
            "payments-api  1/1     1           1          5h37m   app,sidecar  "
            "payments-api:2.4.0  app=payments-api"
        )

        assert str(self._wide_table()) == expected

    def test_columns_start_at_the_same_offset_on_every_line(self) -> None:
        """Every line breaks its columns at the same character offsets."""
        lines = str(self._wide_table()).splitlines()[1:]
        widths = [12, 6, 10, 9, 6, 11, 18, 16]
        offsets = []
        cursor = 0
        for width in widths[:-1]:
            cursor += width
            offsets.append(cursor + 2)
            cursor += 2

        for line in lines:
            for offset in offsets:
                assert line[offset - 2 : offset] == "  "

    def test_rule_runs_match_the_column_widths(self) -> None:
        """One rule under the header, its dash runs as wide as the columns."""
        rule = str(self._wide_table()).splitlines()[3]

        assert set(rule) == {"-", " "}
        assert [len(run) for run in rule.split("  ")] == [12, 6, 10, 9, 6, 11, 18, 16]

    def test_numeric_columns_are_right_aligned(self) -> None:
        """Integer and float columns right-align; string and boolean left-align."""
        table = Table(columns=[("n", "integer"), ("s", "string")])
        table.add_row([5, "ab"])
        table.add_row([1000, "cd"])

        lines = str(table).splitlines()

        assert lines[1] == "      n  s"
        assert lines[2] == "integer  string"
        assert lines[4] == "      5  ab"
        assert lines[5] == "   1000  cd"

    def test_no_line_has_trailing_whitespace(self) -> None:
        """The last column is never right-padded: trailing spaces survive copy-paste."""
        table = Table(columns=["Name", "Note"])
        table.add_row(["payments-api", "ok"])
        table.add_row(["a", "a much longer note"])

        for line in str(table).splitlines():
            assert line == line.rstrip()

    def test_widths_come_from_the_displayed_rows_only(self) -> None:
        """Row 11 never reflows the table: an unshown wide cell changes nothing."""
        shown = Table(columns=["blob"])
        overflowing = Table(columns=["blob"])
        for index in range(10):
            shown.add_row([f"row-{index}"])
            overflowing.add_row([f"row-{index}"])
        overflowing.add_row(["w" * 39])

        assert str(shown).splitlines()[1:] == str(overflowing).splitlines()[1:-1]


class TestDisplayCaps:
    """Four caps bound a rendered table, and each one announces itself."""

    def test_ten_rows_render_without_a_marker(self) -> None:
        table = Table(columns=["x"])
        for index in range(MAX_DISPLAY_ROWS):
            table.add_row([str(index)])

        lines = str(table).splitlines()

        assert len(lines) == 4 + MAX_DISPLAY_ROWS
        assert "more rows" not in str(table)

    def test_eleventh_row_is_dropped_and_announced(self) -> None:
        table = Table(columns=["x"])
        for index in range(MAX_DISPLAY_ROWS + 1):
            table.add_row([f"row-{index}"])

        lines = str(table).splitlines()

        assert lines[-1] == "... and 1 more rows"
        assert "row-10" not in str(table)

    def test_twelve_columns_render_without_a_marker(self) -> None:
        table = Table(columns=[f"c{index}" for index in range(MAX_DISPLAY_COLS)])
        table.add_row([f"v{index}" for index in range(MAX_DISPLAY_COLS)])

        result = str(table)

        assert "more columns" not in result
        assert "v11" in result

    def test_thirteenth_column_is_dropped_and_announced(self) -> None:
        count = MAX_DISPLAY_COLS + 1
        table = Table(columns=[f"c{index}" for index in range(count)])
        table.add_row([f"v{index}" for index in range(count)])

        result = str(table)

        assert result.splitlines()[-1] == "... and 1 more columns"
        assert "c12" not in result
        assert "v12" not in result

    def test_title_reports_the_true_shape_not_the_shown_shape(self) -> None:
        count = MAX_DISPLAY_COLS + 1
        table = Table(columns=[f"c{index}" for index in range(count)])

        assert str(table).splitlines()[0] == "Table (0 rows x 13 columns)"

    def test_cell_at_the_column_width_prints_in_full(self) -> None:
        cell = "x" * MAX_COL_WIDTH
        table = Table(columns=["blob"])
        table.add_row([cell])

        assert str(table).splitlines()[-1] == cell

    def test_cell_over_the_column_width_is_cut_with_an_ellipsis(self) -> None:
        cell = "x" * (MAX_COL_WIDTH + 1)
        table = Table(columns=["blob"])
        table.add_row([cell])

        rendered = str(table).splitlines()[-1]

        assert rendered == "x" * (MAX_COL_WIDTH - 3) + "..."
        assert len(rendered) == MAX_COL_WIDTH

    def test_cell_at_the_display_cap_is_width_cut_not_length_noticed(self) -> None:
        """At the display cap the width cap is the one that fires."""
        table = Table(columns=["blob"])
        table.add_row(["x" * MAX_CELL_DISPLAY])

        rendered = str(table).splitlines()[-1]

        assert rendered == "x" * (MAX_COL_WIDTH - 3) + "..."

    def test_cell_over_the_display_cap_shows_only_its_length(self) -> None:
        table = Table(columns=["blob"])
        table.add_row(["x" * (MAX_CELL_DISPLAY + 1)])

        result = str(table)

        assert result.splitlines()[-1] == f"a {MAX_CELL_DISPLAY + 1}-character value"
        assert "xxxxx" not in result

    def test_the_length_notice_is_never_width_cut(self) -> None:
        """The two caps cannot compound: a length notice is always under the width."""
        table = Table(columns=["blob"])
        table.add_row(["x" * 10_000_000])

        assert str(table).splitlines()[-1] == "a 10000000-character value"

    def test_a_fully_capped_table_stays_under_the_message_cap(self) -> None:
        """Caps 1-4 bound a table well below the whole-message cap, so the message
        cap never fires on a table alone."""
        table = Table(columns=[f"c{index}" for index in range(MAX_DISPLAY_COLS)])
        for _ in range(MAX_DISPLAY_ROWS + 5):
            table.add_row(["x" * MAX_COL_WIDTH] * MAX_DISPLAY_COLS)

        assert len(str(table)) < MAX_MESSAGE_DISPLAY


# =============================================================================
# Type Inference Tests
# =============================================================================


class TestTypeInference:
    """Tests for type inference in from_list."""

    def test_infer_integer(self) -> None:
        """Test integer type inference."""
        table = Table.from_list([{"num": 42}])

        assert table.col_types() == ["integer"]

    def test_infer_float(self) -> None:
        """Test float type inference."""
        table = Table.from_list([{"num": 3.14}])

        assert table.col_types() == ["float"]

    def test_infer_boolean(self) -> None:
        """Test boolean type inference."""
        table = Table.from_list([{"flag": True}])

        assert table.col_types() == ["boolean"]

    def test_infer_string(self) -> None:
        """Test string type inference."""
        table = Table.from_list([{"text": "hello"}])

        assert table.col_types() == ["string"]

    def test_infer_none_defaults_to_string(self) -> None:
        """Test None value defaults to string type."""
        table = Table.from_list([{"val": None}])

        assert table.col_types() == ["string"]


# =============================================================================
# Edge Case Tests for Full Coverage
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases to achieve 100% coverage."""

    def test_set_row_extra_values_ignored(self) -> None:
        """Test set_row with more values than columns (extra ignored)."""
        table = Table(columns=["a", "b"])
        table.add_row(["1", "2"])

        table.set_row(["x", "y", "z", "extra"], 0)

        assert table[0] == ["x", "y"]  # Extra values ignored

    def test_insert_row_very_negative(self) -> None:
        """Test insert_row with very negative index (clamps to 0)."""
        table = Table(columns=["a"])
        table.add_row(["first"])

        table.insert_row(["inserted"], -100)

        assert table[0] == ["inserted"]  # Inserted at start
        assert table[1] == ["first"]

    def test_insert_col_very_negative(self) -> None:
        """Test insert_col with very negative index (clamps to 0)."""
        table = Table(columns=["a"])
        table.add_row(["1"])

        table.insert_col(["x"], -100, "first")

        assert table.col_names() == ["first", "a"]  # Inserted at start


class TestFloatColumnDecimalCells:
    """Float-typed table cells hold exact Decimal values and serialize to plain
    decimal strings (REQ-3.1.3.14)."""

    def test_infer_type_decimal_is_float(self) -> None:
        assert Table._infer_type(Decimal("1.5")) == ColumnType.FLOAT

    def test_float_column_accepts_decimal_cell(self) -> None:
        table = Table(columns=[("price", "float")])
        table.add_row([Decimal("19.99")])

        assert table.cell(0, "price") == Decimal("19.99")

    def test_set_cell_accepts_decimal_in_float_column(self) -> None:
        table = Table(columns=[("price", "float")])
        table.add_row([Decimal("0")])

        table.set_cell(Decimal("-2123.123213123123699999"), 0, "price")

        assert table.cell(0, "price") == Decimal("-2123.123213123123699999")

    def test_to_dict_serializes_float_cell_as_plain_string(self) -> None:
        # Decimal('1E+3') would render as '1E+3' via str(); plain decimal text forbids it.
        table = Table(columns=[("price", "float")])
        table.add_row([Decimal("1E+3")])

        result = table.to_dict()
        assert result["rows"][0][0] == "1000"

    def test_to_dict_serializes_small_float_cell_without_exponent(self) -> None:
        table = Table(columns=[("ratio", "float")])
        table.add_row([Decimal("1E-7")])

        result = table.to_dict()
        assert result["rows"][0][0] == "0.0000001"

    def test_round_trip_float_column_preserves_exact_value(self) -> None:
        # to_dict emits a plain string; from_dict coerces it back to an exact
        # Decimal so a float-column table survives storage round-trips.
        original = Table(columns=[("price", "float")])
        original.add_row([Decimal("-2123.123213123123699999")])

        restored = Table.from_dict(original.to_dict())

        assert restored.cell(0, "price") == Decimal("-2123.123213123123699999")
        assert isinstance(restored.cell(0, "price"), Decimal)


# =============================================================================
# Row Filtering Tests (Table.filter - non-mutating, REQ-3.5.5 Row Filtering)
# =============================================================================


class TestTableFilter:
    """Tests for the non-mutating filter() query operation.

    filter(column) names a column and returns the comparison step; each of its
    operators returns a NEW table of the rows whose cell satisfies it. The
    operator set is the type-appropriate one shared with the assertion control.
    None cells never satisfy an ordering/equality operator (SQL null
    semantics); they are surfaced only by is_empty / is_not_empty. Filters
    chain conjunctively.
    """

    @pytest.fixture
    def people(self) -> Table:
        """Sample table: id (int), name (str), score (float, one None), active (bool)."""
        table = Table(
            columns=[
                ("id", "integer"),
                ("name", "string"),
                ("score", "float"),
                ("active", "boolean"),
            ]
        )
        table.add_row([1, "Alice", 95.5, True])
        table.add_row([2, "Bob", 80.0, False])
        table.add_row([3, "Carol", 95.5, True])
        table.add_row([4, "Dave", None, False])
        return table

    def test_filter_names_a_column_without_selecting_rows(self, people: Table) -> None:
        step = people.filter("id")

        assert isinstance(step, ColumnFilter)

    def test_filter_returns_new_table_instance(self, people: Table) -> None:
        result = people.filter("id").greater_than(1)

        assert isinstance(result, Table)
        assert result is not people

    def test_filter_preserves_schema(self, people: Table) -> None:
        result = people.filter("id").greater_than(999)

        assert result.col_names() == people.col_names()
        assert result.col_types() == people.col_types()
        assert result.row_count() == 0

    # --- numeric operators -------------------------------------------------

    def test_filter_integer_equals(self, people: Table) -> None:
        assert people.filter("id").equals(2).col("id") == [2]

    def test_filter_integer_not_equals(self, people: Table) -> None:
        assert people.filter("id").not_equals(2).col("id") == [1, 3, 4]

    def test_filter_integer_less_than(self, people: Table) -> None:
        assert people.filter("id").less_than(3).col("id") == [1, 2]

    def test_filter_integer_greater_than(self, people: Table) -> None:
        assert people.filter("id").greater_than(2).col("id") == [3, 4]

    def test_filter_integer_less_or_equal(self, people: Table) -> None:
        assert people.filter("id").less_or_equal(2).col("id") == [1, 2]

    def test_filter_integer_greater_or_equal(self, people: Table) -> None:
        assert people.filter("id").greater_or_equal(3).col("id") == [3, 4]

    # --- string operators --------------------------------------------------

    def test_filter_string_equals(self, people: Table) -> None:
        assert people.filter("name").equals("Alice").col("id") == [1]

    def test_filter_string_not_equals(self, people: Table) -> None:
        assert people.filter("name").not_equals("Alice").col("id") == [2, 3, 4]

    def test_filter_string_contains(self, people: Table) -> None:
        assert people.filter("name").contains("o").col("id") == [2, 3]

    def test_filter_string_does_not_contain(self, people: Table) -> None:
        assert people.filter("name").does_not_contain("o").col("id") == [1, 4]

    def test_filter_string_starts_with(self, people: Table) -> None:
        assert people.filter("name").starts_with("C").col("id") == [3]

    def test_filter_string_ends_with(self, people: Table) -> None:
        assert people.filter("name").ends_with("e").col("id") == [1, 4]

    def test_filter_string_matches_regex(self, people: Table) -> None:
        assert people.filter("name").matches_regex("^[AB]").col("id") == [1, 2]

    # --- boolean operators -------------------------------------------------

    def test_filter_boolean_is_true(self, people: Table) -> None:
        assert people.filter("active").is_true().col("id") == [1, 3]

    def test_filter_boolean_is_false(self, people: Table) -> None:
        assert people.filter("active").is_false().col("id") == [2, 4]

    # --- float operators + None semantics ---------------------------------

    def test_filter_float_greater_than_excludes_none(self, people: Table) -> None:
        # Dave's score is None and must never satisfy an ordering operator.
        assert people.filter("score").greater_than(90).col("id") == [1, 3]

    def test_filter_none_cell_excluded_from_equality(self, people: Table) -> None:
        assert people.filter("score").greater_than(0).col("id") == [1, 2, 3]

    def test_filter_is_empty_keeps_only_none(self, people: Table) -> None:
        assert people.filter("score").is_empty().col("id") == [4]

    def test_filter_is_not_empty_drops_none(self, people: Table) -> None:
        assert people.filter("score").is_not_empty().col("id") == [1, 2, 3]

    def test_filter_decimal_cells(self) -> None:
        table = Table(columns=[("id", "integer"), ("price", "float")])
        table.add_row([1, Decimal("9.99")])
        table.add_row([2, Decimal("19.99")])
        table.add_row([3, Decimal("4.50")])

        assert table.filter("price").greater_than(5).col("id") == [1, 2]

    # --- column resolution -------------------------------------------------

    def test_filter_by_column_index(self, people: Table) -> None:
        assert people.filter(0).greater_than(2).col("id") == [3, 4]

    def test_filter_by_negative_column_index(self, people: Table) -> None:
        # -1 is the active (boolean) column.
        assert people.filter(-1).is_true().col("id") == [1, 3]

    def test_filter_missing_column_raises_key_error(self, people: Table) -> None:
        with pytest.raises(KeyError, match="Column 'nope' not found"):
            people.filter("nope")

    # --- operator availability --------------------------------------------

    def test_filter_ordering_operator_on_a_string_column(self, people: Table) -> None:
        with pytest.raises(
            ValueError,
            match="^Operator 'greater_than' is not available for string column 'name'$",
        ):
            people.filter("name").greater_than("x")

    def test_filter_text_operator_on_a_numeric_column(self, people: Table) -> None:
        with pytest.raises(
            ValueError,
            match="^Operator 'starts_with' is not available for integer column 'id'$",
        ):
            people.filter("id").starts_with("1")

    def test_filter_boolean_operator_on_a_numeric_column(self, people: Table) -> None:
        with pytest.raises(
            ValueError,
            match="^Operator 'is_true' is not available for integer column 'id'$",
        ):
            people.filter("id").is_true()

    def test_filter_emptiness_works_on_every_type(self, people: Table) -> None:
        assert people.filter("name").is_not_empty().row_count() == 4
        assert people.filter("active").is_not_empty().row_count() == 4
        assert people.filter("id").is_empty().row_count() == 0

    def test_filter_names_the_column_by_index_in_the_error(self, people: Table) -> None:
        with pytest.raises(
            ValueError,
            match="^Operator 'contains' is not available for integer column 'id'$",
        ):
            people.filter(0).contains("1")

    # --- chaining + non-mutation ------------------------------------------

    def test_filter_chaining_is_conjunctive(self, people: Table) -> None:
        result = people.filter("active").is_true().filter("score").greater_than(90)

        assert result.col("id") == [1, 3]

    def test_filter_chains_into_order_by(self, people: Table) -> None:
        result = people.filter("score").is_not_empty().order_by(("score", "desc"), "name")

        assert result.col("id") == [1, 3, 2]

    def test_filter_chain_across_three_column_types_then_orders(self, people: Table) -> None:
        result = (
            people.filter("active")
            .is_true()
            .filter("name")
            .contains("a")
            .filter("score")
            .greater_or_equal(90)
            .order_by(("score", "desc"), "name")
        )

        assert result.to_list() == [
            {"id": 3, "name": "Carol", "score": 95.5, "active": True},
        ]

    def test_filter_by_index_chains_into_order_by_by_name(self, people: Table) -> None:
        result = people.filter(0).greater_than(1).order_by(("name", "desc"))

        assert result.col("name") == ["Dave", "Carol", "Bob"]

    def test_every_step_returns_a_table_so_the_chain_never_breaks(self, people: Table) -> None:
        step = people.filter("id")
        assert isinstance(step, ColumnFilter)
        assert isinstance(step.greater_than(0), Table)
        assert isinstance(step.greater_than(0).filter("name"), ColumnFilter)
        assert isinstance(step.greater_than(0).order_by("name"), Table)

    def test_filter_does_not_mutate_source(self, people: Table) -> None:
        people.filter("id").greater_than(2)

        assert people.col("id") == [1, 2, 3, 4]
        assert people.row_count() == 4

    # --- null cells follow the check rule (REQ-3.1.3.25) -------------------

    @pytest.fixture
    def holes(self) -> Table:
        """Row 'b' holds null in every typed column; rows 'a' and 'c' hold values."""
        table = Table(
            columns=[
                ("who", "string"),
                ("count", "integer"),
                ("label", "string"),
                ("ratio", "float"),
                ("flag", "boolean"),
            ]
        )
        table.add_row(["a", 1, "x", Decimal("1.5"), True])
        table.add_row(["b", None, None, None, None])
        table.add_row(["c", 2, "y", Decimal("2.5"), False])
        return table

    @pytest.mark.parametrize(
        "column",
        [
            pytest.param("count", id="integer"),
            pytest.param("label", id="string"),
            pytest.param("ratio", id="float"),
            pytest.param("flag", id="boolean"),
        ],
    )
    def test_filter_is_null_keeps_only_the_null_cell(self, holes: Table, column: str) -> None:
        assert holes.filter(column).is_null().col("who") == ["b"]

    @pytest.mark.parametrize(
        "column",
        [
            pytest.param("count", id="integer"),
            pytest.param("label", id="string"),
            pytest.param("ratio", id="float"),
            pytest.param("flag", id="boolean"),
        ],
    )
    def test_filter_is_not_null_drops_the_null_cell(self, holes: Table, column: str) -> None:
        assert holes.filter(column).is_not_null().col("who") == ["a", "c"]

    @pytest.mark.parametrize(
        ("method", "column", "value"),
        [
            pytest.param("not_equals", "count", 1, id="integer-not-equals"),
            pytest.param("not_equals", "ratio", Decimal("1.5"), id="float-not-equals"),
            pytest.param("not_equals", "label", "x", id="string-not-equals"),
            pytest.param("does_not_contain", "label", "x", id="string-does-not-contain"),
        ],
    )
    def test_filter_keeps_a_null_cell_on_a_negative_comparison(
        self, holes: Table, method: str, column: str, value: object
    ) -> None:
        assert getattr(holes.filter(column), method)(value).col("who") == ["b", "c"]

    @pytest.mark.parametrize(
        ("method", "kept"),
        [
            pytest.param("is_true", ["a"], id="is-true"),
            pytest.param("is_false", ["c"], id="is-false"),
        ],
    )
    def test_filter_boolean_operators_drop_a_null_cell(
        self, holes: Table, method: str, kept: list[str]
    ) -> None:
        assert getattr(holes.filter("flag"), method)().col("who") == kept

    @pytest.mark.parametrize(
        ("method", "column", "value", "kept"),
        [
            pytest.param("equals", "count", 1, ["a"], id="integer-equals"),
            pytest.param("less_than", "count", 2, ["a"], id="integer-less-than"),
            pytest.param("greater_than", "count", 1, ["c"], id="integer-greater-than"),
            pytest.param("less_or_equal", "count", 2, ["a", "c"], id="integer-less-or-equal"),
            pytest.param("greater_or_equal", "count", 1, ["a", "c"], id="integer-greater-or-equal"),
            pytest.param("equals", "label", "", [], id="string-equals-empty-text"),
            pytest.param("contains", "label", "", ["a", "c"], id="string-contains"),
            pytest.param("starts_with", "label", "", ["a", "c"], id="string-starts-with"),
            pytest.param("ends_with", "label", "", ["a", "c"], id="string-ends-with"),
            pytest.param("matches_regex", "label", "^$", [], id="string-matches-empty-pattern"),
        ],
    )
    def test_filter_drops_a_null_cell_on_equality_ordering_and_text_matching(
        self, holes: Table, method: str, column: str, value: object, kept: list[str]
    ) -> None:
        assert getattr(holes.filter(column), method)(value).col("who") == kept


# =============================================================================
# Filter operator gate (CSV / Excel Transform literal rows, CSV-12)
# =============================================================================


class TestFilterOperatorGate:
    """The gate a literal filter row passes: the check operators of the column type, plus null."""

    @pytest.mark.parametrize("operator", ["is_null", "is_not_null"])
    @pytest.mark.parametrize("col_type", list(ColumnType), ids=lambda t: t.value)
    def test_the_null_operators_pass_on_every_column_type(
        self, col_type: ColumnType, operator: str
    ) -> None:
        validate_filter_operator(col_type, operator)

    @pytest.mark.parametrize(
        ("col_type", "operators"),
        [
            pytest.param(
                ColumnType.INTEGER,
                [
                    "equals",
                    "not_equals",
                    "less_than",
                    "greater_than",
                    "less_or_equal",
                    "greater_or_equal",
                ],
                id="integer",
            ),
            pytest.param(
                ColumnType.FLOAT,
                [
                    "equals",
                    "not_equals",
                    "less_than",
                    "greater_than",
                    "less_or_equal",
                    "greater_or_equal",
                ],
                id="float",
            ),
            pytest.param(
                ColumnType.STRING,
                [
                    "equals",
                    "not_equals",
                    "contains",
                    "does_not_contain",
                    "starts_with",
                    "ends_with",
                    "matches_regex",
                ],
                id="string",
            ),
            pytest.param(ColumnType.BOOLEAN, ["is_true", "is_false"], id="boolean"),
        ],
    )
    def test_the_check_operators_of_the_column_type_pass(
        self, col_type: ColumnType, operators: list[str]
    ) -> None:
        for operator in operators:
            validate_filter_operator(col_type, operator)

    @pytest.mark.parametrize("operator", ["is_empty", "is_not_empty"])
    @pytest.mark.parametrize("col_type", list(ColumnType), ids=lambda t: t.value)
    def test_the_emptiness_operators_are_refused_on_every_column_type(
        self, col_type: ColumnType, operator: str
    ) -> None:
        with pytest.raises(ValueError, match=rf"^Unknown filter operator: '{operator}'$"):
            validate_filter_operator(col_type, operator)


# =============================================================================
# Row Ordering Tests (Table.order_by - non-mutating, REQ-3.5.5 Row Ordering)
# =============================================================================


class TestTableOrderBy:
    """Tests for the non-mutating order_by() query operation.

    order_by(*keys) returns a NEW table sorted by one or more column keys in
    priority order (first key most significant). Each key is a bare column
    (ascending) or a (column, direction) tuple. Sorting is stable; missing
    cells (None) sort last regardless of direction.
    """

    @pytest.fixture
    def records(self) -> Table:
        """Sample table: region (str, one None), score (int), id (int)."""
        table = Table(
            columns=[
                ("region", "string"),
                ("score", "integer"),
                ("id", "integer"),
            ]
        )
        table.add_row(["west", 10, 1])
        table.add_row(["east", 20, 2])
        table.add_row(["west", 10, 3])
        table.add_row(["east", 25, 4])
        table.add_row([None, 99, 5])
        return table

    def test_order_by_returns_new_table_instance(self, records: Table) -> None:
        result = records.order_by("id")

        assert isinstance(result, Table)
        assert result is not records

    def test_order_by_preserves_schema(self, records: Table) -> None:
        result = records.order_by("id")

        assert result.col_names() == records.col_names()
        assert result.col_types() == records.col_types()

    def test_order_by_single_key_ascending(self, records: Table) -> None:
        assert records.order_by("score").col("id") == [1, 3, 2, 4, 5]

    def test_order_by_single_key_descending(self, records: Table) -> None:
        assert records.order_by(("score", "desc")).col("id") == [5, 4, 2, 1, 3]

    def test_order_by_bare_key_is_ascending(self, records: Table) -> None:
        assert records.order_by("score").col("id") == records.order_by(("score", "asc")).col("id")

    def test_order_by_is_stable(self, records: Table) -> None:
        # Two rows share score 10 (ids 1 and 3); stability keeps source order.
        assert records.order_by("score").col("id")[:2] == [1, 3]
        assert records.order_by(("score", "desc")).col("id")[-2:] == [1, 3]

    def test_order_by_multi_key_priority(self, records: Table) -> None:
        result = records.order_by(("region", "asc"), ("score", "desc"))

        assert result.col("id") == [4, 2, 1, 3, 5]

    def test_order_by_none_sorts_last_ascending(self, records: Table) -> None:
        assert records.order_by("region").col("id") == [2, 4, 1, 3, 5]

    def test_order_by_none_sorts_last_descending(self, records: Table) -> None:
        assert records.order_by(("region", "desc")).col("id") == [1, 3, 2, 4, 5]

    def test_order_by_column_index(self, records: Table) -> None:
        assert records.order_by(1).col("id") == [1, 3, 2, 4, 5]

    def test_order_by_negative_column_index(self, records: Table) -> None:
        # -1 is the id column.
        assert records.order_by(-1).col("id") == [1, 2, 3, 4, 5]

    def test_order_by_bad_direction_raises(self, records: Table) -> None:
        with pytest.raises(
            ValueError, match="Sort direction must be 'asc' or 'desc', got 'sideways'"
        ):
            records.order_by(("score", "sideways"))

    def test_order_by_missing_column_raises_key_error(self, records: Table) -> None:
        with pytest.raises(KeyError, match="Column 'nope' not found"):
            records.order_by("nope")

    def test_order_by_does_not_mutate_source(self, records: Table) -> None:
        records.order_by("score")

        assert records.col("id") == [1, 2, 3, 4, 5]
        assert records.col("region") == ["west", "east", "west", "east", None]

    def test_order_by_result_is_deep_copied(self, records: Table) -> None:
        result = records.order_by("id")
        result.set_cell(999, 0, "score")

        assert result.cell(0, "score") == 999
        assert records.cell(0, "score") == 10
