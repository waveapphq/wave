/**
 * The control structure rules the window holds Save on and the canvas lists, in the save check's words
 * (REQ-3.5.0.3, REQ-3.5.1.5, REQ-3.1.1.3, REQ-3.5.1.15), and the window lines the field list cannot express.
 */

import type { LiteralAssertion } from '@/features/workbench/common/config/assertion-builder/types'
import {
  compareNumbers,
  floatSignificantDigits,
  integerDigitCount,
  MAX_FLOAT_SIG_DIGITS,
  MAX_INTEGER_DIGITS,
  numberValueProblem,
  type NumberProblem,
  type NumberType,
} from '@/lib/number-rule'
import { compareValueState, conditionListsOf } from './condition-checks'
import { literalNumber, numberBoundError, type BoundedParam } from './number-bounds'

export type ControlFindingCode =
  | 'REQUIRED_PARAM_MISSING'
  | 'REQUIRED_PARAM_EMPTY'
  | 'INVALID_CONDITION'
  | 'INVALID_COMPARE_VALUE'
  | 'INVALID_CONTROL_STRUCTURE'
  | 'INVALID_SETTING_VALUE'

/** One control problem: the save check's code, its place under `config.values`, and its text. */
export interface ControlFinding {
  code: ControlFindingCode
  field: string
  message: string
}

export interface ControlProblem {
  field: string
  message: string
}

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlankText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}

function missing(field: string): ControlFinding {
  return { code: 'REQUIRED_PARAM_MISSING', field, message: `Required parameter '${field}' is missing` }
}

function empty(field: string, message = `Required parameter '${field}' is empty`): ControlFinding {
  return { code: 'REQUIRED_PARAM_EMPTY', field, message }
}

// --- Condition items ---

const STRAY_JOIN = "'and' and 'or' go between two conditions"

function isMarker(item: unknown): boolean {
  return isRec(item) && item.type === 'operator'
}

/** The join break at `index`: a marker first, last or next to another marker, or two conditions side by side. */
function joinBreak(items: readonly unknown[], index: number, place: string): ControlFinding | null {
  const field = `${place}.${index}`
  const afterMarker = index > 0 && isMarker(items[index - 1])
  if (isMarker(items[index])) {
    const stray = index === 0 || index === items.length - 1 || afterMarker
    return stray ? { code: 'INVALID_CONDITION', field, message: STRAY_JOIN } : null
  }
  if (index === 0 || afterMarker) return null
  return { code: 'INVALID_CONDITION', field, message: `Condition items in '${place}' must be joined by 'and' or 'or'` }
}

/** The subject the save check names a compare value by. */
function comparedSubject(row: LiteralAssertion, inFilter: boolean): string {
  return inFilter ? 'The value compared with the cell' : `The value compared with '${row.variable}'`
}

/** The number rule's reason, as the save check words it after its subject. */
export function numberRuleReason(value: unknown, type: NumberType, problem: NumberProblem): string {
  if (problem === 'integer-cap') {
    return `allows at most ${MAX_INTEGER_DIGITS} digits, got ${integerDigitCount(value as string | number)}`
  }
  if (problem === 'float-cap') {
    return `allows at most ${MAX_FLOAT_SIG_DIGITS} significant digits, got ${floatSignificantDigits(value as string | number)}`
  }
  return `is not a valid ${type}`
}

/** A literal row's compare value finding, if any; an operator that takes no value has none. */
function compareValueFinding(row: LiteralAssertion, at: string, inFilter: boolean): ControlFinding | null {
  const field = `${at}.reference_value`
  const state = compareValueState(row)
  if (state.kind === 'missing') return missing(field)
  if (state.kind === 'empty') return empty(field)
  if (state.kind !== 'number') return null
  const reason = numberRuleReason(row.reference_value, state.type, state.problem)
  return { code: 'INVALID_COMPARE_VALUE', field, message: `${comparedSubject(row, inFilter)} ${reason}` }
}

/** Each part of a literal row as Save checks it: the variable, then the compare value. */
function literalFindings(row: LiteralAssertion, at: string, inFilter: boolean): ControlFinding[] {
  const found: ControlFinding[] = []
  if (row.variable === undefined || row.variable === null) found.push(missing(`${at}.variable`))
  else if (isBlankText(row.variable)) found.push(empty(`${at}.variable`))
  const compared = compareValueFinding(row, at, inFilter)
  return compared === null ? found : [...found, compared]
}

function itemFindings(item: unknown, at: string, inFilter: boolean): ControlFinding[] {
  if (!isRec(item)) return []
  if (item.type === 'literal') return literalFindings(item as unknown as LiteralAssertion, at, inFilter)
  if (item.type === 'expression') {
    if (item.expression === undefined || item.expression === null) return [missing(`${at}.expression`)]
    return isBlankText(item.expression) ? [empty(`${at}.expression`)] : []
  }
  if (item.type !== 'group') return []
  const items = Array.isArray(item.items) ? item.items : []
  return items.length === 0 ? [empty(`${at}.items`)] : listFindings(items, `${at}.items`, inFilter)
}

/** Every finding of one condition list in list order, with one join finding at its first break. */
function listFindings(items: readonly unknown[], place: string, inFilter: boolean): ControlFinding[] {
  const found: ControlFinding[] = []
  let joinFound = false
  items.forEach((item, index) => {
    const join = joinFound ? null : joinBreak(items, index, place)
    if (join !== null) {
      found.push(join)
      joinFound = true
    }
    found.push(...itemFindings(item, `${place}.${index}`, inFilter))
  })
  return found
}

// --- Branches ---

const BRANCHES_NEEDING_CONDITIONS = new Map<string, ReadonlySet<string>>([
  ['if-else', new Set(['if', 'else_if'])],
  ['switch-case', new Set(['case'])],
])

/** The type of each branch whose list must hold a row, by its list's place. */
function branchTypesNeedingRows(elementType: string, values: Rec): Map<string, string> {
  const needing = BRANCHES_NEEDING_CONDITIONS.get(elementType)
  const types = new Map<string, string>()
  if (needing === undefined || !Array.isArray(values.branches)) return types
  values.branches.forEach((branch: unknown, index) => {
    if (isRec(branch) && typeof branch.type === 'string' && needing.has(branch.type)) {
      types.set(`branches.${index}.conditions`, branch.type)
    }
  })
  return types
}

function conditionFindings(elementType: string, values: Rec): ControlFinding[] {
  const branchTypes = branchTypesNeedingRows(elementType, values)
  return conditionListsOf(elementType, values).flatMap(({ items, place, inFilter }) => {
    const branchType = branchTypes.get(place)
    const noRow = items.every(isMarker)
    const rule = branchType !== undefined && noRow ? [empty(place, `${branchType} branch must have conditions`)] : []
    return [...rule, ...listFindings(items, place, inFilter)]
  })
}

// --- Parallel lanes ---

const LANE_LIMIT: BoundedParam = { name: 'time_limit', label: 'Time Limit', minimum: 1 }
const NO_FLAGS: ReadonlySet<string> = new Set()

function laneLimitPlace(index: number): string {
  return `branches.${index}.time_limit`
}

function isBlankExpression(value: unknown): boolean {
  return value === undefined || value === null || isBlankText(value)
}

function laneFinding(lane: unknown, index: number, flags: ReadonlySet<string>): ControlFinding | null {
  if (!isRec(lane)) return null
  const field = laneLimitPlace(index)
  const limit = lane.time_limit
  if (flags.has(field)) return isBlankExpression(limit) ? empty(field) : null
  const bound = numberBoundError(LANE_LIMIT, { time_limit: limit }, [LANE_LIMIT], NO_FLAGS)
  return bound === null ? null : { code: 'INVALID_SETTING_VALUE', field, message: bound }
}

function parallelFindings(values: Rec, flags: ReadonlySet<string>): ControlFinding[] {
  const lanes = Array.isArray(values.branches) ? values.branches : []
  const found: ControlFinding[] =
    lanes.length < 2 ? [{ code: 'INVALID_CONTROL_STRUCTURE', field: 'branches', message: 'Parallel requires at least 2 branches' }] : []
  lanes.forEach((lane: unknown, index) => {
    const finding = laneFinding(lane, index, flags)
    if (finding !== null) found.push(finding)
  })
  return found
}

// --- For step ---

const STEP_ZERO = 'Step must not be zero'

/** A literal whole-number step of 0; an {x} step is checked at run. */
function stepIsZero(values: Rec, flags: ReadonlySet<string>): boolean {
  if (flags.has('step')) return false
  const step = literalNumber(values.step, false)
  return step !== undefined && numberValueProblem(values.step, 'integer') === null && compareNumbers(step, 0) === 0
}

/** Every control problem of a Block with its save check code; a Block with no control rules has none. */
export function controlFindings(
  elementType: string,
  values: Record<string, unknown>,
  expressionFields: readonly string[],
): ControlFinding[] {
  const flags = new Set(expressionFields)
  if (elementType === 'parallel') return parallelFindings(values, flags)
  if (elementType === 'for') {
    return stepIsZero(values, flags) ? [{ code: 'INVALID_SETTING_VALUE', field: 'step', message: STEP_ZERO }] : []
  }
  return conditionFindings(elementType, values)
}

/** The rules the window holds Save on and the canvas lists; an empty top-level list belongs to the required rule. */
export function controlProblems(
  elementType: string,
  values: Record<string, unknown>,
  expressionFields: readonly string[],
): ControlProblem[] {
  return controlFindings(elementType, values, expressionFields).map(({ field, message }) => ({ field, message }))
}

/** The window lines the field list cannot express, by field place. */
export function controlFieldMessages(
  elementType: string,
  values: Record<string, unknown>,
  expressionFields: readonly string[],
): Record<string, string> {
  const flags = new Set(expressionFields)
  if (elementType === 'for') return stepIsZero(values, flags) ? { step: STEP_ZERO } : {}
  if (elementType !== 'parallel' || !Array.isArray(values.branches)) return {}
  const messages: Record<string, string> = {}
  values.branches.forEach((lane: unknown, index) => {
    const place = laneLimitPlace(index)
    if (isRec(lane) && flags.has(place) && isBlankExpression(lane.time_limit)) messages[place] = 'Time Limit is required'
  })
  return messages
}
