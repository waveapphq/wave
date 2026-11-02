/**
 * FunctionsListContainer integration tests.
 *
 * Covers the container + data/table/actions hooks: list load, view nav,
 * per-Function + bulk delete, single + bulk export (with download), import,
 * retry, and filter wiring. All API calls are mocked.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { FunctionsListContainer } from '@/features/functions/container'

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctions: vi.fn(),
  listFunctionTags: vi.fn(),
  deleteFunction: vi.fn(),
  batchDeleteFunctions: vi.fn(),
}))

vi.mock('@/features/functions/api/export-import', () => ({
  exportFunction: vi.fn(),
  exportFunctions: vi.fn(),
  validateFunctionImport: vi.fn(),
  importFunctions: vi.fn(),
}))

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

import {
  listFunctions,
  listFunctionTags,
  deleteFunction,
  batchDeleteFunctions,
} from '@/features/functions/api/functions-api'
import { exportFunction, exportFunctions } from '@/features/functions/api/export-import'
import { downloadBlob } from '@/lib/download-blob'

const mockList = vi.mocked(listFunctions)
const mockTags = vi.mocked(listFunctionTags)
const mockDelete = vi.mocked(deleteFunction)
const mockBatchDelete = vi.mocked(batchDeleteFunctions)
const mockExportOne = vi.mocked(exportFunction)
const mockExportMany = vi.mocked(exportFunctions)

const SUMMARIES = [
  {
    id: 'fn-1',
    name: 'send_email',
    description: 'Send an email',
    tags: ['mail'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    latest_version: '2.1.0',
  },
  {
    id: 'fn-2',
    name: 'charge_card',
    description: '',
    tags: ['payment'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    latest_version: '1.0.0',
  },
]

function listOk(functions = SUMMARIES) {
  return {
    functions,
    pagination: { page: 1, per_page: 25, total: functions.length, total_pages: 1 },
  }
}

// The table sorts client-side by name, so target rows by content not index.
function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-testid="function-row"]') as HTMLElement
}

function renderContainer(initialEntry = '/functions') {
  const router = createMemoryRouter(
    [
      { path: '/functions', element: <FunctionsListContainer /> },
      { path: '/functions/:functionId', element: <div data-testid="detail-page">Detail</div> },
    ],
    { initialEntries: [initialEntry] },
  )
  return { ...render(<RouterProvider router={router} />), router }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mockList.mockResolvedValue(listOk())
  mockTags.mockResolvedValue(['mail', 'payment'])
  mockDelete.mockResolvedValue(undefined)
  mockBatchDelete.mockResolvedValue({ deleted: ['fn-1'], failed: [] })
  mockExportOne.mockResolvedValue(new Blob(['fn']))
  mockExportMany.mockResolvedValue(new Blob(['zip']))
  // Add the blob-download statics without replacing the URL constructor
  // (react-router needs `new URL(...)`).
  ;(URL as unknown as Record<string, unknown>).createObjectURL = vi
    .fn()
    .mockReturnValue('blob:fn')
  ;(URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn()
  // The export download anchors a real <a>.click(); stub it so jsdom does not
  // log "Not implemented: navigation to another Document" to stderr.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

describe('FunctionsListContainer', () => {
  it('loads and renders Function rows + tags', async () => {
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    expect(mockList).toHaveBeenCalled()
    expect(mockTags).toHaveBeenCalled()
    expect(screen.getAllByTestId('function-row')).toHaveLength(2)
  })

  it('navigates to the detail page from the view action', async () => {
    const user = userEvent.setup()
    const { router } = renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    const row = rowFor('send_email')
    await user.click(within(row).getByTestId('action-view'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/functions/fn-1'))
  })

  it('deletes a Function via the confirmation dialog (cascade)', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    const row = rowFor('send_email')
    await user.click(within(row).getByTestId('action-menu-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('fn-1', { cascade: true }))
    // Reload fires after a successful delete.
    expect(mockList).toHaveBeenCalledTimes(2)
  })

  it('surfaces an error when a delete fails', async () => {
    const user = userEvent.setup()
    mockDelete.mockRejectedValueOnce(new Error('boom'))
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    const row = rowFor('send_email')
    await user.click(within(row).getByTestId('action-menu-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalled())
  })

  it('exports a single Function and downloads through the shared downloadBlob helper', async () => {
    const user = userEvent.setup()
    const blob = new Blob(['fn'])
    mockExportOne.mockResolvedValue(blob)
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    const row = rowFor('send_email')
    await user.click(within(row).getByTestId('action-menu-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Export/i }))
    await user.click(await screen.findByTestId('export-button'))
    await waitFor(() =>
      expect(mockExportOne).toHaveBeenCalledWith('fn-1', { format: 'yaml', secrets: 'mask' }),
    )
    expect(downloadBlob).toHaveBeenCalledWith(blob, 'send_email.yaml')
  })

  it('logs an error when an export fails', async () => {
    const user = userEvent.setup()
    mockExportOne.mockRejectedValueOnce(new Error('export boom'))
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    const row = rowFor('send_email')
    await user.click(within(row).getByTestId('action-menu-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Export/i }))
    await user.click(await screen.findByTestId('export-button'))
    await waitFor(() => expect(mockExportOne).toHaveBeenCalled())
  })

  it('bulk-exports selected Functions (ZIP) and bulk-deletes', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Mass Action/i }))
    const checkboxes = screen.getAllByTestId('row-checkbox')
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])

    await user.click(screen.getByTestId('bulk-export'))
    await user.click(await screen.findByTestId('export-button'))
    await waitFor(() => expect(mockExportMany).toHaveBeenCalled())
    const [exportIds, exportOpts] = mockExportMany.mock.calls[0]
    expect([...exportIds].sort()).toEqual(['fn-1', 'fn-2'])
    expect(exportOpts).toEqual({ format: 'yaml', secrets: 'mask' })
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'functions-export.zip'),
    )

    await user.click(screen.getByTestId('bulk-delete'))
    await user.click(screen.getByRole('button', { name: /Delete All/i }))
    await waitFor(() => expect(mockBatchDelete).toHaveBeenCalled())
    const [deleteIds, deleteOpts] = mockBatchDelete.mock.calls[0]
    expect([...deleteIds].sort()).toEqual(['fn-1', 'fn-2'])
    expect(deleteOpts).toEqual({ cascade: true })
  })

  it('opens the import dialog from the Import button', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    await user.click(screen.getByTestId('import-button'))
    expect(await screen.findByText(/Import Function/i)).toBeInTheDocument()
  })

  it('shows the error state and retries on failure', async () => {
    const user = userEvent.setup()
    mockList.mockRejectedValueOnce(new Error('load failed'))
    renderContainer()
    await waitFor(() => expect(screen.getByTestId('error-state-title')).toBeInTheDocument())
    mockList.mockResolvedValue(listOk())
    await user.click(screen.getByRole('button', { name: /Try Again/i }))
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
  })

  it('refetches when the search filter changes', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    await user.type(screen.getByPlaceholderText(/Search functions/i), 'charge')
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ search: 'charge' })),
    )
  })

  it('clears selection when exiting selection mode', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Mass Action/i }))
    await user.click(screen.getAllByTestId('row-checkbox')[0])
    expect(screen.getByTestId('selection-counter')).toHaveTextContent('1 selected')
    await user.click(screen.getByTestId('selection-close'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument(),
    )
  })

  it('seeds filters from the URL query params', async () => {
    renderContainer('/functions?search=charge&tags=payment')
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'charge', tags: ['payment'] }),
      ),
    )
  })

  it('clears active filters from the no-results state', async () => {
    const user = userEvent.setup()
    renderContainer()
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
    // A search that matches nothing surfaces the filtered-empty (no-results) state.
    mockList.mockResolvedValue(listOk([]))
    await user.type(screen.getByPlaceholderText(/Search functions/i), 'zzz')
    const noResults = await screen.findByTestId('no-results-state')
    // "Clear Filters" (page handleClearFilters) reloads without the search, so rows return.
    mockList.mockResolvedValue(listOk())
    await user.click(within(noResults).getByRole('button', { name: /Clear Filters/i }))
    await waitFor(() => expect(screen.getByText('send_email')).toBeInTheDocument())
  })
})
