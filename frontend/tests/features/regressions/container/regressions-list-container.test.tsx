/**
 * RegressionsListContainer load outcomes: the regression list is the only
 * primary read. A failed tag read blocks the page; a failed regression list
 * read owns the page on its own and the two states never render together.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressions: vi.fn(),
  fetchRegressionsTags: vi.fn(),
  fetchRegressionSuites: vi.fn(),
  deleteRegression: vi.fn(),
  batchDeleteRegressions: vi.fn(),
  batchCloneRegressions: vi.fn(),
  cloneRegression: vi.fn(),
  createRegression: vi.fn(),
}))

vi.mock('@/features/regressions/api/export-import', () => ({
  validateRegressionImport: vi.fn(),
  importRegressions: vi.fn(),
  exportRegression: vi.fn(),
  exportRegressions: vi.fn(),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: vi.fn().mockResolvedValue([]),
}))

import { fetchRegressions, fetchRegressionsTags } from '@/features/regressions/api/crud'
import { fetchEnvironmentNames } from '@/features/settings/api/environments/crud'
import { RegressionsListContainer } from '@/features/regressions/container/container'
import { ToastProvider } from '@/components/ui/toast'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockList = vi.mocked(fetchRegressions)
const mockTags = vi.mocked(fetchRegressionsTags)
const mockEnvironmentNames = vi.mocked(fetchEnvironmentNames)

const REGRESSION = {
  id: 'reg-1',
  name: 'Nightly',
  description: '',
  version: '1.0.0',
  tags: [],
  status: 'passed' as const,
  suitesCount: 1,
  testsCount: 3,
  lastRun: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function listOk() {
  return {
    success: true,
    data: [REGRESSION],
    pagination: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  }
}

function tagFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/regressions/tags',
    status: 500,
    statusText: 'Internal Server Error',
  })
}

function renderContainer(initialEntry = '/regressions') {
  const router = createMemoryRouter(
    [{ path: '/regressions', element: <RegressionsListContainer /> }],
    { initialEntries: [initialEntry] }
  )
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
  mockList.mockResolvedValue(listOk())
  mockTags.mockResolvedValue(['nightly'])
  mockEnvironmentNames.mockResolvedValue([])
})

describe('RegressionsListContainer', () => {
  it('renders the loaded list with the page unblocked', async () => {
    renderContainer()

    expect(await screen.findByText('Nightly')).toBeInTheDocument()
    await waitFor(() => expect(mockTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('blocks the page when only the tag read fails', async () => {
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderContainer()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(usePageBlockStore.getState().block?.title).toBe('Could not load tags')
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('shows the full-page error state when the regression list read fails', async () => {
    mockList.mockRejectedValue(new Error('Regressions unavailable'))

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    expect(screen.getByTestId('error-state-description')).toHaveTextContent(
      'Regressions unavailable'
    )
  })

  it('falls back to a generic message when the list failure is not an Error', async () => {
    mockList.mockRejectedValue('weird failure')

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    expect(screen.getByTestId('error-state-description')).toHaveTextContent(
      'Failed to load regressions'
    )
  })

  it('shows only the full-page error state when both reads fail', async () => {
    mockList.mockRejectedValue(new Error('Regressions unavailable'))
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    await waitFor(() => expect(mockTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('holds the environments read back while the page shows its own error state', async () => {
    mockList.mockRejectedValue(new Error('Regressions unavailable'))
    mockEnvironmentNames.mockRejectedValue(new Error('Environment registry unavailable'))

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    await waitFor(() => expect(mockEnvironmentNames).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reads the list with the status and tag filters from the URL', async () => {
    renderContainer('/regressions?status=passed,failed&tags=nightly,,smoke')

    expect(await screen.findByText('Nightly')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['passed', 'failed'], tags: ['nightly', 'smoke'] })
    )
  })

  it('reads the list with no status or tag filter when the URL has none', async () => {
    renderContainer()

    expect(await screen.findByText('Nightly')).toBeInTheDocument()
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, tags: undefined })
    )
  })

  it('reads the environments once for the page and its run dialog', async () => {
    renderContainer()

    expect(await screen.findByText('Nightly')).toBeInTheDocument()
    await waitFor(() => expect(mockEnvironmentNames).toHaveBeenCalled())
    expect(mockEnvironmentNames).toHaveBeenCalledTimes(1)
  })
})
