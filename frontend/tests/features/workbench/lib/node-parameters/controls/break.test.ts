/**
 * Break Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the Break control.
 * REQ-3.5.1.2: Break current block execution
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/break'

describe('Break parameter schema', () => {
  describe('inputs', () => {
    it('has 1 parameter', () => {
      expect(inputs).toHaveLength(1)
    })

    it('target_loop parameter has correct schema', () => {
      const targetLoop = inputs.find((p) => p.name === 'target_loop')!
      expect(targetLoop).toBeDefined()
      expect(targetLoop.type).toBe('string')
      expect(targetLoop.required).toBe(true)
      expect(targetLoop.label).toBe('Target Loop')
    })

    it('target_loop has a description', () => {
      const targetLoop = inputs.find((p) => p.name === 'target_loop')!
      expect(targetLoop.description).toBeDefined()
      expect(targetLoop.description!.length).toBeGreaterThan(0)
    })

    it('target_loop is the first and only parameter', () => {
      expect(inputs[0].name).toBe('target_loop')
    })

    it('does not have a condition parameter', () => {
      const condition = inputs.find((p) => p.name === 'condition')
      expect(condition).toBeUndefined()
    })

    it('does not have enumValues (populated dynamically from graph)', () => {
      const targetLoop = inputs.find((p) => p.name === 'target_loop')!
      expect(targetLoop.enumValues).toBeUndefined()
    })
  })

  describe('outputs', () => {
    it('has 0 outputs', () => {
      expect(outputs).toHaveLength(0)
    })
  })
})
