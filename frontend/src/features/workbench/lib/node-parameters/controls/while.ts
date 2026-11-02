import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('mode', 'Mode', 'string', true, 'Loop mode: pre-check or post-check', {
    enumValues: ['while-do', 'do-while'],
    defaultValue: 'while-do',
    noExpression: true,
  }),
  param('conditions', 'Conditions', 'array', true, 'Assertion conditions evaluated each iteration', {
    noExpression: true,
  }),
  param('max_iterations', 'Max Iterations', 'integer', false, 'Maximum iterations - session fails if reached', {
    group: 'Advanced',
  }),
  param('timeout', 'Timeout', 'float', false, 'Max execution time in seconds - session fails if reached', {
    group: 'Advanced',
  }),
]

export const outputs: OutputParam[] = [
  output('index', 'Index', 'integer', '0-based iteration counter'),
]
