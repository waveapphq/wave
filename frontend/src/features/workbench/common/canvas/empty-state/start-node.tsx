/**
 * StartNode Component
 *
 * Entry point node displayed in the empty canvas state.
 * Shows a pulsing animation to prompt user action.
 *
 * Visual Specs:
 * - Shape: Rounded rectangle with play icon
 * - Background: Success muted color
 * - Border: 2px solid success color
 * - Label: "Start" text
 * - Animation: Subtle pulse when no connections exist
 * - Not draggable - remains anchored at designated position
 */

import { Play } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StartNodeProps {
  /** Whether the node has an outgoing connection */
  hasConnection?: boolean
  /** Additional class names */
  className?: string
}

export function StartNode({ hasConnection = false, className }: Readonly<StartNodeProps>) {
  const shouldPulse = !hasConnection

  return (
    <div
      data-testid="start-node"
      data-variant="success"
      data-animate={shouldPulse ? 'pulse' : undefined}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5',
        'rounded-lg border-2',
        'bg-green-500/10 border-green-500',
        shouldPulse && 'animate-pulse',
        className
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
    </div>
  )
}
