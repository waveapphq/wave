/**
 * TruncatedName - shared trigger + clipped-name tooltip for clipping cells.
 *
 * Renders the text inside a single inline-flex trigger (button when an onClick
 * is provided, span otherwise). A ResizeObserver-gated shared tooltip surfaces
 * the full text (wide variant) only when the inner span actually clips. Used by
 * every name column in the data tables and by the canvas breadcrumb leaf.
 */

import { useLayoutEffect, useState, type ReactNode } from 'react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface TruncatedNameProps {
  value: string
  testId?: string
  onClick?: () => void
  ariaExpanded?: boolean
  ariaLabel?: string
  /** Optional leading content rendered inside the trigger (e.g. an expand chevron). */
  leading?: ReactNode
  /** Optional override class applied to the outer trigger element. */
  className?: string
  /** Optional override for the inner text span styling (default font-medium). */
  textClassName?: string
  /**
   * Fires when the truncation state changes (i.e. the inner text starts or
   * stops clipping). Lets parent layouts cascade additional UI changes - the
   * detail-header uses this to collapse its breadcrumb prefix into `...`
   * the moment the title would clip.
   */
  onTruncatedChange?: (isTruncated: boolean) => void
}

export function TruncatedName({
  value,
  testId,
  onClick,
  ariaExpanded,
  ariaLabel,
  leading,
  className,
  textClassName,
  onTruncatedChange,
}: Readonly<TruncatedNameProps>) {
  // Tracked as state, not a ref: turning the hint on and off swaps the trigger
  // for a tooltip-wrapped copy, so the measured node is replaced under us and
  // an observer bound to the old one would never report again.
  const [textNode, setTextNode] = useState<HTMLSpanElement | null>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  useLayoutEffect(() => {
    /* v8 ignore next 2 - COV-V8-003: ref guard for SSR / unmount race */
    if (!textNode) return
    const measure = () => {
      setIsTruncated(textNode.scrollWidth - textNode.clientWidth > 1)
    }
    measure()
    /* v8 ignore next 6 - COV-V8-003: ResizeObserver path is exercised at runtime */
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(textNode)
      return () => observer.disconnect()
    }
  }, [textNode, value])

  useLayoutEffect(() => {
    onTruncatedChange?.(isTruncated)
  }, [isTruncated, onTruncatedChange])

  const triggerClass = cn(
    'flex items-center gap-2 font-medium min-w-0 max-w-[clamp(20rem,40vw,60rem)]',
    onClick && 'cursor-pointer text-left hover:underline',
    className,
  )
  const textClass = cn('truncate min-w-0 flex-1 text-left', textClassName ?? 'font-medium')

  const trigger = onClick ? (
    <button
      type="button"
      data-testid={testId}
      className={triggerClass}
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-label={ariaLabel}
    >
      {leading}
      <span ref={setTextNode} className={textClass}>
        {value}
      </span>
    </button>
  ) : (
    <span data-testid={testId} className={triggerClass}>
      {leading}
      <span ref={setTextNode} className={textClass}>
        {value}
      </span>
    </span>
  )

  // Below the trigger, so the popup never covers the cell row it names.
  return (
    <ConditionalTooltip content={isTruncated ? value : undefined} wide side="bottom">
      {trigger}
    </ConditionalTooltip>
  )
}
