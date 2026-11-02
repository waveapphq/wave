/**
 * K8s Copy plugin parameter schema tests (K8SEXEC-4, K8SEXEC-5, K8SEXEC-6,
 * K8SEXEC-7, K8SEXEC-8, K8SEXEC-10).
 *
 * K8s Copy copies a file or directory between a pod and the WAVE side. Direction
 * stands in for kubectl's argument order, and Source Path and Target Path keep
 * their labels in both directions: each label is two rows gated on Direction
 * storing one field, so each info badge states truthfully which side it names.
 * The only unique output is the Summary table. Error and Reason
 * are offered for binding only under Record and continue.
 */

import { describe, it, expect } from 'vitest'
import { ArrowRightLeft } from 'lucide-react'
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

interface FileReferenceKeys {
  fileReference?: 'file' | 'file-or-folder' | 'folder' | 'save-as'
  fileReferenceArtifactsOnly?: boolean
}

function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

/** The two picker keys read off a row without widening the row to `unknown`. */
function fileRef(row: InputParam): FileReferenceKeys {
  return row as InputParam & FileReferenceKeys
}

/**
 * Every descriptor under one wire name, in declaration order. source_path and
 * target_path are declared twice each, and inputsByName keeps the last.
 */
function inputsNamed(nodeId: string, name: string): InputParam[] {
  return (getInputParams(nodeId) ?? []).filter((p) => p.name === name)
}

function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

/** The rows the parameter table renders for one set of field values. */
function visibleParams(values: Record<string, unknown>): InputParam[] {
  const all = (getInputParams('k8s-copy') ?? []) as unknown as Parameter[]
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

/** The outputs the binding table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const inputs = (getInputParams('k8s-copy') ?? []) as unknown as Parameter[]
  return (getOutputParams('k8s-copy') ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

const CP_PARAM_ORDER = [
  'session',
  'timeout',
  'direction',
  'pod',
  'container',
  'source_path',
  'source_path',
  'target_path',
  'target_path',
  'no_preserve',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'max_size_mib',
  'max_files',
  'on_error',
]

/** The wire contract the backend declares: one field per name, 14 of them. */
const CP_WIRE_NAMES = [
  'session',
  'timeout',
  'direction',
  'pod',
  'container',
  'source_path',
  'target_path',
  'no_preserve',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'max_size_mib',
  'max_files',
  'on_error',
]

/** The two wire names carrying two descriptors each. */
const PAIRED_NAMES = ['source_path', 'target_path']

const CONNECTION_PARAMS = ['session', 'timeout']

const COPY_PARAMS = [
  'direction',
  'pod',
  'container',
  'source_path',
  'source_path',
  'target_path',
  'target_path',
  'no_preserve',
]

const OVERRIDE_PARAMS = ['namespace', 'impersonate_user', 'impersonate_groups']

/** The copy limits, shown only on From Pod (K8SEXEC-10). */
const LIMIT_PARAMS = ['max_size_mib', 'max_files']

const ADVANCED_PARAMS = [...OVERRIDE_PARAMS, ...LIMIT_PARAMS]

const ADVANCED_FOOTER =
  'Namespace and identity in place of what the session provides, and size limits for copies from the pod'

const FAILURE_PARAMS = ['on_error']

const FROM_POD = { field: 'direction', values: ['from_pod'] }
const TO_POD = { field: 'direction', values: ['to_pod'] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const DIRECTION_VALUES = ['from_pod', 'to_pod']
const DIRECTION_LABELS = { from_pod: 'From Pod', to_pod: 'To Pod' }

const REQUIRED_PARAMS = [
  'session',
  'direction',
  'pod',
  'container',
  'source_path',
  'target_path',
]

const ENUM_LIST_PARAMS = ['direction', 'on_error']
const ENUM_LABEL_PARAMS = ['direction', 'on_error']

// Direction gates the four path rows and the two limits; On error gates the two core outputs.
const NO_EXPRESSION_PARAMS = ['direction', 'on_error']

// Every row but the two path pairs and the two limit rows shows in both directions.
const ALWAYS_VISIBLE_PARAMS = [
  'session',
  'timeout',
  'direction',
  'pod',
  'container',
  'no_preserve',
  'namespace',
  'impersonate_user',
  'impersonate_groups',
  'on_error',
]

/** The rows the sheet shows on From Pod, one descriptor per wire name. */
const CP_VISIBLE_ORDER = CP_WIRE_NAMES

/** The rows the sheet shows on To Pod: the From Pod rows without the two limits. */
const CP_TO_POD_VISIBLE_ORDER = CP_WIRE_NAMES.filter((name) => !LIMIT_PARAMS.includes(name))

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
  direction: 'Direction',
  pod: 'Pod',
  container: 'Container',
  source_path: 'Source Path',
  target_path: 'Target Path',
  no_preserve: 'No Preserve',
  namespace: 'Namespace',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  max_size_mib: 'Max size (MiB)',
  max_files: 'Max files',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  direction: 'string',
  pod: 'string',
  container: 'string',
  source_path: 'string',
  target_path: 'string',
  no_preserve: 'boolean',
  namespace: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  max_size_mib: 'integer',
  max_files: 'integer',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  session: undefined,
  timeout: 60,
  direction: 'from_pod',
  pod: undefined,
  container: undefined,
  source_path: undefined,
  target_path: undefined,
  no_preserve: false,
  namespace: undefined,
  impersonate_user: undefined,
  impersonate_groups: undefined,
  max_size_mib: 256,
  max_files: 10000,
  on_error: 'fail',
}

// source_path and target_path are absent: each carries two descriptors, so the
// strings are pinned in the pair's own test instead.
const PARAM_DESCRIPTIONS: Record<string, string> = {
  session:
    'The session from a K8s Connect block: server URL, credentials and default namespace',
  timeout: 'Request timeout in seconds',
  direction:
    'Which way the file moves: out of the pod onto the WAVE side, or from WAVE into the pod.',
  pod: 'The pod to copy from or to.',
  container:
    'Which container in the pod to use. Name it even when the pod has only one.',
  no_preserve:
    "Do not carry the file's permissions and ownership across. kubectl preserves them by default.",
  namespace:
    'The namespace the pod is in. Leave empty to use the namespace the session carries.',
  impersonate_user:
    "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
  impersonate_groups:
    'Send these group memberships with the impersonated user, comma separated.',
  max_size_mib:
    'Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
  max_files:
    'Most files a copy from the pod may write. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const SOURCE_FROM_POD_DESCRIPTION = 'The file or directory inside the pod to copy.'

const SOURCE_TO_POD_DESCRIPTION =
  'The file or directory on the WAVE side to copy: an artifact path, or an absolute or relative path where the block runs.'

const TARGET_FROM_POD_DESCRIPTION =
  'Where to put it on the WAVE side: an artifact path, or an absolute or relative path where the block runs.'

const TARGET_TO_POD_DESCRIPTION = 'Where to put it inside the pod.'

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
  'One row per file: where it came from, where it landed, and its size.'

// The Summary table's own row count carries what a Count would have said.
const DROPPED_OUTPUTS = ['count', 'names', 'paths']

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
  it('registers k8s-copy in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS['k8s-copy']).toBeDefined()
  })

  it('registers k8s-copy in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS['k8s-copy']).toBeDefined()
  })

  it('registers k8s-copy in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS['k8s-copy']).toBeDefined()
  })

  it('resolves k8s-copy via hasNodeParams', () => {
    expect(hasNodeParams('k8s-copy')).toBe(true)
  })
})

describe('schema surface: count, order, and groups', () => {
  it('declares exactly 16 descriptors in the pinned order', () => {
    expect((getInputParams('k8s-copy') ?? []).map((p) => p.name)).toEqual(CP_PARAM_ORDER)
    expect(getInputParams('k8s-copy') ?? []).toHaveLength(16)
  })

  it('sends exactly 14 wire names to the backend, each path name once', () => {
    const distinct = [...new Set((getInputParams('k8s-copy') ?? []).map((p) => p.name))]

    expect(distinct).toEqual(CP_WIRE_NAMES)
    expect(distinct).toHaveLength(14)
  })

  it('declares each path name twice and every other name once', () => {
    expect(inputsNamed('k8s-copy', 'source_path')).toHaveLength(2)
    expect(inputsNamed('k8s-copy', 'target_path')).toHaveLength(2)
    for (const name of CP_WIRE_NAMES) {
      if (PAIRED_NAMES.includes(name)) continue
      expect(inputsNamed('k8s-copy', name), name).toHaveLength(1)
    }
  })

  it('assigns the Connection group to the session and timeout rows', () => {
    const names = (getInputParams('k8s-copy') ?? [])
      .filter((p) => p.group === 'Connection')
      .map((p) => p.name)

    expect(names).toEqual(CONNECTION_PARAMS)
  })

  it('assigns the Copy group to the verb rows', () => {
    const names = (getInputParams('k8s-copy') ?? [])
      .filter((p) => p.group === 'Copy')
      .map((p) => p.name)

    expect(names).toEqual(COPY_PARAMS)
  })

  it('assigns the Advanced group to the per-block override rows and the two limit rows', () => {
    const names = (getInputParams('k8s-copy') ?? [])
      .filter((p) => p.group === 'Advanced')
      .map((p) => p.name)

    expect(names).toEqual(ADVANCED_PARAMS)
  })

  it('assigns the Failure Handling group to on_error', () => {
    const names = (getInputParams('k8s-copy') ?? [])
      .filter((p) => p.group === 'Failure Handling')
      .map((p) => p.name)

    expect(names).toEqual(FAILURE_PARAMS)
  })

  it('marks the session, Direction, Pod, Container and path rows required and nothing else', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.required, param.name).toBe(REQUIRED_PARAMS.includes(param.name))
    }
  })

  it('describes every descriptor for the info badge', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every unpaired parameter', () => {
    const unpaired = (getInputParams('k8s-copy') ?? []).filter(
      (p) => !PAIRED_NAMES.includes(p.name),
    )

    expect(unpaired).toHaveLength(12)
    for (const param of unpaired) {
      expect(param.description, param.name).toBe(PARAM_DESCRIPTIONS[param.name])
    }
  })

  it('labels every descriptor for display', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.label, param.name).toBe(PARAM_LABELS[param.name])
    }
  })

  it('types every descriptor exactly', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.type, param.name).toBe(PARAM_TYPES[param.name])
    }
  })

  it('declares the exact default for every descriptor', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.defaultValue, param.name).toBe(PARAM_DEFAULTS[param.name])
    }
  })

  it('conditions none of the rows outside the two path pairs and the two limit rows', () => {
    const params = inputsByName('k8s-copy')

    for (const name of ALWAYS_VISIBLE_PARAMS) {
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
      expect(params[name].requiredWhen, name).toBeUndefined()
      expect(params[name].requiredWhenAll, name).toBeUndefined()
    }
  })

  it('gates only the path rows and the two limit rows', () => {
    const gated = (getInputParams('k8s-copy') ?? [])
      .filter((p) => p.showWhen !== undefined)
      .map((p) => p.name)

    expect(gated).toEqual([...PAIRED_NAMES.flatMap((name) => [name, name]), ...LIMIT_PARAMS])
  })

  it('gates the two limit rows on From Pod', () => {
    const params = inputsByName('k8s-copy')

    for (const name of LIMIT_PARAMS) {
      expect(params[name].showWhen, name).toEqual(FROM_POD)
      expect(params[name].requiredWhen, name).toBeUndefined()
    }
  })

  it('uses no conjunctive gate at all, every gate being single', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.showWhenAll, param.name).toBeUndefined()
      expect(param.requiredWhenAll, param.name).toBeUndefined()
    }
  })

  it('requires the path rows outright rather than by condition', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.requiredWhen, param.name).toBeUndefined()
    }
  })

  it('declares an enum list and enum labels on Direction and On error', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
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

  it('leaves every row on the plain ungrouped select', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.enumGroups, param.name).toBeUndefined()
      expect(param.enumSearchable, param.name).toBeUndefined()
      expect(param.enumSublabels, param.name).toBeUndefined()
      expect(param.quickInserts, param.name).toBeUndefined()
    }
  })

  it('declares none of the keys this family never uses', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      for (const key of NEVER_DECLARED_KEYS) {
        expect(param[key], `${param.name}.${key}`).toBeUndefined()
      }
    }
  })
})

describe('Connection group', () => {
  it('declares session as the required plain-locked secret', () => {
    const session = inputsByName('k8s-copy').session

    expect(session.type).toBe('string')
    expect(session.required).toBe(true)
    expect(session.secret).toBe(true)
    expect(session.allowedFormats).toEqual(['plain'])
    expect(session.showWhen).toBeUndefined()
    expect(session.showWhenAll).toBeUndefined()
  })

  it('declares timeout as an integer defaulting to 60', () => {
    const timeout = inputsByName('k8s-copy').timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(60)
    expect(timeout.required).toBe(false)
  })

  it('locks no parameter other than session to a format', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      if (param.name === 'session') continue
      expect(param.allowedFormats, param.name).toBeUndefined()
    }
  })
})

describe('Copy group (K8SEXEC-5, K8SEXEC-7)', () => {
  it('declares Direction as a From Pod / To Pod enum defaulting to From Pod', () => {
    const direction = inputsByName('k8s-copy').direction

    expect(direction.type).toBe('string')
    expect(direction.required).toBe(true)
    expect(direction.enumValues).toEqual(DIRECTION_VALUES)
    expect(direction.enumLabels).toEqual(DIRECTION_LABELS)
    expect(direction.defaultValue).toBe('from_pod')
    expect(direction.noExpression).toBe(true)
    expect(direction.showWhen).toBeUndefined()
  })

  it('declares Pod as an always-required string with no gate', () => {
    const pod = inputsByName('k8s-copy').pod

    expect(pod.type).toBe('string')
    expect(pod.required).toBe(true)
    expect(pod.enumValues).toBeUndefined()
    expect(pod.showWhen).toBeUndefined()
  })

  it('declares Container as a required string with nothing to leave empty (K8SEXEC-9)', () => {
    const container = inputsByName('k8s-copy').container

    expect(container.type).toBe('string')
    expect(container.required).toBe(true)
    expect(container.defaultValue).toBeUndefined()
    expect(container.description).toBe(
      'Which container in the pod to use. Name it even when the pod has only one.',
    )
  })

  it('declares No Preserve as a boolean unticked by default, keeping its toggle', () => {
    const noPreserve = inputsByName('k8s-copy').no_preserve

    expect(noPreserve.type).toBe('boolean')
    expect(noPreserve.required).toBe(false)
    expect(noPreserve.defaultValue).toBe(false)
    expect(noPreserve.noExpression).not.toBe(true)
    expect(noPreserve.showWhen).toBeUndefined()
    expect(noPreserve.description).toBe(
      "Do not carry the file's permissions and ownership across. kubectl preserves them by default.",
    )
  })

  // kubectl cp's Retries flag is a deliberate parity exception (K8SEXEC-7).
  it('carries no Retries row', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    expect(inputs.map((p) => p.name)).not.toContain('retries')
  })
})

describe('the two path pairs', () => {
  it('declares two Source Path rows on one wire name, gated on opposite directions', () => {
    const [fromPod, toPod] = inputsNamed('k8s-copy', 'source_path')

    expect(fromPod.showWhen).toEqual(FROM_POD)
    expect(toPod.showWhen).toEqual(TO_POD)
    for (const row of inputsNamed('k8s-copy', 'source_path')) {
      expect(row.label).toBe('Source Path')
      expect(row.type).toBe('string')
      expect(row.required).toBe(true)
      expect(row.group).toBe('Copy')
      expect(row.defaultValue).toBeUndefined()
      expect(row.enumValues).toBeUndefined()
      expect(row.noExpression).not.toBe(true)
      expect(row.retainOnHide).not.toBe(true)
      expect(row.showWhenAll).toBeUndefined()
      expect(row.requiredWhen).toBeUndefined()
      expect(row.requiredWhenAll).toBeUndefined()
    }
  })

  it('declares two Target Path rows on one wire name, gated on opposite directions', () => {
    const [fromPod, toPod] = inputsNamed('k8s-copy', 'target_path')

    expect(fromPod.showWhen).toEqual(FROM_POD)
    expect(toPod.showWhen).toEqual(TO_POD)
    for (const row of inputsNamed('k8s-copy', 'target_path')) {
      expect(row.label).toBe('Target Path')
      expect(row.type).toBe('string')
      expect(row.required).toBe(true)
      expect(row.group).toBe('Copy')
      expect(row.defaultValue).toBeUndefined()
      expect(row.enumValues).toBeUndefined()
      expect(row.noExpression).not.toBe(true)
      expect(row.retainOnHide).not.toBe(true)
      expect(row.showWhenAll).toBeUndefined()
      expect(row.requiredWhen).toBeUndefined()
      expect(row.requiredWhenAll).toBeUndefined()
    }
  })


  it('browses only the WAVE side, in the mode that direction needs (TDATA-10)', () => {
    const [sourceFromPod, sourceToPod] = inputsNamed('k8s-copy', 'source_path')
    const [targetFromPod, targetToPod] = inputsNamed('k8s-copy', 'target_path')

    expect(fileRef(sourceToPod).fileReference).toBe('file-or-folder')
    expect(fileRef(targetFromPod).fileReference).toBe('save-as')

    expect(fileRef(sourceFromPod).fileReference).toBeUndefined()
    expect(fileRef(targetToPod).fileReference).toBeUndefined()
  })

  it('leaves the artifacts-only narrowing off every copy row', () => {
    for (const name of PAIRED_NAMES) {
      for (const row of inputsNamed('k8s-copy', name)) {
        expect(fileRef(row).fileReferenceArtifactsOnly, `${name}: ${row.description}`).toBeUndefined()
      }
    }
  })

  it('puts the picker on the two WAVE-side rows and nowhere else', () => {
    const withPicker = (getInputParams('k8s-copy') ?? []).filter(
      (p) => fileRef(p).fileReference !== undefined,
    )
    expect(withPicker.map((p) => p.name)).toEqual(['source_path', 'target_path'])
  })

  it('names the pod side and the WAVE side truthfully in each direction', () => {
    const [sourceFromPod, sourceToPod] = inputsNamed('k8s-copy', 'source_path')
    const [targetFromPod, targetToPod] = inputsNamed('k8s-copy', 'target_path')

    expect(sourceFromPod.description).toBe(SOURCE_FROM_POD_DESCRIPTION)
    expect(sourceToPod.description).toBe(SOURCE_TO_POD_DESCRIPTION)
    expect(targetFromPod.description).toBe(TARGET_FROM_POD_DESCRIPTION)
    expect(targetToPod.description).toBe(TARGET_TO_POD_DESCRIPTION)
  })
})

describe('Advanced group', () => {
  it('keeps the three override rows always visible, in order', () => {
    const params = inputsByName('k8s-copy')

    expect(visibleInGroup('Advanced', { direction: 'to_pod' })).toEqual(OVERRIDE_PARAMS)
    for (const name of OVERRIDE_PARAMS) {
      expect(params[name].type, name).toBe('string')
      expect(params[name].required, name).toBe(false)
      expect(params[name].showWhen, name).toBeUndefined()
      expect(params[name].showWhenAll, name).toBeUndefined()
    }
  })

  it('renders Namespace as a plain always-visible optional field', () => {
    const namespace = inputsByName('k8s-copy').namespace

    expect(namespace.required).toBe(false)
    expect(namespace.showWhen).toBeUndefined()
    expect(namespace.retainOnHide).not.toBe(true)
    expect(namespace.description).toBe(
      'The namespace the pod is in. Leave empty to use the namespace the session carries.',
    )
    expect((getInputParams('k8s-copy') ?? []).map((p) => p.name)).not.toContain(
      'specify_namespace',
    )
  })

  it('carries the exact impersonation copy for a block that changes something', () => {
    const params = inputsByName('k8s-copy')

    expect(params.impersonate_user.description).toBe(
      "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do.",
    )
    expect(params.impersonate_groups.description).toBe(
      'Send these group memberships with the impersonated user, comma separated.',
    )
  })
})

describe('the two copy limits (K8SEXEC-10)', () => {
  it('closes Advanced with Max size (MiB) then Max files, after Impersonate groups', () => {
    const names = (getInputParams('k8s-copy') ?? []).map((p) => p.name)

    expect(names.slice(names.indexOf('impersonate_groups'), names.indexOf('on_error'))).toEqual([
      'impersonate_groups',
      ...LIMIT_PARAMS,
    ])
  })

  it('declares Max size (MiB) as an optional integer defaulting to 256 MiB', () => {
    const size = inputsByName('k8s-copy').max_size_mib

    expect(size.label).toBe('Max size (MiB)')
    expect(size.type).toBe('integer')
    expect(size.required).toBe(false)
    expect(size.defaultValue).toBe(256)
    expect(size.group).toBe('Advanced')
    expect(size.description).toBe(PARAM_DESCRIPTIONS.max_size_mib)
  })

  it('declares Max files as an optional integer defaulting to 10000 files', () => {
    const files = inputsByName('k8s-copy').max_files

    expect(files.label).toBe('Max files')
    expect(files.type).toBe('integer')
    expect(files.required).toBe(false)
    expect(files.defaultValue).toBe(10000)
    expect(files.group).toBe('Advanced')
    expect(files.description).toBe(PARAM_DESCRIPTIONS.max_files)
  })

  it('accepts 0 as no limit and declares no maximum', () => {
    const params = inputsByName('k8s-copy')

    for (const name of LIMIT_PARAMS) {
      expect(params[name].minimum, name).toBe(0)
      expect(params[name].maximum, name).toBeUndefined()
      expect(params[name].maximumField, name).toBeUndefined()
    }
  })

  it('puts no picker on the limit rows and keeps their expression toggle', () => {
    const params = inputsByName('k8s-copy')

    for (const name of LIMIT_PARAMS) {
      expect(fileRef(params[name]).fileReference, name).toBeUndefined()
      expect(params[name].noExpression, name).toBeUndefined()
    }
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName('k8s-copy').on_error

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
  it('turns the expression toggle off on the two enum rows', () => {
    const structural = (getInputParams('k8s-copy') ?? []).filter((p) =>
      NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(structural).toHaveLength(2)
    for (const param of structural) {
      expect(param.noExpression, param.name).toBe(true)
    }
  })

  it('leaves every other row expression-capable, the path and limit rows included', () => {
    const expressive = (getInputParams('k8s-copy') ?? []).filter(
      (p) => !NO_EXPRESSION_PARAMS.includes(p.name),
    )

    expect(expressive).toHaveLength(14)
    for (const param of expressive) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  // Two descriptors sharing one wire name must never both retain: the hidden
  // twin would fight the visible one for the same key.
  it('retains no row, the two path pairs included', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      expect(param.retainOnHide, param.name).not.toBe(true)
    }
  })
})

describe('secret flags', () => {
  it('flags session secret', () => {
    expect(inputsByName('k8s-copy').session.secret).toBe(true)
  })

  it('does not flag any other parameter secret', () => {
    const inputs = getInputParams('k8s-copy') ?? []

    expect(inputs).toHaveLength(CP_PARAM_ORDER.length)
    for (const param of inputs) {
      if (param.name === 'session') continue
      expect(param.secret, param.name).not.toBe(true)
    }
  })
})

describe('group metadata', () => {
  it('declares the four groups in declaration order, tuning groups collapsed', () => {
    const meta = getGroupMeta('k8s-copy')

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(['Connection', 'Copy', 'Advanced', 'Failure Handling'])
    for (const group of ['Connection', 'Copy']) {
      expect(meta![group].defaultExpanded, `${group} expanded`).toBe(true)
    }
    for (const group of ['Advanced', 'Failure Handling']) {
      expect(meta![group].defaultExpanded, `${group} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact Connection footer', () => {
    expect(getGroupMeta('k8s-copy')!.Connection.description).toBe(
      'K8s Session and request timeout',
    )
  })

  it('carries the exact Copy footer', () => {
    expect(getGroupMeta('k8s-copy')!.Copy.description).toBe('What to copy, and which way')
  })

  it('carries the exact Advanced footer, naming the copy limits (K8SEXEC-10)', () => {
    expect(getGroupMeta('k8s-copy')!.Advanced.description).toBe(ADVANCED_FOOTER)
  })

  it('carries the exact Failure Handling footer', () => {
    expect(getGroupMeta('k8s-copy')!['Failure Handling'].description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
  })
})

describe('visible rows per state (K8SEXEC-5)', () => {
  it('opens on From Pod with one descriptor per wire name', () => {
    expect(visibleNames({})).toEqual(CP_VISIBLE_ORDER)
    expect(visibleNames({ direction: 'from_pod' })).toEqual(CP_VISIBLE_ORDER)
  })

  it('shows the same rows in the same order on To Pod, the two limit rows left out', () => {
    expect(visibleNames({ direction: 'to_pod' })).toEqual(CP_TO_POD_VISIBLE_ORDER)
  })

  it('shows the three overrides and the two limits in Advanced on From Pod (K8SEXEC-10)', () => {
    expect(visibleInGroup('Advanced', {})).toEqual(ADVANCED_PARAMS)
    expect(visibleInGroup('Advanced', { direction: 'from_pod' })).toEqual(ADVANCED_PARAMS)
  })

  it('shows only the three overrides in Advanced on To Pod', () => {
    expect(visibleInGroup('Advanced', { direction: 'to_pod' })).toEqual(OVERRIDE_PARAMS)
  })

  it('starts the From Pod limits at 256 MiB and 10000 files', () => {
    const limits = visibleParams({ direction: 'from_pod' }).filter((p) =>
      LIMIT_PARAMS.includes(p.name),
    )

    expect(limits.map((p) => [p.label, p.defaultValue])).toEqual([
      ['Max size (MiB)', 256],
      ['Max files', 10000],
    ])
  })

  it('never shows both descriptors of a path at once', () => {
    for (const values of [{}, { direction: 'from_pod' }, { direction: 'to_pod' }]) {
      for (const name of PAIRED_NAMES) {
        expect(visibleNamed(values, name), `${name} ${JSON.stringify(values)}`).toHaveLength(1)
      }
    }
  })

  it('shows the pod-side Source Path and the WAVE-side Target Path on From Pod', () => {
    expect(visibleNamed({}, 'source_path')[0].description).toBe(SOURCE_FROM_POD_DESCRIPTION)
    expect(visibleNamed({}, 'target_path')[0].description).toBe(TARGET_FROM_POD_DESCRIPTION)
  })

  it('swaps the two badges on To Pod, the labels staying put', () => {
    const source = visibleNamed({ direction: 'to_pod' }, 'source_path')[0]
    const target = visibleNamed({ direction: 'to_pod' }, 'target_path')[0]

    expect(source.label).toBe('Source Path')
    expect(target.label).toBe('Target Path')
    expect(source.description).toBe(SOURCE_TO_POD_DESCRIPTION)
    expect(target.description).toBe(TARGET_TO_POD_DESCRIPTION)
  })

  it('keeps the whole Copy group visible in both directions', () => {
    const copyRows = ['direction', 'pod', 'container', 'source_path', 'target_path', 'no_preserve']

    expect(visibleInGroup('Copy', {})).toEqual(copyRows)
    expect(visibleInGroup('Copy', { direction: 'to_pod' })).toEqual(copyRows)
  })
})

describe('outputs', () => {
  it('declares the four outputs in order', () => {
    const outputs = getOutputParams('k8s-copy') ?? []

    expect(outputs.map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs).toHaveLength(4)
  })

  it('labels every output', () => {
    const outputs = outputsByName('k8s-copy')

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(outputs[name].label, name).toBe(label)
    }
  })

  it('describes every output for the (i) tooltip', () => {
    const outputs = getOutputParams('k8s-copy') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.description, `description of ${output.name}`).toBeTruthy()
    }
  })

  it('returns Summary as a table, one row per file, ungated by Direction', () => {
    const summary = outputsByName('k8s-copy').summary

    expect(summary.type).toBe('table')
    expect(summary.description).toBe(SUMMARY_DESCRIPTION)
    expect(summary.showWhen).toBeUndefined()
  })

  it('offers no Count and no list-of-paths output', () => {
    const names = (getOutputParams('k8s-copy') ?? []).map((o) => o.name)

    expect(names).toHaveLength(4)
    for (const name of DROPPED_OUTPUTS) {
      expect(names, name).not.toContain(name)
    }
  })

  it('carries the exact copy on the three core outputs', () => {
    const outputs = outputsByName('k8s-copy')

    for (const [name, description] of Object.entries(CORE_DESCRIPTIONS)) {
      expect(outputs[name].description, name).toBe(description)
    }
  })

  it('flags no output secret', () => {
    const outputs = getOutputParams('k8s-copy') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('varies no output type with the sheet state', () => {
    const outputs = getOutputParams('k8s-copy') ?? []

    expect(outputs).toHaveLength(4)
    for (const output of outputs) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating', () => {
  it('offers Error and Reason only under Record and continue', () => {
    const outputs = outputsByName('k8s-copy')

    expect(outputs.error.showWhen).toEqual(RECORD_GATE)
    expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('keeps Success visible in both On error modes', () => {
    expect(outputsByName('k8s-copy').success.showWhen).toBeUndefined()
  })

  it('gates Error and Reason and no other output', () => {
    const gated = (getOutputParams('k8s-copy') ?? [])
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

  it('offers the same outputs in both directions', () => {
    expect(visibleOutputs({ direction: 'to_pod' })).toEqual(['summary', 'success'])
  })
})

describe('palette + icon wiring', () => {
  it('defines the K8s Copy palette row in the kubernetes category', () => {
    const def = getPluginById('k8s-copy')

    expect(def).toBeDefined()
    expect(def!.name).toBe('K8s Copy')
    expect(def!.category).toBe('kubernetes')
    expect(def!.iconName).toBe('ArrowRightLeft')
    expect(def!.colorClass).toBe('text-sky-500')
  })

  it('is remotable, so it carries the remote-host badge', () => {
    expect(getPluginById('k8s-copy')?.remotable).toBe(true)
  })

  it('registers ArrowRightLeft in the palette icon registry', () => {
    expect(isValidIconName('ArrowRightLeft')).toBe(true)
  })

  it('registers all three canvas maps for k8s-copy', () => {
    expect(getIcon('k8s-copy')).toBe(ArrowRightLeft)
    expect(getIconName('k8s-copy')).toBe('arrow-right-left')
    expect(getColorClass('k8s-copy')).toBe('text-sky-500')
  })
})
