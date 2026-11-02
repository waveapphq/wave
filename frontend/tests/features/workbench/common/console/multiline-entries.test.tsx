/**
 * Multiline console log entries (REQ-3.4.1.4, HTTP-13).
 *
 * Combined DEBUG trace entries arrive as ONE log event whose message contains
 * newlines (4 entries for a redirect GET, not 13). The console must render the
 * entry as a single log element preserving its line breaks - never splitting,
 * collapsing, or truncating them - and the copy format must carry the breaks.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LogEntry, formatEntryForCopy } from '@/components/shared/console/log-entry'
import type { LogEntry as LogEntryType, DisplaySettings } from '@/types/console'

const TRACE_MESSAGE = [
  'Connection established: TLS 1.3, cipher TLS_AES_256_GCM_SHA384',
  '  peer CN=api.example.com, issuer CN=R11, expires in 54 days',
  'GET /v1/orders -> 302 Found (redirect)',
  'GET /v1/orders/all -> 200 OK',
].join('\n')

const entry: LogEntryType = {
  id: 'log-trace-1',
  timestamp: '2026-07-16T08:30:45.123Z',
  level: 'DEBUG',
  message: TRACE_MESSAGE,
  source: 'HTTP Client',
  sequence: 1,
}

const settings: DisplaySettings = {
  showTimestamps: false,
  showLevel: true,
  showSource: true,
  sourceWidth: 20,
  showSystemLogs: true,
  fontSize: 12,
}

describe('multiline log entries', () => {
  it('renders a multiline message as ONE log-entry element', () => {
    render(<LogEntry entry={entry} displaySettings={settings} />)
    expect(screen.getByTestId('log-entry-log-trace-1')).toBeInTheDocument()
    expect(screen.getAllByTestId('log-entry-message')).toHaveLength(1)
  })

  it('preserves every line break in the rendered message text', () => {
    render(<LogEntry entry={entry} displaySettings={settings} />)
    const message = screen.getByTestId('log-entry-message')
    expect(message.textContent).toBe(TRACE_MESSAGE)
    expect(message.textContent?.split('\n')).toHaveLength(4)
  })

  it('styles the message so the breaks actually render (pre-wrap)', () => {
    render(<LogEntry entry={entry} displaySettings={settings} />)
    expect(screen.getByTestId('log-entry-message').className).toContain('whitespace-pre-wrap')
  })

  it('exposes the full multiline message to assistive tech', () => {
    render(<LogEntry entry={entry} displaySettings={settings} />)
    expect(screen.getByTestId('log-entry-log-trace-1')).toHaveAttribute(
      'aria-label',
      `DEBUG: ${TRACE_MESSAGE}`,
    )
  })

  it('does not clamp the row to the single-line height', () => {
    render(<LogEntry entry={entry} displaySettings={settings} height={26} />)
    const row = screen.getByTestId('log-entry-log-trace-1')
    // minHeight (not height) so a wrapped/multiline entry can grow.
    expect(row.style.height).toBe('')
    expect(row.style.minHeight).toBe('26px')
  })

  it('carries the line breaks through the copy format', () => {
    const copied = formatEntryForCopy(entry, settings)
    expect(copied).toContain(TRACE_MESSAGE)
    expect(copied.split('\n')).toHaveLength(4)
  })

  it('embeds the multiline copy text on the row for selection copy', () => {
    render(<LogEntry entry={entry} displaySettings={settings} />)
    const copyText = screen.getByTestId('log-entry-log-trace-1').getAttribute('data-copy-text')
    expect(copyText).toContain('GET /v1/orders -> 302 Found (redirect)')
    expect(copyText?.includes('\n')).toBe(true)
  })
})
