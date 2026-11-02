/**
 * Utility functions for backup-restore-tab components.
 */

/**
 * Format a UTC ISO timestamp to local time with timezone abbreviation.
 * E.g. "2026-03-08T02:00:00Z" -> "2026-03-08 02:00 PST"
 */
export function formatLocalTime(utcIso: string): string {
  const date = new Date(utcIso)
  const localStr = date.toLocaleString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  // Extract timezone abbreviation (e.g. PST, EST, CET)
  const tzAbbr =
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value || 'Local'
  return `${localStr} ${tzAbbr}`
}

export function formatUtcTime(utcIso: string): string {
  return utcIso.replace('T', ' ').replace(/:\d{2}Z$/, ' UTC').replace('Z', ' UTC')
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
