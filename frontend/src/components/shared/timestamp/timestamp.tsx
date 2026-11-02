/**
 * Centralized timestamp display component.
 *
 * Reads the per-browser Time Zone preference from useTimezoneStore (selector)
 * and delegates string formatting to lib/timestamp-format. When the preference
 * flips, every Timestamp on screen re-renders in the same frame.
 */

import { formatTimestamp, type TimestampStyle } from '@/lib/timestamp-format'
import { useTimezoneStore } from '@/stores/timezone-store'

interface TimestampProps {
  value: string | null | undefined
  style: TimestampStyle
  'data-testid'?: string
  className?: string
}

export function Timestamp({
  value,
  style,
  'data-testid': dataTestId,
  className,
}: Readonly<TimestampProps>) {
  const mode = useTimezoneStore((s) => s.mode)
  const formatted = formatTimestamp(value, style, mode)
  return (
    <span data-testid={dataTestId} className={className}>
      {formatted}
    </span>
  )
}
