/**
 * OnboardingNodeFlow Component - React Flow Onboarding Placeholder
 *
 * Placeholder node shown when canvas is empty.
 * Connected to Start node with a dashed edge.
 */

import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type OnboardingNodeFlowProps = Record<string, never>

export const OnboardingNodeFlow = memo(function OnboardingNodeFlow() {
  // When drilled into an empty local Function, the inner canvas reuses this
  // placeholder. Adapt the copy so the user knows they're populating the
  // Function's body, not the parent Test.
  const insideFunction = useWorkflowStore((s) => s.drillPath.length > 0)
  return (
    <div
      data-testid="onboarding-placeholder"
      data-border="dashed"
      className={cn(
        'flex flex-col items-center gap-3 p-4',
        'rounded-lg border-2 border-dashed',
        'border-muted-foreground/30 bg-muted/20',
        // Fixed width: keeps the node's horizontal center deterministic
        // so the React Flow edge from Start (also centered at x=0) runs
        // as a straight vertical line. `min-w-*` would let content
        // re-flow the width and shift the center off x=0, which makes
        // the smoothstep edge introduce a step-bend with visible gaps
        // near the bend radii.
        'w-[220px]'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-muted-foreground/50 border-2 border-card opacity-0"
      />

      <p
        data-testid="onboarding-hint"
        className="text-sm text-muted-foreground text-center"
      >
        {insideFunction ? (
          <>
            Drag a plugin to define
            <br />
            what this Function does.
          </>
        ) : (
          <>
            Drag a plugin from the
            <br />
            palette to add your first step
          </>
        )}
      </p>
    </div>
  )
})

export type { OnboardingNodeFlowProps }
