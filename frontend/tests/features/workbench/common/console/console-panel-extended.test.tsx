/**
 * ConsolePanel Extended Tests - REQ-3.4.2.7, REQ-3.7.2.6, REQ-3.7.2.8
 *
 * Tests for console panel extensions including level dropdown,
 * error badge, clear button, and integrated console content.
 *
 * Design Reference:
 * - Level dropdown for minimum level filter (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Error badge on collapsed panel header (red triangle + count)
 * - Error badge click expands panel + activates error filter
 * - Clear button to reset log buffer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Log level type
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

// Props type
interface ConsolePanelProps {
  sessionId: string | null
  errorCount: number
  minLevel: LogLevel
  onMinLevelChange: (level: LogLevel) => void
  errorFilterActive: boolean
  onErrorFilterChange: (active: boolean) => void
  onClear: () => void
  onCopyLogs?: () => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  hasEntries?: boolean
}

describe('ConsolePanel Extended', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.resetModules()
  })

  const defaultProps: ConsolePanelProps = {
    sessionId: 'session-123',
    errorCount: 0,
    minLevel: 'INFO',
    onMinLevelChange: vi.fn(),
    errorFilterActive: false,
    onErrorFilterChange: vi.fn(),
    onClear: vi.fn(),
    onCopyLogs: vi.fn(),
    collapsed: false,
    onCollapsedChange: vi.fn(),
    hasEntries: true,
  }

  describe('Level Dropdown', () => {
    it('displays current level selection', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} minLevel="INFO" />)

      expect(screen.getByText('INFO')).toBeInTheDocument()
    })

    it('shows all log levels in dropdown', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(<ConsolePanelHeader {...defaultProps} />)

      // Open dropdown
      const trigger = screen.getByRole('combobox', { name: /level/i })
      await user.click(trigger)

      const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
      for (const level of levels) {
        expect(screen.getByRole('option', { name: level })).toBeInTheDocument()
      }
    })

    it('calls onMinLevelChange when level is selected', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onMinLevelChange = vi.fn()

      render(<ConsolePanelHeader {...defaultProps} onMinLevelChange={onMinLevelChange} />)

      const trigger = screen.getByRole('combobox', { name: /level/i })
      await user.click(trigger)
      await user.click(screen.getByRole('option', { name: 'DEBUG' }))

      expect(onMinLevelChange).toHaveBeenCalledWith('DEBUG')
    })

    it('shows selected level with checkmark', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(<ConsolePanelHeader {...defaultProps} minLevel="WARN" />)

      const trigger = screen.getByRole('combobox', { name: /level/i })
      await user.click(trigger)

      const warnOption = screen.getByRole('option', { name: 'WARN' })
      expect(warnOption).toHaveAttribute('aria-selected', 'true')
    })

    it('has label "Level:" before dropdown', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByText('Level:')).toBeInTheDocument()
    })

    it('binds the "Level:" label to the dropdown', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const trigger = screen.getByRole('combobox', { name: 'Minimum log level' })
      expect(trigger.id).not.toBe('')
      expect(screen.getByText('Level:')).toHaveAttribute('for', trigger.id)
    })

    it('gives each console header its own dropdown id', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <>
          <ConsolePanelHeader {...defaultProps} />
          <ConsolePanelHeader {...defaultProps} />
        </>
      )

      const [first, second] = screen.getAllByRole('combobox', { name: 'Minimum log level' })
      expect(first.id).not.toBe(second.id)
    })

    // No test covers keyboard use of this select (REQ-5.2.1.30-33): Radix Select keyboard navigation needs a real browser, not jsdom.
  })

  describe('Error Badge (Collapsed State)', () => {
    it('shows error badge when collapsed and errors exist', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={2}
        />
      )

      const badge = screen.getByTestId('error-badge')
      expect(badge).toBeInTheDocument()
      expect(badge).toHaveTextContent('2')
    })

    it('hides error badge when collapsed with zero errors', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={0}
        />
      )

      expect(screen.queryByTestId('error-badge')).not.toBeInTheDocument()
    })

    it('shows error badge in both collapsed and expanded modes', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={false}
          errorCount={5}
        />
      )

      // Error badge should be visible even when expanded for quick error awareness
      expect(screen.getByTestId('error-badge')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('displays warning triangle icon', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={1}
        />
      )

      const badge = screen.getByTestId('error-badge')
      expect(badge.querySelector('svg')).toBeInTheDocument() // Triangle icon
    })

    it('has red styling for visibility', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={3}
        />
      )

      const badge = screen.getByTestId('error-badge')
      expect(badge).toHaveClass('text-error')
    })
  })

  describe('Error Badge Click Behavior', () => {
    it('expands panel when badge is clicked', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCollapsedChange = vi.fn()

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={2}
          onCollapsedChange={onCollapsedChange}
        />
      )

      await user.click(screen.getByTestId('error-badge'))

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
    })

    it('activates error filter when badge is clicked', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onErrorFilterChange = vi.fn()

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={2}
          onErrorFilterChange={onErrorFilterChange}
        />
      )

      await user.click(screen.getByTestId('error-badge'))

      expect(onErrorFilterChange).toHaveBeenCalledWith(true)
    })

    it('badge is focusable and clickable', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={1}
        />
      )

      const badge = screen.getByTestId('error-badge')
      expect(badge.tagName).toBe('BUTTON')
      expect(badge).toHaveRole('button')
    })

    it('badge can be activated with Enter key', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCollapsedChange = vi.fn()
      const onErrorFilterChange = vi.fn()

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={1}
          onCollapsedChange={onCollapsedChange}
          onErrorFilterChange={onErrorFilterChange}
        />
      )

      const badge = screen.getByTestId('error-badge')
      badge.focus()
      await user.keyboard('{Enter}')

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
      expect(onErrorFilterChange).toHaveBeenCalledWith(true)
    })

    it('badge can be activated with Space key', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCollapsedChange = vi.fn()
      const onErrorFilterChange = vi.fn()

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={1}
          onCollapsedChange={onCollapsedChange}
          onErrorFilterChange={onErrorFilterChange}
        />
      )

      const badge = screen.getByTestId('error-badge')
      badge.focus()
      await user.keyboard(' ')

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
      expect(onErrorFilterChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Errors Only Filter Chip', () => {
    it('shows "Errors only" chip when error filter is active', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          errorFilterActive={true}
        />
      )

      expect(screen.getByText('Errors only')).toBeInTheDocument()
    })

    it('hides chip when error filter is inactive', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          errorFilterActive={false}
        />
      )

      expect(screen.queryByText('Errors only')).not.toBeInTheDocument()
    })

    it('chip has dismiss button', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          errorFilterActive={true}
        />
      )

      const chip = screen.getByText('Errors only').closest('[data-testid="error-filter-chip"]')
      expect(within(chip as HTMLElement).getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
    })

    it('dismissing chip deactivates error filter', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onErrorFilterChange = vi.fn()

      render(
        <ConsolePanelHeader
          {...defaultProps}
          errorFilterActive={true}
          onErrorFilterChange={onErrorFilterChange}
        />
      )

      const chip = screen.getByText('Errors only').closest('[data-testid="error-filter-chip"]')
      const dismissButton = within(chip as HTMLElement).getByRole('button', { name: /dismiss/i })
      await user.click(dismissButton)

      expect(onErrorFilterChange).toHaveBeenCalledWith(false)
    })

    it('chip is positioned after Console label', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          errorFilterActive={true}
        />
      )

      const header = screen.getByTestId('console-panel-header')
      const children = Array.from(header.children)
      const consoleLabel = children.find((child) => child.textContent?.includes('Console'))
      const chip = children.find((child) => child.textContent?.includes('Errors only'))

      // Console label should come before chip
      expect(consoleLabel).toBeDefined()
      expect(chip).toBeDefined()
      if (consoleLabel && chip) {
        expect(children.indexOf(consoleLabel)).toBeLessThan(children.indexOf(chip))
      }
    })
  })

  describe('Copy Logs Button', () => {
    it('displays copy logs button', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByRole('button', { name: /copy logs/i })).toBeInTheDocument()
    })

    it('calls onCopyLogs when clicked', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCopyLogs = vi.fn()

      render(<ConsolePanelHeader {...defaultProps} onCopyLogs={onCopyLogs} />)

      await user.click(screen.getByRole('button', { name: /copy logs/i }))

      expect(onCopyLogs).toHaveBeenCalled()
    })

    it('is disabled when there are no entries', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} hasEntries={false} />)

      const button = screen.getByRole('button', { name: /copy logs/i })
      expect(button).toBeDisabled()
    })

    it('has aria-label for accessibility', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const button = screen.getByRole('button', { name: /copy logs/i })
      expect(button).toHaveAttribute('aria-label', 'Copy logs')
    })
  })

  describe('Clear Button', () => {
    it('displays clear button', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    })

    it('calls onClear when clicked', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onClear = vi.fn()

      render(<ConsolePanelHeader {...defaultProps} onClear={onClear} />)

      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(onClear).toHaveBeenCalled()
    })

    it('clear button is on far right of header', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const clearButton = screen.getByRole('button', { name: /clear/i })

      // Clear button should be in a right-aligned group
      expect(clearButton.parentElement).toHaveClass('ml-auto')
    })

    it('has aria-label for accessibility', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const button = screen.getByRole('button', { name: /clear/i })
      expect(button).toHaveAttribute('aria-label', 'Clear console')
    })
  })

  describe('Settings Button', () => {
    it('displays settings button with gear icon', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
    })

    it('settings button is positioned before clear button', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const settingsButton = screen.getByRole('button', { name: /settings/i })
      const clearButton = screen.getByRole('button', { name: /clear/i })

      const parent = settingsButton.parentElement
      const children = Array.from(parent?.children || [])

      expect(children.indexOf(settingsButton)).toBeLessThan(children.indexOf(clearButton))
    })
  })

  describe('Header Layout', () => {
    it('header includes collapse toggle', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByRole('button', { name: /toggle console/i })).toBeInTheDocument()
    })

    it('calls onCollapsedChange when toggle button is clicked', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCollapsedChange = vi.fn()

      render(<ConsolePanelHeader {...defaultProps} collapsed={false} onCollapsedChange={onCollapsedChange} />)

      const toggleButton = screen.getByRole('button', { name: /toggle console/i })
      await user.click(toggleButton)

      expect(onCollapsedChange).toHaveBeenCalledWith(true)
    })

    it('calls onDisplaySettingsChange when settings are changed', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onDisplaySettingsChange = vi.fn()

      render(<ConsolePanelHeader {...defaultProps} onDisplaySettingsChange={onDisplaySettingsChange} />)

      // Open settings popover
      const settingsButton = screen.getByRole('button', { name: /settings/i })
      await user.click(settingsButton)

      // Toggle a setting
      const timestampToggle = screen.getByLabelText('Show Timestamps')
      await user.click(timestampToggle)

      expect(onDisplaySettingsChange).toHaveBeenCalledWith({ showTimestamps: false })
    })

    it('header includes terminal icon', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByTestId('console-icon')).toBeInTheDocument()
    })

    it('header includes "Console" title', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      expect(screen.getByText('Console')).toBeInTheDocument()
    })

    it('header elements are in correct order', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(
        <ConsolePanelHeader
          {...defaultProps}
          collapsed={true}
          errorCount={1}
          errorFilterActive={true}
        />
      )

      // Order: Toggle, Icon, Title, Error Badge (collapsed), Error Filter Chip, Level Dropdown, Settings, Clear
      const header = screen.getByTestId('console-panel-header')
      const allText = header.textContent || ''

      expect(allText.indexOf('Console')).toBeLessThan(allText.indexOf('Level'))
    })
  })

  describe('Disabled States', () => {
    it('level dropdown is always enabled (can set level before execution)', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} sessionId={null} />)

      const dropdown = screen.getByRole('combobox', { name: /level/i })
      expect(dropdown).not.toBeDisabled()
    })

    it('disables clear button when no entries', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} hasEntries={false} isExecuting={false} />)

      const button = screen.getByRole('button', { name: /clear/i })
      expect(button).toBeDisabled()
    })

    it('disables clear button during active execution (idle state only)', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} hasEntries={true} isExecuting={true} />)

      const button = screen.getByRole('button', { name: /clear/i })
      expect(button).toBeDisabled()
    })

    it('enables clear button when entries exist and execution is idle', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} hasEntries={true} isExecuting={false} />)

      const button = screen.getByRole('button', { name: /clear/i })
      expect(button).not.toBeDisabled()
    })

    it('disables clear button when readOnly is true even with entries and idle', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} hasEntries={true} isExecuting={false} readOnly />)

      const button = screen.getByRole('button', { name: /clear/i })
      expect(button).toBeDisabled()
    })
  })

  describe('Optional Callbacks', () => {
    it('handles toggle when onCollapsedChange is not provided', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      // Render without onCollapsedChange - should not throw
      render(
        <ConsolePanelHeader
          {...defaultProps}
          onCollapsedChange={undefined}
        />
      )

      const toggleButton = screen.getByRole('button', { name: /toggle console/i })

      // Click should not throw even without callback
      await user.click(toggleButton)
      expect(toggleButton).toBeInTheDocument()
    })

    it('handles settings change when onDisplaySettingsChange is not provided', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      // Render without onDisplaySettingsChange - should not throw
      render(
        <ConsolePanelHeader
          {...defaultProps}
          onDisplaySettingsChange={undefined}
        />
      )

      // Open settings popover
      const settingsButton = screen.getByRole('button', { name: /settings/i })
      await user.click(settingsButton)

      // Toggle a setting - should not throw even without callback
      const timestampToggle = screen.getByLabelText('Show Timestamps')
      await user.click(timestampToggle)
      expect(timestampToggle).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('header has proper ARIA structure', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const header = screen.getByTestId('console-panel-header')
      expect(header).toHaveAttribute('role', 'toolbar')
    })

    it('all interactive elements have labels', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAccessibleName()
      })
    })

    it('dropdown has accessible description', async () => {
      const { ConsolePanelHeader } = await import('../../../../../src/components/shared/console/console-panel-header')

      render(<ConsolePanelHeader {...defaultProps} />)

      const dropdown = screen.getByRole('combobox')
      expect(dropdown).toHaveAccessibleName()
    })
  })
})
