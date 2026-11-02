/**
 * DraggableSheet primitive tests (CANVAS-227..230).
 *
 * Shared non-blocking floating panel promoted from the Functions Library
 * modal's drag pattern. Contract under test:
 *   - open/closed rendering (`<section aria-label>` shell, no overlay)
 *   - every sheet is its own window, mounted at viewport level
 *   - header drag updates the centered-offset transform
 *   - viewport clamping during drag and on ResizeObserver re-clamp
 *   - ESC closes the front-most sheet only (module z-ordering)
 *   - click-outside never dismisses
 *   - pointer-down brings a sheet to front (monotonic z-counter)
 *   - width resize via the shared DialogResizeHandle (520-1200 clamp)
 */

import { createRef, useEffect, useRef, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import {
  DraggableSheet,
  focusSheet,
  pulseSheet,
  refocusSheet,
  openOrRefocus,
  useSheetOpener,
  hasOpenModalDialog,
  type SheetHandle,
} from '@/components/shared/draggable-sheet'

function renderSheet(
  props: Partial<React.ComponentProps<typeof DraggableSheet>> = {},
) {
  return render(
    <DraggableSheet
      open
      onClose={() => {}}
      ariaLabel="Test Sheet"
      header={<span>Sheet Header</span>}
      data-testid="test-sheet"
      {...props}
    >
      <p>Sheet body</p>
    </DraggableSheet>,
  )
}

function getRoot(name = /test sheet/i): HTMLElement {
  return screen.getByRole('region', { name })
}

function getHandle(testid = 'test-sheet'): HTMLElement {
  return screen.getByTestId(`${testid}-drag-handle`)
}

function withElementSize(width: number, height: number, run: () => void): void {
  const widthSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
    .mockReturnValue(width)
  const heightSpy = vi
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockReturnValue(height)
  try {
    run()
  } finally {
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  }
}

beforeEach(() => {
  window.innerWidth = 1200
  window.innerHeight = 800
  localStorage.clear()
})

afterEach(() => {
  window.innerWidth = 1280
  window.innerHeight = 800
})

describe('DraggableSheet - open/closed rendering', () => {
  it('renders nothing when open is false', () => {
    renderSheet({ open: false })
    expect(
      screen.queryByRole('region', { name: /test sheet/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a region with the given aria-label, header, and children', () => {
    renderSheet()
    expect(getRoot()).toBeInTheDocument()
    expect(screen.getByText('Sheet Header')).toBeInTheDocument()
    expect(screen.getByText('Sheet body')).toBeInTheDocument()
  })

  it('starts centered with a zero offset transform by default', () => {
    renderSheet()
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
  })

  it('applies initialOffset to the starting transform (cascade support)', () => {
    renderSheet({ initialOffset: { x: 28, y: 28 } })
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 28px), calc(-50% + 28px))',
    )
  })

  it('exposes a drag handle derived from the data-testid', () => {
    renderSheet()
    expect(getHandle()).toBeInTheDocument()
  })
})

describe('DraggableSheet - header drag', () => {
  it('updates the transform when the header is dragged', () => {
    renderSheet()
    const handle = getHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 30px), calc(-50% + 45px))',
    )
  })

  it('ignores pointerdown for non-primary buttons', () => {
    renderSheet()
    const handle = getHandle()
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200, clientY: 200 })
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
  })

  it('stops following the pointer after pointerup', () => {
    renderSheet()
    const handle = getHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 500 })
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 30px), calc(-50% + 45px))',
    )
  })

  it('clamps the drag offset so the sheet stays inside the viewport', () => {
    renderSheet()
    const handle = getHandle()
    withElementSize(400, 200, () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10000, clientY: 10000 })
    })
    // max x = 1200/2 - 200 = 400; max y = 800/2 - 100 = 300
    expect(getRoot().style.transform).toContain('400')
    expect(getRoot().style.transform).toContain('300')
  })
})

describe('DraggableSheet - ResizeObserver re-clamp', () => {
  it('re-clamps the offset when the observed sheet resizes past the viewport edge', () => {
    const callbacks: ResizeObserverCallback[] = []
    const OriginalRO = globalThis.ResizeObserver
    class CapturingResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb)
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      CapturingResizeObserver as unknown as typeof ResizeObserver
    try {
      renderSheet()
      const handle = getHandle()
      withElementSize(400, 200, () => {
        // Drag to the max legal offset for a 1200px viewport (x = 400).
        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400, clientY: 0 })
        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 400, clientY: 0 })
        // Shrink the viewport; the old offset is now out of bounds
        // (new max x = 600/2 - 200 = 100). Fire the observer callbacks.
        window.innerWidth = 600
        expect(callbacks.length).toBeGreaterThan(0)
        act(() => {
          for (const cb of callbacks) {
            cb([], {} as ResizeObserver)
          }
        })
      })
      expect(getRoot().style.transform).toContain('100px')
      expect(getRoot().style.transform).not.toContain('400px')
    } finally {
      globalThis.ResizeObserver = OriginalRO
    }
  })
})

describe('DraggableSheet - dismissal rules', () => {
  it('does not call onClose on click or pointerdown outside the sheet', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape for a single open sheet', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape when closed', () => {
    const onClose = vi.fn()
    renderSheet({ open: false, onClose })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('ignores an Escape a dismissable layer already consumed (defaultPrevented)', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    // Radix layers (Select, dialogs) preventDefault the ESC they consume on
    // document, before it bubbles to the sheet's window listener.
    const consume = (e: KeyboardEvent) => e.preventDefault()
    document.addEventListener('keydown', consume)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    document.removeEventListener('keydown', consume)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('marks the Escape consumed when the front-most sheet closes (no cascade)', () => {
    const onClose = vi.fn()
    renderSheet({ onClose })
    const evt = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(evt)
    expect(onClose).toHaveBeenCalledTimes(1)
    // Consuming the event is what stops the next sheet's listener from also
    // closing within the same dispatch (the real-browser cascade).
    expect(evt.defaultPrevented).toBe(true)
  })
})

describe('DraggableSheet - capture-phase Escape (captureEsc)', () => {
  function addPopupLayer(state?: string): HTMLElement {
    const layer = document.createElement('div')
    layer.setAttribute('role', 'listbox')
    if (state) layer.setAttribute('data-state', state)
    document.body.appendChild(layer)
    return layer
  }

  it('closes on a capture-phase Escape', () => {
    const onClose = vi.fn()
    renderSheet({ onClose, captureEsc: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes even when a host dialog already marked the Escape consumed', () => {
    // The host dialog's own capture listener is registered first, so it runs
    // before the sheet's and the sheet cannot honor defaultPrevented.
    const consume = (e: KeyboardEvent) => e.preventDefault()
    document.addEventListener('keydown', consume, true)
    const onClose = vi.fn()
    try {
      renderSheet({ onClose, captureEsc: true })
      fireEvent.keyDown(document, { key: 'Escape' })
    } finally {
      document.removeEventListener('keydown', consume, true)
    }
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves the Escape to an open popup layer', () => {
    const onClose = vi.fn()
    renderSheet({ onClose, captureEsc: true })
    const layer = addPopupLayer()
    try {
      fireEvent.keyDown(document, { key: 'Escape' })
    } finally {
      layer.remove()
    }
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes when the only popup layer is already closing', () => {
    const onClose = vi.fn()
    renderSheet({ onClose, captureEsc: true })
    const layer = addPopupLayer('closed')
    try {
      fireEvent.keyDown(document, { key: 'Escape' })
    } finally {
      layer.remove()
    }
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the front-most sheet when two captureEsc sheets are open', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    render(
      <>
        <DraggableSheet
          open
          captureEsc
          onClose={onCloseA}
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="sheet-a"
        >
          <p>body a</p>
        </DraggableSheet>
        <DraggableSheet
          open
          captureEsc
          onClose={onCloseB}
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="sheet-b"
        >
          <p>body b</p>
        </DraggableSheet>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseB).toHaveBeenCalledTimes(1)
    expect(onCloseA).not.toHaveBeenCalled()
  })
})

describe('DraggableSheet - nested sheets', () => {
  function renderNested(
    onCloseOuter: () => void,
    onCloseInner: () => void,
    innerProps: Partial<React.ComponentProps<typeof DraggableSheet>> = {},
  ) {
    // The host sheet opens first and the nested one later, as a value editor
    // opened from a parameter row does.
    function Nested({ innerOpen }: Readonly<{ innerOpen: boolean }>) {
      return (
        <DraggableSheet
          open
          onClose={onCloseOuter}
          ariaLabel="Outer Sheet"
          header={<span>Outer</span>}
          data-testid="outer-sheet"
        >
          <button data-testid="outer-field">outer field</button>
          {innerOpen && (
            <DraggableSheet
              open
              onClose={onCloseInner}
              ariaLabel="Inner Sheet"
              header={<span>Inner</span>}
              data-testid="inner-sheet"
              {...innerProps}
            >
              <button data-testid="inner-field">inner field</button>
            </DraggableSheet>
          )}
        </DraggableSheet>
      )
    }
    const view = render(<Nested innerOpen={false} />)
    view.rerender(<Nested innerOpen />)
    return view
  }

  it('keeps the nested sheet front-most after a pointerdown inside it', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    renderNested(onCloseOuter, onCloseInner)
    fireEvent.pointerDown(screen.getByTestId('inner-field'))
    expect(screen.getByTestId('inner-sheet')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('outer-sheet')).not.toHaveAttribute('data-active')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()
  })

  it('keeps a nested captureEsc sheet front-most for a capture-phase Escape', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    renderNested(onCloseOuter, onCloseInner, { captureEsc: true })
    fireEvent.pointerDown(screen.getByTestId('inner-field'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()
  })

  it('brings the host to front on a pointerdown in its own body', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    renderNested(onCloseOuter, onCloseInner)
    fireEvent.pointerDown(screen.getByTestId('inner-field'))
    fireEvent.pointerDown(screen.getByTestId('outer-field'))
    expect(screen.getByTestId('outer-sheet')).toHaveAttribute('data-active', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseOuter).toHaveBeenCalledTimes(1)
    expect(onCloseInner).not.toHaveBeenCalled()
  })
})

describe('DraggableSheet - every sheet is its own window', () => {
  const OFFSET_ZERO = 'translate(calc(-50% + 0px), calc(-50% + 0px))'

  /** Mirrors a sheet body that binds its own keys or presses to its sheet. */
  function SectionListener({
    type,
    listener,
  }: Readonly<{ type: 'keydown' | 'pointerdown'; listener: (event: Event) => void }>) {
    const ref = useRef<HTMLSpanElement>(null)
    useEffect(() => {
      const section = (ref.current as HTMLSpanElement).closest(
        '[data-draggable-sheet]',
      ) as HTMLElement
      section.addEventListener(type, listener)
      return () => section.removeEventListener(type, listener)
    }, [type, listener])
    return <span ref={ref} />
  }

  function renderNested({
    outerBody,
    outerProps = {},
    innerProps = {},
    innerInHeader = false,
  }: {
    outerBody?: ReactNode
    outerProps?: Partial<React.ComponentProps<typeof DraggableSheet>>
    innerProps?: Partial<React.ComponentProps<typeof DraggableSheet>>
    innerInHeader?: boolean
  } = {}) {
    // The parent opens first and the nested sheet later, as an editor opened from a row does.
    function Tree({ innerOpen }: Readonly<{ innerOpen: boolean }>) {
      const inner = innerOpen && (
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Inner Sheet"
          header={<span>Inner</span>}
          data-testid="inner-sheet"
          {...innerProps}
        >
          <button data-testid="inner-field">inner field</button>
        </DraggableSheet>
      )
      return (
        <div data-testid="opener">
          <DraggableSheet
            open
            onClose={() => {}}
            ariaLabel="Outer Sheet"
            header={
              <>
                <span>Outer</span>
                {innerInHeader && inner}
              </>
            }
            data-testid="outer-sheet"
            {...outerProps}
          >
            <button data-testid="outer-field">outer field</button>
            {outerBody}
            {!innerInHeader && inner}
          </DraggableSheet>
        </div>
      )
    }
    const view = render(<Tree innerOpen={false} />)
    view.rerender(<Tree innerOpen />)
    return {
      outer: screen.getByTestId('outer-sheet'),
      inner: screen.getByTestId('inner-sheet'),
    }
  }

  function drag(handle: HTMLElement, dx: number, dy: number) {
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy })
  }

  it('mounts at viewport level, outside the markup that opened it', () => {
    renderSheet()
    const root = getRoot()
    expect(root.parentElement).toBe(document.body)
  })

  it('mounts a sheet opened from inside another sheet beside it, never inside it', () => {
    const { outer, inner } = renderNested()
    expect(screen.getByTestId('opener')).not.toContainElement(outer)
    expect(outer).not.toContainElement(inner)
    expect(inner.parentElement).toBe(document.body)
  })

  it('leaves an open nested sheet where it is while its parent is dragged', () => {
    const { outer, inner } = renderNested()
    drag(getHandle('outer-sheet'), 60, 40)
    expect(outer.style.transform).toBe('translate(calc(-50% + 60px), calc(-50% + 40px))')
    expect(inner.style.transform).toBe(OFFSET_ZERO)
    expect(outer).not.toContainElement(inner)
  })

  it('drags a nested sheet anywhere in the viewport without moving its parent', () => {
    const { outer, inner } = renderNested()
    withElementSize(400, 200, () => {
      drag(getHandle('inner-sheet'), 10000, -10000)
    })
    // Clamped against the 1200 x 800 viewport alone: max x = 400, min y = -300.
    expect(inner.style.transform).toBe('translate(calc(-50% + 400px), calc(-50% + -300px))')
    expect(outer.style.transform).toBe(OFFSET_ZERO)
  })

  it('maximizes a nested sheet to the viewport, not to its parent', () => {
    const { inner } = renderNested({
      outerProps: { initialWidth: 600, initialHeight: 400 },
      innerProps: { onMaximize: vi.fn() },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(inner.style.width).toBe('1200px')
    expect(inner.style.height).toBe('800px')
    expect(inner.parentElement).toBe(document.body)
  })

  it('never starts the parent drag from a sheet opened inside its header', () => {
    const { outer } = renderNested({ innerInHeader: true })
    const field = screen.getByTestId('inner-field')
    fireEvent.pointerDown(field, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(field, { pointerId: 1, clientX: 180, clientY: 150 })
    expect(outer.style.transform).toBe(OFFSET_ZERO)
  })

  it('keeps a chord pressed in a nested sheet away from the parent sheet', () => {
    const outerKeys = vi.fn()
    renderNested({ outerBody: <SectionListener type="keydown" listener={outerKeys} /> })

    fireEvent.keyDown(screen.getByTestId('inner-field'), { key: 'Enter', ctrlKey: true })
    expect(outerKeys).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByTestId('outer-field'), { key: 'Enter', ctrlKey: true })
    expect(outerKeys).toHaveBeenCalledTimes(1)
  })

  it('keeps a press in a nested sheet away from the parent sheet', () => {
    const outerPresses = vi.fn()
    renderNested({ outerBody: <SectionListener type="pointerdown" listener={outerPresses} /> })

    fireEvent.pointerDown(screen.getByTestId('inner-field'))
    expect(outerPresses).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByTestId('outer-field'))
    expect(outerPresses).toHaveBeenCalledTimes(1)
  })

  it('closes only the nested sheet on an Escape pressed inside it', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    renderNested({
      outerProps: { onClose: onCloseOuter },
      innerProps: { onClose: onCloseInner },
    })
    fireEvent.keyDown(screen.getByTestId('inner-field'), { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()
  })

  it('closes only the nested sheet on a capture-phase Escape pressed inside it', () => {
    const onCloseOuter = vi.fn()
    const onCloseInner = vi.fn()
    renderNested({
      outerProps: { onClose: onCloseOuter, captureEsc: true },
      innerProps: { onClose: onCloseInner, captureEsc: true },
    })
    fireEvent.keyDown(screen.getByTestId('inner-field'), { key: 'Escape' })
    expect(onCloseInner).toHaveBeenCalledTimes(1)
    expect(onCloseOuter).not.toHaveBeenCalled()
  })

  it('brings a nested sheet and its parent to the front in turn', () => {
    const { outer, inner } = renderNested()

    fireEvent.pointerDown(screen.getByTestId('outer-field'))
    expect(Number(outer.style.zIndex)).toBeGreaterThan(Number(inner.style.zIndex))
    expect(outer).toHaveAttribute('data-active', 'true')

    fireEvent.pointerDown(screen.getByTestId('inner-field'))
    expect(Number(inner.style.zIndex)).toBeGreaterThan(Number(outer.style.zIndex))
    expect(inner).toHaveAttribute('data-active', 'true')
    expect(outer).not.toHaveAttribute('data-active')
  })

  it('keeps playing its select pulse when a nested sheet finishes an animation', () => {
    const { outer, inner } = renderNested({ outerProps: { sheetId: 'pulse-outer' } })
    act(() => {
      pulseSheet('pulse-outer')
    })

    fireEvent.animationEnd(inner)
    expect(outer.className).toMatch(/animate-sheet-select-pulse/)

    fireEvent.animationEnd(outer)
    expect(outer.className).not.toMatch(/animate-sheet-select-pulse/)
  })
})

describe('DraggableSheet - z-ordering across multiple sheets', () => {
  function renderTwoSheets(
    onCloseA: () => void,
    onCloseB: () => void,
    openB = true,
  ) {
    return render(
      <>
        <DraggableSheet
          open
          onClose={onCloseA}
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="sheet-a"
        >
          <p>body a</p>
        </DraggableSheet>
        <DraggableSheet
          open={openB}
          onClose={onCloseB}
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="sheet-b"
        >
          <p>body b</p>
        </DraggableSheet>
      </>,
    )
  }

  it('Escape closes only the front-most (most recently opened) sheet', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    renderTwoSheets(onCloseA, onCloseB)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseB).toHaveBeenCalledTimes(1)
    expect(onCloseA).not.toHaveBeenCalled()
  })

  it('pointer-down on a sheet brings it to front for both z-index and Escape', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    renderTwoSheets(onCloseA, onCloseB)
    const rootA = screen.getByRole('region', { name: /sheet a/i })
    const rootB = screen.getByRole('region', { name: /sheet b/i })

    fireEvent.pointerDown(rootA)
    expect(Number(rootA.style.zIndex)).toBeGreaterThan(
      Number(rootB.style.zIndex),
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseA).toHaveBeenCalledTimes(1)
    expect(onCloseB).not.toHaveBeenCalled()
  })

  it('falls back to the next sheet when the front-most closes', () => {
    const onCloseA = vi.fn()
    const onCloseB = vi.fn()
    const { rerender } = renderTwoSheets(onCloseA, onCloseB)

    rerender(
      <>
        <DraggableSheet
          open
          onClose={onCloseA}
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="sheet-a"
        >
          <p>body a</p>
        </DraggableSheet>
        <DraggableSheet
          open={false}
          onClose={onCloseB}
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="sheet-b"
        >
          <p>body b</p>
        </DraggableSheet>
      </>,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCloseA).toHaveBeenCalledTimes(1)
    expect(onCloseB).not.toHaveBeenCalled()
  })
})

describe('DraggableSheet - named-sheet focus (focusSheet)', () => {
  it('brings a registered open sheet to the front', () => {
    render(
      <>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="sheet-a"
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="sheet-a"
        >
          <p>body a</p>
        </DraggableSheet>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="sheet-b"
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="sheet-b"
        >
          <p>body b</p>
        </DraggableSheet>
      </>,
    )
    const rootA = screen.getByRole('region', { name: /sheet a/i })
    const rootB = screen.getByRole('region', { name: /sheet b/i })
    expect(Number(rootB.style.zIndex)).toBeGreaterThan(Number(rootA.style.zIndex))

    let focused = false
    act(() => {
      focused = focusSheet('sheet-a')
    })
    expect(focused).toBe(true)
    expect(Number(rootA.style.zIndex)).toBeGreaterThan(Number(rootB.style.zIndex))
  })

  it('returns false for an unknown or closed sheet id', () => {
    renderSheet({ sheetId: 'known-sheet' })
    expect(focusSheet('ghost-sheet')).toBe(false)
  })
})

describe('DraggableSheet - active (front-most) state', () => {
  function renderTwoNamed() {
    return render(
      <>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="active-a"
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="active-a"
        >
          <p>a</p>
        </DraggableSheet>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="active-b"
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="active-b"
        >
          <p>b</p>
        </DraggableSheet>
      </>,
    )
  }

  it('marks only the front-most sheet active and migrates it on focus', () => {
    renderTwoNamed()
    const rootA = screen.getByTestId('active-a')
    const rootB = screen.getByTestId('active-b')
    expect(rootB).toHaveAttribute('data-active', 'true')
    expect(rootA).not.toHaveAttribute('data-active', 'true')

    act(() => {
      focusSheet('active-a')
    })
    expect(rootA).toHaveAttribute('data-active', 'true')
    expect(rootB).not.toHaveAttribute('data-active', 'true')
  })

  it('re-activates the next sheet when the active one closes', () => {
    const { rerender } = renderTwoNamed()
    rerender(
      <>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="active-a"
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="active-a"
        >
          <p>a</p>
        </DraggableSheet>
        <DraggableSheet
          open={false}
          onClose={() => {}}
          sheetId="active-b"
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="active-b"
        >
          <p>b</p>
        </DraggableSheet>
      </>,
    )
    expect(screen.getByTestId('active-a')).toHaveAttribute('data-active', 'true')
  })
})

describe('DraggableSheet - select pulse (pulseSheet)', () => {
  it('plays and clears the select pulse on a registered sheet', () => {
    renderSheet({ sheetId: 'pulse-sheet' })
    const root = screen.getByTestId('test-sheet')
    expect(root.className).not.toMatch(/animate-sheet-select-pulse/)

    act(() => {
      pulseSheet('pulse-sheet')
    })
    expect(root.className).toMatch(/animate-sheet-select-pulse/)

    fireEvent.animationEnd(root)
    expect(root.className).not.toMatch(/animate-sheet-select-pulse/)
  })

  it('returns false for an unknown sheet id', () => {
    renderSheet({ sheetId: 'known-pulse-sheet' })
    expect(pulseSheet('ghost-pulse')).toBe(false)
  })
})

describe('DraggableSheet - reopen affordance (refocusSheet)', () => {
  it('raises the sheet to the front AND plays the select pulse', () => {
    render(
      <>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="refocus-a"
          ariaLabel="Sheet A"
          header={<span>A</span>}
          data-testid="refocus-a"
        >
          <p>a</p>
        </DraggableSheet>
        <DraggableSheet
          open
          onClose={() => {}}
          sheetId="refocus-b"
          ariaLabel="Sheet B"
          header={<span>B</span>}
          data-testid="refocus-b"
        >
          <p>b</p>
        </DraggableSheet>
      </>,
    )
    const rootA = screen.getByTestId('refocus-a')
    const rootB = screen.getByTestId('refocus-b')

    let result = false
    act(() => {
      result = refocusSheet('refocus-a')
    })

    expect(result).toBe(true)
    expect(Number(rootA.style.zIndex)).toBeGreaterThan(Number(rootB.style.zIndex))
    expect(rootA.className).toMatch(/animate-sheet-select-pulse/)
    expect(rootB.className).not.toMatch(/animate-sheet-select-pulse/)
  })

  it('returns false and pulses nothing for an unknown sheet id', () => {
    renderSheet({ sheetId: 'refocus-known' })
    expect(refocusSheet('refocus-ghost')).toBe(false)
    expect(screen.getByTestId('test-sheet').className).not.toMatch(/animate-sheet-select-pulse/)
  })
})

function OpenerHarness({ label }: Readonly<{ label: string }>) {
  const opener = useSheetOpener()
  return (
    <>
      <button type="button" onClick={opener.show}>
        Open {label}
      </button>
      <DraggableSheet
        ref={opener.ref}
        open={opener.open}
        onClose={opener.hide}
        ariaLabel={label}
        header={<span>{label}</span>}
        data-testid={`opener-${label}`}
      >
        <button type="button" onClick={opener.hide}>
          Hide {label}
        </button>
      </DraggableSheet>
    </>
  )
}

describe('DraggableSheet - a second press on the opener (useSheetOpener)', () => {
  it('opens the sheet on the first press', () => {
    render(<OpenerHarness label="A" />)
    expect(screen.queryByTestId('opener-A')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    expect(screen.getByTestId('opener-A')).toBeInTheDocument()
  })

  it('raises the open sheet above the one in front and pulses it, without a second copy', () => {
    render(
      <>
        <OpenerHarness label="A" />
        <OpenerHarness label="B" />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open B' }))
    const rootA = screen.getByTestId('opener-A')
    const rootB = screen.getByTestId('opener-B')
    expect(Number(rootB.style.zIndex)).toBeGreaterThan(Number(rootA.style.zIndex))

    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))

    expect(screen.getAllByTestId('opener-A')).toHaveLength(1)
    expect(Number(rootA.style.zIndex)).toBeGreaterThan(Number(rootB.style.zIndex))
    expect(rootA).toHaveAttribute('data-active', 'true')
    expect(rootA.className).toMatch(/animate-sheet-select-pulse/)
    expect(rootB.className).not.toMatch(/animate-sheet-select-pulse/)
  })

  it('closes on hide, and the next press opens it again', () => {
    render(<OpenerHarness label="A" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide A' }))
    expect(screen.queryByTestId('opener-A')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open A' }))
    expect(screen.getByTestId('opener-A').className).not.toMatch(/animate-sheet-select-pulse/)
  })
})

describe('DraggableSheet - openOrRefocus', () => {
  it('opens a closed sheet without touching the handle', () => {
    const open = vi.fn()
    const refocus = vi.fn()
    openOrRefocus(false, { current: { refocus } }, open)
    expect(open).toHaveBeenCalledOnce()
    expect(refocus).not.toHaveBeenCalled()
  })

  it('raises an open sheet and still hands over the new target', () => {
    const open = vi.fn()
    const refocus = vi.fn()
    openOrRefocus(true, { current: { refocus } }, open)
    expect(refocus).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledOnce()
  })

  it('is harmless while the open sheet has not handed over its handle yet', () => {
    const open = vi.fn()
    expect(() => openOrRefocus(true, { current: null }, open)).not.toThrow()
    expect(open).toHaveBeenCalledOnce()
  })

  it('never raises a mounted sheet that is closed', () => {
    const handle = createRef<SheetHandle>()
    render(
      <>
        <DraggableSheet
          ref={handle}
          open={false}
          onClose={() => {}}
          ariaLabel="Closed"
          header={<span>Closed</span>}
          data-testid="closed-sheet"
        >
          <p>closed</p>
        </DraggableSheet>
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Front"
          header={<span>Front</span>}
          data-testid="front-sheet"
        >
          <p>front</p>
        </DraggableSheet>
      </>,
    )
    act(() => handle.current?.refocus())
    expect(screen.queryByTestId('closed-sheet')).not.toBeInTheDocument()
    expect(screen.getByTestId('front-sheet')).toHaveAttribute('data-active', 'true')
  })
})

describe('DraggableSheet - responsiveSize (mode-driven default)', () => {
  function responsiveTree(width: number, height: number) {
    return (
      <DraggableSheet
        open
        onClose={() => {}}
        ariaLabel="Responsive"
        header={<span>R</span>}
        data-testid="responsive"
        responsiveSize
        initialWidth={width}
        initialHeight={height}
        minWidth={100}
        minHeight={100}
      >
        <p>body</p>
      </DraggableSheet>
    )
  }

  it('snaps to the new default size when initialWidth/Height change', () => {
    const { rerender } = render(responsiveTree(300, 200))
    const root = screen.getByTestId('responsive')
    expect(root.style.width).toBe('300px')
    expect(root.style.height).toBe('200px')

    rerender(responsiveTree(420, 260))
    expect(root.style.width).toBe('420px')
    expect(root.style.height).toBe('260px')
  })

  it('still snaps to the new default after the user only DRAGS (move is not a resize)', () => {
    const { rerender } = render(responsiveTree(300, 200))
    const root = screen.getByTestId('responsive')
    const handle = screen.getByTestId('responsive-drag-handle')
    // Reposition by dragging the header - a move, not a resize. A fixed-size
    // (non-resizable) watcher can ONLY be moved, so a move must not freeze its
    // mode-driven size.
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 40 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 40, clientY: 40 })

    rerender(responsiveTree(420, 260))
    expect(root.style.width).toBe('420px')
    expect(root.style.height).toBe('260px')
  })

  it('keeps the user size after a manual resize, ignoring later default changes', () => {
    const { rerender } = render(responsiveTree(300, 200))
    const root = screen.getByTestId('responsive')

    const corner = screen.getByTestId('dialog-resize-corner')
    fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 })
    fireEvent.mouseUp(document)
    const resizedWidth = root.style.width
    const resizedHeight = root.style.height

    rerender(responsiveTree(420, 260))
    expect(root.style.width).toBe(resizedWidth)
    expect(root.style.height).toBe(resizedHeight)
  })

  it('keeps an auto-height sheet auto after a width-only resize across default changes', () => {
    function autoTree(width: number) {
      return (
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Auto"
          header={<span>A</span>}
          data-testid="auto-resp"
          responsiveSize
          initialWidth={width}
          minWidth={100}
          minHeight={100}
        >
          <p>body</p>
        </DraggableSheet>
      )
    }
    const { rerender } = render(autoTree(300))
    const root = screen.getByTestId('auto-resp')
    expect(root.style.height).toBe('') // auto (no fixed height)

    // Width-only edge resize marks the sheet user-resized but leaves height auto.
    const edge = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(edge, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 40 })
    fireEvent.mouseUp(document)

    // A default change runs clampUpToMin with an undefined height: width raises
    // to the min, height stays auto (the `h === undefined` branch).
    rerender(autoTree(420))
    expect(root.style.height).toBe('')
  })
})

describe('DraggableSheet - extraHeight (validation strip)', () => {
  function extraTree(extraHeight: number) {
    return (
      <DraggableSheet
        open
        onClose={() => {}}
        ariaLabel="Extra"
        header={<span>E</span>}
        data-testid="extra"
        initialWidth={300}
        initialHeight={200}
        minWidth={100}
        minHeight={100}
        extraHeight={extraHeight}
      >
        <p>body</p>
      </DraggableSheet>
    )
  }

  it('adds extraHeight on top of the base height and removes it when it clears', () => {
    const { rerender } = render(extraTree(0))
    const root = screen.getByTestId('extra')
    expect(root.style.height).toBe('200px')

    rerender(extraTree(45))
    expect(root.style.height).toBe('245px') // base + strip

    rerender(extraTree(0))
    expect(root.style.height).toBe('200px') // shrinks back
  })

  it('keeps the resize base independent of extraHeight', () => {
    const { rerender } = render(extraTree(45))
    const root = screen.getByTestId('extra')
    expect(root.style.height).toBe('245px')

    // Corner resize grows the BASE (200 + 30*gain(2) = 260); the strip still adds.
    const corner = screen.getByTestId('dialog-resize-corner')
    fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 0, clientY: 30 })
    fireEvent.mouseUp(document)
    expect(root.style.height).toBe('305px')

    // Clearing the strip leaves the resized base intact.
    rerender(extraTree(0))
    expect(root.style.height).toBe('260px')
  })
})

describe('hasOpenModalDialog', () => {
  it('detects an open MODAL dialog (role=dialog + aria-modal)', () => {
    expect(hasOpenModalDialog()).toBe(false)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    try {
      expect(hasOpenModalDialog()).toBe(true)
    } finally {
      dialog.remove()
    }
  })

  it('detects an open alertdialog', () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'alertdialog')
    document.body.appendChild(dialog)
    try {
      expect(hasOpenModalDialog()).toBe(true)
    } finally {
      dialog.remove()
    }
  })

  it('ignores non-modal role=dialog surfaces (Radix Popover content)', () => {
    // Radix Popover content (autocomplete dropdowns, etc.) carries
    // role="dialog" without aria-modal - it must not block sheet closes.
    const popover = document.createElement('div')
    popover.setAttribute('role', 'dialog')
    document.body.appendChild(popover)
    try {
      expect(hasOpenModalDialog()).toBe(false)
    } finally {
      popover.remove()
    }
  })
})

describe('DraggableSheet - geometry memory (sheetId)', () => {
  function renderNamed(sheetId: string, initialOffset?: { x: number; y: number }) {
    return render(
      <DraggableSheet
        open
        onClose={() => {}}
        sheetId={sheetId}
        ariaLabel="Geometry Sheet"
        header={<span>G</span>}
        data-testid="geometry-sheet"
        initialOffset={initialOffset}
      >
        <p>body</p>
      </DraggableSheet>,
    )
  }

  function getNamedRoot(): HTMLElement {
    return screen.getByRole('region', { name: /geometry sheet/i })
  }

  it('reopens a dragged and resized sheet where the user left it', () => {
    const first = renderNamed('geom-adjusted')
    const handle = screen.getByTestId('geometry-sheet-drag-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    const resize = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(resize, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document)
    first.unmount()

    // Remount (close -> reopen): the cascade default is overridden by the
    // remembered geometry.
    renderNamed('geom-adjusted', { x: 28, y: 28 })
    expect(getNamedRoot().style.transform).toBe(
      'translate(calc(-50% + 40px), calc(-50% + 60px))',
    )
    expect(getNamedRoot().style.width).toBe('772px')
  })

  it('never reopens a remembered size below the sheet own minimum', () => {
    const sized = (width: number, height: number, minWidth: number, minHeight: number) => (
      <DraggableSheet
        open
        onClose={() => {}}
        sheetId="geom-floor"
        ariaLabel="Geometry Sheet"
        header={<span>G</span>}
        data-testid="geometry-sheet"
        initialWidth={width}
        initialHeight={height}
        minWidth={minWidth}
        minHeight={minHeight}
      >
        <p>body</p>
      </DraggableSheet>
    )
    const first = render(sized(460, 300, 440, 220))
    const handle = screen.getByTestId('geometry-sheet-drag-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    first.unmount()

    render(sized(720, 460, 660, 320))
    expect(getNamedRoot().style.width).toBe('660px')
    expect(getNamedRoot().style.height).toBe('320px')
    expect(getNamedRoot().style.transform).toBe(
      'translate(calc(-50% + 40px), calc(-50% + 60px))',
    )
  })

  it('keeps the default placement for sheets the user never adjusted', () => {
    const first = renderNamed('geom-untouched', { x: 28, y: 28 })
    first.unmount()

    renderNamed('geom-untouched')
    expect(getNamedRoot().style.transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
    expect(getNamedRoot().style.width).toBe('672px')
  })
})

// ===========================================================================
// Both-axis corner resize + per-instance bounds
// ===========================================================================

describe('DraggableSheet - corner grip rendering', () => {
  it('renders the bottom-right corner grip by default', () => {
    renderSheet()
    expect(screen.getByTestId('dialog-resize-corner')).toBeInTheDocument()
  })

  it('omits the corner grip when resizable is false', () => {
    renderSheet({ resizable: false })
    expect(
      screen.queryByTestId('dialog-resize-corner'),
    ).not.toBeInTheDocument()
  })

  it('hides the corner grip from the accessibility tree (pointer-only)', () => {
    renderSheet()
    expect(screen.getByTestId('dialog-resize-corner')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })
})

describe('DraggableSheet - height axis', () => {
  it('keeps the height auto (content-driven) when initialHeight is absent', () => {
    renderSheet()
    expect(getRoot().style.height).toBe('')
  })

  it('applies initialHeight as a fixed pixel height', () => {
    renderSheet({ initialHeight: 500 })
    expect(getRoot().style.height).toBe('500px')
  })

  it('fixes the height from the measured size on the first corner drag', () => {
    renderSheet()
    withElementSize(672, 300, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(document, { clientX: 150, clientY: 140 })
      fireEvent.mouseUp(document)
    })
    // Shared 2x drag amplification on both axes:
    // width 672 + 50 * 2 = 772; height 300 + 40 * 2 = 380.
    expect(getRoot().style.width).toBe('772px')
    expect(getRoot().style.height).toBe('380px')
  })

  it('clamps the corner drag to the default minimums (520 wide, 240 tall)', () => {
    renderSheet()
    withElementSize(672, 300, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: -10000, clientY: -10000 })
      fireEvent.mouseUp(document)
    })
    expect(getRoot().style.width).toBe('520px')
    expect(getRoot().style.height).toBe('240px')
  })

  it('respects per-instance minWidth / minHeight overrides', () => {
    renderSheet({ initialWidth: 400, minWidth: 320, minHeight: 240 })
    withElementSize(400, 300, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: -10000, clientY: -10000 })
      fireEvent.mouseUp(document)
    })
    expect(getRoot().style.width).toBe('320px')
    expect(getRoot().style.height).toBe('240px')
  })

  it('caps the width at 1200 but lets the height grow (no fixed height max)', () => {
    renderSheet()
    withElementSize(672, 300, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: 10000, clientY: 10000 })
      fireEvent.mouseUp(document)
    })
    expect(getRoot().style.width).toBe('1200px')
    // Height keeps the raw amplified delta; the viewport offset clamp (not
    // the resize hook) keeps the header reachable for over-tall sheets.
    expect(getRoot().style.height).toBe('20300px')
  })

  it('width-only edge resize leaves an auto height untouched', () => {
    renderSheet()
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 200 })
    fireEvent.mouseUp(document)
    expect(getRoot().style.width).toBe('872px')
    expect(getRoot().style.height).toBe('')
  })
})

describe('DraggableSheet - height geometry memory (sheetId)', () => {
  it('remembers a corner-resized height across close and reopen', () => {
    const first = render(
      <DraggableSheet
        open
        onClose={() => {}}
        sheetId="geom-corner"
        ariaLabel="Corner Sheet"
        header={<span>C</span>}
        data-testid="corner-sheet"
      >
        <p>body</p>
      </DraggableSheet>,
    )
    withElementSize(672, 300, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(document, { clientX: 150, clientY: 115 })
      fireEvent.mouseUp(document)
    })
    // width 672 + 50 * 2 = 772; height 300 + 15 * 2 = 330.
    expect(
      screen.getByRole('region', { name: /corner sheet/i }).style.height,
    ).toBe('330px')
    first.unmount()

    render(
      <DraggableSheet
        open
        onClose={() => {}}
        sheetId="geom-corner"
        ariaLabel="Corner Sheet"
        header={<span>C</span>}
        data-testid="corner-sheet"
      >
        <p>body</p>
      </DraggableSheet>,
    )
    const reopened = screen.getByRole('region', { name: /corner sheet/i })
    expect(reopened.style.width).toBe('772px')
    expect(reopened.style.height).toBe('330px')
  })
})

// ===========================================================================
// localStorage geometry tier (persistGeometry - watcher reload persistence)
// ===========================================================================

describe('DraggableSheet - persisted geometry (persistGeometry)', () => {
  const GEOMETRY_KEY = 'draggable-sheet.geometry'

  function renderPersistent(
    sheetId: string,
    props: Partial<React.ComponentProps<typeof DraggableSheet>> = {},
  ) {
    return render(
      <DraggableSheet
        open
        onClose={() => {}}
        sheetId={sheetId}
        persistGeometry
        ariaLabel="Persistent Sheet"
        header={<span>P</span>}
        data-testid="persistent-sheet"
        {...props}
      >
        <p>body</p>
      </DraggableSheet>,
    )
  }

  function getPersistentRoot(): HTMLElement {
    return screen.getByRole('region', { name: /persistent sheet/i })
  }

  it('restores localStorage geometry on mount (reload survival)', () => {
    localStorage.setItem(
      GEOMETRY_KEY,
      JSON.stringify({
        'persist-restore': { offset: { x: 40, y: 60 }, width: 772, height: 330 },
      }),
    )
    renderPersistent('persist-restore')
    const root = getPersistentRoot()
    expect(root.style.transform).toBe(
      'translate(calc(-50% + 40px), calc(-50% + 60px))',
    )
    expect(root.style.width).toBe('772px')
    expect(root.style.height).toBe('330px')
  })

  it('ignores localStorage geometry when persistGeometry is not set', () => {
    localStorage.setItem(
      GEOMETRY_KEY,
      JSON.stringify({
        'persist-optout': { offset: { x: 40, y: 60 }, width: 772, height: 330 },
      }),
    )
    renderSheet({ sheetId: 'persist-optout' })
    expect(getRoot().style.width).toBe('672px')
    expect(getRoot().style.height).toBe('')
  })

  it('writes the adjusted geometry to localStorage', () => {
    renderPersistent('persist-write')
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document)

    const store = JSON.parse(localStorage.getItem(GEOMETRY_KEY) ?? '{}')
    expect(store['persist-write']).toMatchObject({ width: 772 })
  })

  it('does not write to localStorage without persistGeometry', () => {
    renderSheet({ sheetId: 'persist-no-write' })
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document)

    expect(localStorage.getItem(GEOMETRY_KEY)).toBeNull()
  })

  it('tolerates corrupt store content and recovers on the next write', () => {
    localStorage.setItem(GEOMETRY_KEY, 'garbage{')
    renderPersistent('persist-corrupt')
    expect(getPersistentRoot().style.width).toBe('672px')

    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document)

    const store = JSON.parse(localStorage.getItem(GEOMETRY_KEY) ?? '{}')
    expect(store['persist-corrupt']).toMatchObject({ width: 772 })
  })

  it('tolerates a non-object store payload', () => {
    localStorage.setItem(GEOMETRY_KEY, JSON.stringify(['not', 'a', 'map']))
    renderPersistent('persist-non-object')
    expect(getPersistentRoot().style.width).toBe('672px')
  })

  it('evicts the oldest entry past the 100-entry cap', () => {
    const seeded: Record<string, unknown> = {}
    for (let i = 0; i < 100; i++) {
      seeded[`g${i}`] = { offset: { x: 0, y: 0 }, width: 600 }
    }
    localStorage.setItem(GEOMETRY_KEY, JSON.stringify(seeded))

    renderPersistent('persist-cap-new')
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 150 })
    fireEvent.mouseUp(document)

    const store = JSON.parse(localStorage.getItem(GEOMETRY_KEY) ?? '{}')
    expect(Object.keys(store)).toHaveLength(100)
    expect(store['persist-cap-new']).toBeDefined()
    expect(store.g0).toBeUndefined()
    expect(store.g1).toBeDefined()
  })
})

describe('DraggableSheet - width resize', () => {
  it('renders the shared resize handle by default', () => {
    renderSheet()
    expect(screen.getByTestId('dialog-resize-handle')).toBeInTheDocument()
  })

  it('omits the resize handle when resizable is false', () => {
    renderSheet({ resizable: false })
    expect(
      screen.queryByTestId('dialog-resize-handle'),
    ).not.toBeInTheDocument()
  })

  it('starts at the shared default width', () => {
    renderSheet()
    expect(getRoot().style.width).toBe('672px')
  })

  it('honors a custom initialWidth', () => {
    renderSheet({ initialWidth: 640 })
    expect(getRoot().style.width).toBe('640px')
  })

  it('widens the sheet when the handle is dragged right', () => {
    renderSheet()
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 200 })
    fireEvent.mouseUp(document)
    // Shared resize amplifies pointer deltas 2x: 672 + 100 * 2 = 872.
    expect(getRoot().style.width).toBe('872px')
  })

  it('clamps the width to the 520-1200 range', () => {
    renderSheet()
    const handle = screen.getByTestId('dialog-resize-handle')
    fireEvent.mouseDown(handle, { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 10000 })
    fireEvent.mouseUp(document)
    expect(getRoot().style.width).toBe('1200px')

    fireEvent.mouseDown(handle, { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: -10000 })
    fireEvent.mouseUp(document)
    expect(getRoot().style.width).toBe('520px')
  })
})

describe('DraggableSheet - handing focus back on close', () => {
  function renderWithOpener(open: boolean) {
    return render(
      <>
        <button data-testid="opener">Opener</button>
        <DraggableSheet
          open={open}
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <button data-testid="inside">Inside</button>
        </DraggableSheet>
      </>,
    )
  }

  it('returns focus to whatever opened it', () => {
    const { rerender, unmount } = renderWithOpener(false)
    const opener = screen.getByTestId('opener')
    opener.focus()

    rerender(
      <>
        <button data-testid="opener">Opener</button>
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <button data-testid="inside">Inside</button>
        </DraggableSheet>
      </>,
    )
    screen.getByTestId('inside').focus()

    rerender(
      <>
        <button data-testid="opener">Opener</button>
        <DraggableSheet
          open={false}
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <button data-testid="inside">Inside</button>
        </DraggableSheet>
      </>,
    )

    expect(screen.getByTestId('opener')).toHaveFocus()
    unmount()
  })

  it('leaves focus alone when the user has already moved it elsewhere', () => {
    const { rerender, unmount } = render(
      <>
        <button data-testid="opener">Opener</button>
        <button data-testid="other">Other</button>
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <p>Sheet body</p>
        </DraggableSheet>
      </>,
    )
    screen.getByTestId('other').focus()

    rerender(
      <>
        <button data-testid="opener">Opener</button>
        <button data-testid="other">Other</button>
        <DraggableSheet
          open={false}
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <p>Sheet body</p>
        </DraggableSheet>
      </>,
    )

    expect(screen.getByTestId('other')).toHaveFocus()
    unmount()
  })

  it('restores nothing when there was no focused element to return to', () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement')
    Object.defineProperty(document, 'activeElement', { get: () => null, configurable: true })
    const { rerender, unmount } = renderWithOpener(true)
    Object.defineProperty(document, 'activeElement', original!)

    expect(() => rerender(<div />)).not.toThrow()
    unmount()
  })

  it('survives an opener that is gone by the time the sheet closes', () => {
    const { rerender, unmount } = render(
      <>
        <button data-testid="opener">Opener</button>
        <DraggableSheet
          open
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <p>Sheet body</p>
        </DraggableSheet>
      </>,
    )
    screen.getByTestId('opener').focus()

    expect(() =>
      rerender(
        <DraggableSheet
          open={false}
          onClose={() => {}}
          ariaLabel="Test Sheet"
          header={<span>Sheet Header</span>}
          data-testid="test-sheet"
        >
          <p>Sheet body</p>
        </DraggableSheet>,
      ),
    ).not.toThrow()
    unmount()
  })
})

// ===========================================================================
// Optional header maximize control (PYRUN-13)
// ===========================================================================

describe('DraggableSheet - maximize control (PYRUN-13)', () => {
  function getMaximize(): HTMLElement {
    return screen.getByRole('button', { name: 'Maximize' })
  }

  it('renders no maximize control when onMaximize is absent', () => {
    renderSheet()
    expect(
      screen.queryByRole('button', { name: 'Maximize' }),
    ).not.toBeInTheDocument()
  })

  it('renders a labeled, unpressed control when onMaximize is supplied', () => {
    renderSheet({ onMaximize: vi.fn() })
    expect(getMaximize()).toBeInTheDocument()
    expect(getMaximize()).toHaveAttribute('aria-pressed', 'false')
  })

  it('fills the viewport on the first click', () => {
    window.innerWidth = 1440
    window.innerHeight = 900
    renderSheet({ initialWidth: 720, initialHeight: 460, onMaximize: vi.fn() })

    fireEvent.click(getMaximize())

    expect(getRoot().style.width).toBe('1440px')
    expect(getRoot().style.height).toBe('900px')
    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
  })

  it('restores the dragged and resized box exactly on the second click', () => {
    renderSheet({ initialWidth: 720, initialHeight: 460, onMaximize: vi.fn() })
    const handle = getHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    withElementSize(720, 460, () => {
      const corner = screen.getByTestId('dialog-resize-corner')
      fireEvent.mouseDown(corner, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(document, { clientX: 150, clientY: 130 })
      fireEvent.mouseUp(document)
    })
    // width 720 + 50 * 2 = 820; height 460 + 30 * 2 = 520.
    const before = {
      width: getRoot().style.width,
      height: getRoot().style.height,
      transform: getRoot().style.transform,
    }
    expect(before).toEqual({
      width: '820px',
      height: '520px',
      transform: 'translate(calc(-50% + 40px), calc(-50% + 60px))',
    })

    fireEvent.click(getMaximize())
    expect(getRoot().style.width).toBe('1200px')
    expect(getRoot().style.height).toBe('800px')

    fireEvent.click(getMaximize())
    expect({
      width: getRoot().style.width,
      height: getRoot().style.height,
      transform: getRoot().style.transform,
    }).toEqual(before)
  })

  it('gives an auto-height sheet its auto height back on restore', () => {
    renderSheet({ onMaximize: vi.fn() })
    expect(getRoot().style.height).toBe('')

    fireEvent.click(getMaximize())
    expect(getRoot().style.height).toBe('800px')

    fireEvent.click(getMaximize())
    expect(getRoot().style.height).toBe('')
  })

  it('shows the four-corner frame while the sheet is not maximized (FIELD-11)', () => {
    renderSheet({ onMaximize: vi.fn() })
    expect(getMaximize().querySelector('.lucide-maximize')).toBeInTheDocument()
    expect(getMaximize().querySelector('.lucide-maximize-2')).not.toBeInTheDocument()
    expect(getMaximize().querySelector('.lucide-minimize')).not.toBeInTheDocument()
  })

  it('shows the four inward corners while maximized and the frame again on restore (FIELD-11)', () => {
    renderSheet({ onMaximize: vi.fn() })

    fireEvent.click(getMaximize())
    expect(getMaximize().querySelector('.lucide-minimize')).toBeInTheDocument()
    expect(getMaximize().querySelector('.lucide-minimize-2')).not.toBeInTheDocument()
    expect(getMaximize().querySelector('.lucide-maximize')).not.toBeInTheDocument()

    fireEvent.click(getMaximize())
    expect(getMaximize().querySelector('.lucide-maximize')).toBeInTheDocument()
    expect(getMaximize().querySelector('.lucide-minimize')).not.toBeInTheDocument()
  })

  it('reports the maximized state through aria-pressed', () => {
    renderSheet({ onMaximize: vi.fn() })
    expect(getMaximize()).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(getMaximize())
    expect(getMaximize()).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(getMaximize())
    expect(getMaximize()).toHaveAttribute('aria-pressed', 'false')
  })

  it('notifies the host on every toggle', () => {
    const onMaximize = vi.fn()
    renderSheet({ onMaximize })

    fireEvent.click(getMaximize())
    fireEvent.click(getMaximize())

    expect(onMaximize).toHaveBeenCalledTimes(2)
  })

  it('does not start a header drag when the control is pressed', () => {
    renderSheet({ onMaximize: vi.fn() })

    fireEvent.pointerDown(getMaximize(), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    })
    fireEvent.pointerMove(getHandle(), { pointerId: 1, clientX: 200, clientY: 240 })

    expect(getRoot().style.transform).toBe(
      'translate(calc(-50% + 0px), calc(-50% + 0px))',
    )
  })

  it('takes the new box in one step when the viewer asks for reduced motion', () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    })

    try {
      window.innerWidth = 1440
      window.innerHeight = 900
      renderSheet({ initialWidth: 720, initialHeight: 460, onMaximize: vi.fn() })

      fireEvent.click(getMaximize())

      expect(getRoot().style.width).toBe('1440px')
      const motion = Array.from(getRoot().classList).filter(
        (token) =>
          (token.startsWith('animate-') || token.startsWith('transition-')) &&
          token !== 'animate-none' &&
          token !== 'transition-none',
      )
      expect(motion).toEqual([])
    } finally {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original })
    }
  })
})

