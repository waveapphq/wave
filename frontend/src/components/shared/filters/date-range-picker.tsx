import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import type { DateRange, DayButtonProps } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Icon, ChevronDownIcon, ChevronLeftIcon } from '@/components/ui/icon'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DateRangePreset, DateRangeValue } from '@/lib/date-range'

export interface DateRangePickerProps {
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  disabled?: boolean
  testId?: string
}

const ALL_TIME_VALUE = 'all-time'
const CUSTOM_VALUE = 'custom'

const PRESET_OPTIONS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last-7', label: 'Last 7 days' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'last-90', label: 'Last 90 days' },
]

const DEFAULT_FROM_TIME = '00:00'
const DEFAULT_TO_TIME = '23:59'

function getPresetLabel(preset: DateRangePreset): string {
  const found = PRESET_OPTIONS.find((o) => o.value === preset)
  /* v8 ignore next - COV-UNREACH-019 */
  return found ? found.label : 'Date'
}

function isDefaultFromTime(date: Date): boolean {
  return date.getHours() === 0 && date.getMinutes() === 0
}

function isDefaultToTime(date: Date): boolean {
  return date.getHours() === 23 && date.getMinutes() === 59
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatRangeLabel(fromISO: string, toISO: string): string {
  const from = new Date(fromISO)
  const to = new Date(toISO)
  const currentYear = new Date().getFullYear()
  const sameCurrentYear =
    from.getFullYear() === to.getFullYear() &&
    from.getFullYear() === currentYear
  const dateFmt = sameCurrentYear ? 'MMM d' : 'MMM d, yyyy'
  const showTime = !isDefaultFromTime(from) || !isDefaultToTime(to)
  if (!showTime) {
    return `${format(from, dateFmt)} - ${format(to, dateFmt)}`
  }
  if (isSameDay(from, to)) {
    return `${format(from, dateFmt)}, ${format(from, 'HH:mm')} - ${format(to, 'HH:mm')}`
  }
  return `${format(from, dateFmt)} ${format(from, 'HH:mm')} - ${format(to, dateFmt)} ${format(to, 'HH:mm')}`
}

function getTriggerLabel(value: DateRangeValue): string {
  if (value.kind === 'all-time') return 'Date'
  if (value.kind === 'preset') return getPresetLabel(value.preset)
  return formatRangeLabel(value.from, value.to)
}

function combineDateAndTime(
  date: Date,
  time: string,
  boundary: 'start' | 'end',
): string {
  const [hhStr, mmStr] = time.split(':')
  const hh = Number.parseInt(hhStr, 10)
  const mm = Number.parseInt(mmStr, 10)
  const d = new Date(date)
  if (boundary === 'start') d.setHours(hh, mm, 0, 0)
  else d.setHours(hh, mm, 59, 999)
  return d.toISOString()
}

function deriveRadioValue(
  view: 'presets' | 'custom',
  value: DateRangeValue,
): string {
  if (view === 'custom') return CUSTOM_VALUE
  if (value.kind === 'all-time') return ALL_TIME_VALUE
  if (value.kind === 'preset') return value.preset
  return CUSTOM_VALUE
}

function initialCustomState(value: DateRangeValue): {
  range: DateRange | undefined
  fromTime: string
  toTime: string
} {
  if (value.kind === 'custom') {
    const from = new Date(value.from)
    const to = new Date(value.to)
    return {
      range: { from, to },
      fromTime: format(from, 'HH:mm'),
      toTime: format(to, 'HH:mm'),
    }
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return {
    range: { from: today, to: today },
    fromTime: DEFAULT_FROM_TIME,
    toTime: DEFAULT_TO_TIME,
  }
}

export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  testId = 'filter-date',
}: Readonly<DateRangePickerProps>) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'presets' | 'custom'>('presets')

  const initial = initialCustomState(value)
  const [range, setRange] = useState<DateRange | undefined>(initial.range)
  const [fromTime, setFromTime] = useState<string>(initial.fromTime)
  const [toTime, setToTime] = useState<string>(initial.toTime)

  useEffect(() => {
    if (open) {
      // Land directly on the calendar when the active value is already
      // a custom range so users can edit it without an extra hop through
      // the preset list. Otherwise start on the preset list.
      setView(value.kind === 'custom' ? 'custom' : 'presets')
    } else {
      const next = initialCustomState(value)
      setRange(next.range)
      setFromTime(next.fromTime)
      setToTime(next.toTime)
    }
  }, [open, value])

  const radioValue = deriveRadioValue(view, value)

  const handleRadioChange = (next: string) => {
    if (next === CUSTOM_VALUE) {
      setView('custom')
      return
    }
    if (next === ALL_TIME_VALUE) {
      onChange({ kind: 'all-time' })
      setOpen(false)
      return
    }
    onChange({ kind: 'preset', preset: next as DateRangePreset })
    setOpen(false)
  }

  const handleCancel = () => {
    setView('presets')
    const next = initialCustomState(value)
    setRange(next.range)
    setFromTime(next.fromTime)
    setToTime(next.toTime)
  }

  const setRangeRef = useRef(setRange)
  setRangeRef.current = setRange

  const dayButtonComponent = useMemo(() => {
    return function DayButtonWithReset({
      day,
      modifiers: _modifiers,
      ...buttonProps
    }: DayButtonProps) {
      return (
        <button
          {...buttonProps}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            setRangeRef.current({ from: day.date, to: undefined })
          }}
        />
      )
    }
  }, [])

  /* v8 ignore next 2 - COV-BRANCH-201 */
  const customFrom =
    range?.from ? combineDateAndTime(range.from, fromTime, 'start') : null
  /* v8 ignore next 2 - COV-BRANCH-201 */
  const customTo =
    range?.to ? combineDateAndTime(range.to, toTime, 'end') : null
  const endBeforeStart =
    customFrom !== null &&
    customTo !== null &&
    new Date(customFrom).getTime() >= new Date(customTo).getTime()

  const handleApply = () => {
    /* v8 ignore next - COV-BRANCH-202 */
    if (!customFrom || !customTo || endBeforeStart) return
    onChange({ kind: 'custom', from: customFrom, to: customTo })
    setOpen(false)
  }

  const applyDisabled = !range?.from || !range?.to || endBeforeStart
  const triggerLabel = getTriggerLabel(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          aria-disabled={disabled}
          disabled={disabled}
          className="flex h-9 min-w-[120px] max-w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{triggerLabel}</span>
          <Icon icon={ChevronDownIcon} size="sm" className="opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        role="dialog"
      >
        {view === 'presets' ? (
          <div className="p-3">
            <RadioGroup
              value={radioValue}
              onValueChange={handleRadioChange}
              className="gap-1"
            >
              <PresetRow id="dr-all-time" value={ALL_TIME_VALUE} label="All time" />
              {PRESET_OPTIONS.map((opt) => (
                <PresetRow
                  key={opt.value}
                  id={`dr-${opt.value}`}
                  value={opt.value}
                  label={opt.label}
                />
              ))}
              <div className="my-1 border-t border-border" />
              <PresetRow id="dr-custom" value={CUSTOM_VALUE} label="Custom range" />
            </RadioGroup>
          </div>
        ) : (
          <div className="flex flex-col">
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              numberOfMonths={1}
              defaultMonth={range?.from}
              components={{ DayButton: dayButtonComponent }}
            />
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              Tip: double-click a day to reset the start date.
            </p>
            <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
              <TimeField
                id="dr-time-from"
                label="From"
                value={fromTime}
                disabled={!range?.from}
                onChange={setFromTime}
              />
              <TimeField
                id="dr-time-to"
                label="To"
                value={toTime}
                disabled={!range?.to}
                onChange={setToTime}
              />
              {endBeforeStart && (
                <p
                  role="alert"
                  className="text-xs text-destructive"
                >
                  End must be after start.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('presets')}
                leftIcon={<Icon icon={ChevronLeftIcon} size="sm" />}
              >
                Presets
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApply}
                  disabled={applyDisabled}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface PresetRowProps {
  id: string
  value: string
  label: string
}

function PresetRow({ id, value, label }: Readonly<PresetRowProps>) {
  return (
    <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground focus-within:bg-accent focus-within:text-accent-foreground">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id} className="flex-1 cursor-pointer">
        {label}
      </Label>
    </div>
  )
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0'),
)
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, '0'),
)

interface TimeFieldProps {
  id: string
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

function TimeField({ id, label, value, disabled, onChange }: Readonly<TimeFieldProps>) {
  const [hh, mm] = value.split(':')
  /* v8 ignore next 2 - COV-DEF-109 */
  const hours = hh ?? '00'
  const minutes = mm ?? '00'

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Select
          value={hours}
          disabled={disabled}
          onValueChange={(next) => onChange(`${next}:${minutes}`)}
        >
          <SelectTrigger
            id={id}
            aria-label={`${label} hour`}
            className="h-8 w-[72px] px-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {HOUR_OPTIONS.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          :
        </span>
        <Select
          value={minutes}
          disabled={disabled}
          onValueChange={(next) => onChange(`${hours}:${next}`)}
        >
          <SelectTrigger
            aria-label={`${label} minute`}
            className="h-8 w-[72px] px-2"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-48">
            {MINUTE_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
