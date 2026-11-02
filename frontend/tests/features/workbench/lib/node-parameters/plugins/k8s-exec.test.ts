/**
 * K8s Exec plugin parameter schema tests (K8SEXEC-1, K8SEXEC-8).
 *
 * Exec runs one command line in one pod and returns stdout, stderr and the exit
 * code. The sheet has a single state: no mode row, no gated row, and no stdin
 * row at all, the command riding the request URL instead. Error and
 * Reason are offered for binding only under Record and continue.
 */

import { describe, it, expect } from 'vitest'
import { Terminal } from 'lucide-react'
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

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

/** The rows the parameter table renders for one set of field values. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-exec') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-exec') ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.group === groupName && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The outputs the binding table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-exec') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-exec') ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const EXEC_PARAM_ORDER = [
  'session',
  'timeout',
  'pod',
  'container',
  'command',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const COMMAND_PARAMS = ['pod', 'container', 'command']

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_PARAMS = ['on_error']

const RECORD_GATE = { field: 'on_error', values: ['record'] }

const REQUIRED_PARAMS = ['session', 'pod', 'container', 'command']

const ENUM_LIST_PARAMS = ['on_error']
const ENUM_LABEL_PARAMS = ['on_error']

// On error gates the two core outputs, so it cannot take an expression.
const NO_EXPRESSION_PARAMS = ['on_error']

// Every row on the sheet shows in every state: nothing here is gated.
const ALWAYS_VISIBLE_PARAMS = EXEC_PARAM_ORDER

// Keys no block in this family declares on any row.
const NEVER_DECLARED_KEYS: (keyof InputParam)[] = [
  'requiredMessage',
  'note',
  'editorNote',
  'placeholder',
  'variableRef',
  'variableRefExistingOnly',
  'selectableType',
  'keyPolicy',
  'credentialCatalog',
  'partsEditor',
  'cipherPicker',
  'lockedWhen',
  'notAbove',
  'clampsSibling',
  'contentTypeAdvisory',
]

const PARAM_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  pod: 'Pod',
  container: 'Container',
  command: 'Command',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  pod: 'string',
  container: 'string',
  command: 'string',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 60,
  pod: undefined,
  container: undefined,
  command: undefined,
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  on_error: 'fail',
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  pod: 'The pod to run the command in.',
  container:
    'Which container in the pod to use. Name it even when the pod has only one.',
  command:
    'One command line. Quotes group arguments the way a shell does, so sh -c "echo hi there" is three arguments.',
  namespace:
    'The namespace the pod is in. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = [
  ['stdout', 'string'],
  ['stderr', 'string'],
  ['exit_code', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  stdout: 'Stdout',
  stderr: 'Stderr',
  exit_code: 'Exit Code',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const EXEC_OUTPUT_DESCRIPTIONS: Record<string, string> = {
  stdout: 'Everything the command wrote to standard output.',
  stderr: 'Everything the command wrote to standard error.',
  exit_code:
    'The exit code the command returned. A non-zero code is returned as data, not treated as a failure.',
}

const CORE_DESCRIPTIONS: Record<string, string> = {
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const GATED_OUTPUTS = ['error', 'reason']

describe('registration', () => {
  it('registers k8s-exec in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-exec']).toBeDefined()
  })

  it('registers k8s-exec in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-exec']).toBeDefined()
  })

  it('registers k8s-exec in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-exec']).toBeDefined()
  })

  it('resolves k8s-exec via hasNodeParams', () => {
    expect(hasNodeParams('k8s-exec')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 9 input params in the pinned order', () => {
    expect((getInputParams('k8s-exec') ?? []).map((p) => p.name)).toEqual(EXEC_PARAM_ORDER)
    expect(getInputParams('k8s-exec') ?? []).toHaveLength(9)
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const names = (getInputParams('k8s-exec') ?? [])
      .filter((p) => p.group === 'Connection')
      .map((p) => p.name)

    expect(names).toEqual(CONNECTION_PARAMS)
  })

  it('assigns the Command group to the verb rows', () => {
    const names = (getInputParams('k8s-exec') ?? [])
      .filter((p) => p.group === 'Command')
      .map((p) => p.name)

    expect(names).toEqual(COMMAND_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const names = (getInputParams('k8s-exec') ?? [])
      .filter((p) => p.group === 'Advanced')
      .map((p) => p.name)

    expect(names).toEqual(ADVANCED_PARAMS)
  })

  it('assigns the Failure Handling group to on_error', () => {
    const names = (getInputParams('k8s-exec') ?? [])
      .filter((p) => p.group === 'Failure Handling')
      .map((p) => p.name)

    expect(names).toEqual(FAILURE_PARAMS)
  })

  it('marks the session, Pod, Container and Command rows required and nothing else', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].required, name).toBe(REQUIRED_PARAMS.includes(name))
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-exec') ?? []

    expect(inputs).toHaveLength(EXEC_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every parameter', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('types every parameter exactly', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('declares the exact default for every parameter', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].defaultValue, name).toBe(PARAM_DEFAULTS[name])
    }
  })

  it('conditions no row on the sheet, every row being always visible', () => {
    const params = inputsByName('k8s-exec')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('declares an enum list and enum labels on On error alone', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      if (ENUM_LIST_PARAMS.includes(name)) {
        expect(params[name].enumValues, name).toBeDefined()
      } else {
        expect(params[name].enumValues, name).toBeUndefined()
      }
      if (ENUM_LABEL_PARAMS.includes(name)) {
        expect(params[name].enumLabels, name).toBeDefined()
      } else {
        expect(params[name].enumLabels, name).toBeUndefined()
      }
    }
  })

  it('leaves every row on the plain ungrouped select', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
      expect(params[name].quickInserts, name).toBeUndefined()
    }
  })

  it('declares none of the keys this family never uses', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(params[name][key], `${name}.${key}`).toBeUndefined()
      }
    }
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-exec').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 60', () => {
    const timeout = inputsByName('k8s-exec').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(60)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('Command group (K8SEXEC-1)', () => {
  it('declares Pod as an always-required string with no gate', () => {
    const pod = inputsByName('k8s-exec').pod

    expect(pod.type).toBe('string')
    expect(pod.required).toBe(true)
    expect(pod.enumValues).toBeUndefined()
    expect(pod.showWhen).toBeUndefined()
  })

  it('declares Container as a required string with nothing to leave empty (K8SEXEC-9)', () => {
    const container = inputsByName('k8s-exec').container

    expect(container.type).toBe('string')
    expect(container.required).toBe(true)
    expect(container.defaultValue).toBeUndefined()
    expect(container.description).toBe(
      'Which container in the pod to use. Name it even when the pod has only one.',
    )
  })

  it('declares Command as one required string, split shell-style', () => {
    const command = inputsByName('k8s-exec').command

    expect(command.type).toBe('string')
    expect(command.required).toBe(true)
    expect(command.description).toBe(
      'One command line. Quotes group arguments the way a shell does, so sh -c "echo hi there" is three arguments.',
    )
  })

  it('declares no stdin row at all', () => {
    const inputs = getInputParams('k8s-exec') ?? []

    expect(inputs).toHaveLength(EXEC_PARAM_ORDER.length)
    expect(inputsByName('k8s-exec').stdin).toBeUndefined()
    expect(inputs.map((p) => p.name)).not.toContain('stdin')
    expect(visibleNames({})).not.toContain('stdin')
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows always visible, in order', () => {
    const params = inputsByName('k8s-exec')

    expect(visibleInGroup('Advanced', {})).toEqual(ADVANCED_PARAMS)
    for (const name of ADVANCED_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('renders Namespace as a plain always-visible optional field', () => {
    const namespace = inputsByName('k8s-exec').namespace

    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toBeUndefined()
    expect(namespace.retainOnHide).not.toBe(true)
    expect(namespace.description).toBe(
      'The namespace the pod is in. Leave empty to use the namespace the session carries.',
    )
    expect((getInputParams('k8s-exec') ?? []).map((p) => p.name)).not.toContain(
      'specify_namespace',
    )
  })

  it('carries the exact impersonation copy for a block that changes something', () => {
    const params = inputsByName('k8s-exec')

    expect(params.impersonate_user.description).toBe(
      "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
    )
    expect(params.impersonate_groups.description).toBe(
      'Send these group memberships with the impersonated user, comma separated.',
    )
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-exec').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.showWhen).toBeUndefined()
    expect(onError.noExpression).toBe(true)
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on the On error row', () => {
    const structural = (getInputParams('k8s-exec') ?? []).filter((p) =>
      NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(structural).toHaveLength(1)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('leaves every other row expression-capable', () => {
    const expressive = (getInputParams('k8s-exec') ?? []).filter(
      (p) => !NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(expressive).toHaveLength(8)
    for (const param of expressive) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains no row, the sheet having nothing to hide', () => {
    const inputs = getInputParams('k8s-exec') ?? []

    expect(inputs).toHaveLength(EXEC_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-exec').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    const params = inputsByName('k8s-exec')

    for (const name of EXEC_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-exec')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(['Connection', 'Command', 'Advanced', 'Failure Handling'])
    for (const group of ['Connection', 'Command']) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-exec')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Command footer', () => {
    expect(getGroupMeta('k8s-exec')!.Command.description).toBe(
      'The pod and the command line to run in it',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-exec')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-exec')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state (K8SEXEC-1)', () => {
  it('shows every row on open', () => {
    expect(visibleNames({})).toEqual(EXEC_PARAM_ORDER)
  })

  it('shows the same rows under Record and continue', () => {
    expect(visibleNames({ on_error: 'record' })).toEqual(EXEC_PARAM_ORDER)
  })

  it('keeps the whole Command group visible in every state', () => {
    expect(visibleInGroup('Command', {})).toEqual(COMMAND_PARAMS)
    expect(visibleInGroup('Command', { on_error: 'record' })).toEqual(COMMAND_PARAMS)
  })
})

describe('outputs', () => {
  it('declares the six outputs in order', () => {
    const outputs = getOutputParams('k8s-exec') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(6)
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-exec')

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(outputs[name].label, name).toBe(label)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-exec') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact copy on the three command outputs', () => {
    const outputs = outputsByName('k8s-exec')

    for (const [name, description] of Object.entries(EXEC_OUTPUT_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('carries the exact copy on the three core outputs', () => {
    const outputs = outputsByName('k8s-exec')

    for (const [name, description] of Object.entries(CORE_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-exec') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('varies no output type with the sheet state', () => {
    const outputs = getOutputParams('k8s-exec') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating', () => {
  it('offers Error and Reason only under Record and continue', () => {
    const outputs = outputsByName('k8s-exec')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('keeps Success visible in both On error modes', () => {
    expect(outputsByName('k8s-exec').success.showWhen).toBeUndefined()
  })

  it('gates Error and Reason and no other output', () => {
    const gated = (getOutputParams('k8s-exec') ?? [])
      .filter((o) => o.showWhen !== undefined)
      .map((o) => o.name)

    expect(gated).toEqual(GATED_OUTPUTS)
  })

  it('offers four outputs while On error is Fail the block', () => {
    expect(visibleOutputs({})).toEqual(['stdout', 'stderr', 'exit_code', 'success'])
  })

  it('offers all six outputs under Record and continue', () => {
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'stdout',
      'stderr',
      'exit_code',
      'success',
      'error',
      'reason',
    ])
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Exec palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-exec')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Exec')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Terminal')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-exec')?.remotable).toBe(true)
  })

  it('registers Terminal in the palette icon registry', () => {
    expect(isValidIconName('Terminal')).toBe(true)
  })

  it('registers all three canvas maps for k8s-exec', () => {
    expect(getIcon('k8s-exec')).toBe(Terminal)
    expect(getIconName('k8s-exec')).toBe('terminal')
    expect(getColorClass('k8s-exec')).toBe('text-sky-500')
  })
})
