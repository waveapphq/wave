/**
 * Remote Execution container parameter schema tests (REQ-3.4.1.3).
 *
 * The Remote Execution container renders on the schema-driven element config
 * form with exactly one input, Session ID (required - an open SSH session bound
 * from an SSH Session Open Session ID output), and exactly one output, Remote
 * Session ID. There is no Inputs, Interpreter, or Timeout parameter: interpreter
 * compatibility is validated on the host at run time, and each body block owns
 * its own timeout (REMEX-3).
 *
 * The Session ID field reuses the shared `sshSessionIdInput` (session picker;
 * required) - the same input the SSH Execute / Close plugins use - so it looks
 * and resolves identically.
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  getInputParams,
  getOutputParams,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
// Static (not dynamic) import: a top-level import shares vitest's module
// instance with the schema chain, so the `toBe` reference-identity check holds
// (an `await import()` evaluates a separate instance and can never match).
import { sshSessionIdInput } from '@/features/workbench/lib/node-parameters/plugins/_ssh-session-shared'

function remoteInputs(): InputParam[] {
  return getInputParams('remote-execution') ?? []
}

function remoteOutputs(): OutputParam[] {
  return getOutputParams('remote-execution') ?? []
}

describe('Remote Execution schema registration', () => {
  it('registers remote-execution in the plugin input registry', () => {
    expect(PLUGIN_INPUTS['remote-execution']).toBeDefined()
  })

  it('registers remote-execution in the plugin output registry', () => {
    expect(PLUGIN_OUTPUTS['remote-execution']).toBeDefined()
  })

  it('resolves remote-execution via hasNodeParams', () => {
    expect(hasNodeParams('remote-execution')).toBe(true)
  })
})

describe('Remote Execution inputs (REMEX-3)', () => {
  it('exposes exactly one input', () => {
    expect(remoteInputs()).toHaveLength(1)
  })

  it('the single input is a required Session ID string field', () => {
    const [input] = remoteInputs()
    expect(input.name).toBe('session_id')
    expect(input.label).toBe('Session ID')
    expect(input.type).toBe('string')
    expect(input.required).toBe(true)
  })

  it('has no Inputs, Interpreter, or Timeout parameter', () => {
    const names = remoteInputs().map((p) => p.name)
    expect(names).not.toContain('interpreter')
    expect(names).not.toContain('timeout')
    expect(names).not.toContain('inputs')
  })
})

describe('Remote Execution outputs (REMEX-3)', () => {
  it('exposes exactly one output', () => {
    expect(remoteOutputs()).toHaveLength(1)
  })

  it('the single output is the Remote Session ID string', () => {
    const [out] = remoteOutputs()
    expect(out.name).toBe('remote_session_id')
    expect(out.label).toBe('Remote Session ID')
    expect(out.type).toBe('string')
    expect(out.description).toBeTruthy()
  })
})

describe('shared Session ID input', () => {
  it('the shared sshSessionIdInput is a required Session ID session picker', () => {
    expect(sshSessionIdInput.name).toBe('session_id')
    expect(sshSessionIdInput.label).toBe('Session ID')
    expect(sshSessionIdInput.type).toBe('string')
    expect(sshSessionIdInput.required).toBe(true)
  })

  it('the remote-execution schema reuses the shared SSH sshSessionIdInput', () => {
    const first = remoteInputs()[0]
    expect(first).toBeDefined()
    expect(first).toBe(sshSessionIdInput)
  })
})
