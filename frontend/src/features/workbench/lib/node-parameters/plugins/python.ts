/**
 * Python Plugin Parameters
 */

import {
  group,
  param,
  type GroupMeta,
  type InputParam,
  type MapKeyPolicy,
  type OutputParam,
} from '../types'
import {
  SHELL_NAME_PATTERN,
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

/** PYRUN-5: the entries are globals, so no WAVE_ ban, and no dunder name. */
const PYTHON_GLOBAL_KEY_POLICY: MapKeyPolicy = {
  keyNoun: 'variable',
  keyPattern: { pattern: SHELL_NAME_PATTERN, message: "Invalid variable name: '{key}'" },
  blockedPrefixes: [{ prefix: '__', message: "Variable names may not start with __: '{key}'" }],
}

// The Execution rows are placed one at a time: the Environment map sits between them.
const [WORKING_DIR, TIMEOUT, STREAM_OUTPUT] = localProcessExecutionInputs('script')

const EXPORTS = localProcessExportsParam('script')

export const groups: Record<string, GroupMeta> = {
  ...localProcessGroups(
    group('Script', { description: 'What to run and the arguments it gets' }),
    'script',
  ),
  Variables: group('Variables', {
    description: 'Values passed in as globals, and the process environment',
    defaultExpanded: true,
  }),
}

export const inputs: InputParam[] = [
  // --- Script ---
  param('script_type', 'Script Type', 'string', false, 'Source runs the script typed here. File runs a script file from Test Data, Artifacts or the WAVE server.', {
    enumValues: ['source', 'file'],
    enumLabels: { source: 'Source', file: 'File' },
    defaultValue: 'source',
    noExpression: true,
    group: 'Script',
  }),
  param('script', 'Script', 'string', false, 'The Python script to run. It runs under the interpreter named below.', {
    allowedFormats: ['python'],
    noExpression: true,
    showWhen: SOURCE,
    requiredWhen: SOURCE,
    retainOnHide: true,
    group: 'Script',
  }),
  param('script_file', 'Script File', 'string', false, 'The script file to run: testdata://, artifact:// or an absolute or relative path. A testdata:// or artifact:// file is read on WAVE; a plain path is read where the block runs.', {
    showWhen: FILE,
    requiredWhen: FILE,
    retainOnHide: true,
    fileReference: 'file',
    placeholder: 'testdata://…, artifact://…, or /abs/path',
    group: 'Script',
  }),
  param('interpreter', 'Interpreter', 'string', false, "The interpreter that runs the script. It may include flags, for example uv run --project /opt/lab-env. Empty runs WAVE's own interpreter.", {
    defaultValue: '',
    placeholder: "WAVE's own interpreter",
    group: 'Script',
  }),
  param('arguments', 'Arguments', 'array', false, 'Reach the script as sys.argv[1:], in row order. An empty row is passed as an empty argument.', {
    defaultValue: [],
    orderedList: { itemNoun: 'argument', positionPrefix: '$' },
    noExpression: true,
    group: 'Script',
  }),
  // --- Variables ---
  param('input_vars', 'Input Variables', 'map', false, 'Each entry is a global in the script before its first line runs. Types are kept: a float arrives as a Decimal, a table as a row-by-row object.', {
    defaultValue: {},
    group: 'Variables',
    keyPolicy: PYTHON_GLOBAL_KEY_POLICY,
  }),
  // --- Execution / Stop on Pattern / Failure Handling ---
  WORKING_DIR,
  localProcessEnvInput('environment', 'Environment', 'script'),
  STREAM_OUTPUT,
  ...localProcessStopPatternInputs('script'),
  TIMEOUT,
  ...localProcessFailureInputs(),
  {
    ...EXPORTS,
    description: "Python globals the script sets, each bound to one WAVE variable and read as that variable's type.",
    outputList: { ...EXPORTS.outputList, assignedIn: 'script' },
  },
]

export const outputs: OutputParam[] = localProcessOutputs(
  'script',
  'NonZeroExit, Exception, Timeout, FailPattern, StartFailed or OutputVariable',
)
