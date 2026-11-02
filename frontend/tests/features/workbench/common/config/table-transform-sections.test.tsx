/**
 * TableTransformSections tests.
 *
 * Two collapsible sub-sections (Sorts, Filters) rendered between the input
 * parameter table and the output variables for any table-producing element
 * (the CSV converter in parse mode, the Excel converter in read mode). Each
 * section carries an `(i)` tooltip and a count badge, and embeds its editor.
 * The child editors are mocked here so the sections are tested in isolation.
 */

import { render, screen } from '@testing-library/react'
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

vi.mock('@/features/workbench/common/config/table-transform/sort-list-editor', () => ({
  SortListEditor: ({
    sorts,
    onChange,
  }: {
    sorts: unknown[]
    onChange: (next: unknown[]) => void
  }) => (
    <button data-testid="mock-sort-editor" data-count={sorts.length} onClick={() => onChange(['sorted'])}>
      sort-editor
    </button>
  ),
}))

vi.mock('@/features/workbench/common/config/table-transform/filter-block-builder', () => ({
  FilterBlockBuilder: ({
    filters,
    onChange,
  }: {
    filters: unknown[]
    onChange: (next: unknown[]) => void
  }) => (
    <button data-testid="mock-filter-builder" data-count={filters.length} onClick={() => onChange(['filtered'])}>
      filter-builder
    </button>
  ),
}))

import { TableTransformSections } from '@/features/workbench/common/config/table-transform'
import type { TableFilterBlock, TableSort } from '@/features/workbench/common/config/table-transform/types'

function makeSort(id: string): TableSort {
  return { id, column: { mode: 'name', value: 'score' }, direction: 'asc' }
}

function makeFilter(id: string): TableFilterBlock {
  return { id, column: { mode: 'name', value: 'score' }, asType: 'string', conditions: [] }
}

function renderSections(overrides: Partial<React.ComponentProps<typeof TableTransformSections>> = {}) {
  const onSortsChange = (overrides.onSortsChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onFiltersChange = (overrides.onFiltersChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const props = {
    sorts: [] as TableSort[],
    filters: [] as TableFilterBlock[],
    hasHeader: true,
    onSortsChange,
    onFiltersChange,
    ...overrides,
  }
  render(<TableTransformSections {...props} />)
  return { onSortsChange, onFiltersChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TableTransformSections', () => {
  it('renders the Transform group with both collapsible sections and their info tooltips', () => {
    renderSections({ sorts: [makeSort('s1')], filters: [makeFilter('f1'), makeFilter('f2')] })

    expect(screen.getByRole('heading', { name: 'Transform' })).toBeInTheDocument()
    expect(screen.getByTestId('csv-sorts-section-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('csv-filters-section-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('csv-sorts-section-info')).toBeInTheDocument()
    expect(screen.getByTestId('csv-filters-section-info')).toBeInTheDocument()
  })

  it('shows the per-section count when a section is non-empty', () => {
    renderSections({ sorts: [makeSort('s1')], filters: [makeFilter('f1'), makeFilter('f2')] })

    expect(screen.getByTestId('csv-sorts-section-count')).toHaveTextContent('1 keys')
    expect(screen.getByTestId('csv-filters-section-count')).toHaveTextContent('2 columns')
  })

  it('omits the count badge when a section is empty', () => {
    renderSections({ sorts: [], filters: [] })

    expect(screen.queryByTestId('csv-sorts-section-count')).not.toBeInTheDocument()
    expect(screen.queryByTestId('csv-filters-section-count')).not.toBeInTheDocument()
  })

  it('expands the Sorts section to reveal its editor', async () => {
    const user = userEvent.setup()
    renderSections({ sorts: [makeSort('s1')] })

    await user.click(screen.getByTestId('csv-sorts-section-trigger'))

    expect(screen.getByTestId('mock-sort-editor')).toBeInTheDocument()
  })

  it('threads sort edits through onSortsChange', async () => {
    const user = userEvent.setup()
    const { onSortsChange } = renderSections({ sorts: [makeSort('s1')] })

    await user.click(screen.getByTestId('csv-sorts-section-trigger'))
    await user.click(screen.getByTestId('mock-sort-editor'))

    expect(onSortsChange).toHaveBeenCalledWith(['sorted'])
  })

  it('threads filter edits through onFiltersChange', async () => {
    const user = userEvent.setup()
    const { onFiltersChange } = renderSections({ filters: [makeFilter('f1')] })

    await user.click(screen.getByTestId('csv-filters-section-trigger'))
    await user.click(screen.getByTestId('mock-filter-builder'))

    expect(onFiltersChange).toHaveBeenCalledWith(['filtered'])
  })
})
