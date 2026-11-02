/**
 * Skeleton Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.20: Loading skeletons and spinners
 *
 * Skeleton component following design system specifications.
 *
 * Specifications:
 * - Base background: --color-bg-muted
 * - Shimmer highlight: --color-bg-subtle
 * - Border radius: text=4px (rounded), card=8px (rounded-lg), circular=full
 * - Shimmer animation: 1500ms duration, ease-in-out timing, infinite
 * - Shimmer highlight band: ~40% of skeleton width
 * - Variants: Text (14-16px height), Circular, Rectangular, Custom
 * - Reduced motion: static placeholder without shimmer animation
 * - Loading state transitions: 150ms crossfade when content loads
 * - Error state: stops shimmer, applies error colors from semantic palette
 */

import { forwardRef, type HTMLAttributes, type CSSProperties } from 'react'

export type SkeletonVariant = 'default' | 'card' | 'circular'
export type SkeletonRadius = 'none' | 'sm' | 'md' | 'lg' | 'full'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
  variant?: SkeletonVariant
  radius?: SkeletonRadius
  isError?: boolean
}

const radiusClasses: Record<SkeletonRadius, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

const variantRadiusClasses: Record<SkeletonVariant, string> = {
  default: 'rounded',
  card: 'rounded-lg',
  circular: 'rounded-full',
}

function formatDimension(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ width, height, variant = 'default', radius, isError = false, className = '', style, ...props }, ref) => {
    // Determine radius class - explicit radius prop takes precedence
    const radiusClass = radius ? radiusClasses[radius] : variantRadiusClasses[variant]

    // Compute inline styles for dimensions
    const computedStyle: CSSProperties = { ...style }
    const formattedWidth = formatDimension(width)
    const formattedHeight = formatDimension(height)
    if (formattedWidth) computedStyle.width = formattedWidth
    if (formattedHeight) computedStyle.height = formattedHeight

    // Build class list
    const baseClasses = [
      'skeleton',
      'relative',
      'overflow-hidden',
      radiusClass,
      // Transition classes for smooth content swap
      'transition-opacity',
      'transition-colors',
      'duration-150',
    ]

    if (isError) {
      // Error state - no animation, error colors
      baseClasses.push('skeleton-error', 'bg-error-bg', 'border', 'border-error-border')
    } else {
      // Normal state - with shimmer animation
      baseClasses.push('bg-muted', 'animate-shimmer', 'duration-1500', 'ease-in-out', 'motion-reduce:animate-none')
    }

    // Default dimensions if not specified
    if (!formattedWidth) baseClasses.push('w-full')
    if (!formattedHeight) baseClasses.push('h-4')

    const classes = [...baseClasses, className].filter(Boolean).join(' ')

    return (
      <div
        ref={ref}
        className={classes}
        style={Object.keys(computedStyle).length > 0 ? computedStyle : undefined}
        aria-hidden="true"
        data-error={isError ? 'true' : undefined}
        {...props}
      >
        {/* Shimmer overlay - only show when not in error state */}
        {!isError && (
          <div
            data-skeleton-shimmer=""
            className="absolute inset-0 bg-gradient-to-r from-transparent via-subtle to-transparent motion-reduce:hidden"
          />
        )}
      </div>
    )
  }
)

Skeleton.displayName = 'Skeleton'

// ============================================
// SkeletonText
// ============================================

export type SkeletonTextPreset = 'short' | 'medium' | 'long'

export interface SkeletonTextProps extends Omit<SkeletonProps, 'variant'> {
  preset?: SkeletonTextPreset
}

const presetClasses: Record<SkeletonTextPreset, string> = {
  short: 'w-2/5',
  medium: 'w-3/5',
  long: 'w-4/5',
}

export const SkeletonText = forwardRef<HTMLDivElement, SkeletonTextProps>(
  ({ preset, width, className = '', ...props }, ref) => {
    const classes = ['skeleton-text', preset && !width ? presetClasses[preset] : '', className].filter(Boolean).join(' ')

    return <Skeleton ref={ref} className={classes} width={width} variant="default" {...props} />
  }
)

SkeletonText.displayName = 'SkeletonText'

// ============================================
// SkeletonCircle
// ============================================

export type SkeletonCircleSize = 'sm' | 'md' | 'lg' | 'xl'

export interface SkeletonCircleProps extends Omit<SkeletonProps, 'variant' | 'width' | 'height' | 'radius'> {
  size?: SkeletonCircleSize
  diameter?: number
}

const circleSizeClasses: Record<SkeletonCircleSize, string> = {
  sm: 'w-8 h-8', // 32px
  md: 'w-10 h-10', // 40px
  lg: 'w-12 h-12', // 48px
  xl: 'w-16 h-16', // 64px
}

export const SkeletonCircle = forwardRef<HTMLDivElement, SkeletonCircleProps>(
  ({ size = 'md', diameter, className = '', style, ...props }, ref) => {
    const computedStyle: CSSProperties = { ...style }
    let sizeClass = ''

    if (diameter === undefined) {
      sizeClass = circleSizeClasses[size]
    } else {
      // Custom diameter overrides size preset
      computedStyle.width = `${diameter}px`
      computedStyle.height = `${diameter}px`
    }

    const classes = ['skeleton-circle', sizeClass, className].filter(Boolean).join(' ')

    // Pass empty width/height to prevent Skeleton from adding default classes
    return (
      <Skeleton
        ref={ref}
        className={classes}
        style={Object.keys(computedStyle).length > 0 ? computedStyle : undefined}
        variant="circular"
        width={diameter}
        height={diameter}
        {...props}
      />
    )
  }
)

SkeletonCircle.displayName = 'SkeletonCircle'

// ============================================
// SkeletonCard
// ============================================

export type SkeletonCardAspectRatio = 'video' | 'square'

export interface SkeletonCardProps extends Omit<SkeletonProps, 'variant'> {
  aspectRatio?: SkeletonCardAspectRatio
}

const aspectRatioClasses: Record<SkeletonCardAspectRatio, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
}

export const SkeletonCard = forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ aspectRatio, width, height, className = '', ...props }, ref) => {
    const classes = [
      'skeleton-card',
      aspectRatio ? aspectRatioClasses[aspectRatio] : '',
      // Only add default height if no aspect ratio and no explicit height
      !aspectRatio && !height ? 'h-32' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return <Skeleton ref={ref} className={classes} width={width} height={height} variant="card" {...props} />
  }
)

SkeletonCard.displayName = 'SkeletonCard'

// ============================================
// SkeletonParagraph
// ============================================

export interface SkeletonParagraphProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number
  isError?: boolean
}

export const SkeletonParagraph = forwardRef<HTMLDivElement, SkeletonParagraphProps>(
  ({ lines = 3, isError = false, className = '', ...props }, ref) => {
    const classes = ['skeleton-paragraph', 'space-y-2', className].filter(Boolean).join(' ')

    return (
      <div ref={ref} className={classes} aria-hidden="true" {...props}>
        {Array.from({ length: lines }).map((_, index) => {
          const isLastLine = index === lines - 1
          const lineKey = `line-${index}`
          // Last line is shorter to simulate natural text
          // Use width prop to prevent base Skeleton from adding w-full
          return <SkeletonText key={lineKey} width={isLastLine ? '60%' : undefined} isError={isError} />
        })}
      </div>
    )
  }
)

SkeletonParagraph.displayName = 'SkeletonParagraph'

// ============================================
// SkeletonListItem
// ============================================

export interface SkeletonListItemProps extends HTMLAttributes<HTMLDivElement> {
  isError?: boolean
}

export const SkeletonListItem = forwardRef<HTMLDivElement, SkeletonListItemProps>(
  ({ isError = false, className = '', ...props }, ref) => {
    const classes = ['flex', 'items-center', 'gap-3', className].filter(Boolean).join(' ')

    return (
      <div ref={ref} className={classes} aria-hidden="true" {...props}>
        <SkeletonCircle size="md" isError={isError} />
        <div className="flex-1 space-y-2">
          <SkeletonText preset="long" isError={isError} />
          <SkeletonText preset="medium" isError={isError} />
        </div>
      </div>
    )
  }
)

SkeletonListItem.displayName = 'SkeletonListItem'

// ============================================
// SkeletonTableRow
// ============================================

export interface SkeletonTableRowProps extends HTMLAttributes<HTMLDivElement> {
  columns?: number
  isError?: boolean
}

export const SkeletonTableRow = forwardRef<HTMLDivElement, SkeletonTableRowProps>(
  ({ columns = 4, isError = false, className = '', ...props }, ref) => {
    const classes = ['grid', 'gap-4', className].filter(Boolean).join(' ')
    const gridStyle = { gridTemplateColumns: `repeat(${columns}, 1fr)` }

    return (
      <div ref={ref} className={classes} style={gridStyle} aria-hidden="true" {...props}>
        {Array.from({ length: columns }).map((_, index) => {
          const colKey = `col-${index}`
          return <SkeletonText key={colKey} isError={isError} />
        })}
      </div>
    )
  }
)

SkeletonTableRow.displayName = 'SkeletonTableRow'
