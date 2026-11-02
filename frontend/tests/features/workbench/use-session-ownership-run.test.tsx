/**
 * useSessionOwnership - run state, hand-off reasons, dirtiness reporting
 * (RUNM-2 / RUNM-5 / RUNM-6).
 *
 * The ownership hook gains three responsibilities: it carries the holder's
 * announced run so a watcher can attach to it, it inherits silently when the
 * assistant releases gracefully and flips to watching without a dialog when a
 * clean idle tab auto-yields, and it reports this tab's draft dirtiness so the
 * server can decide whether an arriving assistant claim may take the slot.
 *
 * Hook under test:
 * frontend/src/features/workbench/hooks/use-session-ownership.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { ownershipApi, mockSubscribe, mockSend, mockConnect, handlerRef } = vi.hoisted(() => {
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

const RUN_WIRE = {
  session_id: 'run-session-1',
  test_id: 'test-1',
  test_name: 'Nightly Smoke',
  environment_id: 'env-1',
  environment_name: 'Staging',
  status: 'running',
}

const RUN_MAPPED = {
  sessionId: 'run-session-1',
  testId: 'test-1',
  testName: 'Nightly Smoke',
  environmentId: 'env-1',
  environmentName: 'Staging',
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
const HELD_BY_MCP = {
  holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' },
  you_are_holder: false,
  watchers: 0,
  pending_takeover: null,
  run: null,
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

function draftStateFrames(): Array<Record<string, unknown>> {
  return mockSend.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((frame) => frame.type === 'draft_state')
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

describe('useSessionOwnership - announced run state', () => {
  it('has no mirrored run when nothing is announced', async () => {
    const { result } = mount()
    await flush()

    expect(result.current.mirroredRun).toBeNull()
  })

  it('picks the run up from the initial ownership payload', async () => {
    ownershipApi.getOwnership.mockResolvedValue({ ...HELD_BY_MCP, run: RUN_WIRE })

    const { result } = mount()
    await flush()

    expect(result.current.mirroredRun).toEqual(RUN_MAPPED)
  })

  it('picks the run up from a run_state_changed event', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()

    emit({ event: 'run_state_changed', run: RUN_WIRE })

    expect(result.current.mirroredRun).toEqual(RUN_MAPPED)
  })

  it('clears the run when the announcement goes null', async () => {
    ownershipApi.getOwnership.mockResolvedValue({ ...HELD_BY_MCP, run: RUN_WIRE })
    const { result } = mount()
    await flush()

    emit({ event: 'run_state_changed', run: null })

    expect(result.current.mirroredRun).toBeNull()
  })

  it('tolerates a run with no environment recorded', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()

    emit({
      event: 'run_state_changed',
      run: { ...RUN_WIRE, environment_id: null, environment_name: null },
    })

    expect(result.current.mirroredRun).toMatchObject({
      environmentId: null,
      environmentName: null,
    })
  })

  it('replaces one announced run with the next', async () => {
    ownershipApi.getOwnership.mockResolvedValue({ ...HELD_BY_MCP, run: RUN_WIRE })
    const { result } = mount()
    await flush()

    emit({
      event: 'run_state_changed',
      run: { ...RUN_WIRE, session_id: 'run-session-2', test_name: 'Other Test' },
    })

    expect(result.current.mirroredRun).toMatchObject({
      sessionId: 'run-session-2',
      testName: 'Other Test',
    })
  })
})

describe('useSessionOwnership - graceful hand-back', () => {
  it('inherits silently when the assistant releases gracefully', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    emit({ event: 'holder_changed', holder: null, reason: 'handoff' })
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(result.current.takeoverResult).toBeNull()
  })

  it('detaches instead of inheriting when the holder disappears unexpectedly', async () => {
    // Nobody is promoted into a session they never asked for; the tab stays
    // read-only and offers to take it.
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()

    emit({ event: 'holder_changed', holder: null })
    await flush()

    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(true)
    expect(result.current.browsingAway).toBe(true)
    expect(result.current.takeoverResult).toBeNull()
  })
})

describe('useSessionOwnership - auto-yield', () => {
  it('flips a clean idle holder to watching with no dialog', async () => {
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    emit({
      event: 'holder_changed',
      holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' },
      reason: 'auto_yield',
    })

    expect(result.current.isMirroring).toBe(true)
    expect(result.current.takeoverResult).toBeNull()
    expect(result.current.holderKind).toBe('mcp')
  })

  it('still surfaces a forced take-over that carries no reason', async () => {
    const { result } = mount()
    await flush()

    emit({
      event: 'holder_changed',
      holder: { id: 'other', label: 'Ashley', kind: 'person' },
    })

    expect(result.current.isMirroring).toBe(true)
    expect(result.current.takeoverResult).toBe('forced')
  })

  it('clears any open approval prompt when it yields', async () => {
    const { result } = mount()
    await flush()
    emit({ event: 'takeover_requested', requester_label: 'Ashley' })
    expect(result.current.pendingTakeover).not.toBeNull()

    emit({
      event: 'holder_changed',
      holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' },
      reason: 'auto_yield',
    })

    expect(result.current.pendingTakeover).toBeNull()
  })
})

describe('useSessionOwnership - draft dirtiness reporting', () => {
  it('reports a clean draft the moment it becomes holder', async () => {
    mount()
    await flush()

    expect(draftStateFrames()).toEqual([
      { type: 'draft_state', holderId: expect.any(String), dirty: false },
    ])
  })

  it('reports the transition to a dirty draft', async () => {
    mount()
    await flush()
    mockSend.mockClear()

    act(() => {
      useWorkflowStore.getState().setDirty(true)
    })

    expect(draftStateFrames()).toEqual([
      { type: 'draft_state', holderId: expect.any(String), dirty: true },
    ])
  })

  it('reports the transition back to a clean draft', async () => {
    mount()
    await flush()
    act(() => {
      useWorkflowStore.getState().setDirty(true)
    })
    mockSend.mockClear()

    act(() => {
      useWorkflowStore.getState().setDirty(false)
    })

    expect(draftStateFrames()).toEqual([
      { type: 'draft_state', holderId: expect.any(String), dirty: false },
    ])
  })

  it('does not repeat the frame when nothing changed', async () => {
    mount()
    await flush()
    act(() => {
      useWorkflowStore.getState().setDirty(true)
    })
    mockSend.mockClear()

    act(() => {
      useWorkflowStore.getState().setDirty(true)
    })

    expect(draftStateFrames()).toEqual([])
  })

  it('never duplicates the frame under StrictMode double-invoked effects', async () => {
    const { StrictMode } = await import('react')
    renderHook(() => useSessionOwnership(), { wrapper: StrictMode })
    await flush()

    expect(draftStateFrames()).toEqual([
      { type: 'draft_state', holderId: expect.any(String), dirty: false },
    ])
  })

  it('a watcher never reports dirtiness - only the holder does', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    mount()
    await flush()
    mockSend.mockClear()

    act(() => {
      useWorkflowStore.getState().setDirty(true)
    })

    expect(draftStateFrames()).toEqual([])
  })
})
