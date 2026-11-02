/**
 * RegressionExecutionTable - the suite-level Download action.
 *
 * The suite row downloads every test of that suite in one file. A failed
 * download is reported where the user is looking instead of doing nothing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/features/executions/api/export', () => ({
  downloadExecutionExport: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { downloadExecutionExport } from '@/features/executions/api/export'
import { RegressionExecutionTable } from '@/features/executions/detail/regression-execution-table'
import type { ExecutionSuiteRow } from '@/features/executions/detail/_shared'

const SUITES: ExecutionSuiteRow[] = [
  {
    id: 's1',
    name: 'Auth Suite',
    status: 'passed',
    duration: 3,
    tests: [
      { id: 't1', name: 'Login', status: 'passed', duration: 1, run_id: 'r1' },
      { id: 't2', name: 'Logout', status: 'passed', duration: 2, run_id: 'r2' },
    ],
  },
]

function renderTable() {
  return render(
    <MemoryRouter>
      <RegressionExecutionTable executionId="exec-1" suites={SUITES} />
    </MemoryRouter>,
  )
}

describe('RegressionExecutionTable suite download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downloads every test of the suite', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined)
    renderTable()

    await user.click(screen.getByRole('button', { name: /download suite/i }))

    await waitFor(() => {
      expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { testIds: ['t1', 't2'] })
    })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports the reason when the suite download fails', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionExport).mockRejectedValue(new Error('Export job failed'))
    renderTable()

    await user.click(screen.getByRole('button', { name: /download suite/i }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Export job failed', 'Download Failed')
    })
  })
})
