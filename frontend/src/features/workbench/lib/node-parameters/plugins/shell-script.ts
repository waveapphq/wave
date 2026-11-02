/**
 * Shell Script Plugin Parameters
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  localProcessEnvInput,
  localProcessExecutionInputs,
  localProcessExportsParam,
  localProcessFailureInputs,
  localProcessGroups,
  localProcessOutputs,
  localProcessStopPatternInputs,
} from './_local-process-params'

const SOURCE = { field: 'script_type', values: ['source'] }
const FILE = { field: 'script_type', values: ['file'] }

export const groups: Record<string, GroupMeta> = localProcessGroups(
  group('Script', { description: 'What to run and the arguments it gets' }),
  'script',
)

export const inputs: InputParam[] = [
  // --- Script ---
  param('script_type', 'Script Type', 'string', false, 'Source runs the script typed here. File runs a script file from Test Data, Artifacts or the WAVE server.', {
    enumValues: ['source', 'file'],
    enumLabels: { source: 'Source', file: 'File' },
    defaultValue: 'source',
    noExpression: true,
    group: 'Script',
  }),
  param('shell', 'Shell', 'string', false, 'The shell that runs the script. It may include flags, for example /bin/bash -o pipefail.', {
    defaultValue: '/bin/bash',
    group: 'Script',
  }),
  param('script', 'Script', 'string', false, 'The script to run. It runs under the shell named above, whatever its first line says.', {
    allowedFormats: ['plain'],
    showWhen: SOURCE,
    requiredWhen: SOURCE,
    retainOnHide: true,
    group: 'Script',
  }),
  param('script_file', 'Script File', 'string', false, 'The script file to run: testdata://, artifact:// or an absolute or relative path on the WAVE server. It runs under the shell named above, whatever its first line says.', {
    showWhen: FILE,
    requiredWhen: FILE,
    retainOnHide: true,
    fileReference: 'file',
    placeholder: 'testdata://…, artifact://…, or /abs/path',
    group: 'Script',
  }),
  param('arguments', 'Arguments', 'array', false, 'Passed to the script as $1, $2 and on, in row order. An empty row is passed as an empty argument.', {
    defaultValue: [],
    orderedList: { itemNoun: 'argument', positionPrefix: '$' },
    noExpression: true,
    group: 'Script',
  }),
  // --- Variables / Execution / Stop on Pattern / Failure Handling ---
  localProcessEnvInput('input_vars', 'Input Variables', 'script'),
  ...localProcessExecutionInputs('script'),
  ...localProcessStopPatternInputs('script'),
  ...localProcessFailureInputs(),
  localProcessExportsParam('script'),
]

export const outputs: OutputParam[] = localProcessOutputs(
  'script',
  'NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable',
)
