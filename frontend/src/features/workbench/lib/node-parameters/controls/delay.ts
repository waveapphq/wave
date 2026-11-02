import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('duration', 'Duration', 'integer', true, 'Duration to pause workflow execution in milliseconds', {
    minimum: 1,
  }),
]

export const outputs: OutputParam[] = []
