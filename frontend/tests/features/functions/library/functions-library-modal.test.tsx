/**
 * Tests for the `FunctionsLibraryModal` shell.
 *
 * Library content (search, tag filters, card grid, drag-to-canvas) has its own
 * tests in `functions-library-modal-populated.test.tsx`. The concerns covered
 * here are the shell behavior only:
 *   - closed state (`isOpen={false}`) renders nothing
 *   - open state renders the title, the empty-state copy, and the close button
 *   - Escape and X both invoke `onClose`
 *   - the header acts as a pointer-drag handle and updates the modal's offset
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act as domAct } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
  })
})

vi.mock('@/features/functions/api/functions-api', async () => {
  const actual = await vi.importActual<
    typeof import('@/features/functions/api/functions-api')
  >('@/features/functions/api/functions-api')
  return {
    ...actual,
    // Default: never resolves so the modal's `setAllFunctions` state update
    // doesn't fire outside an act() boundary. Tests that need a resolved
    // value (or rejection) override via `vi.spyOn(...).mockResolvedValueOnce`.
    listFunctions: vi.fn(
      () =>
        new Promise<{
          functions: never[]
          pagination: { page: number; per_page: number; total: number; total_pages: number }
        }>(() => {}),
    ),
  }
})

import * as functionsApi from '@/features/functions/api/functions-api'
import { FunctionsLibraryModal } from '@/features/functions/library/functions-library-modal'

const EMPTY_COPY =
  'No published Functions yet. Build one in the canvas, then Publish it.'

describe('FunctionsLibraryModal - closed', () => {
  it('renders nothing when isOpen is false', () => {
    render(<FunctionsLibraryModal isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('region', { name: /functions library/i })).not.toBeInTheDocument()
  })
})

describe('FunctionsLibraryModal - open (empty library)', () => {
  it('renders the title heading', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: /functions library/i })).toBeInTheDocument()
  })

  it('renders the empty-state copy verbatim', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument()
  })

  it('exposes a close button with an accessible name', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
  })

  it('exposes a drag handle with the documented testid + aria-label', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = screen.getByTestId('functions-library-drag-handle')
    expect(handle).toHaveAttribute('aria-label', 'Drag to move')
  })
})

describe('FunctionsLibraryModal - close behavior', () => {
  it('invokes onClose when the X button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<FunctionsLibraryModal isOpen={true} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<FunctionsLibraryModal isOpen={true} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores Escape when the modal is closed', () => {
    const onClose = vi.fn()
    render(<FunctionsLibraryModal isOpen={false} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('FunctionsLibraryModal - drag behavior', () => {
  function getModalRoot(): HTMLElement {
    return screen.getByRole('region', { name: /functions library/i })
  }

  function getDragHandle(): HTMLElement {
    return screen.getByTestId('functions-library-drag-handle')
  }

  function initialTransform(): string {
    return 'translate(calc(-50% + 0px), calc(-50% + 0px))'
  }

  it('does not initiate a drag when pointerdown lands on an interactive child (close button)', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const closeButton = screen.getByRole('button', { name: /close/i })
    fireEvent.pointerDown(closeButton, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(getDragHandle(), { pointerId: 1, clientX: 200, clientY: 220 })
    expect(root.style.transform).toBe(initialTransform())
  })

  it('updates modal position when the user drags the header', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const handle = getDragHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    expect(root.style.transform).toBe('translate(calc(-50% + 30px), calc(-50% + 45px))')
  })

  // NOTE (geometry memory): the library sheet remembers its adjusted
  // position across mounts within a session, so tests below assert RELATIVE
  // to the mount-time transform instead of a hardcoded centered base. The
  // absolute drag-delta contract stays pinned by the first drag test above
  // (which runs from a clean base).
  it('ignores pointermove events from a different pointer id', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const handle = getDragHandle()
    const beforeDrag = root.style.transform
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 99, clientX: 999, clientY: 999 })
    expect(root.style.transform).toBe(beforeDrag)
  })

  it('ignores pointerdown for non-primary buttons', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const handle = getDragHandle()
    const beforeDrag = root.style.transform
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    expect(root.style.transform).toBe(beforeDrag)
  })

  it('completes the drag cycle on pointerup and releases pointer capture', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const handle = getDragHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    const afterDrag = root.style.transform
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 500 })
    // The post-pointerup move is ignored: the transform froze at drag end.
    expect(root.style.transform).toBe(afterDrag)
  })

  it('swallows releasePointerCapture errors on pointerup', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = getDragHandle()
    const originalRelease = handle.releasePointerCapture.bind(handle)
    handle.releasePointerCapture = () => {
      throw new DOMException('Invalid pointer id', 'NotFoundError')
    }
    try {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
      expect(() =>
        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100, clientY: 100 }),
      ).not.toThrow()
    } finally {
      handle.releasePointerCapture = originalRelease
    }
  })

  it('ignores pointerup from a different pointer id', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = getModalRoot()
    const handle = getDragHandle()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    const afterFirstMove = root.style.transform
    fireEvent.pointerUp(handle, { pointerId: 99, clientX: 999, clientY: 999 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160, clientY: 175 })
    // The foreign pointerup did NOT end the drag: the sheet kept following.
    expect(root.style.transform).not.toBe(afterFirstMove)
  })
})


describe('FunctionsLibraryModal - listFunctions failure', () => {
  it('shows its own error state instead of an empty library', async () => {
    vi.spyOn(functionsApi, 'listFunctions').mockRejectedValueOnce(
      new Error('network down'),
    )
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)

    expect(await screen.findByTestId('functions-library-error')).toBeInTheDocument()
    expect(screen.getByTestId('error-state-title')).toHaveTextContent('Unable to load Functions')
    expect(screen.queryByText(/no published functions yet/i)).not.toBeInTheDocument()
  })

  it('re-reads the library when Try Again is clicked', async () => {
    const user = userEvent.setup()
    const listSpy = vi
      .spyOn(functionsApi, 'listFunctions')
      .mockRejectedValueOnce(new Error('network down'))
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByTestId('functions-library-error')

    listSpy.mockResolvedValueOnce({
      functions: [],
      pagination: { page: 1, per_page: 100, total: 0, total_pages: 0 },
    })
    await user.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(await screen.findByText(/no published functions yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('functions-library-error')).not.toBeInTheDocument()
  })
})


describe('FunctionsLibraryModal - listFunctions cancellation', () => {
  it('ignores the listFunctions response when the modal unmounts before it resolves', async () => {
    let resolveList!: (result: { functions: never[]; pagination: { page: number; per_page: number; total: number; total_pages: number } }) => void
    vi.spyOn(functionsApi, 'listFunctions').mockReturnValueOnce(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )
    const { unmount } = render(
      <FunctionsLibraryModal isOpen={true} onClose={() => {}} />,
    )
    unmount()
    resolveList({
      functions: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
    })
    await Promise.resolve()
    expect(screen.queryByRole('region', { name: /functions library/i })).not.toBeInTheDocument()
  })

  it('ignores the listFunctions rejection when the modal unmounts before it settles', async () => {
    let rejectList!: (err: unknown) => void
    vi.spyOn(functionsApi, 'listFunctions').mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectList = reject
      }),
    )
    const { unmount } = render(
      <FunctionsLibraryModal isOpen={true} onClose={() => {}} />,
    )
    unmount()
    rejectList(new Error('network down'))
    await Promise.resolve()
    expect(screen.queryByRole('region', { name: /functions library/i })).not.toBeInTheDocument()
  })

  // Covers the executed (`!canceled === true`) side of the spinner-clear
  // guard inside the `finally` setTimeout. The fetch settles WHILE mounted,
  // so `.finally` schedules the 400 ms timer; firing that timer while the
  // modal is still mounted runs `setIsRefreshing(false)`.
  //
  // We capture the timer callback by stubbing setTimeout (rather than using
  // fake timers, which interfere with v8 coverage's async temp-file flush)
  // and invoke it manually while still mounted.
  it('clears the spinner when the spinner timer fires while still mounted', async () => {
    let timerCb: (() => void) | null = null
    const originalSetTimeout = globalThis.setTimeout
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: () => void, ms?: number) => {
        // Only intercept the modal's spinner-clear timer (delay <= 400 ms);
        // defer all other timers to the real implementation so unrelated
        // async machinery keeps working.
        if (typeof ms === 'number' && ms <= 400) {
          timerCb = cb
          return 0 as unknown as ReturnType<typeof setTimeout>
        }
        return originalSetTimeout(cb, ms)
      }) as typeof setTimeout)
    try {
      let resolveList!: (result: {
        functions: never[]
        pagination: { page: number; per_page: number; total: number; total_pages: number }
      }) => void
      vi.spyOn(functionsApi, 'listFunctions').mockReturnValueOnce(
        new Promise((resolve) => {
          resolveList = resolve
        }),
      )
      render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
      // Settle the fetch while still mounted so `.then` AND `.finally` both
      // run and the spinner-clear timer callback is captured above.
      await domAct(async () => {
        resolveList({
          functions: [],
          pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
        })
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(timerCb).not.toBeNull()
      // Fire the captured spinner-clear callback while still mounted; its
      // `if (!canceled)` guard is true, so setIsRefreshing(false) runs.
      domAct(() => {
        timerCb?.()
      })
      const refresh = screen.getByRole('button', { name: /refresh/i })
      expect(refresh).not.toHaveAttribute('aria-busy', 'true')
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})


describe('FunctionsLibraryModal - viewport-clamp edge cases', () => {
  /**
   * The viewport-clamp helper has two fallback branches: when the modal is
   * wider than the viewport, the left edge is pinned to 0; when it's taller
   * than the viewport, the top edge is pinned to 0. These can't normally be
   * triggered through user gestures in jsdom (offsetWidth/offsetHeight are
   * always 0), so we drive them by spying on the element's metrics.
   */
  function withModalSize(width: number, height: number, run: () => void): void {
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

  it('clamps the drag offset within the viewport (x and y bounds)', () => {
    window.innerWidth = 1200
    window.innerHeight = 800
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = screen.getByTestId('functions-library-drag-handle')
    withModalSize(400, 200, () => {
      // Drag far to the right (clamps to vw/2 - halfW = 400).
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10000, clientY: 10000 })
    })
    const root = screen.getByRole('region', { name: /functions library/i })
    // The X is clamped to 400 (vw/2 - halfW); Y is clamped to 300 (vh/2 - halfH).
    expect(root.style.transform).toContain('400')
    expect(root.style.transform).toContain('300')

    withModalSize(400, 200, () => {
      // Drag far to the left/top (clamps to -400 / -300).
      fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(handle, { pointerId: 2, clientX: -10000, clientY: -10000 })
    })
    expect(root.style.transform).toContain('-400')
    expect(root.style.transform).toContain('-300')
  })

  it('clears a stray text selection on pointerdown so the browser does not start a text-drag', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = screen.getByTestId('functions-library-drag-handle')
    // Mock window.getSelection to simulate an existing non-collapsed selection.
    const removeAllRanges = vi.fn()
    const originalGetSelection = window.getSelection
    window.getSelection = vi.fn(() => ({
      isCollapsed: false,
      removeAllRanges,
    })) as unknown as typeof window.getSelection
    try {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      expect(removeAllRanges).toHaveBeenCalled()
    } finally {
      window.getSelection = originalGetSelection
    }
  })

  it('pins the left edge when the modal width exceeds the viewport', () => {
    window.innerWidth = 800
    window.innerHeight = 800
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = screen.getByTestId('functions-library-drag-handle')
    withModalSize(2000, 100, () => {
      // Try to drag the modal right by 100px. The clamp pins it because
      // the modal is wider than the viewport.
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 0 })
    })
    const root = screen.getByRole('region', { name: /functions library/i })
    // halfW - vw/2 = 1000 - 400 = 600
    expect(root.style.transform).toContain('600')
  })

  it('pins the top edge when the modal height exceeds the viewport', () => {
    window.innerWidth = 800
    window.innerHeight = 400
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const handle = screen.getByTestId('functions-library-drag-handle')
    withModalSize(100, 1000, () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 100 })
    })
    const root = screen.getByRole('region', { name: /functions library/i })
    // halfH - vh/2 = 500 - 200 = 300
    expect(root.style.transform).toContain('300')
  })
})

describe('FunctionsLibraryModal - width resize handle (FN-LC-6)', () => {
  it('renders the shared resize handle after the DraggableSheet migration', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(screen.getByTestId('dialog-resize-handle')).toBeInTheDocument()
  })

  it('resizes the sheet width within the shared 520-1200 clamp', () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const root = screen.getByRole('region', { name: /functions library/i })
    const handle = screen.getByTestId('dialog-resize-handle')

    fireEvent.mouseDown(handle, { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 10000 })
    fireEvent.mouseUp(document)
    expect(root.style.width).toBe('1200px')

    fireEvent.mouseDown(handle, { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: -10000 })
    fireEvent.mouseUp(document)
    expect(root.style.width).toBe('520px')
  })
})
