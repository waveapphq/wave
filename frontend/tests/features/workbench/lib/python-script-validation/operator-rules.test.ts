/**
 * alwaysRaisesTypeError - operand types Python rejects for a binary operator.
 *
 * Contract under test (PYRUN-13): a pair is rejected only when every Python
 * from 3.8 to 3.14 raises TypeError for it whatever the values; an operator
 * without a rule is never reported.
 *
 * REQ-3.4.1.2: Python script execution
 */

import { describe, it, expect } from 'vitest'

import { alwaysRaisesTypeError } from '@/features/workbench/lib/python-script-validation/operator-rules'

describe('alwaysRaisesTypeError', () => {
  it('rejects Decimal with float', () => {
    expect(alwaysRaisesTypeError('*', 'Decimal', 'float')).toBe(true)
    expect(alwaysRaisesTypeError('+', 'float', 'Decimal')).toBe(true)
  })

  it('accepts Decimal with int', () => {
    expect(alwaysRaisesTypeError('*', 'Decimal', 'int')).toBe(false)
  })

  it('accepts dict | dict, which only some supported versions allow', () => {
    expect(alwaysRaisesTypeError('|', 'dict', 'dict')).toBe(false)
  })

  it('never rejects string formatting, whose failure depends on the value', () => {
    expect(alwaysRaisesTypeError('%', 'str', 'table')).toBe(false)
    expect(alwaysRaisesTypeError('%', 'bytes', 'NoneType')).toBe(false)
  })

  it('rejects every pair for matrix multiplication', () => {
    expect(alwaysRaisesTypeError('@', 'int', 'int')).toBe(true)
  })

  it('never reports an operator it has no rule for', () => {
    expect(alwaysRaisesTypeError('<>', 'str', 'int')).toBe(false)
  })
})
