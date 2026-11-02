import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface NodeDescriptionRowProps {
  description: string
  expanded: boolean
  /** Notified whenever the visible-text overflow state changes so the parent can render the (out-of-button) chevron. */
  onOverflowChange?: (overflows: boolean) => void
}

/**
 * Description row with 2-line clamp. The chevron is rendered by the PARENT
 * (node.tsx) as a sibling of the body <button> - that way both the body and
 * the chevron can be real <button> elements without nesting.
 */
export function NodeDescriptionRow({ description, expanded, onOverflowChange }: Readonly<NodeDescriptionRowProps>) {
  const textRef = useRef<HTMLDivElement | null>(null)
  const [overflows, setOverflows] = useState(false)
  const reportedRef = useRef(false)

  const recomputeOverflow = useCallback(() => {
    const el = textRef.current
    /* v8 ignore next - COV-DEF-018 */
    if (!el) return
    const next = el.scrollHeight > el.clientHeight + 1
    setOverflows(next)
    if (reportedRef.current === next) return
    reportedRef.current = next
    onOverflowChange?.(next)
  }, [onOverflowChange])

  useLayoutEffect(() => {
    recomputeOverflow()
  }, [recomputeOverflow, description, expanded])

  useEffect(() => {
    /* v8 ignore next - COV-SSR-004 */
    if (typeof ResizeObserver === 'undefined') return
    const el = textRef.current
    /* v8 ignore next - COV-DEF-018 */
    if (!el) return
    const ro = new ResizeObserver(() => recomputeOverflow())
    ro.observe(el)
    return () => ro.disconnect()
  }, [recomputeOverflow])

  // Reserve space at the right for the parent-rendered chevron so the text doesn't overlap it.
  const reserveChevronGap = overflows || expanded

  return (
    <div className="flex items-end gap-1 min-w-0 pl-8">
      <div
        ref={textRef}
        data-testid="node-description"
        data-expanded={expanded ? 'true' : undefined}
        className={cn(
          'text-xs leading-snug text-muted-foreground whitespace-pre-wrap break-words min-w-0 flex-1',
          !expanded && 'line-clamp-2',
          reserveChevronGap && 'pr-5',
        )}
      >
        {description}
      </div>
    </div>
  )
}
