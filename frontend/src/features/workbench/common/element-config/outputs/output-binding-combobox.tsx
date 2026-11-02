/**
 * OutputBindingCombobox - Variable binding combobox for output parameters.
 *
 * Dropdown lists only type-compatible variables, but the input still accepts
 * any name as free text. Picking an incompatible variable (by typing its
 * name) surfaces an inline error under the row and disables Save until a
 * compatible binding is chosen.
 *
 * Delegates rendering to VariableComboboxBase. The "new variable" hint and
 * keyboard shortcut footer live here.
 */

import { useMemo } from 'react'
import { OUTPUT_TYPE_COMPAT } from '@/features/workbench/lib/node-parameters/types'
import {
  VariableComboboxBase,
  type ComboboxVariable,
} from '../shared/variable-combobox-base'
import {
  describeBindingRejection,
  isOutputBindable,
} from '@/features/workbench/lib/validation/output-binding-rules'

export function OutputBindingCombobox({
  value,
  onChange,
  parameterType,
  availableVariables,
  errorId,
  ariaLabel,
}: Readonly<{
  value: string
  onChange: (value: string) => void
  parameterType: string
  availableVariables: ComboboxVariable[]
  /** Id of the inline error the row renders under this input, when there is one. */
  errorId?: string
  /** Accessible name of the input; the placeholder alone names nothing. */
  ariaLabel?: string
}>) {
  // Output bindings can only target test-local variables - filter out
  // namespace placeholders (system / suite / regression) and any names that
  // aren't valid Python identifiers (dotted aliases, profile fields, etc.).
  const bindableVariables = useMemo(
    () => availableVariables.filter((v) => isOutputBindable(v.name)),
    [availableVariables],
  )

  const compatibleVariables = useMemo(() => {
    const compat = OUTPUT_TYPE_COMPAT[parameterType]
    const filtered = !compat || compat.size === 0
      ? bindableVariables
      : bindableVariables.filter((v) => compat.has(v.type))
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  }, [bindableVariables, parameterType])

  const allVariableNames = useMemo(
    () => new Set(availableVariables.map((v) => v.name)),
    [availableVariables],
  )

  // A name the rules reject can never be bound, so the dropdown stays shut and
  // the row's inline error under the input is the only thing on screen.
  const nameRejected = describeBindingRejection(value.trim()) !== null

  // Show "new variable" hint when the typed name doesn't match any existing variable exactly
  const isNewVariable = value.trim().length > 0
    && !availableVariables.some((v) => v.name === value.trim())

  const headerSlot = isNewVariable ? (
    <div
      className="px-3 py-1.5 text-xs text-muted-foreground italic border-b"
      data-testid="output-new-var-hint"
    >
      &ldquo;{value.trim()}&rdquo; will be created as a new variable
    </div>
  ) : null

  const footerSlot = (
    <div
      className="px-3 py-1.5 text-[11px] text-muted-foreground border-t bg-muted/30"
      data-testid="output-binding-footer"
    >
      <kbd className="font-mono">Esc</kbd>{' '}close
      <span className="mx-2">|</span>
      <kbd className="font-mono">Ctrl+Space</kbd>{' '}reopen
    </div>
  )

  return (
    <VariableComboboxBase
      value={value}
      onChange={onChange}
      variables={compatibleVariables}
      allVariableNames={allVariableNames}
      header={headerSlot}
      footer={footerSlot}
      suppressPopover={nameRejected}
      invalid={nameRejected || errorId !== undefined}
      aria-describedby={errorId}
      aria-label={ariaLabel}
    />
  )
}
