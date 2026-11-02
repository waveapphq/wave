/**
 * ReportsListContainer Tests
 *
 * Container for /reports: fetches rows via fetchReports with URL-seeded
 * filters and table state, reuses the executions users endpoint for the
 * user facet, and navigates both row actions (View and Generate) to the
 * viewer route - the viewer owns generation.
 *
 * Module: frontend/src/features/reports/container/container.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('@/features/reports/api/reports', () => ({
  fetchReports: vi.fn(),
  startReportJob: vi.fn(),
  getReportJobStatus: vi.fn(),
  fetchReportJson: vi.fn(),
  ensureReport: vi.fn(),
}))

vi.mock('@/features/executions/api/executions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/executions/api/executions')>()
  return {
    ...actual,
    fetchExecutionUsers: vi.fn().mockResolvedValue(['alice', 'dev']),
  }
})

import { fetchReports } from '@/features/reports/api/reports'
import { fetchExecutionUsers } from '@/features/executions/api/executions'
import { usePageBlockStore } from '@/stores/page-block-store'
import { ReportsListContainer } from '@/features/reports/container/container'

const ROWS = [
  {
    execution: {
      id: 'exec-1',
      name: 'Nightly API Suite',
      entity_type: 'suite',
      entity_id: 'suite-1',
      status: 'failed',
      triggered_by: 'dev',
      started_at: '2026-06-10T11:06:52+00:00',
      ended_at: '2026-06-10T11:07:13+00:00',
      duration: 21,
    },
    reports: {
      json: {
        artifact_id: 'dir-1/report.v1.json',
        version: 1,
        size_bytes: 14541,
        generated_at: '2026-06-10T11:30:00+00:00',
      },
      html: null,
    },
  },
  {
    execution: {
      id: 'exec-2',
      name: 'Inventory Sync Validation',
      entity_type: 'test',
      entity_id: 'test-1',
      status: 'passed',
      triggered_by: 'qa-bot',
      started_at: '2026-06-10T10:00:00+00:00',
      ended_at: '2026-06-10T10:00:04+00:00',
      duration: 4,
    },
    reports: { json: null, html: null },
  },
]

function renderContainer(initialEntry = '/reports') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ReportsListContainer />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchReports).mockResolvedValue({
    data: ROWS,
    pagination: { total: 2, page: 1, per_page: 10, total_pages: 1 },
  } as never)
  vi.mocked(fetchExecutionUsers).mockResolvedValue(['alice', 'dev'])
  usePageBlockStore.setState({ block: null, retrying: false })
})

describe('ReportsListContainer - the users read is a blocking secondary', () => {
  it('blocks the loaded page instead of taking it to the error state when the users read fails', async () => {
    vi.mocked(fetchExecutionUsers).mockRejectedValueOnce(new Error('users store down'))
    renderContainer()

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load users')
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('users store down')
    expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument()
  })

  it('reaches the error state without waiting for the users read', async () => {
    vi.mocked(fetchReports).mockRejectedValueOnce(new Error('reports are down'))
    vi.mocked(fetchExecutionUsers).mockImplementationOnce(() => new Promise(() => {}))
    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
  })

  it('shows only the page error state when both reads fail', async () => {
    vi.mocked(fetchReports).mockRejectedValueOnce(new Error('reports are down'))
    vi.mocked(fetchExecutionUsers).mockRejectedValueOnce(new Error('users store down'))
    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('ReportsListContainer - fetch wiring', () => {
  it('fetches the first page with the default sort on mount and renders the rows', async () => {
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    })
    expect(fetchReports).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        per_page: 10,
        sort_by: 'started_at',
        sort_order: 'desc',
      }),
    )
    expect(screen.getByText('Inventory Sync Validation')).toBeInTheDocument()
  })

  it('loads the user facet values from the executions users endpoint', async () => {
    renderContainer()

    await waitFor(() => {
      expect(fetchExecutionUsers).toHaveBeenCalled()
    })
  })

  it('seeds filters from the URL search params, mapping user to triggered_by', async () => {
    renderContainer('/reports?search=night&status=passed,failed&type=suite&user=alice')

    await waitFor(() => {
      expect(fetchReports).toHaveBeenCalledWith(
        expect.objectContaining({
          search: 'night',
          status: ['passed', 'failed'],
          type: ['suite'],
          triggered_by: ['alice'],
        }),
      )
    })
  })

  it('renders the error state and refetches on Try Again', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchReports).mockRejectedValueOnce(new Error('boom'))

    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /try again/i }))

    await waitFor(() => {
      expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    })
    expect(fetchReports).toHaveBeenCalledTimes(2)
  })
})

describe('ReportsListContainer - pagination', () => {
  it('fetches the next page when the pagination next button is clicked', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchReports).mockResolvedValue({
      data: ROWS,
      pagination: { total: 30, page: 1, per_page: 10, total_pages: 3 },
    } as never)

    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => {
      expect(fetchReports).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    })
  })
})

describe('ReportsListContainer - navigation', () => {
  it('navigates to the viewer when the View action is clicked', async () => {
    const user = userEvent.setup()
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly API Suite')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('report-row')
    await user.click(within(rows[0]).getByTestId('row-action-view'))

    expect(navigateMock).toHaveBeenCalledWith('/reports/exec-1')
  })

  it('navigates to the viewer when the Generate action is clicked (viewer owns generation)', async () => {
    const user = userEvent.setup()
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Inventory Sync Validation')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('report-row')
    await user.click(within(rows[1]).getByTestId('row-action-generate'))

    expect(navigateMock).toHaveBeenCalledWith('/reports/exec-2')
  })
})
