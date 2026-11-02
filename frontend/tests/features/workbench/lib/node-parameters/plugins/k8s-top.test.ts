/**
 * K8s Top plugin parameter schema tests (REQ-3.4.1.5, REQ-5.1.1, K8SREAD-8,
 * K8SREAD-9, K8SREAD-10).
 *
 * Top measures pods or nodes through one `scope` enum instead of two blocks.
 * `scope` gates the container breakdown and all three namespace rows; `select_by`
 * gates the target row and the All namespaces tick. This file pins every name,
 * label, default, enum, gate and output, and cross-checks the visible set in each
 * state the sheet can be in.
 */

import { describe, it, expect } from 'vitest'
import { Gauge } from 'lucide-react'
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

/** The two opt-in enum keys on the shared enum control. */
type PickerParam = InputParam & {
  enumGroups?: { heading: string; values: string[] }[]
  enumSearchable?: boolean
}

function inputsByName(nodeId: string): Record<string, PickerParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

/** The rows the sheet renders for a given set of values, in schema order. */
function visibleParams(values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-top') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(values: Record<string, unknown>, group: string): string[] {
  const params = inputsByName('k8s-top')
  return visibleParams(values).filter((name) => params[name]?.group === group)
}

/** The outputs the sheet offers for a given set of values, in schema order. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-top') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-top') ?? [])
    .filter((o) => (o.showWhen ? matchesCondition(o.showWhen, values, inputs) : true))
    .map((o) => o.name)
}

const TOP_PARAM_ORDER = [
  'session',
  'timeout',
  'scope',
  'select_by',
  'name',
  'label_selector',
  'include_containers',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']
const MEASUREMENT_PARAMS = [
  'scope',
  'select_by',
  'name',
  'label_selector',
  'include_containers',
]
const ADVANCED_PARAMS = [
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]
const FAILURE_PARAMS = ['on_error']

const REQUIRED_PARAMS = ['session', 'scope', 'select_by']

// Structural rows and mode enums carry no expression toggle.
const NO_EXPRESSION_PARAMS = ['scope', 'select_by', 'all_namespaces', 'on_error']

// Conditionally-shown rows keep their value while hidden, except all_namespaces.
const RETAINED_PARAMS = ['name', 'label_selector', 'include_containers', 'namespace']

const SCOPE_POD = { field: 'scope', values: ['pod'] }
const SELECT_BY_NAME = { field: 'select_by', values: ['name'] }
const SELECT_BY_SELECTOR = { field: 'select_by', values: ['selector'] }
const SELECT_BY_LIST_MODES = { field: 'select_by', values: ['all', 'selector'] }
const ALL_NAMESPACES_OFF = { field: 'all_namespaces', values: ['false'] }

// Error and Reason are offered only when the block records the outcome.
const RECORD_GATE = { field: 'on_error', values: ['record'] }
const GATED_OUTPUTS = ['error', 'reason']

const PARAM_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  scope: 'Measure',
  select_by: 'Select by',
  name: 'Name',
  label_selector: 'Label Selector',
  include_containers: 'Include containers',
  all_namespaces: 'All namespaces',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  scope:
    'Measure pods, or measure whole nodes. Node numbers include the kubelet and other system processes, not just pods.',
  select_by:
    'Measure every pod or node, one by name, or the ones that match a label selector.',
  name: 'The pod or node name to measure.',
  label_selector: 'Match pods or nodes by label, like app=web.',
  include_containers: 'Report usage per container instead of one total per pod.',
  all_namespaces: 'Measure pods in every namespace at once, instead of naming one.',
  namespace:
    'The namespace whose pods to measure. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to read.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error:
    'Fail the block, or record the outcome and let the test continue. A cluster with no metrics API fails the block either way.',
}

const PARAM_TYPES: Record<string, string> = {
  session: 'string',
  timeout: 'integer',
  scope: 'string',
  select_by: 'string',
  name: 'string',
  label_selector: 'string',
  include_containers: 'boolean',
  all_namespaces: 'boolean',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  timeout: 30,
  scope: 'pod',
  select_by: 'all',
  include_containers: false,
  all_namespaces: false,
  on_error: 'fail',
}

const NO_DEFAULT_PARAMS = [
  'session',
  'name',
  'label_selector',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

const ALWAYS_VISIBLE = [
  'session',
  'timeout',
  'scope',
  'select_by',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const ENUM_PARAMS = ['scope', 'select_by', 'on_error']

describe('registration', () => {
  it('registers k8s-top in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-top']).toBeDefined()
  })

  it('registers k8s-top in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-top']).toBeDefined()
  })

  it('registers k8s-top in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-top']).toBeDefined()
  })

  it('resolves k8s-top via hasNodeParams', () => {
    expect(hasNodeParams('k8s-top')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 12 input params in the pinned order', () => {
    expect((getInputParams('k8s-top') ?? []).map((p) => p.name)).toEqual(TOP_PARAM_ORDER)
    expect(getInputParams('k8s-top') ?? []).toHaveLength(12)
  })

  it('assigns the Connection group to session and timeout', () => {
    const params = inputsByName('k8s-top')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Measurement group to the verb params', () => {
    const params = inputsByName('k8s-top')

    for (const name of MEASUREMENT_PARAMS) {
      expect(params[name].group, name).toBe('Measurement')
    }
  })

  it('assigns the Advanced group to the namespace and impersonation params', () => {
    const params = inputsByName('k8s-top')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName('k8s-top')

    for (const name of FAILURE_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('declares the pinned type of every parameter', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('carries the pinned info-badge copy on every parameter', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-top') ?? []

    expect(inputs).toHaveLength(TOP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('declares the pinned defaults and leaves the free-text rows without one', () => {
    const params = inputsByName('k8s-top')

    for (const [name, value] of Object.entries(PARAM_DEFAULTS)) {
      expect(params[name].defaultValue, name).toBe(value)
    }
    for (const name of NO_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeUndefined()
    }
  })

  it('marks session, scope and select_by required and nothing else', () => {
    const params = inputsByName('k8s-top')

    for (const name of REQUIRED_PARAMS) {
      expect(params[name].required, name).toBe(true)
    }
    for (const name of TOP_PARAM_ORDER) {
      if (REQUIRED_PARAMS.includes(name)) continue
      expect(params[name].required, name).toBe(false)
    }
  })

  it('offers no Output Format row, because kubectl top has no such flag', () => {
    expect(inputsByName('k8s-top').output_format).toBeUndefined()
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-top')

    for (const name of ALWAYS_VISIBLE) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('uses showWhenAll on the two rows that need more than one condition', () => {
    const params = inputsByName('k8s-top')
    const conjunctive = ['all_namespaces', 'namespace']

    for (const name of TOP_PARAM_ORDER) {
      if (conjunctive.includes(name)) continue
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
    expect(params.all_namespaces.showWhenAll).toHaveLength(2)
    expect(params.namespace.showWhenAll).toHaveLength(2)
  })

  it('declares an enum list and enum labels on exactly three rows', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      if (ENUM_PARAMS.includes(name)) {
        expect(params[name].enumValues, name).toBeDefined()
        expect(params[name].enumLabels, name).toBeDefined()
        continue
      }
      expect(params[name].enumValues, name).toBeUndefined()
      expect(params[name].enumLabels, name).toBeUndefined()
    }
  })

  it('opts no row into grouping, search or sublabels - only Get carries them', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
    }
  })
})

describe('Connection group', () => {
  it('declares session as a required plain-locked secret string', () => {
    const session = inputsByName('k8s-top').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-top').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.required).toBe(false)
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.showWhen).toBeUndefined()
  })
})

describe('Measurement group', () => {
  it('declares scope as a required Measure enum of pod | node defaulting to pod', () => {
    const scope = inputsByName('k8s-top').scope

    expect(scope.label).toBe('Measure')
    expect(scope.required).toBe(true)
    expect(scope.enumValues).toEqual(['pod', 'node'])
    expect(scope.enumLabels).toEqual({ pod: 'Pods', node: 'Nodes' })
    expect((scope.enumValues ?? []).map((v) => scope.enumLabels?.[v])).toEqual([
      'Pods',
      'Nodes',
    ])
    expect(scope.defaultValue).toBe('pod')
    expect(scope.showWhen).toBeUndefined()
    expect(scope.showWhenAll).toBeUndefined()
  })

  it('declares select_by as a required Select by enum of all | name | selector defaulting to all', () => {
    const selectBy = inputsByName('k8s-top').select_by

    expect(selectBy.label).toBe('Select by')
    expect(selectBy.required).toBe(true)
    expect(selectBy.enumValues).toEqual(['all', 'name', 'selector'])
    expect(selectBy.enumLabels).toEqual({
      all: 'All',
      name: 'Name',
      selector: 'Selector',
    })
    expect((selectBy.enumValues ?? []).map((v) => selectBy.enumLabels?.[v])).toEqual([
      'All',
      'Name',
      'Selector',
    ])
    expect(selectBy.defaultValue).toBe('all')
    expect(selectBy.showWhen).toBeUndefined()
    expect(selectBy.showWhenAll).toBeUndefined()
  })

  it('shows name only in Select by = Name and requires it there', () => {
    const name = inputsByName('k8s-top').name

    expect(name.showWhen).toEqual(SELECT_BY_NAME)
    expect(name.showWhenAll).toBeUndefined()
    expect(name.requiredWhen).toEqual(SELECT_BY_NAME)
    expect(name.requiredWhenAll).toBeUndefined()
    expect(name.retainOnHide).toBe(true)
  })

  it('shows label_selector only in Select by = Selector and never requires it', () => {
    const labelSelector = inputsByName('k8s-top').label_selector

    expect(labelSelector.showWhen).toEqual(SELECT_BY_SELECTOR)
    expect(labelSelector.showWhenAll).toBeUndefined()
    expect(labelSelector.requiredWhen).toBeUndefined()
    expect(labelSelector.requiredWhenAll).toBeUndefined()
    expect(labelSelector.retainOnHide).toBe(true)
  })

  it('shows include_containers only while measuring pods, and keeps its expression toggle', () => {
    const includeContainers = inputsByName('k8s-top').include_containers

    expect(includeContainers.type).toBe('boolean')
    expect(includeContainers.defaultValue).toBe(false)
    expect(includeContainers.showWhen).toEqual(SCOPE_POD)
    expect(includeContainers.showWhenAll).toBeUndefined()
    expect(includeContainers.noExpression).toBeUndefined()
    expect(includeContainers.retainOnHide).toBe(true)
  })
})

describe('conditional requirements', () => {
  it('conditionally requires name and no other row', () => {
    const params = inputsByName('k8s-top')

    expect(params.name.requiredWhen).toEqual(SELECT_BY_NAME)
    for (const name of TOP_PARAM_ORDER) {
      if (name === 'name') continue
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })
})

describe('Advanced group', () => {
  it('offers all_namespaces only while measuring pods in All and Selector mode, and clears it when hidden', () => {
    const allNamespaces = inputsByName('k8s-top').all_namespaces

    expect(allNamespaces.type).toBe('boolean')
    expect(allNamespaces.defaultValue).toBe(false)
    expect(allNamespaces.showWhen).toBeUndefined()
    expect(allNamespaces.showWhenAll).toEqual([SCOPE_POD, SELECT_BY_LIST_MODES])
    expect(allNamespaces.retainOnHide).not.toBe(true)
  })

  it('gates namespace on pod scope with All namespaces unticked', () => {
    const namespace = inputsByName('k8s-top').namespace

    expect(namespace.type).toBe('string')
    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toBeUndefined()
    expect(namespace.showWhenAll).toEqual([SCOPE_POD, ALL_NAMESPACES_OFF])
    expect(namespace.retainOnHide).toBe(true)
  })

  it('keeps both impersonation rows always visible at the foot of Advanced', () => {
    const params = inputsByName('k8s-top')

    for (const name of ['impersonate_user', 'impersonate_groups']) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].retainOnHide, name).toBeUndefined()
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as a fail | record enum defaulting to fail', () => {
    const onError = inputsByName('k8s-top').on_error

    expect(onError.type).toBe('string')
    expect(onError.required).toBe(false)
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect((onError.enumValues ?? []).map((v) => onError.enumLabels?.[v])).toEqual([
      'Fail the block',
      'Record and continue',
    ])
    expect(onError.defaultValue).toBe('fail')
    expect(onError.showWhen).toBeUndefined()
    expect(onError.showWhenAll).toBeUndefined()
  })

  it('names the metrics-API hard fail in the on_error info badge (K8SREAD-10)', () => {
    expect(inputsByName('k8s-top').on_error.description).toBe(
      'Fail the block, or record the outcome and let the test continue. A cluster with no metrics API fails the block either way.',
    )
  })
})

describe('expression toggles', () => {
  it('drops the expression toggle on the structural rows', () => {
    const params = inputsByName('k8s-top')

    for (const name of NO_EXPRESSION_PARAMS) {
      expect(params[name].noExpression, name).toBe(true)
    }
  })

  it('keeps the expression toggle on every other row, include_containers included', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      if (NO_EXPRESSION_PARAMS.includes(name)) continue
      expect(params[name].noExpression, name).toBeUndefined()
    }
  })
})

describe('retained values', () => {
  it('retains every conditionally-shown row except all_namespaces', () => {
    const params = inputsByName('k8s-top')

    for (const name of RETAINED_PARAMS) {
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('leaves the always-visible rows without retainOnHide', () => {
    const params = inputsByName('k8s-top')

    for (const name of ALWAYS_VISIBLE) {
      expect(params[name].retainOnHide, name).toBeUndefined()
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-top').session.secret).toBe(true)
  })

  it('does not flag any other param secret', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })

  it('locks no parameter other than session to a value format', () => {
    const params = inputsByName('k8s-top')

    for (const name of TOP_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed (K8SREAD-8)', () => {
    const meta = getGroupMeta('k8s-top')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual([
      'Connection',
      'Measurement',
      'Advanced',
      'Failure Handling',
    ])
    for (const group of ['Connection', 'Measurement']) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-top')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Measurement footer', () => {
    expect(getGroupMeta('k8s-top')!.Measurement.description).toBe(
      'Pods or nodes, and which ones to measure',
    )
  })

  it('carries one static Advanced footer, not a mode-dependent one', () => {
    expect(getGroupMeta('k8s-top')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-top')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('state-to-UI: which rows the sheet renders', () => {
  it('opens on Pods measured across the whole namespace, with no target row', () => {
    expect(visibleParams({})).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'include_containers',
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('drops Include containers and both namespace rows in node scope (K8SREAD-8)', () => {
    expect(visibleParams({ scope: 'node' })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('leaves only the impersonation rows in Advanced in node scope', () => {
    expect(visibleInGroup({ scope: 'node' }, 'Advanced')).toEqual([
      'impersonate_user',
      'impersonate_groups',
    ])
  })

  it('offers both namespace rows in Advanced in pod scope outside Name mode', () => {
    expect(visibleInGroup({ select_by: 'all' }, 'Advanced')).toEqual([
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])
  })

  it('drops All namespaces from Advanced in Name mode, the way Get does', () => {
    expect(visibleInGroup({ select_by: 'name' }, 'Advanced')).toEqual([
      'namespace',
      'impersonate_user',
      'impersonate_groups',
    ])
  })

  it('brings back the Name row in Select by = Name', () => {
    expect(visibleParams({ select_by: 'name' })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'name',
      'include_containers',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('swaps Name for Label Selector in Select by = Selector', () => {
    expect(visibleParams({ select_by: 'selector' })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'label_selector',
      'include_containers',
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('hides Namespace while All namespaces is ticked', () => {
    expect(visibleParams({ all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'include_containers',
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
    expect(visibleParams({ select_by: 'selector', all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'label_selector',
      'include_containers',
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('keeps the All namespaces row hidden in Name mode even with a stale tick', () => {
    expect(visibleParams({ select_by: 'name', all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'name',
      'include_containers',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('measures nodes by selector with neither the container breakdown nor a namespace', () => {
    expect(visibleParams({ scope: 'node', select_by: 'selector' })).toEqual([
      'session',
      'timeout',
      'scope',
      'select_by',
      'label_selector',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('keeps Connection, Measure, Select by, impersonation and On error visible in every state', () => {
    const states: Record<string, unknown>[] = [
      {},
      { scope: 'node' },
      { select_by: 'all' },
      { select_by: 'name' },
      { select_by: 'selector' },
      { all_namespaces: true },
    ]

    for (const values of states) {
      const shown = visibleParams(values)
      for (const name of ALWAYS_VISIBLE) {
        expect(shown, `${name} in ${JSON.stringify(values)}`).toContain(name)
      }
    }
  })
})

describe('outputs', () => {
  it('declares Usage as a table and Count, then the core footer gated on Record', () => {
    const outputs = getOutputParams('k8s-top') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['usage', 'table'],
      ['count', 'integer'],
      ['success', 'boolean'],
      ['error', 'string'],
      ['reason', 'string'],
    ])

    for (const output of outputs) {
      if (GATED_OUTPUTS.includes(output.name)) {
        expect(output.showWhen, `showWhen of ${output.name}`).toEqual(RECORD_GATE)
      } else {
        expect(output.showWhen, `showWhen of ${output.name}`).toBeUndefined()
      }
    }
  })

  it('offers Usage, Count and Success always, and the two failure rows only on Record', () => {
    expect(visibleOutputs({})).toEqual(['usage', 'count', 'success'])
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'usage',
      'count',
      'success',
      'error',
      'reason',
    ])
  })

  it('labels every output for display', () => {
    const outputs = outputsByName('k8s-top')

    expect(outputs.usage.label).toBe('Usage')
    expect(outputs.count.label).toBe('Count')
    expect(outputs.success.label).toBe('Success')
    expect(outputs.error.label).toBe('Error')
    expect(outputs.reason.label).toBe('Reason')
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-top') ?? []

    expect(outputs).toHaveLength(5)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).toBeUndefined()
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-top') ?? []

    expect(outputs).toHaveLength(5)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('describes Success, Error and Reason in the words every K8s block shares', () => {
    const outputs = outputsByName('k8s-top')

    expect(outputs.success.description).toBe(
      'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
    )
    expect(outputs.error.description).toBe(
      'The error message when the operation failed under Record and continue; empty otherwise',
    )
    expect(outputs.reason.description).toBe(
      'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
    )
  })

  it('describes Usage as one row per target', () => {
    const outputs = outputsByName('k8s-top')

    expect(outputs.usage.description).toBe(
      'One row per pod, container or node with its name, cpu in cores and memory in bytes; nodes also carry capacity and allocatable, and a node the metrics API does not report comes back with null cpu and memory',
    )
  })

  it('fixes every declared type, so no output follows another field', () => {
    for (const output of getOutputParams('k8s-top') ?? []) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Top palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-top')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Top')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Gauge')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-top')?.remotable).toBe(true)
  })

  it('keeps Gauge registered in the palette icon registry', () => {
    expect(isValidIconName('Gauge')).toBe(true)
  })

  it('registers all three canvas maps for k8s-top', () => {
    expect(getIcon('k8s-top')).toBe(Gauge)
    expect(getIconName('k8s-top')).toBe('gauge')
    expect(getColorClass('k8s-top')).toBe('text-sky-500')
  })
})
