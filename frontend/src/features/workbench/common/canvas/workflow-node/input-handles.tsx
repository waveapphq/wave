/**
 * Input (ingress) handles for workflow nodes.
 * Renders dynamic target handles at the top of the node,
 * including cycle detection indicator and proximity "+" handle.
 */

import { Handle, Position } from '@xyflow/react'
import { RefreshCcw, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InputHandlesProps {
  ingressCount: number
  showAddHandle: boolean
  proximityTarget?: boolean
  proximityCycleDetected?: boolean
}

/**
 * Renders the input (target) handles at the top of a workflow node.
 * Supports single handle, multi-handle, cycle detection indicator,
 * and proximity "+" handle for adding new ingress edges.
 */
export function InputHandles({
  ingressCount,
  showAddHandle,
  proximityTarget,
  proximityCycleDetected,
}: Readonly<InputHandlesProps>) {
  // Single centered handle (backward compatible - no id)
  if (ingressCount <= 1 && !showAddHandle) {
    if (proximityCycleDetected) {
      // Cycle detected - show red circling arrow instead of handle
      return (
        <Handle
          type="target"
          position={Position.Top}
          data-testid="handle-input-cycle"
          className="!w-5 !h-5 !rounded-full !bg-red-600 !border-2 !border-red-400 !border-solid !flex !items-center !justify-center"
        >
          <RefreshCcw className="w-3 h-3 text-white" strokeWidth={3} />
        </Handle>
      )
    }
    return (
      <Handle
        type="target"
        position={Position.Top}
        data-testid="handle-input"
        className={cn(
          '!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0',
          'hover:!ring-2 hover:!ring-zinc-400 transition-shadow',
          proximityTarget && '!ring-2 !ring-green-400 !bg-green-500 animate-pulse'
        )}
      />
    )
  }

  // Multi-handle: cycle detected - show red indicator on first handle
  if (proximityCycleDetected) {
    return (
      <>
        {Array.from({ length: Math.max(1, ingressCount) }, (_, i) => {
          const totalSlots = Math.max(1, ingressCount)
          const leftPct = ((i + 1) / (totalSlots + 1)) * 100
          const handleId = i === 0 ? undefined : `ingress_${i}`
          return i === 0 ? (
            <Handle
              key="ingress-cycle"
              type="target"
              position={Position.Top}
              id={handleId}
              data-testid="handle-input-cycle"
              style={{ left: `${leftPct}%` }}
              className="!w-5 !h-5 !rounded-full !bg-red-600 !border-2 !border-red-400 !border-solid !flex !items-center !justify-center"
            >
              <RefreshCcw className="w-3 h-3 text-white" strokeWidth={3} />
            </Handle>
          ) : (
            <Handle
              key={`ingress-${i}`}
              type="target"
              position={Position.Top}
              id={handleId}
              data-testid={`handle-input-${handleId}`}
              style={{ left: `${leftPct}%` }}
              className="!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0"
            />
          )
        })}
      </>
    )
  }

  // Multi-handle: normal rendering with optional "+" handle
  return (
    <>
      {/* Multiple input handles:
          - First handle: no id (default, for the original edge)
          - Additional handles: ingress_1, ingress_2, etc. */}
      {Array.from({ length: Math.max(1, ingressCount) }, (_, i) => {
        const totalSlots = Math.max(1, ingressCount) + (showAddHandle ? 1 : 0)
        const leftPct = ((i + 1) / (totalSlots + 1)) * 100
        // First handle stays unnamed (default) for backward compat
        const handleId = i === 0 ? undefined : `ingress_${i}`
        return (
          <Handle
            key={`ingress-${i}`}
            type="target"
            position={Position.Top}
            id={handleId}
            data-testid={handleId ? `handle-input-${handleId}` : 'handle-input'}
            style={{ left: `${leftPct}%` }}
            className="!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0 hover:!ring-2 hover:!ring-zinc-400 transition-shadow"
          />
        )
      })}
      {/* "+" handle for adding new ingress edge.
       *
       * Important: use the FUTURE stable ingress id (`ingress_${ingressCount}`),
       * NOT a transient `ingress_add` token. When the user drops on this handle
       * we add an edge whose `targetHandle` equals this id; after the add, the
       * proximity state clears and the next render replaces this "+" decoration
       * with the regular handle at the SAME index (and SAME DOM element), so
       * React Flow's `handleBounds` map already contains the id and the edge
       * binds cleanly. Using a transient id caused error#008 "couldn't create
       * edge for target handle" because the post-drop edge referenced a handle
       * that was only briefly in the DOM under a different name. */}
      {showAddHandle && (
        <Handle
          type="target"
          position={Position.Top}
          id={`ingress_${Math.max(1, ingressCount)}`}
          data-testid="handle-input-add"
          style={{ left: `${((Math.max(1, ingressCount) + 1) / (Math.max(1, ingressCount) + 2)) * 100}%` }}
          className={cn(
            '!w-5 !h-5 !rounded-full !bg-green-600 !border-2 !border-green-400 !border-solid',
            'hover:!ring-2 hover:!ring-green-300 transition-shadow',
            '!flex !items-center !justify-center'
          )}
        >
          <Plus className="w-3 h-3 text-white" strokeWidth={3} />
        </Handle>
      )}
    </>
  )
}
