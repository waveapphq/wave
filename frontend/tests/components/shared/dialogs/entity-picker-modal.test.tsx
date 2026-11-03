/**
 * EntityPickerModal Tests
 *
 * Covers the shared modal used by both the suite detail page (pick tests to
 * add) and the regression detail page (pick suites to add).
 *
 * Contract under test: server-paginated, infinite-scroll picker.
 * fetchItems receives { search?, tags?, page, perPage } and resolves
 * { items, total }. Selection lives in a Map so it survives page loads and
 * filter changes. A page-1 / filter-change failure shows the shared
 * ListErrorState; a load-more failure keeps the loaded rows and swaps the
 * bottom-center pill to a "Try Again" control. The tag read is part of the
 * initial load, so its failure uses that same error state and retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { EntityPickerModal, type PickerItem } from '@/components/shared/dialogs/entity-picker-modal'
import type { ReactNode } from 'react'

const PER_PAGE = 25

interface FetchParams {
  search?: string
  tags?: string[]
  page: number
  perPage: number
}
interface FetchResult {
  items: PickerItem[]
  total: number
}
type FetchItems = (params: FetchParams) => Promise<FetchResult>

const PAGE1: PickerItem[] = [
  { id: 't1', name: 'Login Test', tags: ['smoke'], status: 'passed' },
  { id: 't2', name: 'Signup Test', tags: ['regression'], status: 'failed' },
  { id: 't3', name: 'Legacy Test', tags: [], status: 'never_run' },
]
const PAGE2: PickerItem[] = [
  { id: 't4', name: 'Profile Test', tags: ['smoke'], status: 'passed' },
  { id: 't5', name: 'Search Test', tags: [], status: 'never_run' },
  { id: 't6', name: 'Upload Test', tags: ['api'], status: 'failed' },
]
const TAGS = ['smoke', 'regression']

const emptyIcon: ReactNode = <svg data-testid="picker-empty-icon" />

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  excludeIds: [] as string[],
  title: 'Add Tests to Suite',
  description: 'Pick tests to add.',
  searchPlaceholder: 'Search tests…',
  excludedLabel: '(in suite)',
  emptyIcon,
  testId: 'picker',
  itemKind: 'item',
  entityNamePlural: 'tests',
  // Typed as the function shape (not Mock) so any vi.fn() variant is assignable.
  fetchItems: vi.fn() as unknown as FetchItems,
  fetchTags: vi.fn() as unknown as () => Promise<string[]>,
}

/** Serve pages keyed by page number; every page reports the same total. */
function pagedFetch(total: number, pagesByNum: Record<number, PickerItem[]>) {
  return vi.fn(async (params: FetchParams) => ({
    items: pagesByNum[params.page] ?? [],
    total,
  }))
}

/** Drive the modal's infinite-scroll handler by faking near-bottom metrics. */
function scrollNearBottom(testId = 'picker'): void {
  const list = screen.getByTestId(`${testId}-list`)
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1000 })
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 400 })
  list.scrollTop = 600
  fireEvent.scroll(list)
}

function renderModal(overrides: Partial<typeof baseProps> = {}) {
  const props = { ...baseProps, ...overrides }
  return { props, ...render(<EntityPickerModal {...props} />) }
}

beforeEach(() => {
  // Default: one full page, nothing more to load.
  baseProps.fetchItems = vi.fn(async () => ({ items: PAGE1, total: PAGE1.length }))
  baseProps.fetchTags = vi.fn().mockResolvedValue(TAGS)
  baseProps.onClose = vi.fn()
  baseProps.onSelect = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EntityPickerModal', () => {
  // ==========================================================================
  // Rendering & basic interaction
  // ==========================================================================

  it('renders the loading spinner while the first page is in flight', async () => {
    let resolveFetch: ((value: FetchResult) => void) | undefined
    const pending = new Promise<FetchResult>(resolve => { resolveFetch = resolve })
    renderModal({ fetchItems: vi.fn().mockReturnValue(pending) })

    expect(screen.getByTestId('picker-loading')).toBeInTheDocument()

    resolveFetch?.({ items: PAGE1, total: PAGE1.length })
    await waitFor(() => {
      expect(screen.queryByTestId('picker-loading')).not.toBeInTheDocument()
    })
  })

  it('requests the first page with page=1 and perPage=25 on open', async () => {
    const fetchItems = vi.fn(async () => ({ items: PAGE1, total: PAGE1.length }))
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(fetchItems).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, perPage: PER_PAGE }),
    )
  })

  it('renders empty state when the first page returns no items', async () => {
    renderModal({ fetchItems: vi.fn(async () => ({ items: [], total: 0 })) })

    await waitFor(() => {
      expect(screen.getByTestId('picker-empty')).toBeInTheDocument()
    })
    expect(screen.getByText('No items found')).toBeInTheDocument()
  })

  it('displays fetched items as rows with names', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
      expect(screen.getByText('Signup Test')).toBeInTheDocument()
      expect(screen.getByText('Legacy Test')).toBeInTheDocument()
    })
  })

  it('marks excluded items with the excluded label', async () => {
    renderModal({ excludeIds: ['t1'] })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    const rows = screen.getAllByTestId('picker-item-row')
    expect(rows[0]).toBeDisabled()
    expect(screen.getByText('(in suite)')).toBeInTheDocument()
  })

  it('selects and deselects items via clicking', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    const rows = screen.getAllByTestId('picker-item-row')

    fireEvent.click(rows[0])
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')

    fireEvent.click(rows[0])
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected')
  })

  it('calls onSelect with id and name pairs when adding', async () => {
    const { props } = renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByTestId('picker-item-row')[0])
    fireEvent.click(screen.getAllByTestId('picker-item-row')[1])
    fireEvent.click(screen.getByTestId('picker-add-btn'))

    expect(props.onSelect).toHaveBeenCalledWith([
      { id: 't1', name: 'Login Test' },
      { id: 't2', name: 'Signup Test' },
    ])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('disables Add Selected when nothing is selected', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.getByTestId('picker-add-btn')).toBeDisabled()
  })

  it('does not select excluded items on click', async () => {
    renderModal({ excludeIds: ['t1'] })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByTestId('picker-item-row')[0])
    expect(screen.getByTestId('picker-add-btn')).toBeDisabled()
  })

  it('calls onClose without onSelect when Cancel is clicked', async () => {
    const { props } = renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel'))

    expect(props.onClose).toHaveBeenCalled()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('resets selection state when reopened', async () => {
    const { rerender } = renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByTestId('picker-item-row')[0])
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')

    rerender(<EntityPickerModal {...baseProps} open={false} />)
    rerender(<EntityPickerModal {...baseProps} open={true} />)

    await waitFor(() => {
      expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected')
    })
  })

  it('does not render content when closed', () => {
    renderModal({ open: false })
    expect(screen.queryByText('Add Tests to Suite')).not.toBeInTheDocument()
  })

  // ==========================================================================
  // Status-line nudge (PICKER-3)
  // ==========================================================================

  it('shows the refine nudge when more results remain than are loaded', async () => {
    renderModal({ fetchItems: vi.fn(async () => ({ items: PAGE1, total: 60 })) })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(
      screen.getByText('60 tests - refine your search to narrow down'),
    ).toBeInTheDocument()
  })

  it('uses entityNamePlural in the refine nudge copy', async () => {
    renderModal({
      entityNamePlural: 'suites',
      fetchItems: vi.fn(async () => ({ items: PAGE1, total: 42 })),
    })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(
      screen.getByText('42 suites - refine your search to narrow down'),
    ).toBeInTheDocument()
  })

  it('hides the refine nudge when everything fits one page', async () => {
    renderModal({ fetchItems: vi.fn(async () => ({ items: PAGE1, total: PAGE1.length })) })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.queryByText(/refine your search to narrow down/)).not.toBeInTheDocument()
  })

  // ==========================================================================
  // Infinite scroll (PICKER-1, PICKER-2)
  // ==========================================================================

  it('appends the next page when scrolled near the bottom', async () => {
    const fetchItems = pagedFetch(6, { 1: PAGE1, 2: PAGE2 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.queryByText('Profile Test')).not.toBeInTheDocument()

    await act(async () => {
      scrollNearBottom()
    })

    await waitFor(() => {
      expect(screen.getByText('Profile Test')).toBeInTheDocument()
    })
    // Page 1 rows are still present (appended, not replaced).
    expect(screen.getByText('Login Test')).toBeInTheDocument()
    expect(fetchItems).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, perPage: PER_PAGE }),
    )
  })

  it('shows the bottom-center "Loading…" pill while the next page loads', async () => {
    let resolvePage2: ((value: FetchResult) => void) | undefined
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: 6 })
      .mockReturnValueOnce(
        new Promise<FetchResult>(resolve => { resolvePage2 = resolve }),
      )

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    await act(async () => {
      scrollNearBottom()
    })

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeInTheDocument()
    })
    // The first-page rows remain visible behind the pill.
    expect(screen.getByText('Login Test')).toBeInTheDocument()

    resolvePage2?.({ items: PAGE2, total: 6 })
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
      expect(screen.getByText('Profile Test')).toBeInTheDocument()
    })
  })

  it('does not load more once every item is loaded', async () => {
    const fetchItems = pagedFetch(PAGE1.length, { 1: PAGE1 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await act(async () => {
      scrollNearBottom()
    })

    // total === items.length, so no second page is requested.
    expect(fetchItems).toHaveBeenCalledTimes(1)
    expect(fetchItems).not.toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    )
  })

  // ==========================================================================
  // Error surfacing (PICKER-4)
  // ==========================================================================

  it('shows the shared error state when the first page fails', async () => {
    renderModal({
      fetchItems: vi.fn().mockRejectedValue(new Error('boom')),
    })

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('Unable to load tests')).toBeInTheDocument()
    expect(
      screen.getByText('Something went wrong while loading. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    // The silent empty state is NOT used for failures.
    expect(screen.queryByTestId('picker-empty')).not.toBeInTheDocument()
  })

  it('reloads the first page when "Try Again" is clicked', async () => {
    const fetchItems = vi
      .fn<FetchItems>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: PAGE1, total: PAGE1.length })

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('keeps loaded rows and shows a "Try Again" pill when a load-more fails', async () => {
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: 6 })
      .mockRejectedValueOnce(new Error('page 2 broke'))

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    await act(async () => {
      scrollNearBottom()
    })

    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument()
    })
    // Loaded rows are preserved; we do NOT discard them for a full error state.
    expect(screen.getByText('Login Test')).toBeInTheDocument()
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('retries the failed page from the "Try Again" pill', async () => {
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: 6 })
      .mockRejectedValueOnce(new Error('page 2 broke'))
      .mockResolvedValueOnce({ items: PAGE2, total: 6 })

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await act(async () => {
      scrollNearBottom()
    })
    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Try Again'))
    })

    await waitFor(() => {
      expect(screen.getByText('Profile Test')).toBeInTheDocument()
    })
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument()
  })

  // ==========================================================================
  // Selection persistence across pages & filters (PICKER-5)
  // ==========================================================================

  it('keeps a page-1 selection after the next page is appended', async () => {
    const fetchItems = pagedFetch(6, { 1: PAGE1, 2: PAGE2 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByTestId('picker-item-row')[0])
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')

    await act(async () => {
      scrollNearBottom()
    })
    await waitFor(() => {
      expect(screen.getByText('Profile Test')).toBeInTheDocument()
    })

    // Selection survived the page load and a second-page row can be added.
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')
    fireEvent.click(screen.getByText('Profile Test'))
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (2)')
  })

  it('preserves a selection whose row is filtered out of the list, and adds it', async () => {
    const filtered: PickerItem[] = [
      { id: 't9', name: 'Filtered Match', tags: [], status: 'passed' },
    ]
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: PAGE1.length })
      .mockResolvedValue({ items: filtered, total: filtered.length })

    const { props } = renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    // Select Login Test, then search so it is no longer in the rendered list.
    fireEvent.click(screen.getAllByTestId('picker-item-row')[0])
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')

    const nativeInput = document.querySelector(
      `[data-testid="picker-search"] input`,
    ) as HTMLInputElement | null
    expect(nativeInput).not.toBeNull()
    await act(async () => {
      fireEvent.input(nativeInput!, { target: { value: 'match' } })
    })

    await waitFor(
      () => {
        expect(screen.getByText('Filtered Match')).toBeInTheDocument()
      },
    )
    expect(screen.queryByText('Login Test')).not.toBeInTheDocument()
    // Selection count survives the filter change even though the row is gone.
    expect(screen.getByTestId('picker-add-btn')).toHaveTextContent('Add Selected (1)')

    fireEvent.click(screen.getByTestId('picker-add-btn'))
    expect(props.onSelect).toHaveBeenCalledWith([{ id: 't1', name: 'Login Test' }])
  })

  // ==========================================================================
  // Search / filter requests (PICKER-1)
  // ==========================================================================

  it('runs a debounced search from page 1 and replaces the item list', async () => {
    const second: PickerItem[] = [
      { id: 'match', name: 'Match Test', tags: [], status: 'passed' },
    ]
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: PAGE1.length })
      .mockResolvedValueOnce({ items: second, total: second.length })

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    const nativeInput = document.querySelector(
      `[data-testid="picker-search"] input`,
    ) as HTMLInputElement | null
    expect(nativeInput).not.toBeNull()
    await act(async () => {
      fireEvent.input(nativeInput!, { target: { value: 'match' } })
    })

    await waitFor(
      () => {
        expect(screen.getByText('Match Test')).toBeInTheDocument()
      },
    )
    expect(screen.queryByText('Login Test')).not.toBeInTheDocument()
    expect(fetchItems).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'match', page: 1, perPage: PER_PAGE }),
    )
  })

  it('forwards the active search to the next page request', async () => {
    const searchPage1: PickerItem[] = PAGE1
    const searchPage2: PickerItem[] = PAGE2
    const fetchItems = vi.fn<FetchItems>(async (params: FetchParams) => {
      if (!params.search) return { items: PAGE1, total: PAGE1.length }
      return { items: params.page === 1 ? searchPage1 : searchPage2, total: 6 }
    })

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    const nativeInput = document.querySelector(
      `[data-testid="picker-search"] input`,
    ) as HTMLInputElement | null
    await act(async () => {
      fireEvent.input(nativeInput!, { target: { value: 'foo' } })
    })
    await waitFor(
      () => {
        expect(
          screen.getByText('6 tests - refine your search to narrow down'),
        ).toBeInTheDocument()
      },
    )

    await act(async () => {
      scrollNearBottom()
    })

    await waitFor(() => {
      expect(fetchItems).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'foo', page: 2, perPage: PER_PAGE }),
      )
    })
  })

  it('shows the error state when a search (page-1) request fails', async () => {
    const fetchItems = vi
      .fn<FetchItems>()
      .mockResolvedValueOnce({ items: PAGE1, total: PAGE1.length })
      .mockRejectedValueOnce(new Error('search broke'))

    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    const nativeInput = document.querySelector(
      `[data-testid="picker-search"] input`,
    ) as HTMLInputElement | null
    expect(nativeInput).not.toBeNull()
    await act(async () => {
      fireEvent.input(nativeInput!, { target: { value: 'broken' } })
    })

    await waitFor(
      () => {
        expect(screen.getByTestId('error-state')).toBeInTheDocument()
      },
    )
    expect(screen.getByText('Unable to load tests')).toBeInTheDocument()
  })

  // ==========================================================================
  // The tag read shares the item read's failure model
  // ==========================================================================

  it('shows the shared error state naming the tags when the tag fetch fails', async () => {
    renderModal({
      fetchItems: vi.fn(async () => ({ items: PAGE1, total: PAGE1.length })),
      fetchTags: vi.fn().mockRejectedValue(new Error('tags broke')),
    })

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('Unable to load tags')).toBeInTheDocument()
    expect(screen.queryByText('Unable to load tests')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    // No rows are shown as though the picker had loaded cleanly.
    expect(screen.queryByText('Login Test')).not.toBeInTheDocument()
  })

  it('names both reads when the item page and the tag list fail together', async () => {
    renderModal({
      fetchItems: vi.fn().mockRejectedValue(new Error('items broke')),
      fetchTags: vi.fn().mockRejectedValue(new Error('tags broke')),
    })

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(screen.getByText('Unable to load tests and tags')).toBeInTheDocument()
  })

  it('recovers items and tags together from the same "Try Again"', async () => {
    const fetchItems = vi.fn(async () => ({ items: PAGE1, total: PAGE1.length }))
    const fetchTags = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('tags broke'))
      .mockResolvedValueOnce(TAGS)

    renderModal({ fetchItems, fetchTags })

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
    expect(fetchTags).toHaveBeenCalledTimes(2)
  })

  it('does not re-read tags when a search reloads the first page', async () => {
    const fetchItems = pagedFetch(PAGE1.length, { 1: PAGE1 })
    const fetchTags = vi.fn<() => Promise<string[]>>().mockResolvedValue(TAGS)
    renderModal({ fetchItems, fetchTags })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })

    const nativeInput = document.querySelector(
      `[data-testid="picker-search"] input`,
    ) as HTMLInputElement | null
    await act(async () => {
      fireEvent.input(nativeInput!, { target: { value: 'log' } })
    })

    await waitFor(
      () => {
        expect(fetchItems).toHaveBeenCalledWith(expect.objectContaining({ search: 'log' }))
      },
    )
    expect(fetchTags).toHaveBeenCalledTimes(1)
  })

  // ==========================================================================
  // Tag filtering
  // ==========================================================================

  /** Open the tag popover and pick one of the loaded tags (rows carry the same labels). */
  async function pickTag(tag: string): Promise<void> {
    if (document.querySelector('[data-slot="command-item"]') === null) {
      await act(async () => {
        fireEvent.click(screen.getByTestId('picker-tag-filter'))
      })
    }
    const option = document.querySelector(`[data-slot="command-item"][data-value="${tag}"]`)
    expect(option).not.toBeNull()
    await act(async () => {
      fireEvent.click(option!)
    })
  }

  it('reloads the first page filtered by the picked tag', async () => {
    const fetchItems = pagedFetch(PAGE1.length, { 1: PAGE1 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await pickTag('smoke')

    expect(fetchItems).toHaveBeenLastCalledWith({ page: 1, perPage: PER_PAGE, tags: ['smoke'] })
    expect(screen.getByTestId('picker-tag-filter')).toHaveTextContent('1 tag')
  })

  it('drops the tag from the filter when the same tag is picked again', async () => {
    const fetchItems = pagedFetch(PAGE1.length, { 1: PAGE1 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await pickTag('smoke')
    await pickTag('smoke')

    expect(fetchItems).toHaveBeenLastCalledWith({ page: 1, perPage: PER_PAGE })
    expect(screen.getByTestId('picker-tag-filter')).toHaveTextContent('Tags')
  })

  it('clears every picked tag from the clear control', async () => {
    const fetchItems = pagedFetch(PAGE1.length, { 1: PAGE1 })
    renderModal({ fetchItems })

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await pickTag('smoke')
    await pickTag('regression')
    expect(screen.getByTestId('picker-tag-filter')).toHaveTextContent('2 tags')

    await act(async () => {
      fireEvent.click(screen.getByTestId('picker-tag-clear'))
    })

    expect(fetchItems).toHaveBeenLastCalledWith({ page: 1, perPage: PER_PAGE })
    expect(screen.getByTestId('picker-tag-filter')).toHaveTextContent('Tags')
  })

  it('falls back to the Never Run badge for a status it does not know', async () => {
    const odd: PickerItem[] = [{ id: 't7', name: 'Odd Test', tags: [], status: 'queued' }]
    renderModal({ fetchItems: vi.fn(async () => ({ items: odd, total: odd.length })) })

    await waitFor(() => {
      expect(screen.getByText('Odd Test')).toBeInTheDocument()
    })
    expect(screen.getByText('Never Run')).toBeInTheDocument()
  })

  it('offers no clear control until a tag is picked', async () => {
    renderModal()

    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('picker-tag-clear')).not.toBeInTheDocument()
  })
})
