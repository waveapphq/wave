/**
 * ArtifactsListContainer (coverage for container/container.tsx).
 *
 * Fetches execution-artifact summaries, owns table/filter/selection state, and
 * wires row + mass actions: open navigates to the drill, download streams a
 * .zip, delete soft-deletes (single execution or the selected set) and reloads.
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

vi.mock('@/features/artifacts/api/artifacts', () => ({
  fetchExecutionArtifactSummaries: vi.fn(),
  deleteExecutionArtifacts: vi.fn(),
}))

vi.mock('@/features/artifacts/api/download', () => ({
  downloadExecutionZip: vi.fn(),
}))

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn(), warning: vi.fn() }),
}))

import {
  deleteExecutionArtifacts,
  fetchExecutionArtifactSummaries,
} from '@/features/artifacts/api/artifacts'
import { downloadExecutionZip } from '@/features/artifacts/api/download'
import { ArtifactsListContainer } from '@/features/artifacts/container/container'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

const ROWS: ExecutionArtifactSummary[] = [
  {
    execution_id: 'exec-1',
    name: 'Nightly API Suite',
    entity_type: 'suite',
    status: 'failed',
    finished_at: '2026-06-10T11:07:13+00:00',
    artifact_count: 12,
    total_size_bytes: 48210,
  },
  {
    execution_id: 'exec-2',
    name: 'Inventory Sync Validation',
    entity_type: 'test',
    status: 'passed',
    finished_at: '2026-06-10T10:00:04+00:00',
    artifact_count: 3,
    total_size_bytes: 1024,
  },
]

function summariesResult(rows: ExecutionArtifactSummary[]) {
  return {
    data: rows,
    pagination: { total: rows.length, page: 1, per_page: 10, total_pages: 1 },
  }
}

function renderContainer() {
  return render(
    <MemoryRouter initialEntries={['/artifacts']}>
      <ArtifactsListContainer />
    </MemoryRouter>,
  )
}

async function passTypeToConfirm(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const input = within(dialog).getByLabelText(/to confirm/i)
  const confirmButton = within(dialog).getByRole('button', { name: /^delete/i })
  const label = input.getAttribute('aria-label') ?? ''
  const phrase = label.replace(/^type\s+/i, '').replace(/\s+to confirm$/i, '')
  await user.type(input, phrase)
  await user.click(confirmButton)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fetchExecutionArtifactSummaries).mockResolvedValue(summariesResult(ROWS) as never)
  vi.mocked(deleteExecutionArtifacts).mockResolvedValue(undefined as never)
  vi.mocked(downloadExecutionZip).mockResolvedValue(undefined)
})

describe('ArtifactsListContainer - load', () => {
  it('renders one row per execution after loading', async () => {
    renderContainer()

    expect(await screen.findByText('Nightly API Suite')).toBeInTheDocument()
    expect(screen.getByText('Inventory Sync Validation')).toBeInTheDocument()
    expect(fetchExecutionArtifactSummaries).toHaveBeenCalled()
  })

  it('shows the error state when the fetch rejects with an Error', async () => {
    vi.mocked(fetchExecutionArtifactSummaries).mockRejectedValueOnce(new Error('backend down'))
    renderContainer()

    expect(await screen.findByText('backend down')).toBeInTheDocument()
  })

  it('falls back to a generic message for a non-Error rejection', async () => {
    vi.mocked(fetchExecutionArtifactSummaries).mockRejectedValueOnce('weird')
    renderContainer()

    expect(await screen.findByText('Failed to load artifacts')).toBeInTheDocument()
  })

  it('retries from the error state', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchExecutionArtifactSummaries).mockRejectedValueOnce(new Error('backend down'))
    renderContainer()

    await user.click(await screen.findByRole('button', { name: /try again/i }))

    expect(await screen.findByText('Nightly API Suite')).toBeInTheDocument()
  })

  it('re-fetches with the search filter', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.type(screen.getByPlaceholderText(/search artifacts/i), 'nightly')

    await waitFor(() =>
      expect(fetchExecutionArtifactSummaries).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'nightly' }),
      ),
    )
  })
})

describe('ArtifactsListContainer - row actions', () => {
  beforeEach(() => {
    vi.mocked(fetchExecutionArtifactSummaries).mockResolvedValue(summariesResult([ROWS[0]]) as never)
  })

  it('opens the drill for a row', async () => {
    const user = userEvent.setup()
    renderContainer()

    await user.click(await screen.findByRole('button', { name: /open nightly api suite/i }))

    expect(navigateMock).toHaveBeenCalledWith('/artifacts/exec-1')
  })

  it('downloads a single execution zip from the row kebab', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    expect(downloadExecutionZip).toHaveBeenCalledWith('exec-1')
  })

  it('soft-deletes a single execution after type-to-confirm and reloads', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))
    await passTypeToConfirm(user, screen.getByRole('alertdialog'))

    await waitFor(() => expect(deleteExecutionArtifacts).toHaveBeenCalledWith('exec-1'))
    await waitFor(() => expect(fetchExecutionArtifactSummaries).toHaveBeenCalledTimes(2))
  })
})

describe('ArtifactsListContainer - mass actions', () => {
  it('enters and exits selection mode', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getByRole('button', { name: /mass action/i }))
    expect(screen.getByTestId('selection-counter')).toBeInTheDocument()

    await user.click(screen.getByTestId('selection-close'))
    expect(screen.getByRole('button', { name: /mass action/i })).toBeInTheDocument()
  })

  it('runs the bulk download path from the mass menu', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getByRole('button', { name: /mass action/i }))
    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    // Nothing selected -> no per-execution zip fired, but the path is exercised.
    expect(downloadExecutionZip).not.toHaveBeenCalled()
  })

  it('runs the bulk delete path after type-to-confirm and reloads', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getByRole('button', { name: /mass action/i }))
    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))
    await passTypeToConfirm(user, screen.getByRole('alertdialog'))

    await waitFor(() => expect(fetchExecutionArtifactSummaries).toHaveBeenCalledTimes(2))
    expect(deleteExecutionArtifacts).not.toHaveBeenCalled()
  })
})

describe('ArtifactsListContainer - a failed action is reported', () => {
  async function selectBothRows(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /mass action/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Nightly API Suite' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Inventory Sync Validation' }))
  }

  it('reports a failed row download', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionZip).mockRejectedValue(new Error('Not Found'))
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getAllByRole('button', { name: /more actions/i })[0])
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Not Found', 'Download Failed'))
  })

  it('names how many downloads finished when only some failed', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionZip)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Not Found'))
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await selectBothRows(user)
    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        '1 of 2 downloads finished. The rest failed: Not Found',
        'Download Failed',
      ),
    )
  })

  it('reports a failed row delete and reloads, so the list stops claiming the artifacts are gone', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteExecutionArtifacts).mockRejectedValue(new Error('Forbidden'))
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await user.click(screen.getAllByRole('button', { name: /more actions/i })[0])
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))
    await passTypeToConfirm(user, screen.getByRole('alertdialog'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Forbidden', 'Delete Failed'))
    await waitFor(() => expect(fetchExecutionArtifactSummaries).toHaveBeenCalledTimes(2))
  })

  it('names how many executions were cleared when only some deletes failed, and keeps the selection', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteExecutionArtifacts)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Forbidden'))
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await selectBothRows(user)
    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))
    await passTypeToConfirm(user, screen.getByRole('alertdialog'))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        '1 of 2 executions had their artifacts removed. The rest failed: Forbidden',
        'Delete Failed',
      ),
    )
    expect(screen.getByRole('checkbox', { name: 'Select Nightly API Suite' })).toBeChecked()
  })

  it('clears the selection and says nothing when every delete lands', async () => {
    const user = userEvent.setup()
    renderContainer()
    await screen.findByText('Nightly API Suite')

    await selectBothRows(user)
    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))
    await passTypeToConfirm(user, screen.getByRole('alertdialog'))

    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Select Nightly API Suite' })).not.toBeChecked(),
    )
    expect(mockToastError).not.toHaveBeenCalled()
  })
})
