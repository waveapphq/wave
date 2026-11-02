/**
 * Centralized timestamp formatter.
 *
 * Backend stores and returns UTC ISO-8601 only; this module is the single point
 * where ISO strings become user-facing text. Every UI surface that renders a
 * timestamp routes through here (directly or via the <Timestamp> component) so
 * that toggling the per-browser Time Zone preference flips every visible
 * timestamp in one frame.
 *
 * Display styles match the four uses identified across the app: console lines
 * (`time`), info panels and compact cells (`datetime`), audit fields and
 * About > Build Date (`date`), and list relative-time cells (`relative`). Each
 * style emits a trailing zone token so the active mode is unambiguous - the
 * browser's IANA short name in local mode (e.g. PDT, PST, CET) and the literal
 * `UTC` in UTC mode. The one exception is `picker`, the OpenSearch time picker
 * wording, which is always UTC and carries no zone token.
 */

export type TimezoneMode = 'local' | 'utc'
export type TimestampStyle = 'time' | 'datetime' | 'date' | 'relative' | 'full' | 'picker'

const ONE_MINUTE_MS = 60_000
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS
const ONE_DAY_MS = 24 * ONE_HOUR_MS
const RELATIVE_FALLBACK_DAYS = 7

function localTimeZoneOption(mode: TimezoneMode): { timeZone?: string } {
  return mode === 'utc' ? { timeZone: 'UTC' } : {}
}

function zoneSuffix(date: Date, mode: TimezoneMode): string {
  if (mode === 'utc') {
    return 'UTC'
  }
  // Intl.DateTimeFormat with `timeZoneName: 'short'` always emits a
  // timeZoneName part - the spec requires it - so destructure assumes it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short',
  }).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')!.value
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function formatTime(date: Date, mode: TimezoneMode): string {
  const [hours, minutes, seconds, ms] =
    mode === 'utc'
      ? [
          date.getUTCHours(),
          date.getUTCMinutes(),
          date.getUTCSeconds(),
          date.getUTCMilliseconds(),
        ]
      : [date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms, 3)} ${zoneSuffix(date, mode)}`
}

function formatFull(date: Date, mode: TimezoneMode): string {
  // YYYY-MM-DD HH:MM:SS (report document style)
  const [year, month, day, hours, minutes, seconds] =
    mode === 'utc'
      ? [
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          date.getUTCSeconds(),
        ]
      : [
          date.getFullYear(),
          date.getMonth() + 1,
          date.getDate(),
          date.getHours(),
          date.getMinutes(),
          date.getSeconds(),
        ]
  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)} ${zoneSuffix(date, mode)}`
}

function formatDateTime(date: Date, mode: TimezoneMode): string {
  // MMM d, HH:MM
  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...localTimeZoneOption(mode),
  }).format(date)
  const [hours, minutes] =
    mode === 'utc'
      ? [date.getUTCHours(), date.getUTCMinutes()]
      : [date.getHours(), date.getMinutes()]
  return `${datePart}, ${pad(hours)}:${pad(minutes)} ${zoneSuffix(date, mode)}`
}

function formatDate(date: Date, mode: TimezoneMode): string {
  // MMM d, YYYY
  const text = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...localTimeZoneOption(mode),
  }).format(date)
  return `${text} ${zoneSuffix(date, mode)}`
}

// MMM d, YYYY @ HH:MM:SS[.mmm], always UTC with no zone token: every block time is UTC
function formatPicker(date: Date): string {
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
  const ms = date.getUTCMilliseconds()
  const fraction = ms === 0 ? '' : `.${pad(ms, 3)}`
  return `${day} @ ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${fraction}`
}

function formatRelative(
  date: Date,
  mode: TimezoneMode,
  now: Date
): string {
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  if (diffSecs < 60) return 'just now'

  const diffMins = Math.floor(diffMs / ONE_MINUTE_MS)
  if (diffMins < 60) return `${diffMins} min ago`

  const diffHours = Math.floor(diffMs / ONE_HOUR_MS)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`

  const diffDays = Math.floor(diffMs / ONE_DAY_MS)
  if (diffDays === 1) return 'yesterday'
  if (diffDays < RELATIVE_FALLBACK_DAYS) return `${diffDays} days ago`

  return formatDate(date, mode)
}

/**
 * Format a UTC ISO-8601 timestamp for display in the active mode and style.
 *
 * Returns `'-'` for null/undefined under any non-relative style and `'Never'`
 * under the relative style (matching the prior `formatRelativeTime` contract).
 * Returns the original input verbatim when the string cannot be parsed as a
 * Date - giving the user something to look at and the implementer a clear
 * signal that the upstream payload is malformed.
 *
 * The optional `now` parameter exists so relative-time tests can pin "now" to
 * an absolute instant; production callers omit it.
 */
/**
 * Calendar date for a published/release timestamp: `MMM d, YYYY` in UTC with no
 * zone token (e.g. "Jun 3, 2026"). For surfaces that show a release date rather
 * than a precise instant. Returns '' for null/empty/unparsable input.
 */
export function formatPublishedDate(iso: string | null | undefined): string {
  if (iso == null || iso === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Compact HH:MM:SS clock (no zone token) from a UTC ISO string, in the active
 * mode. The wireframe "Connected {clock}" style used by the session rosters.
 */
export function formatClock(iso: string, mode: TimezoneMode): string {
  return formatTimestamp(iso, 'time', mode).split('.')[0]
}

export function formatTimestamp(
  iso: string | null | undefined,
  style: TimestampStyle,
  mode: TimezoneMode,
  now: Date = new Date()
): string {
  if (iso == null || iso === '') {
    return style === 'relative' ? 'Never' : '-'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  switch (style) {
    case 'time':
      return formatTime(date, mode)
    case 'datetime':
      return formatDateTime(date, mode)
    case 'full':
      return formatFull(date, mode)
    case 'date':
      return formatDate(date, mode)
    case 'relative':
      return formatRelative(date, mode, now)
    case 'picker':
      return formatPicker(date)
  }
}
