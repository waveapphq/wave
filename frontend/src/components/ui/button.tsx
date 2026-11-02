/**
 * Button Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Button component following design system specifications.
 */

import {
  forwardRef,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
  type ReactElement,
} from 'react'
import { Slot } from '@radix-ui/react-slot'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'default' | 'destructive' | 'outline' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm' | 'default'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  fullWidth?: boolean
  asChild?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  default: 'btn-primary',
  destructive: 'btn-danger',
  outline: 'btn-secondary',
  link: 'btn-ghost underline-offset-4 hover:underline',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
  icon: 'h-9 w-9 p-0',
  'icon-sm': 'h-8 w-8 p-0',
  default: 'btn-md',
}

function Spinner() {
  return (
    <svg
      data-testid="button-spinner"
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      asChild = false,
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    const classes = [
      'btn',
      'inline-flex',
      'items-center',
      'justify-center',
      'gap-2',
      'font-semibold',
      'rounded-md',
      'transition-[background-color,border-color,box-shadow,opacity,transform]',
      'duration-150',
      'ease-out',
      'motion-reduce:transition-none',
      'motion-reduce:duration-0',
      'focus-visible:ring-2',
      'focus-visible:ring-offset-2',
      variantClasses[variant],
      sizeClasses[size],
      fullWidth ? 'w-full' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    // For asChild, we don't render the button wrapper, just pass props to child
    if (asChild) {
      return (
        <Slot ref={ref} className={classes} {...props}>
          {children}
        </Slot>
      )
    }

    // Apply invisible class to icons when loading
    const processedLeftIcon =
      loading && leftIcon && isValidElement(leftIcon)
        ? cloneElement(leftIcon as ReactElement<{ className?: string }>, {
            className: `${(leftIcon.props as { className?: string }).className ?? ''} invisible`.trim(),
          })
        : leftIcon
    const processedRightIcon =
      loading && rightIcon && isValidElement(rightIcon)
        ? cloneElement(rightIcon as ReactElement<{ className?: string }>, {
            className: `${(rightIcon.props as { className?: string }).className ?? ''} invisible`.trim(),
          })
        : rightIcon

    return (
      <button
        ref={ref}
        type={type}
        className={classes}
        disabled={isDisabled}
        aria-busy={loading ? 'true' : undefined}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
        <span className={`inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}>
          {processedLeftIcon}
          <span data-loading-text className={`inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}>
            {children}
          </span>
          {processedRightIcon}
        </span>
      </button>
    )
  }
)

Button.displayName = 'Button'
