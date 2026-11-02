/**
 * Custom hook for workflow node store selectors and action handlers.
 * Encapsulates all Zustand store interactions used by WorkflowNode.
 */

import { useCallback } from 'react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { getFunctionVersion } from '@/features/functions/api/functions-api'
import { buildEditModeDraft } from '@/features/functions/lib/edit-mode-draft'
import { canvasFunctionBody } from '@/features/workbench/lib/canonical-workflow'
import { useToast } from '@/components/ui/toast'
import { reportFunctionBodyFailure } from '@/features/functions/lib/function-body-report'
import { getBlockMenuGroups, type BlockContextMenuAction } from './menu-groups'
import { useFunctionDrill } from './use-function-drill'
import { refocusOpenConfigSheet } from '@/features/workbench/common/canvas/config-sheet-focus'
import { useAdHocActions, type AdHocAction } from '../adhoc-actions-context'
import type { ExecutionStatus } from '@/features/workbench/stores/execution-store'

// Stable empty-data fallback for the active-node selector. Must be a hoisted
// module constant: returning a fresh `{}` from a Zustand selector triggers an
// infinite re-render loop (a new reference every render).
const EMPTY_NODE_DATA: Record<string, unknown> = {}

interface UseNodeActionsParams {
  id: string
  disabled?: boolean
  isExecuting?: boolean
  rawExecutionStatus?: ExecutionStatus
  /** A read-only scope that can still run: the menu offers only the run and debug items. */
  inspectOnly?: boolean
}

/**
 * Frontend mirror of ``backend/wavecore/api/services/workbench/execution.py:
 * _disabled_pass_through_handles``. Returns the set of source handles that
 * remain executable when ``node`` is disabled, or ``null`` if no cascade
 * applies (single-egress node, or node not disabled). ``'then'`` is always
 * implicitly pass-through for scoped controls (try-catch / for / for-each /
 * while) and is handled by the BFS caller, so we don't include it here.
 *
 * Keep this matrix in sync with the backend's ``_disabled_pass_through_handles``
 * - the canvas mute reflects the runtime cascade-skip behavior.
 */
function disabledPassThroughHandles(
  node: { data?: Record<string, unknown> },
): Set<string> | null {
  const data = node.data ?? {}
  if (data.disabled !== true) return null
  if (data.nodeType !== 'control') return null
  const elementType = data.elementType as string | undefined
  const config = (data.config as Record<string, unknown> | undefined)?.values as
    | Record<string, unknown>
    | undefined
  if (elementType === 'assert') {
    const mode = (config?.mode as string | undefined) ?? 'split'
    return mode === 'split' ? new Set(['pass']) : null
  }
  if (
    elementType === 'try-catch-finally' ||
    elementType === 'for' ||
    elementType === 'for-each' ||
    elementType === 'while' ||
    elementType === 'switch-case' ||
    elementType === 'parallel'
  ) {
    // 'then' is always implicit pass-through (handled by caller).
    return new Set()
  }
  if (elementType === 'if-else') {
    const branches = (config?.branches as Array<{ id?: string }> | undefined) ?? []
    const firstId = branches[0]?.id
    return firstId ? new Set([firstId]) : new Set()
  }
  // Single-egress / unknown - no cascade restriction.
  return null
}

interface AdjEntry {
  target: string
  sourceHandle?: string | null
}

function buildAdjacency(
  edges: Array<{ source: string; target: string; sourceHandle?: string | null }>,
): Map<string, AdjEntry[]> {
  const adj = new Map<string, AdjEntry[]>()
  for (const edge of edges) {
    const entry: AdjEntry = { target: edge.target, sourceHandle: edge.sourceHandle }
    const list = adj.get(edge.source)
    if (list) list.push(entry)
    else adj.set(edge.source, [entry])
  }
  return adj
}

function buildNodeMap(
  nodes: Array<{ id: string }>,
): Map<string, { data?: Record<string, unknown> }> {
  const nodeMap = new Map<string, { data?: Record<string, unknown> }>()
  for (const node of nodes) {
    nodeMap.set(node.id, node as { data?: Record<string, unknown> })
  }
  return nodeMap
}

function shouldEnqueueChild(
  passThrough: Set<string> | null,
  sourceHandle: string | null | undefined,
): boolean {
  if (passThrough === null) return true
  // 'then' is always implicit pass-through for scoped controls
  // (try-catch-finally / for / for-each / while).
  return sourceHandle === 'then' || passThrough.has(sourceHandle ?? '')
}

/** Compute the set of node ids reachable from ``start-node`` via the
 *  pass-through-aware BFS used by the canvas mute / unreachable highlight. */
function reachableFromStart(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string; sourceHandle?: string | null }>,
): Set<string> {
  const adj = buildAdjacency(edges)
  const nodeMap = buildNodeMap(nodes)
  const visited = new Set<string>(['start-node'])
  const queue = ['start-node']
  while (queue.length > 0) {
    const current = queue.shift()!
    const parentNode = nodeMap.get(current)
    const passThrough = parentNode ? disabledPassThroughHandles(parentNode) : null
    for (const { target, sourceHandle } of adj.get(current) ?? []) {
      if (!shouldEnqueueChild(passThrough, sourceHandle)) continue
      if (!visited.has(target)) {
        visited.add(target)
        queue.push(target)
      }
    }
  }
  return visited
}

export function useNodeActions({ id, disabled, isExecuting, rawExecutionStatus, inspectOnly }: UseNodeActionsParams) {
  const selectNode = useWorkflowStore((state) => state.selectNode)
  const openConfigModal = useWorkflowStore((state) => state.openConfigModal)
  const openPublishDialog = useWorkflowStore((state) => state.openPublishDialog)
  const openMakeLocalDialog = useWorkflowStore((state) => state.openMakeLocalDialog)
  const openPublishEditModeDialog = useWorkflowStore((state) => state.openPublishEditModeDialog)
  const openDropChangesDialog = useWorkflowStore((state) => state.openDropChangesDialog)
  const applyEditModeEntered = useWorkflowStore((state) => state.applyEditModeEntered)
  const selectedNodeIds = useWorkflowStore((state) => state.selectedNodeIds)
  const requestDeleteSelected = useWorkflowStore((state) => state.requestDeleteSelected)
  const duplicate = useWorkflowStore((state) => state.duplicate)
  const copyFn = useWorkflowStore((state) => state.copy)
  const cut = useWorkflowStore((state) => state.cut)
  const toggleBreakpoint = useWorkflowStore((state) => state.toggleBreakpoint)
  const toggleDisable = useWorkflowStore((state) => state.toggleDisable)
  const toggleSkip = useWorkflowStore((state) => state.toggleSkip)
  const unlinkNode = useWorkflowStore((state) => state.unlinkNode)
  const hasBreakpoint = useWorkflowStore((state) => state.hasBreakpoint(id))
  const dispatchAdHoc = useAdHocActions()
  const { error: toastError } = useToast()
  const elementType = useWorkflowStore(
    (state) => {
      // Walk the active subtree so a Function node inside a drilled-in parent
      // is still found when computing its menu groups.
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      return (active.nodes as Array<{ id: string; data?: { elementType?: string } }>)
        .find((n) => n.id === id)?.data?.elementType
    },
  )
  const functionLifecycle = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      return (active.nodes as Array<{ id: string; data?: { functionLifecycle?: 'local' | 'shared' } }>)
        .find((n) => n.id === id)?.data?.functionLifecycle
    },
  )
  const functionId = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      return (active.nodes as Array<{ id: string; data?: { functionId?: string } }>)
        .find((n) => n.id === id)?.data?.functionId
    },
  )
  const functionVersion = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find((n) => n.id === id) as
        | { data?: { functionVersion?: string } }
        | undefined
      return node?.data?.functionVersion
    },
  )
  const editMode = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find((n) => n.id === id) as
        | { data?: { editMode?: boolean } }
        | undefined
      return !!node?.data?.editMode
    },
  )
  const missingVersion = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find((n) => n.id === id) as
        | { data?: { missingVersion?: boolean } }
        | undefined
      return !!node?.data?.missingVersion
    },
  )
  // Pre-read the entire active node data once per render so the dispatcher
  // branches that need multiple fields (functionId + functionVersion + draft
  // + upstreamLink) can read consistently. Returning a primitive subset would
  // need three more selectors; just plucking the data slice is cheaper.
  const activeNodeData = useWorkflowStore(
    (state) => {
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      return (
        (active.nodes as Array<{ id: string; data?: Record<string, unknown> }>).find(
          (n) => n.id === id,
        )?.data ?? EMPTY_NODE_DATA
      )
    },
  )

  // CANVAS-72: Skipped is transient - lives in store, not node data
  const skipped = useWorkflowStore((state) => state.skippedNodeIds.includes(id))

  // Live-derived per-node issue presence (drives the static alert icon); a
  // warning is not a node issue (PYRUN-14).
  const hasNodeIssue = useWorkflowStore((state) =>
    /* v8 ignore next - COV-BRANCH-003 */
    (state.nodeIssues.get(id) ?? []).some((issue) => issue.severity !== 'warning'),
  )

  // Transient pulse flag for the alert icon (set by handleValidationClose)
  const shouldPulse = useWorkflowStore((state) => state.pulseValidationNodeIds.has(id))

  // Dynamic ingress (input) handles - expand as more edges connect
  // Return primitive count (not array) to avoid infinite re-renders from new array references.
  // Inside a drilled-in Function the BFS / count must walk the inner subtree;
  // root edges don't reference inner node ids.
  const ingressCount = useWorkflowStore((state) => {
    const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
    let count = 0
    for (const e of active.edges) {
      if (e.target === id) count++
    }
    return count
  })

  // Unreachable: not reachable from Start via edges (won't execute) AND
  // not behind a disabled control's non-pass-through branch. The second
  // half mirrors the backend's ``execution.py:_disabled_pass_through_handles``
  // matrix - a disabled diverging/scoped control cascades skip to every
  // non-pass-through descendant, so the canvas treats them as muted just
  // like topologically-disconnected nodes.
  // Note: start node (id='start-node') lives in canvas useMemo, not in store nodes,
  // but its edges ARE in the active edges - so we BFS from the well-known ID directly.
  const isUnreachable = useWorkflowStore((state) => {
    const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
    return !reachableFromStart(active.nodes, active.edges).has(id)
  })

  // Shared menu groups for context menu (same items as kebab - CANVAS-39)
  const hasConnections = useWorkflowStore((state) => {
    const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
    return active.edges.some((e) => e.source === id || e.target === id)
  })
  const isNodeRunning = rawExecutionStatus === 'running'
  const menuGroups = getBlockMenuGroups({
    hasBreakpoint,
    disabled: !!disabled,
    skipped: !!skipped,
    hasConnections,
    isExecuting: !!isExecuting,
    isNodeRunning,
    elementType,
    functionLifecycle,
    editMode,
    missingVersion,
    inspectOnly,
  })

  // Show action row only for single selection (not multi-select)
  const showActionRow = selectedNodeIds.length === 1

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't select node when clicking on handles (ingress/egress connection points)
      const target = e.target as HTMLElement
      if (target.closest('.react-flow__handle')) return
      e.stopPropagation()
      const addToSelection = e.ctrlKey || e.metaKey
      if (addToSelection) {
        selectNode(id, { addToSelection: true })
      } else {
        selectNode(id)
      }
    },
    [id, selectNode]
  )

  const handleConfigureClick = useCallback(() => {
    // The cluster stops the click reaching the canvas, so selection is set here:
    // the block being configured is the block the keyboard acts on.
    selectNode(id)
    // Reopen attempt: raise + pulse the already-open sheet instead of a no-op.
    if (refocusOpenConfigSheet(id)) return
    openConfigModal(id)
  }, [id, openConfigModal, selectNode])

  // 'Open' on a Function node: the shared open-body path, so the glyph, the
  // kebab entry and Ctrl+Enter all behave identically.
  const openFunctionBody = useFunctionDrill()
  const runOpenAction = useCallback(() => {
    openFunctionBody(id, activeNodeData)
  }, [id, activeNodeData, openFunctionBody])

  // 'Edit' on a Published Function instance: edit-mode entry
  // is always client-side - build the draft from the pinned version and mark the
  // node dirty. It persists only on the normal Test Save (no BE round-trip).
  const runEditAction = useCallback(() => {
    if (!functionId) return
    const data = activeNodeData
    const sourceVersion =
      (data.functionVersion as string | undefined) ?? functionVersion
    if (!sourceVersion) return
    void getFunctionVersion(functionId, sourceVersion)
      .then(({ definition }) => {
        applyEditModeEntered(
          id,
          {
            ...data,
            editMode: true,
            upstreamLink: { functionId, sourceVersion },
            draft: canvasFunctionBody(buildEditModeDraft(definition)),
          },
          false,
        )
      })
      .catch((err: unknown) => reportFunctionBodyFailure(toastError, err))
  }, [id, functionId, activeNodeData, functionVersion, applyEditModeEntered, toastError])

  // Context menu action handler - dispatches to store actions (CANVAS-39)
  const handleContextMenuAction = useCallback(
    (action: BlockContextMenuAction) => {
      // Block destructive/edit actions while workflow is executing
      // Skip and toggle-breakpoint remain allowed during execution
      const blockedActions: BlockContextMenuAction[] = ['delete', 'duplicate', 'copy', 'cut', 'unlink', 'disable', 'run-current', 'run-from-here', 'debug-current', 'debug-from-here']
      if (isExecuting && blockedActions.includes(action)) return
      // Can't skip the currently running node
      if (rawExecutionStatus === 'running' && action === 'skip') return

      switch (action) {
        case 'delete':
          selectNode(id)
          requestDeleteSelected()
          break
        case 'duplicate':
          selectNode(id)
          duplicate()
          break
        case 'copy':
          selectNode(id)
          copyFn()
          break
        case 'cut':
          selectNode(id)
          cut()
          break
        case 'toggle-breakpoint':
          toggleBreakpoint(id)
          break
        case 'unlink':
          unlinkNode(id)
          break
        case 'disable':
          toggleDisable(id)
          break
        case 'skip':
          toggleSkip(id)
          break
        case 'run-current':
        case 'run-from-here':
        case 'debug-current':
        case 'debug-from-here':
          dispatchAdHoc(action as AdHocAction, id)
          break
        case 'open':
          runOpenAction()
          break
        case 'publish-to-library':
          openPublishDialog(id)
          break
        case 'make-local':
          openMakeLocalDialog(id)
          break
        case 'edit':
          runEditAction()
          break
        case 'publish-edit-mode':
          openPublishEditModeDialog(id)
          break
        case 'drop-changes':
          openDropChangesDialog(id)
          break
      }
    },
    [
      id,
      selectNode,
      requestDeleteSelected,
      duplicate,
      copyFn,
      cut,
      toggleBreakpoint,
      toggleDisable,
      toggleSkip,
      unlinkNode,
      isExecuting,
      rawExecutionStatus,
      dispatchAdHoc,
      runOpenAction,
      runEditAction,
      openPublishDialog,
      openMakeLocalDialog,
      openPublishEditModeDialog,
      openDropChangesDialog,
    ]
  )

  return {
    selectNode,
    skipped,
    hasNodeIssue,
    shouldPulse,
    ingressCount,
    isUnreachable,
    isNodeRunning,
    menuGroups,
    showActionRow,
    handleClick,
    handleConfigureClick,
    handleContextMenuAction,
    hasConnections,
  }
}
