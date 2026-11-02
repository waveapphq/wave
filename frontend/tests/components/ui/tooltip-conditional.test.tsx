/**
 * The one WAVE tooltip (SHELL-7, REQ-5.2.1.17).
 *
 * A call site chooses only the delay, the side/align, the wide variant, and whether there
 * is content at all; surface, arrow, stacking, Escape, close-on-leave and
 * not-shown-on-touch are fixed here and are not per-site options.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const viewportHook = vi.hoisted(() => ({ useViewport: vi.fn() }))

vi.mock('@/hooks/use-viewport', () => viewportHook)

import { useViewport } from '@/hooks/use-viewport'
import * as tooltipModule from '@/components/ui/tooltip'
import {
  ConditionalTooltip,
  DISABLED_TOOLTIP_DELAY_MS,
  ENABLED_TOOLTIP_DELAY_MS,
} from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'

function popup(): HTMLElement | null {
  return document.querySelector('[data-slot="tooltip-content"]')
}

function trigger(): HTMLElement {
  return screen.getByTestId('trigger')
}

function renderTooltip(props: Partial<React.ComponentProps<typeof ConditionalTooltip>> = {}) {
  return render(
    <ConditionalTooltip content="Configure" {...props}>
      <button data-testid="trigger" type="button">
        go
      </button>
    </ConditionalTooltip>,
  )
}

/** Radix opens on keyboard focus without waiting out the hover delay. */
function revealByFocus(): void {
  act(() => {
    fireEvent.focus(trigger())
  })
}

function hover(): void {
  act(() => {
    fireEvent.pointerEnter(trigger(), { pointerType: 'mouse' })
    fireEvent.pointerMove(trigger(), { pointerType: 'mouse' })
  })
}

function setTouchPoints(value: number): void {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    writable: true,
    value,
  })
}

beforeEach(() => {
  vi.mocked(useViewport).mockClear()
})

describe('ConditionalTooltip - empty content passthrough', () => {
  it('renders children unchanged when content is undefined', () => {
    renderTooltip({ content: undefined })
    expect(trigger()).toBeInTheDocument()
    expect(popup()).toBeNull()
  })

  it('renders children unchanged when content is null', () => {
    renderTooltip({ content: null })
    expect(trigger()).toBeInTheDocument()
  })

  it('renders children unchanged when content is the empty string', () => {
    renderTooltip({ content: '' })
    expect(trigger()).toBeInTheDocument()
  })
})

describe('ConditionalTooltip - reveal', () => {
  it('shows the hint on keyboard focus', () => {
    renderTooltip()

    revealByFocus()

    expect(popup()).toBeInTheDocument()
    expect(popup()).toHaveTextContent('Configure')
  })

  it('carries the slot marker the shared key badge styles against', () => {
    renderTooltip({
      content: (
        <span>
          Configure <Kbd>Enter</Kbd>
        </span>
      ),
    })

    revealByFocus()

    expect(popup()).toHaveAttribute('data-slot', 'tooltip-content')
    expect(popup()?.querySelector('[data-slot="kbd"]')).toBeInTheDocument()
  })

  it('anchors where the call site asks', () => {
    renderTooltip({ side: 'bottom' })

    revealByFocus()

    expect(popup()).toHaveAttribute('data-side', 'bottom')
  })

  it('defaults to the top side', () => {
    renderTooltip()

    revealByFocus()

    expect(popup()).toHaveAttribute('data-side', 'top')
  })

  it('draws an arrow pointing at the trigger', () => {
    renderTooltip()

    revealByFocus()

    expect(document.querySelector('[data-slot="tooltip-arrow"]')).toBeInTheDocument()
  })
})

describe('ConditionalTooltip - surface (SHELL-7)', () => {
  it('sits on the menu surface rather than the primary accent', () => {
    renderTooltip()

    revealByFocus()

    const className = popup()?.className ?? ''
    expect(className).toContain('bg-popover')
    expect(className).not.toContain('bg-primary')
    expect(className).not.toContain('bg-foreground')
  })

  it('is outlined and lifted off the page', () => {
    renderTooltip()

    revealByFocus()

    const className = popup()?.className ?? ''
    expect(className).toContain('border')
    expect(className).toContain('shadow-md')
  })

  it('keeps long copy on one line by default', () => {
    renderTooltip()

    revealByFocus()

    expect(popup()?.className).toContain('whitespace-nowrap')
  })

  it('wraps and caps the width in the wide variant', () => {
    renderTooltip({ wide: true })

    revealByFocus()

    const className = popup()?.className ?? ''
    expect(className).toContain('whitespace-normal')
    expect(className).not.toContain('whitespace-nowrap')
  })

  it('caps the fixed wide variant at 26rem whatever the screen width', () => {
    renderTooltip({ wide: 'fixed' })

    revealByFocus()

    const className = popup()?.className ?? ''
    expect(className).toContain('max-w-[26rem]')
    expect(className).toContain('whitespace-normal')
    expect(className).not.toContain('max-w-[30vw]')
  })
})

describe('ConditionalTooltip - timing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits out the standard delay on hover', () => {
    renderTooltip()

    hover()
    act(() => {
      vi.advanceTimersByTime(ENABLED_TOOLTIP_DELAY_MS - 1)
    })
    expect(popup()).toBeNull()

    act(() => {
      vi.advanceTimersByTime(2)
    })
    expect(popup()).toBeInTheDocument()
  })

  it('answers faster for a control whose click does nothing', () => {
    renderTooltip({ disabled: true })

    hover()
    act(() => {
      vi.advanceTimersByTime(DISABLED_TOOLTIP_DELAY_MS + 1)
    })

    expect(popup()).toBeInTheDocument()
  })

  it('honors an explicit delay override', () => {
    renderTooltip({ delayMs: 0 })

    hover()
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(popup()).toBeInTheDocument()
  })

  it('keeps the two shared timings distinct', () => {
    expect(DISABLED_TOOLTIP_DELAY_MS).toBeLessThan(ENABLED_TOOLTIP_DELAY_MS)
  })
})

describe('ConditionalTooltip - dismissal', () => {
  it('closes on Escape', async () => {
    renderTooltip()
    revealByFocus()
    expect(popup()).toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(popup()).toBeNull()
  })

  it('closes when the pointer leaves the trigger', () => {
    renderTooltip()
    revealByFocus()
    expect(popup()).toBeInTheDocument()

    act(() => {
      fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' })
      fireEvent.blur(trigger())
    })

    expect(popup()).toBeNull()
  })
})

describe('ConditionalTooltip - opened by code (FIELD-2, FIELD-6)', () => {
  it('shows the hint when open is true, with no hover or focus', () => {
    renderTooltip({ open: true })

    expect(popup()).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^Configure$/)
  })

  it('hides the hint again when open turns false', () => {
    const view = renderTooltip({ open: true })
    expect(popup()).toBeInTheDocument()

    view.rerender(
      <ConditionalTooltip content="Configure" open={false}>
        <button data-testid="trigger" type="button">
          go
        </button>
      </ConditionalTooltip>,
    )

    expect(popup()).toBeNull()
  })

  it('stays hidden on focus while open is false, and reports the request', () => {
    const onOpenChange = vi.fn()
    renderTooltip({ open: false, onOpenChange })

    revealByFocus()

    expect(popup()).toBeNull()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('reports a close on Escape while open is true', () => {
    const onOpenChange = vi.fn()
    renderTooltip({ open: true, onOpenChange })

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports a close when the pointer leaves while open is true', () => {
    const onOpenChange = vi.fn()
    renderTooltip({ open: true, onOpenChange })

    act(() => {
      fireEvent.pointerLeave(trigger(), { pointerType: 'mouse' })
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the call site side when opened by code', () => {
    renderTooltip({ open: true, side: 'bottom' })

    expect(popup()).toHaveAttribute('data-side', 'bottom')
  })

  it('renders the bare trigger for empty content even when open is true', () => {
    renderTooltip({ content: '', open: true })

    expect(trigger()).toBeInTheDocument()
    expect(popup()).toBeNull()
  })
})

describe('ConditionalTooltip - hover with open left unset', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('still opens after the standard delay and reports through onOpenChange', () => {
    const onOpenChange = vi.fn()
    renderTooltip({ onOpenChange })

    hover()
    act(() => {
      vi.advanceTimersByTime(ENABLED_TOOLTIP_DELAY_MS + 1)
    })

    expect(popup()).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })
})

describe('ConditionalTooltip - touch (REQ-5.2.1.17, SHELL-7b)', () => {
  let originalTouchPoints: number

  beforeEach(() => {
    originalTouchPoints = navigator.maxTouchPoints
    setTouchPoints(5)
  })

  afterEach(() => {
    setTouchPoints(originalTouchPoints)
  })

  it('renders the trigger with no hint on a touch viewport', () => {
    renderTooltip()

    revealByFocus()

    expect(trigger()).toBeInTheDocument()
    expect(popup()).toBeNull()
  })

  it('offers no way to force the hint back on', () => {
    renderTooltip({ delayMs: 0 })

    hover()

    expect(popup()).toBeNull()
  })

  it('shows no hint on a touch viewport even when open is true', () => {
    renderTooltip({ open: true })

    expect(trigger()).toBeInTheDocument()
    expect(popup()).toBeNull()
  })
})

describe('ConditionalTooltip - no viewport subscription', () => {
  it('answers the touch question without instantiating the viewport hook', () => {
    renderTooltip()

    revealByFocus()

    expect(popup()).toBeInTheDocument()
    expect(vi.mocked(useViewport)).not.toHaveBeenCalled()
  })
})

describe('tooltip module surface', () => {
  const REMOVED = [
    'ResponsiveTooltip',
    'Tooltip',
    'RadixTooltipRoot',
    'TooltipTrigger',
    'TooltipContent',
  ]

  it.each(REMOVED)('no longer exports %s', (name) => {
    expect(name in tooltipModule).toBe(false)
  })

  it('exports the one component and its two timings', () => {
    expect(typeof tooltipModule.ConditionalTooltip).toBe('function')
    expect(typeof tooltipModule.ENABLED_TOOLTIP_DELAY_MS).toBe('number')
    expect(typeof tooltipModule.DISABLED_TOOLTIP_DELAY_MS).toBe('number')
  })
})
