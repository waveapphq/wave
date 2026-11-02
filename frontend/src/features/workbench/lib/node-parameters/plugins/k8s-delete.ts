/**
 * K8s Delete Plugin Parameters
 *
 * Deletes one kind by Name or by Selector (K8SWRITE-5). Resource Type swaps the Kind
 * row between the grouped searchable picker and a plain string field (K8SREAD-2).
 */

import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type OutputParam,
} from '../types'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sKindInputs,
  k8sLabelSelectorInput,
  k8sNameInput,
  k8sOutputCore,
} from './_k8s-shared'

const DELETE_BY_NAME = { field: 'delete_by', values: ['name'] }
const DELETE_BY_SELECTOR = { field: 'delete_by', values: ['selector'] }

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Resource', {
    description: 'What to delete, and how thoroughly',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Resource ---
  ...k8sKindInputs('Resource'),
  param('delete_by', 'Delete by', 'string', false, 'Delete one object by name, or every object that matches a selector.', {
    enumValues: ['name', 'selector'],
    enumLabels: { name: 'Name', selector: 'Selector' },
    defaultValue: 'name',
    noExpression: true,
    group: 'Resource',
  }),
  {
    ...k8sNameInput("The object's name. A name that is already gone is an error, exactly as in kubectl, unless Ignore not found is ticked."),
    group: 'Resource',
    showWhen: DELETE_BY_NAME,
    requiredWhen: DELETE_BY_NAME,
    retainOnHide: true,
  },
  {
    ...k8sLabelSelectorInput('Match objects by label, like app=web or tier in (a,b). Every object that matches is deleted.'),
    group: 'Resource',
    showWhen: DELETE_BY_SELECTOR,
    requiredWhen: DELETE_BY_SELECTOR,
    retainOnHide: true,
  },
  // A stale tick would turn a failure into a pass, so this one is not retained.
  param('ignore_not_found', 'Ignore not found', 'boolean', false, "Treat a name that is already gone as a success instead of an error. Same as kubectl's --ignore-not-found.", {
    defaultValue: false,
    group: 'Resource',
    showWhen: DELETE_BY_NAME,
  }),
  param('cascade', 'Cascade', 'string', false, 'Background returns at once and the cluster removes the children after. Foreground waits until the children are gone. Orphan leaves them running.', {
    enumValues: ['background', 'foreground', 'orphan'],
    enumLabels: { background: 'Background', foreground: 'Foreground', orphan: 'Orphan' },
    defaultValue: 'background',
    noExpression: true,
    group: 'Resource',
  }),
  param('grace_period_seconds', 'Grace Period (s)', 'integer', false, "How long the object gets to shut down. 0 removes it immediately. Leave empty for the kind's own default.", {
    group: 'Resource',
  }),
  param('wait_until_gone', 'Wait until gone', 'boolean', false, "Keep checking until the object is really gone, within the block's timeout. kubectl waits by default; untick to return as soon as the cluster accepts the delete.", {
    defaultValue: true,
    group: 'Resource',
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Node or PersistentVolume.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  }),
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', 'One row per object: the resource and what happened to it, as kubectl prints it.'),
  output('names', 'Names', 'array', 'The names of the objects deleted, in the order the cluster reported them'),
  output('count', 'Count', 'integer', 'How many objects were deleted; 0 when a selector matched nothing'),
  ...k8sOutputCore(),
]
