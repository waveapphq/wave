/**
 * JSON-body-without-Content-Type advisory (non-blocking): an amber in-field
 * icon on a body value that parses as JSON while the sibling `headers` map
 * carries no Content-Type row.
 */

import { AlertTriangle } from 'lucide-react'

import { ConditionalTooltip } from '@/components/ui/tooltip'

const TOOLTIP =
  'Body looks like JSON but no Content-Type header is set. ' +
  'Add one from "+ Content-Type" in the Headers editor.'

function isJsonContent(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/** Whether the advisory fires for a body value + the node's current values. */
export function needsContentTypeAdvisory(
  value: unknown,
  allValues: Record<string, unknown> | undefined,
): boolean {
  if (typeof value !== 'string' || !isJsonContent(value)) return false
  const headers = allValues?.headers
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) return true
  return !Object.keys(headers).some((key) => key.trim().toLowerCase() === 'content-type')
}

/** Non-interactive amber icon in the value field's right slot. */
export function ContentTypeAdvisoryIcon() {
  return (
    <ConditionalTooltip
      content={TOOLTIP}
      side="bottom"
      align="end"
      wide
    >
      <span
        aria-label="Missing Content-Type"
        className="absolute right-2 top-1/2 -translate-y-1/2 z-10 inline-flex items-center"
      >
        <AlertTriangle className="h-[15px] w-[15px] text-amber-500" />
      </span>
    </ConditionalTooltip>
  )
}
