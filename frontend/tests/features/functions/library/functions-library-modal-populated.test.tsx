/**
 * Tests for the populated `FunctionsLibraryModal` (FN-LC-6..8).
 *
 * Covers concerns NOT covered by the existing
 * `functions-library-modal.test.tsx` (which exercises the modal
 * shell). Here we exercise the live population branch:
 *
 *   - Search filtering against the populated list
 *   - Tag popover multi-select AND semantics (per FN-LC-7)
 *   - Filtered-empty body copy ("No Functions match these filters.")
 *   - Filter-clear affordance visibility rules
 *   - Card grid CSS shape (responsive `auto-fill, minmax(220px, 1fr)`)
 *
 * The store is mocked at the module boundary so the modal renders against
 * deterministic fixture data without touching the real backend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'

// API mock returning a deterministic list of Functions.
const listFunctionsMock = vi.fn()

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: (...args: unknown[]) => listFunctionsMock(...args),
  createFunction: vi.fn(),
  getFunction: vi.fn(),
  deleteFunction: vi.fn(),
  getDependents: vi.fn(),
  batchCreateFunctions: vi.fn(),
  batchDeleteFunctions: vi.fn(),
  exportFunction: vi.fn(),
  exportFunctionsBatch: vi.fn(),
  importFunctions: vi.fn(),
  runScopedFunction: vi.fn(),
}))

import { FunctionsLibraryModal } from '@/features/functions/library/functions-library-modal'

const NO_RESULTS_COPY = 'No Functions match these filters.'
const EMPTY_LIBRARY_COPY =
  'No published Functions yet. Build one in the canvas, then Publish it.'


const SAMPLE = [
  { id: '1', name: 'Greet User', description: 'Greet a user', tags: ['demo', 'greet'], created_at: '', updated_at: '' },
  { id: '2', name: 'Send Email', description: 'Send an email', tags: ['mail'], created_at: '', updated_at: '' },
  { id: '3', name: 'Charge Card', description: 'Charge a credit card', tags: ['mail', 'payment'], created_at: '', updated_at: '' },
  { id: '4', name: 'Refund', description: 'Refund a charge', tags: ['payment'], created_at: '', updated_at: '' },
]


beforeEach(() => {
  listFunctionsMock.mockReset()
  listFunctionsMock.mockResolvedValue({
    functions: SAMPLE,
    pagination: { page: 1, per_page: 50, total: SAMPLE.length, total_pages: 1 },
  })
})

// Flush any pending state updates from the listFunctions effect so the
// listFunctionsMock.then() that calls setAllFunctions lands inside act().
afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
  })
})


describe('FunctionsLibraryModal - populated grid', () => {
  it('renders one card per Function returned by the API', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(await screen.findByText('Greet User')).toBeInTheDocument()
    expect(screen.getByText('Send Email')).toBeInTheDocument()
    expect(screen.getByText('Charge Card')).toBeInTheDocument()
    expect(screen.getByText('Refund')).toBeInTheDocument()
  })

  it('does NOT render the empty-state copy when the library has items', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(await screen.findByText('Greet User')).toBeInTheDocument()
    expect(screen.queryByText(EMPTY_LIBRARY_COPY)).not.toBeInTheDocument()
  })

  it('lays out cards in a responsive grid (auto-fill, minmax(220px, 1fr))', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    const grid = await screen.findByTestId('functions-library-grid')
    const style = (grid as HTMLElement).getAttribute('style') ?? ''
    expect(style).toMatch(/grid-template-columns/)
    expect(style).toMatch(/auto-fill/)
    expect(style).toMatch(/minmax\(220px, 1fr\)/)
    // Sanity: the grid sits inside the modal region.
    expect(screen.getByRole('region', { name: 'Functions Library' })).toContainElement(grid)
  })
})


describe('FunctionsLibraryModal - search filtering', () => {
  it('filters cards by name (case-insensitive substring)', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const search = screen.getByPlaceholderText(/search/i)
    await user.type(search, 'EMAIL')
    expect(screen.queryByText('Greet User')).not.toBeInTheDocument()
    expect(screen.getByText('Send Email')).toBeInTheDocument()
    expect(screen.queryByText('Charge Card')).not.toBeInTheDocument()
  })

  it('shows the filtered-empty body copy when no card matches the search', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const search = screen.getByPlaceholderText(/search/i)
    await user.type(search, 'definitely-not-a-name')
    expect(await screen.findByText(NO_RESULTS_COPY)).toBeInTheDocument()
  })
})


async function openTagsPopover(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole('button', { name: /tags/i })
  await user.click(trigger)
}


describe('FunctionsLibraryModal - tag popover (multi-select AND)', () => {
  it('shows a single Tags popover trigger (not a chip strip)', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const triggers = screen.getAllByRole('button', { name: /tags/i })
    // Exactly one trigger button labeled `Tags ▾` (per FN-LC-7).
    expect(triggers).toHaveLength(1)
  })

  it('filters cards to those carrying ALL selected tags (AND semantics)', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    // The popover hosts one entry per distinct tag in the listing.
    const mail = await screen.findByRole('option', { name: /mail/i })
    const payment = await screen.findByRole('option', { name: /payment/i })
    await user.click(mail)
    await user.click(payment)
    // Only Charge Card carries BOTH 'mail' AND 'payment'.
    expect(screen.queryByText('Greet User')).not.toBeInTheDocument()
    expect(screen.queryByText('Send Email')).not.toBeInTheDocument()
    expect(screen.getByText('Charge Card')).toBeInTheDocument()
    expect(screen.queryByText('Refund')).not.toBeInTheDocument()
  })

  it('the trigger reads "1 tag" for one selected tag and "2 tags" for two', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    const mail = await screen.findByRole('option', { name: /mail/i })
    const payment = await screen.findByRole('option', { name: /payment/i })
    const trigger = screen.getByRole('button', { name: /tags/i })

    await user.click(mail)
    expect(trigger).toHaveTextContent(/^1 tag$/)

    await user.click(payment)
    expect(trigger).toHaveTextContent(/^2 tags$/)
  })

  it('shows the filtered-empty body copy when no card carries every selected tag', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    const greet = await screen.findByRole('option', { name: /greet/i })
    const payment = await screen.findByRole('option', { name: /payment/i })
    await user.click(greet)
    await user.click(payment)
    expect(await screen.findByText(NO_RESULTS_COPY)).toBeInTheDocument()
  })
})


describe('FunctionsLibraryModal - tag popover chosen state', () => {
  it('cmdk supplies the listbox role and the list declares no aria-multiselectable', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)

    const list = await screen.findByRole('listbox')
    expect(list).toHaveAttribute('role', 'listbox')
    expect(list).not.toHaveAttribute('aria-multiselectable')
  })

  it('chosen tags are exposed as checked and unchosen as unchecked', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)

    // 'payment' is last in the sorted tag list, never where cmdk parks its cursor.
    const payment = await screen.findByRole('option', { name: /payment/i })
    expect(payment).toHaveAttribute('aria-checked', 'false')
    expect(payment).toHaveAttribute('data-state', 'unchecked')

    await user.click(payment)

    const chosen = await screen.findByRole('option', { name: /payment/i })
    expect(chosen).toHaveAttribute('aria-checked', 'true')
    expect(chosen).toHaveAttribute('data-state', 'checked')
    expect(screen.getByRole('option', { name: /demo/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('every chosen tag is checked when several are chosen', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)

    await user.click(await screen.findByRole('option', { name: /mail/i }))
    await user.click(await screen.findByRole('option', { name: /payment/i }))

    expect(screen.getByRole('option', { name: /mail/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('option', { name: /payment/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('option', { name: /demo/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('option', { name: /greet/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('the checked marker follows the chosen tag, not the keyboard cursor', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    await user.click(await screen.findByRole('option', { name: /payment/i }))
    // Park the cursor on a row that is NOT chosen.
    await user.hover(screen.getByRole('option', { name: /demo/i }))

    const cursorRows = () =>
      screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')

    expect(cursorRows()).toHaveLength(1)
    expect(cursorRows()[0]).toHaveAccessibleName('demo')
    expect(cursorRows()[0]).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('option', { name: /payment/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('the check icon marks the chosen tag and no other', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    await user.click(await screen.findByRole('option', { name: /payment/i }))

    expect(
      within(screen.getByRole('option', { name: /payment/i })).getByTestId('check-icon'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('option', { name: /demo/i })).queryByTestId('check-icon'),
    ).not.toBeInTheDocument()
  })

  it('the visible check and aria-checked always agree', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await openTagsPopover(user)
    await user.click(await screen.findByRole('option', { name: /mail/i }))

    const pairs = screen
      .getAllByRole('option')
      .map((o) => [
        o.getAttribute('aria-checked'),
        within(o).queryByTestId('check-icon') !== null ? 'true' : 'false',
      ])

    expect(pairs.length).toBeGreaterThan(1)
    for (const [ariaChecked, hasCheck] of pairs) {
      expect(ariaChecked).toBe(hasCheck)
    }
  })
})


describe('FunctionsLibraryModal - Clear Filters affordance', () => {
  it('is HIDDEN when no filters are active', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    expect(
      screen.queryByRole('button', { name: /clear filters/i }),
    ).not.toBeInTheDocument()
  })

  it('is SHOWN once a search term is entered', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    await user.type(screen.getByPlaceholderText(/search/i), 'mail')
    expect(
      await screen.findByRole('button', { name: /clear filters/i }),
    ).toBeInTheDocument()
  })

  it('resets search + tag selections back to empty when clicked', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const search = screen.getByPlaceholderText(/search/i) as HTMLInputElement
    await user.type(search, 'mail')
    await user.click(await screen.findByRole('button', { name: /clear filters/i }))
    expect(search.value).toBe('')
    // All four cards are visible again.
    expect(screen.getByText('Greet User')).toBeInTheDocument()
    expect(screen.getByText('Send Email')).toBeInTheDocument()
    expect(screen.getByText('Charge Card')).toBeInTheDocument()
    expect(screen.getByText('Refund')).toBeInTheDocument()
  })
})


describe('FunctionsLibraryModal - empty library', () => {
  it('shows the empty-library copy when the API returns zero Functions', async () => {
    listFunctionsMock.mockResolvedValue({
      functions: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
    })
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(await screen.findByText(EMPTY_LIBRARY_COPY)).toBeInTheDocument()
  })

  it('does NOT show Clear Filters when the library itself is empty', async () => {
    listFunctionsMock.mockResolvedValue({
      functions: [],
      pagination: { page: 1, per_page: 50, total: 0, total_pages: 0 },
    })
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText(EMPTY_LIBRARY_COPY)
    expect(
      screen.queryByRole('button', { name: /clear filters/i }),
    ).not.toBeInTheDocument()
  })
})


describe('FunctionsLibraryModal - Refresh button', () => {
  it('marks the button busy and re-fetches the catalog when clicked', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    // First fetch from the open effect.
    expect(listFunctionsMock).toHaveBeenCalledTimes(1)

    const refresh = screen.getByRole('button', { name: /refresh/i })
    await user.click(refresh)

    // onClick bumps the library revision, which re-fires the listFunctions
    // effect, and flips the spinner flag on (aria-busy + spinning icon).
    expect(refresh).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('functions-library-refresh-icon')).toHaveAttribute(
      'data-spinning',
      'true',
    )
    expect(listFunctionsMock).toHaveBeenCalledTimes(2)
  })

  it('does not start a drag gesture when the Refresh button is clicked', async () => {
    const user = userEvent.setup()
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const root = screen.getByRole('region', { name: /functions library/i })
    const before = root.style.transform
    await user.click(screen.getByRole('button', { name: /refresh/i }))
    // onClick + onPointerDown both stopPropagation, so the modal offset
    // (and therefore the transform) is unchanged by the click.
    expect(root.style.transform).toBe(before)
  })
})


// Sanity: the existing modal-shell concerns (Escape, drag handle, X) keep
// passing once the populated body lands. We do not duplicate them here -
// they live in `functions-library-modal.test.tsx`. But verify the title
// row still works against the populated body.
describe('FunctionsLibraryModal - shell coexistence with populated body', () => {
  it('still renders the title heading when populated', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    expect(
      await screen.findByRole('heading', { name: /functions library/i }),
    ).toBeInTheDocument()
    // Wait for the populated body to land so the listFunctions effect's
    // setAllFunctions state update fires inside the test boundary.
    await screen.findByText('Greet User')
  })

  it('keeps a single region label "Functions Library"', async () => {
    render(<FunctionsLibraryModal isOpen={true} onClose={() => {}} />)
    await screen.findByText('Greet User')
    const region = screen.getByRole('region', { name: /functions library/i })
    expect(within(region).getByText('Greet User')).toBeInTheDocument()
  })
})
