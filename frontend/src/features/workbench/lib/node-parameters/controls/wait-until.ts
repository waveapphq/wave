import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('conditions', 'Conditions', 'array', true, 'Assertion conditions evaluated each round', {
    noExpression: true,
  }),
  param('timeout', 'Timeout', 'integer', true, 'Maximum time to wait in milliseconds', {
    minimum: 1,
  }),
  param('check_interval', 'Check Interval', 'integer', false, 'Interval between condition checks in milliseconds', {
    defaultValue: 1000,
    minimum: 1,
  }),
  param('message', 'Timeout Message', 'string', false, 'Message logged when the wait gives up'),
  param('mode', 'Wait Mode', 'string', false, 'Retry runs a sub-flow between checks; Watch only re-checks', {
    enumValues: ['retry', 'watch'],
    defaultValue: 'retry',
    noExpression: true,
  }),
  param('fail_current_scope', 'Fail Current Scope', 'boolean', false, 'Fail the block and stop the flow when the wait gives up', {
    defaultValue: false,
  }),
]

export const outputs: OutputParam[] = [
  output('passed', 'Passed', 'boolean', 'Whether the condition became true'),
  output('elapsed', 'Elapsed', 'integer', 'Time waited in ms'),
]
