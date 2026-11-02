/**
 * StoredPasswordField - a Settings password that may already be stored: the
 * masked stored-secret field until its confirm empties it, then a password
 * input with an eye toggle (MCP-7, NET-10).
 *
 * REQ-3.1.3.5: Secret variable masking
 */

import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ProtectedValueField } from '@/components/shared/variable-bodies/protected-value-field'
import { cn } from '@/lib/utils'

export interface StoredPasswordFieldProps {
  /** The row's label points here, whichever control is showing. */
  id?: string
  'aria-describedby'?: string
  /** Names the password input. */
  'aria-label'?: string
  /** The row's label; it leads the masked field's accessible name. */
  fieldName?: string
  /** Set by the row while it shows a problem: the password input draws its error border. */
  'aria-invalid'?: boolean
  /** A password is saved. */
  stored: boolean
  /** The staged password; undefined while untouched. */
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
  /** The field's width, when the page's inputs differ from the default. */
  className?: string
}

// The eye of a typed password and the lock of a stored one share this place.
const RIGHT_SLOT = 'absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2'

// As tall as the input (`!` beats the button's size class); a muted row fades it once, not twice.
const MASKED_FIELD_CLASS = '!h-10 disabled:opacity-100'

interface TypedPasswordProps {
  id?: string
  'aria-describedby'?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

function TypedPassword({
  'aria-invalid': invalid,
  value,
  onChange,
  disabled,
  ...input
}: Readonly<TypedPasswordProps>) {
  const [revealed, setRevealed] = useState(false)
  const typed = value !== ''
  // Save and Cancel empty the field without a keystroke; the next password starts hidden.
  if (!typed && revealed) setRevealed(false)
  const showEye = typed && !disabled

  return (
    <>
      <Input
        {...input}
        name="password"
        aria-invalid={invalid}
        type={revealed ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        className={cn('w-full', showEye && 'pr-8', invalid && 'border-error')}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === '') setRevealed(false)
          onChange(event.target.value)
        }}
      />
      {showEye && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(RIGHT_SLOT, 'p-0')}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          onClick={() => setRevealed((shown) => !shown)}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      )}
    </>
  )
}

export function StoredPasswordField({
  id,
  'aria-describedby': describedBy,
  'aria-label': ariaLabel,
  'aria-invalid': invalid,
  fieldName,
  stored,
  value,
  onChange,
  disabled = false,
  className,
}: Readonly<StoredPasswordFieldProps>) {
  return (
    <div className={cn('relative w-52', className)}>
      {stored && value === undefined ? (
        <>
          <ProtectedValueField
            id={id}
            aria-describedby={describedBy}
            fieldName={fieldName}
            secretAffordance="field"
            className={MASKED_FIELD_CLASS}
            disabled={disabled}
            onCleared={() => onChange('')}
          />
          <span
            className={cn(
              RIGHT_SLOT,
              'pointer-events-none flex items-center justify-center text-muted-foreground',
            )}
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </>
      ) : (
        <TypedPassword
          id={id}
          aria-describedby={describedBy}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          value={value ?? ''}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </div>
  )
}
