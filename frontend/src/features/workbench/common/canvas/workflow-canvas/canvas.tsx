/** WorkflowCanvas: the React Flow canvas for building a workflow (REQ-3.1.1.1). */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { glidePhase } from '@/features/workbench/lib/mirror-glide'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { ToastContext } from '@/components/ui/toast'
import { useQuickAddShortcut } from '@/features/workbench/hooks/use-quick-add-shortcut'
import { QuickAddPopover, type QuickAddInsertMode } from '../quick-add/quick-add-popover'
import { performQuickAddInsert } from '../quick-add/quick-add-insert'
import { useQuickAddFunctions } from '../quick-add/use-quick-add-functions'
import {
  QUICK_ADD_BUILTINS,
  type QuickAddItem,
} from '@/features/workbench/lib/quick-add-catalog'
import { WorkflowNode } from '../workflow-node/node'
import { StartNodeFlow } from '../empty-state/start-node-flow'
import { OnboardingNodeFlow } from '../empty-state/onboarding-node-flow'
import { NoteNode } from '../note-node/note-node'
import { ElementConfigModal } from '@/features/workbench/common/element-config'
import { FunctionBlockWindow } from '@/features/functions/canvas/function-config-modal'
import { FunctionLifecycleDialogs } from '@/features/functions/canvas/function-lifecycle-dialogs'
import { CanvasContextMenu } from '../menus/canvas-context-menu'
import { EdgeContextMenu } from '../menus/edge-context-menu'
import { InteractionsHintPopover } from '../chrome/interactions-hint-bar'
import { HintPopoverToggle } from '../chrome/hint-bar-toggle'
import { CanvasReadOnlyProvider, useCanvasReadOnly } from '../read-only-context'

import { AUTO_PAN_SPEED, getSourceHandleCenter, isBlockFullyVisible, useThemeSafe } from './canvas-constants'
import { GhostEdge } from './ghost-edge'
import { useCanvasNodes } from './use-canvas-nodes'
import { useCanvasEdges } from './use-canvas-edges'
import { useCanvasFitView } from './use-canvas-fitview'
import { useCanvasFocus } from '@/features/workbench/hooks/use-canvas-focus'
import { useCanvasBringIntoView } from '@/features/workbench/hooks/use-canvas-bring-into-view'
import { useCanvasDrop } from './use-canvas-drop'
import { useCanvasConnections } from './use-canvas-connections'
import { useCanvasInteractions } from './use-canvas-interactions'
import { useConfigModal } from './use-config-modal'

// Custom node types registry
const nodeTypes = {
  workflowNode: WorkflowNode,
  startNode: StartNodeFlow,
  onboardingNode: OnboardingNodeFlow,
  noteNode: NoteNode,
}

// Each additional sheet opens offset right/down from the previous one.
const CASCADE_STEP = 28

interface ConfigSheetHostProps {
  nodeId: string
  cascadeIndex: number
}

/** One Block window per open node id, Function Blocks with their lifecycle chrome; out of scope it opens read-only. */
export function ConfigSheetHost({ nodeId, cascadeIndex }: Readonly<ConfigSheetHostProps>) {
  const { configModalElement, isInActiveScope, closeConfigModal, handleConfigSave } = useConfigModal(nodeId)
  const canvasReadOnly = useCanvasReadOnly()
  const sheetReadOnly = canvasReadOnly || !isInActiveScope
  const initialOffset = useMemo(
    () => ({ x: CASCADE_STEP * cascadeIndex, y: CASCADE_STEP * cascadeIndex }),
    [cascadeIndex],
  )

  if (configModalElement?.kind === 'function') {
    return (
      <CanvasReadOnlyProvider value={sheetReadOnly}>
        <FunctionBlockWindow
          onClose={closeConfigModal}
          element={configModalElement}
          onSave={handleConfigSave}
          initialOffset={initialOffset}
        />
      </CanvasReadOnlyProvider>
    )
  }
  if (configModalElement) {
    return (
      <CanvasReadOnlyProvider value={sheetReadOnly}>
        <ElementConfigModal
          isOpen
          onClose={closeConfigModal}
          element={configModalElement}
          onSave={handleConfigSave}
          initialOffset={initialOffset}
        />
      </CanvasReadOnlyProvider>
    )
  }
  return null
}

/** Deleting a selection whose config sheet or its open editors hold unsaved changes asks first. */
function DirtySheetDeleteDialog() {
  const pendingDeleteNodeIds = useWorkflowStore((s) => s.pendingDeleteNodeIds)
  const confirmPendingDelete = useWorkflowStore((s) => s.confirmPendingDelete)
  const cancelPendingDelete = useWorkflowStore((s) => s.cancelPendingDelete)
  return (
    <ConfirmationDialog
      isOpen={pendingDeleteNodeIds !== null}
      onClose={cancelPendingDelete}
      onConfirm={confirmPendingDelete}
      variant="delete"
      title="Delete with unsaved changes?"
      description="The selection includes a config sheet with unsaved changes. Deleting discards those edits."
      confirmLabel="Close"
      cancelLabel="Keep Editing"
    />
  )
}

/** Drilling with unsaved config sheet edits asks first, since a scope change resets the sheet. */
function DirtySheetDrillDialog() {
  const pendingDrillAction = useWorkflowStore((s) => s.pendingDrillAction)
  const confirmPendingDrill = useWorkflowStore((s) => s.confirmPendingDrill)
  const cancelPendingDrill = useWorkflowStore((s) => s.cancelPendingDrill)
  return (
    <ConfirmationDialog
      isOpen={pendingDrillAction !== null}
      onClose={cancelPendingDrill}
      onConfirm={confirmPendingDrill}
      variant="delete"
      title="Navigate with unsaved changes?"
      description="A config sheet has unsaved changes. Changing scope discards those edits."
      confirmLabel="Discard and Continue"
    />
  )
}

/** A block Save that turns existing plain variables secret asks first (SECUI-12, REQ-4.5.20). */
function SecretPromotionDialog() {
  const pendingSecretPromotion = useWorkflowStore((s) => s.pendingSecretPromotion)
  const confirmSecretPromotion = useWorkflowStore((s) => s.confirmSecretPromotion)
  const cancelSecretPromotion = useWorkflowStore((s) => s.cancelSecretPromotion)
  const names = pendingSecretPromotion?.names ?? []
  const several = names.length > 1
  return (
    <ConfirmationDialog
      isOpen={pendingSecretPromotion !== null}
      onClose={cancelSecretPromotion}
      onConfirm={confirmSecretPromotion}
      variant="make-secret"
      data-testid="secret-promote-dialog"
      itemCount={names.length}
      description={
        several ? (
          'Saving makes these plain variables secrets. Their values are masked from then on. Making them plain again clears their values.'
        ) : (
          <>
            Saving makes the plain variable{' '}
            <code translate="no" className="text-xs bg-muted px-1 py-0.5 rounded">{names[0]}</code> a secret. Its value
            is masked from then on. Making it plain again clears its value.
          </>
        )
      }
      itemNames={several ? names : undefined}
      cancelLabel="Cancel"
    />
  )
}

interface WorkflowCanvasInnerProps {
  className?: string
  executionStatus?: string
  onReset?: () => void
  /** Live workbench session id, so context-menu toggles can PATCH a running engine. */
  sessionId?: string
  /** Paint-only mode for the history canvas: no drag, connect, drop, menus, shortcuts or config. */
  readOnly?: boolean
}

const EMPTY_READONLY_HANDLERS = {
  onDrop: undefined,
  onDragOver: undefined,
  onDragLeave: undefined,
  onConnect: undefined,
  onConnectStart: undefined,
  onConnectEnd: undefined,
  isValidConnection: undefined,
  onPaneContextMenu: undefined,
  onEdgeContextMenu: undefined,
  onNodeDragStart: undefined,
  onNodeDrag: undefined,
  onNodeDragStop: undefined,
} as const

/** Inner canvas component (needs ReactFlowProvider). */
function WorkflowCanvasInner({ className, executionStatus, onReset, sessionId, readOnly = false }: Readonly<WorkflowCanvasInnerProps>) {
  const isExecuting = executionStatus === 'running' || executionStatus === 'paused'
  const interactionLocked = readOnly || isExecuting
  // Concrete, not `undefined`: RF ignores undefined updates, leaving a stale MAX that kills drag after a read-only->editable transition.
  const dragThreshold = readOnly ? Number.MAX_SAFE_INTEGER : 1
  const { resolvedTheme } = useThemeSafe()
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  const viewport = useWorkflowStore((state) => state.viewport)
  const isCanvasReady = useWorkflowStore((state) => state.isCanvasReady)
  const mirrorGlidePhase = useWorkflowStore((state) => glidePhase(state.mirrorGlide))

  // Hint popover state - ephemeral, no localStorage persistence (REQ-4.2.5)
  const [hintPopoverOpen, setHintPopoverOpen] = useState(false)
  /* v8 ignore next 3 - COV-BRANCH-141 */
  const handleHintPopoverToggle = useCallback(() => {
    setHintPopoverOpen((prev) => !prev)
  }, [])

  // --- Extracted hooks ---

  // Drop handling (palette drag-and-drop, proximity feedback)
  const {
    proximitySourceId,
    proximitySourceHandle,
    proximityTargetPos,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    handleNodeDrag,
    handleNodeDragStop,
    validate,
    drilledFunctionIds,
  } = useCanvasDrop({ isExecuting })

  // Quick-add popover (REQ-4.2.5, CANVAS-223..226)
  const { screenToFlowPosition } = useReactFlow()
  const rfStoreApi = useStoreApi()
  const toast = use(ToastContext)
  const { isOpen: quickAddOpen, setIsOpen: setQuickAddOpen } = useQuickAddShortcut({
    disabled: interactionLocked,
  })
  const hasSelection = useWorkflowStore(
    (state) => state.selectedNodeIds.length === 1,
  )
  const quickAddFunctions = useQuickAddFunctions(quickAddOpen)

  const handleQuickAddInsert = useCallback(
    (item: QuickAddItem, mode: QuickAddInsertMode) => {
      // The wrapper is always mounted when the popover is interactive.
      const rect = (reactFlowWrapper.current as HTMLDivElement).getBoundingClientRect()
      const viewportCenter = screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
      const topLeft = screenToFlowPosition({ x: rect.left, y: rect.top })
      const bottomRight = screenToFlowPosition({ x: rect.right, y: rect.bottom })
      performQuickAddInsert(item, mode, {
        validate,
        toast,
        viewportCenter,
        drilledFunctionIds,
        isPlacementVisible: (position) => isBlockFullyVisible(position, topLeft, bottomRight),
        resolveHandleCenter: (nodeId, sourceHandle) => {
          const internalNode = rfStoreApi.getState().nodeLookup.get(nodeId)
          if (!internalNode) return null
          // With no handle named, the anchor's own center (CANVAS-249).
          const located = sourceHandle
            ? internalNode
            : { measured: internalNode.measured, internals: { positionAbsolute: internalNode.internals.positionAbsolute } }
          return getSourceHandleCenter(located, sourceHandle)
        },
      })
    },
    [screenToFlowPosition, rfStoreApi, validate, toast, drilledFunctionIds],
  )

  // Edge connection and relocation
  const {
    relocatingEdgeId,
    relocDragPos,
    relocatingEdgeRef,
    relocProximityTargetId,
    newConnProximityTargetId,
    cycleDetectedNodeId,
    replacementEdgeId,
    isSnappedToHandle,
    isOverDeleteX,
    handleConnectStart,
    onConnect,
    handleConnectEnd,
    isValidConnection,
  } = useCanvasConnections({ isExecuting })

  // Node computation
  const { allNodes, isEmptyCanvas } = useCanvasNodes({
    proximitySourceId,
    relocProximityTargetId,
    newConnProximityTargetId,
    cycleDetectedNodeId,
    isExecuting,
  })

  // Edge computation
  const { allEdges } = useCanvasEdges({
    isEmptyCanvas,
    proximitySourceId,
    relocatingEdgeId,
    replacementEdgeId,
    isSnappedToHandle,
    isOverDeleteX,
  })

  // Fit view effect
  useCanvasFitView()
  useCanvasFocus()
  useCanvasBringIntoView()

  // UI interactions (selection, context menus, keyboard)
  const {
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
  } = useCanvasInteractions({
    isExecuting,
    reactFlowWrapperRef: reactFlowWrapper,
  })

  // Proximity auto-connect runs first, then endDragOperation writes the single history entry.
  const composedNodeDragStop = useCallback(
    (event: React.MouseEvent, node: Parameters<typeof handleNodeDragStop>[1]) => {
      handleNodeDragStop(event, node)
      endDragOperation()
    },
    [handleNodeDragStop, endDragOperation],
  )

  // Config sheets - one per open node id, cascade offset by open order
  const openConfigNodeIds = useWorkflowStore((state) => state.openConfigNodeIds)

  // Background colors based on theme
  const bgColor = resolvedTheme === 'dark' ? '#09090B' : '#FAFAFA'
  const gridColor = resolvedTheme === 'dark' ? '#27272A' : '#E4E4E7'

  // tabIndex and keydown are set in code for static analysis; read-only mode has no keyboard actions.
  useEffect(() => {
    if (readOnly) return
    const el = reactFlowWrapper.current
    /* v8 ignore next - COV-DEF-110 */
    if (!el) return
    el.tabIndex = 0
    const onKeyDown = (e: KeyboardEvent) =>
      handleKeyDown(e as unknown as React.KeyboardEvent)
    el.addEventListener('keydown', onKeyDown)
    return () => el.removeEventListener('keydown', onKeyDown)
  }, [handleKeyDown, readOnly])

  // A stable handler bundle keeps React Flow from re-registering drag listeners mid-drag.
  const interactiveHandlers = useMemo(
    () =>
      readOnly
        ? EMPTY_READONLY_HANDLERS
        : {
            onDrop: handleDrop,
            onDragOver: handleDragOver,
            onDragLeave: handleDragLeave,
            onConnect,
            onConnectStart: handleConnectStart,
            onConnectEnd: handleConnectEnd,
            isValidConnection,
            onPaneContextMenu: handlePaneContextMenu,
            onEdgeContextMenu: handleEdgeContextMenu,
            onNodeDragStart: handleNodeDragStart,
            onNodeDrag: handleNodeDrag,
            onNodeDragStop: composedNodeDragStop,
          },
    [
      readOnly,
      handleDrop,
      handleDragOver,
      handleDragLeave,
      onConnect,
      handleConnectStart,
      handleConnectEnd,
      isValidConnection,
      handlePaneContextMenu,
      handleEdgeContextMenu,
      handleNodeDragStart,
      handleNodeDrag,
      composedNodeDragStop,
    ],
  )

  return (
    <CanvasReadOnlyProvider value={interactionLocked}>
    <div
      ref={reactFlowWrapper}
      data-testid="workflow-canvas"
      data-readonly={readOnly ? 'true' : undefined}
      data-mirror-glide={mirrorGlidePhase}
      role="application"
      aria-roledescription="workflow canvas"
      aria-label="Workflow canvas"
      className={`w-full h-full flex flex-col relative transition-opacity duration-200 ease-out ${isCanvasReady ? 'opacity-100' : 'opacity-0'} ${className ?? ''}`}
      style={isCanvasReady ? undefined : { transitionDuration: '0ms' }}
      onDrop={interactiveHandlers.onDrop}
      onDragOver={interactiveHandlers.onDragOver}
      onDragLeave={interactiveHandlers.onDragLeave}
    >
      <div className="flex-1 relative min-h-0">
      <ReactFlow
        nodes={allNodes}
        edges={allEdges}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={interactiveHandlers.onConnect}
        onConnectStart={interactiveHandlers.onConnectStart}
        onConnectEnd={interactiveHandlers.onConnectEnd}
        isValidConnection={interactiveHandlers.isValidConnection}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={interactiveHandlers.onPaneContextMenu}
        onEdgeContextMenu={interactiveHandlers.onEdgeContextMenu}
        onEdgeClick={handleEdgeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={interactiveHandlers.onNodeDragStart}
        onNodeDrag={interactiveHandlers.onNodeDrag}
        onNodeDragStop={interactiveHandlers.onNodeDragStop}
        onViewportChange={handleViewportChange}
        defaultViewport={viewport}
        onSelectionChange={handleSelectionChange}
        nodesDraggable={!isExecuting}
        nodesConnectable={!interactionLocked}
        nodeDragThreshold={dragThreshold}
        autoPanSpeed={AUTO_PAN_SPEED}
        fitView={false}
        selectNodesOnDrag={false}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode="Shift"
        proOptions={{ hideAttribution: true }}
        style={{ backgroundColor: bgColor }}
        /* v8 ignore next 3 - COV-BRANCH-142 */
        connectionLineStyle={relocatingEdgeId
          ? { stroke: 'transparent', strokeWidth: 0 }
          : { stroke: '#71717A', strokeWidth: 2 }
        }
        defaultEdgeOptions={{
          style: { stroke: '#71717A', strokeWidth: 2 },
          type: 'default',
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={gridColor}
        />
        <Controls
          showInteractive={false}
          className={resolvedTheme === 'dark' ? 'react-flow-controls-dark' : ''}
        />
      </ReactFlow>

      {/* Ghost edge overlay - uses screen coords via flowToScreenPosition */}
      {!readOnly && proximitySourceId && proximityTargetPos && (
        <GhostEdge sourceNodeId={proximitySourceId} sourceHandleId={proximitySourceHandle} targetPos={proximityTargetPos} />
      )}

      {/* Relocation ghost edge - from original source's egress to cursor/snap target */}
      {/* v8 ignore next 3 - COV-BRANCH-143 */}
      {!readOnly && relocatingEdgeId && relocDragPos && relocatingEdgeRef.current && (
        <GhostEdge sourceNodeId={relocatingEdgeRef.current.source} sourceHandleId={relocatingEdgeRef.current.sourceHandle} targetPos={relocDragPos} testId="relocation-ghost-edge" />
      )}

      {/* Canvas pane right-click context menu - skipped in read-only mode */}
      {!readOnly && (
        <CanvasContextMenu
          open={canvasMenuState.open}
          position={{ x: canvasMenuState.x, y: canvasMenuState.y }}
          flowPosition={{ x: canvasMenuState.flowX, y: canvasMenuState.flowY }}
          onClose={() => setCanvasMenuState((s) => ({ ...s, open: false }))}
          executionStatus={executionStatus}
          onReset={onReset}
          sessionId={sessionId}
        />
      )}

      {/* Edge right-click context menu - skipped in read-only mode */}
      {!readOnly && (
        <EdgeContextMenu
          open={edgeMenuState.open}
          position={{ x: edgeMenuState.x, y: edgeMenuState.y }}
          edgeId={edgeMenuState.edgeId}
          edgeType={edgeMenuState.edgeType}
          onClose={() => setEdgeMenuState((s) => ({ ...s, open: false }))}
        />
      )}

      {/* One Block window per open Block, in edit and read-only modes alike. */}
      {openConfigNodeIds.map((nodeId, index) => (
        <ConfigSheetHost key={nodeId} nodeId={nodeId} cascadeIndex={index} />
      ))}
      <DirtySheetDeleteDialog />
      <DirtySheetDrillDialog />
      <SecretPromotionDialog />
      <FunctionLifecycleDialogs />

      {/* Quick-add popover - top-center over the canvas area (CANVAS-223) */}
      <QuickAddPopover
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        onInsert={handleQuickAddInsert}
        items={QUICK_ADD_BUILTINS}
        functions={quickAddFunctions}
        hasSelection={hasSelection}
      />

      {/* Hint popover toggle - positioned bottom-right near React Flow controls (REQ-4.2.5) */}
      <div className="absolute bottom-2 right-2 z-10">
        <HintPopoverToggle isOpen={hintPopoverOpen} onToggle={handleHintPopoverToggle} />
      </div>

      {/* Keyboard shortcut hint popover (REQ-4.2.5) */}
      {/* v8 ignore next 4 - COV-BRANCH-164 */}
      {hintPopoverOpen && (
        <div className="absolute bottom-12 right-2 z-20 w-64 rounded-md border bg-popover text-popover-foreground shadow-md">
          <InteractionsHintPopover open={hintPopoverOpen} />
        </div>
      )}
      </div>
    </div>
    </CanvasReadOnlyProvider>
  )
}

/** WorkflowCanvas: wraps the inner canvas in a ReactFlowProvider. */
interface WorkflowCanvasProps {
  className?: string
  executionStatus?: string
  onReset?: () => void
  sessionId?: string
  readOnly?: boolean
}

export function WorkflowCanvas({ className, executionStatus, onReset, sessionId, readOnly }: Readonly<WorkflowCanvasProps>) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner className={className} executionStatus={executionStatus} onReset={onReset} sessionId={sessionId} readOnly={readOnly} />
    </ReactFlowProvider>
  )
}
