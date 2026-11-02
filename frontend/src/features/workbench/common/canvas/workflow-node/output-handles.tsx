/**
 * Output (egress) handles for workflow nodes.
 * Renders source handles at the bottom of the node for:
 * - Default single output
 * - Assert split mode (pass/fail)
 * - If/Else branching (N handles)
 * - Switch/Case, Parallel, Try/Catch/Finally scoped lanes + egress
 * - Halt (no output)
 */

import { Handle, Position } from '@xyflow/react'
import { Check, X, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConditionalTooltip } from '@/components/ui/tooltip'

/** Lane names surface through the app's tooltip; the browser's own `title`
 *  popup cannot be timed and would double up with it. */
const LANE_TOOLTIP_DELAY_MS = 150

interface OutputHandlesProps {
  elementType: string
  proximitySource?: boolean
  isSplitMode: boolean
  isIfElseMode: boolean
  ifElseBranches: Array<{ id: string; type: string; label?: string }>
  switchBranches: Array<{ id: string; type: string; label?: string }>
  parallelBranches: Array<{ id: string; name?: string }>
  isTryCatch: boolean
  tryCatchEnableCatch: boolean
  tryCatchEnableFinally: boolean
  isForLoop: boolean
  isWaitRetry: boolean
}

/**
 * Renders the output (source) handles at the bottom of a workflow node.
 * Returns null for halt nodes (no output).
 */
export function OutputHandles({
  elementType,
  proximitySource,
  isSplitMode,
  isIfElseMode,
  ifElseBranches,
  switchBranches,
  parallelBranches,
  isTryCatch,
  tryCatchEnableCatch,
  tryCatchEnableFinally,
  isForLoop,
  isWaitRetry,
}: Readonly<OutputHandlesProps>) {
  // Halt control: no output handle (terminating dead-end node)
  if (elementType === 'halt') return null

  // Try/Catch/Finally and For Loop: scoped path handles
  const scopedHandles: Array<{ id: string; color: string; hoverRing: string; label: string }> | null = (() => {
    if (isTryCatch) {
      const h: Array<{ id: string; color: string; hoverRing: string; label: string }> = [
        { id: 'try', color: '!bg-blue-500', hoverRing: 'hover:!ring-blue-300', label: 'try' },
      ]
      if (tryCatchEnableCatch) {
        h.push({ id: 'catch', color: '!bg-red-500', hoverRing: 'hover:!ring-red-300', label: 'catch' })
      }
      if (tryCatchEnableFinally) {
        h.push({ id: 'finally', color: '!bg-amber-500', hoverRing: 'hover:!ring-amber-300', label: 'finally' })
      }
      h.push({ id: 'then', color: '!bg-zinc-600', hoverRing: 'hover:!ring-zinc-400', label: 'then' })
      return h
    }
    // Switch: one orange lane per case in author order, a muted default lane,
    // then the container-exit lane last.
    if (elementType === 'switch-case' && switchBranches.length > 0) {
      let caseNumber = 0
      const lanes = switchBranches.map((branch) => {
        if (branch.type === 'default') {
          return {
            id: branch.id,
            color: '!bg-zinc-400',
            hoverRing: 'hover:!ring-zinc-300',
            label: branch.label || 'default',
          }
        }
        caseNumber += 1
        return {
          id: branch.id,
          color: '!bg-orange-500',
          hoverRing: 'hover:!ring-orange-300',
          label: branch.label || `case ${caseNumber}`,
        }
      })
      lanes.push({ id: 'then', color: '!bg-zinc-600', hoverRing: 'hover:!ring-zinc-400', label: 'then' })
      return lanes
    }
    // Parallel: one violet lane per branch in config order - a fan-out is its
    // own role - then the container-exit lane last.
    if (elementType === 'parallel' && parallelBranches.length > 0) {
      const lanes = parallelBranches.map((branch, idx) => ({
        id: branch.id,
        color: '!bg-violet-500',
        hoverRing: 'hover:!ring-violet-300',
        label: branch.name || `branch ${idx + 1}`,
      }))
      lanes.push({ id: 'then', color: '!bg-zinc-600', hoverRing: 'hover:!ring-zinc-400', label: 'then' })
      return lanes
    }
    // Retry mode holds a sub-flow that runs each round, so its lane carries the
    // loop-body cyan; Watch mode has none and falls through to the default egress.
    if (isWaitRetry) {
      return [
        { id: 'retry', color: '!bg-cyan-500', hoverRing: 'hover:!ring-cyan-300', label: 'retry' },
        { id: 'then', color: '!bg-zinc-600', hoverRing: 'hover:!ring-zinc-400', label: 'then' },
      ]
    }
    // Remote Execution is a For-Loop-style container: cyan body sub-flow (runs on
    // the SSH session host) + zinc then continuation.
    if (isForLoop || elementType === 'remote-execution') {
      return [
        { id: 'body', color: '!bg-cyan-500', hoverRing: 'hover:!ring-cyan-300', label: 'body' },
        { id: 'then', color: '!bg-zinc-600', hoverRing: 'hover:!ring-zinc-400', label: 'then' },
      ]
    }
    return null
  })()

  if (scopedHandles) {
    return (
      <>
        {scopedHandles.map((handle, idx) => {
          const leftPx = 48 + idx * 64
          return (
            <ConditionalTooltip key={handle.id} content={handle.label} delayMs={LANE_TOOLTIP_DELAY_MS}>
              <Handle
                type="source"
                position={Position.Bottom}
                id={handle.id}
                data-testid={`handle-output-${handle.id}`}
                style={{ left: `${leftPx}px` }}
                className={cn(
                  `!w-4 !h-2 !rounded-full ${handle.color} !border-0`,
                  `${handle.hoverRing} transition-shadow`,
                  'flex items-center justify-center',
                  proximitySource && '!ring-2 !ring-green-400 animate-pulse'
                )}
                aria-label={handle.label}
              >
                <ChevronDown className="w-2 h-2 text-background" strokeWidth={3} />
              </Handle>
            </ConditionalTooltip>
          )
        })}
      </>
    )
  }

  // If/Else branching: N handles evenly spaced
  const branchHandles: Array<{ id: string; label: string }> | null = (() => {
    if (isIfElseMode) {
      const branchTypeLabels: Record<string, string> = { if: 'if', else_if: 'else if', else: 'else' }
      return ifElseBranches.map((branch) => ({
        id: branch.id,
        /* v8 ignore next - COV-BRANCH-109 */
        label: branch.label || branchTypeLabels[branch.type] || 'else',
      }))
    }
    return null
  })()

  if (branchHandles) {
    return (
      <>
        {branchHandles.map((branch, idx) => {
          const leftPx = branchHandles.length === 1 ? undefined : 48 + idx * 64
          return (
            <ConditionalTooltip key={branch.id} content={branch.label} delayMs={LANE_TOOLTIP_DELAY_MS}>
              <Handle
                type="source"
                position={Position.Bottom}
                id={branch.id}
                data-testid={`handle-output-${branch.id}`}
                style={leftPx === undefined ? undefined : { left: `${leftPx}px` }}
                className={cn(
                  '!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0',
                  'hover:!ring-2 hover:!ring-zinc-400 transition-shadow',
                  'flex items-center justify-center',
                  proximitySource && '!ring-2 !ring-green-400 !bg-green-500 animate-pulse'
                )}
                aria-label={branch.label}
              >
                <ChevronDown className="w-2 h-2 text-background" strokeWidth={3} />
              </Handle>
            </ConditionalTooltip>
          )
        })}
      </>
    )
  }

  // Assert split mode: dual pass/fail handles
  if (isSplitMode) {
    return (
      <>
        {/* Pass handle (left) */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="pass"
          data-testid="handle-output-pass"
          aria-label="pass"
          style={{ left: '30%' }}
          className={cn(
            '!w-4 !h-2 !rounded-full !bg-green-500 !border-0',
            'hover:!ring-2 hover:!ring-green-300 transition-shadow',
            'flex items-center justify-center',
            proximitySource && '!ring-2 !ring-green-400 animate-pulse'
          )}
        >
          <Check className="w-2 h-2 text-white" strokeWidth={3} />
        </Handle>
        {/* Fail handle (right) */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="fail"
          data-testid="handle-output-fail"
          aria-label="fail"
          style={{ left: '70%' }}
          className={cn(
            '!w-4 !h-2 !rounded-full !bg-red-500 !border-0',
            'hover:!ring-2 hover:!ring-red-300 transition-shadow',
            'flex items-center justify-center',
            proximitySource && '!ring-2 !ring-red-400 animate-pulse'
          )}
        >
          <X className="w-2 h-2 text-white" strokeWidth={3} />
        </Handle>
      </>
    )
  }

  // Default single output handle
  return (
    <Handle
      type="source"
      position={Position.Bottom}
      data-testid="handle-output"
      className={cn(
        '!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0',
        'hover:!ring-2 hover:!ring-zinc-400 transition-shadow',
        'flex items-center justify-center',
        proximitySource && '!ring-2 !ring-green-400 !bg-green-500 animate-pulse'
      )}
    >
      <ChevronDown data-testid="handle-chevron" className="w-2 h-2 text-background" strokeWidth={3} />
    </Handle>
  )
}
