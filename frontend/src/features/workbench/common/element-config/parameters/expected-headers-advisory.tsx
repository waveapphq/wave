/**
 * Expected-headers advisory (non-blocking): an amber in-field icon
 * on the Headers map value slot while body headers are off and the active body
 * mode would have generated a header that has no manual equivalent row.
 */

import { AlertTriangle } from 'lucide-react'

import { ConditionalTooltip } from '@/components/ui/tooltip'
import type { MissingHeaderAdvisory } from './parameter-table-types'

/** The advisories still unmet by the map value's manual rows (case-insensitive). */
export function unmetHeaderAdvisories(
  advisories: MissingHeaderAdvisory[] | undefined,
  mapValue: unknown,
): MissingHeaderAdvisory[] {
  if (!advisories?.length) return []
  const keys =
    mapValue !== null && typeof mapValue === 'object' && !Array.isArray(mapValue)
      ? Object.keys(mapValue as Record<string, unknown>).map((key) => key.trim().toLowerCase())
      : []
  return advisories.filter((advisory) => !keys.includes(advisory.key.toLowerCase()))
}

/** Non-interactive amber icon in the value field's right slot. */
export function ExpectedHeadersAdvisoryIcon({
  advisories,
}: Readonly<{ advisories: MissingHeaderAdvisory[] }>) {
  return (
    <ConditionalTooltip
      content={advisories.map((advisory) => advisory.message).join('; ')}
      side="bottom"
      align="end"
      wide
    >
      <span
        aria-label="Expected headers missing"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 inline-flex items-center"
      >
        <AlertTriangle className="h-[15px] w-[15px] text-amber-500" />
      </span>
    </ConditionalTooltip>
  )
}
