import { memo, useCallback, useEffect, useState } from 'react'
import { NodeResizer, useUpdateNodeInternals } from '@xyflow/react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dataFlag } from '@/components/shared/file-row'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { WorkflowNodeProps } from './types'
import {
  NODE_DEFAULT_WIDTH,
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
import { computeNodeMinWidth, detectNodeModes, resolveNodeMinFloor, toOutputModes } from './node-width'

// Under a system-wide run-output reveal every block reveals, so the "unsecured" badge stays silent.
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

/** NodeChangePulse: the watch-mode one-shot ring, keyed by the change tick so a repeat re-fires. */
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
      className="absolute right-3 bottom-9 z-10 inline-flex items-center justify-center h-4 w-4 rounded-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors bg-transparent border-0 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  // Halt's 'warning' is an intentional skip, so it reads SKIP; every other amber reads WARN.
  if (args.elementType === 'halt' && args.executionStatus === 'warning') return 'skip'
  if (args.executionStatus === 'warning') return 'warn'
  // SKIP marks intentional skips only; a structural 'skipped' stays neutral.
  if (args.skipped || args.resultSkipped) return 'skip'
  return undefined
}

/** The R/L locus inside a Remote Execution body: R for a remotable plugin, else L. */
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

  const nodeModes = detectNodeModes(elementType, config)
  const { isSplitMode, ifElseBranches, isIfElseMode, isTryCatch, tryCatchEnableCatch, tryCatchEnableFinally, isForLoop, switchBranches, parallelBranches, isWaitRetry } = nodeModes

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
  const nodeMinWidth = computeNodeMinWidth(topHandleCount, toOutputModes(nodeModes))

  const isMuted = !!disabled || skipped || isUnreachable
  // Disabled/skipped supersedes execution visuals on the card border.
  const executionStatus = isMuted ? undefined : rawExecutionStatus

  const typeLabel = label || elementType
  const Icon = getIcon(elementType)
  const iconName = getIconName(elementType)
  const iconColorClass = getColorClass(elementType)

  // A result-skip paints the amber skip border; a structural 'skipped' keeps the neutral gray.
  const executionBorderClass = resultSkipped
    ? 'border-[#F59E0B]'
    : getExecutionBorderClass(executionStatus)
  const executionBgClass = getExecutionBgClass(executionStatus)

  const hasBreakpoint = useWorkflowStore((state) => state.breakpoints?.has(id) ?? false)
  const isPaused = useWorkflowStore((state) => state.pausedNodeId === id)
  const isMirrorActive = useWorkflowStore((state) => state.mirrorActiveNodeId === id)

  // Blocks in a Remote Execution body carry an R (host) or L (WAVE) badge from the remotable flag.
  const inRemoteBody = useWorkflowStore((state) =>
    isInRemoteBody(state.nodes, state.edges, state.drillPath, id),
  )
  const remoteLocus = resolveRemoteLocus(inRemoteBody, elementType)

  const effectiveMinWidth = resolveNodeMinFloor(nodeType)
  const resolvedWidth = clamp(width ?? NODE_DEFAULT_WIDTH, effectiveMinWidth, NODE_MAX_WIDTH)
  const wrapperWidth = Math.max(resolvedWidth, nodeMinWidth)

  // React Flow caches handle bounds; re-measure when the body height or top-handle layout changes.
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
  const descriptionId = `node-description-${id}`

  const nodeBody = (
    <div
      data-testid={`workflow-node-${id}`}
      data-nodetype={nodeType}
      data-selected={dataFlag(selected)}
      data-dragging={dataFlag(dragging)}
      data-execution-status={executionStatus}
      data-disabled={dataFlag(disabled)}
      data-skipped={dataFlag(skipped)}
      data-paused={dataFlag(isPaused)}
      data-mirror-active={dataFlag(isMirrorActive)}
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
          aria-describedby={description ? descriptionId : undefined}
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
              id={descriptionId}
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

      {/* Egress handles sit outside the body button so they anchor to the card's bottom edge. */}
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
