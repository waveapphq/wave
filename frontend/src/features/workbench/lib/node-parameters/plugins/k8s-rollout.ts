/**
 * K8s Rollout Plugin Parameters
 *
 * Drives one workload through Restart, Status or Undo. `operation` is the
 * only row that reveals another: To revision belongs to Undo alone, and
 * the Status output is offered only in Status (K8SWRITE-7, K8SWRITE-8).
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sOutputCore,
} from './_k8s-shared'

const OPERATION_UNDO = { field: 'operation', values: ['undo'] }
const OPERATION_STATUS = { field: 'operation', values: ['status'] }

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Rollout', {
    description: 'Which workload to restart, report on or roll back',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Rollout ---
  param('operation', 'Operation', 'string', false, 'Restart replaces the pods with fresh ones. Status reports how the current rollout is going. Undo rolls the workload back to an earlier revision.', {
    enumValues: ['restart', 'status', 'undo'],
    enumLabels: { restart: 'Restart', status: 'Status', undo: 'Undo' },
    defaultValue: 'restart',
    noExpression: true,
    group: 'Rollout',
  }),
  param('kind', 'Kind', 'string', true, 'The three kinds that have a rollout. Anything else has no rollout to restart or report on.', {
    enumValues: ['Deployment', 'StatefulSet', 'DaemonSet'],
    defaultValue: 'Deployment',
    group: 'Rollout',
  }),
  param('name', 'Name', 'string', true, "The object's name.", {
    group: 'Rollout',
  }),
  param('to_revision', 'To revision', 'integer', false, 'The revision to roll back to. Leave empty to go back to the previous one.', {
    group: 'Rollout',
    showWhen: OPERATION_UNDO,
    retainOnHide: true,
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'Leave empty to use the namespace the session carries. Otherwise, the namespace the workload is in.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  }),
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', "One row per object: the resource, what happened to it, and the cluster's own sentence about the rollout."),
  output('status', 'Status', 'string', 'The rollout verdict: complete, progressing or failed. Use it to drive a Wait Until control.', { showWhen: OPERATION_STATUS }),
  ...k8sOutputCore(),
]
