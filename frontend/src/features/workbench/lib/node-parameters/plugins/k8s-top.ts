/**
 * K8s Top Plugin Parameters
 *
 * Measures pods or nodes through one `scope` enum. `scope` gates the
 * container breakdown and both namespace rows; `select_by` gates the
 * target row and the All namespaces tick.
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_ALL_NAMESPACES_OFF,
  K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  k8sAllNamespacesInput,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sLabelSelectorInput,
  k8sNameInput,
  k8sOutputCore,
} from './_k8s-shared'
import { ON_ERROR_DESCRIPTION } from './_shared-params'

const SCOPE_POD = { field: 'scope', values: ['pod'] }
const SELECT_BY_NAME = { field: 'select_by', values: ['name'] }
const SELECT_BY_SELECTOR = { field: 'select_by', values: ['selector'] }
const SELECT_BY_LIST_MODES = { field: 'select_by', values: ['all', 'selector'] }

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Measurement', {
    description: 'Pods or nodes, and which ones to measure',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Measurement ---
  param('scope', 'Measure', 'string', true, 'Measure pods, or measure whole nodes. Node numbers include the kubelet and other system processes, not just pods.', {
    enumValues: ['pod', 'node'],
    enumLabels: { pod: 'Pods', node: 'Nodes' },
    defaultValue: 'pod',
    noExpression: true,
    group: 'Measurement',
  }),
  param('select_by', 'Select by', 'string', true, 'Measure every pod or node, one by name, or the ones that match a label selector.', {
    enumValues: ['all', 'name', 'selector'],
    enumLabels: { all: 'All', name: 'Name', selector: 'Selector' },
    defaultValue: 'all',
    noExpression: true,
    group: 'Measurement',
  }),
  {
    ...k8sNameInput('The pod or node name to measure.'),
    group: 'Measurement',
    showWhen: SELECT_BY_NAME,
    requiredWhen: SELECT_BY_NAME,
    retainOnHide: true,
  },
  {
    ...k8sLabelSelectorInput('Match pods or nodes by label, like app=web.'),
    group: 'Measurement',
    showWhen: SELECT_BY_SELECTOR,
    retainOnHide: true,
  },
  param('include_containers', 'Include containers', 'boolean', false, 'Report usage per container instead of one total per pod.', {
    defaultValue: false,
    group: 'Measurement',
    showWhen: SCOPE_POD,
    retainOnHide: true,
  }),
  // --- Advanced ---
  {
    ...k8sAllNamespacesInput('Measure pods in every namespace at once, instead of naming one.'),
    group: 'Advanced',
    showWhenAll: [SCOPE_POD, SELECT_BY_LIST_MODES],
  },
  ...k8sBlockTailInputs({
    namespace: {
      description: 'The namespace whose pods to measure. Leave empty to use the namespace the session carries.',
      showWhenAll: [SCOPE_POD, K8S_ALL_NAMESPACES_OFF],
      retainOnHide: true,
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_READ_DESCRIPTION,
    onErrorDescription: `${ON_ERROR_DESCRIPTION} A cluster with no metrics API fails the block either way.`,
  }),
]

export const outputs: OutputParam[] = [
  output('usage', 'Usage', 'table', 'One row per pod, container or node with its name, cpu in cores and memory in bytes; nodes also carry capacity and allocatable, and a node the metrics API does not report comes back with null cpu and memory'),
  output('count', 'Count', 'integer', 'How many entries Usage holds: pods, containers when Include containers is on, or nodes'),
  ...k8sOutputCore(),
]
