/**
 * Tests for the complex-type formatting additions in lib/variable-format.
 *
 * Contract under test:
 *   - `formatComplexMetric`: footer metric for complex types, identical in
 *     both views - `N items` / `N keys` / `N rows x M cols` (U+00D7), zero
 *     counts for empty values, counts readable from summary envelopes
 *   - `inferRenderType`: per-cell render type of a value's OWN type
 *   - `getCellColorClass`: tint class per render type (string sky, integer
 *     violet, float pink, boolean orange, array amber, map emerald, null
 *     muted)
 *   - `isSummaryEnvelope`: predicate for the WS push summary shapes
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect } from 'vitest'

import {
  formatCompareMetric,
  formatComplexMetric,
  getCellColorClass,
  inferRenderType,
  isSummaryEnvelope,
  NULL_LOOK_CLASS,
} from '@/lib/variable-format'

// ===========================================================================
// formatComplexMetric
// ===========================================================================

describe('formatComplexMetric - arrays', () => {
  it('counts array items', () => {
    expect(formatComplexMetric(['a', 'b', 'c'], 'array')).toBe('3 items')
  })

  it('singularizes one item', () => {
    expect(formatComplexMetric(['a'], 'array')).toBe('1 item')
  })

  it('shows a zero count for an empty array', () => {
    expect(formatComplexMetric([], 'array')).toBe('0 items')
  })

  it('reads the count from an array summary envelope', () => {
    expect(formatComplexMetric({ count: 5, changed: true }, 'array')).toBe(
      '5 items',
    )
  })

  it('defends garbage values with a zero count', () => {
    expect(formatComplexMetric('garbage', 'array')).toBe('0 items')
  })
})

describe('formatComplexMetric - maps', () => {
  it('counts map keys', () => {
    expect(formatComplexMetric({ a: 1, b: 2 }, 'map')).toBe('2 keys')
  })

  it('singularizes one key', () => {
    expect(formatComplexMetric({ a: 1 }, 'map')).toBe('1 key')
  })

  it('shows a zero count for an empty map', () => {
    expect(formatComplexMetric({}, 'map')).toBe('0 keys')
  })

  it('reads the count from a map summary envelope', () => {
    expect(formatComplexMetric({ count: 4, changed: true }, 'map')).toBe(
      '4 keys',
    )
  })

  it.each([
    ['a string', 'garbage'],
    ['an array', [1, 2]],
  ])('defends %s with a zero count', (_label, value) => {
    expect(formatComplexMetric(value, 'map')).toBe('0 keys')
  })
})

describe('formatComplexMetric - tables', () => {
  it('formats rows x cols with the U+00D7 multiplication sign (dict shape)', () => {
    const value = {
      columns: [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'integer' },
        { name: 'c', type: 'integer' },
        { name: 'd', type: 'boolean' },
      ],
      rows: [['x', 1, 2, true], ['y', 3, 4, false], ['z', 5, 6, true]],
    }
    expect(formatComplexMetric(value, 'table')).toBe('3 rows × 4 cols')
  })

  it('counts rows and cols from an array-of-row-objects table', () => {
    const value = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]
    expect(formatComplexMetric(value, 'table')).toBe('2 rows × 2 cols')
  })

  it('keeps the column count of a zero-row table with schema', () => {
    const value = {
      columns: [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'integer' },
      ],
      rows: [],
    }
    expect(formatComplexMetric(value, 'table')).toBe('0 rows × 2 cols')
  })

  it('singularizes one row and one col', () => {
    const value = { columns: [{ name: 'only', type: 'string' }], rows: [['x']] }
    expect(formatComplexMetric(value, 'table')).toBe('1 row × 1 col')
  })

  it('reads counts from a table summary envelope', () => {
    expect(
      formatComplexMetric({ rows: 3, cols: 4, changed: true }, 'table'),
    ).toBe('3 rows × 4 cols')
  })

  it('defends garbage values with zero counts', () => {
    expect(formatComplexMetric('garbage', 'table')).toBe('0 rows × 0 cols')
  })
})

describe('formatComplexMetric - a null value (REQ-3.1.3.20)', () => {
  it.each(['array', 'map', 'table'] as const)('gives a null %s no count', (type) => {
    expect(formatComplexMetric(null, type)).toBeNull()
    expect(formatComplexMetric(undefined, type)).toBeNull()
  })
})

describe('formatComplexMetric - scalar types', () => {
  it.each(['string', 'integer', 'float', 'boolean'] as const)(
    'returns null for %s (scalar metrics stay with formatScalarMetric)',
    (type) => {
      expect(formatComplexMetric('anything', type)).toBeNull()
    },
  )
})

// ===========================================================================
// formatCompareMetric (inspect modal Compare-mode delta metric;
// REQ-3.1.3.11 Compare metric table)
//
// Signature: formatCompareMetric(initialValue, currentValue, type,
// showingSourceLeft). The unit is written once at the end; the arrow always
// renders (even when the two counts are equal); expression watchers label the
// initial side with the literal word "expression"; a mismatched current value
// collapses to the bare "type mismatch" with no arrow.
// ===========================================================================

describe('formatCompareMetric - literal scalars', () => {
  it('renders the string delta with the unit once at the end', () => {
    expect(formatCompareMetric('ab', 'abcd', 'string', false)).toBe('2 -> 4 chars')
  })

  it('always renders the arrow even when both sides are equal', () => {
    expect(formatCompareMetric('same', 'same', 'string', false)).toBe('4 -> 4 chars')
  })

  it('takes the singular unit from a one-character current value', () => {
    expect(formatCompareMetric('ab', 'a', 'string', false)).toBe('2 -> 1 char')
  })

  it('counts grown strings in full with no cap (42 -> 84 chars)', () => {
    expect(
      formatCompareMetric('x'.repeat(42), 'y'.repeat(84), 'string', false),
    ).toBe('42 -> 84 chars')
  })

  it.each(['integer', 'float', 'boolean'] as const)(
    'returns null for %s values (empty center zone)',
    (type) => {
      expect(formatCompareMetric(1, 2, type, false)).toBeNull()
    },
  )

  it('shows a null current string as null, never counting the letters of the word', () => {
    expect(formatCompareMetric('ab', null, 'string', false)).toBe('2 -> null')
  })
})

describe('formatCompareMetric - literal complex', () => {
  it('renders the array item delta', () => {
    expect(formatCompareMetric([1, 2, 3], [1, 2, 3, 4], 'array', false)).toBe(
      '3 -> 4 items',
    )
  })

  it('pluralizes the unit on the current count (3 -> 1 item)', () => {
    expect(formatCompareMetric([1, 2, 3], [1], 'array', false)).toBe('3 -> 1 item')
  })

  it('renders the map key delta', () => {
    expect(
      formatCompareMetric({ a: 1, b: 2 }, { a: 1, b: 2, c: 3 }, 'map', false),
    ).toBe('2 -> 3 keys')
  })

  it('renders the table row delta only (cols omitted from the metric)', () => {
    const initial = [{ id: 1 }]
    const current = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(formatCompareMetric(initial, current, 'table', false)).toBe(
      '1 -> 3 rows',
    )
  })

  it('reads the current array count from a live summary envelope', () => {
    expect(
      formatCompareMetric([1, 2, 3], { count: 2, changed: true }, 'array', false),
    ).toBe('3 -> 2 items')
  })

  it('reads the current rows from a table summary envelope (rows only)', () => {
    expect(
      formatCompareMetric([{ a: 1 }], { rows: 3, cols: 9, changed: true }, 'table', false),
    ).toBe('1 -> 3 rows')
  })

  it('shows a null current complex value as null, with no count and no mismatch', () => {
    expect(formatCompareMetric([1, 2], null, 'array', false)).toBe('2 -> null')
  })

  it('shows a null initial complex value as null, with no count', () => {
    expect(formatCompareMetric(null, [1, 2, 3], 'array', false)).toBe('null -> 3 items')
  })

  it('reads the current map keys from a live summary envelope', () => {
    expect(
      formatCompareMetric({ a: 1 }, { count: 3, changed: true }, 'map', false),
    ).toBe('1 -> 3 keys')
  })

  it('singularizes the map unit on a current count of one (2 -> 1 key)', () => {
    expect(formatCompareMetric({ a: 1, b: 2 }, { x: 1 }, 'map', false)).toBe(
      '2 -> 1 key',
    )
  })

  it('singularizes the table unit on a current count of one (2 -> 1 row)', () => {
    expect(
      formatCompareMetric([{ id: 1 }, { id: 2 }], [{ id: 1 }], 'table', false),
    ).toBe('2 -> 1 row')
  })
})

describe('formatCompareMetric - expression watchers', () => {
  it('labels the initial side "expression" and counts the evaluated string', () => {
    expect(formatCompareMetric('a + b', 'hello world', 'string', true)).toBe(
      'expression -> 11 chars',
    )
  })

  it('labels the initial side "expression" and counts the evaluated array', () => {
    expect(formatCompareMetric('a + b', [1, 2, 3, 4], 'array', true)).toBe(
      'expression -> 4 items',
    )
  })

  it.each(['string', 'array'] as const)(
    'shows "no value yet" while a %s expression is unevaluated (current undefined)',
    (type) => {
      expect(formatCompareMetric('a + b', undefined, type, true)).toBe(
        'expression -> no value yet',
      )
    },
  )

  it('returns null for an evaluated numeric expression (empty center zone)', () => {
    expect(formatCompareMetric('x + 1', 42, 'integer', true)).toBeNull()
  })

  it('shows an expression that evaluated to null as null, not as no value yet', () => {
    expect(formatCompareMetric('a + b', null, 'array', true)).toBe('expression -> null')
  })
})

describe('formatCompareMetric - type mismatch', () => {
  it('returns the bare "type mismatch" (no arrow) for a mismatched literal scalar', () => {
    expect(formatCompareMetric('bob', 42, 'string', false)).toBe('type mismatch')
  })

  it('flags a mismatched evaluated expression complex value', () => {
    expect(formatCompareMetric('x + 1', { oops: true }, 'array', true)).toBe(
      'type mismatch',
    )
  })

  it('flags a mismatched numeric scalar even though its normal metric is empty', () => {
    expect(formatCompareMetric(7, {}, 'integer', false)).toBe('type mismatch')
  })

  it('never treats a summary envelope as a mismatch', () => {
    expect(
      formatCompareMetric([1], { count: 2, changed: true }, 'array', false),
    ).toBe('1 -> 2 items')
  })
})

// ===========================================================================
// inferRenderType
// ===========================================================================

describe('inferRenderType', () => {
  it.each([
    ['abc', 'string'],
    [42, 'integer'],
    [4.2, 'float'],
    [true, 'boolean'],
    [false, 'boolean'],
    [null, 'null'],
    [undefined, 'null'],
    [[1, 2], 'array'],
    [{ a: 1 }, 'map'],
  ])('classifies %j as %s', (value, expected) => {
    expect(inferRenderType(value)).toBe(expected)
  })
})

// ===========================================================================
// getCellColorClass
// ===========================================================================

describe('getCellColorClass', () => {
  it('tints strings sky', () => {
    expect(getCellColorClass('string')).toMatch(/sky/)
  })

  it('tints integers violet', () => {
    expect(getCellColorClass('integer')).toMatch(/violet/)
  })

  it('tints floats pink', () => {
    expect(getCellColorClass('float')).toMatch(/pink/)
  })

  it('tints booleans orange', () => {
    expect(getCellColorClass('boolean')).toMatch(/orange/)
  })

  it('tints nested arrays amber', () => {
    expect(getCellColorClass('array')).toMatch(/amber/)
  })

  it('tints nested maps emerald', () => {
    expect(getCellColorClass('map')).toMatch(/emerald/)
  })

  it('mutes null', () => {
    expect(getCellColorClass('null')).toMatch(/muted/)
  })

  it('gives a null item, map value or cell the one null look (VMGR-93)', () => {
    expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
    expect(getCellColorClass('null')).toBe(NULL_LOOK_CLASS)
  })
})

// ===========================================================================
// isSummaryEnvelope
// ===========================================================================

describe('isSummaryEnvelope', () => {
  it('recognizes the array/map count envelope', () => {
    expect(isSummaryEnvelope({ count: 3, changed: true })).toBe(true)
  })

  it('recognizes the zero-count envelope', () => {
    expect(isSummaryEnvelope({ count: 0, changed: true })).toBe(true)
  })

  it('recognizes the table rows/cols envelope', () => {
    expect(isSummaryEnvelope({ rows: 2, cols: 5, changed: true })).toBe(true)
  })

  it('rejects a count object without changed: true', () => {
    expect(isSummaryEnvelope({ count: 3 })).toBe(false)
    expect(isSummaryEnvelope({ count: 3, changed: false })).toBe(false)
  })

  it('rejects a non-numeric count', () => {
    expect(isSummaryEnvelope({ count: 'x', changed: true })).toBe(false)
  })

  it('rejects the table render dict (rows is an array, not a number)', () => {
    expect(
      isSummaryEnvelope({ columns: [{ name: 'a' }], rows: [['x']] }),
    ).toBe(false)
  })

  it('rejects real arrays, maps, and scalars', () => {
    expect(isSummaryEnvelope([1, 2])).toBe(false)
    expect(isSummaryEnvelope({ a: 1 })).toBe(false)
    expect(isSummaryEnvelope('text')).toBe(false)
    expect(isSummaryEnvelope(42)).toBe(false)
    expect(isSummaryEnvelope(null)).toBe(false)
    expect(isSummaryEnvelope(undefined)).toBe(false)
  })
})

describe('formatComplexMetric - the live push envelope', () => {
  const envelope = { count: 4, rows: 4, cols: 9, changed: true }

  it('counts records for a variable declared array', () => {
    expect(formatComplexMetric(envelope, 'array')).toBe('4 items')
  })

  it('reads dimensions for a variable declared table', () => {
    expect(formatComplexMetric(envelope, 'table')).toBe('4 rows \u00D7 9 cols')
  })

  it('is still recognized as a summary that needs the full value fetched', () => {
    expect(isSummaryEnvelope(envelope)).toBe(true)
  })
})
