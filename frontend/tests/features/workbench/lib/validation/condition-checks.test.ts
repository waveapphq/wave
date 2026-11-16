/**
 * The one condition row check shared by the control windows, the CSV / Excel filters and the canvas:
 * the compare type, the row problem, the value-loss fit, list completeness and the list enumeration.
 *
 * REQ-3.5.1.5, REQ-3.5.1.1, REQ-3.5.1.11, REQ-3.5.1.17, REQ-3.5.1.20, REQ-3.5.4.3, CSV-12
 */

import { describe, it, expect } from 'vitest'

import {
  compareToType,
  compareValueFits,
  conditionListComplete,
  conditionListsOf,
  conditionRowProblem,
} from '@/features/workbench/lib/validation/condition-checks'
import type { AssertionItem, LiteralAssertion } from '@/features/workbench/common/config/assertion-builder/types'

/** A literal row; a field left out is not stored (an unset compare value has no key). */
function literal(fields: Record<string, unknown> = {}): LiteralAssertion {
  return {
    id: 'row-1',
    type: 'literal',
    variable: 'status',
    value_type: 'string',
    operator: 'equals',
    ...fields,
  } as LiteralAssertion
}

function expression(text: string): AssertionItem {
  return { id: 'expr-1', type: 'expression', expression: text }
}

function group(items: AssertionItem[], id = 'group-1'): AssertionItem {
  return { id, type: 'group', items }
}

const AND: AssertionItem = { type: 'operator', value: 'and' }

const COMPLETE = literal({ reference_value: 'ready' })
const INCOMPLETE = literal({ variable: '' })

describe('compareToType - the type a compare value is held to', () => {
  it.each<[string, string, 'integer' | 'float' | 'string']>([
    ['integer', 'equals', 'integer'],
    ['integer', 'greater_than', 'integer'],
    ['float', 'less_than', 'float'],
    ['float', 'equals', 'float'],
    ['string', 'equals', 'string'],
    ['string', 'contains', 'string'],
    ['string', 'matches_regex', 'string'],
    ['array', 'length_equals', 'integer'],
    ['array', 'contains', 'string'],
    ['map', 'has_key', 'string'],
  ])('a %s value under %s compares as %s', (valueType, operator, expected) => {
    expect(compareToType(literal({ value_type: valueType, operator, reference_value: '1' }))).toBe(expected)
  })
})

describe('conditionRowProblem - one problem per row, variable first', () => {
  it('asks for a variable on a row that names none', () => {
    expect(conditionRowProblem(literal({ variable: '', reference_value: 'ready' }))).toEqual({
      field: 'variable',
      message: 'Choose a variable.',
    })
  })

  it('asks for a variable on a row whose variable is only spaces', () => {
    expect(conditionRowProblem(literal({ variable: '   ', reference_value: 'ready' }))).toEqual({
      field: 'variable',
      message: 'Choose a variable.',
    })
  })

  it('names only the variable on a fresh row that also holds no value', () => {
    expect(conditionRowProblem(literal({ variable: '' }))).toEqual({ field: 'variable', message: 'Choose a variable.' })
  })

  it('asks for a value under a binary operator when the value is not set', () => {
    expect(conditionRowProblem(literal())).toEqual({ field: 'value', message: 'Value is required' })
  })

  it('asks for a value when the compare value is null', () => {
    expect(conditionRowProblem(literal({ reference_value: null }))).toEqual({ field: 'value', message: 'Value is required' })
  })

  // Empty text typed on purpose is a value and compares with empty text (FIELD-4, FIELD-15).
  it.each(['', '   '])('takes text typed into a text compare as a value, empty text included (%j)', (text) => {
    expect(conditionRowProblem(literal({ reference_value: text }))).toBeNull()
  })

  it('asks for a value when a number compare holds empty text', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: '' })

    expect(conditionRowProblem(row)).toEqual({ field: 'value', message: 'Value is required' })
  })

  it.each(['', '   '])('asks for a value when the {x} compare value is blank (%j)', (text) => {
    expect(conditionRowProblem(literal({ reference_value: text, reference_is_expression: true }))).toEqual({
      field: 'value',
      message: 'Value is required',
    })
  })

  it.each(['', '   '])('asks for a value when the Template compare value is blank (%j)', (text) => {
    expect(conditionRowProblem(literal({ reference_value: text, reference_is_template: true }))).toEqual({
      field: 'value',
      message: 'Value is required',
    })
  })

  it('gives the number rule message for text an integer compare cannot read', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: 'abc' })

    expect(conditionRowProblem(row)).toEqual({ field: 'value', message: 'Enter a valid integer value' })
  })

  it('gives the number rule message for text a float compare cannot read', () => {
    const row = literal({ variable: 'ratio', value_type: 'float', reference_value: 'abc' })

    expect(conditionRowProblem(row)).toEqual({ field: 'value', message: 'Enter a valid float value' })
  })

  it('reads a list length compare as an integer', () => {
    const row = literal({ variable: 'items', value_type: 'array', operator: 'length_equals', reference_value: '1.5' })

    expect(conditionRowProblem(row)).toEqual({ field: 'value', message: 'Enter a valid integer value' })
  })

  it('gives the digit cap message for an integer compare value over 19 digits', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: '12345678901234567890' })

    expect(conditionRowProblem(row)).toEqual({ field: 'value', message: 'Maximum 19 digits' })
  })

  it.each<[string, unknown]>([
    ['integer', '500'],
    ['integer', 500],
    ['float', '2.5'],
  ])('finds nothing on a %s compare holding %j', (valueType, value) => {
    expect(conditionRowProblem(literal({ variable: 'n', value_type: valueType, reference_value: value }))).toBeNull()
  })

  it('never reads an {x} compare value with the number rule', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: 'limit + 1', reference_is_expression: true })

    expect(conditionRowProblem(row)).toBeNull()
  })

  it('finds nothing on a text compare held as Template', () => {
    expect(conditionRowProblem(literal({ reference_value: 'Hi {{ who }}', reference_is_template: true }))).toBeNull()
  })

  it('finds nothing on a complete text row', () => {
    expect(conditionRowProblem(COMPLETE)).toBeNull()
  })

  it.each<[string, string]>([
    ['is_true', 'boolean'],
    ['is_false', 'boolean'],
    ['is_empty', 'array'],
    ['is_not_empty', 'map'],
    ['is_null', 'integer'],
    ['is_not_null', 'string'],
  ])('asks for no value under %s on a %s variable', (operator, valueType) => {
    expect(conditionRowProblem(literal({ variable: 'subject', value_type: valueType, operator }))).toBeNull()
  })

  it.each(['', '   '])('asks for a condition on a blank expression row (%j)', (text) => {
    expect(conditionRowProblem(expression(text))).toEqual({ field: 'expression', message: 'Condition is required' })
  })

  it('finds nothing on an expression row that holds text', () => {
    expect(conditionRowProblem(expression('len(errors) == 0'))).toBeNull()
  })

  it('gives a group no row problem of its own, even an empty one', () => {
    expect(conditionRowProblem(group([]))).toBeNull()
    expect(conditionRowProblem(group([INCOMPLETE]))).toBeNull()
  })

  it('gives an AND / OR item no row problem', () => {
    expect(conditionRowProblem(AND)).toBeNull()
  })
})

describe('compareValueFits - does a variable pick or an as Type change keep the compare value', () => {
  it('keeps text on a text compare', () => {
    const row = literal({ variable: 'count', value_type: 'integer', reference_value: '5' })

    expect(compareValueFits(row, literal({ variable: 'name', value_type: 'string', reference_value: '5' }))).toBe(true)
  })

  it('keeps digit text on a number compare', () => {
    const row = literal({ reference_value: '42' })

    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer', reference_value: '42' }))).toBe(true)
  })

  it('refuses text an integer compare cannot read', () => {
    const row = literal({ reference_value: 'abc' })

    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer', reference_value: 'abc' }))).toBe(false)
  })

  it('refuses a decimal on an integer compare', () => {
    const row = literal({ variable: 'ratio', value_type: 'float', reference_value: '1.5' })

    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer', reference_value: '1.5' }))).toBe(false)
  })

  it('always keeps an {x} value under an operator that takes one', () => {
    const flags = { reference_value: 'limit + 1', reference_is_expression: true }
    const row = literal(flags)

    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer', ...flags }))).toBe(true)
  })

  it('keeps a Template only on a text compare', () => {
    const flags = { reference_value: 'Hi {{ who }}', reference_is_template: true }
    const row = literal(flags)

    expect(compareValueFits(row, literal({ variable: 'name', ...flags }))).toBe(true)
    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer', ...flags }))).toBe(false)
  })

  it('keeps nothing under an operator that takes no value', () => {
    const row = literal({ reference_value: 'ready' })
    const expr = literal({ reference_value: 'flag_var', reference_is_expression: true })

    expect(compareValueFits(row, literal({ variable: 'done', value_type: 'boolean', operator: 'is_true', reference_value: 'ready' }))).toBe(false)
    expect(
      compareValueFits(expr, literal({ variable: 'done', value_type: 'boolean', operator: 'is_true', reference_value: 'flag_var', reference_is_expression: true })),
    ).toBe(false)
  })

  it('always fits a row that holds no compare value', () => {
    const row = literal()

    expect(compareValueFits(row, literal({ variable: 'done', value_type: 'boolean', operator: 'is_true' }))).toBe(true)
    expect(compareValueFits(row, literal({ variable: 'count', value_type: 'integer' }))).toBe(true)
  })
})

describe('conditionListComplete - at least one row, no row problem at any depth, no empty group', () => {
  it('refuses an empty list', () => {
    expect(conditionListComplete([])).toBe(false)
  })

  it('takes a flat list of complete rows joined by AND / OR', () => {
    expect(conditionListComplete([COMPLETE, AND, expression('ok == True')])).toBe(true)
  })

  it('refuses a flat list holding one incomplete row', () => {
    expect(conditionListComplete([COMPLETE, AND, INCOMPLETE])).toBe(false)
  })

  it('takes a text compare holding empty text and refuses a blank {x} one', () => {
    expect(conditionListComplete([literal({ reference_value: '' })])).toBe(true)
    expect(conditionListComplete([literal({ reference_value: '', reference_is_expression: true })])).toBe(false)
  })

  it('takes complete rows three group levels deep', () => {
    const list = [COMPLETE, AND, group([COMPLETE, AND, group([group([COMPLETE], 'g3')], 'g2')], 'g1')]

    expect(conditionListComplete(list)).toBe(true)
  })

  it('refuses an incomplete row three group levels deep', () => {
    const list = [COMPLETE, AND, group([COMPLETE, AND, group([group([INCOMPLETE], 'g3')], 'g2')], 'g1')]

    expect(conditionListComplete(list)).toBe(false)
  })

  it('refuses an empty group at any depth', () => {
    expect(conditionListComplete([group([])])).toBe(false)
    expect(conditionListComplete([COMPLETE, AND, group([COMPLETE, AND, group([], 'g2')], 'g1')])).toBe(false)
  })
})

describe('conditionListsOf - the one enumeration of the condition lists a Block holds', () => {
  const rows = [COMPLETE]

  it('lists the Assert assertions', () => {
    expect(conditionListsOf('assert', { assertions: rows, mode: 'split' })).toEqual([
      { items: rows, place: 'assertions', inFilter: false },
    ])
  })

  it.each(['while', 'wait-until'])('lists the %s conditions', (elementType) => {
    expect(conditionListsOf(elementType, { conditions: rows })).toEqual([
      { items: rows, place: 'conditions', inFilter: false },
    ])
  })

  it('lists every If and Else If branch, never the Else', () => {
    const values = {
      branches: [
        { id: 'b0', type: 'if', label: '', conditions: rows },
        { id: 'b1', type: 'else_if', label: '', conditions: [] },
        { id: 'b2', type: 'else', label: '' },
      ],
    }

    expect(conditionListsOf('if-else', values)).toEqual([
      { items: rows, place: 'branches.0.conditions', inFilter: false },
      { items: [], place: 'branches.1.conditions', inFilter: false },
    ])
  })

  it('lists every Switch case, never the default', () => {
    const values = {
      branches: [
        { id: 'c0', type: 'case', label: '', conditions: rows, break: true },
        { id: 'c1', type: 'case', label: '', conditions: [], break: false },
        { id: 'd0', type: 'default', label: '' },
      ],
    }

    expect(conditionListsOf('switch-case', values)).toEqual([
      { items: rows, place: 'branches.0.conditions', inFilter: false },
      { items: [], place: 'branches.1.conditions', inFilter: false },
    ])
  })

  it.each(['csv-parser', 'excel-parser'])('lists every %s filter with its filter mark', (elementType) => {
    const cellRows = [literal({ variable: '_cell', value_type: 'integer', reference_value: '5' })]
    const values = {
      filters: [
        { id: 'f0', column: { mode: 'name', value: 'amount' }, asType: 'integer', conditions: cellRows },
        { id: 'f1', column: { mode: 'name', value: 'name' }, asType: 'string', conditions: [] },
      ],
    }

    expect(conditionListsOf(elementType, values)).toEqual([
      { items: cellRows, place: 'filters.0.conditions', inFilter: true },
      { items: [], place: 'filters.1.conditions', inFilter: true },
    ])
  })

  it.each<[string, Record<string, unknown>]>([
    ['for', { mode: 'count', count: 3 }],
    ['log', { message: 'hello' }],
  ])('lists nothing for a %s Block', (elementType, values) => {
    expect(conditionListsOf(elementType, values)).toEqual([])
  })

  // Stored data the window never writes: the enumeration reads what it can and skips the rest.
  it.each<[string, string, Record<string, unknown>]>([
    ['an Assert assertion list that is not a list', 'assert', { assertions: 'ready' }],
    ['If / Else branches that are not a list', 'if-else', { branches: { b0: { type: 'if', conditions: rows } } }],
    ['Switch branches that are not a list', 'switch-case', { branches: null }],
    ['CSV filters that are not a list', 'csv-parser', { filters: 'amount > 5' }],
  ])('lists nothing for %s', (_case, elementType, values) => {
    expect(conditionListsOf(elementType, values)).toEqual([])
  })

  it('skips a branch or a filter entry that is not an object, keeping the place of every other entry', () => {
    const branches = [null, 'if', ['else_if'], { id: 'b3', type: 'else_if', label: '', conditions: rows }]
    const filters = [42, { id: 'f1', column: { mode: 'name', value: 'amount' }, asType: 'integer', conditions: rows }]

    expect(conditionListsOf('if-else', { branches })).toEqual([
      { items: rows, place: 'branches.3.conditions', inFilter: false },
    ])
    expect(conditionListsOf('excel-parser', { filters })).toEqual([
      { items: rows, place: 'filters.1.conditions', inFilter: true },
    ])
  })

  it('reads a branch or a filter with no condition list as an empty list', () => {
    const branches = [
      { id: 'c0', type: 'case', label: '' },
      { id: 'c1', type: 'case', label: '', conditions: 'status == 200' },
      { id: 'd0', type: 'default', label: '' },
    ]
    const filters = [{ id: 'f0', column: { mode: 'name', value: 'amount' }, asType: 'integer' }]

    expect(conditionListsOf('switch-case', { branches })).toEqual([
      { items: [], place: 'branches.0.conditions', inFilter: false },
      { items: [], place: 'branches.1.conditions', inFilter: false },
    ])
    expect(conditionListsOf('csv-parser', { filters })).toEqual([
      { items: [], place: 'filters.0.conditions', inFilter: true },
    ])
  })
})
