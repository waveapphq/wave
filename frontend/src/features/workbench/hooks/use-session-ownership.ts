/**
 * useSessionOwnership Hook - REQ-5.2.7.15/.16
 *
 * Single-active-session workbench ownership: mints a per-tab identity, claims
 * the draft slot when free, mirrors read-only when held, heartbeats while
 * holder, and drives the take-over protocol from both sides. Draft snapshots
 * and ownership events travel over the `workbench:draft` WebSocket topic.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ownershipApi,
  isHeldByAnother,
  type HolderKind,
  type MirroredRun,
  type MirroredRunWire,
  type Ownership,
  type OwnershipHolder,
} from '@/features/workbench/api/ownership'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { usePageBlock } from '@/hooks/use-page-block'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import { useWorkbenchSessionStore } from '@/features/workbench/stores/workbench-session-store'
import {
  useWorkflowStore,
  type NodeType,
  type EdgeType,
  type WorkflowVariable,
  type Rect,
} from '@/features/workbench/stores/workflow-store'
import { mirrorChangeTarget } from '@/features/workbench/lib/mirror-change'
import { glidesFrame } from '@/features/workbench/lib/mirror-glide'
import { convertBackendVariables } from '@/features/workbench/live/variable-helpers'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import {
  getPageId,
  getSessionId,
  getSessionLabel,
  rememberOwnSession,
} from '@/lib/session-identity'
import type { Subscription } from '@/services/websocket-client'
import { alreadyReported } from '@/features/workbench/lib/already-reported'

export const DRAFT_TOPIC = 'workbench:draft'

const SESSION_LABEL = 'workbench session'

// Identity is per browser tab: stable across route remounts within the tab.
const TAB_ID = getSessionId()
const TAB_LABEL = getSessionLabel()

function mapMirroredRun(run: MirroredRunWire | null | undefined): MirroredRun | null {
  if (!run) return null
  return {
    sessionId: run.session_id,
    testId: run.test_id,
    testName: run.test_name,
    environmentId: run.environment_id,
    environmentName: run.environment_name,
    status: run.status,
  }
}

export interface DraftSnapshot {
  nodes: NodeType[]
  edges: EdgeType[]
  variables: WorkflowVariable[]
  /** The holder's open test, or null for an unsaved draft surface. */
  test_id: string | null
  test_name: string | null
  /** Whether the holder's surface holds unsaved work. */
  dirty: boolean
}

/** What an assistant streams into the session: a watched build or a watched change. */
export type WatchKind = 'build' | 'change'

type DraftSnapshotEvent = {
  event: 'draft_snapshot'
  from_holder_id: string
  active_node_id?: string | null
  /** Where a watched build or change in progress ends up; absent on every other surface. */
  final_bounds?: Rect | null
  /** Null on a person's frame and on the saved last frame of a stream. */
  watch_kind?: WatchKind | null
} & DraftSnapshot

type DraftTopicEvent =
  | DraftSnapshotEvent
  | {
      event: 'holder_changed'
      holder: OwnershipHolder | null
      reason?: 'handoff' | 'auto_yield'
    }
  | { event: 'takeover_requested'; requester_label: string }
  | {
      event: 'takeover_resolved'
      outcome: 'granted' | 'denied'
      new_holder: OwnershipHolder | null
    }
  | { event: 'run_state_changed'; run: MirroredRunWire | null }
  | { event: 'watchers_changed'; count: number }

export interface SessionOwnership {
  isHolder: boolean
  isMirroring: boolean
  holderLabel: string | null
  holderKind: HolderKind | null
  mcpSessionId: string | null
  browserSessionId: string | null
  /** The holder's announced live run, if any (watchers attach to it). */
  mirroredRun: MirroredRun | null
  /** What the assistant holding the session streams, or null when it streams nothing. */
  watchKind: WatchKind | null
  /** True while this watcher tracks nothing: browsed away, or the slot went free. */
  browsingAway: boolean
  /** Watcher-initiated navigation: stop tracking the holder, browse free. */
  browseAway: () => void
  /** Switch back to watching the holder's session (draft or live run). */
  rejoinMirror: () => void
  /** Bumps when the slot returns from a write-only borrow: the open test may have changed in storage. */
  inheritRefreshTick: number
  watchers: number
  pendingTakeover: { requesterLabel: string } | null
  isRequestingTakeover: boolean
  /** Outcome to surface as a modal: a resolved request, or being forced out. */
  takeoverResult: 'granted' | 'inherited' | 'denied' | 'forced' | null
  dismissTakeoverResult: () => void
  takeOver: () => void
  forceTakeOver: () => void
  approve: () => void
  deny: () => void
  cancelRequest: () => void
  /** Holder-side: push the current canvas snapshot to the mirror relay. */
  pushDraft: (snapshot: DraftSnapshot) => void
}

export function useSessionOwnership(): SessionOwnership {
  const { isConnected, subscribe, connect } = useWebSocketStore()
  const { error: toastError } = useToast()
  const { blockPage, clearPageBlock } = usePageBlock()
  const [isHolder, setIsHolder] = useState(false)
  const [isMirroring, setIsMirroring] = useState(false)
  const [holderLabel, setHolderLabel] = useState<string | null>(null)
  const [holderKind, setHolderKind] = useState<HolderKind | null>(null)
  const [mcpSessionId, setMcpSessionId] = useState<string | null>(null)
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null)
  const [mirroredRun, setMirroredRun] = useState<MirroredRun | null>(null)
  const [watchKind, setWatchKind] = useState<WatchKind | null>(null)
  const [browsingAway, setBrowsingAway] = useState(false)
  const [inheritRefreshTick, setInheritRefreshTick] = useState(0)
  const [watchers, setWatchers] = useState(0)
  const [pendingTakeover, setPendingTakeover] = useState<{ requesterLabel: string } | null>(null)
  const [isRequestingTakeover, setIsRequestingTakeover] = useState(false)
  const [takeoverResult, setTakeoverResult] = useState<
    'granted' | 'inherited' | 'denied' | 'forced' | null
  >(null)

  const isHolderRef = useRef(false)
  isHolderRef.current = isHolder
  const holderKindRef = useRef<HolderKind | null>(null)
  const isRequestingTakeoverRef = useRef(false)
  isRequestingTakeoverRef.current = isRequestingTakeover
  // The server retracts a request with the same event it denies one with, so
  // this is the only thing that tells a tab its own cancel from a refusal.
  const isCancelingRequestRef = useRef(false)
  const isMirroringRef = useRef(false)
  isMirroringRef.current = isMirroring
  // Previous mirrored node tree, to diff for the Follow Changes target.
  const prevMirrorNodesRef = useRef<NodeType[]>([])
  const browsingAwayRef = useRef(false)
  // Detached by an unexpected holder loss with that holder's surface still on screen, and nobody continued it since.
  const showsLostHolderSurfaceRef = useRef(false)
  // What this tab actually received while yielded: streamed build or change
  // frames make the inherited draft unsaved work; a run keeps its paint; a
  // write-only borrow (create/amend) means the open test may have moved in storage.
  const sawSnapshotsRef = useRef(false)
  const sawRunRef = useRef(false)
  // Saved-state of the last streamed frame: a completed build hands back clean.
  const streamDirtyRef = useRef(false)
  // Latest holder snapshot, buffered even while browsing so rejoin can apply it.
  const lastSnapshotRef = useRef<DraftSnapshotEvent | null>(null)
  const preBrowseIdentityRef = useRef<{ testId: string | null; testName: string | null } | null>(null)
  const mirroredRunRef = useRef<MirroredRun | null>(null)
  // The assistant's run whose mirror ended when a person took the session over; it stays ended until that run does.
  const leftRunSessionIdRef = useRef<string | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)
  const subscribeRef = useRef(subscribe)
  subscribeRef.current = subscribe
  const connectRef = useRef(connect)
  connectRef.current = connect

  // Stop watching: drop the remote stream's active-block border, Follow target,
  // framing and kind of work, and (when inheriting a live draft) mark it dirty so
  // it reads as unsaved work (WATCH-5), autosaving and showing the Save affordance.
  const dropMirrorState = useCallback((markDirty: boolean) => {
    const store = useWorkflowStore.getState()
    store.finishMirrorGlide()
    store.setMirrorActiveNodeId(null)
    store.signalMirrorChange(null)
    store.setMirrorBuildBounds(null)
    prevMirrorNodesRef.current = []
    setWatchKind(null)
    if (markDirty) {
      // Undo stops at the inherited surface, and it stays unsaved work until a save.
      store.markUnsaved()
    }
  }, [])

  const applyBrowsingAway = useCallback((value: boolean) => {
    browsingAwayRef.current = value
    setBrowsingAway(value)
  }, [])

  // The role holds from the event that set it: the next draft frame can land before a render.
  const applyIsHolder = useCallback((value: boolean) => {
    isHolderRef.current = value
    setIsHolder(value)
  }, [])

  const applyIsMirroring = useCallback((value: boolean) => {
    isMirroringRef.current = value
    setIsMirroring(value)
  }, [])

  const applyHolderKind = useCallback((kind: HolderKind | null) => {
    // The mirror carries the holder's run: a person taking the session from an assistant ends it in every tab.
    const run = mirroredRunRef.current
    if (holderKindRef.current === 'mcp' && kind === 'person' && run !== null) {
      leftRunSessionIdRef.current = run.sessionId
      mirroredRunRef.current = null
      setMirroredRun(null)
    }
    holderKindRef.current = kind
    setHolderKind(kind)
  }, [])

  const setAnnouncedRun = useCallback((announced: MirroredRun | null) => {
    if (announced?.sessionId !== leftRunSessionIdRef.current) leftRunSessionIdRef.current = null
    const run = leftRunSessionIdRef.current === null ? announced : null
    mirroredRunRef.current = run
    // Only a run watched while yielded keeps its paint; this tab's own run says nothing about a later borrow.
    if (run !== null && !isHolderRef.current) sawRunRef.current = true
    setMirroredRun(run)
  }, [])

  // Regaining the slot: only a streamed UNSAVED surface reads as inherited
  // unsaved work; a completed build or change streams its saved state, stays
  // clean and becomes what this tab has saved. A write-only borrow instead
  // flags the open test for a storage refresh.
  const settleInherit = useCallback(
    (wasMirroring: boolean, wasBrowsing: boolean, handedBack = false) => {
      const sawSnapshots = sawSnapshotsRef.current
      const sawRun = sawRunRef.current
      const streamDirty = streamDirtyRef.current
      const showsLostHolderSurface = showsLostHolderSurfaceRef.current
      sawSnapshotsRef.current = false
      sawRunRef.current = false
      streamDirtyRef.current = false
      showsLostHolderSurfaceRef.current = false
      const inherited = wasMirroring && (!wasBrowsing || showsLostHolderSurface)
      dropMirrorState(inherited && sawSnapshots && streamDirty)
      if (inherited && showsLostHolderSurface) {
        // Inheritance after an unexpected holder loss is announced; every other one is silent.
        setTakeoverResult('inherited')
      }
      if (inherited && sawSnapshots && !streamDirty) {
        // Undo and the unsaved checks compare with the saved test, never with the one before the stream.
        useWorkflowStore.getState().markSaved()
      }
      // A browsing tab never showed the holder's work: to it, a hand back follows a write to storage.
      const wroteUnseen = inherited ? !sawSnapshots && !sawRun : wasBrowsing && handedBack
      if (wroteUnseen) {
        setInheritRefreshTick((tick) => tick + 1)
      }
    },
    [dropMirrorState],
  )

  const becomeHolder = useCallback(
    ({ handedBack = false }: { handedBack?: boolean } = {}) => {
      const wasHolder = isHolderRef.current
      const wasMirroring = isMirroringRef.current
      const wasBrowsing = browsingAwayRef.current
      applyBrowsingAway(false)
      applyIsHolder(true)
      applyIsMirroring(false)
      setHolderLabel(TAB_LABEL)
      applyHolderKind('person')
      setMcpSessionId(null)
      setBrowserSessionId(TAB_ID)
      // A claim's answer after its own event keeps the notice that event raised.
      if (!wasHolder) setTakeoverResult(null)
      settleInherit(wasMirroring, wasBrowsing, handedBack)
    },
    [applyBrowsingAway, applyIsHolder, applyIsMirroring, applyHolderKind, settleInherit],
  )

  const applyHolder = useCallback(
    (holder: OwnershipHolder | null) => {
      if (holder === null) {
        applyIsHolder(false)
        applyIsMirroring(false)
        setHolderLabel(null)
        applyHolderKind(null)
        setMcpSessionId(null)
        setBrowserSessionId(null)
        return
      }
      const mine = holder.id === TAB_ID
      const wasMirroring = isMirroringRef.current
      const wasBrowsing = browsingAwayRef.current
      // Another holder continues the lost holder's work: this tab's copy of it is no longer the live draft.
      if (!mine) showsLostHolderSurfaceRef.current = false
      applyIsHolder(mine)
      applyIsMirroring(!mine)
      setHolderLabel(holder.label)
      applyHolderKind(holder.kind)
      setMcpSessionId(holder.kind === 'mcp' ? holder.id : null)
      setBrowserSessionId(holder.kind === 'person' ? holder.id : null)
      if (mine && wasMirroring) {
        applyBrowsingAway(false)
        settleInherit(wasMirroring, wasBrowsing)
      }
    },
    [applyBrowsingAway, applyIsHolder, applyIsMirroring, applyHolderKind, settleInherit],
  )

  // Reclaims a slot freed by a hand back that names nobody.
  const claimOrMirror = useCallback(async () => {
    try {
      const claimed = await ownershipApi.claim(TAB_ID, TAB_LABEL)
      becomeHolder({ handedBack: true })
      setWatchers(claimed.watchers)
    } catch (error_) {
      if (!isHeldByAnother(error_)) throw error_
      const current = await ownershipApi.getOwnership(TAB_ID)
      applyHolder(current.holder)
      setWatchers(current.watchers)
      setAnnouncedRun(mapMirroredRun(current.run))
    }
    clearPageBlock(SESSION_LABEL)
  }, [becomeHolder, applyHolder, setAnnouncedRun, clearPageBlock])

  const sendFrame = useCallback((frame: Record<string, unknown>) => {
    subscriptionRef.current?.send?.(frame)
  }, [])

  const pushDraft = useCallback(
    (snapshot: DraftSnapshot) => {
      sendFrame({ type: 'draft_update', holderId: TAB_ID, snapshot })
    },
    [sendFrame],
  )

  const browseAway = useCallback(() => {
    showsLostHolderSurfaceRef.current = false
    if (isHolderRef.current || browsingAwayRef.current) return
    const store = useWorkflowStore.getState()
    preBrowseIdentityRef.current = {
      testId: store.editingTestId,
      testName: store.editingTestName,
    }
    dropMirrorState(false)
    applyBrowsingAway(true)
  }, [dropMirrorState, applyBrowsingAway])

  // The slot went free: keep the canvas read-only but follow nothing, and stay
  // that way until the viewer asks to watch again.
  const detachFromHolder = useCallback(() => {
    const wasWatching = !browsingAwayRef.current
    setHolderLabel(null)
    applyHolderKind(null)
    setMcpSessionId(null)
    setBrowserSessionId(null)
    browseAway()
    // A watching tab keeps the lost holder's surface for whoever continues it.
    showsLostHolderSurfaceRef.current = wasWatching
  }, [applyHolderKind, browseAway])

  const handleHolderChanged = useCallback(
    (holder: OwnershipHolder | null, reason?: 'handoff' | 'auto_yield') => {
      // Whoever holds next starts from the Blocks on their new places.
      useWorkflowStore.getState().finishMirrorGlide()
      // The kind of watched work belongs to the holding that streamed it.
      setWatchKind(null)
      if (reason === 'handoff' && holder?.id === TAB_ID) {
        // The assistant handed the session back to this tab, the one that gave
        // way: it holds again exactly as if it had won the freed slot.
        becomeHolder({ handedBack: true })
        return
      }
      if (holder === null && isMirroringRef.current) {
        // A hand-back that names nobody frees the slot for a watcher to claim; an
        // unexpected loss promotes nobody, so this tab detaches instead of racing to claim.
        if (reason === 'handoff') {
          startBlockingRead({ label: SESSION_LABEL, run: claimOrMirror }, blockPage)
        } else {
          detachFromHolder()
        }
        return
      }
      if (reason === 'auto_yield') {
        // This clean idle tab yielded to an assistant claim: flip to watching
        // with no dialog; the banner appearing IS the signal.
        setPendingTakeover(null)
        applyHolder(holder)
        return
      }
      const forcedOut = isHolderRef.current && holder !== null && holder.id !== TAB_ID
      if (forcedOut) {
        // Only a forced take-over reaches a still-holder: drop any open approval
        // modal and surface the forced-out notice.
        setPendingTakeover(null)
        setTakeoverResult('forced')
      }
      applyHolder(holder)
    },
    [becomeHolder, claimOrMirror, applyHolder, detachFromHolder, blockPage],
  )

  const handleTakeoverResolved = useCallback(
    (payload: Extract<DraftTopicEvent, { event: 'takeover_resolved' }>) => {
      useWorkflowStore.getState().finishMirrorGlide()
      setPendingTakeover(null)
      // A cancel in flight suppresses only its own denied echo; a granted outcome won the race.
      if (
        isRequestingTakeoverRef.current &&
        (payload.outcome === 'granted' || !isCancelingRequestRef.current)
      ) {
        // An assistant grants a request only by letting go of the slot: it is not watching.
        const leftByAssistant = payload.outcome === 'granted' && holderKindRef.current === 'mcp'
        setTakeoverResult(leftByAssistant ? 'inherited' : payload.outcome)
      }
      isCancelingRequestRef.current = false
      setIsRequestingTakeover(false)
      applyHolder(payload.new_holder)
    },
    [applyHolder],
  )

  const applyDraftSnapshot = useCallback((payload: DraftSnapshotEvent, live: boolean) => {
    const store = useWorkflowStore.getState()
    // A live MCP build streams the stored shape (keyed variables, locals without ids): map it with stable ids.
    const rawVars = payload.variables as unknown
    const stored = !Array.isArray(rawVars)
    const variables: WorkflowVariable[] = stored
      ? convertBackendVariables(
          rawVars as Parameters<typeof convertBackendVariables>[0],
          (name) => `mirror-var-${name}`,
        )
      : rawVars
    const nodes = stored ? canvasLocalFunctionBodies(payload.nodes, (name) => `mirror-local-${name}`) : payload.nodes
    const graph = { nodes, edges: payload.edges, variables }
    // A watched change first makes room: the shown Blocks it moves glide there.
    if (live && glidesFrame(payload, store.editingTestId)) {
      store.glideMirroredGraph(graph)
    } else {
      store.applyMirroredGraph(graph)
    }
    // Converge on WHOSE surface this is, so a mirrored build can never sit
    // under the name of a test this tab merely had open.
    const testId = payload.test_id ?? null
    const testName = payload.test_name ?? null
    if (store.editingTestId !== testId || store.editingTestName !== testName) {
      store.setEditingTest(testId, testName)
    }
    store.setMirrorActiveNodeId(payload.active_node_id ?? null)
    // Before the change signal, so a starting build or change is framed rather than chased (WATCH-8).
    store.setMirrorBuildBounds(payload.final_bounds ?? null)
    // A frame with no kind (a person's, or a stream's saved last frame) keeps the kind until the holder changes.
    if (payload.watch_kind) setWatchKind(payload.watch_kind)
    // Change target for the pulse + Follow: a watched stream names its own
    // (none in a change's first step); a person's frame is diffed, at any
    // nesting depth. Bumps the tick so a repeated change re-fires.
    // A rejoin apply moves the whole viewport instead, so it never signals.
    // A frame that changes no Block keeps the last change, so a trailing frame never cuts its pulse.
    const changed = live ? mirrorChangeTarget(payload, prevMirrorNodesRef.current, nodes) : null
    if (changed !== null) store.signalMirrorChange(changed)
    prevMirrorNodesRef.current = nodes
  }, [])

  const handleDraftEvent = useCallback(
    (payload: DraftTopicEvent) => {
      if (payload.event === 'draft_snapshot') {
        // Never mirror our own draft echoed back by the snapshot replay: on a holder's
        // re-subscribe (SPA nav back to the workbench) isHolder is briefly false,
        // and applying our own snapshot would clobber local edits + clear isDirty,
        // silently discarding unsaved work.
        if (!isHolderRef.current && payload.from_holder_id !== TAB_ID) {
          lastSnapshotRef.current = payload
          sawSnapshotsRef.current = true
          streamDirtyRef.current = payload.dirty !== false
          // A browsing watcher buffers only: the holder never moves this view.
          if (!browsingAwayRef.current) {
            applyDraftSnapshot(payload, true)
          }
        }
      } else if (payload.event === 'holder_changed') {
        handleHolderChanged(payload.holder, payload.reason)
      } else if (payload.event === 'takeover_requested') {
        if (isHolderRef.current) {
          setPendingTakeover({ requesterLabel: payload.requester_label })
        }
      } else if (payload.event === 'takeover_resolved') {
        handleTakeoverResolved(payload)
      } else if (payload.event === 'run_state_changed') {
        setAnnouncedRun(mapMirroredRun(payload.run))
      } else {
        setWatchers(payload.count)
      }
    },
    [applyDraftSnapshot, handleHolderChanged, handleTakeoverResolved, setAnnouncedRun],
  )

  const rejoinMirror = useCallback(() => {
    if (!browsingAwayRef.current) return
    applyBrowsingAway(false)
    const store = useWorkflowStore.getState()
    store.reset()
    // A live run names the surface; else the buffered stream carries it, and a
    // tab that saw no frames falls back to what it showed before browsing.
    const run = mirroredRunRef.current
    const snapshot = lastSnapshotRef.current
    let identity: { testId: string | null; testName: string | null } | null
    if (run) {
      identity = { testId: run.testId, testName: run.testName }
    } else if (snapshot) {
      identity = { testId: snapshot.test_id ?? null, testName: snapshot.test_name ?? null }
    } else {
      identity = preBrowseIdentityRef.current
    }
    preBrowseIdentityRef.current = null
    if (snapshot) {
      applyDraftSnapshot(snapshot, false)
    }
    // After the apply, so a run's identity wins over the buffered frame's.
    if (identity?.testId) {
      store.setEditingTest(identity.testId, identity.testName)
    }
    store.requestFitView({ padding: 0.2, duration: 0 })
  }, [applyDraftSnapshot, applyBrowsingAway])

  // Subscribe to the draft topic, identify this tab, then claim or mirror.
  // Re-runs on the disconnected -> connected transition so the subscription
  // and identify frame land on the live socket (the store's subscribe is a
  // permanent no-op while no client exists). A failed read blocks the canvas:
  // an editable canvas nobody registered as the holder is not this tab's.
  useEffect(() => {
    connectRef.current().catch(alreadyReported)
    const subscription = subscribeRef.current(DRAFT_TOPIC, handleDraftEvent)
    subscriptionRef.current = subscription
    sendFrame({ type: 'identify', holderId: TAB_ID, pageId: getPageId(), clientType: 'workbench' })
    rememberOwnSession(TAB_ID)
    let canceled = false

    const applyOwnership = (ownership: Ownership): void => {
      if (ownership.you_are_holder) {
        becomeHolder()
      } else {
        applyHolder(ownership.holder)
      }
      setWatchers(ownership.watchers)
      setAnnouncedRun(mapMirroredRun(ownership.run))
    }

    const readOwnership = async (): Promise<void> => {
      const ownership = await ownershipApi.getOwnership(TAB_ID)
      if (ownership.holder === null) {
        try {
          const claimed = await ownershipApi.claim(TAB_ID, TAB_LABEL)
          becomeHolder()
          setWatchers(claimed.watchers)
        } catch (error_) {
          if (!isHeldByAnother(error_)) throw error_
          applyOwnership(await ownershipApi.getOwnership(TAB_ID))
        }
      } else {
        applyOwnership(ownership)
      }
      clearPageBlock(SESSION_LABEL)
    }

    startBlockingRead(
      { label: SESSION_LABEL, canceled: () => canceled, run: readOwnership },
      blockPage,
    )

    return () => {
      canceled = true
      subscription.unsubscribe()
      subscriptionRef.current = null
    }
  }, [
    isConnected,
    handleDraftEvent,
    becomeHolder,
    applyHolder,
    sendFrame,
    setAnnouncedRun,
    blockPage,
    clearPageBlock,
  ])

  // Holder-side dirtiness reporting: the server's auto-yield gate needs to know
  // whether this tab's draft has unsaved work. Report on becoming holder and on
  // every isDirty transition (the store selector dedupes equal values);
  // watchers never report.
  const isDirty = useWorkflowStore((state) => state.isDirty)
  useEffect(() => {
    if (!isHolder) return
    sendFrame({ type: 'draft_state', holderId: TAB_ID, dirty: isDirty })
  }, [isHolder, isDirty, sendFrame])

  // Publish this tab's role at app scope; session continuity reads it from any
  // route, because holding outlives the Workbench screen. No unmount reset.
  useEffect(() => {
    useWorkbenchSessionStore.getState().setSessionRole({ isHolder, isWatching: isMirroring })
  }, [isHolder, isMirroring])

  // Every ownership action is a write the user pressed a button for: a failed
  // one is reported, and the dialog it was pressed in stays open, because the
  // hand-over the user believes happened did not.
  const takeOver = useCallback(() => {
    isCancelingRequestRef.current = false
    setIsRequestingTakeover(true)
    void ownershipApi
      .requestTakeover(TAB_ID, TAB_LABEL)
      .then((outcome) => {
        if (outcome.outcome === 'granted') {
          becomeHolder()
          setIsRequestingTakeover(false)
        }
      })
      .catch((err: unknown) => {
        setIsRequestingTakeover(false)
        toastError(toFailureDetail(err).message, 'Take Over Failed')
      })
  }, [becomeHolder, toastError])

  const forceTakeOver = useCallback(() => {
    void ownershipApi
      .forceTakeover(TAB_ID, TAB_LABEL)
      .then(() => {
        becomeHolder()
        setIsRequestingTakeover(false)
      })
      .catch((err: unknown) => {
        setIsRequestingTakeover(false)
        toastError(toFailureDetail(err).message, 'Force Take Over Failed')
      })
  }, [becomeHolder, toastError])

  const approve = useCallback(() => {
    void ownershipApi
      .approveTakeover(TAB_ID)
      .then((ownership) => {
        setPendingTakeover(null)
        applyHolder(ownership.holder)
      })
      .catch((err: unknown) => {
        toastError(`You are still the holder: ${toFailureDetail(err).message}`, 'Hand Over Failed')
      })
  }, [applyHolder, toastError])

  const deny = useCallback(() => {
    void ownershipApi
      .denyTakeover(TAB_ID)
      .then(() => setPendingTakeover(null))
      .catch((err: unknown) => {
        toastError(`The request is still open: ${toFailureDetail(err).message}`, 'Deny Failed')
      })
  }, [toastError])

  const cancelRequest = useCallback(() => {
    // Retract the pending request server-side so the holder's approval modal
    // closes; the waiting dialog stays until the server confirms, because an
    // unretracted request can still be approved. The retraction is broadcast
    // before the call answers, so mark it first or this tab reads its own
    // cancel as the holder refusing it.
    isCancelingRequestRef.current = true
    void ownershipApi
      .cancelTakeover(TAB_ID)
      .then(() => setIsRequestingTakeover(false))
      .catch((err: unknown) => {
        // A request that resolved while the cancel was in flight is gone; there is nothing to report.
        const requestResolved = !isCancelingRequestRef.current || isHolderRef.current
        isCancelingRequestRef.current = false
        if (requestResolved) {
          setIsRequestingTakeover(false)
          return
        }
        toastError(
          `Your request is still open and can still be approved: ${toFailureDetail(err).message}`,
          'Cancel Failed',
        )
      })
  }, [toastError])

  const dismissTakeoverResult = useCallback(() => {
    setTakeoverResult(null)
  }, [])

  return {
    isHolder,
    isMirroring,
    holderLabel,
    holderKind,
    mcpSessionId,
    browserSessionId,
    mirroredRun,
    watchKind,
    browsingAway,
    browseAway,
    rejoinMirror,
    inheritRefreshTick,
    watchers,
    pendingTakeover,
    isRequestingTakeover,
    takeoverResult,
    dismissTakeoverResult,
    takeOver,
    forceTakeOver,
    approve,
    deny,
    cancelRequest,
    pushDraft,
  }
}
