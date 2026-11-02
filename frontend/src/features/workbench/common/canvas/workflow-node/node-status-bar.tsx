import { Fragment } from 'react'
import { Settings, MoreVertical, ArrowUp, ChevronRight, Loader2, Mouse } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { formatShortcut } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useCanvasReadOnly } from '../read-only-context'
import { NodeValidationAlert } from './node-validation-alert'
import { FunctionLifecycleBadge } from '@/features/functions/components/lifecycle-badge'
import { RemoteLocusBadge, type RemoteLocus } from './remote-locus-badge'
import {
  getBlockMenuGroups,
  type BlockContextMenuAction,
  type BlockMenuGroupsState,
} from './menu-groups'

export type NodeRunState =
  | 'pass'
  | 'fail'
  | 'skip'
  | 'warn'
  | 'run'
  | 'paused'
  | 'stopped'
  | 'disabled'
export type FunctionLifecycle = 'local' | 'shared'

interface NodeStatusBarProps {
  nodeId: string
  kind: 'plugin' | 'control' | 'function'
  runState?: NodeRunState
  isMuted?: boolean
  hasIssue?: boolean
  /** The block reveals its secrets in run output - amber badge when no issues. */
  revealing?: boolean
  hasNewerVersion?: boolean
  functionLifecycle?: FunctionLifecycle
  /** Execution locus for a block inside a Remote Execution body: R (host) / L (WAVE). */
  remoteLocus?: RemoteLocus
  /** Shared Function only: render the edit-mode asterisk overlay on the S badge (FN-VER-1). */
  editMode?: boolean
  /** Shared Function only: source version the draft was snapshotted from (FN-VER-2 tooltip body). */
  editModeSourceVersion?: string
  pulseValidation?: boolean
  menuState?: BlockMenuGroupsState
  onConfigure: () => void
  onMenuAction: (action: BlockContextMenuAction) => void
  onDigIn?: () => void
  showDigIn?: boolean
  slim?: boolean
}

const RUN_STATE_LABEL: Record<NodeRunState, string> = {
  pass: 'Passed',
  fail: 'Failed',
  skip: 'Skipped',
  warn: 'Warning',
  run: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  disabled: 'Disabled',
}

const NODE_BADGE_CLASS =
  'inline-flex items-center px-1.5 py-0 h-4 rounded text-[10px] font-medium border leading-none'

const RUN_STATE_BADGE_CLASS: Record<NodeRunState, string> = {
  pass: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
  skip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  warn: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  run: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
  paused: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  stopped: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30',
  disabled: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
}

const CONFIGURE_HINT = (
  <span className="flex items-center gap-1.5">
    Configure
    <Kbd aria-hidden="true">Enter</Kbd>
  </span>
)

const MORE_OPTIONS_HINT = (
  <span className="flex items-center gap-1.5">
    More options
    <Kbd aria-hidden="true">
      <Mouse aria-hidden="true" />
      right-click
    </Kbd>
  </span>
)

const OPEN_HINT = (
  <span className="flex items-center gap-1.5">
    Open
    <Kbd aria-hidden="true">{formatShortcut('Enter')}</Kbd>
  </span>
)

const RUN_STATE_TEXT: Record<NodeRunState, string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
  warn: 'WARN',
  run: 'RUNNING',
  paused: 'PAUSED',
  stopped: 'STOPPED',
  disabled: 'DISABLED',
}

function NodeBadgeRunState({ state }: Readonly<{ state: NodeRunState }>) {
  return (
    <span
      data-testid="node-run-state-badge"
      data-state={state}
      aria-label={RUN_STATE_LABEL[state]}
      className={cn(NODE_BADGE_CLASS, RUN_STATE_BADGE_CLASS[state])}
    >
      {RUN_STATE_TEXT[state]}
    </span>
  )
}

// NodeBadgeFunctionLifecycle is the shared lifecycle badge in canvas size;
// forwards `editMode` + `editModeSourceVersion` so the Shared variant can
// surface the red SVG-asterisk overlay (FN-VER-1) with the right tooltip
// body (FN-VER-2) for the current draft.
const NodeBadgeFunctionLifecycle = ({
  state,
  editMode,
  editModeSourceVersion,
}: Readonly<{
  state: FunctionLifecycle
  editMode?: boolean
  editModeSourceVersion?: string
}>) => (
  <FunctionLifecycleBadge
    lifecycle={state}
    size="sm"
    editMode={editMode}
    editModeSourceVersion={editModeSourceVersion}
  />
)

export function NodeStatusBar({
  nodeId,
  kind,
  runState,
  isMuted,
  hasIssue,
  revealing,
  hasNewerVersion,
  functionLifecycle,
  remoteLocus,
  editMode,
  editModeSourceVersion,
  pulseValidation = false,
  menuState,
  onConfigure,
  onMenuAction,
  onDigIn,
  showDigIn = false,
  slim = false,
}: Readonly<NodeStatusBarProps>) {
  const readOnly = useCanvasReadOnly()
  // Keep the kebab during execution (mutations disabled inside) so breakpoints
  // can still be toggled; hide it only for a truly read-only scope.
  const menuHidden = readOnly && !menuState?.isExecuting
  const digInPending = useWorkflowStore((s) => s.digInPendingNodeId === nodeId)
  const isFunction = kind === 'function'
  const showLifecycle = isFunction && !!functionLifecycle && !slim
  const showDigInGlyph = isFunction && showDigIn && !slim
  const showCog = !slim
  // The alert slot shows a red misconfiguration badge (issues) OR an amber
  // "unsecured" reveal badge; NodeValidationAlert resolves red-wins internally.
  const showAlert = (!!hasIssue || !!revealing) && !slim
  const showRunState = !!runState && !slim
  const showVerArrow = !!hasNewerVersion && !slim

  const menuGroups = menuState
    ? getBlockMenuGroups(menuState)
    : []

  return (
    <div
      data-testid="node-status-bar"
      data-slim={slim ? 'true' : undefined}
      data-muted={isMuted ? 'true' : undefined}
      className={cn(
        'flex items-center justify-between gap-2 px-2 h-7',
      )}
    >
      <div
        data-testid="node-status-bar-left"
        className="flex items-center gap-1 min-w-0"
      >
        {showAlert && (
          <NodeValidationAlert nodeId={nodeId} pulse={pulseValidation} revealing={revealing} />
        )}
        {showLifecycle && functionLifecycle && (
          <NodeBadgeFunctionLifecycle
            state={functionLifecycle}
            editMode={editMode}
            editModeSourceVersion={editModeSourceVersion}
          />
        )}
        {remoteLocus && <RemoteLocusBadge locus={remoteLocus} />}
        {showRunState && runState && <NodeBadgeRunState state={runState} />}
      </div>

      <div
        data-testid="node-status-bar-right"
        className="flex items-center gap-0.5"
      >
        {showVerArrow && (
          <ConditionalTooltip content="Newer version available" side="bottom">
            <span
              data-testid="version-update-indicator"
              aria-label="Newer version available"
              className="inline-flex items-center justify-center h-5 w-5"
            >
              <ArrowUp className="h-3 w-3 text-green-500" aria-hidden="true" />
            </span>
          </ConditionalTooltip>
        )}
        {showCog && (
          <ConditionalTooltip content={CONFIGURE_HINT} side="bottom">
            <button
              type="button"
              data-testid="node-configure"
              aria-label="Configure"
              className="inline-flex items-center justify-center h-5 w-5 rounded-md cursor-pointer transition-colors hover:bg-accent/50"
              onClick={(e) => { e.stopPropagation(); onConfigure() }}
            >
              <Settings className="h-3 w-3" aria-hidden="true" />
            </button>
          </ConditionalTooltip>
        )}
        {!menuHidden && (
          <DropdownMenu>
            <ConditionalTooltip content={MORE_OPTIONS_HINT} side="bottom">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="node-kebab"
                  aria-label="More options"
                  className="inline-flex items-center justify-center h-5 w-5 rounded-md cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <MoreVertical className="h-3 w-3" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
            </ConditionalTooltip>
            <DropdownMenuContent align="end" className="w-48">
              {menuGroups.map((group, gi) => {
                const groupKey = `group-${gi}`
                return (
                  <Fragment key={groupKey}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    {group.map((item) => (
                      <DropdownMenuItem
                        key={item.action}
                        onClick={() => onMenuAction(item.action)}
                        className={item.destructiveClassName}
                        data-state={item.dataState}
                        disabled={item.itemDisabled}
                      >
                        <item.icon className={item.iconClassName} />
                        {item.label}
                        {item.shortcutLabel && (
                          <span aria-hidden="true" className="ml-auto pl-4 text-xs text-muted-foreground">
                            {item.shortcutLabel}
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </Fragment>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showDigInGlyph && (
          <ConditionalTooltip content={OPEN_HINT} side="bottom">
            <button
              type="button"
              data-testid="node-dig-in"
              aria-label="Open inner canvas"
              aria-busy={digInPending || undefined}
              className="inline-flex items-center justify-center h-5 w-5 rounded-md cursor-pointer transition-colors hover:bg-accent/50"
              onClick={(e) => { e.stopPropagation(); onDigIn?.() }}
            >
              {digInPending ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
          </ConditionalTooltip>
        )}
      </div>
    </div>
  )
}
