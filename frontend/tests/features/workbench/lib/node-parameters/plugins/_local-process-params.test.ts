/**
 * The rows Shell Script and Shell Exec share (SHRUN-5, SHRUN-10, SHRUN-12, SHRUN-13,
 * SHRUN-14, SHRUN-18, REQ-3.4.1.1, REQ-3.4.1.18, REQ-3.4.2.2). Every text names the
 * script or the command, so it stays true on both blocks.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LOCAL_PROCESS_ENV_KEY_POLICY,
  SHELL_NAME_PATTERN,
  localProcessEnvInput,
  localProcessExecutionInputs,
  localProcessExportsParam,
  localProcessFailureInputs,
  localProcessGroups,
  localProcessOutputs,
  localProcessStopPatternInputs,
} from '@/features/workbench/lib/node-parameters/plugins/_local-process-params'
import {
  group,
  type InputParam,
  type OutputParam,
} from '@/features/workbench/lib/node-parameters/types'
import { getInputParams } from '@/features/workbench/lib/node-parameters'

const PATTERN_ON = { field: 'stop_on_pattern', values: ['true'] }
const PASS_EMPTY = { field: 'pass_pattern', values: [''] }
const RECORD_GATE = { field: 'on_error', values: ['record'] }

const SCRIPT_GROUP = group('Script', { description: 'What to run and the arguments it gets' })
const COMMAND_GROUP = group('Command', {
  description: 'The command line and the shell that runs it',
})

const SCRIPT_REASONS = 'NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable'
const COMMAND_REASONS = 'NonZeroExit, Timeout, FailPattern or StartFailed'

function row(rows: InputParam[], name: string): InputParam {
  const found = rows.find((r) => r.name === name)
  if (!found) throw new Error(`no row named ${name}`)
  return found
}

describe('localProcessGroups', () => {
  it('opens with the block own group, then Variables, Execution, Stop on Pattern and Failure Handling', () => {
    expect(Object.keys(localProcessGroups(SCRIPT_GROUP, 'script'))).toEqual([
      'Script',
      'Variables',
      'Execution',
      'Stop on Pattern',
      'Failure Handling',
    ])
  })

  it('opens with the Shell Exec group when that is the one it is given', () => {
    expect(Object.keys(localProcessGroups(COMMAND_GROUP, 'command'))).toEqual([
      'Command',
      'Variables',
      'Execution',
      'Stop on Pattern',
      'Failure Handling',
    ])
  })

  it('keeps the first group name and footer it is given', () => {
    const first = localProcessGroups(SCRIPT_GROUP, 'script')['Script']

    expect(first.name).toBe('Script')
    expect(first.description).toBe('What to run and the arguments it gets')
  })

  it('expands the first group', () => {
    expect(localProcessGroups(SCRIPT_GROUP, 'script')['Script'].defaultExpanded).toBe(true)
  })

  it('expands Variables and footers it as the values passed in', () => {
    const variables = localProcessGroups(SCRIPT_GROUP, 'script')['Variables']

    expect(variables.description).toBe('Values passed in as environment variables')
    expect(variables.defaultExpanded).toBe(true)
  })

  it('collapses Execution and footers it as where and how long it runs', () => {
    const execution = localProcessGroups(SCRIPT_GROUP, 'script')['Execution']

    expect(execution.description).toBe('Where and how long it runs')
    expect(execution.defaultExpanded).toBeUndefined()
  })

  it('names the script in the Stop on Pattern footer', () => {
    expect(localProcessGroups(SCRIPT_GROUP, 'script')['Stop on Pattern'].description).toBe(
      'End the script early when a line matches',
    )
  })

  it('names the command in the Stop on Pattern footer', () => {
    expect(localProcessGroups(COMMAND_GROUP, 'command')['Stop on Pattern'].description).toBe(
      'End the command early when a line matches',
    )
  })

  it('collapses Stop on Pattern', () => {
    expect(
      localProcessGroups(SCRIPT_GROUP, 'script')['Stop on Pattern'].defaultExpanded,
    ).toBeUndefined()
  })

  it('collapses Failure Handling and carries the shared footer', () => {
    const failure = localProcessGroups(SCRIPT_GROUP, 'script')['Failure Handling']

    expect(failure.description).toBe(
      'Record and continue sets Success, Error and Reason instead of failing the block',
    )
    expect(failure.defaultExpanded).toBeUndefined()
  })
})

describe('localProcessEnvInput', () => {
  it('is an optional map row in Variables', () => {
    const input = localProcessEnvInput('input_vars', 'Input Variables', 'script')

    expect(input.type).toBe('map')
    expect(input.required).toBe(false)
    expect(input.group).toBe('Variables')
  })

  it('takes the wire name and the label from the block', () => {
    const input = localProcessEnvInput('input_vars', 'Input Variables', 'script')

    expect(input.name).toBe('input_vars')
    expect(input.label).toBe('Input Variables')
  })

  it('keeps the Shell Exec wire name under the same label', () => {
    const input = localProcessEnvInput('env_vars', 'Input Variables', 'command')

    expect(input.name).toBe('env_vars')
    expect(input.label).toBe('Input Variables')
  })

  it('names the script environment', () => {
    expect(localProcessEnvInput('input_vars', 'Input Variables', 'script').description).toBe(
      "Each entry is exported into the script's environment. Text, numbers and booleans arrive as text; arrays, maps and tables as JSON text.",
    )
  })

  it('names the command environment', () => {
    expect(localProcessEnvInput('env_vars', 'Input Variables', 'command').description).toBe(
      "Each entry is exported into the command's environment. Text, numbers and booleans arrive as text; arrays, maps and tables as JSON text.",
    )
  })

  it('carries the environment key policy', () => {
    expect(localProcessEnvInput('input_vars', 'Input Variables', 'script').keyPolicy).toEqual(
      LOCAL_PROCESS_ENV_KEY_POLICY,
    )
  })

  it('defaults to the empty map the block reads', () => {
    expect(localProcessEnvInput('input_vars', 'Input Variables', 'script').defaultValue).toEqual({})
    expect(localProcessEnvInput('env_vars', 'Input Variables', 'command').defaultValue).toEqual({})
  })
})

describe('localProcessExecutionInputs', () => {
  const scriptRows = localProcessExecutionInputs('script')
  const commandRows = localProcessExecutionInputs('command')

  it('gives the working directory, the timeout and the console toggle in that order', () => {
    expect(scriptRows.map((r: InputParam) => r.name)).toEqual(['working_dir', 'timeout', 'stream_output'])
  })

  it('files all three in Execution', () => {
    expect(scriptRows.map((r: InputParam) => r.group)).toEqual(['Execution', 'Execution', 'Execution'])
  })

  it('labels the working directory and gives it no default value (REQ-3.4.3.11)', () => {
    const workingDir = row(scriptRows, 'working_dir')

    expect(workingDir.label).toBe('Working Directory')
    expect(workingDir.type).toBe('string')
    expect(workingDir.required).toBe(false)
    expect(workingDir.defaultValue).toBeUndefined()
    expect(row(commandRows, 'working_dir').defaultValue).toBeUndefined()
  })

  it('shows System temp folder in the empty working directory (SHRUN-10)', () => {
    expect(row(scriptRows, 'working_dir').placeholder).toBe('System temp folder')
    expect(row(commandRows, 'working_dir').placeholder).toBe('System temp folder')
  })

  it('offers Browse over folders on the working directory', () => {
    expect(row(scriptRows, 'working_dir').fileReference).toBe('folder')
  })

  it('says where the script starts and where an empty one starts', () => {
    expect(row(scriptRows, 'working_dir').description).toBe(
      'Where the script starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the script runs on.',
    )
  })

  it('says where the command starts and where an empty one starts', () => {
    expect(row(commandRows, 'working_dir').description).toBe(
      'Where the command starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the command runs on.',
    )
  })

  it('gives the timeout five minutes', () => {
    const timeout = row(scriptRows, 'timeout')

    expect(timeout.label).toBe('Timeout')
    expect(timeout.type).toBe('integer')
    expect(timeout.defaultValue).toBe(300)
  })

  it('names the script in the timeout wording', () => {
    expect(row(scriptRows, 'timeout').description).toBe(
      'Seconds the script may run before WAVE stops it.',
    )
  })

  it('names the command in the timeout wording', () => {
    expect(row(commandRows, 'timeout').description).toBe(
      'Seconds the command may run before WAVE stops it.',
    )
  })

  it('labels the console toggle Log Output and starts it off', () => {
    const stream = row(scriptRows, 'stream_output')

    expect(stream.label).toBe('Log Output')
    expect(stream.type).toBe('boolean')
    expect(stream.defaultValue).toBe(false)
  })

  it('says what the console toggle writes', () => {
    expect(row(scriptRows, 'stream_output').description).toBe(
      'Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN.',
    )
  })

  it('keeps the expression toggle on Log Output', () => {
    expect(row(scriptRows, 'stream_output').noExpression).toBeUndefined()
  })
})

describe('localProcessStopPatternInputs', () => {
  const scriptRows = localProcessStopPatternInputs('script')
  const commandRows = localProcessStopPatternInputs('command')

  it('gives the toggle and the two pattern rows in that order', () => {
    expect(scriptRows.map((r: InputParam) => r.name)).toEqual([
      'stop_on_pattern',
      'pass_pattern',
      'fail_pattern',
    ])
  })

  it('files all three in Stop on Pattern', () => {
    expect(scriptRows.map((r: InputParam) => r.group)).toEqual([
      'Stop on Pattern',
      'Stop on Pattern',
      'Stop on Pattern',
    ])
  })

  it('starts the toggle off with no expression toggle', () => {
    const toggle = row(scriptRows, 'stop_on_pattern')

    expect(toggle.label).toBe('Stop on pattern')
    expect(toggle.type).toBe('boolean')
    expect(toggle.defaultValue).toBe(false)
    expect(toggle.noExpression).toBe(true)
  })

  it('says the script stops on a matching line', () => {
    expect(row(scriptRows, 'stop_on_pattern').description).toBe(
      'Stop the script as soon as a line of its output matches a pattern.',
    )
  })

  it('says the command stops on a matching line', () => {
    expect(row(commandRows, 'stop_on_pattern').description).toBe(
      'Stop the command as soon as a line of its output matches a pattern.',
    )
  })

  it('shows both pattern rows only while the toggle is on', () => {
    expect(row(scriptRows, 'pass_pattern').showWhen).toEqual(PATTERN_ON)
    expect(row(scriptRows, 'fail_pattern').showWhen).toEqual(PATTERN_ON)
  })

  it('keeps both pattern drafts while they are hidden', () => {
    expect(row(scriptRows, 'pass_pattern').retainOnHide).toBe(true)
    expect(row(scriptRows, 'fail_pattern').retainOnHide).toBe(true)
  })

  it('leaves both pattern rows optional on their own', () => {
    expect(row(scriptRows, 'pass_pattern').required).toBe(false)
    expect(row(scriptRows, 'fail_pattern').required).toBe(false)
  })

  it('defaults both pattern rows to the empty text the block reads', () => {
    expect(row(scriptRows, 'pass_pattern').defaultValue).toBe('')
    expect(row(scriptRows, 'fail_pattern').defaultValue).toBe('')
  })

  it('labels the pass row and says a match passes the block', () => {
    const pass = row(scriptRows, 'pass_pattern')

    expect(pass.label).toBe('Pass pattern')
    expect(pass.type).toBe('string')
    expect(pass.description).toBe(
      'A Python regular expression. A matching line stops the script and the block passes.',
    )
  })

  it('labels the fail row and says a match fails the block', () => {
    const fail = row(scriptRows, 'fail_pattern')

    expect(fail.label).toBe('Fail pattern')
    expect(fail.type).toBe('string')
    expect(fail.description).toBe(
      'A Python regular expression. A matching line stops the script and the block fails.',
    )
  })

  it('names the command in both pattern rows', () => {
    expect(row(commandRows, 'pass_pattern').description).toBe(
      'A Python regular expression. A matching line stops the command and the block passes.',
    )
    expect(row(commandRows, 'fail_pattern').description).toBe(
      'A Python regular expression. A matching line stops the command and the block fails.',
    )
  })

  it('requires the fail pattern while the toggle is on and the pass pattern is unset', () => {
    expect(row(scriptRows, 'fail_pattern').requiredWhenAll).toEqual([PATTERN_ON, PASS_EMPTY])
  })

  it('asks for one pattern or the other in the fail row message', () => {
    expect(row(scriptRows, 'fail_pattern').requiredMessage).toBe(
      'Set a pass pattern, a fail pattern or both',
    )
  })

  it('leaves the rule off the pass row, so the message shows once', () => {
    expect(row(scriptRows, 'pass_pattern').requiredWhenAll).toBeUndefined()
    expect(row(scriptRows, 'pass_pattern').requiredMessage).toBeUndefined()
  })
})

describe('localProcessFailureInputs', () => {
  it('gives the On error row alone, in Failure Handling', () => {
    const rows = localProcessFailureInputs()

    expect(rows.map((r: InputParam) => r.name)).toEqual(['on_error'])
    expect(rows[0].group).toBe('Failure Handling')
  })

  it('offers Fail the block and Record and continue, starting on Fail', () => {
    const onError = localProcessFailureInputs()[0]

    expect(onError.label).toBe('On error')
    expect(onError.enumValues).toEqual(['fail', 'record'])
    expect(onError.enumLabels).toEqual({ fail: 'Fail the block', record: 'Record and continue' })
    expect(onError.defaultValue).toBe('fail')
    expect(onError.noExpression).toBe(true)
  })

  it('carries the shared On error wording, with no family of its own', () => {
    expect(localProcessFailureInputs()[0].description).toBe(
      'Fail the block, or record the outcome and let the test continue.',
    )
  })
})

describe('localProcessOutputs', () => {
  const scriptOutputs = localProcessOutputs('script', SCRIPT_REASONS)
  const commandOutputs = localProcessOutputs('command', COMMAND_REASONS)

  it('gives the three captured outputs, then the shared core', () => {
    expect(scriptOutputs.map((o: OutputParam) => o.name)).toEqual([
      'stdout',
      'stderr',
      'exit_code',
      'success',
      'error',
      'reason',
    ])
  })

  it('labels every output', () => {
    expect(scriptOutputs.map((o: OutputParam) => o.label)).toEqual([
      'Stdout',
      'Stderr',
      'Exit Code',
      'Success',
      'Error',
      'Reason',
    ])
  })

  it('types the exit code as an integer and success as a boolean', () => {
    expect(scriptOutputs.map((o: OutputParam) => o.type)).toEqual([
      'string',
      'string',
      'integer',
      'boolean',
      'string',
      'string',
    ])
  })

  it('names the script in the two stream outputs', () => {
    expect(scriptOutputs[0].description).toBe('Everything the script wrote to standard output.')
    expect(scriptOutputs[1].description).toBe('Everything the script wrote to standard error.')
  })

  it('names the command in the two stream outputs', () => {
    expect(commandOutputs[0].description).toBe('Everything the command wrote to standard output.')
    expect(commandOutputs[1].description).toBe('Everything the command wrote to standard error.')
  })

  it('says a non-zero exit code is a failure', () => {
    expect(scriptOutputs[2].description).toBe(
      "The script's exit code; 137 when WAVE stopped it, -1 when it never started. A non-zero code is a failure.",
    )
  })

  it('names the command in the exit code wording', () => {
    expect(commandOutputs[2].description).toBe(
      "The command's exit code; 137 when WAVE stopped it, -1 when it never started. A non-zero code is a failure.",
    )
  })

  it('says what Success means for the script', () => {
    expect(scriptOutputs[3].description).toBe(
      'True when the script passed. False when it failed and On error is Record and continue.',
    )
  })

  it('says what Success means for the command', () => {
    expect(commandOutputs[3].description).toBe(
      'True when the command passed. False when it failed and On error is Record and continue.',
    )
  })

  it('lists the ways a script run ends in the Reason wording', () => {
    expect(scriptOutputs[5].description).toBe(
      'Why it failed: NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable; empty when it passed.',
    )
  })

  it('leaves the variable-export failure out of the Shell Exec reasons', () => {
    expect(commandOutputs[5].description).toBe(
      'Why it failed: NonZeroExit, Timeout, FailPattern or StartFailed; empty when it passed.',
    )
  })

  it('offers the first four outputs whatever On error is set to', () => {
    expect(scriptOutputs.slice(0, 4).map((o: OutputParam) => o.showWhen)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('gates Error and Reason on Record and continue', () => {
    expect(scriptOutputs[4].showWhen).toEqual(RECORD_GATE)
    expect(scriptOutputs[5].showWhen).toEqual(RECORD_GATE)
  })
})

describe('localProcessExportsParam', () => {
  const exportsRow = () => localProcessExportsParam('script')

  it('is an optional array row outside every rendered group', () => {
    const row = exportsRow()

    expect(row.name).toBe('script_variables')
    expect(row.label).toBe('Variable Exports')
    expect(row.type).toBe('array')
    expect(row.required).toBe(false)
    expect(row.group).toBeUndefined()
  })

  it('defaults to the empty list the block reads', () => {
    expect(exportsRow().defaultValue).toEqual([])
  })

  it('says what a script variable is bound to', () => {
    expect(exportsRow().description).toBe(
      "Shell variables the script sets, each bound to one WAVE variable and read as that variable's type.",
    )
  })

  it('names the two headings, the item and the add button', () => {
    const policy = exportsRow().outputList

    expect(policy?.nameHeading).toBe('Script Variable')
    expect(policy?.bindingHeading).toBe('WAVE Variable')
    expect(policy?.itemNoun).toBe('variable export')
    expect(policy?.addLabel).toBe('Add variable export')
  })

  it('carries the shell name rule and its message', () => {
    const policy = exportsRow().outputList

    expect(policy?.namePattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$')
    expect(policy?.nameRuleMessage).toBe(
      'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
    )
  })

  it('carries the exact row messages for a bad, clashing or repeated name', () => {
    const policy = exportsRow().outputList

    expect(policy?.invalidNameMessage).toBe("Invalid script variable name: '{name}'")
    expect(policy?.clashMessage).toBe("Script variable '{name}' has the name of a block output")
    expect(policy?.duplicateMessage).toBe("Script variable '{name}' is listed more than once")
  })

  it('carries no ordered-list descriptor', () => {
    expect(exportsRow().orderedList).toBeUndefined()
  })

  it('is exactly the row Shell Script declares, its behavior unchanged', () => {
    const declared = (getInputParams('shell-script') ?? []).find(
      (p: InputParam) => p.name === 'script_variables',
    )

    expect(declared).toBeDefined()
    expect(exportsRow()).toEqual(declared)
  })
})

describe('the environment key policy', () => {
  it('is the shell identifier rule', () => {
    expect(SHELL_NAME_PATTERN).toBe('^[A-Za-z_][A-Za-z0-9_]*$')
  })

  it('accepts a shell identifier', () => {
    expect(new RegExp(SHELL_NAME_PATTERN).test('_A1')).toBe(true)
  })

  it('rejects a name that starts with a digit, a space or a dash', () => {
    const pattern = new RegExp(SHELL_NAME_PATTERN)

    expect(pattern.test('1X')).toBe(false)
    expect(pattern.test(' X')).toBe(false)
    expect(pattern.test('A-B')).toBe(false)
  })

  it('calls each entry a variable and carries both checks with their messages', () => {
    expect(LOCAL_PROCESS_ENV_KEY_POLICY).toEqual({
      keyNoun: 'variable',
      keyPattern: {
        pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
        message: "Invalid variable name: '{key}'",
      },
      blockedPrefixes: [
        { prefix: 'WAVE_', message: "Variable names may not start with WAVE_: '{key}'" },
      ],
    })
  })
})

describe('module boundaries', () => {
  it('does not import the K8s family module', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../../../../../../src/features/workbench/lib/node-parameters/plugins/_local-process-params.ts',
      ),
      'utf8',
    )

    expect(source).not.toMatch(/_k8s-shared/)
  })
})
