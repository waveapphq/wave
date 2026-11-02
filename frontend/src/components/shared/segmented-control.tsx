/**
 * Aria-pressed tab strip: one plain button per option inside a labeled group
 * (the fieldset carries that group role natively). The caller owns the value.
 */

import { cn } from '@/lib/utils'

export interface SegmentedControlOption<V extends string = string> {
  value: V
  label: string
  testId?: string
}

/** `value` is the mono, equal-width, indigo-accented strip of the value editors. */
export type SegmentedControlVariant = 'default' | 'value'

interface SegmentedControlStyle {
  group: string
  segment: string
  pressed: string
  unpressed: string
  divider: string
}

const STYLES: Record<SegmentedControlVariant, SegmentedControlStyle> = {
  default: {
    group: 'flex items-center overflow-hidden rounded-md border text-xs font-medium',
    // The group clips what lies outside a part, so the focus outline sits inside it.
    segment: 'px-2.5 py-1 focus-visible:-outline-offset-4',
    pressed: 'bg-primary text-white focus-visible:outline-current',
    unpressed: 'text-muted enabled:hover:bg-muted enabled:hover:text-foreground',
    divider: '',
  },
  value: {
    group: 'flex overflow-hidden rounded-md border font-mono text-sm',
    segment:
      'flex-1 px-4 py-1 text-center transition-colors focus-visible:outline-none ' +
      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
    pressed: 'bg-indigo-600 text-white focus-visible:ring-current',
    unpressed: 'text-muted-foreground hover:bg-muted',
    divider: 'border-l',
  },
}

export interface SegmentedControlProps<V extends string = string> {
  options: readonly SegmentedControlOption<V>[]
  value: string
  onChange: (value: V) => void
  'aria-label': string
  /** A visible caption's id; it names the group over `aria-label`. */
  'aria-labelledby'?: string
  variant?: SegmentedControlVariant
  className?: string
  /** Disables every segment. */
  disabled?: boolean
  id?: string
  'aria-describedby'?: string
}

export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  'aria-labelledby': labeledBy,
  variant = 'default',
  className,
  disabled = false,
  id,
  'aria-describedby': describedBy,
}: Readonly<SegmentedControlProps<V>>) {
  const style = STYLES[variant]
  return (
    <fieldset
      id={id}
      aria-label={ariaLabel}
      aria-labelledby={labeledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn(style.group, 'disabled:opacity-50', className)}
    >
      {options.map((option, index) => {
        const pressed = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            className={cn(
              style.segment,
              'disabled:cursor-not-allowed',
              index > 0 && style.divider,
              pressed ? style.pressed : style.unpressed
            )}
          >
            {option.label}
          </button>
        )
      })}
    </fieldset>
  )
}
