/**
 * K8s Rollout plugin parameter schema tests (K8SWRITE-7).
 *
 * Rollout drives one workload through the three rollout operations the block
 * surfaces - Restart, Status and Undo (K8SWRITE-7). Operation is the only row
 * that reveals another: To revision belongs to Undo alone. This file pins the
 * ten rows, the four groups, the five outputs, and the two independent output
 * gates that hide Status outside Status and Error and Reason outside Record
 * and continue.
 */

import { describe, it, expect } from 'vitest'
import { RefreshCw } from 'lucide-react'
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
  const all = (getInputParams('k8s-rollout') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-rollout') ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.group === groupName && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The outputs the binding table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-rollout') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-rollout') ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const ROLLOUT_PARAM_ORDER = [
  'session',
  'timeout',
  'operation',
  'kind',
  'name',
  'to_revision',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const ROLLOUT_PARAMS = ['operation', 'kind', 'name', 'to_revision']

const ROLLOUT_PARAMS_WITHOUT_REVISION = ['operation', 'kind', 'name']

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_PARAMS = ['on_error']

const GROUP_ORDER = ['Connection', 'Rollout', 'Advanced', 'Failure Handling']

const EXPANDED_GROUPS = ['Connection', 'Rollout']

const COLLAPSED_GROUPS = ['Advanced', 'Failure Handling']

const OPERATION_UNDO = { field: 'operation', values: ['undo'] }
const OPERATION_STATUS = { field: 'operation', values: ['status'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const OPERATION_VALUES = ['restart', 'status', 'undo']
const OPERATION_LABELS = { restart: 'Restart', status: 'Status', undo: 'Undo' }

// The three kinds that have a rollout; the value is its own display text.
const KIND_VALUES = ['Deployment', 'StatefulSet', 'DaemonSet']

const ON_ERROR_VALUES = ['fail', 'record']
const ON_ERROR_LABELS = { fail: 'Fail the block', record: 'Record and continue' }

const REQUIRED_PARAMS = ['session', 'kind', 'name']

const ENUM_LIST_PARAMS = ['operation', 'kind', 'on_error']
const ENUM_LABEL_PARAMS = ['operation', 'on_error']

// A row that gates another row, and the failure switch, cannot take an
// expression; Kind gates nothing and is a plain data value.
const NO_EXPRESSION_PARAMS = ['operation', 'on_error']

const RETAIN_ON_HIDE_PARAMS = ['to_revision']

const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'operation',
  'kind',
  'name',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

/** Keys no block in this family declares on any row. */
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
  operation: 'Operation',
  kind: 'Kind',
  name: 'Name',
  to_revision: 'To revision',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  operation: 'string',
  kind: 'string',
  name: 'string',
  to_revision: 'integer',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 30,
  operation: 'restart',
  kind: 'Deployment',
  name: undefined,
  to_revision: undefined,
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  on_error: 'fail',
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  operation:
    'Restart replaces the pods with fresh ones. Status reports how the current rollout is going. Undo rolls the workload back to an earlier revision.',
  kind: 'The three kinds that have a rollout. Anything else has no rollout to restart or report on.',
  name: "The object's name.",
  to_revision: 'The revision to roll back to. Leave empty to go back to the previous one.',
  namespace:
    'Leave empty to use the namespace the session carries. Otherwise, the namespace the workload is in.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  Connection: 'K8s Session and request timeout',
  Rollout: 'Which workload to restart, report on or roll back',
  Advanced:
    'Namespace and identity for this block only, in place of what the session provides',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

// The nine rows every operation shows; Undo adds To revision after Name.
const RESTART_ROWS = [
  'session',
  'timeout',
  'operation',
  'kind',
  'name',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const OUTPUT_ORDER = [
  ['summary', 'table'],
  ['status', 'string'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  status: 'Status',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  summary:
    "One row per object: the resource, what happened to it, and the cluster's own sentence about the rollout.",
  status:
    'The rollout verdict: complete, progressing or failed. Use it to drive a Wait Until control.',
}

const CORE_DESCRIPTIONS: Record<string, string> = {
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error: 'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

/** Each gated output and the field its gate reads. */
const GATED_OUTPUT_FIELDS = {
  status: 'operation',
  error: 'on_error',
  reason: 'on_error',
}

const RESTART_OUTPUTS = ['summary', 'success']
const STATUS_OUTPUTS = ['summary', 'status', 'success']
const RECORD_RESTART_OUTPUTS = ['summary', 'success', 'error', 'reason']
const RECORD_STATUS_OUTPUTS = ['summary', 'status', 'success', 'error', 'reason']

describe('registration', () => {
  it('registers k8s-rollout in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-rollout']).toBeDefined()
  })

  it('registers k8s-rollout in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-rollout']).toBeDefined()
  })

  it('registers k8s-rollout in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-rollout']).toBeDefined()
  })

  it('resolves k8s-rollout via hasNodeParams', () => {
    expect(hasNodeParams('k8s-rollout')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 10 input params in the pinned order', () => {
    expect((getInputParams('k8s-rollout') ?? []).map((p) => p.name)).toEqual(ROLLOUT_PARAM_ORDER)
    expect(getInputParams('k8s-rollout') ?? []).toHaveLength(10)
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const inGroup = (getInputParams('k8s-rollout') ?? []).filter((p) => p.group === 'Connection')

    expect(inGroup.map((p) => p.name)).toEqual(CONNECTION_PARAMS)
  })

  it('assigns the Rollout group to the verb rows', () => {
    const inGroup = (getInputParams('k8s-rollout') ?? []).filter((p) => p.group === 'Rollout')

    expect(inGroup.map((p) => p.name)).toEqual(ROLLOUT_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const inGroup = (getInputParams('k8s-rollout') ?? []).filter((p) => p.group === 'Advanced')

    expect(inGroup.map((p) => p.name)).toEqual(ADVANCED_PARAMS)
  })

  it('assigns the Failure Handling group to on_error', () => {
    const inGroup = (getInputParams('k8s-rollout') ?? []).filter(
      (p) => p.group === 'Failure Handling',
    )

    expect(inGroup.map((p) => p.name)).toEqual(FAILURE_PARAMS)
  })

  it('requires the session, Kind and Name rows and nothing else', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].required, name).toBe(REQUIRED_PARAMS.includes(name))
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-rollout') ?? []

    expect(inputs).toHaveLength(ROLLOUT_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every parameter', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('types every parameter exactly', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('declares the exact default for every parameter', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].defaultValue, name).toBe(PARAM_DEFAULTS[name])
    }
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('uses no conjunctive gate at all, every gate being single', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('requires no row conditionally, the required rows being required outright', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('declares an enum list on three rows and enum labels on two of them', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
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

  it('declares none of the keys this family never uses', () => {
    const inputs = getInputParams('k8s-rollout') ?? []

    expect(inputs).toHaveLength(ROLLOUT_PARAM_ORDER.length)
    for (const param of inputs) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(param[key], `${param.name}.${key}`).toBeUndefined()
      }
    }
  })

  it('offers Kind as one fixed list, with no Resource Type row and no custom Kind row', () => {
    const names = (getInputParams('k8s-rollout') ?? []).map((p) => p.name)

    expect(names).toContain('kind')
    expect(names).not.toContain('resource_type')
    expect(names).not.toContain('kind_custom')
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-rollout').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-rollout').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('Rollout group (K8SWRITE-7)', () => {
  it('declares operation as the three-way Restart/Status/Undo enum defaulting to Restart', () => {
    const operation = inputsByName('k8s-rollout').operation

    expect(operation.type).toBe('string')
    expect(operation.enumValues).toEqual(OPERATION_VALUES)
    expect(operation.enumLabels).toEqual(OPERATION_LABELS)
    expect(operation.defaultValue).toBe('restart')
    expect(operation.required).toBe(false)
    expect(operation.showWhen).toBeUndefined()
  })

  it('offers only the three kinds that have a rollout, defaulting to Deployment', () => {
    const kind = inputsByName('k8s-rollout').kind

    expect(kind.type).toBe('string')
    expect(kind.enumValues).toEqual(KIND_VALUES)
    expect(kind.enumValues).toHaveLength(3)
    expect(kind.defaultValue).toBe('Deployment')
    expect(kind.required).toBe(true)
    expect(kind.showWhen).toBeUndefined()
  })

  it('shows each kind by its own name, off the searchable picker', () => {
    const kind = inputsByName('k8s-rollout').kind

    expect(kind.enumLabels).toBeUndefined()
    expect(kind.enumGroups).toBeUndefined()
    expect(kind.enumSublabels).toBeUndefined()
    expect(kind.enumSearchable).toBeUndefined()
  })

  it('requires Name in every operation, with no gate on it', () => {
    const name = inputsByName('k8s-rollout').name

    expect(name.type).toBe('string')
    expect(name.required).toBe(true)
    expect(name.defaultValue).toBeUndefined()
    expect(name.showWhen).toBeUndefined()
    expect(name.showWhenAll).toBeUndefined()
  })

  it('leaves every row on the plain ungrouped select', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
    }
  })

  it('shows To revision only in Undo, and leaves it optional there', () => {
    const toRevision = inputsByName('k8s-rollout').to_revision

    expect(toRevision.type).toBe('integer')
    expect(toRevision.required).toBe(false)
    expect(toRevision.defaultValue).toBeUndefined()
    expect(toRevision.showWhen).toEqual(OPERATION_UNDO)
    expect(toRevision.showWhenAll).toBeUndefined()
    expect(toRevision.requiredWhen).toBeUndefined()
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows visible in every operation, in order', () => {
    const params = inputsByName('k8s-rollout')

    expect(visibleInGroup('Advanced', {})).toEqual(ADVANCED_PARAMS)
    for (const name of ADVANCED_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('carries the exact override-row copy', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-rollout').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(ON_ERROR_VALUES)
    expect(onError.enumLabels).toEqual(ON_ERROR_LABELS)
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
    expect(onError.showWhen).toBeUndefined()
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on the operation and failure rows alone', () => {
    const offRows = (getInputParams('k8s-rollout') ?? [])
      .filter((p) => p.noExpression === true)
      .map((p) => p.name)

    expect(offRows).toEqual(NO_EXPRESSION_PARAMS)
  })

  it('leaves every other row expression-capable, Kind included', () => {
    const inputs = getInputParams('k8s-rollout') ?? []

    expect(inputs).toHaveLength(ROLLOUT_PARAM_ORDER.length)
    for (const param of inputs) {
      if (NO_EXPRESSION_PARAMS.includes(param.name)) continue
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains To revision, so a typed revision survives a trip through Restart', () => {
    const retained = (getInputParams('k8s-rollout') ?? [])
      .filter((p) => p.retainOnHide === true)
      .map((p) => p.name)

    expect(retained).toEqual(RETAIN_ON_HIDE_PARAMS)
  })

  it('leaves retainOnHide off every row outside that one', () => {
    const inputs = getInputParams('k8s-rollout') ?? []

    expect(inputs).toHaveLength(ROLLOUT_PARAM_ORDER.length)
    for (const param of inputs) {
      if (RETAIN_ON_HIDE_PARAMS.includes(param.name)) continue
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })

  it('leaves retainOnHide off the always-visible rows', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].retainOnHide, name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-rollout').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    const params = inputsByName('k8s-rollout')

    for (const name of ROLLOUT_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-rollout')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(GROUP_ORDER)
    for (const group of EXPANDED_GROUPS) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of COLLAPSED_GROUPS) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-rollout')!.Connection.description).toBe(
      GROUP_DESCRIPTIONS.Connection,
    )
  })

  it('carries the exact Rollout footer', () => {
    expect(getGroupMeta('k8s-rollout')!.Rollout.description).toBe(GROUP_DESCRIPTIONS.Rollout)
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-rollout')!.Advanced.description).toBe(GROUP_DESCRIPTIONS.Advanced)
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-rollout')!['Failure Handling'].description).toBe(
      GROUP_DESCRIPTIONS['Failure Handling'],
    )
  })
})

describe('visible rows per state (K8SWRITE-7)', () => {
  it('opens on Restart with the To revision row hidden', () => {
    expect(visibleNames({})).toEqual(RESTART_ROWS)
  })

  it('shows the same rows in Status', () => {
    expect(visibleNames({ operation: 'status' })).toEqual(RESTART_ROWS)
  })

  it('reveals To revision under Name in Undo', () => {
    expect(visibleNames({ operation: 'undo' })).toEqual(ROLLOUT_PARAM_ORDER)
  })

  it('leaves the row list untouched when On error is Record and continue', () => {
    expect(visibleNames({ operation: 'status', on_error: 'record' })).toEqual(RESTART_ROWS)
    expect(visibleNames({ operation: 'restart', on_error: 'record' })).toEqual(RESTART_ROWS)
  })

  it('adds To revision to the Rollout group only in Undo', () => {
    expect(visibleInGroup('Rollout', {})).toEqual(ROLLOUT_PARAMS_WITHOUT_REVISION)
    expect(visibleInGroup('Rollout', { operation: 'status' })).toEqual(
      ROLLOUT_PARAMS_WITHOUT_REVISION,
    )
    expect(visibleInGroup('Rollout', { operation: 'undo' })).toEqual(ROLLOUT_PARAMS)
  })
})

describe('outputs', () => {
  it('declares the five outputs in order, with their exact types', () => {
    const outputs = getOutputParams('k8s-rollout') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(5)
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-rollout')

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(outputs[name].label, name).toBe(label)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-rollout') ?? []

    expect(outputs).toHaveLength(5)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact copy on Summary and Status', () => {
    const outputs = outputsByName('k8s-rollout')

    for (const [name, description] of Object.entries(OUTPUT_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('carries the shared Success, Error and Reason copy verbatim', () => {
    const outputs = outputsByName('k8s-rollout')

    for (const [name, description] of Object.entries(CORE_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-rollout') ?? []

    expect(outputs).toHaveLength(5)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('lets no output type follow another field', () => {
    const outputs = getOutputParams('k8s-rollout') ?? []

    expect(outputs).toHaveLength(5)
    for (const output of outputs) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating', () => {
  it('offers Status only while the operation is Status', () => {
    expect(outputsByName('k8s-rollout').status.showWhen).toEqual(OPERATION_STATUS)
  })

  it('offers Error and Reason only under Record and continue', () => {
    const outputs = outputsByName('k8s-rollout')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('keeps Summary and Success bindable in every state', () => {
    const outputs = outputsByName('k8s-rollout')

    expect(outputs.summary.showWhen).toBeUndefined()
    expect(outputs.success.showWhen).toBeUndefined()
  })

  it('gates three outputs on two independent fields', () => {
    const gated = Object.fromEntries(
      (getOutputParams('k8s-rollout') ?? [])
        .filter((o) => o.showWhen)
        .map((o) => [o.name, o.showWhen!.field]),
    )

    expect(gated).toEqual(GATED_OUTPUT_FIELDS)
  })

  it('offers Summary and Success on a fresh block', () => {
    expect(visibleOutputs({})).toEqual(RESTART_OUTPUTS)
  })

  it('adds Status in the Status operation', () => {
    expect(visibleOutputs({ operation: 'status' })).toEqual(STATUS_OUTPUTS)
  })

  it('keeps Status away from Undo', () => {
    expect(visibleOutputs({ operation: 'undo' })).toEqual(RESTART_OUTPUTS)
  })

  it('adds Error and Reason to Restart under Record and continue', () => {
    expect(visibleOutputs({ operation: 'restart', on_error: 'record' })).toEqual(
      RECORD_RESTART_OUTPUTS,
    )
  })

  it('composes both gates in Status under Record and continue', () => {
    expect(visibleOutputs({ operation: 'status', on_error: 'record' })).toEqual(
      RECORD_STATUS_OUTPUTS,
    )
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Rollout palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-rollout')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Rollout')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('RefreshCw')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-rollout')?.remotable).toBe(true)
  })

  it('keeps RefreshCw registered in the palette icon registry', () => {
    expect(isValidIconName('RefreshCw')).toBe(true)
  })

  it('registers all three canvas maps for k8s-rollout', () => {
    expect(getIcon('k8s-rollout')).toBe(RefreshCw)
    expect(getIconName('k8s-rollout')).toBe('refresh-cw')
    expect(getColorClass('k8s-rollout')).toBe('text-sky-500')
  })
})
