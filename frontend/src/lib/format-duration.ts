/**
 * Format a duration in seconds to a human-readable string.
 *
 * The backend sends sub-minute durations already rounded to 3 decimals
 * (per-run `_compute_live_duration` + the sums computed in
 * `_enrich_execution_for_detail`). This formatter just truncates the
 * display to at most 3 digits after the dot as a belt-and-braces guard
 * against any future backend bug that leaks a longer float - no
 * arithmetic, pure string work.
 *
 * Examples: `null` → `-`, `5` → `5s`, `65` → `1m 5s`, `3600` → `1h`,
 * `3660` → `1h 1m`.
 */
export function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null || durationSeconds === undefined) {
    return '-'
  }

  const hours = Math.floor(durationSeconds / 3600)
  const minutes = Math.floor((durationSeconds % 3600) / 60)
  const seconds = durationSeconds % 60

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${hours}h`
  } else if (minutes > 0) {
    if (seconds > 0) {
      return `${minutes}m ${truncateDecimals(seconds, 3)}s`
    }
    return `${minutes}m`
  } else {
    return `${truncateDecimals(seconds, 3)}s`
  }
}

function truncateDecimals(value: number, maxDecimals: number): string {
  const str = String(value)
  const dot = str.indexOf('.')
  if (dot === -1) return str
  // Slice to at most ``maxDecimals`` digits past the dot, then drop a
  // trailing zeroed fraction (``0.000`` -> ``0``, ``5.100`` -> ``5.1``).
  // JS ``String(number)`` never emits trailing zeros on the fraction
  // itself, so every trailing zero here was produced by the slice and
  // always sits on the dot-prefixed side. The regex either matches the
  // entire dot-prefixed fraction (leaving just the integer part) or no
  // match (original string unchanged), so the result always carries an
  // integer prefix and can never be empty.
  return str.slice(0, dot + 1 + maxDecimals).replace(/\.0+$/, '')
}
