/**
 * SuitesListContainer load outcomes: the suite list is the only primary read.
 * A failed tag read blocks the page; a failed suite list read owns the page on
 * its own and the two states never render together.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuitesList: vi.fn(),
  fetchSuitesTags: vi.fn(),
  fetchSuiteTests: vi.fn(),
  transformApiSuiteList: vi.fn((suite) => suite),
  deleteSuite: vi.fn(),
  cloneSuite: vi.fn(),
  batchDeleteSuites: vi.fn(),
  batchCloneSuites: vi.fn(),
  createSuite: vi.fn(),
}))

vi.mock('@/features/suites/api/export-import', () => ({
  validateSuiteImport: vi.fn(),
  importSuites: vi.fn(),
  exportSuite: vi.fn(),
  exportSuites: vi.fn(),
}))

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironmentNames: vi.fn().mockResolvedValue([]),
}))

import { fetchSuitesList, fetchSuitesTags } from '@/features/suites/api/crud'
import { fetchEnvironmentNames } from '@/features/settings/api/environments/crud'
import { SuitesListContainer } from '@/features/suites/container/container'
import { ToastProvider } from '@/components/ui/toast'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockList = vi.mocked(fetchSuitesList)
const mockTags = vi.mocked(fetchSuitesTags)
const mockEnvironmentNames = vi.mocked(fetchEnvironmentNames)

const SUITE = {
  id: 'suite-1',
  name: 'Smoke',
  description: '',
  tags: [],
  status: 'passed',
  testsCount: 1,
  lastRun: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function listOk() {
  return {
    success: true,
    data: [SUITE],
    pagination: { page: 1, per_page: 25, total: 1, total_pages: 1 },
  }
}

function tagFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/suites/tags',
    status: 500,
    statusText: 'Internal Server Error',
  })
}

function renderContainer() {
  const router = createMemoryRouter([{ path: '/suites', element: <SuitesListContainer /> }], {
    initialEntries: ['/suites'],
  })
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false, retiredOwners: new Set() })
  mockList.mockResolvedValue(listOk() as unknown as Awaited<ReturnType<typeof fetchSuitesList>>)
  mockTags.mockResolvedValue(['smoke'])
  mockEnvironmentNames.mockResolvedValue([])
})

describe('SuitesListContainer', () => {
  it('blocks the page when only the tag read fails', async () => {
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderContainer()

    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(usePageBlockStore.getState().block?.title).toBe('Could not load tags')
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('shows only the full-page error state when both reads fail', async () => {
    mockList.mockRejectedValue(new Error('Suites unavailable'))
    mockTags.mockRejectedValue(tagFailure('Tags unavailable'))

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    await waitFor(() => expect(mockTags).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('holds the environments read back while the page shows its own error state', async () => {
    mockList.mockRejectedValue(new Error('Suites unavailable'))
    mockEnvironmentNames.mockRejectedValue(new Error('Environment registry unavailable'))

    renderContainer()

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeInTheDocument())
    await waitFor(() => expect(mockEnvironmentNames).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('reads the environments once for the page and its run dialog', async () => {
    renderContainer()

    expect(await screen.findByText('Smoke')).toBeInTheDocument()
    await waitFor(() => expect(mockEnvironmentNames).toHaveBeenCalled())
    expect(mockEnvironmentNames).toHaveBeenCalledTimes(1)
  })
})
