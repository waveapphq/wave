/**
 * The mode adapter of the one field: where a field's {x}, Template, entry {x} and element types live,
 * and the dotted-flag math every host shares (whole field `name`, entry `name.<key>`, ordered row
 * `<field>.<i>.<rowKey>`), with the text a blank {x} entry shows.
 *
 * REQ-3.1.1.5, REQ-3.1.3.19; FIELD-6, FIELD-13, SHRUN-4
 */

import { describe, it, expect, vi } from 'vitest'

import {
  blankEntryMessage,
  blockFieldModes,
  conditionValueModes,
  entryFlagsFor,
  expressionOnlyModes,
  indexedRowFlagsFor,
  indexedRowModes,
  rekeyIndexedFlags,
  setterRowModes,
  withEntryFlags,
  withIndexedRowFlags,
  type FieldModes,
} from '@/features/workbench/lib/node-parameters/field-modes'
import type { ElementTypes } from '@/lib/variable-validation'
import type { LiteralAssertion } from '@/features/workbench/common/config/assertion-builder/types'
import type { VariableRow } from '@/features/workbench/common/variables/variable-setter-editor/types'

// ---------------------------------------------------------------------------
// Hosts: the Block lists a window keeps, read back after each write as a re-render would.
// ---------------------------------------------------------------------------

interface BlockLists {
  expressionFields: string[]
  templateFields: string[]
  elementTypes: ElementTypes | undefined
}

/** The Block lists of a window and the field's modes built over them, as `ParameterRow` hands its props. */
function blockHost(name: string, initial: Partial<BlockLists> = {}) {
  const current: BlockLists = { expressionFields: [], templateFields: [], elementTypes: undefined, ...initial }
  const lists = () => ({
    expressionFields: current.expressionFields,
    onExpressionFieldsChange: (next: string[]) => {
      current.expressionFields = next
    },
    templateFields: current.templateFields,
    onTemplateFieldsChange: (next: string[]) => {
      current.templateFields = next
    },
    elementTypes: current.elementTypes,
    onElementTypesChange: (next: ElementTypes | undefined) => {
      current.elementTypes = next
    },
  })
  return {
    current,
    lists,
    modes: (): FieldModes => blockFieldModes(name, lists()),
  }
}

/** One ordered row's modes over the Block {x} list. */
function indexedHost(field: string, rowKey: string, initial: string[] = []) {
  const host = blockHost(field, { expressionFields: initial })
  return {
    current: host.current,
    modes: (index: number): FieldModes => indexedRowModes(field, rowKey, index, host.lists()),
    flagged: (index: number): boolean => indexedRowModes(field, rowKey, index, host.lists()).expression,
  }
}

const sorted = (flags: readonly string[]) => [...flags].sort((a, b) => a.localeCompare(b))

// A row change as the hosts make it: a move swaps two neighbors, an add appends, a delete takes one out.
const moved = (flags: string[], field: string, rowKey: string, from: number, to: number) =>
  rekeyIndexedFlags(flags, field, rowKey, { kind: 'move', from, to })
const added = (flags: string[], field: string, rowKey: string, at: number) =>
  rekeyIndexedFlags(flags, field, rowKey, { kind: 'add', at })
const deleted = (flags: string[], field: string, rowKey: string, at: number) =>
  rekeyIndexedFlags(flags, field, rowKey, { kind: 'delete', at })

/** A host's row callback gets the next row whole or the changed members: either way, the row it leads to. */
function nextCondition(row: LiteralAssertion, onRow: ReturnType<typeof vi.fn>): LiteralAssertion {
  expect(onRow).toHaveBeenCalled()
  const written = onRow.mock.lastCall?.[0] as Partial<LiteralAssertion>
  return 'id' in written ? (written as LiteralAssertion) : { ...row, ...written }
}

function nextSetterRow(row: VariableRow, onRow: ReturnType<typeof vi.fn>): VariableRow {
  expect(onRow).toHaveBeenCalled()
  const written = onRow.mock.lastCall?.[0] as Partial<VariableRow>
  return 'key' in written ? (written as VariableRow) : { ...row, ...written }
}

// ---------------------------------------------------------------------------
// Ordered rows: Parts (`value`) and Parallel lanes (`time_limit`)
// ---------------------------------------------------------------------------

const ROW_KINDS = [
  { rows: 'Parts rows', field: 'arguments', rowKey: 'value', otherKey: 'time_limit' },
  { rows: 'Parallel lanes', field: 'branches', rowKey: 'time_limit', otherKey: 'value' },
] as const

describe.each(ROW_KINDS)('indexedRowModes reads a row flag of $rows', ({ field, rowKey, otherKey }) => {
  const flag = (index: number | string) => `${field}.${index}.${rowKey}`

  it('reads no row as {x} when there are no expression fields', () => {
    const host = indexedHost(field, rowKey)
    expect([0, 1, 2].map(host.flagged)).toEqual([false, false, false])
  })

  it('reads every row index the field declares', () => {
    const host = indexedHost(field, rowKey, [flag(0), flag(2)])
    expect([0, 1, 2].map(host.flagged)).toEqual([true, false, true])
  })

  it('reads a multi-digit row index as a number', () => {
    const host = indexedHost(field, rowKey, [flag(10)])
    expect(host.flagged(10)).toBe(true)
    expect(host.flagged(1)).toBe(false)
    expect(host.flagged(0)).toBe(false)
  })

  it('reads a repeated entry as one flag, which one clear takes away', () => {
    const host = indexedHost(field, rowKey, [flag(1), flag(1)])
    expect(host.flagged(1)).toBe(true)
    host.modes(1).setExpression(false)
    expect(host.current.expressionFields).toEqual([])
    expect(host.flagged(1)).toBe(false)
  })

  it("ignores another field's row entries", () => {
    const host = indexedHost(field, rowKey, [`parts.0.${rowKey}`, flag(1)])
    expect(host.flagged(0)).toBe(false)
    expect(host.flagged(1)).toBe(true)
  })

  it('ignores a field whose name only starts with this one', () => {
    const host = indexedHost(field, rowKey, [`${field}Extra.0.${rowKey}`])
    expect(host.flagged(0)).toBe(false)
  })

  it('ignores an entry for the field that is not this row value', () => {
    const host = indexedHost(field, rowKey, [
      field,
      `${field}.0`,
      `${field}.0.name`,
      `${field}.x.${rowKey}`,
      `${field}.0.${otherKey}`,
    ])
    expect(host.flagged(0)).toBe(false)
  })

  it('reads no Template, entry {x} or element types for a row', () => {
    const modes = indexedHost(field, rowKey, [flag(0)]).modes(0)
    expect(modes.template).toBe(false)
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
  })
})

describe.each(ROW_KINDS)('indexedRowModes writes a row flag of $rows', ({ field, rowKey }) => {
  const flag = (index: number) => `${field}.${index}.${rowKey}`

  it('writes one entry per row set to {x}', () => {
    const host = indexedHost(field, rowKey)
    host.modes(0).setExpression(true)
    host.modes(2).setExpression(true)
    expect(host.current.expressionFields).toEqual([flag(0), flag(2)])
  })

  it('writes the entries in the order the rows are set', () => {
    const host = indexedHost(field, rowKey)
    host.modes(2).setExpression(true)
    host.modes(0).setExpression(true)
    expect(host.current.expressionFields).toEqual([flag(2), flag(0)])
  })

  it('clears the entry of the row taken out of {x}', () => {
    const host = indexedHost(field, rowKey, [flag(0), flag(1)])
    host.modes(0).setExpression(false)
    expect(host.current.expressionFields).toEqual([flag(1)])
  })

  it('removes every entry of the field when no row is an expression', () => {
    const host = indexedHost(field, rowKey, [flag(0)])
    host.modes(0).setExpression(false)
    expect(host.current.expressionFields).toEqual([])
  })

  it('writes a row already in {x} only once', () => {
    const host = indexedHost(field, rowKey, [flag(0)])
    host.modes(0).setExpression(true)
    expect(host.current.expressionFields).toEqual([flag(0)])
  })

  it("keeps other fields' entries in place", () => {
    const host = indexedHost(field, rowKey, ['input_vars.HOST', flag(0), 'parts.1.value'])
    host.modes(0).setExpression(false)
    host.modes(1).setExpression(true)
    expect(host.current.expressionFields).toEqual(['input_vars.HOST', 'parts.1.value', flag(1)])
  })

  it('keeps a field whose name only starts with this one', () => {
    const host = indexedHost(field, rowKey, [`${field}Extra.0.${rowKey}`])
    host.modes(0).setExpression(false)
    expect(host.current.expressionFields).toEqual([`${field}Extra.0.${rowKey}`])
    host.modes(0).setExpression(true)
    expect(host.current.expressionFields).toEqual([`${field}Extra.0.${rowKey}`, flag(0)])
  })

  it('keeps a whole-field entry that carries no row index', () => {
    const host = indexedHost(field, rowKey, [field])
    host.modes(0).setExpression(true)
    expect(host.current.expressionFields).toEqual([field, flag(0)])
  })

  it('leaves a dotted entry of the field that is not this row value in place', () => {
    const host = indexedHost(field, rowKey, [`${field}.0.name`])
    host.modes(0).setExpression(false)
    expect(host.current.expressionFields).toEqual([`${field}.0.name`])
  })

  it('round trips: a row set to {x} reads back as {x}', () => {
    const host = indexedHost(field, rowKey, ['input_vars.HOST'])
    host.modes(0).setExpression(true)
    host.modes(3).setExpression(true)
    expect([0, 1, 2, 3].map(host.flagged)).toEqual([true, false, false, true])
    expect(host.current.expressionFields).toContain('input_vars.HOST')
  })
})

describe.each(ROW_KINDS)('rekeyIndexedFlags moves the flags of $rows with their rows', ({ field, rowKey }) => {
  const flag = (index: number) => `${field}.${index}.${rowKey}`

  it('moves the flag down with its row', () => {
    expect(moved([flag(0)], field, rowKey, 0, 1)).toEqual([flag(1)])
  })

  it('moves the flag up with its row', () => {
    expect(moved([flag(1)], field, rowKey, 1, 0)).toEqual([flag(0)])
  })

  it('moves the flag of the row a move swaps with the other way', () => {
    expect(moved([flag(1)], field, rowKey, 0, 1)).toEqual([flag(0)])
  })

  it('keeps both flags when two {x} rows swap', () => {
    expect(sorted(moved([flag(0), flag(1)], field, rowKey, 0, 1))).toEqual(sorted([flag(0), flag(1)]))
  })

  it('leaves the rows a move does not touch as they are', () => {
    expect(sorted(moved([flag(0), flag(3)], field, rowKey, 1, 2))).toEqual(sorted([flag(0), flag(3)]))
  })

  it('leaves the flags as they are when a row is added at the end', () => {
    expect(sorted(added([flag(0), flag(1)], field, rowKey, 2))).toEqual(sorted([flag(0), flag(1)]))
  })

  it('shifts the flags below a deleted row up by one', () => {
    expect(sorted(deleted([flag(1), flag(2)], field, rowKey, 0))).toEqual(sorted([flag(0), flag(1)]))
  })

  it("drops the deleted row's own flag", () => {
    expect(deleted([flag(0), flag(2)], field, rowKey, 0)).toEqual([flag(1)])
  })

  it('leaves the flags above a deleted row alone', () => {
    expect(deleted([flag(0)], field, rowKey, 1)).toEqual([flag(0)])
  })

  it('reads a multi-digit row index as a number', () => {
    expect(deleted([flag(10)], field, rowKey, 0)).toEqual([flag(9)])
  })

  it("keeps other fields' flags, the whole-field entry and a field whose name only starts with this one", () => {
    const others = ['url', field, `${field}Extra.1.${rowKey}`, 'parts.1.value']
    expect(sorted(deleted([...others, flag(1)], field, rowKey, 0))).toEqual(sorted([...others, flag(0)]))
  })

  it('leaves the list it was given unchanged', () => {
    const flags = Object.freeze([flag(1), flag(2)]) as unknown as string[]
    expect(sorted(deleted(flags, field, rowKey, 0))).toEqual(sorted([flag(0), flag(1)]))
    expect(flags).toEqual([flag(1), flag(2)])
  })
})

// A Parts or ordered list sheet saves the whole set of its {x} rows at once.
describe('indexedRowFlagsFor and withIndexedRowFlags: a sheet save of Parts rows', () => {
  const field = 'arguments'
  const rowKey = 'value'
  const flag = (index: number) => `${field}.${index}.${rowKey}`

  it('reads no row when there are no expression fields', () => {
    expect(indexedRowFlagsFor(field, rowKey, [])).toEqual(new Set())
  })

  it('reads every row index the field declares, a repeated one once, a multi-digit one as a number', () => {
    expect(indexedRowFlagsFor(field, rowKey, [flag(0), flag(2), flag(2), flag(10)])).toEqual(new Set([0, 2, 10]))
  })

  it("ignores another field's rows, a field whose name only starts with this one and an entry that is not a row value", () => {
    const others = ['parts.0.value', `${field}Extra.0.value`, field, `${field}.0`, `${field}.0.name`, `${field}.x.value`]
    expect(indexedRowFlagsFor(field, rowKey, others)).toEqual(new Set())
  })

  it('writes one entry per given row, in the given order', () => {
    expect(withIndexedRowFlags(field, rowKey, [], [2, 0])).toEqual([flag(2), flag(0)])
  })

  it('takes the set a sheet hands back', () => {
    expect(withIndexedRowFlags(field, rowKey, [], new Set([3, 1]))).toEqual([flag(3), flag(1)])
  })

  it('replaces the rows the field had, and removes them all for an empty set', () => {
    expect(withIndexedRowFlags(field, rowKey, [flag(0), flag(1)], [1])).toEqual([flag(1)])
    expect(withIndexedRowFlags(field, rowKey, [flag(0)], [])).toEqual([])
  })

  it("keeps other fields' entries, a field whose name only starts with this one and the whole-field entry", () => {
    const kept = ['input_vars.HOST', 'parts.1.value', `${field}Extra.0.value`, field]
    expect(withIndexedRowFlags(field, rowKey, ['input_vars.HOST', flag(0), 'parts.1.value', `${field}Extra.0.value`, field], [1])).toEqual([
      ...kept,
      flag(1),
    ])
  })

  it('drops a dotted entry of the field that is not a row value', () => {
    expect(withIndexedRowFlags(field, rowKey, [`${field}.0.name`], [])).toEqual([])
  })

  it('round trips through indexedRowFlagsFor', () => {
    const flags = withIndexedRowFlags(field, rowKey, ['input_vars.HOST'], [0, 3])
    expect(indexedRowFlagsFor(field, rowKey, flags)).toEqual(new Set([0, 3]))
    expect(flags).toContain('input_vars.HOST')
  })

  it('leaves the list it was given unchanged', () => {
    const flags = Object.freeze([flag(1)]) as unknown as string[]
    expect(withIndexedRowFlags(field, rowKey, flags, [0])).toEqual([flag(0)])
    expect(flags).toEqual([flag(1)])
  })
})

// ---------------------------------------------------------------------------
// Entry flags: a list item's index or a map key under the field
// ---------------------------------------------------------------------------

describe('entryFlagsFor', () => {
  it('reads no entry when there are no expression fields', () => {
    expect(entryFlagsFor('headers', [])).toEqual([])
  })

  it('reads the map keys held as {x}', () => {
    expect(entryFlagsFor('headers', ['headers.Authorization', 'url', 'headers.X-Trace'])).toEqual([
      'Authorization',
      'X-Trace',
    ])
  })

  it('reads list indices as text', () => {
    expect(entryFlagsFor('targets', ['targets.0', 'targets.2'])).toEqual(['0', '2'])
  })

  it('keeps a map key that holds dots whole', () => {
    expect(entryFlagsFor('labels', ['labels.app.kubernetes.io/name'])).toEqual(['app.kubernetes.io/name'])
  })

  it('ignores the whole-field entry and a field whose name only starts with this one', () => {
    expect(entryFlagsFor('headers', ['headers', 'headersExtra.a', 'body.headers'])).toEqual([])
  })

  it("reads a Setter row's entries under its two-level place", () => {
    expect(
      entryFlagsFor('variables.hosts', [
        'variables.hosts',
        'variables.hosts.1',
        'variables.hostsExtra.0',
        'variables.ports.0',
      ]),
    ).toEqual(['1'])
  })
})

describe('withEntryFlags', () => {
  it('writes one entry per given key', () => {
    expect(withEntryFlags('headers', [], ['A', 'B'])).toEqual(['headers.A', 'headers.B'])
  })

  it('replaces the entries the field had', () => {
    expect(withEntryFlags('headers', ['headers.A', 'headers.B'], ['B'])).toEqual(['headers.B'])
  })

  it('removes every entry of the field when no key is given', () => {
    expect(withEntryFlags('targets', ['targets.0', 'targets.1'], [])).toEqual([])
  })

  it("keeps other fields' entries and the field's whole entry", () => {
    expect(withEntryFlags('headers', ['url', 'headers', 'headers.A', 'body.x'], ['B'])).toEqual([
      'url',
      'headers',
      'body.x',
      'headers.B',
    ])
  })

  it('keeps a field whose name only starts with this one', () => {
    expect(withEntryFlags('headers', ['headersExtra.a'], [])).toEqual(['headersExtra.a'])
  })

  it("writes a Setter row's entries under its two-level place and keeps the other rows", () => {
    expect(
      withEntryFlags('variables.hosts', ['variables.ports.0', 'variables.hosts', 'variables.hosts.0'], ['2']),
    ).toEqual(['variables.ports.0', 'variables.hosts', 'variables.hosts.2'])
  })

  it('round trips through entryFlagsFor', () => {
    const flags = withEntryFlags('labels', ['url'], ['app', 'tier'])
    expect(entryFlagsFor('labels', flags)).toEqual(['app', 'tier'])
  })
})

// ---------------------------------------------------------------------------
// The text a blank {x} entry shows (FIELD-13)
// ---------------------------------------------------------------------------

describe('blankEntryMessage', () => {
  it('counts a list row from 1', () => {
    expect(blankEntryMessage('hosts', ['web-1', ''], '1')).toBe("Row 2 in 'hosts' is required")
  })

  it('names the first list row Row 1', () => {
    expect(blankEntryMessage('targets', [''], '0')).toBe("Row 1 in 'targets' is required")
  })

  it('counts a multi-digit row as a number', () => {
    expect(blankEntryMessage('targets', Array.from({ length: 10 }, () => ''), '9')).toBe(
      "Row 10 in 'targets' is required",
    )
  })

  it('names a map key by name', () => {
    expect(blankEntryMessage('labels', { app: '' }, 'app')).toBe("'app' in 'labels' is required")
  })

  it('names a map key that holds dots whole', () => {
    expect(blankEntryMessage('labels', { 'app.kubernetes.io/name': '' }, 'app.kubernetes.io/name')).toBe(
      "'app.kubernetes.io/name' in 'labels' is required",
    )
  })
})

// ---------------------------------------------------------------------------
// blockFieldModes: a Block field's flags in the Block lists (every plugin, Function Block and plain control row)
// ---------------------------------------------------------------------------

describe('blockFieldModes reads the Block lists', () => {
  it('reads a field in expressionFields as {x}', () => {
    expect(blockHost('url', { expressionFields: ['url'] }).modes().expression).toBe(true)
  })

  it('reads a field with only entry flags as not {x}', () => {
    const modes = blockHost('headers', { expressionFields: ['headers.A'] }).modes()
    expect(modes.expression).toBe(false)
    expect(modes.entryExpressions).toEqual(['A'])
  })

  it('reads a field in templateFields as a Template', () => {
    const modes = blockHost('url', { templateFields: ['url'] }).modes()
    expect(modes.template).toBe(true)
    expect(modes.expression).toBe(false)
  })

  it("reads another field's flags as none of this field's", () => {
    const modes = blockHost('url', { expressionFields: ['urlExtra', 'body.url'], templateFields: ['body'] }).modes()
    expect(modes.expression).toBe(false)
    expect(modes.template).toBe(false)
    expect(modes.entryExpressions).toEqual([])
  })

  it('reads the entries held as {x} under the field', () => {
    const modes = blockHost('targets', { expressionFields: ['url', 'targets.0', 'targets.2', 'targetsExtra.1'] }).modes()
    expect(modes.entryExpressions).toEqual(['0', '2'])
  })

  it("reads the field's element types", () => {
    const types: ElementTypes = { cpu: 'integer', mem: 'string' }
    expect(blockHost('limits', { elementTypes: types }).modes().elementTypes).toEqual(types)
  })
})

describe('blockFieldModes writes the Block lists', () => {
  it('switches the field into {x} and drops its entry flags, Template mark and element types', () => {
    const host = blockHost('labels', {
      expressionFields: ['url', 'labels.app', 'labelsExtra.a'],
      templateFields: ['labels', 'body'],
      elementTypes: { app: 'string' },
    })
    host.modes().setExpression(true)
    expect(sorted(host.current.expressionFields)).toEqual(sorted(['url', 'labelsExtra.a', 'labels']))
    expect(host.current.templateFields).toEqual(['body'])
    expect(host.current.elementTypes).toBeUndefined()
  })

  it("switches the field out of {x} and keeps every other field's flags", () => {
    const host = blockHost('url', { expressionFields: ['headers.A', 'url', 'body'] })
    host.modes().setExpression(false)
    expect(host.current.expressionFields).toEqual(['headers.A', 'body'])
    expect(host.modes().expression).toBe(false)
  })

  it('writes the field into {x} only once', () => {
    const host = blockHost('url', { expressionFields: ['url'] })
    host.modes().setExpression(true)
    expect(host.current.expressionFields).toEqual(['url'])
  })

  it('marks the field as a Template and takes the mark away again', () => {
    const host = blockHost('url', { templateFields: ['body'] })
    host.modes().setTemplate(true)
    expect(sorted(host.current.templateFields)).toEqual(['body', 'url'])
    expect(host.modes().template).toBe(true)
    host.modes().setTemplate(false)
    expect(host.current.templateFields).toEqual(['body'])
  })

  it("writes the entry flags under the field and keeps its whole entry and other fields' flags", () => {
    const host = blockHost('targets', { expressionFields: ['url', 'targets.0'] })
    host.modes().setEntryExpressions(['1', '3'])
    expect(host.current.expressionFields).toEqual(['url', 'targets.1', 'targets.3'])
    expect(host.modes().entryExpressions).toEqual(['1', '3'])
    host.modes().setEntryExpressions([])
    expect(host.current.expressionFields).toEqual(['url'])
  })

  it('writes the element types through the field sink', () => {
    const host = blockHost('limits')
    host.modes().setElementTypes({ cpu: 'integer' })
    expect(host.current.elementTypes).toEqual({ cpu: 'integer' })
    host.modes().setElementTypes(undefined)
    expect(host.current.elementTypes).toBeUndefined()
  })

  it('switches into {x} when the host keeps no element types sink', () => {
    const lists = {
      expressionFields: [] as string[],
      onExpressionFieldsChange: vi.fn(),
      templateFields: [] as string[],
      onTemplateFieldsChange: vi.fn(),
    }
    expect(() => blockFieldModes('url', lists).setExpression(true)).not.toThrow()
    expect(lists.onExpressionFieldsChange).toHaveBeenLastCalledWith(['url'])
  })
})

// ---------------------------------------------------------------------------
// conditionValueModes: a compare value's flags inside its condition item
// ---------------------------------------------------------------------------

const COMPARE_ROW = {
  id: 'cond_1',
  type: 'literal',
  variable: 'status',
  value_type: 'string',
  operator: 'equals',
  reference_value: 'ready',
} as LiteralAssertion

describe('conditionValueModes', () => {
  it('reads a row with no flag as a literal value', () => {
    const modes = conditionValueModes(COMPARE_ROW, vi.fn())
    expect(modes.expression).toBe(false)
    expect(modes.template).toBe(false)
  })

  it('reads reference_is_expression as {x} and reference_is_template as a Template', () => {
    expect(conditionValueModes({ ...COMPARE_ROW, reference_is_expression: true }, vi.fn()).expression).toBe(true)
    const template = conditionValueModes({ ...COMPARE_ROW, reference_is_template: true } as LiteralAssertion, vi.fn())
    expect(template.template).toBe(true)
    expect(template.expression).toBe(false)
  })

  it('holds no entry {x} and no element types', () => {
    const modes = conditionValueModes({ ...COMPARE_ROW, reference_is_expression: true }, vi.fn())
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
  })

  it('sets reference_is_expression and clears the Template flag, keeping the rest of the row', () => {
    const row = { ...COMPARE_ROW, reference_is_template: true } as LiteralAssertion
    const onRow = vi.fn()
    conditionValueModes(row, onRow).setExpression(true)
    const next = nextCondition(row, onRow)
    expect(next.reference_is_expression).toBe(true)
    expect((next as { reference_is_template?: boolean }).reference_is_template).toBeFalsy()
    expect(next).toMatchObject({ id: 'cond_1', variable: 'status', value_type: 'string', operator: 'equals' })
    expect(next.reference_value).toBe('ready')
  })

  it('clears reference_is_expression when the value leaves {x}', () => {
    const row = { ...COMPARE_ROW, reference_is_expression: true }
    const onRow = vi.fn()
    conditionValueModes(row, onRow).setExpression(false)
    expect(nextCondition(row, onRow).reference_is_expression).toBeFalsy()
  })

  it('sets reference_is_template and clears the {x} flag', () => {
    const row = { ...COMPARE_ROW, reference_is_expression: true }
    const onRow = vi.fn()
    conditionValueModes(row, onRow).setTemplate(true)
    const next = nextCondition(row, onRow) as LiteralAssertion & { reference_is_template?: boolean }
    expect(next.reference_is_template).toBe(true)
    expect(next.reference_is_expression).toBeFalsy()
  })

  it('clears reference_is_template when the value goes back to Literal', () => {
    const row = { ...COMPARE_ROW, reference_is_template: true } as LiteralAssertion
    const onRow = vi.fn()
    conditionValueModes(row, onRow).setTemplate(false)
    const next = nextCondition(row, onRow) as LiteralAssertion & { reference_is_template?: boolean }
    expect(next.reference_is_template).toBeFalsy()
  })

  it('changes no flag on an entry {x} or element type write', () => {
    const row = { ...COMPARE_ROW, reference_is_expression: true }
    const onRow = vi.fn()
    const modes = conditionValueModes(row, onRow)
    modes.setEntryExpressions(['0'])
    modes.setElementTypes(['string'])
    for (const [written] of onRow.mock.calls as Array<[Partial<LiteralAssertion>]>) {
      const next = 'id' in written ? written : { ...row, ...written }
      expect(next).toEqual(row)
    }
  })
})

// ---------------------------------------------------------------------------
// expressionOnlyModes: the expression condition row
// ---------------------------------------------------------------------------

describe('expressionOnlyModes', () => {
  it('is always {x}, with no Template, no entry {x} and no element types', () => {
    const modes = expressionOnlyModes()
    expect(modes.expression).toBe(true)
    expect(modes.template).toBe(false)
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
  })

  it('does nothing on a write and stays {x}', () => {
    const modes = expressionOnlyModes()
    expect(() => {
      modes.setExpression(false)
      modes.setTemplate(true)
      modes.setEntryExpressions(['0'])
      modes.setElementTypes(['string'])
    }).not.toThrow()
    expect(modes.expression).toBe(true)
    expect(modes.template).toBe(false)
    expect(expressionOnlyModes()).toMatchObject({ expression: true, template: false, entryExpressions: [] })
  })
})

// ---------------------------------------------------------------------------
// setterRowModes: a Setter row's local flags (the editor writes them to the `variables.<row>` slots)
// ---------------------------------------------------------------------------

const SETTER_ROW = {
  key: 'row-1',
  name: 'hosts',
  value: ['web-1', ''],
  type: 'array',
  isExpression: false,
  isTemplate: false,
  isSecret: false,
  entryExpressions: ['1'],
  elementTypes: ['string', 'string'],
} as VariableRow

describe('setterRowModes', () => {
  it("reads the row's {x}, Template, entry {x} and element types", () => {
    const modes = setterRowModes(SETTER_ROW, vi.fn())
    expect(modes.expression).toBe(false)
    expect(modes.template).toBe(false)
    expect(modes.entryExpressions).toEqual(['1'])
    expect(modes.elementTypes).toEqual(['string', 'string'])
    expect(setterRowModes({ ...SETTER_ROW, isExpression: true }, vi.fn()).expression).toBe(true)
    expect(setterRowModes({ ...SETTER_ROW, type: 'string', isTemplate: true }, vi.fn()).template).toBe(true)
  })

  it('reads a row that carries no Template mark or entry flags as having none', () => {
    const bare = { key: 'row-2', name: 'greeting', value: 'hello', type: 'string', isExpression: false } as VariableRow
    const modes = setterRowModes(bare, vi.fn())
    expect(modes.template).toBe(false)
    expect(modes.entryExpressions).toEqual([])
    expect(modes.elementTypes).toBeUndefined()
  })

  it('switches the row into {x} and drops its Template mark, entry flags and element types', () => {
    const onRow = vi.fn()
    setterRowModes(SETTER_ROW, onRow).setExpression(true)
    const next = nextSetterRow(SETTER_ROW, onRow)
    expect(next.isExpression).toBe(true)
    expect(next.isTemplate ?? false).toBe(false)
    expect((next as { entryExpressions?: string[] }).entryExpressions ?? []).toEqual([])
    expect(next.elementTypes).toBeUndefined()
    expect(next).toMatchObject({ key: 'row-1', name: 'hosts', type: 'array', isSecret: false })
  })

  it('switches the row out of {x}', () => {
    const row = { ...SETTER_ROW, isExpression: true, entryExpressions: [], elementTypes: undefined } as VariableRow
    const onRow = vi.fn()
    setterRowModes(row, onRow).setExpression(false)
    expect(nextSetterRow(row, onRow).isExpression).toBe(false)
  })

  it('marks a text row as a Template and takes the mark away again', () => {
    const row = { ...SETTER_ROW, type: 'string', value: 'Run {{ run_id }}', entryExpressions: [], elementTypes: undefined } as VariableRow
    const on = vi.fn()
    setterRowModes(row, on).setTemplate(true)
    expect(nextSetterRow(row, on).isTemplate).toBe(true)
    const off = vi.fn()
    setterRowModes({ ...row, isTemplate: true }, off).setTemplate(false)
    expect(nextSetterRow({ ...row, isTemplate: true }, off).isTemplate ?? false).toBe(false)
  })

  it("writes the row's entry flags", () => {
    const onRow = vi.fn()
    setterRowModes(SETTER_ROW, onRow).setEntryExpressions(['0', '1'])
    expect((nextSetterRow(SETTER_ROW, onRow) as { entryExpressions?: string[] }).entryExpressions).toEqual(['0', '1'])
  })

  it("writes the row's element types", () => {
    const onRow = vi.fn()
    setterRowModes(SETTER_ROW, onRow).setElementTypes(['integer', 'string'])
    expect(nextSetterRow(SETTER_ROW, onRow).elementTypes).toEqual(['integer', 'string'])
  })
})
