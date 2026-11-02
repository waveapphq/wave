/**
 * ExecutionToolbar Tests
 *
 * Top-bar actions for the Execution Detail view.
 *
 * Running state  : Stop (split) | View Running | Export
 * Terminal state : Re-run | Export | Delete  (Delete disabled while Running/Paused)
 *
 * Stop opens a confirmation dialog that offers Immediate and With Finalization.
 * Re-run opens the RunDialog prepopulated; Run creates a new execution and
 * navigates the browser to the new execution's detail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('@/features/executions/api/executions', () => ({
  stopExecution: vi.fn(),
  deleteExecution: vi.fn(),
  startExecution: vi.fn(),
}))

// Re-run for suite / regression loads the subset via these endpoints so the
// Run dialog can show tests and compute the selected_tests payload. Mocks
// return a non-empty shape so the Run button is enabled and submit produces
// a realistic payload.
vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteTests: vi.fn().mockResolvedValue([
    { id: 't1', name: 'Login' },
    { id: 't2', name: 'Logout' },
  ]),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionSuitesWithTests: vi.fn().mockResolvedValue([
    {
      id: 's1',
      name: 'Auth Suite',
      tests: [
        { id: 't1', name: 'Login' },
        { id: 't2', name: 'Logout' },
      ],
    },
  ]),
}))

vi.mock('@/features/executions/api/export', () => ({
  downloadExecutionExport: vi.fn(),
}))

const envMockState: { environments: { id: string; name: string; tags: string[] }[] } = {
  environments: [{ id: 'env-1', name: 'env-1', tags: [] }],
}

const useEnvironmentsMock = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: (primary?: unknown) => {
    useEnvironmentsMock(primary)
    return {
      get environments() {
        return envMockState.environments
      },
      loading: false,
      error: null,
      hasEnvironments: true,
      refresh: vi.fn(),
    }
  },
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import {
  stopExecution,
  deleteExecution,
  startExecution,
} from '@/features/executions/api/executions'
import { fetchSuiteTests } from '@/features/suites/api/crud'
import { fetchRegressionSuitesWithTests } from '@/features/regressions/api/crud'
import { downloadExecutionExport } from '@/features/executions/api/export'
import { ExecutionToolbar } from '@/features/executions/detail/execution-toolbar'

function renderToolbar(props: Partial<Parameters<typeof ExecutionToolbar>[0]> = {}) {
  const { execution: executionOverrides, ...otherProps } = props
  const execution = {
    id: 'exec-1',
    name: 'Nightly Run',
    entity_type: 'regression',
    entity_id: 'reg-1',
    environment_id: 'env-1',
    status: 'running',
    ...executionOverrides,
  }
  const defaultProps = {
    execution,
    onStopped: vi.fn(),
    onDeleted: vi.fn(),
    ...otherProps,
  }
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<ExecutionToolbar {...defaultProps} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ExecutionToolbar - Running state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Stop, View Running, and Export buttons', () => {
    renderToolbar()
    expect(screen.getByRole('button', { name: /^Stop$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view running/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('does not show Re-run or Delete while running', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: /re-run/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('opens the Stop confirmation dialog when the primary Stop is clicked', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    expect(await screen.findByTestId('stop-confirmation-dialog')).toBeInTheDocument()
  })

  it('confirming Stop (Immediate) calls stopExecution with mode=immediate', async () => {
    const user = userEvent.setup()
    vi.mocked(stopExecution).mockResolvedValue(undefined as never)
    renderToolbar()
    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    await user.click(await screen.findByTestId('stop-confirm-immediate'))
    await waitFor(() => {
      expect(stopExecution).toHaveBeenCalledWith('exec-1', { mode: 'immediate' })
    })
  })

  it('confirming Stop (With Finalization) calls stopExecution with mode=finalize', async () => {
    const user = userEvent.setup()
    vi.mocked(stopExecution).mockResolvedValue(undefined as never)
    renderToolbar()
    await user.click(screen.getByRole('button', { name: /stop options/i }))
    await user.click(await screen.findByRole('menuitem', { name: /stop with finalization/i }))
    await user.click(await screen.findByTestId('stop-confirm-finalize'))
    await waitFor(() => {
      expect(stopExecution).toHaveBeenCalledWith('exec-1', { mode: 'finalize' })
    })
  })

  it('canceling the Stop dialog does not call stopExecution', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    await user.click(await screen.findByTestId('stop-confirm-cancel'))
    expect(stopExecution).not.toHaveBeenCalled()
  })

  it('View Running navigates to the Workbench', async () => {
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole('button', { name: /view running/i }))
    expect(navigateMock).toHaveBeenCalledWith('/workbench')
  })

  it('Export opens the export dialog via onExport instead of downloading directly', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    renderToolbar({ onExport })
    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(downloadExecutionExport).not.toHaveBeenCalled()
  })

  // Per RVIEW-13: the Report button renders disabled while the
  // execution is in progress instead of disappearing.
  it('shows a disabled Report button that explains itself through the shared tooltip', () => {
    renderToolbar()
    const report = screen.getByTestId('report-button')
    expect(report).toBeDisabled()
    expect(report).not.toHaveAttribute('title')
    // A disabled button emits no pointer events, so the hint hangs off the
    // wrapper the shared tooltip triggers from.
    fireEvent.focus(report.parentElement as HTMLElement)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      'Available when the execution finishes',
    )
  })

})

describe('ExecutionToolbar - Terminal state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Re-run, Export, and Delete buttons', () => {
    renderToolbar({ execution: { status: 'passed' } as never })
    expect(screen.getByRole('button', { name: /re-run/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('Export opens the export dialog via onExport in terminal state', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    renderToolbar({ execution: { status: 'passed' } as never, onExport })
    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(downloadExecutionExport).not.toHaveBeenCalled()
  })

  it('hides Stop and View Running in terminal state', () => {
    renderToolbar({ execution: { status: 'stopped' } as never })
    expect(screen.queryByRole('button', { name: /^Stop$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /view running/i })).toBeNull()
  })

  it('opens the RunDialog prepopulated when Re-run is clicked', async () => {
    const user = userEvent.setup()
    renderToolbar({ execution: { status: 'passed' } as never })
    await user.click(screen.getByRole('button', { name: /re-run/i }))
    const dialog = await screen.findByRole('dialog', { name: /run/i })
    expect(dialog).toHaveTextContent('Nightly Run')
    expect(dialog).toHaveTextContent('env-1')
  })

  it('confirming Run in the dialog creates a new execution and navigates to its detail', async () => {
    const user = userEvent.setup()
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-2' } as never)
    renderToolbar({ execution: { status: 'failed', selected_tests: [{ suite_id: 's1', test_id: 't1' }] } as never })
    await user.click(screen.getByRole('button', { name: /re-run/i }))
    await user.click(await screen.findByRole('button', { name: /^Run$/ }))
    await waitFor(() => {
      expect(startExecution).toHaveBeenCalledWith({
        type: 'regression',
        id: 'reg-1',
        environmentId: 'env-1',
        // Re-run with seed: original execution had selected_tests for only
        // t1 in s1, so the hook pre-checks only that pair.
        selectedTests: [
          { suiteId: 's1', testId: 't1' },
        ],
      })
    })
    expect(navigateMock).toHaveBeenCalledWith('/executions/exec-2')
  })

  it('canceling Re-run does not call startExecution', async () => {
    const user = userEvent.setup()
    renderToolbar({ execution: { status: 'passed' } as never })
    await user.click(screen.getByRole('button', { name: /re-run/i }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(startExecution).not.toHaveBeenCalled()
  })

  it('Delete is disabled while the execution is Running/Paused', () => {
    renderToolbar({ execution: { status: 'running' } as never })
    // Delete not shown while running
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })

  it('Delete prompts for confirmation and then calls deleteExecution', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteExecution).mockResolvedValue(undefined as never)
    const onDeleted = vi.fn()
    renderToolbar({ execution: { status: 'passed' } as never, onDeleted })
    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(await screen.findByTestId('delete-confirm'))
    await waitFor(() => {
      expect(deleteExecution).toHaveBeenCalledWith('exec-1')
      expect(onDeleted).toHaveBeenCalledTimes(1)
    })
  })

  it('Delete confirmation warns that artifacts and reports are also removed', async () => {
    const user = userEvent.setup()
    renderToolbar({ execution: { status: 'passed' } as never })
    await user.click(screen.getByRole('button', { name: /delete/i }))
    const dialog = await screen.findByTestId('delete-confirmation-dialog')
    expect(dialog).toHaveTextContent(/artifacts and reports/i)
  })

  it('Cancel on the Delete confirmation does not call deleteExecution', async () => {
    const user = userEvent.setup()
    renderToolbar({ execution: { status: 'passed' } as never })
    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(await screen.findByTestId('delete-confirm-cancel'))
    expect(deleteExecution).not.toHaveBeenCalled()
  })

  it('falls back to the execution environment id when no environments are loaded', async () => {
    const user = userEvent.setup()
    const original = envMockState.environments
    envMockState.environments = []
    try {
      renderToolbar({ execution: { status: 'passed' } as never })
      await user.click(screen.getByRole('button', { name: /re-run/i }))
      const dialog = await screen.findByRole('dialog', { name: /run/i })
      expect(dialog).toHaveTextContent('env-1')
    } finally {
      envMockState.environments = original
    }
  })

  it('Re-run for test entity_type opens simple env-only RunDialog', async () => {
    const user = userEvent.setup()
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-test-rerun' } as never)
    renderToolbar({
      execution: {
        status: 'passed',
        entity_type: 'test',
        entity_id: 'test-1',
      } as never,
    })
    await user.click(screen.getByRole('button', { name: /re-run/i }))
    const dialog = await screen.findByRole('dialog', { name: /run/i })
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Run$/ }))
    await waitFor(() => {
      expect(startExecution).toHaveBeenCalledWith({
        type: 'test',
        id: 'test-1',
        environmentId: 'env-1',
      })
    })
    // Test runs stream live on the Workbench canvas.
    expect(navigateMock).toHaveBeenCalledWith('/workbench')
  })

  // Per RVIEW-13: terminal executions get an enabled Report
  // button between Re-run and Export; the label is always "Report" (the
  // viewer handles both the view and generate cases).
  it('shows an enabled Report button between Re-run and Export', () => {
    renderToolbar({ execution: { status: 'passed' } as never })

    const report = screen.getByTestId('report-button')
    expect(report).toBeEnabled()
    expect(report).toHaveTextContent('Report')

    const buttons = screen.getAllByRole('button')
    const rerunIndex = buttons.findIndex((b) => /re-run/i.test(b.textContent ?? ''))
    const reportIndex = buttons.indexOf(report)
    const exportIndex = buttons.findIndex((b) => /export/i.test(b.textContent ?? ''))
    expect(rerunIndex).toBeLessThan(reportIndex)
    expect(reportIndex).toBeLessThan(exportIndex)
  })

  it('Report navigates to the report viewer for the execution', async () => {
    const user = userEvent.setup()
    renderToolbar({ execution: { status: 'failed' } as never })

    await user.click(screen.getByTestId('report-button'))

    expect(navigateMock).toHaveBeenCalledWith('/reports/exec-1')
  })

  it('Re-run for suite entity_type opens the subset RunDialog via the suite hook', async () => {
    const user = userEvent.setup()
    vi.mocked(startExecution).mockResolvedValue({ id: 'exec-suite-rerun' } as never)
    renderToolbar({
      execution: {
        status: 'passed',
        entity_type: 'suite',
        entity_id: 'suite-1',
        selected_tests: ['t1'],
      } as never,
    })
    // The toolbar owns the only environments read; the run dialogs take its list.
    expect(useEnvironmentsMock).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /re-run/i }))
    const dialog = await screen.findByRole('dialog', { name: /run/i })
    expect(dialog).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Run$/ }))
    await waitFor(() => {
      expect(startExecution).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'suite', id: 'suite-1' })
      )
    })
    expect(navigateMock).toHaveBeenCalledWith('/executions/exec-suite-rerun')
  })
})

// A failed read behind Re-run must be reported, never open a dialog listing nothing.
describe('ExecutionToolbar - Re-run when the read fails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not open the suite Re-run dialog and reports the reason', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSuiteTests).mockRejectedValueOnce(new Error('Suite tests unavailable'))
    renderToolbar({
      execution: {
        status: 'passed',
        entity_type: 'suite',
        entity_id: 'suite-1',
      } as never,
    })

    await user.click(screen.getByRole('button', { name: /re-run/i }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Suite tests unavailable',
        'Could Not Load Suite Tests',
      )
    })
    expect(screen.queryByRole('dialog', { name: /run/i })).toBeNull()
  })

  it('does not open the regression Re-run dialog and reports the reason', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchRegressionSuitesWithTests).mockRejectedValueOnce(
      new Error('Regression suites unavailable'),
    )
    renderToolbar({ execution: { status: 'passed' } as never })

    await user.click(screen.getByRole('button', { name: /re-run/i }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Regression suites unavailable',
        'Could Not Load Regression Suites',
      )
    })
    expect(screen.queryByRole('dialog', { name: /run/i })).toBeNull()
  })

  it('reports a Stop that the server refuses', async () => {
    const user = userEvent.setup()
    vi.mocked(stopExecution).mockRejectedValueOnce(new Error('Execution already finished'))
    const onStopped = vi.fn()
    renderToolbar({ onStopped })

    await user.click(screen.getByRole('button', { name: /^Stop$/ }))
    await user.click(await screen.findByTestId('stop-confirm-immediate'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Execution already finished', 'Stop Failed')
    })
    expect(onStopped).not.toHaveBeenCalled()
  })

  it('reports a Delete that the server refuses', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteExecution).mockRejectedValueOnce(new Error('Execution is running'))
    const onDeleted = vi.fn()
    renderToolbar({ execution: { status: 'passed' } as never, onDeleted })

    await user.click(screen.getByRole('button', { name: /delete/i }))
    await user.click(await screen.findByTestId('delete-confirm'))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Execution is running', 'Delete Failed')
    })
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('reports a test Re-run that fails to start and stays put', async () => {
    const user = userEvent.setup()
    vi.mocked(startExecution).mockRejectedValueOnce(new Error('No runner available'))
    renderToolbar({
      execution: {
        status: 'passed',
        entity_type: 'test',
        entity_id: 'test-1',
      } as never,
    })

    await user.click(screen.getByRole('button', { name: /re-run/i }))
    await screen.findByRole('dialog', { name: /run/i })
    await user.click(screen.getByRole('button', { name: /^Run$/ }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('No runner available', 'Re-run Failed')
    })
    expect(navigateMock).not.toHaveBeenCalledWith('/workbench')
  })

  it('reports a Re-run that fails to start', async () => {
    const user = userEvent.setup()
    vi.mocked(startExecution).mockRejectedValueOnce(new Error('Runner busy'))
    renderToolbar({
      execution: {
        status: 'passed',
        entity_type: 'suite',
        entity_id: 'suite-1',
      } as never,
    })

    await user.click(screen.getByRole('button', { name: /re-run/i }))
    await screen.findByRole('dialog', { name: /run/i })
    await user.click(screen.getByRole('button', { name: /^Run$/ }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Runner busy')
    })
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
