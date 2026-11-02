/**
 * Declared numeric bounds (PING-17, PING-18) and the number rule of a literal value (REQ-3.1.3.14), shared by
 * the block's issue badge and the config form's own field check so both say the same thing.
 */

import {
  compareNumbers,
  numberProblemMessage,
  numberValueProblem,
  PLAIN_FLOAT,
  plainNumberText,
} from '@/lib/number-rule'
import { isStoredSecretValue } from '@/lib/secret-envelope'

/** The bound-carrying subset of a parameter row, as both callers hold it. */
export interface BoundedParam {
  name: string
  /** The name the message uses; the wire name when absent (FIELDERR-1). */
  label?: string
  minimum?: number
  maximum?: number
  maximumField?: { field: string; message: string }
  defaultValue?: unknown
}

/** A value the form can compare, as exact decimal text: a finite number, or plain decimal text.
 *  An expression field, a blank row and anything else are left to the other rules. */
export function literalNumber(value: unknown, isExpression: boolean): string | undefined {
  if (isExpression) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? plainNumberText(value) : undefined
  return typeof value === 'string' && PLAIN_FLOAT.test(value) ? value : undefined
}

/** The message of a literal integer / float value the number rule refuses, or null. */
export function literalNumberProblem(type: string, value: unknown, isExpression: boolean): string | null {
  if (isExpression || (type !== 'integer' && type !== 'float')) return null
  if (value === undefined || value === null || value === '' || isStoredSecretValue(value)) return null
  const problem = numberValueProblem(value, type)
  if (problem === null) return null
  return problem === 'type' ? `Enter a valid ${type} value` : numberProblemMessage(problem, type)
}

/** The name a row's messages use: its label, else its wire name (FIELDERR-1). */
export function fieldLabel(param: Pick<BoundedParam, 'name' | 'label'>): string {
  return param.label ?? param.name
}

function rangeMessage(param: BoundedParam): string {
  const { minimum, maximum } = param
  const label = fieldLabel(param)
  if (minimum !== undefined && maximum !== undefined) {
    return `${label} must be between ${minimum} and ${maximum}`
  }
  if (minimum !== undefined) return `${label} must be at least ${minimum}`
  return `${label} must be at most ${maximum}`
}

/** The message for a declared bound the row's literal value breaks, or null. Nothing
 *  is clamped: the value the author typed is kept and the row carries the message. */
export function numberBoundError(
  param: BoundedParam,
  values: Record<string, unknown>,
  schema: readonly BoundedParam[],
  expressionFields: ReadonlySet<string>,
): string | null {
  const { minimum, maximum, maximumField } = param
  if (minimum === undefined && maximum === undefined && !maximumField) return null
  const own = literalNumber(values[param.name], expressionFields.has(param.name))
  if (own === undefined) return null
  if (
    (minimum !== undefined && compareNumbers(own, minimum) < 0) ||
    (maximum !== undefined && compareNumbers(own, maximum) > 0)
  ) {
    return rangeMessage(param)
  }
  if (!maximumField) return null
  const refParam = schema.find((p) => p.name === maximumField.field)
  const raw = values[maximumField.field] ?? refParam?.defaultValue
  const ceiling = literalNumber(raw, expressionFields.has(maximumField.field))
  return ceiling !== undefined && compareNumbers(own, ceiling) > 0 ? maximumField.message : null
}
