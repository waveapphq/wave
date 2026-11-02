/**
 * SSH Session plugin parameter schema tests (REQ-3.4.1.3, REQ-5.1.5).
 *
 * The SSH Session trio (Open / Exec / Close) renders on the schema-driven
 * element config form. Open groups its params into Connection (expanded by
 * default) and Advanced (collapsed), both carrying a short group description
 * (SSH-1..SSH-3); every output carries a description feeding the (i) tooltip
 * (SSH-5); the session_id definition is shared across the trio (SSH-6).
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
import { timeoutInput } from '@/features/workbench/lib/node-parameters/plugins/_shared-params'
import { numberBoundError } from '@/features/workbench/lib/validation/number-bounds'

type MaybeSecret = InputParam & { secret?: boolean }

function inputsByName(nodeId: string): Record<string, MaybeSecret> {
  const inputs = (getInputParams(nodeId) ?? []) as MaybeSecret[]
  return Object.fromEntries(inputs.map((p) => [p.name, p]))
}

const NO_EXPRESSIONS: ReadonlySet<string> = new Set()

/** The form and issue-badge message a literal on one row earns, or null (PING-17). */
function boundMessage(nodeId: string, name: string, value: number): string | null {
  const inputs = getInputParams(nodeId) ?? []
  const row = inputs.find((p) => p.name === name)
  expect(row, `${nodeId} row ${name}`).toBeDefined()
  return numberBoundError(row!, { [name]: value }, inputs, NO_EXPRESSIONS)
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

const OPEN_PARAM_ORDER = [
  'host',
  'port',
  'username',
  'password',
  'private_key',
  'use_parent',
  'parent_session_id',
  'passphrase',
  'host_key_verification',
  'connect_timeout',
  'keep_alive_interval',
  'keep_alive_max_count',
  'compression',
]

const CONNECTION_PARAMS = [
  'host',
  'port',
  'username',
  'password',
  'private_key',
  'use_parent',
  'parent_session_id',
]

const ADVANCED_PARAMS = [
  'passphrase',
  'host_key_verification',
  'connect_timeout',
  'keep_alive_interval',
  'keep_alive_max_count',
  'compression',
]

const HOST_KEY_VERIFICATION_HELP =
  "Host key policy: 'strict' requires the host to be in WAVE's trusted hosts list, 'accept-new' adds an unknown host's key to that list the first time and refuses it later if it changes, 'disabled' skips verification. While trusted hosts are locked in Settings, 'accept-new' acts as 'strict'. Default: 'disabled'; a newly placed block takes the Settings default."

const PRIVATE_KEY_HELP =
  'Private key for key authentication: inline PEM content or the path of a key file on the WAVE host; a relative path starts at the home folder of the account WAVE runs under'

describe('registration', () => {
  it('registers the three SSH session plugins in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['ssh-session-open']).toBeDefined()
    expect(PLUGIN_INPUTS['ssh-session-exec']).toBeDefined()
    expect(PLUGIN_INPUTS['ssh-session-close']).toBeDefined()
  })

  it('registers the three SSH session plugins in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['ssh-session-open']).toBeDefined()
    expect(PLUGIN_OUTPUTS['ssh-session-exec']).toBeDefined()
    expect(PLUGIN_OUTPUTS['ssh-session-close']).toBeDefined()
  })

  it('resolves all three via hasNodeParams', () => {
    expect(hasNodeParams('ssh-session-open')).toBe(true)
    expect(hasNodeParams('ssh-session-exec')).toBe(true)
    expect(hasNodeParams('ssh-session-close')).toBe(true)
  })

  it('registers ssh-session-script in the plugin registries', () => {
    expect(PLUGIN_INPUTS['ssh-session-script']).toBeDefined()
    expect(PLUGIN_OUTPUTS['ssh-session-script']).toBeDefined()
    expect(hasNodeParams('ssh-session-script')).toBe(true)
  })
})

describe('ssh-session-open inputs', () => {
  it('declares the full parameter set in order', () => {
    const names = (getInputParams('ssh-session-open') ?? []).map((p) => p.name)

    expect(names).toEqual(OPEN_PARAM_ORDER)
  })

  it('assigns the Connection group to connection params', () => {
    const params = inputsByName('ssh-session-open')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group).toBe('Connection')
    }
  })

  it('assigns the Advanced group to advanced params', () => {
    const params = inputsByName('ssh-session-open')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group).toBe('Advanced')
    }
  })

  it('declares types matching the backend schema', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.host.type).toBe('string')
    expect(params.port.type).toBe('integer')
    expect(params.username.type).toBe('string')
    expect(params.password.type).toBe('string')
    expect(params.private_key.type).toBe('string')
    expect(params.parent_session_id.type).toBe('string')
    expect(params.passphrase.type).toBe('string')
    expect(params.host_key_verification.type).toBe('string')
    expect(params.connect_timeout.type).toBe('integer')
    expect(params.keep_alive_interval.type).toBe('integer')
    expect(params.keep_alive_max_count.type).toBe('integer')
    expect(params.compression.type).toBe('boolean')
  })

  it('marks host, port, and username required and the rest optional', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.host.required).toBe(true)
    expect(params.port.required).toBe(true)
    expect(params.username.required).toBe(true)
    for (const name of OPEN_PARAM_ORDER) {
      if (name === 'host' || name === 'port' || name === 'username') continue
      expect(params[name].required).toBe(false)
    }
  })

  it('declares the documented defaults', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.port.defaultValue).toBe(22)
    expect(params.host_key_verification.defaultValue).toBe('disabled')
    expect(params.connect_timeout.defaultValue).toBe(30)
    expect(params.keep_alive_interval.defaultValue).toBe(0)
    expect(params.keep_alive_max_count.defaultValue).toBe(3)
    expect(params.compression.defaultValue).toBe(false)
  })

  it('defaults Host Key Verification to disabled, one of its declared choices (REQ-4.5.14)', () => {
    const row = inputsByName('ssh-session-open').host_key_verification

    expect(row.defaultValue).toBe('disabled')
    expect(row.enumValues).toContain('disabled')
  })

  it('flags the credential params secret', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.password.secret).toBe(true)
    expect(params.private_key.secret).toBe(true)
    expect(params.passphrase.secret).toBe(true)
  })

  it('does not flag non-credential params secret', () => {
    const params = inputsByName('ssh-session-open')

    for (const name of ['host', 'port', 'username', 'parent_session_id']) {
      expect(params[name].secret).not.toBe(true)
    }
  })

  it('declares the host key verification enum', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.host_key_verification.enumValues).toEqual([
      'strict',
      'accept-new',
      'disabled',
    ])
  })

  it('renders the private key as a plain field', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.private_key.allowedFormats).toEqual(['plain'])
  })

  it('locks the plain format on free-text string params', () => {
    const params = inputsByName('ssh-session-open')

    for (const name of ['host', 'username', 'password', 'parent_session_id', 'passphrase']) {
      expect(params[name].allowedFormats).toEqual(['plain'])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.host.label).toBe('Host')
    expect(params.port.label).toBe('Port')
    expect(params.username.label).toBe('Username')
    expect(params.password.label).toBe('Password')
    expect(params.private_key.label).toBe('Private Key')
    expect(params.parent_session_id.label).toBe('Parent Session')
    expect(params.passphrase.label).toBe('Passphrase')
    expect(params.host_key_verification.label).toBe('Host Key Verification')
    expect(params.connect_timeout.label).toBe('Connect Timeout')
    expect(params.keep_alive_interval.label).toBe('Keep-Alive Interval')
    expect(params.keep_alive_max_count.label).toBe('Keep-Alive Max Count')
    expect(params.compression.label).toBe('Compression')
  })

  it('gates the Parent Session field behind the chain-through-parent checkbox', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.use_parent.type).toBe('boolean')
    expect(params.use_parent.defaultValue).toBe(false)
    // Parent Session only shows - and is only required - when the box is checked.
    expect(params.parent_session_id.showWhen).toEqual({ field: 'use_parent', values: ['true'] })
    expect(params.parent_session_id.requiredWhen).toEqual({ field: 'use_parent', values: ['true'] })
  })

  it('describes every parameter', () => {
    const inputs = getInputParams('ssh-session-open') ?? []

    expect(inputs).toHaveLength(OPEN_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })
})

describe('ssh-session-open help copy', () => {
  it("names WAVE's trusted hosts list, the Lock and the Disabled default on Host Key Verification (REQ-4.5.14)", () => {
    expect(inputsByName('ssh-session-open').host_key_verification.description).toBe(
      HOST_KEY_VERIFICATION_HELP,
    )
  })

  it('says a relative Private Key path starts at the home folder of the account WAVE runs under (REQ-3.4.3.12)', () => {
    expect(inputsByName('ssh-session-open').private_key.description).toBe(PRIVATE_KEY_HELP)
  })
})

describe('ssh-session-open declared bounds (SSH-9)', () => {
  const BOUNDED_ROWS: [string, InputParam][] = [
    [
      'port',
      {
        name: 'port',
        label: 'Port',
        type: 'integer',
        required: true,
        description: 'SSH port on the target host',
        group: 'Connection',
        defaultValue: 22,
        minimum: 1,
        maximum: 65535,
      },
    ],
    [
      'connect_timeout',
      {
        name: 'connect_timeout',
        label: 'Connect Timeout',
        type: 'integer',
        required: false,
        description: 'Connection timeout in seconds',
        group: 'Advanced',
        defaultValue: 30,
        minimum: 1,
      },
    ],
    [
      'keep_alive_interval',
      {
        name: 'keep_alive_interval',
        label: 'Keep-Alive Interval',
        type: 'integer',
        required: false,
        description:
          'Seconds between keepalive probes; 0 disables keepalive. With keepalive on, a dropped connection flips the Connected output to false',
        group: 'Advanced',
        defaultValue: 0,
        minimum: 0,
      },
    ],
    [
      'keep_alive_max_count',
      {
        name: 'keep_alive_max_count',
        label: 'Keep-Alive Max Count',
        type: 'integer',
        required: false,
        description: 'Consecutive unanswered keepalives before the connection counts as lost',
        group: 'Advanced',
        defaultValue: 3,
        minimum: 1,
      },
    ],
  ]

  const BOUNDED_NAMES = BOUNDED_ROWS.map(([name]) => name)

  it.each(BOUNDED_ROWS)('declares the bounds of %s and keeps the rest of the row', (name, expected) => {
    expect(inputsByName('ssh-session-open')[name]).toEqual(expected)
  })

  it('declares a highest value on Port only', () => {
    const params = inputsByName('ssh-session-open')

    expect(params.port.maximum).toBe(65535)
    for (const name of ['connect_timeout', 'keep_alive_interval', 'keep_alive_max_count']) {
      expect(params[name].maximum, `maximum of ${name}`).toBeUndefined()
    }
  })

  it('leaves every row that holds no number unbounded', () => {
    const others = (getInputParams('ssh-session-open') ?? []).filter(
      (p) => !BOUNDED_NAMES.includes(p.name),
    )

    expect(others).toHaveLength(OPEN_PARAM_ORDER.length - BOUNDED_NAMES.length)
    for (const p of others) {
      expect(p.minimum, `minimum of ${p.name}`).toBeUndefined()
      expect(p.maximum, `maximum of ${p.name}`).toBeUndefined()
      expect(p.maximumField, `maximumField of ${p.name}`).toBeUndefined()
    }
  })

  it.each([
    ['port', 0, 'Port must be between 1 and 65535'],
    ['port', 65536, 'Port must be between 1 and 65535'],
    ['connect_timeout', 0, 'Connect Timeout must be at least 1'],
    ['keep_alive_interval', -1, 'Keep-Alive Interval must be at least 0'],
    ['keep_alive_max_count', 0, 'Keep-Alive Max Count must be at least 1'],
  ])('flags %s = %d with "%s" (PING-17)', (name, value, message) => {
    expect(boundMessage('ssh-session-open', name, value)).toBe(message)
  })

  it.each([
    ['port', 1],
    ['port', 65535],
    ['connect_timeout', 1],
    ['keep_alive_interval', 0],
    ['keep_alive_max_count', 1],
  ])('accepts %s = %d', (name, value) => {
    expect(boundMessage('ssh-session-open', name, value)).toBeNull()
  })
})

describe('ssh-session-open outputs', () => {
  it('declares the four outputs in order', () => {
    const outputs = (getOutputParams('ssh-session-open') ?? []).map((o) => [o.name, o.type])

    expect(outputs).toEqual([
      ['session_id', 'string'],
      ['connected', 'boolean'],
      ['server_banner', 'string'],
      ['hop_count', 'integer'],
    ])
  })

  it('labels the outputs for display', () => {
    const outputs = outputsByName('ssh-session-open')

    expect(outputs.session_id.label).toBe('Session ID')
    expect(outputs.connected.label).toBe('Connected')
    expect(outputs.server_banner.label).toBe('Server Banner')
    expect(outputs.hop_count.label).toBe('Hop Count')
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('ssh-session-open') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })
})

describe('ssh-session-open group metadata', () => {
  it('declares Connection expanded by default with its description', () => {
    const meta = getGroupMeta('ssh-session-open')

    expect(meta).toBeDefined()
    expect(meta!.Connection.defaultExpanded).toBe(true)
    expect(meta!.Connection.description).toBe('Target host and credentials')
  })

  it('declares Advanced collapsed with its description', () => {
    const meta = getGroupMeta('ssh-session-open')

    expect(meta!.Advanced.defaultExpanded).not.toBe(true)
    expect(meta!.Advanced.description).toBe(
      'Host-key policy, timeouts, and session tuning',
    )
  })

  // http-client declares group meta; log declares none.
  it('returns no group meta for plugins that declare none', () => {
    expect(getGroupMeta('log')).toBeUndefined()
  })
})

describe('ssh-session-exec schema', () => {
  it('declares session_id, command, and timeout inputs', () => {
    const names = (getInputParams('ssh-session-exec') ?? []).map((p) => p.name)

    expect(names).toEqual(['session_id', 'command', 'timeout'])
  })

  it('marks session_id and command required', () => {
    const params = inputsByName('ssh-session-exec')

    expect(params.session_id.required).toBe(true)
    expect(params.command.required).toBe(true)
    expect(params.timeout.required).toBe(false)
  })

  it('defaults the timeout to 300 seconds', () => {
    const params = inputsByName('ssh-session-exec')

    expect(params.timeout.type).toBe('integer')
    expect(params.timeout.defaultValue).toBe(300)
  })

  it('declares stdout, stderr, and exit_code outputs with descriptions', () => {
    const outputs = (getOutputParams('ssh-session-exec') ?? [])

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['stdout', 'string'],
      ['stderr', 'string'],
      ['exit_code', 'integer'],
    ])
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('describes every parameter', () => {
    const inputs = getInputParams('ssh-session-exec') ?? []

    expect(inputs).toHaveLength(3)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })
})

describe('ssh-session-script schema', () => {
  it('declares session_id, script, interpreter, working_dir, and timeout inputs', () => {
    const names = (getInputParams('ssh-session-script') ?? []).map((p) => p.name)

    expect(names).toEqual(['session_id', 'script', 'interpreter', 'working_dir', 'timeout'])
  })

  it('marks session_id and script required, the rest optional', () => {
    const params = inputsByName('ssh-session-script')

    expect(params.session_id.required).toBe(true)
    expect(params.script.required).toBe(true)
    expect(params.interpreter.required).toBe(false)
    expect(params.working_dir.required).toBe(false)
    expect(params.timeout.required).toBe(false)
  })

  it('defaults the interpreter to /bin/sh', () => {
    const params = inputsByName('ssh-session-script')

    expect(params.interpreter.type).toBe('string')
    expect(params.interpreter.defaultValue).toBe('/bin/sh')
  })

  it('defaults the timeout to 300 seconds', () => {
    const params = inputsByName('ssh-session-script')

    expect(params.timeout.type).toBe('integer')
    expect(params.timeout.defaultValue).toBe(300)
  })

  it('declares stdout, stderr, and exit_code outputs with descriptions', () => {
    const outputs = getOutputParams('ssh-session-script') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['stdout', 'string'],
      ['stderr', 'string'],
      ['exit_code', 'integer'],
    ])
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('describes every parameter', () => {
    const inputs = getInputParams('ssh-session-script') ?? []

    expect(inputs).toHaveLength(5)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('pins the script body to Plain, the picker offering nothing else (PYRUN-15)', () => {
    expect(inputsByName('ssh-session-script').script.allowedFormats).toEqual(['plain'])
  })

  it('locks no row other than the session and the script body to a format', () => {
    const params = inputsByName('ssh-session-script')

    for (const name of ['interpreter', 'working_dir', 'timeout']) {
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('ssh-session-exec and ssh-session-script Timeout (SSH-9)', () => {
  const RUN_BLOCKS = ['ssh-session-exec', 'ssh-session-script']

  it.each(RUN_BLOCKS)('%s takes its Timeout row from the shared builder', (nodeId) => {
    expect(inputsByName(nodeId).timeout).toEqual(timeoutInput(300, 'Execution timeout in seconds'))
  })

  it.each(RUN_BLOCKS)('%s declares a lowest Timeout of 1 and no highest', (nodeId) => {
    const timeout = inputsByName(nodeId).timeout

    expect(timeout.minimum).toBe(1)
    expect(timeout.maximum).toBeUndefined()
    expect(timeout.maximumField).toBeUndefined()
  })

  it.each(RUN_BLOCKS)('%s flags Timeout = 0 with "Timeout must be at least 1" (PING-17)', (nodeId) => {
    expect(boundMessage(nodeId, 'timeout', 0)).toBe('Timeout must be at least 1')
  })

  it.each(RUN_BLOCKS)('%s accepts Timeout = 1', (nodeId) => {
    expect(boundMessage(nodeId, 'timeout', 1)).toBeNull()
  })

  it.each(RUN_BLOCKS)('%s leaves every row other than Timeout unbounded', (nodeId) => {
    for (const p of (getInputParams(nodeId) ?? []).filter((row) => row.name !== 'timeout')) {
      expect(p.minimum, `minimum of ${p.name}`).toBeUndefined()
      expect(p.maximum, `maximum of ${p.name}`).toBeUndefined()
    }
  })
})

describe('ssh-session-close schema', () => {
  it('declares only the session_id input, required', () => {
    const inputs = getInputParams('ssh-session-close') ?? []

    expect(inputs.map((p) => p.name)).toEqual(['session_id'])
    expect(inputs[0].required).toBe(true)
  })

  it('declares the closed_session_ids output with a description', () => {
    const outputs = getOutputParams('ssh-session-close') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['closed_session_ids', 'array'],
    ])
    expect(outputs[0].description).toBeTruthy()
  })
})

describe('shared session_id definition', () => {
  it('keeps the session_id label identical across the trio', () => {
    const openOutput = outputsByName('ssh-session-open').session_id
    const execInput = inputsByName('ssh-session-exec').session_id
    const closeInput = inputsByName('ssh-session-close').session_id

    expect(openOutput.label).toBe('Session ID')
    expect(execInput.label).toBe('Session ID')
    expect(closeInput.label).toBe('Session ID')
  })

  it('keeps the session_id description identical across the trio', () => {
    const openOutput = outputsByName('ssh-session-open').session_id
    const execInput = inputsByName('ssh-session-exec').session_id
    const closeInput = inputsByName('ssh-session-close').session_id

    expect(openOutput.description).toBeTruthy()
    expect(execInput.description).toBe(openOutput.description)
    expect(closeInput.description).toBe(openOutput.description)
  })

  it('names every SSH block that references the session (SSH-11)', () => {
    expect(outputsByName('ssh-session-open').session_id.description).toBe(
      "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, " +
        "Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it",
    )
  })

  it.each(['ssh-session-exec', 'ssh-session-script', 'ssh-session-close', 'ssh-tunnel-open', 'sftp', 'remote-execution'])(
    'gives %s the same session_id description as Open (SSH-11)',
    (nodeId) => {
      expect(inputsByName(nodeId).session_id.description).toBe(
        outputsByName('ssh-session-open').session_id.description,
      )
    },
  )

  it('reuses the shared session_id definition for ssh-session-script', () => {
    const openOutput = outputsByName('ssh-session-open').session_id
    const scriptInput = inputsByName('ssh-session-script').session_id

    expect(scriptInput.label).toBe('Session ID')
    expect(scriptInput.description).toBe(openOutput.description)
  })
})
