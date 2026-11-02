/**
 * Helm Rollback Plugin Parameters
 *
 * Rolls a release back to an earlier revision (HELM-1). There is no chart, so no
 * chart-repository rows and no Create Namespace, and helm rollback has no atomic
 * flag: Cleanup on Fail, with the cleanup room it buys, is all that sits above On error.
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sOutputCore } from './_k8s-shared'
import {
  helmBlockGroups,
  helmBlockTailInputs,
  helmCleanupOnFailInput,
  helmCleanupTimeoutInput,
  HELM_CLEANUP_ON_FAIL_ON,
  helmConnectionInputs,
  helmOutputFormatInput,
  helmReleaseInput,
  helmReleaseOutputs,
} from './_helm-shared'

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Rollback', {
    description: 'Release and target revision',
    defaultExpanded: true,
  }),
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...helmConnectionInputs(),
  // --- Rollback ---
  { ...helmReleaseInput('The release to roll back.'), group: 'Rollback' },
  param('revision', 'Revision', 'integer', false, 'The revision to go back to. Leave empty to go back to the revision before the current one.', {
    group: 'Rollback',
  }),
  helmOutputFormatInput('Rollback'),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs({
    failureHandlingBeforeOnError: [
      helmCleanupOnFailInput('Delete the resources this rollback created when it fails, instead of leaving them behind.'),
      helmCleanupTimeoutInput(HELM_CLEANUP_ON_FAIL_ON),
    ],
  }),
]

export const outputs: OutputParam[] = [...helmReleaseOutputs(), ...k8sOutputCore()]
