/**
 * While Loop Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the While Loop control.
 * REQ-3.5.1.17: While loop with condition
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/while'

describe('While Loop parameter schema', () => {
  describe('inputs', () => {
    it('has 4 parameters', () => {
      expect(inputs).toHaveLength(4)
    })

    it('mode parameter has correct schema', () => {
      const mode = inputs.find((p) => p.name === 'mode')!
      expect(mode).toBeDefined()
      expect(mode.type).toBe('string')
      expect(mode.required).toBe(true)
      expect(mode.enumValues).toEqual(['while-do', 'do-while'])
      expect(mode.defaultValue).toBe('while-do')
      expect(mode.noExpression).toBe(true)
    })

    it('conditions parameter has correct schema', () => {
      const conditions = inputs.find((p) => p.name === 'conditions')!
      expect(conditions).toBeDefined()
      expect(conditions.type).toBe('array')
      expect(conditions.required).toBe(true)
      expect(conditions.noExpression).toBe(true)
    })

    it('max_iterations parameter has correct schema', () => {
      const maxIter = inputs.find((p) => p.name === 'max_iterations')!
      expect(maxIter).toBeDefined()
      expect(maxIter.type).toBe('integer')
      expect(maxIter.required).toBe(false)
      expect(maxIter.defaultValue).toBeUndefined()
      expect(maxIter.group).toBe('Advanced')
    })

    it('timeout parameter has correct schema', () => {
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout).toBeDefined()
      expect(timeout.type).toBe('float')
      expect(timeout.required).toBe(false)
      expect(timeout.defaultValue).toBeUndefined()
      expect(timeout.group).toBe('Advanced')
    })

    it('mode is first parameter', () => {
      expect(inputs[0].name).toBe('mode')
    })

    it('conditions is second parameter', () => {
      expect(inputs[1].name).toBe('conditions')
    })

    it('max_iterations is third parameter', () => {
      expect(inputs[2].name).toBe('max_iterations')
    })

    it('timeout is fourth parameter', () => {
      expect(inputs[3].name).toBe('timeout')
    })

    it('mode has label', () => {
      const mode = inputs.find((p) => p.name === 'mode')!
      expect(mode.label).toBeDefined()
      expect(mode.label!.length).toBeGreaterThan(0)
    })

    it('conditions has label', () => {
      const conditions = inputs.find((p) => p.name === 'conditions')!
      expect(conditions.label).toBeDefined()
      expect(conditions.label!.length).toBeGreaterThan(0)
    })

    it('max_iterations has label', () => {
      const maxIter = inputs.find((p) => p.name === 'max_iterations')!
      expect(maxIter.label).toBeDefined()
      expect(maxIter.label!.length).toBeGreaterThan(0)
    })

    it('timeout has label', () => {
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout.label).toBeDefined()
      expect(timeout.label!.length).toBeGreaterThan(0)
    })
  })

  describe('outputs', () => {
    it('has 1 output', () => {
      expect(outputs).toHaveLength(1)
    })

    it('index output has correct schema', () => {
      const index = outputs.find((p) => p.name === 'index')!
      expect(index).toBeDefined()
      expect(index.type).toBe('integer')
      expect(index.description).toBeDefined()
      expect(index.description!.length).toBeGreaterThan(0)
    })
  })
})
