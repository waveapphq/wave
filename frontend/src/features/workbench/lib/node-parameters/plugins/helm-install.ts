/**
 * Helm Install Plugin Parameters
 *
 * Installs a chart as a new release (HELM-1). Atomic removes a failed install so
 * the release name stays free; nothing waits for readiness (HELM-2).
 */

import { group, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sOutputCore } from './_k8s-shared'
import {
  helmAtomicInput,
  helmCleanupTimeoutInput,
  HELM_ATOMIC_ON,
  helmAuthInputs,
  helmBlockGroups,
  helmBlockTailInputs,
  helmChartInputs,
  helmConnectionInputs,
  helmCreateNamespaceInput,
  helmOutputFormatInput,
  helmReleaseInput,
  helmReleaseOutputs,
} from './_helm-shared'

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Install', {
    description: 'Chart, release and values',
    defaultExpanded: true,
  }),
  { auth: true },
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...helmConnectionInputs(),
  // --- Install ---
  {
    ...helmReleaseInput('The name to give the release. A name already in use in the namespace is an error.'),
    group: 'Install',
  },
  ...helmChartInputs('Install'),
  helmOutputFormatInput('Install'),
  // --- Auth & TLS ---
  ...helmAuthInputs(),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs({
    createNamespace: helmCreateNamespaceInput('Create the namespace first when it does not exist yet.'),
    failureHandlingBeforeOnError: [
      helmAtomicInput('Remove the release again when the install fails, so its name stays free. helm waits for the resources by its own definition of ready before it decides.'),
      helmCleanupTimeoutInput(HELM_ATOMIC_ON),
    ],
  }),
]

export const outputs: OutputParam[] = [...helmReleaseOutputs(), ...k8sOutputCore()]
