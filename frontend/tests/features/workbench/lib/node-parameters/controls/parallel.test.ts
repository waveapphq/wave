/**
 * Parallel Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the Parallel control and
 * their wiring into the control registry. The list declares the lanes and the
 * join mode, which the window draws outside the parameter table, and the
 * section time limit row.
 *
 * Decisions: PARALLEL-6 (no outputs), PARALLEL-5 (section limit), PARALLEL-4 (join radios).
 * REQ-3.2.3.6, REQ-3.2.3.7, REQ-3.5.0.3
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/parallel'
import { CONTROL_INPUTS, CONTROL_OUTPUTS } from '@/features/workbench/lib/node-parameters'

const PARALLEL_FIELDS = ['branches', 'join', 'time_limit']

function field(name: string) {
  return inputs.find((p) => p.name === name)
}

describe('Parallel parameter schema', () => {
  describe('inputs', () => {
    it('declares the lanes, the join mode and the section time limit', () => {
      // Guard: no integer branch count and no waitStrategy rows.
      expect(inputs.map((p) => p.name).sort()).toEqual(PARALLEL_FIELDS)
    })

    it('declares the lanes as a required list with no {x}', () => {
      expect(field('branches')).toMatchObject({ type: 'array', required: true, noExpression: true })
    })

    it('declares the join mode as Wait for all or First to finish, defaulting to all, with no {x}', () => {
      expect(field('join')).toMatchObject({
        type: 'string',
        required: false,
        enumValues: ['all', 'first'],
        defaultValue: 'all',
        noExpression: true,
        enumLabels: { all: 'Wait for all', first: 'First to finish' },
      })
    })

    it('time_limit is an optional integer', () => {
      const limit = inputs.find((p) => p.name === 'time_limit')!
      expect(limit.label).toBe('Section Time Limit')
      expect(limit.type).toBe('integer')
      expect(limit.required).toBe(false)
    })

    it('time_limit takes nothing below 1', () => {
      expect(field('time_limit')?.minimum).toBe(1)
    })

    it('time_limit describes itself in milliseconds', () => {
      const limit = inputs.find((p) => p.name === 'time_limit')!
      expect(limit.description).toBe('Optional. Milliseconds.')
    })
  })

  describe('outputs', () => {
    // Guard: the control bound a `results` array the runtime never wrote.
    it('has no outputs', () => {
      expect(outputs).toHaveLength(0)
    })

    it('declares an empty output schema', () => {
      expect(outputs).toEqual([])
    })
  })

  describe('registry wiring', () => {
    it('registers the parallel inputs in the control registry', () => {
      expect(CONTROL_INPUTS['parallel']).toBe(inputs)
      expect(CONTROL_INPUTS['parallel'].map((p) => p.name).sort()).toEqual(PARALLEL_FIELDS)
    })

    it('registers the parallel outputs in the control registry', () => {
      expect(CONTROL_OUTPUTS['parallel']).toBe(outputs)
      expect(CONTROL_OUTPUTS['parallel']).toHaveLength(0)
    })
  })
})
