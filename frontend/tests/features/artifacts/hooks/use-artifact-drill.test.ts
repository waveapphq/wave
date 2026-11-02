/**
 * useArtifactDrill (coverage for hooks/use-artifact-drill.ts).
 *
 * Fetches with tombstones included (so the removed count is always known),
 * filters them out until showRemoved, and wires download / delete
 * for a leaf artifact or a directory subtree, reloading after a soft-delete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

vi.mock('@/features/artifacts/api/artifacts', () => ({
  fetchExecutionArtifacts: vi.fn(),
  fetchArtifactJson: vi.fn(),
  fetchDrillExecution: vi.fn(),
  deleteArtifact: vi.fn(),
}))
vi.mock('@/features/artifacts/api/download', () => ({
  downloadArtifactFile: vi.fn(),
  downloadExecutionZip: vi.fn(),
}))
vi.mock('@/lib/api', () => ({
  getApiBaseUrl: () => 'http://localhost:8000/api',
}))

const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }))
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn(), warning: vi.fn() }),
}))

import { useArtifactDrill } from '@/features/artifacts/hooks/use-artifact-drill'
import {
  deleteArtifact,
  fetchArtifactJson,
  fetchDrillExecution,
  fetchExecutionArtifacts,
} from '@/features/artifacts/api/artifacts'
import { downloadArtifactFile, downloadExecutionZip } from '@/features/artifacts/api/download'
import { usePageBlockStore, type PageBlock } from '@/stores/page-block-store'
import type { ArtifactMeta } from '@/features/artifacts/api/types'
import type { ArtifactTreeNode } from '@/features/artifacts/lib/artifact-sections'

const DRILL_EXECUTION = { name: 'Nightly Suite', entityType: 'suite', status: 'failed' }

function readFailure(message: string) {
  return Object.assign(new Error(message), {
    method: 'GET',
    path: '/artifacts/dir-1/error.json/content',
    status: 500,
    statusText: 'Internal Server Error',
    durationMs: 12,
    requestId: 'req-drill',
    occurredAt: '2026-08-10T15:42:09.000Z',
  })
}

function currentBlock(): PageBlock {
  const { block } = usePageBlockStore.getState()
  if (!block) throw new Error('expected the page to be blocked')
  return block
}

function artifact(path: string, extra: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    id: `dir-1/${path}`,
    execution_id: 'exec-1',
    name: path.split('/').pop() ?? path,
    path,
    size_bytes: 1,
    content_type: 'text/plain',
    compression: null,
    created_at: '2026-06-09T12:00:00Z',
    ...extra,
  }
}

function dirNode(path: string, children: ArtifactTreeNode[] = []): ArtifactTreeNode {
  return { name: path.split('/').pop() ?? path, path, children, artifact: null }
}

function leafNode(path: string): ArtifactTreeNode {
  return { name: path.split('/').pop() ?? path, path, children: [], artifact: artifact(path) }
}

beforeEach(() => {
  vi.clearAllMocks()
  usePageBlockStore.setState({ block: null, retrying: false })
  vi.mocked(fetchExecutionArtifacts).mockResolvedValue([])
  vi.mocked(fetchDrillExecution).mockResolvedValue(DRILL_EXECUTION as never)
  vi.mocked(fetchArtifactJson).mockResolvedValue({ failures: [] } as never)
  vi.mocked(deleteArtifact).mockResolvedValue(undefined)
  vi.mocked(downloadArtifactFile).mockResolvedValue(undefined)
  vi.mocked(downloadExecutionZip).mockResolvedValue(undefined)
})

describe('useArtifactDrill - loading', () => {
  it('fetches with tombstones included and groups into sections', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([
      artifact('error.json'),
      artifact('report.json'),
      artifact('logs/a.log'),
      artifact('out.csv'),
    ])

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchExecutionArtifacts).toHaveBeenCalledWith('exec-1', true)
    expect(result.current.sections.failure).toHaveLength(1)
    expect(result.current.sections.reports).toHaveLength(1)
    expect(result.current.sections.logs).toHaveLength(1)
    expect(result.current.sections.files).toHaveLength(1)
    expect(result.current.execution).toEqual({
      name: 'Nightly Suite',
      entityType: 'suite',
      status: 'failed',
    })
    expect(result.current.error).toBeUndefined()
  })

  it('does not fetch when executionId is undefined', async () => {
    const { result } = renderHook(() => useArtifactDrill(undefined))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchExecutionArtifacts).not.toHaveBeenCalled()
    expect(result.current.sections.files).toEqual([])
  })

  it('captures the error message on failure', async () => {
    vi.mocked(fetchExecutionArtifacts).mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })
})

describe('useArtifactDrill - header metadata + failure scopes', () => {
  it('derives execution metadata and failing scopes from error.json', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([
      artifact('error.json'),
      artifact('logs/smoke/login.log'),
    ])
    vi.mocked(fetchArtifactJson).mockResolvedValue({
      failures: [{ scope_path: 'smoke/login' }],
    } as never)

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchArtifactJson).toHaveBeenCalledWith('dir-1/error.json')
    expect(result.current.failedScopes.has('smoke/login')).toBe(true)
  })

  it('passes the resolved execution metadata through', async () => {
    vi.mocked(fetchDrillExecution).mockResolvedValue({
      name: 'API Test',
      entityType: 'test',
      status: 'passed',
    } as never)

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.execution).toEqual({ name: 'API Test', entityType: 'test', status: 'passed' })
  })

  it('ignores failure entries without a scope_path', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('error.json')])
    vi.mocked(fetchArtifactJson).mockResolvedValue({
      failures: [{}, { scope_path: 'smoke/login' }],
    } as never)

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.failedScopes.has('smoke/login')).toBe(true)
    expect(result.current.failedScopes.has('')).toBe(false)
  })

  it('treats error.json without a failures array as no failing scopes', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('error.json')])
    vi.mocked(fetchArtifactJson).mockResolvedValue({} as never)

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.failedScopes.size).toBe(0)
  })

})

describe('useArtifactDrill - a failed supporting read blocks the page', () => {
  it('blocks naming the failure summary when error.json cannot be read', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('error.json')])
    vi.mocked(fetchArtifactJson).mockRejectedValue(readFailure('unreadable'))

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    expect(result.current.error).toBeUndefined()
    expect(currentBlock().title).toBe('Could not load failure summary')
    expect(currentBlock().detail).toEqual({
      method: 'GET',
      path: '/artifacts/dir-1/error.json/content',
      status: 500,
      statusText: 'Internal Server Error',
      durationMs: 12,
      requestId: 'req-drill',
      occurredAt: '2026-08-10T15:42:09.000Z',
      message: 'unreadable',
    })
  })

  it('blocks naming the execution details when its read fails', async () => {
    vi.mocked(fetchDrillExecution).mockRejectedValue(readFailure('no execution'))

    renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    expect(currentBlock().title).toBe('Could not load execution details')
  })

  it('names both reads when both fail', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('error.json')])
    vi.mocked(fetchDrillExecution).mockRejectedValue(readFailure('no execution'))
    vi.mocked(fetchArtifactJson).mockRejectedValue(readFailure('unreadable'))

    renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    expect(currentBlock().title).toBe('Could not load execution details and failure summary')
    expect(currentBlock().detail.message).toContain('execution details')
    expect(currentBlock().detail.message).toContain('failure summary')
    expect(currentBlock().detail.message).toContain('no execution')
    expect(currentBlock().detail.message).toContain('unreadable')
  })

  it('retries only the read that failed and clears the block on success', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('error.json')])
    vi.mocked(fetchArtifactJson).mockRejectedValueOnce(readFailure('unreadable'))

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const executionCalls = vi.mocked(fetchDrillExecution).mock.calls.length
    vi.mocked(fetchArtifactJson).mockResolvedValue({
      failures: [{ scope_path: 'smoke/login' }],
    } as never)
    await act(async () => {
      await currentBlock().retry()
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.failedScopes.has('smoke/login')).toBe(true)
    expect(vi.mocked(fetchDrillExecution).mock.calls.length).toBe(executionCalls)
    expect(vi.mocked(fetchExecutionArtifacts)).toHaveBeenCalledTimes(1)
  })

  it('re-blocks with the newer reason and rejects when the retry fails again', async () => {
    vi.mocked(fetchDrillExecution).mockRejectedValue(readFailure('no execution'))

    renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    const newer = readFailure('still no execution')
    vi.mocked(fetchDrillExecution).mockRejectedValue(newer)
    await act(async () => {
      await expect(currentBlock().retry()).rejects.toBe(newer)
    })

    expect(currentBlock().detail.message).toBe('still no execution')
  })

  it('leaves the page unblocked when a run produced no error.json', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([artifact('out.csv')])

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchArtifactJson).not.toHaveBeenCalled()
    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('releases its own block when the primary read fails, so only the error state shows', async () => {
    vi.mocked(fetchDrillExecution).mockRejectedValue(readFailure('no execution'))

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    vi.mocked(fetchExecutionArtifacts).mockRejectedValue(new Error('boom'))
    await act(async () => {
      result.current.refetch()
    })

    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('useArtifactDrill - live rollups', () => {
  it('exposes the live artifact count and total size (excluding tombstones)', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([
      artifact('a.csv', { size_bytes: 100 }),
      artifact('b.csv', { size_bytes: 200 }),
      artifact('gone.csv', { size_bytes: 999, removed_at: '2026-06-09T13:00:00Z' }),
    ])

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.artifactCount).toBe(2)
    expect(result.current.totalSizeBytes).toBe(300)
  })
})

describe('useArtifactDrill - removed visibility', () => {
  it('counts removed always but hides them until showRemoved', async () => {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue([
      artifact('out.csv'),
      artifact('gone.csv', { removed_at: '2026-06-09T13:00:00Z' }),
    ])

    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.removedCount).toBe(1)
    expect(result.current.sections.files).toHaveLength(1)

    act(() => result.current.setShowRemoved(true))
    expect(result.current.sections.files).toHaveLength(2)
  })
})

describe('useArtifactDrill - actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('onDownload downloads a leaf file', async () => {
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.onDownload(artifact('logs/a.log'))

    expect(downloadArtifactFile).toHaveBeenCalledWith('dir-1/logs/a.log', 'a.log')
  })

  it('onDownload zips a directory subtree', async () => {
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.onDownload(dirNode('logs/smoke'))

    expect(downloadExecutionZip).toHaveBeenCalledWith('exec-1', 'logs/smoke')
  })

  it('onDownload subtree falls back to an empty execution id when unknown', async () => {
    const { result } = renderHook(() => useArtifactDrill(undefined))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.onDownload(dirNode('logs/smoke'))

    expect(downloadExecutionZip).toHaveBeenCalledWith('', 'logs/smoke')
  })

  it('onDelete soft-deletes a leaf then reloads', async () => {
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    vi.mocked(fetchExecutionArtifacts).mockClear()

    await act(async () => {
      await result.current.onDelete(artifact('logs/a.log'))
    })

    expect(deleteArtifact).toHaveBeenCalledWith('dir-1/logs/a.log')
    expect(fetchExecutionArtifacts).toHaveBeenCalledWith('exec-1', true)
  })

  it('onDelete soft-deletes every leaf of a subtree then reloads', async () => {
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const subtree = dirNode('logs/smoke', [leafNode('logs/smoke/a.log'), leafNode('logs/smoke/b.log')])
    await act(async () => {
      await result.current.onDelete(subtree)
    })

    const deleted = vi.mocked(deleteArtifact).mock.calls.map((call) => call[0])
    expect(deleted).toEqual(
      expect.arrayContaining(['dir-1/logs/smoke/a.log', 'dir-1/logs/smoke/b.log']),
    )
  })

  it('refetch reloads the artifacts', async () => {
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    vi.mocked(fetchExecutionArtifacts).mockClear()

    await act(async () => {
      result.current.refetch()
    })

    await waitFor(() => expect(fetchExecutionArtifacts).toHaveBeenCalled())
  })
})

describe('useArtifactDrill - a failed action is reported', () => {
  async function renderLoaded(artifacts: ArtifactMeta[] = []) {
    vi.mocked(fetchExecutionArtifacts).mockResolvedValue(artifacts)
    const { result } = renderHook(() => useArtifactDrill('exec-1'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    return result
  }

  it('reports a failed file download', async () => {
    vi.mocked(downloadArtifactFile).mockRejectedValue(new Error('Not Found'))
    const result = await renderLoaded()

    result.current.onDownload(artifact('logs/a.log'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Not Found', 'Download Failed'))
  })

  it('reports a failed subtree download', async () => {
    vi.mocked(downloadExecutionZip).mockRejectedValue(new Error('Service Unavailable'))
    const result = await renderLoaded()

    result.current.onDownload(dirNode('logs/smoke'))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Service Unavailable', 'Download Failed'),
    )
  })

  it('says nothing when the download starts', async () => {
    vi.mocked(downloadArtifactFile).mockResolvedValue(undefined)
    const result = await renderLoaded()

    result.current.onDownload(artifact('logs/a.log'))

    await waitFor(() => expect(downloadArtifactFile).toHaveBeenCalled())
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('reports a failed delete and still reloads, so the tree stops claiming the file is gone', async () => {
    vi.mocked(deleteArtifact).mockRejectedValue(new Error('Forbidden'))
    const result = await renderLoaded()
    vi.mocked(fetchExecutionArtifacts).mockClear()

    await act(async () => {
      await result.current.onDelete(artifact('logs/a.log'))
    })

    expect(mockToastError).toHaveBeenCalledWith('Forbidden', 'Delete Failed')
    expect(fetchExecutionArtifacts).toHaveBeenCalledWith('exec-1', true)
  })

  it('names how many artifacts were removed when only some deletes failed', async () => {
    vi.mocked(deleteArtifact)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Forbidden'))
    const result = await renderLoaded()

    const subtree = dirNode('logs/smoke', [
      leafNode('logs/smoke/a.log'),
      leafNode('logs/smoke/b.log'),
    ])
    await act(async () => {
      await result.current.onDelete(subtree)
    })

    expect(mockToastError).toHaveBeenCalledWith(
      '1 of 2 artifacts were removed. The rest failed: Forbidden',
      'Delete Failed',
    )
  })

  it('says nothing when every delete lands', async () => {
    vi.mocked(deleteArtifact).mockResolvedValue(undefined)
    const result = await renderLoaded()

    await act(async () => {
      await result.current.onDelete(artifact('logs/a.log'))
    })

    expect(mockToastError).not.toHaveBeenCalled()
  })
})
