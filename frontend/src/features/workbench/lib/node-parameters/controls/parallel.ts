import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('time_limit', 'Section Time Limit', 'integer', false, 'Optional. Milliseconds.'),
]

export const outputs: OutputParam[] = []
