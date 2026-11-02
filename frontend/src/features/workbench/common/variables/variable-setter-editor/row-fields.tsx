/**
 * Variable Setter Editor - Row Field Components
 *
 * Value field used by VariableRowComponent: an inline expression field for an
 * expression row, otherwise the shared ValueField (inline scalar body, or an Edit
 * button that opens the shared "Edit value" sheet for string + array / map / table).
 */

import { use } from 'react'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import { ValueField as SharedValueField } from '@/components/shared/variable-bodies/value-field'
import { ExpressionField } from '@/features/workbench/common/element-config/expressions/expression-field'
import type { VariableType } from '@/lib/variable-types'
import type { AvailableVariable, VariableRow } from './types'

// ---------------------------------------------------------------------------
// ValueField
// ---------------------------------------------------------------------------

export function ValueField({
  row,
  index,
  isExpr,
  secret = false,
  availableVariables,
  onValueChange,
  onEditValue,
  onEditSecret,
}: Readonly<{
  row: VariableRow
  index: number
  isExpr: boolean
  secret?: boolean
  availableVariables: AvailableVariable[]
  onValueChange: (index: number, value: unknown) => void
  onEditValue: (rowIndex: number) => void
  onEditSecret?: (rowIndex: number) => void
}>) {
  const errorId = use(FieldErrorContext)
  if (isExpr) {
    return (
      <div className="flex-1 min-w-[140px]">
        <ExpressionField
          name={row.name || `row-${index}`}
          value={typeof row.value === 'string' ? row.value : ''}
          onChange={(val) => onValueChange(index, val)}
          isInvalid={errorId !== undefined}
          availableVariables={availableVariables.map((v) => ({
            name: v.name,
            type: v.type,
          }))}
        />
      </div>
    )
  }

  // integer / float / boolean inline; string + array / map / table edit via the
  // shared "Edit value" sheet - all behind the shared value field. A secret row
  // holding a value masks write-only until the clear-and-edit confirm.
  return (
    <div className="flex-1 min-w-[140px]">
      <SharedValueField
        type={row.type as VariableType}
        value={row.value}
        onChange={(val) => onValueChange(index, val)}
        onEdit={() => onEditValue(index)}
        editTestId={`varset-edit-value-${index}`}
        secret={secret}
        secretAffordance="field"
        onEditSecret={() => onEditSecret?.(index)}
        blank="variable"
        fieldName={row.name}
      />
    </div>
  )
}
