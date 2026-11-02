/**
 * SSH Tunnel plugin parameter schema tests (REQ-3.4.1.3, REQ-5.1.5).
 *
 * The SSH Tunnel pair (Open / Close) renders on the schema-driven element
 * config form. Open groups Session ID, Local Port, Remote Host and Remote Port
 * into the Forwarding group (expanded by default), holds Validate Target in a
 * collapsed Advanced group (SSHTUN-2, SSHTUN-7), and outputs Tunnel ID + the
 * resolved Local Port (SSHTUN-1..4). The session_id input is the shared session
 * handle; the tunnel_id handle is shared between Open's output and Close's
 * input. Close takes only Tunnel ID and outputs Closed.
 */

import { describe, it, expect } from 'vitest'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import { numberBoundError } from '@/features/workbench/lib/validation/number-bounds'

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

const NO_EXPRESSIONS: ReadonlySet<string> = new Set()

/** The form and issue-badge message a literal on one Tunnel Open row earns, or null (PING-17). */
function boundMessage(name: string, value: number): string | null {
  const inputs = getInputParams('ssh-tunnel-open') ?? []
  const row = inputs.find((p) => p.name === name)
  expect(row, `ssh-tunnel-open row ${name}`).toBeDefined()
  return numberBoundError(row!, { [name]: value }, inputs, NO_EXPRESSIONS)
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

const FORWARDING_PARAMS = ['session_id', 'local_port', 'remote_host', 'remote_port']
const OPEN_PARAM_ORDER = [...FORWARDING_PARAMS, 'validate_target']
const VALIDATE_TARGET_HELP =
  'Connects to the target once when the tunnel opens and fails if the SSH host refuses or ' +
  'cannot reach it. That connection is handed to the first block that uses the tunnel.'

describe('registration', () => {
  it('registers both SSH tunnel plugins in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['ssh-tunnel-open']).toBeDefined()
    expect(PLUGIN_INPUTS['ssh-tunnel-close']).toBeDefined()
  })

  it('registers both SSH tunnel plugins in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['ssh-tunnel-open']).toBeDefined()
    expect(PLUGIN_OUTPUTS['ssh-tunnel-close']).toBeDefined()
  })

  it('resolves both via hasNodeParams', () => {
    expect(hasNodeParams('ssh-tunnel-open')).toBe(true)
    expect(hasNodeParams('ssh-tunnel-close')).toBe(true)
  })
})

describe('ssh-tunnel-open inputs', () => {
  it('declares the four forwarding params, then Validate Target, in order', () => {
    const names = (getInputParams('ssh-tunnel-open') ?? []).map((p) => p.name)

    expect(names).toEqual(OPEN_PARAM_ORDER)
  })

  it('assigns the four forwarding inputs to the Forwarding group', () => {
    const params = inputsByName('ssh-tunnel-open')

    for (const name of FORWARDING_PARAMS) {
      expect(params[name].group).toBe('Forwarding')
    }
  })

  it('puts Validate Target in the Advanced group (SSHTUN-2)', () => {
    expect(inputsByName('ssh-tunnel-open').validate_target.group).toBe('Advanced')
  })

  it('declares types matching the backend schema', () => {
    const params = inputsByName('ssh-tunnel-open')

    expect(params.session_id.type).toBe('string')
    expect(params.local_port.type).toBe('integer')
    expect(params.remote_host.type).toBe('string')
    expect(params.remote_port.type).toBe('integer')
    expect(params.validate_target.type).toBe('boolean')
  })

  it('marks session_id, remote_host, and remote_port required and the rest optional', () => {
    const params = inputsByName('ssh-tunnel-open')

    expect(params.session_id.required).toBe(true)
    expect(params.remote_host.required).toBe(true)
    expect(params.remote_port.required).toBe(true)
    expect(params.local_port.required).toBe(false)
    expect(params.validate_target.required).toBe(false)
  })

  it('defaults the local port to 0 (auto-assign)', () => {
    const params = inputsByName('ssh-tunnel-open')

    expect(params.local_port.defaultValue).toBe(0)
  })

  it('leaves Validate Target unchecked by default (SSHTUN-7)', () => {
    expect(inputsByName('ssh-tunnel-open').validate_target.defaultValue).toBe(false)
  })

  it('declares the whole Validate Target row with its help text (SSHTUN-7)', () => {
    expect(inputsByName('ssh-tunnel-open').validate_target).toEqual({
      name: 'validate_target',
      label: 'Validate Target',
      type: 'boolean',
      required: false,
      description: VALIDATE_TARGET_HELP,
      group: 'Advanced',
      defaultValue: false,
    })
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('ssh-tunnel-open')

    expect(params.session_id.label).toBe('Session ID')
    expect(params.local_port.label).toBe('Local Port')
    expect(params.remote_host.label).toBe('Remote Host')
    expect(params.remote_port.label).toBe('Remote Port')
    expect(params.validate_target.label).toBe('Validate Target')
  })

  it('describes every parameter', () => {
    const inputs = getInputParams('ssh-tunnel-open') ?? []

    expect(inputs).toHaveLength(OPEN_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })
})

describe('ssh-tunnel-open declared bounds (SSH-9)', () => {
  const PORT_ROWS: [string, InputParam][] = [
    [
      'local_port',
      {
        name: 'local_port',
        label: 'Local Port',
        type: 'integer',
        required: false,
        description: 'Local port to listen on; 0 auto-assigns a free port',
        group: 'Forwarding',
        defaultValue: 0,
        minimum: 0,
        maximum: 65535,
      },
    ],
    [
      'remote_port',
      {
        name: 'remote_port',
        label: 'Remote Port',
        type: 'integer',
        required: true,
        description: 'Destination port to forward to',
        group: 'Forwarding',
        minimum: 1,
        maximum: 65535,
      },
    ],
  ]

  it.each(PORT_ROWS)('declares the range of %s and keeps the rest of the row', (name, expected) => {
    expect(inputsByName('ssh-tunnel-open')[name]).toEqual(expected)
  })

  it('leaves Session ID and Remote Host unbounded', () => {
    const params = inputsByName('ssh-tunnel-open')

    for (const name of ['session_id', 'remote_host']) {
      expect(params[name].minimum, `minimum of ${name}`).toBeUndefined()
      expect(params[name].maximum, `maximum of ${name}`).toBeUndefined()
      expect(params[name].maximumField, `maximumField of ${name}`).toBeUndefined()
    }
  })

  it.each([
    ['local_port', -1, 'Local Port must be between 0 and 65535'],
    ['local_port', 65536, 'Local Port must be between 0 and 65535'],
    ['remote_port', 0, 'Remote Port must be between 1 and 65535'],
    ['remote_port', 65536, 'Remote Port must be between 1 and 65535'],
  ])('flags %s = %d with "%s" (PING-17)', (name, value, message) => {
    expect(boundMessage(name, value)).toBe(message)
  })

  it.each([
    ['local_port', 0],
    ['local_port', 65535],
    ['remote_port', 1],
    ['remote_port', 65535],
  ])('accepts %s = %d', (name, value) => {
    expect(boundMessage(name, value)).toBeNull()
  })
})

describe('ssh-tunnel-open outputs', () => {
  it('declares Tunnel ID and Local Port in order', () => {
    const outputs = (getOutputParams('ssh-tunnel-open') ?? []).map((o) => [o.name, o.type])

    expect(outputs).toEqual([
      ['tunnel_id', 'string'],
      ['local_port', 'integer'],
    ])
  })

  it('labels the outputs for display', () => {
    const outputs = outputsByName('ssh-tunnel-open')

    expect(outputs.tunnel_id.label).toBe('Tunnel ID')
    expect(outputs.local_port.label).toBe('Local Port')
  })

  it('omits remote destination and status outputs', () => {
    const names = (getOutputParams('ssh-tunnel-open') ?? []).map((o) => o.name)

    expect(names).not.toContain('remote_destination')
    expect(names).not.toContain('tunnel_status')
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('ssh-tunnel-open') ?? []

    expect(outputs).toHaveLength(2)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })
})

describe('ssh-tunnel-open group metadata', () => {
  it('declares Forwarding, then Advanced', () => {
    const meta = getGroupMeta('ssh-tunnel-open')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(['Forwarding', 'Advanced'])
  })

  it('keeps the Forwarding group expanded with its description', () => {
    const meta = getGroupMeta('ssh-tunnel-open')

    expect(meta!.Forwarding).toEqual({
      name: 'Forwarding',
      description: 'Session to forward through and the local to remote mapping',
      defaultExpanded: true,
    })
  })

  it('declares Advanced collapsed by default with no description (SSHTUN-2)', () => {
    expect(getGroupMeta('ssh-tunnel-open')!.Advanced).toEqual({ name: 'Advanced' })
  })
})

describe('ssh-tunnel-close schema', () => {
  it('declares only the tunnel_id input, required', () => {
    const inputs = getInputParams('ssh-tunnel-close') ?? []

    expect(inputs.map((p) => p.name)).toEqual(['tunnel_id'])
    expect(inputs[0].required).toBe(true)
    expect(inputs[0].type).toBe('string')
  })

  it('declares the closed output with a description', () => {
    const outputs = getOutputParams('ssh-tunnel-close') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['closed', 'boolean'],
    ])
    expect(outputs[0].description).toBeTruthy()
  })
})

describe('shared session handle', () => {
  it('labels Open session_id the same as the session trio', () => {
    const openInput = inputsByName('ssh-tunnel-open').session_id
    const execInput = inputsByName('ssh-session-exec').session_id

    expect(openInput.label).toBe('Session ID')
    expect(execInput.label).toBe('Session ID')
  })

  it('reuses the shared session_id definition (identical description)', () => {
    const openInput = inputsByName('ssh-tunnel-open').session_id
    const execInput = inputsByName('ssh-session-exec').session_id

    expect(openInput.description).toBeTruthy()
    expect(openInput.description).toBe(execInput.description)
  })

  it('locks the session_id editor to the plain format', () => {
    const openInput = inputsByName('ssh-tunnel-open').session_id

    expect(openInput.allowedFormats).toEqual(['plain'])
  })
})

describe('shared tunnel handle', () => {
  it("keeps Open's tunnel_id output identical to Close's tunnel_id input", () => {
    const openOutput = outputsByName('ssh-tunnel-open').tunnel_id
    const closeInput = inputsByName('ssh-tunnel-close').tunnel_id

    expect(openOutput.label).toBe('Tunnel ID')
    expect(closeInput.label).toBe('Tunnel ID')
    expect(openOutput.description).toBeTruthy()
    expect(closeInput.description).toBe(openOutput.description)
  })
})

describe('plain-text rows', () => {
  it('locks Remote Host to plain text, so its editor has no Format picker', () => {
    expect(inputsByName('ssh-tunnel-open').remote_host.allowedFormats).toEqual(['plain'])
  })
})
