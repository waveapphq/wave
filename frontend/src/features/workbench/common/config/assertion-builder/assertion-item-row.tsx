/**
 * Assertion Builder - Assertion Item Row
 *
 * Renders a single literal assertion, expression assertion, or group.
 */

import { Braces } from 'lucide-react'
import { ExpressionField } from '@/features/workbench/common/element-config/expressions/expression-field'
import { TextField } from '@/components/shared/fields/text-field'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn, safeStringify } from '@/lib/utils'
import { TYPE_PILL_CLASS, getTypePillColorClass } from '@/lib/variable-format'

import type {
  AssertionItem,
  AssertionNodeProps,
} from './types'
import { UNARY_OPERATORS, getOperatorsForType, withOperator, withValueType } from './types'
import { ActionButtons } from './action-buttons'
import { compareToProblem } from './tree-helpers'
import { VariableComboboxBase } from '@/features/workbench/common/element-config/shared/variable-combobox-base'
import { GroupContainer } from './group-container'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AssertionItemRowProps extends AssertionNodeProps {
  item: AssertionItem
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringifyRefValue(value: unknown): string {
  return safeStringify(value)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssertionItemRow({
  item,
  path,
  index,
  total,
  availableVariables,
  onUpdate,
  onDelete,
  onMove,
  onAddLiteral,
  onAddExpression,
  onAddGroup,
  onDeleteGroup,
}: Readonly<AssertionItemRowProps>) {
  const pathStr = path.join('-')

  if (item.type === 'group') {
    return (
      <GroupContainer
        group={item}
        path={path}
        index={index}
        total={total}
        availableVariables={availableVariables}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onMove={onMove}
        onAddLiteral={onAddLiteral}
        onAddExpression={onAddExpression}
        onAddGroup={onAddGroup}
        onDeleteGroup={onDeleteGroup}
      />
    )
  }

  if (item.type === 'expression') {
    return (
      <div className="flex items-center gap-2" data-testid={`assert-row-${pathStr}`}>
        {/* Braces icon */}
        <div
          className="flex items-center justify-center h-8 w-8 shrink-0 text-muted-foreground"
          data-testid={`assert-expression-icon-${pathStr}`}
        >
          <Braces className="h-4 w-4" />
        </div>

        {/* Expression input - CodeMirror-based with autocomplete */}
        <div className="flex-1 min-w-0" data-testid={`assert-expression-input-${pathStr}`}>
          <ExpressionField
            name={`assert-expr-${item.id}`}
            displayName="assertion expression"
            isInvalid={item.expression.trim().length === 0}
            value={item.expression}
            onChange={(val) =>
              onUpdate(path, { ...item, expression: val })
            }
            availableVariables={availableVariables}
            placeholder="Boolean expression (e.g. x > 5)"
            isFieldExpression={false}
          />
        </div>

        {/* Action buttons */}
        <ActionButtons
          pathStr={pathStr}
          index={index}
          total={total}
          isNested={path.length > 1}
          onDelete={() => onDelete(path)}
          onMoveUp={() => onMove(path, 'up')}
          onMoveDown={() => onMove(path, 'down')}
        />
      </div>
    )
  }

  // Operator items are rendered by the parent, not by AssertionItemRow
  /* v8 ignore next - COV-UNREACH-013 */
  if (item.type === 'operator') return null

  // Literal assertion
  const operators = getOperatorsForType(item.value_type)
  const isUnary = UNARY_OPERATORS.has(item.operator)
  const valueProblem = compareToProblem(item)
  const valueErrorId = `assert-value-error-${item.id}`

  return (
    <>
      <div className="flex items-center gap-2" data-testid={`assert-row-${pathStr}`}>
        {/* Variable selector. It may narrow so the row never outgrows its box -
            a wider row would push the action buttons out of the shared column. */}
        <div className="w-[160px] min-w-[100px]">
          <VariableComboboxBase
            data-testid={`assert-variable-${pathStr}`}
            aria-label="Assertion variable"
            value={item.variable}
            variables={availableVariables}
            existingOnly
            invalid={item.variable.trim().length === 0}
            placeholder="variable"
            onChange={(varName) => {
              const varInfo = availableVariables.find((v) => v.name === varName)
              onUpdate(path, withValueType({ ...item, variable: varName }, varInfo?.type ?? 'string'))
            }}
          />
        </div>

        {/* Type badge - same pill the Variable Manager and the picker use */}
        <span
          data-testid={`assert-type-badge-${pathStr}`}
          className={cn(TYPE_PILL_CLASS, getTypePillColorClass(item.value_type))}
        >
          {item.value_type}
        </span>

        {/* Operator selector */}
        <Select
          value={item.operator}
          onValueChange={(val) => onUpdate(path, withOperator(item, val))}
        >
          <SelectTrigger
            className="h-8 text-sm w-[140px] shrink-0"
            data-testid={`assert-operator-${pathStr}`}
            aria-label="Assertion operator"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Value input (hidden for unary operators) */}
        {!isUnary && (() => {
          /* v8 ignore next - COV-BRANCH-105 */
          const refValueStr = stringifyRefValue(item.reference_value)
          return item.reference_is_expression ? (
            <div className="flex-1 min-w-[80px]" data-testid={`assert-value-input-${pathStr}`}>
              <ExpressionField
                name={`assert-ref-${item.id}`}
                /* v8 ignore next - COV-BRANCH-002 */
                displayName={item.variable || 'reference value'}
                value={refValueStr}
                onChange={(val) =>
                  onUpdate(path, { ...item, reference_value: val })
                }
                availableVariables={availableVariables}
                placeholder="Expression"
                isFieldExpression={false}
              />
            </div>
          ) : (
            <div className="flex-1 min-w-[80px]">
              <TextField
                data-testid={`assert-value-input-${pathStr}`}
                aria-label="Assertion value"
                inputMode={numberEntryProps(item.value_type).inputMode}
                aria-invalid={valueProblem === null ? undefined : true}
                aria-describedby={valueProblem === null ? undefined : valueErrorId}
                value={refValueStr}
                onChange={(val) => {
                  if (takesEntryText(val, item.value_type)) onUpdate(path, { ...item, reference_value: val })
                }}
                placeholder="Value"
              />
            </div>
          )
        })()}

        {/* Expression toggle for reference value */}
        {!isUnary && (
          <ExpressionToggle
            pressed={item.reference_is_expression}
            onPressedChange={() =>
              onUpdate(path, {
                ...item,
                reference_is_expression: !item.reference_is_expression,
              })
            }
            data-testid={`assert-expr-toggle-${pathStr}`}
            label="Toggle expression mode for value"
          />
        )}

        {/* Action buttons */}
        <ActionButtons
          pathStr={pathStr}
          index={index}
          total={total}
          isNested={path.length > 1}
          onDelete={() => onDelete(path)}
          onMoveUp={() => onMove(path, 'up')}
          onMoveDown={() => onMove(path, 'down')}
        />
      </div>
      {valueProblem !== null && (
        <p id={valueErrorId} data-testid={valueErrorId} role="alert" className="pl-1 text-xs text-destructive">
          {valueProblem}
        </p>
      )}
    </>
  )
}
