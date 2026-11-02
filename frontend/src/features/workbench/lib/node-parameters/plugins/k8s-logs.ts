/**
 * K8s Logs Plugin Parameters
 *
 * Reads one container's log from one pod. No mode and no All namespaces
 * (kubectl logs has no such flag). Output Format is two rows sharing one wire
 * name and the same values, one per Timestamps state (K8SREAD-16).
 */

import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type OutputParam,
  type OutputTypeRule,
} from '../types'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sOutputCore,
} from './_k8s-shared'

const TIMESTAMPS_OFF = { field: 'timestamps', values: ['false'] }
const TIMESTAMPS_ON = { field: 'timestamps', values: ['true'] }

// Timestamps picks the Output Format row, so the per-line option is named after the type it yields (K8SREAD-16).
const OUTPUT_FORMAT_TIMESTAMPED_LABELS: Record<string, string> = {
  string: 'String',
  array: 'Table',
}
const OUTPUT_FORMAT_TIMESTAMPED_DESCRIPTION =
  'How the log comes back. String is the text as the container wrote it, Table one row per line, with the time and the message in separate columns.'

function logsOutputFormatInput(): InputParam {
  return param('output_format', 'Output Format', 'string', false, 'How the log comes back. String is the text as the container wrote it, Array one entry per line.', {
    enumValues: ['string', 'array'],
    enumLabels: { string: 'String', array: 'Array' },
    defaultValue: 'string',
    noExpression: true,
  })
}

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Logs', {
    description: 'Which pod and container to read, and how much of the log to bring back',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Logs ---
  param('pod', 'Pod', 'string', true, 'The pod to read from. One pod per block; there is no label selector.', {
    group: 'Logs',
  }),
  // Required with no default: WAVE never picks a container for the author (K8SREAD-20).
  param('container', 'Container', 'string', true, 'Which container in the pod to use. Name it even when the pod has only one.', {
    group: 'Logs',
  }),
  param('previous', 'Previous Instance', 'boolean', false, 'Read the previous, terminated instance of the container instead of the running one. Fails when the container has not restarted.', {
    defaultValue: false,
    group: 'Logs',
  }),
  param('tail_lines', 'Tail Lines', 'integer', false, 'How many lines to return, counting back from the end. Leave empty for the whole log.', {
    group: 'Logs',
  }),
  param('since_seconds', 'Since (s)', 'integer', false, 'How far back to read, in seconds. Leave empty for the whole log.', {
    group: 'Logs',
  }),
  param('timestamps', 'Timestamps', 'boolean', false, 'Prefix every line with the time the container wrote it.', {
    defaultValue: false,
    noExpression: true,
    group: 'Logs',
  }),
  { ...logsOutputFormatInput(), group: 'Logs', showWhen: TIMESTAMPS_OFF },
  {
    ...logsOutputFormatInput(),
    description: OUTPUT_FORMAT_TIMESTAMPED_DESCRIPTION,
    enumLabels: OUTPUT_FORMAT_TIMESTAMPED_LABELS,
    group: 'Logs',
    showWhen: TIMESTAMPS_ON,
  },
  param('max_bytes', 'Max Bytes', 'integer', false, 'Stop reading after this many bytes. Anything past that is cut off.', {
    group: 'Logs',
  }),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'The namespace the pod is in. Leave empty to use the namespace the session carries.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_READ_DESCRIPTION,
  }),
]

// String is the raw text the API returns; the per-line option splits on Timestamps, so its rule comes first (K8SREAD-16).
const LOGS_TYPE_WHEN: OutputTypeRule[] = [
  {
    when: [
      { field: 'output_format', values: ['array'] },
      { field: 'timestamps', values: ['true'] },
    ],
    type: 'table',
  },
  { when: [{ field: 'output_format', values: ['array'] }], type: 'array' },
]

export const outputs: OutputParam[] = [
  output('logs', 'Logs', 'string', 'The log, cut to Tail Lines, Since and Max Bytes. Its type follows Output Format: text for String, one entry per line for Array, a row per line for Table.', { typeWhen: LOGS_TYPE_WHEN }),
  ...k8sOutputCore(),
]
