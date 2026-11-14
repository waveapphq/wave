import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('collection', 'Collection', 'array', true, 'Variable to iterate over (array, map, or table)', {
    variableRef: { types: ['array', 'map', 'table'] },
    selectableType: { options: ['array', 'map', 'table'] },
  }),
  // Drawn by the collection row's Type picker; left out, the picker shows the bound variable's type.
  param('collection_type', 'Collection Type', 'string', false, "The collection's type as picked in the window: array, map or table", {
    enumValues: ['array', 'map', 'table'],
    noExpression: true,
  }),
  param('timeout', 'Timeout', 'float', false, 'Max execution time in seconds', {
    group: 'Advanced',
  }),
]

export const outputs: OutputParam[] = [
  output('item', 'Item', 'map', 'Current item envelope: {type, value}'),
  output('index', 'Index', 'integer', 'Current iteration index (0-based)'),
]
