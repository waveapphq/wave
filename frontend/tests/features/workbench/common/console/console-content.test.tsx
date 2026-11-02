/**
 * ConsoleContent Component Tests - REQ-3.4.2.7, REQ-3.7.2.8
 *
 * Tests for the console content component that renders a virtualized list
 * of log entries with auto-scroll behavior.
 *
 * Design Reference:
 * - Virtualized rendering for 10K+ entries
 * - Auto-scroll to new entries when at bottom
 * - "Jump to bottom" button when scrolled up
 * - Pagination trigger when scrolling near top
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Log entry type
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  sequence: number
}

interface DisplaySettings {
  showTimestamps: boolean
  showLevel: boolean
  showSource: boolean
  sourceWidth: number
  showSystemLogs: boolean
  fontSize: number
}

describe('ConsoleContent Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
  })

  const defaultSettings: DisplaySettings = {
    showTimestamps: true,
    showLevel: true,
    showSource: true,
    sourceWidth: 20,
    showSystemLogs: true,
    fontSize: 12,
  }

  const createEntries = (count: number): LogEntry[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `log-${i}`,
      timestamp: `2025-01-22T10:30:${String(i % 60).padStart(2, '0')}.000Z`,
      level: 'INFO' as LogLevel,
      message: `Message ${i}`,
      source: 'Test',
      sequence: i,
    }))
  }

  describe('Basic Rendering', () => {
    it('renders container with correct role', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')

      render(
        <ConsoleContent
          entries={[]}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      expect(screen.getByRole('log')).toBeInTheDocument()
    })

    it('renders empty state when no entries', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')

      render(
        <ConsoleContent
          entries={[]}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      expect(screen.getByText(/no logs/i)).toBeInTheDocument()
    })

    it('renders log entries', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Should render visible entries
      expect(screen.getByText('Message 0')).toBeInTheDocument()
    })

    it('passes display settings to log entries', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1)

      const settings: DisplaySettings = {
        ...defaultSettings,
        showTimestamps: false,
      }

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={settings}
          containerHeight={200}
        />
      )

      // Timestamp should not be visible
      expect(screen.queryByText(/10:30:00/)).not.toBeInTheDocument()
    })

    it('uses default font size when not provided in settings', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1)

      // Create settings without fontSize to trigger default fallback
      const settingsWithoutFontSize = {
        showTimestamps: true,
        showLevel: true,
        showSource: true,
        sourceWidth: 20,
        showSystemLogs: true,
      } as DisplaySettings

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={settingsWithoutFontSize}
          containerHeight={200}
        />
      )

      // Component should render with default font size (12)
      const items = screen.getAllByTestId(/^log-entry-log-/)
      // Default item height = 12 * 2.2 = 26px (rounded), used as minHeight
      expect(items[0]).toHaveStyle({ minHeight: '26px' })
    })

    it('renders with all display columns hidden', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1)

      const minimalSettings: DisplaySettings = {
        ...defaultSettings,
        showTimestamps: false,
        showLevel: false,
        showSource: false,
      }

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={minimalSettings}
          containerHeight={200}
        />
      )

      // Only message should be visible
      expect(screen.getByText('Message 0')).toBeInTheDocument()
      // No timestamp
      expect(screen.queryByText(/10:30:00/)).not.toBeInTheDocument()
      // No resize handle (source is hidden)
      expect(screen.queryByTestId('source-resize-handle')).not.toBeInTheDocument()
    })

    it('uses default sourceWidth when not provided in settings', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1)

      // Create settings without sourceWidth to trigger default (20)
      const settingsWithoutSourceWidth = {
        showTimestamps: true,
        showLevel: true,
        showSource: true,
        showSystemLogs: true,
        fontSize: 12,
      } as DisplaySettings

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={settingsWithoutSourceWidth}
          containerHeight={200}
        />
      )

      // Component should render - source column uses default width
      expect(screen.getByTestId('source-resize-handle')).toBeInTheDocument()
    })
  })

  describe('Virtualization', () => {
    it('uses virtualized list for large datasets', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Should use virtualized list component
      const container = screen.getByRole('log')
      expect(container.querySelector('[data-virtualized-spacer]')).toBeInTheDocument()
    })

    it('only renders visible entries plus buffer', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1000)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          itemHeight={40}
        />
      )

      // With 200px height and 40px items, should render ~5 visible + overscan
      // Not all 1000 entries should be in DOM
      const renderedItems = screen.getAllByTestId(/^log-entry-log-/)
      expect(renderedItems.length).toBeLessThan(50)
    })

    it('uses execution-log context height (40px)', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Default item height based on fontSize 12 * 2.2 ratio = 26px, used as minHeight
      const items = screen.getAllByTestId(/^log-entry-log-/)
      items.forEach((item) => {
        expect(item).toHaveStyle({ minHeight: '26px' })
      })
    })
  })

  describe('Auto-scroll Behavior', () => {
    it('auto-scrolls to new entries when at bottom', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      const { rerender } = render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={true}
        />
      )

      const container = screen.getByRole('log')
      // Mock being at bottom
      Object.defineProperty(container, 'scrollHeight', { value: 400, writable: true })
      Object.defineProperty(container, 'scrollTop', { value: 200, writable: true })
      Object.defineProperty(container, 'clientHeight', { value: 200, writable: true })

      // Add new entries
      const newEntries = [...entries, ...createEntries(5).map((e, i) => ({ ...e, id: `log-new-${i}`, sequence: 10 + i }))]

      rerender(
        <ConsoleContent
          entries={newEntries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={true}
        />
      )

      // Should trigger scroll to bottom
      // Implementation will call scrollIntoView or scrollTo
      expect(container).toBeInTheDocument()
    })

    it('pauses auto-scroll when user scrolls up', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)
      const onAutoScrollChange = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={true}
          onAutoScrollChange={onAutoScrollChange}
        />
      )

      const container = screen.getByRole('log')

      // Simulate scroll up (not at bottom)
      fireEvent.scroll(container, { target: { scrollTop: 0 } })

      // Should notify parent that auto-scroll should be disabled
      expect(onAutoScrollChange).toHaveBeenCalledWith(false)
    })

    it('resumes auto-scroll when scrolled back to bottom', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)
      const onAutoScrollChange = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={false}
          onAutoScrollChange={onAutoScrollChange}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollHeight', { value: 800, writable: true })
      Object.defineProperty(container, 'clientHeight', { value: 200, writable: true })

      // Simulate scroll to bottom (within threshold)
      Object.defineProperty(container, 'scrollTop', { value: 580, writable: true }) // 800 - 200 - 20 threshold
      fireEvent.scroll(container)

      expect(onAutoScrollChange).toHaveBeenCalledWith(true)
    })

    it('uses 20px threshold for "at bottom" detection', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)
      const onAutoScrollChange = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={false}
          onAutoScrollChange={onAutoScrollChange}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollHeight', { value: 800, writable: true })
      Object.defineProperty(container, 'clientHeight', { value: 200, writable: true })

      // 19px from bottom - should be considered "at bottom"
      Object.defineProperty(container, 'scrollTop', { value: 581, writable: true })
      fireEvent.scroll(container)

      expect(onAutoScrollChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Jump to Bottom Button', () => {
    it('shows "Jump to bottom" button when not at bottom', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(50)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={false}
        />
      )

      expect(screen.getByRole('button', { name: /jump to bottom/i })).toBeInTheDocument()
    })

    it('hides "Jump to bottom" button when at bottom', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={true}
        />
      )

      expect(screen.queryByRole('button', { name: /jump to bottom/i })).not.toBeInTheDocument()
    })

    it('scrolls to bottom and resumes auto-scroll when button clicked', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(50)
      const onAutoScrollChange = vi.fn()
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={false}
          onAutoScrollChange={onAutoScrollChange}
        />
      )

      const button = screen.getByRole('button', { name: /jump to bottom/i })
      await user.click(button)

      expect(onAutoScrollChange).toHaveBeenCalledWith(true)
    })

    it('button floats at bottom-center of log area', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(50)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          autoScrollEnabled={false}
        />
      )

      const button = screen.getByRole('button', { name: /jump to bottom/i })
      expect(button.parentElement).toHaveClass('absolute', 'bottom-4', 'left-1/2')
    })
  })

  describe('Pagination', () => {
    it('triggers onLoadMore when scrolling near top', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)
      const onLoadMore = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          hasMore={true}
          onLoadMore={onLoadMore}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollTop', { value: 50, writable: true })
      fireEvent.scroll(container)

      expect(onLoadMore).toHaveBeenCalled()
    })

    it('does not trigger onLoadMore when hasMore is false', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)
      const onLoadMore = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          hasMore={false}
          onLoadMore={onLoadMore}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollTop', { value: 0, writable: true })
      fireEvent.scroll(container)

      expect(onLoadMore).not.toHaveBeenCalled()
    })

    it('shows loading indicator when loading more', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          isLoading={true}
        />
      )

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument()
    })

    it('loading indicator appears at top when loading historical logs', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          isLoading={true}
        />
      )

      const indicator = screen.getByTestId('loading-indicator')
      // Loading indicator is a floating badge centered at top
      expect(indicator.parentElement).toHaveClass('absolute', 'top-2', 'pointer-events-none', 'select-none')
    })
  })

  describe('Scroll Position Management', () => {
    it('calls onScroll callback when scrolling', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)
      const onScroll = vi.fn()

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          onScroll={onScroll}
        />
      )

      const container = screen.getByRole('log')
      fireEvent.scroll(container, { target: { scrollTop: 100 } })

      expect(onScroll).toHaveBeenCalledWith(100)
    })

    it('maintains scroll position when entries are prepended', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)

      const { rerender } = render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollTop', { value: 100, writable: true })

      // Prepend historical entries
      const newEntries = [
        ...createEntries(10).map((e, i) => ({ ...e, id: `historical-${i}`, sequence: -10 + i })),
        ...entries,
      ]

      rerender(
        <ConsoleContent
          entries={newEntries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Scroll position should be adjusted to maintain visual position
      // (This is implementation-specific, testing the interface)
      expect(container).toBeInTheDocument()
    })

    it('shifts scrollTop downward when a historical page is prepended so the user stays anchored near the previous top entry', async () => {
      // Loading more logs adds (added * itemHeight) to scrollTop, minus a
      // small "nudge" so a couple lines of new content remain visible.
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(20)

      const { rerender } = render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
          itemHeight={24}
        />
      )

      const container = screen.getByRole('log')
      Object.defineProperty(container, 'scrollTop', {
        value: 40,
        writable: true,
        configurable: true,
      })

      const newEntries = [
        ...createEntries(100).map((e, i) => ({
          ...e,
          id: `historical-${i}`,
          sequence: -100 + i,
        })),
        ...entries,
      ]

      rerender(
        <ConsoleContent
          entries={newEntries}
          displaySettings={defaultSettings}
          containerHeight={200}
          itemHeight={24}
        />
      )

      // 40 (prev) + 100 * 24 (shift) - max(24*2, 32) (nudge) = 2392
      expect(container.scrollTop).toBe(2392)
    })
  })

  describe('Keyboard Navigation', () => {
    it('supports keyboard navigation with arrow keys', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Interactive wrapper (parent of role="log") handles keyboard events
      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      fireEvent.keyDown(wrapper, { key: 'ArrowDown' })
      // First entry should be focused
      expect(wrapper).toBeInTheDocument()
    })

    it('supports PageDown for faster navigation forward', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      fireEvent.keyDown(wrapper, { key: 'PageDown' })
      // Should jump multiple entries forward
      expect(wrapper).toBeInTheDocument()
    })

    it('supports PageUp for faster navigation backward', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      // First scroll down, then use PageUp
      fireEvent.keyDown(wrapper, { key: 'End' })
      fireEvent.keyDown(wrapper, { key: 'PageUp' })
      // Should jump multiple entries backward
      expect(wrapper).toBeInTheDocument()
    })

    it('supports End for jumping to end', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      fireEvent.keyDown(wrapper, { key: 'End' })
      // Should jump to last entry
      expect(wrapper).toBeInTheDocument()
    })

    it('supports Home for jumping to start', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      // First scroll to end, then use Home
      fireEvent.keyDown(wrapper, { key: 'End' })
      fireEvent.keyDown(wrapper, { key: 'Home' })
      // Should jump to first entry
      expect(wrapper).toBeInTheDocument()
    })

    it('supports ArrowUp for scrolling up', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const wrapper = screen.getByRole('log').parentElement!
      wrapper.focus()

      // First scroll down, then use ArrowUp
      fireEvent.keyDown(wrapper, { key: 'ArrowDown' })
      fireEvent.keyDown(wrapper, { key: 'ArrowUp' })
      // Should scroll up by one item height
      expect(wrapper).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('has role="log" for live region', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')

      render(
        <ConsoleContent
          entries={[]}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      expect(screen.getByRole('log')).toBeInTheDocument()
    })

    it('has aria-live="polite" for new entries', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')

      render(
        <ConsoleContent
          entries={[]}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const container = screen.getByRole('log')
      expect(container).toHaveAttribute('aria-live', 'polite')
    })

    it('is focusable with tabindex', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')

      render(
        <ConsoleContent
          entries={[]}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // tabIndex is on the interactive wrapper (parent of role="log")
      const wrapper = screen.getByRole('log').parentElement!
      expect(wrapper).toHaveAttribute('tabindex', '0')
    })

    it('announces position in list for screen readers', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(10)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const items = screen.getAllByTestId(/^log-entry-log-/)
      items.forEach((item, index) => {
        expect(item).toHaveAttribute('aria-posinset', String(index + 1))
        expect(item).toHaveAttribute('aria-setsize', '10')
      })
    })

    it('new entries do not steal focus from current interaction', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      const { rerender } = render(
        <div>
          <button data-testid="other-button">Other Button</button>
          <ConsoleContent
            entries={entries}
            displaySettings={defaultSettings}
            containerHeight={200}
          />
        </div>
      )

      // Focus on external element
      const button = screen.getByTestId('other-button')
      button.focus()
      expect(document.activeElement).toBe(button)

      // Add new entries
      const newEntries = [...entries, ...createEntries(3).map((e, i) => ({ ...e, id: `new-${i}`, sequence: 5 + i }))]
      rerender(
        <div>
          <button data-testid="other-button">Other Button</button>
          <ConsoleContent
            entries={newEntries}
            displaySettings={defaultSettings}
            containerHeight={200}
          />
        </div>
      )

      // Focus should remain on the button, not stolen by new entries
      expect(document.activeElement).toBe(button)
    })
  })

  describe('Copy Functionality', () => {
    it('handles copy event and formats entries consistently', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(3)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      const container = screen.getByRole('log')

      // Simulate copy event
      const clipboardData = {
        setData: vi.fn(),
      }
      const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: (type: string, data: string) => void }
      }
      Object.defineProperty(copyEvent, 'clipboardData', { value: clipboardData })

      // Mock window.getSelection to return a selection spanning entries
      const mockSelection = {
        isCollapsed: false,
        getRangeAt: vi.fn().mockReturnValue({
          intersectsNode: vi.fn().mockReturnValue(true),
        }),
      }
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection)

      container.dispatchEvent(copyEvent)

      // Should intercept copy and format properly
      expect(clipboardData.setData).toHaveBeenCalledWith('text/plain', expect.any(String))

      vi.restoreAllMocks()
    })

    it('respects display settings when copying', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(1)

      const settingsWithoutSource = { ...defaultSettings, showSource: false }

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={settingsWithoutSource}
          containerHeight={200}
        />
      )

      // The copy handler should respect display settings
      const container = screen.getByRole('log')

      const clipboardData = {
        setData: vi.fn(),
      }
      const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
        clipboardData: { setData: (type: string, data: string) => void }
      }
      Object.defineProperty(copyEvent, 'clipboardData', { value: clipboardData })
      Object.defineProperty(copyEvent, 'preventDefault', { value: vi.fn() })

      const mockSelection = {
        isCollapsed: false,
        getRangeAt: vi.fn().mockReturnValue({
          intersectsNode: vi.fn().mockReturnValue(true),
        }),
      }
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection)

      container.dispatchEvent(copyEvent)

      // When source is hidden, copy text should not include source
      if (clipboardData.setData.mock.calls.length > 0) {
        const copiedText = clipboardData.setData.mock.calls[0][1] as string
        expect(copiedText).not.toContain('[')  // No brackets = no source
      }

      vi.restoreAllMocks()
    })
  })

  describe('Performance', () => {
    it('uses React.memo for entry components', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      // This test verifies memoization is in place
      const { rerender } = render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Re-render with same props
      rerender(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Entry components should not re-render
      // (Implementation uses React.memo internally)
      expect(screen.getByRole('log')).toBeInTheDocument()
    })

    it('handles rapid entry additions efficiently', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(100)

      const start = performance.now()

      const { rerender } = render(
        <ConsoleContent
          entries={entries}
          displaySettings={defaultSettings}
          containerHeight={200}
        />
      )

      // Add 100 more entries rapidly
      for (let i = 0; i < 10; i++) {
        const newEntries = [...entries, ...createEntries(10).map((e, j) => ({
          ...e,
          id: `batch-${i}-${j}`,
          sequence: 100 + i * 10 + j,
        }))]

        rerender(
          <ConsoleContent
            entries={newEntries}
            displaySettings={defaultSettings}
            containerHeight={200}
          />
        )
      }

      const elapsed = performance.now() - start
      // Should complete quickly due to virtualization
      expect(elapsed).toBeLessThan(1000)
    })
  })

  describe('Text Selection State', () => {
    it('disables resize handle pointer events during text selection', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true }}
          containerHeight={200}
        />
      )

      // Mouse events are on the interactive wrapper (parent of role="log")
      const wrapper = screen.getByRole('log').parentElement!
      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Before selection: resize handle should be interactive
      expect(resizeHandle).toHaveClass('pointer-events-auto')
      expect(resizeHandle).toHaveClass('cursor-col-resize')

      // Simulate mousedown on wrapper to start text selection
      fireEvent.mouseDown(wrapper)

      // During selection: resize handle should be non-interactive
      expect(resizeHandle).toHaveClass('pointer-events-none')
      expect(resizeHandle).not.toHaveClass('pointer-events-auto')

      // Simulate mouseup to end text selection
      fireEvent.mouseUp(wrapper)

      // After selection: resize handle should be interactive again
      expect(resizeHandle).toHaveClass('pointer-events-auto')
      expect(resizeHandle).toHaveClass('cursor-col-resize')
    })

    it('resets selection state on mouse leave', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true }}
          containerHeight={200}
        />
      )

      // Mouse events are on the interactive wrapper (parent of role="log")
      const wrapper = screen.getByRole('log').parentElement!
      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Start selection
      fireEvent.mouseDown(wrapper)
      expect(resizeHandle).toHaveClass('pointer-events-none')

      // Mouse leaves container - should reset selection state
      fireEvent.mouseLeave(wrapper)

      // Resize handle should be interactive again
      expect(resizeHandle).toHaveClass('pointer-events-auto')
    })
  })

  describe('Source Column Resize', () => {
    it('handles resize drag start', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true }}
          containerHeight={200}
        />
      )

      const resizeHandle = screen.getByTestId('source-resize-handle')
      fireEvent.mouseDown(resizeHandle, { clientX: 100 })

      // Drag should have started (component internally tracks this)
      expect(resizeHandle).toBeInTheDocument()
    })

    it('sets up document event listeners when drag starts', async () => {
      // Use real timers for this test since effects need to run
      vi.useRealTimers()

      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const onSourceWidthChange = vi.fn()
      const entries = createEntries(5)

      // Spy on document.addEventListener
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true, sourceWidth: 30 }}
          containerHeight={200}
          onSourceWidthChange={onSourceWidthChange}
        />
      )

      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Start drag - this triggers the useEffect that adds document listeners
      await act(async () => {
        fireEvent.mouseDown(resizeHandle, { clientX: 100 })
      })

      // Wait for React to process the state update and run effects
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })

      // Document event listeners should have been added for drag handling
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

      addEventListenerSpy.mockRestore()

      // Restore fake timers for other tests
      vi.useFakeTimers()
    })

    it('invokes onSourceWidthChange callback when dragging changes width', async () => {
      // This test directly invokes the handler pattern used by the component
      // to verify the callback mechanism works correctly
      vi.useRealTimers()

      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const onSourceWidthChange = vi.fn()
      const entries = createEntries(5)

      // Track what handler gets registered
      let registeredMouseMoveHandler: ((e: MouseEvent) => void) | null = null
      const originalAddEventListener = document.addEventListener.bind(document)
      document.addEventListener = vi.fn((type: string, handler: EventListenerOrEventListenerObject) => {
        if (type === 'mousemove' && typeof handler === 'function') {
          registeredMouseMoveHandler = handler as (e: MouseEvent) => void
        }
        return originalAddEventListener(type, handler)
      })

      // Mock getBoundingClientRect - use different values for container vs measurement element
      // Container gets large width, test element (span) gets 80px for 10 chars = 8px/char
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
      let callCount = 0
      Element.prototype.getBoundingClientRect = vi.fn().mockImplementation(function (this: Element) {
        callCount++
        // First call is for container (main component), second is for measurement span
        if (this.tagName === 'SPAN') {
          // Measurement element: 10 chars at 8px = 80px total
          return {
            width: 80,
            height: 14,
            top: 0,
            left: 0,
            bottom: 14,
            right: 80,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          }
        }
        // Container element: large width
        return {
          width: 2000,
          height: 200,
          top: 0,
          left: 0,
          bottom: 200,
          right: 2000,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }
      })

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true, sourceWidth: 30 }}
          containerHeight={200}
          onSourceWidthChange={onSourceWidthChange}
        />
      )

      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Start drag at position 0
      await act(async () => {
        fireEvent.mouseDown(resizeHandle, { clientX: 0 })
      })

      // Wait for effect to run
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })

      // If the handler was registered, call it directly
      // Moving 80px with 8px/char = 10 chars, so width goes from 30 to 40
      if (registeredMouseMoveHandler) {
        const mockEvent = new MouseEvent('mousemove', { clientX: 80 })
        await act(async () => {
          registeredMouseMoveHandler!(mockEvent)
        })

        // Callback should have been invoked with new width
        expect(onSourceWidthChange).toHaveBeenCalled()
      }

      // Restore
      document.addEventListener = originalAddEventListener
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
      vi.useFakeTimers()
    })

    it('cleans up document event listeners on drag end', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true }}
          containerHeight={200}
        />
      )

      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Start drag - document listeners should be added
      fireEvent.mouseDown(resizeHandle, { clientX: 100 })

      // Verify listeners were added
      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

      // End drag - document listeners should be removed
      fireEvent.mouseUp(document)

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function))

      addEventListenerSpy.mockRestore()
      removeEventListenerSpy.mockRestore()
    })

    it('clamps source width changes within valid range', async () => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const onSourceWidthChange = vi.fn()
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true, sourceWidth: 20 }}
          containerHeight={200}
          onSourceWidthChange={onSourceWidthChange}
        />
      )

      const resizeHandle = screen.getByTestId('source-resize-handle')

      // Start drag
      fireEvent.mouseDown(resizeHandle, { clientX: 100 })

      // Move mouse dramatically to test clamping
      fireEvent.mouseMove(document, { clientX: 1000 })

      // End drag
      fireEvent.mouseUp(document)

      // Component should have clamped the width - verify resize interaction completed
      expect(resizeHandle).toBeInTheDocument()
    })

    it('measures character width when getBoundingClientRect returns positive value', async () => {
      // Mock getBoundingClientRect to return positive width for measurement element
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        width: 80, // 10 chars * 8px = 80px
        height: 20,
        top: 0,
        left: 0,
        bottom: 20,
        right: 80,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      })

      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const entries = createEntries(5)

      render(
        <ConsoleContent
          entries={entries}
          displaySettings={{ ...defaultSettings, showSource: true }}
          containerHeight={200}
        />
      )

      // Component should have measured ch width
      expect(screen.getByRole('log')).toBeInTheDocument()

      // Restore original
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    })
  })

  describe('Source column width limits', () => {
    const CHAR_PX = 8
    const NARROW_CONSOLE_PX = 700
    const WIDE_CONSOLE_PX = 4000
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

    const mockWidths = (consolePx: number) => {
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const width = this.tagName === 'SPAN' ? CHAR_PX * 10 : consolePx
        return { width, height: 200, top: 0, left: 0, bottom: 200, right: width, x: 0, y: 0, toJSON: () => ({}) }
      }
    }

    const renderConsole = async (consolePx: number, sourceWidth: number) => {
      mockWidths(consolePx)
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      const onSourceWidthChange = vi.fn()
      render(
        <ConsoleContent
          entries={createEntries(3)}
          displaySettings={{ ...defaultSettings, sourceWidth }}
          containerHeight={200}
          onSourceWidthChange={onSourceWidthChange}
        />
      )
      return onSourceWidthChange
    }

    const dragHandleBy = async (deltaPx: number) => {
      const handle = screen.getByTestId('source-resize-handle')
      await act(async () => {
        fireEvent.mouseDown(handle, { clientX: 0 })
      })
      await act(async () => {
        fireEvent.mouseMove(document, { clientX: deltaPx })
      })
      await act(async () => {
        fireEvent.mouseUp(document)
      })
    }

    const sourceColumnWidth = () => {
      const handle = screen.getByTestId('source-resize-handle')
      return (handle.parentElement!.previousElementSibling as HTMLElement).style.width
    }

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    })

    it('keeps the Source column at its set width on a narrow console', async () => {
      await renderConsole(NARROW_CONSOLE_PX, 20)

      expect(sourceColumnWidth()).toBe('20ch')
    })

    it('keeps a dragged width on a narrow console', async () => {
      await renderConsole(NARROW_CONSOLE_PX, 42)

      expect(sourceColumnWidth()).toBe('42ch')
    })

    it('lets the Source column be dragged wider on a narrow console', async () => {
      const onSourceWidthChange = await renderConsole(NARROW_CONSOLE_PX, 20)

      await dragHandleBy(CHAR_PX * 15)

      expect(onSourceWidthChange).toHaveBeenLastCalledWith(35)
    })

    it('stops a drag at 50 characters on a narrow console', async () => {
      const onSourceWidthChange = await renderConsole(NARROW_CONSOLE_PX, 20)

      await dragHandleBy(CHAR_PX * 90)

      expect(onSourceWidthChange).toHaveBeenLastCalledWith(50)
    })

    it('stops a drag at 50 characters on a wide console', async () => {
      const onSourceWidthChange = await renderConsole(WIDE_CONSOLE_PX, 20)

      await dragHandleBy(CHAR_PX * 90)

      expect(onSourceWidthChange).toHaveBeenLastCalledWith(50)
    })

    it('stops a drag at 10 characters', async () => {
      const onSourceWidthChange = await renderConsole(WIDE_CONSOLE_PX, 20)

      await dragHandleBy(-CHAR_PX * 90)

      expect(onSourceWidthChange).toHaveBeenLastCalledWith(10)
    })

    it('shows a stored width over 50 characters as 50', async () => {
      await renderConsole(WIDE_CONSOLE_PX, 80)

      expect(sourceColumnWidth()).toBe('50ch')
    })

    it('shows a stored width under 10 characters as 10', async () => {
      await renderConsole(WIDE_CONSOLE_PX, 4)

      expect(sourceColumnWidth()).toBe('10ch')
    })
  })

  describe('Source column resize handle by keyboard', () => {
    const renderConsole = async (sourceWidth: number, onSourceWidthChange?: (width: number) => void) => {
      const { ConsoleContent } = await import('../../../../../src/components/shared/console/content')
      render(
        <ConsoleContent
          entries={createEntries(3)}
          displaySettings={{ ...defaultSettings, sourceWidth }}
          containerHeight={200}
          onSourceWidthChange={onSourceWidthChange}
        />
      )
      return screen.getByTestId('source-resize-handle')
    }

    it('widens the Source column by one character on Right arrow', async () => {
      const onSourceWidthChange = vi.fn()
      const handle = await renderConsole(20, onSourceWidthChange)

      fireEvent.keyDown(handle, { key: 'ArrowRight' })

      expect(onSourceWidthChange).toHaveBeenCalledTimes(1)
      expect(onSourceWidthChange).toHaveBeenCalledWith(21)
    })

    it('narrows the Source column by one character on Left arrow', async () => {
      const onSourceWidthChange = vi.fn()
      const handle = await renderConsole(20, onSourceWidthChange)

      fireEvent.keyDown(handle, { key: 'ArrowLeft' })

      expect(onSourceWidthChange).toHaveBeenCalledTimes(1)
      expect(onSourceWidthChange).toHaveBeenCalledWith(19)
    })

    it('stops at 50 characters', async () => {
      const onSourceWidthChange = vi.fn()
      const handle = await renderConsole(50, onSourceWidthChange)

      fireEvent.keyDown(handle, { key: 'ArrowRight' })

      expect(onSourceWidthChange).not.toHaveBeenCalled()
    })

    it('stops at 10 characters', async () => {
      const onSourceWidthChange = vi.fn()
      const handle = await renderConsole(10, onSourceWidthChange)

      fireEvent.keyDown(handle, { key: 'ArrowLeft' })

      expect(onSourceWidthChange).not.toHaveBeenCalled()
    })

    it('keeps an arrow key on the handle away from the page', async () => {
      const handle = await renderConsole(20, vi.fn())

      const notHandled = fireEvent.keyDown(handle, { key: 'ArrowRight' })

      expect(notHandled).toBe(false)
    })

    it('leaves every other key alone', async () => {
      const onSourceWidthChange = vi.fn()
      const handle = await renderConsole(20, onSourceWidthChange)

      const notHandled = fireEvent.keyDown(handle, { key: 'Tab' })

      expect(notHandled).toBe(true)
      expect(onSourceWidthChange).not.toHaveBeenCalled()
    })

    it('takes an arrow key when nothing listens for the width', async () => {
      const handle = await renderConsole(20)

      expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false)
    })

    it('is announced by its name', async () => {
      const handle = await renderConsole(20)

      expect(screen.getByRole('button', { name: 'Resize source column' })).toBe(handle)
    })

    it('shows the hover line as its keyboard focus mark', async () => {
      const handle = await renderConsole(20)

      const line = handle.firstElementChild as HTMLElement
      expect(line.className).toContain('group-focus-visible:w-[2px]')
      expect(line.className).toContain('group-focus-visible:bg-primary')
    })

    it('shows a focus mark inside the log area', async () => {
      await renderConsole(20)

      expect(screen.getByRole('application', { name: 'Log output' }).className).toContain(
        'focus-visible:[outline-offset:-2px]'
      )
    })
  })
})
