/**
 * K8s Exec Plugin Parameters
 *
 * Runs one command line in one pod (K8SEXEC-1). The command is a single string
 * split shell-style; there is no stdin row at all.
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
  group('Command', {
    description: 'The pod and the command line to run in it',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(60),
  // --- Command ---
  { ...k8sPodInput('The pod to run the command in.'), group: 'Command' },
  { ...k8sContainerInput(), group: 'Command' },
  param('command', 'Command', 'string', true, 'One command line. Quotes group arguments the way a shell does, so sh -c "echo hi there" is three arguments.', {
    group: 'Command',
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
