/**
 * CSV Parser plugin parameter schema tests (REQ-3.4.1.12, REQ-3.4.3.3).
 *
 * The CSV plugin has two operations (Parse / Serialize) selected by `operation`.
 * Parse-only params (csv_content, column typing, empty/mismatch, sorts/filters)
 * are gated by showWhen operation=parse; Serialize's `table` by operation=serialize.
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

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

describe('registration', () => {
  it('registers csv-parser in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['csv-parser']).toBeDefined()
  })

  it('registers csv-parser in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['csv-parser']).toBeDefined()
  })

  it('resolves csv-parser via hasNodeParams', () => {
    expect(hasNodeParams('csv-parser')).toBe(true)
  })
})

describe('operation selector', () => {
  it('is a string enum of parse | serialize defaulting to parse', () => {
    const operation = inputsByName('csv-parser').operation
    expect(operation).toBeDefined()
    expect(operation.type).toBe('string')
    expect(operation.enumValues).toEqual(['parse', 'serialize'])
    expect(operation.defaultValue).toBe('parse')
  })

  it('renders operation as a selector, never an expression', () => {
    expect(inputsByName('csv-parser').operation.noExpression).toBe(true)
  })
})

describe('parse inputs', () => {
  it('has csv_content as a string shown only for parse', () => {
    const csvContent = inputsByName('csv-parser').csv_content
    expect(csvContent).toBeDefined()
    expect(csvContent.type).toBe('string')
    expect(csvContent.showWhen).toEqual({ field: 'operation', values: ['parse'] })
  })

  it('requires csv_content only in parse mode', () => {
    expect(inputsByName('csv-parser').csv_content.requiredWhen).toEqual({
      field: 'operation',
      values: ['parse'],
    })
  })

  it('has delimiter defaulting to a comma', () => {
    const delimiter = inputsByName('csv-parser').delimiter
    expect(delimiter.type).toBe('string')
    expect(delimiter.defaultValue).toBe(',')
  })

  it('has has_header boolean defaulting to true', () => {
    const hasHeader = inputsByName('csv-parser').has_header
    expect(hasHeader.type).toBe('boolean')
    expect(hasHeader.defaultValue).toBe(true)
  })

  it('has column_types enum auto|string|schema defaulting to auto', () => {
    const columnTypes = inputsByName('csv-parser').column_types
    expect(columnTypes.type).toBe('string')
    expect(columnTypes.enumValues).toEqual(['auto', 'string', 'schema'])
    expect(columnTypes.defaultValue).toBe('auto')
    expect(columnTypes.showWhen).toEqual({ field: 'operation', values: ['parse'] })
  })

  it('has schema_source as a table variable ref shown only for parse + schema mode', () => {
    const schemaSource = inputsByName('csv-parser').schema_source
    expect(schemaSource.type).toBe('table')
    expect(schemaSource.variableRef).toEqual({ types: ['table'] })
    expect(schemaSource.showWhenAll).toEqual([
      { field: 'operation', values: ['parse'] },
      { field: 'column_types', values: ['schema'] },
    ])
  })

  it('has empty_cells enum none|default defaulting to none', () => {
    const emptyCells = inputsByName('csv-parser').empty_cells
    expect(emptyCells.enumValues).toEqual(['none', 'default'])
    expect(emptyCells.defaultValue).toBe('none')
  })

  it('has on_mismatch enum fail|skip_row|replace_default defaulting to fail', () => {
    const onMismatch = inputsByName('csv-parser').on_mismatch
    expect(onMismatch.enumValues).toEqual(['fail', 'skip_row', 'replace_default'])
    expect(onMismatch.defaultValue).toBe('fail')
  })

  it('declares sorts and filters for both operations, so a table can be shaped on the way out', () => {
    const inputs = inputsByName('csv-parser')
    expect(inputs.sorts.type).toBe('array')
    expect(inputs.sorts.showWhen).toBeUndefined()
    expect(inputs.filters.type).toBe('array')
    expect(inputs.filters.showWhen).toBeUndefined()
  })

})

describe('serialize inputs', () => {
  it('has table as a table variable ref shown only for serialize', () => {
    const table = inputsByName('csv-parser').table
    expect(table).toBeDefined()
    expect(table.type).toBe('table')
    expect(table.variableRef).toEqual({ types: ['table'] })
    expect(table.showWhen).toEqual({ field: 'operation', values: ['serialize'] })
  })

  it('accepts an expression, so a table can be shaped inline', () => {
    expect(inputsByName('csv-parser').table.noExpression).toBeUndefined()
  })

  it('requires table only in serialize mode', () => {
    expect(inputsByName('csv-parser').table.requiredWhen).toEqual({
      field: 'operation',
      values: ['serialize'],
    })
  })
})

describe('outputs', () => {
  it('exposes the parse + serialize outputs with correct types', () => {
    const outputs = outputsByName('csv-parser')
    expect(outputs.table.type).toBe('table')
    expect(outputs.row_count.type).toBe('integer')
    expect(outputs.schema.type).toBe('array')
    expect(outputs.csv_content.type).toBe('string')
    expect(outputs.success.type).toBe('boolean')
    expect(outputs.errors.type).toBe('array')
  })

  it('renames the resolved-columns output to schema (not "headers")', () => {
    const names = (getOutputParams('csv-parser') ?? []).map((o) => o.name)
    expect(names).toContain('schema')
    expect(names).not.toContain('headers')
  })
})

describe('palette + icon wiring', () => {
  it('has a CSV palette definition using the spreadsheet icon', () => {
    const def = getPluginById('csv-parser')
    expect(def).toBeDefined()
    expect(def!.name).toBe('CSV')
    expect(def!.category).toBe('data')
    expect(def!.iconName).toBe('FileSpreadsheet')
  })

  it('registers the canvas icon + emerald color for csv-parser', () => {
    expect(getIconName('csv-parser')).toBe('file-spreadsheet')
    expect(getColorClass('csv-parser')).toBe('text-emerald-500')
  })
})
