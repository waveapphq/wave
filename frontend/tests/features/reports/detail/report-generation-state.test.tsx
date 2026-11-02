/**
 * ReportGenerationState Tests
 *
 * Centered interstitial cards for the viewer (RVIEW-10): generating
 * (spinner + progress + "N of M runs processed"), failed (Try Again +
 * View Execution), 409 still-running (View Execution + Back to Reports),
 * and the permanent no-artifacts failure (no Try Again).
 *
 * Module: frontend/src/features/reports/detail/report-generation-state.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  ReportGenerationState,
  type ReportGenerationStateProps,
} from '@/features/reports/detail/report-generation-state'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

function renderState(props: Partial<ReportGenerationStateProps> = {}) {
  const defaultProps: ReportGenerationStateProps = {
    phase: 'generating',
    progress: null,
    error: null,
    executionId: 'exec-1',
    onRetry: vi.fn(),
    ...props,
  }
  return {
    props: defaultProps,
    ...render(
      <MemoryRouter>
        <ReportGenerationState {...defaultProps} />
      </MemoryRouter>,
    ),
  }
}

beforeEach(() => {
  navigateMock.mockClear()
})

describe('ReportGenerationState - generating', () => {
  it('renders the generating card with a polite live headline', () => {
    renderState({ phase: 'generating' })

    const card = screen.getByTestId('report-generation-state')
    expect(card).toHaveTextContent('Generating report…')
    const headline = screen.getByText('Generating report…')
    expect(headline.closest('[aria-live="polite"]')).not.toBeNull()
  })

  it('shows indeterminate text without a runs count when progress is unknown', () => {
    renderState({ phase: 'generating', progress: null })

    expect(screen.queryByText(/runs processed/)).toBeNull()
  })

  it('shows the progress bar with aria values and the runs-processed count', () => {
    renderState({ phase: 'generating', progress: { processed: 2, total: 5 } })

    expect(screen.getByText('2 of 5 runs processed')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '5')
  })

  it.each([
    ['with a runs count', { processed: 2, total: 5 }],
    ['without a runs count', null],
  ])('names the progress bar %s', (_, progress) => {
    renderState({ phase: 'generating', progress })

    expect(screen.getByRole('progressbar', { name: 'Report progress' })).toBeInTheDocument()
  })

  it('renders the starting phase as the indeterminate generating card', () => {
    renderState({ phase: 'starting' })

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent(
      'Generating report…',
    )
  })

  it('renders the fetching phase with the preparing text', () => {
    renderState({ phase: 'fetching' })

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent(
      'Preparing report…',
    )
  })
})

describe('ReportGenerationState - failed', () => {
  it('renders the failure card with the backend message, Try Again, and View Execution', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderState({
      error: { kind: 'job-failed', message: 'model build exploded' },
      onRetry,
    })

    const card = screen.getByTestId('report-generation-state')
    expect(card).toHaveTextContent('Report generation failed')
    expect(card).toHaveTextContent('model build exploded')

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /view execution/i }))
    expect(navigateMock).toHaveBeenCalledWith('/executions/exec-1')
  })

  it('renders job-lost and request-failed kinds as the failure card with Try Again', () => {
    renderState({ error: { kind: 'job-lost', message: 'The report job was lost' } })

    expect(screen.getByTestId('report-generation-state')).toHaveTextContent(
      'Report generation failed',
    )
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('omits Try Again for the permanent no-artifacts failure and offers Back to Reports', async () => {
    const user = userEvent.setup()
    renderState({
      error: { kind: 'no-artifacts', message: "Execution 'exec-1' has no artifact directory" },
    })

    const card = screen.getByTestId('report-generation-state')
    expect(card).toHaveTextContent("Execution 'exec-1' has no artifact directory")
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: /back to reports/i }))
    expect(navigateMock).toHaveBeenCalledWith('/reports')
  })
})

describe('ReportGenerationState - execution still running', () => {
  const runningError = {
    kind: 'execution-running',
    message:
      "Cannot generate report for execution in 'running' state. Wait for the execution to finish.",
  }

  it('renders the still-running card with the backend message', () => {
    renderState({ error: runningError })

    const card = screen.getByTestId('report-generation-state')
    expect(card).toHaveTextContent('Execution still in progress')
    expect(card).toHaveTextContent(runningError.message)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  it('offers View Execution and Back to Reports', async () => {
    const user = userEvent.setup()
    renderState({ error: runningError })

    await user.click(screen.getByRole('button', { name: /view execution/i }))
    expect(navigateMock).toHaveBeenCalledWith('/executions/exec-1')

    await user.click(screen.getByRole('button', { name: /back to reports/i }))
    expect(navigateMock).toHaveBeenCalledWith('/reports')
  })
})
