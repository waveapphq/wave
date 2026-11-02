/**
 * Documentation text the Python editor's completion panel shows beside an
 * Input Variable (PYRUN-19). The type mapping is PYRUN-5's.
 */

import { toTableRenderModel } from '@/lib/variable-table-model'

const ORIGIN = 'Input Variable.'

const RUNTIME_SENTENCE: Record<string, string> = {
  string: 'Arrives as a str.',
  integer: 'Arrives as an int.',
  float: 'Arrives as a Decimal.',
  boolean: 'Arrives as a bool.',
  null: 'Arrives as None.',
  array: 'Arrives as a list; iterate, index, len().',
  map: 'Arrives as a dict; index by key, .get(), .items().',
}

const TABLE_ACCESS = 'Rows are dicts; iterate, index, len(); .columns and .rows.'

function tableSentences(boundValue: unknown): string {
  const names = toTableRenderModel(boundValue).columns.map((column) => column.name)
  if (names.length === 0) return `Arrives as a table. ${TABLE_ACCESS}`
  const count = `${names.length} column${names.length === 1 ? '' : 's'}`
  return `Arrives as a table with ${count}: ${names.join(', ')}. ${TABLE_ACCESS}`
}

/** `boundValue` is the referenced variable's value; a table reads its columns from it. */
export function pythonInputVariableDoc(type: string, boundValue?: unknown): string {
  if (type === 'table') return `${ORIGIN} ${tableSentences(boundValue)}`
  const sentence = RUNTIME_SENTENCE[type]
  return sentence === undefined ? ORIGIN : `${ORIGIN} ${sentence}`
}
