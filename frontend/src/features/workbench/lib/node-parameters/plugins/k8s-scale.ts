/**
 * K8s Scale Plugin Parameters
 *
 * Writes one replica count onto one scalable object (K8SWRITE-6). Resource Type swaps
 * the Kind row between the four scalable kinds and a plain string field.
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
  K8S_RESOURCE_CUSTOM,
  K8S_RESOURCE_DEFAULT,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sKindSourceInput,
  k8sNameInput,
  k8sOutputCore,
} from './_k8s-shared'

// The kinds a stock cluster serves a scale endpoint for.
const SCALABLE_KINDS = ['Deployment', 'ReplicaSet', 'ReplicationController', 'StatefulSet']

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Scale', {
    description: 'What to scale and to how many',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Scale ---
  {
    ...k8sKindSourceInput('resource_type', 'Resource Type'),
    description: 'Default offers the kinds that can be scaled. Custom takes any other kind as plain text, including custom resources.',
    group: 'Scale',
  },
  param('kind', 'Kind', 'string', false, 'The kind to scale. Only kinds the cluster serves a scale endpoint for can be scaled.', {
    enumValues: SCALABLE_KINDS,
    defaultValue: 'Deployment',
    group: 'Scale',
    showWhen: K8S_RESOURCE_DEFAULT,
    requiredWhen: K8S_RESOURCE_DEFAULT,
    retainOnHide: true,
  }),
  param('kind_custom', 'Kind', 'string', false, 'The kind exactly as the cluster names it. A kind with no scale endpoint is refused before anything is written.', {
    group: 'Scale',
    showWhen: K8S_RESOURCE_CUSTOM,
    requiredWhen: K8S_RESOURCE_CUSTOM,
    retainOnHide: true,
  }),
  { ...k8sNameInput("The object's name."), required: true, group: 'Scale' },
  param('replicas', 'Replicas', 'integer', true, 'How many replicas to run. 0 is allowed and scales the object down to nothing.', {
    group: 'Scale',
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'Leave empty to use the namespace the session carries. Otherwise, the namespace the object is in.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  }),
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', 'One row per object: the resource, what happened to it, and the replica count before and after.'),
  ...k8sOutputCore(),
]
