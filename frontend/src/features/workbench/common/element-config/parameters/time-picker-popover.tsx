/**
 * TimePickerPopover - the From / To popover: Absolute, Relative or Now, edited as a draft that Save writes and
 * Cancel, Escape or a click outside discard (OS-4, FIELD-9, REQ-3.3.2.3). Every time is UTC.
 */

import { useId, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SegmentedControl, type SegmentedControlOption } from '@/components/shared/segmented-control'
import { safeStringify } from '@/lib/utils'
import { acceptsNumericInput } from '@/lib/number-rule'
import {
  buildAbsoluteValue,
  buildRelativeValue,
  describeTimeValue,
  parseTimeValue,
  resolveTimeValue,
  type RelativeControls,
  type TimeTab,
  type TimeUnit,
} from '@/features/workbench/lib/opensearch/time-values'

type Direction = RelativeControls['direction']

interface RelativeDraft {
  amount: string
  unit: TimeUnit
  direction: Direction
  round: boolean
}

interface UtcParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const TAB_OPTIONS: readonly SegmentedControlOption<TimeTab>[] = [
  { value: 'absolute', label: 'Absolute' },
  { value: 'relative', label: 'Relative' },
  { value: 'now', label: 'Now' },
]

const FIFTEEN_MINUTES_AGO: RelativeControls = { amount: 15, unit: 'm', direction: 'ago', round: false }

const UNIT_WORDS: Record<TimeUnit, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
}

const UNIT_OPTIONS = (['ago', 'from-now'] as const).flatMap((direction) =>
  (Object.keys(UNIT_WORDS) as TimeUnit[]).map((unit) => ({
    key: `${direction}:${unit}`,
    label: `${UNIT_WORDS[unit]}s ${direction === 'ago' ? 'ago' : 'from now'}`,
  })),
)

// Up to 15 digits stays an exact whole number (no exponent form)
const WHOLE_NUMBER = /^\d{1,15}$/
const WHOLE_COUNT = { negative: false } as const

const twoDigits = (count: number): string[] =>
  Array.from({ length: count }, (_, n) => String(n).padStart(2, '0'))
const HOURS = twoDigits(24)
const MINUTES = twoDigits(60)

const NOT_A_TIMESTAMP = 'Not a timestamp: use 2026-09-25T10:42:05Z'
const RESULT_LINE_CLASS = 'border-t bg-muted/50 px-3 py-2 font-mono text-xs'

/** What the draft starts on: the value, or the row default while the value is blank. */
function startingTime(value: unknown, defaultValue: string): unknown {
  return parseTimeValue(value).kind === 'blank' ? defaultValue : value
}

function absoluteInstant(value: unknown, at: Date): Date {
  return resolveTimeValue(value, at) ?? at
}

function relativeControlsOf(value: unknown): RelativeControls {
  const parsed = parseTimeValue(value)
  return parsed.kind === 'relative' ? parsed : FIFTEEN_MINUTES_AGO
}

// Other date math keeps its text on the result line and starts the controls cleared
function relativeDraftOf(value: unknown): RelativeDraft {
  const { amount, unit, direction, round } = relativeControlsOf(value)
  const cleared = parseTimeValue(value).kind === 'date-math'
  return { amount: cleared ? '' : String(amount), unit, direction, round }
}

function controlsOf({ amount, unit, direction, round }: RelativeDraft): RelativeControls | null {
  return WHOLE_NUMBER.test(amount) ? { amount: Number(amount), unit, direction, round } : null
}

/** What a switch to each tab puts in the draft. */
const TAB_VALUES: Record<TimeTab, (value: unknown, at: Date) => string> = {
  absolute: (value, at) => buildAbsoluteValue(absoluteInstant(value, at)),
  relative: (value) => buildRelativeValue(relativeControlsOf(value)),
  now: () => 'now',
}

function utcPartsOf(date: Date): UtcParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  }
}

function instantOf({ year, month, day, hour, minute, second }: UtcParts): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second))
}

// The calendar works in local days, so the UTC day shows as the same local date
function localDayOf({ year, month, day }: UtcParts): Date {
  return new Date(year, month, day)
}

function RelativePanel({ value, onChange }: Readonly<{ value: unknown; onChange: (value: string) => void }>) {
  const [draft, setDraft] = useState(() => relativeDraftOf(value))
  const roundId = useId()
  const controls = controlsOf(draft)

  const update = (patch: Partial<RelativeDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    const nextControls = controlsOf(next)
    if (nextControls !== null) onChange(buildRelativeValue(nextControls))
  }

  return (
    <>
      <div className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Amount"
            inputMode="numeric"
            autoComplete="off"
            value={draft.amount}
            onChange={(event) => {
              if (acceptsNumericInput(event.target.value, 'integer', WHOLE_COUNT)) update({ amount: event.target.value })
            }}
            wrapperClassName="w-[72px] shrink-0"
            className="!h-9"
          />
          <Select
            value={`${draft.direction}:${draft.unit}`}
            onValueChange={(key) => {
              const [direction, unit] = key.split(':') as [Direction, TimeUnit]
              update({ direction, unit })
            }}
          >
            <SelectTrigger aria-label="Unit" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={roundId}
            checked={draft.round}
            onCheckedChange={(checked) => update({ round: checked === true })}
          />
          <Label htmlFor={roundId} className="cursor-pointer font-normal">
            {`Round to the ${UNIT_WORDS[draft.unit]}`}
          </Label>
        </div>
      </div>
      <p aria-live="polite" className={RESULT_LINE_CLASS}>
        {controls === null ? safeStringify(value) : buildRelativeValue(controls)}
      </p>
    </>
  )
}

// Drawn as the Select trigger beside it (height, border, radius, chevron), without the browser arrow.
const TIME_PART_CLASS =
  'h-9 w-[72px] appearance-none rounded-md border border-input bg-transparent py-2 pl-3 pr-8 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-popover [&>option]:text-popover-foreground'

// Native: a Radix Select re-rendered by a typed value schedules its item updates after the change
function TimePartSelect({
  label,
  options,
  value,
  onChange,
}: Readonly<{ label: string; options: readonly string[]; value: number; onChange: (value: number) => void }>) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={options[value]}
        onChange={(event) => onChange(Number(event.target.value))}
        className={TIME_PART_CLASS}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"
      />
    </div>
  )
}

/** The ISO text box: applies on Enter or blur when the typed text is a timestamp. */
function AbsoluteTextBox({ iso, onApply }: Readonly<{ iso: string; onApply: (instant: Date) => void }>) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const messageId = useId()

  const apply = (text: string) => {
    const parsed = parseTimeValue(text)
    if (parsed.kind !== 'absolute') {
      setInvalid(true)
      return
    }
    setDraft(null)
    setInvalid(false)
    onApply(new Date(parsed.epochMs))
  }
  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    apply(event.currentTarget.value)
  }

  return (
    <div className="space-y-1">
      <Input
        aria-label="Date and time"
        autoComplete="off"
        spellCheck={false}
        value={draft ?? iso}
        onChange={(event) => setDraft(event.target.value)}
        // Only typed text applies; an untouched box writes nothing
        onKeyDown={draft === null ? undefined : applyOnEnter}
        onBlur={draft === null ? undefined : (event) => apply(event.currentTarget.value)}
        aria-invalid={invalid}
        aria-describedby={invalid ? messageId : undefined}
        className="!h-9 font-mono"
      />
      {invalid && (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {NOT_A_TIMESTAMP}
        </p>
      )}
    </div>
  )
}

function AbsolutePanel({
  value,
  openedAt,
  onChange,
}: Readonly<{ value: unknown; openedAt: Date; onChange: (value: string) => void }>) {
  const parts = utcPartsOf(absoluteInstant(value, openedAt))
  const selectedDay = localDayOf(parts)
  const [month, setMonth] = useState(selectedDay)

  const write = (patch: Partial<UtcParts>) => onChange(buildAbsoluteValue(instantOf({ ...parts, ...patch })))
  const applyTyped = (instant: Date) => {
    setMonth(localDayOf(utcPartsOf(instant)))
    onChange(buildAbsoluteValue(instant))
  }

  return (
    <>
      <Calendar
        mode="single"
        required
        selected={selectedDay}
        onSelect={(day) => write({ year: day.getFullYear(), month: day.getMonth(), day: day.getDate() })}
        month={month}
        onMonthChange={setMonth}
      />
      <div className="space-y-2 border-t p-3">
        <p className="text-xs text-muted-foreground">Time</p>
        <div className="flex items-center gap-1.5">
          <TimePartSelect label="Hour" options={HOURS} value={parts.hour} onChange={(hour) => write({ hour })} />
          <span aria-hidden="true" className="text-muted-foreground">
            :
          </span>
          <TimePartSelect
            label="Minute"
            options={MINUTES}
            value={parts.minute}
            onChange={(minute) => write({ minute })}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            :
          </span>
          <TimePartSelect
            label="Second"
            options={MINUTES}
            value={parts.second}
            onChange={(second) => write({ second })}
          />
        </div>
        <AbsoluteTextBox iso={buildAbsoluteValue(instantOf(parts))} onApply={applyTyped} />
      </div>
    </>
  )
}

interface TimePickerBodyProps {
  label: string
  value: unknown
  /** The row default a blank value stands for. */
  defaultValue: string
  now: () => Date
  /** Shown only: the controls are off and there is no Save. */
  readOnly: boolean
  onSave: (value: string) => void
  onCancel: () => void
}

/** Mounted on each open, so the draft, the tab and the clock are read afresh; opening writes nothing. */
function TimePickerBody({ label, value, defaultValue, now, readOnly, onSave, onCancel }: Readonly<TimePickerBodyProps>) {
  const [openedAt] = useState(now)
  const [draft, setDraft] = useState(() => startingTime(value, defaultValue))
  const [tab, setTab] = useState(() => describeTimeValue(value, { label, defaultValue }).tab)

  const switchTab = (next: TimeTab) => {
    if (next === tab) return
    setTab(next)
    setDraft(TAB_VALUES[next](draft, openedAt))
  }

  return (
    <>
      <fieldset disabled={readOnly} className="contents">
        <div className="border-b p-3">
          <SegmentedControl
            options={TAB_OPTIONS}
            value={tab}
            onChange={switchTab}
            aria-label={`${label} mode`}
            className="w-fit"
          />
        </div>
        {tab === 'absolute' && <AbsolutePanel value={draft} openedAt={openedAt} onChange={setDraft} />}
        {tab === 'relative' && <RelativePanel value={draft} onChange={setDraft} />}
        {tab === 'now' && <p className="px-3 py-2 font-mono text-xs text-muted-foreground">now</p>}
      </fieldset>
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="secondary" size="sm" data-testid="time-picker-cancel" onClick={onCancel}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly && (
          <Button variant="primary" size="sm" data-testid="time-picker-save" onClick={() => onSave(safeStringify(draft))}>
            Save
          </Button>
        )}
      </div>
    </>
  )
}

export interface TimePickerPopoverProps extends Omit<TimePickerBodyProps, 'readOnly'> {
  /** Shown only: the controls are off and there is no Save. */
  readOnly?: boolean
  open: boolean
  /** Escape and a click outside close it here, discarding the draft. */
  onOpenChange: (open: boolean) => void
  /** The element it opens from, which gets the focus back when it closes. */
  children: ReactNode
}

/** What a wrapper around the opener, such as its tooltip, hands down: it reaches the opener through the trigger. */
type TriggerPassThrough = Omit<ComponentPropsWithRef<typeof PopoverTrigger>, 'asChild' | 'children' | keyof TimePickerPopoverProps>

export function TimePickerPopover({
  label,
  value,
  defaultValue,
  now,
  readOnly = false,
  open,
  onOpenChange,
  onSave,
  onCancel,
  children,
  ...trigger
}: Readonly<TimePickerPopoverProps & TriggerPassThrough>) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild {...trigger}>
        {children}
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        aria-label={label}
        // Opened from the expand button: it ends under that button, inside the window (FIELD-9).
        align="end"
        className="w-72 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
        }}
      >
        <TimePickerBody
          label={label}
          value={value}
          defaultValue={defaultValue}
          now={now}
          readOnly={readOnly}
          onSave={onSave}
          onCancel={onCancel}
        />
      </PopoverContent>
    </Popover>
  )
}
