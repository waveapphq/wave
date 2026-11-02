/**
 * Canvas Action Bar Types
 *
 * Shared type definitions for the canvas action bar component and its sub-components.
 */

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped'

export interface Environment {
  id: string
  name: string
}

export interface CanvasActionBarProps {
  /** Current workflow execution status */
  status?: WorkflowStatus
  /** Whether workflow has unsaved changes */
  isDirty?: boolean
  /** Whether undo is available */
  canUndo?: boolean
  /** Whether redo is available */
  canRedo?: boolean
  /** Whether to show the close button (hidden on draft pages) */
  showCloseButton?: boolean
  /** Whether to show the Test-lifecycle controls (Close, Save, Edit). False in
   *  the read-only library Function View, which has no parent Test. */
  showTestControls?: boolean
  /** Whether editing an existing test (Close always enabled to return to draft) */
  isEditingTest?: boolean
  /** Element type of the currently paused node; drives context-aware Skip Block disable. */
  pausedElementType?: string | null
  /** When the canvas is drilled into a published Function show the
   *  read-only chrome (lock pill + Edit button + bracketing splitters). */
  showReadOnlyChrome?: boolean
  /** Session-ownership mirror lock: disables Save/Edit/Undo/Redo/Run/Debug. */
  editingLocked?: boolean
  /** Watcher-side mirrored run: with `editingLocked`, collapses the right side
   *  to the run's env readout + Focus Current. */
  mirroredRun?: { environmentName: string | null; hasCurrentBlock: boolean } | null
  /** Holder-side count of other viewers mirroring the draft (0 hides the pill). */
  watchersCount?: number
  /** Currently selected environment */
  selectedEnvironment?: string | null
  /** Available environments */
  availableEnvironments?: Environment[]
  /** Recently used environments */
  recentEnvironments?: Environment[]
  /** Whether to remember environment selection */
  rememberSelection?: boolean
  /** Debug options */
  debugOptions?: {
    pauseOnFirstBlock: boolean
    pauseOnErrors: boolean
  }
  /** Callbacks */
  onClose?: () => void
  onSave?: () => void
  onEdit?: () => void
  onUndo?: () => void
  onRedo?: () => void
  onEnvironmentChange?: (env: string | null) => void
  onRememberSelectionChange?: (remember: boolean) => void
  onDebugOptionsChange?: (options: {
    pauseOnFirstBlock: boolean
    pauseOnErrors: boolean
  }) => void
  onRun?: (scope: 'current' | 'all', environmentOverride?: string) => void
  onDebug?: (scope: 'current' | 'all', environmentOverride?: string) => void
  onPause?: () => void
  onStop?: (mode: 'immediate' | 'finalize') => void
  onContinue?: () => void
  onSkipBlock?: () => void
  onStepOver?: () => void
  onStepInto?: () => void
  onRepeatStep?: () => void
  onFocusCurrent?: () => void
}
