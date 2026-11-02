/**
 * K8s Apply plugin parameter schema tests (K8SWRITE-1, K8SWRITE-3, K8SWRITE-4).
 *
 * Apply writes one object from a pasted manifest, or from a short form for one
 * of three kinds. The form path splits the Data map into one descriptor per
 * kind and per Secret type, so the quick-insert key names follow the chosen
 * Secret type, and it splits Output Format in two so the first option reads
 * Map for a form and Array for a manifest. ConfigMap data stores under `data`
 * and Secret data under `secret_data`, so the run can mask the Secret values
 * without touching ConfigMap ones; the three Secret descriptors share
 * `secret_data`, and the two Output Format descriptors share `output_format`.
 * This file pins the 22 descriptors under 19 wire names, every row the sheet
 * shows in each state, and the seven outputs with their two gates.
 */

import { describe, it, expect } from 'vitest'
import { CloudUpload } from 'lucide-react'
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

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

/**
 * Every descriptor under one wire name, in declaration order. secret_data and
 * output_format are declared more than once, and inputsByName keeps the last.
 */
function inputsNamed(nodeId: string, name: string): InputParam[] {
  return (getInputParams(nodeId) ?? []).filter((p) => p.name === name)
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

/** The rows the parameter table renders for one set of field values. */
function visibleParams(values: Record<string, unknown>): InputParam[] {
  const all = (getInputParams('k8s-apply') ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)) as unknown as InputParam[]
}

function visibleNames(values: Record<string, unknown>): string[] {
  return visibleParams(values).map((p) => p.name)
}

/** The visible rows of one group, in declaration order. */
function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  return visibleParams(values)
    .filter((p) => p.group === groupName)
    .map((p) => p.name)
}

/** The visible descriptors sharing one wire name, at most one by construction. */
function visibleNamed(values: Record<string, unknown>, name: string): InputParam[] {
  return visibleParams(values).filter((p) => p.name === name)
}

/** The output rows the sheet offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-apply') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-apply') ?? [])
    .filter((o) => !o.showWhen || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const APPLY_PARAM_ORDER = [
  'session',
  'timeout',
  'define_with',
  'manifest',
  'kind',
  'name',
  'data',
  'secret_data',
  'secret_data',
  'secret_data',
  'secret_type',
  'job_from',
  'cronjob_name',
  'image',
  'command',
  'if_exists',
  'output_format',
  'output_format',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

/** The wire contract the backend declares: one field per name, 19 of them. */
const APPLY_WIRE_NAMES = [
  'session',
  'timeout',
  'define_with',
  'manifest',
  'kind',
  'name',
  'data',
  'secret_data',
  'secret_type',
  'job_from',
  'cronjob_name',
  'image',
  'command',
  'if_exists',
  'output_format',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

/** The two wire names carrying more than one descriptor. */
const PAIRED_NAMES = ['secret_data', 'output_format']

/** The two wire names the Data row stores under, ConfigMap first. */
const DATA_NAMES = ['data', 'secret_data']

/** The four Data descriptors in declaration order: ConfigMap, then the three Secret types. */
function dataDescriptors(): InputParam[] {
  return (getInputParams('k8s-apply') ?? []).filter((p) => DATA_NAMES.includes(p.name))
}

const CONNECTION_PARAMS = ['session', 'timeout']

const RESOURCE_PARAMS = [
  'define_with',
  'manifest',
  'kind',
  'name',
  'data',
  'secret_data',
  'secret_data',
  'secret_data',
  'secret_type',
  'job_from',
  'cronjob_name',
  'image',
  'command',
  'if_exists',
  'output_format',
  'output_format',
]

const ADVANCED_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

const FAILURE_PARAMS = ['on_error']

const DEFINE_MANIFEST = { field: 'define_with', values: ['manifest'] }
const DEFINE_FORM = { field: 'define_with', values: ['form'] }
const KIND_CONFIGMAP = { field: 'kind', values: ['ConfigMap'] }
const KIND_SECRET = { field: 'kind', values: ['Secret'] }
const KIND_JOB = { field: 'kind', values: ['Job'] }
const SECRET_TYPE_OPAQUE = { field: 'secret_type', values: ['Opaque'] }
const SECRET_TYPE_TLS = { field: 'secret_type', values: ['kubernetes.io/tls'] }
const SECRET_TYPE_DOCKERCONFIG = {
  field: 'secret_type',
  values: ['kubernetes.io/dockerconfigjson'],
}
const JOB_FROM_IMAGE = { field: 'job_from', values: ['image'] }
const JOB_FROM_CRONJOB = { field: 'job_from', values: ['cronjob'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const DEFINE_WITH_VALUES = ['manifest', 'form']
const DEFINE_WITH_LABELS = { manifest: 'Manifest', form: 'Form' }
const KIND_VALUES = ['ConfigMap', 'Secret', 'Job']
const SECRET_TYPE_VALUES = ['Opaque', 'kubernetes.io/tls', 'kubernetes.io/dockerconfigjson']
const JOB_FROM_VALUES = ['image', 'cronjob']
const JOB_FROM_LABELS = { image: 'Image', cronjob: 'CronJob' }
const IF_EXISTS_VALUES = ['update', 'fail']
const IF_EXISTS_LABELS = { update: 'Update', fail: 'Fail' }
const OUTPUT_FORMAT_VALUES = ['map', 'json', 'yaml']
const OUTPUT_FORMAT_LABELS_FORM = { map: 'Map', json: 'JSON', yaml: 'YAML' }
const OUTPUT_FORMAT_LABELS_MANIFEST = { map: 'Array', json: 'JSON', yaml: 'YAML' }
const ON_ERROR_VALUES = ['fail', 'record']
const ON_ERROR_LABELS = { fail: 'Fail the block', record: 'Record and continue' }

const TLS_QUICK_INSERTS = [
  {
    label: '+ Key',
    items: [
      { label: 'tls.crt', key: 'tls.crt', value: '' },
      { label: 'tls.key', key: 'tls.key', value: '' },
    ],
  },
]

const DOCKERCONFIG_QUICK_INSERTS = [
  {
    label: '+ Key',
    items: [{ label: '.dockerconfigjson', key: '.dockerconfigjson', value: '' }],
  },
]

const CONFIGMAP_DATA_DESCRIPTION =
  'The keys and values to store. Point a value at a secret variable to keep it out of the config.'

const SECRET_DATA_DESCRIPTION =
  'The keys and values to store. WAVE encodes them for you - do not paste base64. Values are hidden everywhere the run is recorded.'

const OUTPUT_FORMAT_FORM_DESCRIPTION =
  'How Result comes back. Map is the applied object, JSON and YAML the same object as text.'

const OUTPUT_FORMAT_MANIFEST_DESCRIPTION =
  'How Result comes back. Array is one applied object per document, JSON and YAML the same objects as text.'

const PARAM_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  define_with: 'Define with',
  manifest: 'Manifest',
  kind: 'Kind',
  name: 'Name',
  data: 'Data',
  secret_data: 'Data',
  secret_type: 'Secret Type',
  job_from: 'Job from',
  cronjob_name: 'CronJob Name',
  image: 'Image',
  command: 'Command',
  if_exists: 'If exists',
  output_format: 'Output Format',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  define_with: 'string',
  manifest: 'string',
  kind: 'string',
  name: 'string',
  data: 'map',
  secret_data: 'map',
  secret_type: 'string',
  job_from: 'string',
  cronjob_name: 'string',
  image: 'string',
  command: 'string',
  if_exists: 'string',
  output_format: 'string',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 30,
  define_with: 'manifest',
  manifest: undefined,
  kind: 'ConfigMap',
  name: undefined,
  data: undefined,
  secret_data: undefined,
  secret_type: 'Opaque',
  job_from: 'image',
  cronjob_name: undefined,
  image: undefined,
  command: undefined,
  if_exists: 'update',
  output_format: 'map',
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  on_error: 'fail',
}

// secret_data and output_format are absent: each carries several descriptors, so
// the strings are pinned in the pair's own test instead.
const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  define_with: 'Paste a manifest, or fill in a short form for one of the common kinds.',
  manifest:
    'The object to apply, as YAML or JSON. Several documents separated by --- are applied in order.',
  kind: 'The kind to build. Anything else goes in a manifest.',
  name: "The object's name.",
  data: CONFIGMAP_DATA_DESCRIPTION,
  secret_type:
    "The Secret's type. Kubernetes fixes this when the Secret is created and will not let it change.",
  job_from:
    'Run an image you name, or run an existing CronJob now without waiting for its schedule.',
  cronjob_name: 'The CronJob to copy. The Job runs the same thing the schedule would have run.',
  image:
    'The container image to run, like busybox:1.28 or registry.example.com/team/app:1.4.2.',
  command:
    'The command to run in the container. Write it as you would type it in a shell - quotes group arguments.',
  if_exists:
    'Update brings the object to match and can be run again safely. Fail creates it and refuses when it is already there.',
  namespace:
    'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Namespace. A manifest that names its own namespace wins.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const ENUM_LIST_PARAMS = [
  'define_with',
  'kind',
  'secret_type',
  'job_from',
  'if_exists',
  'output_format',
  'on_error',
]

// kind and secret_type show their values as-is; the label is the value itself.
const ENUM_LABEL_PARAMS = ['define_with', 'job_from', 'if_exists', 'output_format', 'on_error']

// Every enum on the sheet, Kind included: it decides which form rows render.
const NO_EXPRESSION_PARAMS = [
  'define_with',
  'kind',
  'secret_type',
  'job_from',
  'if_exists',
  'output_format',
  'on_error',
]

const RETAIN_ON_HIDE_PARAMS = [
  'manifest',
  'kind',
  'name',
  'secret_type',
  'job_from',
  'cronjob_name',
  'image',
  'command',
]

const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'define_with',
  'if_exists',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

const REQUIRED_WHEN_PARAMS = ['manifest', 'kind', 'name']
const REQUIRED_WHEN_ALL_PARAMS = ['cronjob_name', 'image']

/** Keys no row on this block declares. */
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

const OUTPUT_ORDER = [
  ['summary', 'table'],
  ['result', 'map'],
  ['names', 'array'],
  ['count', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  summary: 'Summary',
  result: 'Result',
  names: 'Names',
  count: 'Count',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  summary:
    'One row per object: the resource and what happened to it, as kubectl prints it. Created or configured - a server-side apply cannot tell an unchanged object from a changed one.',
  result:
    'What was applied. Its type follows Output Format: a map for a form, an array for a manifest, or text for JSON and YAML.',
  names: 'The names of the objects applied, in the order they were applied',
  count:
    'How many objects were applied; with a multi-document manifest, how many landed before a failure',
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

const CORE_DESCRIPTIONS = {
  success: OUTPUT_DESCRIPTIONS.success,
  error: OUTPUT_DESCRIPTIONS.error,
  reason: OUTPUT_DESCRIPTIONS.reason,
}

const RESULT_TYPE_WHEN: OutputTypeRule[] = [
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
  { when: [{ field: 'define_with', values: ['manifest'] }], type: 'array' },
]

/** Every Form-mode state of the sheet. */
const FORM_STATES: Record<string, unknown>[] = [
  { define_with: 'form' },
  { define_with: 'form', kind: 'ConfigMap' },
  { define_with: 'form', kind: 'Secret' },
  { define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/tls' },
  { define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/dockerconfigjson' },
  { define_with: 'form', kind: 'Job' },
  { define_with: 'form', kind: 'Job', job_from: 'cronjob' },
]

describe('registration', () => {
  it('registers k8s-apply in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-apply']).toBeDefined()
  })

  it('registers k8s-apply in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-apply']).toBeDefined()
  })

  it('registers k8s-apply in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-apply']).toBeDefined()
  })

  it('resolves k8s-apply via hasNodeParams', () => {
    expect(hasNodeParams('k8s-apply')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 22 descriptors in the pinned order', () => {
    expect((getInputParams('k8s-apply') ?? []).map((p) => p.name)).toEqual(APPLY_PARAM_ORDER)
    expect(getInputParams('k8s-apply') ?? []).toHaveLength(22)
  })

  it('sends exactly 19 wire names to the backend, Secret Data and Output Format once each', () => {
    const distinct = [...new Set((getInputParams('k8s-apply') ?? []).map((p) => p.name))]

    expect(distinct).toEqual(APPLY_WIRE_NAMES)
    expect(distinct).toHaveLength(19)
  })

  it('declares Secret Data three times and Output Format twice, every other name once', () => {
    expect(inputsNamed('k8s-apply', 'data')).toHaveLength(1)
    expect(inputsNamed('k8s-apply', 'secret_data')).toHaveLength(3)
    expect(inputsNamed('k8s-apply', 'output_format')).toHaveLength(2)
    for (const name of APPLY_WIRE_NAMES) {
      if (PAIRED_NAMES.includes(name)) continue
      expect(inputsNamed('k8s-apply', name), name).toHaveLength(1)
    }
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const names = (getInputParams('k8s-apply') ?? [])
      .filter((p) => p.group === 'Connection')
      .map((p) => p.name)

    expect(names).toEqual(CONNECTION_PARAMS)
  })

  it('assigns the Resource group to the verb rows', () => {
    const names = (getInputParams('k8s-apply') ?? [])
      .filter((p) => p.group === 'Resource')
      .map((p) => p.name)

    expect(names).toEqual(RESOURCE_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows', () => {
    const names = (getInputParams('k8s-apply') ?? [])
      .filter((p) => p.group === 'Advanced')
      .map((p) => p.name)

    expect(names).toEqual(ADVANCED_PARAMS)
  })

  it('assigns the Failure Handling group to on_error', () => {
    const names = (getInputParams('k8s-apply') ?? [])
      .filter((p) => p.group === 'Failure Handling')
      .map((p) => p.name)

    expect(names).toEqual(FAILURE_PARAMS)
  })

  it('marks only session required, leaving the mode rows to requiredWhen', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.required, param.name).toBe(param.name === 'session')
    }
  })

  it('describes every parameter for the info badge', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every unpaired parameter', () => {
    const unpaired = (getInputParams('k8s-apply') ?? []).filter(
      (p) => !PAIRED_NAMES.includes(p.name),
    )

    expect(unpaired).toHaveLength(17)
    for (const param of unpaired) {
      expect(param.description, param.name).toBe(PARAM_DESCRIPTIONS[param.name])
    }
  })

  it('labels every descriptor for display', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.label, param.name).toBe(PARAM_LABELS[param.name])
    }
  })

  it('types every descriptor exactly', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.type, param.name).toBe(PARAM_TYPES[param.name])
    }
  })

  it('declares the exact default for every descriptor', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.defaultValue, param.name).toBe(PARAM_DEFAULTS[param.name])
    }
  })

  it('conditions none of the always-visible rows', () => {
    const params = inputsByName('k8s-apply')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('locks only session and the Manifest editor to a format set', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      if (param.name === 'session') {
        expect(param.allowedFormats, param.name).toEqual(['plain'])
        continue
      }
      if (param.name === 'manifest') {
        expect(param.allowedFormats, param.name).toEqual(['yaml', 'json'])
        continue
      }
      expect(param.allowedFormats, param.name).toBeUndefined()
    }
  })

  it('declares an enum list on seven names and enum labels on five of them', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
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

  it('conditionally requires the mode-swapped rows and nothing else', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      if (REQUIRED_WHEN_PARAMS.includes(param.name)) {
        expect(param.requiredWhen, param.name).toBeDefined()
        expect(param.requiredWhenAll, param.name).toBeUndefined()
        continue
      }
      if (REQUIRED_WHEN_ALL_PARAMS.includes(param.name)) {
        expect(param.requiredWhenAll, param.name).toBeDefined()
        expect(param.requiredWhen, param.name).toBeUndefined()
        continue
      }
      expect(param.requiredWhen, param.name).toBeUndefined()
      expect(param.requiredWhenAll, param.name).toBeUndefined()
    }
  })

  it('declares none of the keys this block has no use for', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(param[key], `${param.name}.${key}`).toBeUndefined()
      }
    }
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-apply').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 30', () => {
    const timeout = inputsByName('k8s-apply').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(30)
    expect(timeout.required).toBe(false)
  })
})

describe('Resource group', () => {
  it('declares define_with as a Manifest/Form enum defaulting to Manifest', () => {
    const defineWith = inputsByName('k8s-apply').define_with

    expect(defineWith.type).toBe('string')
    expect(defineWith.enumValues).toEqual(DEFINE_WITH_VALUES)
    expect(defineWith.enumLabels).toEqual(DEFINE_WITH_LABELS)
    expect(defineWith.defaultValue).toBe('manifest')
    expect(defineWith.showWhen).toBeUndefined()
    expect(defineWith.showWhenAll).toBeUndefined()
  })

  it('shows the Manifest editor only in Manifest mode and requires it there', () => {
    const manifest = inputsByName('k8s-apply').manifest

    expect(manifest.showWhen).toEqual(DEFINE_MANIFEST)
    expect(manifest.showWhenAll).toBeUndefined()
    expect(manifest.requiredWhen).toEqual(DEFINE_MANIFEST)
    expect(manifest.requiredWhenAll).toBeUndefined()
    expect(manifest.allowedFormats).toEqual(['yaml', 'json'])
    expect(manifest.retainOnHide).toBe(true)
  })

  it('offers the three form kinds, defaulting to ConfigMap, only in Form mode', () => {
    const kind = inputsByName('k8s-apply').kind

    expect(kind.type).toBe('string')
    expect(kind.enumValues).toEqual(KIND_VALUES)
    expect(kind.enumLabels).toBeUndefined()
    expect(kind.defaultValue).toBe('ConfigMap')
    expect(kind.showWhen).toEqual(DEFINE_FORM)
    expect(kind.showWhenAll).toBeUndefined()
    expect(kind.requiredWhen).toEqual(DEFINE_FORM)
  })

  it('shows Name only in Form mode and requires it there', () => {
    const name = inputsByName('k8s-apply').name

    expect(name.type).toBe('string')
    expect(name.showWhen).toEqual(DEFINE_FORM)
    expect(name.showWhenAll).toBeUndefined()
    expect(name.requiredWhen).toEqual(DEFINE_FORM)
  })

  it('declares four Data rows across two wire names, gated so at most one can show', () => {
    const dataRows = dataDescriptors()

    expect(dataRows).toHaveLength(4)
    for (const row of dataRows) {
      expect(row.label).toBe('Data')
      expect(row.type).toBe('map')
      expect(row.required).toBe(false)
      expect(row.group).toBe('Resource')
      expect(row.defaultValue).toBeUndefined()
      expect(row.showWhen).toBeUndefined()
      expect(row.requiredWhen).toBeUndefined()
      expect(row.requiredWhenAll).toBeUndefined()
    }
    expect(dataRows.map((row) => row.showWhenAll)).toEqual([
      [DEFINE_FORM, KIND_CONFIGMAP],
      [DEFINE_FORM, KIND_SECRET, SECRET_TYPE_OPAQUE],
      [DEFINE_FORM, KIND_SECRET, SECRET_TYPE_TLS],
      [DEFINE_FORM, KIND_SECRET, SECRET_TYPE_DOCKERCONFIG],
    ])
  })

  it('stores ConfigMap data under data and every Secret data row under secret_data', () => {
    expect(dataDescriptors().map((row) => row.name)).toEqual([
      'data',
      'secret_data',
      'secret_data',
      'secret_data',
    ])
    expect(inputsNamed('k8s-apply', 'data')[0].showWhenAll).toEqual([
      DEFINE_FORM,
      KIND_CONFIGMAP,
    ])
    for (const row of inputsNamed('k8s-apply', 'secret_data')) {
      expect(row.showWhenAll?.slice(0, 2)).toEqual([DEFINE_FORM, KIND_SECRET])
    }
  })

  it('gives the ConfigMap Data row its own copy and the three Secret rows one shared copy', () => {
    const [configMapData, opaqueData, tlsData, dockerData] = dataDescriptors()

    expect(configMapData.description).toBe(CONFIGMAP_DATA_DESCRIPTION)
    expect(opaqueData.description).toBe(SECRET_DATA_DESCRIPTION)
    expect(tlsData.description).toBe(SECRET_DATA_DESCRIPTION)
    expect(dockerData.description).toBe(SECRET_DATA_DESCRIPTION)
  })

  it('offers the key names Kubernetes fixes for the chosen Secret type (K8SWRITE-3)', () => {
    const [configMapData, opaqueData, tlsData, dockerData] = dataDescriptors()

    expect(configMapData.quickInserts).toBeUndefined()
    expect(opaqueData.quickInserts).toBeUndefined()
    expect(tlsData.quickInserts).toEqual(TLS_QUICK_INSERTS)
    expect(dockerData.quickInserts).toEqual(DOCKERCONFIG_QUICK_INSERTS)
  })

  it('gives each Secret menu one + Key group whose items carry no sublabel', () => {
    const withMenus = inputsNamed('k8s-apply', 'secret_data').filter(
      (row) => row.quickInserts !== undefined,
    )

    expect(withMenus).toHaveLength(2)
    for (const [index, row] of withMenus.entries()) {
      const menus = row.quickInserts ?? []
      expect(menus, `menu count ${index}`).toHaveLength(1)
      expect(menus[0].label, `menu label ${index}`).toBe('+ Key')
      for (const item of menus[0].items) {
        expect(item.sublabel, item.key).toBeUndefined()
        expect(item.value, item.key).toBe('')
        expect(item.label, item.key).toBe(item.key)
      }
    }
  })

  it('declares secret_type as the three Kubernetes types defaulting to Opaque', () => {
    const secretType = inputsByName('k8s-apply').secret_type

    expect(secretType.type).toBe('string')
    expect(secretType.enumValues).toEqual(SECRET_TYPE_VALUES)
    expect(secretType.enumLabels).toBeUndefined()
    expect(secretType.defaultValue).toBe('Opaque')
    expect(secretType.showWhen).toBeUndefined()
    expect(secretType.showWhenAll).toEqual([DEFINE_FORM, KIND_SECRET])
    expect(secretType.requiredWhen).toBeUndefined()
    expect(secretType.retainOnHide).toBe(true)
  })

  it('declares job_from as an Image/CronJob enum defaulting to Image', () => {
    const jobFrom = inputsByName('k8s-apply').job_from

    expect(jobFrom.type).toBe('string')
    expect(jobFrom.enumValues).toEqual(JOB_FROM_VALUES)
    expect(jobFrom.enumLabels).toEqual(JOB_FROM_LABELS)
    expect(jobFrom.defaultValue).toBe('image')
    expect(jobFrom.showWhen).toBeUndefined()
    expect(jobFrom.showWhenAll).toEqual([DEFINE_FORM, KIND_JOB])
    expect(jobFrom.requiredWhen).toBeUndefined()
  })

  it('requires CronJob Name only while a Job is built from a CronJob', () => {
    const cronjobName = inputsByName('k8s-apply').cronjob_name

    expect(cronjobName.type).toBe('string')
    expect(cronjobName.showWhenAll).toEqual([DEFINE_FORM, KIND_JOB, JOB_FROM_CRONJOB])
    expect(cronjobName.requiredWhenAll).toEqual([DEFINE_FORM, KIND_JOB, JOB_FROM_CRONJOB])
    expect(cronjobName.showWhen).toBeUndefined()
    expect(cronjobName.requiredWhen).toBeUndefined()
  })

  it('requires Image only while a Job is built from an image', () => {
    const image = inputsByName('k8s-apply').image

    expect(image.type).toBe('string')
    expect(image.showWhenAll).toEqual([DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE])
    expect(image.requiredWhenAll).toEqual([DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE])
    expect(image.showWhen).toBeUndefined()
    expect(image.requiredWhen).toBeUndefined()
  })

  it('shows Command beside Image and never requires it', () => {
    const command = inputsByName('k8s-apply').command

    expect(command.type).toBe('string')
    expect(command.showWhen).toBeUndefined()
    expect(command.showWhenAll).toEqual([DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE])
    expect(command.requiredWhen).toBeUndefined()
    expect(command.requiredWhenAll).toBeUndefined()
  })

  it('declares if_exists as an Update/Fail enum defaulting to Update (K8SWRITE-1)', () => {
    const ifExists = inputsByName('k8s-apply').if_exists

    expect(ifExists.type).toBe('string')
    expect(ifExists.enumValues).toEqual(IF_EXISTS_VALUES)
    expect(ifExists.enumLabels).toEqual(IF_EXISTS_LABELS)
    expect(ifExists.defaultValue).toBe('update')
    expect(ifExists.showWhen).toBeUndefined()
    expect(ifExists.showWhenAll).toBeUndefined()
  })

  it('declares two Output Format rows on one wire name, gated on opposite modes', () => {
    const [formFormat, manifestFormat] = inputsNamed('k8s-apply', 'output_format')

    expect(formFormat.showWhen).toEqual(DEFINE_FORM)
    expect(manifestFormat.showWhen).toEqual(DEFINE_MANIFEST)
    for (const row of inputsNamed('k8s-apply', 'output_format')) {
      expect(row.label).toBe('Output Format')
      expect(row.type).toBe('string')
      expect(row.required).toBe(false)
      expect(row.group).toBe('Resource')
      expect(row.defaultValue).toBe('map')
      expect(row.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
      expect(row.noExpression).toBe(true)
      expect(row.showWhenAll).toBeUndefined()
      expect(row.requiredWhen).toBeUndefined()
      expect(row.requiredWhenAll).toBeUndefined()
    }
  })

  it('names the first option Map for a form and Array for a manifest', () => {
    const [formFormat, manifestFormat] = inputsNamed('k8s-apply', 'output_format')

    expect(formFormat.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_FORM)
    expect(manifestFormat.enumLabels).toEqual(OUTPUT_FORMAT_LABELS_MANIFEST)
    expect(formFormat.description).toBe(OUTPUT_FORMAT_FORM_DESCRIPTION)
    expect(manifestFormat.description).toBe(OUTPUT_FORMAT_MANIFEST_DESCRIPTION)
  })

  it('offers no Table option on either Output Format row', () => {
    const rows = inputsNamed('k8s-apply', 'output_format')

    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.enumValues, row.description).not.toContain('table')
      expect(Object.keys(row.enumLabels ?? {}), row.description).not.toContain('table')
    }
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows always visible', () => {
    const params = inputsByName('k8s-apply')

    for (const name of ADVANCED_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('carries the exact Namespace copy, naming the manifest as the winner', () => {
    expect(inputsByName('k8s-apply').namespace.description).toBe(PARAM_DESCRIPTIONS.namespace)
  })

  it('carries the write wording on the impersonation rows', () => {
    const params = inputsByName('k8s-apply')

    expect(params.impersonate_user.description).toBe(PARAM_DESCRIPTIONS.impersonate_user)
    expect(params.impersonate_groups.description).toBe(PARAM_DESCRIPTIONS.impersonate_groups)
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-apply').on_error

    expect(onError.type).toBe('string')
    expect(onError.enumValues).toEqual(ON_ERROR_VALUES)
    expect(onError.enumLabels).toEqual(ON_ERROR_LABELS)
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
    expect(onError.showWhen).toBeUndefined()
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on all eight enum descriptors', () => {
    const off = (getInputParams('k8s-apply') ?? []).filter((p) => p.noExpression === true)

    expect(off).toHaveLength(8)
    for (const param of off) {
      expect(NO_EXPRESSION_PARAMS, param.name).toContain(param.name)
    }
  })

  it('leaves every other descriptor expression-capable', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      if (NO_EXPRESSION_PARAMS.includes(param.name)) {
        expect(param.noExpression, param.name).toBe(true)
        continue
      }
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('retains the conditionally-shown form rows', () => {
    const retained = (getInputParams('k8s-apply') ?? []).filter((p) =>
      RETAIN_ON_HIDE_PARAMS.includes(p.name),
    )

    expect(retained).toHaveLength(RETAIN_ON_HIDE_PARAMS.length)
    for (const param of retained) {
      expect(param.retainOnHide, param.name).toBe(true)
    }
  })

  it('leaves the shared-name rows unretained, so no twin deletes the value the other shows', () => {
    const paired = (getInputParams('k8s-apply') ?? []).filter((p) =>
      PAIRED_NAMES.includes(p.name),
    )

    expect(paired).toHaveLength(5)
    for (const param of paired) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })

  it('leaves retainOnHide off every row it does not name, the ConfigMap Data row included', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      if (RETAIN_ON_HIDE_PARAMS.includes(param.name)) continue
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })

  it('leaves retainOnHide off the always-visible rows', () => {
    const params = inputsByName('k8s-apply')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].retainOnHide, name).not.toBe(true)
    }
  })
})

describe('secret flags (K8SWRITE-3)', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-apply').session.secret).toBe(true)
  })

  it('flags every Secret data row secret and leaves the ConfigMap one unflagged', () => {
    const [configMapData, ...secretData] = dataDescriptors()

    expect(configMapData.name).toBe('data')
    expect(configMapData.secret).toBeUndefined()
    expect(secretData).toHaveLength(3)
    for (const row of secretData) {
      expect(row.name).toBe('secret_data')
      expect(row.secret, row.name).toBe(true)
    }
  })

  it('keeps each flagged Secret data row a map, so it keeps the editor and its key menus', () => {
    const secretData = inputsNamed('k8s-apply', 'secret_data')

    for (const row of secretData) {
      expect(row.type, row.name).toBe('map')
    }
    expect(secretData.map((row) => row.quickInserts)).toEqual([
      undefined,
      TLS_QUICK_INSERTS,
      DOCKERCONFIG_QUICK_INSERTS,
    ])
  })

  it('flags nothing but session and the Secret data rows', () => {
    const inputs = getInputParams('k8s-apply') ?? []

    expect(inputs).toHaveLength(APPLY_PARAM_ORDER.length)
    for (const param of inputs) {
      if (param.name === 'session' || param.name === 'secret_data') continue
      expect(param.secret, param.name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-apply')

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
    expect(getGroupMeta('k8s-apply')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Resource footer', () => {
    expect(getGroupMeta('k8s-apply')!.Resource.description).toBe(
      'What to apply, and what to do when it is already there',
    )
  })

  it('carries the exact Advanced footer', () => {
    expect(getGroupMeta('k8s-apply')!.Advanced.description).toBe(
      'Namespace and identity for this block only, in place of what the session provides',
    )
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-apply')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state', () => {
  it('opens on the Manifest editor with no form row in sight', () => {
    expect(visibleNames({})).toEqual([
      'session',
      'timeout',
      'define_with',
      'manifest',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('swaps the editor for the ConfigMap form, Kind falling back to its default', () => {
    expect(visibleNames({ define_with: 'form' })).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'data',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('adds Secret Type below Data when the kind is Secret', () => {
    expect(visibleNames({ define_with: 'form', kind: 'Secret' })).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'secret_data',
      'secret_type',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('shows the same rows for a TLS Secret', () => {
    expect(
      visibleNames({ define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/tls' }),
    ).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'secret_data',
      'secret_type',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('shows the same rows for a dockerconfigjson Secret', () => {
    expect(
      visibleNames({
        define_with: 'form',
        kind: 'Secret',
        secret_type: 'kubernetes.io/dockerconfigjson',
      }),
    ).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'secret_data',
      'secret_type',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('offers Image and Command when the kind is Job (K8SWRITE-4)', () => {
    expect(visibleNames({ define_with: 'form', kind: 'Job' })).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'job_from',
      'image',
      'command',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('replaces Image and Command with CronJob Name when the Job comes from a CronJob', () => {
    expect(visibleNames({ define_with: 'form', kind: 'Job', job_from: 'cronjob' })).toEqual([
      'session',
      'timeout',
      'define_with',
      'kind',
      'name',
      'job_from',
      'cronjob_name',
      'if_exists',
      'output_format',
      'namespace',
      'impersonate_user',
      'impersonate_groups',
      'on_error',
    ])
  })

  it('keeps the Connection, Advanced and Failure Handling rows whole in every state', () => {
    for (const values of [{}, ...FORM_STATES]) {
      const label = JSON.stringify(values)
      expect(visibleInGroup('Connection', values), label).toEqual(CONNECTION_PARAMS)
      expect(visibleInGroup('Advanced', values), label).toEqual(ADVANCED_PARAMS)
      expect(visibleInGroup('Failure Handling', values), label).toEqual(FAILURE_PARAMS)
    }
  })

  it('shows exactly one Output Format row in every state, named for the mode', () => {
    const manifestRows = visibleNamed({}, 'output_format')

    expect(manifestRows).toHaveLength(1)
    expect(manifestRows[0].enumLabels).toEqual(OUTPUT_FORMAT_LABELS_MANIFEST)
    for (const values of FORM_STATES) {
      const label = JSON.stringify(values)
      const rows = visibleNamed(values, 'output_format')
      expect(rows, label).toHaveLength(1)
      expect(rows[0].enumLabels, label).toEqual(OUTPUT_FORMAT_LABELS_FORM)
    }
  })

  it('shows the Data row that matches the chosen kind and Secret type, and none elsewhere', () => {
    const dataRows = dataDescriptors()
    const cases: [Record<string, unknown>, number][] = [
      [{}, -1],
      [{ define_with: 'form' }, 0],
      [{ define_with: 'form', kind: 'ConfigMap' }, 0],
      [{ define_with: 'form', kind: 'Secret' }, 1],
      [{ define_with: 'form', kind: 'Secret', secret_type: 'Opaque' }, 1],
      [{ define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/tls' }, 2],
      [{ define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/dockerconfigjson' }, 3],
      [{ define_with: 'form', kind: 'Job' }, -1],
      [{ define_with: 'form', kind: 'Job', job_from: 'cronjob' }, -1],
    ]

    for (const [values, index] of cases) {
      const label = JSON.stringify(values)
      const visible = visibleParams(values).filter((p) => DATA_NAMES.includes(p.name))
      if (index < 0) {
        expect(visible, label).toHaveLength(0)
        continue
      }
      expect(visible, label).toHaveLength(1)
      expect(dataRows.indexOf(visible[0]), label).toBe(index)
    }
  })

  it('offers no key menu under a ConfigMap or an Opaque Secret', () => {
    expect(visibleNamed({ define_with: 'form' }, 'data')[0].quickInserts).toBeUndefined()
    expect(
      visibleNamed({ define_with: 'form', kind: 'Secret' }, 'secret_data')[0].quickInserts,
    ).toBeUndefined()
  })

  it('offers the TLS keys under a TLS Secret and the docker key under a dockerconfigjson one', () => {
    const tls = visibleNamed(
      { define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/tls' },
      'secret_data',
    )
    const docker = visibleNamed(
      { define_with: 'form', kind: 'Secret', secret_type: 'kubernetes.io/dockerconfigjson' },
      'secret_data',
    )

    expect((tls[0].quickInserts ?? []).flatMap((menu) => menu.items.map((i) => i.key))).toEqual([
      'tls.crt',
      'tls.key',
    ])
    expect(
      (docker[0].quickInserts ?? []).flatMap((menu) => menu.items.map((i) => i.key)),
    ).toEqual(['.dockerconfigjson'])
  })
})

describe('outputs', () => {
  it('declares the seven outputs in order, led by Summary', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(7)
  })

  it('labels every output', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs).toHaveLength(7)
    for (const output of outputs) {
      expect(output.label, output.name).toBe(OUTPUT_LABELS[output.name])
    }
  })

  it('describes every output for the tooltip', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs).toHaveLength(7)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('carries the exact output copy', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs).toHaveLength(7)
    for (const output of outputs) {
      expect(output.description, output.name).toBe(OUTPUT_DESCRIPTIONS[output.name])
    }
  })

  it('words the three shared outputs as the operation, not the read', () => {
    const outputs = outputsByName('k8s-apply')

    expect(outputs.success.description).toBe(CORE_DESCRIPTIONS.success)
    expect(outputs.error.description).toBe(CORE_DESCRIPTIONS.error)
    expect(outputs.reason.description).toBe(CORE_DESCRIPTIONS.reason)
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs).toHaveLength(7)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })
})

describe('output gating', () => {
  it('offers Error and Reason only under Record and continue', () => {
    const outputs = outputsByName('k8s-apply')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('keeps Success visible in both On error modes', () => {
    expect(outputsByName('k8s-apply').success.showWhen).toBeUndefined()
  })

  it('gates exactly Error and Reason, and gates them on On error', () => {
    const gated = Object.fromEntries(
      (getOutputParams('k8s-apply') ?? [])
        .filter((o) => o.showWhen)
        .map((o) => [o.name, o.showWhen!.field]),
    )

    expect(gated).toEqual({ error: 'on_error', reason: 'on_error' })
  })

  it('offers five outputs while On error fails the block', () => {
    expect(visibleOutputs({})).toEqual(['summary', 'result', 'names', 'count', 'success'])
  })

  it('offers all seven outputs under Record and continue', () => {
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'summary',
      'result',
      'names',
      'count',
      'success',
      'error',
      'reason',
    ])
  })
})

describe('Result type rules', () => {
  it('declares the two rules verbatim and in order on result', () => {
    const result = outputsByName('k8s-apply').result

    expect(result.type).toBe('map')
    expect(result.typeWhen).toEqual(RESULT_TYPE_WHEN)
  })

  it('carries typeWhen on no other output', () => {
    const outputs = getOutputParams('k8s-apply') ?? []

    expect(outputs).toHaveLength(7)
    for (const output of outputs) {
      if (output.name === 'result') continue
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })

  it('resolves to an array on a fresh block, where the mode is Manifest', () => {
    const result = outputsByName('k8s-apply').result

    expect(
      resolveOutputType(result.type, result.typeWhen, {}, getInputParams('k8s-apply') ?? []),
    ).toBe('array')
  })

  it('resolves every Output Format and Define with pairing', () => {
    const result = outputsByName('k8s-apply').result
    const matrix: [string, string, string][] = [
      ['map', 'form', 'map'],
      ['map', 'manifest', 'array'],
      ['json', 'form', 'string'],
      ['json', 'manifest', 'string'],
      ['yaml', 'form', 'string'],
      ['yaml', 'manifest', 'string'],
    ]

    for (const [format, defineWith, expected] of matrix) {
      expect(
        resolveOutputType(result.type, result.typeWhen, {
          output_format: format,
          define_with: defineWith,
        }),
        `${format} + ${defineWith}`,
      ).toBe(expected)
    }
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Apply palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-apply')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Apply')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('CloudUpload')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-apply')?.remotable).toBe(true)
  })

  it('keeps CloudUpload registered in the palette icon registry', () => {
    expect(isValidIconName('CloudUpload')).toBe(true)
  })

  it('registers all three canvas maps for k8s-apply', () => {
    expect(getIcon('k8s-apply')).toBe(CloudUpload)
    expect(getIconName('k8s-apply')).toBe('cloud-upload')
    expect(getColorClass('k8s-apply')).toBe('text-sky-500')
  })
})
