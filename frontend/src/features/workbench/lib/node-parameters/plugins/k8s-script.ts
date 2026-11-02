/**
 * K8s Script Plugin Parameters
 *
 * Feeds a script body to an interpreter on the pod's standard input
 * (K8SEXEC-2). No working-directory row: kubectl exec has no such flag
 * (K8SEXEC-3). Nothing here mentions the cluster version.
 */

import {
  group,
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
  k8sCommandOutputs,
  k8sConnectionInputs,
  k8sContainerInput,
  k8sOutputCore,
  k8sPodInput,
} from './_k8s-shared'

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Script', {
    description: 'The pod and the script to run in it',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(60),
  // --- Script ---
  { ...k8sPodInput('The pod to run the script in.'), group: 'Script' },
  { ...k8sContainerInput(), group: 'Script' },
  param('interpreter', 'Interpreter', 'string', false, 'The interpreter that runs the script. Anything that reads a program on standard input: /bin/sh, bash, python3, perl, node. May include flags.', {
    defaultValue: '/bin/sh',
    group: 'Script',
  }),
  param('script', 'Script', 'string', true, 'The script to run. It is fed to the interpreter on standard input.', {
    allowedFormats: ['plain'],
    group: 'Script',
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'The namespace the pod is in. Leave empty to use the namespace the session carries.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  }),
]

export const outputs: OutputParam[] = [...k8sCommandOutputs(), ...k8sOutputCore()]
