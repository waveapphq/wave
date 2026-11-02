/**
 * ScalarTypeSelect - the shared per-element type pill used by the table column
 * header, array items, and map values. A rounded badge whose color tracks the
 * type; the four scalar WAVE types only. ScalarTypePill is the same pill for a
 * type that is shown, not picked.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getTypeBadgeClass } from '@/lib/variable-format'
import type { ValueType } from '@/lib/variable-validation'

// The pill shape both the picker and the read-only pill share.
const PILL_CLASS = 'h-5 w-fit shrink-0 rounded-full px-2 text-[10px] font-semibold'

export const SCALAR_TYPES: readonly ValueType[] = ['string', 'integer', 'float', 'boolean']
/** Array item / map value types: the scalars plus a nested array / map. */
export const VALUE_TYPES: readonly ValueType[] = [...SCALAR_TYPES, 'array', 'map']

export interface ScalarTypeSelectProps {
  value: ValueType
  onChange: (type: ValueType) => void
  testId: string
  label: string
  /** The selectable type set; defaults to the four scalars (a table column). */
  options?: readonly ValueType[]
}

export function ScalarTypeSelect({
  value,
  onChange,
  testId,
  label,
  options = SCALAR_TYPES,
}: Readonly<ScalarTypeSelectProps>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ValueType)}>
      <SelectTrigger
        data-testid={testId}
        aria-label={label}
        className={cn(
          // focus:ring-0 keeps the borderless inline-pill look on click; the
          // focus-visible ring restores a keyboard-focus indicator (the base
          // SelectTrigger ring was suppressed by focus:ring-0).
          PILL_CLASS,
          'gap-1 border-0 shadow-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3',
          getTypeBadgeClass(value),
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((type) => (
          <SelectItem key={type} value={type} className="text-xs">
            {type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A fixed type in the pill look, with no chevron and no picker. */
export function ScalarTypePill({ value, testId }: Readonly<{ value: ValueType; testId?: string }>) {
  return (
    <span data-testid={testId} className={cn(PILL_CLASS, 'inline-flex items-center whitespace-nowrap', getTypeBadgeClass(value))}>
      {value}
    </span>
  )
}
