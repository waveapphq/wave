/**
 * Shell Exec plugin parameter schema tests (REQ-3.4.1.18, REQ-3.4.2.2).
 *
 * Shell Exec runs one command line on the WAVE server through the chosen
 * shell's -c option (SHRUN-17). It shares Shell Script's local-process rows and
 * every text names the command instead of the script (SHRUN-18): there is no
 * Script Type, no Arguments list and no variable-export table, so the block
 * never reports an output-variable failure.
 *
 * Design decisions: SHRUN-5, SHRUN-10, SHRUN-12, SHRUN-13, SHRUN-17, SHRUN-18, SHRUN-19
 */

import { describe, it, expect } from 'vitest'
import { Terminal } from 'lucide-react'
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
import {
  getPluginById,
  PLUGIN_DEFINITIONS,
} from '@/features/workbench/lib/plugin-definitions'
import { isValidIconName } from '@/features/workbench/lib/icon-registry'
import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

const ID = 'shell-exec'

interface ListKeys {
  orderedList?: { itemNoun: string; positionPrefix: string }
  outputList?: { nameHeading: string }
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

/** The rows the INPUT table renders for one set of field values. */
function visibleNames(values: Record<string, unknown>): string[] {
  const all = inputs() as unknown as Parameter[]
  return all.filter((p) => isParameterVisible(p, values, all)).map((p) => p.name)
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

const ON = { field: 'stop_on_pattern', values: ['true'] }
const PASS_EMPTY = { field: 'pass_pattern', values: [''] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const PARAM_ORDER = [
  'command',
  'shell',
  'env_vars',
  'working_dir',
  'timeout',
  'stream_output',
  'stop_on_pattern',
  'pass_pattern',
  'fail_pattern',
  'on_error',
]

const COMMAND_PARAMS = ['command', 'shell']
const VARIABLES_PARAMS = ['env_vars']
const EXECUTION_PARAMS = ['working_dir', 'timeout', 'stream_output']
const STOP_PARAMS = ['stop_on_pattern', 'pass_pattern', 'fail_pattern']
const FAILURE_PARAMS = ['on_error']

const GROUP_ORDER = ['Command', 'Variables', 'Execution', 'Stop on Pattern', 'Failure Handling']
const EXPANDED_GROUPS = ['Command', 'Variables']
const COLLAPSED_GROUPS = ['Execution', 'Stop on Pattern', 'Failure Handling']

const CLOSED_ROWS = [
  'command',
  'shell',
  'env_vars',
  'working_dir',
  'timeout',
  'stream_output',
  'stop_on_pattern',
  'on_error',
]

/** Rows Shell Script declares that a single command line has no use for. */
const SCRIPT_ONLY_PARAMS = ['script_type', 'script', 'script_file', 'arguments', 'script_variables']

// Structural rows: they gate other rows or other outputs, so they take no expression.
const NO_EXPRESSION_PARAMS = ['stop_on_pattern', 'on_error']

const RETAINED_PARAMS = ['pass_pattern', 'fail_pattern']

const PARAM_LABELS: Record<string, string> = {
  command: 'Command',
  shell: 'Shell',
  env_vars: 'Input Variables',
  working_dir: 'Working Directory',
  timeout: 'Timeout',
  stream_output: 'Log Output',
  stop_on_pattern: 'Stop on pattern',
  pass_pattern: 'Pass pattern',
  fail_pattern: 'Fail pattern',
  on_error: 'On error',
}

const PARAM_TYPES: Record<string, InputParam['type']> = {
  command: 'string',
  shell: 'string',
  env_vars: 'map',
  working_dir: 'string',
  timeout: 'integer',
  stream_output: 'boolean',
  stop_on_pattern: 'boolean',
  pass_pattern: 'string',
  fail_pattern: 'string',
  on_error: 'string',
}

const PARAM_DEFAULTS: Record<string, unknown> = {
  command: undefined,
  shell: '/bin/sh',
  env_vars: {},
  working_dir: undefined,
  timeout: 300,
  stream_output: false,
  stop_on_pattern: false,
  pass_pattern: '',
  fail_pattern: '',
  on_error: 'fail',
}

/** The row with no default: an empty working directory means the system temp folder. */
const NO_DEFAULT_PARAMS = ['working_dir']

/** The rows the block reads with a default, the empty text and map included. */
const KEEPS_DEFAULT_PARAMS = ['shell', 'timeout', 'pass_pattern', 'fail_pattern', 'env_vars']

const PARAM_DESCRIPTIONS: Record<string, string> = {
  command:
    'One command line, run as <shell> -c <command>, so pipes, redirects, globs and && work. For example kubectl get pods -A | grep -c Running.',
  shell:
    'The shell that runs the command. It may include flags, for example /bin/bash -o pipefail.',
  env_vars:
    "Each entry is exported into the command's environment. Text, numbers and booleans arrive as text; arrays, maps and tables as JSON text.",
  working_dir:
    'Where the command starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the command runs on.',
  timeout: 'Seconds the command may run before WAVE stops it.',
  stream_output:
    'Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN.',
  stop_on_pattern: 'Stop the command as soon as a line of its output matches a pattern.',
  pass_pattern:
    'A Python regular expression. A matching line stops the command and the block passes.',
  fail_pattern:
    'A Python regular expression. A matching line stops the command and the block fails.',
  on_error: 'Fail the block, or record the outcome and let the test continue.',
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  Command: 'The command line and the shell that runs it',
  Variables: 'Values passed in as environment variables',
  Execution: 'Where and how long it runs',
  'Stop on Pattern': 'End the command early when a line matches',
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
  stdout: 'Everything the command wrote to standard output.',
  stderr: 'Everything the command wrote to standard error.',
  exit_code:
    "The command's exit code; 137 when WAVE stopped it, -1 when it never started. A non-zero code is a failure.",
  success:
    'True when the command passed. False when it failed and On error is Record and continue.',
  error: 'The error message when the operation failed under Record and continue; empty otherwise',
  reason: 'Why it failed: NonZeroExit, Timeout, FailPattern or StartFailed; empty when it passed.',
}

const GATED_OUTPUTS = ['error', 'reason']

const SYSTEM_PALETTE_ORDER = ['shell-script', 'shell-exec', 'python', 'file-io', 'log']

describe('registration', () => {
  it('registers shell-exec in PLUGIN_INPUTS', () => {
    expect(PLUGIN_INPUTS[ID]).toBeDefined()
  })

  it('registers shell-exec in PLUGIN_OUTPUTS', () => {
    expect(PLUGIN_OUTPUTS[ID]).toBeDefined()
  })

  it('registers shell-exec in PLUGIN_GROUPS', () => {
    expect(PLUGIN_GROUPS[ID]).toBeDefined()
  })

  it('resolves shell-exec via hasNodeParams', () => {
    expect(hasNodeParams(ID)).toBe(true)
  })
})

describe('schema surface: count, order and groups (SHRUN-18)', () => {
  it('declares exactly 10 input params in the pinned order', () => {
    expect(inputs().map((p) => p.name)).toEqual(PARAM_ORDER)
    expect(inputs()).toHaveLength(10)
  })

  it('assigns the Command group to the command line and the shell', () => {
    expect(inputs().filter((p) => p.group === 'Command').map((p) => p.name)).toEqual(COMMAND_PARAMS)
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

  it('names the command, never the script, in every description (SHRUN-18)', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].description, name).toBe(PARAM_DESCRIPTIONS[name])
    }
  })

  it('requires the command line and nothing else', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].required, name).toBe(name === 'command')
    }
  })

  it('flags no parameter secret', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].secret, name).not.toBe(true)
    }
  })

  it('locks no row to a value format', () => {
    const params = inputsByName()

    for (const name of PARAM_ORDER) {
      expect(params[name].allowedFormats, name).toBeUndefined()
    }
  })
})

describe('no script rows (SHRUN-17, SHRUN-18)', () => {
  it('declares none of the rows a script needs', () => {
    const params = inputsByName()
    const names = inputs().map((p) => p.name)

    for (const name of SCRIPT_ONLY_PARAMS) {
      expect(params[name], name).toBeUndefined()
      expect(names, name).not.toContain(name)
    }
  })

  it('declares no ordered list, the command line carrying its own arguments', () => {
    for (const param of inputs()) {
      expect(listKeys(param).orderedList, param.name).toBeUndefined()
    }
  })

  it('declares no variable-export table', () => {
    for (const param of inputs()) {
      expect(listKeys(param).outputList, param.name).toBeUndefined()
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

  it('leaves only the working-directory row and the command with no default', () => {
    const params = inputsByName()

    for (const name of NO_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeUndefined()
    }
    expect(PARAM_ORDER.filter((name) => params[name].defaultValue === undefined)).toEqual(['command', 'working_dir'])
  })

  it('keeps a default on Shell, Timeout and the pattern and input-variable rows', () => {
    const params = inputsByName()

    for (const name of KEEPS_DEFAULT_PARAMS) {
      expect(params[name].defaultValue, name).toBeDefined()
    }
  })
})

describe('Command group (SHRUN-17)', () => {
  it('declares Command as the one required row', () => {
    const command = inputsByName().command

    expect(command.type).toBe('string')
    expect(command.required).toBe(true)
    expect(command.showWhen).toBeUndefined()
    expect(command.defaultValue).toBeUndefined()
    expect(command.description).toBe(
      'One command line, run as <shell> -c <command>, so pipes, redirects, globs and && work. For example kubectl get pods -A | grep -c Running.',
    )
  })

  it('defaults the shell that runs the command to /bin/sh', () => {
    const shell = inputsByName().shell

    expect(shell.type).toBe('string')
    expect(shell.defaultValue).toBe('/bin/sh')
    expect(shell.required).toBe(false)
    expect(shell.description).toBe(
      'The shell that runs the command. It may include flags, for example /bin/bash -o pipefail.',
    )
  })

  it('shows the command line and the shell in every state', () => {
    expect(visibleInGroup('Command', {})).toEqual(COMMAND_PARAMS)
    expect(visibleInGroup('Command', { stop_on_pattern: true })).toEqual(COMMAND_PARAMS)
    expect(visibleInGroup('Command', { on_error: 'record' })).toEqual(COMMAND_PARAMS)
  })
})

describe('Variables group (SHRUN-5)', () => {
  it('labels the map Input Variables while its wire name stays env_vars', () => {
    const envVars = inputsByName().env_vars

    expect(envVars.name).toBe('env_vars')
    expect(envVars.label).toBe('Input Variables')
    expect(envVars.type).toBe('map')
    expect(envVars.required).toBe(false)
  })

  it('reads the same label as Shell Script, so both blocks say Input Variables', () => {
    expect(inputsByName().env_vars.label).toBe('Input Variables')
    expect(inputs().map((p) => p.name)).not.toContain('input_vars')
  })

  it('puts a key policy on the map row and nowhere else', () => {
    const withPolicy = inputs().filter((p) => p.keyPolicy !== undefined)

    expect(withPolicy.map((p) => p.name)).toEqual(['env_vars'])
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

  it('puts a picker on the Working Directory row alone', () => {
    const withPicker = inputs().filter((p) => p.fileReference !== undefined)

    expect(withPicker.map((p) => p.name)).toEqual(['working_dir'])
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
    expect(visibleInGroup('Stop on Pattern', { stop_on_pattern: false })).toEqual([
      'stop_on_pattern',
    ])
  })

  it('shows both pattern rows while the toggle is on', () => {
    expect(visibleInGroup('Stop on Pattern', { stop_on_pattern: true })).toEqual(STOP_PARAMS)
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

    expect(expressive).toHaveLength(8)
    for (const param of expressive) {
      expect(param.noExpression, param.name).toBeUndefined()
    }
  })
})

describe('retainOnHide', () => {
  it('keeps the drafts of the two pattern rows only', () => {
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

  it('opens the Command and Variables groups and collapses the rest', () => {
    const meta = getGroupMeta(ID)!

    for (const name of EXPANDED_GROUPS) {
      expect(meta[name].defaultExpanded, `${name} expanded`).toBe(true)
    }
    for (const name of COLLAPSED_GROUPS) {
      expect(meta[name].defaultExpanded, `${name} collapsed`).toBeUndefined()
    }
  })

  it('carries the exact footer under every group, naming the command (SHRUN-18)', () => {
    const meta = getGroupMeta(ID)!

    for (const [name, description] of Object.entries(GROUP_DESCRIPTIONS)) {
      expect(meta[name].description, name).toBe(description)
    }
  })
})

describe('visible rows per state (SHRUN-13)', () => {
  it('shows eight rows on open', () => {
    expect(visibleNames({})).toEqual(CLOSED_ROWS)
  })

  it('adds the two pattern rows while the toggle is on', () => {
    expect(visibleNames({ stop_on_pattern: true })).toEqual([
      'command',
      'shell',
      'env_vars',
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
    expect(visibleNames({ on_error: 'record' })).toEqual(CLOSED_ROWS)
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

  it('carries the exact copy on every output, naming the command (SHRUN-18)', () => {
    const byName = outputsByName()

    for (const [name, description] of Object.entries(OUTPUT_DESCRIPTIONS)) {
      expect(byName[name].description, name).toBe(description)
    }
  })

  it('leaves OutputVariable out of the reasons, the block declaring no exports', () => {
    const reason = outputsByName().reason

    expect(reason.description).toBe(
      'Why it failed: NonZeroExit, Timeout, FailPattern or StartFailed; empty when it passed.',
    )
    expect(reason.description).not.toContain('OutputVariable')
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
  it('defines the Shell Exec palette row in the System category', () => {
    const def = getPluginById(ID)

    expect(def).toBeDefined()
    expect(def!.name).toBe('Shell Exec')
    expect(def!.category).toBe('system')
    expect(def!.iconName).toBe('Terminal')
    expect(def!.colorClass).toBe('text-red-500')
  })

  it('runs on WAVE only, so it is not remotable (SHRUN-17)', () => {
    expect(getPluginById(ID)?.remotable).toBe(false)
  })

  it('carries the Exec glyph every Exec block carries', () => {
    expect(isValidIconName('Terminal')).toBe(true)
    expect(getPluginById('k8s-exec')?.iconName).toBe('Terminal')
    expect(getPluginById('ssh-session-exec')?.iconName).toBe('Terminal')
  })

  it('registers all three canvas maps for shell-exec', () => {
    expect(getIcon(ID)).toBe(Terminal)
    expect(getIconName(ID)).toBe('terminal')
    expect(getColorClass(ID)).toBe('text-red-500')
  })

  it('sits right after Shell Script in the palette', () => {
    const ids = PLUGIN_DEFINITIONS.map((p) => p.id)

    expect(ids.indexOf(ID)).toBe(ids.indexOf('shell-script') + 1)
  })

  it('makes System a five-row category in the pinned order', () => {
    const system = PLUGIN_DEFINITIONS.filter((p) => p.category === 'system')

    expect(system.map((p) => p.id)).toEqual(SYSTEM_PALETTE_ORDER)
  })
})
