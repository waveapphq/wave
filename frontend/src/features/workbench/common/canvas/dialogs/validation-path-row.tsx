/**
 * ValidationPathRow - one path-aware validation error row.
 *
 * Renders the enclosing-Function trail as clickable monospace segments, the
 * failing leaf as a clickable bold target, and the message after ` - `. A
 * segment whose Function is a Published (shared) reference renders the library
 * name in italics (CANVAS-217). Clicking a segment fires
 * `onSegmentNavigate(depthIndex)`; clicking the leaf fires `onLeafFocus()`.
 */

import { cn } from '@/lib/utils'

export interface PathSegment {
  label: string
  isShared?: boolean
  /** Canvas node id of the enclosing Function; used by drill navigation
   *  (the row itself navigates by depth index, not id). */
  nodeId?: string
}

export interface ValidationPathRowProps {
  path: PathSegment[]
  leafLabel: string
  message: string
  onSegmentNavigate: (depthIndex: number) => void
  onLeafFocus: () => void
  /** Render the leaf as a Published reference (library name, italic + muted)
   *  rather than a bold canvas-instance leaf (CANVAS-217/218). */
  leafIsShared?: boolean
}

const INTERACTIVE =
  'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary'
const SEGMENT_CLASS = cn('font-mono text-sm text-primary', INTERACTIVE)
const SHARED_REF_CLASS = 'italic text-muted-foreground'
const LEAF_BASE_CLASS = cn('font-mono text-sm', INTERACTIVE)
const LEAF_LOCAL_CLASS = 'font-semibold text-foreground'
const SEPARATOR_CLASS = 'font-mono text-sm text-muted-foreground select-none mx-1'

export function ValidationPathRow({
  path,
  leafLabel,
  message,
  onSegmentNavigate,
  onLeafFocus,
  leafIsShared = false,
}: Readonly<ValidationPathRowProps>) {
  return (
    <div className="flex flex-wrap items-baseline gap-y-0.5">
      {path.map((segment, index) => (
        <span key={`${index}-${segment.label}`} className="inline-flex items-baseline">
          <button
            type="button"
            className={cn(SEGMENT_CLASS, segment.isShared && SHARED_REF_CLASS)}
            onClick={() => onSegmentNavigate(index)}
          >
            {segment.label}
          </button>
          <span aria-hidden="true" className={SEPARATOR_CLASS}>
            /
          </span>
        </span>
      ))}
      <button
        type="button"
        className={cn(LEAF_BASE_CLASS, leafIsShared ? SHARED_REF_CLASS : LEAF_LOCAL_CLASS)}
        onClick={onLeafFocus}
      >
        {leafLabel}
      </button>
      <span aria-hidden="true" className="text-sm text-muted-foreground mx-1">
        -
      </span>
      <span className="text-sm text-secondary">{message}</span>
    </div>
  )
}
