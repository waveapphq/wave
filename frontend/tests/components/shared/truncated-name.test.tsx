/**
 * TruncatedName Tests
 *
 * Tests for the shared TruncatedName component extracted from
 * column-factories.tsx so it can be reused by the canvas breadcrumb.
 * The component MUST behave identically to the original:
 *   - Span trigger when no onClick, button trigger when onClick is set
 *   - The shared WAVE tooltip is shown only when the inner text actually
 *     clips (scrollWidth - clientWidth > 1)
 *   - Long names wrap, through the shared component's wide variant rather
 *     than this component's own portal and placement maths (SHELL-7a)
 *   - ResizeObserver-gated re-measurement
 */

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TruncatedName } from '@/components/shared/truncated-name'

function withForcedTruncation(scrollWidth: number, clientWidth: number, body: () => Promise<void> | void) {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth
    },
  })
  return Promise.resolve(body()).finally(() => {
    if (scrollDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollDescriptor)
    }
    if (clientDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientDescriptor)
    }
  })
}

/** The shared tooltip marks its popup with the slot the key badge styles against. */
function sharedPopup(): HTMLElement | null {
  return document.querySelector('[data-slot="tooltip-content"]')
}

function reveal(testId: string): void {
  act(() => {
    fireEvent.focus(screen.getByTestId(testId))
  })
}

describe('TruncatedName', () => {
  it('renders a span when no onClick is provided', () => {
    render(<TruncatedName value="Plain Name" testId="plain-name" />)
    const el = screen.getByTestId('plain-name')
    expect(el.tagName).toBe('SPAN')
    expect(el).toHaveTextContent('Plain Name')
  })

  it('renders a button when onClick is provided', () => {
    const handleClick = vi.fn()
    render(<TruncatedName value="Clickable Name" testId="clickable-name" onClick={handleClick} />)
    const el = screen.getByTestId('clickable-name')
    expect(el.tagName).toBe('BUTTON')
  })

  it('fires onClick when the trigger is clicked', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()
    render(<TruncatedName value="Click Me" testId="click-me" onClick={handleClick} />)
    await user.click(screen.getByTestId('click-me'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('forwards ariaLabel onto the button trigger', () => {
    render(
      <TruncatedName
        value="My Entity"
        testId="aria-labeled"
        onClick={vi.fn()}
        ariaLabel="Open My Entity"
      />
    )
    const el = screen.getByTestId('aria-labeled')
    expect(el).toHaveAttribute('aria-label', 'Open My Entity')
  })

  it('shows no hint when the text fits (no clipping)', async () => {
    // jsdom reports scrollWidth = clientWidth = 0 by default. With the
    // 1px slack rule (scrollWidth - clientWidth > 1) the tooltip stays
    // gated off in this baseline state.
    render(<TruncatedName value="Short" testId="short-name" />)
    reveal('short-name')
    expect(sharedPopup()).toBeNull()
  })

  it('shows the full name through the shared tooltip when the text clips', async () => {
    await withForcedTruncation(800, 200, () => {
      const longName = 'A very long entity name that definitely clips inside its container'
      render(<TruncatedName value={longName} testId="long-name" />)

      reveal('long-name')

      expect(sharedPopup()).toBeInTheDocument()
      expect(sharedPopup()).toHaveTextContent(longName)
    })
  })

  it('wraps long names through the shared wide variant', async () => {
    await withForcedTruncation(800, 200, () => {
      const longName = 'Multiline tooltip wraps across lines for visual clarity'
      render(<TruncatedName value={longName} testId="multiline-name" />)

      reveal('multiline-name')

      expect(sharedPopup()?.className).toMatch(/whitespace-normal/)
    })
  })

  it('keeps no portal or placement maths of its own', async () => {
    await withForcedTruncation(800, 200, () => {
      render(<TruncatedName value="A clipped entity name" testId="one-popup" />)

      reveal('one-popup')

      expect(document.querySelectorAll('[data-slot="tooltip-content"]')).toHaveLength(1)
    })
  })

  it('renders the `leading` slot before the text inside the trigger', () => {
    render(
      <TruncatedName
        value="With Icon"
        testId="with-leading"
        leading={<span data-testid="leading-marker">icon</span>}
      />
    )
    const trigger = screen.getByTestId('with-leading')
    expect(trigger.querySelector('[data-testid="leading-marker"]')).not.toBeNull()
    expect(trigger).toHaveTextContent('With Icon')
  })
})
