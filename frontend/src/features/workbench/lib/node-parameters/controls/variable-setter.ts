import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('variables', 'Variables', 'map', true, 'Key-value pairs of variable names and values to set in the execution context'),
]

export const outputs: OutputParam[] = []
