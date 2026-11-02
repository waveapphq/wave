/**
 * Breadcrumb Component
 *
 * REQ-5.2.1.25: Breadcrumb navigation
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Breadcrumb component following design system specifications.
 *
 * Design tokens used:
 * - Container: py-2 (space-2, 8px vertical padding)
 * - Link text: text-sm (14px), font-medium (500), text-secondary
 * - Link hover: text-primary + underline
 * - Current text: font-normal (400), text-muted
 * - Separator: h-4 w-4 (icon-sm, 16px), text-muted, mx-2 (8px margins)
 * - Item gap: gap-1 (4px)
 */

import {
  forwardRef,
  useState,
  useRef,
  useEffect,
  type HTMLAttributes,
  type ReactNode,
  type KeyboardEvent,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'

// Chevron Right Icon - used as default separator
function ChevronRightIcon({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

// More Horizontal Icon - used for ellipsis
function MoreHorizontalIcon({ className = '' }: Readonly<{ className?: string }>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  )
}

// ============================================================================
// Breadcrumb (Root)
// ============================================================================

export interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode
}

export const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(
  ({ className = '', children, ...props }, ref) => {
    const classes = ['py-2', className].filter(Boolean).join(' ')

    return (
      <nav
        ref={ref}
        aria-label={props['aria-label'] ?? 'Breadcrumb'}
        className={classes}
        {...props}
      >
        {children}
      </nav>
    )
  }
)

Breadcrumb.displayName = 'Breadcrumb'

// ============================================================================
// BreadcrumbList
// ============================================================================

export interface BreadcrumbListProps extends HTMLAttributes<HTMLOListElement> {
  children?: ReactNode
}

export const BreadcrumbList = forwardRef<HTMLOListElement, BreadcrumbListProps>(
  ({ className = '', children, ...props }, ref) => {
    const classes = [
      'flex',
      'items-center',
      'flex-wrap',
      'gap-1',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <ol ref={ref} className={classes} {...props}>
        {children}
      </ol>
    )
  }
)

BreadcrumbList.displayName = 'BreadcrumbList'

// ============================================================================
// BreadcrumbItem
// ============================================================================

export interface BreadcrumbItemProps extends HTMLAttributes<HTMLLIElement> {
  children: ReactNode
}

export const BreadcrumbItem = forwardRef<HTMLLIElement, BreadcrumbItemProps>(
  ({ className = '', children, ...props }, ref) => {
    const classes = ['inline-flex', 'items-center', className]
      .filter(Boolean)
      .join(' ')

    return (
      <li ref={ref} className={classes} {...props}>
        {children}
      </li>
    )
  }
)

BreadcrumbItem.displayName = 'BreadcrumbItem'

// ============================================================================
// BreadcrumbLink
// ============================================================================

export interface BreadcrumbLinkProps extends HTMLAttributes<HTMLAnchorElement> {
  href: string
  children: ReactNode
}

export const BreadcrumbLink = forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  ({ className = '', href, children, ...props }, ref) => {
    const classes = [
      'text-sm',
      'font-medium',
      'text-secondary',
      'hover:text-primary',
      'hover:underline',
      'transition-colors',
      'motion-reduce:transition-none',
      'focus-visible:ring-2',
      'focus-visible:outline-none',
      'min-h-[44px]',
      'inline-flex',
      'items-center',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <Link ref={ref} to={href} className={classes} {...props}>
        {children}
      </Link>
    )
  }
)

BreadcrumbLink.displayName = 'BreadcrumbLink'

// ============================================================================
// BreadcrumbPage
// ============================================================================

export interface BreadcrumbPageProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
}

export const BreadcrumbPage = forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
  ({ className = '', children, ...props }, ref) => {
    const classes = ['font-normal', 'text-muted', className]
      .filter(Boolean)
      .join(' ')

    return (
      <span ref={ref} aria-current="page" className={classes} {...props}>
        {children}
      </span>
    )
  }
)

BreadcrumbPage.displayName = 'BreadcrumbPage'

// ============================================================================
// BreadcrumbSeparator
// ============================================================================

export interface BreadcrumbSeparatorProps extends HTMLAttributes<HTMLLIElement> {
  children?: ReactNode
}

export const BreadcrumbSeparator = forwardRef<HTMLLIElement, BreadcrumbSeparatorProps>(
  ({ className = '', children, ...props }, ref) => {
    const classes = ['text-muted', 'mx-2', className].filter(Boolean).join(' ')

    return (
      <li
        ref={ref}
        aria-hidden="true"
        className={classes}
        {...props}
      >
        {children ?? <ChevronRightIcon className="h-4 w-4" />}
      </li>
    )
  }
)

BreadcrumbSeparator.displayName = 'BreadcrumbSeparator'

// ============================================================================
// BreadcrumbEllipsis
// ============================================================================

export interface BreadcrumbHiddenItem {
  href: string
  label: string
}

export interface BreadcrumbEllipsisProps extends HTMLAttributes<HTMLButtonElement> {
  hiddenItems?: BreadcrumbHiddenItem[]
}

export const BreadcrumbEllipsis = forwardRef<HTMLButtonElement, BreadcrumbEllipsisProps>(
  ({ className = '', hiddenItems = [], ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const navigate = useNavigate()

    // Close dropdown when clicking outside
    useEffect(() => {
      if (!isOpen) return

      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node
        if (
          menuRef.current &&
          !menuRef.current.contains(target) &&
          buttonRef.current &&
          !buttonRef.current.contains(target)
        ) {
          setIsOpen(false)
        }
      }

      // Delay to avoid immediate close from the click that opened it
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)

      return () => {
        clearTimeout(timeoutId)
        document.removeEventListener('click', handleClickOutside)
      }
    }, [isOpen])

    // Handle keyboard navigation
    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setIsOpen(!isOpen)
      } else if (event.key === 'Escape' && isOpen) {
        event.preventDefault()
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    // Handle menu item click
    const handleItemClick = (href: string) => {
      navigate(href)
      setIsOpen(false)
    }

    // Handle menu keyboard navigation
    const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    const buttonClasses = [
      'inline-flex',
      'items-center',
      'justify-center',
      'min-h-[44px]',
      'min-w-[44px]',
      'rounded-md',
      'text-muted',
      'hover:bg-subtle',
      'focus-visible:ring-2',
      'focus-visible:outline-none',
      'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    const mergeRefs = (element: HTMLButtonElement | null) => {
      buttonRef.current = element
      if (typeof ref === 'function') {
        ref(element)
      } else if (ref) {
        ref.current = element
      }
    }

    return (
      <span className="relative">
        <button
          type="button"
          ref={mergeRefs}
          aria-label="Show more breadcrumbs"
          className={buttonClasses}
          onClick={() => setIsOpen(!isOpen)}
          onKeyDown={handleKeyDown}
          {...props}
        >
          <MoreHorizontalIcon className="h-4 w-4" />
        </button>

        {isOpen && (
          <div
            ref={menuRef}
            role="menu"
            tabIndex={-1}
            className="absolute top-full left-0 z-50 mt-1 min-w-[160px] py-1 rounded-md shadow-md border bg-card"
            onKeyDown={handleMenuKeyDown}
          >
            {hiddenItems.map((item) => (
              <button
                type="button"
                key={item.href}
                role="menuitem"
                className="flex items-center w-full px-3 py-2 text-sm cursor-pointer outline-none hover:bg-subtle focus:bg-subtle bg-transparent border-0 text-left"
                onClick={() => handleItemClick(item.href)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </span>
    )
  }
)

BreadcrumbEllipsis.displayName = 'BreadcrumbEllipsis'
