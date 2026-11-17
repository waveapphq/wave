/**
 * useSessionOwnership - an assistant's watched change of a saved test, and the
 * hand back that ends it (WATCH-8, WATCH-9, RUNM-2, RUNM-6).
 *
 * A watched change streams a first step (staying Blocks at their final places,
 * removed Blocks gone, no target) and then one turn per added or changed Block.
 * Every frame carries the finished test's bounds and the kind of watched work.
 * The tab the session goes back to holds the saved test; every other tab keeps
 * watching it. A stream that drops midway frees the slot with no hand back, and
 * the tab that takes it holds the half-done work as unsaved and is told so.
 *
 * Runs on the real workflow store, with Follow Changes and the variable cue
 * mounted beside the hook, so the ring, the steady border, the view and the
 * saved state are read where the canvas reads them.
 *
 * Hook under test:
 * frontend/src/features/workbench/hooks/use-session-ownership.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act, screen } from '@testing-library/react'

const { ownershipApi, mockSubscribe, mockSend, mockConnect, handlerRef, mockFocusCurrentBlock } =
  vi.hoisted(() => {
    const handlerRef: { current: (payload: Record<string, unknown>) => void } = {
      current: () => {},
    }
    const mockSend = vi.fn()
    const mockSubscribe = vi.fn(
      (topic: string, handler: (payload: Record<string, unknown>) => void) => {
        handlerRef.current = handler
        return { topic, unsubscribe: vi.fn(), send: mockSend }
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
      mockSend,
      mockConnect: vi.fn().mockResolvedValue(undefined),
      handlerRef,
      mockFocusCurrentBlock: vi.fn(),
    }
  })

vi.mock('@/features/workbench/api/ownership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/api/ownership')>()),
  ownershipApi,
}))
vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: () => ({ isConnected: true, subscribe: mockSubscribe, connect: mockConnect }),
}))
vi.mock('@/features/workbench/lib/focus-current', () => ({
  focusCurrentBlock: (id: string) => mockFocusCurrentBlock(id),
}))
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const error = vi.fn()
  return {
    ...(await importOriginal<typeof import('@/components/ui/toast')>()),
    useToast: () => ({ error }),
  }
})

import {
  useWorkflowStore,
  type NodeType,
  type WorkflowVariable,
} from '@/features/workbench/stores/workflow-store'
import { useSessionOwnership } from '@/features/workbench/hooks/use-session-ownership'
import { useFollowChanges } from '@/features/workbench/hooks/use-follow-changes'
import { useMirrorVariablePulse } from '@/features/workbench/hooks/use-mirror-variable-pulse'
import { TakeOverResultDialog } from '@/features/workbench/common/canvas/chrome/take-over-result-dialog'
import { getSessionId } from '@/lib/session-identity'

const TAB_ID = getSessionId()
const ME = { id: TAB_ID, label: 'You', kind: 'person' }
const ASHLEY = { id: 'ashley-tab', label: 'Ashley', kind: 'person' }
const MCP = { id: 'mcp-sess', label: 'Claude Code (MCP)', kind: 'mcp' }

const FREE = { holder: null, watchers: 0, pending_takeover: null, run: null }
const HOLDER_ME = { holder: ME, you_are_holder: true, watchers: 0, pending_takeover: null, run: null }
const HELD_BY_ASHLEY = {
  holder: ASHLEY,
  you_are_holder: false,
  watchers: 1,
  pending_takeover: null,
  run: null,
}
const HELD_BY_MCP = { holder: MCP, you_are_holder: false, watchers: 1, pending_takeover: null, run: null }

const CHANGED_TEST = { test_id: 'test-7', test_name: 'Checkout Flow' }
const BOUNDS = { x: 0, y: 0, width: 240, height: 520 }
const NO_RECENT_CHANGES: Set<string> = new Set()

function block(id: string, y: number, label = id, config: Record<string, unknown> = {}): NodeType {
  return { id, type: 'log', position: { x: 0, y }, data: { label, config } } as unknown as NodeType
}

// The stored test: a, b, then r (removed by the change).
const STORED = [block('a', 0), block('b', 200, 'Old B', { message: 'old' }), block('r', 400)]
// The finished test: n inserted after a, b renamed with new settings, r gone.
const FINISHED = [block('a', 0), block('n', 200), block('b', 400, 'New B', { message: 'new' })]

const STEP_ONE = [block('a', 0), block('b', 400, 'Old B', { message: 'old' })]
const TURN_ADD = [block('a', 0), block('n', 200), block('b', 400, 'Old B', { message: 'old' })]

function changeFrame(nodes: NodeType[], activeNodeId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    event: 'draft_snapshot',
    from_holder_id: MCP.id,
    nodes,
    edges: [],
    variables: {},
    ...CHANGED_TEST,
    dirty: true,
    active_node_id: activeNodeId,
    final_bounds: BOUNDS,
    watch_kind: 'change',
    ...overrides,
  }
}

const stepOne = () => changeFrame(STEP_ONE, null)
const turnAdd = () => changeFrame(TURN_ADD, 'n')
const turnChange = () => changeFrame(FINISHED, 'b')
const savedFrame = () =>
  changeFrame(FINISHED, null, { dirty: false, final_bounds: null, watch_kind: null })

function mount() {
  return renderHook(() => {
    const ownership = useSessionOwnership()
    const follow = useFollowChanges(ownership.isMirroring)
    const pulsedVariables = useMirrorVariablePulse(ownership.isMirroring, NO_RECENT_CHANGES)
    return { ownership, follow, pulsedVariables }
  })
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

function emit(...payloads: Array<Record<string, unknown>>) {
  act(() => {
    for (const payload of payloads) handlerRef.current(payload)
  })
}

const handBackTo = (holder: Record<string, unknown> | null) => ({
  event: 'holder_changed',
  holder,
  reason: 'handoff',
})
const yieldTo = (holder: Record<string, unknown>) => ({
  event: 'holder_changed',
  holder,
  reason: 'auto_yield',
})

function store() {
  return useWorkflowStore.getState()
}

function ids(nodes: readonly { id: string }[]): string[] {
  return nodes.map((node) => node.id)
}

function labelOf(nodeId: string): unknown {
  return store().nodes.find((node) => node.id === nodeId)?.data.label
}

/** The tab has the stored test open and saved, as a load leaves it. */
function openSavedTest(
  identity: { id: string; name: string },
  nodes: NodeType[],
  variables: WorkflowVariable[] = [],
) {
  act(() => {
    store().setEditingTest(identity.id, identity.name)
    store().setNodeTree(nodes, { skipDirty: true })
    store().setVariables(variables)
    store().markSaved()
  })
}

/** This tab holds the session with the stored test open, clean. */
async function mountHoldingStoredTest() {
  const rendered = mount()
  await flush()
  expect(rendered.result.current.ownership.isHolder).toBe(true)
  openSavedTest({ id: CHANGED_TEST.test_id, name: CHANGED_TEST.test_name }, STORED)
  return rendered
}

/** Another tab (Ashley) holds the stored test; this tab watches it. */
async function mountWatchingAshley() {
  ownershipApi.getOwnership.mockResolvedValue(HELD_BY_ASHLEY)
  const rendered = mount()
  await flush()
  expect(rendered.result.current.ownership.isMirroring).toBe(true)
  emit({
    event: 'draft_snapshot',
    from_holder_id: ASHLEY.id,
    nodes: STORED,
    edges: [],
    variables: [],
    ...CHANGED_TEST,
    dirty: false,
  })
  return rendered
}

function sentFrames(type: string): Array<Record<string, unknown>> {
  return mockSend.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((frame) => frame.type === type)
}

// The store's own, for a spec that needs the canvas to see a fit of the view waiting.
const storeRequestFitView = useWorkflowStore.getState().requestFitView
const requestFitView = vi.fn()
const requestBringIntoView = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  handlerRef.current = () => {}
  useWorkflowStore.getState().reset()
  useWorkflowStore.setState({ requestFitView, requestBringIntoView })
  ownershipApi.getOwnership.mockResolvedValue(FREE)
  ownershipApi.claim.mockResolvedValue(HOLDER_ME)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSessionOwnership - the first step of a watched change', () => {
  it('rings no Block, even though every staying Block moved', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))
    const tickBefore = store().mirrorChangeTick

    emit(stepOne())

    expect(store().mirrorLastChangeNodeId).toBeNull()
    expect(store().mirrorChangeTick).toBe(tickBefore)
    expect(store().mirrorActiveNodeId).toBeNull()
  })

  it('frames the finished test and brings no Block into view', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0, bounds: BOUNDS })
    expect(requestBringIntoView).not.toHaveBeenCalled()
  })

  it('gives Follow Changes nothing to follow', async () => {
    const { result } = await mountWatchingAshley()
    act(() => result.current.follow.toggleFollow())
    emit(yieldTo(MCP))
    mockFocusCurrentBlock.mockClear()

    emit(stepOne())

    expect(mockFocusCurrentBlock).not.toHaveBeenCalled()
  })

  it('takes the removed Block away at once and brings the staying Blocks to their final places', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(ids(store().nodes)).toEqual(['a', 'b'])
    expect(labelOf('b')).toBe('Old B')
    // They glide there.
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(store().nodes[1].position).toEqual({ x: 0, y: 400 })
  })
})

describe('useSessionOwnership - the turns of a watched change', () => {
  async function watchUpToTurnAdd() {
    const rendered = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne(), turnAdd())
    return rendered
  }

  it("rings the turn's Block and gives it the steady border", async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())

    emit(turnAdd())

    expect(store().mirrorLastChangeNodeId).toBe('n')
    expect(store().mirrorActiveNodeId).toBe('n')
  })

  it("takes the turn's Block as the target even when other Blocks changed with it", async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    // b moved too, and it comes after n: the diff alone would pick b.
    emit(changeFrame(TURN_ADD, 'n'))

    expect(store().mirrorLastChangeNodeId).toBe('n')
  })

  it('a changed Block takes its final form, the steady border and the ring', async () => {
    await watchUpToTurnAdd()
    const tickBefore = store().mirrorChangeTick

    emit(turnChange())

    expect(labelOf('b')).toBe('New B')
    expect(store().mirrorActiveNodeId).toBe('b')
    expect(store().mirrorLastChangeNodeId).toBe('b')
    expect(store().mirrorChangeTick).toBe(tickBefore + 1)
  })

  it('Follow Changes re-centers on the changed Block', async () => {
    const { result } = await watchUpToTurnAdd()
    act(() => result.current.follow.toggleFollow())
    mockFocusCurrentBlock.mockClear()

    emit(turnChange())

    expect(mockFocusCurrentBlock).toHaveBeenCalledWith('b')
  })

  it("keeps a turn's Block in view without reframing the finished test", async () => {
    await watchUpToTurnAdd()
    requestFitView.mockClear()

    emit(turnChange())

    expect(requestBringIntoView).toHaveBeenLastCalledWith('b')
    expect(requestFitView).not.toHaveBeenCalled()
  })
})

describe('useSessionOwnership - the kind of watched work', () => {
  it('reads a watched change from its frames', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(result.current.ownership.watchKind).toBe('change')
  })

  it('reads a watched build from its frames', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(changeFrame([block('a', 0)], 'a', { test_id: null, test_name: null, watch_kind: 'build' }))

    expect(result.current.ownership.watchKind).toBe('build')
  })

  it('names no kind for a person holder', async () => {
    const { result } = await mountWatchingAshley()

    expect(result.current.ownership.watchKind).toBeNull()
  })

  it('still reads a watched change on its saved last frame, until the session is handed back', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne(), turnAdd(), turnChange())

    emit(savedFrame())
    expect(result.current.ownership.watchKind).toBe('change')

    emit(handBackTo(ASHLEY))
    expect(result.current.ownership.watchKind).toBeNull()
  })

  it('a tab that joins mid-change reads the change from the cached frame, before it knows who holds', async () => {
    let settleOwnership: (value: unknown) => void = () => {}
    ownershipApi.getOwnership.mockReturnValue(
      new Promise((resolve) => {
        settleOwnership = resolve
      }),
    )
    const { result } = mount()

    emit(turnAdd())
    await act(async () => {
      settleOwnership(HELD_BY_MCP)
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.ownership.isMirroring).toBe(true)
    expect(result.current.ownership.watchKind).toBe('change')
  })

  it('a watcher that browsed away reads the change again when it rejoins', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP))
    act(() => result.current.ownership.browseAway())
    emit(stepOne(), turnAdd())

    act(() => result.current.ownership.rejoinMirror())

    expect(result.current.ownership.watchKind).toBe('change')
  })
})

describe('useSessionOwnership - a tab that joins a watched change midway', () => {
  it('frames the finished test, then follows the next turn', async () => {
    ownershipApi.getOwnership.mockResolvedValue(HELD_BY_MCP)
    const { result } = mount()
    emit(turnAdd())
    await flush()
    expect(requestFitView).toHaveBeenCalledWith({ padding: 0.2, duration: 0, bounds: BOUNDS })
    expect(result.current.ownership.watchKind).toBe('change')

    emit(turnChange())

    expect(store().mirrorActiveNodeId).toBe('b')
    expect(store().mirrorLastChangeNodeId).toBe('b')
    expect(requestBringIntoView).toHaveBeenLastCalledWith('b')
  })
})

describe('useSessionOwnership - the session handed back to the tab that gave way', () => {
  async function changeWatchedByTheTabThatGaveWay() {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP))
    expect(rendered.result.current.ownership.isMirroring).toBe(true)
    emit(stepOne(), turnAdd(), turnChange(), savedFrame())
    return rendered
  }

  it('holds the session again, with no dialog and no new claim', async () => {
    const { result } = await changeWatchedByTheTabThatGaveWay()
    ownershipApi.claim.mockClear()

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.isMirroring).toBe(false)
    expect(result.current.ownership.takeoverResult).toBeNull()
    expect(ownershipApi.claim).not.toHaveBeenCalled()
  })

  it('keeps the saved test it was shown, clean, with no reload', async () => {
    const { result } = await changeWatchedByTheTabThatGaveWay()

    emit(handBackTo(ME))

    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(labelOf('b')).toBe('New B')
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
    expect(store().isDirty).toBe(false)
    expect(result.current.ownership.inheritRefreshTick).toBe(0)
  })

  it('drops the steady border, the follow target and the build framing', async () => {
    await changeWatchedByTheTabThatGaveWay()

    emit(handBackTo(ME))

    expect(store().mirrorActiveNodeId).toBeNull()
    expect(store().mirrorLastChangeNodeId).toBeNull()
    expect(store().mirrorBuildBounds).toBeNull()
  })

  it('reports a clean draft, so the next assistant claim can take the slot', async () => {
    await changeWatchedByTheTabThatGaveWay()
    mockSend.mockClear()

    emit(handBackTo(ME))

    expect(sentFrames('draft_state')).toEqual([
      { type: 'draft_state', holderId: TAB_ID, dirty: false },
    ])
  })

  it('takes the saved test as what it has saved: an undo never brings back the test from before the change', async () => {
    await changeWatchedByTheTabThatGaveWay()
    emit(handBackTo(ME))

    expect(ids(store().getSavedNodes())).toEqual(ids(FINISHED))
    act(() => {
      store().addNode(block('extra', 600))
    })
    act(() => {
      store().undo()
    })

    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
  })

  it('ends holding the changed test when it had another test open', async () => {
    const { result } = mount()
    await flush()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    emit(yieldTo(MCP), stepOne())
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
    emit(turnAdd(), turnChange(), savedFrame())

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
    expect(store().editingTestName).toBe(CHANGED_TEST.test_name)
    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(ids(store().getSavedNodes())).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
    expect(result.current.ownership.inheritRefreshTick).toBe(0)
  })

  it('settles a fast amend that yields and hands back before a render: the open test is re-read', async () => {
    const { result } = await mountHoldingStoredTest()

    emit(yieldTo(MCP), handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })

  it("re-reads the open test after a fast amend even when this tab ran the test earlier", async () => {
    const { result } = await mountHoldingStoredTest()
    const run = {
      session_id: 'run-own',
      test_id: CHANGED_TEST.test_id,
      test_name: CHANGED_TEST.test_name,
      environment_id: null,
      environment_name: null,
      status: 'running',
    }
    emit({ event: 'run_state_changed', run }, { event: 'run_state_changed', run: null })
    emit(yieldTo(MCP))

    emit(handBackTo(ME))

    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })
})

describe('useSessionOwnership - every other tab after the hand back', () => {
  async function watchChangeOfAshleysTest() {
    const rendered = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne(), turnAdd(), turnChange(), savedFrame())
    return rendered
  }

  it('keeps watching the tab the session went back to, and never claims', async () => {
    const { result } = await watchChangeOfAshleysTest()

    emit(handBackTo(ASHLEY))
    await flush()

    expect(ownershipApi.claim).not.toHaveBeenCalled()
    expect(result.current.ownership.isHolder).toBe(false)
    expect(result.current.ownership.isMirroring).toBe(true)
    expect(result.current.ownership.browsingAway).toBe(false)
    expect(result.current.ownership.holderKind).toBe('person')
    expect(result.current.ownership.holderLabel).toBe('Ashley')
  })

  it('keeps the saved test on screen until the holder streams again', async () => {
    await watchChangeOfAshleysTest()

    emit(handBackTo(ASHLEY))

    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
  })

  it('claims the freed slot as before when the tab that gave way has closed', async () => {
    const { result } = await watchChangeOfAshleysTest()

    emit(handBackTo(null))
    await flush()
    await flush()

    expect(ownershipApi.claim).toHaveBeenCalledTimes(1)
    expect(result.current.ownership.isHolder).toBe(true)
    expect(store().isDirty).toBe(false)
    expect(result.current.ownership.inheritRefreshTick).toBe(0)
  })

  it('claims the freed slot when a fast amend yields and frees it before a render', async () => {
    const { result } = await mountHoldingStoredTest()

    emit(yieldTo(MCP), handBackTo(null))
    await flush()
    await flush()

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })
})

describe('useSessionOwnership - a tab browsing on its own when the session is handed back', () => {
  /** This tab gives way, sees the first step, then browses away while the change goes on. */
  async function giveWayThenBrowse() {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne())
    act(() => rendered.result.current.ownership.browseAway())
    return rendered
  }

  function finishChange() {
    emit(turnAdd(), turnChange(), savedFrame())
  }

  it('re-reads the changed test it opened before the save, so it never holds the version from before the change', async () => {
    const { result } = await giveWayThenBrowse()
    openSavedTest({ id: CHANGED_TEST.test_id, name: CHANGED_TEST.test_name }, STORED)
    finishChange()

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.browsingAway).toBe(false)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })

  it('re-reads the other test it browsed to, and stays on it', async () => {
    const { result } = await giveWayThenBrowse()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    finishChange()

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
    expect(store().editingTestId).toBe('test-login')
    expect(ids(store().nodes)).toEqual(['login-1'])
    expect(store().isDirty).toBe(false)
  })

  it('holds the new draft it browsed to, clean, with no test to re-read', async () => {
    const { result } = await giveWayThenBrowse()
    act(() => store().reset())
    finishChange()

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
    expect(store().editingTestId).toBeNull()
    expect(store().nodes).toEqual([])
    expect(store().isDirty).toBe(false)
  })

  it('re-reads the changed test when it wins the freed slot after a hand back that names nobody', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    act(() => result.current.ownership.browseAway())
    openSavedTest({ id: CHANGED_TEST.test_id, name: CHANGED_TEST.test_name }, STORED)
    finishChange()

    emit(handBackTo(null))
    await flush()
    await flush()

    expect(ownershipApi.claim).toHaveBeenCalledTimes(1)
    expect(result.current.ownership.isHolder).toBe(true)
    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })

  it('re-reads its open test after a fast amend it did not watch', async () => {
    const { result } = await mountHoldingStoredTest()
    emit(yieldTo(MCP))
    act(() => result.current.ownership.browseAway())

    emit(handBackTo(ME))

    expect(result.current.ownership.inheritRefreshTick).toBe(1)
  })
})

describe('useSessionOwnership - a watched change that only changes a variable', () => {
  it('shows the new value in the first step, rings no Block, and ends saved', async () => {
    const { result } = mount()
    await flush()
    openSavedTest({ id: CHANGED_TEST.test_id, name: CHANGED_TEST.test_name }, STORED, [
      { id: 'var-host', name: 'host', value: 'old.example', type: 'string' } as WorkflowVariable,
      { id: 'var-port', name: 'port', value: 80, type: 'integer' } as WorkflowVariable,
    ])
    emit(yieldTo(MCP))
    const variables = {
      host: { type: 'string', value: 'new.example' },
      port: { type: 'integer', value: 80 },
    }

    emit(changeFrame(STORED, null, { variables }))

    expect(store().variables.find((variable) => variable.name === 'host')?.value).toBe('new.example')
    expect([...result.current.pulsedVariables]).toEqual(['host'])
    expect(store().mirrorLastChangeNodeId).toBeNull()
    expect(requestBringIntoView).not.toHaveBeenCalled()

    emit(changeFrame(STORED, null, { variables, dirty: false, final_bounds: null, watch_kind: null }))
    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(store().isDirty).toBe(false)
    expect(store().getSavedVariables().find((variable) => variable.name === 'host')?.value).toBe(
      'new.example',
    )
  })
})

describe('useSessionOwnership - the tab that gave way while the change streams', () => {
  it('sends nothing back, and whatever it held mid-stream gives way to the saved test', async () => {
    await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne())
    mockSend.mockClear()

    // Anything that reaches the store mid-stream (the canvas is read-only).
    act(() => {
      store().setNodeTree([...STEP_ONE, block('typed', 800)])
    })
    expect(store().isDirty).toBe(true)
    emit(turnAdd(), turnChange(), savedFrame())

    expect(sentFrames('draft_update')).toEqual([])
    expect(sentFrames('draft_state')).toEqual([])

    emit(handBackTo(ME))

    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
  })
})

describe('useSessionOwnership - undo never reaches past the surface a tab takes over', () => {
  const AWAITING_RELEASE = {
    outcome: 'awaiting_release',
    holder: MCP,
    watchers: 1,
    pending_takeover: { requester_label: 'You' },
  }

  /** This tab has Login open and saved, gives way, and watches half of a change of another test. */
  async function watchHalfAChangeAfterLogin() {
    const rendered = mount()
    await flush()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    emit(yieldTo(MCP), stepOne(), turnAdd())
    return rendered
  }

  function editThenUndo() {
    act(() => {
      store().addNode(block('extra', 600))
    })
    act(() => {
      store().undo()
    })
  }

  function expectHalfDoneChangeStillUnsaved() {
    expect(ids(store().nodes)).toEqual(ids(TURN_ADD))
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
    expect(store().isDirty).toBe(true)
  }

  it('a forced take-over mid-change: an edit plus undo returns to the change as taken over, still unsaved', async () => {
    const { result } = await watchHalfAChangeAfterLogin()
    ownershipApi.forceTakeover.mockResolvedValue(HOLDER_ME)

    await act(async () => {
      result.current.ownership.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.ownership.isHolder).toBe(true)
    editThenUndo()

    expectHalfDoneChangeStillUnsaved()
  })

  it('a take-over the assistant grants mid-change: an edit plus undo returns to the change as taken over', async () => {
    const { result } = await watchHalfAChangeAfterLogin()
    ownershipApi.requestTakeover.mockResolvedValue(AWAITING_RELEASE)
    await act(async () => {
      result.current.ownership.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    emit({ event: 'takeover_resolved', outcome: 'granted', new_holder: ME })
    expect(result.current.ownership.isHolder).toBe(true)
    editThenUndo()

    expectHalfDoneChangeStillUnsaved()
  })

  it('a hand back of a stream that ended unsaved: an edit plus undo returns to the stream, still unsaved', async () => {
    const { result } = await watchHalfAChangeAfterLogin()

    emit(handBackTo(ME))
    expect(result.current.ownership.isHolder).toBe(true)
    editThenUndo()

    expectHalfDoneChangeStillUnsaved()
  })

  it('while it watches, a tab cannot redo its own earlier edit over the mirrored test', async () => {
    mount()
    await flush()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    act(() => {
      store().addNode(block('login-2', 200))
    })
    act(() => {
      store().undo()
    })
    expect(store().canRedo()).toBe(true)

    emit(yieldTo(MCP), stepOne())

    expect(store().canUndo()).toBe(false)
    expect(store().canRedo()).toBe(false)
    act(() => {
      store().redo()
    })
    expect(ids(store().nodes)).toEqual(ids(STEP_ONE))
  })

  it('a holder forced out cannot undo its own edits over the test it now watches', async () => {
    mount()
    await flush()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    act(() => {
      store().addNode(block('login-2', 200))
    })
    expect(store().canUndo()).toBe(true)

    emit({ event: 'holder_changed', holder: ASHLEY })
    emit({
      event: 'draft_snapshot',
      from_holder_id: ASHLEY.id,
      nodes: STORED,
      edges: [],
      variables: [],
      ...CHANGED_TEST,
      dirty: true,
    })

    expect(store().canUndo()).toBe(false)
    act(() => {
      store().undo()
    })
    expect(ids(store().nodes)).toEqual(ids(STORED))
  })
})

describe('useSessionOwnership - a stream that drops midway, then a tab takes the freed slot', () => {
  const GRANTED_FREE_SLOT = {
    outcome: 'granted',
    holder: ME,
    you_are_holder: true,
    watchers: 1,
    pending_takeover: null,
    run: null,
  }
  const BUILD_START = [block('a', 0)]
  const BUILD_HALF = [block('a', 0), block('n', 200)]

  // The assistant dropped: the slot frees with no hand back and no reason.
  const holderLost = () => ({ event: 'holder_changed', holder: null })

  function buildFrame(nodes: NodeType[], activeNodeId: string) {
    return changeFrame(nodes, activeNodeId, { test_id: null, test_name: null, watch_kind: 'build' })
  }

  type Rendered = Awaited<ReturnType<typeof mountHoldingStoredTest>>

  /** Take Session from the banner. The server's event lands before its answer, as it usually does. */
  async function takeSession({ result }: Rendered, { answerFirst = false } = {}) {
    ownershipApi.requestTakeover.mockImplementation(async () => {
      if (!answerFirst) handlerRef.current({ event: 'holder_changed', holder: ME })
      return GRANTED_FREE_SLOT
    })
    await act(async () => {
      result.current.ownership.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    if (answerFirst) emit({ event: 'holder_changed', holder: ME })
    expect(result.current.ownership.isHolder).toBe(true)
  }

  /** This tab gives way and watches half of the change, then the assistant drops. */
  async function dropMidChange() {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne(), turnAdd(), holderLost())
    return rendered
  }

  function expectHalfDoneChangeHeldUnsaved() {
    expect(ids(store().nodes)).toEqual(ids(TURN_ADD))
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
    expect(store().isDirty).toBe(true)
  }

  const AWAITING_RELEASE = {
    outcome: 'awaiting_release',
    holder: MCP,
    watchers: 1,
    pending_takeover: { requester_label: 'You' },
  }
  const AWAITING_APPROVAL = {
    outcome: 'awaiting_approval',
    holder: ASHLEY,
    watchers: 1,
    pending_takeover: { requester_label: 'You' },
  }
  const requestGranted = () => [
    { event: 'takeover_resolved', outcome: 'granted', new_holder: ME },
    { event: 'holder_changed', holder: ME },
  ]

  /** Take Session while the holder is still there: the request waits. */
  async function requestWhileHeld({ result }: Rendered, waiting: Record<string, unknown>) {
    ownershipApi.requestTakeover.mockResolvedValue(waiting)
    await act(async () => {
      result.current.ownership.takeOver()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.ownership.isRequestingTakeover).toBe(true)
  }

  /** The notice the workbench shows this tab for its outcome. */
  function noticeOf({ result }: Rendered) {
    const outcome = result.current.ownership.takeoverResult
    expect(outcome).not.toBeNull()
    render(<TakeOverResultDialog open outcome={outcome ?? 'denied'} onClose={() => {}} />)
    return screen.getByRole('alertdialog')
  }

  it('the tab that gave way detaches with the half-done change on screen, and no notice yet', async () => {
    const { result } = await dropMidChange()
    await flush()

    expect(ownershipApi.claim).toHaveBeenCalledTimes(1)
    expect(result.current.ownership.isHolder).toBe(false)
    expect(result.current.ownership.isMirroring).toBe(true)
    expect(result.current.ownership.browsingAway).toBe(true)
    expect(result.current.ownership.takeoverResult).toBeNull()
    expect(ids(store().nodes)).toEqual(ids(TURN_ADD))
    expect(store().editingTestId).toBe(CHANGED_TEST.test_id)
  })

  it('the tab that gave way takes the freed slot and holds the half-done change as unsaved work', async () => {
    const rendered = await dropMidChange()

    await takeSession(rendered)

    expectHalfDoneChangeHeldUnsaved()
    expect(sentFrames('draft_state').at(-1)).toMatchObject({ dirty: true })
  })

  it('the tab that takes the freed slot is told it now holds the session', async () => {
    const rendered = await dropMidChange()

    await takeSession(rendered)

    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
  })

  it('the notice it gets leaves out that the previous holder is watching', async () => {
    const rendered = await dropMidChange()

    await takeSession(rendered)

    const notice = noticeOf(rendered)
    expect(notice).toHaveTextContent('You now hold the session')
    expect(notice).not.toHaveTextContent(/watching/)
  })

  it('a take-over waiting when the stream drops is granted, and its notice leaves out that the previous holder is watching', async () => {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne(), turnAdd())
    await requestWhileHeld(rendered, AWAITING_RELEASE)

    // The server grants the waiting request when the assistant drops.
    emit(...requestGranted())

    expect(rendered.result.current.ownership.isHolder).toBe(true)
    expectHalfDoneChangeHeldUnsaved()
    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
    expect(noticeOf(rendered)).not.toHaveTextContent(/watching/)
  })

  it('with nothing dropped, a take-over the person holder approves keeps the notice that the previous holder is watching', async () => {
    const rendered = await mountWatchingAshley()
    await requestWhileHeld(rendered, AWAITING_APPROVAL)

    emit(...requestGranted())

    expect(rendered.result.current.ownership.isHolder).toBe(true)
    expect(rendered.result.current.ownership.takeoverResult).toBe('granted')
    expect(noticeOf(rendered)).toHaveTextContent(
      'You are now editing this draft; the previous holder is watching.',
    )
  })

  it('an edit plus undo returns to the half-done change, still unsaved', async () => {
    const rendered = await dropMidChange()
    await takeSession(rendered)

    act(() => {
      store().addNode(block('extra', 600))
    })
    act(() => {
      store().undo()
    })

    expectHalfDoneChangeHeldUnsaved()
  })

  it('holds and announces it the same way when the answer to its take arrives before the event', async () => {
    const rendered = await dropMidChange()

    await takeSession(rendered, { answerFirst: true })

    expectHalfDoneChangeHeldUnsaved()
    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
  })

  it('a forced take-over of the freed slot holds and announces it the same way', async () => {
    const { result } = await dropMidChange()
    ownershipApi.forceTakeover.mockImplementation(async () => {
      handlerRef.current({ event: 'holder_changed', holder: ME })
      return HOLDER_ME
    })

    await act(async () => {
      result.current.ownership.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.ownership.isHolder).toBe(true)
    expectHalfDoneChangeHeldUnsaved()
    expect(result.current.ownership.takeoverResult).toBe('inherited')
  })

  it('another tab that watched the change takes the freed slot the same way', async () => {
    const rendered = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne(), turnAdd(), holderLost())

    await takeSession(rendered)

    expectHalfDoneChangeHeldUnsaved()
    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
  })

  it('a dropped build is taken as an unsaved draft with no test bound, and announced', async () => {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP), buildFrame(BUILD_START, 'a'), buildFrame(BUILD_HALF, 'n'), holderLost())

    await takeSession(rendered)

    expect(ids(store().nodes)).toEqual(ids(BUILD_HALF))
    expect(store().editingTestId).toBeNull()
    expect(store().isDirty).toBe(true)
    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
  })

  it("a person holder lost the same way: the tab that takes the slot holds their unsaved work as unsaved, and is told", async () => {
    const rendered = await mountWatchingAshley()
    emit(
      {
        event: 'draft_snapshot',
        from_holder_id: ASHLEY.id,
        nodes: TURN_ADD,
        edges: [],
        variables: [],
        ...CHANGED_TEST,
        dirty: true,
      },
      holderLost(),
    )

    await takeSession(rendered)

    expectHalfDoneChangeHeldUnsaved()
    expect(rendered.result.current.ownership.takeoverResult).toBe('inherited')
  })

  it('a tab that opened another test after the drop takes the slot with that test, clean, and no notice', async () => {
    const rendered = await dropMidChange()
    act(() => rendered.result.current.ownership.browseAway())
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])

    await takeSession(rendered)

    expect(store().editingTestId).toBe('test-login')
    expect(ids(store().nodes)).toEqual(['login-1'])
    expect(store().isDirty).toBe(false)
    expect(rendered.result.current.ownership.takeoverResult).toBeNull()
  })

  it('a tab browsing on its own when the stream drops takes the slot with what it browsed, clean, and no notice', async () => {
    const rendered = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne())
    act(() => rendered.result.current.ownership.browseAway())
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('login-1', 0)])
    emit(turnAdd(), holderLost())

    await takeSession(rendered)

    expect(store().editingTestId).toBe('test-login')
    expect(store().isDirty).toBe(false)
    expect(rendered.result.current.ownership.takeoverResult).toBeNull()
  })

  it('after another tab took the freed slot and this tab watched it, a forced take-over from that tab is silent', async () => {
    const { result } = await dropMidChange()
    const WILL = { id: 'will-tab', label: 'Will', kind: 'person' }
    emit({ event: 'holder_changed', holder: WILL })
    act(() => result.current.ownership.rejoinMirror())
    emit({
      event: 'draft_snapshot',
      from_holder_id: WILL.id,
      nodes: TURN_ADD,
      edges: [],
      variables: [],
      ...CHANGED_TEST,
      dirty: true,
    })
    ownershipApi.forceTakeover.mockImplementation(async () => {
      handlerRef.current({ event: 'holder_changed', holder: ME })
      return HOLDER_ME
    })

    await act(async () => {
      result.current.ownership.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.ownership.isHolder).toBe(true)
    expectHalfDoneChangeHeldUnsaved()
    expect(result.current.ownership.takeoverResult).toBeNull()
  })

  it('a stream handed back unfinished, after a refused save, is unsaved work with no notice', async () => {
    const { result } = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne(), turnAdd())

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expectHalfDoneChangeHeldUnsaved()
    expect(result.current.ownership.takeoverResult).toBeNull()
  })

  it('a finished stream handed back to the tab that gave way is clean, with no notice', async () => {
    const { result } = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne(), turnAdd(), turnChange(), savedFrame())

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
    expect(result.current.ownership.takeoverResult).toBeNull()
  })

  it('a finished stream handed back to nobody is claimed clean, with no notice', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne(), turnAdd(), turnChange(), savedFrame(), handBackTo(null))
    await flush()
    await flush()

    expect(result.current.ownership.isHolder).toBe(true)
    expect(ids(store().nodes)).toEqual(ids(FINISHED))
    expect(store().isDirty).toBe(false)
    expect(result.current.ownership.takeoverResult).toBeNull()
  })
})

describe('useSessionOwnership - the staying Blocks of a watched change glide to their new places first', () => {
  // b and c move down to make room; a stays; r is removed.
  const SHOWN = [block('a', 0), block('b', 200), block('c', 400), block('r', 600)]
  const MAKE_ROOM = [block('a', 0), block('b', 400), block('c', 600)]

  function yOf(nodeId: string): number | undefined {
    return store().nodes.find((node) => node.id === nodeId)?.position.y
  }

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  /** Mid-glide, b sits strictly between where it showed and its new place. */
  function expectMidGlide(nodeId: string, from: number, to: number) {
    const y = yOf(nodeId) ?? from
    expect(y).toBeGreaterThan(from)
    expect(y).toBeLessThan(to)
  }

  function preferReducedMotion() {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the tab that gave way sees every moving Block glide from where it showed to its new place, all together', async () => {
    await mountHoldingStoredTest()
    openSavedTest({ id: CHANGED_TEST.test_id, name: CHANGED_TEST.test_name }, SHOWN)
    emit(yieldTo(MCP))

    emit(changeFrame(MAKE_ROOM, null))

    expect(ids(store().nodes)).toEqual(['a', 'b', 'c'])
    expect(yOf('b')).toBe(200)
    expect(yOf('c')).toBe(400)
    advance(150)
    const bMoved = (yOf('b') ?? 200) - 200
    expect(bMoved).toBeGreaterThan(0)
    expect(bMoved).toBeLessThan(200)
    expect((yOf('c') ?? 400) - 400).toBe(bMoved)
    expect(yOf('a')).toBe(0)
    advance(200)
    expect(store().nodes.map((node) => node.position)).toEqual(MAKE_ROOM.map((node) => node.position))
    expect(store().mirrorGlide).toBeNull()
  })

  it('a watcher sees the same glide, ending exactly on the places of the first step', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(yOf('b')).toBe(200)
    advance(150)
    expectMidGlide('b', 200, 400)
    advance(200)
    expect(store().nodes).toEqual(STEP_ONE)
  })

  it('frames the finished test before any Block moves, so the view holds still while they glide', async () => {
    useWorkflowStore.setState({ requestFitView: storeRequestFitView })
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(store().fitViewRequested).toBe(true)
    expect(store().fitViewOptions).toEqual({ padding: 0.2, duration: 0, bounds: BOUNDS })
    advance(400)
    expect(yOf('b')).toBe(200)
    // The canvas frames the finished test, then the Blocks set off.
    act(() => store().acknowledgeFitView())
    advance(150)
    expectMidGlide('b', 200, 400)
    advance(200)
    expect(yOf('b')).toBe(400)
  })

  it('never marks the canvas unsaved and sends nothing while the Blocks glide', async () => {
    await mountHoldingStoredTest()
    emit(yieldTo(MCP))
    mockSend.mockClear()

    emit(stepOne())
    advance(150)

    expectMidGlide('b', 200, 400)
    expect(store().isDirty).toBe(false)
    expect(store().getSavedNodes()).toEqual(STEP_ONE)
    advance(200)
    expect(store().isDirty).toBe(false)
    expect(store().getSavedNodes()).toEqual(STEP_ONE)
    expect(sentFrames('draft_update')).toEqual([])
    expect(sentFrames('draft_state')).toEqual([])
  })

  it('with reduced motion, the Blocks take their new places at once', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))
    preferReducedMotion()

    emit(stepOne())

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it("a person's frame moves its Blocks at once", async () => {
    await mountWatchingAshley()

    emit({
      event: 'draft_snapshot',
      from_holder_id: ASHLEY.id,
      nodes: STEP_ONE,
      edges: [],
      variables: [],
      ...CHANGED_TEST,
      dirty: true,
    })

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it("a watched build's frame places its Blocks at once", async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(changeFrame([block('a', 0), block('b', 400)], 'b', { watch_kind: 'build' }))

    expect(yOf('b')).toBe(400)
    expect(store().mirrorGlide).toBeNull()
  })

  it('a turn of a watched change places its Blocks at once', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP))

    emit(turnAdd())

    expect(store().nodes).toEqual(TURN_ADD)
    expect(store().mirrorGlide).toBeNull()
  })

  it('a rejoin shows the first step with its Blocks already at their new places', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP))
    act(() => result.current.ownership.browseAway())
    emit(stepOne())

    act(() => result.current.ownership.rejoinMirror())

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it('a tab that shows another test takes the changed test with its Blocks at their places at once', async () => {
    mount()
    await flush()
    openSavedTest({ id: 'test-login', name: 'Login' }, [block('a', 0), block('b', 900)])
    emit(yieldTo(MCP))

    emit(stepOne())

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it('a turn that comes mid-glide ends the glide on the new places, then lands as it is', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)

    emit(turnAdd())

    expect(store().nodes).toEqual(TURN_ADD)
    expect(store().mirrorGlide).toBeNull()
    const landed = store().nodes
    advance(300)
    expect(store().nodes).toBe(landed)
  })

  it("a take-over mid-glide puts the Blocks on their new places at once, and the canvas holds the frame's places", async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)
    ownershipApi.forceTakeover.mockResolvedValue(HOLDER_ME)

    await act(async () => {
      result.current.ownership.forceTakeOver()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(result.current.ownership.isHolder).toBe(true)
    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().getSavedNodes().map((node) => node.position)).toEqual(STEP_ONE.map((node) => node.position))
    expect(store().mirrorGlide).toBeNull()
    advance(300)
    expect(store().nodes).toEqual(STEP_ONE)
  })

  it('a hand back mid-glide puts the Blocks on their new places first', async () => {
    const { result } = await mountHoldingStoredTest()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)

    emit(handBackTo(ME))

    expect(result.current.ownership.isHolder).toBe(true)
    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it('another tab taking over mid-glide puts the Blocks on their new places first', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)

    emit({ event: 'holder_changed', holder: ASHLEY })

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it('a take-over granted to another tab mid-glide puts the Blocks on their new places first', async () => {
    await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)

    emit({ event: 'takeover_resolved', outcome: 'granted', new_holder: ASHLEY })

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
  })

  it('leaving the mirror mid-glide puts the Blocks on their new places first', async () => {
    const { result } = await mountWatchingAshley()
    emit(yieldTo(MCP), stepOne())
    advance(100)
    expectMidGlide('b', 200, 400)

    act(() => result.current.ownership.browseAway())

    expect(store().nodes).toEqual(STEP_ONE)
    expect(store().mirrorGlide).toBeNull()
    advance(300)
    expect(store().nodes).toEqual(STEP_ONE)
  })
})
