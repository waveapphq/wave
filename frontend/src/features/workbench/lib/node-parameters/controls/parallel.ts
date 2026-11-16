import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('branches', 'Branches', 'array', true, 'Branch lanes, each with an id, an optional name and an optional time limit in milliseconds', {
    noExpression: true,
  }),
  param('join', 'Join Mode', 'string', false, 'Join mode: Wait for all waits for every branch, First to finish for the first', {
    enumValues: ['all', 'first'],
    defaultValue: 'all',
    noExpression: true,
    enumLabels: { all: 'Wait for all', first: 'First to finish' },
  }),
  param('time_limit', 'Section Time Limit', 'integer', false, 'Optional. Milliseconds.', {
    minimum: 1,
  }),
]

export const outputs: OutputParam[] = []
