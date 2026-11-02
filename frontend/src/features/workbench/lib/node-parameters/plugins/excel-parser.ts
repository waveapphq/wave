/**
 * Excel Parser Plugin Parameters - the `sorts` / `filters` arrays are declared here
 * but rendered by the shared Table Transform UI, not the generic parameter table.
 */

import { param, output, type InputParam, type OutputParam } from '../types'

const READ_ONLY = { field: 'operation', values: ['read'] }
const WRITE_ONLY = { field: 'operation', values: ['write'] }

export const inputs: InputParam[] = [
  param('operation', 'Operation', 'string', false, 'Read a worksheet into a table, or write a table into a workbook.', {
    enumValues: ['read', 'write'],
    enumLabels: { read: 'Read (workbook → table)', write: 'Write (table → workbook)' },
    defaultValue: 'read',
    noExpression: true,
  }),
  // One label, two descriptors: Read may take test data, Write may not (TDATA-10).
  param('workbook', 'Workbook', 'string', true, 'Workbook file to read from or write to.', {
    placeholder: 'artifact://…, testdata://…, or /abs/path',
    allowedFormats: ['plain'],
    showWhen: READ_ONLY,
    fileReference: 'file',
  }),
  param('workbook', 'Workbook', 'string', true, 'Workbook file to read from or write to.', {
    placeholder: 'artifact://…, or /abs/path',
    allowedFormats: ['plain'],
    showWhen: WRITE_ONLY,
    fileReference: 'save-as',
  }),
  param('sheet', 'Sheet', 'string', false, 'Sheet name, or its position in the workbook. Blank picks the first sheet.', {
    placeholder: 'Sheet name or position',
  }),
  param('range', 'Range', 'string', false, 'Cell range to read. Blank reads the whole used area.', {
    placeholder: 'A1:F200',
    showWhen: READ_ONLY,
  }),
  param('has_header', 'Has header row', 'boolean', false, 'Take column names from a header row instead of the spreadsheet letters.', {
    defaultValue: true,
    noExpression: true,
    showWhen: READ_ONLY,
  }),
  param('header_row', 'Header row', 'integer', false, 'Sheet row that holds the column names.', {
    defaultValue: 1,
    showWhenAll: [READ_ONLY, { field: 'has_header', values: ['true'] }],
  }),
  param('column_types', 'Column types', 'string', false, 'How the columns that are read are typed.', {
    enumValues: ['auto', 'string', 'schema'],
    enumLabels: { auto: 'Auto', string: 'String', schema: 'Schema' },
    defaultValue: 'auto',
    noExpression: true,
    showWhen: READ_ONLY,
  }),
  param('schema_source', 'Schema source', 'table', false, 'Schema table whose columns drive typing.', {
    variableRef: { types: ['table'] },
    variableRefExistingOnly: true,
    noExpression: true,
    showWhenAll: [READ_ONLY, { field: 'column_types', values: ['schema'] }],
    requiredWhenAll: [READ_ONLY, { field: 'column_types', values: ['schema'] }],
  }),
  param('empty_cells', 'Empty cells', 'string', false, 'Map an empty cell to null or the column type default.', {
    enumValues: ['none', 'default'],
    enumLabels: { none: 'Null', default: 'Default' },
    defaultValue: 'none',
    noExpression: true,
    showWhen: READ_ONLY,
  }),
  param('on_mismatch', 'On type mismatch', 'string', false, 'Behavior when a cell violates a declared type.', {
    enumValues: ['fail', 'skip_row', 'replace_default'],
    enumLabels: { fail: 'Fail', skip_row: 'Skip row', replace_default: 'Replace with default' },
    defaultValue: 'fail',
    noExpression: true,
    showWhen: READ_ONLY,
  }),
  param('sorts', 'Sorts', 'array', false, 'Declarative sort keys applied to the table.'),
  param('filters', 'Filters', 'array', false, 'Declarative per-column filter blocks applied to the table.'),
  param('table', 'Table', 'table', false, 'Table to write into the workbook.', {
    variableRef: { types: ['table'] },
    variableRefExistingOnly: true,
    showWhen: WRITE_ONLY,
    requiredWhen: WRITE_ONLY,
  }),
  param('write_header', 'Write header row', 'boolean', false, 'Write the column names as the first row.', {
    defaultValue: true,
    noExpression: true,
    showWhen: WRITE_ONLY,
  }),
  param('start_cell', 'Start cell', 'string', false, 'Top-left cell the table is written from.', {
    defaultValue: 'A1',
    showWhen: WRITE_ONLY,
  }),
  param('if_exists', 'If the file exists', 'string', false, 'What happens to a workbook that is already there.', {
    enumValues: ['keep_sheets', 'replace_file'],
    enumLabels: { keep_sheets: 'Keep other sheets', replace_file: 'Replace the file' },
    defaultValue: 'keep_sheets',
    noExpression: true,
    showWhen: WRITE_ONLY,
  }),
]

export const outputs: OutputParam[] = [
  output('table', 'Table', 'table', 'Table read from the sheet.', { showWhen: READ_ONLY }),
  output('row_count', 'Row Count', 'integer', 'Number of rows in the table that was read.', {
    showWhen: READ_ONLY,
  }),
  output('schema', 'Schema', 'array', 'Column name/type descriptors for the table that was read.', {
    showWhen: READ_ONLY,
  }),
  output('sheets', 'Sheets', 'array', 'Every sheet name in the workbook, in workbook order.', {
    showWhen: READ_ONLY,
  }),
  output('file', 'File', 'string', 'Path of the workbook that was written.', {
    showWhen: WRITE_ONLY,
  }),
  output('success', 'Success', 'boolean', 'True when no cell errors occurred.'),
  output('errors', 'Errors', 'array', 'Per-cell read errors.'),
]
