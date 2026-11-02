/**
 * ExecutionCard Component
 *
 * V-DASH-01: Dashboard Running Executions section
 * Per wireframe: Simple list item with status dot, name, status info, and progress bar.
 * NOT a bordered card - items are rows within the section card.
 */

import { type KeyboardEvent, type HTMLAttributes, useId } from 'react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

export type { ExecutionStatus } from '@/features/dashboard/api/types'
import type { ExecutionStatus } from '@/features/dashboard/api/types'

export interface ExecutionCardProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** Execution ID */
  id: string
  /** Execution name (format: "Type > Name > Environment") */
  name: string
  /** Execution status */
  status: ExecutionStatus
  /** Status info line (e.g., "Running · 67% · 5m · 50/150 tests done") */
  statusInfo: string
  /** Progress percentage (0-100) */
  progress: number
  /** Click handler */
  onClick?: (id: string) => void
}

const statusDotClasses: Record<ExecutionStatus, string> = {
  running: 'bg-info',
  passed: 'bg-success',
  failed: 'bg-error',
  stopped: 'bg-muted',
  paused: 'bg-warning',
  skipped: 'bg-muted',
}

const statusTextClasses: Record<ExecutionStatus, string> = {
  running: 'text-info',
  passed: 'text-success',
  failed: 'text-error',
  stopped: 'text-muted',
  paused: 'text-warning',
  skipped: 'text-muted',
}

export function ExecutionCard({
  id,
  name,
  status,
  statusInfo,
  progress,
  onClick,
  className = '',
  ...props
}: Readonly<ExecutionCardProps>) {
  const statusDescId = useId()
  const isInteractive = !!onClick
  const showProgress = status === 'running' || status === 'paused'

  const handleClick = () => {
    onClick?.(id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      handleClick()
    }
  }

  const baseClasses = cn(
    'py-3',
    'flex',
    'flex-col',
    'gap-1',
    'transition-colors',
    'motion-reduce:transition-none',
    isInteractive && 'cursor-pointer hover:bg-subtle rounded-md px-2 -mx-2',
    className
  )

  const interactiveProps = isInteractive
    ? {
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        role: 'button' as const,
      }
    : {}

  return (
    <article
      data-testid="execution-card"
      className={baseClasses}
      aria-label={`Execution: ${name}`}
      aria-describedby={statusDescId}
      {...interactiveProps}
      {...props}
    >
      {/* Header with status dot and name */}
      <div className="flex items-center gap-2">
        <span
          data-testid="execution-status-indicator"
          className={cn(
            'w-2 h-2 rounded-full flex-shrink-0',
            statusDotClasses[status],
            status === 'running' && 'animate-pulse'
          )}
        />
        <span
          data-testid="execution-name"
          className="text-sm font-medium truncate text-card-title"
        >
          {name}
        </span>
      </div>

      {/* Status info line - colored based on status */}
      <span
        id={statusDescId}
        data-testid="execution-status-info"
        className={cn('text-xs pl-4', statusTextClasses[status])}
      >
        {statusInfo}
      </span>

      {/* Progress bar - only for running/paused, inline with padding */}
      {showProgress && (
        <div className="pl-4 pt-1">
          <Progress
            data-testid="execution-progress"
            value={progress}
            className="h-1"
            aria-label="Execution progress"
          />
        </div>
      )}
    </article>
  )
}
