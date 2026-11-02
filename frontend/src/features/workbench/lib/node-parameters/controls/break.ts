import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('target_loop', 'Target Loop', 'string', true, 'Which loop to break out of'),
]

export const outputs: OutputParam[] = []
