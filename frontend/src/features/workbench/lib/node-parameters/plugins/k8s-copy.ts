/**
 * K8s Copy Plugin Parameters
 *
 * Copies a file or directory between a pod and the WAVE side (K8SEXEC-4).
 * Direction stands in for kubectl's argument order, and each path label is two
 * rows on one wire name gated on opposite directions, so the info badge always
 * names the right side (K8SEXEC-5). Summary is the only unique output
 * (K8SEXEC-6).
 */

import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type OutputParam,
} from '../types'
import { transferLimitInputs } from './_file-shared'
import {
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sContainerInput,
  k8sOutputCore,
  k8sPodInput,
} from './_k8s-shared'

const FROM_POD = { field: 'direction', values: ['from_pod'] }
const TO_POD = { field: 'direction', values: ['to_pod'] }

const WAVE_SIDE = 'an artifact path, or an absolute or relative path where the block runs'

const K8S_COPY_ADVANCED_DESCRIPTION =
  'Namespace and identity in place of what the session provides, and size limits for copies from the pod'

// One label, two descriptors: exactly one is ever visible, so both are required
// outright and neither retains on hide. Every row is a remote-host path; the
// WAVE-side row of each direction browses (TDATA-10).
function cpPathInput(
  name: string,
  label: string,
  description: string,
  showWhen: InputParam['showWhen'],
  fileReference?: InputParam['fileReference'],
): InputParam {
  return param(name, label, 'string', true, description, {
    group: 'Copy',
    showWhen,
    ...(fileReference ? { fileReference } : {}),
  })
}

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Copy', {
    description: 'What to copy, and which way',
    defaultExpanded: true,
  }),
  K8S_COPY_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(60),
  // --- Copy ---
  param('direction', 'Direction', 'string', true, 'Which way the file moves: out of the pod onto the WAVE side, or from WAVE into the pod.', {
    enumValues: ['from_pod', 'to_pod'],
    enumLabels: { from_pod: 'From Pod', to_pod: 'To Pod' },
    defaultValue: 'from_pod',
    noExpression: true,
    group: 'Copy',
  }),
  { ...k8sPodInput('The pod to copy from or to.'), group: 'Copy' },
  { ...k8sContainerInput(), group: 'Copy' },
  cpPathInput('source_path', 'Source Path', 'The file or directory inside the pod to copy.', FROM_POD),
  cpPathInput('source_path', 'Source Path', `The file or directory on the WAVE side to copy: ${WAVE_SIDE}.`, TO_POD, 'file-or-folder'),
  cpPathInput('target_path', 'Target Path', `Where to put it on the WAVE side: ${WAVE_SIDE}.`, FROM_POD, 'save-as'),
  cpPathInput('target_path', 'Target Path', 'Where to put it inside the pod.', TO_POD),
  param('no_preserve', 'No Preserve', 'boolean', false, "Do not carry the file's permissions and ownership across. kubectl preserves them by default.", {
    defaultValue: false,
    group: 'Copy',
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'The namespace the pod is in. Leave empty to use the namespace the session carries.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
    // K8SEXEC-10: bounds on what a copy from the pod may write.
    advancedAfterIdentity: transferLimitInputs({
      maxSizeMib: 256,
      maxFiles: 10000,
      showWhen: FROM_POD,
      sizeDescription: 'Largest total a copy from the pod may write, in MiB. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
      filesDescription: 'Most files a copy from the pod may write. The copy stops the moment it goes over and removes what it wrote. 0 means no limit.',
    }),
  }),
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', 'One row per file: where it came from, where it landed, and its size.'),
  ...k8sOutputCore(),
]
