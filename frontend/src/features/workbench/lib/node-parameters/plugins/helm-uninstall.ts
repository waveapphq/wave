/**
 * Helm Uninstall Plugin Parameters
 *
 * Removes a release (HELM-10). It carries the K8s Delete controls helm has a
 * flag for, and reports the shared output core alone: once the release is gone
 * there is nothing left to describe, so no Result, no Status and no Output
 * Format row.
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sOutputCore } from './_k8s-shared'
import {
  helmBlockGroups,
  helmBlockTailInputs,
  helmConnectionInputs,
  helmReleaseInput,
} from './_helm-shared'

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Uninstall', {
    description: 'Release to remove',
    defaultExpanded: true,
  }),
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...helmConnectionInputs(),
  // --- Uninstall ---
  { ...helmReleaseInput('The release to remove.'), group: 'Uninstall' },
  param('keep_history', 'Keep History', 'boolean', false, 'Keep the release history so the release can still be rolled back after it is removed.', {
    defaultValue: false,
    group: 'Uninstall',
  }),
  param('ignore_not_found', 'Ignore Not Found', 'boolean', false, 'Treat a release that is already gone as a success instead of an error.', {
    defaultValue: false,
    group: 'Uninstall',
  }),
  param('cascade', 'Cascade', 'string', false, 'Choose Background to return at once and let the cluster remove the children after, Foreground to wait until the children are gone, or Orphan to leave them running.', {
    enumValues: ['background', 'foreground', 'orphan'],
    enumLabels: { background: 'Background', foreground: 'Foreground', orphan: 'Orphan' },
    defaultValue: 'background',
    noExpression: true,
    group: 'Uninstall',
  }),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs(),
]

export const outputs: OutputParam[] = k8sOutputCore()
