/** Tests for the Variable Setter row checks: name (VARSET-8) and value (REQ-3.4.3.8, REQ-3.1.3.21). */

import { describe, it, expect } from 'vitest'

import * as setterValidation from '@/features/workbench/common/variables/variable-setter-editor/validation'
import type {
  AvailableVariable,
  VariableRow,
} from '@/features/workbench/common/variables/variable-setter-editor/types'
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'

const { validateName } = setterValidation
const setterValueProblem = (setterRow: VariableRow) => setterValidation.setterValueProblem(setterRow)

describe('validateName - Function input read-only guard', () => {
  it('rejects a name matching a Function input with the Function save check text', () => {
    const vars = [{ name: 'x', type: 'string', source: 'Function input' }] as AvailableVariable[]
    const result = validateName('x', ['x'], 0, vars)
    expect(result.error).toBe("Writes to declared input 'x'; inputs are read-only")
  })

  it('allows a name matching a writable (non-input) variable', () => {
    const vars = [{ name: 'x', type: 'string', source: 'Function output' }] as AvailableVariable[]
    const result = validateName('x', ['x'], 0, vars)
    expect(result.error).toBeNull()
  })
})

/** A Setter row as the editor holds it; entry {x} keys are the list index or the map key. */
function row(fields: Partial<VariableRow> & { entryExpressions?: string[] }): VariableRow {
  return { key: 'k', name: 'retries', value: null, type: 'string', isExpression: false, ...fields } as VariableRow
}

describe('setterValueProblem - an {x} row needs an expression', () => {
  it.each([
    ['empty text', ''],
    ['spaces only', '   '],
    ['a stored null', null],
    ['no value', undefined],
  ])('refuses %s with "Value is required"', (_label, value) => {
    expect(setterValueProblem(row({ isExpression: true, value }))).toBe('Value is required')
  })

  it('accepts an expression', () => {
    expect(setterValueProblem(row({ isExpression: true, value: 'attempt + 1' }))).toBeNull()
  })

  it('accepts an expression that gives null', () => {
    expect(setterValueProblem(row({ isExpression: true, value: 'None' }))).toBeNull()
  })

  it('leaves an {x} row on a number variable to the expression, not the number rule', () => {
    expect(setterValueProblem(row({ isExpression: true, type: 'integer', value: 'attempt + 1' }))).toBeNull()
  })
})

describe('setterValueProblem - a literal row', () => {
  it('refuses a literal row with no value, as one dropped when it no longer fit its variable', () => {
    expect(setterValueProblem(row({ type: 'boolean', value: undefined }))).toBe('Value is required')
  })

  it.each([
    ['null', 'string', null],
    ['empty text', 'string', ''],
    ['text', 'string', 'hello'],
    ['false', 'boolean', false],
    ['an empty list', 'array', []],
    ['a sealed secret', 'string', MASK_PLACEHOLDER],
  ])('accepts %s', (_label, type, value) => {
    expect(setterValueProblem(row({ type, value }))).toBeNull()
  })
})

// A literal number row keeps the one number rule (REQ-3.1.3.14).
describe('setterValueProblem - a literal number row', () => {
  const valueProblem = (type: string, value: unknown) => setterValueProblem(row({ type, value }))

  it.each([
    ['integer', '-', 'Enter a valid integer value'],
    ['float', '1.', 'Enter a valid float value'],
  ])('names unfinished %s text %j with the window message', (type, value, message) => {
    expect(valueProblem(type, value)).toBe(message)
  })

  it('names an integer past 19 digits, as text or as a JS number', () => {
    expect(valueProblem('integer', '12345678901234567890')).toBe('Maximum 19 digits')
    expect(valueProblem('integer', 1e21)).toBe('Maximum 19 digits')
  })

  it('names a JS number that is no whole number in an integer row', () => {
    expect(valueProblem('integer', 2.5)).toBe('Enter a valid integer value')
  })

  it('takes a JS number in plain digits and exact digit text', () => {
    expect(valueProblem('float', 0.0000001)).toBeNull()
    expect(valueProblem('integer', '9007199254740993')).toBeNull()
  })

  it.each([
    ['integer', ' 30 ', 'Enter a valid integer value'],
    ['float', '2.5 ', 'Enter a valid float value'],
  ])('names %s text with a space around its digits as no number, as the server does', (type, value, message) => {
    expect(valueProblem(type, value)).toBe(message)
  })

  it('leaves a stored null, a sealed secret and another type alone', () => {
    expect(valueProblem('integer', null)).toBeNull()
    expect(valueProblem('integer', MASK_PLACEHOLDER)).toBeNull()
    expect(valueProblem('string', '-')).toBeNull()
  })
})

describe('setterValueProblem - list and map entries held as {x} (FIELD-13)', () => {
  it.each([
    ['empty text', ''],
    ['spaces only', '  '],
  ])("names a blank {x} list entry holding %s by its row, counted from 1", (_label, blank) => {
    const hosts = row({ name: 'hosts', type: 'array', value: ['web-1', 'web-2', blank], entryExpressions: ['2'] })
    expect(setterValueProblem(hosts)).toBe("Row 3 in 'hosts' is required")
  })

  it('names a blank {x} map entry by its key', () => {
    const limits = row({ name: 'limits', type: 'map', value: { cpu: '2', mem: '' }, entryExpressions: ['mem'] })
    expect(setterValueProblem(limits)).toBe("'mem' in 'limits' is required")
  })

  it('accepts {x} entries that hold an expression', () => {
    const hosts = row({ name: 'hosts', type: 'array', value: ['web-1', 'backup_host'], entryExpressions: ['1'] })
    expect(setterValueProblem(hosts)).toBeNull()
  })

  it('accepts a blank literal entry, which is empty text', () => {
    const hosts = row({ name: 'hosts', type: 'array', value: ['web-1', ''] })
    expect(setterValueProblem(hosts)).toBeNull()
  })
})
