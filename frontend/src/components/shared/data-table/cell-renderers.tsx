/**
 * Shared cell renderers for DataTable column definitions.
 *
 * Reusable cell rendering functions for common column types
 * across entity tables (status badges, relative time, tags).
 */

import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
} from '@/components/shared/tables/table-utils'
import { Timestamp } from '@/components/shared/timestamp/timestamp'

/** Status badge with colored dot and label; dot pulses when status is 'running'. */
export function StatusBadgeCell({
  status,
  testIdPrefix,
}: Readonly<{ status: string; testIdPrefix?: string }>) {
  const pulse = status === 'running' ? ' animate-pulse' : ''
  return (
    <span
      data-testid={testIdPrefix ? `status-badge-${status.replace('_', '-')}` : undefined}
      className={`inline-flex items-center gap-1.5 ${getStatusColor(status)}`}
    >
      <span
        data-testid="status-dot"
        className={`h-2 w-2 rounded-full ${getStatusDotColor(status)}${pulse}`}
        aria-hidden="true"
      />
      {getStatusLabel(status)}
    </span>
  )
}

/** Relative time display (e.g. "3 min ago", "yesterday"). */
export function RelativeTimeCell({
  dateString,
  'data-testid': dataTestId,
}: Readonly<{ dateString: string | null | undefined; 'data-testid'?: string }>) {
  return <Timestamp value={dateString} style="relative" data-testid={dataTestId} />
}

