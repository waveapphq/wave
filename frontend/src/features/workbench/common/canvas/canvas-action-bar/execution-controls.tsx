/**
 * Execution Controls
 *
 * Right-side toolbar controls that change based on workflow status.
 */

/* v8 ignore next - COV-V8-001 */
import type { ReactNode, MouseEvent } from 'react'
import {
  Play,
  Square,
  StepForward,
  ArrowDownToLine,
  SkipForward,
  RefreshCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SplitButton } from '@/components/shared/split-button'
import { DebugSplitButton } from './debug-split-button'
import { FocusCurrentButton } from './focus-current-button'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export type StopMode = 'immediate' | 'finalize'

const SKIP_BLOCK_DISABLED_TOOLTIP =
  'Cannot skip branching block; step into a branch and skip a leaf inside'

const DIVERGING_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'if-else',
  'assert-split',
])

interface ExecutionControlsProps {
  /** Session-ownership mirror lock: disables the idle Run/Debug launchers. */
  editingLocked?: boolean
  selectedEnvironment: string | null
  onActionWithoutEnv: (action: 'run' | 'debug') => void
  onRun?: (scope: 'current' | 'all', environmentOverride?: string) => void
  onDebug?: (scope: 'current' | 'all', environmentOverride?: string) => void
  onPause?: () => void
  onStop?: (mode: StopMode) => void
  onContinue?: () => void
  onSkipBlock?: () => void
  onStepOver?: () => void
  onStepInto?: () => void
  onRepeatStep?: () => void
  pausedElementType?: string | null
  onFocusCurrent?: () => void
  showIdleControls: boolean
  isRunning: boolean
  isPaused: boolean
}

function IdleControls({
  editingLocked = false,
  selectedEnvironment,
  onActionWithoutEnv,
  onRun,
  onDebug,
}: Readonly<
  Pick<
    ExecutionControlsProps,
    'editingLocked' | 'selectedEnvironment' | 'onActionWithoutEnv' | 'onRun' | 'onDebug'
  >
>): ReactNode {
  // DebugSplitButton only fires `onDebug(scope)` today - the env-override
  // branch is owned by the CanvasActionBar's env-selection dialog, which
  // invokes the outer `onDebug` prop directly. Opening that dialog here is
  // the only responsibility left when no environment is selected.
  const handleDebug = (scope: 'current' | 'all') => {
    if (selectedEnvironment) {
      onDebug?.(scope)
    } else {
      onActionWithoutEnv('debug')
    }
  }

  const handleRunPrimary = () => {
    if (selectedEnvironment) {
      onRun?.('current')
    } else {
      onActionWithoutEnv('run')
    }
  }

  return (
    <>
      <DebugSplitButton
        onDebug={handleDebug}
        selectedEnvironment={selectedEnvironment}
        showCurrentScope={true}
        disabled={editingLocked}
      />

      <Separator orientation="vertical" className="mx-1 h-5" />

      <SplitButton
        label="Run"
        icon={<Play className="h-4 w-4" />}
        variant="default"
        onPrimaryClick={handleRunPrimary}
        disabled={editingLocked}
        caretDisabled={!selectedEnvironment}
        testIdPrefix="run"
        options={[
          { id: 'current', label: 'Run Scope', onClick: () => onRun?.('current') },
          { id: 'all', label: 'Run All', onClick: () => onRun?.('all') },
        ]}
      />
    </>
  )
}

function StopSplitButton({
  onStop,
}: Readonly<Pick<ExecutionControlsProps, 'onStop'>>): ReactNode {
  return (
    <SplitButton
      label="Stop"
      icon={<Square className="h-4 w-4" />}
      variant="destructive"
      onPrimaryClick={() => onStop?.('immediate')}
      testIdPrefix="action-stop"
      options={[
        {
          id: 'immediate',
          label: 'Immediate Stop',
          onClick: () => onStop?.('immediate'),
        },
        {
          id: 'finalize',
          label: 'Stop with Finalization',
          onClick: () => onStop?.('finalize'),
        },
      ]}
    />
  )
}

function RunningControls({
  onStop,
  onFocusCurrent,
}: Readonly<Pick<ExecutionControlsProps, 'onStop' | 'onFocusCurrent'>>): ReactNode {
  // No manual Pause while Running: a debug run pauses at a breakpoint or a debug
  // option (first block, errors). Stop + Focus Current are the only Running controls.
  return (
    <>
      <StopSplitButton onStop={onStop} />
      <FocusCurrentButton onFocusCurrent={onFocusCurrent} />
    </>
  )
}

function PausedControls({
  onStepOver,
  onStepInto,
  onRepeatStep,
  onContinue,
  onSkipBlock,
  pausedElementType,
  onStop,
  onFocusCurrent,
}: Readonly<
  Pick<
    ExecutionControlsProps,
    | 'onStepOver'
    | 'onStepInto'
    | 'onRepeatStep'
    | 'onContinue'
    | 'onSkipBlock'
    | 'pausedElementType'
    | 'onStop'
    | 'onFocusCurrent'
  >
>): ReactNode {
  // Skip Block is disabled for diverging parents (if-else, assert-split,
  // switch): there is no single fall-through path past the sub-graph, so
  // the user must step into a branch and skip a leaf instead. We use
  // aria-disabled (not the HTML disabled attribute) so the button stays
  // focusable for screen readers and keyboard users.
  const skipDisabled =
    pausedElementType !== null &&
    pausedElementType !== undefined &&
    DIVERGING_ELEMENT_TYPES.has(pausedElementType)

  const handleSkipClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (skipDisabled) {
      event.preventDefault()
      return
    }
    onSkipBlock?.()
  }

  return (
    <>
      <Button
        data-testid="action-step-over-button"
        variant="outline"
        size="sm"
        onClick={() => onStepOver?.()}
        className="h-8 gap-1.5"
      >
        <StepForward className="h-4 w-4" />
        <span className="text-sm">Step Over</span>
      </Button>
      <Button
        data-testid="action-step-into-button"
        variant="outline"
        size="sm"
        onClick={() => onStepInto?.()}
        className="h-8 gap-1.5"
      >
        <ArrowDownToLine className="h-4 w-4" />
        <span className="text-sm">Step Into</span>
      </Button>
      <ConditionalTooltip content="Re-run the currently paused block without advancing" wide>
        <Button
          data-testid="action-repeat-step-button"
          variant="outline"
          size="sm"
          onClick={() => onRepeatStep?.()}
          className="h-8 gap-1.5"
        >
          <RefreshCcw className="h-4 w-4" />
          <span className="text-sm">Repeat Step</span>
        </Button>
      </ConditionalTooltip>
      <Button
        data-testid="action-continue-button"
        variant="outline"
        size="sm"
        onClick={onContinue}
        className="h-8 gap-1.5"
      >
        <Play className="h-4 w-4" />
        <span className="text-sm">Continue</span>
      </Button>
      <ConditionalTooltip content={skipDisabled ? SKIP_BLOCK_DISABLED_TOOLTIP : undefined} disabled wide>
        <Button
          data-testid="action-skip-block-button"
          variant="outline"
          size="sm"
          onClick={handleSkipClick}
          aria-disabled={skipDisabled || undefined}
          className={
            skipDisabled
              ? 'h-8 gap-1.5 cursor-not-allowed opacity-50 hover:bg-transparent'
              : 'h-8 gap-1.5'
          }
        >
          <SkipForward className="h-4 w-4" />
          <span className="text-sm">Skip Block</span>
        </Button>
      </ConditionalTooltip>
      <StopSplitButton onStop={onStop} />
      <FocusCurrentButton onFocusCurrent={onFocusCurrent} />
    </>
  )
}

export function ExecutionControls({
  editingLocked = false,
  selectedEnvironment,
  onActionWithoutEnv,
  onRun,
  onDebug,
  onStop,
  onContinue,
  onSkipBlock,
  onStepOver,
  onStepInto,
  onRepeatStep,
  pausedElementType,
  onFocusCurrent,
  showIdleControls,
  isRunning,
  isPaused,
}: Readonly<ExecutionControlsProps>): ReactNode {
  return (
    <>
      {showIdleControls && (
        <IdleControls
          editingLocked={editingLocked}
          selectedEnvironment={selectedEnvironment}
          onActionWithoutEnv={onActionWithoutEnv}
          onRun={onRun}
          onDebug={onDebug}
        />
      )}

      {isRunning && (
        <RunningControls
          onStop={onStop}
          onFocusCurrent={onFocusCurrent}
        />
      )}

      {isPaused && (
        <PausedControls
          onStepOver={onStepOver}
          onStepInto={onStepInto}
          onRepeatStep={onRepeatStep}
          onContinue={onContinue}
          onSkipBlock={onSkipBlock}
          pausedElementType={pausedElementType}
          onStop={onStop}
          onFocusCurrent={onFocusCurrent}
        />
      )}
    </>
  )
}
