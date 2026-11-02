/**
 * Workflow Store - REQ-5.2.1.5 Zustand state management stores
 *
 * State management for workflow canvas including node positions, selections,
 * and undo history.
 * - Workflow store maintains canvas state including node positions, selections, and undo history
 * - Canvas specifications: grid pattern, zoom levels, node styles
 * - Node specifications: min/max width, states, execution colors
 * - Connection specifications: stroke width, arrow style, animations
 */

import { createContext, createElement, useContext, useRef, type ReactNode } from 'react'
import { createStore, useStore, type StateCreator } from 'zustand'
import { subscribeWithSelector, persist } from 'zustand/middleware'
import { secureRandomId } from '@/lib/utils'
import {
  clearScriptSyntaxIssues,
  computeNodeIssues,
  scriptSyntaxIssuesByNode,
  setScriptSyntaxIssues,
  type NodeIssue,
  type ScriptSyntaxIssue,
} from '@/features/workbench/lib/validation/compute-node-issues'
import {
  walkActiveSubtree,
  resolveValidDrillDepth,
  applyMutationAtPath,
  applyEdgesMutationAtPath,
  applyVariablesMutationAtPath,
  applyInputsMutationAtPath,
  applyOutputsMutationAtPath,
  isScopeReadOnly,
  type DrillEntry,
} from '@/features/functions/canvas/inner-workflow'
import { reconcileBindingsToContract } from '@/features/functions/lib/edit-mode-draft'
import {
  canonicalizeNodes,
  canonicalizeEdges,
  canonicalEqual,
  stripSharedDrillStamps,
} from '@/features/workbench/lib/canonical-workflow'
import {
  stampSharedFunctionContracts,
  type VersionsByFunction,
} from '@/features/workbench/lib/shared-function-contracts'
import {
  dropBlockFields,
  renameBlockField,
  renameNamesInText,
  rewriteBlockNames,
  type BlockFieldContract,
  type BlockFieldInput,
  type NameRename,
} from '@/features/workbench/lib/saved-block-fields'
import { functionScopeNames, type ScopeBody } from '@/features/workbench/lib/function-scope-rows'
import type { ElementTypes } from '@/lib/variable-validation'
import { validateVariableName } from '@/features/workbench/hooks/use-variable-name-validation'

type WorkflowStoreApi = ReturnType<typeof createWorkflowStore>

// Storage key for persisted editing test state
const EDITING_TEST_STORAGE_KEY = 'wave_editing_test'

interface Position {
  x: number
  y: number
}

// Variable type for workflow variables (test-local only)
export interface WorkflowVariable {
  id: string
  name: string
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  isSecret?: boolean
  isExpression?: boolean
  /** A template string value: {{ }} markers render lazily on reference. Mutually
   *  exclusive with isExpression (REQ-3.1.3.15). */
  isTemplate?: boolean
  /** Array / map only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/** Declared input or output spec on a Function's localDefinition, shaped like a plugin parameter. */
export interface ParamSpec {
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  default?: unknown
  required?: boolean
  secret?: boolean
  /** Enum input only: the allowed values, typed by `type` (REQ-3.1.2.11). */
  enumValues?: unknown[]
  /** Output Kind: `default` holds the expression / template source (VMGR-99). */
  isExpression?: boolean
  isTemplate?: boolean
  /** Free-form parameter description; feeds the config-modal (i) tooltip. */
  description?: string
  /** Array / map default only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

// Namespace variable entry (read-only, for autocomplete)
export interface NamespaceEntry {
  name: string
  type: string
  sources?: string[]
}

export interface NamespaceVariables {
  system: NamespaceEntry[]
  suite: NamespaceEntry[]
  regression: NamespaceEntry[]
}

interface NodeType {
  id: string
  type: 'block' | 'control' | 'parallel' | 'error-handler' | 'workflowNode' | 'noteNode'
  position: Position
  data: {
    label: string
    elementType?: string
    nodeType?: 'control' | 'plugin' | 'function'
    config?: Record<string, unknown>
    /** Per-instance description (multiline, max 64 chars). */
    description?: string
    /** Persisted expand state for the description chevron toggle. */
    descriptionExpanded?: boolean
    version?: string
    hasNewerVersion?: boolean
    disabled?: boolean
    expressionFields?: string[]
    templateFields?: string[]
    variableExpressionKeys?: string[]
    variableTemplateKeys?: string[]
    variableTypes?: Record<string, string>
    /** Variable Setter: each array / map literal row's element types (REQ-3.1.3.19). */
    variableElementTypes?: Record<string, ElementTypes>
    /** Typed block settings: each one's element types (REQ-3.1.3.19). */
    elementTypes?: Record<string, ElementTypes>
    /** Function nodes only: 'local' = inline in this Test, 'shared' = library reference. */
    functionLifecycle?: 'local' | 'shared'
    /** Local Function nodes: inline definition (workflow + inputs + outputs + locals). */
    localDefinition?: {
      workflow: { nodes: NodeType[]; edges: EdgeType[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: WorkflowVariable[]
    }
    /** Shared Function nodes: reference to a library Function by id. */
    functionId?: string
    /** Shared Function instances: pinned library version (e.g. "1.0.0"). */
    functionVersion?: string
    /** Shared Function instances: the pinned version is gone from the library. */
    missingVersion?: boolean
  }
  width?: number
  height?: number
}

interface EdgeType {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  animated?: boolean
  label?: string
  type?: string
}

interface ViewportState {
  x: number
  y: number
  zoom: number
}

/** A Function body as the library returns it (the shape `pushSharedDrill` injects). */
export interface FunctionBodyBaseline {
  workflow: { nodes: NodeType[]; edges: EdgeType[] }
  inputs: unknown[]
  outputs: unknown[]
  variables?: WorkflowVariable[]
}

interface HistoryEntry {
  nodes: NodeType[]
  edges: EdgeType[]
  variables?: WorkflowVariable[]
  timestamp: number
  isInitialState?: boolean
  operationDescription?: string
}

interface WorkflowError {
  type: 'undo_conflict' | 'redo_conflict'
  message: string
}

/** Mirror of the workbench run status, set by the run layer for undo/redo gating. */
type WorkflowExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'passed'
  | 'failed'
  | 'stopped'
  | 'skipped'

/** Outcome modes of the pick-out history surgery. */
type PickOutMode = 'drop' | 'keep-old' | 'set-new' | 'first-publish'

interface EditModePublishOptions {
  mode: 'keep-old' | 'set-new'
  targetContract?: BlockFieldContract
}

export interface DebugOptions {
  pauseOnFirstBlock: boolean
  pauseOnErrors: boolean
}

const DEBUG_OPTIONS_STORAGE_KEY = 'wave.workbench.debugOptions'

const DEFAULT_DEBUG_OPTIONS: DebugOptions = {
  pauseOnFirstBlock: false,
  pauseOnErrors: false,
}

function loadDebugOptionsFromStorage(): DebugOptions {
  try {
    const raw = globalThis.localStorage.getItem(DEBUG_OPTIONS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_DEBUG_OPTIONS }
    const parsed = JSON.parse(raw) as Partial<DebugOptions>
    return {
      pauseOnFirstBlock: !!parsed.pauseOnFirstBlock,
      pauseOnErrors: !!parsed.pauseOnErrors,
    }
  } catch {
    // localStorage can throw if the browser sandbox blocks it, or JSON.parse
    // can throw on a corrupt payload. Either way, fall back to defaults.
    return { ...DEFAULT_DEBUG_OPTIONS }
  }
}

function persistDebugOptions(options: DebugOptions): void {
  globalThis.localStorage.setItem(DEBUG_OPTIONS_STORAGE_KEY, JSON.stringify(options))
}

interface FitViewOptions {
  padding?: number
  duration?: number
}

interface FocusOptions {
  zoom?: number
  duration?: number
}

interface SelectNodeOptions {
  addToSelection?: boolean
}

/** One catalog pull (Get Tables, Get fields), keyed by `kind:stateKey` (SQL-12, OS-13). */
export interface CatalogPullEntry {
  status: 'connecting' | 'reading' | 'loaded' | 'failed'
  jobId: string | null
  data: unknown
  error: string | null
}

interface WorkflowState {
  // Canvas state
  nodes: NodeType[]
  edges: EdgeType[]
  viewport: ViewportState

  // Selection state
  selectedNodeIds: string[]
  selectedEdgeIds: string[]

  // Debug state
  breakpoints: Set<string>
  pausedNodeId: string | null
  debugOptions: DebugOptions

  // Runtime skip - transient, never saved (CANVAS-72)
  skippedNodeIds: string[]

  // Live-derived per-node validation issues (recomputed on nodes/variables changes)
  nodeIssues: Map<string, NodeIssue[]>

  // What the script editor's own parse last reported, per block (PYRUN-13)
  nodeSyntaxIssues: Map<string, ScriptSyntaxIssue[]>

  // Catalog pulls by `kind:stateKey` (SQL-12, OS-13)
  catalogPulls: Map<string, CatalogPullEntry>

  // Transient pulse set: ids of nodes whose alert icon should pulse
  pulseValidationNodeIds: Set<string>

  // Config sheets state - ordered open list (order = cascade slot), cap 10
  openConfigNodeIds: string[]
  // Quick-add Ctrl+Enter anchor; survives deselection, released on removal
  lastInteractedNodeId: string | null
  // Sheets with unsaved form edits (reported by the sheet components); gates
  // delete confirmation and the close/switch prompts
  dirtyConfigNodeIds: string[]
  // Delete request intercepted because a selected node's sheet is dirty;
  // the canvas renders the confirmation dialog
  pendingDeleteNodeIds: string[] | null
  // Drill navigation intercepted because a sheet is dirty (scope changes
  // reset sheet form state); the canvas renders the confirmation dialog
  pendingDrillAction: { run: () => void } | null
  // A block Save held until the person confirms it turns these plain variables secret (REQ-4.5.20)
  pendingSecretPromotion: { names: string[]; save: () => void } | null

  // Function lifecycle dialog state
  publishDialogNodeId: string | null
  makeLocalDialogNodeId: string | null
  // edit-mode lifecycle dialogs
  publishEditModeDialogNodeId: string | null
  dropChangesDialogNodeId: string | null
  // Dig-in (Open) in-flight state - drives the glyph spinner + the click lock
  digInPendingNodeId: string | null
  // Lifted because the "From library" link on the Function Block window
  // also opens the same modal. LivePalette consumes this flag instead of
  // owning local state. `functionLibraryInitialSearch` carries an optional
  // search query that pre-fills the library's filter when opened from the
  // link (so the user lands on the source Function); the palette button
  // opens it with an empty query for the unfiltered library view.
  //
  // `functionLibraryRevision` is bumped any time the underlying library
  // state has changed (publish, publish-edit-mode, delete-version, ...).
  // The Functions Library modal effects on this counter so an open modal
  // refetches automatically without the user having to close/reopen it.
  // The refresh button inside the modal bumps the same counter so the
  // user has a manual trigger when an external change is suspected.
  isFunctionLibraryOpen: boolean
  functionLibraryInitialSearch: string
  functionLibraryRevision: number

  // Workflow variables (test-local only)
  variables: WorkflowVariable[]

  // Namespace variables (read-only, for autocomplete)
  namespaceVariables: NamespaceVariables

  // Undo/Redo
  history: HistoryEntry[]
  historyIndex: number
  maxHistoryLength: number

  // Clipboard
  clipboard: { nodes: NodeType[]; edges: EdgeType[] } | null
  clipboardSource: 'copy' | 'cut' | null

  // Dirty state - DERIVED: canonical(current canvas) != canonical(saved baseline)
  isDirty: boolean
  lastSavedAt: number | null

  // Undo/redo gating inputs - set by the run and save layers
  executionStatus: WorkflowExecutionStatus
  saveInFlight: boolean

  // Drill state - nested local Function navigation
  drillPath: DrillEntry[]

  // Currently editing test (persists across route changes)
  editingTestId: string | null
  editingTestName: string | null
  // Suite membership of the editing test. Needed so workbench listeners
  // (e.g. ``regression-variables-changed``) can filter updates to events
  // that actually concern the currently-open test.
  editingTestSuiteIds: string[]

  // Library-View mode: set when the workbench is booted to view/run a Published
  // Function standalone (no parent Test). null in the normal Test workbench.
  functionViewMode: { functionId: string; version: string; editable: boolean; name?: string } | null
  /** The library View's body as loaded or last published: the client-side baseline its secrets compare to. */
  functionViewBaseline: { nodeId: string; body: FunctionBodyBaseline } | null

  // Error state (REQ-5.2.1.24)
  lastError: WorkflowError | null

  // Accessibility (REQ-5.2.1.24)
  lastAnnouncement: string
  // Monotonic counter incremented on every undo/redo that actually fires.
  // Lets subscribers (e.g. the toast hook) detect a repeat operation even
  // when lastAnnouncement is the same string as before.
  announcementSeq: number

  // Canvas readiness (loading experience)
  isCanvasReady: boolean

  // FitView coordination with React Flow
  fitViewRequested: boolean
  fitViewOptions: FitViewOptions | null

  // Focus Current coordination with React Flow (watch-mode jump + navigation)
  focusRequested: boolean
  focusNodeId: string | null
  focusOptions: FocusOptions | null

  // Build-active node while mirroring a live watch-mode build (block pulse)
  mirrorActiveNodeId: string | null

  // Last changed block while mirroring (drives Follow Changes + the change
  // pulse; any nesting depth). The tick increments on every change so the same
  // block re-pulses and Follow re-centers when it changes again.
  mirrorLastChangeNodeId: string | null
  mirrorChangeTick: number

  // Edge drag state (for dynamic ingress "+" handle visibility)
  isDraggingEdge: boolean
  draggingEdgeSourceId: string | null
  setDraggingEdge: (isDragging: boolean, sourceId?: string | null) => void

  // Operation grouping state (REQ-5.2.1.24)
  isDragging: boolean
  isInTransaction: boolean
  dragStartState: { nodes: NodeType[]; edges: EdgeType[]; variables: WorkflowVariable[] } | null
  transactionStartState: { nodes: NodeType[]; edges: EdgeType[]; variables: WorkflowVariable[] } | null
  groupingDebounceTimer: ReturnType<typeof setTimeout> | null

  // Actions
  /** Replace the drilled scope's Blocks (the whole canvas at the Test root). */
  setNodes: (nodes: NodeType[], options?: { skipDirty?: boolean }) => void
  /** Replace the whole canvas tree, every Function body included, whatever scope is drilled. */
  setNodeTree: (nodes: NodeType[], options?: { skipDirty?: boolean }) => void
  setEdges: (edges: EdgeType[], options?: { skipDirty?: boolean }) => void
  /** Mirror-apply a holder's draft snapshot at root: no history, never dirty. */
  applyMirroredGraph: (snapshot: {
    nodes: NodeType[]
    edges: EdgeType[]
    variables: WorkflowVariable[]
  }) => void
  /** Stamp every Shared instance, at any depth and in every history entry, with its pinned contract. */
  applyFunctionContracts: (versions: VersionsByFunction) => void
  addNode: (node: NodeType) => void
  updateNode: (id: string, updates: Partial<NodeType>) => void
  updateNodeWithGrouping: (id: string, updates: Partial<NodeType>) => void
  removeNode: (id: string) => void
  addEdge: (edge: EdgeType) => void
  removeEdge: (id: string) => void
  updateEdgeType: (id: string, type: string) => void

  setSelectedNodes: (ids: string[]) => void
  setSelectedEdges: (ids: string[]) => void
  clearSelection: () => void
  selectAll: () => void
  selectNode: (nodeId: string, options?: SelectNodeOptions) => void
  deselectAll: () => void

  // Rubber-band & chain selection (REQ-4.2.5)
  selectNodesInRect: (rect: Rect) => void
  chainSelect: (clickedNodeId: string) => void
  handleShiftPaneClick: (clickPoint: Position) => void

  // Config sheets
  openConfigModal: (nodeId: string) => void
  closeConfigModal: (nodeId: string) => void
  closeAllConfigModals: () => void
  setConfigSheetDirty: (nodeId: string, dirty: boolean) => void
  // Delete flow: request -> confirm/cancel when a dirty sheet is affected
  requestDeleteSelected: () => void
  confirmPendingDelete: () => void
  cancelPendingDelete: () => void
  // Drill flow: user-initiated drills ask first when any sheet is dirty
  requestDrill: (run: () => void) => void
  confirmPendingDrill: () => void
  cancelPendingDrill: () => void
  // Save warning flow: a Save that makes plain variables secret waits for confirm/cancel
  requestSecretPromotion: (names: string[], save: () => void) => void
  confirmSecretPromotion: () => void
  cancelSecretPromotion: () => void

  // Function lifecycle dialogs
  openPublishDialog: (nodeId: string) => void
  closePublishDialog: () => void
  openMakeLocalDialog: (nodeId: string) => void
  closeMakeLocalDialog: () => void
  // edit-mode lifecycle dialogs + draft actions
  openPublishEditModeDialog: (nodeId: string) => void
  closePublishEditModeDialog: () => void
  openDropChangesDialog: (nodeId: string) => void
  closeDropChangesDialog: () => void
  setFunctionLibraryOpen: (open: boolean, initialSearch?: string) => void
  bumpFunctionLibraryRevision: () => void
  applyEditModeEntered: (
    nodeId: string,
    nodeData: Record<string, unknown>,
    persisted?: boolean,
  ) => void
  applyEditModeDropped: (nodeId: string, nodeData: Record<string, unknown>) => void
  applyEditModePublished: (
    nodeId: string,
    nodeData: Record<string, unknown>,
    options?: EditModePublishOptions,
  ) => void
  /** Shared-to-local rewrite performed in-store with exactly ONE history entry. */
  applyMakeLocal: (nodeId: string, nodeData: Record<string, unknown>) => void
  /** Local-to-shared rewrite via pick-out surgery; NO undoable conversion entry. */
  applyFirstPublish: (nodeId: string, nodeData: Record<string, unknown>) => void
  /** True when the test tree still carries any Function in edit mode (drives
   *  the close-time OK-only edit-mode nag). */
  hasEditModeNodes: () => boolean
  setDigInPending: (nodeId: string) => void
  clearDigInPending: () => void

  // Variables
  /** `functionPath` names the scope to write into (VMGR-102); the drill path when absent. */
  addVariable: (variable: Omit<WorkflowVariable, 'id'>, functionPath?: DrillEntry[]) => WorkflowVariable
  /** `functionPath` names the scope the variable lives in; the drill path when absent. */
  updateVariable: (id: string, updates: Partial<Omit<WorkflowVariable, 'id'>>, functionPath?: DrillEntry[]) => void
  removeVariable: (id: string) => void
  setVariables: (variables: WorkflowVariable[], options?: { skipDirty?: boolean }) => void
  /** `functionPath` names the scope the variable lives in; the drill path when absent. */
  renameVariable: (id: string, newName: string, functionPath?: DrillEntry[]) => { success: boolean; error?: string }

  // Namespace variables (read-only, for autocomplete)
  setNamespaceVariables: (namespace: keyof NamespaceVariables, entries: NamespaceEntry[]) => void
  clearNamespaceVariables: () => void

  // Declared input/output parameters on the active Function (drilled-in only)
  addInputParam: (spec: ParamSpec, functionPath?: DrillEntry[]) => void
  removeInputParam: (name: string) => void
  addOutputParam: (spec: ParamSpec, functionPath?: DrillEntry[]) => void
  removeOutputParam: (name: string) => void
  /** Update or rename an input of the Function `functionPath` names, else the drilled one. */
  updateInputParam: (
    oldName: string,
    updates: Partial<ParamSpec>,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  /** Mirror of updateInputParam for outputs. */
  updateOutputParam: (
    oldName: string,
    updates: Partial<ParamSpec>,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }

  // Debug
  hasBreakpoint: (nodeId: string) => boolean
  toggleBreakpoint: (nodeId: string) => void
  getBreakpointList: () => string[]
  clearBreakpoints: () => void
  clearBreakpointsOnTestClose: () => void
  setPausedNodeId: (nodeId: string | null) => void
  setDebugOptions: (options: DebugOptions) => void

  // Disable/Skip/Unlink (CANVAS-71, CANVAS-72, CANVAS-145)
  toggleDisable: (nodeId: string) => void
  toggleSkip: (nodeId: string) => void
  unlinkNode: (nodeId: string) => void
  unskipAll: () => void
  enableAll: () => void

  setNodeSyntaxIssues: (nodeId: string, issues: ScriptSyntaxIssue[]) => void

  setCatalogPull: (key: string, entry: CatalogPullEntry) => void
  removeCatalogPull: (key: string) => void
  clearCatalogPulls: () => void

  // Pulse validation actions (transient pulse set, populated on modal close)
  setPulseValidationNodeIds: (ids: string[]) => void
  clearPulseValidationNodeId: (nodeId: string) => void

  setViewport: (viewport: ViewportState) => void
  zoomIn: () => void
  zoomOut: () => void
  fitView: (options?: FitViewOptions) => void
  setCanvasReady: (ready: boolean) => void
  requestFitView: (options?: FitViewOptions) => void
  acknowledgeFitView: () => void
  requestFocus: (nodeId: string, options?: FocusOptions) => void
  acknowledgeFocus: () => void
  setMirrorActiveNodeId: (id: string | null) => void
  signalMirrorChange: (id: string | null) => void
  setDirty: (dirty: boolean) => void
  resetZoom: () => void

  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  commitHistory: (operationDescription?: string) => void

  copy: () => void
  paste: (offset?: Position) => void
  cut: () => void
  duplicate: () => void

  // Edge operations
  relocateEdge: (oldEdgeId: string, newEdge: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }) => void

  // Batch operations (REQ-5.2.1.24)
  deleteSelected: () => void
  disconnectSelected: () => void
  moveSelectedNodes: (delta: Position) => void

  // Operation grouping (REQ-5.2.1.24)
  startDragOperation: () => void
  endDragOperation: () => void
  cancelDragOperation: () => void
  transaction: (callback: () => void, description?: string) => void

  markSaved: () => void
  reset: () => void
  clearError: () => void

  // Undo/redo gating inputs
  setExecutionStatus: (status: WorkflowExecutionStatus) => void
  setSaveInFlight: (inFlight: boolean) => void

  // Editing test state
  setEditingTest: (testId: string | null, testName: string | null) => void
  setEditingTestSuiteIds: (suiteIds: string[]) => void
  clearEditingTest: () => void

  // Library-View mode (standalone Published Function view/run)
  enterFunctionView: (mode: { functionId: string; version: string; editable: boolean; name?: string }) => void
  exitFunctionView: () => void
  setFunctionViewBaseline: (baseline: { nodeId: string; body: FunctionBodyBaseline } | null) => void
  setFunctionViewVersion: (version: string) => void

  // Drill actions
  pushDrill: (nodeId: string) => void
  /**
   * Drill into a shared (published) Function instance. The library entry is
   * fetched by the caller; this action injects the resolved body as the
   * shared node's `localDefinition` (transient - stripped on save by
   * `sanitizeNodesForSave`) so the standard drill machinery can render it.
   * Read-only enforcement is handled separately via `isCurrentScopeReadOnly`.
   */
  pushSharedDrill: (
    nodeId: string,
    resolvedDefinition: {
      workflow: { nodes: NodeType[]; edges: EdgeType[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: WorkflowVariable[]
    },
  ) => void
  /** Replace the deepest drilled-into shared node's localDefinition with a freshly resolved body (drillPath unchanged); used after Drop changes. */
  refreshSharedDrillBody: (
    nodeId: string,
    resolvedDefinition: {
      workflow: { nodes: NodeType[]; edges: EdgeType[] }
      inputs: unknown[]
      outputs: unknown[]
      variables?: WorkflowVariable[]
    },
  ) => void
  popDrillOne: () => void
  popDrillTo: (depth: number) => void
  clearDrill: () => void
  /**
   * True when the active drill scope is read-only. A drill scope becomes
   * read-only when any entry in `drillPath` references a shared (published)
   * Function node. The Test canvas and locally-drilled Function bodies are
   * never read-only.
   */
  isCurrentScopeReadOnly: () => boolean

  // Active-subtree selectors (return root tree when drillPath empty,
  // deepest Function's localDefinition when drilled in).
  getActiveNodes: () => NodeType[]
  getActiveEdges: () => EdgeType[]
  getActiveVariables: () => WorkflowVariable[]

  // Derived selectors
  getSelectedNodes: () => NodeType[]
  getSelectedEdges: () => EdgeType[]
  getNodeCount: () => number
  getEdgeCount: () => number
  getNodesByType: (type: NodeType['type']) => NodeType[]
  getConnectedNodes: (nodeId: string) => NodeType[]
  getEdgesBySource: (sourceId: string) => EdgeType[]
  getEdgesByTarget: (targetId: string) => EdgeType[]
  hasUnsavedChanges: () => boolean
  /** The variables as of the last save (the dirty baseline). Used to tell whether
   *  a secret's value is still unsaved (visible) vs persisted (masked). */
  getSavedVariables: () => WorkflowVariable[]
  /** The canvas nodes as of the last save (canonical, so Local Function bodies are in them). */
  getSavedNodes: () => NodeType[]
  isNodeSelected: (nodeId: string) => boolean
  prefersReducedMotion: () => boolean
}

// Default node dimensions when not measured yet
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 80

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Strip the transient `localDefinition` stamped by `pushSharedDrill` from
 *  any Shared whose drill scope was just exited. */
function cleanupSharedDrillResidue(
  nodes: NodeType[],
  prevPath: DrillEntry[],
  nextPath: DrillEntry[],
): NodeType[] {
  // Compute the set of node ids that were on the path but are no longer -
  // those are the ones whose Shared body residue (if any) needs stripping.
  const stillOnPath = new Set(nextPath.map((entry) => entry.nodeId))
  const exitedIds = prevPath
    .map((entry) => entry.nodeId)
    .filter((id) => !stillOnPath.has(id))
  if (exitedIds.length === 0) return nodes
  return stripSharedDrillStamps(nodes, { only: new Set(exitedIds) })
}

/** Deep-walk the tree, merge `patch` into the node matching `targetId`.
 *  `clearEditModeMarkers` additionally drops editMode/draft/upstreamLink. */
function mergeNodeDataDeep(
  nodes: NodeType[],
  targetId: string,
  patch: Record<string, unknown>,
  clearEditModeMarkers: boolean,
): NodeType[] {
  let mutated = false
  const next = nodes.map((node) => {
    if (node.id === targetId) {
      mutated = true
      const merged: Record<string, unknown> = { ...node.data, ...patch }
      if (clearEditModeMarkers) {
        delete merged.editMode
        delete merged.draft
        delete merged.upstreamLink
      }
      return { ...node, data: merged as NodeType['data'] }
    }
    const localDef = node.data.localDefinition as
      | {
          workflow: { nodes: NodeType[]; edges: EdgeType[] }
          inputs: unknown[]
          outputs: unknown[]
          variables?: WorkflowVariable[]
        }
      | undefined
    if (!localDef?.workflow?.nodes) return node
    const innerNext = mergeNodeDataDeep(
      localDef.workflow.nodes,
      targetId,
      patch,
      clearEditModeMarkers,
    )
    if (innerNext === localDef.workflow.nodes) return node
    mutated = true
    return {
      ...node,
      data: {
        ...node.data,
        localDefinition: {
          ...localDef,
          workflow: { ...localDef.workflow, nodes: innerNext },
        },
      },
    }
  })
  return mutated ? next : nodes
}


/** Recursively find a node by id (top-level + nested localDefinition bodies). */
function findNodeDeep(nodes: NodeType[], targetId: string): NodeType | null {
  for (const node of nodes) {
    if (node.id === targetId) return node
    const localDef = node.data?.localDefinition as
      | { workflow?: { nodes?: NodeType[] } }
      | undefined
    const innerNodes = localDef?.workflow?.nodes
    if (Array.isArray(innerNodes)) {
      const found = findNodeDeep(innerNodes, targetId)
      if (found) return found
    }
  }
  return null
}

/** True when any node in ``nodes`` (or nested local-Function bodies) carries an
 *  edit-mode marker. Drives the close-time edit-mode nag. Mirrors
 *  ``findNodeDeep``'s deep walk but matches on the editMode predicate. */
function anyEditModeNode(nodes: NodeType[]): boolean {
  for (const node of nodes) {
    if ((node.data as Record<string, unknown>)?.editMode === true) return true
    const localDef = node.data?.localDefinition as
      | { workflow?: { nodes?: NodeType[] } }
      | undefined
    const innerNodes = localDef?.workflow?.nodes
    if (Array.isArray(innerNodes) && anyEditModeNode(innerNodes)) return true
  }
  return false
}

/** Deep-walk the tree, replacing the matching node's data wholesale (the
 *  lifecycle rewrites swap the entire shape, e.g. local <-> shared form). */
function replaceNodeDataDeep(
  nodes: NodeType[],
  targetId: string,
  data: Record<string, unknown>,
): NodeType[] {
  let mutated = false
  const next = nodes.map((node) => {
    if (node.id === targetId) {
      mutated = true
      return { ...node, data: { ...data } as NodeType['data'] }
    }
    const localDef = node.data.localDefinition
    if (!localDef?.workflow?.nodes) return node
    const innerNext = replaceNodeDataDeep(localDef.workflow.nodes, targetId, data)
    if (innerNext === localDef.workflow.nodes) return node
    mutated = true
    return {
      ...node,
      data: {
        ...node.data,
        localDefinition: {
          ...localDef,
          workflow: { ...localDef.workflow, nodes: innerNext },
        },
      },
    }
  })
  return mutated ? next : nodes
}

/** Canonical structural equality of two history snapshots:
 *  key-order insensitive AND blind to selection/drag/transient residue, so
 *  surgery dedup cannot retain dead entries that differ in residue only. */
function historySnapshotEqual(a: HistoryEntry, b: HistoryEntry): boolean {
  return (
    canonicalEqual(canonicalizeNodes(a.nodes), canonicalizeNodes(b.nodes)) &&
    canonicalEqual(canonicalizeEdges(a.edges), canonicalizeEdges(b.edges)) &&
    canonicalEqual(a.variables ?? [], b.variables ?? [])
  )
}

/** Single commit core: truncate the redo tail, append, evict the oldest
 *  NON-baseline entry at the cap (the baseline is never evicted). */
function appendHistoryEntry(
  state: Pick<WorkflowState, 'history' | 'historyIndex' | 'maxHistoryLength'>,
  entry: HistoryEntry,
): { history: HistoryEntry[]; historyIndex: number } {
  const newHistory = state.history.slice(0, state.historyIndex + 1)
  newHistory.push(entry)
  while (newHistory.length > state.maxHistoryLength) {
    const evictIdx = newHistory.findIndex((e) => !e.isInitialState)
    if (evictIdx === -1) break
    newHistory.splice(evictIdx, 1)
  }
  return { history: newHistory, historyIndex: newHistory.length - 1 }
}

/** Stable empty fallback so the getSavedVariables selector keeps a constant ref
 *  (no baseline yet) and never forces a spurious re-render. */
const EMPTY_SAVED_VARIABLES: WorkflowVariable[] = []
const EMPTY_SAVED_NODES: NodeType[] = []

/** The saved-baseline entry derived dirty compares against. */
function findBaselineEntry(history: HistoryEntry[]): HistoryEntry | undefined {
  return history.find((entry) => entry.isInitialState) ?? history[0]
}

/** Derived dirty: canonical(current canvas) != canonical(saved baseline). */
function computeDerivedDirty(
  state: Pick<WorkflowState, 'nodes' | 'edges' | 'variables' | 'history' | 'isDirty'>,
): boolean {
  const baseline = findBaselineEntry(state.history)
  if (!baseline) return state.isDirty
  return !(
    canonicalEqual(canonicalizeNodes(state.nodes), canonicalizeNodes(baseline.nodes)) &&
    canonicalEqual(canonicalizeEdges(state.edges), canonicalizeEdges(baseline.edges)) &&
    canonicalEqual(state.variables, baseline.variables ?? [])
  )
}

/** Open-sheet cap: the 11th open is refused; the canvas layer toasts. */
export const MAX_OPEN_CONFIG_SHEETS = 10

/** Drop config sheets + the last-interacted anchor whose nodes no longer
 *  exist anywhere in the post-removal tree (deep: deleting a Function also
 *  releases sheets opened on its body nodes). */
function releaseRemovedNodeRefs(
  state: Pick<
    WorkflowState,
    'openConfigNodeIds' | 'lastInteractedNodeId' | 'dirtyConfigNodeIds'
  >,
  remainingNodes: NodeType[],
): Pick<
  WorkflowState,
  'openConfigNodeIds' | 'lastInteractedNodeId' | 'dirtyConfigNodeIds'
> {
  const stillInTree = (id: string): boolean => findNodeDeep(remainingNodes, id) !== null
  return {
    openConfigNodeIds: state.openConfigNodeIds.filter(stillInTree),
    dirtyConfigNodeIds: state.dirtyConfigNodeIds.filter(stillInTree),
    lastInteractedNodeId:
      state.lastInteractedNodeId !== null && !stillInTree(state.lastInteractedNodeId)
        ? null
        : state.lastInteractedNodeId,
  }
}

/** Reconcile drill location + UI refs against a restored/rewritten tree:
 *  pop to the nearest valid ancestor scope, strip shared-drill residue outside
 *  the reconciled path, and release refs absent from the restored tree. */
function reconcileRestoredState(
  state: WorkflowState,
  restored: { nodes: NodeType[]; edges: EdgeType[]; variables: WorkflowVariable[] },
): Partial<WorkflowState> & Pick<WorkflowState, 'nodes'> {
  const validDepth = resolveValidDrillDepth(restored.nodes, state.drillPath)
  const drillPath =
    validDepth === state.drillPath.length ? state.drillPath : state.drillPath.slice(0, validDepth)
  const keepIds = new Set(drillPath.map((entry) => entry.nodeId))
  const nodes = stripSharedDrillStamps(restored.nodes, { keep: keepIds })

  const active = walkActiveSubtree(nodes, restored.edges, restored.variables, drillPath)
  const activeNodeIds = new Set(active.nodes.map(pluckId))
  const activeEdgeIds = new Set(active.edges.map(pluckId))
  const inTree = (id: string | null): boolean => id !== null && findNodeDeep(nodes, id) !== null
  const breakpoints = new Set([...state.breakpoints].filter((id) => inTree(id)))

  return {
    nodes,
    drillPath,
    selectedNodeIds: state.selectedNodeIds.filter((id) => activeNodeIds.has(id)),
    selectedEdgeIds: state.selectedEdgeIds.filter((id) => activeEdgeIds.has(id)),
    breakpoints,
    openConfigNodeIds: state.openConfigNodeIds.filter((id) => inTree(id)),
    dirtyConfigNodeIds: state.dirtyConfigNodeIds.filter((id) => inTree(id)),
    lastInteractedNodeId: inTree(state.lastInteractedNodeId)
      ? state.lastInteractedNodeId
      : null,
    publishDialogNodeId: inTree(state.publishDialogNodeId) ? state.publishDialogNodeId : null,
    makeLocalDialogNodeId: inTree(state.makeLocalDialogNodeId) ? state.makeLocalDialogNodeId : null,
    publishEditModeDialogNodeId: inTree(state.publishEditModeDialogNodeId)
      ? state.publishEditModeDialogNodeId
      : null,
    dropChangesDialogNodeId: inTree(state.dropChangesDialogNodeId)
      ? state.dropChangesDialogNodeId
      : null,
    digInPendingNodeId: inTree(state.digInPendingNodeId) ? state.digInPendingNodeId : null,
  }
}

interface PickOutParams {
  nodeId: string
  nodeData: Record<string, unknown>
  mode: PickOutMode
  targetContract?: BlockFieldContract
}

/** Normalize one retained entry to the resulting pinned form (per mode). */
function normalizePickOutEntry(entry: HistoryEntry, params: PickOutParams): HistoryEntry {
  if (params.mode === 'first-publish') {
    return { ...entry, nodes: replaceNodeDataDeep(entry.nodes, params.nodeId, params.nodeData) }
  }
  if (entry.isInitialState) return entry
  const reverted = stripSharedDrillStamps(
    mergeNodeDataDeep(entry.nodes, params.nodeId, {}, true),
    { only: new Set([params.nodeId]) },
  )
  return { ...entry, nodes: reverted }
}

/** Rewrite the live tree to the resulting pinned form (per mode). */
function rewriteLiveNodes(state: WorkflowState, params: PickOutParams): NodeType[] {
  const { nodeId, nodeData, mode, targetContract } = params
  // The contract the Block followed before the publish: its new choice inputs start on their defaults.
  const previousInputs = (findNodeDeep(state.nodes, nodeId)?.data as Record<string, unknown> | undefined)?.resolvedInputs
  const previous = Array.isArray(previousInputs) ? { inputs: previousInputs as BlockFieldInput[], outputs: [] } : undefined
  let nodes =
    mode === 'first-publish'
      ? replaceNodeDataDeep(state.nodes, nodeId, nodeData)
      : mergeNodeDataDeep(state.nodes, nodeId, nodeData, true)
  if (mode === 'drop') {
    nodes = stripSharedDrillStamps(nodes, { only: new Set([nodeId]) })
  }
  if (targetContract) {
    const current = findNodeDeep(nodes, nodeId)
    if (current) {
      const reconciled = reconcileBindingsToContract(
        current.data as Record<string, unknown>,
        targetContract,
        previous,
      )
      if (reconciled !== current.data) {
        nodes = mergeNodeDataDeep(nodes, nodeId, reconciled, false)
      }
    }
  }
  return nodes
}

/** Description of the canvas-equals-tip entry appended when the rewritten
 *  canvas diverges from the last retained entry. */
function pickOutTipDescription(mode: PickOutMode, label: string, oldVersion: string): string {
  if (mode === 'drop') return 'Drop changes'
  if (mode === 'keep-old') return `${label} published (kept ${oldVersion})`
  return `${label} published`
}

/**
 * Pick-out surgery engine: per-entry normalization
 * of one Function's changes (nested included) to the resulting pinned form,
 * no-op dedupe, redo-tail truncation, optional single version-change tip
 * entry (set-new only), and drill/ref reconciliation.
 */
function computePickOutState(state: WorkflowState, params: PickOutParams): Partial<WorkflowState> {
  const { nodeId, nodeData, mode } = params
  const currentData = (findNodeDeep(state.nodes, nodeId)?.data ?? {}) as Record<string, unknown>
  const upstream = currentData.upstreamLink as { sourceVersion?: string } | undefined
  const oldVersion =
    upstream?.sourceVersion ?? (currentData.functionVersion as string | undefined) ?? ''
  const newVersion = (nodeData.functionVersion as string | undefined) ?? oldVersion
  const label =
    (nodeData.label as string | undefined) ?? (currentData.label as string | undefined) ?? 'Function'

  const deduped: HistoryEntry[] = []
  for (const original of state.history.slice(0, state.historyIndex + 1)) {
    const normalized = normalizePickOutEntry(original, params)
    const prev = deduped.at(-1)
    if (prev && historySnapshotEqual(prev, normalized)) continue
    deduped.push(normalized)
  }

  const liveNodes = rewriteLiveNodes(state, params)
  const reconciled = reconcileRestoredState(state, {
    nodes: liveNodes,
    edges: state.edges,
    variables: state.variables,
  })
  const tipSnapshot: HistoryEntry = {
    nodes: [...reconciled.nodes],
    edges: [...state.edges],
    variables: [...state.variables],
    timestamp: Date.now(),
    operationDescription:
      mode === 'set-new'
        ? `${label} ver changed (${oldVersion} -> ${newVersion})`
        : pickOutTipDescription(mode, label, oldVersion),
  }
  const needsTip =
    mode === 'set-new' || !deduped.at(-1) || !historySnapshotEqual(deduped.at(-1)!, tipSnapshot)
  let history = deduped
  let historyIndex = deduped.length - 1
  if (needsTip) {
    const appended = appendHistoryEntry(
      { history: deduped, historyIndex: deduped.length - 1, maxHistoryLength: state.maxHistoryLength },
      tipSnapshot,
    )
    history = appended.history
    historyIndex = appended.historyIndex
  }
  const isDirty = computeDerivedDirty({
    nodes: reconciled.nodes,
    edges: state.edges,
    variables: state.variables,
    history,
    isDirty: state.isDirty,
  })
  return { ...reconciled, history, historyIndex, isDirty }
}

/**
 * Build a `(innerNodes) => innerNodes'` mutator that replaces the matching
 * node with a copy carrying `resolvedDefinition` as its `localDefinition`.
 * Used by `pushSharedDrill` to inject the library body at the current drill
 * level without inflating that action's nesting depth (Sonar S2004).
 */
function injectLocalDefinition(
  targetId: string,
  resolvedDefinition: NodeType['data']['localDefinition'],
): (innerNodes: NodeType[]) => NodeType[] {
  return (innerNodes) =>
    innerNodes.map((n) =>
      n.id === targetId
        ? { ...n, data: { ...n.data, localDefinition: resolvedDefinition } }
        : n,
    )
}

/**
 * Pure geometry helper: checks if a rectangle intersects a node's bounding box.
 * Uses strict inequality (touching at edges only = no intersection).
 * Returns false for zero-area rectangles.
 */
export function rectangleIntersectsNode(rect: Rect, node: NodeType): boolean {
  if (rect.width === 0 || rect.height === 0) return false

  const nodeWidth = node.width ?? DEFAULT_NODE_WIDTH
  const nodeHeight = node.height ?? DEFAULT_NODE_HEIGHT

  const rectLeft = rect.x
  const rectRight = rect.x + rect.width
  const rectTop = rect.y
  const rectBottom = rect.y + rect.height

  const nodeLeft = node.position.x
  const nodeRight = node.position.x + nodeWidth
  const nodeTop = node.position.y
  const nodeBottom = node.position.y + nodeHeight

  return (
    rectLeft < nodeRight &&
    rectRight > nodeLeft &&
    rectTop < nodeBottom &&
    rectBottom > nodeTop
  )
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const DEFAULT_PASTE_OFFSET = 20
const TEXT_INPUT_DEBOUNCE_MS = 500

/**
 * Generate a unique ID for nodes/edges
 */
function generateId(): string {
  return `${Date.now()}-${secureRandomId(9)}`
}

const renameTo =
  (oldName: string, newName: string): NameRename =>
  (name) => (name === oldName ? newName : name)

/** The text kind a computed variable or parameter source reads as; null for a literal. */
function computedKind(entry: { isExpression?: boolean; isTemplate?: boolean }): 'expression' | 'template' | null {
  if (entry.isExpression) return 'expression'
  if (entry.isTemplate) return 'template'
  return null
}

// The renamed variable gets the new name; every other computed variable's references follow it.
function applyRenameToVariables(
  variables: WorkflowVariable[],
  id: string,
  oldName: string,
  newName: string,
): WorkflowVariable[] {
  const rename = renameTo(oldName, newName)
  return variables.map((variable) => {
    if (variable.id === id) return { ...variable, name: newName }
    const kind = computedKind(variable)
    if (kind === null || typeof variable.value !== 'string') return variable
    const value = renameNamesInText(variable.value, kind, rename)
    return value === variable.value ? variable : { ...variable, value }
  })
}

/** Expression / Template parameter sources (an output's Kind) follow a rename. */
function renameParamSources(params: ParamSpec[], rename: NameRename): ParamSpec[] {
  return params.map((param) => {
    const kind = computedKind(param)
    if (kind === null || typeof param.default !== 'string') return param
    const source = renameNamesInText(param.default, kind, rename)
    return source === param.default ? param : { ...param, default: source }
  })
}

/** Names already taken in one scope: Test variables at the root, else the Function's inputs, outputs and locals. */
export function activeScopeNames(
  nodes: NodeType[],
  edges: EdgeType[],
  variables: WorkflowVariable[],
  drillPath: DrillEntry[],
): string[] {
  const active = walkActiveSubtree(nodes, edges, variables, drillPath)
  if (!active.localDefinition) return active.variables.map((v) => v.name)
  return functionScopeNames(active.localDefinition as ScopeBody)
    .filter((entry) => entry.kind !== 'profile')
    .map((entry) => entry.name)
}

/**
 * Compact ingress targetHandle values when edges are removed from a node.
 * First remaining edge gets default (no targetHandle), subsequent edges
 * get sequential ingress_1, ingress_2, etc. This ensures handles render
 * correctly without gaps.
 */
function edgeIsDisconnected(
  edge: EdgeType,
  selectedEdgeIdSet: Set<string>,
  selectedNodeIdSet: Set<string>,
): boolean {
  return (
    selectedEdgeIdSet.has(edge.id) ||
    selectedNodeIdSet.has(edge.source) ||
    selectedNodeIdSet.has(edge.target)
  )
}

/** Recompute the edge set after a disconnect: drop edges that touch selected
 *  nodes or are themselves selected, then compact ingress handles on every
 *  target whose ingress fan changed. */
function computeDisconnectedEdges(
  sourceEdges: EdgeType[],
  selectedEdgeIdSet: Set<string>,
  selectedNodeIdSet: Set<string>,
): EdgeType[] {
  const affectedTargets = new Set<string>()
  for (const edge of sourceEdges) {
    if (edgeIsDisconnected(edge, selectedEdgeIdSet, selectedNodeIdSet)) {
      affectedTargets.add(edge.target)
      affectedTargets.add(edge.source)
    }
  }
  let edges = sourceEdges.filter(
    (edge) => !edgeIsDisconnected(edge, selectedEdgeIdSet, selectedNodeIdSet),
  )
  for (const targetId of affectedTargets) {
    edges = migrateIngressHandles(edges, targetId)
  }
  return edges
}

/** Shift every selected node by ``delta`` while preserving non-selected
 *  nodes untouched (referential equality preserved for unmoved entries). */
function shiftSelectedNodes(
  nodes: NodeType[],
  selectedNodeIdSet: Set<string>,
  delta: Position,
): NodeType[] {
  return nodes.map((node) => shiftSingleNode(node, selectedNodeIdSet, delta))
}

function shiftSingleNode(
  node: NodeType,
  selectedNodeIdSet: Set<string>,
  delta: Position,
): NodeType {
  if (!selectedNodeIdSet.has(node.id)) return node
  return {
    ...node,
    position: {
      x: node.position.x + delta.x,
      y: node.position.y + delta.y,
    },
  }
}

function migrateIngressHandles(edges: EdgeType[], nodeId: string): EdgeType[] {
  const ingressEdges = edges.filter((e) => e.target === nodeId)
  if (ingressEdges.length === 0) return edges
  if (ingressEdges.length === 1) {
    // Single ingress: clear targetHandle (use default handle)
    return edges.map((e) =>
      e.target === nodeId && e.targetHandle
        ? { ...e, targetHandle: undefined }
        : e
    )
  }
  // Multiple ingress: compact to sequential handles
  // Build a map from old edge id to new targetHandle
  const handleMap = new Map<string, string | undefined>()
  ingressEdges.forEach((e, i) => {
    handleMap.set(e.id, i === 0 ? undefined : `ingress_${i}`)
  })
  return edges.map((e) => {
    if (e.target !== nodeId) return e
    const newHandle = handleMap.get(e.id)
    if (newHandle === e.targetHandle) return e
    return { ...e, targetHandle: newHandle }
  })
}

/** Build an undirected adjacency list from edges */
function buildAdjacencyList(edges: EdgeType[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, [])
    if (!adj.has(edge.target)) adj.set(edge.target, [])
    adj.get(edge.source)!.push(edge.target)
    adj.get(edge.target)!.push(edge.source)
  }
  return adj
}

/** BFS from startId to find the nearest node in targetIds, returning the path or null */
function bfsShortestPath(
  adj: Map<string, string[]>,
  startId: string,
  targetIds: string[],
): string[] | null {
  const visited = new Set<string>([startId])
  const parent = new Map<string, string>()
  const queue: string[] = [startId]
  let foundSelected: string | null = null

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current !== startId && targetIds.includes(current)) {
      foundSelected = current
      break
    }
    for (const neighbor of adj.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        parent.set(neighbor, current)
        queue.push(neighbor)
      }
    }
  }

  if (!foundSelected) return null

  // Reconstruct path from startId to foundSelected
  const pathNodes: string[] = []
  let cur: string | undefined = foundSelected
  while (cur !== undefined) {
    pathNodes.push(cur)
    cur = parent.get(cur)
  }
  return pathNodes
}

/**
 * Zustand store for workflow state
 *
 * The store is built by a factory (`createWorkflowStore`) so separate
 * instances can be created per React subtree: a default "live" instance
 * backs the `/workbench` route with persistence; a scoped instance backs
 * the historical test canvas at `/executions/history/:runId` with no
 * persistence and an initial snapshot. Selectors using the exported
 * `useWorkflowStore(selector)` hook read from the nearest
 * `WorkflowStoreProvider` or fall back to the default live instance.
 * Persists `editingTestId` and `editingTestName` for the live instance
 * across page refreshes.
 */

export interface WorkflowSnapshot {
  nodes: NodeType[]
  edges: EdgeType[]
}

export interface CreateWorkflowStoreOptions {
  /** Seed nodes/edges (used for the historical canvas). */
  initialSnapshot?: WorkflowSnapshot
  /**
   * localStorage key for the persist middleware. Set to `null` to build a
   * transient instance with no persistence (used for the history canvas).
   */
  persistKey?: string | null
}

const byId =
  <T extends { id: string }>(id: string) =>
  (item: T): boolean =>
    item.id === id
const notById =
  <T extends { id: string }>(id: string) =>
  (item: T): boolean =>
    item.id !== id
const edgeNotConnectedTo =
  (nodeId: string) =>
  (e: EdgeType): boolean =>
    e.source !== nodeId && e.target !== nodeId
// Curried `inner.filter(notById(id))` and `innerEdges.filter(edgeNotConnectedTo(id))`
// helpers used by the drill-aware removeNode mutation. Lifted to module
// scope so the call site stays flat (Sonar S2004 cap on nested callbacks).
const filterNodesNotById =
  (id: string) =>
  (nodes: NodeType[]): NodeType[] =>
    nodes.filter(notById(id))
const filterEdgesNotConnectedTo =
  (id: string) =>
  (edges: EdgeType[]): EdgeType[] =>
    edges.filter(edgeNotConnectedTo(id))
const stringNotEqualTo =
  (target: string) =>
  (value: string): boolean =>
    value !== target
const notByName =
  <T extends { name: string }>(name: string) =>
  (item: T): boolean =>
    item.name !== name
const filterByPredicate =
  <T>(predicate: (item: T) => boolean) =>
  (items: T[]): T[] =>
    items.filter(predicate)
const mergeUpdatesAt =
  <T extends { id: string }>(id: string, updates: Partial<T>) =>
  (nodes: T[]): T[] => {
    const idx = nodes.findIndex(byId(id))
    if (idx === -1) return nodes
    const next = [...nodes]
    next[idx] = { ...next[idx], ...updates }
    return next
  }
const notSourceOrTargetInSet =
  (idSet: Set<string>) =>
  (e: EdgeType): boolean =>
    !idSet.has(e.source) && !idSet.has(e.target)
const filterSelectedEdgesNotConnected =
  (selectedEdgeIdSet: Set<string>, selectedNodeIdSet: Set<string>) =>
  (e: EdgeType): boolean =>
    !selectedEdgeIdSet.has(e.id) &&
    !selectedNodeIdSet.has(e.source) &&
    !selectedNodeIdSet.has(e.target)
const pluckId = <T extends { id: string }>(item: T): string => item.id
const updateEdgeTypeById =
  (id: string, type: string) =>
  (e: EdgeType): EdgeType =>
    e.id === id ? { ...e, type } : e
const applyUpdatesToVariable =
  (id: string, updates: Partial<WorkflowVariable>) =>
  (v: WorkflowVariable): WorkflowVariable =>
    v.id === id ? { ...v, ...updates } : v

/** A rename reaches every name site of one scope: its blocks and, inside a Function, its Expression / Template outputs. */
function renameInScope(nodes: NodeType[], drillPath: DrillEntry[], oldName: string, newName: string): NodeType[] {
  const rename = renameTo(oldName, newName)
  const renameBlocks = (blocks: NodeType[]): NodeType[] => blocks.map((block) => rewriteBlockNames(block, rename))
  if (drillPath.length === 0) return renameBlocks(nodes)
  const renamed = applyMutationAtPath(nodes, drillPath, renameBlocks)
  return applyOutputsMutationAtPath<NodeType, ParamSpec>(renamed, drillPath, (outputs) =>
    renameParamSources(outputs, rename),
  )
}

/** Rewrite the data of the Function Block at the end of `functionPath`. */
function updateFunctionBlock(
  nodes: NodeType[],
  functionPath: DrillEntry[],
  update: (data: NodeType['data']) => NodeType['data'],
): NodeType[] {
  const blockId = functionPath.at(-1)!.nodeId
  return applyMutationAtPath(nodes, functionPath.slice(0, -1), (blocks) =>
    blocks.map((block) => {
      if (block.id !== blockId) return block
      const data = update(block.data)
      return data === block.data ? block : { ...block, data }
    }),
  )
}

function declaredParams(params: unknown[] | undefined): ParamSpec[] {
  return (params ?? []).filter(
    (param): param is ParamSpec => typeof (param as Partial<ParamSpec> | null)?.name === 'string',
  )
}

/** The contract a Function Block follows: the inputs and outputs of the body it holds. */
function bodyContract(data: NodeType['data']): BlockFieldContract {
  const body = data.localDefinition
  return { inputs: declaredParams(body?.inputs), outputs: declaredParams(body?.outputs) }
}

/** After a Local Function's inputs change, its Function Block drops what no longer fits and starts each new choice input on its default (FNCFG-9). */
function reconcileLocalFunctionBlock(
  nodes: NodeType[],
  functionPath: DrillEntry[],
  previousInputs: readonly BlockFieldInput[],
): NodeType[] {
  return updateFunctionBlock(nodes, functionPath, (data) => {
    // A Shared draft's Block is reconciled when the draft is published.
    if (data.functionLifecycle === 'shared') return data
    return reconcileBindingsToContract(data, bodyContract(data), { inputs: previousInputs, outputs: [] })
  })
}

/** A removed parameter leaves its Function Block at once, with all its flags, Shared drafts included. */
function dropRemovedParam(nodes: NodeType[], functionPath: DrillEntry[]): NodeType[] {
  return updateFunctionBlock(nodes, functionPath, (data) => {
    const { inputs, outputs } = bodyContract(data)
    // Names only: a removal drops no other value.
    return dropBlockFields(data, { inputs: inputs.map(({ name }) => ({ name })), outputs })
  })
}

/** The inputs of the Function the path names, as they are before a change. */
function scopeInputs(state: WorkflowState, scopePath: DrillEntry[]): ParamSpec[] {
  const active = walkActiveSubtree(state.nodes, state.edges, state.variables, scopePath)
  return declaredParams(active.localDefinition?.inputs)
}

/** Append a parameter to the Function `functionPath` names (VMGR-102), else the drilled one. */
function addParam(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  field: 'inputs' | 'outputs',
  spec: ParamSpec,
  functionPath: DrillEntry[] | undefined,
): void {
  const state = get()
  const scopePath = functionPath ?? state.drillPath
  const action = field === 'inputs' ? 'input parameter' : 'output parameter'
  if (scopePath.length === 0) {
    throw new Error(`Cannot add ${action} outside a Function`)
  }
  const nameError = validateVariableName(spec.name, { parameter: true })
  if (nameError !== null) {
    throw new Error(nameError)
  }
  if (activeScopeNames(state.nodes, state.edges, state.variables, scopePath).includes(spec.name)) {
    throw new Error(`Name "${spec.name}" already exists in this Function`)
  }
  const applyParams =
    field === 'inputs'
      ? applyInputsMutationAtPath<NodeType, ParamSpec>
      : applyOutputsMutationAtPath<NodeType, ParamSpec>
  let nodes = applyParams(state.nodes, scopePath, (params) => [...params, spec])
  if (field === 'inputs') nodes = reconcileLocalFunctionBlock(nodes, scopePath, scopeInputs(state, scopePath))
  set({ nodes, isDirty: true })
  get().commitHistory(`Add ${action}`)
}

/** The refusal of a parameter rename: the one name rule, then a name the Function already has. */
function paramRenameError(state: WorkflowState, scopePath: DrillEntry[], newName: string): string | null {
  const nameError = validateVariableName(newName, { parameter: true })
  if (nameError !== null) return nameError
  const taken = activeScopeNames(state.nodes, state.edges, state.variables, scopePath)
  return taken.includes(newName) ? `Name "${newName}" already exists in this Function` : null
}

/** Update or atomically rename a parameter spec of the Function `functionPath` names, else the drilled one. */
function updateParam(
  get: () => WorkflowState,
  set: (partial: Partial<WorkflowState>) => void,
  field: 'inputs' | 'outputs',
  oldName: string,
  updates: Partial<ParamSpec>,
  functionPath: DrillEntry[] | undefined,
): { success: boolean; error?: string } {
  const state = get()
  const scopePath = functionPath ?? state.drillPath
  if (scopePath.length === 0) {
    return { success: false, error: `Cannot update ${field === 'inputs' ? 'input' : 'output'} parameter outside a Function` }
  }
  const active = walkActiveSubtree(state.nodes, state.edges, state.variables, scopePath)
  const params = (active.localDefinition?.[field] as ParamSpec[] | undefined) ?? []
  const oldParam = params.find((p) => p.name === oldName)
  if (!oldParam) {
    return { success: false, error: `Parameter "${oldName}" not found` }
  }

  const newName = updates.name ?? oldName
  const renameError = newName === oldName ? null : paramRenameError(state, scopePath, newName)
  if (renameError !== null) {
    return { success: false, error: renameError }
  }

  const newSpec: ParamSpec = { ...oldParam, ...updates, name: newName }
  const mutator = (arr: ParamSpec[]): ParamSpec[] =>
    arr.map((p) => (p.name === oldName ? newSpec : p))

  const applyParams =
    field === 'inputs'
      ? applyInputsMutationAtPath<NodeType, ParamSpec>
      : applyOutputsMutationAtPath<NodeType, ParamSpec>
  let newRoot = applyParams(state.nodes, scopePath, mutator)

  if (newName !== oldName) {
    newRoot = renameInScope(newRoot, scopePath, oldName, newName)
    newRoot = applyVariablesMutationAtPath<NodeType, WorkflowVariable>(newRoot, scopePath, (locals) =>
      applyRenameToVariables(locals, '', oldName, newName),
    )
    newRoot = updateFunctionBlock(newRoot, scopePath, (data) => renameBlockField(data, oldName, newName))
  }
  if (field === 'inputs') {
    // A renamed input is never new, so its field is never written over.
    const previous = params.map((p) => (p.name === oldName ? { ...p, name: newName } : p))
    newRoot = reconcileLocalFunctionBlock(newRoot, scopePath, previous)
  }

  set({ nodes: newRoot, isDirty: true })
  const action = field === 'inputs' ? 'input parameter' : 'output parameter'
  const description = newName === oldName
    ? `Update ${action}`
    : `Rename ${action} "${oldName}" to "${newName}"`
  get().commitHistory(description)
  return { success: true }
}
type GetState = () => WorkflowState
type SetPartial = (partial: Partial<WorkflowState>) => void

/** Finalize a pending grouped text-edit commit before a timeline boundary. */
function flushPendingGroupingCommit(get: GetState, set: SetPartial): void {
  const timer = get().groupingDebounceTimer
  if (!timer) return
  clearTimeout(timer)
  set({ groupingDebounceTimer: null })
  get().commitHistory('Edit text')
}

/** Discard a pending grouped text-edit commit (save/reset absorb the mutation). */
function cancelPendingGroupingCommit(get: GetState, set: SetPartial): void {
  const timer = get().groupingDebounceTimer
  if (!timer) return
  clearTimeout(timer)
  set({ groupingDebounceTimer: null })
}

/** Undo/redo are unavailable while executing or saving. */
function historyGateBlocked(state: WorkflowState): boolean {
  return (
    state.executionStatus === 'running' ||
    state.executionStatus === 'paused' ||
    state.saveInFlight
  )
}

const toggleNodeDisabled =
  (nodeId: string) =>
  (n: NodeType): NodeType =>
    n.id === nodeId
      ? { ...n, data: { ...n.data, disabled: !n.data.disabled } }
      : n
const enableIfDisabled = (n: NodeType): NodeType =>
  n.data.disabled ? { ...n, data: { ...n.data, disabled: false } } : n
function clonePastedNode(idMap: Map<string, string>, pasteOffset: Position) {
  return (node: NodeType): NodeType => {
    const newId = generateId()
    idMap.set(node.id, newId)
    const config = node.data.config
    const cleanedData = config?.outputBindings
      ? { ...node.data, config: { ...config, outputBindings: {} } }
      : node.data
    return {
      ...node,
      id: newId,
      data: cleanedData,
      position: {
        x: node.position.x + pasteOffset.x,
        y: node.position.y + pasteOffset.y,
      },
    }
  }
}

/**
 * Build a baseline history entry. The baseline floors the undo stack:
 * `canUndo()` returns false when `historyIndex === 0` and the entry at
 * index 0 carries `isInitialState: true`. Used by `markSaved`, `reset`,
 * and snapshot-seeded historical canvases.
 */
function makeBaselineEntry(
  nodes: NodeType[],
  edges: EdgeType[],
  variables: WorkflowVariable[],
  description: string,
): HistoryEntry {
  return {
    nodes: [...nodes],
    edges: [...edges],
    variables: [...variables],
    timestamp: Date.now(),
    operationDescription: description,
    isInitialState: true,
  }
}

/** Stamp Shared Function contracts on the canvas, history and clipboard; null when nothing changed. */
function stampStateContracts(
  state: WorkflowState,
  versions: VersionsByFunction,
): Pick<WorkflowState, 'nodes' | 'history' | 'clipboard'> | null {
  const nodes = stampSharedFunctionContracts(state.nodes, versions)
  // Undo, redo and paste bring back the stamped Blocks too.
  const history = state.history.map((entry) => {
    const stamped = stampSharedFunctionContracts(entry.nodes, versions)
    return stamped === entry.nodes ? entry : { ...entry, nodes: stamped }
  })
  const historyChanged = history.some((entry, index) => entry !== state.history[index])
  const clipboardNodes = state.clipboard
    ? stampSharedFunctionContracts(state.clipboard.nodes, versions)
    : null
  const clipboard =
    state.clipboard && clipboardNodes !== state.clipboard.nodes
      ? { ...state.clipboard, nodes: clipboardNodes as NodeType[] }
      : state.clipboard
  if (nodes === state.nodes && !historyChanged && clipboard === state.clipboard) return null
  return { nodes, history, clipboard }
}

function buildInitializer(
  snapshot?: WorkflowSnapshot,
): StateCreator<WorkflowState, [], []> {
  const seedNodes = snapshot?.nodes ?? []
  const seedEdges = snapshot?.edges ?? []
  // Always seed a baseline so the post-state invariant
  // (canvas === history[historyIndex]) holds from the first render. Without
  // it, the first mutation in a fresh workbench would land at historyIndex 0
  // with canUndo()===false, leaving the user stranded one op above empty.
  const initialDescription = snapshot ? 'Initial snapshot' : 'Empty canvas'
  const initialHistory: HistoryEntry[] = [
    makeBaselineEntry(seedNodes, seedEdges, [], initialDescription),
  ]
  const initialHistoryIndex = 0
  return (set, get) => ({
    nodes: seedNodes,
    edges: seedEdges,
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedNodeIds: [],
    selectedEdgeIds: [],
    breakpoints: new Set<string>(),
    pausedNodeId: null,
    debugOptions: loadDebugOptionsFromStorage(),
    skippedNodeIds: [],
    nodeIssues: new Map(),
    nodeSyntaxIssues: new Map(),
    catalogPulls: new Map(),
    pulseValidationNodeIds: new Set(),
    openConfigNodeIds: [],
    lastInteractedNodeId: null,
    dirtyConfigNodeIds: [],
    pendingDeleteNodeIds: null,
    pendingDrillAction: null,
    pendingSecretPromotion: null,
    publishDialogNodeId: null,
    makeLocalDialogNodeId: null,
    isFunctionLibraryOpen: false,
    functionLibraryInitialSearch: '',
    functionLibraryRevision: 0,
    publishEditModeDialogNodeId: null,
    dropChangesDialogNodeId: null,
    digInPendingNodeId: null,
    variables: [],
    namespaceVariables: { system: [], suite: [], regression: [] },
    history: initialHistory,
    historyIndex: initialHistoryIndex,
    maxHistoryLength: 50,
    clipboard: null,
    clipboardSource: null,
    isDirty: false,
    lastSavedAt: null,
    executionStatus: 'idle',
    saveInFlight: false,
    drillPath: [],
    editingTestId: null,
    editingTestName: null,
    editingTestSuiteIds: [],
    functionViewMode: null,
    functionViewBaseline: null,
    lastError: null,
    lastAnnouncement: '',
    announcementSeq: 0,
    isCanvasReady: false,
    fitViewRequested: false,
    fitViewOptions: null,
    focusRequested: false,
    focusNodeId: null,
    focusOptions: null,
    mirrorActiveNodeId: null,
    mirrorLastChangeNodeId: null,
    mirrorChangeTick: 0,
    isDraggingEdge: false,
    draggingEdgeSourceId: null,
    setDraggingEdge: (isDragging, sourceId = null) =>
      set({ isDraggingEdge: isDragging, draggingEdgeSourceId: sourceId }),
    isDragging: false,
    isInTransaction: false,
    dragStartState: null,
    transactionStartState: null,
    groupingDebounceTimer: null,

    setNodes: (nodes, options) => {
      const state = get()
      const dirty = options?.skipDirty ? {} : { isDirty: true }
      if (state.drillPath.length === 0) {
        set({ nodes, ...dirty })
        return
      }
      set({ nodes: applyMutationAtPath(state.nodes, state.drillPath, () => nodes), ...dirty })
    },

    setNodeTree: (nodes, options) => {
      set({ nodes, ...(options?.skipDirty ? {} : { isDirty: true }) })
    },

    setEdges: (edges, options) => {
      const state = get()
      const dirty = options?.skipDirty ? {} : { isDirty: true }
      if (state.drillPath.length === 0) {
        set({ edges, ...dirty })
        return
      }
      set({
        nodes: applyEdgesMutationAtPath<NodeType, EdgeType>(
          state.nodes,
          state.drillPath,
          () => edges,
        ),
        ...dirty,
      })
    },

    applyMirroredGraph: (snapshot) => {
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        variables: snapshot.variables,
        isDirty: false,
      })
    },

    applyFunctionContracts: (versions) => {
      set((state) => stampStateContracts(state, versions) ?? state)
    },

    addNode: (node) => {
      const state = get()
      if (state.drillPath.length === 0) {
        set({
          nodes: [...state.nodes, node],
          isDirty: true,
        })
      } else {
        const newRoot = applyMutationAtPath(state.nodes, state.drillPath, (inner) => [
          ...inner,
          node,
        ])
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Add block')
    },

    updateNode: (id, updates) => {
      set((state) => {
        if (state.drillPath.length === 0) {
          const nodeIndex = state.nodes.findIndex(byId(id))
          if (nodeIndex === -1) return state

          const updatedNodes = [...state.nodes]
          updatedNodes[nodeIndex] = { ...updatedNodes[nodeIndex], ...updates }
          return { nodes: updatedNodes, isDirty: true }
        }
        const newRoot = applyMutationAtPath(state.nodes, state.drillPath, mergeUpdatesAt<NodeType>(id, updates))
        // Detect no-op: if the inner mutation didn't find the target, the
        // returned root is structurally identical (path helper still clones
        // the spine, so use a content check via the active subtree).
        const activeAfter = walkActiveSubtree(newRoot, state.edges, state.variables, state.drillPath)
        if (!activeAfter.nodes.some(byId(id))) return state
        return { nodes: newRoot, isDirty: true }
      })
    },

    updateNodeWithGrouping: (id, updates) => {
      // Clear existing debounce timer
      const existingTimer = get().groupingDebounceTimer
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Update the node immediately (drill-aware via updateNode)
      get().updateNode(id, updates)

      // Set up debounced history commit (post-mutation)
      const timer = setTimeout(() => {
        get().commitHistory('Edit text')
        set({ groupingDebounceTimer: null })
      }, TEXT_INPUT_DEBOUNCE_MS)

      set({ groupingDebounceTimer: timer })
    },

    removeNode: (id) => {
      const state = get()
      if (state.drillPath.length === 0) {
        const remainingNodes = state.nodes.filter(notById(id))
        set({
          nodes: remainingNodes,
          edges: state.edges.filter(edgeNotConnectedTo(id)),
          selectedNodeIds: state.selectedNodeIds.filter(stringNotEqualTo(id)),
          ...releaseRemovedNodeRefs(state, remainingNodes),
          isDirty: true,
        })
      } else {
        // First filter inner nodes, then filter the inner edges that touched
        // the removed node. Both mutations stay scoped to the deepest subtree.
        const filterEdgesNotTouching = filterEdgesNotConnectedTo(id)
        const afterNodes = applyMutationAtPath(state.nodes, state.drillPath, filterNodesNotById(id))
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(
          afterNodes,
          state.drillPath,
          filterEdgesNotTouching,
        )
        set({
          nodes: newRoot,
          selectedNodeIds: state.selectedNodeIds.filter(stringNotEqualTo(id)),
          ...releaseRemovedNodeRefs(state, newRoot),
          isDirty: true,
        })
      }
      get().commitHistory('Delete block')
    },

    addEdge: (edge) => {
      const state = get()
      const activeEdges = state.drillPath.length === 0
        ? state.edges
        : walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).edges
      // Check for duplicate within active subtree
      const exists = activeEdges.some((e) => e.id === edge.id)
      if (exists) return

      if (state.drillPath.length === 0) {
        set((currentState) => ({
          edges: [...currentState.edges, edge],
          isDirty: true,
        }))
      } else {
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, (innerEdges) => [
          ...innerEdges,
          edge,
        ])
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Add connection')
    },

    removeEdge: (id) => {
      const state = get()
      if (state.drillPath.length === 0) {
        const removedEdge = state.edges.find(byId(id))
        let edges = state.edges.filter(notById(id))
        if (removedEdge) {
          edges = migrateIngressHandles(edges, removedEdge.target)
        }
        set({
          edges,
          selectedEdgeIds: state.selectedEdgeIds.filter(stringNotEqualTo(id)),
          isDirty: true,
        })
      } else {
        const activeEdges = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).edges
        const removedEdge = activeEdges.find(byId(id))
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, (innerEdges) => {
          let next = innerEdges.filter(notById(id))
          if (removedEdge) {
            next = migrateIngressHandles(next, removedEdge.target)
          }
          return next
        })
        set({
          nodes: newRoot,
          selectedEdgeIds: state.selectedEdgeIds.filter(stringNotEqualTo(id)),
          isDirty: true,
        })
      }
      get().commitHistory('Remove connection')
    },

    updateEdgeType: (id, type) => {
      const state = get()
      const remap = (edges: EdgeType[]): EdgeType[] => edges.map(updateEdgeTypeById(id, type))
      if (state.drillPath.length === 0) {
        set({ edges: remap(state.edges), isDirty: true })
      } else {
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, remap)
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Change edge type')
    },

    relocateEdge: (oldEdgeId, newEdge) => {
      const state = get()
      const activeEdges = state.drillPath.length === 0
        ? state.edges
        : walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).edges
      const oldEdge = activeEdges.find(byId(oldEdgeId))
      const relocate = (edges: EdgeType[]): EdgeType[] => {
        let next = [...edges.filter(notById(oldEdgeId)), newEdge]
        if (oldEdge && oldEdge.target !== newEdge.target) {
          next = migrateIngressHandles(next, oldEdge.target)
        }
        return next
      }
      if (state.drillPath.length === 0) {
        set({
          edges: relocate(state.edges),
          selectedEdgeIds: state.selectedEdgeIds.filter(stringNotEqualTo(oldEdgeId)),
          isDirty: true,
        })
      } else {
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, relocate)
        set({
          nodes: newRoot,
          selectedEdgeIds: state.selectedEdgeIds.filter(stringNotEqualTo(oldEdgeId)),
          isDirty: true,
        })
      }
      get().commitHistory('Relocate connection')
    },

    setSelectedNodes: (ids) => {
      set((state) => ({
        selectedNodeIds: ids,
        // Only a single-node selection is an interaction with that block; a
        // rubber-band multi-select (or deselection) leaves the anchor in place.
        lastInteractedNodeId: ids.length === 1 ? ids[0] : state.lastInteractedNodeId,
      }))
    },

    setSelectedEdges: (ids) => {
      set({ selectedEdgeIds: ids })
    },

    clearSelection: () => {
      set({ selectedNodeIds: [], selectedEdgeIds: [] })
    },

    selectAll: () => {
      set((state) => {
        const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
        return {
          selectedNodeIds: active.nodes.map(pluckId),
          selectedEdgeIds: active.edges.map(pluckId),
        }
      })
    },

    selectNode: (nodeId, options) => {
      set((state) => {
        if (options?.addToSelection) {
          // Add to existing selection - clear edge selection (mutual exclusivity)
          return {
            selectedNodeIds: state.selectedNodeIds.includes(nodeId)
              ? state.selectedNodeIds
              : [...state.selectedNodeIds, nodeId],
            selectedEdgeIds: [],
            lastInteractedNodeId: nodeId,
          }
        }
        // Replace selection - clear edge selection (mutual exclusivity)
        return {
          selectedNodeIds: [nodeId],
          selectedEdgeIds: [],
          lastInteractedNodeId: nodeId,
        }
      })
    },

    deselectAll: () => {
      set({ selectedNodeIds: [], selectedEdgeIds: [] })
    },

    selectNodesInRect: (rect: Rect) => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const intersecting = active.nodes
        .filter((node) => rectangleIntersectsNode(rect, node))
        .map((node) => node.id)

      // Additive: merge with existing selection, deduplicate
      const merged = new Set([...state.selectedNodeIds, ...intersecting])

      set({
        selectedNodeIds: [...merged],
        // Edge selection is mutually exclusive with node selection
        selectedEdgeIds: [],
      })
    },

    chainSelect: (clickedNodeId: string) => {
      const state = get()
      if (state.selectedNodeIds.length === 0) return

      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const adj = buildAdjacencyList(active.edges)
      const pathNodes = bfsShortestPath(adj, clickedNodeId, state.selectedNodeIds)

      if (!pathNodes) return

      // Additive: merge path with existing selection
      const merged = new Set([...state.selectedNodeIds, ...pathNodes])
      set({ selectedNodeIds: [...merged], selectedEdgeIds: [] })
    },

    handleShiftPaneClick: (_clickPoint: Position) => {
      // Shift+click on empty canvas - no-op
      // Chain select only works on node Shift+click (handled in canvas)
    },

    openConfigModal: (nodeId) => {
      set((state) => {
        // Duplicate and over-cap opens are silent no-ops; the canvas layer
        // owns the cap toast and the bring-to-front focus.
        if (state.openConfigNodeIds.includes(nodeId)) return state
        if (state.openConfigNodeIds.length >= MAX_OPEN_CONFIG_SHEETS) return state
        return { openConfigNodeIds: [...state.openConfigNodeIds, nodeId] }
      })
    },

    closeConfigModal: (nodeId) => {
      set((state) => ({
        openConfigNodeIds: state.openConfigNodeIds.filter(stringNotEqualTo(nodeId)),
      }))
    },

    closeAllConfigModals: () => {
      set({ openConfigNodeIds: [] })
    },

    setConfigSheetDirty: (nodeId, dirty) => {
      set((state) => {
        const isTracked = state.dirtyConfigNodeIds.includes(nodeId)
        if (dirty === isTracked) return state
        return {
          dirtyConfigNodeIds: dirty
            ? [...state.dirtyConfigNodeIds, nodeId]
            : state.dirtyConfigNodeIds.filter(stringNotEqualTo(nodeId)),
        }
      })
    },

    requestDeleteSelected: () => {
      const state = get()
      // Deleting a node whose sheet has unsaved edits asks first; the
      // canvas renders the dialog off pendingDeleteNodeIds.
      const dirtySelected = state.selectedNodeIds.filter((id) =>
        state.dirtyConfigNodeIds.includes(id),
      )
      if (dirtySelected.length > 0) {
        set({ pendingDeleteNodeIds: dirtySelected })
        return
      }
      get().deleteSelected()
    },

    confirmPendingDelete: () => {
      set({ pendingDeleteNodeIds: null })
      get().deleteSelected()
    },

    cancelPendingDelete: () => {
      set({ pendingDeleteNodeIds: null })
    },

    requestDrill: (run) => {
      // A scope change resets sheet form state, so drilling
      // with unsaved edits asks first; the canvas renders the dialog off
      // pendingDrillAction. Clean sheets navigate immediately.
      if (get().dirtyConfigNodeIds.length > 0) {
        set({ pendingDrillAction: { run } })
        return
      }
      run()
    },

    confirmPendingDrill: () => {
      const pending = get().pendingDrillAction
      set({ pendingDrillAction: null })
      pending?.run()
    },

    cancelPendingDrill: () => {
      set({ pendingDrillAction: null })
    },

    requestSecretPromotion: (names, save) => {
      set({ pendingSecretPromotion: { names, save } })
    },

    confirmSecretPromotion: () => {
      const pending = get().pendingSecretPromotion
      set({ pendingSecretPromotion: null })
      pending?.save()
    },

    cancelSecretPromotion: () => {
      set({ pendingSecretPromotion: null })
    },

    openPublishDialog: (nodeId) => {
      set({ publishDialogNodeId: nodeId })
    },

    closePublishDialog: () => {
      set({ publishDialogNodeId: null })
    },

    openMakeLocalDialog: (nodeId) => {
      set({ makeLocalDialogNodeId: nodeId })
    },

    closeMakeLocalDialog: () => {
      set({ makeLocalDialogNodeId: null })
    },

    // edit-mode dialog actions
    openPublishEditModeDialog: (nodeId) => {
      set({ publishEditModeDialogNodeId: nodeId })
    },

    closePublishEditModeDialog: () => {
      set({ publishEditModeDialogNodeId: null })
    },

    openDropChangesDialog: (nodeId) => {
      set({ dropChangesDialogNodeId: nodeId })
    },

    closeDropChangesDialog: () => {
      set({ dropChangesDialogNodeId: null })
    },

    setDigInPending: (nodeId) => {
      set({ digInPendingNodeId: nodeId })
    },

    clearDigInPending: () => {
      set({ digInPendingNodeId: null })
    },

    setFunctionLibraryOpen: (open: boolean, initialSearch: string = '') => {
      // When closing, also reset the initial-search seed so the next manual
      // palette open lands in the unfiltered view (we do not want the last
      // From-library click's query to bleed across opens).
      if (!open) {
        set({ isFunctionLibraryOpen: false, functionLibraryInitialSearch: '' })
        return
      }
      set({ isFunctionLibraryOpen: true, functionLibraryInitialSearch: initialSearch })
    },

    bumpFunctionLibraryRevision: () => {
      set((state) => ({
        functionLibraryRevision: state.functionLibraryRevision + 1,
      }))
    },

    applyEditModeEntered: (nodeId, nodeData, _persisted = true) => {
      // Merge (not replace) so transient `localDefinition` survives the BE response.
      // Exactly ONE undoable entry covers the marker/draft creation.
      set((state) => ({
        nodes: mergeNodeDataDeep(state.nodes, nodeId, nodeData, false),
      }))
      get().commitHistory('Enter edit mode')
    },

    applyEditModeDropped: (nodeId, nodeData) => {
      flushPendingGroupingCommit(get, set)
      set((state) => ({
        ...computePickOutState(state, { nodeId, nodeData, mode: 'drop' }),
        dropChangesDialogNodeId: null,
      }))
    },

    hasEditModeNodes: () => anyEditModeNode(get().nodes),

    applyEditModePublished: (nodeId, nodeData, options) => {
      flushPendingGroupingCommit(get, set)
      set((state) => ({
        ...computePickOutState(state, {
          nodeId,
          nodeData,
          mode: options?.mode ?? 'set-new',
          targetContract: options?.targetContract,
        }),
        publishEditModeDialogNodeId: null,
      }))
    },

    applyMakeLocal: (nodeId, nodeData) => {
      set((state) => ({
        nodes: replaceNodeDataDeep(state.nodes, nodeId, nodeData),
      }))
      get().commitHistory('Make local')
    },

    applyFirstPublish: (nodeId, nodeData) => {
      flushPendingGroupingCommit(get, set)
      set((state) => computePickOutState(state, { nodeId, nodeData, mode: 'first-publish' }))
    },

    addVariable: (variable, functionPath) => {
      const state = get()
      const scopePath = functionPath ?? state.drillPath
      if (activeScopeNames(state.nodes, state.edges, state.variables, scopePath).includes(variable.name)) {
        throw new Error(`Name "${variable.name}" already exists in this scope`)
      }
      const newVariable: WorkflowVariable = {
        ...variable,
        id: generateId(),
      }
      if (scopePath.length === 0) {
        set({
          variables: [...state.variables, newVariable],
          isDirty: true,
        })
      } else {
        const newRoot = applyVariablesMutationAtPath(
          state.nodes,
          scopePath,
          (innerVars: WorkflowVariable[]) => [...innerVars, newVariable],
        )
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Add variable')
      return newVariable
    },

    updateVariable: (id, updates, functionPath) => {
      const state = get()
      const scopePath = functionPath ?? state.drillPath
      if (scopePath.length === 0) {
        set({
          variables: state.variables.map(applyUpdatesToVariable(id, updates)),
          isDirty: true,
        })
      } else {
        const newRoot = applyVariablesMutationAtPath(
          state.nodes,
          scopePath,
          (innerVars: WorkflowVariable[]) => innerVars.map(applyUpdatesToVariable(id, updates)),
        )
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Update variable')
    },

    removeVariable: (id) => {
      // No standalone history commit - confirmVariableDelete wraps this in a
      // transaction together with the node-binding cascade so undo restores
      // both the variable AND any cleared output bindings in one step.
      const state = get()
      if (state.drillPath.length === 0) {
        set({
          variables: state.variables.filter(notById(id)),
          isDirty: true,
        })
      } else {
        const newRoot = applyVariablesMutationAtPath(
          state.nodes,
          state.drillPath,
          (innerVars: WorkflowVariable[]) => innerVars.filter(notById(id)),
        )
        set({ nodes: newRoot, isDirty: true })
      }
    },

    setVariables: (variables, options) => {
      const state = get()
      const dirty = options?.skipDirty ? {} : { isDirty: true }
      if (state.drillPath.length === 0) {
        set({ variables, ...dirty })
        return
      }
      set({
        nodes: applyVariablesMutationAtPath(state.nodes, state.drillPath, () => variables),
        ...dirty,
      })
    },

    renameVariable: (id, newName, functionPath) => {
      const state = get()
      const scopePath = functionPath ?? state.drillPath
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, scopePath)
      const variable = active.variables.find(byId(id))
      if (!variable) {
        return { success: false }
      }
      const oldName = variable.name
      if (oldName === newName) {
        return { success: true }
      }
      const nameError = validateVariableName(newName)
      if (nameError !== null) {
        return { success: false, error: nameError }
      }
      if (activeScopeNames(state.nodes, state.edges, state.variables, scopePath).includes(newName)) {
        const where = scopePath.length === 0 ? 'scope' : 'Function'
        return { success: false, error: `Name "${newName}" already exists in this ${where}` }
      }

      // Rename the variable and refactor its references within the variable's own scope.
      if (scopePath.length === 0) {
        set((currentState) => ({
          variables: applyRenameToVariables(currentState.variables, id, oldName, newName),
          nodes: renameInScope(currentState.nodes, [], oldName, newName),
          isDirty: true,
        }))
      } else {
        // Variables first, then the scope's blocks and outputs on top of the renamed tree.
        const afterVars = applyVariablesMutationAtPath<NodeType, WorkflowVariable>(
          state.nodes,
          scopePath,
          (innerVars) => applyRenameToVariables(innerVars, id, oldName, newName),
        )
        set({ nodes: renameInScope(afterVars, scopePath, oldName, newName), isDirty: true })
      }

      get().commitHistory(`Rename variable "${oldName}" to "${newName}"`)

      return { success: true }
    },

    setNamespaceVariables: (namespace, entries) => {
      set((state) => ({
        namespaceVariables: { ...state.namespaceVariables, [namespace]: entries },
      }))
    },

    clearNamespaceVariables: () => {
      set({ namespaceVariables: { system: [], suite: [], regression: [] } })
    },

    addInputParam: (spec, functionPath) => {
      addParam(get, set, 'inputs', spec, functionPath)
    },

    removeInputParam: (name) => {
      const state = get()
      if (state.drillPath.length === 0) {
        throw new Error('Cannot remove input parameter outside a Function')
      }
      const newRoot = applyInputsMutationAtPath<NodeType, ParamSpec>(
        state.nodes,
        state.drillPath,
        filterByPredicate(notByName<ParamSpec>(name)),
      )
      set({ nodes: dropRemovedParam(newRoot, state.drillPath), isDirty: true })
      get().commitHistory('Remove input parameter')
    },

    addOutputParam: (spec, functionPath) => {
      addParam(get, set, 'outputs', spec, functionPath)
    },

    removeOutputParam: (name) => {
      const state = get()
      if (state.drillPath.length === 0) {
        throw new Error('Cannot remove output parameter outside a Function')
      }
      const newRoot = applyOutputsMutationAtPath<NodeType, ParamSpec>(
        state.nodes,
        state.drillPath,
        filterByPredicate(notByName<ParamSpec>(name)),
      )
      set({ nodes: dropRemovedParam(newRoot, state.drillPath), isDirty: true })
      get().commitHistory('Remove output parameter')
    },

    updateInputParam: (oldName, updates, functionPath) => {
      return updateParam(get, set, 'inputs', oldName, updates, functionPath)
    },

    updateOutputParam: (oldName, updates, functionPath) => {
      return updateParam(get, set, 'outputs', oldName, updates, functionPath)
    },

    hasBreakpoint: (nodeId) => {
      return get().breakpoints.has(nodeId)
    },

    toggleBreakpoint: (nodeId) => {
      set((state) => {
        const newBreakpoints = new Set(state.breakpoints)
        if (newBreakpoints.has(nodeId)) {
          newBreakpoints.delete(nodeId)
        } else {
          newBreakpoints.add(nodeId)
        }
        return { breakpoints: newBreakpoints }
      })
    },

    getBreakpointList: () => Array.from(get().breakpoints),

    clearBreakpoints: () => {
      set({ breakpoints: new Set<string>() })
    },

    clearBreakpointsOnTestClose: () => {
      set({ breakpoints: new Set<string>() })
    },

    setPausedNodeId: (nodeId) => set({ pausedNodeId: nodeId }),

    setDebugOptions: (options) => {
      persistDebugOptions(options)
      set({ debugOptions: options })
    },

    toggleDisable: (nodeId) => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find(byId(nodeId))
      if (!node) return

      const willDisable = !node.data.disabled
      if (state.drillPath.length === 0) {
        set((currentState) => ({
          nodes: currentState.nodes.map(toggleNodeDisabled(nodeId)),
          // Disable negates skip - unskip the node when disabling
          skippedNodeIds: willDisable
            ? currentState.skippedNodeIds.filter(stringNotEqualTo(nodeId))
            : currentState.skippedNodeIds,
          isDirty: true,
        }))
      } else {
        const newRoot = applyMutationAtPath(state.nodes, state.drillPath, (inner) =>
          inner.map(toggleNodeDisabled(nodeId)),
        )
        set((currentState) => ({
          nodes: newRoot,
          skippedNodeIds: willDisable
            ? currentState.skippedNodeIds.filter(stringNotEqualTo(nodeId))
            : currentState.skippedNodeIds,
          isDirty: true,
        }))
      }
      get().commitHistory('Toggle disable')
    },

    toggleSkip: (nodeId) => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find(byId(nodeId))
      if (!node) return

      set((currentState) => ({
        skippedNodeIds: currentState.skippedNodeIds.includes(nodeId)
          ? currentState.skippedNodeIds.filter(stringNotEqualTo(nodeId))
          : [...currentState.skippedNodeIds, nodeId],
        // Skip is runtime-transient (CANVAS-72): never dirty, never undoable
      }))
    },

    unlinkNode: (nodeId) => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const node = active.nodes.find(byId(nodeId))
      if (!node) return

      // Find nodes that will lose ingress edges when this node is unlinked
      const affectedTargets = new Set<string>()
      for (const e of active.edges) {
        if (e.source === nodeId) affectedTargets.add(e.target)
      }

      const filterEdges = (edges: EdgeType[]): EdgeType[] => {
        let next = edges.filter(edgeNotConnectedTo(nodeId))
        for (const targetId of affectedTargets) {
          next = migrateIngressHandles(next, targetId)
        }
        // Also compact handles on this node itself (it lost ingress edges)
        next = migrateIngressHandles(next, nodeId)
        return next
      }

      if (state.drillPath.length === 0) {
        set((currentState) => ({ edges: filterEdges(currentState.edges), isDirty: true }))
      } else {
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, filterEdges)
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Unlink block')
    },

    unskipAll: () => {
      // Skip is runtime-transient (CANVAS-72): never dirty, never undoable
      set({ skippedNodeIds: [] })
    },

    enableAll: () => {
      const state = get()
      const enableAllNodes = (nodes: NodeType[]): NodeType[] => nodes.map(enableIfDisabled)
      if (state.drillPath.length === 0) {
        set({ nodes: enableAllNodes(state.nodes), isDirty: true })
      } else {
        const newRoot = applyMutationAtPath(state.nodes, state.drillPath, enableAllNodes)
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Enable all')
    },

    setNodeSyntaxIssues: (nodeId, issues) => {
      setScriptSyntaxIssues(nodeId, issues)
      set({ nodeSyntaxIssues: scriptSyntaxIssuesByNode() })
    },

    setCatalogPull: (key, entry) => {
      set((state) => ({ catalogPulls: new Map(state.catalogPulls).set(key, entry) }))
    },

    removeCatalogPull: (key) => {
      set((state) => {
        const next = new Map(state.catalogPulls)
        next.delete(key)
        return { catalogPulls: next }
      })
    },

    clearCatalogPulls: () => {
      set({ catalogPulls: new Map() })
    },

    setPulseValidationNodeIds: (ids) => {
      set({ pulseValidationNodeIds: new Set(ids) })
    },

    clearPulseValidationNodeId: (nodeId) => {
      set((state) => {
        if (!state.pulseValidationNodeIds.has(nodeId)) return state
        const next = new Set(state.pulseValidationNodeIds)
        next.delete(nodeId)
        return { pulseValidationNodeIds: next }
      })
    },

    setViewport: (viewport) => {
      set({ viewport })
    },

    zoomIn: () => {
      set((state) => ({
        viewport: {
          ...state.viewport,
          zoom: Math.min(state.viewport.zoom + ZOOM_STEP, MAX_ZOOM),
        },
      }))
    },

    zoomOut: () => {
      set((state) => ({
        viewport: {
          ...state.viewport,
          zoom: Math.max(state.viewport.zoom - ZOOM_STEP, MIN_ZOOM),
        },
      }))
    },

    fitView: (_options?: FitViewOptions) => {
      const state = get()
      if (state.nodes.length === 0) return

      // Calculate bounding box of all nodes
      const minX = Math.min(...state.nodes.map((n) => n.position.x))
      const maxX = Math.max(...state.nodes.map((n) => n.position.x + (n.width ?? 200)))
      const minY = Math.min(...state.nodes.map((n) => n.position.y))
      const maxY = Math.max(...state.nodes.map((n) => n.position.y + (n.height ?? 100)))

      const width = maxX - minX
      const height = maxY - minY

      // Assuming canvas size of 1000x800 for calculation
      const canvasWidth = 1000
      const canvasHeight = 800

      const scaleX = canvasWidth / (width || 1)
      const scaleY = canvasHeight / (height || 1)
      const zoom = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.9, MIN_ZOOM), MAX_ZOOM)

      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      set({
        viewport: {
          x: canvasWidth / 2 - centerX * zoom,
          y: canvasHeight / 2 - centerY * zoom,
          zoom,
        },
      })
    },

    setCanvasReady: (ready: boolean) => {
      set({ isCanvasReady: ready })
    },

    // Request React Flow to fit the view (actual fitting happens in WorkflowCanvas)
    requestFitView: (options?: FitViewOptions) => {
      set({
        fitViewRequested: true,
        fitViewOptions: options ?? null,
      })
    },

    // Called by WorkflowCanvas after executing fitView
    acknowledgeFitView: () => {
      set({
        fitViewRequested: false,
        fitViewOptions: null,
      })
    },

    requestFocus: (nodeId: string, options?: FocusOptions) => {
      set({
        focusRequested: true,
        focusNodeId: nodeId,
        focusOptions: options ?? null,
      })
    },

    // Called by useCanvasFocus after centering the node
    acknowledgeFocus: () => {
      set({
        focusRequested: false,
        focusNodeId: null,
        focusOptions: null,
      })
    },

    setMirrorActiveNodeId: (id: string | null) => {
      set({ mirrorActiveNodeId: id })
    },

    signalMirrorChange: (id: string | null) => {
      // A non-null change bumps the tick so a repeated change to the same block
      // still re-pulses and re-centers; a null (metadata/var) frame does not.
      set((state) => ({
        mirrorLastChangeNodeId: id,
        mirrorChangeTick: id === null ? state.mirrorChangeTick : state.mirrorChangeTick + 1,
      }))
    },

    setDirty: (dirty: boolean) => {
      set({ isDirty: dirty })
    },

    resetZoom: () => {
      set((state) => ({
        viewport: { ...state.viewport, zoom: 1 },
      }))
    },

    /**
     * Post-state baseline model: undo moves the pointer back one slot and
     * restores the entry that lives there. The canvas always equals
     * `history[historyIndex]`. At the baseline (index 0) undo is a no-op.
     * Refuses while running/paused/save-in-flight; a pending grouped
     * text edit is finalized first; the drill location and UI refs are
     * reconciled against the restored tree.
     */
    undo: () => {
      if (historyGateBlocked(get())) return
      if (get().isDragging || get().isInTransaction) return
      flushPendingGroupingCommit(get, set)

      const state = get()
      // At baseline or empty history: nothing to undo
      if (state.historyIndex <= 0) return

      const entry = state.history[state.historyIndex - 1]

      // Conflict guard: corrupt entry at the target slot
      if (!entry?.nodes || !Array.isArray(entry.nodes) || !Array.isArray(entry.edges)) {
        set({
          lastError: { type: 'undo_conflict', message: 'Undo failed due to state conflict' },
          history: [],
          historyIndex: -1,
        })
        return
      }

      // Announcement reads from the entry being LEFT (what we are undoing)
      const leavingEntry = state.history[state.historyIndex]
      const operationDesc = leavingEntry?.operationDescription ?? 'last change'
      const announcement = `Undone: ${operationDesc}`

      const variables = entry.variables ?? []
      const reconciled = reconcileRestoredState(state, {
        nodes: entry.nodes,
        edges: entry.edges,
        variables,
      })
      set({
        ...reconciled,
        edges: entry.edges,
        variables,
        historyIndex: state.historyIndex - 1,
        isDirty: computeDerivedDirty({
          nodes: reconciled.nodes,
          edges: entry.edges,
          variables,
          history: state.history,
          isDirty: state.isDirty,
        }),
        lastAnnouncement: announcement,
        announcementSeq: state.announcementSeq + 1,
      })
    },

    /**
     * Post-state baseline model: redo advances the pointer and restores the
     * entry that lives there. At the end of history redo is a no-op. Same
     * gating, debounce-flush, and reconciliation rules as undo.
     */
    redo: () => {
      if (historyGateBlocked(get())) return
      if (get().isDragging || get().isInTransaction) return
      flushPendingGroupingCommit(get, set)

      const state = get()
      if (state.historyIndex >= state.history.length - 1) return

      const newIndex = state.historyIndex + 1
      const entry = state.history[newIndex]

      // Conflict guard
      if (!entry?.nodes || !Array.isArray(entry.nodes) || !Array.isArray(entry.edges)) {
        set({
          lastError: { type: 'redo_conflict', message: 'Redo failed due to state conflict' },
          history: [],
          historyIndex: -1,
        })
        return
      }

      // Announcement reads from the entry being ENTERED
      const operationDesc = entry.operationDescription ?? 'last change'
      const announcement = `Redone: ${operationDesc}`

      const variables = entry.variables ?? []
      const reconciled = reconcileRestoredState(state, {
        nodes: entry.nodes,
        edges: entry.edges,
        variables,
      })
      set({
        ...reconciled,
        edges: entry.edges,
        variables,
        historyIndex: newIndex,
        isDirty: computeDerivedDirty({
          nodes: reconciled.nodes,
          edges: entry.edges,
          variables,
          history: state.history,
          isDirty: state.isDirty,
        }),
        lastAnnouncement: announcement,
        announcementSeq: state.announcementSeq + 1,
      })
    },

    canUndo: () => {
      // Post-state baseline: at index 0 the canvas IS the baseline, so
      // there is nowhere to undo to. Execution-aware: unavailable
      // while running/paused/save-in-flight.
      const state = get()
      return state.historyIndex > 0 && !historyGateBlocked(state)
    },

    canRedo: () => {
      const state = get()
      return state.historyIndex < state.history.length - 1 && !historyGateBlocked(state)
    },

    /**
     * Append a post-mutation snapshot to the history timeline. Called AFTER
     * the action mutates state; the resulting entry IS the current canvas.
     * Silently skipped during drag/transaction - those wrappers commit once
     * at the end so individual sub-mutations group into one entry.
     */
    commitHistory: (operationDescription?: string) => {
      const state = get()

      // Drag/transaction in progress: the wrapper will commit at end
      if (state.isDragging) return
      if (state.isInTransaction) return

      set((currentState) => {
        const entry: HistoryEntry = {
          nodes: [...currentState.nodes],
          edges: [...currentState.edges],
          variables: [...currentState.variables],
          timestamp: Date.now(),
          operationDescription,
        }
        return {
          ...appendHistoryEntry(currentState, entry),
          isDirty: computeDerivedDirty(currentState),
        }
      })
    },

    copy: () => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const selectedNodes = active.nodes.filter((n) => state.selectedNodeIds.includes(n.id))

      // Only copy edges that connect two selected nodes
      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const selectedEdges = active.edges.filter(
        (e) => selectedNodeIdSet.has(e.source) && selectedNodeIdSet.has(e.target)
      )

      set({
        clipboard: {
          nodes: selectedNodes,
          edges: selectedEdges,
        },
        clipboardSource: 'copy',
      })
    },

    paste: (offset?: Position) => {
      const state = get()
      if (!state.clipboard || state.clipboard.nodes.length === 0) return

      const pasteOffset = offset ?? { x: DEFAULT_PASTE_OFFSET, y: DEFAULT_PASTE_OFFSET }

      const idMap = new Map<string, string>()
      const newNodes = state.clipboard.nodes.map(clonePastedNode(idMap, pasteOffset))
      const newEdges = state.clipboard.edges.map((edge) => ({
        ...edge,
        id: generateId(),
        source: idMap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? edge.target,
      }))

      // Cut is single-use: clear clipboard after paste so it can't be pasted again
      const isCutPaste = state.clipboardSource === 'cut'
      const clipboardClear = isCutPaste ? { clipboard: null, clipboardSource: null } : {}

      if (state.drillPath.length === 0) {
        set((currentState) => ({
          nodes: [...currentState.nodes, ...newNodes],
          edges: [...currentState.edges, ...newEdges],
          selectedNodeIds: newNodes.map(pluckId),
          isDirty: true,
          ...clipboardClear,
        }))
      } else {
        const afterNodes = applyMutationAtPath(state.nodes, state.drillPath, (inner) => [
          ...inner,
          ...newNodes,
        ])
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(afterNodes, state.drillPath, (innerEdges) => [
          ...innerEdges,
          ...newEdges,
        ])
        set({
          nodes: newRoot,
          selectedNodeIds: newNodes.map(pluckId),
          isDirty: true,
          ...clipboardClear,
        })
      }
      get().commitHistory('Paste')
    },

    cut: () => {
      const state = get()

      // Copy first (sets clipboardSource to 'copy')
      get().copy()

      // Then remove selected nodes from the active subtree
      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const filterNodes = filterByPredicate<NodeType>((n) => !selectedNodeIdSet.has(n.id))
      const filterEdges = filterByPredicate<EdgeType>(notSourceOrTargetInSet(selectedNodeIdSet))

      if (state.drillPath.length === 0) {
        const remainingNodes = filterNodes(state.nodes)
        set({
          nodes: remainingNodes,
          edges: filterEdges(state.edges),
          selectedNodeIds: [],
          ...releaseRemovedNodeRefs(state, remainingNodes),
          isDirty: true,
          clipboardSource: 'cut',
        })
      } else {
        const afterNodes = applyMutationAtPath(state.nodes, state.drillPath, filterNodes)
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(afterNodes, state.drillPath, filterEdges)
        set({
          nodes: newRoot,
          selectedNodeIds: [],
          ...releaseRemovedNodeRefs(state, newRoot),
          isDirty: true,
          clipboardSource: 'cut',
        })
      }
      get().commitHistory('Cut selection')
    },

    duplicate: () => {
      const state = get()
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)
      const selectedNodes = active.nodes.filter((n) => state.selectedNodeIds.includes(n.id))

      if (selectedNodes.length === 0) return

      // Create ID mapping
      const idMap = new Map<string, string>()

      const newNodes = selectedNodes.map((node) => {
        const newId = generateId()
        idMap.set(node.id, newId)

        // Clear output bindings on duplicated nodes to avoid duplicate variable writes
        const config = node.data.config
        const cleanedData = config?.outputBindings
          ? { ...node.data, config: { ...config, outputBindings: {} } }
          : node.data

        return {
          ...node,
          id: newId,
          data: cleanedData,
          position: {
            x: node.position.x + DEFAULT_PASTE_OFFSET,
            y: node.position.y + DEFAULT_PASTE_OFFSET,
          },
        }
      })

      // Duplicate edges between selected nodes
      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const newEdges = active.edges
        .filter((e) => selectedNodeIdSet.has(e.source) && selectedNodeIdSet.has(e.target))
        .map((edge) => ({
          ...edge,
          id: generateId(),
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
        }))

      if (state.drillPath.length === 0) {
        set({
          nodes: [...state.nodes, ...newNodes],
          edges: [...state.edges, ...newEdges],
          selectedNodeIds: newNodes.map((n) => n.id),
          isDirty: true,
        })
      } else {
        const afterNodes = applyMutationAtPath(state.nodes, state.drillPath, (inner) => [...inner, ...newNodes])
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(afterNodes, state.drillPath, (innerEdges) => [
          ...innerEdges,
          ...newEdges,
        ])
        set({
          nodes: newRoot,
          selectedNodeIds: newNodes.map((n) => n.id),
          isDirty: true,
        })
      }
      get().commitHistory('Duplicate selection')
    },

    // Batch operations (REQ-5.2.1.24)
    deleteSelected: () => {
      const state = get()
      if (state.selectedNodeIds.length === 0 && state.selectedEdgeIds.length === 0) return

      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const selectedEdgeIdSet = new Set(state.selectedEdgeIds)

      // Remove nodes and edges only - variables are never auto-deleted.
      // Only the Variable Manager can remove variables.
      // The OUT badge recomputes from live nodes automatically.
      const active = walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath)

      // Find target nodes that will lose ingress edges
      const affectedTargets = new Set<string>()
      for (const e of active.edges) {
        if (selectedEdgeIdSet.has(e.id) || selectedNodeIdSet.has(e.source)) {
          affectedTargets.add(e.target)
        }
      }

      const edgeFilter = filterSelectedEdgesNotConnected(selectedEdgeIdSet, selectedNodeIdSet)
      const computeEdges = (sourceEdges: EdgeType[]): EdgeType[] => {
        let next = sourceEdges.filter(edgeFilter)
        for (const targetId of affectedTargets) {
          if (!selectedNodeIdSet.has(targetId)) {
            next = migrateIngressHandles(next, targetId)
          }
        }
        return next
      }
      const filterNodes = filterByPredicate<NodeType>((n) => !selectedNodeIdSet.has(n.id))

      if (state.drillPath.length === 0) {
        const remainingNodes = filterNodes(state.nodes)
        set({
          nodes: remainingNodes,
          edges: computeEdges(state.edges),
          selectedNodeIds: [],
          selectedEdgeIds: [],
          ...releaseRemovedNodeRefs(state, remainingNodes),
          isDirty: true,
        })
      } else {
        const afterNodes = applyMutationAtPath(state.nodes, state.drillPath, filterNodes)
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(afterNodes, state.drillPath, computeEdges)
        set({
          nodes: newRoot,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          ...releaseRemovedNodeRefs(state, newRoot),
          isDirty: true,
        })
      }
      get().commitHistory('Delete selection')
    },

    disconnectSelected: () => {
      const state = get()
      if (state.selectedNodeIds.length === 0 && state.selectedEdgeIds.length === 0) return

      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const selectedEdgeIdSet = new Set(state.selectedEdgeIds)
      const computeEdges = (sourceEdges: EdgeType[]) =>
        computeDisconnectedEdges(sourceEdges, selectedEdgeIdSet, selectedNodeIdSet)

      if (state.drillPath.length === 0) {
        set({
          edges: computeEdges(state.edges),
          selectedNodeIds: [],
          selectedEdgeIds: [],
          isDirty: true,
        })
      } else {
        const newRoot = applyEdgesMutationAtPath<NodeType, EdgeType>(state.nodes, state.drillPath, computeEdges)
        set({
          nodes: newRoot,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          isDirty: true,
        })
      }
      get().commitHistory('Disconnect selection')
    },

    moveSelectedNodes: (delta: Position) => {
      const state = get()
      if (state.selectedNodeIds.length === 0) return

      const selectedNodeIdSet = new Set(state.selectedNodeIds)
      const shift = (nodes: NodeType[]) => shiftSelectedNodes(nodes, selectedNodeIdSet, delta)

      if (state.drillPath.length === 0) {
        set({ nodes: shift(state.nodes), isDirty: true })
      } else {
        const newRoot = applyMutationAtPath(state.nodes, state.drillPath, shift)
        set({ nodes: newRoot, isDirty: true })
      }
      get().commitHistory('Move selection')
    },

    // Operation grouping (REQ-5.2.1.24)
    startDragOperation: () => {
      const state = get()
      set({
        isDragging: true,
        dragStartState: {
          nodes: [...state.nodes],
          edges: [...state.edges],
          variables: [...state.variables],
        },
      })
    },

    /**
     * Close a drag operation. Commits a single post-state entry IF the
     * canvas actually moved. A click-then-release with no displacement
     * produces zero history entries (the user's intent was a click).
     */
    endDragOperation: () => {
      const state = get()
      if (!state.isDragging) return

      const startState = state.dragStartState
      const hasDisplacement =
        !startState ||
        !canonicalEqual(startState.nodes, state.nodes) ||
        !canonicalEqual(startState.edges, state.edges)

      if (!hasDisplacement) {
        // No movement - just clear the drag flags, no commit
        set({ isDragging: false, dragStartState: null })
        return
      }

      // Commit the post-drag state into history
      set((currentState) => {
        const entry: HistoryEntry = {
          nodes: [...currentState.nodes],
          edges: [...currentState.edges],
          variables: [...currentState.variables],
          timestamp: Date.now(),
          operationDescription: 'Move block',
        }
        return {
          ...appendHistoryEntry(currentState, entry),
          isDirty: computeDerivedDirty(currentState),
          isDragging: false,
          dragStartState: null,
        }
      })
    },

    cancelDragOperation: () => {
      const state = get()
      if (!state.isDragging || !state.dragStartState) return

      // Revert to state before drag started
      set({
        nodes: state.dragStartState.nodes,
        edges: state.dragStartState.edges,
        variables: state.dragStartState.variables,
        isDragging: false,
        dragStartState: null,
      })
    },

    /**
     * Group multiple mutations into one history entry. Inner sub-mutations
     * skip their own commit because `isInTransaction` is true; on success
     * the wrapper appends a single post-state entry. On failure, state is
     * rolled back to the pre-transaction snapshot and no commit fires.
     */
    transaction: (callback: () => void, description?: string) => {
      const state = get()

      // Nested transactions flatten - the outer wrapper owns the commit
      if (state.isInTransaction) {
        callback()
        return
      }

      // Capture pre-transaction state for rollback
      set({
        isInTransaction: true,
        transactionStartState: {
          nodes: [...state.nodes],
          edges: [...state.edges],
          variables: [...state.variables],
        },
      })

      try {
        callback()

        // Success: append single post-state entry for the entire batch
        set((s) => {
          const entry: HistoryEntry = {
            nodes: [...s.nodes],
            edges: [...s.edges],
            variables: [...s.variables],
            timestamp: Date.now(),
            operationDescription: description ?? 'Batch operation',
          }
          return {
            ...appendHistoryEntry(s, entry),
            isDirty: computeDerivedDirty(s),
            isInTransaction: false,
            transactionStartState: null,
          }
        })
      } catch (error) {
        // Rollback to pre-transaction snapshot (no commit)
        const startState = get().transactionStartState
        set({
          nodes: startState?.nodes ?? [],
          edges: startState?.edges ?? [],
          variables: startState?.variables ?? [],
          isInTransaction: false,
          transactionStartState: null,
        })
        throw error
      }
    },

    /**
     * Save commits the current canvas as the new baseline. Floors the undo
     * stack to a single `isInitialState` entry; users cannot undo past a
     * save, so `canUndo() === false` immediately after. The baseline holds
     * the CANONICAL form of the live tree (the persisted shape); a
     * pending grouped text edit is absorbed into it.
     */
    markSaved: () => {
      cancelPendingGroupingCommit(get, set)
      const state = get()
      set({
        isDirty: false,
        lastSavedAt: Date.now(),
        history: [
          makeBaselineEntry(
            canonicalizeNodes(state.nodes),
            canonicalizeEdges(state.edges),
            state.variables,
            'Saved baseline',
          ),
        ],
        historyIndex: 0,
      })
    },

    /**
     * Reset the canvas to an empty draft and floor the undo stack with an
     * empty baseline so `canUndo() === false` immediately after.
     */
    reset: () => {
      cancelPendingGroupingCommit(get, set)
      clearScriptSyntaxIssues()
      set({
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        selectedNodeIds: [],
        selectedEdgeIds: [],
        breakpoints: new Set<string>(),
        pausedNodeId: null,
        // debugOptions is a per-browser user preference (localStorage
        // persistence); it must NOT be wiped by workflow resets.
        skippedNodeIds: [],
        nodeIssues: new Map(),
        nodeSyntaxIssues: new Map(),
        catalogPulls: new Map(),
        pulseValidationNodeIds: new Set(),
        openConfigNodeIds: [],
        lastInteractedNodeId: null,
        dirtyConfigNodeIds: [],
        pendingDeleteNodeIds: null,
        pendingDrillAction: null,
        pendingSecretPromotion: null,
        publishDialogNodeId: null,
        makeLocalDialogNodeId: null,
        publishEditModeDialogNodeId: null,
        dropChangesDialogNodeId: null,
        digInPendingNodeId: null,
        variables: [],
        namespaceVariables: { system: [], suite: [], regression: [] },
        history: [makeBaselineEntry([], [], [], 'Empty canvas')],
        historyIndex: 0,
        clipboard: null,
        clipboardSource: null,
        isDirty: false,
        lastSavedAt: null,
        executionStatus: 'idle',
        saveInFlight: false,
        editingTestId: null,
        editingTestName: null,
        editingTestSuiteIds: [],
        functionViewMode: null,
        functionViewBaseline: null,
        lastError: null,
        lastAnnouncement: '',
        announcementSeq: 0,
        isCanvasReady: false,
        fitViewRequested: false,
        fitViewOptions: null,
        focusRequested: false,
        focusNodeId: null,
        focusOptions: null,
        mirrorActiveNodeId: null,
    mirrorLastChangeNodeId: null,
    mirrorChangeTick: 0,
        isDragging: false,
        isInTransaction: false,
        dragStartState: null,
        transactionStartState: null,
        groupingDebounceTimer: null,
        drillPath: [],
      })
    },

    clearError: () => {
      set({ lastError: null })
    },

    setExecutionStatus: (status) => {
      set({ executionStatus: status })
    },

    setSaveInFlight: (inFlight) => {
      set({ saveInFlight: inFlight })
    },

    setEditingTest: (testId, testName) => {
      set({ editingTestId: testId, editingTestName: testName })
    },

    setEditingTestSuiteIds: (suiteIds) => {
      set({ editingTestSuiteIds: suiteIds })
    },

    clearEditingTest: () => {
      set({ editingTestId: null, editingTestName: null, editingTestSuiteIds: [] })
    },

    enterFunctionView: (mode) => {
      set({ functionViewMode: mode })
    },

    exitFunctionView: () => {
      set({ functionViewMode: null, functionViewBaseline: null })
    },

    setFunctionViewBaseline: (baseline) => {
      set({ functionViewBaseline: baseline })
    },

    setFunctionViewVersion: (version) => {
      const current = get().functionViewMode
      if (current === null) return
      set({ functionViewMode: { ...current, version } })
    },

    pushDrill: (nodeId) => {
      const state = get()
      const activeSubtree = walkActiveSubtree(
        state.nodes,
        state.edges,
        state.variables,
        state.drillPath,
      )
      const node = activeSubtree.nodes.find(byId(nodeId))
      if (!node) return
      if (node.data.nodeType !== 'function') return
      if (node.data.functionLifecycle !== 'local') return
      if (!node.data.localDefinition) return
      const entry: DrillEntry = { nodeId, label: node.data.label }
      set({ drillPath: [...state.drillPath, entry] })
    },

    pushSharedDrill: (nodeId, resolvedDefinition) => {
      const state = get()
      const activeSubtree = walkActiveSubtree(
        state.nodes,
        state.edges,
        state.variables,
        state.drillPath,
      )
      const node = activeSubtree.nodes.find(byId(nodeId))
      if (!node) return
      if (node.data.nodeType !== 'function') return
      if (node.data.functionLifecycle !== 'shared') return
      // Inject the resolved library body as the node's localDefinition at
      // the current drill level. The injection is transient: sanitize-on-save
      // strips localDefinition from shared nodes before persisting.
      const inject = injectLocalDefinition(nodeId, resolvedDefinition)
      const newRoot =
        state.drillPath.length === 0
          ? inject(state.nodes)
          : applyMutationAtPath(state.nodes, state.drillPath, inject)
      const entry: DrillEntry = { nodeId, label: node.data.label }
      set({ nodes: newRoot, drillPath: [...state.drillPath, entry] })
    },

    refreshSharedDrillBody: (nodeId, resolvedDefinition) => {
      const state = get()
      const last = state.drillPath.at(-1)
      // Only meaningful while drilled into nodeId (deepest entry): replace its injected body in place, drillPath untouched.
      if (last?.nodeId !== nodeId) return
      const parentPath = state.drillPath.slice(0, -1)
      const inject = injectLocalDefinition(nodeId, resolvedDefinition)
      set({
        nodes:
          parentPath.length === 0
            ? inject(state.nodes)
            : applyMutationAtPath(state.nodes, parentPath, inject),
      })
    },

    isCurrentScopeReadOnly: () => {
      const state = get()
      return isScopeReadOnly(state.nodes, state.drillPath)
    },

    popDrillOne: () => {
      const state = get()
      if (state.drillPath.length === 0) return
      const nextPath = state.drillPath.slice(0, -1)
      set({
        drillPath: nextPath,
        nodes: cleanupSharedDrillResidue(state.nodes, state.drillPath, nextPath),
      })
    },

    popDrillTo: (depth) => {
      const state = get()
      if (depth >= state.drillPath.length) return
      const clamped = Math.max(0, depth)
      const nextPath = state.drillPath.slice(0, clamped)
      set({
        drillPath: nextPath,
        nodes: cleanupSharedDrillResidue(state.nodes, state.drillPath, nextPath),
      })
    },

    clearDrill: () => {
      const state = get()
      if (state.drillPath.length === 0) return
      set({
        drillPath: [],
        nodes: cleanupSharedDrillResidue(state.nodes, state.drillPath, []),
      })
    },

    getActiveNodes: () => {
      const state = get()
      return walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).nodes
    },

    getActiveEdges: () => {
      const state = get()
      return walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).edges
    },

    getActiveVariables: () => {
      const state = get()
      return walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).variables
    },

    // Derived selectors
    getSelectedNodes: () => {
      const state = get()
      return state.nodes.filter((n) => state.selectedNodeIds.includes(n.id))
    },

    getSelectedEdges: () => {
      const state = get()
      return state.edges.filter((e) => state.selectedEdgeIds.includes(e.id))
    },

    getNodeCount: () => {
      return get().nodes.length
    },

    getEdgeCount: () => {
      return get().edges.length
    },

    getNodesByType: (type) => {
      return get().nodes.filter((n) => n.type === type)
    },

    getConnectedNodes: (nodeId) => {
      const state = get()
      const connectedIds = new Set<string>()

      state.edges.forEach((edge) => {
        if (edge.source === nodeId) {
          connectedIds.add(edge.target)
        }
        if (edge.target === nodeId) {
          connectedIds.add(edge.source)
        }
      })

      return state.nodes.filter((n) => connectedIds.has(n.id))
    },

    getEdgesBySource: (sourceId) => {
      return get().edges.filter((edge) => edge.source === sourceId)
    },

    getEdgesByTarget: (targetId) => {
      return get().edges.filter((edge) => edge.target === targetId)
    },

    hasUnsavedChanges: () => {
      return get().isDirty
    },

    getSavedNodes: () => findBaselineEntry(get().history)?.nodes ?? EMPTY_SAVED_NODES,

    getSavedVariables: () => {
      return findBaselineEntry(get().history)?.variables ?? EMPTY_SAVED_VARIABLES
    },

    isNodeSelected: (nodeId) => {
      return get().selectedNodeIds.includes(nodeId)
    },

    prefersReducedMotion: () => {
      if (globalThis.window === undefined) return false
      return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    },
  })
}

function attachNodeIssuesSubscription(store: WorkflowStoreApi): void {
  const recompute = (nodes: NodeType[], variables: WorkflowVariable[]): void => {
    const issues = computeNodeIssues(
      nodes as Parameters<typeof computeNodeIssues>[0],
      variables.map((v) => ({ name: v.name, type: v.type })),
    )
    store.setState({ nodeIssues: issues })
  }
  const initialState = store.getState()
  recompute(initialState.nodes, initialState.variables)
  store.subscribe(
    (state) => ({
      nodes: state.nodes,
      variables: state.variables,
      syntax: state.nodeSyntaxIssues,
    }),
    ({ nodes, variables }) => recompute(nodes, variables),
    {
      equalityFn: (a, b) =>
        a.nodes === b.nodes && a.variables === b.variables && a.syntax === b.syntax,
    },
  )
}

export function createWorkflowStore(options: CreateWorkflowStoreOptions = {}) {
  const { initialSnapshot, persistKey = EDITING_TEST_STORAGE_KEY } = options
  const initializer = buildInitializer(initialSnapshot)

  const store =
    persistKey === null
      ? createStore<WorkflowState>()(subscribeWithSelector(initializer))
      : createStore<WorkflowState>()(
          subscribeWithSelector(
            persist(initializer, {
              name: persistKey,
              partialize: (state) => ({
                editingTestId: state.editingTestId,
                editingTestName: state.editingTestName,
              }),
            }),
          ),
        )

  attachNodeIssuesSubscription(store)
  return store
}

// Default "live" store instance. Any component rendered without a
// `WorkflowStoreProvider` sees this one; `.getState()` / `.setState()` /
// `.subscribe()` accessed statically on `useWorkflowStore` target this
// same instance, so existing code that accesses the store imperatively
// continues to hit the live workbench state byte-for-byte.
const defaultStore = createWorkflowStore()

const WorkflowStoreContext = createContext<WorkflowStoreApi>(defaultStore)

export function WorkflowStoreProvider({
  children,
  store,
}: Readonly<{
  children: ReactNode
  /** Caller-owned store. If omitted, a transient instance is created. */
  store?: WorkflowStoreApi
}>) {
  const storeRef = useRef<WorkflowStoreApi | null>(null)
  /* v8 ignore next - COV-UNREACH-018 */
  storeRef.current ??= store ?? createWorkflowStore({ persistKey: null })
  /* v8 ignore next - COV-UNREACH-018 */
  const effectiveStore = store ?? storeRef.current
  return createElement(
    WorkflowStoreContext.Provider,
    { value: effectiveStore },
    children,
  )
}

export function useWorkflowStoreInstance(): WorkflowStoreApi {
  return useContext(WorkflowStoreContext)
}

type UseWorkflowStoreHook = {
  <T>(selector: (state: WorkflowState) => T): T
  getState: WorkflowStoreApi['getState']
  setState: WorkflowStoreApi['setState']
  subscribe: WorkflowStoreApi['subscribe']
}

function useWorkflowStoreHook<T>(selector: (state: WorkflowState) => T): T {
  const api = useContext(WorkflowStoreContext)
  return useStore(api, selector)
}

export const useWorkflowStore: UseWorkflowStoreHook = Object.assign(
  useWorkflowStoreHook,
  {
    getState: defaultStore.getState,
    setState: defaultStore.setState,
    subscribe: defaultStore.subscribe,
  },
)

// Export types
export type {
  Position,
  NodeType,
  EdgeType,
  ViewportState,
  HistoryEntry,
  WorkflowError,
  WorkflowState,
  SelectNodeOptions,
  Rect,
}
