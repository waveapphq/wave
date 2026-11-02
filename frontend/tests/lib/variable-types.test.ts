import { describe, it, expect } from 'vitest'
import {
  recordToRows,
  rowsToRecord,
  duplicateRows,
  variableRowsDiffer,
  deleteRows,
  type VariableRecord,
  type VariableRow,
} from '@/lib/variable-types'

describe('recordToRows', () => {
  it('returns empty array for empty record', () => {
    expect(recordToRows({})).toEqual([])
  })

  it('converts record entries to rows with UUIDs', () => {
    const record = {
      host: { type: 'string' as const, value: 'localhost', secret: false },
      port: { type: 'integer' as const, value: '8080', secret: false },
    }
    const rows = recordToRows(record)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'host', type: 'string', value: 'localhost', secret: false })
    expect(rows[1]).toMatchObject({ name: 'port', type: 'integer', value: '8080', secret: false })
    expect(rows[0].id).toBeTruthy()
    expect(rows[0].id).not.toBe(rows[1].id)
  })

  it('preserves secret flag', () => {
    const record = {
      key: { type: 'string' as const, value: 'secret', secret: true },
    }
    const rows = recordToRows(record)
    expect(rows[0].secret).toBe(true)
  })
})

describe('rowsToRecord', () => {
  it('returns empty record for empty rows', () => {
    expect(rowsToRecord([])).toEqual({})
  })

  it('converts rows to record', () => {
    const rows: VariableRow[] = [
      { id: '1', name: 'a', type: 'string', secret: false, value: 'x' },
      { id: '2', name: 'b', type: 'integer', secret: true, value: '42' },
    ]
    const record = rowsToRecord(rows)

    expect(record).toEqual({
      a: { type: 'string', value: 'x', secret: false },
      b: { type: 'integer', value: '42', secret: true },
    })
  })

  it('skips rows with empty or whitespace name', () => {
    const rows: VariableRow[] = [
      { id: '1', name: '', type: 'string', secret: false, value: 'skip' },
      { id: '2', name: '  ', type: 'string', secret: false, value: 'skip' },
      { id: '3', name: 'keep', type: 'string', secret: false, value: 'yes' },
    ]
    expect(Object.keys(rowsToRecord(rows))).toEqual(['keep'])
  })
})

describe('duplicateRows', () => {
  const rows: VariableRow[] = [
    { id: 'r1', name: 'host', type: 'string', secret: false, value: 'localhost' },
    { id: 'r2', name: 'port', type: 'integer', secret: false, value: '8080' },
  ]

  it('returns empty array when no ids selected', () => {
    expect(duplicateRows(rows, new Set())).toEqual([])
  })

  it('duplicates selected rows with _copy suffix', () => {
    const result = duplicateRows(rows, new Set(['r1']))

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('host_copy')
    expect(result[0].type).toBe('string')
    expect(result[0].value).toBe('localhost')
    expect(result[0].id).not.toBe('r1')
  })

  it('increments suffix to avoid name collisions', () => {
    const rowsWithCopy: VariableRow[] = [
      ...rows,
      { id: 'r3', name: 'host_copy', type: 'string', secret: false, value: 'x' },
    ]
    const result = duplicateRows(rowsWithCopy, new Set(['r1']))

    expect(result[0].name).toBe('host_copy_2')
  })

  it('duplicates multiple rows', () => {
    const result = duplicateRows(rows, new Set(['r1', 'r2']))

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('host_copy')
    expect(result[1].name).toBe('port_copy')
  })

  it('skips unknown ids gracefully', () => {
    const result = duplicateRows(rows, new Set(['nonexistent']))
    expect(result).toEqual([])
  })
})

describe('deleteRows', () => {
  const rows: VariableRow[] = [
    { id: 'r1', name: 'a', type: 'string', secret: false, value: 'x' },
    { id: 'r2', name: 'b', type: 'string', secret: false, value: 'y' },
    { id: 'r3', name: 'c', type: 'string', secret: false, value: 'z' },
  ]

  it('removes selected rows', () => {
    const result = deleteRows(rows, new Set(['r1', 'r3']))
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('b')
  })

  it('returns all rows when nothing selected', () => {
    expect(deleteRows(rows, new Set())).toHaveLength(3)
  })

  it('returns empty when all selected', () => {
    expect(deleteRows(rows, new Set(['r1', 'r2', 'r3']))).toHaveLength(0)
  })
})

describe('element types (REQ-3.1.3.19)', () => {
  it('reads a record\'s element types onto its row and writes them back only for an array / map', () => {
    const [row] = recordToRows({ m: { type: 'map', value: '{"n":"1"}', secret: false, elementTypes: { n: 'integer' } } })
    expect(row.elementTypes).toEqual({ n: 'integer' })
    expect(rowsToRecord([row]).m.elementTypes).toEqual({ n: 'integer' })
    expect(rowsToRecord([{ ...row, type: 'string', value: 'x' }]).m).not.toHaveProperty('elementTypes')
  })

  it('copies a duplicated row\'s element types', () => {
    const rows: VariableRow[] = [{ id: 'r1', name: 'a', type: 'array', secret: false, value: '["1"]', elementTypes: ['integer'] }]
    expect(duplicateRows(rows, new Set(['r1']))[0].elementTypes).toEqual(['integer'])
  })

  it('reads a changed element type as a change', () => {
    const stored: Record<string, VariableRecord> = {
      m: { type: 'map', value: '{"n":"1"}', secret: false, elementTypes: { n: 'string' } },
    }
    const [row] = recordToRows(stored)
    expect(variableRowsDiffer(stored, [row])).toBe(false)
    expect(variableRowsDiffer(stored, [{ ...row, elementTypes: { n: 'integer' } }])).toBe(true)
  })
})
