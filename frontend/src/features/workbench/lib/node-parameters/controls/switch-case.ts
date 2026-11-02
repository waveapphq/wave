import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param(
    'branches',
    'Branches',
    'array',
    true,
    'Ordered list of case branches with conditions and break, plus an optional default',
    { noExpression: true },
  ),
]

export const outputs: OutputParam[] = []
