/**
 * Parallel Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the Parallel control and
 * their wiring into the control registry. The branch list moved to the
 * dedicated BRANCHES editor, so the only parameter row left is the section
 * time limit; the join mode is a radio section, not a row.
 *
 * Decisions: PARALLEL-6 (no outputs), PARALLEL-5 (section limit), PARALLEL-4 (join radios).
 * REQ-3.2.3.6, REQ-3.2.3.7
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/parallel'
import { CONTROL_INPUTS, CONTROL_OUTPUTS } from '@/features/workbench/lib/node-parameters'

describe('Parallel parameter schema', () => {
  describe('inputs', () => {
    it('declares the section time limit as its only parameter row', () => {
      // Guard: no integer branch count and no waitStrategy rows.
      expect(inputs.map((p) => p.name)).toEqual(['time_limit'])
    })

    it('time_limit is an optional integer', () => {
      const limit = inputs.find((p) => p.name === 'time_limit')!
      expect(limit.label).toBe('Section Time Limit')
      expect(limit.type).toBe('integer')
      expect(limit.required).toBe(false)
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
      expect(CONTROL_INPUTS['parallel'].map((p) => p.name)).toEqual(['time_limit'])
    })

    it('registers the parallel outputs in the control registry', () => {
      expect(CONTROL_OUTPUTS['parallel']).toBe(outputs)
      expect(CONTROL_OUTPUTS['parallel']).toHaveLength(0)
    })
  })
})
