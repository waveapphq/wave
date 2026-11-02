/**
 * LogEntry Component Tests - REQ-3.7.2.5, REQ-3.7.2.6
 *
 * Tests for the log entry component that renders individual log rows
 * with level-based coloring, timestamps, source, and messages.
 *
 * Design Reference:
 * - Log entry structure: timestamp, level, message, source
 * - Row coloring by level (entire row, regardless of visible columns)
 * - Source column truncation with tooltip
 * - Monospace font for log content
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Log level type
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

// Log entry structure
interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  blockId?: string
  sequence: number
  variant?: 'success' | 'error' | 'warning'
}

// Display settings
interface DisplaySettings {
  showTimestamps: boolean
  showLevel: boolean
  showSource: boolean
  sourceWidth: number
  showSystemLogs: boolean
  fontSize: number
}

describe('LogEntry Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  const defaultEntry: LogEntry = {
    id: 'log-1',
    // 18:30:45.123 UTC = 10:30:45.123 PST (the host TZ pinned in vite.config.ts).
    // Tests assert against the local-time digits the renderer produces under
    // the default Browser-local Time Zone preference.
    timestamp: '2025-01-22T18:30:45.123Z',
    level: 'INFO',
    message: 'Test message content',
    source: 'HTTP Client',
    sequence: 1,
  }

  const defaultSettings: DisplaySettings = {
    showTimestamps: true,
    showLevel: true,
    showSource: true,
    sourceWidth: 20,
    showSystemLogs: true,
    fontSize: 12,
  }

  describe('Basic Rendering', () => {
    it('renders log entry with all elements', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      // Should show timestamp in HH:MM:SS.mmm format (appears in both visual and copy text)
      expect(screen.getAllByText(/10:30:45\.123/).length).toBeGreaterThan(0)
      // Should show level (appears in both visual and copy text)
      expect(screen.getAllByText('INFO').length).toBeGreaterThan(0)
      // Should show source in visual display
      expect(screen.getByTestId('log-entry-source')).toHaveTextContent('HTTP Client')
      // Should show message
      expect(screen.getByTestId('log-entry-message')).toHaveTextContent('Test message content')
    })

    it('renders with data-testid for identification', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByTestId('log-entry-log-1')).toBeInTheDocument()
    })

    it('applies monospace font class', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const entry = screen.getByTestId('log-entry-log-1')
      expect(entry).toHaveClass('font-mono')
    })

    it('uses configurable font size from display settings', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const entry = screen.getByTestId('log-entry-log-1')
      expect(entry).toHaveStyle({ fontSize: '12px' })
    })

    it('uses data-testid with entry id', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByTestId('log-entry-log-1')).toBeInTheDocument()
    })
  })

  describe('Timestamp Formatting', () => {
    it('formats timestamp as HH:MM:SS.mmm', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        // 22:05:09.007 UTC = 14:05:09.007 PST (host TZ pinned in vite.config.ts)
        timestamp: '2025-01-22T22:05:09.007Z',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      // Renderer emits "HH:MM:SS.mmm <ZONE>"; the timestamp column may pad
      // the trailing zone token with spaces, so match the digits + zone.
      expect(screen.getByText(/14:05:09\.007\s+PST/)).toBeInTheDocument()
    })

    it('hides timestamp when showTimestamps is false', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showTimestamps: false }

      render(<LogEntry entry={defaultEntry} displaySettings={settings} />)

      expect(screen.queryByText(/10:30:45/)).not.toBeInTheDocument()
    })

    it('shows timestamp when showTimestamps is true', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      // Timestamp appears in both visual display and copy text
      expect(screen.getAllByText(/10:30:45\.123/).length).toBeGreaterThan(0)
    })
  })

  describe('Level Badge', () => {
    it('displays level text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByText('INFO')).toBeInTheDocument()
    })

    it('hides level when showLevel is false', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showLevel: false }

      render(<LogEntry entry={defaultEntry} displaySettings={settings} />)

      expect(screen.queryByText('INFO')).not.toBeInTheDocument()
    })

    it('applies level badge styling', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const badge = screen.getByText('INFO')
      expect(badge).toHaveClass('level-badge')
    })
  })

  describe('Source Column', () => {
    it('displays source text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByText('HTTP Client')).toBeInTheDocument()
    })

    it('hides source when showSource is false', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showSource: false }

      render(<LogEntry entry={defaultEntry} displaySettings={settings} />)

      expect(screen.queryByText('HTTP Client')).not.toBeInTheDocument()
    })

    it('truncates long source names to sourceWidth characters', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'Very Long Source Name That Exceeds Twenty Characters',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      // Should show truncated with ellipsis (19 chars + ellipsis = 20)
      const sourceElement = screen.getByTestId('log-entry-source')
      expect(sourceElement.textContent?.length).toBe(20)
    })

    it('shows tooltip with full source on hover when truncated', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'Very Long Source Name That Exceeds Twenty Characters',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const sourceElement = screen.getByTestId('log-entry-source')
      await user.hover(sourceElement)

      // The browser popup is gone; the full source comes from the one tooltip.
      expect(sourceElement).not.toHaveAttribute('title')
      fireEvent.focus(sourceElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Very Long Source Name That Exceeds Twenty Characters',
      )
    })

    it('uses configurable sourceWidth for column width', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'Log : Block Name', // 16 chars
      }
      // Set sourceWidth to 20 - source should fit without truncation
      const settings: DisplaySettings = { ...defaultSettings, sourceWidth: 20 }

      render(<LogEntry entry={entry} displaySettings={settings} />)

      const sourceElement = screen.getByTestId('log-entry-source')
      // 16 chars padded to 20 = 4 leading spaces
      expect(sourceElement.textContent).toBe('    Log : Block Name')
      // No tooltip needed since full text is visible
      expect(sourceElement).not.toHaveAttribute('title')
    })

    it('truncates source at larger sourceWidth', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'Very Long Source Name That Would Otherwise Be Truncated', // 56 chars (no colon)
      }
      const settings: DisplaySettings = { ...defaultSettings, sourceWidth: 40 }

      render(<LogEntry entry={entry} displaySettings={settings} />)

      const sourceElement = screen.getByTestId('log-entry-source')
      // Truncated at 40 chars (39 chars + ellipsis)
      expect(sourceElement.textContent).toBe('Very Long Source Name That Would Otherw…')
      expect(sourceElement.textContent?.length).toBe(40)
      // The shared tooltip carries the full source.
      expect(sourceElement).not.toHaveAttribute('title')
      fireEvent.focus(sourceElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Very Long Source Name That Would Otherwise Be Truncated',
      )
    })

    it('shows a source that holds a colon as it arrives', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, source: 'HTTP : GET http://host/x' }
      const settings: DisplaySettings = { ...defaultSettings, sourceWidth: 30 }

      render(<LogEntry entry={entry} displaySettings={settings} />)

      expect(screen.getByTestId('log-entry-source').textContent).toBe(
        '      HTTP : GET http://host/x',
      )
    })

    it('right-aligns short source names with padding', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'short', // 5 characters
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const sourceElement = screen.getByTestId('log-entry-source')
      expect(sourceElement).toHaveClass('source-column')
      // Source is right-aligned: padded with spaces on the left
      expect(sourceElement.textContent).toBe('               short') // 15 spaces + 5 chars = 20
    })
  })

  describe('Message Column', () => {
    it('displays message text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByText('Test message content')).toBeInTheDocument()
    })

    it('preserves whitespace in message', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        message: 'Line 1\n  Line 2 with indent',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const messageElement = screen.getByTestId('log-entry-message')
      expect(messageElement).toHaveClass('whitespace-pre-wrap')
    })

    it('allows message to wrap to multiple lines', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        message: 'A very long message that should wrap to multiple lines when the container is narrow enough',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const messageElement = screen.getByTestId('log-entry-message')
      expect(messageElement).not.toHaveClass('truncate')
    })
  })

  describe('Level-Based Row Coloring (REQ-3.7.2.6)', () => {
    it('applies DEBUG styling - muted gray text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'DEBUG' }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-debug')
    })

    it('applies INFO styling - cyan text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'INFO' }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-info')
    })

    it('applies WARN styling - amber text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'WARN' }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-warn')
    })

    it('applies ERROR styling - red text', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'ERROR' }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-error')
    })

    it('applies FATAL styling - red text with background tint', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'FATAL' }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-fatal')
    })

    it('row coloring applies regardless of hidden columns', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'ERROR' }
      const settings: DisplaySettings = {
        showTimestamps: false,
        showLevel: false, // Level column hidden
        showSource: false,
        sourceWidth: 20,
        showSystemLogs: true,
        fontSize: 12,
      }

      render(<LogEntry entry={entry} displaySettings={settings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-level-error')
    })
  })

  describe('Variant-Based Styling', () => {
    it('applies success variant class when variant is success', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        variant: 'success',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-variant-success')
    })

    it('applies error variant class when variant is error', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        variant: 'error',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-variant-error')
    })

    it('applies regression-banner variant class for regression-scope banners', async () => {
      // Regression start/finish banners get a distinct
      // violet color + accent so the Execution Detail console visually
      // delimits the outermost scope from ordinary test logs.
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        variant: 'regression-banner' as 'success' | 'error' | 'warning',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-variant-regression-banner')
    })

    it('applies suite-banner variant class for suite-scope banners', async () => {
      // Suite start/completed banners (and the
      // suite-transition boundaries inside a regression) get a distinct
      // blue color + accent so each nested scope is visually separable.
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        variant: 'suite-banner' as 'success' | 'error' | 'warning',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('log-variant-suite-banner')
    })

    it('falls back to level class for unknown variant', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        level: 'WARN',
        variant: 'unknown-variant' as 'success' | 'error' | 'warning',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      // Should fall back to level class since variant is unknown
      expect(row).toHaveClass('log-level-warn')
    })
  })

  describe('Status Indicators', () => {
    it('shows in-progress indicator for messages starting with ">" symbol', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        message: '> GET /api/login',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      // The message should be rendered (appears in both visual and copy text)
      expect(screen.getAllByText(/GET \/api\/login/).length).toBeGreaterThan(0)
    })

    it('shows completed indicator for messages starting with checkmark', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        message: 'Status 200 (847ms)',
      }

      render(<LogEntry entry={entry} displaySettings={defaultSettings} />)

      // Message appears in both visual and copy text
      expect(screen.getAllByText(/Status 200/).length).toBeGreaterThan(0)
    })
  })

  describe('Accessibility', () => {
    it('has appropriate ARIA attributes', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveAttribute('aria-label')
    })

    it('includes level in ARIA label for screen readers', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row.getAttribute('aria-label')).toContain('INFO')
    })

    it('is accessible with aria attributes', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      // Log entries are navigated via container-level keyboard handling, not individual tabIndex
      expect(row).toHaveAttribute('aria-label')
    })

    it('keeps the time, the level and the Source out of browser translation', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row.querySelector('.log-timestamp')).toHaveAttribute('translate', 'no')
      expect(row.querySelector('.level-badge')).toHaveAttribute('translate', 'no')
      expect(screen.getByTestId('log-entry-source')).toHaveAttribute('translate', 'no')
    })

    it('leaves the message open to browser translation', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      expect(screen.getByTestId('log-entry-message')).not.toHaveAttribute('translate')
    })
  })

  describe('Muted Element Styling', () => {
    it('timestamp has muted styling relative to row color', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      // Find the timestamp element within the visual display (has log-timestamp class)
      const timestamps = screen.getAllByText(/10:30:45\.123/)
      const visualTimestamp = timestamps.find((el) => el.classList.contains('log-timestamp'))
      expect(visualTimestamp).toBeDefined()
      expect(visualTimestamp).toHaveClass('log-timestamp')
    })

    it('source has muted styling relative to row color', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const source = screen.getByTestId('log-entry-source')
      expect(source).toHaveClass('log-source')
    })

    it('message has full row color', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const message = screen.getByTestId('log-entry-message')
      expect(message).toHaveClass('log-message')
    })
  })

  describe('Height Configuration', () => {
    it('accepts height prop as minHeight for virtualization', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} height={40} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveStyle({ minHeight: '40px' })
    })

    it('uses default height when not specified', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      // Should not have inline minHeight style when using default
      expect(row.style.minHeight).toBeFalsy()
    })

    it('uses flex layout so wrapped text stays in message column', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} height={26} />)

      const row = screen.getByTestId('log-entry-log-1')
      expect(row).toHaveClass('flex', 'items-start')
      // Message column should fill remaining space
      const message = screen.getByTestId('log-entry-message')
      expect(message).toHaveClass('flex-1', 'min-w-0')
    })
  })

  describe('Copy Text Format (formatEntryForCopy)', () => {
    it('formats entry with all columns visible', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const result = formatEntryForCopy(defaultEntry, defaultSettings)

      // Should include timestamp, level, [source], message
      expect(result).toContain('10:30:45.123')
      expect(result).toContain('INFO')
      expect(result).toContain('[HTTP Client]') // Source in brackets
      expect(result).toContain('Test message content')
    })

    it('copies the source as it arrives', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'SQL : Run PSQL Proc',
      }
      const result = formatEntryForCopy(entry, defaultSettings)

      expect(result).toContain('[SQL : Run PSQL Proc]')
    })

    it('copies a source that holds a colon as it arrives', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, source: 'HTTP : GET http://host/x' }
      const result = formatEntryForCopy(entry, defaultSettings)

      expect(result).toContain('[HTTP : GET http://host/x]')
    })

    it('excludes timestamp when showTimestamps is false', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showTimestamps: false }
      const result = formatEntryForCopy(defaultEntry, settings)

      expect(result).not.toContain('10:30:45')
      expect(result).toContain('INFO')
      expect(result).toContain('[HTTP Client]')
    })

    it('excludes level when showLevel is false', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showLevel: false }
      const result = formatEntryForCopy(defaultEntry, settings)

      expect(result).toContain('10:30:45.123')
      expect(result).not.toMatch(/INFO\s/)
      expect(result).toContain('[HTTP Client]')
    })

    it('excludes source when showSource is false', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = { ...defaultSettings, showSource: false }
      const result = formatEntryForCopy(defaultEntry, settings)

      expect(result).toContain('10:30:45.123')
      expect(result).toContain('INFO')
      expect(result).not.toContain('[HTTP Client]')
      expect(result).toContain('Test message content')
    })

    it('always includes message', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const settings: DisplaySettings = {
        ...defaultSettings,
        showTimestamps: false,
        showLevel: false,
        showSource: false,
      }
      const result = formatEntryForCopy(defaultEntry, settings)

      expect(result).toBe('Test message content')
    })

    it('uses full source (not truncated) in brackets', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = {
        ...defaultEntry,
        source: 'Very Long Source Name That Exceeds Width',
      }
      const settings: DisplaySettings = { ...defaultSettings, sourceWidth: 10 }
      const result = formatEntryForCopy(entry, settings)

      // Source should be full, not truncated
      expect(result).toContain('[Very Long Source Name That Exceeds Width]')
    })

    it('pads level to consistent width', async () => {
      const { formatEntryForCopy } = await import('../../../../../src/components/shared/console/log-entry')

      const entry: LogEntry = { ...defaultEntry, level: 'WARN' }
      const result = formatEntryForCopy(entry, defaultSettings)

      // WARN should be padded to 5 chars
      expect(result).toMatch(/WARN\s/)
    })

    it('stores copy text in data attribute for copy handler', async () => {
      const { LogEntry } = await import('../../../../../src/components/shared/console/log-entry')

      render(<LogEntry entry={defaultEntry} displaySettings={defaultSettings} />)

      const row = screen.getByTestId('log-entry-log-1')
      const copyText = row.getAttribute('data-copy-text')
      expect(copyText).toContain('10:30:45.123')
      expect(copyText).toContain('[HTTP Client]')
    })
  })
})
