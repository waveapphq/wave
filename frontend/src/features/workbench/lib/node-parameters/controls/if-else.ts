import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('branches', 'Branches', 'array', true, 'Ordered list of conditional branches with conditions', { noExpression: true }),
]

export const outputs: OutputParam[] = []
