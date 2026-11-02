/**
 * Helm Status Plugin Parameters
 *
 * Reads a release, current or by revision, into Result and into the Status
 * scalar Wait Until polls (HELM-9). Its Timeout bounds WAVE's read rather than a
 * helm operation, so the Connection group keeps the family wording.
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { K8S_CONNECTION_DESCRIPTION, k8sConnectionInputs, k8sOutputCore } from './_k8s-shared'
import {
  helmBlockGroups,
  helmBlockTailInputs,
  helmOutputFormatInput,
  helmReleaseInput,
  helmReleaseOutputs,
} from './_helm-shared'

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Status', {
    description: 'Release to read',
    defaultExpanded: true,
  }),
  { connectionDescription: K8S_CONNECTION_DESCRIPTION },
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(30),
  // --- Status ---
  { ...helmReleaseInput('The release to read.'), group: 'Status' },
  param('revision', 'Revision', 'integer', false, 'The revision to read. Leave empty to read the current one.', {
    group: 'Status',
  }),
  helmOutputFormatInput('Status'),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs(),
]

export const outputs: OutputParam[] = [...helmReleaseOutputs(), ...k8sOutputCore()]
