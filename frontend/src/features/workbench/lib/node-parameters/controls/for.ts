import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('mode', 'Mode', 'string', true, 'Iteration mode', {
    enumValues: ['count', 'range'],
    defaultValue: 'count',
    noExpression: true,
  }),
  param('count', 'Count', 'integer', false, 'Number of iterations', {
    showWhen: { field: 'mode', values: ['count'] },
    requiredWhen: { field: 'mode', values: ['count'] },
  }),
  param('start', 'Start', 'integer', false, 'Starting value (inclusive)', {
    showWhen: { field: 'mode', values: ['range'] },
    requiredWhen: { field: 'mode', values: ['range'] },
  }),
  param('end', 'End', 'integer', false, 'Ending value (exclusive)', {
    showWhen: { field: 'mode', values: ['range'] },
    requiredWhen: { field: 'mode', values: ['range'] },
  }),
  param('step', 'Step', 'integer', true, 'Increment per iteration', {
    defaultValue: 1,
    group: 'Advanced',
  }),
  param('timeout', 'Timeout', 'float', false, 'Max execution time in seconds', {
    group: 'Advanced',
  }),
]

export const outputs: OutputParam[] = [
  output('index', 'Index', 'integer', 'Current iteration value'),
]
