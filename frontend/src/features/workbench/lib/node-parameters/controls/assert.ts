import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('assertions', 'Assertions', 'array', true, 'List of assertion items (literal, expression, or group)', { noExpression: true }),
  param('mode', 'Mode', 'string', true, 'Output mode: single (one handle, always continues) or split (pass/fail handles with branching)', {
    defaultValue: 'split', enumValues: ['single', 'split'], noExpression: true,
  }),
  param('fail_current_scope', 'Fail Current Scope', 'boolean', false, 'When enabled, a failed assertion in single mode fails the block and stops the flow; in split mode the flow continues down the fail branch and the Test or Function it runs in ends failed', {
    defaultValue: false, noExpression: true,
  }),
]

export const outputs: OutputParam[] = [
  output('passed', 'Passed', 'boolean', 'Whether all assertions passed'),
]
