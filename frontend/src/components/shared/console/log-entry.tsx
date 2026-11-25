/** LogEntry: one console row colored by level (REQ-3.7.2.5, REQ-3.7.2.6). */

import { memo } from 'react'
import type { LogEntry as LogEntryType, DisplaySettings } from '@/types/console'
import type { LogLevel } from '@/lib/log-levels'
import { formatTimestamp } from '@/lib/timestamp-format'
import { useTimezoneStore } from '@/stores/timezone-store'
import { ConditionalTooltip } from '@/components/ui/tooltip'

// Types

export interface LogEntryProps {
  entry: LogEntryType
  displaySettings: DisplaySettings
  /** Effective source width from parent (clamped to valid range) */
  effectiveSourceWidth?: number
  height?: number
  'aria-posinset'?: number
  'aria-setsize'?: number
}

/** Format a log entry for clipboard copy with the visible columns and the user's time zone. */
export function formatEntryForCopy(entry: LogEntryType, displaySettings: DisplaySettings): string {
  const parts: string[] = []

  if (displaySettings.showTimestamps) {
    parts.push(formatTimestamp(entry.timestamp, 'time', useTimezoneStore.getState().mode))
  }

  if (displaySettings.showLevel) {
    parts.push(entry.level.padEnd(5))
  }

  if (displaySettings.showSource) {
    parts.push(`[${entry.source}]`)
  }

  // Message is always included
  parts.push(entry.message)

  return parts.join(' ')
}

// Constants

const DEFAULT_SOURCE_WIDTH = 20
const MIN_SOURCE_WIDTH = 10
const MAX_SOURCE_WIDTH = 50

/** The Source column's width in characters, kept between its smallest and largest size. */
export function clampSourceWidth(width: number): number {
  return Math.max(MIN_SOURCE_WIDTH, Math.min(MAX_SOURCE_WIDTH, width))
}

const LEVEL_CLASS_MAP: Record<LogLevel, string> = {
  DEBUG: 'log-level-debug',
  INFO: 'log-level-info',
  WARN: 'log-level-warn',
  ERROR: 'log-level-error',
  FATAL: 'log-level-fatal',
}

// Variant classes override level coloring; banners mark regression and suite boundaries.
const VARIANT_CLASS_MAP: Record<string, string> = {
  success: 'log-variant-success',
  error: 'log-variant-error',
  warning: 'log-variant-warning',
  // Paused lines use the warning amber (CANVAS-87).
  paused: 'log-variant-paused log-variant-warning',
  'regression-banner': 'log-variant-regression-banner',
  'suite-banner': 'log-variant-suite-banner',
}

// Must match the timestamp and level spacer widths in content.tsx; 18ch fits a GMT-7 zone token.
const TIMESTAMP_WIDTH_CH = 18
const LEVEL_WIDTH_CH = 5 // DEBUG/INFO/WARN/ERROR/FATAL padded to 5

// Helpers

/** Fit source to the column: truncate with an ellipsis or right-align. */
function formatSource(source: string, width: number): string {
  if (source.length > width) {
    return source.slice(0, width - 1) + '…'
  }
  // Pad short sources on the left (right-align)
  return source.padStart(width, ' ')
}

// Component

export const LogEntry = memo(function LogEntry({
  entry,
  displaySettings,
  effectiveSourceWidth: effectiveSourceWidthProp,
  height,
  'aria-posinset': ariaPosinset,
  'aria-setsize': ariaSetsize,
}: LogEntryProps) {
  const { showTimestamps, showLevel, showSource, sourceWidth = DEFAULT_SOURCE_WIDTH, fontSize } = displaySettings
  const timezoneMode = useTimezoneStore((s) => s.mode)

  // Use variant class if specified, otherwise use level-based class
  const colorClass = entry.variant
    ? VARIANT_CLASS_MAP[entry.variant] || LEVEL_CLASS_MAP[entry.level]
    : LEVEL_CLASS_MAP[entry.level]

  const formattedTimestamp = formatTimestamp(entry.timestamp, 'time', timezoneMode)

  // Pad level to fixed width for alignment (e.g., "INFO " -> "INFO ", "ERROR" -> "ERROR")
  const displayLevel = entry.level.padEnd(LEVEL_WIDTH_CH, ' ')

  // Use effective width from parent if provided, otherwise clamp locally
  const effectiveSourceWidth =
    effectiveSourceWidthProp ?? clampSourceWidth(sourceWidth)
  const displaySource = formatSource(entry.source, effectiveSourceWidth)
  const needsTooltip = entry.source.length > effectiveSourceWidth

  const ariaLabel = `${entry.level}: ${entry.message}`

  // Generate copy-friendly text (stored in data attribute for copy handler)
  const copyText = formatEntryForCopy(entry, displaySettings)

  // Compute line height for comfortable reading with wrapped text
  const textLineHeight = Math.round(fontSize * 1.5)
  const verticalPadding = height ? Math.max(0, Math.round((height - textLineHeight) / 2)) : 0

  return (
    <article
      data-testid={`log-entry-${entry.id}`}
      data-copy-text={copyText}
      className={`font-mono ${colorClass} px-2 flex items-start`}
      style={{
        minHeight: height ? `${height}px` : undefined,
        fontSize: `${fontSize}px`,
        lineHeight: `${textLineHeight}px`,
        paddingTop: `${verticalPadding}px`,
        paddingBottom: `${verticalPadding}px`,
      }}
      aria-label={ariaLabel}
      aria-posinset={ariaPosinset}
      aria-setsize={ariaSetsize}
    >
      {showTimestamps && (
        <span
          className="log-timestamp inline-block shrink-0 opacity-60 whitespace-pre"
          translate="no"
          style={{ width: `${TIMESTAMP_WIDTH_CH}ch` }}
        >
          {formattedTimestamp}
        </span>
      )}
      {showTimestamps && <span className="inline-block shrink-0" style={{ width: '1ch' }} />}

      {showLevel && (
        <span
          className="level-badge inline-block shrink-0 whitespace-pre font-semibold uppercase"
          translate="no"
          style={{ width: `${LEVEL_WIDTH_CH}ch` }}
        >
          {displayLevel}
          </span>
        )}
      {showLevel && <span className="inline-block shrink-0" style={{ width: '1ch' }} />}

      {showSource && (
        <>
          <ConditionalTooltip content={needsTooltip ? entry.source : undefined} wide>
            <span
              data-testid="log-entry-source"
              className="log-source source-column inline-block shrink-0 align-top opacity-70 whitespace-pre overflow-hidden text-ellipsis"
              translate="no"
              style={{
                width: `${effectiveSourceWidth}ch`,
                maxWidth: `${effectiveSourceWidth}ch`,
              }}
            >
              {displaySource}
            </span>
          </ConditionalTooltip>
          {/* Gap between source and message (resize bar sits here) */}
          <span className="inline-block shrink-0" style={{ width: '16px' }} />
        </>
      )}

      <span
        data-testid="log-entry-message"
        className="log-message flex-1 min-w-0 whitespace-pre-wrap break-words"
      >
        {entry.message}
      </span>
    </article>
  )
})

export default LogEntry
