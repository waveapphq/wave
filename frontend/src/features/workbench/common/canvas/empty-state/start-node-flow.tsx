/** StartNodeFlow: the always visible, fixed entry node of a workflow. */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Play, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { START_NODE_WIDTH } from '../workflow-canvas/canvas-constants'

interface StartNodeFlowData {
  hasConnection?: boolean
  proximitySource?: boolean
}

interface StartNodeFlowProps {
  data: StartNodeFlowData
}

/** Start node; it pulses while it has no outgoing link. */
export const StartNodeFlow = memo(function StartNodeFlow({ data }: Readonly<StartNodeFlowProps>) {
  const shouldPulse = !data.hasConnection
  const proximitySource = !!data.proximitySource

  return (
    <div
      data-testid="start-node"
      data-variant="success"
      data-animate={shouldPulse ? 'pulse' : undefined}
      style={{ width: START_NODE_WIDTH }}
      className={cn(
        'flex items-center justify-center gap-2 py-2.5',
        'rounded-lg border-2',
        'bg-green-500/10 border-green-500',
        shouldPulse && 'animate-pulse'
      )}
    >
      <Play
        data-testid="start-node-icon"
        className="h-4 w-4 text-green-600 fill-green-600"
      />
      <span
        data-testid="start-node-label"
        className="text-sm font-medium text-foreground"
      >
        Start
      </span>

      {/* Output Handle (bottom) */}
      <Handle
        type="source"
        position={Position.Bottom}
        className={cn(
          '!w-4 !h-2 !rounded-full !bg-green-500 !border-0',
          'hover:!ring-2 hover:!ring-green-400 transition-shadow',
          'flex items-center justify-center',
          proximitySource && '!ring-2 !ring-green-400 animate-pulse'
        )}
      >
        <ChevronDown data-testid="handle-chevron" className="w-2 h-2 text-background" strokeWidth={3} />
      </Handle>
    </div>
  )
})

export type { StartNodeFlowData, StartNodeFlowProps }
