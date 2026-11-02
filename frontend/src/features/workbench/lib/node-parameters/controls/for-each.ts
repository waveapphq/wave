import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('collection', 'Collection', 'array', true, 'Variable to iterate over (array, map, or table)', {
    variableRef: { types: ['array', 'map', 'table'] },
    selectableType: { options: ['array', 'map', 'table'] },
  }),
  param('timeout', 'Timeout', 'float', false, 'Max execution time in seconds', {
    group: 'Advanced',
  }),
]

export const outputs: OutputParam[] = [
  output('item', 'Item', 'map', 'Current item envelope: {type, value}'),
  output('index', 'Index', 'integer', 'Current iteration index (0-based)'),
]
