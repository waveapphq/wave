/**
 * ParameterRow Component
 *
 * PROFILE-35: Columns: Name | Type | Secret | Value | Actions
 * PROFILE-36 to PROFILE-41: Parameter table row behavior
 *
 * Value editing mirrors the Variable Setter: integer / float / boolean edit
 * inline via the shared ScalarEditBody; string + array / map / table open the
 * shared "Edit value" sheet. A secret parameter with a value renders one uniform
 * masked affordance whose clear-and-edit confirm gates the type-appropriate editor.
 */

import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { NameField } from '@/components/shared/fields/name-field'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { holdsSecretValue, isStoredSecretValue } from '@/lib/secret-envelope'
import { validateVariableName } from '@/features/workbench/hooks/use-variable-name-validation'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { VariableValueCell } from '@/features/workbench/common/variables/variable-value-cell'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import type { VariableType } from '@/lib/variable-types'
import type { TextFormat } from '@/lib/codemirror/format-editor'
import type { ElementTypes } from '@/lib/variable-validation'
import {
  convertValueToType,
  valueToString,
  headersRowsToRowObjects,
} from '@/features/profiles/container/transforms'
import { toTableRenderModel } from '@/lib/variable-table-model'
import type { Parameter, WaveType } from './types'
import { WAVE_TYPES, WAVE_TYPE_LABELS } from './types'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FieldErrorContext } from '@/components/shared/fields/field-error-context'

// Profiles are literal-only - the sheet's template autocomplete scope is empty.
const PROFILE_AVAILABLE_VARIABLES: AvailableVariable[] = []
const PLAIN_ONLY: TextFormat[] = ['plain']

/** The structured value the shared cell edits: a real boolean / raw string for the
 *  inline scalar bodies, raw string for a string preview, the parsed structure for
 *  array / map, and header-keyed row objects for table (converted at the edge). */
function fieldValueFor(type: WaveType, currentValue: string): unknown {
  if (type === 'boolean') return currentValue === 'true'
  if (type === 'table') {
    return headersRowsToRowObjects(
      convertValueToType(currentValue, 'table') as { headers: string[]; rows: unknown[][] },
    )
  }
  if (type === 'array' || type === 'map') return convertValueToType(currentValue, type)
  return currentValue
}

interface ParameterRowProps {
  parameter: Parameter
  environmentId: string
  /** A plain-text field: its value editor offers no format, as a secret's does not. */
  plainText?: boolean
  /** The message of a value outside its declared bounds (FIELDERR-1). */
  valueError?: string | null
  disabled: boolean
  /** When true, name/type/delete are read-only; values remain editable. */
  structureLocked?: boolean
  onUpdate: (id: string, updates: Partial<Parameter>) => void
  onUpdateValue: (id: string, value: string, elementTypes?: ElementTypes) => void
  onDelete: (id: string) => void
  /** Returns true if another parameter (different ID) already has this name. */
  nameExists?: (name: string, excludeId: string) => boolean
}

/** Every environment of the map, each with no value. */
function emptiedValues(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(values).map((environmentId) => [environmentId, '']))
}

export function ParameterRow({ parameter, environmentId, plainText = false, valueError, disabled, structureLocked = false, onUpdate, onUpdateValue, onDelete, nameExists }: Readonly<ParameterRowProps>) {
  const [secretConfirmOpen, setSecretConfirmOpen] = React.useState(false)
  const valueErrorId = React.useId()
  const nameErrorId = React.useId()
  // A value message hangs below the field; every cell pads alike so nothing moves (FIELDERR-2).
  const cellY = valueError ? 'pt-2 pb-7' : 'py-2'
  const rowGuard = useRowRemovalGuard()

  // Get value for current environment
  const currentValue = parameter.values[environmentId] ?? ''

  // Un-securing drops every environment's stored secret value.
  const hasAnyValue = Object.values(parameter.values).some(holdsSecretValue)

  // Handle secret checkbox change with confirmation
  const handleSecretChange = (checked: boolean) => {
    const isRemovingSecretWithValues = !checked && parameter.secret && hasAnyValue
    if (isRemovingSecretWithValues) {
      setSecretConfirmOpen(true)
    } else {
      onUpdate(parameter.id, { secret: checked })
    }
  }

  const handleConfirmUnsecret = () => {
    // Clear the value when removing secret protection
    onUpdateValue(parameter.id, '')
    const elsewhere = Object.keys(parameter.values).some((id) => id !== environmentId)
    onUpdate(
      parameter.id,
      // The environments not on screen hold the secret too; none may keep it unprotected.
      elsewhere
        ? { secret: false, values: emptiedValues(parameter.values), elementTypes: undefined }
        : { secret: false },
    )
    setSecretConfirmOpen(false)
  }

  // The shared cell emits a structured value (a scalar inline edit or a sheet
  // save); store it back as the per-environment string, converting the table at
  // the edge. Profiles are literal-only, so the cell's template flag is moot.
  const handleCellChange = (value: unknown, _isTemplate?: boolean, elementTypes?: ElementTypes) => {
    let stored: string
    if (parameter.type === 'table') {
      const { columns, rows } = toTableRenderModel(value)
      const original = convertValueToType(currentValue, 'table') as { headers: string[] }
      const headers = columns.length > 0 ? columns.map((column) => column.name) : (original.headers ?? [])
      stored = JSON.stringify({ headers, rows })
    } else {
      stored = valueToString(value, parameter.type)
    }
    onUpdateValue(parameter.id, stored, elementTypes)
  }

  // An unnamed parameter is dropped on save, so an empty name is an error
  // ("Name is required") and blocks Save (use-profile-form canSubmit).
  const nameError = validateVariableName(parameter.name, {
    variableId: parameter.id,
    nameExists,
  })

  return (
    <>
      <tr className="border-b border-border last:border-b-0" data-parameter-id={parameter.id}>
        {/* Name */}
        <td className={cn(cellY, 'pl-3 pr-2 min-w-0 align-top')}>
          <NameField
            name="parameter-name"
            value={parameter.name}
            onChange={(value) => onUpdate(parameter.id, { name: value })}
            placeholder="name"
            disabled={disabled || structureLocked}
            className="h-8 text-sm font-mono"
            aria-label="Parameter name"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? nameErrorId : undefined}
            maxLength={MAX_VARIABLE_NAME_LENGTH}
          />
          {nameError && (
            <p id={nameErrorId} className="mt-1 text-xs text-destructive" role="alert">
              {nameError}
            </p>
          )}
        </td>

        {/* Type */}
        <td className={cn(cellY, 'px-2')}>
          <select
            name="parameter-type"
            value={parameter.type}
            onChange={(e) => onUpdate(parameter.id, { type: e.target.value as WaveType })}
            disabled={disabled || structureLocked}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Parameter type"
          >
            {WAVE_TYPES.map((type) => (
              <option key={type} value={type}>
                {WAVE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </td>

        {/* Secret Checkbox - disabled for Boolean type */}
        <td className={cn(cellY, 'px-2 text-center')}>
          <ConditionalTooltip
            content={
              parameter.type === 'boolean'
                ? 'Secret not available for Boolean type'
                : 'Mark as secret'
            }
            disabled={parameter.type === 'boolean'}
          >
            <span className="inline-flex">
              <input
                type="checkbox"
                name="parameter-secret"
                checked={parameter.secret}
                onChange={(e) => handleSecretChange(e.target.checked)}
                disabled={disabled || parameter.type === 'boolean'}
                className="h-4 w-4 rounded border-primary disabled:opacity-50"
                aria-label="Mark as secret"
              />
            </span>
          </ConditionalTooltip>
        </td>

        {/* Value - per-environment (PROFILE-39), type-specific affordances.
            The flex + min-w-0 row gives the affordance a flex-resolved width so
            the Edit-button preview truncates inside the table-fixed cell instead
            of stretching the column (mirrors the Variable Setter's value field). */}
        <td className={cn(cellY, 'px-2')}>
          <div className="relative flex min-w-0">
            <FieldErrorContext value={valueError ? valueErrorId : undefined}>
              <VariableValueCell
                key={environmentId}
                label={parameter.name}
                type={parameter.type as VariableType}
                value={fieldValueFor(parameter.type, currentValue)}
                elementTypes={parameter.elementTypes?.[environmentId]}
                secret={parameter.secret && isStoredSecretValue(currentValue)}
                allowedFormats={parameter.secret || plainText ? PLAIN_ONLY : undefined}
                secretAffordance="field"
                disabled={disabled}
                availableVariables={PROFILE_AVAILABLE_VARIABLES}
                allowTemplate={false}
                isTemplate={false}
                onChange={handleCellChange}
                onClearSecretValue={() => onUpdateValue(parameter.id, '')}
                editTestId={`param-edit-value-${parameter.id}`}
                blank="unset"
              />
            </FieldErrorContext>
            {valueError ? (
              <p
                id={valueErrorId}
                role="alert"
                data-testid={`param-value-error-${parameter.id}`}
                className="absolute inset-x-0 top-full mt-1 truncate text-xs text-destructive"
              >
                {valueError}
              </p>
            ) : null}
          </div>
        </td>

        {/* Delete */}
        <td className={cn(cellY, 'pl-2 text-center')}>
          <button
            type="button"
            onClick={() => rowGuard.request([parameter.name], () => onDelete(parameter.id))}
            disabled={disabled || structureLocked}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Delete parameter"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>

      <RowRemovalQuestion guard={rowGuard} />

      {/* Secret Removal Confirmation Dialog (canonical ConfirmationDialog) */}
      <ConfirmationDialog
        isOpen={secretConfirmOpen}
        onClose={() => setSecretConfirmOpen(false)}
        onConfirm={handleConfirmUnsecret}
        variant="delete"
        title="Remove Secret Protection?"
        description="Removing secret protection will permanently delete the stored value. This action cannot be undone."
        confirmLabel="Remove & Delete Value"
      />
    </>
  )
}
