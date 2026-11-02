/**
 * MetricCard Component
 *
 * V-DASH-01, V-DASH-02: Dashboard metric cards
 * DASH-1: Four summary cards: Tests, Suites, Regressions, Recent Executions
 *
 * Displays a metric with label, count, and subtitle.
 * Supports interactive mode, loading state, and custom styling.
 */

import { type KeyboardEvent, type HTMLAttributes, type ReactNode } from 'react'
import {
  FlaskConical,
  Folder,
  Layers,
  Play,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type MetricCardSubtitleVariant = 'muted' | 'success' | 'error' | 'warning'

export interface MetricCardProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** Card label (e.g., "Tests", "Suites") */
  label: string
  /** Numeric count value */
  count: number
  /** Subtitle content - can be string or styled ReactNode for bi-colored text (optional) */
  subtitle?: ReactNode
  /** Subtitle color variant */
  subtitleVariant?: MetricCardSubtitleVariant
  /** Icon name for the card */
  icon?: 'flask' | 'folder' | 'layers' | 'play'
  /** Click handler for interactive mode */
  onClick?: () => void
  /** Show loading skeleton state */
  loading?: boolean
  /** data-testid for testing */
  testId: string
}

const iconMap: Record<string, LucideIcon> = {
  flask: FlaskConical,
  folder: Folder,
  layers: Layers,
  play: Play,
}

const subtitleVariantClasses: Record<MetricCardSubtitleVariant, string> = {
  muted: 'text-muted',
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
}

export function MetricCard({
  label,
  count,
  subtitle,
  subtitleVariant = 'muted',
  icon,
  onClick,
  loading = false,
  testId,
  className = '',
  ...props
}: Readonly<MetricCardProps>) {
  const isInteractive = !!onClick

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick?.()
    }
  }

  const formattedCount = count.toLocaleString()

  const baseClasses = cn(
    'card',
    'flex',
    'flex-col',
    'rounded-lg',
    'border',
    'bg-card',
    'px-4',
    'py-3',
    'transition-shadow',
    'motion-reduce:transition-none',
    isInteractive && 'cursor-pointer hover:shadow-md',
    className
  )

  const interactiveProps = isInteractive
    ? {
        tabIndex: 0,
        onClick,
        onKeyDown: handleKeyDown,
        role: 'button' as const,
      }
    : {}

  const loadingProps = loading ? { 'aria-busy': 'true' as const } : {}

  const IconComponent = icon ? iconMap[icon] : null

  return (
    <article
      data-testid={testId}
      className={baseClasses}
      aria-label={`${label}: ${formattedCount}`}
      {...interactiveProps}
      {...loadingProps}
      {...props}
    >
      {loading ? (
        <>
          <span className="text-base text-secondary">{label}</span>
          <div data-skeleton className="animate-pulse bg-subtle rounded h-8 w-16 my-1" />
          <div data-skeleton className="animate-pulse bg-subtle rounded h-4 w-24" />
        </>
      ) : (
        <>
          {IconComponent && (
            <span data-metric-icon className="text-muted mb-1">
              <IconComponent size={18} strokeWidth={2} />
            </span>
          )}
          <span className="text-base text-secondary">{label}</span>
          <div className="flex items-baseline gap-3 mt-1">
            <span
              data-testid="metric-count"
              className="text-5xl font-semibold"
              aria-hidden="true"
            >
              {formattedCount}
            </span>
            {subtitle && (
              <span
                data-testid="metric-subtitle"
                className={cn('text-sm', subtitleVariantClasses[subtitleVariant])}
              >
                {subtitle}
              </span>
            )}
          </div>
        </>
      )}
    </article>
  )
}
