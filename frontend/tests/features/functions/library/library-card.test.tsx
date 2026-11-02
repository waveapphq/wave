/**
 * Tests for `LibraryCard` (FN-LC-8).
 *
 * The card is the unit-of-display in the populated Functions Library modal:
 *
 *   Library card: Icon + name (bold) on row 1; 1-line description (truncate)
 *   on row 2; tag chips on row 3; NO S badge.
 *
 * Plus: the card is the drag source onto the canvas (`draggable="true"`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LibraryCard } from '@/features/functions/library/library-card'
import { ENABLED_TOOLTIP_DELAY_MS } from '@/components/ui/tooltip'

import type { FunctionSummary } from '@/features/functions/api/types'

function makeSummary(overrides: Partial<FunctionSummary> = {}): FunctionSummary {
  return {
    id: 'fn-1',
    name: 'Greet User',
    description: 'Greets a named user with a salutation.',
    tags: ['demo', 'greet'],
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
    // REQ-3.1.2.2: latest_version is propagated from the
    // /functions list response so the card can render the version pill.
    latest_version: '1.0.0',
    ...overrides,
  } as FunctionSummary
}


describe('LibraryCard - structure', () => {
  it('renders the Function name in row 1', () => {
    render(<LibraryCard function={makeSummary({ name: 'Greet User' })} />)
    expect(screen.getByText('Greet User')).toBeInTheDocument()
  })

  it('renders the 1-line description (truncated visually)', () => {
    render(
      <LibraryCard
        function={makeSummary({ description: 'A long description that the card truncates after the first line for layout.' })}
      />,
    )
    expect(
      screen.getByText(/A long description that the card truncates/),
    ).toBeInTheDocument()
  })

  it('renders all tag chips supplied by the summary', () => {
    render(
      <LibraryCard function={makeSummary({ tags: ['alpha', 'beta', 'gamma'] })} />,
    )
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(screen.getByText('gamma')).toBeInTheDocument()
  })

  it('omits the description paragraph entirely when description is empty', () => {
    const { container } = render(
      <LibraryCard function={makeSummary({ description: '' })} />,
    )
    // No description text node, no muted paragraph in the card body.
    const card = container.querySelector('[data-testid="library-card"]')
    expect(card?.querySelector('p.text-muted-foreground')).toBeNull()
  })

  it('omits the tag row entirely when tags is empty', () => {
    const { container } = render(
      <LibraryCard function={makeSummary({ tags: [] })} />,
    )
    expect(container.querySelector('[data-testid="library-card-tags"]')).toBeNull()
  })

  it('renders no footer at all when there are no tags and no version', () => {
    const { container } = render(
      <LibraryCard
        function={makeSummary({
          tags: [],
          latest_version: undefined,
        } as Partial<FunctionSummary>)}
      />,
    )
    // Neither branch of CardTagsFooter applies (no tags, no version), so the
    // footer collapses to nothing: no tags row, no version pill.
    expect(container.querySelector('[data-testid="library-card-tags"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="library-card-version-pill"]'),
    ).toBeNull()
  })

  it('does NOT render an S badge on the card (FN-LC-8 explicit exclusion)', () => {
    const { container } = render(
      <LibraryCard function={makeSummary({ name: 'No Badge' })} />,
    )
    // The shared `LifecycleBadge` for published Functions exposes the
    // testid `lifecycle-badge`; it must not appear inside cards.
    expect(container.querySelector('[data-testid="lifecycle-badge"]')).toBeNull()
  })
})


// ===========================================================================
// Version pill (REQ-3.1.2.2)
// ===========================================================================


describe('LibraryCard - version pill (FN-VER-12, FN-VER-13)', () => {
  it('renders the latest_version pill in the row 3 bottom-right', () => {
    render(
      <LibraryCard
        function={makeSummary({ latest_version: '2.0.0' } as Partial<FunctionSummary>)}
      />,
    )
    const pill = screen.getByTestId('library-card-version-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent('2.0.0')
  })

  it('version pill uses the indigo / mono-font S-badge palette', () => {
    render(
      <LibraryCard
        function={makeSummary({ latest_version: '1.4.2' } as Partial<FunctionSummary>)}
      />,
    )
    const pill = screen.getByTestId('library-card-version-pill')
    expect(pill.className).toMatch(/font-mono/)
    expect(pill.className).toMatch(/indigo/)
  })

  it('renders the tags row but no version pill when tags exist and latest_version is absent', () => {
    // CardTagsFooter takes the `fn.tags.length > 0` branch, but the
    // bottom-right `fn.latest_version ? <VersionPill/> : null` must resolve to
    // the null side because the summary carries no version.
    const { container } = render(
      <LibraryCard
        function={makeSummary({
          tags: ['demo', 'greet'],
          latest_version: undefined,
        } as Partial<FunctionSummary>)}
      />,
    )
    expect(container.querySelector('[data-testid="library-card-tags"]')).not.toBeNull()
    expect(
      container.querySelector('[data-testid="library-card-version-pill"]'),
    ).toBeNull()
  })
})


describe('LibraryCard - name truncation tooltip', () => {
  // JSDOM reports `scrollWidth === clientWidth === 0` for every element, so
  // the production "tooltip-only-when-truncated" logic must be driven by
  // pre-faking those props on the name span. The original descriptors live
  // on `Element.prototype` (not HTMLElement), so our override is installed
  // there and afterEach puts the original descriptors back.
  function fakeNameMetrics(scrollWidth: number, clientWidth: number): void {
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get(this: Element) {
        if (this.getAttribute('data-testid') === 'library-card-name') {
          return scrollWidth
        }
        return 0
      },
    })
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        if (this.getAttribute('data-testid') === 'library-card-name') {
          return clientWidth
        }
        return 0
      },
    })
  }
  // jsdom's own getters live on Element.prototype too, so they are put back rather than deleted.
  const jsdomScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
  const jsdomClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  afterEach(() => {
    if (jsdomScrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', jsdomScrollWidth)
    if (jsdomClientWidth) Object.defineProperty(Element.prototype, 'clientWidth', jsdomClientWidth)
    delete (document as unknown as Record<string, unknown>).fonts
  })

  it('renders the name span with `cursor-help` when the name is truncated', () => {
    fakeNameMetrics(800, 120)
    render(
      <LibraryCard
        function={makeSummary({
          name: 'A very long function name that will not fit in the card row',
        })}
      />,
    )
    const nameSpan = screen.getByTestId('library-card-name')
    expect(nameSpan.className).toMatch(/cursor-help/)
  })

  it('does NOT add `cursor-help` when the name fits the row', () => {
    fakeNameMetrics(100, 120)
    render(<LibraryCard function={makeSummary({ name: 'short' })} />)
    const nameSpan = screen.getByTestId('library-card-name')
    expect(nameSpan.className).not.toMatch(/cursor-help/)
  })

  it('exposes the full name to assistive tech via aria-label', () => {
    const fullName = 'A very long function name that will not fit in the card row'
    render(<LibraryCard function={makeSummary({ name: fullName })} />)
    const nameSpan = screen.getByTestId('library-card-name')
    expect(nameSpan).toHaveAttribute('aria-label', fullName)
  })

  it('shows the shared ConditionalTooltip with the full name on hover (truncated case)', async () => {
    fakeNameMetrics(800, 120)
    const fullName = 'A very long function name that will not fit in the card row'
    const user = userEvent.setup()
    render(<LibraryCard function={makeSummary({ name: fullName })} />)
    const nameSpan = screen.getByTestId('library-card-name')
    await user.hover(nameSpan)
    // ConditionalTooltip lazily mounts the tooltip surface; wait for the
    // role="tooltip" element with the full name to appear.
    const tooltips = await screen.findAllByRole('tooltip')
    expect(tooltips.some((node) => node.textContent === fullName)).toBe(true)
  })

  it('does NOT render a tooltip when the name fits the row', async () => {
    fakeNameMetrics(100, 120)
    const user = userEvent.setup()
    render(<LibraryCard function={makeSummary({ name: 'short' })} />)
    const nameSpan = screen.getByTestId('library-card-name')
    await user.hover(nameSpan)
    // ConditionalTooltip received `content={undefined}` (not truncated),
    // so no role="tooltip" element should appear.
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('re-measures truncation on window resize (font-swap fallback)', () => {
    // Mount with metrics that fit (not truncated): no cursor-help yet.
    fakeNameMetrics(100, 120)
    render(
      <LibraryCard
        function={makeSummary({
          name: 'A very long function name that will not fit in the card row',
        })}
      />,
    )
    expect(
      screen.getByTestId('library-card-name').className,
    ).not.toMatch(/cursor-help/)

    // Swap to overflowing metrics, then fire the window `resize` event the
    // defensive useEffect listener handles. The handler re-reads the span's
    // scroll/client widths and flips isTruncated -> true. The ConditionalTooltip
    // swaps its child node when content appears, so re-query after the event.
    delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth
    delete (Element.prototype as unknown as Record<string, unknown>).clientWidth
    fakeNameMetrics(800, 120)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(
      screen.getByTestId('library-card-name').className,
    ).toMatch(/cursor-help/)
  })

  it('resize handler no-ops when the name span ref is gone', () => {
    // Capture the registered resize handler, unmount the card (which nulls
    // spanRef.current), then invoke the handler: the `if (!el) return` guard
    // must short-circuit without throwing on a null ref.
    // Collect EVERY resize registration - the card's own sits among the
    // tooltip positioning listeners, and which one lands last is not ours to
    // depend on.
    const resizeHandlers: EventListenerOrEventListenerObject[] = []
    const addSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((type, handler) => {
        if (type === 'resize' && handler) resizeHandlers.push(handler)
      })
    fakeNameMetrics(100, 120)
    const { unmount } = render(
      <LibraryCard function={makeSummary({ name: 'short' })} />,
    )
    addSpy.mockRestore()
    expect(resizeHandlers.length).toBeGreaterThan(0)

    unmount()
    expect(() =>
      act(() => {
        for (const handler of resizeHandlers) (handler as EventListener)(new Event('resize'))
      }),
    ).not.toThrow()
  })

  it('clears truncation on window resize when the name once again fits', () => {
    // Mount truncated, then resize back to a fitting width.
    fakeNameMetrics(800, 120)
    render(
      <LibraryCard
        function={makeSummary({
          name: 'A very long function name that will not fit in the card row',
        })}
      />,
    )
    expect(
      screen.getByTestId('library-card-name').className,
    ).toMatch(/cursor-help/)

    delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth
    delete (Element.prototype as unknown as Record<string, unknown>).clientWidth
    fakeNameMetrics(100, 120)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(
      screen.getByTestId('library-card-name').className,
    ).not.toMatch(/cursor-help/)
  })

  it('re-measures when the document fonts finish loading (late font swap)', async () => {
    // A font swap changes the TEXT width without changing the span's box, so
    // neither ResizeObserver nor a window resize fires - fonts.ready is the
    // only signal. Mount truncated under the fallback font, then "load" the
    // narrower webfont (metrics now fit) and resolve fonts.ready.
    let resolveFonts: () => void = () => {}
    const ready = new Promise<void>((resolve) => {
      resolveFonts = resolve
    })
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready },
    })

    fakeNameMetrics(800, 120)
    render(
      <LibraryCard
        function={makeSummary({
          name: 'A very long function name that will not fit in the card row',
        })}
      />,
    )
    expect(
      screen.getByTestId('library-card-name').className,
    ).toMatch(/cursor-help/)

    delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth
    delete (Element.prototype as unknown as Record<string, unknown>).clientWidth
    fakeNameMetrics(100, 120)
    await act(async () => {
      resolveFonts()
      await ready
    })
    expect(
      screen.getByTestId('library-card-name').className,
    ).not.toMatch(/cursor-help/)
  })
})


describe('LibraryCard - tag overflow `(+N)` chip', () => {
  it('renders a `(+N)` chip when there are more tags than fit', () => {
    render(
      <LibraryCard
        function={makeSummary({
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        })}
      />,
    )
    // The exact split (N visible + (+M) chip) is implementation-controlled;
    // the assertion is that the overflow chip is rendered when there are
    // many tags.
    expect(screen.getByTestId('library-card-tag-overflow')).toBeInTheDocument()
  })

  it('omits the overflow chip when all tags fit', () => {
    render(
      <LibraryCard function={makeSummary({ tags: ['demo', 'greet'] })} />,
    )
    expect(screen.queryByTestId('library-card-tag-overflow')).toBeNull()
  })

  it('exposes the full tag list to assistive tech via aria-label on the chip', () => {
    render(
      <LibraryCard
        function={makeSummary({
          tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        })}
      />,
    )
    const chip = screen.getByTestId('library-card-tag-overflow')
    const aria = chip.getAttribute('aria-label') ?? ''
    // The chip's aria-label lists every tag (comma-separated).
    for (const tag of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(aria).toContain(tag)
    }
  })

  it('hovering the overflow chip surfaces the full tag list in a tooltip', async () => {
    const user = userEvent.setup()
    render(
      <LibraryCard
        function={makeSummary({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })}
      />,
    )
    const chip = screen.getByTestId('library-card-tag-overflow')
    await user.hover(chip)
    // Tooltip body lists every tag joined by commas; assert the tooltip
    // textContent covers the first + last entries.
    const tooltips = await screen.findAllByRole('tooltip')
    const body = tooltips.map((node) => node.textContent ?? '').join('\n')
    expect(body).toMatch(/a/)
    expect(body).toMatch(/g/)
  })

  it('hover shows the full tag list in the shared tooltip, outside the chip, and leaving hides it', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <LibraryCard
          function={makeSummary({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })}
        />,
      )
      const chip = screen.getByTestId('library-card-tag-overflow')
      act(() => {
        fireEvent.pointerEnter(chip, { pointerType: 'mouse' })
        fireEvent.mouseEnter(chip)
        fireEvent.pointerMove(chip, { pointerType: 'mouse' })
      })
      act(() => {
        vi.advanceTimersByTime(ENABLED_TOOLTIP_DELAY_MS + 1)
      })
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent(/^a, b, c, d, e, f, g$/)
      expect(chip).not.toContainElement(tooltip)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument()

      act(() => {
        fireEvent.pointerLeave(chip, { pointerType: 'mouse' })
        fireEvent.mouseLeave(chip)
      })
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus shows the full tag list in the shared tooltip at once, and blur hides it (keyboard a11y)', () => {
    render(
      <LibraryCard
        function={makeSummary({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })}
      />,
    )
    const chip = screen.getByTestId('library-card-tag-overflow')
    act(() => {
      fireEvent.focus(chip)
    })
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(/^a, b, c, d, e, f, g$/)
    expect(chip).not.toContainElement(tooltip)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeInTheDocument()

    act(() => {
      fireEvent.blur(chip)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('draws the chip text alone, with no tooltip inside it', () => {
    render(
      <LibraryCard
        function={makeSummary({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })}
      />,
    )
    const chip = screen.getByTestId('library-card-tag-overflow')
    act(() => {
      fireEvent.focus(chip)
    })
    expect(chip.querySelector('[role="tooltip"]')).toBeNull()
    expect(chip.textContent).toMatch(/^\+\d+$/)
  })
})


describe('LibraryCard - drag affordance', () => {
  it('renders with draggable=true so the canvas DnD pipeline accepts it', () => {
    const { container } = render(<LibraryCard function={makeSummary()} />)
    const root = container.querySelector('[data-testid="library-card"]')
    expect(root?.getAttribute('draggable')).toBe('true')
  })

  it('invokes onDragStart with the function id when supplied', () => {
    const onDragStart = vi.fn()
    const { container } = render(
      <LibraryCard function={makeSummary({ id: 'fn-42' })} onDragStart={onDragStart} />,
    )
    const root = container.querySelector(
      '[data-testid="library-card"]',
    ) as HTMLElement
    fireEvent.dragStart(root, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' },
    })
    expect(onDragStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fn-42' }),
      expect.anything(),
    )
  })

  // The card MUST set its payload on `application/wave-block` with
  // `type: 'function-published'`; the canvas drop handler reads exactly that.
  it('writes payload to application/wave-block with type=function-published', () => {
    const setData = vi.fn()
    const { container } = render(
      <LibraryCard function={makeSummary({ id: 'fn-42', name: 'Helper' })} />,
    )
    const root = container.querySelector(
      '[data-testid="library-card"]',
    ) as HTMLElement
    fireEvent.dragStart(root, {
      dataTransfer: { setData, effectAllowed: '', dropEffect: '' },
    })
    expect(setData).toHaveBeenCalledWith(
      'application/wave-block',
      expect.stringContaining('"type":"function-published"'),
    )
    const [, payloadJson] = setData.mock.calls[0]!
    const payload = JSON.parse(payloadJson as string)
    expect(payload).toMatchObject({
      type: 'function-published',
      functionId: 'fn-42',
      name: 'Helper',
    })
  })

  // effectAllowed MUST be 'move', matching the canvas's dropEffect='move';
  // HTML5 DnD rejects a 'copy' source on a 'move' target.
  it("sets dataTransfer.effectAllowed = 'move' so the canvas accepts the drop", () => {
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const { container } = render(<LibraryCard function={makeSummary()} />)
    const root = container.querySelector(
      '[data-testid="library-card"]',
    ) as HTMLElement
    fireEvent.dragStart(root, { dataTransfer })
    expect(dataTransfer.effectAllowed).toBe('move')
  })
})
