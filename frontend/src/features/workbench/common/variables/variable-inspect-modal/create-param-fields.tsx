/**
 * CreateParamFields - the field cluster of the one variable window (VMGR-98, VMGR-112).
 *
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.3.24: Set to null by hand
 * REQ-3.1.2.10: Inputs with no default
 * REQ-3.1.2.11: Enum inputs
 */

import { useId, type MouseEvent, type ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { DescriptionField } from '@/components/shared/fields/description-field'
import type { ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import { cn } from '@/lib/utils'
import {
  MAX_FLOAT_SIG_DIGITS,
  MAX_INTEGER_DIGITS,
  numberValueProblem,
  sameNumber,
  type NumberProblem,
} from '@/lib/number-rule'
import { valueToText } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'
import type { VariableCreateMode } from './use-inspect-create'

/** Why a secret input's Set to null is held on: it has no default (VMGR-103, VMGR-114). */
export const NULL_FORCED_REASON = {
  secret: 'A secret input has no default: the Function Block gives the value.',
} as const

/** The Set to null row: ticked by hand, held on by a secret input, off while Create enum or Required is set. */
export interface SetToNullState {
  ticked: boolean
  forcedBy: keyof typeof NULL_FORCED_REASON | null
  disabledByEnum: boolean
  onChange: (next: boolean) => void
  /** No Set to null row: Kind is Expression or Template (VMGR-111). */
  hidden?: boolean
  /** Locked as it is: the definition is read-only. */
  locked?: boolean
}

const UNTICKED_NULL: SetToNullState = {
  ticked: false,
  forcedBy: null,
  disabledByEnum: false,
  onChange: () => {},
}

function enumValueProblem(value: unknown, type: ListItemType): NumberProblem | null {
  if (type === 'string') return typeof value === 'string' ? null : 'type'
  return numberValueProblem(value, type)
}

function problemWords(problem: NumberProblem, type: ListItemType): string {
  if (problem === 'integer-cap') return `must have at most ${MAX_INTEGER_DIGITS} digits`
  if (problem === 'float-cap') return `must have at most ${MAX_FLOAT_SIG_DIGITS} significant digits`
  return `is not a valid ${type}`
}

/** Allowed values are the same value: equal text, or the same exact number (`1.5` and `1.50`). */
function sameAllowed(left: unknown, right: unknown, type: ListItemType): boolean {
  return type === 'string' ? left === right : sameNumber(left as number | string, right as number | string)
}

/** Validate an enum input's allowed values against its type: the first problem's message, or null. */
export function validateEnumValues(values: unknown[], type: ListItemType): string | null {
  if (values.length === 0) return 'Enum allowed values cannot be empty'
  const index = values.findIndex((value) => enumValueProblem(value, type) !== null)
  if (index !== -1) {
    const problem = enumValueProblem(values[index], type) as NumberProblem
    return `Allowed value at index ${index} (${valueToText(values[index])}) ${problemWords(problem, type)}`
  }
  const empty = values.indexOf('')
  if (empty !== -1) return `Allowed value at index ${empty} is empty`
  const repeat = values.findIndex((value, at) => values.findIndex((other) => sameAllowed(other, value, type)) !== at)
  if (repeat === -1) return null
  return `Allowed value at index ${repeat} (${valueToText(values[repeat])}) is already listed`
}

interface CheckboxRowProps {
  testId: string
  label: string
  checked: boolean
  /** Locked, with this italic note beside the label linked to the box. */
  hint?: string
  /** Locked, with this reason shown as the row's tooltip. */
  reason?: string
  /** Locked with no note: the definition is read-only. */
  locked?: boolean
  onCheckedChange: (checked: boolean) => void
}

// A locked box drops the click (Space fires one too), so its checked state never changes.
function ignoreClick(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

function CheckboxRow({
  testId,
  label,
  checked,
  hint,
  reason,
  locked: lockedAsIs = false,
  onCheckedChange,
}: Readonly<CheckboxRowProps>) {
  const id = useId()
  const hintId = useId()
  const locked = lockedAsIs || hint !== undefined || reason !== undefined
  // The row is the tooltip trigger; a locked row rings itself on box focus, padded inside by a pulled-back margin.
  return (
    <ConditionalTooltip content={reason} disabled wide="fixed" side="right">
      <div
        className={cn(
          'flex w-fit items-center rounded-sm',
          locked && '-m-1 p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500',
        )}
      >
        <Checkbox
          id={id}
          data-testid={testId}
          checked={checked}
          aria-disabled={locked ? 'true' : undefined}
          aria-describedby={hint === undefined ? undefined : hintId}
          aria-description={reason}
          onClick={locked ? ignoreClick : undefined}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          className={cn(
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
            locked && 'focus-visible:ring-0',
          )}
        />
        <Label
          htmlFor={id}
          className="pl-2 text-sm font-normal cursor-pointer peer-aria-disabled:cursor-not-allowed peer-aria-disabled:opacity-50"
        >
          {label}
        </Label>
        {hint !== undefined && (
          <span id={hintId} className="ml-1 text-xs text-muted-foreground italic">
            {hint}
          </span>
        )}
      </div>
    </ConditionalTooltip>
  )
}

// A true / false input's default is never null (REQ-3.1.2.10); it shares the enum lock but has no enum to name.
function setToNullHint(setToNull: SetToNullState, required: boolean, type: VariableType): string | undefined {
  if (setToNull.forcedBy !== null) return undefined
  if (setToNull.disabledByEnum && type !== 'boolean') return 'off while enum is set'
  if (required) return 'off while Required is set'
  return setToNull.disabledByEnum ? 'off for a Boolean input' : undefined
}

export interface CreateParamFieldsProps {
  mode: VariableCreateMode
  /** The draft type; `typeIsEnumerable` is passed in step with it. */
  type: VariableType
  /** The type can carry an enum (String, Integer or Float), so an input offers Create enum (VMGR-112). */
  typeIsEnumerable: boolean
  required: boolean
  createEnum: boolean
  description: string
  onRequiredChange: (required: boolean) => void
  onCreateEnumChange: (createEnum: boolean) => void
  onDescriptionChange: (description: string) => void
  /** The Type (and Kind) row, slotted under Description. */
  typeField?: ReactNode
  /** The value area, slotted last. */
  valueBody?: ReactNode
  secret?: boolean
  onSecretChange?: (secret: boolean) => void
  /** Create enum is set, so Mark as secret is off (VMGR-104). */
  enumLocksSecret?: boolean
  /** Mark as secret is set, so Create enum is off (VMGR-104). */
  secretLocksEnum?: boolean
  setToNull?: SetToNullState
  /** The definition is read-only: Description and the checkboxes are locked. */
  readOnly?: boolean
}

export function CreateParamFields({
  mode,
  type,
  typeIsEnumerable,
  required,
  createEnum,
  description,
  onRequiredChange,
  onCreateEnumChange,
  onDescriptionChange,
  typeField,
  valueBody,
  secret = false,
  onSecretChange,
  enumLocksSecret = false,
  secretLocksEnum = false,
  setToNull = UNTICKED_NULL,
  readOnly = false,
}: Readonly<CreateParamFieldsProps>) {
  const descriptionId = useId()
  const showCreateEnum = mode === 'input' && typeIsEnumerable
  const enumOn = showCreateEnum && createEnum
  const nullReason = setToNull.forcedBy === null ? undefined : NULL_FORCED_REASON[setToNull.forcedBy]

  return (
    <>
      {mode !== 'variable' && (
        <div className="space-y-1.5">
          <Label htmlFor={descriptionId} className="block text-base font-medium">
            Description
          </Label>
          <DescriptionField
            id={descriptionId}
            name="parameter-description"
            data-testid="param-description"
            value={description}
            onChange={onDescriptionChange}
            placeholder="What this parameter is for"
            disabled={readOnly}
          />
        </div>
      )}

      {typeField}

      {mode === 'input' && (
        <CheckboxRow
          testId="param-required-checkbox"
          label="Required (the Function Block must set a value)"
          checked={required}
          hint={enumOn ? 'locked on while enum is set' : undefined}
          locked={readOnly}
          onCheckedChange={onRequiredChange}
        />
      )}

      <CheckboxRow
        testId="create-secret-checkbox"
        label="Mark as secret (value will be masked)"
        checked={secret}
        hint={enumLocksSecret ? 'off while enum is set' : undefined}
        locked={readOnly}
        onCheckedChange={(next) => onSecretChange?.(next)}
      />

      {!setToNull.hidden && (
        <CheckboxRow
          testId="create-set-to-null-checkbox"
          label="Set to null"
          checked={setToNull.ticked}
          hint={setToNullHint(setToNull, required, type)}
          reason={nullReason}
          locked={setToNull.locked}
          onCheckedChange={setToNull.onChange}
        />
      )}

      {showCreateEnum && (
        <CheckboxRow
          testId="param-create-enum-checkbox"
          label="Create enum (limit the Function Block to a fixed set of values)"
          checked={createEnum}
          hint={secretLocksEnum ? 'off while secret is set' : undefined}
          locked={readOnly}
          onCheckedChange={onCreateEnumChange}
        />
      )}

      {valueBody}
    </>
  )
}
