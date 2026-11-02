/**
 * ValueField - the shared per-type value affordance for a variable / parameter
 * row, used by both the Variable Setter rows and the Profile parameter rows so
 * the two surfaces stay identical:
 * - integer / float / boolean: an inline shared ScalarEditBody.
 * - string + array / map / table: a plain truncating Edit-preview button (pencil
 *   + value preview) that calls onEdit() to open the host's "Edit value" sheet.
 *
 * A plain <button> (not the shadcn Button, whose inner children-wrapper has no
 * min-w-0) so a long preview truncates with an ellipsis inside its bounded
 * wrapper instead of overflowing onto sibling controls.
 */

import { use, type ComponentProps } from 'react'
import { Lock, Pencil } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  describedByOf,
  FieldErrorContext,
  FieldNoteContext,
} from '@/components/shared/fields/field-error-context'
import { Button } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { NullChip } from '@/components/shared/variable-bodies/body-parts'
import { ScalarEditBody } from '@/components/shared/variable-bodies/scalar-edit-body'
import { getDefaultValueForType } from '@/lib/variable-defaults'
import { getValueColorClass, isNullValue, NULL_LOOK_CLASS } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'
import { holdsSecretValue } from '@/lib/secret-envelope'
import { getValuePreview } from '@/lib/variable-value-preview'

// The hosts check the value they receive; an emptied box arrives as empty text, unfinished text (`-`) as typed.
const noopValidChange = () => {}

/** What a cleared number box means; 'variable' also shows a stored null as the null chip. */
export type ValueFieldBlank = 'refuse' | 'unset' | 'variable'

/** The Edit-preview text color: the null look for a null value, else the type's color. */
function previewColorClass(type: VariableType, value: unknown): string {
  if (isNullValue(value)) return NULL_LOOK_CLASS
  return type === 'string' ? getValueColorClass('string') : 'text-muted-foreground'
}

/** A blank string preview (or no value) shows the host's placeholder instead. */
function isBlankPreview(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

export interface MaskedSecretControlProps {
  /** 'pill' keeps the lock inside the control; 'field' leaves it to the host (SECFLD-1..2). */
  secretAffordance?: 'pill' | 'field'
  /** The field's visible label; it leads the control's accessible name. */
  fieldName?: string
  onClick?: () => void
  disabled?: boolean
  id?: string
  'aria-describedby'?: string
  'data-testid'?: string
  className?: string
}

type MaskedSecretButtonProps = ComponentProps<typeof Button> & {
  lockInside: boolean
  describedBy?: string
  fieldName?: string
}

/** The masked button; its tooltip trigger hands it the hint's id as aria-describedby. */
function MaskedSecretButton({
  lockInside,
  describedBy,
  fieldName,
  'aria-describedby': hintId,
  className,
  ...button
}: Readonly<MaskedSecretButtonProps>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      {...button}
      // Important: the outline Button's own text color otherwise wins over the muted look.
      className={cn(
        'h-8 w-full min-w-0 justify-start text-sm font-normal !text-muted-foreground',
        className,
      )}
      aria-label={fieldName ? `${fieldName}: Edit protected value` : 'Edit protected value'}
      aria-describedby={describedByOf(describedBy, hintId)}
    >
      <Pencil className="h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />
      {lockInside && <Lock className="h-3.5 w-3.5 mr-1.5 shrink-0" aria-hidden="true" />}
      <span className="font-mono tracking-widest" aria-hidden="true">
        {'•'.repeat(8)}
      </span>
    </Button>
  )
}

/** The masked stored-secret control: a click asks the host to clear the value and edit it. */
export function MaskedSecretControl({
  secretAffordance = 'pill',
  'aria-describedby': describedBy,
  onClick,
  ...button
}: Readonly<MaskedSecretControlProps>) {
  return (
    <ConditionalTooltip content="Edit will clear the existing value">
      <MaskedSecretButton
        lockInside={secretAffordance === 'pill'}
        describedBy={describedBy}
        {...button}
        onClick={(event) => {
          // Not every browser focuses a clicked button, and the confirm hands focus back to its opener.
          event.currentTarget.focus()
          onClick?.()
        }}
      />
    </ConditionalTooltip>
  )
}

export interface ValueFieldProps {
  type: VariableType
  /** Typed scalar value (scalar branch) or structured value (complex preview). */
  value: unknown
  onChange: (value: unknown) => void
  /** Opens the host's "Edit value" sheet (string + array / map / table). */
  onEdit: () => void
  /** data-testid for the Edit-preview button (the host surfaces differ). */
  editTestId: string
  /** Disables the Edit-preview button (the inline scalar bodies are never disabled). */
  disabled?: boolean
  /** Marks this a secret row: a secret holding a value renders one uniform masked
   *  clear-and-edit affordance (every type) instead of the inline / Edit-preview. */
  secret?: boolean
  /** Starts the host's clear-and-edit confirm for a masked secret value. */
  onEditSecret?: () => void
  /** True while a cleared secret scalar is being re-entered inline (skips masking). */
  isEditingSecret?: boolean
  /** Masked-affordance shape: 'pill' is the compact inline pencil+lock+dots pill;
   *  'field' is a full-width field without the inline lock, for hosts that render
   *  their own status icon in the field's right slot (SECFLD-1..2). */
  secretAffordance?: 'pill' | 'field'
  /** Empty-state placeholder shown italic + muted instead of "Edit…" (strings). */
  placeholder?: string
  /** Accessible name for the Edit-preview button when the preview text does not identify the field. */
  ariaLabel?: string
  /** What a cleared number box means; the scalar body's own default when absent. */
  blank?: ValueFieldBlank
  /** The field's visible name; a variable value's null chip reads `<fieldName> (null)`. */
  fieldName?: string
}

export function ValueField({
  type,
  value,
  onChange,
  onEdit,
  editTestId,
  disabled = false,
  secret = false,
  onEditSecret,
  isEditingSecret = false,
  secretAffordance = 'pill',
  placeholder,
  ariaLabel,
  blank,
  fieldName,
}: Readonly<ValueFieldProps>) {
  const errorId = use(FieldErrorContext)
  const noteId = use(FieldNoteContext)
  // A secret row holding a value masks uniformly for every type (boolean is never
  // secret; a cleared scalar being re-entered edits inline). Fires before the type
  // dispatch so the raw value never renders.
  if (secret && type !== 'boolean' && !isEditingSecret && holdsSecretValue(value)) {
    return (
      <MaskedSecretControl
        secretAffordance={secretAffordance}
        onClick={onEditSecret}
        disabled={disabled}
      />
    )
  }

  const isVariable = blank === 'variable'
  if (isVariable && fieldName !== undefined && isNullValue(value)) {
    return (
      <div className="flex h-8 w-full min-w-0 items-center">
        <NullChip label={fieldName} onEnterValue={() => onChange(getDefaultValueForType(type))} />
      </div>
    )
  }

  if (type === 'integer' || type === 'float' || type === 'boolean') {
    return (
      <div className="w-full min-w-0">
        <ScalarEditBody
          value={value}
          type={type}
          onChange={onChange}
          onValidChange={noopValidChange}
          onInvalidText={onChange}
          errorId={errorId}
          size="row"
          blank={isVariable ? 'refuse' : blank}
        />
      </div>
    )
  }

  const isString = type === 'string'
  const showPlaceholder =
    placeholder !== undefined && isString && isBlankPreview(value)
  const triggerClassName =
    'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
  const triggerBody = (
    <>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
      {showPlaceholder ? (
        <span className="truncate min-w-0 font-mono italic text-muted-foreground/70">
          {placeholder}
        </span>
      ) : (
        <span
          className={cn(
            'truncate min-w-0 font-mono',
            previewColorClass(type, value),
          )}
        >
          {getValuePreview(type, value)}
        </span>
      )}
    </>
  )

  return (
    <button
      type="button"
      data-testid={editTestId}
      aria-label={ariaLabel}
      aria-describedby={describedByOf(errorId, noteId)}
      onClick={onEdit}
      disabled={disabled}
      className={cn(triggerClassName, errorId ? 'border-destructive' : 'border-input')}
    >
      {triggerBody}
    </button>
  )
}
