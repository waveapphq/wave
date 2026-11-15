/**
 * Operator lists of the check rows (REQ-3.1.3.25): every type offers "is null" and
 * "not null" last, a table offers its own four, and a row on an operator that takes no
 * compare-to value keeps none. One new-row seed and one drop rule for the compare value
 * (REQ-3.5.1.5).
 */

import { describe, expect, it } from 'vitest'

import {
  OPERATORS_BY_TYPE,
  UNARY_OPERATORS,
  getOperatorsForType,
  withOperator,
  withValueType,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'

type Operator = { value: string; label: string }

const IS_NULL: Operator = { value: 'is_null', label: 'is null' }
const IS_NOT_NULL: Operator = { value: 'is_not_null', label: 'not null' }

const NUMBER_OPERATORS: Operator[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'less_than', label: 'less than' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_or_equal', label: 'less or equal' },
  { value: 'greater_or_equal', label: 'greater or equal' },
  IS_NULL,
  IS_NOT_NULL,
]

const EXPECTED_BY_TYPE: Array<[string, Operator[]]> = [
  ['integer', NUMBER_OPERATORS],
  ['float', NUMBER_OPERATORS],
  [
    'string',
    [
      { value: 'equals', label: 'equals' },
      { value: 'not_equals', label: 'not equals' },
      { value: 'contains', label: 'contains' },
      { value: 'does_not_contain', label: 'does not contain' },
      { value: 'starts_with', label: 'starts with' },
      { value: 'ends_with', label: 'ends with' },
      { value: 'matches_regex', label: 'matches regex' },
      IS_NULL,
      IS_NOT_NULL,
    ],
  ],
  [
    'boolean',
    [
      { value: 'is_true', label: 'is true' },
      { value: 'is_false', label: 'is false' },
      IS_NULL,
      IS_NOT_NULL,
    ],
  ],
  [
    'array',
    [
      { value: 'contains', label: 'contains' },
      { value: 'does_not_contain', label: 'does not contain' },
      { value: 'is_empty', label: 'is empty' },
      { value: 'is_not_empty', label: 'is not empty' },
      { value: 'length_equals', label: 'length equals' },
      IS_NULL,
      IS_NOT_NULL,
    ],
  ],
  [
    'map',
    [
      { value: 'has_key', label: 'has key' },
      { value: 'does_not_have_key', label: 'does not have key' },
      { value: 'is_empty', label: 'is empty' },
      { value: 'is_not_empty', label: 'is not empty' },
      IS_NULL,
      IS_NOT_NULL,
    ],
  ],
]

const TABLE_OPERATORS: Operator[] = [
  IS_NULL,
  IS_NOT_NULL,
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

describe('OPERATORS_BY_TYPE - is null and not null on every type (REQ-3.1.3.25)', () => {
  it.each(EXPECTED_BY_TYPE)(
    'offers the %s operators in order, ending with is null and not null',
    (valueType, expected) => {
      expect(OPERATORS_BY_TYPE[valueType]).toEqual(expected)
    },
  )
})

describe('OPERATORS_BY_TYPE - the table type (REQ-3.1.3.25)', () => {
  it('offers a table exactly is null, not null, is empty, is not empty', () => {
    expect(OPERATORS_BY_TYPE.table).toEqual(TABLE_OPERATORS)
    expect(getOperatorsForType('table')).toEqual(TABLE_OPERATORS)
  })

  it('offers a table no equals and no not equals', () => {
    const values = getOperatorsForType('table').map((op) => op.value)
    expect(values).not.toContain('equals')
    expect(values).not.toContain('not_equals')
  })
})

describe('UNARY_OPERATORS - operators that take no compare-to value (REQ-3.1.3.25)', () => {
  it.each(['is_null', 'is_not_null'])('holds %s', (operator) => {
    expect(UNARY_OPERATORS.has(operator)).toBe(true)
  })

  it('holds exactly is true, is false, is empty, is not empty, is null and not null', () => {
    expect([...UNARY_OPERATORS].sort()).toEqual(
      ['is_empty', 'is_false', 'is_not_empty', 'is_not_null', 'is_null', 'is_true'],
    )
  })
})

describe('getOperatorsForType - unknown type fallback (REQ-3.1.3.25)', () => {
  it('offers equals, not equals, is null, not null for a type it does not know', () => {
    expect(getOperatorsForType('unknown_custom_type')).toEqual([
      { value: 'equals', label: 'equals' },
      { value: 'not_equals', label: 'not equals' },
      IS_NULL,
      IS_NOT_NULL,
    ])
  })
})

function literalRow(overrides: Partial<LiteralAssertion> = {}): LiteralAssertion {
  return {
    id: 'lit-1',
    type: 'literal',
    variable: 'x',
    value_type: 'string',
    operator: 'equals',
    reference_value: 'done',
    reference_is_expression: false,
    ...overrides,
  }
}

/** A row in the stored shape of an operator that takes no compare value: none of the three value keys. */
function bareRow(overrides: Partial<LiteralAssertion> = {}): LiteralAssertion {
  return { id: 'lit-1', type: 'literal', variable: 'x', value_type: 'string', operator: 'is_null', ...overrides }
}

const VALUE_KEYS = ['reference_value', 'reference_is_expression', 'reference_is_template'] as const

function expectNoCompareTo(row: LiteralAssertion): void {
  for (const key of VALUE_KEYS) expect(row).not.toHaveProperty(key)
}

interface RowRules {
  newLiteralRow: (valueType?: string) => LiteralAssertion
  dropUnusedCompareTo: (row: LiteralAssertion) => LiteralAssertion
}

/** The new-row seed and the drop rule, read inside each case so the other cases run without them. */
async function rowRules(): Promise<RowRules> {
  return (await import('@/features/workbench/common/config/assertion-builder/types')) as unknown as RowRules
}

describe('withOperator - a row given an operator (REQ-3.1.3.25)', () => {
  it.each([...UNARY_OPERATORS])('%s leaves the row no compare value and no flag', (operator) => {
    const next = withOperator(literalRow({ reference_is_template: false }), operator)
    expect(next).toEqual(bareRow({ operator }))
    expectNoCompareTo(next)
  })

  it('an operator that compares keeps the compare-to value', () => {
    expect(withOperator(literalRow(), 'contains')).toEqual(literalRow({ operator: 'contains' }))
  })

  it.each([...UNARY_OPERATORS])(
    'switching from %s back to an operator that compares leaves the compare value not set',
    (unary) => {
      const next = withOperator(bareRow({ operator: unary }), 'equals')
      expect(next).toEqual(bareRow({ operator: 'equals' }))
      expect(next).not.toHaveProperty('reference_value')
    },
  )
})

describe('withValueType - a row read as another value type (REQ-3.1.3.25)', () => {
  it('keeps an operator the new type offers, with its compare-to value', () => {
    expect(withValueType(literalRow(), 'integer')).toEqual(literalRow({ value_type: 'integer' }))
  })

  it("falls to the new type's first operator and keeps the compare-to value when that one compares", () => {
    expect(withValueType(literalRow({ operator: 'starts_with', reference_value: 'a' }), 'array')).toEqual(
      literalRow({ value_type: 'array', operator: 'contains', reference_value: 'a' }),
    )
  })

  it('a row leaving the boolean is_true for a string falls to equals with the compare value not set', () => {
    const next = withValueType(bareRow({ value_type: 'boolean', operator: 'is_true' }), 'string')
    expect(next).toEqual(bareRow({ operator: 'equals' }))
    expect(next).not.toHaveProperty('reference_value')
  })

  it.each([
    ['boolean', 'is_true'],
    ['table', 'is_null'],
  ])("falls to the %s type's first operator %s and leaves no compare value and no flag", (valueType, operator) => {
    const next = withValueType(literalRow({ reference_value: '' }), valueType)
    expect(next).toEqual(bareRow({ value_type: valueType, operator }))
    expectNoCompareTo(next)
  })
})

describe('newLiteralRow - the one new-row seed (REQ-3.5.1.5)', () => {
  it('starts a control row with no variable, on equals, with no compare value and no flag', async () => {
    const { newLiteralRow } = await rowRules()
    const row = newLiteralRow()
    expect(row).toEqual({ id: row.id, type: 'literal', variable: '', value_type: 'string', operator: 'equals' })
    expect(row.id).toMatch(/\S/)
    expectNoCompareTo(row)
  })

  it.each([
    ['string', 'equals'],
    ['integer', 'equals'],
    ['float', 'equals'],
    ['boolean', 'is_true'],
    ['array', 'contains'],
    ['map', 'has_key'],
    ['table', 'is_null'],
  ])("starts a row of type %s on the type's first operator %s with no compare value", async (valueType, operator) => {
    const { newLiteralRow } = await rowRules()
    const row = newLiteralRow(valueType)
    expect(row).toEqual({ id: row.id, type: 'literal', variable: '', value_type: valueType, operator })
    expectNoCompareTo(row)
  })

  it('gives every new row an id of its own', async () => {
    const { newLiteralRow } = await rowRules()
    expect(newLiteralRow().id).not.toBe(newLiteralRow().id)
  })
})

describe('dropUnusedCompareTo - the one drop rule for a compare value (REQ-3.5.1.5)', () => {
  it.each([...UNARY_OPERATORS])(
    'removes the compare value, the {x} flag and the Template flag under %s',
    async (operator) => {
      const { dropUnusedCompareTo } = await rowRules()
      const held = literalRow({ operator, reference_value: 'ready', reference_is_expression: true, reference_is_template: false })
      const next = dropUnusedCompareTo(held)
      expect(next).toEqual(bareRow({ operator }))
      expectNoCompareTo(next)
    },
  )

  it('removes a Template compare value under an operator that takes none', async () => {
    const { dropUnusedCompareTo } = await rowRules()
    const held = literalRow({ operator: 'is_not_null', reference_value: '{{ host }}', reference_is_template: true })
    const next = dropUnusedCompareTo(held)
    expect(next).toEqual(bareRow({ operator: 'is_not_null' }))
    expectNoCompareTo(next)
  })

  it.each(['equals', 'contains', 'length_equals', 'has_key', 'greater_than'])(
    'keeps the compare value and both flags under %s',
    async (operator) => {
      const { dropUnusedCompareTo } = await rowRules()
      const held = literalRow({ operator, reference_value: 'limit', reference_is_expression: true, reference_is_template: false })
      expect(dropUnusedCompareTo(held)).toEqual(held)
    },
  )

  it('keeps a row under an operator that takes none and holds nothing as it is', async () => {
    const { dropUnusedCompareTo } = await rowRules()
    expect(dropUnusedCompareTo(bareRow({ operator: 'is_empty' }))).toEqual(bareRow({ operator: 'is_empty' }))
  })
})
