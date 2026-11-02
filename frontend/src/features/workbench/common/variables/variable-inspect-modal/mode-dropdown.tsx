/**
 * Mode Dropdown - the one value pill of the watcher footer and the variable window's Value line.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'

import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type InspectMode = 'initial' | 'current' | 'compare'

const ALL_MODES: readonly InspectMode[] = ['initial', 'current', 'compare']

const LABELS: Record<InspectMode, string> = {
  initial: 'Initial',
  current: 'Current',
  compare: 'Compare',
}

const PILL_STYLES: Record<InspectMode, string> = {
  initial:
    'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300',
  current:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300',
  compare:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-500/40 dark:bg-slate-500/15 dark:text-slate-300',
}

export type ModeDropdownSize = 'footer' | 'label'

interface SizeLook {
  trigger: string
  chevron: string
  side: 'top' | 'bottom'
  testId: string
}

const SIZE_LOOKS: Record<ModeDropdownSize, SizeLook> = {
  footer: { trigger: 'h-7 px-2.5', chevron: 'h-3.5 w-3.5', side: 'top', testId: 'mode-dropdown' },
  label: { trigger: 'h-[22px] px-2', chevron: 'h-3 w-3', side: 'bottom', testId: 'value-switch' },
}

export interface ModeDropdownProps {
  value: InspectMode
  onValueChange: (value: InspectMode) => void
  /** The modes offered, in order (default: all three). */
  options?: readonly InspectMode[]
  /** Per-mode label overrides (an input reads Default for its initial value). */
  labels?: Partial<Record<InspectMode, string>>
  /** Footer pill (watcher) or the smaller pill on a field label line (window). */
  size?: ModeDropdownSize
  ariaLabel?: string
}

export function ModeDropdown({
  value,
  onValueChange,
  options = ALL_MODES,
  labels,
  size = 'footer',
  ariaLabel = 'Inspect mode',
}: Readonly<ModeDropdownProps>) {
  const look = SIZE_LOOKS[size]
  const labelOf = (mode: InspectMode) => labels?.[mode] ?? LABELS[mode]
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as InspectMode)}>
      <SelectPrimitive.Trigger
        className={cn(
          'inline-flex items-center gap-1 rounded-full border text-xs font-semibold',
          'ring-offset-background focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          look.trigger,
          PILL_STYLES[value]
        )}
        aria-label={ariaLabel}
        data-testid={look.testId}
      >
        <SelectPrimitive.Value>{labelOf(value)}</SelectPrimitive.Value>
        <ChevronDown className={cn(look.chevron, 'opacity-70')} data-testid="mode-pill-chevron" aria-hidden="true" />
      </SelectPrimitive.Trigger>
      <SelectContent side={look.side}>
        {options.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {labelOf(mode)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
