/**
 * Shared value-preview helpers for the at-a-glance "Edit value" button label.
 *
 * Used by the Variable Setter rows and the Profile parameter rows so both
 * render the same complex summary / string preview text.
 */

import { isNullValue, valueToText } from '@/lib/variable-format'
import { isTableShape, toTableRenderModel } from '@/lib/variable-table-model'

function isComplexType(type: string): boolean {
  return type === 'array' || type === 'map' || type === 'table'
}

function getComplexSummary(type: string, value: unknown): string {
  if (type === 'array' && Array.isArray(value)) {
    return `${value.length} items`
  }
  if (type === 'map' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return `${Object.keys(value).length} pairs`
  }
  if (type === 'table' && isTableShape(value)) {
    const { columns, rows } = toTableRenderModel(value)
    return `${rows.length} rows x ${columns.length} col`
  }
  return 'Edit…'
}

/** The at-a-glance text on a row's Edit-value button: `null`, a shape summary, or the string quoted. */
export function getValuePreview(type: string, value: unknown): string {
  if (isNullValue(value)) return 'null'
  if (isComplexType(type)) return getComplexSummary(type, value)
  const str = valueToText(value)
  if (!str) return 'Edit…'
  return `"${str}"`
}
