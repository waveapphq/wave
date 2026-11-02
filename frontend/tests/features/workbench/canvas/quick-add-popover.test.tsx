/**
 * Quick Insert window (REQ-4.2.5, CANVAS-231..237, PICKER-1..5).
 *
 * A movable window: header bar with a title and a close control, its own
 * substring search, a caret that never leaves the search box, Tab / PgUp /
 * PgDn as highlight movers, two insert modes - Enter at the resolved anchor,
 * Ctrl+Enter at viewport center - and one permanent status line under the
 * list describing the server-paged Functions half.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: vi.fn(() => new Promise(() => {})),
}))

import { QuickAddPopover } from '@/features/workbench/common/canvas/quick-add/quick-add-popover'
import type { QuickAddFunctionsState } from '@/features/workbench/common/canvas/quick-add/use-quick-add-functions'
import type { QuickAddItem } from '@/features/workbench/lib/quick-add-catalog'

const ITEMS: QuickAddItem[] = [
  {
    id: 'log',
    name: 'Log',
    type: 'plugin',
    group: 'plugins',
    iconName: 'ScrollText',
    colorClass: 'text-slate-400',
    categoryLabel: 'System',
  },
  {
    id: 'http-client',
    name: 'HTTP',
    type: 'plugin',
    group: 'plugins',
    iconName: 'Globe',
    colorClass: 'text-blue-500',
    categoryLabel: 'Network',
  },
  {
    id: 'shell-script',
    name: 'Shell Script',
    type: 'plugin',
    group: 'plugins',
    iconName: 'FileTerminal',
    colorClass: 'text-emerald-500',
    categoryLabel: 'System',
  },
  {
    id: 'while',
    name: 'While Loop',
    type: 'control',
    group: 'controls',
    iconName: 'RefreshCw',
    colorClass: 'text-cyan-500',
    categoryLabel: 'Loops',
  },
  {
    id: 'assert',
    name: 'Assert',
    type: 'control',
    group: 'controls',
    iconName: 'CheckCircle',
    colorClass: 'text-orange-500',
    categoryLabel: 'Conditionals',
  },
  {
    id: 'fail',
    name: 'Fail Test',
    type: 'control',
    group: 'controls',
    iconName: 'XCircle',
    colorClass: 'text-red-500',
    categoryLabel: 'Flow',
  },
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'fetch_user',
    type: 'function',
    group: 'functions',
    iconName: 'Braces',
    colorClass: 'text-emerald-500',
    functionId: '00000000-0000-0000-0000-000000000001',
    version: '1.0.0',
  },
  {
    id: 'new-function',
    name: 'New Function',
    type: 'new-function',
    group: 'functions',
    iconName: 'Plus',
    colorClass: 'text-emerald-500',
  },
]

/** The catalog for the search cases: exactly two rows match "del", a plugin then a control. */
const SEARCH_ITEMS: QuickAddItem[] = [
  ...ITEMS,
  {
    id: 'k8s-delete',
    name: 'K8s Delete',
    type: 'plugin',
    group: 'plugins',
    iconName: 'Trash2',
    colorClass: 'text-sky-500',
    categoryLabel: 'Kubernetes',
  },
  {
    id: 'delay',
    name: 'Delay',
    type: 'control',
    group: 'controls',
    iconName: 'Timer',
    colorClass: 'text-cyan-500',
    categoryLabel: 'Timing',
  },
]

/** A list comfortably longer than one visible page, for the paging keys. */
const LONG_ITEMS: QuickAddItem[] = Array.from({ length: 30 }, (_, index) => ({
  id: `plugin-${index}`,
  name: `Plugin ${index}`,
  type: 'plugin' as const,
  group: 'plugins' as const,
  iconName: 'Puzzle',
  colorClass: 'text-slate-400',
  categoryLabel: 'System',
}))

/** Rows the server hands back, appended after the built-ins. */
const SERVER_FUNCTIONS: QuickAddItem[] = [
  {
    id: 'fn-1',
    name: 'assert_pod_ready',
    type: 'function',
    group: 'functions',
    iconName: 'FunctionSquare',
    colorClass: 'text-emerald-500',
    functionId: 'fn-1',
    version: '2.3.1',
  },
  {
    id: 'fn-2',
    name: 'send_report',
    type: 'function',
    group: 'functions',
    iconName: 'FunctionSquare',
    colorClass: 'text-emerald-500',
    functionId: 'fn-2',
    version: '1.0.0',
  },
]

function makeFunctions(
  overrides: Partial<QuickAddFunctionsState> = {},
): QuickAddFunctionsState {
  return {
    items: [],
    total: 0,
    status: 'ready',
    appliedQuery: '',
    onQueryChange: vi.fn(),
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  }
}

interface RenderOptions {
  open?: boolean
  hasSelection?: boolean
  items?: QuickAddItem[]
  functions?: QuickAddFunctionsState
  onInsert?: ReturnType<typeof vi.fn>
  onOpenChange?: ReturnType<typeof vi.fn>
}

function renderPopover(options: RenderOptions = {}) {
  const onInsert = options.onInsert ?? vi.fn()
  const onOpenChange = options.onOpenChange ?? vi.fn()
  const functions = options.functions ?? makeFunctions()
  render(
    <QuickAddPopover
      open={options.open ?? true}
      onOpenChange={onOpenChange}
      onInsert={onInsert}
      items={options.items ?? ITEMS}
      functions={functions}
      hasSelection={options.hasSelection ?? false}
    />,
  )
  return { onInsert, onOpenChange, functions }
}

function getStatusLine(): HTMLElement {
  return screen.getByTestId('quick-add-functions-status')
}

function getWindow(): HTMLElement {
  return screen.getByTestId('quick-add-popover')
}

function getInput(): HTMLElement {
  return screen.getByRole('combobox')
}

function getItem(id: string): HTMLElement {
  return screen.getByTestId(`quick-add-item-${id}`)
}

function highlightedId(): string | null {
  const row = getWindow().querySelector('[aria-selected="true"][data-testid^="quick-add-item-"]')
  return row?.getAttribute('data-testid')?.replace('quick-add-item-', '') ?? null
}

function visibleRowIds(): string[] {
  return [...getWindow().querySelectorAll('[data-testid^="quick-add-item-"]')].map(
    (row) => row.getAttribute('data-testid')!.replace('quick-add-item-', ''),
  )
}

function makeDataTransfer() {
  const data: Record<string, string> = {}
  return {
    data,
    effectAllowed: '',
    dropEffect: '',
    types: [] as string[],
    setData: (type: string, value: string) => {
      data[type] = value
    },
    getData: (type: string) => data[type] ?? '',
    setDragImage: () => {},
  }
}

describe('Quick Insert - window shell', () => {
  it('renders nothing when closed', () => {
    renderPopover({ open: false })
    expect(screen.queryByTestId('quick-add-popover')).not.toBeInTheDocument()
  })

  it('names itself in a header bar', () => {
    renderPopover()
    expect(within(getWindow()).getByText('Quick Insert')).toBeInTheDocument()
  })

  it('offers a close control with an accessible name', () => {
    const { onOpenChange } = renderPopover()

    fireEvent.click(within(getWindow()).getByRole('button', { name: /close/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Escape without inserting', () => {
    const { onInsert, onOpenChange } = renderPopover()

    fireEvent.keyDown(getInput(), { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('does not start a drag when the close control is pressed', () => {
    // The header bar is the drag handle; its controls must not begin a drag.
    renderPopover()
    const close = within(getWindow()).getByRole('button', { name: /close/i })

    const event = fireEvent.pointerDown(close, { bubbles: true, cancelable: true })

    expect(event).toBe(false)
  })

  it('still opens when the viewport reports no height', () => {
    // The opening position is derived from viewport height; a host that
    // reports none must not collapse the window out of view.
    vi.stubGlobal('innerHeight', 0)
    try {
      renderPopover()
      expect(getWindow()).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Quick Insert - catalog rendering', () => {
  it('renders the grouped catalog', () => {
    renderPopover()
    expect(screen.getByText('PLUGINS')).toBeInTheDocument()
    expect(screen.getByText('CONTROLS')).toBeInTheDocument()
    expect(screen.getByText('FUNCTIONS')).toBeInTheDocument()
    for (const item of ITEMS) {
      expect(getItem(item.id)).toBeInTheDocument()
    }
  })

  it('puts the caret in the search box on open', () => {
    renderPopover()
    expect(getInput()).toHaveFocus()
  })

  it('highlights the first row on open', () => {
    renderPopover()
    expect(highlightedId()).toBe('log')
  })

  it('shows the version badge on library Function rows', () => {
    renderPopover()
    expect(
      within(getItem('00000000-0000-0000-0000-000000000001')).getByText('v1.0.0'),
    ).toBeInTheDocument()
  })

  it('shows the empty Local Function hint on the New Function row', () => {
    renderPopover()
    expect(
      within(getItem('new-function')).getByText(/empty local function/i),
    ).toBeInTheDocument()
  })
})

describe('Quick Insert - substring search', () => {
  it('leaves exactly the two matching rows, a plugin before a control', async () => {
    const user = userEvent.setup()
    renderPopover({ items: SEARCH_ITEMS })

    await user.type(getInput(), 'del')

    expect(visibleRowIds()).toEqual(['k8s-delete', 'delay'])
  })

  it('hides a group that has no match', async () => {
    const user = userEvent.setup()
    renderPopover()

    await user.type(getInput(), 'as')

    expect(screen.queryByText('FUNCTIONS')).not.toBeInTheDocument()
  })

  it('re-highlights the first remaining row on every query change', async () => {
    const user = userEvent.setup()
    renderPopover({ items: SEARCH_ITEMS })
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    expect(highlightedId()).toBe('http-client')

    await user.type(getInput(), 'del')

    expect(highlightedId()).toBe('k8s-delete')
  })

  it('shows the empty state when nothing matches, keeping the hints', async () => {
    const user = userEvent.setup()
    renderPopover()

    await user.type(getInput(), 'zzzznothing')

    expect(screen.getByText('No matching items')).toBeInTheDocument()
    expect(within(getWindow()).getByText(/drag a row onto the canvas/i)).toBeInTheDocument()
  })

  it('inserts nothing when Enter is pressed with no match', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()

    await user.type(getInput(), 'zzzznothing')
    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onInsert).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('inserts nothing when Ctrl+Enter is pressed with no match', async () => {
    const user = userEvent.setup()
    const { onInsert, onOpenChange } = renderPopover()

    await user.type(getInput(), 'zzzznothing')
    fireEvent.keyDown(getInput(), { key: 'Enter', ctrlKey: true })

    expect(onInsert).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe('Quick Insert - highlight movement', () => {
  it('moves the highlight with ArrowDown and ArrowUp', () => {
    renderPopover()

    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    expect(highlightedId()).toBe('http-client')

    fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
    expect(highlightedId()).toBe('log')
  })

  it('treats Tab as the next-row key', () => {
    renderPopover()

    fireEvent.keyDown(getInput(), { key: 'Tab' })

    expect(highlightedId()).toBe('http-client')
  })

  it('treats Shift+Tab as the previous-row key', () => {
    renderPopover()
    fireEvent.keyDown(getInput(), { key: 'Tab' })

    fireEvent.keyDown(getInput(), { key: 'Tab', shiftKey: true })

    expect(highlightedId()).toBe('log')
  })

  it('keeps the caret in the search box when Tab is pressed', () => {
    renderPopover()

    const notPrevented = fireEvent.keyDown(getInput(), {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })

    expect(notPrevented).toBe(false)
    expect(getInput()).toHaveFocus()
  })

  it('moves the highlight a whole page with PageDown', () => {
    renderPopover({ items: LONG_ITEMS })

    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    const afterOneRow = highlightedId()
    fireEvent.keyDown(getInput(), { key: 'ArrowUp' })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).not.toBe(afterOneRow)
    expect(highlightedId()).not.toBe('plugin-0')
    expect(highlightedId()).not.toBe('plugin-29')
  })

  it('returns to the starting row with PageUp', () => {
    renderPopover({ items: LONG_ITEMS })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('plugin-0')
  })

  it('clamps PageDown to the last row on a short list', () => {
    renderPopover()

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('new-function')
  })

  it('has nothing to move when no row matches', async () => {
    const user = userEvent.setup()
    renderPopover()
    await user.type(getInput(), 'zzzznothing')

    fireEvent.keyDown(getInput(), { key: 'Tab' })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBeNull()
    expect(screen.getByText('No matching items')).toBeInTheDocument()
  })

  it('clamps PageUp to the first row', () => {
    renderPopover()
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('log')
  })
})

describe('Quick Insert - revealing the moved highlight', () => {
  /** Every scroll the press asked for: what it targeted, and where it lands. */
  function scrolls(spy: ReturnType<typeof vi.spyOn>) {
    return (spy.mock.contexts as Element[]).map((target, index) => {
      const testId = target.getAttribute('data-testid')
      const options = spy.mock.calls[index][0] as ScrollIntoViewOptions
      return {
        target: testId
          ? testId.replace('quick-add-item-', '')
          : `heading:${target.textContent}`,
        block: options.block,
      }
    })
  }

  it('nudges the row Tab lands on into view', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover()
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'Tab' })

    expect(highlightedId()).toBe('http-client')
    expect(scrolls(spy)).toEqual([{ target: 'http-client', block: 'nearest' }])
    spy.mockRestore()
  })

  it('nudges the row Shift+Tab lands on into view', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover()
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'Tab', shiftKey: true })

    expect(highlightedId()).toBe('http-client')
    expect(scrolls(spy)).toEqual([{ target: 'http-client', block: 'nearest' }])
    spy.mockRestore()
  })

  it('puts the row PageDown lands on at the top of the list', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover({ items: LONG_ITEMS })
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-10')
    expect(scrolls(spy)).toEqual([{ target: 'plugin-10', block: 'start' }])
    expect(getInput()).toHaveFocus()
    spy.mockRestore()
  })

  it('puts the row PageUp lands on at the bottom of the list', () => {
    // The mirror of PageDown: landing on the far edge it traveled to is what
    // uncovers a screenful, here the rows above the row it stopped on.
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover({ items: LONG_ITEMS })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('plugin-10')
    expect(scrolls(spy)).toEqual([{ target: 'plugin-10', block: 'end' }])
    spy.mockRestore()
  })

  it('reveals the group heading when the highlight opens a group', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover()
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'Tab' })

    expect(highlightedId()).toBe('while')
    // The set, not the sequence: the row and its heading both end up revealed
    // whichever order they are asked for in.
    const asked = scrolls(spy)
    expect(asked).toHaveLength(2)
    expect(asked).toEqual(
      expect.arrayContaining([
        { target: 'while', block: 'nearest' },
        { target: 'heading:CONTROLS', block: 'nearest' },
      ]),
    )
    spy.mockRestore()
  })

  it('scrolls nothing when the row it moves to has left the list', () => {
    const { onInsert } = renderPopover({ items: LONG_ITEMS })
    getItem('plugin-10').remove()
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(spy).not.toHaveBeenCalled()
    // The highlight still moved: Ctrl+Enter inserts the row that is not there.
    fireEvent.keyDown(getInput(), { key: 'Enter', ctrlKey: true })
    expect(onInsert).toHaveBeenCalledWith(LONG_ITEMS[10], 'center')
    spy.mockRestore()
  })
})

describe('Quick Insert - the page step follows the list', () => {
  function boxAt(top: number, height: number): DOMRect {
    return {
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }

  /** Lays the list out: a box of its own, with the rows stacked inside it. */
  function layOutList(options: {
    viewport: number
    rowHeight: number
    /** Space above the first row, as a group heading takes. */
    headingHeight?: number
    /** Rows already scrolled off the top edge. */
    scrolledRows?: number
  }) {
    const { viewport, rowHeight, headingHeight = 0, scrolledRows = 0 } = options
    const list = screen.getByTestId('quick-add-list')
    Object.defineProperty(list, 'clientHeight', { value: viewport, configurable: true })
    list.getBoundingClientRect = () => boxAt(0, viewport)
    const rows = getWindow().querySelectorAll<HTMLElement>('[data-testid^="quick-add-item-"]')
    rows.forEach((row, index) => {
      const top = headingHeight + (index - scrolledRows) * rowHeight
      row.getBoundingClientRect = () => boxAt(top, rowHeight)
    })
  }

  /**
   * What a browser does with the reveal a page key asks for: the row it landed
   * on goes to the top, as far as the end of the list allows.
   */
  function scrollHighlightToTop(viewport: number, rowHeight: number) {
    const fits = Math.floor(viewport / rowHeight)
    const landed = Number(highlightedId()!.replace('plugin-', ''))
    layOutList({
      viewport,
      rowHeight,
      scrolledRows: Math.min(landed, LONG_ITEMS.length - fits),
    })
  }

  /** The same for a PageUp reveal: the row it landed on goes to the bottom. */
  function scrollHighlightToBottom(viewport: number, rowHeight: number) {
    const fits = Math.floor(viewport / rowHeight)
    const landed = Number(highlightedId()!.replace('plugin-', ''))
    layOutList({
      viewport,
      rowHeight,
      scrolledRows: Math.max(0, landed - fits + 1),
    })
  }

  it('lands on the last row the list shows in full', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    // Six rows are shown whole, and the sixth is the last one seen.
    expect(highlightedId()).toBe('plugin-5')
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.contexts as Element[])[0]).toBe(getItem('plugin-5'))
    expect(spy.mock.calls[0][0]).toEqual({ block: 'start' })
    spy.mockRestore()
  })

  it('does not step over a row a group heading pushed below the fold', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50, headingHeight: 28 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    // The heading takes the sixth row's place, so only five are shown whole.
    expect(highlightedId()).toBe('plugin-4')
  })

  it('walks on from where the last press left the list', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    layOutList({ viewport: 300, rowHeight: 50, scrolledRows: 5 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-10')
  })

  it('measures again on every press, so taller rows page more slowly', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('plugin-5')

    layOutList({ viewport: 300, rowHeight: 100, scrolledRows: 5 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-7')
  })

  it('starts the screenful above when the highlight is already on the top row shown', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('plugin-5')

    layOutList({ viewport: 300, rowHeight: 50, scrolledRows: 5 })
    spy.mockClear()
    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    // The nearest row above the box, which the reveal then puts at the bottom.
    expect(highlightedId()).toBe('plugin-4')
    expect(spy.mock.calls[0][0]).toEqual({ block: 'end' })
    spy.mockRestore()
  })

  it('steps ten rows when the list reports no height', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 0, rowHeight: 50 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-10')
  })

  it('steps ten rows back when the list reports no height', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 0, rowHeight: 50 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('plugin-20')

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('plugin-10')
  })

  it('follows the rows on screen when the list was scrolled away from the highlight', () => {
    renderPopover({ items: LONG_ITEMS })
    // A wheel scroll leaves the highlight far above the rows now on screen.
    layOutList({ viewport: 300, rowHeight: 50, scrolledRows: 20 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    // The key reads the box, not the distance to the highlight.
    expect(highlightedId()).toBe('plugin-25')
  })

  it('never steps over a row the list kept below the fold', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    for (let press = 0; press < 3; press++) {
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    }
    expect(highlightedId()).toBe('plugin-3')

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    // Rows 6 and 7 sit below the fold, so the press cannot reach past them.
    expect(highlightedId()).toBe('plugin-5')
  })

  it('pages a screenful a press either way, after one row to turn around', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    const down: Array<string | null> = []
    for (let press = 0; press < 4; press++) {
      fireEvent.keyDown(getInput(), { key: 'PageDown' })
      down.push(highlightedId())
      scrollHighlightToTop(300, 50)
    }

    const up: Array<string | null> = []
    for (let press = 0; press < 4; press++) {
      fireEvent.keyDown(getInput(), { key: 'PageUp' })
      up.push(highlightedId())
      scrollHighlightToBottom(300, 50)
    }

    expect(down).toEqual(['plugin-5', 'plugin-10', 'plugin-15', 'plugin-20'])
    // The turn costs one row: the highlight is already the top row shown.
    expect(up).toEqual(['plugin-19', 'plugin-14', 'plugin-9', 'plugin-4'])
  })

  it('brings the highlight back to the top row on screen', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    scrollHighlightToTop(300, 50)
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('plugin-10')
    spy.mockClear()

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    // Rows 5 to 10 are still the ones on screen: the press stops at the first.
    expect(highlightedId()).toBe('plugin-5')
    // And it lands there at the bottom, so the rows above it come into view.
    expect(spy.mock.calls[0][0]).toEqual({ block: 'end' })
    spy.mockRestore()
  })

  it('stops on the last row instead of running past the end', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })

    for (let press = 0; press < 10; press++) {
      fireEvent.keyDown(getInput(), { key: 'PageDown' })
      scrollHighlightToTop(300, 50)
    }

    // The list clamps five presses before the last one, and the key clamps with it.
    expect(highlightedId()).toBe('plugin-29')
  })

  it('stops on the first row instead of running past the start', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    for (let press = 0; press < 10; press++) {
      fireEvent.keyDown(getInput(), { key: 'PageDown' })
      scrollHighlightToTop(300, 50)
    }
    expect(highlightedId()).toBe('plugin-29')

    for (let press = 0; press < 10; press++) {
      fireEvent.keyDown(getInput(), { key: 'PageUp' })
      scrollHighlightToBottom(300, 50)
    }

    expect(highlightedId()).toBe('plugin-0')
  })

  it('moves one row when the rows report no height', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 0 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-1')
  })

  it('moves one row back when the rows report no height', () => {
    renderPopover({ items: LONG_ITEMS })
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    layOutList({ viewport: 300, rowHeight: 0 })

    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('plugin-0')
  })

  it('still moves one row when the list is shorter than a single row', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 20, rowHeight: 50 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    expect(highlightedId()).toBe('plugin-1')
  })

  it('still moves in both directions when only one row fits the box', () => {
    renderPopover({ items: LONG_ITEMS })
    for (let press = 0; press < 3; press++) {
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    }
    layOutList({ viewport: 60, rowHeight: 50, scrolledRows: 3 })

    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('plugin-4')

    layOutList({ viewport: 60, rowHeight: 50, scrolledRows: 4 })
    fireEvent.keyDown(getInput(), { key: 'PageUp' })

    expect(highlightedId()).toBe('plugin-3')
  })

  it('starts the next screenful when the highlight is already on the last row shown', () => {
    renderPopover({ items: LONG_ITEMS })
    layOutList({ viewport: 300, rowHeight: 50 })
    for (let press = 0; press < 5; press++) {
      fireEvent.keyDown(getInput(), { key: 'ArrowDown' })
    }
    expect(highlightedId()).toBe('plugin-5')

    fireEvent.keyDown(getInput(), { key: 'PageDown' })

    // The first row still unseen, which the reveal then puts at the top.
    expect(highlightedId()).toBe('plugin-6')
  })
})

describe('Quick Insert - caret retention', () => {
  function focusElsewhere(): HTMLElement {
    const outside = document.createElement('button')
    outside.setAttribute('data-testid', 'outside-target')
    document.body.appendChild(outside)
    outside.focus()
    return outside
  }

  it('returns the caret to the search box when the window is clicked', () => {
    renderPopover()
    focusElsewhere()
    expect(getInput()).not.toHaveFocus()

    fireEvent.mouseDown(getWindow())

    expect(getInput()).toHaveFocus()
  })

  it('returns the caret when a group heading is clicked', () => {
    renderPopover()
    focusElsewhere()

    fireEvent.mouseDown(screen.getByText('CONTROLS'))

    expect(getInput()).toHaveFocus()
  })

  it('returns the caret when the footer is clicked', () => {
    renderPopover()
    focusElsewhere()

    fireEvent.mouseDown(within(getWindow()).getByText(/drag a row onto the canvas/i))

    expect(getInput()).toHaveFocus()
  })

  it('returns the caret when the title bar is pressed', () => {
    // The title bar cancels the mouse event to drive its drag, so the caret
    // has to be restored from the pointer event instead.
    renderPopover()
    focusElsewhere()

    fireEvent.pointerDown(screen.getByTestId('quick-add-popover-drag-handle'))

    expect(getInput()).toHaveFocus()
  })

  it('keeps the caret while the window is dragged by its title bar', () => {
    renderPopover()
    focusElsewhere()
    const handle = screen.getByTestId('quick-add-popover-drag-handle')

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 40 })
    fireEvent.pointerUp(handle)

    expect(getInput()).toHaveFocus()
  })

  it('returns the caret when the title text itself is pressed', () => {
    renderPopover()
    focusElsewhere()

    fireEvent.pointerDown(within(getWindow()).getByText('Quick Insert'))

    expect(getInput()).toHaveFocus()
  })

  it('makes the movement keys live again after clicking away and back', () => {
    renderPopover()
    focusElsewhere()

    fireEvent.mouseDown(getWindow())
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })

    expect(highlightedId()).toBe('http-client')
  })
})

describe('Quick Insert - insert modes', () => {
  it('Enter inserts at the resolved anchor and closes', () => {
    const { onInsert, onOpenChange } = renderPopover()

    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'log' }), 'anchor')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Ctrl+Enter inserts at the viewport center and closes', () => {
    const { onInsert, onOpenChange } = renderPopover()

    fireEvent.keyDown(getInput(), { key: 'Enter', ctrlKey: true })

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'log' }), 'center')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Cmd+Enter maps to the center mode for macOS keyboards', () => {
    const { onInsert } = renderPopover()

    fireEvent.keyDown(getInput(), { key: 'Enter', metaKey: true })

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'log' }), 'center')
  })

  it('Alt+Enter does nothing at all', () => {
    const { onInsert, onOpenChange } = renderPopover({ hasSelection: true })

    fireEvent.keyDown(getInput(), { key: 'Enter', altKey: true })

    expect(onInsert).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('inserts the highlighted row rather than the first one', () => {
    const { onInsert } = renderPopover()
    fireEvent.keyDown(getInput(), { key: 'ArrowDown' })

    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onInsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'http-client' }),
      'anchor',
    )
  })

  it('clicking a row inserts at the anchor, like Enter', () => {
    const { onInsert, onOpenChange } = renderPopover()

    fireEvent.click(getItem('while'))

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'while' }), 'anchor')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('Quick Insert - footer hints', () => {
  it('names the anchor as the last block when nothing is selected', () => {
    renderPopover({ hasSelection: false })

    expect(within(getWindow()).getByText(/add after last block/i)).toBeInTheDocument()
    expect(within(getWindow()).queryByText(/add after selection/i)).not.toBeInTheDocument()
  })

  it('names the anchor as the selection when one block is selected', () => {
    renderPopover({ hasSelection: true })

    expect(within(getWindow()).getByText(/add after selection/i)).toBeInTheDocument()
    expect(within(getWindow()).queryByText(/add after last block/i)).not.toBeInTheDocument()
  })

  it('lists the movement, center, paging and close hints', () => {
    renderPopover()
    const popover = getWindow()

    expect(within(popover).getByText(/navigate/i)).toBeInTheDocument()
    expect(within(popover).getByText(/add at center/i)).toBeInTheDocument()
    expect(within(popover).getByText(/^page$/i)).toBeInTheDocument()
    expect(within(popover).getByText(/close/i)).toBeInTheDocument()
  })

  it('leads the drag hint with a pointer badge', () => {
    renderPopover()

    const hint = screen.getByTestId('quick-add-hint-pointer')

    expect(hint).toHaveTextContent(/drag a row onto the canvas/i)
    expect(hint.querySelector('svg')).toBeInTheDocument()
  })

  it('advertises click-to-add with its own pointer badge', () => {
    renderPopover()

    const hint = screen.getByTestId('quick-add-hint-click')

    expect(hint).toHaveTextContent(/click a row to add/i)
    expect(hint.querySelector('svg')).toBeInTheDocument()
  })

  it('no longer advertises Alt+Enter', () => {
    renderPopover({ hasSelection: true })

    expect(screen.queryByText(/alt\+enter/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('quick-add-hint-after-selection')).not.toBeInTheDocument()
  })
})

describe('Quick Insert - drag sources (CANVAS-226)', () => {
  it('marks every row as an HTML5 drag source', () => {
    renderPopover()
    for (const item of ITEMS) {
      expect(getItem(item.id)).toHaveAttribute('draggable', 'true')
    }
  })

  it('leaves a row press alone so the drag gesture survives', () => {
    // Pulling focus back to the search box mid-press cancels the drag; a row
    // is closing the window either way, so the caret does not matter there.
    renderPopover()
    const row = getItem('log')
    ;(getInput() as HTMLInputElement).blur()

    const pointer = fireEvent.pointerDown(row, { bubbles: true, cancelable: true })
    const mouse = fireEvent.mouseDown(row, { bubbles: true, cancelable: true })

    // Neither event was canceled, and the caret was not pulled back.
    expect(pointer).toBe(true)
    expect(mouse).toBe(true)
    expect(getInput()).not.toHaveFocus()
  })

  it('emits the palette plugin payload on dragstart', () => {
    renderPopover()
    const dt = makeDataTransfer()

    fireEvent.dragStart(getItem('log'), { dataTransfer: dt })

    const payload = JSON.parse(dt.getData('application/wave-block'))
    expect(payload).toMatchObject({
      id: 'log',
      name: 'Log',
      type: 'plugin',
    })
    expect(payload).not.toHaveProperty('category')
  })

  it('emits the palette control payload on dragstart', () => {
    renderPopover()
    const dt = makeDataTransfer()

    fireEvent.dragStart(getItem('while'), { dataTransfer: dt })

    const payload = JSON.parse(dt.getData('application/wave-block'))
    expect(payload).toMatchObject({
      id: 'while',
      name: 'While Loop',
      type: 'control',
    })
    expect(payload).not.toHaveProperty('category')
  })

  it('emits the function-published payload on dragstart of a Function row', () => {
    renderPopover()
    const dt = makeDataTransfer()

    fireEvent.dragStart(getItem('00000000-0000-0000-0000-000000000001'), { dataTransfer: dt })

    expect(JSON.parse(dt.getData('application/wave-block'))).toMatchObject({
      type: 'function-published',
      functionId: '00000000-0000-0000-0000-000000000001',
      name: 'fetch_user',
      version: '1.0.0',
    })
  })

  it('emits the function-new-local payload on dragstart of the New Function row', () => {
    renderPopover()
    const dt = makeDataTransfer()

    fireEvent.dragStart(getItem('new-function'), { dataTransfer: dt })

    expect(JSON.parse(dt.getData('application/wave-block'))).toMatchObject({
      type: 'function-new-local',
    })
  })
})

describe('Quick Insert - paged Function rows (PICKER-1)', () => {
  it('renders server Function rows after the New Function row', () => {
    renderPopover({ functions: makeFunctions({ items: SERVER_FUNCTIONS, total: 2 }) })

    const ids = visibleRowIds()
    expect(ids.slice(-3)).toEqual(['new-function', 'fn-1', 'fn-2'])
  })

  it('makes a server Function row a drag source like any other', () => {
    renderPopover({ functions: makeFunctions({ items: SERVER_FUNCTIONS, total: 2 }) })
    const dt = makeDataTransfer()

    fireEvent.dragStart(getItem('fn-1'), { dataTransfer: dt })

    expect(JSON.parse(dt.getData('application/wave-block'))).toMatchObject({
      type: 'function-published',
      functionId: 'fn-1',
      version: '2.3.1',
    })
  })

  it('hands every keystroke to the search owner, undebounced', async () => {
    const user = userEvent.setup()
    const { functions } = renderPopover()

    await user.type(getInput(), 'ab')

    const onQueryChange = vi.mocked(functions.onQueryChange)
    expect(onQueryChange).toHaveBeenCalledTimes(2)
    expect(onQueryChange).toHaveBeenNthCalledWith(1, 'a')
    expect(onQueryChange).toHaveBeenNthCalledWith(2, 'ab')
  })

  it('narrows the loaded Function rows with the same search as the blocks', async () => {
    const user = userEvent.setup()
    renderPopover({ functions: makeFunctions({ items: SERVER_FUNCTIONS, total: 2 }) })

    await user.type(getInput(), 'send')

    expect(visibleRowIds()).toEqual(['fn-2'])
  })

  it('leaves the highlight where it is when Function rows arrive', () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onInsert: vi.fn(),
      items: ITEMS,
      hasSelection: false,
    }
    const { rerender } = render(<QuickAddPopover {...props} functions={makeFunctions()} />)
    expect(highlightedId()).toBe('log')

    rerender(
      <QuickAddPopover
        {...props}
        functions={makeFunctions({ items: SERVER_FUNCTIONS, total: 2 })}
      />,
    )

    expect(highlightedId()).toBe('log')
  })

  it('leaves a deliberately moved highlight alone when Function rows arrive', () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      onInsert: vi.fn(),
      items: ITEMS,
      hasSelection: false,
    }
    const { rerender } = render(<QuickAddPopover {...props} functions={makeFunctions()} />)
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    expect(highlightedId()).toBe('http-client')

    rerender(
      <QuickAddPopover
        {...props}
        functions={makeFunctions({ items: SERVER_FUNCTIONS, total: 2 })}
      />,
    )

    expect(highlightedId()).toBe('http-client')
  })
})

describe('Quick Insert - reopening', () => {
  const BASE = {
    onOpenChange: vi.fn(),
    onInsert: vi.fn(),
    items: ITEMS,
    hasSelection: false,
  }

  /** Rows the command library scrolled to, in call order. */
  function scrolledRowIds(spy: ReturnType<typeof vi.spyOn>): string[] {
    return (spy.mock.contexts as Element[])
      .map((target) => target?.getAttribute?.('data-testid') ?? '')
      .filter((id) => id.startsWith('quick-add-item-'))
      .map((id) => id.replace('quick-add-item-', ''))
  }

  it('reopens at the top after the highlight was left down the list', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const functions = makeFunctions()
    const { rerender } = render(<QuickAddPopover {...BASE} open functions={functions} />)
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('new-function')

    rerender(<QuickAddPopover {...BASE} open={false} functions={functions} />)
    spy.mockClear()
    rerender(<QuickAddPopover {...BASE} open functions={functions} />)

    // The list mounts on the row it scrolls to, so it must be the first one.
    expect(scrolledRowIds(spy)).toEqual(['log'])
    expect(highlightedId()).toBe('log')
    spy.mockRestore()
  })

  it('reopens at the top after a search narrowed the list', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const functions = makeFunctions()
    const { rerender } = render(
      <QuickAddPopover {...BASE} open items={SEARCH_ITEMS} functions={functions} />,
    )
    fireEvent.change(getInput(), { target: { value: 'del' } })
    expect(visibleRowIds()).toEqual(['k8s-delete', 'delay'])

    rerender(<QuickAddPopover {...BASE} open={false} items={SEARCH_ITEMS} functions={functions} />)
    spy.mockClear()
    rerender(<QuickAddPopover {...BASE} open items={SEARCH_ITEMS} functions={functions} />)

    expect(scrolledRowIds(spy)).toEqual(['log'])
    expect(getInput()).toHaveValue('')
    spy.mockRestore()
  })

  it('reopens without asking for another page of Functions', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const functions = makeFunctions({ items: SERVER_FUNCTIONS, total: 60 })
    const { rerender } = render(<QuickAddPopover {...BASE} open functions={functions} />)
    fireEvent.keyDown(getInput(), { key: 'PageDown' })
    expect(highlightedId()).toBe('fn-2')

    rerender(<QuickAddPopover {...BASE} open={false} functions={functions} />)
    spy.mockClear()
    rerender(<QuickAddPopover {...BASE} open functions={functions} />)

    // Mounting on the last row parks the viewport in the load-more zone.
    expect(scrolledRowIds(spy)).not.toContain('fn-2')
    expect(functions.onLoadMore).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('Quick Insert - loading the next page (PICKER-1)', () => {
  function setListGeometry(scrollTop: number) {
    const list = screen.getByTestId('quick-add-list')
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(list, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(list, 'scrollTop', { value: scrollTop, configurable: true })
    return list
  }

  it('asks for the next page when the list is scrolled near the bottom', () => {
    const { functions } = renderPopover({
      functions: makeFunctions({ items: SERVER_FUNCTIONS, total: 60 }),
    })

    fireEvent.scroll(setListGeometry(650))

    expect(functions.onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not ask for the next page higher up the list', () => {
    const { functions } = renderPopover({
      functions: makeFunctions({ items: SERVER_FUNCTIONS, total: 60 }),
    })

    fireEvent.scroll(setListGeometry(100))

    expect(functions.onLoadMore).not.toHaveBeenCalled()
  })
})

describe('Quick Insert - Functions status line (PICKER-2, PICKER-3)', () => {
  const CASES: Array<[string, Partial<QuickAddFunctionsState>, string]> = [
    ['the first fetch is in flight', { status: 'loading' }, 'Loading Functions…'],
    [
      'the next page is in flight',
      { status: 'loading-more', items: SERVER_FUNCTIONS, total: 60 },
      'Loading more Functions…',
    ],
    [
      'more remain than are loaded',
      { items: SERVER_FUNCTIONS, total: 60 },
      '60 Functions - refine your search to narrow down',
    ],
    ['everything is loaded', { items: SERVER_FUNCTIONS, total: 2 }, '2 Functions'],
    ['nothing matches the search', { appliedQuery: 'zz' }, 'No Functions match'],
    ['the library is empty', {}, 'No Functions published yet'],
  ]

  it.each(CASES)('reads the count when %s', (_case, overrides, expected) => {
    renderPopover({ functions: makeFunctions(overrides) })

    expect(getStatusLine()).toHaveTextContent(expected)
  })

  it('reports a failed fetch with a retry action', () => {
    renderPopover({ functions: makeFunctions({ status: 'error' }) })

    expect(getStatusLine()).toHaveTextContent("Couldn't load Functions")
    expect(
      within(getStatusLine()).getByRole('button', { name: 'Try Again' }),
    ).toBeInTheDocument()
  })

  it('keeps every block row usable while the Functions half is failed', () => {
    renderPopover({ functions: makeFunctions({ status: 'error' }) })

    for (const item of ITEMS) {
      expect(getItem(item.id)).toBeInTheDocument()
    }
  })

  it('carries the failure even when no FUNCTIONS group is on screen', async () => {
    const user = userEvent.setup()
    renderPopover({ functions: makeFunctions({ status: 'error' }) })

    await user.type(getInput(), 'as')

    expect(screen.queryByText('FUNCTIONS')).not.toBeInTheDocument()
    expect(getStatusLine()).toHaveTextContent("Couldn't load Functions")
  })

  it('retries the failed fetch and returns the caret to the search box', async () => {
    const user = userEvent.setup()
    const { functions } = renderPopover({ functions: makeFunctions({ status: 'error' }) })
    ;(getInput() as HTMLInputElement).blur()

    await user.click(within(getStatusLine()).getByRole('button', { name: 'Try Again' }))

    expect(functions.onRetry).toHaveBeenCalledTimes(1)
    expect(getInput()).toHaveFocus()
  })

  it('is never a row: it sits outside the list and cannot be inserted', () => {
    const { onInsert } = renderPopover({ functions: makeFunctions({ status: 'loading' }) })
    const line = getStatusLine()

    expect(line.closest('[data-slot="command-list"]')).toBeNull()
    expect(line.querySelector('[data-slot="command-item"]')).toBeNull()
    expect(line.querySelector('[data-testid^="quick-add-item-"]')).toBeNull()
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('does not suppress the no-match empty state', async () => {
    const user = userEvent.setup()
    renderPopover({ functions: makeFunctions({ status: 'loading' }) })

    await user.type(getInput(), 'zzzznothing')

    expect(screen.getByText('No matching items')).toBeInTheDocument()
    expect(getStatusLine()).toHaveTextContent('Loading Functions…')
  })

  it('never blocks Enter, even mid-fetch', () => {
    const { onInsert, onOpenChange } = renderPopover({
      functions: makeFunctions({ status: 'loading' }),
    })

    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'log' }), 'anchor')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
