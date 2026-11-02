/**
 * Shared helpers for Execution Detail tables.
 *
 * The Status filter exposes seven options (passed / failed / running /
 * pending / skipped / stopped / excluded) and the default-visible set
 * excludes both 'skipped' and 'excluded' - scanning an execution should not
 * be dominated by rows the user intentionally left out (excluded) or rows
 * that were truncated mid-run without further user interest (skipped).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'

vi.mock('@/features/executions/api/export', () => ({
  downloadExecutionExport: vi.fn(),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: mockToastError }),
}))

import { downloadExecutionExport } from '@/features/executions/api/export'
import {
  TEST_STATUS_OPTIONS,
  TEST_STATUS_DEFAULT,
  isTestViewable,
  TestActions,
} from '@/features/executions/detail/_shared'

describe('TEST_STATUS_OPTIONS', () => {
  it('includes an Excluded option with the canonical label', () => {
    const excluded = TEST_STATUS_OPTIONS.find((o) => o.value === 'excluded')
    expect(excluded).toBeDefined()
    expect(excluded?.label).toBe('Excluded')
  })

  it('includes a Skipped option with the canonical label', () => {
    const skipped = TEST_STATUS_OPTIONS.find((o) => o.value === 'skipped')
    expect(skipped).toBeDefined()
    expect(skipped?.label).toBe('Skipped')
  })

  it('exposes every non-pending terminal status plus pending and running', () => {
    const values = TEST_STATUS_OPTIONS.map((o) => o.value).sort()
    expect(values).toEqual(
      ['excluded', 'failed', 'passed', 'pending', 'running', 'skipped', 'stopped'].sort(),
    )
  })
})

describe('TEST_STATUS_DEFAULT', () => {
  it('shows skipped by default', () => {
    expect(TEST_STATUS_DEFAULT).toContain('skipped')
  })

  it('hides excluded by default', () => {
    expect(TEST_STATUS_DEFAULT).not.toContain('excluded')
  })

  it('shows every other status by default', () => {
    expect([...TEST_STATUS_DEFAULT].sort()).toEqual(
      ['failed', 'passed', 'pending', 'running', 'skipped', 'stopped'].sort(),
    )
  })
})

describe('isTestViewable', () => {
  // Tests that actually ran have a recorded canvas to open. 'skipped'
  // counts because the Halt plugin can short-circuit a real run with
  // skipped status - the user still wants to inspect what happened.
  it.each([['passed'], ['failed'], ['stopped'], ['skipped']])(
    'returns true for %s (recorded canvas exists)',
    (status) => {
      expect(isTestViewable(status)).toBe(true)
    },
  )

  it('returns false for excluded (test was never selected for the run)', () => {
    expect(isTestViewable('excluded')).toBe(false)
  })

  it.each([['pending'], ['running']])(
    'returns false for %s (no terminal canvas yet)',
    (status) => {
      expect(isTestViewable(status)).toBe(false)
    },
  )
})

describe('TestActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function renderActions(props: {
    executionId: string
    testId: string
    runId?: string | null
    status: string
  }) {
    return render(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(TestActions, props),
      ),
    )
  }

  it('shows the Open Detail link when status is viewable and runId is present', () => {
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'passed',
    })

    const link = screen.getByRole('link', { name: /open test detail/i })
    expect(link.getAttribute('href')).toBe('/executions/history/run-1')
  })

  it('hides the Open Detail link when runId is absent', () => {
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: null,
      status: 'passed',
    })

    expect(screen.queryByRole('link', { name: /open test detail/i })).toBeNull()
  })

  it('hides the Open Detail link when status is not viewable', () => {
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'excluded',
    })

    expect(screen.queryByRole('link', { name: /open test detail/i })).toBeNull()
  })

  it('renders the Download button regardless of status', () => {
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'excluded',
    })

    expect(screen.getByRole('button', { name: /download test/i })).toBeDefined()
  })

  it('downloads only this test row', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionExport).mockResolvedValue(undefined)
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'passed',
    })

    await user.click(screen.getByRole('button', { name: /download test/i }))

    await waitFor(() => {
      expect(downloadExecutionExport).toHaveBeenCalledWith('exec-1', { testIds: ['test-1'] })
    })
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports the reason when the test download fails', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionExport).mockRejectedValue(new Error('Execution not found'))
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'passed',
    })

    await user.click(screen.getByRole('button', { name: /download test/i }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Execution not found', 'Download Failed')
    })
  })

  it('passes a non-Error rejection through verbatim', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionExport).mockRejectedValue('not an error object')
    renderActions({
      executionId: 'exec-1',
      testId: 'test-1',
      runId: 'run-1',
      status: 'passed',
    })

    await user.click(screen.getByRole('button', { name: /download test/i }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('not an error object', 'Download Failed')
    })
  })
})
