/**
 * K8s Get Plugin Parameters
 *
 * Reads one kind by Name, Selector or List (K8SREAD-1). Resource Type swaps the Kind
 * row between the grouped searchable picker and a plain string field (K8SREAD-2).
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
  K8S_ADVANCED_DESCRIPTION,
  K8S_ALL_NAMESPACES_OFF,
  K8S_FORMAT_TYPE_RULES,
  K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  k8sAllNamespacesInput,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sKindInputs,
  k8sLabelSelectorInput,
  k8sNameInput,
  k8sOutputCore,
  k8sOutputFormatInput,
} from './_k8s-shared'

const SEARCH_BY_NAME = { field: 'search_by', values: ['name'] }
const SEARCH_BY_SELECTOR = { field: 'search_by', values: ['selector'] }
const SEARCH_BY_LIST_MODES = { field: 'search_by', values: ['selector', 'list'] }

// Search by picks the Output Format row, so the first option is named after the type it yields (K8SREAD-15).
const OUTPUT_FORMAT_LIST_LABELS: Record<string, string> = {
  map: 'Array',
  table: 'Table',
  json: 'JSON',
  yaml: 'YAML',
}
const OUTPUT_FORMAT_LIST_DESCRIPTION =
  'How Result comes back. Array is the parsed list, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.'

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Resource', {
    description: 'Which kind to read, how to find it, and how it comes back',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Resource ---
  ...k8sKindInputs('Resource'),
  param('search_by', 'Search by', 'string', false, 'Name reads one object and fails when it is not there. Selector and List read a list, which can legitimately come back empty.', {
    enumValues: ['name', 'selector', 'list'],
    enumLabels: { name: 'Name', selector: 'Selector', list: 'List' },
    defaultValue: 'name',
    noExpression: true,
    group: 'Resource',
  }),
  {
    ...k8sNameInput("The object's name. A name that does not exist fails the block."),
    group: 'Resource',
    showWhen: SEARCH_BY_NAME,
    requiredWhen: SEARCH_BY_NAME,
    retainOnHide: true,
  },
  {
    ...k8sLabelSelectorInput('Match objects by label, like app=web or tier in (a,b). Leave empty to match on fields alone.'),
    group: 'Resource',
    showWhen: SEARCH_BY_SELECTOR,
    retainOnHide: true,
  },
  param('field_selector', 'Field Selector', 'string', false, 'Match objects by field, like status.phase=Running. The cluster supports only a few fields per kind.', {
    group: 'Resource',
    showWhen: SEARCH_BY_SELECTOR,
    retainOnHide: true,
  }),
  { ...k8sOutputFormatInput(), group: 'Resource', showWhen: SEARCH_BY_NAME },
  {
    ...k8sOutputFormatInput(),
    description: OUTPUT_FORMAT_LIST_DESCRIPTION,
    enumLabels: OUTPUT_FORMAT_LIST_LABELS,
    group: 'Resource',
    showWhen: SEARCH_BY_LIST_MODES,
  },
  // --- Advanced ---
  {
    ...k8sAllNamespacesInput('Read across every namespace at once, instead of naming one. Ignored for cluster-scoped kinds.'),
    group: 'Advanced',
    showWhen: SEARCH_BY_LIST_MODES,
  },
  ...k8sBlockTailInputs({
    namespace: {
      description: 'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Node or PersistentVolume.',
      showWhen: K8S_ALL_NAMESPACES_OFF,
      retainOnHide: true,
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  }),
]

// Result's declared type follows Output Format, and Map splits on Search by (K8SREAD-6).
const RESULT_TYPE_WHEN: OutputTypeRule[] = [
  ...K8S_FORMAT_TYPE_RULES,
  {
    when: [
      { field: 'output_format', values: ['map'] },
      { field: 'search_by', values: ['selector', 'list'] },
    ],
    type: 'array',
  },
]

export const outputs: OutputParam[] = [
  output('result', 'Result', 'map', 'What the cluster returned. Its type follows Output Format: a map for one named object, an array for a Selector or List read, a table for Table, text for JSON and YAML.', { typeWhen: RESULT_TYPE_WHEN }),
  output('names', 'Names', 'array', 'The names of the objects read, in the order the cluster returned them'),
  output('count', 'Count', 'integer', 'How many objects were read; 0 when a Selector or List read matched nothing'),
  ...k8sOutputCore(),
]
