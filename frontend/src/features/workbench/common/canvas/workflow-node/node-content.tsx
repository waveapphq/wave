/**
 * Inner content of a workflow node: the icon + type-label row.
 */

import { cn } from '@/lib/utils'

interface NodeIconRowProps {
  Icon: React.ComponentType<{ className?: string }>
  iconName: string
  iconColorClass: string
  typeLabel: string
  isMuted: boolean
  hasBreakpoint: boolean
}

/** Top row: icon + type label + breakpoint dot */
export function NodeIconRow({ Icon, iconName, iconColorClass, typeLabel, isMuted, hasBreakpoint }: Readonly<NodeIconRowProps>) {
  return (
    <div className="flex items-center gap-2 leading-tight">
      <div
        data-testid="workflow-node-icon"
        data-icon={iconName}
        className="flex items-center justify-center w-6 h-6 shrink-0"
      >
        <Icon className={cn('w-6 h-6', isMuted ? 'text-muted-foreground' : iconColorClass)} aria-hidden="true" />
      </div>
      <span
        className={cn(
          'text-base font-bold leading-tight truncate min-w-0 flex-1',
          isMuted ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {typeLabel}
      </span>
      {hasBreakpoint && (
        <span
          aria-hidden="true"
          className="flex items-center justify-center w-4 h-4 shrink-0"
        >
          <span
            data-testid="node-breakpoint-dot"
            className="h-3 w-3 rounded-full bg-red-500 shadow-sm ring-1 ring-background"
          />
        </span>
      )}
    </div>
  )
}
