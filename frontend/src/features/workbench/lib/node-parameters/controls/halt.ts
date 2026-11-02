import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('scope', 'Scope', 'string', false, 'Scope level at which to halt execution (test, suite, regression, or function)', {
    defaultValue: 'test', enumValues: ['test', 'suite', 'regression', 'function'], noExpression: true,
  }),
  param('status', 'Status', 'string', false, 'Status to assign to the halt', {
    defaultValue: 'failed', enumValues: ['passed', 'failed', 'skipped'], noExpression: true,
  }),
  param('message', 'Message', 'string', false, 'Halt message or reason'),
]

export const outputs: OutputParam[] = []
