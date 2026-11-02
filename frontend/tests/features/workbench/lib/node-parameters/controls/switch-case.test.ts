/**
 * Switch/Case Control Parameter Schema Tests
 *
 * Verifies the input/output parameter definitions for the Switch/Case control
 * and their wiring into the control registry.
 * Decisions: SWITCH-12 (Switch declares no outputs), branch record shape
 * REQ-3.5.1.20: Switch/Case multi-branch decisions
 */

import { describe, it, expect } from 'vitest'
import { inputs, outputs } from '@/features/workbench/lib/node-parameters/controls/switch-case'
import { CONTROL_INPUTS, CONTROL_OUTPUTS } from '@/features/workbench/lib/node-parameters'

describe('Switch/Case parameter schema', () => {
  describe('inputs', () => {
    it('has 1 parameter', () => {
      expect(inputs).toHaveLength(1)
    })

    it('declares branches as its only parameter', () => {
      expect(inputs.map((p) => p.name)).toEqual(['branches'])
    })

    it('branches parameter has correct schema', () => {
      const branches = inputs.find((p) => p.name === 'branches')!
      expect(branches).toBeDefined()
      expect(branches.label).toBe('Branches')
      expect(branches.type).toBe('array')
      expect(branches.required).toBe(true)
      expect(branches.noExpression).toBe(true)
    })

    it('branches parameter describes the case list and the optional default', () => {
      const branches = inputs.find((p) => p.name === 'branches')!
      expect(branches.description).toBe(
        'Ordered list of case branches with conditions and break, plus an optional default',
      )
    })
  })

  describe('outputs', () => {
    // Guard: the control declared a matchedCase output the runtime never wrote.
    it('has no outputs', () => {
      expect(outputs).toHaveLength(0)
    })

    it('declares an empty output schema', () => {
      expect(outputs).toEqual([])
    })
  })

  describe('registry wiring', () => {
    it('registers the switch-case inputs in the control registry', () => {
      expect(CONTROL_INPUTS['switch-case']).toBe(inputs)
      expect(CONTROL_INPUTS['switch-case'].map((p) => p.name)).toEqual(['branches'])
    })

    it('registers the switch-case outputs in the control registry', () => {
      expect(CONTROL_OUTPUTS['switch-case']).toBe(outputs)
      expect(CONTROL_OUTPUTS['switch-case']).toHaveLength(0)
    })
  })
})
