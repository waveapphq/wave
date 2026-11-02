/**
 * K8s Get plugin parameter schema tests (K8SREAD-1..11).
 *
 * Get reads one kind through an explicit three-way Search by - Name, Selector
 * or List. Resource Type swaps the Kind row between the grouped
 * searchable picker and a plain string field, two params with different names
 * and the same label. This file pins the 23 kinds, their five groups,
 * the kubectl short names, every row the sheet shows in each state, the two
 * Output Format rows Search by picks between, and the six outputs, two
 * of which are offered only under Record and continue.
 */

import { describe, it, expect } from 'vitest'
import { PackageSearch } from 'lucide-react'
import {
  ALL_INPUTS,
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

/** The two opt-in enum keys on the shared enum control. */
type PickerParam = InputParam & {
  enumGroups?: { heading: string; values: string[] }[]
  enumSearchable?: boolean
}

function inputsByName(nodeId: string): Record<string, PickerParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

/** Every descriptor sharing one wire name, in declaration order. */
function inputsNamed(nodeId: string, name: string): InputParam[] {
  return (getInputParams(nodeId) ?? []).filter((p) => p.name === name)
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

/** The rows the parameter table renders for one set of field values. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-get') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

/** The first-option label of every Output Format row visible in a state. */
function visibleFormatLabels(values: Record<string, unknown>): (string | undefined)[] {
  const all = (getInputParams('k8s-get') ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.name === 'output_format' && isParameterVisible(p, values, all))
    .map((p) => p.enumLabels?.map)
}

/** The outputs the sheet offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-get') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-get') ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const GET_PARAM_ORDER = [
  'session',
  'timeout',
  'resource_type',
  'kind',
  'kind_custom',
  'search_by',
  'name',
  'label_selector',
  'field_selector',
  'output_format',
  'output_format',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

// The wire names the backend declares: Output Format is one field behind two rows.
const GET_WIRE_NAMES = [
  'session',
  'timeout',
  'resource_type',
  'kind',
  'kind_custom',
  'search_by',
  'name',
  'label_selector',
  'field_selector',
  'output_format',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const RESOURCE_PARAMS = [
  'resource_type',
  'kind',
  'kind_custom',
  'search_by',
  'name',
  'label_selector',
  'field_selector',
  'output_format',
  'output_format',
]

const ADVANCED_PARAMS = [
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

const FAILURE_PARAMS = ['on_error']

const RESOURCE_DEFAULT = { field: 'resource_type', values: ['default'] }
const RESOURCE_CUSTOM = { field: 'resource_type', values: ['custom'] }
const SEARCH_BY_NAME = { field: 'search_by', values: ['name'] }
const SEARCH_BY_SELECTOR = { field: 'search_by', values: ['selector'] }
const SEARCH_BY_LIST_MODES = { field: 'search_by', values: ['selector', 'list'] }
const ALL_NAMESPACES_OFF = { field: 'all_namespaces', values: ['false'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

// The picker data is declared independently of the group partition so the
// "groups flatten back to enumValues" check stays a real check.
const KIND_VALUES = [
  'CronJob',
  'DaemonSet',
  'Deployment',
  'Job',
  'Pod',
  'ReplicaSet',
  'StatefulSet',
  'Endpoints',
  'Ingress',
  'NetworkPolicy',
  'Service',
  'ConfigMap',
  'Secret',
  'ServiceAccount',
  'PersistentVolume',
  'PersistentVolumeClaim',
  'StorageClass',
  'ClusterRole',
  'ClusterRoleBinding',
  'Namespace',
  'Node',
  'Role',
  'RoleBinding',
]

const KIND_GROUPS = [
  {
    heading: 'Workloads',
    values: ['CronJob', 'DaemonSet', 'Deployment', 'Job', 'Pod', 'ReplicaSet', 'StatefulSet'],
  },
  { heading: 'Networking', values: ['Endpoints', 'Ingress', 'NetworkPolicy', 'Service'] },
  { heading: 'Config', values: ['ConfigMap', 'Secret', 'ServiceAccount'] },
  {
    heading: 'Storage',
    values: ['PersistentVolume', 'PersistentVolumeClaim', 'StorageClass'],
  },
  {
    heading: 'Cluster',
    values: ['ClusterRole', 'ClusterRoleBinding', 'Namespace', 'Node', 'Role', 'RoleBinding'],
  },
]

const KIND_SHORT_NAMES: Record<string, string> = {
  CronJob: 'cj',
  DaemonSet: 'ds',
  Deployment: 'deploy',
  Pod: 'po',
  ReplicaSet: 'rs',
  StatefulSet: 'sts',
  Endpoints: 'ep',
  Ingress: 'ing',
  NetworkPolicy: 'netpol',
  Service: 'svc',
  ConfigMap: 'cm',
  ServiceAccount: 'sa',
  PersistentVolume: 'pv',
  PersistentVolumeClaim: 'pvc',
  StorageClass: 'sc',
  Namespace: 'ns',
  Node: 'no',
}

const KINDS_WITHOUT_SHORT_NAME = [
  'Job',
  'Secret',
  'ClusterRole',
  'ClusterRoleBinding',
  'Role',
  'RoleBinding',
]

const OUTPUT_FORMAT_VALUES = ['map', 'table', 'json', 'yaml']
// One row per Search by mode: the first option is a Map in Name mode and an
// Array in the two list modes.
const OUTPUT_FORMAT_LABELS_NAME = { map: 'Map', table: 'Table', json: 'JSON', yaml: 'YAML' }
const OUTPUT_FORMAT_LABELS_LIST = { map: 'Array', table: 'Table', json: 'JSON', yaml: 'YAML' }

// kind carries an enum list but no labels - the label is the value itself.
const ENUM_LIST_PARAMS = ['resource_type', 'kind', 'search_by', 'output_format', 'on_error']
const ENUM_LABEL_PARAMS = ['resource_type', 'search_by', 'output_format', 'on_error']

// The three rows the mode swaps are the only conditionally-required ones.
const REQUIRED_WHEN_PARAMS = ['kind', 'kind_custom', 'name']

// A row that gates which other rows the form shows cannot take an expression.
const NO_EXPRESSION_PARAMS = [
  'resource_type',
  'search_by',
  'output_format',
  'all_namespaces',
  'on_error',
]

const RETAIN_ON_HIDE_PARAMS = [
  'kind',
  'kind_custom',
  'name',
  'label_selector',
  'field_selector',
  'namespace',
]

const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'resource_type',
  'search_by',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  resource_type: 'Resource Type',
  kind: 'Kind',
  kind_custom: 'Kind',
  search_by: 'Search by',
  name: 'Name',
  label_selector: 'Label Selector',
  field_selector: 'Field Selector',
  output_format: 'Output Format',
  all_namespaces: 'All namespaces',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  resource_type: 'string',
  kind: 'string',
  kind_custom: 'string',
  search_by: 'string',
  name: 'string',
  label_selector: 'string',
  field_selector: 'string',
  output_format: 'string',
  all_namespaces: 'boolean',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 30,
  resource_type: 'default',
  kind: 'Pod',
  kind_custom: undefined,
  search_by: 'name',
  name: undefined,
  label_selector: undefined,
  field_selector: undefined,
  output_format: 'map',
  all_namespaces: false,
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  on_error: 'fail',
}

const DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  resource_type:
    'Default offers the kinds a stock cluster serves. Custom takes any other kind as plain text, including custom resources.',
  kind: 'The resource kind, as kubectl names it. Search the list, or switch Resource Type to Custom to type one that is not in it.',
  kind_custom:
    "The kind exactly as the cluster names it. A kind this cluster does not serve fails the block.",
  search_by:
    'Name reads one object and fails when it is not there. Selector and List read a list, which can legitimately come back empty.',
  name: "The object's name. A name that does not exist fails the block.",
  label_selector:
    'Match objects by label, like app=web or tier in (a,b). Leave empty to match on fields alone.',
  field_selector:
    'Match objects by field, like status.phase=Running. The cluster supports only a few fields per kind.',
  all_namespaces:
    'Read across every namespace at once, instead of naming one. Ignored for cluster-scoped kinds.',
  namespace:
    'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Node or PersistentVolume.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to read.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = [
  ['result', 'map'],
  ['names', 'array'],
  ['count', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

// Success is the deliberate exception and stays ungated, by ruling.
const RECORD_GATED_OUTPUTS = ['error', 'reason']

describe('registration', () => {
  it('registers k8s-get in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-get']).toBeDefined()
  })

  it('registers k8s-get in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-get']).toBeDefined()
  })

  it('registers k8s-get in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-get']).toBeDefined()
  })

  it('resolves k8s-get via hasNodeParams', () => {
    expect(hasNodeParams('k8s-get')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 16 input params in the pinned order, Output Format twice', () => {
    expect((getInputParams('k8s-get') ?? []).map((p) => p.name)).toEqual(GET_PARAM_ORDER)
    expect(getInputParams('k8s-get') ?? []).toHaveLength(16)
    expect([...new Set((getInputParams('k8s-get') ?? []).map((p) => p.name))]).toEqual(
      GET_WIRE_NAMES,
    )
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const params = inputsByName('k8s-get')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Resource group to the verb rows', () => {
    const resource = (getInputParams('k8s-get') ?? []).filter((p) => p.group === 'Resource')

    expect(resource.map((p) => p.name)).toEqual(RESOURCE_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const params = inputsByName('k8s-get')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName('k8s-get')

    for (const name of FAILURE_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('marks only session required, leaving the mode rows to requiredWhen', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.required, param.name).toBe(param.name === 'session')
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-get') ?? []

    expect(inputs).toHaveLength(GET_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every row outside the Output Format pair', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      if (param.name === 'output_format') continue
      expect(param.description, param.name).toBe(DESCRIPTIONS[param.name])
    }
  })

  it('labels every parameter for display', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.label, param.name).toBe(LABELS[param.name])
    }
  })

  it('types every parameter exactly', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.type, param.name).toBe(TYPES[param.name])
    }
  })

  it('declares the exact default for every parameter', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.defaultValue, param.name).toBe(DEFAULTS[param.name])
    }
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-get')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('uses no conjunctive gate at all, every gate being single', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.showWhenAll, param.name).toBeUndefined()
    }
  })

  it('conditionally requires the three mode-swapped rows and nothing else', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      expect(param.requiredWhenAll, param.name).toBeUndefined()
      if (REQUIRED_WHEN_PARAMS.includes(param.name)) {
        expect(param.requiredWhen, param.name).toBeDefined()
        continue
      }
      expect(param.requiredWhen, param.name).toBeUndefined()
    }
  })

  it('declares an enum list on six rows and enum labels on five of them', () => {
    const inputs = getInputParams('k8s-get') ?? []

    expect(inputs.filter((p) => p.enumValues !== undefined)).toHaveLength(6)
    expect(inputs.filter((p) => p.enumLabels !== undefined)).toHaveLength(5)
    for (const param of inputs) {
      if (ENUM_LIST_PARAMS.includes(param.name)) {
        expect(param.enumValues, param.name).toBeDefined()
      } else {
        expect(param.enumValues, param.name).toBeUndefined()
      }
      if (ENUM_LABEL_PARAMS.includes(param.name)) {
        expect(param.enumLabels, param.name).toBeDefined()
      } else {
        expect(param.enumLabels, param.name).toBeUndefined()
      }
    }
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-get').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-get').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      if (param.name === 'session') continue
      expect(param.allowedFormats, param.name).toBeUndefined()
    }
  })
})

describe('Resource group', () => {
  it('declares resource_type as a Default/Custom enum defaulting to Default', () => {
    const resourceType = inputsByName('k8s-get').resource_type

    expect(resourceType.type).toBe('string')
    expect(resourceType.enumValues).toEqual(['default', 'custom'])
    expect(resourceType.enumLabels).toEqual({ default: 'Default', custom: 'Custom' })
    expect(resourceType.defaultValue).toBe('default')
    expect(resourceType.showWhen).toBeUndefined()
  })

  it('gates the two Kind widgets on opposite resource_type values', () => {
    const params = inputsByName('k8s-get')

    expect(params.kind.showWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.showWhen).toEqual(RESOURCE_CUSTOM)
    expect(params.kind.showWhenAll).toBeUndefined()
    expect(params.kind_custom.showWhenAll).toBeUndefined()
  })

  it('labels both Kind widgets Kind, under two different names', () => {
    const params = inputsByName('k8s-get')

    expect(params.kind.name).toBe('kind')
    expect(params.kind_custom.name).toBe('kind_custom')
    expect(params.kind.label).toBe('Kind')
    expect(params.kind_custom.label).toBe('Kind')
  })

  it('requires whichever Kind widget is showing', () => {
    const params = inputsByName('k8s-get')

    expect(params.kind.requiredWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.requiredWhen).toEqual(RESOURCE_CUSTOM)
  })

  it('renders the custom Kind as a plain string field with no enum data', () => {
    const kindCustom = inputsByName('k8s-get').kind_custom

    expect(kindCustom.type).toBe('string')
    expect(kindCustom.enumValues).toBeUndefined()
    expect(kindCustom.enumGroups).toBeUndefined()
    expect(kindCustom.enumSearchable).toBeUndefined()
  })

  it('declares search_by as the three-way Name/Selector/List enum defaulting to Name', () => {
    const searchBy = inputsByName('k8s-get').search_by

    expect(searchBy.type).toBe('string')
    expect(searchBy.enumValues).toEqual(['name', 'selector', 'list'])
    expect(searchBy.enumLabels).toEqual({ name: 'Name', selector: 'Selector', list: 'List' })
    expect(searchBy.defaultValue).toBe('name')
    expect(searchBy.showWhen).toBeUndefined()
  })

  it('shows Name only in Name mode and requires it there', () => {
    const name = inputsByName('k8s-get').name

    expect(name.showWhen).toEqual(SEARCH_BY_NAME)
    expect(name.requiredWhen).toEqual(SEARCH_BY_NAME)
  })

  it('shows the two selectors only in Selector mode, neither required', () => {
    const params = inputsByName('k8s-get')

    for (const name of ['label_selector', 'field_selector']) {
      expect(params[name].showWhen, name).toEqual(SEARCH_BY_SELECTOR)
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('declares two Output Format rows on one wire name, one per Search by mode', () => {
    const rows = inputsNamed('k8s-get', 'output_format')

    expect(rows).toHaveLength(2)
    const [nameMode, listMode] = rows

    expect(nameMode.showWhen).toEqual(SEARCH_BY_NAME)
    expect(listMode.showWhen).toEqual(SEARCH_BY_LIST_MODES)
    expect(nameMode.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_NAME)
    expect(listMode.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_LIST)
    expect(nameMode.description).toBe(
      'How Result comes back. Map is the parsed structure, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.',
    )
    expect(listMode.description).toBe(
      'How Result comes back. Array is the parsed list, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.',
    )
    for (const row of rows) {
      expect(row.type, row.label).toBe('string')
      expect(row.enumValues, row.label).toEqual(OUTPUT_FORMAT_VALUES)
      expect(row.defaultValue, row.label).toBe('map')
      expect(row.noExpression, row.label).toBe(true)
      expect(row.showWhenAll, row.label).toBeUndefined()
      expect(row.requiredWhen, row.label).toBeUndefined()
    }
  })
})

describe('Kind picker (K8SREAD-4, K8SREAD-5)', () => {
  it('declares the 23 kinds as one flat ordered string array', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumValues).toEqual(KIND_VALUES)
    expect(kind.enumValues).toHaveLength(23)
    expect(Array.isArray(kind.enumValues)).toBe(true)
    for (const value of kind.enumValues ?? []) {
      expect(typeof value, String(value)).toBe('string')
    }
  })

  it('partitions the kinds into the five headed groups, in order', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumGroups).toEqual(KIND_GROUPS)
    expect(kind.enumGroups?.map((g) => g.heading)).toEqual([
      'Workloads',
      'Networking',
      'Config',
      'Storage',
      'Cluster',
    ])
    expect(kind.enumGroups?.map((g) => g.values.length)).toEqual([7, 4, 3, 3, 6])
  })

  it('orders every group alphabetically', () => {
    const groups = inputsByName('k8s-get').kind.enumGroups ?? []

    expect(groups).toHaveLength(5)
    for (const group of groups) {
      expect([...group.values].sort(), group.heading).toEqual(group.values)
    }
  })

  it('keeps every grouped value inside enumValues, with no value in two groups', () => {
    const kind = inputsByName('k8s-get').kind
    const seen = new Set<string>()

    for (const group of kind.enumGroups ?? []) {
      for (const value of group.values) {
        expect(kind.enumValues, value).toContain(value)
        expect(seen.has(value), `${value} appears twice`).toBe(false)
        seen.add(value)
      }
    }
    expect(seen.size).toBe(23)
  })

  it('flattens the groups back to enumValues exactly', () => {
    const kind = inputsByName('k8s-get').kind

    expect((kind.enumGroups ?? []).flatMap((g) => g.values)).toEqual(kind.enumValues)
  })

  it('carries the kubectl short names as inline sublabels', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumSublabels).toEqual(KIND_SHORT_NAMES)
    expect(Object.keys(kind.enumSublabels ?? {})).toHaveLength(17)
    for (const key of Object.keys(kind.enumSublabels ?? {})) {
      expect(kind.enumValues, key).toContain(key)
    }
  })

  it('leaves the six kinds with no short name without a sublabel entry', () => {
    const sublabels = inputsByName('k8s-get').kind.enumSublabels ?? {}

    for (const name of KINDS_WITHOUT_SHORT_NAME) {
      expect(Object.prototype.hasOwnProperty.call(sublabels, name), name).toBe(false)
      expect(sublabels[name], name).toBeUndefined()
    }
  })

  it('omits Event, which the Events block owns', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumValues).not.toContain('Event')
    expect((kind.enumGroups ?? []).flatMap((g) => g.values)).not.toContain('Event')
  })

  it('opts the Kind row into the searchable picker', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumSearchable).toBe(true)
  })

  it('shows each kind by its own name and starts on Pod, one of the kinds it offers', () => {
    const kind = inputsByName('k8s-get').kind

    expect(kind.enumLabels).toBeUndefined()
    expect(kind.defaultValue).toBe('Pod')
    expect(kind.enumValues).toContain('Pod')
  })

  it('leaves every other row on the plain ungrouped select', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      if (param.name === 'kind') continue
      expect(param.enumGroups, param.name).toBeUndefined()
      expect(param.enumSearchable, param.name).toBeUndefined()
      expect(param.enumSublabels, param.name).toBeUndefined()
    }
  })
})

describe('Advanced group', () => {
  it('offers All namespaces only in Selector and List mode', () => {
    const allNamespaces = inputsByName('k8s-get').all_namespaces

    expect(allNamespaces.type).toBe('boolean')
    expect(allNamespaces.defaultValue).toBe(false)
    expect(allNamespaces.showWhen).toEqual(SEARCH_BY_LIST_MODES)
    expect(allNamespaces.showWhenAll).toBeUndefined()
  })

  it('shows Namespace whenever All namespaces is off, with no tick above it', () => {
    const namespace = inputsByName('k8s-get').namespace

    expect(namespace.type).toBe('string')
    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toEqual(ALL_NAMESPACES_OFF)
    expect(namespace.showWhenAll).toBeUndefined()
  })

  it('keeps the impersonation rows always visible at the foot of the group', () => {
    const params = inputsByName('k8s-get')

    for (const name of ['impersonate_user', 'impersonate_groups']) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-get').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.showWhen).toBeUndefined()
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on every structural row', () => {
    const structural = (getInputParams('k8s-get') ?? []).filter((p) =>
      NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(structural).toHaveLength(6)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('leaves every other row expression-capable', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      if (NO_EXPRESSION_PARAMS.includes(param.name)) continue
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains every conditionally-shown row except All namespaces', () => {
    const params = inputsByName('k8s-get')

    for (const name of RETAIN_ON_HIDE_PARAMS) {
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('drops All namespaces when a mode hides it, so no stale tick survives', () => {
    expect(inputsByName('k8s-get').all_namespaces.retainOnHide).not.toBe(true)
  })

  it('retains neither Output Format row, since hiding one twin strips the shared value at save', () => {
    const rows = inputsNamed('k8s-get', 'output_format')

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.retainOnHide, row.label).not.toBe(true)
    }
  })

  it('leaves retainOnHide off the always-visible rows', () => {
    const params = inputsByName('k8s-get')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].retainOnHide, name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-get').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    for (const param of getInputParams('k8s-get') ?? []) {
      if (param.name === 'session') continue
      expect(param.secret, param.name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-get')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual([
      'Connection',
      'Resource',
      'Advanced',
      'Failure Handling',
    ])
    for (const group of ['Connection', 'Resource']) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-get')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Resource footer', () => {
    expect(getGroupMeta('k8s-get')!.Resource.description).toBe(
      'Which kind to read, how to find it, and how it comes back',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-get')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-get')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state (K8SREAD-1)', () => {
  it('opens on Default resource type in Name mode', () => {
    expect(visibleNames({})).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'name',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({})).toEqual(['Map'])
  })

  it('swaps the picker for the plain Kind field on Custom', () => {
    expect(visibleNames({ resource_type: 'custom' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind_custom',
      'search_by',
      'name',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ resource_type: 'custom' })).toEqual(['Map'])
  })

  it('shows both selectors and All namespaces in Selector mode', () => {
    expect(visibleNames({ search_by: 'selector' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'label_selector',
      'field_selector',
      'output_format',
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ search_by: 'selector' })).toEqual(['Array'])
  })

  it('drops every target row in List mode', () => {
    expect(visibleNames({ search_by: 'list' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'output_format',
      'all_namespaces',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ search_by: 'list' })).toEqual(['Array'])
  })

  it('removes the Namespace row while All namespaces is ticked in Selector mode', () => {
    expect(visibleNames({ search_by: 'selector', all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'label_selector',
      'field_selector',
      'output_format',
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ search_by: 'selector', all_namespaces: true })).toEqual(['Array'])
  })

  it('removes the Namespace row while All namespaces is ticked in List mode', () => {
    expect(visibleNames({ search_by: 'list', all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'output_format',
      'all_namespaces',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ search_by: 'list', all_namespaces: true })).toEqual(['Array'])
  })

  it('would keep the Namespace row hidden if a ticked All namespaces survived into Name mode', () => {
    expect(visibleNames({ search_by: 'name', all_namespaces: true })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'search_by',
      'name',
      'output_format',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])

    expect(visibleFormatLabels({ search_by: 'name', all_namespaces: true })).toEqual(['Map'])
  })
})

describe('outputs', () => {
  it('declares the six outputs in order, gating Error and Reason on Record', () => {
    const outputs = getOutputParams('k8s-get') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    for (const output of outputs) {
      if (RECORD_GATED_OUTPUTS.includes(output.name)) {
        expect(output.showWhen, `showWhen of ${output.name}`).toEqual(RECORD_GATE)
        continue
      }
      expect(output.showWhen, `showWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('offers Error and Reason only once On error is Record and continue', () => {
    expect(visibleOutputs({})).toEqual(['result', 'names', 'count', 'success'])
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'result',
      'names',
      'count',
      'success',
      'error',
      'reason',
    ])
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-get')

    expect(outputs.result.label).toBe('Result')
    expect(outputs.names.label).toBe('Names')
    expect(outputs.count.label).toBe('Count')
    expect(outputs.success.label).toBe('Success')
    expect(outputs.error.label).toBe('Error')
    expect(outputs.reason.label).toBe('Reason')
  })

  it('flags no output secret, since the run registry masks read Secret values', () => {
    const outputs = getOutputParams('k8s-get') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-get') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact copy on the three outcome outputs', () => {
    const outputs = outputsByName('k8s-get')

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
})

describe("Result's declared type follows Output Format and Search by (K8SREAD-6)", () => {
  const EXPECTED_RULES: OutputTypeRule[] = [
    { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
    { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
    {
      when: [
        { field: 'output_format', values: ['map'] },
        { field: 'search_by', values: ['selector', 'list'] },
      ],
      type: 'array',
    },
  ]

  it('declares the three rules verbatim and in order on result', () => {
    const result = outputsByName('k8s-get').result

    expect(result.type).toBe('map')
    expect(result.typeWhen).toEqual(EXPECTED_RULES)
  })

  it('carries typeWhen on no other output', () => {
    for (const output of getOutputParams('k8s-get') ?? []) {
      if (output.name === 'result') continue
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('resolves to the static map type on a fresh block', () => {
    const result = outputsByName('k8s-get').result

    expect(resolveOutputType(result.type, result.typeWhen, {}, getInputParams('k8s-get') ?? [])).toBe(
      'map',
    )
  })

  it('resolves every Output Format and Search by pairing', () => {
    const result = outputsByName('k8s-get').result
    const matrix: [string, string, string][] = [
      ['map', 'name', 'map'],
      ['map', 'selector', 'array'],
      ['map', 'list', 'array'],
      ['table', 'name', 'table'],
      ['table', 'selector', 'table'],
      ['table', 'list', 'table'],
      ['json', 'name', 'string'],
      ['json', 'selector', 'string'],
      ['json', 'list', 'string'],
      ['yaml', 'name', 'string'],
      ['yaml', 'selector', 'string'],
      ['yaml', 'list', 'string'],
    ]

    for (const [format, searchBy, expected] of matrix) {
      expect(
        resolveOutputType(result.type, result.typeWhen, {
          output_format: format,
          search_by: searchBy,
        }),
        `${format} + ${searchBy}`,
      ).toBe(expected)
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Get palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-get')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Get')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('PackageSearch')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-get')?.remotable).toBe(true)
  })

  it('keeps PackageSearch registered in the palette icon registry', () => {
    expect(isValidIconName('PackageSearch')).toBe(true)
  })

  it('registers all three canvas maps for k8s-get', () => {
    expect(getIcon('k8s-get')).toBe(PackageSearch)
    expect(getIconName('k8s-get')).toBe('package-search')
    expect(getColorClass('k8s-get')).toBe('text-sky-500')
  })
})

// ============================================================================
// The two opt-in enum keys, registry-wide
// ============================================================================

describe('the searchable-picker keys stay opt-in registry-wide', () => {
  function everyInput(): { id: string; param: PickerParam }[] {
    return Object.entries(ALL_INPUTS).flatMap(([id, params]) =>
      (params as PickerParam[]).map((param) => ({ id, param })),
    )
  }

  it('is set by the three K8s kind pickers alone, on no other descriptor (K8SREAD-11)', () => {
    const optedIn = everyInput()
      .filter(({ param }) => param.enumGroups !== undefined || param.enumSearchable !== undefined)
      .map(({ id, param }) => `${id}.${param.name}`)

    expect(optedIn).toEqual(['k8s-get.kind', 'k8s-events.object_kind', 'k8s-delete.kind'])
  })

  it('keeps enumValues a flat ordered string array on every descriptor', () => {
    // clampSibling, notAbove and the halt scope filter all read enumValues as an
    // ordered scale; a nested shape would break them.
    for (const { id, param } of everyInput()) {
      if (param.enumValues === undefined) continue
      expect(Array.isArray(param.enumValues), `${id}.${param.name}`).toBe(true)
      for (const value of param.enumValues) {
        expect(typeof value, `${id}.${param.name}`).toBe('string')
      }
    }
  })
})
