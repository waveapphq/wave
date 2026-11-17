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

const { ownershipApi, mockSubscribe, mockSend, mockConnect, handlerRef, connection } = vi.hoisted(() => {
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
    connection: { isConnected: true },
  }
})

vi.mock('@/features/workbench/api/ownership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/api/ownership')>()),
  ownershipApi,
}))
vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: () => ({
    isConnected: connection.isConnected,
    subscribe: mockSubscribe,
    connect: mockConnect,
  }),
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
  connection.isConnected = true
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

describe("useSessionOwnership - a person takes the session over during an assistant's run", () => {
  const ASHLEY = { id: 'ashley-tab', label: 'Ashley', kind: 'person' }
  const ASSISTANT_RUNNING = { ...HELD_BY_MCP, run: RUN_WIRE }
  // The server still announces the run after the take-over: it goes on to its end.
  const ASHLEY_HOLDS = { ...HELD_BY_MCP, holder: ASHLEY, run: RUN_WIRE }

  async function watchAssistantRun() {
    ownershipApi.getOwnership.mockResolvedValue(ASSISTANT_RUNNING)
    const hook = mount()
    await flush()
    expect(hook.result.current.mirroredRun).toEqual(RUN_MAPPED)
    return hook
  }

  // A dropped socket re-reads the ownership on its way back.
  async function reconnect(rerender: () => void) {
    connection.isConnected = false
    rerender()
    connection.isConnected = true
    rerender()
    await flush()
  }

  it('a tab that watches on stops mirroring the run and watches the taker', async () => {
    const { result } = await watchAssistantRun()

    emit({ event: 'holder_changed', holder: ASHLEY })

    expect(result.current.mirroredRun).toBeNull()
    expect(result.current.isMirroring).toBe(true)
    expect(result.current.holderKind).toBe('person')
    expect(result.current.holderLabel).toBe('Ashley')
    expect(result.current.takeoverResult).toBeNull()
  })

  it('does not mirror that run again when a read after a reconnect still announces it', async () => {
    const { result, rerender } = await watchAssistantRun()
    emit({ event: 'holder_changed', holder: ASHLEY })
    ownershipApi.getOwnership.mockClear().mockResolvedValue(ASHLEY_HOLDS)

    await reconnect(rerender)

    expect(ownershipApi.getOwnership).toHaveBeenCalled()
    expect(result.current.holderLabel).toBe('Ashley')
    expect(result.current.mirroredRun).toBeNull()
  })

  it('stops mirroring the run when it learns of the take-over only from a read after a reconnect', async () => {
    const { result, rerender } = await watchAssistantRun()
    ownershipApi.getOwnership.mockResolvedValue(ASHLEY_HOLDS)

    await reconnect(rerender)

    expect(result.current.holderLabel).toBe('Ashley')
    expect(result.current.mirroredRun).toBeNull()
  })

  it('a tab that took the session over does not mirror the run once another person takes it from it', async () => {
    const { result } = await watchAssistantRun()
    ownershipApi.requestTakeover.mockResolvedValue({ outcome: 'granted', ...HOLDER_ME, run: RUN_WIRE })
    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.isHolder).toBe(true)

    emit({ event: 'holder_changed', holder: ASHLEY })

    expect(result.current.isMirroring).toBe(true)
    expect(result.current.mirroredRun).toBeNull()
  })

  it('mirrors the next run announced after that run ends', async () => {
    const { result } = await watchAssistantRun()
    emit({ event: 'holder_changed', holder: ASHLEY })
    emit({ event: 'run_state_changed', run: null })
    expect(result.current.mirroredRun).toBeNull()

    emit({ event: 'run_state_changed', run: { ...RUN_WIRE, session_id: 'run-session-2' } })

    expect(result.current.mirroredRun).toMatchObject({ sessionId: 'run-session-2' })
  })

  it("keeps mirroring a person's run when another person takes the session over", async () => {
    ownershipApi.getOwnership.mockResolvedValue({
      ...HELD_BY_MCP,
      holder: { id: 'other', label: 'Will', kind: 'person' },
      run: RUN_WIRE,
    })
    const { result } = mount()
    await flush()

    emit({ event: 'holder_changed', holder: ASHLEY })

    expect(result.current.mirroredRun).toEqual(RUN_MAPPED)
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
