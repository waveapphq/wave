/**
 * K8s Events Plugin Parameters
 *
 * Reads the cluster's event stream, namespace-wide or scoped to one object.
 * The input `reason` (Event Reason) and the output `reason` (Reason) share a
 * name and are told apart by their labels.
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_ALL_NAMESPACES_OFF,
  K8S_FORMAT_TYPE_RULES,
  K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  k8sAllNamespacesInput,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sKindPickerInput,
  k8sKindSourceInput,
  k8sOutputCore,
  k8sOutputFormatInput,
} from './_k8s-shared'

const SCOPE_ON = { field: 'scope_to_object', values: ['true'] }
const OBJECT_DEFAULT = { field: 'object_type', values: ['default'] }
const OBJECT_CUSTOM = { field: 'object_type', values: ['custom'] }

// Events returns a list in every mode, so the first option is named for the type it yields (K8SREAD-15).
const OUTPUT_FORMAT_LABELS: Record<string, string> = {
  map: 'Array',
  table: 'Table',
  json: 'JSON',
  yaml: 'YAML',
}
const OUTPUT_FORMAT_DESCRIPTION =
  'How Result comes back. Array is the parsed list, Table the printed table with every column the cluster returns, JSON and YAML the same objects as JSON or YAML text.'

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Events', {
    description: 'Which events to keep, and how they come back',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Events ---
  param('scope_to_object', 'Scope to object', 'boolean', false, 'Return only the events about one object instead of every event in the namespace.', {
    defaultValue: false,
    noExpression: true,
    group: 'Events',
  }),
  {
    ...k8sKindSourceInput('object_type', 'Object Type'),
    group: 'Events',
    showWhen: SCOPE_ON,
    retainOnHide: true,
  },
  {
    ...k8sKindPickerInput('object_kind', 'Object Kind', 'The kind of the object the events are about. Search the list, or switch Object Type to Custom for a kind that is not in it.'),
    group: 'Events',
    showWhenAll: [SCOPE_ON, OBJECT_DEFAULT],
    requiredWhenAll: [SCOPE_ON, OBJECT_DEFAULT],
    retainOnHide: true,
  },
  param('object_kind_custom', 'Object Kind', 'string', false, 'Any name kubectl accepts for the kind: HorizontalPodAutoscaler, hpa or horizontalpodautoscalers. A kind this cluster does not serve fails the block.', {
    group: 'Events',
    showWhenAll: [SCOPE_ON, OBJECT_CUSTOM],
    requiredWhenAll: [SCOPE_ON, OBJECT_CUSTOM],
    retainOnHide: true,
  }),
  param('object_name', 'Object Name', 'string', false, "The object's name. A deleted object of the same name still shows its events until the cluster discards them.", {
    group: 'Events',
    showWhen: SCOPE_ON,
    requiredWhen: SCOPE_ON,
    retainOnHide: true,
  }),
  param('event_type', 'Event Type', 'string', false, 'Keep both types, or only Warning, or only Normal.', {
    enumValues: ['any', 'Warning', 'Normal'],
    enumLabels: { any: 'Any', Warning: 'Warning', Normal: 'Normal' },
    defaultValue: 'any',
    group: 'Events',
  }),
  param('reason', 'Event Reason', 'string', false, 'Keep only events with this reason, like BackOff, Unhealthy or FailedScheduling.', {
    group: 'Events',
  }),
  param('within_seconds', 'Max Age (s)', 'integer', false, 'Keep only events last seen within this many seconds. The cluster discards events after about an hour anyway.', {
    group: 'Events',
  }),
  param('max_events', 'Max Events', 'integer', false, 'Keep at most this many events, newest first.', {
    group: 'Events',
  }),
  {
    ...k8sOutputFormatInput(),
    description: OUTPUT_FORMAT_DESCRIPTION,
    enumLabels: OUTPUT_FORMAT_LABELS,
    group: 'Events',
  },
  // --- Advanced ---
  {
    ...k8sAllNamespacesInput('Read events from every namespace at once, instead of naming one.'),
    group: 'Advanced',
  },
  ...k8sBlockTailInputs({
    namespace: {
      description: 'The namespace to read events from. Leave empty to use the namespace the session carries.',
      showWhen: K8S_ALL_NAMESPACES_OFF,
      retainOnHide: true,
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  }),
]

// Map mode always returns the list of events, so `array` is the declared type (K8SREAD-6).
export const outputs: OutputParam[] = [
  output('result', 'Result', 'array', 'The events that passed the filters, newest first. Its type follows Output Format: the parsed list for Array, a table for Table, text for JSON and YAML.', { typeWhen: K8S_FORMAT_TYPE_RULES }),
  output('count', 'Count', 'integer', 'How many events were kept; 0 when nothing matched'),
  ...k8sOutputCore(),
]
