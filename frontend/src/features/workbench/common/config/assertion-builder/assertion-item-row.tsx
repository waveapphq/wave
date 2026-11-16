/**
 * Assertion Builder - Assertion Item Row
 *
 * Renders a single literal assertion, expression assertion, or group (FIELD-15).
 */

import { useId } from 'react'
import { Braces } from 'lucide-react'
import { EntryChangeQuestions, useEntryChange } from '@/components/shared/variable-bodies/entry-change-questions'
import { cn } from '@/lib/utils'
import { TYPE_PILL_CLASS, getTypePillColorClass } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'
import {
  compareToType,
  compareValueFits,
  conditionRowProblem,
} from '@/features/workbench/lib/validation/condition-checks'
import { VariableComboboxBase } from '@/features/workbench/common/element-config/shared/variable-combobox-base'

import type {
  AssertionItem,
  AssertionNodeProps,
  ExpressionAssertion,
  LiteralAssertion,
} from './types'
import { withValueType, withoutCompareValue } from './types'
import { ActionButtons } from './action-buttons'
import { ConditionExpressionRow, ConditionLiteralRow } from './condition-row'
import { GroupContainer } from './group-container'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AssertionItemRowProps extends AssertionNodeProps {
  item: AssertionItem
}

type RowProps<T> = Omit<AssertionItemRowProps, 'item'> & { item: T }

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function RowActions({ path, index, total, onDelete, onMove }: Readonly<Omit<RowProps<unknown>, 'item'>>) {
  return (
    <ActionButtons
      pathStr={path.join('-')}
      index={index}
      total={total}
      isNested={path.length > 1}
      onDelete={() => onDelete(path)}
      onMoveUp={() => onMove(path, 'up')}
      onMoveDown={() => onMove(path, 'down')}
    />
  )
}

function ExpressionItemRow({ item, ...props }: Readonly<RowProps<ExpressionAssertion>>) {
  const pathStr = props.path.join('-')
  const problem = conditionRowProblem(item)
  return (
    <div data-testid={`assert-row-${pathStr}`}>
      <ConditionExpressionRow
        row={item}
        onRow={(next) => props.onUpdate(props.path, next)}
        availableVariables={props.availableVariables}
        testIdStem={`assert-expr-${pathStr}`}
        message={problem?.message}
        grows={problem !== null}
        leading={
          <div
            className="flex items-center justify-center h-8 w-8 shrink-0 text-muted-foreground"
            data-testid={`assert-expression-icon-${pathStr}`}
          >
            <Braces className="h-4 w-4" />
          </div>
        }
        actions={<RowActions {...props} />}
      />
    </div>
  )
}

function LiteralItemRow({ item, ...props }: Readonly<RowProps<LiteralAssertion>>) {
  const { path, availableVariables, onUpdate } = props
  const pathStr = path.join('-')
  const variableErrorId = useId()
  const change = useEntryChange()
  const problem = conditionRowProblem(item)
  const variableMessage = problem?.field === 'variable' ? problem.message : undefined

  // A pick that would lose the compare value asks the shared value-loss question first (FIELD-13).
  const pickVariable = (name: string) => {
    const valueType = availableVariables.find((variable) => variable.name === name)?.type ?? 'string'
    const next = withValueType({ ...item, variable: name }, valueType)
    if (compareValueFits(item, next)) {
      onUpdate(path, next)
      return
    }
    change.askType(compareToType(item), valueType as VariableType, 1, () => onUpdate(path, withoutCompareValue(next)))
  }

  return (
    <div data-testid={`assert-row-${pathStr}`}>
      <ConditionLiteralRow
        row={item}
        onRow={(next) => onUpdate(path, next)}
        availableVariables={availableVariables}
        testIdStem={`assert-value-${pathStr}`}
        operatorTestId={`assert-operator-${pathStr}`}
        toggleTestId={`assert-expr-toggle-${pathStr}`}
        valueMessage={problem?.field === 'value' ? problem.message : undefined}
        grows={variableMessage !== undefined}
        leading={
          <>
            {/* The box may narrow so the row never outgrows its box and pushes the actions out of their column. */}
            <div className="relative w-[160px] min-w-[100px]">
              <VariableComboboxBase
                data-testid={`assert-variable-${pathStr}`}
                aria-label="Assertion variable"
                aria-describedby={variableMessage === undefined ? undefined : variableErrorId}
                value={item.variable}
                variables={availableVariables}
                existingOnly
                invalid={variableMessage !== undefined}
                placeholder="variable"
                onChange={pickVariable}
              />
              {variableMessage !== undefined && (
                <p
                  id={variableErrorId}
                  role="alert"
                  data-testid={`assert-variable-error-${pathStr}`}
                  className="absolute inset-x-0 top-full mt-1 truncate text-xs text-destructive"
                >
                  {variableMessage}
                </p>
              )}
            </div>
            {/* The same pill the Variable Manager and the picker use. */}
            <span
              data-testid={`assert-type-badge-${pathStr}`}
              className={cn(TYPE_PILL_CLASS, getTypePillColorClass(item.value_type))}
            >
              {item.value_type}
            </span>
          </>
        }
        actions={<RowActions {...props} />}
      />
      <EntryChangeQuestions change={change} subject="entry" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssertionItemRow({ item, ...props }: Readonly<AssertionItemRowProps>) {
  if (item.type === 'group') return <GroupContainer group={item} {...props} />
  if (item.type === 'expression') return <ExpressionItemRow item={item} {...props} />
  // Operator items are rendered by the parent, not by AssertionItemRow
  /* v8 ignore next - COV-UNREACH-013 */
  if (item.type === 'operator') return null
  return <LiteralItemRow item={item} {...props} />
}
