/**
 * QuickActionCard Component
 *
 * V-DASH-01, V-DASH-02: Dashboard Quick Actions section
 * DASH-3: Quick Actions section with common workflows
 *
 * Displays an action card with icon, title, and description.
 */

import { type KeyboardEvent, type HTMLAttributes, useId } from 'react'
import { Plus, Play, BarChart, Compass, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type QuickActionIcon = 'plus' | 'play' | 'bar-chart' | 'compass'
export type QuickActionVariant = 'default' | 'primary'

export interface QuickActionCardProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Icon name */
  icon: QuickActionIcon
  /** Action title */
  title: string
  /** Action description */
  description: string
  /** Card variant */
  variant?: QuickActionVariant
  /** Click handler */
  onClick: () => void
  /** Whether the card is disabled */
  disabled?: boolean
  /** data-testid for testing */
  testId: string
}

const iconMap: Record<QuickActionIcon, LucideIcon> = {
  plus: Plus,
  play: Play,
  'bar-chart': BarChart,
  compass: Compass,
}

export function QuickActionCard({
  icon,
  title,
  description,
  variant = 'default',
  onClick,
  disabled = false,
  testId,
  className = '',
  ...props
}: Readonly<QuickActionCardProps>) {
  const descriptionId = useId()
  const IconComponent = iconMap[icon]

  const handleClick = () => {
    if (!disabled) {
      onClick()
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      onClick()
    }
  }

  const isPrimary = variant === 'primary'

  const baseClasses = cn(
    'card',
    'rounded-lg',
    'flex',
    'flex-col',
    'gap-2',
    'p-4',
    'items-center',
    'text-center',
    'transition-[transform,box-shadow,background-color]',
    'duration-200',
    'motion-reduce:transition-none',
    'focus:outline-none',
    'focus:ring-2',
    'focus:ring-primary',
    // Variant styling
    isPrimary ? 'bg-primary' : 'bg-card border',
    // Interactive styling
    disabled
      ? 'opacity-50 cursor-not-allowed'
      : 'cursor-pointer hover:shadow-md hover:-translate-y-0.5',
    isPrimary && !disabled && 'hover:bg-primary-dark',
    className
  )

  return (
    <button
      type="button"
      data-testid={testId}
      className={baseClasses}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      aria-label={title}
      aria-describedby={descriptionId}
      aria-disabled={disabled ? 'true' : undefined}
      {...props}
    >
      {/* Icon */}
      <span
        data-action-icon
        data-icon-name={icon}
        className={cn('icon-lg', isPrimary ? 'text-white' : 'text-muted')}
        aria-hidden="true"
      >
        <IconComponent size={20} strokeWidth={2} />
      </span>

      {/* Title */}
      <span
        className={cn(
          'text-sm font-medium',
          isPrimary ? 'text-white' : 'text-primary'
        )}
      >
        {title}
      </span>

      {/* Description */}
      <span
        id={descriptionId}
        className={cn('text-xs', isPrimary ? 'text-white/80' : 'text-muted')}
      >
        {description}
      </span>
    </button>
  )
}
