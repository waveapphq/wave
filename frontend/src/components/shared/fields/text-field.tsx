/**
 * Single-line text-input primitive used across the frontend.
 *
 * Owns the visual / overflow contract:
 *   - `w-full` + `min-w-0` so it cooperates with flex parents
 *   - Visible horizontal scrollbar when content overflows (matches inline
 *     expression field UX). Implemented via `<textarea rows={1}>` because
 *     native `<input>` elements do not honor `overflow-x` styles.
 *   - optional `maxLength` with a threshold-based char counter
 */

import { cn } from '@/lib/utils'
import type { ChangeEvent, HTMLAttributes, KeyboardEvent, MouseEvent } from 'react'

export interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  onFocus?: () => void
  /** Caller-provided keydown handler. Runs BEFORE the internal Enter-blocker;
   *  if the caller calls `e.preventDefault()` the internal Enter behavior is
   *  skipped. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onClick?: (e: MouseEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  /** The on-screen keyboard to show, such as `numeric` for a number. */
  inputMode?: HTMLAttributes<HTMLTextAreaElement>['inputMode']
  maxLength?: number
  showCount?: boolean
  'aria-invalid'?: boolean
  'aria-expanded'?: boolean
  'aria-autocomplete'?: 'list' | 'none' | 'inline' | 'both'
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-required'?: boolean
  role?: string
  disabled?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
  'data-testid'?: string
  id?: string
  name?: string
  ref?: React.Ref<HTMLTextAreaElement>
}

/** Counter visibility: hidden < 80%, muted 80-99%, destructive 100%. */
function counterState(length: number, max: number): 'hidden' | 'muted' | 'destructive' {
  if (length >= max) return 'destructive'
  if (length >= 0.8 * max) return 'muted'
  return 'hidden'
}

export function TextField({
  value,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  onClick,
  placeholder,
  inputMode,
  maxLength,
  showCount,
  disabled,
  readOnly,
  autoFocus,
  className,
  id,
  name,
  ref,
  role,
  'aria-invalid': ariaInvalid,
  'aria-expanded': ariaExpanded,
  'aria-autocomplete': ariaAutocomplete,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  'aria-required': ariaRequired,
  'data-testid': dataTestId,
}: Readonly<TextFieldProps>) {
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    // Strip newlines so paste-with-newlines behaves single-line.
    const clean = e.target.value.replaceAll(/\r?\n/g, '')
    onChange(clean)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  const counterEnabled = showCount ?? typeof maxLength === 'number'
  const state = maxLength == null ? 'hidden' : counterState(value.length, maxLength)
  const showCounter = counterEnabled && maxLength != null && state !== 'hidden'

  return (
    <div className="w-full min-w-0">
      <textarea
        ref={ref}
        id={id}
        name={name}
        rows={1}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={onClick}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        role={role}
        aria-invalid={ariaInvalid ? 'true' : undefined}
        aria-expanded={ariaExpanded}
        aria-autocomplete={ariaAutocomplete}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-required={ariaRequired ? 'true' : undefined}
        data-testid={dataTestId}
        className={cn(
          'block h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm leading-6',
          'shadow-sm transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Single-line + visible horizontal scrollbar on overflow.
          'whitespace-pre overflow-x-auto overflow-y-hidden resize-none align-middle',
          ariaInvalid && 'border-destructive',
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
