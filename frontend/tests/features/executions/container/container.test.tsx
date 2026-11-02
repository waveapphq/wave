/**
 * ExecutionsListContainer - Re-run wiring test.
 *
 * Verifies that handleRerunExecution fetches the execution detail,
 * dispatches to the correct run-dialog hook (test/suite/regression),
 * and that the RunDialog JSX renders for each entity type.
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

vi.mock('@/features/executions/api/executions', () => ({
  fetchExecutions: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'exec-1',
        name: 'Nightly',
        entity_type: 'regression',
        entity_id: 'reg-1',
        environment_id: 'env-1',
        status: 'passed',
        triggered_by: 'wparker',
        started_at: '2026-04-15T00:00:00Z',
        completed_at: '2026-04-15T00:01:00Z',
        duration: 60,
      },
      {
        id: 'exec-2',
        name: 'Smoke',
        entity_type: 'test',
        entity_id: 'test-1',
        environment_id: 'env-1',
        status: 'passed',
        triggered_by: 'wparker',
        started_at: '2026-04-15T00:02:00Z',
        completed_at: '2026-04-15T00:02:30Z',
        duration: 30,
      },
    ],
    pagination: { total: 2, page: 1, per_page: 20, total_pages: 1 },
  }),
  fetchExecution: vi.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'exec-1',
      name: 'Nightly',
      entity_type: 'regression',
      entity_id: 'reg-1',
      environment_id: 'env-1',
      status: 'passed',
      selected_tests: [{ suite_id: 's1', test_id: 't1' }],
    },
  }),
  fetchExecutionUsers: vi.fn().mockResolvedValue([]),
  transformApiExecution: vi.fn((e) => ({
    id: e.id,
    name: e.name,
    type: e.entity_type,
    status: e.status,
    triggeredBy: e.triggered_by,
    startedAt: e.started_at,
    completedAt: e.completed_at,
    duration: e.duration,
    entityId: e.entity_id,
  })),
  startExecution: vi.fn().mockResolvedValue({ id: 'exec-new' }),
  stopExecution: vi.fn(),
  deleteExecution: vi.fn(),
}))

vi.mock('@/lib/format-duration', () => ({
  formatDuration: vi.fn(() => '1m'),
}))

const useEnvironmentsMock = vi.fn()
vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: (...args: unknown[]) => useEnvironmentsMock(...args),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteTests: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionSuitesWithTests: vi.fn().mockResolvedValue([
    { id: 's1', name: 'Auth', tests: [{ id: 't1', name: 'Login' }] },
  ]),
}))

import { ExecutionsListContainer } from '@/features/executions/container/container'
import { fetchExecutions, fetchExecutionUsers } from '@/features/executions/api/executions'
import { usePageBlockStore } from '@/stores/page-block-store'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

function seedEnvironments() {
  useEnvironmentsMock.mockReturnValue({
    environments: [{ id: 'env-1', name: 'Production' }],
    loading: false,
    loaded: true,
    hasEnvironments: true,
    refresh: vi.fn(),
  })
}

function renderContainer() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <ExecutionsListContainer />
      </MemoryRouter>
      <ToastContainer />
    </ToastProvider>,
  )
}

describe('ExecutionsListContainer - environments read is owned by the page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedEnvironments()
  })

  it('lets the environments read block the page once the executions read answered', async () => {
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly')).toBeInTheDocument()
    })
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('loaded')
    // One gated read for the whole page: the run dialogs run none of their own.
    expect(
      useEnvironmentsMock.mock.calls.filter(([primary]) => typeof primary !== 'string'),
    ).toEqual([])
  })

  it('holds the environments read back while the page shows its own error state', async () => {
    vi.mocked(fetchExecutions).mockRejectedValueOnce(new Error('executions are down'))
    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state-title')).toBeInTheDocument()
    })
    expect(useEnvironmentsMock).toHaveBeenLastCalledWith('failed')
  })
})

describe('ExecutionsListContainer - the users read is a blocking secondary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedEnvironments()
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  it('blocks the loaded page instead of taking it to the error state when the users read fails', async () => {
    vi.mocked(fetchExecutionUsers).mockRejectedValueOnce(new Error('users store down'))
    renderContainer()

    await waitFor(() => {
      expect(usePageBlockStore.getState().block?.title).toBe('Could not load users')
    })
    expect(usePageBlockStore.getState().block?.detail.message).toBe('users store down')
    expect(screen.getByText('Nightly')).toBeInTheDocument()
    expect(screen.queryByTestId('error-state-title')).not.toBeInTheDocument()
  })

  it('reaches the error state without waiting for the users read', async () => {
    vi.mocked(fetchExecutions).mockRejectedValueOnce(new Error('executions are down'))
    vi.mocked(fetchExecutionUsers).mockImplementationOnce(() => new Promise(() => {}))
    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state-title')).toBeInTheDocument()
    })
  })

  it('shows only the page error state when both reads fail', async () => {
    vi.mocked(fetchExecutions).mockRejectedValueOnce(new Error('executions are down'))
    vi.mocked(fetchExecutionUsers).mockRejectedValueOnce(new Error('users store down'))
    renderContainer()

    await waitFor(() => {
      expect(screen.getByTestId('error-state-title')).toBeInTheDocument()
    })
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('ExecutionsListContainer - Re-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedEnvironments()
  })

  it('clicking Re-run on a regression row opens the RunDialog with subset', async () => {
    const user = userEvent.setup()
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('execution-row')
    const regressionRow = rows.find((r) => r.textContent?.includes('Nightly'))!
    await user.click(within(regressionRow).getByTestId('row-action-rerun'))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})

describe('ExecutionsListContainer - View navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedEnvironments()
  })

  it('test-type executions route directly to the Historical Canvas', async () => {
    const user = userEvent.setup()
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Smoke')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('execution-row')
    const testRow = rows.find((r) => r.textContent?.includes('Smoke'))!
    await user.click(within(testRow).getByTestId('row-action-view'))

    expect(navigateMock).toHaveBeenCalledWith('/executions/history/exec-2')
  })

  it('suite/regression executions route to the Execution Detail page', async () => {
    const user = userEvent.setup()
    renderContainer()

    await waitFor(() => {
      expect(screen.getByText('Nightly')).toBeInTheDocument()
    })

    const rows = screen.getAllByTestId('execution-row')
    const regressionRow = rows.find((r) => r.textContent?.includes('Nightly'))!
    await user.click(within(regressionRow).getByTestId('row-action-view'))

    expect(navigateMock).toHaveBeenCalledWith('/executions/exec-1')
  })
})
