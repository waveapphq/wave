/**
 * K8s Delete plugin parameter schema tests (K8SWRITE-5, K8SWRITE-8, K8SREAD-4,
 * K8SREAD-5).
 *
 * Delete removes one kind either by name or by label selector (K8SWRITE-5).
 * Resource Type swaps the Kind row between the grouped searchable picker and a
 * plain string field, two params with the same label under two names, exactly
 * as the Get block ships them (K8SREAD-4, K8SREAD-5). This file pins every row
 * the sheet shows in each state, the kubectl-parity options Cascade, Grace
 * Period and Wait until gone, and the six outputs with the two that the
 * On error mode gates (K8SWRITE-8).
 */

import { describe, it, expect } from 'vitest'
import { Trash2 } from 'lucide-react'
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

/** The rows the parameter table renders for one set of field values. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-delete') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

function visibleInGroup(group: string, values: Record<string, unknown>): string[] {
  const all = (getInputParams('k8s-delete') ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.group === group && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The outputs the OUTPUT VARIABLES table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-delete') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-delete') ?? [])
    .filter((o) => !o.showWhen || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const DELETE_PARAM_ORDER = [
  'session',
  'timeout',
  'resource_type',
  'kind',
  'kind_custom',
  'delete_by',
  'name',
  'label_selector',
  'ignore_not_found',
  'cascade',
  'grace_period_seconds',
  'wait_until_gone',
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
  'delete_by',
  'name',
  'label_selector',
  'ignore_not_found',
  'cascade',
  'grace_period_seconds',
  'wait_until_gone',
]

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_PARAMS = ['on_error']

const RESOURCE_DEFAULT = { field: 'resource_type', values: ['default'] }
const RESOURCE_CUSTOM = { field: 'resource_type', values: ['custom'] }
const DELETE_BY_NAME = { field: 'delete_by', values: ['name'] }
const DELETE_BY_SELECTOR = { field: 'delete_by', values: ['selector'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const CASCADE_VALUES = ['background', 'foreground', 'orphan']
const CASCADE_LABELS = {
  background: 'Background',
  foreground: 'Foreground',
  orphan: 'Orphan',
}

// kind carries an enum list but no labels - the label is the value itself.
const ENUM_LIST_PARAMS = ['resource_type', 'kind', 'delete_by', 'cascade', 'on_error']
const ENUM_LABEL_PARAMS = ['resource_type', 'delete_by', 'cascade', 'on_error']

// The four rows the two modes swap are the only conditionally-required ones.
const REQUIRED_WHEN_PARAMS = ['kind', 'kind_custom', 'name', 'label_selector']

// A row that gates which other rows the form shows cannot take an expression.
const NO_EXPRESSION_PARAMS = ['resource_type', 'delete_by', 'cascade', 'on_error']

const RETAIN_ON_HIDE_PARAMS = ['kind', 'kind_custom', 'name', 'label_selector']

const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'resource_type',
  'delete_by',
  'cascade',
  'grace_period_seconds',
  'wait_until_gone',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

// Keys no K8s verb block declares on any row.
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
  delete_by: 'Delete by',
  name: 'Name',
  label_selector: 'Label Selector',
  ignore_not_found: 'Ignore not found',
  cascade: 'Cascade',
  grace_period_seconds: 'Grace Period (s)',
  wait_until_gone: 'Wait until gone',
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
  delete_by: 'string',
  name: 'string',
  label_selector: 'string',
  ignore_not_found: 'boolean',
  cascade: 'string',
  grace_period_seconds: 'integer',
  wait_until_gone: 'boolean',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 30,
  resource_type: 'default',
  kind: 'Pod',
  kind_custom: undefined,
  delete_by: 'name',
  name: undefined,
  label_selector: undefined,
  ignore_not_found: false,
  cascade: 'background',
  grace_period_seconds: undefined,
  wait_until_gone: true,
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
    'Default offers the kinds a stock cluster serves. Custom takes any other kind as plain text, including custom resources.',
  kind: 'The resource kind, as kubectl names it. Search the list, or switch Resource Type to Custom to type one that is not in it.',
  kind_custom:
    "The kind exactly as the cluster names it. A kind this cluster does not serve fails the block.",
  delete_by: 'Delete one object by name, or every object that matches a selector.',
  name: "The object's name. A name that is already gone is an error, exactly as in kubectl, unless Ignore not found is ticked.",
  label_selector:
    'Match objects by label, like app=web or tier in (a,b). Every object that matches is deleted.',
  ignore_not_found:
    "Treat a name that is already gone as a success instead of an error. Same as kubectl's --ignore-not-found.",
  cascade:
    'Background returns at once and the cluster removes the children after. Foreground waits until the children are gone. Orphan leaves them running.',
  grace_period_seconds:
    "How long the object gets to shut down. 0 removes it immediately. Leave empty for the kind's own default.",
  wait_until_gone:
    "Keep checking until the object is really gone, within the block's timeout. kubectl waits by default; untick to return as soon as the cluster accepts the delete.",
  namespace:
    'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Node or PersistentVolume.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const OUTPUT_ORDER = [
  ['summary', 'table'],
  ['names', 'array'],
  ['count', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  names: 'Names',
  count: 'Count',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const CORE_DESCRIPTIONS: Record<string, string> = {
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  summary: 'One row per object: the resource and what happened to it, as kubectl prints it.',
  names: 'The names of the objects deleted, in the order the cluster reported them',
  count: 'How many objects were deleted; 0 when a selector matched nothing',
  ...CORE_DESCRIPTIONS,
}

const GATED_OUTPUTS = ['error', 'reason']

describe('registration', () => {
  it('registers k8s-delete in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-delete']).toBeDefined()
  })

  it('registers k8s-delete in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-delete']).toBeDefined()
  })

  it('registers k8s-delete in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-delete']).toBeDefined()
  })

  it('resolves k8s-delete via hasNodeParams', () => {
    expect(hasNodeParams('k8s-delete')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 16 input params in the pinned order', () => {
    expect((getInputParams('k8s-delete') ?? []).map((p) => p.name)).toEqual(DELETE_PARAM_ORDER)
    expect(getInputParams('k8s-delete') ?? []).toHaveLength(16)
  })

  it('gives every row its own wire name, with no name declared twice', () => {
    const names = (getInputParams('k8s-delete') ?? []).map((p) => p.name)

    expect(names).toHaveLength(16)
    expect(new Set(names).size).toBe(16)
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const params = inputsByName('k8s-delete')

    for (const name of CONNECTION_PARAMS) {
      expect(params[name].group, name).toBe('Connection')
    }
  })

  it('assigns the Resource group to the verb rows', () => {
    const params = inputsByName('k8s-delete')

    for (const name of RESOURCE_PARAMS) {
      expect(params[name].group, name).toBe('Resource')
    }
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const params = inputsByName('k8s-delete')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].group, name).toBe('Advanced')
    }
  })

  it('assigns the Failure Handling group to on_error', () => {
    const params = inputsByName('k8s-delete')

    for (const name of FAILURE_PARAMS) {
      expect(params[name].group, name).toBe('Failure Handling')
    }
  })

  it('marks only session required, leaving the mode rows to requiredWhen', () => {
    const params = inputsByName('k8s-delete')

    expect(params.session.required).toBe(true)
    for (const name of DELETE_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].required, name).toBe(false)
    }
  })

  it('types every parameter exactly', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('labels every parameter for display', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      expect(params[name].label, name).toBe(PARAM_LABELS[name])
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-delete') ?? []

    expect(inputs).toHaveLength(DELETE_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every parameter', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('declares the exact default for every parameter', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      expect(params[name].defaultValue, name).toBe(PARAM_DEFAULTS[name])
    }
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-delete')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('uses no conjunctive gate at all, every gate being single', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('conditionally requires the four mode-swapped rows and nothing else', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      if (REQUIRED_WHEN_PARAMS.includes(name)) {
        expect(params[name].requiredWhen, name).toBeDefined()
        continue
      }
      expect(params[name].requiredWhen, name).toBeUndefined()
    }
  })

  it('declares an enum list on five rows and enum labels on four of them', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
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

  it('declares none of the editor keys this family never uses', () => {
    const inputs = getInputParams('k8s-delete') ?? []

    expect(inputs).toHaveLength(DELETE_PARAM_ORDER.length)
    for (const param of inputs) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(param[key], `${param.name}.${key}`).toBeUndefined()
      }
    }
  })

  it('offers no Output Format row, the deleted object never being surfaced', () => {
    const inputs = getInputParams('k8s-delete') ?? []

    expect(inputs).toHaveLength(DELETE_PARAM_ORDER.length)
    expect(inputs.filter((p) => p.name === 'output_format')).toEqual([])
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-delete').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-delete').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('Resource group (K8SWRITE-5)', () => {
  it('declares resource_type as a Default/Custom enum defaulting to Default', () => {
    const resourceType = inputsByName('k8s-delete').resource_type

    expect(resourceType.type).toBe('string')
    expect(resourceType.enumValues).toEqual(['default', 'custom'])
    expect(resourceType.enumLabels).toEqual({ default: 'Default', custom: 'Custom' })
    expect(resourceType.defaultValue).toBe('default')
    expect(resourceType.showWhen).toBeUndefined()
  })

  it('gates the two Kind widgets on opposite resource_type values', () => {
    const params = inputsByName('k8s-delete')

    expect(params.kind.showWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.showWhen).toEqual(RESOURCE_CUSTOM)
    expect(params.kind.showWhenAll).toBeUndefined()
    expect(params.kind_custom.showWhenAll).toBeUndefined()
  })

  it('labels both Kind widgets Kind, under two different names', () => {
    const params = inputsByName('k8s-delete')

    expect(params.kind.name).toBe('kind')
    expect(params.kind_custom.name).toBe('kind_custom')
    expect(params.kind.label).toBe('Kind')
    expect(params.kind_custom.label).toBe('Kind')
  })

  it('requires whichever Kind widget is showing', () => {
    const params = inputsByName('k8s-delete')

    expect(params.kind.requiredWhen).toEqual(RESOURCE_DEFAULT)
    expect(params.kind_custom.requiredWhen).toEqual(RESOURCE_CUSTOM)
  })

  it('renders the custom Kind as a plain string field with no enum data', () => {
    const kindCustom = inputsByName('k8s-delete').kind_custom

    expect(kindCustom.type).toBe('string')
    expect(kindCustom.enumValues).toBeUndefined()
    expect(kindCustom.enumGroups).toBeUndefined()
    expect(kindCustom.enumSearchable).toBeUndefined()
  })

  it('declares delete_by as the two-way Name/Selector enum defaulting to Name', () => {
    const deleteBy = inputsByName('k8s-delete').delete_by

    expect(deleteBy.type).toBe('string')
    expect(deleteBy.enumValues).toEqual(['name', 'selector'])
    expect(deleteBy.enumLabels).toEqual({ name: 'Name', selector: 'Selector' })
    expect(deleteBy.defaultValue).toBe('name')
    expect(deleteBy.showWhen).toBeUndefined()
  })

  it('shows Name only in Name mode and requires it there', () => {
    const name = inputsByName('k8s-delete').name

    expect(name.showWhen).toEqual(DELETE_BY_NAME)
    expect(name.requiredWhen).toEqual(DELETE_BY_NAME)
  })

  it('shows Label Selector only in Selector mode and requires it there', () => {
    const labelSelector = inputsByName('k8s-delete').label_selector

    expect(labelSelector.showWhen).toEqual(DELETE_BY_SELECTOR)
    expect(labelSelector.requiredWhen).toEqual(DELETE_BY_SELECTOR)
  })

  it('offers Ignore not found only in Name mode, unticked and never required', () => {
    const ignoreNotFound = inputsByName('k8s-delete').ignore_not_found

    expect(ignoreNotFound.type).toBe('boolean')
    expect(ignoreNotFound.defaultValue).toBe(false)
    expect(ignoreNotFound.showWhen).toEqual(DELETE_BY_NAME)
    expect(ignoreNotFound.showWhenAll).toBeUndefined()
    expect(ignoreNotFound.requiredWhen).toBeUndefined()
  })

  it('declares cascade as the three-way kubectl enum defaulting to Background', () => {
    const cascade = inputsByName('k8s-delete').cascade

    expect(cascade.type).toBe('string')
    expect(cascade.enumValues).toEqual(CASCADE_VALUES)
    expect(cascade.enumLabels).toEqual(CASCADE_LABELS)
    expect(cascade.defaultValue).toBe('background')
    expect(cascade.showWhen).toBeUndefined()
  })

  it('leaves Grace Period empty so the kind keeps its own default', () => {
    const gracePeriod = inputsByName('k8s-delete').grace_period_seconds

    expect(gracePeriod.type).toBe('integer')
    expect(gracePeriod.defaultValue).toBeUndefined()
    expect(gracePeriod.required).toBe(false)
    expect(gracePeriod.showWhen).toBeUndefined()
  })

  it('ticks Wait until gone by default, matching kubectl', () => {
    const waitUntilGone = inputsByName('k8s-delete').wait_until_gone

    expect(waitUntilGone.type).toBe('boolean')
    expect(waitUntilGone.defaultValue).toBe(true)
    expect(waitUntilGone.showWhen).toBeUndefined()
    expect(waitUntilGone.showWhenAll).toBeUndefined()
  })
})

describe('Kind picker (K8SREAD-4, K8SREAD-5)', () => {
  it('reads the one shared list, byte for byte identical to Get Kind', () => {
    const del = inputsByName('k8s-delete').kind
    const get = inputsByName('k8s-get').kind

    expect(del.enumValues).toEqual(get.enumValues)
    expect(del.enumGroups).toEqual(get.enumGroups)
    expect(del.enumSublabels).toEqual(get.enumSublabels)
  })

  it('offers the 23 kinds as one flat ordered string array', () => {
    const kind = inputsByName('k8s-delete').kind

    expect(kind.enumValues).toHaveLength(23)
    expect(Array.isArray(kind.enumValues)).toBe(true)
    for (const value of kind.enumValues ?? []) {
      expect(typeof value, String(value)).toBe('string')
    }
  })

  it('partitions the kinds into the five headed groups, in order', () => {
    const kind = inputsByName('k8s-delete').kind

    expect(kind.enumGroups?.map((g) => g.heading)).toEqual([
      'Workloads',
      'Networking',
      'Config',
      'Storage',
      'Cluster',
    ])
    expect(kind.enumGroups?.map((g) => g.values.length)).toEqual([7, 4, 3, 3, 6])
  })

  it('flattens the groups back to enumValues exactly', () => {
    const kind = inputsByName('k8s-delete').kind

    expect((kind.enumGroups ?? []).flatMap((g) => g.values)).toEqual(kind.enumValues)
  })

  it('carries the 17 kubectl short names as inline sublabels', () => {
    const kind = inputsByName('k8s-delete').kind

    expect(Object.keys(kind.enumSublabels ?? {})).toHaveLength(17)
    for (const key of Object.keys(kind.enumSublabels ?? {})) {
      expect(kind.enumValues, key).toContain(key)
    }
  })

  it('opts the Kind row into the searchable picker', () => {
    expect(inputsByName('k8s-delete').kind.enumSearchable).toBe(true)
  })

  it('shows each kind by its own name and starts on Pod, one of the kinds it offers', () => {
    const kind = inputsByName('k8s-delete').kind

    expect(kind.enumLabels).toBeUndefined()
    expect(kind.defaultValue).toBe('Pod')
    expect(kind.enumValues).toContain('Pod')
  })

  it('keeps the expression toggle on Kind, a value a test may compute', () => {
    expect(inputsByName('k8s-delete').kind.noExpression).toBeUndefined()
  })

  it('leaves every other row on the plain ungrouped select', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      if (name === 'kind') continue
      expect(params[name].enumGroups, name).toBeUndefined()
      expect(params[name].enumSearchable, name).toBeUndefined()
      expect(params[name].enumSublabels, name).toBeUndefined()
    }
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows always visible, in order', () => {
    const params = inputsByName('k8s-delete')

    expect(visibleInGroup('Advanced', {})).toEqual(ADVANCED_PARAMS)
    for (const name of ADVANCED_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('carries the exact info-badge copy on the three override rows', () => {
    const params = inputsByName('k8s-delete')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-delete').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
    expect(onError.showWhen).toBeUndefined()
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on every structural row', () => {
    const structural = (getInputParams('k8s-delete') ?? []).filter((p) =>
      NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(structural).toHaveLength(NO_EXPRESSION_PARAMS.length)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('leaves every other row expression-capable, both ticks included', () => {
    const rest = (getInputParams('k8s-delete') ?? []).filter(
      (p) => !NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(rest).toHaveLength(DELETE_PARAM_ORDER.length - NO_EXPRESSION_PARAMS.length)
    for (const param of rest) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains the four rows the two modes swap', () => {
    const swapped = (getInputParams('k8s-delete') ?? []).filter((p) =>
      RETAIN_ON_HIDE_PARAMS.includes(p.name),
    )

    expect(swapped).toHaveLength(RETAIN_ON_HIDE_PARAMS.length)
    for (const param of swapped) {
      expect(param.retainOnHide, param.name).toBe(true)
    }
  })

  it('drops Ignore not found when Selector mode hides it, so no stale tick turns a failure into a pass', () => {
    const ticks = (getInputParams('k8s-delete') ?? []).filter((p) => p.name === 'ignore_not_found')

    expect(ticks).toHaveLength(1)
    for (const param of ticks) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })

  it('leaves retainOnHide off the always-visible rows', () => {
    const rows = (getInputParams('k8s-delete') ?? []).filter((p) =>
      ALWAYS_VISIBLE_PARAMS.includes(p.name),
    )

    expect(rows).toHaveLength(ALWAYS_VISIBLE_PARAMS.length)
    for (const param of rows) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-delete').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    const params = inputsByName('k8s-delete')

    for (const name of DELETE_PARAM_ORDER) {
      if (name === 'session') continue
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-delete')

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
    expect(getGroupMeta('k8s-delete')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Resource footer', () => {
    expect(getGroupMeta('k8s-delete')!.Resource.description).toBe(
      'What to delete, and how thoroughly',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-delete')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-delete')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state (K8SWRITE-5)', () => {
  it('opens on Default resource type in Name mode', () => {
    expect(visibleNames({})).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'delete_by',
      'name',
      'ignore_not_found',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('swaps the picker for the plain Kind field on Custom', () => {
    expect(visibleNames({ resource_type: 'custom' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind_custom',
      'delete_by',
      'name',
      'ignore_not_found',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('replaces Name and Ignore not found with Label Selector in Selector mode', () => {
    expect(visibleNames({ delete_by: 'selector' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind',
      'delete_by',
      'label_selector',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('combines Custom and Selector mode without interference', () => {
    expect(visibleNames({ resource_type: 'custom', delete_by: 'selector' })).toEqual([
      'session',
      'timeout',
      'resource_type',
      'kind_custom',
      'delete_by',
      'label_selector',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('never shows both Kind rows at once, in any state', () => {
    const states: Record<string, unknown>[] = [
      {},
      { resource_type: 'custom' },
      { delete_by: 'selector' },
      { resource_type: 'custom', delete_by: 'selector' },
    ]

    for (const values of states) {
      const shown = visibleNames(values).filter((name) => name === 'kind' || name === 'kind_custom')
      expect(shown, JSON.stringify(values)).toHaveLength(1)
    }
  })

  it('keeps the Connection, Advanced and Failure Handling groups whole in every state', () => {
    for (const values of [
      {},
      { resource_type: 'custom' },
      { delete_by: 'selector' },
      { resource_type: 'custom', delete_by: 'selector' },
    ]) {
      expect(visibleInGroup('Connection', values), JSON.stringify(values)).toEqual(
        CONNECTION_PARAMS,
      )
      expect(visibleInGroup('Advanced', values), JSON.stringify(values)).toEqual(ADVANCED_PARAMS)
      expect(visibleInGroup('Failure Handling', values), JSON.stringify(values)).toEqual(
        FAILURE_PARAMS,
      )
    }
  })

  it('swaps only the Resource group between the two Delete by modes', () => {
    expect(visibleInGroup('Resource', {})).toEqual([
      'resource_type',
      'kind',
      'delete_by',
      'name',
      'ignore_not_found',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ])
    expect(visibleInGroup('Resource', { delete_by: 'selector' })).toEqual([
      'resource_type',
      'kind',
      'delete_by',
      'label_selector',
      'cascade',
      'grace_period_seconds',
      'wait_until_gone',
    ])
  })
})

describe('outputs', () => {
  it('declares the six outputs in order', () => {
    const outputs = getOutputParams('k8s-delete') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(6)
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-delete')

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(outputs[name].label, name).toBe(label)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-delete') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact copy on the three block outputs', () => {
    const outputs = outputsByName('k8s-delete')

    expect(outputs.summary.description).toBe(OUTPUT_DESCRIPTIONS.summary)
    expect(outputs.names.description).toBe(OUTPUT_DESCRIPTIONS.names)
    expect(outputs.count.description).toBe(OUTPUT_DESCRIPTIONS.count)
  })

  it('carries the shared core copy on Success, Error and Reason', () => {
    const outputs = outputsByName('k8s-delete')

    for (const [name, description] of Object.entries(CORE_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-delete') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('varies no output type with the sheet, so none carries typeWhen', () => {
    const outputs = getOutputParams('k8s-delete') ?? []

    expect(outputs).toHaveLength(6)
    for (const output of outputs) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating (K8SWRITE-8)', () => {
  it('gates Error and Reason on Record and continue', () => {
    const outputs = outputsByName('k8s-delete')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('leaves Success ungated, since it reports the outcome of every run', () => {
    expect(outputsByName('k8s-delete').success.showWhen).toBeUndefined()
  })

  it('gates Error and Reason and no other output', () => {
    const gated = (getOutputParams('k8s-delete') ?? [])
      .filter((o) => o.showWhen !== undefined)
      .map((o) => o.name)

    expect(gated).toEqual(GATED_OUTPUTS)
  })

  it('offers four outputs while On error is Fail the block', () => {
    expect(visibleOutputs({})).toEqual(['summary', 'names', 'count', 'success'])
  })

  it('offers all six outputs under Record and continue', () => {
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'summary',
      'names',
      'count',
      'success',
      'error',
      'reason',
    ])
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Delete palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-delete')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Delete')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('Trash2')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-delete')?.remotable).toBe(true)
  })

  it('keeps Trash2 registered in the palette icon registry', () => {
    expect(isValidIconName('Trash2')).toBe(true)
  })

  it('registers all three canvas maps for k8s-delete', () => {
    expect(getIcon('k8s-delete')).toBe(Trash2)
    expect(getIconName('k8s-delete')).toBe('trash-2')
    expect(getColorClass('k8s-delete')).toBe('text-sky-500')
  })
})
