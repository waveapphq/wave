/**
 * useCanvasInteractions - UI interaction handlers for the workflow canvas
 *
 * Handles node/edge changes, selection, context menus, keyboard shortcuts,
 * node drag proximity, viewport changes, and node double-click.
 *
 * Extracted from canvas.tsx for modularity.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react'
import {
  MAX_OPEN_CONFIG_SHEETS,
  useWorkflowStore,
  useWorkflowStoreInstance,
} from '@/features/workbench/stores/workflow-store'
import { ToastContext } from '@/components/ui/toast'
import { refocusOpenConfigSheet } from '@/features/workbench/common/canvas/config-sheet-focus'
import { useFunctionDrill } from '@/features/workbench/common/canvas/workflow-node/use-function-drill'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { START_NODE_ID, ONBOARDING_NODE_ID, GHOST_EDGE_ID } from './canvas-constants'

interface UseCanvasInteractionsParams {
  isExecuting: boolean
  reactFlowWrapperRef: React.RefObject<HTMLDivElement | null>
}

export function useCanvasInteractions({
  isExecuting,
  reactFlowWrapperRef,
}: UseCanvasInteractionsParams) {
  const { screenToFlowPosition } = useReactFlow()
  const storeApi = useWorkflowStoreInstance()
  // React Flow's change events (position, selection, etc.) reference the
  // nodes/edges currently rendered on the canvas - which is the ACTIVE
  // subtree (deepest drilled Function), not the root tree. We must apply
  // the changes against the active subtree and write the result back via
  // the drill-aware setNodes/setEdges (which scope the write to the same
  // subtree). Using `state.nodes` here was the source of the
  // "infinite recursion" bug where moving any node inside a drilled
  // Function overwrote the inner workflow with the root's content.
  const rootNodes = useWorkflowStore((state) => state.nodes)
  const rootEdges = useWorkflowStore((state) => state.edges)
  const drillPath = useWorkflowStore((state) => state.drillPath)
  const { storeNodes, storeEdges } = useMemo(() => {
    const active = walkActiveSubtree(rootNodes, rootEdges, [], drillPath)
    return { storeNodes: active.nodes, storeEdges: active.edges }
  }, [rootNodes, rootEdges, drillPath])
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const setViewport = useWorkflowStore((state) => state.setViewport)
  const selectedNodeIds = useWorkflowStore((state) => state.selectedNodeIds)
  const selectedEdgeIds = useWorkflowStore((state) => state.selectedEdgeIds)
  const setSelectedEdges = useWorkflowStore((state) => state.setSelectedEdges)
  const setSelectedNodes = useWorkflowStore((state) => state.setSelectedNodes)
  const clearSelection = useWorkflowStore((state) => state.clearSelection)
  const requestDeleteSelected = useWorkflowStore((state) => state.requestDeleteSelected)
  const disconnectSelected = useWorkflowStore((state) => state.disconnectSelected)
  const chainSelect = useWorkflowStore((state) => state.chainSelect)
  const openConfigModal = useWorkflowStore((state) => state.openConfigModal)
  const startDragOperation = useWorkflowStore((state) => state.startDragOperation)
  const endDragOperation = useWorkflowStore((state) => state.endDragOperation)
  const toast = use(ToastContext)
  const openFunctionBody = useFunctionDrill()


  // Context menu state for canvas pane and edge right-click
  const [canvasMenuState, setCanvasMenuState] = useState<{ open: boolean; x: number; y: number; flowX: number; flowY: number }>({ open: false, x: 0, y: 0, flowX: 0, flowY: 0 })
  const [edgeMenuState, setEdgeMenuState] = useState<{ open: boolean; x: number; y: number; edgeId: string; edgeType: string }>({ open: false, x: 0, y: 0, edgeId: '', edgeType: '' })

  // Handle node changes (position, selection, etc.)
  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Filter out changes to the start node and onboarding node (they're not in the store)
      const userChanges = changes.filter((change) => {
        if ('id' in change) {
          return change.id !== START_NODE_ID && change.id !== ONBOARDING_NODE_ID
        }
        return true
      })

      if (userChanges.length > 0) {
        const updatedNodes = applyNodeChanges(userChanges, storeNodes as Node[])
        // Only set dirty for position changes (user moved a node)
        // Dimension changes from React Flow measuring nodes should not set dirty
        const hasPositionChange = userChanges.some(
          (change) => change.type === 'position' && 'position' in change && change.position
        )
        setNodes(updatedNodes as typeof storeNodes, { skipDirty: !hasPositionChange })
      }
    },
    [storeNodes, setNodes]
  )

  // Handle edge changes
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      // Filter out changes to the ghost edge (it's not in the store)
      const userChanges = changes.filter((change) => {
        if ('id' in change) {
          return change.id !== GHOST_EDGE_ID
        }
        return true
      })

      if (userChanges.length > 0) {
        const updatedEdges = applyEdgeChanges(userChanges, storeEdges as Edge[])
        setEdges(updatedEdges as typeof storeEdges)
      }
    },
    [storeEdges, setEdges]
  )

  // Handle viewport change
  const handleViewportChange = useCallback(
    (newViewport: { x: number; y: number; zoom: number }) => {
      setViewport(newViewport)
    },
    [setViewport]
  )

  // Handle pane click (empty area) - clear selection on left-click only
  // Shift+click on pane is a no-op; chain select handled via native pointerup (REQ-4.2.5)
  const handlePaneClick = useCallback(
    (event: React.MouseEvent) => {
      // Only handle left-click (button 0)
      if (event.button !== 0) return
      // Shift+click on empty canvas - no-op (chain select only works on nodes)
      if (event.shiftKey) return
      clearSelection()
    },
    [clearSelection]
  )

  // Handle Shift+click chain select via native pointerup on the wrapper div.
  // React Flow's d3-drag system intercepts pointer events on nodes, preventing
  // onNodeClick from firing when selectionKeyCode is active. React's synthetic
  // events also fail due to d3's setPointerCapture. We use a native DOM listener
  // in capture phase to detect Shift+click on node elements by checking for the
  // data-id attribute that RF puts on every node wrapper.
  // We defer chainSelect via requestAnimationFrame so it runs AFTER RF's own
  // click processing (which resets selection to just the clicked node).
  const pendingChainSelectRef = useRef<string | null>(null)
  useEffect(() => {
    const wrapper = reactFlowWrapperRef.current
    /* v8 ignore next - COV-BRANCH-187 */
    if (!wrapper) return

    const handler = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return
      const nodeEl = (event.target as HTMLElement).closest?.('[data-id]')
      if (!nodeEl) return
      const nodeId = (nodeEl as HTMLElement).dataset.id
      if (!nodeId || nodeId === START_NODE_ID || nodeId === ONBOARDING_NODE_ID) return
      // Save the pre-click selection and defer chainSelect to after RF finishes
      const preClickSelection = storeApi.getState().selectedNodeIds.slice()
      pendingChainSelectRef.current = nodeId
      requestAnimationFrame(() => {
        if (pendingChainSelectRef.current === nodeId) {
          // Restore pre-click selection first (RF may have cleared it)
          storeApi.getState().setSelectedNodes(preClickSelection)
          chainSelect(nodeId)
          pendingChainSelectRef.current = null
        }
      })
    }

    wrapper.addEventListener('pointerup', handler, true) // capture phase
    return () => wrapper.removeEventListener('pointerup', handler, true)
  }, [chainSelect])

  // Handle Shift+drag rubber-band selection (REQ-4.2.5)
  // React Flow fires onSelectionChange with the nodes inside the selection box.
  // We merge them into store selection additively.
  /* v8 ignore start - COV-BRANCH-168 */
  const handleSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: Node[] }) => {
      if (selectedNodes.length === 0) return
      const ids = selectedNodes
        .filter((n) => n.id !== START_NODE_ID && n.id !== ONBOARDING_NODE_ID)
        .map((n) => n.id)
      if (ids.length === 0) return

      // Read fresh state to merge additively
      const current = storeApi.getState().selectedNodeIds
      const merged = new Set([...current, ...ids])
      setSelectedNodes([...merged])
      // Edge selection mutually exclusive
      setSelectedEdges([])
    },
    [setSelectedNodes, setSelectedEdges]
  )
  /* v8 ignore stop */

  // Handle pane right-click (empty area) - show canvas context menu
  const handlePaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault()
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCanvasMenuState({ open: true, x: event.clientX, y: event.clientY, flowX: flowPos.x, flowY: flowPos.y })
    },
    [screenToFlowPosition]
  )

  // Handle edge right-click - show edge context menu (suppressed during execution)
  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault()
      /* v8 ignore next - COV-BRANCH-188 */
      if (isExecuting) return
      /* v8 ignore next - COV-BRANCH-189 */
      setEdgeMenuState({ open: true, x: event.clientX, y: event.clientY, edgeId: edge.id, edgeType: edge.type ?? '' })
    },
    [isExecuting]
  )

  // Handle edge left-click - select edge (mutual exclusivity with nodes)
  const handleEdgeClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      const isMultiSelect = event.ctrlKey || event.metaKey

      /* v8 ignore start - COV-BRANCH-145 */
      if (isMultiSelect) {
        // Read fresh state to avoid stale closure on rapid Ctrl+clicks
        const current = storeApi.getState().selectedEdgeIds
        // Toggle: deselect if already selected, add otherwise
        if (current.includes(edge.id)) {
          setSelectedEdges(current.filter((id) => id !== edge.id))
        } else {
          setSelectedEdges([...current, edge.id])
        }
      /* v8 ignore stop */
      } else {
        // Replace edge selection
        setSelectedEdges([edge.id])
      }

      // Edge selection is mutually exclusive with node selection
      setSelectedNodes([])
    },
    [setSelectedEdges, setSelectedNodes]
  )

  // Open a block's config sheet with the raise-instead-of-duplicate rule and
  // the ten-sheet cap. Start node has no config; Note uses inline editing.
  // Match on React Flow node.type (the reliable identifier) - data.nodeType is
  // the palette block category ('control' | 'plugin'), never 'note'.
  const openConfigSheet = useCallback(
    (node: { id: string; type?: string }) => {
      /* v8 ignore next - COV-BRANCH-146: V8 tracks each || branch separately. */
      if (node.type === 'startNode' || node.type === 'noteNode') return
      // An already-open node raises + pulses its sheet instead of duplicating.
      if (refocusOpenConfigSheet(node.id)) return
      const { openConfigNodeIds } = storeApi.getState()
      if (openConfigNodeIds.length >= MAX_OPEN_CONFIG_SHEETS) {
        toast?.error('10 config sheets open. Close one to open another.')
        return
      }
      openConfigModal(node.id)
    },
    [openConfigModal, storeApi, toast],
  )

  const findActiveNode = useCallback(
    (id: string) => {
      const state = storeApi.getState()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      return (
        active.nodes as Array<{
          id: string
          type?: string
          // Every store node carries data; the drill hands the whole record on.
          data: Record<string, unknown>
        }>
      ).find((n) => n.id === id)
    },
    [storeApi],
  )

  // Enter configures the one selected block; Cmd/Ctrl+Enter drills into it when
  // it is a Function. Both are no-ops on any other selection size.
  const handleSelectionEnter = useCallback(
    (event: React.KeyboardEvent) => {
      if (selectedNodeIds.length !== 1) return
      const node = findActiveNode(selectedNodeIds[0])
      if (!node) return
      const drillIn = event.metaKey || event.ctrlKey
      if (drillIn && node.data.nodeType !== 'function') return
      event.preventDefault()
      if (drillIn) {
        // The shared open-body path: a Shared instance needs its pinned
        // version resolved before there is a body to drill into.
        openFunctionBody(node.id, node.data)
      } else {
        openConfigSheet(node)
      }
    },
    [selectedNodeIds, findActiveNode, openFunctionBody, openConfigSheet],
  )

  // Handle keyboard deletion on canvas
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Don't intercept keys when focus is in an input element
      const target = event.target as HTMLElement
      const tag = target.tagName
      /* v8 ignore next - COV-BRANCH-190 */
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      // CodeMirror uses contenteditable divs - don't intercept those either
      /* v8 ignore next - COV-BRANCH-191 */
      if (target.isContentEditable) return

      // Block destructive keyboard actions while workflow is executing
      /* v8 ignore next - COV-BRANCH-192 */
      if (isExecuting) return

      const hasSelection = selectedEdgeIds.length > 0 || selectedNodeIds.length > 0

      if (!hasSelection) return

      if (event.key === 'Delete') {
        requestDeleteSelected()
      } else if (event.key === 'Backspace') {
        disconnectSelected()
      } else if (event.key === 'Enter') {
        handleSelectionEnter(event)
      }
    },
    [selectedEdgeIds, selectedNodeIds, requestDeleteSelected, disconnectSelected, isExecuting, handleSelectionEnter]
  )

  // Double-click a node to open its config sheet.
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      openConfigSheet(node)
    },
    [openConfigSheet],
  )

  // React Flow drag lifecycle: bracket position deltas with a single
  // history entry so the entire drag is one undoable operation.
  const handleNodeDragStart = useCallback(() => {
    startDragOperation()
  }, [startDragOperation])

  return {
    canvasMenuState,
    setCanvasMenuState,
    edgeMenuState,
    setEdgeMenuState,
    onNodesChange,
    onEdgesChange,
    handleViewportChange,
    handlePaneClick,
    handleSelectionChange,
    handlePaneContextMenu,
    handleEdgeContextMenu,
    handleEdgeClick,
    handleKeyDown,
    handleNodeDoubleClick,
    handleNodeDragStart,
    endDragOperation,
  }
}
