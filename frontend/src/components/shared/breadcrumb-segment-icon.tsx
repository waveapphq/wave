/**
 * BreadcrumbSegmentIcon - presentational segment-type to lucide icon lookup.
 *
 * Each breadcrumb segment carries an entity-type leading icon that matches
 * the sidebar conventions (see app-sidebar.tsx):
 *   - Executions root / Execution segment: Play, #60A5FA
 *   - Regression:                          GitBranch, #A78BFA
 *   - Suite:                               FolderKanban, #F59E0B
 *   - Test:                                TestTube2, #4ADE80
 *   - Function (drill segment):            FunctionSquare, #A78BFA-violet
 */

import type { ReactNode } from 'react'
import { Play, GitBranch, FolderKanban, TestTube2, FunctionSquare, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BreadcrumbSegmentType = 'execution-root' | 'execution' | 'test' | 'suite' | 'regression' | 'function'

interface IconSpec {
  Icon: LucideIcon
  color: string
}

const ICON_LOOKUP: Record<BreadcrumbSegmentType, IconSpec> = {
  'execution-root': { Icon: Play, color: '#60A5FA' },
  execution: { Icon: Play, color: '#60A5FA' },
  regression: { Icon: GitBranch, color: '#A78BFA' },
  suite: { Icon: FolderKanban, color: '#F59E0B' },
  test: { Icon: TestTube2, color: '#4ADE80' },
  function: { Icon: FunctionSquare, color: '#A78BFA' },
}

export interface BreadcrumbSegmentIconProps {
  type: BreadcrumbSegmentType
  className?: string
  /** Size class applied to the inner SVG. Defaults to `h-3.5 w-3.5` for breadcrumb use; override for larger headers. */
  iconClassName?: string
  /** Optional color override (e.g. a status tint on a test leaf: green pass / red fail). Replaces the entity-type default color. */
  statusColor?: string
  /** Render the icon inside a rounded square tinted with the entity/status color. */
  tile?: boolean
  /** Size/shape class for the tile (defaults to `h-8 w-8`). */
  tileClassName?: string
  'data-testid'?: string
}

export function BreadcrumbSegmentIcon({
  type,
  className,
  iconClassName = 'h-3.5 w-3.5',
  statusColor,
  tile = false,
  tileClassName,
  ...rest
}: Readonly<BreadcrumbSegmentIconProps>): ReactNode {
  const { Icon, color: defaultColor } = ICON_LOOKUP[type]
  const color = statusColor ?? defaultColor
  if (tile) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md',
          tileClassName ?? 'h-8 w-8',
          className,
        )}
        style={{ color, backgroundColor: `${color}1f` }}
        aria-hidden="true"
        {...rest}
      >
        <Icon className={iconClassName} />
      </span>
    )
  }
  return (
    <span
      className={cn(`inline-flex shrink-0 text-[${color}]`, className)}
      style={{ color }}
      aria-hidden="true"
      {...rest}
    >
      <Icon className={iconClassName} />
    </span>
  )
}
