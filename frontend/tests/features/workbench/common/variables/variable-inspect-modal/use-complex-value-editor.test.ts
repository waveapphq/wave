// useComplexValueEditor, the "Edit value" sheet's array / map / table core, driven directly (REQ-3.1.3.11).

import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  isComplexEditorType,
  useComplexValueEditor,
  type UseComplexValueEditorArgs,
} from '@/features/workbench/common/variables/variable-inspect-modal/use-complex-value-editor'
import { EDIT_COLUMN_WIDTH } from '@/components/shared/variable-bodies/table-edit-widths'
import type { VariableType } from '@/lib/variable-types'
import type { TableColumnSchema } from '@/lib/variable-validation'

function setup(overrides: Partial<UseComplexValueEditorArgs> = {}) {
  // The value is host-owned (controlled): onChange records the new value so the
  // test can re-render with it, mirroring the modal's draft-value round trip.
  let controlled: unknown = overrides.value ?? []
  const onChange = vi.fn((v: unknown) => {
    controlled = v
  })
  const onValidChange = vi.fn()
  const base: UseComplexValueEditorArgs = {
    type: 'array',
    value: controlled,
    onChange,
    onValidChange,
    view: 'code',
    seedKey: 0,
    ...overrides,
  }
  const { result, rerender } = renderHook(
    (props: UseComplexValueEditorArgs) => useComplexValueEditor(props),
    { initialProps: base },
  )
  return {
    result,
    onChange,
    onValidChange,
    // Re-render reflecting the latest controlled value (+ any prop override).
    sync: (next: Partial<UseComplexValueEditorArgs> = {}) =>
      rerender({ ...base, value: controlled, ...next }),
  }
}

const OVER_CAP_INT = '12345678901234567890' // 20 digits > the 19-digit integer cap

describe('useComplexValueEditor - type guard', () => {
  it('recognizes the three complex types only', () => {
    expect(isComplexEditorType('array')).toBe(true)
    expect(isComplexEditorType('map')).toBe(true)
    expect(isComplexEditorType('table')).toBe(true)
    expect(isComplexEditorType('string')).toBe(false)
    expect(isComplexEditorType('integer')).toBe(false)
  })
})

describe('useComplexValueEditor - array Code', () => {
  it('parses items + inferred types and clears the syntax error', () => {
    const { result, onChange } = setup({ type: 'array', value: [] })
    act(() => result.current.bodyData.onCodeChange('[1, "x"]'))
    expect(onChange).toHaveBeenCalledWith(['1', 'x'])
    expect(result.current.bodyData.arrayTypes).toEqual(['integer', 'string'])
    expect(result.current.stripMessage).toBeNull()
    expect(result.current.semanticInvalid).toBe(false)
  })

  it('flags an over-cap nested integer at its line, gating without locking Visual', () => {
    const { result, sync } = setup({ type: 'array', value: [] })
    act(() => result.current.bodyData.onCodeChange(`[\n  ${OVER_CAP_INT}\n]`))
    sync()
    expect(result.current.stripMessage).toContain('max 19 digits')
    expect(result.current.stripMessage).toContain('Line 2')
    expect(result.current.semanticInvalid).toBe(true)
    expect(result.current.visualLocked).toBe(false)
  })

  it('treats a JSON parse failure as a syntax error that locks Visual', () => {
    const { result } = setup({ type: 'array', value: [] })
    act(() => result.current.bodyData.onCodeChange('[bad'))
    expect(result.current.stripMessage).not.toBeNull()
    expect(result.current.visualLocked).toBe(true)
    expect(result.current.visualLockTooltip).toBe('Fix JSON errors to switch to Visual')
  })

  it('points a non-cap element error at the slot opening line (not a number line)', () => {
    const { result, sync } = setup({ type: 'array', value: [] })
    act(() => result.current.bodyData.onCodeChange('[1]')) // inferred integer type
    // The host value diverges from the inferred type with a non-numeric (a non-cap
    // mismatch), so the line resolver falls back to the slot's opening line.
    sync({ value: ['notanumber'] })
    expect(result.current.stripMessage).toContain('Index 0')
    expect(result.current.stripMessage).toContain('Line 1')
  })
})

describe('useComplexValueEditor - map Code', () => {
  it('parses values + per-key types', () => {
    const { result, onChange } = setup({ type: 'map', value: {} })
    act(() => result.current.bodyData.onCodeChange('{"a": true}'))
    expect(onChange).toHaveBeenCalledWith({ a: true })
    expect(result.current.bodyData.mapTypes).toEqual({ a: 'boolean' })
  })

  it('flags an over-cap nested value by its key line', () => {
    const { result, sync } = setup({ type: 'map', value: {} })
    act(() => result.current.bodyData.onCodeChange(`{\n  "big": ${OVER_CAP_INT}\n}`))
    sync()
    expect(result.current.stripMessage).toContain('max 19 digits')
    expect(result.current.semanticInvalid).toBe(true)
  })

  it('points a non-cap value error at its key line', () => {
    const { result, sync } = setup({ type: 'map', value: {} })
    act(() => result.current.bodyData.onCodeChange('{"a": 1}')) // inferred integer type
    sync({ value: { a: 'notanumber' } })
    expect(result.current.stripMessage).toContain('Key "a"')
    expect(result.current.stripMessage).toContain('Line 1')
  })

  it('treats a value whose key has no inferred type as a string (no error)', () => {
    const { result, sync } = setup({ type: 'map', value: {} })
    act(() => result.current.bodyData.onCodeChange('{}')) // no per-key types
    sync({ value: { extra: 42 } })
    // The untyped value defaults to a string, which accepts the number text.
    expect(result.current.semanticInvalid).toBe(false)
    expect(result.current.stripMessage).toBeNull()
  })
})

describe('useComplexValueEditor - table Code', () => {
  it('flags a cell mismatch against the carried schema', () => {
    const { result } = setup({ type: 'table', value: [{ id: 1 }] })
    act(() => result.current.bodyData.onCodeChange('[{"id":"x"}]'))
    expect(result.current.stripMessage).toContain('expected integer')
    expect(result.current.semanticInvalid).toBe(true)
  })

  it('surfaces a JSON parse failure as the syntax message (not the stale table errors)', () => {
    const { result } = setup({ type: 'table', value: [{ id: 1 }] })
    act(() => result.current.bodyData.onCodeChange('{bad'))
    expect(result.current.stripMessage).not.toBeNull()
    expect(result.current.stripMessages).toBeNull()
    expect(result.current.visualLocked).toBe(true)
  })

  it('locks Visual on a non-row-list shape (structure error) with the table tooltip', () => {
    const { result } = setup({ type: 'table', value: [{ id: 1 }] })
    act(() => result.current.bodyData.onCodeChange('{"id":1}'))
    expect(result.current.visualLocked).toBe(true)
    expect(result.current.visualLockTooltip).toBe('Fix the table structure to switch to Visual')
  })
})

describe('useComplexValueEditor - a whole null in Code (VMGR-96)', () => {
  // The hosts block Save / Create on semanticInvalid or a false body-valid signal.
  function blocksSave(api: ReturnType<typeof setup>): boolean {
    const lastValid = api.onValidChange.mock.calls.at(-1)?.[0]
    return api.result.current.semanticInvalid || lastValid === false
  }

  it.each(['null', '5', '"text"', 'true', '{}'])(
    'refuses the whole text %s in the array Code view',
    (text) => {
      const api = setup({ type: 'array', value: [] })
      act(() => api.result.current.bodyData.onCodeChange(text))
      api.sync()
      expect(api.result.current.stripMessage).toBe('Must be a JSON array')
      expect(blocksSave(api)).toBe(true)
    },
  )

  it.each(['null', '[]', '[1, 2]', '5', '"text"'])(
    'refuses the whole text %s in the map Code view',
    (text) => {
      const api = setup({ type: 'map', value: {} })
      act(() => api.result.current.bodyData.onCodeChange(text))
      api.sync()
      expect(api.result.current.stripMessage).toBe('Must be a JSON object')
      expect(blocksSave(api)).toBe(true)
    },
  )

  it.each(['null', '[]'])('refuses the whole text %s in a string-only map Code view', (text) => {
    const api = setup({ type: 'map', value: {}, stringValuesOnly: true, mapEntry: {} })
    act(() => api.result.current.bodyData.onCodeChange(text))
    api.sync()
    expect(api.result.current.stripMessage).toBe('Must be a JSON object')
    expect(blocksSave(api)).toBe(true)
  })

  it('refuses a whole null in the table Code view with the table structure text', () => {
    const api = setup({ type: 'table', value: [] })
    act(() => api.result.current.bodyData.onCodeChange('null'))
    api.sync()
    expect(api.result.current.stripMessage).toBe('Table must be a list of rows')
    expect(blocksSave(api)).toBe(true)
  })

  it('clears the refusal once the array text is a list again', () => {
    const api = setup({ type: 'array', value: [] })
    act(() => api.result.current.bodyData.onCodeChange('null'))
    api.sync()
    act(() => api.result.current.bodyData.onCodeChange('[1]'))
    api.sync()
    expect(api.onChange).toHaveBeenLastCalledWith(['1'])
    expect(api.result.current.stripMessage).toBeNull()
    expect(blocksSave(api)).toBe(false)
  })

  it('keeps a null item inside the array text as a null item', () => {
    const api = setup({ type: 'array', value: [] })
    act(() => api.result.current.bodyData.onCodeChange('[1, null]'))
    api.sync()
    expect(api.onChange).toHaveBeenLastCalledWith(['1', null])
    expect(api.result.current.stripMessage).toBeNull()
    expect(blocksSave(api)).toBe(false)
  })

  it('keeps a null value inside the map text as a null value', () => {
    const api = setup({ type: 'map', value: {} })
    act(() => api.result.current.bodyData.onCodeChange('{"a": null}'))
    api.sync()
    expect(api.onChange).toHaveBeenLastCalledWith({ a: null })
    expect(api.result.current.stripMessage).toBeNull()
    expect(blocksSave(api)).toBe(false)
  })
})

describe('useComplexValueEditor - Visual strip', () => {
  it('surfaces the per-element messages the Visual body emits', () => {
    const { result } = setup({ type: 'array', value: ['x'], view: 'visual' })
    act(() => result.current.bodyData.onVisualErrors(['Index 0: not a string', 'Index 1: bad']))
    expect(result.current.stripMessage).toBe('Index 0: not a string')
    expect(result.current.stripMessages).toEqual(['Index 0: not a string', 'Index 1: bad'])
  })
})

describe('useComplexValueEditor - validity + format', () => {
  it('forwards the Code body validity and reflects it in the Visual lock', () => {
    const { result, onValidChange } = setup({ type: 'array', value: [] })
    act(() => result.current.bodyData.onCodeValidChange(false))
    expect(onValidChange).toHaveBeenCalledWith(false)
    expect(result.current.visualLocked).toBe(true)
    expect(result.current.formatBlocked).toBe(true)
    act(() => result.current.markFormatted())
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    expect(result.current.visualLocked).toBe(false)
  })
})

describe('useComplexValueEditor - serialize + sync', () => {
  it('serializes the draft to Code text on demand', () => {
    const { result } = setup({ type: 'array', value: ['a'] })
    expect(result.current.serializeDraftToCode()).toBe('[\n  "a"\n]')
  })

  it('falls back to plain JSON when asked to serialize a non-complex type', () => {
    const { result } = setup({ type: 'string' as VariableType, value: 'hi', view: 'visual' })
    expect(result.current.serializeDraftToCode()).toBe('"hi"')
  })

  it('syncs the Code document from the draft', () => {
    const { result } = setup({ type: 'array', value: [1], view: 'visual' })
    act(() => result.current.syncCodeText())
    // The synced text now drives the line resolvers (an over-cap edit lands a line).
    expect(typeof result.current.serializeDraftToCode()).toBe('string')
  })
})

describe('useComplexValueEditor - seeding', () => {
  it('re-seeds per-element types from the value when the seed key changes', () => {
    const { result, sync } = setup({ type: 'array', value: ['x'], view: 'visual', seedKey: 0 })
    expect(result.current.bodyData.arrayTypes).toEqual(['string'])
    // A new seed key re-seeds the per-element types from the new value.
    sync({ value: [1, 2], seedKey: 1 })
    expect(result.current.bodyData.arrayTypes).toEqual(['integer', 'integer'])
  })

  it('re-seeds the Code text in Code view, so a message names the line of the new value', () => {
    const { result, sync } = setup({ type: 'array', value: [], view: 'code', seedKey: 0, elementTypes: [] })
    sync({ value: [OVER_CAP_INT], seedKey: 1, elementTypes: ['integer'] })
    expect(result.current.stripMessage).toContain('max 19 digits')
    expect(result.current.stripMessage).toContain('Line 2')
  })

  it('re-seeds a string-only map in Code view and keeps it valid', () => {
    const { result, sync, onValidChange } = setup({
      type: 'map',
      value: {},
      view: 'code',
      seedKey: 0,
      stringValuesOnly: true,
      mapEntry: {},
    })
    sync({ value: { region: 'eu' }, seedKey: 1 })
    expect(result.current.stripMessage).toBeNull()
    expect(onValidChange).not.toHaveBeenCalledWith(false)
  })

  it('seeds a table schema and a map key set from their values', () => {
    const table = setup({ type: 'table', value: [{ id: 1 }], view: 'visual' })
    expect(table.result.current.bodyData.tableSchema).toEqual([{ name: 'id', type: 'integer' }])
    const map = setup({ type: 'map', value: { a: 1, b: 'x' }, view: 'visual' })
    expect(map.result.current.bodyData.mapTypes).toEqual({ a: 'integer', b: 'string' })
  })
})

describe('useComplexValueEditor - table widths (VMGR-81)', () => {
  it('seeds a column width per table column from the value', () => {
    const { result } = setup({ type: 'table', value: [{ id: 1, name: 'a' }], view: 'visual' })
    expect(result.current.bodyData.tableWidths).toEqual([EDIT_COLUMN_WIDTH, EDIT_COLUMN_WIDTH])
  })

  it('leaves table widths empty for a non-table type', () => {
    const { result } = setup({ type: 'array', value: [1, 2], view: 'visual' })
    expect(result.current.bodyData.tableWidths).toEqual([])
  })

  it('updates table widths through onTableWidthsChange', () => {
    const { result } = setup({ type: 'table', value: [{ id: 1 }], view: 'visual' })
    act(() => result.current.bodyData.onTableWidthsChange([260]))
    expect(result.current.bodyData.tableWidths).toEqual([260])
  })

  it('persists table widths across a Visual -> Code -> Visual round trip', () => {
    const { result, sync } = setup({ type: 'table', value: [{ id: 1 }], view: 'visual' })
    act(() => result.current.bodyData.onTableWidthsChange([260]))
    sync({ view: 'code' }) // the body unmounts, but the hook keeps the widths
    sync({ view: 'visual' })
    expect(result.current.bodyData.tableWidths).toEqual([260])
  })

  it('re-seeds table widths when the seed key changes', () => {
    const { result, sync } = setup({
      type: 'table',
      value: [{ id: 1 }],
      view: 'visual',
      seedKey: 0,
    })
    act(() => result.current.bodyData.onTableWidthsChange([260]))
    sync({ value: [{ id: 1, name: 'a', extra: 'b' }], seedKey: 1 })
    expect(result.current.bodyData.tableWidths).toEqual([
      EDIT_COLUMN_WIDTH,
      EDIT_COLUMN_WIDTH,
      EDIT_COLUMN_WIDTH,
    ])
  })
})

describe('useComplexValueEditor - stringValuesOnly', () => {
  it('threads stringValuesOnly into bodyData so the map body forces string values', () => {
    const { result } = setup({ type: 'map', value: {}, stringValuesOnly: true })
    expect(result.current.bodyData.stringValuesOnly).toBe(true)
  })

  it('leaves bodyData.stringValuesOnly falsy by default', () => {
    const { result } = setup({ type: 'map', value: {} })
    expect(result.current.bodyData.stringValuesOnly).toBeFalsy()
  })
})

describe('useComplexValueEditor - string-map Code (mapEntry options)', () => {
  it('rebuilds the Code document from the string map on a seed key change in Code view', () => {
    const { result, sync } = setup({
      type: 'map',
      stringValuesOnly: true,
      mapEntry: { keyPolicy: { keyNoun: 'header', caseInsensitive: true } },
      value: { 'X-Trace': 'a', 'x-trace': 'b' },
      view: 'code',
    })
    // The Code document has not been built yet - no source to scan.
    expect(result.current.stripMessage).toBeNull()
    sync({ seedKey: 1 })
    // The reseed serialized the map, so the source-level duplicate scan fires.
    expect(result.current.stripMessage).toBe(
      'Duplicate header "X-Trace" (header names are case-insensitive)',
    )
  })

  it('reports source-level duplicates with the plain voice when no key policy applies', () => {
    const { result } = setup({
      type: 'map',
      stringValuesOnly: true,
      mapEntry: {},
      value: {},
      view: 'code',
    })
    act(() => result.current.bodyData.onCodeChange('{"A": "1", "A": "2"}'))
    expect(result.current.stripMessage).toBe('Duplicate key "A"')
  })

  it('reports a generated-row collision with the plain voice when no key policy applies', () => {
    const { result, sync } = setup({
      type: 'map',
      stringValuesOnly: true,
      mapEntry: { generatedRows: [{ key: 'Content-Type', value: 'application/json' }] },
      value: {},
      view: 'code',
    })
    act(() => result.current.bodyData.onCodeChange('{"content-type": "text/csv"}'))
    sync()
    expect(result.current.stripMessage).toBe('Duplicate key "content-type"')
  })
})

describe('useComplexValueEditor - seeds a stored nested element by its structure', () => {
  it('types an array item held as verbatim JSON text as its nested type', () => {
    // A saved array-of-map re-seeds from JSON TEXT elements (the backend realizes
    // them), so the type pills must recover map / array, not decay to string.
    const { result } = setup({
      type: 'array',
      value: ['{"a":1}', '[1,2]', 'plain'],
      view: 'visual',
    })
    expect(result.current.bodyData.arrayTypes).toEqual(['map', 'array', 'string'])
  })

  it('types a map value held as verbatim JSON text as its nested type', () => {
    const { result } = setup({
      type: 'map',
      value: { m: '{"a":1}', a: '[1]', s: 'x' },
      view: 'visual',
    })
    expect(result.current.bodyData.mapTypes).toEqual({ m: 'map', a: 'array', s: 'string' })
  })
})

describe('useComplexValueEditor - declared element types (REQ-3.1.3.19)', () => {
  it('seeds each row from the declared element types and reports them back in full', () => {
    const { result } = setup({
      type: 'map',
      value: { n: '16', zip: '02134', j: '[1]' },
      elementTypes: { n: 'integer' },
      view: 'visual',
    })
    expect(result.current.bodyData.mapTypes).toEqual({ n: 'integer', zip: 'string', j: 'array' })
    expect(result.current.elementTypes).toEqual({ n: 'integer', zip: 'string', j: 'array' })
  })

  it('seeds a text-only list as text and reports no element types for it', () => {
    const { result } = setup({ type: 'array', value: [502, true, '503'], stringValuesOnly: true, view: 'visual' })
    expect(result.current.bodyData.arrayTypes).toEqual(['string', 'string', 'string'])
    expect(result.current.bodyData.stringValuesOnly).toBe(true)
    expect(result.current.elementTypes).toBeUndefined()
  })

  it('keeps a text-only list text when it is edited in Code', () => {
    const { result } = setup({ type: 'array', value: ['502'], stringValuesOnly: true })
    act(() => result.current.bodyData.onCodeChange('[502, true]'))
    expect(result.current.bodyData.arrayTypes).toEqual(['string', 'string'])
  })

  it('re-seeds a text-only list as text when the seed key changes', () => {
    const { result, sync } = setup({ type: 'array', value: [1], stringValuesOnly: true, view: 'visual' })
    sync({ value: [7, false], seedKey: 1 })
    expect(result.current.bodyData.arrayTypes).toEqual(['string', 'string'])
  })

  it('reports one type per array item', () => {
    const { result } = setup({ type: 'array', value: ['1.0', 'x'], elementTypes: ['float'], view: 'visual' })
    expect(result.current.elementTypes).toEqual(['float', 'string'])
  })

  it('reports no element types for a scalar, a string-only map, or a value of the wrong shape', () => {
    expect(setup({ type: 'string', value: 'x' }).result.current.elementTypes).toBeUndefined()
    expect(
      setup({ type: 'map', value: { a: '1' }, stringValuesOnly: true }).result.current.elementTypes,
    ).toBeUndefined()
    expect(setup({ type: 'array', value: 'src' }).result.current.elementTypes).toBeUndefined()
    expect(setup({ type: 'map', value: ['x'] }).result.current.elementTypes).toBeUndefined()
  })

  it('leaves an expression row out of a typed map\'s element types', () => {
    const { result } = setup({
      type: 'map',
      value: { n: '16', app: "'a' + 'b'" },
      elementTypes: { n: 'integer' },
      mapEntry: { expressionEditor: () => null, expressionKeys: ['app'] },
      mapExprKeys: new Set(['app']),
      view: 'visual',
    })
    expect(result.current.elementTypes).toEqual({ n: 'integer' })
  })

  it('reads a typed map\'s Code with its bare expression rows', () => {
    const onMapExprKeysChange = vi.fn()
    const { result, onChange } = setup({
      type: 'map',
      value: {},
      mapEntry: { expressionEditor: () => null },
      mapExprKeys: new Set<string>(),
      onMapExprKeysChange,
      view: 'code',
    })
    act(() => result.current.bodyData.onCodeChange('{"n": 16, "app": {{ x + 1 }}}'))
    expect(onChange).toHaveBeenCalledWith({ n: '16', app: 'x + 1' })
    expect(onMapExprKeysChange).toHaveBeenCalledWith(new Set(['app']))
  })
})

describe('useComplexValueEditor - an edited table is stored with its column types (REQ-3.5.5.4)', () => {
  const COLUMNS = [
    { name: 'id', type: 'integer' },
    { name: 'price', type: 'float' },
    { name: 'active', type: 'boolean' },
  ]
  const GRID = {
    columns: COLUMNS,
    rows: [
      [1, '2.50', true],
      [null, '3', false],
    ],
  }
  const editTable = (overrides: Partial<UseComplexValueEditorArgs> = {}) =>
    setup({ type: 'table', value: GRID, view: 'visual', ...overrides })

  it('stores a Visual edit as {columns, rows} with the column types, numbers as exact text', () => {
    const { result, sync } = editTable()
    // The Visual body emits row objects with integer and float cells as digit text.
    act(() =>
      result.current.bodyData.onChange([
        { id: '7', price: '2.50', active: true },
        { id: null, price: '3', active: false },
      ]),
    )
    sync()
    expect(result.current.storedValue).toEqual({
      columns: COLUMNS,
      rows: [
        ['7', '2.50', true],
        [null, '3', false],
      ],
    })
  })

  it('stores a Code edit under the carried column types', () => {
    const { result, sync } = editTable({ view: 'code' })
    act(() =>
      result.current.bodyData.onCodeChange('[{"id": 9, "price": 1.25, "active": false}]'),
    )
    sync()
    expect(result.current.storedValue).toEqual({ columns: COLUMNS, rows: [['9', '1.25', false]] })
  })

  it('stores a Visual column type change', () => {
    const { result, sync } = editTable()
    act(() => {
      result.current.bodyData.onChange([{ id: '7', price: '2.50', active: true }])
      result.current.bodyData.onTableSchemaChange([
        { name: 'id', type: 'string' },
        { name: 'price', type: 'float' },
        { name: 'active', type: 'boolean' },
      ])
    })
    sync()
    expect(result.current.storedValue).toEqual({
      columns: [{ name: 'id', type: 'string' }, COLUMNS[1], COLUMNS[2]],
      rows: [['7', '2.50', true]],
    })
  })

  it('keeps the columns of a table whose rows were all deleted', () => {
    const { result, sync } = editTable()
    act(() => result.current.bodyData.onChange([]))
    sync()
    expect(result.current.storedValue).toEqual({ columns: COLUMNS, rows: [] })
  })

  it('stores a table held as a list of rows with the types it opened with', () => {
    const { result } = editTable({ value: [{ id: 1, name: 'a' }] })
    expect(result.current.storedValue).toEqual({
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
      rows: [[1, 'a']],
    })
  })

  it('leaves every type other than a table as the draft', () => {
    const items = ['x']
    expect(setup({ type: 'array', value: items }).result.current.storedValue).toBe(items)
  })
})

// The enum allowed values: the Value Type sets every item's type (VMGR-100, VMGR-104, REQ-3.1.2.11).
describe('useComplexValueEditor - a list typed by one Value Type (itemType)', () => {
  it('passes the Value Type to the list body', () => {
    const { result } = setup({ type: 'array', value: [1, 2], itemType: 'integer', view: 'visual' })
    expect(result.current.bodyData.itemType).toBe('integer')
  })

  it('seeds every item with the Value Type, whatever the item looks like', () => {
    const { result } = setup({ type: 'array', value: [1, 2.5], itemType: 'float', view: 'visual' })
    expect(result.current.bodyData.arrayTypes).toEqual(['float', 'float'])
  })

  it('re-types every item when the Value Type changes', () => {
    const { result, sync } = setup({ type: 'array', value: ['1'], itemType: 'string', view: 'visual' })
    expect(result.current.bodyData.arrayTypes).toEqual(['string'])
    sync({ itemType: 'integer' })
    expect(result.current.bodyData.arrayTypes).toEqual(['integer'])
    expect(result.current.bodyData.itemType).toBe('integer')
  })

  it('re-seeds with the Value Type when the seed key changes', () => {
    const { result, sync } = setup({ type: 'array', value: [], itemType: 'float', view: 'visual', seedKey: 0 })
    sync({ value: [1, 2], seedKey: 1 })
    expect(result.current.bodyData.arrayTypes).toEqual(['float', 'float'])
  })

  it('reads an Integer list written in Code as numbers', () => {
    const { result, onChange } = setup({ type: 'array', value: [], itemType: 'integer' })
    act(() => result.current.bodyData.onCodeChange('[1, 2]'))
    expect(onChange).toHaveBeenLastCalledWith([1, 2])
    expect(result.current.bodyData.arrayTypes).toEqual(['integer', 'integer'])
  })

  it('reads a Float list written in Code as numbers', () => {
    const { result, onChange } = setup({ type: 'array', value: [], itemType: 'float' })
    act(() => result.current.bodyData.onCodeChange('[1.5, 2]'))
    expect(onChange).toHaveBeenLastCalledWith([1.5, 2])
    expect(result.current.bodyData.arrayTypes).toEqual(['float', 'float'])
  })

  it('types every Code item of a String list as a string', () => {
    const { result } = setup({ type: 'array', value: [], itemType: 'string' })
    act(() => result.current.bodyData.onCodeChange('["low", 5]'))
    expect(result.current.bodyData.arrayTypes).toEqual(['string', 'string'])
  })
})

// A carried table with no columns takes them from the rows typed in Code, until they are settled in Visual (REQ-3.5.5.1).
describe('useComplexValueEditor - a carried table with no columns', () => {
  const ZIP_N: TableColumnSchema[] = [
    { name: 'zip', type: 'string' },
    { name: 'n', type: 'integer' },
  ]

  it('types the columns by the tokens of the first typed row, a quoted number staying text', () => {
    const { result, sync } = setup({ type: 'table', value: [] })
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134", "n": 7}]'))
    sync()
    expect(result.current.bodyData.tableSchema).toEqual(ZIP_N)
    expect(result.current.storedValue).toEqual({ columns: ZIP_N, rows: [['02134', '7']] })
  })

  it('keeps taking the columns from the typed rows while they are typed', () => {
    const { result, sync } = setup({ type: 'table', value: [] })
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134"}]'))
    sync()
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134", "n": 7}]'))
    sync()
    expect(result.current.semanticInvalid).toBe(false)
    expect(result.current.storedValue).toEqual({ columns: ZIP_N, rows: [['02134', '7']] })
  })

  it('keeps the typed columns on a switch to Visual, after which Code refuses a new column', () => {
    const { result, sync } = setup({ type: 'table', value: [] })
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134", "n": 7}]'))
    sync()
    act(() => result.current.seedTableSchema())
    sync()
    expect(result.current.bodyData.tableSchema).toEqual(ZIP_N)
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134", "n": 7, "extra": 1}]'))
    sync()
    expect(result.current.stripMessage).toBe('Unexpected column "extra" - change columns in the Visual view')
  })

  it('carries the columns set in Visual into the next Code edit', () => {
    const { result, sync } = setup({ type: 'table', value: [] })
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134"}]'))
    sync()
    act(() => result.current.bodyData.onTableSchemaChange(ZIP_N))
    sync()
    act(() => result.current.bodyData.onCodeChange('[{"zip": "02134"}]'))
    sync()
    expect(result.current.stripMessage).toBe('Missing column "n" - change columns in the Visual view')
  })
})

describe('useComplexValueEditor - a list with per-item {x} (FIELD-6)', () => {
  it('writes an {x} item into Code as a bare {{ expr }}', () => {
    const { result } = setup({
      type: 'array',
      value: ['a', 'x'],
      stringValuesOnly: true,
      listExprIndices: new Set([1]),
      view: 'visual',
    })
    expect(result.current.serializeDraftToCode()).toBe('[\n  "a",\n  {{ x }}\n]')
    expect(result.current.bodyData.serialize(['b', 'y'])).toBe('[\n  "b",\n  {{ y }}\n]')
  })

  it('reads a bare {{ expr }} item back as an {x} item with its index', () => {
    const onListExprIndicesChange = vi.fn()
    const { result, onChange } = setup({
      type: 'array',
      value: [],
      stringValuesOnly: true,
      listExprIndices: new Set<number>(),
      onListExprIndicesChange,
    })
    act(() => result.current.bodyData.onCodeChange('["a", {{ y + 1 }}, "c"]'))
    expect(onChange).toHaveBeenCalledWith(['a', 'y + 1', 'c'])
    expect(onListExprIndicesChange).toHaveBeenCalledWith(new Set([1]))
    expect(result.current.stripMessage).toBeNull()
  })

  it('reads the {x} items of a typed list and keeps its numbers as written', () => {
    const onListExprIndicesChange = vi.fn()
    const { result, onChange, sync } = setup({
      type: 'array',
      value: [],
      listExprIndices: new Set<number>(),
      onListExprIndicesChange,
    })
    act(() => result.current.bodyData.onCodeChange('[16, {{ n + 1 }}]'))
    expect(onChange).toHaveBeenCalledWith(['16', 'n + 1'])
    expect(onListExprIndicesChange).toHaveBeenCalledWith(new Set([1]))
    sync({ listExprIndices: new Set([1]) })
    expect(result.current.elementTypes).toEqual(['integer', 'string'])
    expect(result.current.semanticInvalid).toBe(false)
  })

  it('reads every bare item as plain JSON where the list takes no {x}', () => {
    const { result, onChange } = setup({ type: 'array', value: [], stringValuesOnly: true })
    act(() => result.current.bodyData.onCodeChange('["a", {{ y }}]'))
    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.visualLocked).toBe(true)
  })

  it('checks an {x} item of a typed list as text in Code, not as the type it had', () => {
    const { result } = setup({
      type: 'array',
      value: ['7', 'n + 1'],
      elementTypes: ['integer', 'integer'],
      listExprIndices: new Set([1]),
      view: 'code',
    })
    expect(result.current.stripMessage).toBeNull()
    expect(result.current.semanticInvalid).toBe(false)
  })

  it('stores text as the element type of an item switched into {x}, whatever type it had', () => {
    const { result } = setup({
      type: 'array',
      value: ['{"a": 1}', '"abc"', '7'],
      elementTypes: ['map', 'array', 'integer'],
      listExprIndices: new Set([0, 1]),
      view: 'visual',
    })
    expect(result.current.elementTypes).toEqual(['string', 'string', 'integer'])
  })
})

describe('useComplexValueEditor - a typed map {x} row in Code', () => {
  it('checks an {x} row as text in Code, not as the type it had', () => {
    const { result } = setup({
      type: 'map',
      value: { n: '7', app: 'n + 1' },
      elementTypes: { n: 'integer', app: 'integer' },
      mapEntry: { expressionEditor: () => null, expressionKeys: ['app'] },
      mapExprKeys: new Set(['app']),
      view: 'code',
    })
    expect(result.current.stripMessage).toBeNull()
    expect(result.current.semanticInvalid).toBe(false)
  })
})
