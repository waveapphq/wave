/**
 * ScalarEditBody - controlled scalar edit body for the inspect modal edit
 * state. Sibling to the dumb read-only scalar-body: string -> StringEditBody
 * (a line-numbered, wrapping editor), integer/float -> numeric input, boolean
 * -> a true/false segmented control. The numeric field keeps the type value
 * color. Emits onChange(parsedValue) + onValidChange and never saves - the
 * host holds the draft and gates Save.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useState, type InputHTMLAttributes } from 'react'
import type { Extension } from '@codemirror/state'

import { cn, safeStringify } from '@/lib/utils'
import { describedByOf } from '@/components/shared/fields/field-error-context'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import { StringEditBody } from '@/components/shared/variable-bodies/string-edit-body'
import type { ResolvedFormat } from '@/lib/codemirror/format-editor'
import { getValueColorClass, HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'
import {
  acceptsNumericInput,
  floatSignificantDigits,
  integerDigitCount,
  MAX_FLOAT_INPUT_CHARS,
  MAX_FLOAT_SIG_DIGITS,
  MAX_INTEGER_DIGITS,
  PLAIN_FLOAT,
  sameNumber,
} from '@/lib/number-rule'
import { validateAndParseScalarValue } from '@/lib/variable-validation'

// Numeric counter visibility, mirroring the name counter: hidden under 80% of
// the cap, muted from 80%, destructive at the cap. Float counts significant
// digits (cap 28); integer counts digits (cap 19) (REQ-3.1.3.14).
function counterState(count: number, max: number): 'hidden' | 'muted' | 'destructive' {
  if (count >= max) return 'destructive'
  if (count >= 0.8 * max) return 'muted'
  return 'hidden'
}

type BooleanChoice = 'true' | 'false'

const NO_EMPTY_BLUR = () => {}

/** The box already shows this value: the same text, or the same exact number written another way. */
function showsNumber(text: string, value: unknown): boolean {
  const shown = safeStringify(value)
  if (text === shown) return true
  return PLAIN_FLOAT.test(text) && PLAIN_FLOAT.test(shown) && sameNumber(text, shown)
}

const NUMBER_BOX_SIZE_CLASSES = { body: 'py-2', row: 'h-8 py-1', field: 'h-9 py-1' } as const

const BOOLEAN_OPTIONS: readonly SegmentedControlOption<BooleanChoice>[] = [
  { value: 'true', label: 'true', testId: 'scalar-edit-bool-true' },
  { value: 'false', label: 'false', testId: 'scalar-edit-bool-false' },
]

export interface ScalarEditBodyProps {
  value: unknown
  type: VariableType
  onChange: (value: unknown) => void
  onValidChange: (valid: boolean) => void
  /** String branch only: syntax highlighting + advisory lint for the format. */
  format?: ResolvedFormat
  /** String branch only: host-injected extensions (e.g. the template stack). */
  extraExtensions?: Extension[]
  /** The editor's or the number box's accessible name. */
  ariaLabel?: string
  /** Numeric branch only: the id of the message that marks the value invalid. */
  errorId?: string
  /** Numeric branch only: the id of text that tells what the box shows beyond its error (a gray default, null). */
  describedBy?: string
  /** 'row' gives a number box the 32px height of a table row's other controls (FIELDERR-2); 'field' gives a number box and the true / false control the 36px of a form field (VMGR-110). */
  size?: 'body' | 'row' | 'field'
  /** Numeric branch only: the input's id, so a visible label names and focuses it. */
  id?: string
  /** Numeric branch only: the input's form name. */
  name?: string
  /** Numeric branch only: a cleared box is invalid, or nothing for a field that may be left unset (K8SPROF-6). */
  blank?: 'refuse' | 'unset'
  /** Numeric branch only: called when an emptied box loses focus (the creation window ticks Set to null, VMGR-97). */
  onEmptyBlur?: () => void
  /** Number and true / false only: shown, never changed. */
  readOnly?: boolean
  /** True / false only: the id of the caption that names the group. */
  labeledBy?: string
  /** Numeric branch only: the number box's test id (default `scalar-edit-input`). */
  inputTestId?: string
  /** Numeric branch only: the hint an empty number box shows. */
  placeholder?: string
  /** Numeric branch only: the text is a default the field does not hold, painted Text Muted (REQ-3.1.1.5). */
  muted?: boolean
  /** Numeric branch only: receives text the box keeps but the number rule refuses (`-`, `1.`). */
  onInvalidText?: (text: string) => void
  /** Numeric branch only: the host's own key, clipboard and focus handling on the box. */
  inputEvents?: NumberBoxEvents
}

export type NumberBoxEvents = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'onKeyDown' | 'onKeyUp' | 'onPaste' | 'onInput' | 'onCut' | 'onFocus' | 'onBlur'
>

export function ScalarEditBody(props: Readonly<ScalarEditBodyProps>) {
  if (props.type === 'boolean') return <BooleanEditBody {...props} />
  if (props.type === 'string') {
    const { value, onChange, onValidChange, format, extraExtensions, ariaLabel } = props
    return (
      <StringEditBody
        value={value}
        onChange={onChange}
        onValidChange={onValidChange}
        format={format}
        extraExtensions={extraExtensions}
        ariaLabel={ariaLabel}
      />
    )
  }
  return <NumberEditBody {...props} />
}

/** True / false as the two-way segmented control. */
function BooleanEditBody({
  value,
  onChange,
  onValidChange,
  size = 'body',
  readOnly = false,
  labeledBy,
}: Readonly<ScalarEditBodyProps>) {
  const pickBoolean = (choice: BooleanChoice) => {
    onChange(choice === 'true')
    onValidChange(true)
  }
  return (
    <div data-testid="scalar-edit-body">
      {/* Fixed compact width so the toggle does not stretch when the watcher
          is widened (the two halves stay even via flex-1). */}
      <SegmentedControl
        options={BOOLEAN_OPTIONS}
        value={value === true ? 'true' : 'false'}
        onChange={pickBoolean}
        aria-label="Edit value"
        aria-labelledby={labeledBy}
        variant="value"
        className={cn('w-36', size === 'field' && 'h-9')}
        disabled={readOnly}
      />
    </div>
  )
}

/** An integer or float box under the one number rule (REQ-3.1.3.14). */
function NumberEditBody({
  value,
  type,
  onChange,
  onValidChange,
  ariaLabel,
  errorId,
  describedBy,
  size = 'body',
  blank = 'refuse',
  onEmptyBlur = NO_EMPTY_BLUR,
  id,
  name,
  readOnly = false,
  inputTestId = 'scalar-edit-input',
  placeholder,
  muted = false,
  onInvalidText,
  inputEvents,
}: Readonly<ScalarEditBodyProps>) {
  const [text, setText] = useState(() => safeStringify(value))
  // A value from outside the box (a reset, a default shown again) replaces the text it does not already show.
  const [shownValue, setShownValue] = useState(value)
  if (!Object.is(shownValue, value)) {
    setShownValue(value)
    if (!showsNumber(text, value)) setText(safeStringify(value))
  }

  const numericType = type === 'integer' ? 'integer' : 'float'
  const counterMax = type === 'integer' ? MAX_INTEGER_DIGITS : MAX_FLOAT_SIG_DIGITS
  const counterCount = type === 'integer' ? integerDigitCount(text) : floatSignificantDigits(text)
  const counter = counterState(counterCount, counterMax)

  const handleChange = (next: string) => {
    // Drop the keystroke when it adds an invalid char or exceeds the cap, so an
    // invalid / over-cap value never enters (shared with the table numeric cells).
    if (!acceptsNumericInput(next, numericType)) return
    setText(next)
    // The host always sees an emptied box, so it can name the problem; it never means 0.
    if (next.trim() === '') {
      onValidChange(blank === 'unset')
      onChange('')
      return
    }
    const result = validateAndParseScalarValue(type, '', next, false)
    onValidChange(result.valid)
    if (result.valid) onChange(result.value)
    else onInvalidText?.(next)
  }

  const fieldClass = cn(
    'min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-sm',
    NUMBER_BOX_SIZE_CLASSES[size],
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
    muted && showsNumber(text, value) ? HELD_DEFAULT_LOOK_CLASS : getValueColorClass(type),
    errorId && 'border-destructive',
  )

  return (
    <div data-testid="scalar-edit-body" className="flex items-center gap-2">
      <input
        id={id}
        name={name}
        data-testid={inputTestId}
        aria-label={ariaLabel ?? (id === undefined ? 'Edit value' : undefined)}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={describedByOf(errorId, describedBy)}
        type="text"
        autoComplete="off"
        spellCheck={false}
        inputMode={type === 'integer' ? 'numeric' : 'decimal'}
        maxLength={(type === 'integer' ? MAX_INTEGER_DIGITS : MAX_FLOAT_INPUT_CHARS) + 1}
        value={text}
        placeholder={placeholder}
        readOnly={readOnly}
        {...inputEvents}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={(event) => {
          inputEvents?.onBlur?.(event)
          if (text.trim() === '') onEmptyBlur()
        }}
        className={fieldClass}
      />
      {counter !== 'hidden' && <NumberCounter count={counterCount} max={counterMax} counter={counter} />}
    </div>
  )
}

/** The digit counter beside a number box, muted near the cap and destructive at it. */
function NumberCounter({ count, max, counter }: Readonly<{ count: number; max: number; counter: 'muted' | 'destructive' }>) {
  return (
    <span
      data-testid="scalar-edit-counter"
      className={cn('shrink-0 font-mono text-[10px] tabular-nums', counter === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}
    >
      {count}/{max}
    </span>
  )
}
