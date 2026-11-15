/**
 * Assertion Builder - Types, Constants and Utility Functions
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LiteralAssertion {
  id: string
  type: 'literal'
  variable: string
  value_type: string
  operator: string
  /** Absent while not set; an operator that takes no value keeps none of the three compare keys. */
  reference_value?: unknown
  reference_is_expression?: boolean
  reference_is_template?: boolean
}

export interface ExpressionAssertion {
  id: string
  type: 'expression'
  expression: string
}

export interface OperatorItem {
  type: 'operator'
  value: 'and' | 'or'
}

export interface AssertionGroup {
  id: string
  type: 'group'
  items: AssertionItem[]
}

export type AssertionItem = LiteralAssertion | ExpressionAssertion | AssertionGroup | OperatorItem

/** Shared callback and context props for assertion item row and group container */
export interface AssertionNodeProps {
  path: number[]
  index: number
  total: number
  availableVariables: Array<{ name: string; type: string }>
  onUpdate: (path: number[], updated: AssertionItem) => void
  onDelete: (path: number[]) => void
  onMove: (path: number[], direction: 'up' | 'down') => void
  onAddLiteral: (parentId?: string) => void
  onAddExpression: (parentId?: string) => void
  onAddGroup: (parentId?: string) => void
  onDeleteGroup: (groupId: string) => void
}

export interface AssertionBuilderProps {
  assertions: AssertionItem[]
  availableVariables: Array<{ name: string; type: string }>
  onAssertionsChange: (assertions: AssertionItem[]) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UNARY_OPERATORS = new Set([
  'is_true',
  'is_false',
  'is_empty',
  'is_not_empty',
  'is_null',
  'is_not_null',
])

const IS_NULL = { value: 'is_null', label: 'is null' }
const IS_NOT_NULL = { value: 'is_not_null', label: 'not null' }

export const OPERATORS_BY_TYPE: Record<string, Array<{ value: string; label: string }>> = {
  integer: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'not equals' },
    { value: 'less_than', label: 'less than' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_or_equal', label: 'less or equal' },
    { value: 'greater_or_equal', label: 'greater or equal' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  float: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'not equals' },
    { value: 'less_than', label: 'less than' },
    { value: 'greater_than', label: 'greater than' },
    { value: 'less_or_equal', label: 'less or equal' },
    { value: 'greater_or_equal', label: 'greater or equal' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  string: [
    { value: 'equals', label: 'equals' },
    { value: 'not_equals', label: 'not equals' },
    { value: 'contains', label: 'contains' },
    { value: 'does_not_contain', label: 'does not contain' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'matches_regex', label: 'matches regex' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  boolean: [
    { value: 'is_true', label: 'is true' },
    { value: 'is_false', label: 'is false' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  array: [
    { value: 'contains', label: 'contains' },
    { value: 'does_not_contain', label: 'does not contain' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
    { value: 'length_equals', label: 'length equals' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  map: [
    { value: 'has_key', label: 'has key' },
    { value: 'does_not_have_key', label: 'does not have key' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
    IS_NULL,
    IS_NOT_NULL,
  ],
  table: [
    IS_NULL,
    IS_NOT_NULL,
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

// Fallback operators for unknown types
const DEFAULT_OPERATORS = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  IS_NULL,
  IS_NOT_NULL,
]

let idCounter = 0
export function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`
}

export function getOperatorsForType(valueType: string): Array<{ value: string; label: string }> {
  return OPERATORS_BY_TYPE[valueType] ?? DEFAULT_OPERATORS
}

const COMPARE_TO_KEYS = ['reference_value', 'reference_is_expression', 'reference_is_template'] as const

/** The row with no compare value and no mode flag: what a change that loses the value leaves. */
export function withoutCompareValue(row: LiteralAssertion): LiteralAssertion {
  const next = { ...row }
  for (const key of COMPARE_TO_KEYS) delete next[key]
  return next
}

/** The one new-row seed: no variable, the type's first operator, no compare value (REQ-3.5.1.5). */
export function newLiteralRow(valueType = 'string'): LiteralAssertion {
  return {
    id: nextId('lit'),
    type: 'literal',
    variable: '',
    value_type: valueType,
    operator: getOperatorsForType(valueType)[0].value,
  }
}

/** An operator that takes no value keeps no compare value and no mode flag (REQ-3.5.1.5). */
export function dropUnusedCompareTo(row: LiteralAssertion): LiteralAssertion {
  if (!UNARY_OPERATORS.has(row.operator)) return row
  return COMPARE_TO_KEYS.some((key) => Object.hasOwn(row, key)) ? withoutCompareValue(row) : row
}

/** The row with a new operator; one that takes no compare-to value keeps none (REQ-3.1.3.25). */
export function withOperator(item: LiteralAssertion, operator: string): LiteralAssertion {
  // Leaving an operator that takes none, the compare value starts not set, as on a new row.
  if (UNARY_OPERATORS.has(item.operator)) return { ...withoutCompareValue(item), operator }
  return dropUnusedCompareTo({ ...item, operator })
}

/** The row read as another value type: it keeps an operator the type offers, else takes the type's first. */
export function withValueType(item: LiteralAssertion, valueType: string): LiteralAssertion {
  const operators = getOperatorsForType(valueType)
  const kept = operators.some((op) => op.value === item.operator)
  return withOperator({ ...item, value_type: valueType }, kept ? item.operator : operators[0].value)
}
