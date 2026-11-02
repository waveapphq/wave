/**
 * ConsoleSettings Component Tests - REQ-3.4.2.7
 *
 * Tests for the console settings popover that provides display options
 * for log entries (timestamps, level, source, truncation).
 *
 * Design Reference:
 * - Settings button (gear icon) opens display options popover
 * - Show Timestamps toggle (default: ON)
 * - Show Level toggle (default: ON)
 * - Show Source toggle (default: ON)
 * - Source column width is resizable via drag handle in console content
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Display settings type
interface DisplaySettings {
  showTimestamps: boolean
  showLevel: boolean
  showSource: boolean
  sourceWidth: number
  showSystemLogs: boolean
  fontSize: number
}

describe('ConsoleSettings Component', () => {
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

  describe('Trigger Button', () => {
    it('renders settings button with gear icon', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument()
    })

    it('button has aria-label for accessibility', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Console settings')
    })

    it('button has aria-haspopup attribute', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    })

    it('opens popover on click', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('Popover Content', () => {
    it('displays settings title', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      expect(screen.getByText('Display Options')).toBeInTheDocument()
    })

    it('displays all four setting toggles', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      expect(screen.getByLabelText('Show Timestamps')).toBeInTheDocument()
      expect(screen.getByLabelText('Show Level')).toBeInTheDocument()
      expect(screen.getByLabelText('Show Source')).toBeInTheDocument()
      // Source width is resizable via drag handle
    })

    it('closes popover when clicking outside', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <div>
          <ConsoleSettings
            settings={defaultSettings}
            onSettingsChange={vi.fn()}
          />
          <div data-testid="outside">Outside</div>
        </div>
      )

      await user.click(screen.getByRole('button'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.click(screen.getByTestId('outside'))
      // Popover should close

      await vi.advanceTimersByTimeAsync(300)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes popover on Escape key', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      await vi.advanceTimersByTimeAsync(300)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('Show Timestamps Toggle', () => {
    it('reflects current setting state', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showTimestamps: true }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const toggle = screen.getByLabelText('Show Timestamps')
      expect(toggle).toHaveAttribute('data-state', 'checked')
    })

    it('calls onSettingsChange when toggled', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showTimestamps: true }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show Timestamps'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showTimestamps: false })
    })

    it('can toggle from off to on', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showTimestamps: false }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show Timestamps'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showTimestamps: true })
    })
  })

  describe('Show Level Toggle', () => {
    it('reflects current setting state', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showLevel: false }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const toggle = screen.getByLabelText('Show Level')
      expect(toggle).toHaveAttribute('data-state', 'unchecked')
    })

    it('calls onSettingsChange when toggled', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showLevel: true }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show Level'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showLevel: false })
    })
  })

  describe('Show Source Toggle', () => {
    it('reflects current setting state', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showSource: true }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const toggle = screen.getByLabelText('Show Source')
      expect(toggle).toHaveAttribute('data-state', 'checked')
    })

    it('calls onSettingsChange when toggled', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showSource: true }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show Source'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showSource: false })
    })
  })

  describe('Show System Logs Toggle', () => {
    it('reflects current setting state', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showSystemLogs: true }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const toggle = screen.getByLabelText('Show System Logs')
      expect(toggle).toHaveAttribute('data-state', 'checked')
    })

    it('calls onSettingsChange when toggled off', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showSystemLogs: true }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show System Logs'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showSystemLogs: false })
    })

    it('calls onSettingsChange when toggled on', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, showSystemLogs: false }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))
      await user.click(screen.getByLabelText('Show System Logs'))

      expect(onSettingsChange).toHaveBeenCalledWith({ showSystemLogs: true })
    })
  })

  describe('Accessibility', () => {
    it('popover has role="dialog"', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('toggles are keyboard accessible', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button'))

      const toggle = screen.getByLabelText('Show Timestamps')
      toggle.focus()
      await user.keyboard(' ') // Space to toggle

      expect(onSettingsChange).toHaveBeenCalled()
    })

    it('maintains focus within popover', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      // Focus should be trapped in popover
      const dialog = screen.getByRole('dialog')
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null)
    })

    it('all toggles have proper labels', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const switches = screen.getAllByRole('switch')
      switches.forEach((switchEl) => {
        expect(switchEl).toHaveAccessibleName()
      })
    })
  })

  describe('Integration with Switch Component', () => {
    it('uses shadcn Switch component', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(4) // timestamps, level, source, system logs
    })

    it('switches have correct ARIA attributes', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      const switches = screen.getAllByRole('switch')
      switches.forEach((switchEl) => {
        expect(switchEl).toHaveAttribute('aria-checked')
      })
    })
  })

  describe('Font Size Controls', () => {
    it('displays font size controls in settings popover', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))

      expect(screen.getByText('Text Size')).toBeInTheDocument()
      expect(screen.getByTestId('font-size-display')).toHaveTextContent('12')
    })

    it('increases font size when plus button clicked', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, fontSize: 12 }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))
      await user.click(screen.getByRole('button', { name: /increase text size/i }))

      expect(onSettingsChange).toHaveBeenCalledWith({ fontSize: 13 })
    })

    it('decreases font size when minus button clicked', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onSettingsChange = vi.fn()

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, fontSize: 12 }}
          onSettingsChange={onSettingsChange}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))
      await user.click(screen.getByRole('button', { name: /decrease text size/i }))

      expect(onSettingsChange).toHaveBeenCalledWith({ fontSize: 11 })
    })

    it('disables decrease button at minimum font size (10)', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, fontSize: 10 }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))

      const decreaseButton = screen.getByRole('button', { name: /decrease text size/i })
      expect(decreaseButton).toBeDisabled()
    })

    it('disables increase button at maximum font size (18)', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, fontSize: 18 }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))

      const increaseButton = screen.getByRole('button', { name: /increase text size/i })
      expect(increaseButton).toBeDisabled()
    })

    it('displays current font size value', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={{ ...defaultSettings, fontSize: 14 }}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button', { name: /settings/i }))

      expect(screen.getByTestId('font-size-display')).toHaveTextContent('14')
    })
  })

  describe('Styling', () => {
    it('applies consistent spacing to toggle rows', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      // All toggle rows should have consistent styling
      const labels = screen.getAllByText(/Show/)
      labels.forEach((label) => {
        expect(label.parentElement).toHaveClass('settings-row')
      })
    })

    it('labels are properly aligned with switches', async () => {
      const { ConsoleSettings } = await import('../../../../../src/components/shared/console/console-settings')
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      render(
        <ConsoleSettings
          settings={defaultSettings}
          onSettingsChange={vi.fn()}
        />
      )

      await user.click(screen.getByRole('button'))

      // Each row should have label on left, switch on right
      const rows = screen.getAllByTestId(/settings-row/)
      rows.forEach((row) => {
        expect(row).toHaveClass('flex', 'justify-between', 'items-center')
      })
    })
  })
})
