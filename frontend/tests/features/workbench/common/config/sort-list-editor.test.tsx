/**
 * SortListEditor tests (wireframe CSV Sort row).
 *
 * A priority list of sort rows; each row = a ColumnRef control + an
 * ascending/descending selector, with reorder + delete affordances. The list
 * order is the sort priority (first row highest priority). Controlled: emits
 * the whole next array via onChange.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({
    width: 1280,
    height: 800,
    breakpoint: 'xl',
    isAtLeast: () => true,
    isBelow: () => false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    sidebarShouldBeVisible: true,
    canvasInteractionEnabled: true,
    isTouchDevice: false,
  }),
}))

import { SortListEditor } from '@/features/workbench/common/config/table-transform/sort-list-editor'
import type { TableSort } from '@/features/workbench/common/config/table-transform/types'

function sort(id: string, value: string, direction: 'asc' | 'desc' = 'asc'): TableSort {
  return { id, column: { mode: 'name', value }, direction }
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof SortListEditor>> = {}) {
  const onChange = (overrides.onChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const props = {
    sorts: [] as TableSort[],
    columnRefProps: { hasHeader: true },
    onChange,
    ...overrides,
  }
  render(<SortListEditor {...props} />)
  return { onChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('empty state', () => {
  it('renders an add button and no rows', () => {
    renderEditor()

    expect(screen.getByTestId('sort-add-button')).toBeInTheDocument()
    expect(screen.queryByTestId('sort-row-s1')).not.toBeInTheDocument()
  })
})

describe('adding', () => {
  it('appends a new ascending sort', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ sorts: [] })

    await user.click(screen.getByTestId('sort-add-button'))

    const next = onChange.mock.calls.at(-1)![0] as TableSort[]
    expect(next).toHaveLength(1)
    expect(next[0].direction).toBe('asc')
  })
})

describe('rendering existing sorts', () => {
  it('renders a row per sort with an embedded column reference control', () => {
    renderEditor({ sorts: [sort('s1', 'score')] })

    const row = screen.getByTestId('sort-row-s1')
    expect(within(row).getByTestId('column-ref-mode')).toBeInTheDocument()
    expect(within(row).getByTestId('sort-direction-s1')).toBeInTheDocument()
  })
})

describe('direction', () => {
  it('emits the updated direction', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ sorts: [sort('s1', 'score', 'asc')] })

    await user.click(screen.getByTestId('sort-direction-s1'))
    await user.click(await screen.findByRole('option', { name: /descending/i }))

    const next = onChange.mock.calls.at(-1)![0] as TableSort[]
    expect(next[0].direction).toBe('desc')
  })
})

describe('delete', () => {
  it('removes the sort', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ sorts: [sort('s1', 'score')] })

    await user.click(screen.getByTestId('sort-delete-s1'))

    expect(onChange).toHaveBeenCalledWith([])
  })
})

describe('reorder', () => {
  it('moves a sort down, swapping priority', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({
      sorts: [sort('s1', 'region'), sort('s2', 'score')],
    })

    await user.click(screen.getByTestId('sort-move-down-s1'))

    const next = onChange.mock.calls.at(-1)![0] as TableSort[]
    expect(next.map((s) => s.id)).toEqual(['s2', 's1'])
  })
})

describe('column reference', () => {
  it('updates the sort column when the reference changes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderEditor({ sorts: [sort('s1', '')] })

    const row = screen.getByTestId('sort-row-s1')
    await user.type(within(row).getByTestId('column-ref-value'), 'region')

    const next = onChange.mock.calls.at(-1)![0] as TableSort[]
    expect(next[0].column).toEqual({ mode: 'name', value: 'region' })
  })
})
