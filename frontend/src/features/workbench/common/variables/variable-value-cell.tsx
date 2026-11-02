/**
 * VariableValueCell - the shared per-row value editor in structured value space,
 * generalized from the profile parameter-row's value machinery so element-config
 * parameters AND entity-scope variable tables share one family:
 * - integer / float / boolean (not secret): an inline ScalarEditBody (via ValueField)
 * - string + array / map / table (not secret): a ValueField Edit-preview button
 *   opening the shared "Edit value" sheet
 * - a secret holding a value: one uniform masked clear-and-edit affordance whose
 *   "Edit Protected Value?" confirm clears the value (onClearSecretValue) then
 *   re-enters the type-appropriate editor (inline scalar / sheet)
 *
 * The floating sheet and the secret-confirm dialog live here (the sheet owns
 * capture-phase ESC and the unsaved-draft guard); the host adapts its stored
 * shape at the edge (onChange / onClearSecretValue).
 *
 * REQ-3.1.3.1: Variable scoping (entity-scope value editing)
 * REQ-3.1.3.11: Variable Manager UI panel (one family behind every value surface)
 */

import { useState, type ReactNode } from 'react'

import { ValueField, type ValueFieldBlank } from '@/components/shared/variable-bodies/value-field'
import { useProtectedValueConfirm } from '@/components/shared/variable-bodies/protected-value-field'
import { useSheetOpener } from '@/components/shared/draggable-sheet'
import { ValueEditorSheet } from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import type { TextFormat } from '@/lib/codemirror/format-editor'
import type { VariableType } from '@/lib/variable-types'
import type { ElementTypes } from '@/lib/variable-validation'

export interface VariableValueCellProps {
  /** The row's visible name; the sheet names it to the parent it was opened from. */
  label: string
  type: VariableType
  /** Structured value handed straight to the sheet (the host owns any string<->
   *  structured / table edge conversion). */
  value: unknown
  secret?: boolean
  disabled?: boolean
  /** Template autocomplete scope for the sheet (empty for literal-only consumers). */
  availableVariables: AvailableVariable[]
  /** When false the sheet's Kind dropdown is suppressed (literal-only). */
  allowTemplate?: boolean
  /** Restricts the sheet's string format options (host parameter schema). */
  allowedFormats?: TextFormat[]
  /** Seeds the sheet's Kind=Template for a string value already flagged template. */
  isTemplate?: boolean
  /** Array / map only: the value's declared element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  onChange: (value: unknown, isTemplate: boolean, elementTypes?: ElementTypes) => void
  /** Clears the secret value before the cleared-then-edit step (host-owned). */
  onClearSecretValue: () => void
  /** data-testid for the Edit-preview button (host surfaces differ). */
  editTestId?: string
  /** Masked-affordance shape passthrough ('field' for hosts that render their
   *  own status icon in the field's right slot - SECFLD-1..2). */
  secretAffordance?: 'pill' | 'field'
  /** Accessible name for the Edit-preview button when the preview text does not identify the field. */
  ariaLabel?: string
  /** What a cleared number box means; 'unset' for a field that may be left unset (K8SPROF-6), 'variable' for a variable value. */
  blank?: ValueFieldBlank
}

const SCALAR_TYPES = new Set<VariableType>(['integer', 'float'])

export function VariableValueCell({
  label,
  type,
  value,
  secret = false,
  disabled = false,
  availableVariables,
  allowTemplate = true,
  allowedFormats,
  isTemplate = false,
  elementTypes,
  onChange,
  onClearSecretValue,
  editTestId = 'value-cell-edit',
  secretAffordance = 'pill',
  ariaLabel,
  blank,
}: Readonly<VariableValueCellProps>): ReactNode {
  const sheet = useSheetOpener()
  const secretConfirm = useProtectedValueConfirm()
  // Keeps a cleared secret integer / float editable inline (string + complex open
  // the sheet instead).
  const [isEditingSecret, setIsEditingSecret] = useState(false)

  const handleConfirmEditSecret = () => {
    onClearSecretValue()
    if (SCALAR_TYPES.has(type)) {
      setIsEditingSecret(true)
    } else {
      // string + array / map / table: open the sheet once the cleared value settles.
      setTimeout(sheet.show, 50)
    }
  }

  return (
    <>
      <ValueField
        type={type}
        value={value}
        onChange={(next) => onChange(next, false)}
        onEdit={sheet.show}
        editTestId={editTestId}
        disabled={disabled}
        secret={secret}
        onEditSecret={() => secretConfirm.open(handleConfirmEditSecret)}
        isEditingSecret={isEditingSecret}
        secretAffordance={secretAffordance}
        ariaLabel={ariaLabel}
        blank={blank}
        fieldName={label}
      />

      {sheet.open && (
        <ValueEditorSheet
          ref={sheet.ref}
          label={label}
          name=""
          type={type}
          value={value}
          isTemplate={isTemplate}
          allowTemplate={allowTemplate}
          allowedFormats={allowedFormats}
          elementTypes={elementTypes}
          availableVariables={availableVariables}
          captureEsc
          onSave={(next, nextIsTemplate, _exprKeys, nextElementTypes) =>
            onChange(next, nextIsTemplate, nextElementTypes)
          }
          onClose={sheet.hide}
        />
      )}

      {secretConfirm.dialog}
    </>
  )
}
