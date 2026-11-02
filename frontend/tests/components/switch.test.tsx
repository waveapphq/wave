/**
 * Switch Component Tests - REQ-3.4.2.7
 *
 * Tests for the shadcn Switch component used in console settings.
 *
 * Design Reference:
 * - Settings popover uses switches for display options
 * - Show Timestamps, Show Level, Show Source, Single Line Source toggles
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '../../src/components/ui/switch'

describe('Switch Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders switch with default unchecked state', () => {
      render(<Switch />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toBeInTheDocument()
      expect(switchEl).toHaveAttribute('data-state', 'unchecked')
    })

    it('renders switch in checked state when defaultChecked', () => {
      render(<Switch defaultChecked />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('data-state', 'checked')
    })

    it('renders switch in controlled checked state', () => {
      render(<Switch checked={true} onCheckedChange={() => {}} />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('data-state', 'checked')
    })

    it('renders switch in controlled unchecked state', () => {
      render(<Switch checked={false} onCheckedChange={() => {}} />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('data-state', 'unchecked')
    })
  })

  describe('Toggle Behavior', () => {
    it('toggles state on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCheckedChange = vi.fn()

      render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

      await user.click(screen.getByRole('switch'))

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })

    it('toggles from checked to unchecked', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCheckedChange = vi.fn()

      render(<Switch checked={true} onCheckedChange={onCheckedChange} />)

      await user.click(screen.getByRole('switch'))

      expect(onCheckedChange).toHaveBeenCalledWith(false)
    })

    it('toggles with keyboard (Space)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCheckedChange = vi.fn()

      render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

      const switchEl = screen.getByRole('switch')
      switchEl.focus()
      await user.keyboard(' ')

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })

    it('toggles with keyboard (Enter)', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCheckedChange = vi.fn()

      render(<Switch checked={false} onCheckedChange={onCheckedChange} />)

      const switchEl = screen.getByRole('switch')
      switchEl.focus()
      await user.keyboard('{Enter}')

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Disabled State', () => {
    it('does not toggle when disabled', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const onCheckedChange = vi.fn()

      render(<Switch disabled checked={false} onCheckedChange={onCheckedChange} />)

      await user.click(screen.getByRole('switch'))

      expect(onCheckedChange).not.toHaveBeenCalled()
    })

    it('has disabled styling', () => {
      render(<Switch disabled />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toBeDisabled()
      expect(switchEl).toHaveClass('disabled:cursor-not-allowed')
    })

    it('has reduced opacity when disabled', () => {
      render(<Switch disabled />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('disabled:opacity-50')
    })
  })

  describe('Accessibility', () => {
    it('has role="switch"', () => {
      render(<Switch />)

      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('has aria-checked attribute', () => {
      render(<Switch checked={true} onCheckedChange={() => {}} />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-checked', 'true')
    })

    it('supports aria-label', () => {
      render(<Switch aria-label="Toggle setting" />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-label', 'Toggle setting')
    })

    it('supports aria-labelledby', () => {
      render(
        <>
          <label id="label-id">Setting Label</label>
          <Switch aria-labelledby="label-id" />
        </>
      )

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-labelledby', 'label-id')
    })

    it('is focusable', () => {
      render(<Switch />)

      const switchEl = screen.getByRole('switch')
      switchEl.focus()

      expect(document.activeElement).toBe(switchEl)
    })

    it('shows focus ring on focus', () => {
      render(<Switch />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('focus-visible:ring-2')
    })
  })

  describe('Styling', () => {
    it('accepts custom className', () => {
      render(<Switch className="custom-class" />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('custom-class')
    })

    it('has correct base classes', () => {
      render(<Switch />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('peer', 'inline-flex', 'cursor-pointer')
    })

    it('has checked styling', () => {
      render(<Switch checked={true} onCheckedChange={() => {}} />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('data-[state=checked]:bg-primary')
    })

    it('has unchecked styling', () => {
      render(<Switch checked={false} onCheckedChange={() => {}} />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveClass('data-[state=unchecked]:bg-input')
    })
  })

  describe('Thumb Component', () => {
    it('renders thumb inside switch', () => {
      render(<Switch />)

      const switchEl = screen.getByRole('switch')
      const thumb = switchEl.querySelector('[class*="rounded-full"][class*="bg-background"]')
      expect(thumb).toBeInTheDocument()
    })

    it('thumb moves on state change', () => {
      const { rerender } = render(<Switch checked={false} onCheckedChange={() => {}} />)

      let switchEl = screen.getByRole('switch')
      let thumb = switchEl.querySelector('[class*="rounded-full"][class*="bg-background"]')
      expect(thumb).toHaveClass('data-[state=unchecked]:translate-x-0')

      rerender(<Switch checked={true} onCheckedChange={() => {}} />)

      switchEl = screen.getByRole('switch')
      thumb = switchEl.querySelector('[class*="rounded-full"][class*="bg-background"]')
      expect(thumb).toHaveClass('data-[state=checked]:translate-x-4')
    })
  })

  describe('Ref Forwarding', () => {
    it('forwards ref to switch element', () => {
      const ref = { current: null as HTMLButtonElement | null }

      render(<Switch ref={ref} />)

      expect(ref.current).toBeInstanceOf(HTMLButtonElement)
      expect(ref.current).toBe(screen.getByRole('switch'))
    })

    it('forwards function ref to switch element', () => {
      let refNode: HTMLButtonElement | null = null
      const refCallback = (node: HTMLButtonElement | null) => {
        refNode = node
      }

      render(<Switch ref={refCallback} />)

      expect(refNode).toBeInstanceOf(HTMLButtonElement)
      expect(refNode).toBe(screen.getByRole('switch'))
    })

    it('handles function ref with name attribute', () => {
      let refNode: HTMLButtonElement | null = null
      const refCallback = (node: HTMLButtonElement | null) => {
        refNode = node
      }

      render(<Switch ref={refCallback} name="test-switch" />)

      expect(refNode).toBeInstanceOf(HTMLButtonElement)
      expect(refNode).toHaveAttribute('name', 'test-switch')
    })
  })

  describe('Form Integration', () => {
    it('supports name attribute', () => {
      render(<Switch name="setting" />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('name', 'setting')
    })

    it('supports required attribute', () => {
      render(<Switch required />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-required', 'true')
    })

    it('supports value attribute', () => {
      render(<Switch value="on" />)

      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('value', 'on')
    })
  })
})
