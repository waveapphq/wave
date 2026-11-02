/**
 * For Loop Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the For Loop control.
 * REQ-3.5.1.15: For loop with counter variable
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/for'

describe('For Loop parameter schema', () => {
  describe('inputs', () => {
    it('has 6 parameters', () => {
      expect(inputs).toHaveLength(6)
    })

    it('mode parameter has correct schema', () => {
      const mode = inputs.find((p) => p.name === 'mode')!
      expect(mode).toBeDefined()
      expect(mode.type).toBe('string')
      expect(mode.required).toBe(true)
      expect(mode.enumValues).toEqual(['count', 'range'])
      expect(mode.defaultValue).toBe('count')
      expect(mode.noExpression).toBe(true)
    })

    it('count parameter shows and is required when mode is count', () => {
      const count = inputs.find((p) => p.name === 'count')!
      expect(count).toBeDefined()
      expect(count.type).toBe('integer')
      expect(count.required).toBe(false)
      expect(count.showWhen).toEqual({ field: 'mode', values: ['count'] })
      expect(count.requiredWhen).toEqual({ field: 'mode', values: ['count'] })
    })

    it('start parameter shows and is required when mode is range', () => {
      const start = inputs.find((p) => p.name === 'start')!
      expect(start).toBeDefined()
      expect(start.type).toBe('integer')
      expect(start.required).toBe(false)
      expect(start.showWhen).toEqual({ field: 'mode', values: ['range'] })
      expect(start.requiredWhen).toEqual({ field: 'mode', values: ['range'] })
    })

    it('end parameter shows and is required when mode is range', () => {
      const end = inputs.find((p) => p.name === 'end')!
      expect(end).toBeDefined()
      expect(end.type).toBe('integer')
      expect(end.required).toBe(false)
      expect(end.showWhen).toEqual({ field: 'mode', values: ['range'] })
      expect(end.requiredWhen).toEqual({ field: 'mode', values: ['range'] })
    })

    it('step parameter has Advanced group with default 1', () => {
      const step = inputs.find((p) => p.name === 'step')!
      expect(step).toBeDefined()
      expect(step.type).toBe('integer')
      expect(step.required).toBe(true)
      expect(step.defaultValue).toBe(1)
      expect(step.group).toBe('Advanced')
    })

    it('timeout parameter has Advanced group and float type', () => {
      const timeout = inputs.find((p) => p.name === 'timeout')!
      expect(timeout).toBeDefined()
      expect(timeout.type).toBe('float')
      expect(timeout.required).toBe(false)
      expect(timeout.group).toBe('Advanced')
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
