import { memo, useCallback, useEffect, useState } from 'react'
import { NodeResizer, useUpdateNodeInternals } from '@xyflow/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { WorkflowNodeProps } from './types'
import {
  NODE_DEFAULT_WIDTH,
  NODE_MIN_WIDTH,
  NODE_FUNCTION_MIN_WIDTH,
  NODE_MAX_WIDTH,
  NODE_DEFAULT_HEIGHT,
  NODE_MAX_HEIGHT,
} from './types'
import { getIcon, getIconName, getColorClass } from './icon-registry'
import { getExecutionBorderClass, getExecutionBgClass } from './execution-styles'
import { InputHandles } from './input-handles'
import { OutputHandles } from './output-handles'
import { NodeIconRow } from './node-content'
import { NodeDescriptionRow } from './node-description-row'
import { NodeContextMenuContent } from './context-menu-wrapper'
import { NodeStatusBar, type NodeRunState } from './node-status-bar'
import { useNodeActions } from './use-node-actions'
import { useBlockExecutionStatus, useBlockResultSkipped, type ExecutionStatus } from '@/features/workbench/stores/execution-store'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { isInRemoteBody, runsOnExecutionHost } from '@/features/workbench/lib/remote-body-membership'
import type { RemoteLocus } from './remote-locus-badge'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { type SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import { useCanvasReadOnly } from '../read-only-context'
import { useAdHocActionsOffered } from '../adhoc-actions-context'
import { resolveMenuAccess } from './menu-groups'

interface OutputModes {
  isTryCatch: boolean
  tryCatchEnableCatch: boolean
  tryCatchEnableFinally: boolean
  isIfElseMode: boolean
  ifElseBranchCount: number
  switchBranchCount: number
  parallelBranchCount: number
  isSplitMode: boolean
  isForLoop: boolean
  isRemoteExecution: boolean
  isWaitRetry: boolean
}

function computeOutputWidth(modes: OutputModes): number {
  if (modes.isTryCatch) {
    const handleCount = 2 + (modes.tryCatchEnableCatch ? 1 : 0) + (modes.tryCatchEnableFinally ? 1 : 0)
    return 48 * 2 + (handleCount - 1) * 64
  }
  // Remote Execution and a Retry-mode Wait Until mirror the For Loop's
  // two-handle (sub-flow + then) footprint.
  if (modes.isForLoop || modes.isRemoteExecution || modes.isWaitRetry) {
    return 48 * 2 + (2 - 1) * 64
  }
  if (modes.isIfElseMode) {
    return 48 * 2 + (modes.ifElseBranchCount - 1) * 64
  }
  // Branch lanes plus the trailing 'then' egress.
  if (modes.switchBranchCount > 0) {
    return 48 * 2 + modes.switchBranchCount * 64
  }
  if (modes.parallelBranchCount > 0) {
    return 48 * 2 + modes.parallelBranchCount * 64
  }
  return modes.isSplitMode ? 160 : 120
}

function configValuesOf(config?: { values?: unknown }): Record<string, unknown> | undefined {
  return config?.values as Record<string, unknown> | undefined
}

function detectNodeModes(
  elementType: string,
  config?: { values?: unknown },
) {
  const configValues = configValuesOf(config)
  const isSplitMode = elementType === 'assert' && (configValues?.mode ?? 'split') === 'split'
  const ifElseBranches = elementType === 'if-else'
    ? (configValues?.branches as Array<{id: string, type: string, label?: string}> | undefined) ?? []
    : []
  const isIfElseMode = ifElseBranches.length > 0
  const isTryCatch = elementType === 'try-catch-finally'
  const tryCatchConfig = isTryCatch ? configValues : undefined
  const tryCatchEnableCatch = isTryCatch ? (tryCatchConfig?.enable_catch ?? true) as boolean : false
  const tryCatchEnableFinally = isTryCatch ? (tryCatchConfig?.enable_finally ?? false) as boolean : false
  const isForLoop = elementType === 'for' || elementType === 'for-each' || elementType === 'while'
  const isRemoteExecution = elementType === 'remote-execution'
  const rawSwitchBranches = elementType === 'switch-case' ? configValues?.branches : undefined
  const switchBranches = (Array.isArray(rawSwitchBranches) ? rawSwitchBranches : []) as Array<{
    id: string
    type: string
    label?: string
  }>
  const rawParallelBranches = elementType === 'parallel' ? configValues?.branches : undefined
  const parallelBranches = (
    Array.isArray(rawParallelBranches) ? rawParallelBranches : []
  ) as Array<{ id: string; name?: string }>
  const isWaitRetry = elementType === 'wait-until' && (configValues?.mode ?? 'retry') === 'retry'
  return { isSplitMode, ifElseBranches, isIfElseMode, isTryCatch, tryCatchEnableCatch, tryCatchEnableFinally, isForLoop, isRemoteExecution, switchBranches, parallelBranches, isWaitRetry }
}

// Amber "unsecured" badge marks a block that reveals AGAINST the safe default.
// Under a system-wide run-output reveal every block reveals, so no block is
// anomalous - the settings banner signals it and per-block badges fall silent.
function computeIsRevealing(
  nodeType: string,
  systemRunOutput: boolean,
  config: unknown,
): boolean {
  const secretMaskingSetting =
    (config as { secret_masking?: SecretMaskingSetting } | undefined)?.secret_masking ?? 'system'
  return nodeType === 'plugin' && !systemRunOutput && secretMaskingSetting === 'reveal'
}

interface OuterClassState {
  selected: boolean | undefined
  dragging: boolean | undefined
  executionStatus: string | undefined
  executionBorderClass: string | undefined
  executionBgClass: string | undefined
  isPaused: boolean
  isDisabled: boolean
  isMirrorActive: boolean
}

function computeOuterClasses(s: OuterClassState): string {
  return cn(
    'relative cursor-pointer',
    'min-w-[120px] shadow-sm',
    'transition-shadow duration-150',
    'rounded-lg',
    s.isPaused && 'border-[3px] border-solid border-amber-500',
    s.selected && !s.isPaused &&
      'outline outline-2 outline-dashed outline-white outline-offset-[4px]',
    s.dragging && 'opacity-50 shadow-lg',
    !s.isPaused && s.isMirrorActive && 'border border-solid border-violet-500',
    !s.isPaused && !s.isMirrorActive && (s.executionStatus ? 'border-2 border-solid' : 'border-0'),
    !s.isPaused && !s.isMirrorActive && s.executionBorderClass,
    s.executionBgClass,
    s.isDisabled && 'grayscale opacity-[0.55]',
  )
}

/**
 * NodeChangePulse - the watch-mode one-shot ring on the block that just changed.
 * Keyed by the change tick so a repeated change to the same block re-fires.
 */
const NodeChangePulse = memo(function NodeChangePulse({ id }: { id: string }) {
  const pulseTick = useWorkflowStore((state) =>
    state.mirrorLastChangeNodeId === id ? state.mirrorChangeTick : null,
  )
  if (pulseTick === null) return null
  return (
    <span
      key={pulseTick}
      data-testid={`node-change-pulse-${id}`}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-lg animate-mirror-node-pulse"
    />
  )
})

function computeContentClasses(executionStatus: string | undefined): string {
  return cn(
    'relative flex flex-col gap-1 px-3 pt-2.5 pb-1.5 rounded-t-lg',
    'bg-elevated dark:bg-[#0f0f12]',
    !executionStatus && 'border border-strong',
    executionStatus && 'border-b border-strong',
  )
}

function computeStatusBarClasses(executionStatus: string | undefined): string {
  return cn(
    'rounded-b-lg',
    'bg-subtle dark:bg-[#18181b]',
    !executionStatus && 'border border-strong border-t-0',
  )
}

function computeNodeMinWidth(topHandleCount: number, modes: OutputModes): number {
  const inputWidth = topHandleCount * 80
  const outputWidth = computeOutputWidth(modes)
  return Math.max(120, inputWidth, outputWidth)
}

/** Function nodes get a wider floor for their busier action row (lifecycle badge
 *  + dig-in chevron); other node types keep the standard minimum. */
function resolveNodeMinFloor(nodeType: string): number {
  return nodeType === 'function' ? NODE_FUNCTION_MIN_WIDTH : NODE_MIN_WIDTH
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resolveStatusBarKind(nodeType: string): 'plugin' | 'control' | 'function' {
  if (nodeType === 'control') return 'control'
  if (nodeType === 'function') return 'function'
  return 'plugin'
}

interface DescriptionChevronProps {
  expanded: boolean
  onToggle: () => void
}

function DescriptionChevron({ expanded, onToggle }: Readonly<DescriptionChevronProps>) {
  const handleClick = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onToggle() }, [onToggle])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      onToggle()
    }
  }, [onToggle])
  return (
    <button
      type="button"
      aria-label={expanded ? 'Collapse description' : 'Expand description'}
      aria-expanded={expanded}
      data-testid="node-description-chevron"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="absolute right-3 bottom-9 z-10 inline-flex items-center justify-center h-4 w-4 rounded-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors bg-transparent border-0 p-0"
    >
      <ChevronDown
        className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')}
        aria-hidden="true"
      />
    </button>
  )
}

function useToggleDescriptionExpanded(id: string) {
  const setNodes = useWorkflowStore((state) => state.setNodes)
  return useCallback(() => {
    const current = useWorkflowStore.getState().nodes
    const next = current.map((n) =>
      n.id === id
        ? { ...n, data: { ...n.data, descriptionExpanded: !n.data?.descriptionExpanded } }
        : n,
    )
    setNodes(next)
  }, [id, setNodes])
}

function resolveRunState(args: {
  disabled: boolean
  isPaused: boolean
  skipped: boolean
  resultSkipped: boolean
  elementType: string
  executionStatus: ExecutionStatus | undefined
}): NodeRunState | undefined {
  if (args.disabled) return 'disabled'
  if (args.isPaused) return 'paused'
  if (args.executionStatus === 'running') return 'run'
  if (args.executionStatus === 'failed') return 'fail'
  if (args.executionStatus === 'success') return 'pass'
  if (args.executionStatus === 'stopped') return 'stopped'
  // Halt is the one amber block that reads SKIP: its 'warning' status is an
  // intentional skip, not a negative outcome. Every other amber reads WARN.
  if (args.elementType === 'halt' && args.executionStatus === 'warning') return 'skip'
  if (args.executionStatus === 'warning') return 'warn'
  // SKIP is only for intentional skips: a node pre-skipped via skippedNodeIds
  // (Skip Block) or one that ran then reported skip (function-scope skip).
  // Structural 'skipped' (drain-after-halt, not-taken branch) stays neutral.
  if (args.skipped || args.resultSkipped) return 'skip'
  return undefined
}

/** The R/L locus for a block: R (host) when it's a remotable plugin inside a
 *  Remote Execution body, L (WAVE) when it's inside one but not remotable,
 *  undefined when it's not inside a container body. */
function resolveRemoteLocus(inRemoteBody: boolean, elementType: string): RemoteLocus | undefined {
  if (!inRemoteBody) return undefined
  return runsOnExecutionHost(inRemoteBody, elementType) ? 'R' : 'L'
}

export const WorkflowNode = memo(function WorkflowNode({
  id,
  data,
  selected,
  dragging,
  width,
}: WorkflowNodeProps) {
  const {
    label,
    elementType,
    nodeType = 'plugin',
    hasNewerVersion,
    functionLifecycle,
    description,
    descriptionExpanded,
    disabled,
    isExecuting,
    proximitySource,
    proximityTarget,
    proximityCycleDetected,
    config,
  } = data
  const dataRecord = data as unknown as Record<string, unknown>
  const editMode = !!dataRecord.editMode
  const upstreamLink = dataRecord.upstreamLink as
    | { sourceVersion?: string }
    | undefined
  const editModeSourceVersion =
    upstreamLink?.sourceVersion ??
    (dataRecord.functionVersion as string | undefined)
  const missingVersion = !!dataRecord.missingVersion

  const readOnly = useCanvasReadOnly()
  const adHocOffered = useAdHocActionsOffered()
  // History and a mirrored canvas drop the menu while idle; a read-only Function body still runs.
  const { hidden: menuHidden, inspectOnly } = resolveMenuAccess(readOnly, !!isExecuting, adHocOffered)
  const rawExecutionStatus = useBlockExecutionStatus(id)
  const resultSkipped = useBlockResultSkipped(id)

  const { isSplitMode, ifElseBranches, isIfElseMode, isTryCatch, tryCatchEnableCatch, tryCatchEnableFinally, isForLoop, isRemoteExecution, switchBranches, parallelBranches, isWaitRetry } = detectNodeModes(elementType, config)

  const systemRunOutput = useMaskingSettingsStore((s) => s.runOutput)
  const isRevealing = computeIsRevealing(nodeType, systemRunOutput, config)

  const {
    selectNode,
    skipped,
    hasNodeIssue,
    shouldPulse,
    ingressCount,
    isUnreachable,
    menuGroups,
    handleClick,
    handleConfigureClick,
    handleContextMenuAction,
    hasConnections,
  } = useNodeActions({ id, disabled, isExecuting, rawExecutionStatus, inspectOnly })

  const showAddHandle = !!proximityTarget && ingressCount >= 1
  const topHandleCount = Math.max(1, ingressCount) + (showAddHandle ? 1 : 0)
  const nodeMinWidth = computeNodeMinWidth(topHandleCount, { isTryCatch, tryCatchEnableCatch, tryCatchEnableFinally, isIfElseMode, ifElseBranchCount: ifElseBranches.length, switchBranchCount: switchBranches.length, parallelBranchCount: parallelBranches.length, isSplitMode, isForLoop, isRemoteExecution, isWaitRetry })

  const isMuted = !!disabled || skipped || isUnreachable
  // Disabled/skipped supersedes execution visuals on the card border.
  const executionStatus = isMuted ? undefined : rawExecutionStatus

  const typeLabel = label || elementType
  const Icon = getIcon(elementType)
  const iconName = getIconName(elementType)
  const iconColorClass = getColorClass(elementType)

  // A result-skip (ran then skipped) paints the amber skip border; a structural
  // 'skipped' keeps the neutral gray from the status map.
  const executionBorderClass = resultSkipped
    ? 'border-[#F59E0B]'
    : getExecutionBorderClass(executionStatus)
  const executionBgClass = getExecutionBgClass(executionStatus)

  const hasBreakpoint = useWorkflowStore((state) => state.breakpoints?.has(id) ?? false)
  const isPaused = useWorkflowStore((state) => state.pausedNodeId === id)
  const isMirrorActive = useWorkflowStore((state) => state.mirrorActiveNodeId === id)

  // Blocks inside a Remote Execution body carry an R (runs on the host) / L (runs
  // on WAVE) locus badge, set automatically from the plugin's remotable flag.
  const inRemoteBody = useWorkflowStore((state) =>
    isInRemoteBody(state.nodes, state.edges, state.drillPath, id),
  )
  const remoteLocus = resolveRemoteLocus(inRemoteBody, elementType)

  const effectiveMinWidth = resolveNodeMinFloor(nodeType)
  const resolvedWidth = clamp(width ?? NODE_DEFAULT_WIDTH, effectiveMinWidth, NODE_MAX_WIDTH)
  const wrapperWidth = Math.max(resolvedWidth, nodeMinWidth)

  // React Flow caches handle bounds; force a re-measure when:
  // - body height changes (description toggle, status bar mount, wrapper resize)
  //   so output edges stay anchored to the bottom of the card; or
  // - the input-handle layout changes (proximity-driven `+` handle appears /
  //   disappears, ingress count goes up/down, cycle indicator swaps in). Each
  //   of these adds/removes/shifts a top handle. Without a re-measure React
  //   Flow keeps its stale handleBounds map, which causes three bugs in the
  //   proximity-drop path: (1) drops on the new `+` handle don't fire
  //   onConnect because RF can't hit-test it, (2) the existing ingress edge
  //   stays anchored to the old centered handle while the visual position
  //   has shifted, and (3) the new-connection proximity resolver only sees
  //   the original handle and spuriously flags its edge as a replacement
  //   target.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [
    id,
    description,
    descriptionExpanded,
    wrapperWidth,
    proximityTarget,
    proximityCycleDetected,
    ingressCount,
    showAddHandle,
    updateNodeInternals,
  ])

  const runState = resolveRunState({
    disabled: !!disabled,
    isPaused,
    skipped,
    resultSkipped,
    elementType,
    executionStatus,
  })

  const handleToggleDescriptionExpanded = useToggleDescriptionExpanded(id)
  const [descriptionOverflows, setDescriptionOverflows] = useState(false)

  const nodeBody = (
    <div
      data-testid={`workflow-node-${id}`}
      data-nodetype={nodeType}
      data-selected={selected ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      data-execution-status={executionStatus}
      data-disabled={disabled ? 'true' : undefined}
      data-skipped={skipped ? 'true' : undefined}
      data-paused={isPaused ? 'true' : undefined}
      data-mirror-active={isMirrorActive ? 'true' : undefined}
      style={{ WebkitTouchCallout: 'none', width: `${wrapperWidth}px`, minWidth: wrapperWidth }}
      className={computeOuterClasses({ selected, dragging, executionStatus, executionBorderClass, executionBgClass, isPaused, isDisabled: !!disabled, isMirrorActive })}
    >
      <NodeChangePulse id={id} />
      {selected && (
        <div data-testid="node-resize-wrapper" className="contents">
          <NodeResizer
            minWidth={effectiveMinWidth}
            maxWidth={NODE_MAX_WIDTH}
            minHeight={NODE_DEFAULT_HEIGHT}
            maxHeight={NODE_MAX_HEIGHT}
            isVisible={!!selected}
            lineClassName="!border-[2px] !border-transparent !z-20"
            handleClassName="!w-3 !h-3 !opacity-0 !z-20"
          />
        </div>
      )}
      <div className="contents">
        <button
          type="button"
          data-testid={`workflow-node-body-${id}`}
          aria-pressed={selected}
          aria-label={`${label} block`}
          onClick={handleClick}
          onContextMenu={menuHidden ? undefined : () => { if (!selected) selectNode(id) }}
          className={cn(
            'w-full text-left focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            computeContentClasses(executionStatus),
          )}
          style={{ minHeight: `${NODE_DEFAULT_HEIGHT}px` }}
        >
          <InputHandles
            ingressCount={ingressCount}
            showAddHandle={showAddHandle}
            proximityTarget={proximityTarget}
            proximityCycleDetected={proximityCycleDetected}
          />

          <NodeIconRow
            Icon={Icon}
            iconName={iconName}
            iconColorClass={iconColorClass}
            typeLabel={typeLabel}
            isMuted={isMuted}
            hasBreakpoint={hasBreakpoint}
          />

          {description && description.length > 0 && (
            <NodeDescriptionRow
              description={description}
              expanded={!!descriptionExpanded}
              onOverflowChange={setDescriptionOverflows}
            />
          )}

        </button>
      </div>

      {/* Chevron lives OUTSIDE the body <button> so both can be real <button> elements (no HTML nesting). */}
      {description && description.length > 0 && (descriptionOverflows || descriptionExpanded) && (
        <DescriptionChevron expanded={!!descriptionExpanded} onToggle={handleToggleDescriptionExpanded} />
      )}

      <div className={computeStatusBarClasses(executionStatus)}>
        <NodeStatusBar
          nodeId={id}
          kind={resolveStatusBarKind(nodeType)}
          runState={runState}
          isMuted={isMuted}
          hasIssue={hasNodeIssue}
          revealing={isRevealing}
          hasNewerVersion={hasNewerVersion}
          functionLifecycle={functionLifecycle}
          remoteLocus={remoteLocus}
          editMode={editMode}
          editModeSourceVersion={editModeSourceVersion}
          showDigIn={nodeType === 'function'}
          pulseValidation={shouldPulse}
          menuState={{
            hasBreakpoint,
            disabled: !!disabled,
            skipped,
            hasConnections,
            isExecuting,
            isNodeRunning: rawExecutionStatus === 'running',
            elementType,
            functionLifecycle,
            editMode,
            missingVersion,
          }}
          onConfigure={handleConfigureClick}
          onMenuAction={handleContextMenuAction}
          onDigIn={() => handleContextMenuAction('open')}
        />
      </div>

      {/* Egress handles live OUTSIDE the body button so they anchor to the bottom of the entire card
          (= bottom edge of the action bar), not to the seam between body and action bar. */}
      <OutputHandles
        elementType={elementType}
        proximitySource={proximitySource}
        isSplitMode={isSplitMode}
        isIfElseMode={isIfElseMode}
        ifElseBranches={ifElseBranches}
        switchBranches={switchBranches}
        parallelBranches={parallelBranches}
        isTryCatch={isTryCatch}
        tryCatchEnableCatch={tryCatchEnableCatch}
        tryCatchEnableFinally={tryCatchEnableFinally}
        isForLoop={isForLoop}
        isWaitRetry={isWaitRetry}
      />

    </div>
  )

  if (menuHidden) return nodeBody

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {nodeBody}
      </ContextMenuTrigger>
      <NodeContextMenuContent menuGroups={menuGroups} onAction={handleContextMenuAction} />
    </ContextMenu>
  )
})

export type { WorkflowNodeData, WorkflowNodeProps } from './types'
export type { ExecutionStatus } from '@/features/workbench/stores/execution-store'
