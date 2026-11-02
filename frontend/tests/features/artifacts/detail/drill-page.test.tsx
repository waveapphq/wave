/**
 * ArtifactDrillPage - per-execution drill
 *
 * Module: frontend/src/features/artifacts/detail/artifact-drill-page.tsx
 *
 * Renders the four sections in fixed order (Failure summary, Reports, Logs,
 * Files), each only when it has content. Logs + Files carry a Tree|Flat toggle;
 * Failure + Reports do not. A Show removed toggle reveals tombstones. Data
 * comes from useArtifactDrill (mocked here for isolation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { ArtifactDrillPage } from '@/features/artifacts/detail/artifact-drill-page'
import { useArtifactDrill } from '@/features/artifacts/hooks/use-artifact-drill'
import { downloadExecutionZip } from '@/features/artifacts/api/download'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

vi.mock('@/features/artifacts/hooks/use-artifact-drill', () => ({
  useArtifactDrill: vi.fn(),
}))
vi.mock('@/features/artifacts/api/download', () => ({
  downloadExecutionZip: vi.fn(),
}))

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn(), warning: vi.fn() }),
}))

const mockUseArtifactDrill = vi.mocked(useArtifactDrill)

function artifact(path: string, extra: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    id: `20260609-120000-exec-1/${path}`,
    execution_id: 'exec-1',
    name: path.split('/').pop() ?? path,
    path,
    size_bytes: 32,
    content_type: 'text/plain',
    compression: null,
    created_at: '2026-06-09T12:00:00Z',
    ...extra,
  }
}

type DrillReturn = ReturnType<typeof useArtifactDrill>

function drillState(overrides: Partial<DrillReturn> = {}): DrillReturn {
  return {
    sections: {
      failure: [artifact('error.json')],
      reports: [artifact('report.json'), artifact('report.html')],
      logs: [artifact('logs/smoke/login.log')],
      files: [artifact('output.csv')],
    },
    execution: { name: 'Nightly Suite', entityType: 'suite', status: 'failed' },
    failedScopes: new Set<string>(),
    artifactCount: 4,
    totalSizeBytes: 4096,
    removedCount: 0,
    showRemoved: false,
    setShowRemoved: vi.fn(),
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  } as DrillReturn
}

function renderDrill() {
  const router = createMemoryRouter(
    [
      { path: '/artifacts', element: <div>Artifacts list</div> },
      { path: '/artifacts/:executionId', element: <ArtifactDrillPage /> },
    ],
    { initialEntries: ['/artifacts/exec-1'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockToastError.mockClear()
  mockUseArtifactDrill.mockReturnValue(drillState())
  vi.mocked(downloadExecutionZip).mockResolvedValue(undefined)
})

describe('ArtifactDrillPage - header', () => {
  it('renders the execution header with name, status and Download-all', () => {
    renderDrill()

    expect(screen.getByText('Nightly Suite')).toBeInTheDocument()
    expect(screen.getByTestId('artifact-download-all')).toBeInTheDocument()
  })

  it('streams the execution zip from Download-all', async () => {
    const user = userEvent.setup()
    renderDrill()

    await user.click(screen.getByTestId('artifact-download-all'))

    expect(downloadExecutionZip).toHaveBeenCalledWith('exec-1')
  })

  it('reports a Download-all the server refused', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadExecutionZip).mockRejectedValueOnce(new Error('Not Found'))
    renderDrill()

    await user.click(screen.getByTestId('artifact-download-all'))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Not Found', 'Download Failed'),
    )
  })

  it('navigates back to the artifacts list', async () => {
    const user = userEvent.setup()
    renderDrill()

    await user.click(screen.getByTestId('detail-back-btn'))

    expect(screen.getByText('Artifacts list')).toBeInTheDocument()
  })

  it('falls back to the execution id when metadata is unavailable', () => {
    mockUseArtifactDrill.mockReturnValue(drillState({ execution: null }))

    renderDrill()

    expect(screen.getByText('exec-1')).toBeInTheDocument()
  })

  it('omits the entity icon for an unrecognized entity type', () => {
    mockUseArtifactDrill.mockReturnValue(
      drillState({ execution: { name: 'Cron Job', entityType: 'cron', status: 'passed' } }),
    )

    renderDrill()

    expect(screen.getByText('Cron Job')).toBeInTheDocument()
  })

  it('renders the entity type chip next to the name', () => {
    renderDrill()

    expect(screen.getByText('Suite')).toBeInTheDocument()
  })

  it('renders the header when the execution type is absent', () => {
    mockUseArtifactDrill.mockReturnValue(
      drillState({ execution: { name: 'No Type', status: 'passed' } }),
    )

    renderDrill()

    expect(screen.getByText('No Type')).toBeInTheDocument()
  })

  it('renders the metadata line with finished time, artifact count and size', () => {
    mockUseArtifactDrill.mockReturnValue(
      drillState({
        execution: {
          name: 'Nightly Suite',
          entityType: 'suite',
          status: 'failed',
          finishedAt: '2026-06-12T14:25:00Z',
        },
        artifactCount: 214,
        totalSizeBytes: 50_563_892,
      }),
    )

    renderDrill()

    const meta = screen.getByTestId('artifact-drill-meta')
    expect(meta).toHaveTextContent('214 artifacts')
    expect(meta).toHaveTextContent(/Finished/)
  })

  it('uses the generic title and an empty zip id when there is no execution param', async () => {
    const user = userEvent.setup()
    mockUseArtifactDrill.mockReturnValue(drillState({ execution: null }))
    const router = createMemoryRouter([{ path: '/artifacts', element: <ArtifactDrillPage /> }], {
      initialEntries: ['/artifacts'],
    })
    render(<RouterProvider router={router} />)

    expect(screen.getByText('Artifacts')).toBeInTheDocument()
    await user.click(screen.getByTestId('artifact-download-all'))
    expect(downloadExecutionZip).toHaveBeenCalledWith('')
  })
})

describe('ArtifactDrillPage - sections', () => {
  it('renders the four sections in fixed order', () => {
    renderDrill()

    const failure = screen.getByText('Failure summary')
    const reports = screen.getByText('Reports')
    const logs = screen.getByText('Logs')
    const files = screen.getByText('Files')

    expect(failure.compareDocumentPosition(reports) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(reports.compareDocumentPosition(logs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(logs.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('omits the Failure summary section on a clean run (no failures)', () => {
    mockUseArtifactDrill.mockReturnValue(
      drillState({ sections: { failure: [], reports: [artifact('report.json')], logs: [], files: [] } }),
    )

    renderDrill()

    expect(screen.queryByText('Failure summary')).not.toBeInTheDocument()
    expect(screen.getByText('Reports')).toBeInTheDocument()
  })
})

describe('ArtifactDrillPage - Tree/Flat toggle', () => {
  it('shows a Tree|Flat toggle on Logs and Files only', () => {
    renderDrill()

    // One toggle per section that has it: Logs + Files = two each.
    expect(screen.getAllByText('Tree')).toHaveLength(2)
    expect(screen.getAllByText('Flat')).toHaveLength(2)
  })
})

describe('ArtifactDrillPage - failure badge', () => {
  it('shows the failure count badge derived from the failing scopes', () => {
    mockUseArtifactDrill.mockReturnValue(
      drillState({ failedScopes: new Set(['suite/a', 'suite/b']) }),
    )

    renderDrill()

    expect(screen.getByText('2 failures')).toBeInTheDocument()
  })
})

describe('ArtifactDrillPage - Show removed', () => {
  it('renders the Show removed toolbar with the removed count', () => {
    mockUseArtifactDrill.mockReturnValue(drillState({ removedCount: 2 }))

    renderDrill()

    const toggle = screen.getByTestId('artifact-show-removed')
    expect(toggle).toHaveTextContent(/show removed/i)
    expect(toggle).toHaveTextContent('2')
  })

  it('toggling Show removed calls setShowRemoved', async () => {
    const user = userEvent.setup()
    const setShowRemoved = vi.fn()
    mockUseArtifactDrill.mockReturnValue(drillState({ removedCount: 1, setShowRemoved }))

    renderDrill()
    await user.click(screen.getByTestId('artifact-show-removed'))

    expect(setShowRemoved).toHaveBeenCalled()
  })

  it('omits the Show removed toolbar when nothing is removed', () => {
    renderDrill()

    expect(screen.queryByTestId('artifact-show-removed')).not.toBeInTheDocument()
  })

  it('reflects the checked state when removed artifacts are visible', () => {
    mockUseArtifactDrill.mockReturnValue(drillState({ removedCount: 2, showRemoved: true }))

    renderDrill()

    expect(screen.getByTestId('artifact-show-removed')).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('ArtifactDrillPage - loading / error', () => {
  it('shows a skeleton while loading', () => {
    mockUseArtifactDrill.mockReturnValue(drillState({ isLoading: true }))

    renderDrill()

    expect(screen.getByTestId('artifact-drill-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('Reports')).not.toBeInTheDocument()
  })

  it('shows the error message and retries via refetch', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockUseArtifactDrill.mockReturnValue(
      drillState({ error: 'Failed to load artifacts', refetch }),
    )

    renderDrill()
    expect(screen.getByText('Failed to load artifacts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('ArtifactDrillPage - deleting an artifact', () => {
  it('asks before deleting a file and reports it only on confirm', async () => {
    const user = userEvent.setup()
    const state = drillState()
    mockUseArtifactDrill.mockReturnValue(state)
    renderDrill()

    await user.click(screen.getByRole('button', { name: 'Delete output.csv' }))
    expect(state.onDelete).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete "output.csv"?')
    expect(dialog).toHaveTextContent('cannot be restored')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(state.onDelete).toHaveBeenCalledTimes(1)
  })

  it('names the whole subtree when the target is a folder', async () => {
    const user = userEvent.setup()
    const state = drillState({
      sections: { failure: [], reports: [], logs: [], files: [artifact('output/nested.csv')] },
    })
    mockUseArtifactDrill.mockReturnValue(state)
    renderDrill()

    await user.click(screen.getByRole('button', { name: 'Delete output' }))

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'The folder and every artifact under it are removed.',
    )
  })

  it('keeps the artifact when the delete is canceled', async () => {
    const user = userEvent.setup()
    const state = drillState()
    mockUseArtifactDrill.mockReturnValue(state)
    renderDrill()

    await user.click(screen.getByRole('button', { name: 'Delete output.csv' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(state.onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
