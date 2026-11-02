/**
 * useSessionOwnership Hook Tests - Session Ownership & Live Mirroring.
 *
 * Contract: the hook mints a per-instance identity, claims the workbench draft
 * when free, mirrors when held, streams mirrored graphs over the draft topic,
 * heartbeats while holder, and drives the take-over protocol from both sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const {
  ownershipApi,
  mockSubscribe,
  mockUnsubscribe,
  mockSend,
  mockConnect,
  mockApply,
  mockSetMirrorActiveNodeId,
  mockSignalMirrorChange,
  mockSetDirty,
  mockSetEditingTest,
  mockStoreReset,
  mockRequestFitView,
  handlerRef,
} = vi.hoisted(() => {
  const handlerRef: { current: (payload: Record<string, unknown>, meta: unknown) => void } = { current: () => {} }
  const mockUnsubscribe = vi.fn()
  const mockSend = vi.fn()
  interface MockSubscription {
    topic: string
    unsubscribe: () => void
    send?: (message: Record<string, unknown>) => void
  }
  const mockSubscribe = vi.fn(
    (
      topic: string,
      handler: (payload: Record<string, unknown>, meta: unknown) => void,
    ): MockSubscription => {
      handlerRef.current = handler
      return { topic, unsubscribe: mockUnsubscribe, send: mockSend }
    },
  )
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
    mockUnsubscribe,
    mockSend,
    mockConnect: vi.fn().mockResolvedValue(undefined),
    mockApply: vi.fn(),
    mockSetMirrorActiveNodeId: vi.fn(),
    mockSignalMirrorChange: vi.fn(),
    mockSetDirty: vi.fn(),
    mockSetEditingTest: vi.fn(),
    mockStoreReset: vi.fn(),
    mockRequestFitView: vi.fn(),
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
vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: Object.assign(() => {}, {
    getState: () => ({
      applyMirroredGraph: mockApply,
      setMirrorActiveNodeId: mockSetMirrorActiveNodeId,
      signalMirrorChange: mockSignalMirrorChange,
      setDirty: mockSetDirty,
      setEditingTest: mockSetEditingTest,
      reset: mockStoreReset,
      requestFitView: mockRequestFitView,
      editingTestId: null,
      editingTestName: null,
    }),
  }),
}))

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

import { useSessionOwnership } from '@/features/workbench/hooks/use-session-ownership'
import { useWorkbenchSessionStore } from '@/features/workbench/stores/workbench-session-store'
import { usePageBlockStore } from '@/stores/page-block-store'
import { getSessionId } from '@/lib/session-identity'
import { storedLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'

const DRAFT_TOPIC = 'workbench:draft'
const HEARTBEAT_MS = 15000

const FREE = { holder: null, watchers: 0, pending_takeover: null }
const HOLDER_ME = {
  holder: { id: 'me', label: 'You', kind: 'person' },
  you_are_holder: true,
  watchers: 0,
  pending_takeover: null,
}
const HELD_BY_OTHER = {
  holder: { id: 'other', label: 'Ashley', kind: 'person' },
  you_are_holder: false,
  watchers: 0,
  pending_takeover: null,
}
const HELD_BY_MCP = {
  holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' },
  you_are_holder: false,
  mcp_session_id: 'mcp-sess',
  watchers: 0,
  pending_takeover: null,
}
const GRANTED = {
  outcome: 'granted',
  holder: { id: 'me', label: 'You', kind: 'person' },
  you_are_holder: true,
  watchers: 0,
  pending_takeover: null,
}
const AWAITING = {
  outcome: 'awaiting_approval',
  holder: { id: 'other', label: 'Ashley', kind: 'person' },
  watchers: 0,
  pending_takeover: { requester_label: 'You' },
}
const AWAITING_RELEASE = {
  outcome: 'awaiting_release',
  holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' },
  watchers: 0,
  pending_takeover: { requester_label: 'You' },
}

function mount() {
  return renderHook(() => useSessionOwnership())
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  handlerRef.current = () => {}
  ownershipApi.getOwnership.mockResolvedValue(FREE)
  ownershipApi.claim.mockResolvedValue(HOLDER_ME)
  ownershipApi.heartbeat.mockResolvedValue(undefined)
  ownershipApi.release.mockResolvedValue(undefined)
  ownershipApi.requestTakeover.mockResolvedValue(GRANTED)
  ownershipApi.approveTakeover.mockResolvedValue(HELD_BY_OTHER)
  ownershipApi.denyTakeover.mockResolvedValue(HOLDER_ME)
  ownershipApi.forceTakeover.mockResolvedValue(HOLDER_ME)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSessionOwnership - mount', () => {
  it('claims the session with a minted identity when it is free', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)

    const { result } = mount()
    await flush()

    expect(ownershipApi.getOwnership).toHaveBeenCalledWith(expect.any(String))
    expect(ownershipApi.claim).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    expect(result.current.isHolder).toBe(true)
    expect(result.current.isMirroring).toBe(false)
  })

  it('reflects an existing you_are_holder session without re-claiming', async () => {
    ownershipApi.getOwnership.mockResolvedValue({
      holder: { id: 'me', label: 'You', kind: 'person' },
      you_are_holder: true,
      watchers: 0,
      pending_takeover: null,
    })

    const { result } = mount()
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(result.current.isMirroring).toBe(false)
    expect(ownershipApi.claim).not.toHaveBeenCalled()
  })

  it('mirrors when the session is held by another person', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)

    const { result } = mount()
    await flush()

    expect(result.current.isMirroring).toBe(true)
    expect(result.current.isHolder).toBe(false)
    expect(result.current.holderLabel).toBe('Ashley')
    expect(result.current.holderKind).toBe('person')
    expect(ownershipApi.claim).not.toHaveBeenCalled()
    expect(mockSubscribe).toHaveBeenCalledWith(DRAFT_TOPIC, expect.any(Function))
  })

  it('mirrors an MCP holder and surfaces the mcp session id', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)

    const { result } = mount()
    await flush()

    expect(result.current.isMirroring).toBe(true)
    expect(result.current.holderKind).toBe('mcp')
    expect(result.current.mcpSessionId).toBe('mcp-sess')
    expect(result.current.holderLabel).toBe('Claude Code (MCP)')
  })

  it('falls through to mirroring when the claim conflicts (409)', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockRejectedValue(
      Object.assign(new Error('The workbench session is already held'), { status: 409 })
    )

    const { result } = mount()
    await flush()

    expect(ownershipApi.claim).toHaveBeenCalled()
    expect(result.current.isHolder).toBe(false)
  })
})

describe('useSessionOwnership - subscription', () => {
  it('subscribes exactly once to the draft topic', async () => {
    const { result } = mount()
    await flush()

    expect(result.current).toBeDefined()
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    expect(mockSubscribe).toHaveBeenCalledWith(DRAFT_TOPIC, expect.any(Function))
  })

  it('unsubscribes on unmount', async () => {
    const { unmount } = mount()
    await flush()

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalled()
  })
})

describe('useSessionOwnership - mirror events', () => {
  it('applies a draft_snapshot to the workflow store while mirroring', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'n1' }],
          edges: [],
          variables: [],
          from_holder_id: 'other',
        },
        {}
      )
    })

    expect(mockApply).toHaveBeenCalledWith({ nodes: [{ id: 'n1' }], edges: [], variables: [] })
  })

  it('normalizes an MCP build snapshot with keyed-object variables into the array shape', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    // A live MCP build streams variables as a backend keyed object, not the
    // frontend array a person holder sends. The mirror must normalize it (with
    // stable ids) before applying it, or the canvas throws "not iterable".
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'node-1' }],
          edges: [],
          variables: { built_marker: { type: 'string', value: 'watch-built' } },
          active_node_id: 'node-1',
          from_holder_id: 'mcp',
        },
        {}
      )
    })

    expect(mockApply).toHaveBeenCalledWith({
      nodes: [{ id: 'node-1' }],
      edges: [],
      variables: [
        { id: 'mirror-var-built_marker', name: 'built_marker', value: 'watch-built', type: 'string' },
      ],
    })
  })

  it('maps the stored Function locals of an MCP build snapshot to the canvas shape, secret flag kept', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)
    const storedBody = (variables: unknown[], nodes: unknown[] = []) => ({
      workflow: { nodes, edges: [] },
      inputs: [],
      outputs: [],
      variables,
    })
    const inner = {
      id: 'fn-inner',
      data: { nodeType: 'function', localDefinition: storedBody([{ name: 'depth', type: 'integer', value: 2 }]) },
    }
    const holder = {
      id: 'fn-1',
      data: {
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: storedBody(
          [
            { name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', secret: true },
            { name: 'greeting', type: 'string', value: 'Hi {{ who }}', isTemplate: true },
          ],
          [inner],
        ),
      },
    }

    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [holder],
          edges: [],
          variables: {},
          active_node_id: 'fn-1',
          from_holder_id: 'mcp-sess',
        },
        {},
      )
    })

    const applied = mockApply.mock.calls[0][0] as {
      nodes: Array<{ data: { localDefinition: { variables: unknown[]; workflow: { nodes: Array<{ data: { localDefinition: { variables: unknown[] } } }> } } } }>
    }
    const body = applied.nodes[0].data.localDefinition
    expect(body.variables).toEqual([
      { id: 'mirror-local-api_key', name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', isSecret: true },
      { id: 'mirror-local-greeting', name: 'greeting', type: 'string', value: 'Hi {{ who }}', isTemplate: true },
    ])
    expect(body.workflow.nodes[0].data.localDefinition.variables).toEqual([
      { id: 'mirror-local-depth', name: 'depth', type: 'integer', value: 2 },
    ])
    const saved = storedLocalFunctionBodies(applied.nodes)[0].data.localDefinition.variables
    expect(saved[0]).toEqual({ name: 'api_key', type: 'string', value: 'wave:enc:v1:c2VhbGVk', secret: true })
  })

  it('applies the Function locals a person holder streams as they are', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    mount()
    await flush()
    const canvasLocal = { id: 'var-token-1', name: 'token', type: 'string', value: 'x', isSecret: true }
    const holder = {
      id: 'fn-1',
      data: {
        nodeType: 'function',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [canvasLocal] },
      },
    }

    act(() => {
      handlerRef.current(
        { event: 'draft_snapshot', nodes: [holder], edges: [], variables: [], from_holder_id: 'other' },
        {},
      )
    })

    expect(mockApply).toHaveBeenCalledWith({ nodes: [holder], edges: [], variables: [] })
  })

  it('ignores a draft_snapshot while it is the holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      handlerRef.current(
        { event: 'draft_snapshot', nodes: [{ id: 'n1' }], edges: [], variables: [], from_holder_id: 'x' },
        {}
      )
    })

    expect(mockApply).not.toHaveBeenCalled()
  })

  it('never mirrors its own draft echoed back by the snapshot replay on a re-subscribe', async () => {
    // A holder's SPA nav back to the workbench re-subscribes while isHolder is
    // briefly false; the snapshot replay then echoes this tab's own cached draft. It
    // must be ignored, or applyMirroredGraph would clobber local edits + clear
    // isDirty, silently discarding unsaved work.
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)
    const ownId = ownershipApi.getOwnership.mock.calls[0][0] as string

    act(() => {
      handlerRef.current(
        { event: 'draft_snapshot', nodes: [{ id: 'n1' }], edges: [], variables: [], from_holder_id: ownId },
        {}
      )
    })

    expect(mockApply).not.toHaveBeenCalled()
  })

  it('updates the watcher count on watchers_changed', async () => {
    const { result } = mount()
    await flush()

    act(() => {
      handlerRef.current({ event: 'watchers_changed', count: 5 }, {})
    })

    expect(result.current.watchers).toBe(5)
  })
})

describe('useSessionOwnership - the holder disappears', () => {
  async function mountMirroringThenLoseHolder(reason?: string) {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const rendered = mount()
    await flush()
    expect(rendered.result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null, ...(reason ? { reason } : {}) }, {})
    })
    await flush()
    await flush()
    return rendered
  }

  it('never claims the freed slot', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    expect(ownershipApi.claim).not.toHaveBeenCalled()
    expect(result.current.isHolder).toBe(false)
  })

  it('keeps the canvas read-only', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    expect(result.current.isMirroring).toBe(true)
  })

  it('detaches: read-only but following nothing', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    expect(result.current.browsingAway).toBe(true)
  })

  it('forgets the holder there is no longer', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    expect(result.current.holderLabel).toBeNull()
    expect(result.current.holderKind).toBeNull()
    expect(result.current.browserSessionId).toBeNull()
    expect(result.current.mcpSessionId).toBeNull()
  })

  it('raises no notice at all', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    expect(result.current.takeoverResult).toBeNull()
  })

  it('drops the departed holder active-block cue and follow target', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'n1' }],
          edges: [],
          variables: [],
          active_node_id: 'n1',
          from_holder_id: 'other',
        },
        {},
      )
    })
    mockSetMirrorActiveNodeId.mockClear()
    mockSignalMirrorChange.mockClear()

    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null }, {})
    })
    await flush()

    expect(result.current.browsingAway).toBe(true)
    expect(mockSetMirrorActiveNodeId).toHaveBeenCalledWith(null)
    expect(mockSignalMirrorChange).toHaveBeenCalledWith(null)
  })

  it('never dirties the canvas it is left holding nothing of', async () => {
    await mountMirroringThenLoseHolder()

    expect(mockSetDirty).not.toHaveBeenCalled()
  })

  it('stays detached when somebody else takes the free session', async () => {
    const { result } = await mountMirroringThenLoseHolder()

    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: 'third', label: 'Will', kind: 'person' } },
        {},
      )
    })

    expect(result.current.browsingAway).toBe(true)
    expect(result.current.isMirroring).toBe(true)
    expect(result.current.holderLabel).toBe('Will')
  })

  it('rejoins only when asked, and then follows the new holder again', async () => {
    const { result } = await mountMirroringThenLoseHolder()
    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: 'third', label: 'Will', kind: 'person' } },
        {},
      )
    })

    act(() => {
      result.current.rejoinMirror()
    })

    expect(result.current.browsingAway).toBe(false)
  })

  it('clears detachment when this tab takes the free session', async () => {
    const { result } = await mountMirroringThenLoseHolder()
    ownershipApi.requestTakeover.mockResolvedValue(GRANTED)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isHolder).toBe(true)
    expect(result.current.browsingAway).toBe(false)
  })

  it('still takes the slot back on a graceful hand-back', async () => {
    const { result } = await mountMirroringThenLoseHolder('handoff')

    expect(ownershipApi.claim).toHaveBeenCalled()
    expect(result.current.isHolder).toBe(true)
    expect(result.current.isMirroring).toBe(false)
    expect(result.current.browsingAway).toBe(false)
    expect(result.current.takeoverResult).toBeNull()
  })

  it('mirrors the winner if it loses the race for a handed-back slot', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.claim.mockRejectedValueOnce(Object.assign(new Error('held'), { status: 409 }))

    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, {})
    })
    await flush()
    await flush()

    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(true)
  })
})

describe('useSessionOwnership - liveness', () => {
  it('never asserts liveness itself: the hold belongs to the tab, not the screen', async () => {
    // Liveness moved to the app-scoped continuity component, so a holder who
    // browses away from the Workbench keeps proving it is alive.
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      handlerRef.current({ event: 'watchers_changed', count: 1 }, {})
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
    })

    expect(ownershipApi.heartbeat).not.toHaveBeenCalled()
  })
})

/**
 * Holding outlives the Workbench screen, so the departure signal moved to
 * an application-scoped beacon. The hook's only job here is to publish the
 * role this tab currently plays; it announces nothing itself.
 */
describe('useSessionOwnership - publishing the session role', () => {
  beforeEach(() => {
    useWorkbenchSessionStore.setState({ isHolder: false, isWatching: false })
  })

  it('no longer announces departure itself', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/workbench/ownership/leaving'),
      expect.anything(),
    )
    vi.unstubAllGlobals()
  })

  it('publishes that this tab holds the session', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
  })

  it('publishes that this tab mirrors another holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    expect(useWorkbenchSessionStore.getState().isWatching).toBe(true)
    expect(useWorkbenchSessionStore.getState().isHolder).toBe(false)
  })

  it('keeps the published role after the Workbench screen unmounts', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result, unmount } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      unmount()
    })

    expect(useWorkbenchSessionStore.getState().isHolder).toBe(true)
  })
})

describe('useSessionOwnership - take-over (requester)', () => {
  it('takeOver requests and becomes holder when granted', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(GRANTED)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(ownershipApi.requestTakeover).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    expect(result.current.isHolder).toBe(true)
    expect(result.current.isRequestingTakeover).toBe(false)
  })

  it('takeOver keeps the requesting flag when awaiting approval', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isRequestingTakeover).toBe(true)
    expect(result.current.isHolder).toBe(false)
  })

  it('forceTakeOver forces the session and becomes holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.forceTakeover.mockResolvedValue(HOLDER_ME)

    await act(async () => {
      result.current.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(ownershipApi.forceTakeover).toHaveBeenCalledWith(expect.any(String), expect.any(String))
    expect(result.current.isHolder).toBe(true)
    expect(result.current.isRequestingTakeover).toBe(false)
  })

  it('cancelRequest retracts the request server-side, then clears the flag', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.cancelTakeover.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.isRequestingTakeover).toBe(true)

    await act(async () => {
      result.current.cancelRequest()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isRequestingTakeover).toBe(false)
    expect(ownershipApi.cancelTakeover).toHaveBeenCalledTimes(1)
  })

  it('does not present its own cancel as a denial', async () => {
    // The server retracts a request with the same `denied` event it refuses one
    // with, and broadcasts it before the cancel call answers.
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    let finishCancel!: (value: unknown) => void
    ownershipApi.cancelTakeover.mockReturnValue(
      new Promise((resolve) => {
        finishCancel = resolve
      }),
    )
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      result.current.cancelRequest()
    })
    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'denied',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })

    expect(result.current.takeoverResult).toBeNull()
    expect(result.current.isRequestingTakeover).toBe(false)

    await act(async () => {
      finishCancel(HELD_BY_OTHER)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.takeoverResult).toBeNull()

    // A fresh request is a fresh outcome: the next denial is shown.
    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'denied',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })
    expect(result.current.takeoverResult).toBe('denied')
  })

  it('shows the outcome again after a cancel that never landed', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.cancelTakeover.mockRejectedValue(new Error('server down'))
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      result.current.cancelRequest()
      await vi.advanceTimersByTimeAsync(0)
    })
    // Nothing was retracted, so the request is still live and still refusable.
    expect(result.current.isRequestingTakeover).toBe(true)

    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'denied',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })
    expect(result.current.takeoverResult).toBe('denied')
  })

  it('surfaces the granted result when the request is approved, then dismisses', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)
    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.isRequestingTakeover).toBe(true)

    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'granted',
          new_holder: { id: myMintedId(), label: 'Tab', kind: 'person' },
        },
        {}
      )
    })

    expect(result.current.takeoverResult).toBe('granted')
    expect(result.current.isRequestingTakeover).toBe(false)
    expect(result.current.isHolder).toBe(true)

    act(() => {
      result.current.dismissTakeoverResult()
    })
    expect(result.current.takeoverResult).toBeNull()
  })

  it('surfaces the denied result when the request is denied', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)
    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'denied',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })

    expect(result.current.takeoverResult).toBe('denied')
    expect(result.current.isRequestingTakeover).toBe(false)
    expect(result.current.isMirroring).toBe(true)
  })

  it('shows the granted outcome when the approval wins the race with a cancel', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    let failCancel!: (reason: unknown) => void
    ownershipApi.cancelTakeover.mockReturnValue(
      new Promise((_resolve, reject) => {
        failCancel = reject
      }),
    )
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      result.current.cancelRequest()
    })
    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'granted',
          new_holder: { id: myMintedId(), label: 'Tab', kind: 'person' },
        },
        {}
      )
    })

    // The approval won the race: this tab holds the session and is told so once.
    expect(result.current.takeoverResult).toBe('granted')
    expect(result.current.isHolder).toBe(true)
    expect(result.current.isRequestingTakeover).toBe(false)

    await act(async () => {
      failCancel(Object.assign(new Error('No pending take-over request'), { status: 404 }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockToastError).not.toHaveBeenCalled()
    expect(result.current.takeoverResult).toBe('granted')
  })

  it('stays silent when the cancel settles after its own denied echo', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    let failCancel!: (reason: unknown) => void
    ownershipApi.cancelTakeover.mockReturnValue(
      new Promise((_resolve, reject) => {
        failCancel = reject
      }),
    )
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      result.current.cancelRequest()
    })
    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'denied',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })

    expect(result.current.takeoverResult).toBeNull()

    await act(async () => {
      failCancel(Object.assign(new Error('No pending take-over request'), { status: 404 }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockToastError).not.toHaveBeenCalled()
    expect(result.current.isRequestingTakeover).toBe(false)
  })

  it('settles the waiting dialog without a toast when the cancel finds this tab already the holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    let failCancel!: (reason: unknown) => void
    ownershipApi.cancelTakeover.mockReturnValue(
      new Promise((_resolve, reject) => {
        failCancel = reject
      }),
    )
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      result.current.cancelRequest()
    })
    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: myMintedId(), label: 'Tab', kind: 'person' } },
        {}
      )
    })

    expect(result.current.isHolder).toBe(true)

    await act(async () => {
      failCancel(Object.assign(new Error('No pending take-over request'), { status: 404 }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(mockToastError).not.toHaveBeenCalled()
    expect(result.current.isRequestingTakeover).toBe(false)
  })
})

describe('useSessionOwnership - take-over (holder)', () => {
  it('sets pendingTakeover on takeover_requested while it is the holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })

    expect(result.current.pendingTakeover).toEqual({ requesterLabel: 'Ashley' })
  })

  it('approve hands over via the api and clears the pending request', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })
    expect(result.current.pendingTakeover).toEqual({ requesterLabel: 'Ashley' })
    ownershipApi.approveTakeover.mockResolvedValue(HELD_BY_OTHER)

    await act(async () => {
      result.current.approve()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(ownershipApi.approveTakeover).toHaveBeenCalledWith(expect.any(String))
    expect(result.current.pendingTakeover).toBeNull()
  })

  it('deny rejects via the api and clears the pending request', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })
    expect(result.current.pendingTakeover).toEqual({ requesterLabel: 'Ashley' })
    ownershipApi.denyTakeover.mockResolvedValue(HOLDER_ME)

    await act(async () => {
      result.current.deny()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(ownershipApi.denyTakeover).toHaveBeenCalledWith(expect.any(String))
    expect(result.current.pendingTakeover).toBeNull()
  })

  it('clears pending and recomputes on takeover_resolved', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })
    expect(result.current.pendingTakeover).not.toBeNull()

    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'granted',
          new_holder: { id: 'other', label: 'Ashley', kind: 'person' },
        },
        {}
      )
    })

    expect(result.current.pendingTakeover).toBeNull()
    expect(result.current.isMirroring).toBe(true)
    expect(result.current.isHolder).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Plumbing: identify frame, draft push, force detection,
// failure paths.
// ---------------------------------------------------------------------------

async function mountAsHolder() {
  ownershipApi.getOwnership.mockResolvedValue(FREE)
  ownershipApi.claim.mockResolvedValue(HOLDER_ME)
  const rendered = mount()
  await flush()
  expect(rendered.result.current.isHolder).toBe(true)
  return rendered
}

function myMintedId(): string {
  return ownershipApi.getOwnership.mock.calls[0][0] as string
}

describe('useSessionOwnership - identify + draft push', () => {
  it('identifies the tab on the draft socket at mount', async () => {
    mount()
    await flush()

    expect(mockSend).toHaveBeenCalledWith({
      type: 'identify',
      holderId: expect.any(String),
      pageId: expect.any(String),
      clientType: 'workbench',
    })
  })

  it('pushDraft sends a draft_update frame with the tab identity', async () => {
    const { result } = await mountAsHolder()
    mockSend.mockClear()

    act(() => {
      result.current.pushDraft({ nodes: [{ id: 'n1' }], edges: [], variables: [] } as never)
    })

    expect(mockSend).toHaveBeenCalledWith({
      type: 'draft_update',
      holderId: expect.any(String),
      snapshot: { nodes: [{ id: 'n1' }], edges: [], variables: [] },
    })
  })

  it('pushDraft after unmount is a no-op', async () => {
    const { result, unmount } = await mountAsHolder()
    unmount()
    mockSend.mockClear()

    act(() => {
      result.current.pushDraft({ nodes: [], edges: [], variables: [] } as never)
    })

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('tolerates a subscription without a send channel', async () => {
    mockSubscribe.mockImplementationOnce((topic, handler) => {
      handlerRef.current = handler
      return { topic, unsubscribe: mockUnsubscribe }
    })

    const { result } = mount()
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('useSessionOwnership - holder_changed transitions', () => {
  it('recognizes itself in a holder_changed event and becomes holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: myMintedId(), label: 'Tab', kind: 'person' } },
        {}
      )
    })

    expect(result.current.isHolder).toBe(true)
    expect(result.current.isMirroring).toBe(false)
    expect(result.current.takeoverResult).toBeNull()
  })

  it('forces out the holder: clears the pending approval and flags the forced result', async () => {
    const { result } = await mountAsHolder()

    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Tab 7f3a' }, {})
    })
    expect(result.current.pendingTakeover).not.toBeNull()

    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: 'other', label: 'Tab 7f3a', kind: 'person' } },
        {}
      )
    })

    expect(result.current.takeoverResult).toBe('forced')
    expect(result.current.pendingTakeover).toBeNull()
    expect(result.current.isMirroring).toBe(true)
    expect(result.current.isHolder).toBe(false)
  })

  it('does not flag its own claim echo as a forced take-over', async () => {
    const { result } = await mountAsHolder()

    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: myMintedId(), label: 'Tab', kind: 'person' } },
        {}
      )
    })

    expect(result.current.takeoverResult).toBeNull()
    expect(result.current.isHolder).toBe(true)
  })

  it('treats a release to idle while holder as not forced', async () => {
    const { result } = await mountAsHolder()

    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null }, {})
    })

    expect(result.current.takeoverResult).toBeNull()
    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(false)
  })

  it('ignores takeover_requested while mirroring', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })

    expect(result.current.pendingTakeover).toBeNull()
  })
})

describe('useSessionOwnership - failure paths', () => {
  it('reports and clears the requesting flag when the take-over request fails', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.requestTakeover.mockRejectedValue(
      Object.assign(new Error('A take-over request is already pending'), { status: 409 })
    )

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isRequestingTakeover).toBe(false)
    expect(result.current.isHolder).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith(
      'A take-over request is already pending',
      'Take Over Failed',
    )
  })

  it('reports and clears the requesting flag when the force call fails', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    ownershipApi.forceTakeover.mockRejectedValue(new Error('network'))

    await act(async () => {
      result.current.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isRequestingTakeover).toBe(false)
    expect(result.current.isHolder).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('network', 'Force Take Over Failed')
  })

  it('keeps the approval dialog open and reports when approve fails', async () => {
    const { result } = await mountAsHolder()
    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })
    ownershipApi.approveTakeover.mockRejectedValue(new Error('network'))

    await act(async () => {
      result.current.approve()
      await vi.advanceTimersByTimeAsync(0)
    })

    // The hand-over never landed, so the request is still on screen.
    expect(result.current.pendingTakeover).toEqual({ requesterLabel: 'Ashley' })
    expect(result.current.isHolder).toBe(true)
    expect(mockToastError).toHaveBeenCalledWith(
      'You are still the holder: network',
      'Hand Over Failed',
    )
  })

  it('keeps the approval dialog open and reports when deny fails', async () => {
    const { result } = await mountAsHolder()
    act(() => {
      handlerRef.current({ event: 'takeover_requested', requester_label: 'Ashley' }, {})
    })
    ownershipApi.denyTakeover.mockRejectedValue(new Error('network'))

    await act(async () => {
      result.current.deny()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.pendingTakeover).toEqual({ requesterLabel: 'Ashley' })
    expect(mockToastError).toHaveBeenCalledWith(
      'The request is still open: network',
      'Deny Failed',
    )
  })

  it('keeps the waiting dialog open and reports when the request cannot be withdrawn', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING)
    ownershipApi.cancelTakeover.mockRejectedValue(new Error('network'))
    const { result } = mount()
    await flush()

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.isRequestingTakeover).toBe(true)

    await act(async () => {
      result.current.cancelRequest()
      await vi.advanceTimersByTimeAsync(0)
    })

    // The holder can still approve it, so the tab keeps saying it is waiting.
    expect(result.current.isRequestingTakeover).toBe(true)
    expect(mockToastError).toHaveBeenCalledWith(
      'Your request is still open and can still be approved: network',
      'Cancel Failed',
    )
  })
})

// ---------------------------------------------------------------------------
// The ownership read is a read like any other: an editable canvas nobody
// registered as the holder is not this tab's, so a failed read blocks it.
// ---------------------------------------------------------------------------

describe('useSessionOwnership - a failed ownership read blocks the canvas', () => {
  beforeEach(() => {
    usePageBlockStore.setState({ block: null, retrying: false })
  })

  it('blocks the canvas instead of rendering it as this tab holds the session', async () => {
    ownershipApi.getOwnership.mockRejectedValue(new Error('Ownership API down'))
    const { result } = mount()
    await flush()

    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load workbench session')
    expect(block?.detail.message).toBe('Ownership API down')
    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(false)
  })

  it('blocks when the claim fails and the re-read fails too', async () => {
    ownershipApi.getOwnership
      .mockResolvedValueOnce(FREE)
      .mockRejectedValue(new Error('Ownership API down'))
    ownershipApi.claim.mockRejectedValue(Object.assign(new Error('held'), { status: 409 }))
    const { result } = mount()
    await flush()

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load workbench session')
    // The conflict was answered; the reason on the card is the fallback read's.
    expect(usePageBlockStore.getState().block?.detail.message).toBe('Ownership API down')
    expect(result.current.isHolder).toBe(false)
  })

  it('retry re-runs the read and clears the card', async () => {
    ownershipApi.getOwnership
      .mockRejectedValueOnce(new Error('Ownership API down'))
      .mockResolvedValue(FREE)
    const { result } = mount()
    await flush()
    expect(usePageBlockStore.getState().block).not.toBeNull()

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.isHolder).toBe(true)
  })

  it('keeps the card with the newest reason when the retry fails again', async () => {
    ownershipApi.getOwnership
      .mockRejectedValueOnce(new Error('Ownership API down'))
      .mockRejectedValueOnce(new Error('Still down'))
    mount()
    await flush()

    await act(async () => {
      await expect(usePageBlockStore.getState().block!.retry()).rejects.toThrow('Still down')
    })

    expect(usePageBlockStore.getState().block?.detail.message).toBe('Still down')
  })

  it('raises no card for a canvas that has already gone', async () => {
    let failRead: ((reason: unknown) => void) | null = null
    ownershipApi.getOwnership.mockImplementation(
      () => new Promise((_resolve, reject) => { failRead = reject })
    )
    const { unmount } = mount()
    await flush()
    unmount()

    await act(async () => {
      failRead!(new Error('Ownership API down'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(usePageBlockStore.getState().block).toBeNull()
  })

  it('blocks when the hand-back claim cannot be resolved', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    ownershipApi.claim.mockRejectedValue(Object.assign(new Error('held'), { status: 409 }))
    ownershipApi.getOwnership.mockRejectedValue(new Error('Ownership API down'))

    await act(async () => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, null)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(usePageBlockStore.getState().block?.title).toBe('Could not load workbench session')
  })

  it('clears the card once the hand-back claim lands', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()

    ownershipApi.claim.mockRejectedValueOnce(Object.assign(new Error('held'), { status: 409 }))
    ownershipApi.getOwnership.mockRejectedValueOnce(new Error('Ownership API down'))

    await act(async () => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, null)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(usePageBlockStore.getState().block).not.toBeNull()

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.isHolder).toBe(true)
  })

  it('blocks with the claim reason when the mount claim rejects without a conflict', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockRejectedValue(
      Object.assign(new Error('Ownership API down'), { status: 500 }),
    )
    const { result } = mount()
    await flush()

    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load workbench session')
    expect(block?.detail.message).toBe('Ownership API down')
    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(false)
    // A failure is never answered by the held-by-another fallback read.
    expect(ownershipApi.getOwnership).toHaveBeenCalledTimes(1)
  })

  it('treats a claim rejection with no status as a failure, not as held by another', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockRejectedValue(new Error('Failed to fetch'))
    const { result } = mount()
    await flush()

    expect(usePageBlockStore.getState().block?.detail.message).toBe('Failed to fetch')
    expect(result.current.isHolder).toBe(false)
    expect(result.current.isMirroring).toBe(false)
    expect(ownershipApi.getOwnership).toHaveBeenCalledTimes(1)
  })

  it('retry after a failed claim re-runs it and can land holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim
      .mockRejectedValueOnce(Object.assign(new Error('Ownership API down'), { status: 500 }))
      .mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(usePageBlockStore.getState().block).not.toBeNull()

    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(usePageBlockStore.getState().block).toBeNull()
    expect(result.current.isHolder).toBe(true)
  })

  it('blocks with the hand-back claim reason when the re-claim rejects without a conflict', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    ownershipApi.claim.mockRejectedValueOnce(
      Object.assign(new Error('Ownership API down'), { status: 500 }),
    )

    await act(async () => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, null)
      await vi.advanceTimersByTimeAsync(0)
    })

    const block = usePageBlockStore.getState().block
    expect(block?.title).toBe('Could not load workbench session')
    expect(block?.detail.message).toBe('Ownership API down')
    expect(result.current.isHolder).toBe(false)
    expect(ownershipApi.getOwnership).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Watch-mode build-up: mirror-active-node highlight forwarding and
// take-over-of-a-watch-built-draft dirtying (WATCH-5).
// ---------------------------------------------------------------------------

describe('useSessionOwnership - watch-mode active node', () => {
  it('forwards active_node_id to the mirror highlight while mirroring', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'n1' }],
          edges: [],
          variables: [],
          active_node_id: 'n1',
          from_holder_id: 'other',
        },
        {}
      )
    })

    expect(mockSetMirrorActiveNodeId).toHaveBeenCalledWith('n1')
    // MCP build: the follow target is the build's active node.
    expect(mockSignalMirrorChange).toHaveBeenCalledWith('n1')
  })

  it('diffs the snapshot stream for the follow target when no active_node_id (person watch)', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    // First snapshot seeds the baseline (no follow target on initial load).
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }],
          edges: [],
          variables: [],
          from_holder_id: 'other',
        },
        {}
      )
    })
    expect(mockSignalMirrorChange).toHaveBeenLastCalledWith(null)

    // Second snapshot moves block `a`: the diff makes it the follow target.
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'a', position: { x: 80, y: 0 }, data: {} }],
          edges: [],
          variables: [],
          from_holder_id: 'other',
        },
        {}
      )
    })
    expect(mockSignalMirrorChange).toHaveBeenLastCalledWith('a')
  })

  it('forwards null when the snapshot has no active_node_id', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'n1' }],
          edges: [],
          variables: [],
          from_holder_id: 'other',
        },
        {}
      )
    })

    expect(mockSetMirrorActiveNodeId).toHaveBeenCalledWith(null)
  })

  it('does not touch the mirror highlight while it is the holder', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)
    // becomeHolder clears the highlight during setup; assert the draft handler
    // itself adds none while holder.
    mockSetMirrorActiveNodeId.mockClear()

    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          nodes: [{ id: 'n1' }],
          edges: [],
          variables: [],
          active_node_id: 'n1',
          from_holder_id: 'x',
        },
        {}
      )
    })

    expect(mockSetMirrorActiveNodeId).not.toHaveBeenCalled()
  })
})

describe('useSessionOwnership - watch-mode take-over dirtying', () => {
  function emitSnapshot() {
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          from_holder_id: 'other',
          nodes: [{ id: 'streamed-1' }],
          edges: [],
          variables: [],
        },
        {},
      )
    })
  }

  it('marks the canvas dirty when it inherits a streamed mirrored draft', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)
    emitSnapshot()

    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, {})
    })
    await flush()
    await flush()

    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).toHaveBeenCalledWith(true)
    // Inheriting the draft drops the remote build's active-block border and
    // the Follow Changes target.
    expect(mockSetMirrorActiveNodeId).toHaveBeenCalledWith(null)
    expect(mockSignalMirrorChange).toHaveBeenCalledWith(null)
  })

  it('does not mark dirty on a fresh claim of a free slot', async () => {
    ownershipApi.getOwnership.mockResolvedValue(FREE)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isHolder).toBe(true)

    expect(mockSetDirty).not.toHaveBeenCalled()
  })

  it('marks the canvas dirty when taking over an MCP-held streamed draft', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)
    emitSnapshot()
    ownershipApi.requestTakeover.mockResolvedValue(GRANTED)

    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).toHaveBeenCalledWith(true)
  })

  /** One growing reveal frame of an assistant build: `count` blocks, unsaved. */
  function emitBuildFrame(count: number) {
    const nodes = Array.from({ length: count }, (_, index) => ({
      id: `built-${index + 1}`,
      position: { x: index * 120, y: 0 },
      data: { label: `Log ${index + 1}` },
    }))
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          from_holder_id: 'mcp-sess',
          nodes,
          edges: [],
          variables: [],
          test_id: null,
          test_name: null,
          dirty: true,
          active_node_id: `built-${count}`,
        },
        {},
      )
    })
  }

  it('marks the canvas dirty when the adopted build frames landed before the ownership read', async () => {
    // The build streams onto this canvas from the moment the topic is
    // subscribed, which is before the ownership read says who holds the slot.
    let settleOwnership: (value: unknown) => void = () => {}
    ownershipApi.getOwnership.mockReturnValue(
      new Promise((resolve) => {
        settleOwnership = resolve
      }),
    )
    const { result } = mount()
    emitBuildFrame(1)
    emitBuildFrame(2)
    await act(async () => {
      settleOwnership(HELD_BY_MCP)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.isMirroring).toBe(true)
    expect(mockApply).toHaveBeenCalled()

    // An assistant build holder has no approval step: the slot arrives when the
    // build abandons itself, and it streams no further frame on the way out.
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING_RELEASE)
    await act(async () => {
      result.current.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      handlerRef.current(
        {
          event: 'takeover_resolved',
          outcome: 'granted',
          new_holder: { id: getSessionId(), label: 'You', kind: 'person' },
        },
        {},
      )
    })
    await flush()

    // The taker holds blocks that are in no saved test: unsaved work.
    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).toHaveBeenCalledWith(true)
  })
})

describe('useSessionOwnership - inherit after a non-streamed borrow', () => {
  async function inheritAfterHandoff() {
    act(() => {
      handlerRef.current({ event: 'holder_changed', holder: null, reason: 'handoff' }, {})
    })
    await flush()
    await flush()
  }

  it('a run borrow inherits clean and keeps the painted canvas (no refresh)', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current(
        {
          event: 'run_state_changed',
          run: {
            session_id: 's1',
            test_id: 't1',
            test_name: 'T',
            environment_id: null,
            environment_name: null,
            status: 'running',
          },
        },
        {},
      )
    })
    act(() => {
      handlerRef.current({ event: 'run_state_changed', run: null }, {})
    })

    await inheritAfterHandoff()

    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).not.toHaveBeenCalled()
    expect(result.current.inheritRefreshTick).toBe(0)
  })

  it('a write-only borrow inherits clean and flags the open test for refresh', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    expect(result.current.isMirroring).toBe(true)

    await inheritAfterHandoff()

    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).not.toHaveBeenCalled()
    expect(result.current.inheritRefreshTick).toBe(1)
  })

  it('a saved-clean streamed surface inherits clean and bound to its test', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          from_holder_id: 'other',
          nodes: [{ id: 'built-1' }],
          edges: [],
          variables: [],
          test_id: 'test-9',
          test_name: 'Built Test',
          dirty: false,
        },
        {},
      )
    })
    expect(mockSetEditingTest).toHaveBeenCalledWith('test-9', 'Built Test')

    await inheritAfterHandoff()

    expect(result.current.isHolder).toBe(true)
    expect(mockSetDirty).not.toHaveBeenCalled()
    expect(result.current.inheritRefreshTick).toBe(0)
  })

  it('starts each borrow fresh: a streamed episode does not taint the next', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_OTHER)
    ownershipApi.claim.mockResolvedValue(HOLDER_ME)
    const { result } = mount()
    await flush()
    act(() => {
      handlerRef.current(
        {
          event: 'draft_snapshot',
          from_holder_id: 'other',
          nodes: [{ id: 'streamed-1' }],
          edges: [],
          variables: [],
        },
        {},
      )
    })
    await inheritAfterHandoff()
    expect(mockSetDirty).toHaveBeenCalledWith(true)
    expect(result.current.inheritRefreshTick).toBe(0)

    // Forced out into a second borrow that streams nothing, then handed back.
    act(() => {
      handlerRef.current(
        { event: 'holder_changed', holder: { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' } },
        {},
      )
    })
    await inheritAfterHandoff()

    expect(result.current.isHolder).toBe(true)
    expect(result.current.inheritRefreshTick).toBe(1)
  })
})
