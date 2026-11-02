/**
 * Badge Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Badge component for status indicators, labels, and tags following
 * design system specifications:
 * - Display: inline-flex with center alignment
 * - Padding: 4px vertical, 10px horizontal (py-1 px-2.5)
 * - Font size: 12px (text-xs)
 * - Font weight: 600 (font-semibold)
 * - Border radius: 100px (rounded-full)
 * - Variants: default, primary, success, warning, error, info
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { XIcon } from './icon'

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Badge variant for color styling */
  variant?: BadgeVariant
  /** Icon to display on the left side */
  leftIcon?: ReactNode
  /** Icon to display on the right side */
  rightIcon?: ReactNode
  /** Show a dot indicator */
  dot?: boolean
  /** Callback when remove button is clicked - shows remove button when provided */
  onRemove?: () => void
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'badge-default',
  primary: 'badge-primary',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  info: 'badge-info',
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: 'bg-muted',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = 'default',
      leftIcon,
      rightIcon,
      dot,
      onRemove,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const baseClasses = [
      'badge',
      'inline-flex',
      'items-center',
      'rounded-full',
      'font-semibold',
      'text-xs',
      'py-1',
      'px-2.5',
      variantClasses[variant],
    ]

    // Add gap when there are icons, dot, or remove button
    if (leftIcon || rightIcon || dot || onRemove) {
      baseClasses.push('gap-1')
    }

    if (className) {
      baseClasses.push(className)
    }

    // Extract text content for accessible label on remove button
    const getTextContent = (node: ReactNode): string => {
      if (typeof node === 'string') return node
      if (typeof node === 'number') return String(node)
      if (Array.isArray(node)) return node.map(getTextContent).join('')
      return ''
    }

    const badgeText = getTextContent(children)

    return (
      <span ref={ref} className={baseClasses.join(' ')} {...props}>
        {dot && (
          <span
            data-badge-dot
            className={`w-1.5 h-1.5 rounded-full ${dotColorClasses[variant]}`}
          />
        )}
        {leftIcon}
        {children}
        {rightIcon}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${badgeText}`}
            className="badge-remove-btn"
          >
            <XIcon size={12} />
          </button>
        )}
      </span>
    )
  }
)

Badge.displayName = 'Badge'
