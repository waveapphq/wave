/**
 * Excel Parser plugin parameter schema tests (REQ-3.4.1.13, REQ-3.4.3.3).
 *
 * The Excel plugin has two operations (Read / Write) selected by `operation`.
 * Read-only params (range, header controls, column typing, empty/mismatch,
 * sorts/filters) are gated by showWhen operation=read; Write's placement and
 * existing-file params by operation=write. The form is a flat list - no
 * collapsible groups (XLS-4).
 *
 * Design decisions: XLS-1 through XLS-15
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  getInputParams,
  getOutputParams,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import {
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const READ_ONLY = { field: 'operation', values: ['read'] }
const WRITE_ONLY = { field: 'operation', values: ['write'] }

interface FileReferenceKeys {
  fileReference?: 'file' | 'file-or-folder' | 'folder' | 'save-as'
  fileReferenceArtifactsOnly?: boolean
}

function inputsByName(): Record<string, InputParam> {
  return Object.fromEntries((getInputParams('excel-parser') ?? []).map((p) => [p.name, p]))
}

/** Every descriptor under one wire name, in declaration order. */
function inputsNamed(name: string): InputParam[] {
  return (getInputParams('excel-parser') ?? []).filter((p) => p.name === name)
}

/** The two picker keys read off a row without widening the row to `unknown`. */
function fileRef(row: InputParam): FileReferenceKeys {
  return row as InputParam & FileReferenceKeys
}

function outputsByName(): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams('excel-parser') ?? []).map((o) => [o.name, o]))
}

/** Names of the params visible for one operation, in declaration order. */
function visibleFor(operation: 'read' | 'write'): string[] {
  return (getInputParams('excel-parser') ?? [])
    .filter((p) => {
      const conditions = p.showWhenAll ?? (p.showWhen ? [p.showWhen] : [])
      return conditions
        .filter((c) => c.field === 'operation')
        .every((c) => c.values.includes(operation))
    })
    .map((p) => p.name)
}

describe('registration', () => {
  it('registers excel-parser in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['excel-parser']).toBeDefined()
  })

  it('registers excel-parser in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['excel-parser']).toBeDefined()
  })

  it('resolves excel-parser via hasNodeParams', () => {
    expect(hasNodeParams('excel-parser')).toBe(true)
  })
})

describe('field order (XLS-4, XLS-11)', () => {
  it('declares every parameter once, in the order both operations read', () => {
    expect((getInputParams('excel-parser') ?? []).map((p) => p.name)).toEqual([
      'operation',
      'workbook',
      'workbook',
      'sheet',
      'range',
      'has_header',
      'header_row',
      'column_types',
      'schema_source',
      'empty_cells',
      'on_mismatch',
      'sorts',
      'filters',
      'table',
      'write_header',
      'start_cell',
      'if_exists',
    ])
  })

  it('shows the Read parameters in wireframe order', () => {
    expect(visibleFor('read')).toEqual([
      'operation',
      'workbook',
      'sheet',
      'range',
      'has_header',
      'header_row',
      'column_types',
      'schema_source',
      'empty_cells',
      'on_mismatch',
      'sorts',
      'filters',
    ])
  })

  it('shows the Write parameters in wireframe order', () => {
    expect(visibleFor('write')).toEqual([
      'operation',
      'workbook',
      'sheet',
      'sorts',
      'filters',
      'table',
      'write_header',
      'start_cell',
      'if_exists',
    ])
  })

  it('is a flat list - no parameter carries a collapsible group (XLS-4)', () => {
    const grouped = (getInputParams('excel-parser') ?? []).filter((p) => p.group !== undefined)
    expect(grouped).toEqual([])
  })
})

describe('operation selector', () => {
  it('is a string enum of read | write defaulting to read', () => {
    const operation = inputsByName().operation
    expect(operation.type).toBe('string')
    expect(operation.enumValues).toEqual(['read', 'write'])
    expect(operation.defaultValue).toBe('read')
  })

  it('names the direction of conversion in each label', () => {
    expect(inputsByName().operation.enumLabels).toEqual({
      read: 'Read (workbook → table)',
      write: 'Write (table → workbook)',
    })
  })

  it('renders operation as a selector, never an expression', () => {
    expect(inputsByName().operation.noExpression).toBe(true)
  })
})

describe('workbook, sheet and range', () => {
  it('requires workbook for both operations, one flavor per operation', () => {
    const flavors = inputsNamed('workbook')
    expect(flavors).toHaveLength(2)
    expect(flavors.map((p) => p.showWhen)).toEqual([READ_ONLY, WRITE_ONLY])
    for (const workbook of flavors) {
      expect(workbook.label, workbook.placeholder).toBe('Workbook')
      expect(workbook.type, workbook.placeholder).toBe('string')
      expect(workbook.required, workbook.placeholder).toBe(true)
      expect(workbook.allowedFormats, workbook.placeholder).toEqual(['plain'])
      expect(workbook.description, workbook.placeholder).toBe(
        'Workbook file to read from or write to.',
      )
      expect(workbook.retainOnHide, workbook.placeholder).toBeUndefined()
    }
  })

  it('describes the accepted path forms per flavor: Read may take test data, Write may not (TDATA-10)', () => {
    const [read, write] = inputsNamed('workbook')
    expect(read.placeholder).toBe('artifact://…, testdata://…, or /abs/path')
    expect(write.placeholder).toBe('artifact://…, or /abs/path')
  })

  it('browses for a file on Read and for a save target on Write (TDATA-10)', () => {
    const [read, write] = inputsNamed('workbook')
    expect(fileRef(read).fileReference).toBe('file')
    expect(fileRef(write).fileReference).toBe('save-as')
    expect(fileRef(read).fileReferenceArtifactsOnly).toBeUndefined()
    expect(fileRef(write).fileReferenceArtifactsOnly).toBeUndefined()
  })

  it('puts the picker on the workbook rows and nowhere else', () => {
    const withPicker = (getInputParams('excel-parser') ?? []).filter(
      (p) => fileRef(p).fileReference !== undefined,
    )
    expect(withPicker.map((p) => p.name)).toEqual(['workbook', 'workbook'])
  })

  it('has sheet as an optional text field for both operations (XLS-5)', () => {
    const sheet = inputsByName().sheet
    expect(sheet.type).toBe('string')
    expect(sheet.required).toBe(false)
    expect(sheet.showWhen).toBeUndefined()
    expect(sheet.placeholder).toBeTruthy()
  })

  it('has range as a read-only-mode text field in A1 notation (XLS-6)', () => {
    const range = inputsByName().range
    expect(range.type).toBe('string')
    expect(range.required).toBe(false)
    expect(range.showWhen).toEqual(READ_ONLY)
    expect(range.placeholder).toBe('A1:F200')
  })
})

describe('header controls (XLS-7)', () => {
  it('has has_header boolean defaulting to true, read only', () => {
    const hasHeader = inputsByName().has_header
    expect(hasHeader.type).toBe('boolean')
    expect(hasHeader.defaultValue).toBe(true)
    expect(hasHeader.showWhen).toEqual(READ_ONLY)
  })

  it('has header_row as an integer carrying a real default of 1', () => {
    const headerRow = inputsByName().header_row
    expect(headerRow.type).toBe('integer')
    expect(headerRow.defaultValue).toBe(1)
  })

  it('shows header_row only while Has header row is checked', () => {
    expect(inputsByName().header_row.showWhenAll).toEqual([
      READ_ONLY,
      { field: 'has_header', values: ['true'] },
    ])
  })
})

describe('column typing (XLS-8)', () => {
  it('has column_types enum auto|string|schema defaulting to auto, read only', () => {
    const columnTypes = inputsByName().column_types
    expect(columnTypes.enumValues).toEqual(['auto', 'string', 'schema'])
    expect(columnTypes.defaultValue).toBe('auto')
    expect(columnTypes.showWhen).toEqual(READ_ONLY)
  })

  it('has schema_source as a table variable ref shown only for read + schema mode', () => {
    const schemaSource = inputsByName().schema_source
    expect(schemaSource.type).toBe('table')
    expect(schemaSource.variableRef).toEqual({ types: ['table'] })
    expect(schemaSource.variableRefExistingOnly).toBe(true)
    expect(schemaSource.showWhenAll).toEqual([
      READ_ONLY,
      { field: 'column_types', values: ['schema'] },
    ])
  })

  it('requires schema_source only in read + schema mode', () => {
    expect(inputsByName().schema_source.requiredWhenAll).toEqual([
      READ_ONLY,
      { field: 'column_types', values: ['schema'] },
    ])
  })

  it('has empty_cells enum none|default defaulting to none, read only', () => {
    const emptyCells = inputsByName().empty_cells
    expect(emptyCells.enumValues).toEqual(['none', 'default'])
    expect(emptyCells.defaultValue).toBe('none')
    expect(emptyCells.showWhen).toEqual(READ_ONLY)
  })

  it('has on_mismatch enum fail|skip_row|replace_default defaulting to fail, read only', () => {
    const onMismatch = inputsByName().on_mismatch
    expect(onMismatch.enumValues).toEqual(['fail', 'skip_row', 'replace_default'])
    expect(onMismatch.defaultValue).toBe('fail')
    expect(onMismatch.showWhen).toEqual(READ_ONLY)
  })

  it('matches the CSV converter on the typing enumerations it shares (XLS-8)', () => {
    const csv = Object.fromEntries((getInputParams('csv-parser') ?? []).map((p) => [p.name, p]))
    const excel = inputsByName()
    for (const name of ['column_types', 'empty_cells', 'on_mismatch']) {
      expect(excel[name].enumValues).toEqual(csv[name].enumValues)
      expect(excel[name].enumLabels).toEqual(csv[name].enumLabels)
    }
  })
})

describe('transform params (XLS-10)', () => {
  it('declares sorts and filters for both operations, so a table can be shaped on the way out', () => {
    const inputs = inputsByName()
    expect(inputs.sorts.type).toBe('array')
    expect(inputs.sorts.showWhen).toBeUndefined()
    expect(inputs.filters.type).toBe('array')
    expect(inputs.filters.showWhen).toBeUndefined()
  })

  it('matches the CSV converter on the transform params it shares', () => {
    const csv = Object.fromEntries((getInputParams('csv-parser') ?? []).map((p) => [p.name, p]))
    const excel = inputsByName()
    for (const name of ['sorts', 'filters']) {
      expect(excel[name].type).toEqual(csv[name].type)
      expect(excel[name].showWhen).toEqual(csv[name].showWhen)
    }
  })
})

describe('write inputs (XLS-11, XLS-12, XLS-13)', () => {
  it('has table as a table variable ref shown only for write', () => {
    const table = inputsByName().table
    expect(table.type).toBe('table')
    expect(table.variableRef).toEqual({ types: ['table'] })
    expect(table.variableRefExistingOnly).toBe(true)
    expect(table.showWhen).toEqual(WRITE_ONLY)
  })

  it('requires table only in write mode', () => {
    expect(inputsByName().table.requiredWhen).toEqual(WRITE_ONLY)
  })

  it('accepts an expression, so a table can be shaped inline', () => {
    expect(inputsByName().table.noExpression).toBeUndefined()
  })

  it('has write_header boolean defaulting to true, write only', () => {
    const writeHeader = inputsByName().write_header
    expect(writeHeader.type).toBe('boolean')
    expect(writeHeader.defaultValue).toBe(true)
    expect(writeHeader.showWhen).toEqual(WRITE_ONLY)
  })

  it('has start_cell carrying A1 as a value, not a placeholder', () => {
    const startCell = inputsByName().start_cell
    expect(startCell.type).toBe('string')
    expect(startCell.defaultValue).toBe('A1')
    expect(startCell.showWhen).toEqual(WRITE_ONLY)
  })

  it('has if_exists enum defaulting to the non-destructive option', () => {
    const ifExists = inputsByName().if_exists
    expect(ifExists.enumValues).toEqual(['keep_sheets', 'replace_file'])
    expect(ifExists.defaultValue).toBe('keep_sheets')
    expect(ifExists.showWhen).toEqual(WRITE_ONLY)
  })

  it('labels the existing-file choices by what happens to the workbook', () => {
    expect(inputsByName().if_exists.enumLabels).toEqual({
      keep_sheets: 'Keep other sheets',
      replace_file: 'Replace the file',
    })
  })
})

describe('outputs (XLS-14)', () => {
  it('exposes the read + write outputs with correct types', () => {
    const outputs = outputsByName()
    expect(outputs.table.type).toBe('table')
    expect(outputs.row_count.type).toBe('integer')
    expect(outputs.schema.type).toBe('array')
    expect(outputs.sheets.type).toBe('array')
    expect(outputs.file.type).toBe('string')
    expect(outputs.success.type).toBe('boolean')
    expect(outputs.errors.type).toBe('array')
  })

  it('lists the outputs in the wireframe order', () => {
    expect((getOutputParams('excel-parser') ?? []).map((o) => o.name)).toEqual([
      'table',
      'row_count',
      'schema',
      'sheets',
      'file',
      'success',
      'errors',
    ])
  })

  it('labels the outputs as the wireframe does', () => {
    const outputs = outputsByName()
    expect(outputs.table.label).toBe('Table')
    expect(outputs.row_count.label).toBe('Row Count')
    expect(outputs.schema.label).toBe('Schema')
    expect(outputs.sheets.label).toBe('Sheets')
    expect(outputs.file.label).toBe('File')
    expect(outputs.success.label).toBe('Success')
    expect(outputs.errors.label).toBe('Errors')
  })

  it('exposes the workbook sheet names so a loop can walk every sheet', () => {
    expect(outputsByName().sheets.description).toBeTruthy()
  })
})

describe('palette + icon wiring (XLS-15)', () => {
  it('has an Excel palette definition using the grid Sheet icon', () => {
    const def = getPluginById('excel-parser')
    expect(def).toBeDefined()
    expect(def!.name).toBe('Excel')
    expect(def!.category).toBe('data')
    expect(def!.iconName).toBe('Sheet')
  })

  it('registers the canvas icon + emerald color for excel-parser', () => {
    expect(getIconName('excel-parser')).toBe('sheet')
    expect(getColorClass('excel-parser')).toBe('text-emerald-500')
  })

  it('stays distinguishable from the CSV element at node size', () => {
    expect(getIconName('excel-parser')).not.toBe(getIconName('csv-parser'))
    expect(getPluginById('csv-parser')!.iconName).toBe('FileSpreadsheet')
  })
})
