/**
 * Shell Script plugin parameter schema tests (REQ-3.4.1.1, REQ-3.4.2.2).
 *
 * Shell Script runs a script on the WAVE server. Script Type swaps the Script
 * body row for a Script File row and nothing else: the Shell row, the Arguments
 * list and every later group hold still (SHRUN-3, SHRUN-4). Stop on pattern
 * reveals the two pattern rows (SHRUN-13), and the variable exports ride an
 * output-list descriptor that never reaches the INPUT table (SHRUN-6).
 *
 * Design decisions: SHRUN-3, SHRUN-4, SHRUN-5, SHRUN-6, SHRUN-10, SHRUN-12, SHRUN-13, SHRUN-19
 */

import { describe, it, expect } from 'vitest'
import { FileTerminal } from 'lucide-react'
import {
  PLUGIN_INPUTS,
  PLUGIN_OUTPUTS,
  PLUGIN_GROUPS,
  getInputParams,
  getOutputParams,
  getGroupMeta,
  hasNodeParams,
} from '@/features/workbench/lib/node-parameters'
import { type InputParam, type OutputParam } from '@/features/workbench/lib/node-parameters/types'
import {
  isParameterVisible,
  matchesCondition,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import { isValidIconName } from '@/features/workbench/lib/icon-registry'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const ID = 'shell-script'

interface OrderedListDescriptor {
  itemNoun: string
  positionPrefix: string
}

interface OutputListDescriptor {
  nameHeading: string
  bindingHeading: string
  itemNoun: string
  addLabel: string
  namePattern: string
  nameRuleMessage: string
  invalidNameMessage: string
  clashMessage: string
  duplicateMessage: string
}

interface ListKeys {
  orderedList?: OrderedListDescriptor
  outputList?: OutputListDescriptor
}

/** The two list descriptors read off a row without widening the row to `unknown`. */
function listKeys(row: InputParam): ListKeys {
  return row as InputParam & ListKeys
}

function inputs(): InputParam[] {
  return getInputParams(ID) ?? []
}

function outputs(): OutputParam[] {
  return getOutputParams(ID) ?? []
}

function inputsByName(): Record<string, InputParam> {
  return Object.fromEntries(inputs().map((p) => [p.name, p]))
}

function outputsByName(): Record<string, OutputParam> {
  return Object.fromEntries(outputs().map((o) => [o.name, o]))
}

/** The rows the INPUT table renders; an output-list row never reaches it. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return inputs()
    .filter(
      (p, index) =>
        listKeys(p).outputList === undefined && isParameterVisible(all[index], values, all),
    )
    .map((p) => p.name)
}

function visibleInGroup(groupName: string, values: Record<string, unknown>): string[] {
  return visibleNames(values).filter((name) => inputsByName()[name].group === groupName)
}

/** The outputs the binding table offers for one set of field values. */
function visibleOutputs(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return outputs()
    .filter((o) => o.showWhen === undefined || matchesCondition(o.showWhen, values, all))
    .map((o) => o.name)
}

const SOURCE = { field: 'script_type', values: ['source'] }
const FILE = { field: 'script_type', values: ['file'] }
const ON = { field: 'stop_on_pattern', values: ['true'] }
const PASS_EMPTY = { field: 'pass_pattern', values: [''] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const PARAM_ORDER = [
  'script_type',
  'shell',
  'script',
  'script_file',
  'arguments',
  'input_vars',
  'working_dir',
  'timeout',
  'stream_output',
  'stop_on_pattern',
  'pass_pattern',
  'fail_pattern',
  'on_error',
  'script_variables',
]

const SCRIPT_PARAMS = ['script_type', 'shell', 'script', 'script_file', 'arguments']
const VARIABLES_PARAMS = ['input_vars']
const EXECUTION_PARAMS = ['working_dir', 'timeout', 'stream_output']
const STOP_PARAMS = ['stop_on_pattern', 'pass_pattern', 'fail_pattern']
const FAILURE_PARAMS = ['on_error']

const GROUP_ORDER = ['Script', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']
const EXPANDED_GROUPS = ['Script', 'Variables']
const COLLAPSED_GROUPS = ['Execution', 'Stop on Pattern', 'Failure Handling']

const SOURCE_ROWS = [
  'script_type',
  'shell',
  'script',
  'arguments',
  'input_vars',
  'working_dir',
  'timeout',
  'stream_output',
  'stop_on_pattern',
  'on_error',
]

const FILE_ROWS = [
  'script_type',
  'shell',
  'script_file',
  'arguments',
  'input_vars',
  'working_dir',
  'timeout',
  'stream_output',
  'stop_on_pattern',
  'on_error',
]

// Structural rows: they gate other rows or other outputs, so they take no expression.
const NO_EXPRESSION_PARAMS = ['script_type', 'arguments', 'stop_on_pattern', 'on_error']

const RETAINED_PARAMS = ['script', 'script_file', 'pass_pattern', 'fail_pattern']

const PARAM_LABELS: Record<string, string> = {
  script_type: 'Script Type',
  script: 'Script',
  script_file: 'Script File',
  shell: 'Shell',
  arguments: 'Arguments',
  input_vars: 'Input Variables',
  working_dir: 'Working Directory',
  timeout: 'Timeout',
  stream_output: 'Log Output',
  stop_on_pattern: 'Stop on pattern',
  pass_pattern: 'Pass pattern',
  fail_pattern: 'Fail pattern',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  script_type: 'string',
  script: 'string',
  script_file: 'string',
  shell: 'string',
  arguments: 'array',
  input_vars: 'map',
  working_dir: 'string',
  timeout: 'integer',
  stream_output: 'boolean',
  stop_on_pattern: 'boolean',
  pass_pattern: 'string',
  fail_pattern: 'string',
  on_error: 'string',
  script_variables: 'array',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  script_type: 'source',
  script: undefined,
  script_file: undefined,
  shell: '/bin/bash',
  arguments: [],
  input_vars: {},
  working_dir: undefined,
  timeout: 300,
  stream_output: false,
  stop_on_pattern: false,
  pass_pattern: '',
  fail_pattern: '',
  on_error: 'fail',
  script_variables: [],
}

/** The row with no default: an empty working directory means the system temp folder. */
const NO_DEFAULT_PARAMS = ['working_dir']

/** The rows the block reads with a default, the empty text, list or map included. */
const KEEPS_DEFAULT_PARAMS = [
  'script_type',
  'shell',
  'timeout',
  'pass_pattern',
  'fail_pattern',
  'arguments',
  'input_vars',
  'script_variables',
]

const PARAM_DESCRIPTIONS: Record<string, string> = {
  script_type:
    'Source runs the script typed here. File runs a script file from Test Data, Artifacts or the WAVE server.',
  script:
    'The script to run. It runs under the shell named above, whatever its first line says.',
  script_file:
    'The script file to run: testdata://, artifact:// or an absolute or relative path on the WAVE server. It runs under the shell named above, whatever its first line says.',
  shell: 'The shell that runs the script. It may include flags, for example /bin/bash -o pipefail.',
  arguments:
    'Passed to the script as $1, $2 and on, in row order. An empty row is passed as an empty argument.',
  input_vars:
    "Each entry is exported into the script's environment. Text, numbers and booleans arrive as text; arrays, maps and tables as JSON text.",
  working_dir:
    'Where the script starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the script runs on.',
  timeout: 'Seconds the script may run before WAVE stops it.',
  stream_output:
    'Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN.',
  stop_on_pattern: 'Stop the script as soon as a line of its output matches a pattern.',
  pass_pattern:
    'A Python regular expression. A matching line stops the script and the block passes.',
  fail_pattern:
    'A Python regular expression. A matching line stops the script and the block fails.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
  script_variables:
    "Shell variables the script sets, each bound to one WAVE variable and read as that variable's type.",
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  Script: 'What to run and the arguments it gets',
  Variables: 'Values passed in as environment variables',
  Execution: 'Where and how long it runs',
  'Stop on Pattern': 'End the script early when a line matches',
  'Failure Handling':
    'Record and continue sets Success, Error and Reason instead of failing the block',
}

const OUTPUT_ORDER = [
  ['stdout', 'string'],
  ['stderr', 'string'],
  ['exit_code', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const OUTPUT_LABELS: Record<string, string> = {
  stdout: 'Stdout',
  stderr: 'Stderr',
  exit_code: 'Exit Code',
  success: 'Success',
  error: 'Error',
  reason: 'Reason',
}

const OUTPUT_DESCRIPTIONS: Record<string, string> = {
  stdout: 'Everything the script wrote to standard output.',
  stderr: 'Everything the script wrote to standard error.',
  exit_code:
    "The script's exit code; 137 when WAVE stopped it, -1 when it never started. A non-zero code is a failure.",
  success: 'True when the script passed. False when it failed and On error is Record and continue.',
  error: 'The error message when the operation failed under Record and continue; empty otherwise',
  reason:
    'Why it failed: NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable; empty when it passed.',
}

const GATED_OUTPUTS = ['error', 'reason']

describe('registration', () => {
  it('registers shell-script in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers shell-script in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers shell-script in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves shell-script via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('leaves no schema registered under the block it replaces', () => {
    expect(PLUGIN_INPUTS['bash']).toBeUndefined()
    expect(PLUGIN_OUTPUTS['bash']).toBeUndefined()
    expect(PLUGIN_GROUPS['bash']).toBeUndefined()
    expect(hasNodeParams('bash')).toBe(false)
  })
})

describe('schema surface: count, order and groups', () => {
  it('declares exactly 14 input params in the pinned order', () => {
    expect(inputs().map((p) => p.name)).toEqual(PARAM_ORDER)
    expect(inputs()).toHaveLength(14)
  })

  it('assigns the Script group to the body, shell and argument rows (SHRUN-3, SHRUN-4)', () => {
    expect(inputs().filter((p) => p.group === 'Script').map((p) => p.name)).toEqual(SCRIPT_PARAMS)
  })

  it('assigns the Variables group to the Input Variables map (SHRUN-5)', () => {
    expect(inputs().filter((p) => p.group === 'Variables').map((p) => p.name)).toEqual(
      VARIABLES_PARAMS,
    )
  })

  it('assigns the Execution group to the directory, timeout and console rows', () => {
    expect(inputs().filter((p) => p.group === 'Execution').map((p) => p.name)).toEqual(
      EXECUTION_PARAMS,
    )
  })

  it('assigns the Stop on Pattern group to the toggle and its two patterns (SHRUN-13)', () => {
    expect(inputs().filter((p) => p.group === 'Stop on Pattern').map((p) => p.name)).toEqual(
      STOP_PARAMS,
    )
  })

  it('assigns the Failure Handling group to on_error', () => {
    expect(inputs().filter((p) => p.group === 'Failure Handling').map((p) => p.name)).toEqual(
      FAILURE_PARAMS,
    )
  })

  it('files the variable exports outside every rendered group (SHRUN-6)', () => {
    expect(GROUP_ORDER).not.toContain(inputsByName().script_variables.group)
  })

  it('labels every rendered row for display', () => {
    const params = inputsByName()

    for (const [name, label] of Object.entries(PARAM_LABELS)) {
      expect(params[name].label, name).toBe(label)
    }
  })

  it('types every parameter exactly', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].type, name).toBe(PARAM_TYPES[name])
    }
  })

  it('describes every parameter for the info badge', () => {
    expect(inputs()).toHaveLength(PARAM_ORDER.length)
    for (const param of inputs()) {
      expect(param.description, `description of ${param.name}`).toBeTruthy()
    }
  })

  it('carries the exact info-badge copy for every parameter', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('requires no row unconditionally, the body row following Script Type', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].required, name).toBe(false)
    }
  })

  it('flags no parameter secret', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].secret, name).not.toBe(true)
    }
  })
})

describe('defaults', () => {
  it('declares the exact default for every parameter', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].defaultValue, name).toEqual(PARAM_DEFAULTS[name])
    }
  })

  it('leaves only the working-directory row and the two script rows with no default', () => {
    const params = inputsByName()

    for (const name of NO_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeUndefined()
    }
    expect(PARAM_ORDER.filter((name) => params[name].defaultValue === undefined)).toEqual([
      'script',
      'script_file',
      'working_dir',
    ])
  })

  it('keeps a default on Script Type, Shell, Timeout and the pattern, argument, input-variable and export rows', () => {
    const params = inputsByName()

    for (const name of KEEPS_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeDefined()
    }
  })
})

describe('Script group (SHRUN-3)', () => {
  it('declares Script Type as source | file defaulting to Source', () => {
    const scriptType = inputsByName().script_type

    expect(scriptType.enumValues).toEqual(['source', 'file'])
    expect(scriptType.enumLabels).toEqual({ source: 'Source', file: 'File' })
    expect(scriptType.defaultValue).toBe('source')
    expect(scriptType.noExpression).toBe(true)
    expect(scriptType.showWhen).toBeUndefined()
  })

  it('shows and requires the Script body only while Script Type is Source', () => {
    const script = inputsByName().script

    expect(script.showWhen).toEqual(SOURCE)
    expect(script.requiredWhen).toEqual(SOURCE)
    expect(script.retainOnHide).toBe(true)
  })

  it('shows and requires Script File only while Script Type is File', () => {
    const scriptFile = inputsByName().script_file

    expect(scriptFile.showWhen).toEqual(FILE)
    expect(scriptFile.requiredWhen).toEqual(FILE)
    expect(scriptFile.retainOnHide).toBe(true)
    expect(scriptFile.placeholder).toBe('testdata://…, artifact://…, or /abs/path')
  })

  it('offers Browse over Test Data and Artifacts on the Script File row', () => {
    expect(inputsByName().script_file.fileReference).toBe('file')
  })

  it('pins the Script body to Plain, the picker offering nothing else (PYRUN-15)', () => {
    expect(inputsByName().script.allowedFormats).toEqual(['plain'])
  })

  it('locks no row other than the Script body to a value format', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      if (name === 'script') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })

  it('names the shell that runs the script, defaulting to /bin/bash', () => {
    const shell = inputsByName().shell

    expect(shell.type).toBe('string')
    expect(shell.defaultValue).toBe('/bin/bash')
    expect(shell.required).toBe(false)
    expect(shell.description).toBe(
      'The shell that runs the script. It may include flags, for example /bin/bash -o pipefail.',
    )
  })

  it('shows the Shell row under both Script Types, no detection deciding it', () => {
    const shell = inputsByName().shell

    expect(shell.showWhen).toBeUndefined()
    expect(shell.showWhenAll).toBeUndefined()
    expect(visibleNames({ script_type: 'source' })).toContain('shell')
    expect(visibleNames({ script_type: 'file' })).toContain('shell')
  })

  it('declares Arguments as an ordered list of positional rows (SHRUN-4)', () => {
    const args = inputsByName().arguments

    expect(args.type).toBe('array')
    expect(listKeys(args).orderedList).toEqual({ itemNoun: 'argument', positionPrefix: '$' })
    expect(args.noExpression).toBe(true)
    expect(args.partsEditor).toBeUndefined()
    expect(args.cipherPicker).toBeUndefined()
  })

  it('shows the same Arguments list under both Script Types (SHRUN-4)', () => {
    expect(visibleInGroup('Script', { script_type: 'source' })).toEqual([
      'script_type',
      'shell',
      'script',
      'arguments',
    ])
    expect(visibleInGroup('Script', { script_type: 'file' })).toEqual([
      'script_type',
      'shell',
      'script_file',
      'arguments',
    ])
  })
})

describe('Variables group (SHRUN-5)', () => {
  it('declares Input Variables as a map under a key policy', () => {
    const inputVars = inputsByName().input_vars

    expect(inputVars.name).toBe('input_vars')
    expect(inputVars.label).toBe('Input Variables')
    expect(inputVars.type).toBe('map')
    expect(inputVars.required).toBe(false)
    expect(inputVars.keyPolicy).toBeDefined()
  })

  it('puts a key policy on the map row and nowhere else', () => {
    const withPolicy = inputs().filter((p) => p.keyPolicy !== undefined)

    expect(withPolicy.map((p) => p.name)).toEqual(['input_vars'])
  })
})

describe('Execution group (SHRUN-10)', () => {
  it('leaves Working Directory empty with the System temp folder placeholder and offers Browse over folders (REQ-3.4.3.11)', () => {
    const workingDir = inputsByName().working_dir

    expect(workingDir.type).toBe('string')
    expect(workingDir.defaultValue).toBeUndefined()
    expect(workingDir.placeholder).toBe('System temp folder')
    expect(workingDir.fileReference).toBe('folder')
  })

  it('puts a picker on the Script File and Working Directory rows only', () => {
    const withPicker = inputs().filter((p) => p.fileReference !== undefined)

    expect(withPicker.map((p) => p.name)).toEqual(['script_file', 'working_dir'])
  })

  it('declares Timeout as an integer defaulting to 300 seconds', () => {
    const timeout = inputsByName().timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(300)
    expect(timeout.required).toBe(false)
  })

  it('declares Log Output as a checkbox that starts off (SHRUN-12)', () => {
    const streamOutput = inputsByName().stream_output

    expect(streamOutput.name).toBe('stream_output')
    expect(streamOutput.label).toBe('Log Output')
    expect(streamOutput.type).toBe('boolean')
    expect(streamOutput.defaultValue).toBe(false)
  })
})

describe('Stop on Pattern group (SHRUN-13)', () => {
  it('declares the toggle as a checkbox that starts off', () => {
    const stop = inputsByName().stop_on_pattern

    expect(stop.type).toBe('boolean')
    expect(stop.defaultValue).toBe(false)
    expect(stop.showWhen).toBeUndefined()
  })

  it('hides both pattern rows while the toggle is off', () => {
    expect(visibleInGroup('Stop on Pattern', { script_type: 'source', stop_on_pattern: false })).toEqual([
      'stop_on_pattern',
    ])
  })

  it('shows both pattern rows while the toggle is on', () => {
    expect(visibleInGroup('Stop on Pattern', { script_type: 'source', stop_on_pattern: true })).toEqual(
      STOP_PARAMS,
    )
  })

  it('gates both pattern rows on the toggle and keeps their drafts', () => {
    const params = inputsByName()

    for (const name of ['pass_pattern', 'fail_pattern']) {
      expect(params[name].showWhen, name).toEqual(ON)
      expect(params[name].retainOnHide, name).toBe(true)
    }
  })

  it('requires at least one pattern through the Fail pattern row alone', () => {
    const failPattern = inputsByName().fail_pattern
    const passPattern = inputsByName().pass_pattern

    expect(failPattern.requiredWhenAll).toEqual([ON, PASS_EMPTY])
    expect(failPattern.requiredMessage).toBe('Set a pass pattern, a fail pattern or both')
    expect(passPattern.requiredWhenAll).toBeUndefined()
    expect(passPattern.requiredMessage).toBeUndefined()
  })

  it('carries the at-least-one message on no other row, so it shows once', () => {
    const withMessage = inputs().filter((p) => p.requiredMessage !== undefined)

    expect(withMessage.map((p) => p.name)).toEqual(['fail_pattern'])
  })
})

describe('Failure Handling group', () => {
  it('declares on_error as fail | record defaulting to fail', () => {
    const onError = inputsByName().on_error

    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({
      fail: 'Fail the block',
      record: 'Record and continue',
    })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
  })
})

describe('variable exports (SHRUN-6)', () => {
  it('declares the exports as an array the INPUT table never renders', () => {
    const exportsRow = inputsByName().script_variables

    expect(exportsRow.type).toBe('array')
    expect(listKeys(exportsRow).outputList).toBeDefined()
    expect(visibleNames({ script_type: 'source' })).not.toContain('script_variables')
    expect(visibleNames({ script_type: 'file' })).not.toContain('script_variables')
  })

  it('carries the output-list policy on that row alone', () => {
    const withPolicy = inputs().filter((p) => listKeys(p).outputList !== undefined)

    expect(withPolicy.map((p) => p.name)).toEqual(['script_variables'])
  })

  it('names the table columns, the add button and the shell name rule', () => {
    const policy = listKeys(inputsByName().script_variables).outputList

    expect(policy?.nameHeading).toBe('Script Variable')
    expect(policy?.bindingHeading).toBe('WAVE Variable')
    expect(policy?.itemNoun).toBe('variable export')
    expect(policy?.addLabel).toBe('Add variable export')
    expect(policy?.namePattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$')
    expect(policy?.nameRuleMessage).toBe(
      'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
    )
  })

  it('carries the exact row messages for a bad, clashing or repeated name', () => {
    const policy = listKeys(inputsByName().script_variables).outputList

    expect(policy?.invalidNameMessage).toBe("Invalid script variable name: '{name}'")
    expect(policy?.clashMessage).toBe("Script variable '{name}' has the name of a block output")
    expect(policy?.duplicateMessage).toBe("Script variable '{name}' is listed more than once")
  })

  it('carries no ordered-list descriptor on the export row', () => {
    expect(listKeys(inputsByName().script_variables).orderedList).toBeUndefined()
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on the structural rows', () => {
    const params = inputsByName()

    for (const name of NO_EXPRESSION_PARAMS) {
      expect(params[name].noExpression, name).toBe(true)
    }
  })

  it('keeps the expression toggle on Log Output', () => {
    expect(inputsByName().stream_output.noExpression).toBeUndefined()
  })

  it('leaves every other row expression-capable', () => {
    const expressive = inputs().filter((p) => !NO_EXPRESSION_PARAMS.includes(p.name))

    expect(expressive).toHaveLength(10)
    for (const param of expressive) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('keeps the drafts of the two body rows and the two patterns', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      if (RETAINED_PARAMS.includes(name)) {
        expect(params[name].retainOnHide, name).toBe(true)
      } else {
        expect(params[name].retainOnHide, name).not.toBe(true)
      }
    }
  })
})

describe('group metadata', () => {
  it('declares the five groups in the pinned order', () => {
    const meta = getGroupMeta(ID)

    expect(meta).toBeDefined()
    expect(Object.keys(meta!)).toEqual(GROUP_ORDER)
  })

  it('opens the Script and Variables groups and collapses the rest', () => {
    const meta = getGroupMeta(ID)!

    for (const name of EXPANDED_GROUPS) {
      expect(meta[name].defaultExpanded, `${name} expanded`).toBe(true)
    }
    for (const name of COLLAPSED_GROUPS) {
      expect(meta[name].defaultExpanded, `${name} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact footer under every group', () => {
    const meta = getGroupMeta(ID)!

    for (const [name, description] of Object.entries(GROUP_DESCRIPTIONS)) {
      expect(meta[name].description, name).toBe(description)
    }
  })
})

describe('visible rows per state (SHRUN-3, SHRUN-13)', () => {
  it('shows the Source rows on open', () => {
    expect(visibleNames({ script_type: 'source' })).toEqual(SOURCE_ROWS)
  })

  it('swaps the body row for Script File under File', () => {
    expect(visibleNames({ script_type: 'file' })).toEqual(FILE_ROWS)
  })

  it('adds the two pattern rows under Source while the toggle is on', () => {
    expect(visibleNames({ script_type: 'source', stop_on_pattern: true })).toEqual([
      'script_type',
      'shell',
      'script',
      'arguments',
      'input_vars',
      'working_dir',
      'timeout',
      'stream_output',
      'stop_on_pattern',
      'pass_pattern',
      'fail_pattern',
      'on_error',
    ])
  })

  it('adds the two pattern rows under File while the toggle is on', () => {
    expect(visibleNames({ script_type: 'file', stop_on_pattern: true })).toEqual([
      'script_type',
      'shell',
      'script_file',
      'arguments',
      'input_vars',
      'working_dir',
      'timeout',
      'stream_output',
      'stop_on_pattern',
      'pass_pattern',
      'fail_pattern',
      'on_error',
    ])
  })

  it('leaves the INPUT rows alone under Record and continue', () => {
    expect(visibleNames({ script_type: 'source', on_error: 'record' })).toEqual(SOURCE_ROWS)
  })
})

describe('outputs', () => {
  it('declares the six outputs in order', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs()).toHaveLength(6)
  })

  it('labels every output', () => {
    const byName = outputsByName()

    for (const [name, label] of Object.entries(OUTPUT_LABELS)) {
      expect(byName[name].label, name).toBe(label)
    }
  })

  it('carries the exact copy on every output', () => {
    const byName = outputsByName()

    for (const [name, description] of Object.entries(OUTPUT_DESCRIPTIONS)) {
      expect(byName[name].description, name).toBe(description)
    }
  })

  it('names OutputVariable among the reasons a Shell Script run failed', () => {
    expect(outputsByName().reason.description).toBe(
      'Why it failed: NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable; empty when it passed.',
    )
  })

  it('flags no output secret in the schema', () => {
    expect(outputs()).toHaveLength(6)
    for (const output of outputs()) {
      expect(output.secret, `secret of ${output.name}`).not.toBe(true)
    }
  })

  it('varies no output type with the sheet state', () => {
    expect(outputs()).toHaveLength(6)
    for (const output of outputs()) {
      expect(output.typeWhen, `typeWhen of ${output.name}`).toBeUndefined()
    }
  })
})

describe('output gating', () => {
  it('offers Error and Reason only under Record and continue', () => {
    const byName = outputsByName()

    expect(byName.error.showWhen).toEqual(RECORD_GATE)
    expect(byName.reason.showWhen).toEqual(RECORD_GATE)
  })

  it('gates Error and Reason and no other output', () => {
    const gated = outputs()
      .filter((o) => o.showWhen !== undefined)
      .map((o) => o.name)

    expect(gated).toEqual(GATED_OUTPUTS)
  })

  it('offers four outputs while On error is Fail the block', () => {
    expect(visibleOutputs({ on_error: 'fail' })).toEqual([
      'stdout',
      'stderr',
      'exit_code',
      'success',
    ])
  })

  it('offers all six outputs under Record and continue', () => {
    expect(visibleOutputs({ on_error: 'record' })).toEqual([
      'stdout',
      'stderr',
      'exit_code',
      'success',
      'error',
      'reason',
    ])
  })
})

describe('palette and icon wiring (SHRUN-19)', () => {
  it('defines the Shell Script palette row in the System category', () => {
    const def = getPluginById(ID)

    expect(def).toBeDefined()
    expect(def!.name).toBe('Shell Script')
    expect(def!.category).toBe('system')
    expect(def!.iconName).toBe('FileTerminal')
    expect(def!.colorClass).toBe('text-red-500')
  })

  it('runs on WAVE only, so it is not remotable (SHRUN-1)', () => {
    expect(getPluginById(ID)?.remotable).toBe(false)
  })

  it('carries the Script glyph every Script block carries', () => {
    expect(isValidIconName('FileTerminal')).toBe(true)
    expect(getPluginById('k8s-script')?.iconName).toBe('FileTerminal')
    expect(getPluginById('ssh-session-script')?.iconName).toBe('FileTerminal')
  })

  it('registers all three canvas maps for shell-script', () => {
    expect(getIcon(ID)).toBe(FileTerminal)
    expect(getIconName(ID)).toBe('file-terminal')
    expect(getColorClass(ID)).toBe('text-red-500')
  })

  it('leaves no palette row under the block it replaces', () => {
    expect(getPluginById('bash')).toBeUndefined()
  })
})
