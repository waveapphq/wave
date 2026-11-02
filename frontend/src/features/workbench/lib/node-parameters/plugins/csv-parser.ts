/**
 * CSV Parser Plugin Parameters - the `sorts` / `filters` arrays are declared here
 * but rendered by the bespoke CSV Transform UI, not the generic parameter table.
 */

import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('operation', 'Operation', 'string', false, 'Convert text to a table (Parse) or a table to text (Serialize).', {
    enumValues: ['parse', 'serialize'],
    enumLabels: { parse: 'Parse', serialize: 'Serialize' },
    defaultValue: 'parse',
    noExpression: true,
  }),
  param('csv_content', 'CSV Content', 'string', false, 'Delimited text to parse into a table.', {
    showWhen: { field: 'operation', values: ['parse'] },
    requiredWhen: { field: 'operation', values: ['parse'] },
  }),
  param('table', 'Table', 'table', false, 'Table to serialize to text.', {
    variableRef: { types: ['table'] },
    variableRefExistingOnly: true,
    showWhen: { field: 'operation', values: ['serialize'] },
    requiredWhen: { field: 'operation', values: ['serialize'] },
  }),
  param('delimiter', 'Delimiter', 'string', false, 'Single-character field delimiter.', {
    defaultValue: ',',
  }),
  param('has_header', 'Has header row', 'boolean', false, 'First row holds column names (parse) / is written as a header (serialize).', {
    defaultValue: true,
    noExpression: true,
  }),
  param('column_types', 'Column types', 'string', false, 'How parsed columns are typed.', {
    enumValues: ['auto', 'string', 'schema'],
    enumLabels: { auto: 'Auto', string: 'String', schema: 'Schema' },
    defaultValue: 'auto',
    noExpression: true,
    showWhen: { field: 'operation', values: ['parse'] },
  }),
  param('schema_source', 'Schema source', 'table', false, 'Schema table whose columns drive typing.', {
    variableRef: { types: ['table'] },
    variableRefExistingOnly: true,
    noExpression: true,
    showWhenAll: [
      { field: 'operation', values: ['parse'] },
      { field: 'column_types', values: ['schema'] },
    ],
    requiredWhenAll: [
      { field: 'operation', values: ['parse'] },
      { field: 'column_types', values: ['schema'] },
    ],
  }),
  param('empty_cells', 'Empty cells', 'string', false, 'Map an empty cell to null or the column type default.', {
    enumValues: ['none', 'default'],
    enumLabels: { none: 'Null', default: 'Default' },
    defaultValue: 'none',
    noExpression: true,
    showWhen: { field: 'operation', values: ['parse'] },
  }),
  param('on_mismatch', 'On type mismatch', 'string', false, 'Behavior when a cell violates a declared type.', {
    enumValues: ['fail', 'skip_row', 'replace_default'],
    enumLabels: { fail: 'Fail', skip_row: 'Skip row', replace_default: 'Replace with default' },
    defaultValue: 'fail',
    noExpression: true,
    showWhen: { field: 'operation', values: ['parse'] },
  }),
  param('sorts', 'Sorts', 'array', false, 'Declarative sort keys applied to the table.'),
  param('filters', 'Filters', 'array', false, 'Declarative per-column filter blocks applied to the table.'),
]

const PARSE_ONLY = { field: 'operation', values: ['parse'] }
const SERIALIZE_ONLY = { field: 'operation', values: ['serialize'] }

export const outputs: OutputParam[] = [
  output('table', 'Table', 'table', 'Parsed table.', { showWhen: PARSE_ONLY }),
  output('row_count', 'Row Count', 'integer', 'Number of rows in the parsed table.', {
    showWhen: PARSE_ONLY,
  }),
  output('schema', 'Schema', 'array', 'Column name/type descriptors for the parsed table.', {
    showWhen: PARSE_ONLY,
  }),
  output('csv_content', 'CSV Content', 'string', 'Serialized CSV text.', {
    showWhen: SERIALIZE_ONLY,
  }),
  output('success', 'Success', 'boolean', 'True when no cell errors occurred.'),
  output('errors', 'Errors', 'array', 'Per-cell type-mismatch errors.'),
]
