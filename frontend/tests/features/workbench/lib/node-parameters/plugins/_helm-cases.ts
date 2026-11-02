/**
 * Shared expectations for the six Helm block schemas.
 *
 * Every Helm sheet carries the same family furniture - the K8s Session and a
 * timeout in Connection, the Namespace / Helm Path / impersonation rows in
 * Advanced, On error in Failure Handling, and the gated Success / Error / Reason
 * outputs. These helpers assert that furniture once so each block's own file is
 * only about what makes it different.
 */

import { expect } from 'vitest'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
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

export const HELM_COLOR = 'text-indigo-500'

export const RECORD_GATE = { field: 'on_error', values: ['record'] }

/** Result starts as a Table and follows Output Format from there (HELM-6). */
export const HELM_FORMAT_TYPE_RULES = [
  { when: [{ field: 'output_format', values: ['map'] }], type: 'map' },
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
]

export const CONNECTION_PARAMS = ['session', 'timeout']

/** The Advanced tail every Helm block ends with, after any block-specific rows. */
export const ADVANCED_TAIL = ['helm_path', 'impersonate_user', 'impersonate_groups']

export const AUTH_PARAMS = [
  'repo_username',
  'repo_password',
  'repo_ca_cert',
  'repo_verify_ssl',
]

export const OUTPUT_FORMAT_VALUES = ['map', 'table', 'json', 'yaml']
export const OUTPUT_FORMAT_LABELS = { map: 'Map', table: 'Table', json: 'JSON', yaml: 'YAML' }

export const CONNECTION_HELM_TIMEOUT_FOOTER = "K8s Session and helm's operation timeout"
export const CONNECTION_REQUEST_TIMEOUT_FOOTER = 'K8s Session and request timeout'
export const AUTH_FOOTER = 'Credentials and trust for the chart repository'
export const ADVANCED_FOOTER = 'Session overrides and the helm executable'
export const FAILURE_FOOTER =
  'Record and continue sets Success, Error and Reason instead of failing the block'

export const SESSION_DESCRIPTION =
  'The session from a K8s Connect block: server URL, credentials and default namespace'
export const IMPERSONATE_USER_DESCRIPTION =
  "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do."
export const IMPERSONATE_GROUPS_DESCRIPTION =
  'Send these group memberships with the impersonated user, comma separated.'
export const ON_ERROR_DESCRIPTION =
  'Fail the block, or record the outcome and let the test continue.'
export const REQUEST_TIMEOUT_DESCRIPTION = 'Request timeout in seconds'

export const SHARED_LABELS: Record<string, string> = {
  session: 'K8s Session',
  timeout: 'Timeout',
  release: 'Release Name',
  chart: 'Chart',
  version: 'Version',
  repo: 'Repository URL',
  values: 'Values',
  set: 'Set',
  output_format: 'Output Format',
  repo_username: 'Repository Username',
  repo_password: 'Repository Password',
  repo_ca_cert: 'Repository CA Certificate',
  repo_verify_ssl: 'Verify Server Certificate',
  namespace: 'Namespace',
  create_namespace: 'Create Namespace',
  helm_path: 'Helm Path',
  impersonate_user: 'Impersonate user',
  impersonate_groups: 'Impersonate groups',
  atomic: 'Atomic',
  cleanup_on_fail: 'Cleanup on Fail',
  cleanup_timeout: 'Cleanup Timeout',
  install: 'Install if missing',
  reuse_values: 'Reuse Values',
  reset_values: 'Reset Values',
  revision: 'Revision',
  keep_history: 'Keep History',
  ignore_not_found: 'Ignore Not Found',
  cascade: 'Cascade',
  logs: 'Logs',
  on_error: 'On error',
}

export const SHARED_TYPES: Record<string, InputParam['type']> = {
  session: 'string',
  timeout: 'integer',
  release: 'string',
  chart: 'string',
  version: 'string',
  repo: 'string',
  values: 'string',
  set: 'map',
  output_format: 'string',
  repo_username: 'string',
  repo_password: 'string',
  repo_ca_cert: 'string',
  repo_verify_ssl: 'boolean',
  namespace: 'string',
  create_namespace: 'boolean',
  helm_path: 'string',
  impersonate_user: 'string',
  impersonate_groups: 'string',
  atomic: 'boolean',
  cleanup_on_fail: 'boolean',
  cleanup_timeout: 'integer',
  install: 'boolean',
  reuse_values: 'boolean',
  reset_values: 'boolean',
  revision: 'integer',
  keep_history: 'boolean',
  ignore_not_found: 'boolean',
  cascade: 'string',
  logs: 'boolean',
  on_error: 'string',
}

export const OUTPUT_LABELS: Record<string, string> = {
  result: 'Result',
  status: 'Status',
  logs: 'Logs',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

export const OUTPUT_CORE_DESCRIPTIONS: Record<string, string> = {
  success:
    'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
  error:
    'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
}

/** Keys no Helm block declares on any row. */
export const NEVER_DECLARED_KEYS: (keyof InputParam)[] = [
  'requiredMessage',
  'note',
  'editorNote',
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
  'showWhenAll',
  'requiredWhen',
  'requiredWhenAll',
  'retainOnHide',
]

interface FileReferenceKeys {
  fileReference?: 'file' | 'file-or-folder' | 'folder' | 'save-as'
  fileReferenceArtifactsOnly?: boolean
}

/** The two picker keys read off a row without widening the row to `unknown`. */
export function fileRef(row: InputParam): FileReferenceKeys {
  return row as InputParam & FileReferenceKeys
}

export function inputsByName(nodeId: string): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(nodeId) ?? []).map((p) => [p.name, p]))
}

export function outputsByName(nodeId: string): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(nodeId) ?? []).map((o) => [o.name, o]))
}

export function paramNames(nodeId: string): string[] {
  return (getInputParams(nodeId) ?? []).map((p) => p.name)
}

export function outputNames(nodeId: string): string[] {
  return (getOutputParams(nodeId) ?? []).map((o) => o.name)
}

/** The rows the parameter table renders for one set of field values. */
export function visibleNames(nodeId: string, values: Record<string, unknown>): string[] {
  const all = (getInputParams(nodeId) ?? []) as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
}

export function visibleInGroup(
  nodeId: string,
  groupName: string,
  values: Record<string, unknown>,
): string[] {
  const all = (getInputParams(nodeId) ?? []) as unknown as Parameter[]
  return all
    .filter((p) => p.group === groupName && isParameterVisible(p, values, all))
    .map((p) => p.name)
}

/** The outputs the binding table offers for one set of field values. */
export function visibleOutputs(nodeId: string, values: Record<string, unknown>): string[] {
  const inputs = (getInputParams(nodeId) ?? []) as unknown as Parameter[]
  return (getOutputParams(nodeId) ?? [])
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, inputs))
    .map((o) => o.name)
}

export function groupOrder(nodeId: string): string[] {
  const seen: string[] = []
  for (const param of getInputParams(nodeId) ?? []) {
    if (param.group && !seen.includes(param.group)) seen.push(param.group)
  }
  return seen
}

export function expectRegistered(nodeId: string): void {
  expect(PLUGIN_INPUTS[nodeId]).toBeDefined()
  expect(PLUGIN_OUTPUTS[nodeId]).toBeDefined()
  expect(PLUGIN_GROUPS[nodeId]).toBeDefined()
  expect(getInputParams(nodeId)).toBe(PLUGIN_INPUTS[nodeId])
  expect(getOutputParams(nodeId)).toBe(PLUGIN_OUTPUTS[nodeId])
  expect(getGroupMeta(nodeId)).toBe(PLUGIN_GROUPS[nodeId])
}

/** The Connection rows every Helm block opens with. */
export function expectConnectionRows(nodeId: string, timeoutDefault: number): void {
  const inputs = inputsByName(nodeId)

  expect(inputs.session.required).toBe(true)
  expect(inputs.session.secret).toBe(true)
  expect(inputs.session.description).toBe(SESSION_DESCRIPTION)
  expect(inputs.session.group).toBe('Connection')
  expect(inputs.timeout.type).toBe('integer')
  expect(inputs.timeout.required).toBe(false)
  expect(inputs.timeout.defaultValue).toBe(timeoutDefault)
  expect(inputs.timeout.group).toBe('Connection')
}

/** The Advanced tail and the Failure Handling enum, unchanged from the family. */
export function expectFamilyTail(nodeId: string): void {
  const inputs = inputsByName(nodeId)

  expect(inputs.namespace.required).toBe(false)
  expect(inputs.namespace.group).toBe('Advanced')
  expect(inputs.namespace.description).toBeTruthy()
  expect(inputs.helm_path.group).toBe('Advanced')
  expect(inputs.helm_path.placeholder).toBe('helm')
  expect(inputs.impersonate_user.description).toBe(IMPERSONATE_USER_DESCRIPTION)
  expect(inputs.impersonate_user.group).toBe('Advanced')
  expect(inputs.impersonate_groups.type).toBe('string')
  expect(inputs.impersonate_groups.description).toBe(IMPERSONATE_GROUPS_DESCRIPTION)
  expect(inputs.impersonate_groups.group).toBe('Advanced')
  expect(inputs.on_error.enumValues).toEqual(['fail', 'record'])
  expect(inputs.on_error.enumLabels).toEqual({
    fail: 'Fail the block',
    record: 'Record and continue',
  })
  expect(inputs.on_error.defaultValue).toBe('fail')
  expect(inputs.on_error.noExpression).toBe(true)
  expect(inputs.on_error.description).toBe(ON_ERROR_DESCRIPTION)
  expect(inputs.on_error.group).toBe('Failure Handling')
}

/** Output Format: the family's four values, defaulting to Table on every Helm block. */
export function expectOutputFormatRow(nodeId: string, groupName: string): void {
  const row = inputsByName(nodeId).output_format

  expect(row.type).toBe('string')
  expect(row.required).toBe(false)
  expect(row.enumValues).toEqual(OUTPUT_FORMAT_VALUES)
  expect(row.enumLabels).toEqual(OUTPUT_FORMAT_LABELS)
  expect(row.defaultValue).toBe('table')
  expect(row.noExpression).toBe(true)
  expect(row.description).toBeTruthy()
  expect(row.group).toBe(groupName)
}

/** Success always; Error and Reason only under Record and continue. */
export function expectOutputCore(nodeId: string): void {
  const outputs = outputsByName(nodeId)

  expect(outputs.success.type).toBe('boolean')
  expect(outputs.success.showWhen).toBeUndefined()
  expect(outputs.error.showWhen).toEqual(RECORD_GATE)
  expect(outputs.reason.showWhen).toEqual(RECORD_GATE)
  for (const name of Object.keys(OUTPUT_CORE_DESCRIPTIONS)) {
    expect(outputs[name].description).toBe(OUTPUT_CORE_DESCRIPTIONS[name])
    expect(outputs[name].label).toBe(OUTPUT_LABELS[name])
  }
}

/** Result is a Table by default and follows Output Format from there. */
export function expectResultOutput(nodeId: string): void {
  const result = outputsByName(nodeId).result

  expect(result.label).toBe('Result')
  expect(result.type).toBe('table')
  expect(result.typeWhen).toEqual(HELM_FORMAT_TYPE_RULES)
}

/** Every row's label and type, against the family's one naming table. */
export function expectLabelsAndTypes(nodeId: string, names: string[]): void {
  const inputs = inputsByName(nodeId)

  for (const name of names) {
    expect(inputs[name].label, `label of ${name}`).toBe(SHARED_LABELS[name])
    expect(inputs[name].type, `type of ${name}`).toBe(SHARED_TYPES[name])
  }
}

/** No Helm block carries a wait row, under any name (HELM-2). */
export function expectNoWaitRow(nodeId: string): void {
  const names = paramNames(nodeId)

  expect(names.filter((n) => n.includes('wait') || n.includes('poll'))).toEqual([])
}

/**
 * Chart is a name, a WAVE-side file or folder, or an OCI reference, so it
 * browses in file-or-folder mode and is a host path inside a Remote body
 * (TDATA-10). No other row on the block browses.
 */
export function expectChartBrowses(nodeId: string): void {
  const chart = inputsByName(nodeId).chart

  expect(fileRef(chart).fileReference).toBe('file-or-folder')
  expect(fileRef(chart).fileReferenceArtifactsOnly).toBeUndefined()

  const withPicker = (getInputParams(nodeId) ?? []).filter(
    (p) => fileRef(p).fileReference !== undefined,
  )
  expect(withPicker.map((p) => p.name)).toEqual(['chart'])
}

export function expectNoStrayKeys(nodeId: string, allowed: (keyof InputParam)[] = []): void {
  const skip = new Set(allowed)
  for (const param of getInputParams(nodeId) ?? []) {
    for (const key of NEVER_DECLARED_KEYS) {
      if (skip.has(key)) continue
      expect(param[key], `${key} of ${param.name}`).toBeUndefined()
    }
  }
}

/** The palette row, the palette icon registry and the three canvas maps. */
export function expectPaletteWiring(
  nodeId: string,
  name: string,
  iconName: string,
  icon: unknown,
  canvasIconName: string,
): void {
  const def = getPluginById(nodeId)

  expect(def).toBeDefined()
  expect(def!.name).toBe(name)
  expect(def!.category).toBe('helm')
  expect(def!.iconName).toBe(iconName)
  expect(def!.colorClass).toBe(HELM_COLOR)
  expect(def!.remotable).toBe(true)
  expect(isValidIconName(iconName)).toBe(true)
  expect(getIcon(nodeId)).toBe(icon)
  expect(getIconName(nodeId)).toBe(canvasIconName)
  expect(getColorClass(nodeId)).toBe(HELM_COLOR)
}
