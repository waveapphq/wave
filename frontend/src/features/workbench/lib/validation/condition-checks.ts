/**
 * The one condition row check shared by the control windows, the CSV / Excel filters and the canvas
 * (REQ-3.5.1.5, CSV-12): the compare type, a row's problem, the value-loss fit and the condition lists a Block holds.
 */

import {
  UNARY_OPERATORS,
  type AssertionItem,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder/types'
import { numberValueProblem, type NumberProblem, type NumberType } from '@/lib/number-rule'
import { literalNumberProblem } from './number-bounds'

export type CompareType = NumberType | 'string'

/** The type a compare value is held to, from its value type and operator; the backend reads the same table. */
export function compareToType(row: LiteralAssertion): CompareType {
  if (row.value_type === 'integer' || row.value_type === 'float') return row.value_type
  return row.value_type === 'array' && row.operator === 'length_equals' ? 'integer' : 'string'
}

/** How a literal row's compare value reads, as the save check reads it. */
export type CompareValueState =
  | { kind: 'unused' }
  | { kind: 'missing' }
  | { kind: 'empty' }
  | { kind: 'number'; type: NumberType; problem: NumberProblem }
  | { kind: 'set' }

function isBlankText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}

/** An {x} or Template compare value: never read with the number rule. */
function isFlagged(row: LiteralAssertion): boolean {
  return row.reference_is_expression === true || row.reference_is_template === true
}

/** The compare value of a literal row: unused under an operator that takes none, else not set, blank, refused or set. */
export function compareValueState(row: LiteralAssertion): CompareValueState {
  if (UNARY_OPERATORS.has(row.operator)) return { kind: 'unused' }
  const value = row.reference_value
  if (value === undefined || value === null) return { kind: 'missing' }
  if (isFlagged(row)) return isBlankText(value) ? { kind: 'empty' } : { kind: 'set' }
  const type = compareToType(row)
  // Empty text typed into a text compare is a value and compares with empty text (FIELD-4).
  if (type === 'string') return { kind: 'set' }
  if (isBlankText(value)) return { kind: 'empty' }
  const problem = numberValueProblem(value, type)
  return problem === null ? { kind: 'set' } : { kind: 'number', type, problem }
}

/** A variable or expression text that is not set, not text, or only spaces. */
function isUnfilled(text: unknown): boolean {
  return typeof text !== 'string' || text.trim() === ''
}

export interface ConditionRowProblem {
  field: 'variable' | 'value' | 'expression'
  message: string
}

/** One problem per row, the variable first; a group and an AND / OR item have none of their own. */
export function conditionRowProblem(row: AssertionItem): ConditionRowProblem | null {
  if (row.type === 'expression') {
    return isUnfilled(row.expression) ? { field: 'expression', message: 'Condition is required' } : null
  }
  if (row.type !== 'literal') return null
  if (isUnfilled(row.variable)) return { field: 'variable', message: 'Choose a variable.' }
  const state = compareValueState(row)
  if (state.kind === 'missing' || state.kind === 'empty') return { field: 'value', message: 'Value is required' }
  if (state.kind !== 'number') return null
  return { field: 'value', message: literalNumberProblem(state.type, row.reference_value, false) as string }
}

/** Whether a compare value would be lost by a change: a literal holding '' or a blank {x} holds nothing. */
function holdsCompareValue(row: LiteralAssertion): boolean {
  const value = row.reference_value
  if (value === undefined || value === null) return false
  return isFlagged(row) ? !isBlankText(value) : value !== ''
}

/** True when `next` (the row after a variable pick or an as Type change) still keeps the compare value of `row`. */
export function compareValueFits(row: LiteralAssertion, next: LiteralAssertion): boolean {
  if (!holdsCompareValue(row)) return true
  if (UNARY_OPERATORS.has(next.operator)) return false
  if (row.reference_is_expression === true) return true
  const type = compareToType(next)
  if (type === 'string') return true
  // A Template builds text, so only a text compare keeps it.
  if (row.reference_is_template === true) return false
  return numberValueProblem(row.reference_value, type) === null
}

type ConditionRow = Exclude<AssertionItem, { type: 'operator' }>

function rowsOf(items: readonly AssertionItem[]): ConditionRow[] {
  return items.filter((item): item is ConditionRow => item.type !== 'operator')
}

function rowComplete(row: ConditionRow): boolean {
  return row.type === 'group' ? conditionListComplete(row.items) : conditionRowProblem(row) === null
}

/** At least one row, no row problem at any depth and no empty group. */
export function conditionListComplete(items: readonly AssertionItem[]): boolean {
  const rows = rowsOf(items)
  return rows.length > 0 && rows.every(rowComplete)
}

/** One condition list of a Block: its items, its place under `config.values`, and whether it tests a filter cell. */
export interface ConditionList {
  items: AssertionItem[]
  place: string
  inFilter: boolean
}

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function itemsOf(value: unknown): AssertionItem[] {
  return Array.isArray(value) ? (value as AssertionItem[]) : []
}

const TOP_LIST_KEY = new Map([
  ['assert', 'assertions'],
  ['while', 'conditions'],
  ['wait-until', 'conditions'],
])

// The Else and the default branch hold no conditions, so they are never listed.
const BRANCH_WITHOUT_CONDITIONS = new Map([
  ['if-else', 'else'],
  ['switch-case', 'default'],
])

const FILTER_BLOCKS = new Set(['csv-parser', 'excel-parser'])

/** Each entry of a list field holding its own condition list: branches or filters. */
function nestedLists(entries: unknown, key: string, skipType: string | undefined, inFilter: boolean): ConditionList[] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry: unknown, index) => {
    if (!isRec(entry) || (skipType !== undefined && entry.type === skipType)) return []
    return [{ items: itemsOf(entry.conditions), place: `${key}.${index}.conditions`, inFilter }]
  })
}

/** The one enumeration of the condition lists a Block holds, in list order. */
export function conditionListsOf(elementType: string, values: Record<string, unknown>): ConditionList[] {
  const top = TOP_LIST_KEY.get(elementType)
  if (top !== undefined) {
    return Array.isArray(values[top]) ? [{ items: values[top] as AssertionItem[], place: top, inFilter: false }] : []
  }
  const skipped = BRANCH_WITHOUT_CONDITIONS.get(elementType)
  if (skipped !== undefined) return nestedLists(values.branches, 'branches', skipped, false)
  return FILTER_BLOCKS.has(elementType) ? nestedLists(values.filters, 'filters', undefined, true) : []
}
