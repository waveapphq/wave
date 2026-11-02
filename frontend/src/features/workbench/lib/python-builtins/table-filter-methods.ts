/**
 * Python Builtins - Table Column Filter Methods
 *
 * The step `table.filter(column)` returns: its operators select the rows and
 * each returns a table, so filters chain and flow on into ordering.
 */

import type { PythonMethod } from './types'
import { method } from './types'

/** Comparison operators offered on a named table column */
export const TABLE_FILTER_METHODS: PythonMethod[] = [
  method('equals', ['.equals(value: Any) -> Table'], 'Rows whose cell equals the value.', ['column'], 1, 1, { returns: 'table' }),
  method('not_equals', ['.not_equals(value: Any) -> Table'], 'Rows whose cell differs from the value.', ['column'], 1, 1, { returns: 'table' }),
  method('less_than', ['.less_than(value: Any) -> Table'], 'Rows whose cell orders before the value. Numeric columns.', ['column'], 1, 1, { returns: 'table' }),
  method('greater_than', ['.greater_than(value: Any) -> Table'], 'Rows whose cell orders after the value. Numeric columns.', ['column'], 1, 1, { returns: 'table' }),
  method('less_or_equal', ['.less_or_equal(value: Any) -> Table'], 'Rows whose cell orders before the value or equals it. Numeric columns.', ['column'], 1, 1, { returns: 'table' }),
  method('greater_or_equal', ['.greater_or_equal(value: Any) -> Table'], 'Rows whose cell orders after the value or equals it. Numeric columns.', ['column'], 1, 1, { returns: 'table' }),
  method('contains', ['.contains(value: str) -> Table'], 'Rows whose cell contains the value as text. String columns.', ['column'], 1, 1, { returns: 'table' }),
  method('does_not_contain', ['.does_not_contain(value: str) -> Table'], 'Rows whose cell does not contain the value as text. String columns.', ['column'], 1, 1, { returns: 'table' }),
  method('starts_with', ['.starts_with(value: str) -> Table'], 'Rows whose cell starts with the value. String columns.', ['column'], 1, 1, { returns: 'table' }),
  method('ends_with', ['.ends_with(value: str) -> Table'], 'Rows whose cell ends with the value. String columns.', ['column'], 1, 1, { returns: 'table' }),
  method('matches_regex', ['.matches_regex(pattern: str) -> Table'], 'Rows whose cell matches the regular expression. String columns.', ['column'], 1, 1, { returns: 'table' }),
  method('is_true', ['.is_true() -> Table'], 'Rows whose cell is true. Boolean columns.', ['column'], 0, 0, { returns: 'table' }),
  method('is_false', ['.is_false() -> Table'], 'Rows whose cell is false. Boolean columns.', ['column'], 0, 0, { returns: 'table' }),
  method('is_empty', ['.is_empty() -> Table'], 'Rows whose cell has no value. Any column.', ['column'], 0, 0, { returns: 'table' }),
  method('is_not_empty', ['.is_not_empty() -> Table'], 'Rows whose cell has a value. Any column.', ['column'], 0, 0, { returns: 'table' }),
  method('is_null', ['.is_null() -> Table'], 'Rows whose cell is null. Any column.', ['column'], 0, 0, { returns: 'table' }),
  method('is_not_null', ['.is_not_null() -> Table'], 'Rows whose cell is not null. Any column.', ['column'], 0, 0, { returns: 'table' }),
]
