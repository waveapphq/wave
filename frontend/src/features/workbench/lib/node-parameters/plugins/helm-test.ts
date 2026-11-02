/**
 * Helm Test Plugin Parameters
 *
 * Runs the chart's test hooks and reports one Result row per hook (HELM-7).
 * Logs is offered for binding only while the Logs toggle is on, so an author who
 * never asks for logs never sees a Logs variable to bind.
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sOutputCore } from './_k8s-shared'
import {
  helmBlockGroups,
  helmBlockTailInputs,
  helmConnectionInputs,
  helmOutputFormatInput,
  helmReleaseInput,
  helmResultOutput,
} from './_helm-shared'

const LOGS_ON = { field: 'logs', values: ['true'] }

export const groups: Record<string, GroupMeta> = helmBlockGroups(
  group('Test', {
    description: "Run the chart's test hooks",
    defaultExpanded: true,
  }),
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...helmConnectionInputs(),
  // --- Test ---
  { ...helmReleaseInput('The release whose test hooks to run.'), group: 'Test' },
  param('logs', 'Logs', 'boolean', false, 'Collect what each test pod printed and report it in the Logs output.', {
    defaultValue: false,
    noExpression: true,
    group: 'Test',
  }),
  helmOutputFormatInput('Test'),
  // --- Advanced + Failure Handling ---
  ...helmBlockTailInputs(),
]

export const outputs: OutputParam[] = [
  helmResultOutput('One row per test hook: its name, kind, phase and when it started and completed. A chart with no tests gives an empty result.'),
  output('logs', 'Logs', 'string', 'What the test pods printed, in the sections helm prints them in.', {
    showWhen: LOGS_ON,
  }),
  ...k8sOutputCore(),
]
