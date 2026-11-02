/**
 * Declared numeric bounds, shared by the block's issue badge and the config
 * form's own field check (PING-17, PING-18). The message names the row by its
 * label, or by its name when it has none (FIELDERR-1).
 *
 * REQ-3.4.2.2
 */

import { describe, it, expect } from 'vitest'
import {
  literalNumber,
  literalNumberProblem,
  numberBoundError,
  type BoundedParam,
} from '@/features/workbench/lib/validation/number-bounds'
import { MASK_PLACEHOLDER, SECRET_ENVELOPE_PREFIX } from '@/lib/secret-envelope'

const count: BoundedParam = { name: 'count', label: 'Count', minimum: 1, maximum: 1000, defaultValue: 4 }
const interval: BoundedParam = {
  name: 'interval',
  label: 'Interval (seconds)',
  minimum: 0.2,
  defaultValue: 1,
}
const rate: BoundedParam = { name: 'rate', label: 'Rate (%)', maximum: 100 }
const plain: BoundedParam = { name: 'host' }
const minReplies: BoundedParam = {
  name: 'min_replies',
  label: 'Minimum replies',
  minimum: 1,
  maximumField: { field: 'count', message: 'Minimum replies cannot exceed Count' },
}

const NO_EXPRESSIONS: ReadonlySet<string> = new Set()
const schema = [count, interval, rate, plain, minReplies]

function errorFor(
  param: BoundedParam,
  values: Record<string, unknown>,
  expressions: ReadonlySet<string> = NO_EXPRESSIONS,
): string | null {
  return numberBoundError(param, values, schema, expressions)
}

describe('literalNumber', () => {
  it('reads a number as its exact decimal text', () => {
    expect(literalNumber(42, false)).toBe('42')
    expect(literalNumber(1e21, false)).toBe('1000000000000000000000')
  })

  it('reads plain decimal text as it is', () => {
    expect(literalNumber('42', false)).toBe('42')
    expect(literalNumber('0.19999999999999999999', false)).toBe('0.19999999999999999999')
  })

  it.each(['1e3', '0x10', '12.', ' 5'])('ignores %j, which the number rule refuses', (text) => {
    expect(literalNumber(text, false)).toBeUndefined()
  })

  it('ignores a value in expression mode', () => {
    expect(literalNumber(42, true)).toBeUndefined()
  })

  it('ignores a blank string', () => {
    expect(literalNumber('   ', false)).toBeUndefined()
  })

  it('ignores a string that spells no number', () => {
    expect(literalNumber('four', false)).toBeUndefined()
  })

  it('ignores a non-finite number', () => {
    expect(literalNumber(Number.NaN, false)).toBeUndefined()
    expect(literalNumber(Number.POSITIVE_INFINITY, false)).toBeUndefined()
  })

  it('ignores a value that is neither number nor string', () => {
    expect(literalNumber({ nested: 1 }, false)).toBeUndefined()
  })
})

describe('numberBoundError - a row with its own bounds', () => {
  it('passes a literal inside the range', () => {
    expect(errorFor(count, { count: 4 })).toBeNull()
  })

  it('passes a literal on each edge of the range', () => {
    expect(errorFor(count, { count: 1 })).toBeNull()
    expect(errorFor(count, { count: 1000 })).toBeNull()
  })

  it('names both bounds when a literal falls below the lowest', () => {
    expect(errorFor(count, { count: 0 })).toBe('Count must be between 1 and 1000')
  })

  it('names both bounds when a literal rises above the highest', () => {
    expect(errorFor(count, { count: 50000 })).toBe('Count must be between 1 and 1000')
  })

  it('names only the lowest when the row declares no highest', () => {
    expect(errorFor(interval, { interval: 0.1 })).toBe('Interval (seconds) must be at least 0.2')
  })

  it('names only the highest when the row declares no lowest', () => {
    expect(errorFor(rate, { rate: 250 })).toBe('Rate (%) must be at most 100')
  })

  it('reads a value the form holds as a string', () => {
    expect(errorFor(count, { count: '50000' })).toBe('Count must be between 1 and 1000')
  })

  it('names the row by its wire name when it carries no label', () => {
    const port: BoundedParam = { name: 'port', minimum: 1, maximum: 65535 }
    expect(numberBoundError(port, { port: 70000 }, [port], NO_EXPRESSIONS)).toBe(
      'port must be between 1 and 65535',
    )
  })

  it('names an unlabeled row with only a lowest bound by its wire name', () => {
    const timeout: BoundedParam = { name: 'timeout', minimum: 1 }
    expect(numberBoundError(timeout, { timeout: 0 }, [timeout], NO_EXPRESSIONS)).toBe(
      'timeout must be at least 1',
    )
  })

  it('names an unlabeled row with only a highest bound by its wire name', () => {
    const ceiling: BoundedParam = { name: 'ceiling', maximum: 5 }
    expect(numberBoundError(ceiling, { ceiling: 9 }, [ceiling], NO_EXPRESSIONS)).toBe(
      'ceiling must be at most 5',
    )
  })

  it('checks nothing on a row that declares no bound', () => {
    expect(errorFor(plain, { host: 'example.com' })).toBeNull()
  })

  it('checks nothing while the value is an expression', () => {
    expect(errorFor(count, { count: '{{ vars.count }}' }, new Set(['count']))).toBeNull()
  })

  it('checks nothing while the row is blank', () => {
    expect(errorFor(count, { count: '' })).toBeNull()
    expect(errorFor(count, {})).toBeNull()
  })
})

describe('numberBoundError - exact compare', () => {
  it.each([
    [interval, { interval: '0.19999999999999999999' }, 'Interval (seconds) must be at least 0.2'],
    [rate, { rate: '100.0000000000000001' }, 'Rate (%) must be at most 100'],
    [count, { count: '1000.00000000000000001' }, 'Count must be between 1 and 1000'],
  ])('refuses a value a JS double would round onto the bound', (param, values, message) => {
    expect(errorFor(param, values)).toBe(message)
  })

  it('passes a value equal to the bound written another way', () => {
    expect(errorFor(rate, { rate: '100.000' })).toBeNull()
  })

  it('compares against the row it names exactly', () => {
    expect(errorFor(minReplies, { min_replies: '9007199254740993', count: '9007199254740992' })).toBe(
      'Minimum replies cannot exceed Count',
    )
  })
})

describe('literalNumberProblem', () => {
  it.each([
    ['integer', '-', 'Enter a valid integer value'],
    ['float', '1e5', 'Enter a valid float value'],
    ['integer', 1.5, 'Enter a valid integer value'],
    ['integer', '12345678901234567890', 'Maximum 19 digits'],
    ['float', `0.${'1'.repeat(29)}`, 'Maximum 28 significant digits'],
  ] as const)('names a literal %s value %j the number rule refuses', (type, value, message) => {
    expect(literalNumberProblem(type, value, false)).toBe(message)
  })

  it.each([
    ['integer', '42'],
    ['float', 0.0000001],
    ['integer', undefined],
    ['integer', null],
    ['float', ''],
    ['integer', MASK_PLACEHOLDER],
    ['integer', `${SECRET_ENVELOPE_PREFIX}abc`],
    ['string', 'abc'],
  ] as const)('passes a %s value %j', (type, value) => {
    expect(literalNumberProblem(type, value, false)).toBeNull()
  })

  it('checks nothing in expression mode', () => {
    expect(literalNumberProblem('integer', '{{ vars.count }}', true)).toBeNull()
  })
})

describe('numberBoundError - a bound that names another row', () => {
  it('passes while the value sits at or below the row it names', () => {
    expect(errorFor(minReplies, { min_replies: 4, count: 4 })).toBeNull()
    expect(errorFor(minReplies, { min_replies: 2, count: 4 })).toBeNull()
  })

  it('carries the rule’s own message once the value passes that row', () => {
    expect(errorFor(minReplies, { min_replies: 10, count: 4 })).toBe(
      'Minimum replies cannot exceed Count',
    )
  })

  it('falls back to the named row’s default while that row is unset', () => {
    expect(errorFor(minReplies, { min_replies: 10 })).toBe('Minimum replies cannot exceed Count')
  })

  it('reports its own range first when the value also breaks that', () => {
    expect(errorFor(minReplies, { min_replies: 0, count: 4 })).toBe(
      'Minimum replies must be at least 1',
    )
  })

  it('checks nothing while the row it names holds an expression', () => {
    expect(
      errorFor(minReplies, { min_replies: 10, count: '{{ vars.count }}' }, new Set(['count'])),
    ).toBeNull()
  })

  it('checks nothing while the row it names is absent from the schema and unset', () => {
    const orphan: BoundedParam = {
      name: 'min_replies',
      maximumField: { field: 'nowhere', message: 'nope' },
    }
    expect(numberBoundError(orphan, { min_replies: 10 }, schema, NO_EXPRESSIONS)).toBeNull()
  })
})
