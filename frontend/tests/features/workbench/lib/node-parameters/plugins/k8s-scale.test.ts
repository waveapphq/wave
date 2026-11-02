/**
 * K8s Scale plugin parameter schema tests (K8SWRITE-6).
 *
 * Scale writes one replica count onto one scalable object. Resource Type swaps
 * the Kind row between the four kinds a cluster serves a scale endpoint for and
 * a plain string field, two params with different names and the same label. The
 * sheet has one state apart from that swap: no precondition pair and no wait
 * row anywhere on it. Error and Reason are offered for binding only under
 * Record and continue.
 */

import { describe, it, expect } from 'vitest'
import { Scaling } from 'lucide-react'
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
  const all = (getInputParams('k8s-scale') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-scale') ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.group === groupName && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The outputs the binding table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-scale') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-scale') ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const SCALE_PARAM_ORDER = [
  'session',
  'timeout',
  'resource_type',
  'kind',
  'kind_custom',
  'name',
  'replicas',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const SCALE_PARAMS = ['resource_type', 'kind', 'kind_custom', 'name', 'replicas']

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_PARAMS = ['on_error']

const RESOURCE_DEFAULT = { field: 'resource_type', values: ['default'] }
const RESOURCE_CUSTOM = { field: 'resource_type', values: ['custom'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const SCALABLE_KINDS = ['Deployment', 'ReplicaSet', 'ReplicationController', 'StatefulSet']

const KIND_ROWS = ['kind', 'kind_custom']

const REQUIRED_PARAMS = ['session', 'name', 'replicas']

// Only the two Kind rows swap with the mode, so only they are conditionally required.
const REQUIRED_WHEN_PARAMS = ['kind', 'kind_custom']

const ENUM_LIST_PARAMS = ['resource_type', 'kind', 'on_error']
const ENUM_LABEL_PARAMS = ['resource_type', 'on_error']

// A row that gates which other rows the form shows cannot take an expression;
// Kind is a data value, not a mode, so it keeps its toggle.
const NO_EXPRESSION_PARAMS = ['resource_type', 'on_error']

const RETAIN_ON_HIDE_PARAMS = ['kind', 'kind_custom']

const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'resource_type',
  'name',
  'replicas',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

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
  resource_type: 'Resource Type',
  kind: 'Kind',
  kind_custom: 'Kind',
  name: 'Name',
  replicas: 'Replicas',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  resource_type: 'string',
  kind: 'string',
  kind_custom: 'string',
  name: 'string',
  replicas: 'integer',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 30,
  resource_type: 'default',
  kind: 'Deployment',
  kind_custom: undefined,
  name: undefined,
  replicas: undefined,
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  on_error: 'fail',
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  resource_type:
    'Default offers the kinds that can be scaled. Custom takes any other kind as plain text, including custom resources.',
  kind: 'The kind to scale. Only kinds the cluster serves a scale endpoint for can be scaled.',
  kind_custom:
    'The kind exactly as the cluster names it. A kind with no scale endpoint is refused before anything is written.',
  name: "The object's name.",
  replicas: 'How many replicas to run. 0 is allowed and scales the object down to nothing.',
  namespace:
    'Leave empty to use the namespace the session carries. Otherwise, the namespace the object is in.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = [
  ['summary', 'table'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const SUMMARY_DESCRIPTION =
  'One row per object: the resource, what happened to it, and the replica count before and after.'

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
  it('registers k8s-scale in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-scale']).toBeDefined()
  })

  it('registers k8s-scale in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-scale']).toBeDefined()
  })

  it('registers k8s-scale in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-scale']).toBeDefined()
  })

  it('resolves k8s-scale via hasNodeParams', () => {
    expect(hasNodeParams('k8s-scale')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 11 input params in the pinned order', () => {
    expect((getInputParams('k8s-scale') ?? []).map((p) => p.name)).toEqual(SCALE_PARAM_ORDER)
    expect(getInputParams('k8s-scale') ?? []).toHaveLength(11)
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const params = inputsByName('k8s-scale')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Scale group to the verb rows', () => {
    const scale = (getInputParams('k8s-scale') ?? []).filter((p) => p.group === 'Scale')

    expect(scale.map((p) => p.name)).toEqual(SCALE_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const params = inputsByName('k8s-scale')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName('k8s-scale')

    for (const name of FAILURE_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('marks the session, Name and Replicas rows required and nothing else', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].required, name).toBe(REQUIRED_PARAMS.includes(name))
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-scale') ?? []

    expect(inputs).toHaveLength(SCALE_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every parameter', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('types every parameter exactly', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('declares the exact default for every parameter', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].defaultValue, name).toBe(PARAM_DEFAULTS[name])
    }
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-scale')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('uses no conjunctive gate at all, every gate being single', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('conditionally requires the two Kind rows and nothing else', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      if (REQUIRED_WHEN_PARAMS.includes(name)) {
        expect(params[name].requiredWhen, name).toBeDefined()
        continue
      }
      expect(params[name].requiredWhen, name).toBeUndefined()
    }
  })

  it('declares an enum list on three rows and enum labels on two of them', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
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
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(params[name][key], `${name}.${key}`).toBeUndefined()
      }
    }
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-scale').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-scale').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('Scale group (K8SWRITE-6)', () => {
  it('declares resource_type as a Default/Custom enum defaulting to Default', () => {
    const resourceType = inputsByName('k8s-scale').resource_type

    expect(resourceType.type).toBe('string')
    expect(resourceType.enumValues).toEqual(['default', 'custom'])
    expect(resourceType.enumLabels).toEqual({ default: 'Default', custom: 'Custom' })
    expect(resourceType.defaultValue).toBe('default')
    expect(resourceType.showWhen).toBeUndefined()
  })

  it('gates the two Kind widgets on opposite resource_type values', () => {
    const params = inputsByName('k8s-scale')

    expect(params.kind.showWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.showWhen).toEqual(RESOURCE_CUSTOM)
    expect(params.kind.showWhenAll).toBeUndefined()
    expect(params.kind_custom.showWhenAll).toBeUndefined()
  })

  it('labels both Kind widgets Kind, under two different names', () => {
    const params = inputsByName('k8s-scale')

    expect(params.kind.name).toBe('kind')
    expect(params.kind_custom.name).toBe('kind_custom')
    expect(params.kind.label).toBe('Kind')
    expect(params.kind_custom.label).toBe('Kind')
  })

  it('requires whichever Kind widget is showing', () => {
    const params = inputsByName('k8s-scale')

    expect(params.kind.requiredWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.requiredWhen).toEqual(RESOURCE_CUSTOM)
  })

  it('offers the four scalable kinds as a plain enum defaulting to Deployment', () => {
    const kind = inputsByName('k8s-scale').kind

    expect(kind.type).toBe('string')
    expect(kind.enumValues).toEqual(SCALABLE_KINDS)
    expect(kind.enumValues).toHaveLength(4)
    expect(kind.defaultValue).toBe('Deployment')
  })

  it('shows each scalable kind by its own name, off the searchable picker', () => {
    const kind = inputsByName('k8s-scale').kind

    expect(kind.enumLabels).toBeUndefined()
    expect(kind.enumGroups).toBeUndefined()
    expect(kind.enumSublabels).toBeUndefined()
    expect(kind.enumSearchable).toBeUndefined()
  })

  it('renders the custom Kind as a plain string field with no enum data', () => {
    const kindCustom = inputsByName('k8s-scale').kind_custom

    expect(kindCustom.type).toBe('string')
    expect(kindCustom.enumValues).toBeUndefined()
    expect(kindCustom.enumGroups).toBeUndefined()
    expect(kindCustom.enumSearchable).toBeUndefined()
    expect(kindCustom.defaultValue).toBeUndefined()
  })

  it('leaves every row on the plain ungrouped select', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
    }
  })

  it('declares Name as an always-required string with no gate', () => {
    const name = inputsByName('k8s-scale').name

    expect(name.type).toBe('string')
    expect(name.required).toBe(true)
    expect(name.enumValues).toBeUndefined()
    expect(name.showWhen).toBeUndefined()
  })

  it('declares Replicas as an always-required integer with no default', () => {
    const replicas = inputsByName('k8s-scale').replicas

    expect(replicas.type).toBe('integer')
    expect(replicas.required).toBe(true)
    expect(replicas.defaultValue).toBeUndefined()
    expect(replicas.showWhen).toBeUndefined()
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows always visible, in order', () => {
    const params = inputsByName('k8s-scale')

    expect(visibleInGroup('Advanced', {})).toEqual(ADVANCED_PARAMS)
    for (const name of ADVANCED_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('carries the exact Namespace copy for a write block', () => {
    expect(inputsByName('k8s-scale').namespace.description).toBe(
      'Leave empty to use the namespace the session carries. Otherwise, the namespace the object is in.',
    )
  })

  it('carries the exact impersonation copy for a write block', () => {
    const params = inputsByName('k8s-scale')

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
    const onError = inputsByName('k8s-scale').on_error

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
  it('turns the expression toggle off on the two mode rows', () => {
    const structural = (getInputParams('k8s-scale') ?? []).filter((p) =>
      NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(structural).toHaveLength(2)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('leaves every other row expression-capable, the Kind rows included', () => {
    const expressive = (getInputParams('k8s-scale') ?? []).filter(
      (p) => !NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(expressive).toHaveLength(9)
    for (const param of expressive) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains both Kind rows, so switching Resource Type and back keeps the typed kind', () => {
    const retained = (getInputParams('k8s-scale') ?? []).filter((p) =>
      RETAIN_ON_HIDE_PARAMS.includes(p.name),
    )

    expect(retained).toHaveLength(2)
    for (const param of retained) {
      expect(param.retainOnHide, param.name).toBe(true)
    }
  })

  it('leaves retainOnHide off every row outside the Kind pair', () => {
    const notRetained = (getInputParams('k8s-scale') ?? []).filter(
      (p) => !RETAIN_ON_HIDE_PARAMS.includes(p.name),
    )

    expect(notRetained).toHaveLength(9)
    for (const param of notRetained) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })

  it('leaves retainOnHide off the always-visible rows', () => {
    const alwaysVisible = (getInputParams('k8s-scale') ?? []).filter((p) =>
      ALWAYS_VISIBLE_PARAMS.includes(p.name),
    )

    expect(alwaysVisible).toHaveLength(9)
    for (const param of alwaysVisible) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-scale').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    const params = inputsByName('k8s-scale')

    for (const name of SCALE_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-scale')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(['Connection', 'Scale', 'Advanced', 'Failure Handling'])
    for (const group of ['Connection', 'Scale']) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-scale')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Scale footer', () => {
    expect(getGroupMeta('k8s-scale')!.Scale.description).toBe('What to scale and to how many')
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-scale')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-scale')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state (K8SWRITE-6)', () => {
  it('opens on Default resource type with every row showing', () => {
    expect(visibleNames({})).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'name',
      'replicas',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('swaps the enum for the plain Kind field on Custom', () => {
    expect(visibleNames({ resource_type: 'custom' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind_custom',
      'name',
      'replicas',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('never shows both Kind rows at once', () => {
    for (const values of [{}, { resource_type: 'default' }, { resource_type: 'custom' }]) {
      const shown = visibleNames(values).filter((name) => KIND_ROWS.includes(name))
      expect(shown, JSON.stringify(values)).toHaveLength(1)
    }
  })

  it('keeps the whole Scale group visible in both Kind states', () => {
    expect(visibleInGroup('Scale', {})).toEqual([
      'resource_type',
      'kind',
      'name',
      'replicas',
    ])
    expect(visibleInGroup('Scale', { resource_type: 'custom' })).toEqual([
      'resource_type',
      'kind_custom',
      'name',
      'replicas',
    ])
  })
})

describe('outputs', () => {
  it('declares the four outputs in order', () => {
    const outputs = getOutputParams('k8s-scale') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(4)
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-scale')

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(outputs[name].label, name).toBe(label)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-scale') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('returns Summary as a table, one row per object scaled', () => {
    const summary = outputsByName('k8s-scale').summary

    expect(summary.type).toBe('table')
    expect(summary.description).toBe(SUMMARY_DESCRIPTION)
    expect(summary.showWhen).toBeUndefined()
  })

  it('carries the exact copy on the three core outputs', () => {
    const outputs = outputsByName('k8s-scale')

    for (const [name, description] of Object.entries(CORE_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-scale') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('varies no output type with the sheet state', () => {
    const outputs = getOutputParams('k8s-scale') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating', () => {
  it('offers Error and Reason only under Record and continue', () => {
    const outputs = outputsByName('k8s-scale')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('keeps Success visible in both On error modes', () => {
    expect(outputsByName('k8s-scale').success.showWhen).toBeUndefined()
  })

  it('gates Error and Reason and no other output', () => {
    const gated = (getOutputParams('k8s-scale') ?? [])
      .filter((o) => o.showWhen !== undefined)
      .map((o) => o.name)

    expect(gated).toEqual(GATED_OUTPUTS)
  })

  it('offers two outputs while On error is Fail the block', () => {
    expect(visibleOutputs({})).toEqual(['summary', 'success'])
  })

  it('offers all four outputs under Record and continue', () => {
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'summary',
      'success',
      'error',
      'reason',
    ])
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Scale palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-scale')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Scale')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Scaling')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-scale')?.remotable).toBe(true)
  })

  it('registers Scaling in the palette icon registry', () => {
    expect(isValidIconName('Scaling')).toBe(true)
  })

  it('registers all three canvas maps for k8s-scale', () => {
    expect(getIcon('k8s-scale')).toBe(Scaling)
    expect(getIconName('k8s-scale')).toBe('scaling')
    expect(getColorClass('k8s-scale')).toBe('text-sky-500')
  })
})
