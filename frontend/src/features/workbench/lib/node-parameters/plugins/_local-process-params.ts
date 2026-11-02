/**
 * Shared parameter definitions for the blocks that run a process on the WAVE server.
 */

import { VARIABLE_NAME_RULE_MESSAGE } from '@/lib/field-constraints'
import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type MapKeyPolicy,
  type OutputListPolicy,
  type OutputParam,
} from '../types'
import {
  FAILURE_HANDLING_GROUP,
  failureHandlingGroup,
  failureHandlingOnErrorInput,
  outputCore,
  streamOutputInput,
  timeoutInput,
} from './_shared-params'

/** What the block runs; every shared text names it so it stays true on both blocks. */
export type LocalProcessNoun = 'script' | 'command'

export const SHELL_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$'

export const LOCAL_PROCESS_ENV_KEY_POLICY: MapKeyPolicy = {
  keyNoun: 'variable',
  keyPattern: { pattern: SHELL_NAME_PATTERN, message: "Invalid variable name: '{key}'" },
  blockedPrefixes: [
    { prefix: 'WAVE_', message: "Variable names may not start with WAVE_: '{key}'" },
  ],
}

const PATTERN_ON = { field: 'stop_on_pattern', values: ['true'] }
const PASS_EMPTY = { field: 'pass_pattern', values: [''] }

export function localProcessGroups(
  first: GroupMeta,
  noun: LocalProcessNoun,
): Record<string, GroupMeta> {
  return {
    [first.name]: { ...first, defaultExpanded: true },
    'Variables': group('Variables', {
      description: 'Values passed in as environment variables',
      defaultExpanded: true,
    }),
    'Execution': group('Execution', { description: 'Where and how long it runs' }),
    'Stop on Pattern': group('Stop on Pattern', {
      description: `End the ${noun} early when a line matches`,
    }),
    [FAILURE_HANDLING_GROUP]: failureHandlingGroup(),
  }
}

export function localProcessEnvInput(
  name: string,
  label: string,
  noun: LocalProcessNoun,
): InputParam {
  return param(name, label, 'map', false, `Each entry is exported into the ${noun}'s environment. Text, numbers and booleans arrive as text; arrays, maps and tables as JSON text.`, {
    defaultValue: {},
    group: 'Variables',
    keyPolicy: LOCAL_PROCESS_ENV_KEY_POLICY,
  })
}

export function localProcessExecutionInputs(noun: LocalProcessNoun): InputParam[] {
  return [
    param('working_dir', 'Working Directory', 'string', false, `Where the ${noun} starts: testdata://, artifact:// or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the machine the ${noun} runs on.`, {
      placeholder: 'System temp folder',
      fileReference: 'folder',
      group: 'Execution',
    }),
    { ...timeoutInput(300, `Seconds the ${noun} may run before WAVE stops it.`), group: 'Execution' },
    {
      ...streamOutputInput('Write each output line to the run console as it arrives: stdout at INFO, stderr at WARN.'),
      group: 'Execution',
    },
  ]
}

// Only the Fail pattern row carries the at-least-one rule, so its message shows once.
export function localProcessStopPatternInputs(noun: LocalProcessNoun): InputParam[] {
  return [
    param('stop_on_pattern', 'Stop on pattern', 'boolean', false, `Stop the ${noun} as soon as a line of its output matches a pattern.`, {
      defaultValue: false,
      noExpression: true,
      group: 'Stop on Pattern',
    }),
    param('pass_pattern', 'Pass pattern', 'string', false, `A Python regular expression. A matching line stops the ${noun} and the block passes.`, {
      defaultValue: '',
      showWhen: PATTERN_ON,
      retainOnHide: true,
      group: 'Stop on Pattern',
    }),
    param('fail_pattern', 'Fail pattern', 'string', false, `A Python regular expression. A matching line stops the ${noun} and the block fails.`, {
      defaultValue: '',
      showWhen: PATTERN_ON,
      retainOnHide: true,
      requiredWhenAll: [PATTERN_ON, PASS_EMPTY],
      requiredMessage: 'Set a pass pattern, a fail pattern or both',
      group: 'Stop on Pattern',
    }),
  ]
}

export function localProcessFailureInputs(): InputParam[] {
  return [failureHandlingOnErrorInput()]
}

/** Edited under Output Variables, never in the INPUT table. */
export function localProcessExportsParam(
  noun: LocalProcessNoun,
): InputParam & { outputList: OutputListPolicy } {
  return {
    ...param('script_variables', 'Variable Exports', 'array', false, `Shell variables the ${noun} sets, each bound to one WAVE variable and read as that variable's type.`, {
      defaultValue: [],
    }),
    outputList: {
      nameHeading: 'Script Variable',
      bindingHeading: 'WAVE Variable',
      itemNoun: 'variable export',
      addLabel: 'Add variable export',
      namePattern: SHELL_NAME_PATTERN,
      nameRuleMessage: VARIABLE_NAME_RULE_MESSAGE,
      invalidNameMessage: "Invalid script variable name: '{name}'",
      clashMessage: "Script variable '{name}' has the name of a block output",
      duplicateMessage: "Script variable '{name}' is listed more than once",
    },
  }
}

export function localProcessOutputs(noun: LocalProcessNoun, reasons: string): OutputParam[] {
  return [
    output('stdout', 'Stdout', 'string', `Everything the ${noun} wrote to standard output.`),
    output('stderr', 'Stderr', 'string', `Everything the ${noun} wrote to standard error.`),
    output('exit_code', 'Exit Code', 'integer', `The ${noun}'s exit code; 137 when WAVE stopped it, -1 when it never started. A non-zero code is a failure.`),
    ...outputCore({
      successDescription: `True when the ${noun} passed. False when it failed and On error is Record and continue.`,
      reasonDescription: `Why it failed: ${reasons}; empty when it passed.`,
    }),
  ]
}
