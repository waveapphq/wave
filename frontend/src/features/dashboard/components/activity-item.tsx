/**
 * ActivityItem Component
 *
 * V-DASH-01: Dashboard Recent Activity section
 *
 * Displays a single activity item with type icon, name, context, and status.
 */

import { type KeyboardEvent, type HTMLAttributes } from 'react'
import { TestTube2, FolderKanban, GitBranch, Play, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type { ActivityType, ActivityStatus } from '@/features/dashboard/api/types'
import type { ActivityType, ActivityStatus } from '@/features/dashboard/api/types'

export interface ActivityItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  /** Activity type */
  type: ActivityType
  /** Activity name */
  name: string
  /** Activity context (e.g., "Test · Auth Suite · 2 hours ago") */
  context: string
  /** Activity status for indicator */
  status?: ActivityStatus
  /** Click handler for interactive mode */
  onClick?: () => void
}

// Icon colors match navigation sidebar (SHELL-1)
const typeIconMap: Record<ActivityType, { icon: LucideIcon; name: string; color: string }> = {
  test: { icon: TestTube2, name: 'test-tube-2', color: '#4ADE80' },
  suite: { icon: FolderKanban, name: 'folder-kanban', color: '#F59E0B' },
  regression: { icon: GitBranch, name: 'git-branch', color: '#A78BFA' },
  execution: { icon: Play, name: 'play', color: '#60A5FA' },
}

const statusColorClasses: Record<ActivityStatus, string> = {
  passed: 'bg-success',
  failed: 'bg-error',
  running: 'bg-info',
  idle: 'bg-muted',
}

export function ActivityItem({
  type,
  name,
  context,
  status,
  onClick,
  className = '',
  ...props
}: Readonly<ActivityItemProps>) {
  const isInteractive = !!onClick

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick?.()
    }
  }

  const { icon: IconComponent, name: iconName, color: iconColor } = typeIconMap[type]

  const baseClasses = cn(
    'flex',
    'items-center',
    'gap-3',
    'py-2',
    'px-3',
    isInteractive && 'cursor-pointer hover:bg-subtle transition-colors motion-reduce:transition-none',
    className
  )

  const interactiveProps = isInteractive
    ? {
        tabIndex: 0,
        onClick,
        onKeyDown: handleKeyDown,
        role: 'button' as const,
      }
    : {
        role: 'listitem' as const,
      }

  return (
    <div
      data-testid="activity-item"
      className={baseClasses}
      aria-label={`${name}, ${context}`}
      {...interactiveProps}
      {...props}
    >
      {/* Icon - colors match navigation sidebar */}
      <span
        data-testid="activity-icon"
        data-icon-name={iconName}
        data-icon-color={iconColor}
        className="icon-md"
        aria-hidden="true"
        style={{ color: iconColor }}
      >
        <IconComponent size={18} strokeWidth={2} />
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            data-testid="activity-name"
            className="text-sm font-medium truncate text-card-title"
          >
            {name}
          </span>
          {status && (
            <span
              data-testid="activity-status-indicator"
              className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColorClasses[status])}
            />
          )}
        </div>
        <span
          data-testid="activity-context"
          className="text-xs text-muted truncate block"
        >
          {context}
        </span>
      </div>
    </div>
  )
}
