/**
 * Python Builtins - Table Methods
 *
 * Contains common methods for WAVE's Table class type.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/**
 * Common methods for table type (WAVE's Table class)
 */
export const TABLE_METHODS: PythonMethod[] = [
  method('row_count', ['.row_count() -> int'], 'Return the number of rows in the table.', ['table'], 0, 0, { returns: 'int' }),
  method('col_count', ['.col_count() -> int'], 'Return the number of columns in the table.', ['table'], 0, 0, { returns: 'int' }),
  method('cell_count', ['.cell_count() -> int'], 'Return the total number of cells (rows x columns).', ['table'], 0, 0, { returns: 'int' }),
  method('col_names', ['.col_names() -> list'], 'Return a list of column names.', ['table'], 0, 0, { returns: 'list' }),
  method('col_types', ['.col_types() -> list'], 'Return a list of column types as strings.', ['table'], 0, 0, { returns: 'list' }),
  method('row', ['.row(row_idx: int) -> TableRowView'], 'Get row by index as a read-only view. Supports t[row]["col_name"] or t[row][col_idx].', ['table'], 1, 1),
  method('col', ['.col(col_idx: int) -> list', '.col(col_name: str) -> list'], 'Get entire column as a list by index (int) or name (str).', ['table'], 1, 1, { returns: 'list' }),
  method('cell', ['.cell(row_idx: int, col_idx: int) -> Any', '.cell(row_idx: int, col_name: str) -> Any'], 'Get a single cell value by row index and column index (int) or name (str).', ['table'], 2, 2),
  method('set_cell', ['.set_cell(value: Any, row_idx: int, col_idx: int) -> None', '.set_cell(value: Any, row_idx: int, col_name: str) -> None'], 'Set a single cell value by row index and column index (int) or name (str).', ['table'], 3, 3, { returns: 'None' }),
  method('set_row', ['.set_row(values: list, row_idx: int) -> None'], 'Set all values in a row starting from column 0.', ['table'], 2, 2, { returns: 'None' }),
  method('clear', ['.clear() -> None'], 'Remove all rows from the table, keeping column schema.', ['table'], 0, 0, { returns: 'None' }),
  method('add_row', ['.add_row() -> None', '.add_row(values: list) -> None'], 'Append a new row at the end. Missing values filled with None.', ['table'], 0, 1, { returns: 'None' }),
  method('insert_row', ['.insert_row(values: list, row_idx: int) -> None'], 'Insert a new row at the specified index.', ['table'], 2, 2, { returns: 'None' }),
  method('remove_row', ['.remove_row(row_idx: int) -> None'], 'Remove the row at the specified index.', ['table'], 1, 1, { returns: 'None' }),
  method('add_col', ['.add_col() -> None', '.add_col(values: list) -> None', '.add_col(values: list, name: str) -> None', '.add_col(values: list, name: str, col_type: str) -> None'], 'Append a new column. Defaults to "Column N" if name not provided.', ['table'], 0, 3, { returns: 'None' }),
  method('insert_col', ['.insert_col(values: list, col_idx: int) -> None', '.insert_col(values: list, col_idx: int, name: str) -> None', '.insert_col(values: list, col_idx: int, name: str, col_type: str) -> None'], 'Insert a new column at the specified index.', ['table'], 2, 4, { returns: 'None' }),
  method('remove_col', ['.remove_col(col_idx: int) -> None', '.remove_col(col_name: str) -> None'], 'Remove the column by index (int) or name (str).', ['table'], 1, 1, { returns: 'None' }),
  method('to_list', ['.to_list() -> list'], 'Convert table to a list of dictionaries (one per row).', ['table'], 0, 0, { returns: 'list' }),
  method('to_dict', ['.to_dict() -> dict'], 'Serialize table to a dictionary with columns and rows.', ['table'], 0, 0, { returns: 'dict' }),
  method('filter', ['.filter(col_name: str) -> ColumnFilter', '.filter(col_idx: int) -> ColumnFilter'], 'Name a column to compare; the operator that follows (equals, greater_than, starts_with, is_empty, ...) selects the rows and returns a new table. Chainable.', ['table'], 1, 1, { returns: 'column' }),
  method('order_by', ['.order_by(col_name: str) -> Table', '.order_by(key: tuple, ...) -> Table'], 'Return a new table sorted by one or more column keys in priority order. Each key is a column name or index, or a (column, "asc" | "desc") tuple.', ['table'], 0, -1, { returns: 'table' }),
]
