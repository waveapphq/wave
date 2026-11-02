/**
 * Whether a switch into or out of {x}, or a type change, loses a value, so the warning
 * asks first (FIELD-7). One rule for the Block row and every list and map entry.
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 * REQ-3.1.3.19: Declared element types
 */

import { safeStringify } from '@/lib/utils'
import { isNullValue } from '@/lib/variable-format'
import { PLAIN_FLOAT, sameNumber } from '@/lib/number-rule'
import { defaultItemText, formatValue, opensNestedEditor, type ValueType } from '@/lib/variable-validation'
import type { VariableType } from '@/lib/variable-types'

const EMPTY_VALUE_TYPES: ReadonlySet<VariableType> = new Set<VariableType>(['string', 'array', 'map', 'table'])

/** Whether a structure's JSON text holds nothing. */
function emptyStructure(text: string): boolean {
  return Object.keys(JSON.parse(text) as object).length === 0
}

/** Whether a value is its type's default: '', 0 in any written form, false, [] or {}. */
function isTypeDefault(text: string, type: ValueType): boolean {
  if (type === 'integer' || type === 'float') return PLAIN_FLOAT.test(text) && sameNumber(text, 0)
  if (type === 'array' || type === 'map') return opensNestedEditor(text, type) && emptyStructure(text)
  return text === defaultItemText(type)
}

/** Whether a plain value holds what a type change or a switch into {x} would clear: anything but null and the empty default. */
export function plainValueIsHeld(value: unknown, type: ValueType, emptyValue?: unknown): boolean {
  if (isNullValue(value)) return false
  const text = formatValue(value)
  if (emptyValue !== undefined) return text !== formatValue(emptyValue)
  return !isTypeDefault(text, type)
}

/** Whether a switch out of {x} would clear a written expression. */
export function expressionIsHeld(value: unknown): boolean {
  return value !== undefined && value !== null && safeStringify(value).trim() !== ''
}

/** What a type change warning counts: the items or entries of a list or map, else the one value. */
export function clearedCount(value: unknown, type: ValueType): number {
  const text = formatValue(value)
  return opensNestedEditor(text, type) ? Object.keys(JSON.parse(text) as object).length : 1
}

/** Text, list, map and table values have an empty value Clear & Empty can leave (FIELD-7). */
export function hasEmptyValue(type: VariableType): boolean {
  return EMPTY_VALUE_TYPES.has(type)
}

/** The empty value Clear & Empty writes into {x}: `''`, `[]` or `{}`. */
export function emptyExpressionText(type: VariableType): string {
  if (type === 'map') return '{}'
  return type === 'array' || type === 'table' ? '[]' : "''"
}

/** The empty value Clear & Empty leaves: as an expression in {x}, else as the value. */
export function emptyValueOf(type: VariableType, expression: boolean): unknown {
  if (expression) return emptyExpressionText(type)
  if (type === 'map') return {}
  return type === 'array' || type === 'table' ? [] : ''
}
