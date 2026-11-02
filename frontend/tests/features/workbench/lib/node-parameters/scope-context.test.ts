/**
 * Tests for gateHaltScopeForContext.
 *
 * The `function` Halt scope is only valid inside a Function body, so the config
 * dropdown must hide it at the Test top level. The backend enforces the same
 * rule; this helper drives the FE guardrail.
 *
 * REQ-3.5.1.14.
 */

import { describe, it, expect } from 'vitest'

import { gateHaltScopeForContext } from '@/features/workbench/lib/node-parameters/scope-context'
import { inputs as haltInputs } from '@/features/workbench/lib/node-parameters/controls/halt'

describe('gateHaltScopeForContext', () => {
  it('drops the function scope option for a Halt at the Test top level', () => {
    const result = gateHaltScopeForContext('halt', haltInputs, {
      drilled: false,
      functionView: false,
    })

    const scope = result.find((p) => p.name === 'scope')!
    expect(scope.enumValues).toEqual(['test', 'suite', 'regression'])

    // Non-scope params pass through untouched.
    const status = result.find((p) => p.name === 'status')!
    expect(status.enumValues).toEqual(['passed', 'failed', 'skipped'])
    expect(result.find((p) => p.name === 'message')).toBeDefined()

    // The shared schema is not mutated.
    expect(haltInputs.find((p) => p.name === 'scope')!.enumValues).toContain('function')
  })

  it('keeps the function scope option for a Halt drilled into a Function', () => {
    const result = gateHaltScopeForContext('halt', haltInputs, {
      drilled: true,
      functionView: false,
    })
    expect(result).toBe(haltInputs)
    expect(result.find((p) => p.name === 'scope')!.enumValues).toContain('function')
  })

  it('keeps the function scope option for a Halt in Function View', () => {
    const result = gateHaltScopeForContext('halt', haltInputs, {
      drilled: false,
      functionView: true,
    })
    expect(result).toBe(haltInputs)
  })

  it('is a no-op for non-Halt controls', () => {
    const result = gateHaltScopeForContext('log', haltInputs, {
      drilled: false,
      functionView: false,
    })
    expect(result).toBe(haltInputs)
  })
})
