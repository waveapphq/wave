import { describe, it, expect } from 'vitest'

import { isEnumInput } from '@/features/functions/lib/enum-input'
import type { FunctionInput } from '@/features/functions/api/types'
import type { ParamSpec } from '@/features/workbench/stores/workflow-store'

function functionInput(overrides: Partial<FunctionInput> = {}): FunctionInput {
  return { name: 'level', type: 'string', required: true, default: 'low', description: '', ...overrides }
}

describe('isEnumInput (REQ-3.1.2.11)', () => {
  it.each<[FunctionInput['type'], Array<string | number>]>([
    ['string', ['low', 'high']],
    ['integer', [1, 3]],
    ['float', [0.5, 1.5]],
  ])('is true for a %s input that lists allowed values', (type, enumValues) => {
    expect(isEnumInput(functionInput({ type, enumValues, default: enumValues[0] }))).toBe(true)
  })

  it('is true for an input whose allowed values list is empty', () => {
    expect(isEnumInput(functionInput({ enumValues: [] }))).toBe(true)
  })

  it('is false for an input with no allowed values', () => {
    expect(isEnumInput(functionInput())).toBe(false)
  })

  it('is false when the allowed values are left undefined', () => {
    expect(isEnumInput(functionInput({ enumValues: undefined }))).toBe(false)
  })

  it('reads the allowed values alone, never the type', () => {
    expect(isEnumInput(functionInput({ type: 'array', enumValues: ['low'] }))).toBe(true)
    expect(isEnumInput(functionInput({ type: 'array', default: [] }))).toBe(false)
  })

  it('reads a Function parameter spec from the store the same way', () => {
    const plain: ParamSpec = { name: 'region', type: 'string', required: true, default: 'eu' }
    const picked: ParamSpec = { ...plain, name: 'level', enumValues: ['low', 'high'], default: 'low' }

    expect(isEnumInput(plain)).toBe(false)
    expect(isEnumInput(picked)).toBe(true)
  })
})
