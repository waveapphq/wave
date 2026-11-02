/**
 * Shared Parameter Builders
 *
 * The failure-handling rows and group every block family shares (REQ-3.4.2.2). Each
 * family passes its own wording in.
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'

export const RECORD_GATE = { field: 'on_error', values: ['record'] }

export const ON_ERROR_DESCRIPTION =
  'Fail the block, or record the outcome and let the test continue.'

export const FAILURE_HANDLING_DESCRIPTION =
  'Record and continue sets Success, Error and Reason instead of failing the block'

export function onErrorInput(description: string): InputParam {
  return param('on_error', 'On error', 'string', false, description, {
    enumValues: ['fail', 'record'],
    enumLabels: { fail: 'Fail the block', record: 'Record and continue' },
    defaultValue: 'fail',
    noExpression: true,
  })
}

export const FAILURE_HANDLING_GROUP = 'Failure Handling'

/** The collapsed Failure Handling group that holds the On error row. */
export function failureHandlingGroup(): GroupMeta {
  return group(FAILURE_HANDLING_GROUP, { description: FAILURE_HANDLING_DESCRIPTION })
}

export function failureHandlingOnErrorInput(description: string = ON_ERROR_DESCRIPTION): InputParam {
  return { ...onErrorInput(description), group: FAILURE_HANDLING_GROUP }
}

export function timeoutInput(defaultValue: number, description: string): InputParam {
  return param('timeout', 'Timeout', 'integer', false, description, { defaultValue, minimum: 1 })
}

/** The Log Output switch, in no group; each caller places the row itself. */
export function streamOutputInput(description: string): InputParam {
  return param('stream_output', 'Log Output', 'boolean', false, description, { defaultValue: false })
}

export interface OutputCoreWording {
  successDescription: string
  reasonDescription: string
}

// Error and Reason are gated on Record and continue; Success is offered either way.
export function outputCore({ successDescription, reasonDescription }: OutputCoreWording): OutputParam[] {
  return [
    output('success', 'Success', 'boolean', successDescription),
    output('error', 'Error', 'string', 'The error message when the operation failed under Record and continue; empty otherwise', { showWhen: RECORD_GATE }),
    output('reason', 'Reason', 'string', reasonDescription, { showWhen: RECORD_GATE }),
  ]
}
