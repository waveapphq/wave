/**
 * K8s Events plugin parameter schema tests (REQ-5.1.1, K8SREAD-6, 8, 9, 10, 11).
 *
 * Events reads the cluster's event stream, namespace-wide or scoped to one
 * object by the `scope_to_object` tick. The four filter rows (Event Type,
 * Event Reason, Max Age, Max Events) are always offered; `all_namespaces`
 * is always offered too, with no mode carve-out. The input `reason` and the
 * output `reason` share a name and are told apart by their labels.
 *
 * Object Type swaps the Kind row between the same grouped searchable picker
 * Get uses and a plain string field, two params with different names and the
 * same label (K8SREAD-11). Result's declared type follows Output Format
 * (K8SREAD-6).
 */

import { describe, it, expect } from 'vitest'
import { History } from 'lucide-react'
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
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import { isValidIconName } from '@/features/workbench/lib/icon-registry'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'
import {
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'

/** The two opt-in enum keys on the shared enum control (K8SREAD-11). */
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

/** The rows the sheet renders for one set of values, in declaration order. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-events') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

/** The output rows the sheet offers for one set of values, in declaration order. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-events') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-events') ?? [])
    .filter((o) => !o.showWhen || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const EVENTS_PARAM_ORDER = [
  'session',
  'timeout',
  'scope_to_object',
  'object_type',
  'object_kind',
  'object_kind_custom',
  'object_name',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const CONNECTION_PARAMS = ['session', 'timeout']

const EVENTS_PARAMS = [
  'scope_to_object',
  'object_type',
  'object_kind',
  'object_kind_custom',
  'object_name',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
]

const ADVANCED_PARAMS = [
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
]

const FAILURE_PARAMS = ['on_error']

const SCOPE_ON = { field: 'scope_to_object', values: ['true'] }
const ALL_NAMESPACES_OFF = { field: 'all_namespaces', values: ['false'] }
const OBJECT_DEFAULT = { field: 'object_type', values: ['default'] }
const OBJECT_CUSTOM = { field: 'object_type', values: ['custom'] }

const OBJECT_PARAMS = ['object_type', 'object_kind', 'object_kind_custom', 'object_name']

const KIND_ROWS = ['object_kind', 'object_kind_custom']

// Rows that gate which other rows the form shows carry no {x} toggle.
const NO_EXPRESSION_PARAMS = [
  'scope_to_object',
  'object_type',
  'output_format',
  'all_namespaces',
  'on_error',
]

// Everything else keeps the toggle, event_type included - it is a filter.
const EXPRESSION_PARAMS = EVENTS_PARAM_ORDER.filter(
  (name) => !NO_EXPRESSION_PARAMS.includes(name),
)

const CONDITIONAL_PARAMS = [
  'object_type',
  'object_kind',
  'object_kind_custom',
  'object_name',
  'namespace',
]

const UNCONDITIONAL_PARAMS = EVENTS_PARAM_ORDER.filter(
  (name) => !CONDITIONAL_PARAMS.includes(name),
)

const ENUM_PARAMS = ['object_type', 'object_kind', 'event_type', 'output_format', 'on_error']

// object_kind is the picker: an enum list whose label is the value itself.
const ENUM_LABEL_PARAMS = ['object_type', 'event_type', 'output_format', 'on_error']

const OBJECT_TYPE_VALUES = ['default', 'custom']
const OBJECT_TYPE_LABELS = { default: 'Default', custom: 'Custom' }

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

const EVENT_TYPE_VALUES = ['any', 'Warning', 'Normal']
const EVENT_TYPE_LABELS = { any: 'Any', Warning: 'Warning', Normal: 'Normal' }
const OUTPUT_FORMAT_VALUES = ['map', 'table', 'json', 'yaml']
const OUTPUT_FORMAT_LABELS = { map: 'Array', table: 'Table', json: 'JSON', yaml: 'YAML' }
const ON_ERROR_VALUES = ['fail', 'record']
const ON_ERROR_LABELS = { fail: 'Fail the block', record: 'Record and continue' }

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  scope_to_object: 'boolean',
  object_type: 'string',
  object_kind: 'string',
  object_kind_custom: 'string',
  object_name: 'string',
  event_type: 'string',
  reason: 'string',
  within_seconds: 'integer',
  max_events: 'integer',
  output_format: 'string',
  all_namespaces: 'boolean',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  scope_to_object: 'Scope to object',
  object_type: 'Object Type',
  object_kind: 'Object Kind',
  object_kind_custom: 'Object Kind',
  object_name: 'Object Name',
  event_type: 'Event Type',
  reason: 'Event Reason',
  within_seconds: 'Max Age (s)',
  max_events: 'Max Events',
  output_format: 'Output Format',
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
  scope_to_object:
    'Return only the events about one object instead of every event in the namespace.',
  object_type:
    'Default offers the kinds a stock cluster serves. Custom takes any other kind as plain text, including custom resources.',
  object_kind:
    'The kind of the object the events are about. Search the list, or switch Object Type to Custom for a kind that is not in it.',
  object_kind_custom:
    'Any name kubectl accepts for the kind: HorizontalPodAutoscaler, hpa or horizontalpodautoscalers. A kind this cluster does not serve fails the block.',
  object_name:
    "The object's name. A deleted object of the same name still shows its events until the cluster discards them.",
  event_type: 'Keep both types, or only Warning, or only Normal.',
  reason: 'Keep only events with this reason, like BackOff, Unhealthy or FailedScheduling.',
  within_seconds:
    'Keep only events last seen within this many seconds. The cluster discards events after about an hour anyway.',
  max_events: 'Keep at most this many events, newest first.',
  output_format:
    'How Result comes back. Array is the parsed list, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.',
  all_namespaces: 'Read events from every namespace at once, instead of naming one.',
  namespace:
    'The namespace to read events from. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to read.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  timeout: 30,
  scope_to_object: false,
  object_type: 'default',
  object_kind: 'Pod',
  event_type: 'any',
  output_format: 'map',
  all_namespaces: false,
  on_error: 'fail',
}

const NO_DEFAULT_PARAMS = EVENTS_PARAM_ORDER.filter(
  (name) => !Object.keys(PARAM_DEFAULTS).includes(name),
)

const OUTPUT_ORDER = ['result', 'count', 'success', 'error', 'reason']

// The two failure rows are offered only when the block records the outcome.
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const GATED_OUTPUTS = ['error', 'reason']

const UNGATED_OUTPUTS = OUTPUT_ORDER.filter((name) => !GATED_OUTPUTS.includes(name))

// 5.7 Events state-to-UI table, one row per listed state.
const DEFAULT_STATE_ROWS = [
  'session',
  'timeout',
  'scope_to_object',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const SCOPED_STATE_ROWS = [
  'session',
  'timeout',
  'scope_to_object',
  'object_type',
  'object_kind',
  'object_name',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
  'all_namespaces',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const SCOPED_CUSTOM_STATE_ROWS = SCOPED_STATE_ROWS.map((name) =>
  name === 'object_kind' ? 'object_kind_custom' : name,
)

// Everything the sheet can show at once: the 17 rows less the hidden kind row.
const EVERY_ROW_DEFAULT_MODE = EVENTS_PARAM_ORDER.filter((name) => name !== 'object_kind_custom')

const ALL_NAMESPACES_STATE_ROWS = [
  'session',
  'timeout',
  'scope_to_object',
  'event_type',
  'reason',
  'within_seconds',
  'max_events',
  'output_format',
  'all_namespaces',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

describe('registration', () => {
  it('registers k8s-events in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-events']).toBeDefined()
  })

  it('registers k8s-events in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-events']).toBeDefined()
  })

  it('registers k8s-events in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-events']).toBeDefined()
  })

  it('resolves k8s-events via hasNodeParams', () => {
    expect(hasNodeParams('k8s-events')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 17 input params in the pinned order', () => {
    expect((getInputParams('k8s-events') ?? []).map((p) => p.name)).toEqual(EVENTS_PARAM_ORDER)
    expect(getInputParams('k8s-events') ?? []).toHaveLength(17)
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const params = inputsByName('k8s-events')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Events group to the scoping and filter rows', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAMS) {
      expect(params[name].group, name).toBe('Events')
    }
  })

  it('assigns the Advanced group to the namespace and impersonation rows', () => {
    const params = inputsByName('k8s-events')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName('k8s-events')

    for (const name of FAILURE_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('marks only session required', () => {
    const params = inputsByName('k8s-events')

    expect(params.session.required).toBe(true)
    for (const name of EVENTS_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].required, name).toBe(false)
    }
  })

  it('declares the type of every parameter', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-events') ?? []

    expect(inputs).toHaveLength(EVENTS_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy pinned by the wireframes', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('conditions none of the always-visible rows, session and timeout included', () => {
    const params = inputsByName('k8s-events')

    expect(UNCONDITIONAL_PARAMS).toContain('session')
    expect(UNCONDITIONAL_PARAMS).toContain('timeout')
    for (const name of UNCONDITIONAL_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('uses showWhenAll on the kind rows alone, every other gate being single', () => {
    const params = inputsByName('k8s-events')
    const conjunctive = [...KIND_ROWS]

    for (const name of EVENTS_PARAM_ORDER) {
      if (conjunctive.includes(name)) continue
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
    for (const name of conjunctive) {
      expect(params[name].showWhenAll, name).toHaveLength(2)
    }
    expect(params.namespace.showWhen).toEqual(ALL_NAMESPACES_OFF)
  })

  it('conditionally requires Object Name and the kind rows, and nothing else', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      if (name === 'object_name') {
        expect(params[name].requiredWhen, name).toEqual(SCOPE_ON)
        expect(params[name].requiredWhenAll, name).toBeUndefined()
        continue
      }
      if (KIND_ROWS.includes(name)) {
        expect(params[name].requiredWhen, name).toBeUndefined()
        expect(params[name].requiredWhenAll, name).toHaveLength(2)
        continue
      }
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('opts the Object Kind picker into grouping, search and sublabels, and no other row', () => {
    const params = inputsByName('k8s-events')

    expect(params.object_kind.enumGroups).toBeDefined()
    expect(params.object_kind.enumSearchable).toBe(true)
    expect(params.object_kind.enumSublabels).toBeDefined()
    for (const name of EVENTS_PARAM_ORDER) {
      if (name === 'object_kind') continue
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
    }
  })

  it('declares a default only on the rows that have one', () => {
    const params = inputsByName('k8s-events')

    for (const [name, value] of Object.entries(PARAM_DEFAULTS)) {
      expect(params[name].defaultValue, name).toBe(value)
    }
    for (const name of NO_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeUndefined()
    }
  })
})

describe('object scoping', () => {
  it('declares scope_to_object as a boolean defaulting to false', () => {
    const scope = inputsByName('k8s-events').scope_to_object

    expect(scope.type).toBe('boolean')
    expect(scope.defaultValue).toBe(false)
    expect(scope.showWhen).toBeUndefined()
    expect(scope.showWhenAll).toBeUndefined()
  })

  it('gates Object Type and Object Name behind the tick', () => {
    const params = inputsByName('k8s-events')

    for (const name of ['object_type', 'object_name']) {
      expect(params[name].showWhen, name).toEqual(SCOPE_ON)
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('gates the two kind rows behind the tick and the Object Type value (K8SREAD-11)', () => {
    const params = inputsByName('k8s-events')

    expect(params.object_kind.showWhen).toBeUndefined()
    expect(params.object_kind.showWhenAll).toEqual([SCOPE_ON, OBJECT_DEFAULT])
    expect(params.object_kind_custom.showWhen).toBeUndefined()
    expect(params.object_kind_custom.showWhenAll).toEqual([SCOPE_ON, OBJECT_CUSTOM])
  })

  it('requires Object Name only while the tick is on', () => {
    const objectName = inputsByName('k8s-events').object_name

    expect(objectName.required).toBe(false)
    expect(objectName.requiredWhen).toEqual(SCOPE_ON)
    expect(objectName.requiredWhenAll).toBeUndefined()
  })

  it('requires whichever kind row is showing, by the same conjunctive gate', () => {
    const params = inputsByName('k8s-events')

    expect(params.object_kind.required).toBe(false)
    expect(params.object_kind.requiredWhen).toBeUndefined()
    expect(params.object_kind.requiredWhenAll).toEqual([SCOPE_ON, OBJECT_DEFAULT])
    expect(params.object_kind_custom.required).toBe(false)
    expect(params.object_kind_custom.requiredWhen).toBeUndefined()
    expect(params.object_kind_custom.requiredWhenAll).toEqual([SCOPE_ON, OBJECT_CUSTOM])
  })

  it('retains the object rows while hidden', () => {
    const params = inputsByName('k8s-events')

    for (const name of OBJECT_PARAMS) {
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('declares Object Type as Default | Custom defaulting to Default', () => {
    const objectType = inputsByName('k8s-events').object_type

    expect(objectType.type).toBe('string')
    expect(objectType.enumValues).toEqual(OBJECT_TYPE_VALUES)
    expect(objectType.enumLabels).toEqual(OBJECT_TYPE_LABELS)
    expect(objectType.defaultValue).toBe('default')
    expect(objectType.noExpression).toBe(true)
    expect(objectType.showWhen).toEqual(SCOPE_ON)
    expect(objectType.requiredWhen).toBeUndefined()
    expect(objectType.requiredWhenAll).toBeUndefined()
  })

  it('declares Object Name and the custom kind row as plain strings', () => {
    const params = inputsByName('k8s-events')

    for (const name of ['object_name', 'object_kind_custom']) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].enumValues, name).toBeUndefined()
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
    }
  })

  it('labels both kind rows Object Kind', () => {
    const params = inputsByName('k8s-events')

    expect(params.object_kind.label).toBe('Object Kind')
    expect(params.object_kind_custom.label).toBe('Object Kind')
  })
})

describe('Object Kind picker (K8SREAD-4, K8SREAD-5, K8SREAD-11)', () => {
  it('declares the same 23 kinds as one flat ordered array', () => {
    const kind = inputsByName('k8s-events').object_kind

    expect(kind.enumValues).toEqual(KIND_VALUES)
    expect(kind.enumValues).toHaveLength(23)
  })

  it('partitions the kinds into the five headed groups, in order', () => {
    const kind = inputsByName('k8s-events').object_kind

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

  it('carries the 17 kubectl short names and leaves the other six bare', () => {
    const kind = inputsByName('k8s-events').object_kind

    expect(kind.enumSublabels).toEqual(KIND_SHORT_NAMES)
    expect(Object.keys(kind.enumSublabels ?? {})).toHaveLength(17)
    for (const name of KINDS_WITHOUT_SHORT_NAME) {
      expect(
        Object.prototype.hasOwnProperty.call(kind.enumSublabels ?? {}, name),
        name,
      ).toBe(false)
    }
  })

  it('is searchable, with no value labels, and starts on Pod, one of the kinds it offers', () => {
    const kind = inputsByName('k8s-events').object_kind

    expect(kind.enumSearchable).toBe(true)
    expect(kind.enumLabels).toBeUndefined()
    expect(kind.defaultValue).toBe('Pod')
    expect(kind.enumValues).toContain('Pod')
  })

  it('omits Event, the kind this block reads rather than scopes to', () => {
    const kind = inputsByName('k8s-events').object_kind

    expect(kind.enumValues).not.toContain('Event')
    expect((kind.enumGroups ?? []).flatMap((g) => g.values)).not.toContain('Event')
  })

  it('reads the one shared list, byte for byte identical to Get Kind', () => {
    const events = inputsByName('k8s-events').object_kind
    const get = inputsByName('k8s-get').kind

    expect(events.enumValues).toEqual(get.enumValues)
    expect(events.enumGroups).toEqual(get.enumGroups)
    expect(events.enumSublabels).toEqual(get.enumSublabels)
  })
})

describe('event filters', () => {
  it('declares event_type as any | Warning | Normal defaulting to any', () => {
    const eventType = inputsByName('k8s-events').event_type

    expect(eventType.type).toBe('string')
    expect(eventType.enumValues).toEqual(EVENT_TYPE_VALUES)
    expect(eventType.enumLabels).toEqual(EVENT_TYPE_LABELS)
    expect(eventType.defaultValue).toBe('any')
  })

  it('keeps the expression toggle on event_type, which filters rather than gates', () => {
    expect(inputsByName('k8s-events').event_type.noExpression).toBeUndefined()
  })

  it('offers the four filter rows in every state', () => {
    const params = inputsByName('k8s-events')

    for (const name of ['event_type', 'reason', 'within_seconds', 'max_events']) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
    }
  })

  it('declares the reason filter as a plain optional string labeled Event Reason', () => {
    const reason = inputsByName('k8s-events').reason

    expect(reason.type).toBe('string')
    expect(reason.required).toBe(false)
    expect(reason.label).toBe('Event Reason')
    expect(reason.enumValues).toBeUndefined()
    expect(reason.defaultValue).toBeUndefined()
  })

  it('declares the age and count limits as optional integers with no default', () => {
    const params = inputsByName('k8s-events')

    expect(params.within_seconds.type).toBe('integer')
    expect(params.within_seconds.label).toBe('Max Age (s)')
    expect(params.within_seconds.defaultValue).toBeUndefined()
    expect(params.max_events.type).toBe('integer')
    expect(params.max_events.label).toBe('Max Events')
    expect(params.max_events.defaultValue).toBeUndefined()
  })

  it('tells the reason input and the reason output apart by label', () => {
    expect(inputsByName('k8s-events').reason.label).toBe('Event Reason')
    expect(outputsByName('k8s-events').reason.label).toBe('Reason')
  })
})

describe('output format', () => {
  it('declares the same four formats as Get, offering the parsed list as Array', () => {
    const outputFormat = inputsByName('k8s-events').output_format

    expect(outputFormat.type).toBe('string')
    expect(outputFormat.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
    expect(outputFormat.enumLabels).toEqual(OUTPUT_FORMAT_LABELS)
    expect(outputFormat.defaultValue).toBe('map')
    expect(outputFormat.noExpression).toBe(true)
  })

  it('offers Output Format in every state, as the last row of the Events group', () => {
    const outputFormat = inputsByName('k8s-events').output_format

    expect(outputFormat.showWhen).toBeUndefined()
    expect(outputFormat.showWhenAll).toBeUndefined()
    expect(EVENTS_PARAMS[EVENTS_PARAMS.length - 1]).toBe('output_format')
  })
})

describe('Advanced group namespace rows', () => {
  it('always offers All namespaces on this block, with no mode carve-out', () => {
    const allNamespaces = inputsByName('k8s-events').all_namespaces

    expect(allNamespaces.type).toBe('boolean')
    expect(allNamespaces.defaultValue).toBe(false)
    expect(allNamespaces.showWhen).toBeUndefined()
    expect(allNamespaces.showWhenAll).toBeUndefined()
    expect(allNamespaces.noExpression).toBe(true)
  })

  it('shows Namespace whenever All namespaces is off, with no tick above it', () => {
    const namespace = inputsByName('k8s-events').namespace

    expect(namespace.type).toBe('string')
    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toEqual(ALL_NAMESPACES_OFF)
    expect(namespace.showWhenAll).toBeUndefined()
    expect(namespace.requiredWhen).toBeUndefined()
    expect(namespace.requiredWhenAll).toBeUndefined()
  })

  it('always offers the impersonation rows at the foot of Advanced', () => {
    const params = inputsByName('k8s-events')

    for (const name of ['impersonate_user', 'impersonate_groups']) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
    expect(ADVANCED_PARAMS.slice(-2)).toEqual(['impersonate_user', 'impersonate_groups'])
  })
})

describe('expression toggles', () => {
  it('drops the toggle on the rows that gate what the sheet shows', () => {
    const params = inputsByName('k8s-events')

    for (const name of NO_EXPRESSION_PARAMS) {
      expect(params[name].noExpression, name).toBe(true)
    }
  })

  it('keeps the toggle on every other row, filters included', () => {
    const params = inputsByName('k8s-events')

    for (const name of EXPRESSION_PARAMS) {
      expect(params[name].noExpression, name).toBeUndefined()
    }
    expect(EXPRESSION_PARAMS).toContain('event_type')
  })
})

describe('retainOnHide', () => {
  it('retains every conditionally-shown row', () => {
    const params = inputsByName('k8s-events')

    for (const name of CONDITIONAL_PARAMS) {
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('clears All namespaces instead of retaining it', () => {
    expect(inputsByName('k8s-events').all_namespaces.retainOnHide).not.toBe(true)
  })

  it('leaves the always-visible rows without a retain flag', () => {
    const params = inputsByName('k8s-events')

    for (const name of UNCONDITIONAL_PARAMS) {
      expect(params[name].retainOnHide, name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags the session param secret and locks it to plain', () => {
    const session = inputsByName('k8s-events').session

    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
  })

  it('does not flag any other param secret or format-locked', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-events')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual([
      'Connection',
      'Events',
      'Advanced',
      'Failure Handling',
    ])
    for (const groupName of ['Connection', 'Events']) {
      expect(meta![groupName].defaultExpanded, `${groupName} expanded`).toBe(true)
    }
    for (const groupName of ['Advanced', 'Failure Handling']) {
      expect(meta![groupName].defaultExpanded, `${groupName} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-events')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Events footer', () => {
    expect(getGroupMeta('k8s-events')!.Events.description).toBe(
      'Which events to keep, and how they come back',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-events')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-events')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('failure handling', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-events').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(ON_ERROR_VALUES)
    expect(onError.enumLabels).toEqual(ON_ERROR_LABELS)
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
    expect(onError.showWhen).toBeUndefined()
    expect(onError.showWhenAll).toBeUndefined()
  })

  it('declares an enum list on exactly five rows, value labels on four', () => {
    const params = inputsByName('k8s-events')

    for (const name of EVENTS_PARAM_ORDER) {
      if (ENUM_PARAMS.includes(name)) {
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
})

describe('outputs', () => {
  it('declares the five outputs in order with the core as the footer', () => {
    const outputs = getOutputParams('k8s-events') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual([
      ['result', 'array'],
      ['count', 'integer'],
      ['success', 'boolean'],
      ['error', 'string'],
      ['reason', 'string'],
    ])
    expect(outputs).toHaveLength(5)
  })

  it('offers Error and Reason only under Record and continue', () => {
    const outputs = getOutputParams('k8s-events') ?? []

    expect(outputs).toHaveLength(OUTPUT_ORDER.length)
    for (const output of outputs) {
      if (GATED_OUTPUTS.includes(output.name)) {
        expect(output.showWhen, `showWhen of ${output.name}`).toEqual(RECORD_GATE)
      } else {
        expect(output.showWhen, `showWhen of ${output.name}`).toBeUndefined()
      }
    }
  })

  it('offers three output rows on a fresh block and all five under Record and continue', () => {
    expect(visibleOutputs({})).toEqual(UNGATED_OUTPUTS)
    expect(visibleOutputs({})).toHaveLength(3)
    expect(visibleOutputs({ on_error: 'record' })).toEqual(OUTPUT_ORDER)
    expect(visibleOutputs({ on_error: 'record' })).toHaveLength(5)
  })

  it('labels every output for display', () => {
    const outputs = outputsByName('k8s-events')

    expect(outputs.result.label).toBe('Result')
    expect(outputs.count.label).toBe('Count')
    expect(outputs.success.label).toBe('Success')
    expect(outputs.error.label).toBe('Error')
    expect(outputs.reason.label).toBe('Reason')
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-events') ?? []

    expect(outputs).toHaveLength(OUTPUT_ORDER.length)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-events') ?? []

    expect(outputs).toHaveLength(OUTPUT_ORDER.length)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact core output copy for the (i) tooltip', () => {
    const outputs = outputsByName('k8s-events')

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

  it('carries the event list in result, with no separate events array', () => {
    const names = (getOutputParams('k8s-events') ?? []).map((o) => o.name)

    expect(names).toEqual(OUTPUT_ORDER)
    expect(names).not.toContain('events')
  })
})

describe("Result's declared type follows Output Format (K8SREAD-6)", () => {
  const EXPECTED_RULES: OutputTypeRule[] = [
    { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
    { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
  ]

  it('declares the two rules verbatim and in order on result', () => {
    const result = outputsByName('k8s-events').result

    expect(result.type).toBe('array')
    expect(result.typeWhen).toEqual(EXPECTED_RULES)
  })

  it('carries typeWhen on no other output', () => {
    for (const output of getOutputParams('k8s-events') ?? []) {
      if (output.name === 'result') continue
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('resolves to the static array type on a fresh block', () => {
    const result = outputsByName('k8s-events').result

    expect(
      resolveOutputType(result.type, result.typeWhen, {}, getInputParams('k8s-events') ?? []),
    ).toBe('array')
  })

  it('resolves every Output Format', () => {
    const result = outputsByName('k8s-events').result
    const matrix: [string, string][] = [
      ['map', 'array'],
      ['table', 'table'],
      ['json', 'string'],
      ['yaml', 'string'],
    ]

    for (const [format, expected] of matrix) {
      expect(
        resolveOutputType(result.type, result.typeWhen, { output_format: format }),
        format,
      ).toBe(expected)
    }
  })
})

describe('state-to-UI', () => {
  it('shows the namespace-wide rows on a freshly dropped block', () => {
    expect(visibleNames({})).toEqual(DEFAULT_STATE_ROWS)
  })

  it('adds Object Type, Object Kind and Object Name directly under Scope to object', () => {
    expect(visibleNames({ scope_to_object: true })).toEqual(SCOPED_STATE_ROWS)
  })

  it('swaps the picker for the plain kind row under Object Type Custom', () => {
    expect(visibleNames({ scope_to_object: true, object_type: 'custom' })).toEqual(
      SCOPED_CUSTOM_STATE_ROWS,
    )
  })

  it('never shows the two kind rows at once, in any scope and type pairing', () => {
    const states = [
      {},
      { object_type: 'custom' },
      { scope_to_object: true },
      { scope_to_object: true, object_type: 'custom' },
    ]

    for (const state of states) {
      const shown = visibleNames(state).filter((name) => KIND_ROWS.includes(name))
      expect(shown.length, JSON.stringify(state)).toBeLessThanOrEqual(1)
    }
    expect(visibleNames({ scope_to_object: true })).toContain('object_kind')
    expect(visibleNames({ scope_to_object: true, object_type: 'custom' })).toContain(
      'object_kind_custom',
    )
  })

  it('drops the Namespace row while All namespaces is ticked', () => {
    expect(visibleNames({ all_namespaces: true })).toEqual(ALL_NAMESPACES_STATE_ROWS)
  })

  it('shows every Default-mode row at once while scoping is on', () => {
    expect(visibleNames({ scope_to_object: true })).toEqual(EVERY_ROW_DEFAULT_MODE)
    expect(EVERY_ROW_DEFAULT_MODE).toHaveLength(16)
  })

  it('declares the same five outputs in every state, gating only on On error', () => {
    const outputs = getOutputParams('k8s-events') ?? []

    expect(outputs.map((o) => o.name)).toEqual(OUTPUT_ORDER)
    for (const state of [{}, { scope_to_object: true }, { all_namespaces: true }]) {
      expect(visibleOutputs(state), JSON.stringify(state)).toEqual(UNGATED_OUTPUTS)
      expect(visibleOutputs({ ...state, on_error: 'record' }), JSON.stringify(state)).toEqual(
        OUTPUT_ORDER,
      )
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Events palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-events')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Events')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('History')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-events')?.remotable).toBe(true)
  })

  it('keeps History registered in the palette icon registry', () => {
    expect(isValidIconName('History')).toBe(true)
  })

  it('registers all three canvas maps for k8s-events', () => {
    expect(getIcon('k8s-events')).toBe(History)
    expect(getIconName('k8s-events')).toBe('history')
    expect(getColorClass('k8s-events')).toBe('text-sky-500')
  })
})
