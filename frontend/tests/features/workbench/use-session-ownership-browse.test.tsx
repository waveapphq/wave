/**
 * useSessionOwnership - free browsing.
 *
 * A watcher that navigates itself (opens or closes a test or function) stops
 * tracking the holder: draft snapshots buffer instead of applying, the run
 * attach never fires for it, and the banner offers a way back. Rejoining
 * converges on the holder's surface - identity from the announced run (or the
 * pre-browse view) plus the latest buffered snapshot. Becoming holder while
 * browsing keeps the browsed canvas clean and drops the browsing state.
 *
 * Hook under test:
 * frontend/src/features/workbench/hooks/use-session-ownership.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { ownershipApi, mockSubscribe, mockConnect, handlerRef } = vi.hoisted(() => {
  const handlerRef: { current: (payload: Record<string, unknown>) => void } = {
    current: () => {},
  }
  const mockSend = vi.fn()
  const mockSubscribe = vi.fn((topic: string, handler: (payload: Record<string, unknown>) => void) => {
    handlerRef.current = handler
    return { topic, unsubscribe: vi.fn(), send: mockSend }
  })
  return {
    ownershipApi: {
      getOwnership: vi.fn(),
      claim: vi.fn(),
      heartbeat: vi.fn(),
      release: vi.fn(),
      requestTakeover: vi.fn(),
      approveTakeover: vi.fn(),
      denyTakeover: vi.fn(),
      forceTakeover: vi.fn(),
      cancelTakeover: vi.fn(),
    },
    mockSubscribe,
    mockSend,
    mockConnect: vi.fn().mockResolvedValue(undefined),
    handlerRef,
  }
})

vi.mock('@/features/workbench/api/ownership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/api/ownership')>()),
  ownershipApi,
}))
vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: () => ({ isConnected: true, subscribe: mockSubscribe, connect: mockConnect }),
}))

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const error = vi.fn()
  return {
    ...(await importOriginal<typeof import('@/components/ui/toast')>()),
    useToast: () => ({ error }),
  }
})

import { useSessionOwnership } from '@/features/workbench/hooks/use-session-ownership'
import { getSessionId } from '@/lib/session-identity'

const RUN_WIRE = {
  session_id: 'run-session-1',
  test_id: 'run-test-id',
  test_name: 'Nightly Smoke',
  environment_id: 'env-1',
  environment_name: 'Staging',
  status: 'running',
}

const FREE = { holder: null, watchers: 0, pending_takeover: null, run: null }
const HOLDER_ME = {
  holder: { id: 'me', label: 'You', kind: 'person' },
  you_are_holder: true,
  watchers: 0,
  pending_takeover: null,
  run: null,
}
const HELD_BY_OTHER = {
  holder: { id: 'other', label: 'Ashley', kind: 'person' },
  you_are_holder: false,
  watchers: 0,
  pending_takeover: null,
  run: null,
}

function snapshotFrame(
  marker: string,
  identity: { test_id: string | null; test_name: string | null } | null = null,
) {
  return {
    event: 'draft_snapshot',
    from_holder_id: 'other',
    nodes: [{ id: marker, type: 'plugin', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
    variables: [],
    ...(identity ?? {}),
    active_node_id: null,
  }
}

function storeNodeIds(): string[] {
  return useWorkflowStore.getState().nodes.map((n) => n.id)
}

function mount() {
  return renderHook(() => useSessionOwnership())
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function emit(payload: Record<string, unknown>) {
  act(() => {
    handlerRef.current(payload)
  })
}

async function mountMirroring() {
  ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
  const rendered = mount()
  await flush()
  expect(rendered.result.current.isMirroring).toBe(true)
  return rendered
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  handlerRef.current = () => {}
  useWorkflowStore.getState().reset()
  ownershipApi.getOwnership.mockResolvedValue(FREE)
  ownershipApi.claim.mockResolvedValue(HOLDER_ME)
  ownershipApi.heartbeat.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSessionOwnership - browsing away', () => {
  it('starts out not browsing', async () => {
    const { result } = await mountMirroring()

    expect(result.current.browsingAway).toBe(false)
  })

  it('stops applying holder snapshots once browsing', async () => {
    const { result } = await mountMirroring()
    emit(snapshotFrame('applied'))
    expect(storeNodeIds()).toEqual(['applied'])

    act(() => {
      result.current.browseAway()
    })
    emit(snapshotFrame('never-applied'))

    expect(result.current.browsingAway).toBe(true)
    expect(storeNodeIds()).toEqual(['applied'])
  })

  it('drops the mirror active-node cue when browsing starts', async () => {
    const { result } = await mountMirroring()
    emit({ ...snapshotFrame('applied'), active_node_id: 'applied' })
    expect(useWorkflowStore.getState().mirrorActiveNodeId).toBe('applied')

    act(() => {
      result.current.browseAway()
    })

    expect(useWorkflowStore.getState().mirrorActiveNodeId).toBeNull()
  })

  it('is a no-op for the holder', async () => {
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      result.current.browseAway()
    })

    expect(result.current.browsingAway).toBe(false)
  })

  it('keeps the pre-browse identity across repeated browse calls', async () => {
    const { result } = await mountMirroring()
    act(() => {
      useWorkflowStore.getState().setEditingTest('mirror-test', 'Mirror Test')
      result.current.browseAway()
    })
    act(() => {
      useWorkflowStore.getState().setEditingTest('browsed-test', 'Browsed Test')
      result.current.browseAway()
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().editingTestId).toBe('mirror-test')
    expect(useWorkflowStore.getState().editingTestName).toBe('Mirror Test')
  })

  it('still tracks the announced run while browsing', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    emit({ event: 'run_state_changed', run: RUN_WIRE })

    expect(result.current.browsingAway).toBe(true)
    expect(result.current.mirroredRun).toMatchObject({ sessionId: 'run-session-1' })
  })

  it('keeps browsing when the slot changes hands to another person', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    emit({ event: 'holder_changed', holder: { id: 'third', label: 'Will', kind: 'person' } })

    expect(result.current.browsingAway).toBe(true)
    expect(result.current.isMirroring).toBe(true)
  })
})

describe('useSessionOwnership - rejoining the mirror', () => {
  it('applies the latest buffered snapshot on rejoin', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })
    emit(snapshotFrame('missed-1'))
    emit(snapshotFrame('missed-2'))

    act(() => {
      result.current.rejoinMirror()
    })

    expect(result.current.browsingAway).toBe(false)
    expect(storeNodeIds()).toEqual(['missed-2'])
  })

  it('restores the pre-browse test identity when no run is announced', async () => {
    const { result } = await mountMirroring()
    act(() => {
      useWorkflowStore.getState().setEditingTest('mirror-test', 'Mirror Test')
      result.current.browseAway()
    })
    act(() => {
      useWorkflowStore.getState().setEditingTest('browsed-test', 'Browsed Test')
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().editingTestId).toBe('mirror-test')
    expect(useWorkflowStore.getState().editingTestName).toBe('Mirror Test')
  })

  it('adopts the buffered stream identity over the pre-browse one', async () => {
    const { result } = await mountMirroring()
    act(() => {
      useWorkflowStore.getState().setEditingTest('mirror-test', 'Mirror Test')
      result.current.browseAway()
    })
    emit(snapshotFrame('streamed', { test_id: 'stream-test', test_name: 'Stream Test' }))

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().editingTestId).toBe('stream-test')
    expect(useWorkflowStore.getState().editingTestName).toBe('Stream Test')
  })

  it('adopts the announced run identity over the pre-browse one', async () => {
    const { result } = await mountMirroring()
    act(() => {
      useWorkflowStore.getState().setEditingTest('mirror-test', 'Mirror Test')
      result.current.browseAway()
    })
    emit({ event: 'run_state_changed', run: RUN_WIRE })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().editingTestId).toBe('run-test-id')
    expect(useWorkflowStore.getState().editingTestName).toBe('Nightly Smoke')
  })

  it('clears a browsed Library View on rejoin', async () => {
    const { result } = await mountMirroring()
    emit(snapshotFrame('mirror-graph'))
    act(() => {
      result.current.browseAway()
    })
    act(() => {
      useWorkflowStore
        .getState()
        .enterFunctionView({ functionId: 'fn-1', version: '1.0.0', editable: false })
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().functionViewMode).toBeNull()
    expect(storeNodeIds()).toEqual(['mirror-graph'])
  })

  it('tolerates a rejoin with nothing buffered and no identity', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(result.current.browsingAway).toBe(false)
    expect(storeNodeIds()).toEqual([])
    expect(useWorkflowStore.getState().editingTestId).toBeNull()
  })

  it('requests a fit-to-view so the rejoined surface is framed', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().fitViewRequested).toBe(true)
  })

  it('is a no-op when not browsing', async () => {
    const { result } = await mountMirroring()
    emit(snapshotFrame('live'))
    act(() => {
      useWorkflowStore.getState().setEditingTest('mirror-test', 'Mirror Test')
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(useWorkflowStore.getState().editingTestId).toBe('mirror-test')
    expect(storeNodeIds()).toEqual(['live'])
  })

  it('resumes live snapshot application after rejoin', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })
    act(() => {
      result.current.rejoinMirror()
    })

    emit(snapshotFrame('live-again'))

    expect(storeNodeIds()).toEqual(['live-again'])
  })
})

describe('useSessionOwnership - leaving the browse state via ownership', () => {
  it('claims the freed slot while browsing without dirtying the browsed canvas', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    emit({ event: 'holder_changed', holder: null, reason: 'handoff' })
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(result.current.browsingAway).toBe(false)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
    expect(result.current.inheritRefreshTick).toBe(0)
  })

  it('still dirties an inherited STREAMED draft when it was NOT browsing', async () => {
    const { result } = await mountMirroring()
    emit(snapshotFrame('streamed'))

    emit({ event: 'holder_changed', holder: null, reason: 'handoff' })
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(useWorkflowStore.getState().isDirty).toBe(true)
  })

  it('keeps the browsed canvas clean when a holder_changed names this tab', async () => {
    const { result } = await mountMirroring()
    act(() => {
      result.current.browseAway()
    })

    emit({
      event: 'holder_changed',
      holder: { id: getSessionId(), label: 'You', kind: 'person' },
    })

    expect(result.current.isHolder).toBe(true)
    expect(result.current.browsingAway).toBe(false)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})
