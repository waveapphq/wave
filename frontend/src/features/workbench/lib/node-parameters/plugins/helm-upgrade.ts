/**
 * Helm Upgrade Plugin Parameters
 *
 * Upgrades a release to a chart or a set of values (HELM-3). Reuse Values and
 * Reset Values untick each other (HELM-4); Create Namespace shows only while
 * Install if missing is on, because that is the only state helm applies it in
 * (HELM-8).
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sOutputCore } from './_k8s-shared'
import {
  helmAtomicInput,
  helmAuthInputs,
  helmBlockGroups,
  helmBlockTailInputs,
  helmChartInputs,
  helmCleanupOnFailInput,
  helmCleanupTimeoutInput,
  HELM_ATOMIC_ON,
  HELM_CLEANUP_ON_FAIL_ON,
  helmConnectionInputs,
  helmCreateNamespaceInput,
  helmOutputFormatInput,
  helmReleaseInput,
  helmReleaseOutputs,
} from './_helm-shared'

const INSTALL_ON = { field: 'install', values: ['true'] }

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Upgrade', {
    description: 'Chart, release and values',
    defaultExpanded: true,
  }),
  { auth: true },
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...helmConnectionInputs(),
  // --- Upgrade ---
  { ...helmReleaseInput('The release to upgrade.'), group: 'Upgrade' },
  ...helmChartInputs('Upgrade'),
  param('install', 'Install if missing', 'boolean', false, 'Install the release when it does not exist yet, instead of failing.', {
    defaultValue: false,
    noExpression: true,
    group: 'Upgrade',
  }),
  param('reuse_values', 'Reuse Values', 'boolean', false, "Start from the current release's values and apply Values and Set on top. Ticking this unticks Reset Values.", {
    defaultValue: false,
    noExpression: true,
    exclusiveWith: ['reset_values'],
    group: 'Upgrade',
  }),
  param('reset_values', 'Reset Values', 'boolean', false, "Start from the chart's own defaults and apply Values and Set on top. Ticking this unticks Reuse Values.", {
    defaultValue: false,
    noExpression: true,
    exclusiveWith: ['reuse_values'],
    group: 'Upgrade',
  }),
  helmOutputFormatInput('Upgrade'),
  // --- Auth & TLS ---
  ...helmAuthInputs(),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs({
    createNamespace: {
      ...helmCreateNamespaceInput('Create the namespace first when it does not exist yet. helm applies it only while Install if missing is on.'),
      showWhen: INSTALL_ON,
    },
    failureHandlingBeforeOnError: [
      helmAtomicInput('Roll the release back to its previous revision when the upgrade fails. helm waits for the resources by its own definition of ready before it decides.'),
      helmCleanupOnFailInput('Delete the resources this upgrade created when it fails, instead of leaving them behind.'),
      helmCleanupTimeoutInput([...HELM_ATOMIC_ON, ...HELM_CLEANUP_ON_FAIL_ON]),
    ],
  }),
]

export const outputs: OutputParam[] = [...helmReleaseOutputs(), ...k8sOutputCore()]
