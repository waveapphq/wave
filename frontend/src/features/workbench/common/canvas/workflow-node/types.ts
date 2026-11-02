export interface WorkflowNodeData {
  label?: string
  elementType: string
  nodeType?: 'control' | 'plugin' | 'function'
  version?: string
  hasNewerVersion?: boolean
  /** Function-only: whether the function lives inside this Test (local) or in the shared library (shared). */
  functionLifecycle?: 'local' | 'shared'
  /** Shared Function instance: pinned library id. */
  functionId?: string
  /** Shared Function instance: pinned library version (REQ-3.1.2.2). */
  functionVersion?: string
  /** Shared Function instance: library entry's name at drop time. The
   *  user-visible `label` is independently mutable; this field preserves the
   *  source library name so the modal's "From library: <name>" link and any
   *  future traceback UI can recover the original reference after a rename. */
  originalLibraryName?: string
  /** Shared Function instance: true when the node carries an in-Test draft (REQ-3.1.2.2). */
  editMode?: boolean
  /** Edit-mode upstream link to the source version the draft was snapshotted from. */
  upstreamLink?: { functionId: string; sourceVersion: string }
  /** Edit-mode draft body; the execution engine runs this while editMode is true. */
  draft?: Record<string, unknown>
  /** Per-instance description (multiline, max 64 chars). */
  description?: string
  /** Persisted expand state for the description chevron toggle. */
  descriptionExpanded?: boolean
  disabled?: boolean
  isExecuting?: boolean
  proximitySource?: boolean
  proximityTarget?: boolean
  proximityCycleDetected?: boolean
  config?: Record<string, unknown>
}

export interface WorkflowNodeProps {
  id: string
  data: WorkflowNodeData
  selected?: boolean
  dragging?: boolean
  /** User-resized width in px, range [160, 360] (function blocks floor at 192). */
  width?: number
  /** User-resized height in px, range [44, 240]. */
  height?: number
}

/** Default / clamp constants for canvas node sizing. */
export const NODE_DEFAULT_WIDTH = 240
export const NODE_MIN_WIDTH = 160
// Function nodes carry extra action-row footer elements (the L/S lifecycle badge
// and the dig-in chevron), so they need a wider floor to keep the run-state badge
// from crowding the cog/kebab.
export const NODE_FUNCTION_MIN_WIDTH = 192
export const NODE_MAX_WIDTH = 360
export const NODE_DEFAULT_HEIGHT = 44
export const NODE_MAX_HEIGHT = 240
