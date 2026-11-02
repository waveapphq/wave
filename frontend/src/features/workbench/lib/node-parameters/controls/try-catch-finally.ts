import { param, output, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('enable_catch', 'Catch', 'boolean', false, 'Enable catch output handle for error handling path', {
    defaultValue: true, noExpression: true,
  }),
  param('enable_finally', 'Finally', 'boolean', false, 'Enable finally output handle for guaranteed cleanup path', {
    defaultValue: false, noExpression: true,
  }),
]

export const outputs: OutputParam[] = [
  output('error', 'Error', 'map', 'Caught error object with type, message, node, category, and other diagnostic fields'),
  output('caught', 'Caught', 'boolean', 'Whether an error was caught (true if try path failed)'),
]
