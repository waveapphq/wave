/**
 * Halt Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the Halt control,
 * including the `function` scope value.
 * REQ-3.5.1.14: Halt scope configuration (test/suite/regression/function level)
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/halt'

describe('Halt parameter schema', () => {
  describe('inputs', () => {
    it('has 3 parameters (scope, status, message)', () => {
      expect(inputs.map((p) => p.name)).toEqual(['scope', 'status', 'message'])
    })

    it('scope parameter is an optional string with default "test"', () => {
      const scope = inputs.find((p) => p.name === 'scope')!
      expect(scope).toBeDefined()
      expect(scope.type).toBe('string')
      expect(scope.required).toBe(false)
      expect(scope.defaultValue).toBe('test')
    })

    it('scope enumValues are [test, suite, regression, function] in order', () => {
      const scope = inputs.find((p) => p.name === 'scope')!
      expect(scope.enumValues).toEqual(['test', 'suite', 'regression', 'function'])
    })

    it('scope description mentions the function scope', () => {
      const scope = inputs.find((p) => p.name === 'scope')!
      expect(scope.description ?? '').toContain('function')
    })

    it('scope is a no-expression enum field', () => {
      const scope = inputs.find((p) => p.name === 'scope')!
      expect(scope.noExpression).toBe(true)
    })

    it('status enumValues are unchanged [passed, failed, skipped]', () => {
      const status = inputs.find((p) => p.name === 'status')!
      expect(status.enumValues).toEqual(['passed', 'failed', 'skipped'])
      expect(status.defaultValue).toBe('failed')
    })

    it('message is an optional free-text string with no enum', () => {
      const message = inputs.find((p) => p.name === 'message')!
      expect(message.type).toBe('string')
      expect(message.required).toBe(false)
      expect(message.enumValues).toBeUndefined()
    })
  })

  describe('outputs', () => {
    it('has 0 outputs', () => {
      expect(outputs).toHaveLength(0)
    })
  })
})
