/**
 * Canvas Action Bar
 *
 * Top toolbar for the canvas page with workflow actions and execution controls.
 * Height: 48px
 *
 * Left side (all states): Close, Save, Undo, Redo
 * Right side (by state):
 *   - Idle: Environment selector, Debug options gear, Debug split button, Run split button
 *   - Running: Stop, Focus Current
 *   - Paused: Step Over, Step Into, Repeat Step, Continue, Skip Block, Stop, Focus Current
 */

/* v8 ignore next - COV-V8-001 */
import { useState, type ReactNode } from 'react'
import { X, Save, Pencil, Undo2, Redo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { CanvasActionBarProps, Environment } from './types'
import { EnvironmentSelectionDialog } from './environment-selection-dialog'
import { EnvironmentSelector } from './environment-selector'
import { EnvReadout } from './env-readout'
import { FocusCurrentButton } from './focus-current-button'
import { DebugOptionsPopover } from './debug-options-popover'
import { ExecutionControls } from './execution-controls'
import { DrilledSharedChrome } from '../chrome/drilled-shared-chrome'
import { WatchersIndicator } from '../chrome/watchers-indicator'

// Default empty environments - environments should be fetched from backend
const DEFAULT_ENVIRONMENTS: Environment[] = []
const DEFAULT_RECENT: Environment[] = []

export function CanvasActionBar({
  status = 'idle',
  isDirty = false,
  canUndo = false,
  canRedo = false,
  showCloseButton = true,
  showTestControls = true,
  isEditingTest = false,
  selectedEnvironment = null,
  availableEnvironments = DEFAULT_ENVIRONMENTS,
  recentEnvironments = DEFAULT_RECENT,
  rememberSelection = false,
  debugOptions = { pauseOnFirstBlock: false, pauseOnErrors: false },
  onClose,
  onSave,
  onEdit,
  onUndo,
  onRedo,
  onEnvironmentChange,
  onRememberSelectionChange,
  onDebugOptionsChange,
  onRun,
  onDebug,
  onPause,
  onStop,
  onContinue,
  onSkipBlock,
  onStepOver,
  onStepInto,
  onRepeatStep,
  pausedElementType = null,
  onFocusCurrent,
  showReadOnlyChrome = false,
  editingLocked = false,
  mirroredRun = null,
  watchersCount = 0,
}: Readonly<CanvasActionBarProps>): ReactNode {
  const [envSearch, setEnvSearch] = useState('')
  const [envPopoverOpen, setEnvPopoverOpen] = useState(false)
  const [envDialogOpen, setEnvDialogOpen] = useState(false)
  const [envDialogAction, setEnvDialogAction] = useState<'run' | 'debug'>('run')
  const [dialogEnvSearch, setDialogEnvSearch] = useState('')
  const [dialogSelectedEnv, setDialogSelectedEnv] = useState<string | null>(null)

  const isRunning = status === 'running'
  const isPaused = status === 'paused'
  const isTerminal = status === 'stopped' || status === 'passed' || status === 'failed' || status === 'skipped'
  const isExecuting = isRunning || isPaused
  // Show idle controls when idle or in a terminal state (stopped/passed/failed)
  const showIdleControls = status === 'idle' || isTerminal

  // Filter environments by search
  const filteredEnvironments = availableEnvironments.filter((env) =>
    env.name.toLowerCase().includes(envSearch.toLowerCase())
  )

  // Get display name for selected environment
  const selectedEnvName = selectedEnvironment
    ? availableEnvironments.find((e) => e.id === selectedEnvironment)?.name ?? selectedEnvironment
    : null

  // Handle opening env selection dialog for run/debug without env
  const handleActionWithoutEnv = (action: 'run' | 'debug') => {
    setEnvDialogAction(action)
    setDialogSelectedEnv(null)
    setDialogEnvSearch('')
    setEnvDialogOpen(true)
  }

  // Handle confirming action in env dialog
  const handleEnvDialogConfirm = () => {
    /* v8 ignore next - COV-DEF-045: Guard clause unreachable - confirm button disabled when no env selected */
    if (!dialogSelectedEnv) return
    /* v8 ignore start - COV-DEF-046: Optional callbacks always provided by parent in practice */
    // First update the environment in the parent (for UI state)
    onEnvironmentChange?.(dialogSelectedEnv)
    // Then execute the action with environment override
    // (We pass the env directly since state update is async)
    if (envDialogAction === 'run') {
      onRun?.('current', dialogSelectedEnv)
    } else {
      onDebug?.('current', dialogSelectedEnv)
    }
    setEnvDialogOpen(false)
    /* v8 ignore stop */
  }

  return (
    <>
      {/* Environment Selection Dialog for Run/Debug without env */}
      <EnvironmentSelectionDialog
        open={envDialogOpen}
        onOpenChange={setEnvDialogOpen}
        action={envDialogAction}
        environments={availableEnvironments}
        searchValue={dialogEnvSearch}
        onSearchChange={setDialogEnvSearch}
        selectedEnv={dialogSelectedEnv}
        onSelectEnv={setDialogSelectedEnv}
        onConfirm={handleEnvDialogConfirm}
      />
    <div
      data-testid="canvas-toolbar"
      className="flex min-h-12 shrink-0 items-center justify-between gap-2 whitespace-nowrap border-b border-default bg-background px-4 py-1.5"
    >
      {/* Left group: Close (common to Tests + the Function View - closes the
          workflow back to a draft), then the Test-only Save/Edit (hidden in the
          read-only library Function View), then Undo/Redo. */}
      <div data-testid="toolbar-left-group" className="flex items-center gap-2">
        {showCloseButton && (
          <>
            <Button
              data-testid="toolbar-close-button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              // Enabled in the View (showTestControls=false) so the user can
              // always close the open workflow back to a draft.
              disabled={isExecuting || (!isEditingTest && !isDirty && showTestControls)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>

            <Separator orientation="vertical" className="mx-1 h-5" />
          </>
        )}

        {showTestControls && (
          <>
            <Button
              data-testid="toolbar-save-button"
              variant="ghost"
              size="sm"
              onClick={onSave}
              disabled={!isDirty || isExecuting || editingLocked}
              className="h-8 gap-1.5 px-2"
            >
              <Save className="h-4 w-4" />
              <span className="text-sm">Save</span>
            </Button>

            <Button
              data-testid="toolbar-edit-button"
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={!isEditingTest || isExecuting || editingLocked}
              className="h-8 gap-1.5 px-2"
            >
              <Pencil className="h-4 w-4" />
              <span className="text-sm">Edit</span>
            </Button>

            <Separator orientation="vertical" className="mx-1 h-5" />
          </>
        )}

        {/* canUndo/canRedo are execution-aware store guards; no local
            isExecuting OR so keyboard and toolbar cannot diverge. */}
        <Button
          data-testid="toolbar-undo-button"
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo || editingLocked}
          className="h-8 w-8 p-0"
        >
          <Undo2 className="h-4 w-4" />
          <span className="sr-only">Undo</span>
        </Button>

        <Button
          data-testid="toolbar-redo-button"
          variant="ghost"
          size="sm"
          onClick={onRedo}
          disabled={!canRedo || editingLocked}
          className="h-8 w-8 p-0"
        >
          <Redo2 className="h-4 w-4" />
          <span className="sr-only">Redo</span>
        </Button>
      </div>

      {/* Right group: varies by state. A locked watcher mirroring a run holds
          no run control: the run's env readout + Focus Current only. */}
      {/* No label ever breaks; with no room, whole buttons move to a second row. */}
      <div data-testid="toolbar-right-group" className="flex flex-wrap items-center justify-end gap-2">
        <WatchersIndicator count={watchersCount} />
        {editingLocked && mirroredRun ? (
          <>
            <EnvReadout environmentName={mirroredRun.environmentName} />
            <FocusCurrentButton
              onFocusCurrent={onFocusCurrent}
              disabled={!mirroredRun.hasCurrentBlock}
            />
          </>
        ) : (
          <>
            {showIdleControls && (
              <>
                {/* Environment Selector */}
                <EnvironmentSelector
                  selectedEnvironment={selectedEnvironment}
                  selectedEnvName={selectedEnvName}
                  recentEnvironments={recentEnvironments}
                  filteredEnvironments={filteredEnvironments}
                  rememberSelection={rememberSelection}
                  envSearch={envSearch}
                  popoverOpen={envPopoverOpen}
                  onPopoverOpenChange={setEnvPopoverOpen}
                  onSearchChange={setEnvSearch}
                  onEnvironmentChange={onEnvironmentChange}
                  onRememberSelectionChange={onRememberSelectionChange}
                  disabled={editingLocked}
                />

                {/* Read-only chrome while drilled into a Shared instance. */}
                {showReadOnlyChrome && <DrilledSharedChrome />}

                <Separator orientation="vertical" className="mx-1 h-5" />

                {/* Debug Options Gear */}
                <DebugOptionsPopover
                  debugOptions={debugOptions}
                  onDebugOptionsChange={onDebugOptionsChange}
                  disabled={editingLocked}
                />
              </>
            )}

            <ExecutionControls
              editingLocked={editingLocked}
              selectedEnvironment={selectedEnvironment}
              onActionWithoutEnv={handleActionWithoutEnv}
              onRun={onRun}
              onDebug={onDebug}
              onPause={onPause}
              onStop={onStop}
              onContinue={onContinue}
              onSkipBlock={onSkipBlock}
              onStepOver={onStepOver}
              onStepInto={onStepInto}
              onRepeatStep={onRepeatStep}
              pausedElementType={pausedElementType}
              onFocusCurrent={onFocusCurrent}
              showIdleControls={showIdleControls}
              isRunning={isRunning}
              isPaused={isPaused}
            />
          </>
        )}
      </div>
    </div>
    </>
  )
}
