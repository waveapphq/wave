/**
 * K8s Logs plugin parameter schema tests (K8SREAD-8, K8SREAD-9, K8SREAD-10,
 * K8SREAD-20).
 *
 * Logs has no mode. Output Format is two rows sharing one wire name and the
 * same stored values, one per Timestamps state, so exactly one of them is on
 * the sheet at any time and every other row is always there. Only the per-line
 * label and the description change. Timestamps therefore loses its expression
 * toggle while Previous Instance keeps one. The block still carries no All
 * namespaces (kubectl logs has no such flag), and Error and Reason are offered
 * only under Record and continue.
 */

import { describe, it, expect } from 'vitest'
import { Logs } from 'lucide-react'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import { resolveOutputType } from '@/features/workbench/lib/node-parameters/output-type'
import type { OutputTypeRule } from '@/features/workbench/lib/node-parameters/types'
import {
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import { isValidIconName } from '@/features/workbench/lib/icon-registry'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const inputs = () => getInputParams('k8s-logs') ?? []

/** The two opt-in enum keys on the shared enum control. */
type PickerParam = InputParam & {
  enumGroups?: { heading: string; values: string[] }[]
  enumSearchable?: boolean
}

function inputsByName(): Record<string, PickerParam> {
  return Object.fromEntries(inputs().map((p) => [p.name, p]))
}

/** Every descriptor under one wire name, in declaration order. A by-name map
 *  collapses the Output Format pair and silently returns only the second. */
function inputsNamed(name: string): InputParam[] {
  return inputs().filter((p) => p.name === name)
}

function outputsByName(): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams('k8s-logs') ?? []).map((o) => [o.name, o]))
}

function visibleNames(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return all
    .filter((p) => p.group === groupName && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The descriptors under one wire name that the sheet actually renders. */
function visibleNamed(name: string, values: Record<string, unknown>): InputParam[] {
  const all = inputs() as unknown as Parameter[]
  return inputsNamed(name).filter((p) => isParameterVisible(p as unknown as Parameter, values, all))
}

function visibleOutputs(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return (getOutputParams('k8s-logs') ?? [])
    .filter((o) => !o.showWhen || matchesCondition(o.showWhen, values, all))
    .map((o) => o.name)
}

const LOGS_PARAM_ORDER = [
  'session',
  'timeout',
  'pod',
  'container',
  'previous',
  'tail_lines',
  'since_seconds',
  'timestamps',
  'output_format',
  'output_format',
  'max_bytes',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

// Exactly one Output Format row is on the sheet in any state, so every wire
// name the block declares is always visible.
const LOGS_WIRE_NAMES = [
  'session',
  'timeout',
  'pod',
  'container',
  'previous',
  'tail_lines',
  'since_seconds',
  'timestamps',
  'output_format',
  'max_bytes',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const LOG_GROUP_PARAMS = [
  'pod',
  'container',
  'previous',
  'tail_lines',
  'since_seconds',
  'timestamps',
  'output_format',
  'output_format',
  'max_bytes',
]

const LOG_GROUP_VISIBLE = [
  'pod',
  'container',
  'previous',
  'tail_lines',
  'since_seconds',
  'timestamps',
  'output_format',
  'max_bytes',
]

const REQUIRED_PARAMS = ['session', 'pod', 'container']

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_HANDLING_PARAMS = ['on_error']

const TIMESTAMPS_OFF = { field: 'timestamps', values: ['false'] }
const TIMESTAMPS_ON = { field: 'timestamps', values: ['true'] }

// One stored value list for both rows: Timestamps renames the per-line option,
// so a saved choice can never be one the visible row does not offer.
const OUTPUT_FORMAT_VALUES = ['string', 'array']
const OUTPUT_FORMAT_LABELS_OFF = { string: 'String', array: 'Array' }
const OUTPUT_FORMAT_LABELS_ON = { string: 'String', array: 'Table' }
const OUTPUT_FORMAT_DESCRIPTION_OFF =
  'How the log comes back. String is the text as the container wrote it, Array one entry per line.'
const OUTPUT_FORMAT_DESCRIPTION_ON =
  'How the log comes back. String is the text as the container wrote it, Table one row per line, with the time and the message in separate columns.'

// Every enum drops the toggle, and a Boolean drops it when it gates another row.
const NO_EXPRESSION_PARAMS = ['timestamps', 'output_format', 'on_error']

const BOOLEAN_PARAMS = ['previous', 'timestamps']

const ENUM_PARAMS = ['output_format', 'on_error']

const RECORD_GATE = { field: 'on_error', values: ['record'] }

const GATED_OUTPUTS = ['error', 'reason']

const CORE_DESCRIPTIONS = {
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error: 'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const LOGS_DESCRIPTION =
  'The log, cut to Tail Lines, Since and Max Bytes. Its type follows Output Format: text for String, one entry per line for Array, a row per line for Table.'

const LOGS_TYPE_WHEN: OutputTypeRule[] = [
  {
    when: [
      { field: 'output_format', values: ['array'] },
      { field: 'timestamps', values: ['true'] },
    ],
    type: 'table',
  },
  { when: [{ field: 'output_format', values: ['array'] }], type: 'array' },
]

const PARAM_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  pod: 'Pod',
  container: 'Container',
  previous: 'Previous Instance',
  tail_lines: 'Tail Lines',
  since_seconds: 'Since (s)',
  timestamps: 'Timestamps',
  output_format: 'Output Format',
  max_bytes: 'Max Bytes',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

// The two Output Format rows name the per-line option differently, so their
// strings cannot ride a by-name table; they are pinned in its own describe.
const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  pod: 'The pod to read from. One pod per block; there is no label selector.',
  container: 'Which container in the pod to use. Name it even when the pod has only one.',
  previous:
    'Read the previous, terminated instance of the container instead of the running one. Fails when the container has not restarted.',
  tail_lines:
    'How many lines to return, counting back from the end. Leave empty for the whole log.',
  since_seconds: 'How far back to read, in seconds. Leave empty for the whole log.',
  timestamps: 'Prefix every line with the time the container wrote it.',
  max_bytes: 'Stop reading after this many bytes. Anything past that is cut off.',
  namespace:
    'The namespace the pod is in. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to read.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

describe('registration', () => {
  it('registers k8s-logs in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-logs']).toBeDefined()
  })

  it('registers k8s-logs in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-logs']).toBeDefined()
  })

  it('registers k8s-logs in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-logs']).toBeDefined()
  })

  it('resolves k8s-logs via hasNodeParams', () => {
    expect(hasNodeParams('k8s-logs')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 15 input rows on 14 wire names, in the pinned order', () => {
    expect(inputs().map((p) => p.name)).toEqual(LOGS_PARAM_ORDER)
    expect(inputs()).toHaveLength(15)
    expect([...new Set(inputs().map((p) => p.name))]).toEqual(LOGS_WIRE_NAMES)
  })

  it('assigns the Connection group to session and timeout', () => {
    const params = inputsByName()

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Logs group to the log-reading params', () => {
    const logRows = inputs().filter((p) => LOG_GROUP_PARAMS.includes(p.name))

    expect(logRows).toHaveLength(LOG_GROUP_PARAMS.length)
    for (const param of logRows) {
      expect(param.group, param.name).toBe('Logs')
    }
  })

  it('assigns the Advanced group to the namespace and impersonation params', () => {
    const params = inputsByName()

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName()

    for (const name of FAILURE_HANDLING_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('marks only session, pod and container required (K8SREAD-20)', () => {
    for (const param of inputs()) {
      expect(param.required, param.name).toBe(REQUIRED_PARAMS.includes(param.name))
    }
  })

  it('labels every parameter for display', () => {
    for (const param of inputs()) {
      expect(param.label, param.name).toBe(PARAM_LABELS[param.name])
    }
  })

  it('carries the exact info-badge description on every row but the Output Format pair', () => {
    expect(inputs()).toHaveLength(LOGS_PARAM_ORDER.length)
    for (const param of inputs()) {
      if (param.name === 'output_format') continue
      expect(param.description, param.name).toBe(PARAM_DESCRIPTIONS[param.name])
    }
  })

  it('declares the type of every parameter', () => {
    const types: Record<string, string> = {
      session: 'string',
      timeout: 'integer',
      pod: 'string',
      container: 'string',
      previous: 'boolean',
      tail_lines: 'integer',
      since_seconds: 'integer',
      timestamps: 'boolean',
      output_format: 'string',
      max_bytes: 'integer',
      namespace: 'string',
      impersonate_user: 'string',
      impersonate_groups: 'string',
      on_error: 'string',
    }

    for (const param of inputs()) {
      expect(param.type, param.name).toBe(types[param.name])
    }
  })

  it('defaults timeout, the two booleans, Output Format and on_error, and nothing else', () => {
    const defaults: Record<string, unknown> = {
      timeout: 30,
      previous: false,
      timestamps: false,
      output_format: 'string',
      on_error: 'fail',
    }

    for (const param of inputs()) {
      expect(param.defaultValue, param.name).toBe(defaults[param.name])
    }
  })
})

describe('Connection group', () => {
  it('declares session as a required plain-locked secret string', () => {
    const session = inputsByName().session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.noExpression).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName().timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.required).toBe(false)
    expect(timeout.defaultValue).toBe(30)
  })
})

describe('Logs group', () => {
  it('requires pod outright, with no conditional rule', () => {
    const pod = inputsByName().pod

    expect(pod.type).toBe('string')
    expect(pod.required).toBe(true)
    expect(pod.showWhen).toBeUndefined()
    expect(pod.requiredWhen).toBeUndefined()
    expect(pod.requiredWhenAll).toBeUndefined()
  })

  it('requires container with nothing to leave empty, always on the sheet (K8SREAD-20)', () => {
    const container = inputsByName().container

    expect(container.type).toBe('string')
    expect(container.required).toBe(true)
    expect(container.defaultValue).toBeUndefined()
    expect(container.description).toBe(
      'Which container in the pod to use. Name it even when the pod has only one.',
    )
    expect(container.showWhen).toBeUndefined()
    expect(container.showWhenAll).toBeUndefined()
    expect(container.requiredWhen).toBeUndefined()
  })

  it('declares previous and timestamps as booleans defaulting to false', () => {
    const params = inputsByName()

    for (const name of BOOLEAN_PARAMS) {
      expect(params[name].type, name).toBe('boolean')
      expect(params[name].defaultValue, name).toBe(false)
      expect(params[name].required, name).toBe(false)
    }
  })

  it('declares the three limit rows as optional integers with no default', () => {
    const params = inputsByName()

    for (const name of ['tail_lines', 'since_seconds', 'max_bytes']) {
      expect(params[name].type, name).toBe('integer')
      expect(params[name].required, name).toBe(false)
      expect(params[name].defaultValue, name).toBeUndefined()
    }
  })
})

describe('Output Format', () => {
  it('declares two rows on one wire name, between Timestamps and Max Bytes', () => {
    const names = inputs().map((p) => p.name)
    const rows = inputsNamed('output_format')

    expect(names.slice(names.indexOf('timestamps'), names.indexOf('max_bytes') + 1)).toEqual([
      'timestamps',
      'output_format',
      'output_format',
      'max_bytes',
    ])
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.label).toBe('Output Format')
      expect(row.group).toBe('Logs')
      expect(row.type).toBe('string')
      expect(row.required).toBe(false)
      expect(row.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
      expect(row.defaultValue).toBe('string')
      expect(row.noExpression).toBe(true)
      expect(row.retainOnHide).toBeUndefined()
    }
  })

  it('carries the same stored values on both rows, so no saved choice can go missing', () => {
    const rows = inputsNamed('output_format')

    expect(rows.map((row) => row.enumValues)).toEqual([
      OUTPUT_FORMAT_VALUES,
      OUTPUT_FORMAT_VALUES,
    ])
  })

  it('names the per-line option Array while the Timestamps tick is off', () => {
    const rows = inputsNamed('output_format')

    expect(rows).toHaveLength(2)

    const [stringOrArray] = rows

    expect(stringOrArray.showWhen).toEqual(TIMESTAMPS_OFF)
    expect(stringOrArray.showWhenAll).toBeUndefined()
    expect(stringOrArray.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
    expect(stringOrArray.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_OFF)
    expect(stringOrArray.description).toBe(OUTPUT_FORMAT_DESCRIPTION_OFF)
  })

  it('names the same option Table while the Timestamps tick is on', () => {
    const rows = inputsNamed('output_format')

    expect(rows).toHaveLength(2)

    const [, stringOrTable] = rows

    expect(stringOrTable.showWhen).toEqual(TIMESTAMPS_ON)
    expect(stringOrTable.showWhenAll).toBeUndefined()
    expect(stringOrTable.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
    expect(stringOrTable.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_ON)
    expect(stringOrTable.description).toBe(OUTPUT_FORMAT_DESCRIPTION_ON)
  })
})

describe('Advanced group', () => {
  it('offers namespace unconditionally, so nothing is ever retained', () => {
    const namespace = inputsByName().namespace

    expect(namespace.type).toBe('string')
    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toBeUndefined()
    expect(namespace.showWhenAll).toBeUndefined()
    expect(namespace.retainOnHide).not.toBe(true)
  })

  it('keeps the two impersonation rows always visible at the foot of the group', () => {
    const params = inputsByName()

    for (const name of ['impersonate_user', 'impersonate_groups']) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as a fail | record enum defaulting to fail', () => {
    const onError = inputsByName().on_error

    expect(onError.type).toBe('string')
    expect(onError.required).toBe(false)
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
  })

  it('declares Output Format and on_error as the only enums on the block', () => {
    expect(inputs().filter((p) => ENUM_PARAMS.includes(p.name)), 'enum rows').toHaveLength(3)

    for (const param of inputs()) {
      if (ENUM_PARAMS.includes(param.name)) {
        expect(param.enumValues, param.name).toBeDefined()
        expect(param.enumLabels, param.name).toBeDefined()
        continue
      }
      expect(param.enumValues, param.name).toBeUndefined()
      expect(param.enumLabels, param.name).toBeUndefined()
    }
  })

  it('opts no row into grouping, search or sublabels - only Get carries them', () => {
    for (const param of inputs()) {
      expect(param.enumGroups, param.name).toBeUndefined()
      expect(param.enumSearchable, param.name).toBeUndefined()
      expect(param.enumSublabels, param.name).toBeUndefined()
    }
  })
})

describe('conditional rules', () => {
  it('gates the two Output Format rows and no other row', () => {
    expect(inputsNamed('output_format'), 'gated Output Format rows').toHaveLength(2)

    for (const param of inputs()) {
      if (param.name === 'output_format') {
        expect(param.showWhen, `showWhen of ${param.name}`).toBeDefined()
        expect(param.showWhenAll, `showWhenAll of ${param.name}`).toBeUndefined()
        continue
      }
      expect(param.showWhen, `showWhen of ${param.name}`).toBeUndefined()
      expect(param.showWhenAll, `showWhenAll of ${param.name}`).toBeUndefined()
    }
  })

  it('carries no conditional required rule anywhere', () => {
    for (const param of inputs()) {
      expect(param.requiredWhen, `requiredWhen of ${param.name}`).toBeUndefined()
      expect(param.requiredWhenAll, `requiredWhenAll of ${param.name}`).toBeUndefined()
    }
  })

  it('retains no value anywhere, so a hidden Output Format row cannot strip the shared value at save', () => {
    for (const param of inputs()) {
      expect(param.retainOnHide, `retainOnHide of ${param.name}`).not.toBe(true)
    }
  })
})

describe('expression toggles', () => {
  it('drops the toggle on the structural rows', () => {
    const structural = inputs().filter((p) => NO_EXPRESSION_PARAMS.includes(p.name))

    expect(structural).toHaveLength(4)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('keeps the toggle on previous, which only changes what the request asks for', () => {
    expect(inputsByName().previous.noExpression).toBeUndefined()
  })

  it('keeps the toggle on every row that is not structural', () => {
    for (const param of inputs()) {
      if (NO_EXPRESSION_PARAMS.includes(param.name)) continue
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName().session.secret).toBe(true)
  })

  it('does not flag any other param secret', () => {
    for (const param of inputs()) {
      if (param.name === 'session') continue
      expect(param.secret, param.name).not.toBe(true)
    }
  })

  it('locks no parameter other than session to a value format', () => {
    for (const param of inputs()) {
      if (param.name === 'session') continue
      expect(param.allowedFormats, param.name).toBeUndefined()
    }
  })
})

describe('rows this block deliberately does not have', () => {
  it('declares no all_namespaces - kubectl logs has no such flag', () => {
    expect(inputs().map((p) => p.name)).not.toContain('all_namespaces')
    expect(inputsByName().all_namespaces).toBeUndefined()
  })

  it('declares no since_time, so the sinceTime / sinceSeconds conflict cannot be expressed', () => {
    expect(inputs().map((p) => p.name)).not.toContain('since_time')
    expect(inputsByName().since_time).toBeUndefined()
  })
})

describe('state-to-UI', () => {
  it('names the per-line option Array on the visible sheet while the Timestamps tick is off', () => {
    const states: Record<string, unknown>[] = [{}, { timestamps: false }]

    for (const values of states) {
      const state = JSON.stringify(values)

      expect(visibleNames(values), state).toEqual(LOGS_WIRE_NAMES)
      expect(visibleInGroup('Connection', values), state).toEqual(CONNECTION_PARAMS)
      expect(visibleInGroup('Logs', values), state).toEqual(LOG_GROUP_VISIBLE)
      expect(visibleInGroup('Advanced', values), state).toEqual(ADVANCED_PARAMS)
      expect(visibleInGroup('Failure Handling', values), state).toEqual(FAILURE_HANDLING_PARAMS)

      const offered = visibleNamed('output_format', values)

      expect(offered, state).toHaveLength(1)
      expect(offered[0].enumValues, state).toEqual(OUTPUT_FORMAT_VALUES)
      expect(offered[0].enumLabels, state).toEqual(OUTPUT_FORMAT_LABELS_OFF)
    }
  })

  it('swaps in the row that calls the same option Table when the Timestamps tick is on', () => {
    const values = { timestamps: true }

    expect(visibleNames(values)).toEqual(LOGS_WIRE_NAMES)
    expect(visibleInGroup('Logs', values)).toEqual(LOG_GROUP_VISIBLE)

    const offered = visibleNamed('output_format', values)

    expect(offered).toHaveLength(1)
    expect(offered[0].enumValues).toEqual(OUTPUT_FORMAT_VALUES)
    expect(offered[0].enumLabels).toEqual(OUTPUT_FORMAT_LABELS_ON)
  })

  it('keeps a stored per-line choice on the visible row in either Timestamps state', () => {
    for (const timestamps of [false, true]) {
      const offered = visibleNamed('output_format', { timestamps, output_format: 'array' })

      expect(offered, String(timestamps)).toHaveLength(1)
      expect(offered[0].enumValues, String(timestamps)).toContain('array')
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed (K8SREAD-8)', () => {
    const meta = getGroupMeta('k8s-logs')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual([
      'Connection',
      'Logs',
      'Advanced',
      'Failure Handling',
    ])
    for (const groupName of ['Connection', 'Logs']) {
      expect(meta![groupName].defaultExpanded, `${groupName} expanded`).toBe(true)
    }
    for (const groupName of ['Advanced', 'Failure Handling']) {
      expect(meta![groupName].defaultExpanded, `${groupName} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-logs')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Logs footer', () => {
    expect(getGroupMeta('k8s-logs')!.Logs.description).toBe(
      'Which pod and container to read, and how much of the log to bring back',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-logs')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer (K8SREAD-10)', () => {
    expect(getGroupMeta('k8s-logs')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('outputs', () => {
  it('declares logs then the uniform core, gating the two failure rows (K8SREAD-9)', () => {
    const outputs = getOutputParams('k8s-logs') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['logs', 'string'],
      ['success', 'boolean'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
    for (const output of outputs) {
      if (GATED_OUTPUTS.includes(output.name)) {
        expect(output.showWhen, `showWhen of ${output.name}`).toEqual(RECORD_GATE)
        continue
      }
      expect(output.showWhen, `showWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('offers two rows on Fail the block and four on Record and continue', () => {
    expect(visibleOutputs({})).toEqual(['logs', 'success'])
    expect(visibleOutputs({ on_error: 'fail' })).toEqual(['logs', 'success'])
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'logs',
      'success',
      'error',
      'reason',
    ])
  })

  it('labels every output for display', () => {
    const outputs = outputsByName()

    expect(outputs.logs.label).toBe('Logs')
    expect(outputs.success.label).toBe('Success')
    expect(outputs.error.label).toBe('Error')
    expect(outputs.reason.label).toBe('Reason')
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-logs') ?? []

    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).toBeUndefined()
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-logs') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the shared core wording on the three uniform outputs', () => {
    const outputs = outputsByName()

    expect(outputs.success.description).toBe(CORE_DESCRIPTIONS.success)
    expect(outputs.error.description).toBe(CORE_DESCRIPTIONS.error)
    expect(outputs.reason.description).toBe(CORE_DESCRIPTIONS.reason)
  })

  it('describes Logs as a value whose shape follows Output Format', () => {
    expect(outputsByName().logs.description).toBe(LOGS_DESCRIPTION)
  })

  it('follows Output Format on logs and fixes every other declared type', () => {
    expect(outputsByName().logs.typeWhen).toEqual(LOGS_TYPE_WHEN)
    for (const output of getOutputParams('k8s-logs') ?? []) {
      if (output.name === 'logs') continue
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe("Logs' declared type follows Output Format and Timestamps", () => {
  it('resolves to the static string type on a fresh block', () => {
    const logs = outputsByName().logs

    expect(resolveOutputType(logs.type, logs.typeWhen, {}, inputs())).toBe('string')
  })

  it('resolves every Output Format and Timestamps pairing', () => {
    const logs = outputsByName().logs
    const matrix: [string, boolean, string][] = [
      ['string', false, 'string'],
      ['string', true, 'string'],
      ['array', false, 'array'],
      ['array', true, 'table'],
    ]

    for (const [format, timestamps, expected] of matrix) {
      expect(
        resolveOutputType(logs.type, logs.typeWhen, {
          output_format: format,
          timestamps,
        }),
        `${format} + ${timestamps}`,
      ).toBe(expected)
    }
  })

  it('reads Array as an array while Timestamps is left at its default', () => {
    const logs = outputsByName().logs

    expect(
      resolveOutputType(logs.type, logs.typeWhen, { output_format: 'array' }, inputs()),
    ).toBe('array')
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Logs palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-logs')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Logs')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Logs')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-logs')?.remotable).toBe(true)
  })

  it('keeps Logs registered in the palette icon registry', () => {
    expect(isValidIconName('Logs')).toBe(true)
  })

  it('registers all three canvas maps for k8s-logs', () => {
    expect(getIcon('k8s-logs')).toBe(Logs)
    expect(getIconName('k8s-logs')).toBe('logs')
    expect(getColorClass('k8s-logs')).toBe('text-sky-500')
  })
})
