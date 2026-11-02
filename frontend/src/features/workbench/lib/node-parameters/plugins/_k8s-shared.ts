/**
 * Shared K8s Constants
 *
 * Parameter definitions shared across the K8s block family so the fields
 * keep one name, label, and description on every block.
 */

import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type OutputParam,
  type OutputTypeRule,
} from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  timeoutInput,
} from './_shared-params'

export const K8S_TIMEOUT_DESCRIPTION = 'Request timeout in seconds'

export function k8sTimeoutInput(defaultValue: number, description?: string): InputParam {
  return timeoutInput(defaultValue, description ?? K8S_TIMEOUT_DESCRIPTION)
}

// --- Rows shared across the K8s block family ---

export function k8sSessionInput(): InputParam {
  return param(
    'session',
    'K8s Session',
    'string',
    true,
    'The session from a K8s Connect block: server URL, credentials and default namespace',
    { secret: true, allowedFormats: ['plain'] },
  )
}

export function k8sConnectionInputs(
  timeoutDefault = 30,
  timeoutDescription?: string,
): InputParam[] {
  return [
    { ...k8sSessionInput(), group: 'Connection' },
    { ...k8sTimeoutInput(timeoutDefault, timeoutDescription), group: 'Connection' },
  ]
}

export function k8sNamespaceInput(description: string): InputParam {
  return param('namespace', 'Namespace', 'string', false, description)
}

export function k8sAllNamespacesInput(description: string): InputParam {
  return param('all_namespaces', 'All namespaces', 'boolean', false, description, {
    defaultValue: false,
    noExpression: true,
  })
}

export function k8sNameInput(description: string): InputParam {
  return param('name', 'Name', 'string', false, description)
}

export function k8sLabelSelectorInput(description: string): InputParam {
  return param('label_selector', 'Label Selector', 'string', false, description)
}

// The pod and container pair the exec-channel blocks share (K8SEXEC-1).
export function k8sPodInput(description: string): InputParam {
  return param('pod', 'Pod', 'string', true, description)
}

// Required with no default: WAVE never picks a container for the author (K8SEXEC-9).
export function k8sContainerInput(): InputParam {
  return param(
    'container',
    'Container',
    'string',
    true,
    'Which container in the pod to use. Name it even when the pod has only one.',
  )
}

// The Kind picker: 23 stock kinds in 5 groups, alphabetical within each (K8SREAD-5).
const K8S_KIND_GROUPS: { heading: string; values: string[] }[] = [
  {
    heading: 'Workloads',
    values: ['CronJob', 'DaemonSet', 'Deployment', 'Job', 'Pod', 'ReplicaSet', 'StatefulSet'],
  },
  { heading: 'Networking', values: ['Endpoints', 'Ingress', 'NetworkPolicy', 'Service'] },
  { heading: 'Config', values: ['ConfigMap', 'Secret', 'ServiceAccount'] },
  { heading: 'Storage', values: ['PersistentVolume', 'PersistentVolumeClaim', 'StorageClass'] },
  {
    heading: 'Cluster',
    values: ['ClusterRole', 'ClusterRoleBinding', 'Namespace', 'Node', 'Role', 'RoleBinding'],
  },
]
const K8S_KIND_VALUES = K8S_KIND_GROUPS.flatMap((g) => g.values)

// kubectl short names as muted sublabels (K8SREAD-4); kinds without one render plain.
const K8S_KIND_SHORT_NAMES: Record<string, string> = {
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

const K8S_KIND_SOURCE_DESCRIPTION =
  'Default offers the kinds a stock cluster serves. Custom takes any other kind as plain text, including custom resources.'

export function k8sKindSourceInput(name: string, label: string): InputParam {
  return param(name, label, 'string', false, K8S_KIND_SOURCE_DESCRIPTION, {
    enumValues: ['default', 'custom'],
    enumLabels: { default: 'Default', custom: 'Custom' },
    defaultValue: 'default',
    noExpression: true,
  })
}

export function k8sKindPickerInput(name: string, label: string, description: string): InputParam {
  return param(name, label, 'string', false, description, {
    enumValues: K8S_KIND_VALUES,
    enumGroups: K8S_KIND_GROUPS,
    enumSublabels: K8S_KIND_SHORT_NAMES,
    enumSearchable: true,
    defaultValue: 'Pod',
  })
}

const K8S_OUTPUT_FORMAT_VALUES = ['map', 'table', 'json', 'yaml']
const K8S_OUTPUT_FORMAT_LABELS: Record<string, string> = {
  map: 'Map',
  table: 'Table',
  json: 'JSON',
  yaml: 'YAML',
}

export const K8S_OUTPUT_FORMAT_DESCRIPTION =
  'How Result comes back. Map is the parsed structure, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.'

export interface K8sOutputFormatOptions {
  defaultValue?: string
  description?: string
}

export function k8sOutputFormatInput(options?: K8sOutputFormatOptions): InputParam {
  return param(
    'output_format',
    'Output Format',
    'string',
    false,
    options?.description ?? K8S_OUTPUT_FORMAT_DESCRIPTION,
    {
      enumValues: K8S_OUTPUT_FORMAT_VALUES,
      enumLabels: K8S_OUTPUT_FORMAT_LABELS,
      defaultValue: options?.defaultValue ?? 'map',
      noExpression: true,
    },
  )
}

export const K8S_IMPERSONATE_USER_READ_DESCRIPTION =
  "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to read."

export const K8S_IMPERSONATE_USER_WRITE_DESCRIPTION =
  "Send the request as this user instead of the session's own identity. Use it to check what a role is allowed to do."

export function k8sImpersonateUserInput(description: string): InputParam {
  return param('impersonate_user', 'Impersonate user', 'string', false, description)
}

export function k8sImpersonateGroupsInput(): InputParam {
  return param(
    'impersonate_groups',
    'Impersonate groups',
    'string',
    false,
    'Send these group memberships with the impersonated user, comma separated.',
  )
}

// --- Shared condition constants ---

export const K8S_ALL_NAMESPACES_OFF = { field: 'all_namespaces', values: ['false'] }

export const K8S_RESOURCE_DEFAULT = { field: 'resource_type', values: ['default'] }

export const K8S_RESOURCE_CUSTOM = { field: 'resource_type', values: ['custom'] }

// --- Resource Type plus the two Kind rows it swaps between (K8SREAD-2) ---

// Both Kind rows retain on hide, so flipping Resource Type back restores what was typed.
export function k8sKindInputs(groupName: string): InputParam[] {
  return [
    { ...k8sKindSourceInput('resource_type', 'Resource Type'), group: groupName },
    {
      ...k8sKindPickerInput('kind', 'Kind', 'The resource kind, as kubectl names it. Search the list, or switch Resource Type to Custom to type one that is not in it.'),
      group: groupName,
      showWhen: K8S_RESOURCE_DEFAULT,
      requiredWhen: K8S_RESOURCE_DEFAULT,
      retainOnHide: true,
    },
    param('kind_custom', 'Kind', 'string', false, 'The kind exactly as the cluster names it. A kind this cluster does not serve fails the block.', {
      group: groupName,
      showWhen: K8S_RESOURCE_CUSTOM,
      requiredWhen: K8S_RESOURCE_CUSTOM,
      retainOnHide: true,
    }),
  ]
}

// --- Advanced + Failure Handling tail, closing every block's inputs (K8SREAD-10) ---

/** Namespace row of the tail: each block words it and gates it its own way. */
export interface K8sNamespaceRow {
  description: string
  showWhen?: InputParam['showWhen']
  showWhenAll?: InputParam['showWhenAll']
  retainOnHide?: boolean
}

export interface K8sBlockTail {
  namespace: K8sNamespaceRow
  impersonateUserDescription: string
  onErrorDescription?: string
  /** Extra Advanced rows, emitted right after Namespace */
  advancedAfterNamespace?: InputParam[]
  /** Extra Advanced rows, emitted after Impersonate groups */
  advancedAfterIdentity?: InputParam[]
  /** Extra Failure Handling rows, emitted right before On error */
  failureHandlingBeforeOnError?: InputParam[]
}

export function k8sBlockTailInputs(tail: K8sBlockTail): InputParam[] {
  const { description, ...gating } = tail.namespace
  return [
    { ...k8sNamespaceInput(description), group: 'Advanced', ...gating },
    ...(tail.advancedAfterNamespace ?? []).map((row) => ({ ...row, group: 'Advanced' })),
    { ...k8sImpersonateUserInput(tail.impersonateUserDescription), group: 'Advanced' },
    { ...k8sImpersonateGroupsInput(), group: 'Advanced' },
    ...(tail.advancedAfterIdentity ?? []).map((row) => ({ ...row, group: 'Advanced' })),
    ...(tail.failureHandlingBeforeOnError ?? []).map((row) => ({
      ...row,
      group: FAILURE_HANDLING_GROUP,
    })),
    failureHandlingOnErrorInput(tail.onErrorDescription),
  ]
}

// --- Output type rules shared by the blocks that offer Output Format (K8SREAD-6) ---

export const K8S_FORMAT_TYPE_RULES: OutputTypeRule[] = [
  { when: [{ field: 'output_format', values: ['table'] }], type: 'table' },
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
]

// --- Groups: Connection / verb / Advanced / Failure Handling, in that order (K8SREAD-10) ---

export const K8S_ADVANCED_DESCRIPTION =
  'Namespace and identity for this block only, in place of what the session provides'

export const K8S_CONNECTION_DESCRIPTION = 'K8s Session and request timeout'

export function k8sBlockGroups(
  verbGroup: GroupMeta,
  advancedDescription: string,
  connectionDescription?: string,
): Record<string, GroupMeta> {
  return {
    'Connection': group('Connection', {
      description: connectionDescription ?? K8S_CONNECTION_DESCRIPTION,
      defaultExpanded: true,
    }),
    [verbGroup.name]: verbGroup,
    'Advanced': group('Advanced', { description: advancedDescription }),
    [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
  }
}

// --- Outputs of the blocks that run something over the exec channel (K8SEXEC-1) ---

export function k8sCommandOutputs(): OutputParam[] {
  return [
    output('stdout', 'Stdout', 'string', 'Everything the command wrote to standard output.'),
    output('stderr', 'Stderr', 'string', 'Everything the command wrote to standard error.'),
    output('exit_code', 'Exit Code', 'integer', 'The exit code the command returned. A non-zero code is returned as data, not treated as a failure.'),
  ]
}

// --- Output core rendered after each block's own outputs (K8SREAD-9) ---

// Error and Reason are gated on Record and continue; Success is the deliberate exception (K8SWRITE-8).
export function k8sOutputCore(): OutputParam[] {
  return outputCore({
    successDescription: 'True when the cluster carried out the operation without error; false when On error is Record and continue and the cluster refused it',
    reasonDescription: 'The cluster reason for the failure, like NotFound or Forbidden; empty when the operation succeeded',
  })
}
