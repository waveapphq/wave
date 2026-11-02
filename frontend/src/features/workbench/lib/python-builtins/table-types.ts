/**
 * Python Builtins - Table Types
 *
 * The WAVE table types the expression sandbox defines next to the Python builtins.
 */

import type { PythonBuiltin } from './types'
import { builtin } from './types'

export const TABLE_TYPE_BUILTINS: PythonBuiltin[] = [
  builtin(
    'Table',
    'Table(columns=None)',
    'Create an empty table. Columns are names, or (name, type) pairs with string, integer, float or boolean.',
    'type',
    { returns: 'table' },
  ),
  builtin(
    'TableRowView',
    'TableRowView(data, column_names)',
    'A read-only table row, read by position or column name.',
    'type',
  ),
  builtin(
    'ColumnType',
    'ColumnType(value)',
    'A table column type: STRING, INTEGER, FLOAT or BOOLEAN. Its value is the type name.',
    'type',
  ),
]
