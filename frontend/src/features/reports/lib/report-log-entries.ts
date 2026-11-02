/**
 * Adapter from report JSON log records to the shared console LogEntry shape.
 */

import type { LogEntry } from '@/types/console'
import type { LogLevel } from '@/lib/log-levels'
import type { ReportLogRecord } from '@/features/reports/api/types'

const LOG_LEVELS: ReadonlySet<string> = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])

function normalizeLevel(raw: string | undefined): LogLevel {
  const upper = (raw ?? 'INFO').toUpperCase()
  return LOG_LEVELS.has(upper) ? (upper as LogLevel) : 'INFO'
}

/** Map raw report log records to LogEntry rows with index-based sequences. */
export function buildReportLogEntries(records: readonly ReportLogRecord[]): LogEntry[] {
  return records.map((record, index) => ({
    id: record.id ?? `report-${index}`,
    timestamp: record.timestamp ?? '',
    level: normalizeLevel(record.level),
    message: record.message ?? '',
    source: record.source ?? '',
    blockId: record.blockId ?? undefined,
    sequence: index,
    variant: record.variant,
  }))
}
