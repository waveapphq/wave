/**
 * Multi-line description input shared by every entity that has a free-form
 * description (environment, profile, suite, regression, test). Replicates the
 * exact styling and resize/min-height behavior of the original env form
 * description so all entities look identical.
 *
 * Owns the same threshold-based char-counter contract as `TextField`:
 *   - hidden under 80% of `maxLength`
 *   - muted "X/Y" at 80-99%
 *   - destructive "X/Y" at 100%
 */

import type { ChangeEvent, KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

export interface DescriptionFieldProps {
  id?: string
  name?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  maxLength?: number
  showCount?: boolean
  /** Merged over the textarea's base classes; a given class wins a conflict. */
  className?: string
  'aria-label'?: string
  'data-testid'?: string
}

function counterState(length: number, max: number): 'hidden' | 'muted' | 'destructive' {
  if (length >= max) return 'destructive'
  if (length >= 0.8 * max) return 'muted'
  return 'hidden'
}

export function DescriptionField({
  id,
  name,
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  showCount,
  className,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: Readonly<DescriptionFieldProps>) {
  const counterEnabled = showCount ?? typeof maxLength === 'number'
  const state = maxLength == null ? 'hidden' : counterState(value.length, maxLength)
  const showCounter = counterEnabled && maxLength != null && state !== 'hidden'

  // Defensive: ancestor canvas / modal handlers can otherwise intercept Space
  // and Enter for selection-toggle or button-activation. The textarea needs
  // them as literal characters.
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
    }
  }

  return (
    <div className="w-full min-w-0">
      <textarea
        id={id}
        name={name}
        data-testid={dataTestId}
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
      {showCounter && (
        <span
          data-testid={dataTestId ? `${dataTestId}-counter` : undefined}
          data-state={state}
          aria-live="polite"
          className={cn(
            'mt-1 block text-xs',
            state === 'muted' && 'text-muted-foreground',
            state === 'destructive' && 'text-destructive',
          )}
        >
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}
