/**
 * EntityVariableValueCell - the entity-scope (Suite / Regression / System) value
 * cell. It bridges the JSON-string edge: an entity VariableRow stores its value
 * as a string, so this parses it into the structured value the shared
 * VariableValueCell edits and re-stringifies the cell's output back onto the row.
 * Injected into the shared VariableEditor via its renderValueCell render-prop
 * (components/shared cannot import this feature cell).
 *
 * Entity-scope is literal-only (no expression / template kinds), so the sheet is
 * opened with allowTemplate=false and an empty autocomplete scope.
 *
 * REQ-3.1.3.1: Variable scoping (entity-scope value editing)
 * REQ-3.1.3.11: Variable Manager UI panel (one family behind every value surface)
 * REQ-3.1.3.20: Null is the only empty value (VMGR-93, VMGR-95)
 */

import { useId, type ReactNode } from 'react'

import { FieldErrorContext } from '@/components/shared/fields/field-error-context'
import { VariableValueCell } from '@/features/workbench/common/variables/variable-value-cell'
import { isStoredSecretValue } from '@/lib/secret-envelope'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { isNullValue } from '@/lib/variable-format'
import { parseEntityCellValue, toEntityStoredValue, type VariableRow } from '@/lib/variable-types'
import { validateVariableValue, type ElementTypes } from '@/lib/variable-validation'

const EMPTY_AVAILABLE: AvailableVariable[] = []

/** The row fields a sheet save writes: its element types when the sheet reports them. */
function elementTypesOf(elementTypes: ElementTypes | undefined): Partial<VariableRow> {
  return elementTypes === undefined ? {} : { elementTypes }
}

export interface EntityVariableValueCellProps {
  row: VariableRow
  rows: VariableRow[]
  onRowsChange: (rows: VariableRow[]) => void
}

export function EntityVariableValueCell({
  row,
  rows,
  onRowsChange,
}: Readonly<EntityVariableValueCellProps>): ReactNode {
  const errorId = useId()
  // The editor shows no row message for an injected cell, so the cell names what blocks Save.
  const error = validateVariableValue(row.type, row.value)

  // VariableRow.value is typed string, but the backend round-trips entity values
  // as actual JS values (verbatim) - so the stored shape is structured here.
  const store = (stored: unknown, elementTypes?: ElementTypes) =>
    onRowsChange(
      rows.map((r) =>
        r.id === row.id ? { ...r, value: stored as string, ...elementTypesOf(elementTypes) } : r,
      ),
    )

  return (
    <div className="flex w-full min-w-0 flex-col">
      <FieldErrorContext value={error === null ? undefined : errorId}>
        <VariableValueCell
          label={row.name}
          type={row.type}
          value={isNullValue(row.value) ? null : parseEntityCellValue(row.type, row.value)}
          secret={row.secret && isStoredSecretValue(row.value)}
          secretAffordance="field"
          availableVariables={EMPTY_AVAILABLE}
          allowTemplate={false}
          isTemplate={false}
          elementTypes={row.elementTypes}
          onChange={(value, _isTemplate, elementTypes) =>
            store(toEntityStoredValue(row.type, value), elementTypes)
          }
          onClearSecretValue={() => store('')}
          editTestId={`entity-var-edit-${row.id}`}
          blank="variable"
        />
      </FieldErrorContext>
      {error !== null && (
        <p id={errorId} role="alert" className="mt-0.5 text-[10px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
