/**
 * The one condition row of If/Else, Switch, Assert, While, Wait Until and the CSV / Excel filters (FIELD-15):
 * operator list, compare value as the one field with its expand and {x} columns, or the expression row.
 * REQ-3.5.1.5, REQ-3.4.1.12; CSV-12, FIELD-13
 */

import { useRef, type ReactNode } from 'react'
import { EntryChangeQuestions, useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'
import { cn, safeStringify } from '@/lib/utils'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import { conditionValueModes, expressionOnlyModes } from '@/features/workbench/lib/node-parameters/field-modes'
import { compareToType, compareValueFits } from '@/features/workbench/lib/validation/condition-checks'
import { FieldCellView, useFieldCell } from '@/features/workbench/common/element-config/parameters/field-cell'
import { EnumInput } from '@/features/workbench/common/element-config/parameters/parameter-value-inputs'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import {
  UNARY_OPERATORS,
  getOperatorsForType,
  withOperator,
  withoutCompareValue,
  type ExpressionAssertion,
  type LiteralAssertion,
} from './types'

// A row with a line under it grows 20 px as padding, which never collapses with the list's spacing (FIELD-15).
const GROWN_ROW_CLASS = 'pb-5'
const EMPTY_COLUMN_CLASS = 'w-8 shrink-0'
// A filter row tests the table cell, offered to its expressions as `_cell` (CSV-12).
const FILTER_CELL = '_cell'

type OperatorOption = ReturnType<typeof getOperatorsForType>[number]

/** The operator list as a choice field: the operators of the row's value type. */
function operatorField(operators: readonly OperatorOption[]): Parameter {
  return {
    name: 'operator',
    label: 'Operator',
    type: 'string',
    required: false,
    enumValues: operators.map((option) => option.value),
    enumLabels: Object.fromEntries(operators.map((option) => [option.value, option.label])),
  }
}

/** The row holding a new compare value; a value that is not set keeps no key. */
function withCompareValue(row: LiteralAssertion, value: unknown): LiteralAssertion {
  if (value !== undefined) return { ...row, reference_value: value }
  const next = { ...row }
  delete next.reference_value
  return next
}

/** One {x} switch writes its mode and its value in the same event: both land on the row of that event. */
function useRowWriter(row: LiteralAssertion, onRow: (next: LiteralAssertion) => void) {
  const pending = useRef<LiteralAssertion | null>(null)
  return (change: (current: LiteralAssertion) => LiteralAssertion) => {
    if (pending.current === null) {
      queueMicrotask(() => {
        pending.current = null
      })
    }
    const next = change(pending.current ?? row)
    pending.current = next
    onRow(next)
  }
}

/** The columns a compare value takes, left empty so the actions stay in their column. */
function EmptyValueColumns() {
  return (
    <>
      <span aria-hidden="true" className="min-w-0 flex-1" />
      <span aria-hidden="true" className={EMPTY_COLUMN_CLASS} />
      <span aria-hidden="true" className={EMPTY_COLUMN_CLASS} />
    </>
  )
}

export interface ConditionLiteralRowProps {
  row: LiteralAssertion
  onRow: (next: LiteralAssertion) => void
  availableVariables: AvailableVariable[]
  /** The compare value cell's stem: `param-input-<stem>`, `param-expand-<stem>`, `param-error-<stem>`. */
  testIdStem: string
  operatorTestId: string
  toggleTestId: string
  /** The row's compare value message, from the shared row check. */
  valueMessage?: string
  /** The host draws a line under its own part of the row (the variable line). */
  grows: boolean
  /** The variable box and type pill; none for a filter row. */
  leading?: ReactNode
  actions: ReactNode
}

/** A literal condition row on one line: [leading] operator, compare value, expand, {x}, [actions]. */
export function ConditionLiteralRow({
  row,
  onRow,
  availableVariables,
  testIdStem,
  operatorTestId,
  toggleTestId,
  valueMessage,
  grows,
  leading,
  actions,
}: Readonly<ConditionLiteralRowProps>) {
  const write = useRowWriter(row, onRow)
  const change = useEntryChange()
  const cell = useFieldCell({
    mode: 'input',
    // The compare value never takes null; a text compare takes a Template (FIELD-15).
    parameter: { name: testIdStem, label: 'Value', type: compareToType(row), required: false },
    value: row.reference_value,
    onChange: (value) => write((current) => withCompareValue(current, value)),
    modes: conditionValueModes(row, (patch) => write((current) => ({ ...current, ...patch }))),
    availableVariables,
    fieldError: valueMessage,
    toggleTestId,
  })
  const takesValue = !UNARY_OPERATORS.has(row.operator)
  const operators = getOperatorsForType(row.value_type)

  // The fit rule of a variable pick: a held value the new compare type cannot keep asks first, then goes (FIELD-13).
  const pickOperator = (operator: string) => {
    const next = withOperator(row, operator)
    if (compareValueFits(row, next)) {
      onRow(next)
      return
    }
    // The list offers only the operators of the row's value type.
    const { label } = operators.find((option) => option.value === operator) as OperatorOption
    change.askOperator(compareToType(row), label, 1, () => onRow(withoutCompareValue(next)))
  }

  return (
    <>
      <div className={cn('flex items-center gap-2', (grows || (takesValue && cell.hasMessage)) && GROWN_ROW_CLASS)}>
        {leading}
        <div className="w-[140px] shrink-0">
          <EnumInput
            parameter={operatorField(operators)}
            effectiveValue={row.operator}
            onChange={(operator) => pickOperator(String(operator))}
            showRequiredError={false}
            testId={operatorTestId}
          />
        </div>
        {takesValue ? (
          <div className="relative min-w-0 flex-1">
            <FieldCellView state={cell} />
          </div>
        ) : (
          <EmptyValueColumns />
        )}
        {actions}
      </div>
      <EntryChangeQuestions change={change} subject="entry" />
    </>
  )
}

export interface ConditionExpressionRowProps {
  row: ExpressionAssertion
  onRow: (next: ExpressionAssertion) => void
  availableVariables: AvailableVariable[]
  /** The expression cell's stem: `param-input-<stem>`, `param-expand-<stem>`, `param-error-<stem>`. */
  testIdStem: string
  /** The row's message, from the shared row check. */
  message?: string
  grows: boolean
  /** The braces marker of a control row; none for a filter row. */
  leading?: ReactNode
  actions: ReactNode
}

/** An expression condition row: [leading] expression box, expand, an empty {x} column, [actions]. */
export function ConditionExpressionRow({
  row,
  onRow,
  availableVariables,
  testIdStem,
  message,
  grows,
  leading,
  actions,
}: Readonly<ConditionExpressionRowProps>) {
  const readsCell = availableVariables.some((variable) => variable.name === FILTER_CELL)
  const cell = useFieldCell({
    mode: 'input',
    parameter: {
      name: testIdStem,
      label: 'Condition',
      type: 'string',
      required: false,
      noExpression: true,
      placeholder: readsCell ? '_cell != None' : 'Boolean expression (e.g. x > 5)',
    },
    value: row.expression,
    onChange: (value) => onRow({ ...row, expression: safeStringify(value) }),
    modes: expressionOnlyModes(),
    availableVariables,
    fieldError: message,
  })

  return (
    <div className={cn('flex items-center gap-2', (grows || cell.hasMessage) && GROWN_ROW_CLASS)}>
      {leading}
      <div className="relative min-w-0 flex-1">
        <FieldCellView state={cell} />
      </div>
      {actions}
    </div>
  )
}
