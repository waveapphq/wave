/**
 * Python plugin parameter schema tests (REQ-3.4.1.2, REQ-3.4.2.2).
 *
 * The Python block is the Shell Script block with a different variable
 * contract (PYRUN-1): Script Type swaps the Script body for a Script File row,
 * Interpreter replaces the Shell row (PYRUN-3), Input Variables are globals
 * rather than environment text (PYRUN-5) and the block keeps its own
 * Environment map beside them. Groups and outputs follow Shell Script's, and
 * the variable exports ride an output-list descriptor that never reaches the
 * INPUT table (PYRUN-6).
 *
 * Design decisions: PYRUN-1, PYRUN-2, PYRUN-3, PYRUN-4, PYRUN-5, PYRUN-6,
 *                   PYRUN-7, PYRUN-11, PYRUN-13, PYRUN-14
 */

import { describe, it, expect, vi } from 'vitest'
import { FileCode2 } from 'lucide-react'
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
import { seedOutputListRows } from '@/features/workbench/lib/node-parameters/output-list'
import {
  LOCAL_PROCESS_ENV_KEY_POLICY,
  localProcessExportsParam,
} from '@/features/workbench/lib/node-parameters/plugins/_local-process-params'
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

const ID = 'python'
const SHELL = 'shell-script'

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
  /** The body the unassigned-export warning reads (PYRUN-14). */
  assignedIn?: string
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

function shellInputsByName(): Record<string, InputParam> {
  return Object.fromEntries((getInputParams(SHELL) ?? []).map((p) => [p.name, p]))
}

function shellOutputsByName(): Record<string, OutputParam> {
  return Object.fromEntries((getOutputParams(SHELL) ?? []).map((o) => [o.name, o]))
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
  'script',
  'script_file',
  'interpreter',
  'arguments',
  'input_vars',
  'working_dir',
  'environment',
  'stream_output',
  'stop_on_pattern',
  'pass_pattern',
  'fail_pattern',
  'timeout',
  'on_error',
  'script_variables',
]

const SCRIPT_PARAMS = ['script_type', 'script', 'script_file', 'interpreter', 'arguments']
const VARIABLES_PARAMS = ['input_vars', 'environment']
const EXECUTION_PARAMS = ['working_dir', 'stream_output', 'timeout']
const STOP_PARAMS = ['stop_on_pattern', 'pass_pattern', 'fail_pattern']
const FAILURE_PARAMS = ['on_error']

const GROUP_ORDER = ['Script', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']

const SOURCE_ROWS = [
  'script_type',
  'script',
  'interpreter',
  'arguments',
  'input_vars',
  'working_dir',
  'environment',
  'stream_output',
  'stop_on_pattern',
  'timeout',
  'on_error',
]

const FILE_ROWS = [
  'script_type',
  'script_file',
  'interpreter',
  'arguments',
  'input_vars',
  'working_dir',
  'environment',
  'stream_output',
  'stop_on_pattern',
  'timeout',
  'on_error',
]

const SOURCE_ROWS_PATTERN_ON = [
  'script_type',
  'script',
  'interpreter',
  'arguments',
  'input_vars',
  'working_dir',
  'environment',
  'stream_output',
  'stop_on_pattern',
  'pass_pattern',
  'fail_pattern',
  'timeout',
  'on_error',
]

// Structural rows: they gate other rows or other outputs, so they take no expression.
// The Script body joins them because it is never template-expanded (PYRUN-13).
const NO_EXPRESSION_PARAMS = [
  'script_type',
  'script',
  'arguments',
  'stop_on_pattern',
  'on_error',
]

const RETAINED_PARAMS = ['script', 'script_file', 'pass_pattern', 'fail_pattern']

const PARAM_LABELS: Record<string, string> = {
  script_type: 'Script Type',
  script: 'Script',
  script_file: 'Script File',
  interpreter: 'Interpreter',
  arguments: 'Arguments',
  input_vars: 'Input Variables',
  working_dir: 'Working Directory',
  environment: 'Environment',
  stream_output: 'Log Output',
  stop_on_pattern: 'Stop on pattern',
  pass_pattern: 'Pass pattern',
  fail_pattern: 'Fail pattern',
  timeout: 'Timeout',
  on_error: 'On error',
  script_variables: 'Variable Exports',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  script_type: 'string',
  script: 'string',
  script_file: 'string',
  interpreter: 'string',
  arguments: 'array',
  input_vars: 'map',
  working_dir: 'string',
  environment: 'map',
  stream_output: 'boolean',
  stop_on_pattern: 'boolean',
  pass_pattern: 'string',
  fail_pattern: 'string',
  timeout: 'integer',
  on_error: 'string',
  script_variables: 'array',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  script_type: 'source',
  script: undefined,
  script_file: undefined,
  interpreter: '',
  arguments: [],
  input_vars: {},
  working_dir: undefined,
  environment: {},
  stream_output: false,
  stop_on_pattern: false,
  pass_pattern: '',
  fail_pattern: '',
  timeout: 300,
  on_error: 'fail',
  script_variables: [],
}

/** Rows whose info-badge copy is Shell Script's, word for word. Arguments is not one of
 * them: PYRUN-4 says the rows reach a Python script as sys.argv, never as $1. */
const SHARED_DESCRIPTION_PARAMS = [
  'script_type',
  'working_dir',
  'stream_output',
  'stop_on_pattern',
  'pass_pattern',
  'fail_pattern',
  'timeout',
  'on_error',
]

const INTERPRETER_DESCRIPTION =
  "The interpreter that runs the script. It may include flags, for example uv run --project /opt/lab-env. Empty runs WAVE's own interpreter."

const OUTPUT_ORDER = [
  ['stdout', 'string'],
  ['stderr', 'string'],
  ['exit_code', 'integer'],
  ['success', 'boolean'],
  ['error', 'string'],
  ['reason', 'string'],
]

const GATED_OUTPUTS = ['error', 'reason']

/** PYRUN-7 adds Exception to Shell Script's list of reasons. */
const REASON_DESCRIPTION =
  'Why it failed: NonZeroExit, Exception, Timeout, FailPattern, StartFailed or OutputVariable; empty when it passed.'

/** The rows the struck code-executor scheme declared; none of them survives. */
const STRUCK_PARAMS = ['code', 'output_vars', 'cpu_limit', 'memory_limit', 'storage_limit']

describe('registration', () => {
  it('registers python in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers python in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers python in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves python via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })

  it('serves the same arrays through the lookups', () => {
    expect(getInputParams(ID)).toBe(PLUGIN_INPUTS[ID])
    expect(getOutputParams(ID)).toBe(PLUGIN_OUTPUTS[ID])
    expect(getGroupMeta(ID)).toBe(PLUGIN_GROUPS[ID])
  })
})

describe('schema surface: count, order and groups', () => {
  it('declares exactly 15 input params in the pinned order', () => {
    expect(inputs().map((p) => p.name)).toEqual(PARAM_ORDER)
    expect(inputs()).toHaveLength(15)
  })

  it('assigns the Script group to the body, interpreter and argument rows', () => {
    expect(inputs().filter((p) => p.group === 'Script').map((p) => p.name)).toEqual(SCRIPT_PARAMS)
  })

  it('assigns the Variables group to both maps (PYRUN-5)', () => {
    expect(inputs().filter((p) => p.group === 'Variables').map((p) => p.name)).toEqual(
      VARIABLES_PARAMS,
    )
  })

  it('assigns the Execution group to the directory, console and timeout rows', () => {
    expect(inputs().filter((p) => p.group === 'Execution').map((p) => p.name)).toEqual(
      EXECUTION_PARAMS,
    )
  })

  it('assigns the Stop on Pattern group to the toggle and its two patterns (PYRUN-11)', () => {
    expect(inputs().filter((p) => p.group === 'Stop on Pattern').map((p) => p.name)).toEqual(
      STOP_PARAMS,
    )
  })

  it('assigns the Failure Handling group to on_error', () => {
    expect(inputs().filter((p) => p.group === 'Failure Handling').map((p) => p.name)).toEqual(
      FAILURE_PARAMS,
    )
  })

  it('files the variable exports outside every rendered group (PYRUN-6)', () => {
    expect(GROUP_ORDER).not.toContain(inputsByName().script_variables.group)
  })

  it('labels every row for display', () => {
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

  it('declares the exact default for every parameter', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].defaultValue, name).toEqual(PARAM_DEFAULTS[name])
    }
  })

  it('leaves none of the struck code-executor rows behind', () => {
    const params = inputsByName()

    for (const name of STRUCK_PARAMS) {
      expect(params[name], name).toBeUndefined()
    }
  })
})

describe('rows shared with Shell Script', () => {
  it('carries Shell Script copy word for word on every shared row', () => {
    const params = inputsByName()
    const shell = shellInputsByName()

    for (const name of SHARED_DESCRIPTION_PARAMS) {
      expect(params[name].description, name).toBe(shell[name].description)
    }
  })

  it('declares Script Type as source | file defaulting to Source (PYRUN-2)', () => {
    const scriptType = inputsByName().script_type

    expect(scriptType.enumValues).toEqual(['source', 'file'])
    expect(scriptType.enumLabels).toEqual({ source: 'Source', file: 'File' })
    expect(scriptType.defaultValue).toBe('source')
    expect(scriptType.noExpression).toBe(true)
    expect(scriptType.showWhen).toBeUndefined()
  })

  it('declares Arguments as an ordered list of positional rows (PYRUN-4)', () => {
    const args = inputsByName().arguments

    expect(args.type).toBe('array')
    expect(listKeys(args).orderedList).toEqual({ itemNoun: 'argument', positionPrefix: '$' })
    expect(args.noExpression).toBe(true)
    expect(args.description).toContain('sys.argv')
    expect(args.description).not.toContain('$1')
  })

  it('leaves Working Directory empty with the System temp folder placeholder and offers Browse over folders (PYRUN-9, REQ-3.4.3.11)', () => {
    const workingDir = inputsByName().working_dir

    expect(workingDir.defaultValue).toBeUndefined()
    expect(workingDir.placeholder).toBe('System temp folder')
    expect(workingDir.fileReference).toBe('folder')
    expect(workingDir.description).toBe(
      'Where the script starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the script runs on.',
    )
  })

  it('declares Timeout as an integer defaulting to 300 seconds (PYRUN-11)', () => {
    const timeout = inputsByName().timeout

    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(300)
  })

  it('declares Log Output as a checkbox that starts off (PYRUN-11)', () => {
    const streamOutput = inputsByName().stream_output

    expect(streamOutput.name).toBe('stream_output')
    expect(streamOutput.label).toBe('Log Output')
    expect(streamOutput.type).toBe('boolean')
    expect(streamOutput.defaultValue).toBe(false)
  })

  it('gates both pattern rows on the toggle and keeps their drafts (PYRUN-11)', () => {
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

  it('declares on_error as fail | record defaulting to fail (PYRUN-7)', () => {
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

describe('Script body (PYRUN-2, PYRUN-13)', () => {
  it('shows and requires the Script body only while Script Type is Source', () => {
    const script = inputsByName().script

    expect(script.showWhen).toEqual(SOURCE)
    expect(script.requiredWhen).toEqual(SOURCE)
    expect(script.retainOnHide).toBe(true)
  })

  it('locks the body editor to the Python format', () => {
    expect(inputsByName().script.allowedFormats).toEqual(['python'])
  })

  it('locks no other row to a value format', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      if (name === 'script') continue
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })

  it('offers no Kind dropdown on the body, which is never template-expanded', () => {
    expect(inputsByName().script.noExpression).toBe(true)
  })

  it('says nothing about a shell in the body copy', () => {
    const description = inputsByName().script.description ?? ''

    expect(description).toBeTruthy()
    expect(description.toLowerCase()).not.toContain('shell')
  })

  it('shows and requires Script File only while Script Type is File', () => {
    const scriptFile = inputsByName().script_file

    expect(scriptFile.showWhen).toEqual(FILE)
    expect(scriptFile.requiredWhen).toEqual(FILE)
    expect(scriptFile.retainOnHide).toBe(true)
  })

  it('offers Browse over Test Data and Artifacts on the Script File row', () => {
    const scriptFile = inputsByName().script_file

    expect(scriptFile.fileReference).toBe('file')
    expect(scriptFile.placeholder).toBe('testdata://…, artifact://…, or /abs/path')
  })

  it('says nothing about a shell in the Script File copy', () => {
    const description = inputsByName().script_file.description ?? ''

    expect(description).toContain('testdata://')
    expect(description.toLowerCase()).not.toContain('shell')
  })

  it('puts a picker on the Script File and Working Directory rows only', () => {
    const withPicker = inputs().filter((p) => p.fileReference !== undefined)

    expect(withPicker.map((p) => p.name)).toEqual(['script_file', 'working_dir'])
  })
})

describe('Interpreter row (PYRUN-3)', () => {
  it('replaces the Shell row and declares no shell of its own', () => {
    expect(inputsByName().shell).toBeUndefined()
    expect(inputsByName().interpreter.label).toBe('Interpreter')
  })

  it('is an optional string in the Script group whose default is the empty text the block reads', () => {
    const interpreter = inputsByName().interpreter

    expect(interpreter.type).toBe('string')
    expect(interpreter.required).toBe(false)
    expect(interpreter.group).toBe('Script')
    expect(interpreter.defaultValue).toBe('')
  })

  it("offers WAVE's own interpreter as the empty-state placeholder", () => {
    expect(inputsByName().interpreter.placeholder).toBe("WAVE's own interpreter")
  })

  it('carries the exact info-badge copy', () => {
    expect(inputsByName().interpreter.description).toBe(INTERPRETER_DESCRIPTION)
  })

  it('takes an expression, so an Environment can name its own interpreter', () => {
    expect(inputsByName().interpreter.noExpression).toBeUndefined()
  })

  it('shows the Interpreter row under both Script Types', () => {
    expect(inputsByName().interpreter.showWhen).toBeUndefined()
    expect(visibleNames({ script_type: 'source' })).toContain('interpreter')
    expect(visibleNames({ script_type: 'file' })).toContain('interpreter')
  })
})

describe('Input Variables map (PYRUN-5)', () => {
  it('is an optional map in the Variables group', () => {
    const inputVars = inputsByName().input_vars

    expect(inputVars.name).toBe('input_vars')
    expect(inputVars.label).toBe('Input Variables')
    expect(inputVars.type).toBe('map')
    expect(inputVars.required).toBe(false)
    expect(inputVars.group).toBe('Variables')
  })

  it('calls its entries globals and never the environment', () => {
    const description = inputsByName().input_vars.description ?? ''

    expect(description).toContain('global')
    expect(description.toLowerCase()).not.toContain('environment')
  })

  it('carries a key policy of its own, not the shared environment one', () => {
    const policy = inputsByName().input_vars.keyPolicy

    expect(policy).toBeDefined()
    expect(policy).not.toEqual(LOCAL_PROCESS_ENV_KEY_POLICY)
    expect(policy?.keyNoun).toBe('variable')
  })

  it('accepts a Python identifier as a key', () => {
    const declared = inputsByName().input_vars.keyPolicy?.keyPattern?.pattern
    const pattern = new RegExp(declared ?? '')

    expect(declared).toBeDefined()
    expect(pattern.test('limit')).toBe(true)
    expect(pattern.test('_x')).toBe(true)
    expect(pattern.test('temp_c2')).toBe(true)
  })

  it('rejects a key that is not an identifier', () => {
    const policy = inputsByName().input_vars.keyPolicy
    const pattern = new RegExp(policy?.keyPattern?.pattern ?? '')

    expect(pattern.test('1bad')).toBe(false)
    expect(pattern.test('a-b')).toBe(false)
    expect(pattern.test('a b')).toBe(false)
    expect(policy?.keyPattern?.message).toBe("Invalid variable name: '{key}'")
  })

  it('rejects a key that starts with two underscores', () => {
    const policy = inputsByName().input_vars.keyPolicy
    const prefixes = policy?.blockedPrefixes ?? []
    const dunder = prefixes.find((rule) => rule.prefix === '__')

    expect(new RegExp(policy?.keyPattern?.pattern ?? '').test('__x')).toBe(true)
    expect(dunder).toBeDefined()
    expect(dunder?.message).toContain('__')
    expect(dunder?.message).toContain('{key}')
  })

  it('bans no WAVE_ prefix, the entries never reaching the environment', () => {
    const prefixes = inputsByName().input_vars.keyPolicy?.blockedPrefixes

    expect(prefixes).toBeDefined()
    expect(prefixes!.map((rule) => rule.prefix)).not.toContain('WAVE_')
  })
})

describe('Environment map (PYRUN-5, SHRUN-11)', () => {
  it('is an optional map in the Variables group', () => {
    const environment = inputsByName().environment

    expect(environment.name).toBe('environment')
    expect(environment.label).toBe('Environment')
    expect(environment.type).toBe('map')
    expect(environment.required).toBe(false)
    expect(environment.group).toBe('Variables')
  })

  it('carries the shared environment key policy', () => {
    expect(inputsByName().environment.keyPolicy).toEqual(LOCAL_PROCESS_ENV_KEY_POLICY)
  })

  it('carries the shared environment copy', () => {
    expect(inputsByName().environment.description).toBe(
      shellInputsByName().input_vars.description,
    )
  })

  it('puts a key policy on the two map rows and nowhere else', () => {
    const withPolicy = inputs().filter((p) => p.keyPolicy !== undefined)

    expect(withPolicy.map((p) => p.name)).toEqual(['input_vars', 'environment'])
  })
})

describe('variable exports (PYRUN-6, PYRUN-14)', () => {
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

  it('names the four columns of the export row', () => {
    const policy = listKeys(inputsByName().script_variables).outputList

    expect(policy?.nameHeading).toBe('Script Variable')
    expect(policy?.bindingHeading).toBe('WAVE Variable')
    expect(policy?.itemNoun).toBe('variable export')
    expect(policy?.addLabel).toBe('Add variable export')
  })

  it('seeds a row carrying the name, the type, the secret flag and the WAVE variable', () => {
    const rows = seedOutputListRows(
      'script_variables',
      { script_variables: ['summary'] },
      { summary: 'mean_temp' },
      ['summary'],
    )

    expect(Object.keys(rows[0]).sort()).toEqual(['binding', 'name', 'secret', 'type'])
    expect(rows[0].name).toBe('summary')
    expect(rows[0].binding).toBe('mean_temp')
    expect(rows[0].secret).toBe(true)
  })

  it('shares every name rule and message with Shell Script', () => {
    const policy = listKeys(inputsByName().script_variables).outputList
    const shellPolicy = listKeys(shellInputsByName().script_variables).outputList

    expect(policy?.namePattern).toBe(shellPolicy?.namePattern)
    expect(policy?.nameRuleMessage).toBe(shellPolicy?.nameRuleMessage)
    expect(policy?.invalidNameMessage).toBe(shellPolicy?.invalidNameMessage)
    expect(policy?.clashMessage).toBe(shellPolicy?.clashMessage)
    expect(policy?.duplicateMessage).toBe(shellPolicy?.duplicateMessage)
  })

  it('names the Script body as the text the unassigned-export warning reads', () => {
    expect(listKeys(inputsByName().script_variables).outputList?.assignedIn).toBe('script')
  })

  it('is the promoted helper row, changed only by the copy and the assigned body', () => {
    const row = inputsByName().script_variables
    const helperRow = localProcessExportsParam('script')

    expect(row).toEqual({
      ...helperRow,
      description: row.description,
      outputList: { ...listKeys(helperRow).outputList, assignedIn: 'script' },
    })
  })

  it('builds that row by calling the promoted helper, never by repeating it', async () => {
    vi.resetModules()
    const helper = await import(
      '@/features/workbench/lib/node-parameters/plugins/_local-process-params'
    )
    const exportsSpy = vi.fn(helper.localProcessExportsParam)
    vi.doMock('@/features/workbench/lib/node-parameters/plugins/_local-process-params', () => ({
      ...helper,
      localProcessExportsParam: exportsSpy,
    }))

    try {
      const fresh = await import('@/features/workbench/lib/node-parameters')
      const row = (fresh.getInputParams(ID) ?? []).find((p) => p.name === 'script_variables')

      expect(row).toBeDefined()
      expect(exportsSpy).toHaveBeenCalledWith('script')
    } finally {
      vi.doUnmock('@/features/workbench/lib/node-parameters/plugins/_local-process-params')
      vi.resetModules()
    }
  })

  it('names Python rather than the shell in the export row copy', () => {
    const description = inputsByName().script_variables.description ?? ''

    expect(description).toContain('Python')
    expect(description.toLowerCase()).not.toContain('shell')
  })
})

describe('expression toggles', () => {
  it('turns the expression toggle off on the structural rows and the body', () => {
    const params = inputsByName()

    for (const name of NO_EXPRESSION_PARAMS) {
      expect(params[name].noExpression, name).toBe(true)
    }
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

  it('carries Shell Script group metadata unchanged outside the Variables group', () => {
    const meta = getGroupMeta(ID)
    const shell = getGroupMeta(SHELL)

    expect(meta).toBeDefined()
    for (const name of GROUP_ORDER.filter((groupName) => groupName !== 'Variables')) {
      expect(meta![name], name).toEqual(shell![name])
    }
  })

  it('never says the Variables entries become environment variables (PYRUN-5)', () => {
    const variables = getGroupMeta(ID)?.['Variables']

    expect(variables).toBeDefined()
    expect(variables?.description ?? '').not.toMatch(/environment variable/i)
  })

  it('leaves no group behind from the struck code-executor scheme', () => {
    expect(Object.keys(getGroupMeta(ID)!)).not.toContain('Limits')
  })
})

describe('visible rows per state (PYRUN-2, PYRUN-11)', () => {
  it('shows the Source rows on open', () => {
    expect(visibleNames({ script_type: 'source' })).toEqual(SOURCE_ROWS)
  })

  it('swaps the body row for Script File under File', () => {
    expect(visibleNames({ script_type: 'file' })).toEqual(FILE_ROWS)
  })

  it('adds the two pattern rows while the toggle is on', () => {
    expect(visibleNames({ script_type: 'source', stop_on_pattern: true })).toEqual(
      SOURCE_ROWS_PATTERN_ON,
    )
  })

  it('hides both pattern rows while the toggle is off', () => {
    expect(
      visibleInGroup('Stop on Pattern', { script_type: 'source', stop_on_pattern: false }),
    ).toEqual(['stop_on_pattern'])
  })

  it('shows both maps under both Script Types', () => {
    expect(visibleInGroup('Variables', { script_type: 'source' })).toEqual(VARIABLES_PARAMS)
    expect(visibleInGroup('Variables', { script_type: 'file' })).toEqual(VARIABLES_PARAMS)
  })

  it('leaves the INPUT rows alone under Record and continue', () => {
    expect(visibleNames({ script_type: 'source', on_error: 'record' })).toEqual(SOURCE_ROWS)
  })
})

describe('outputs (PYRUN-7)', () => {
  it('declares the six outputs in order', () => {
    expect(outputs().map((o) => [o.name, o.type])).toEqual(OUTPUT_ORDER)
    expect(outputs()).toHaveLength(6)
  })

  it('labels every output as Shell Script does', () => {
    const byName = outputsByName()
    const shell = shellOutputsByName()

    for (const [name] of OUTPUT_ORDER) {
      expect(byName[name].label, name).toBe(shell[name].label)
    }
  })

  it('carries Shell Script copy on every output but the reason', () => {
    const byName = outputsByName()
    const shell = shellOutputsByName()

    for (const [name] of OUTPUT_ORDER) {
      if (name === 'reason') continue
      expect(byName[name].description, name).toBe(shell[name].description)
    }
  })

  it('names Exception among the reasons a Python run failed', () => {
    expect(outputsByName().reason.description).toBe(REASON_DESCRIPTION)
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
  it('gates Error and Reason and no other output', () => {
    const byName = outputsByName()

    expect(byName.error.showWhen).toEqual(RECORD_GATE)
    expect(byName.reason.showWhen).toEqual(RECORD_GATE)
    expect(
      outputs()
        .filter((o) => o.showWhen !== undefined)
        .map((o) => o.name),
    ).toEqual(GATED_OUTPUTS)
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

describe('palette and icon wiring (PYRUN-1, SHRUN-19)', () => {
  it('defines the Python palette row in the System category', () => {
    const def = getPluginById(ID)

    expect(def).toBeDefined()
    expect(def!.name).toBe('Python')
    expect(def!.category).toBe('system')
    expect(def!.iconName).toBe('FileCode2')
    expect(def!.colorClass).toBe('text-red-500')
  })

  it('runs on a remote host inside a Remote Execution body (PYRUN-1)', () => {
    expect(getPluginById(ID)?.remotable).toBe(true)
  })

  it('registers all three canvas maps for python', () => {
    expect(isValidIconName('FileCode2')).toBe(true)
    expect(getIcon(ID)).toBe(FileCode2)
    expect(getIconName(ID)).toBe('file-code-2')
    expect(getColorClass(ID)).toBe('text-red-500')
  })
})
