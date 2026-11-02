/**
 * LibraryCard - one Function entry inside the Functions Library modal.
 *
 * Layout:
 *   - Row 1: f-icon + name (bold, truncates with tooltip on hover for the
 *     full name)
 *   - Row 2: 1-line description (truncated)
 *   - Row 3: tag chips clipped to fit + `(+N)` overflow chip (tooltip lists
 *     all tags) + version pill anchored bottom-right
 *
 * The card is the drag-source onto the canvas via the standard HTML5 DnD
 * pipeline.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FunctionSquare } from 'lucide-react'
import type { DragEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import type { FunctionSummary } from '@/features/functions/api/types'

interface LibraryCardProps {
  function: FunctionSummary
  onDragStart?: (fn: FunctionSummary, event: DragEvent<HTMLDivElement>) => void
}

const MAX_VISIBLE_TAGS = 3

function NameWithTooltip({ name }: Readonly<{ name: string }>) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = useState(false)

  // Measure on layout + on any size change. The card itself uses the
  // shared modal's resizable container, so the available name width can
  // shift independently of the name string.
  useLayoutEffect(() => {
    const el = spanRef.current
    if (!el) return
    const check = () => setIsTruncated(el.scrollWidth > el.clientWidth)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [name])

  // Re-measure on font-load or window resize: a font swap changes the text
  // width without resizing the span's box, so ResizeObserver alone misses it.
  useEffect(() => {
    const handler = () => {
      const el = spanRef.current
      if (!el) return
      setIsTruncated(el.scrollWidth > el.clientWidth)
    }
    window.addEventListener('resize', handler)
    // jsdom has no FontFaceSet, hence the runtime guard. However font loading
    // ends, the name is measured again.
    document.fonts?.ready.then(handler, handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  return (
    <ConditionalTooltip content={isTruncated ? name : undefined} side="top">
      <span
        ref={spanRef}
        data-testid="library-card-name"
        aria-label={name}
        className={cn(
          'text-sm font-semibold truncate min-w-0',
          isTruncated ? 'cursor-help' : '',
        )}
      >
        {name}
      </span>
    </ConditionalTooltip>
  )
}


function TagOverflowChip({ allTags, overflowCount }: Readonly<{ allTags: string[]; overflowCount: number }>) {
  // A11y: the chip's aria-label lists every tag, not just the
  // hidden ones, so screen readers can announce the full set without
  // hopping between the visible chips and the overflow indicator.
  const tagList = allTags.join(', ')
  return (
    <ConditionalTooltip content={tagList} side="top" wide>
      <button
        type="button"
        data-testid="library-card-tag-overflow"
        aria-label={tagList}
        className="relative inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium bg-stone-200/60 text-stone-700 border-stone-300 dark:bg-stone-700/40 dark:text-stone-200 dark:border-stone-600 cursor-help"
      >
        +{overflowCount}
      </button>
    </ConditionalTooltip>
  )
}


function VersionPill({ version }: Readonly<{ version: string }>) {
  return (
    <span
      data-testid="library-card-version-pill"
      className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25 shrink-0"
    >
      v{version}
    </span>
  )
}


function CardTagsFooter({
  fn,
  visibleTags,
  overflowTags,
}: Readonly<{
  fn: FunctionSummary
  visibleTags: string[]
  overflowTags: string[]
}>) {
  if (fn.tags.length > 0) {
    return (
      <div
        data-testid="library-card-tags"
        className="flex items-center justify-between gap-2"
      >
        <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
          {visibleTags.map((tag) => (
            <Badge
              key={tag}
              variant="default"
              className="text-[10px] px-1.5 py-0 font-normal"
            >
              {tag}
            </Badge>
          ))}
          {overflowTags.length > 0 ? (
            <TagOverflowChip allTags={fn.tags} overflowCount={overflowTags.length} />
          ) : null}
        </div>
        {fn.latest_version ? <VersionPill version={fn.latest_version} /> : null}
      </div>
    )
  }
  if (fn.latest_version) {
    return (
      <div className="flex items-center justify-end gap-2">
        <VersionPill version={fn.latest_version} />
      </div>
    )
  }
  return null
}


export function LibraryCard({
  function: fn,
  onDragStart,
}: Readonly<LibraryCardProps>) {
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer) {
      // The canvas drop handler (`use-canvas-drop.ts`) listens on the
      // shared `application/wave-block` MIME type and routes payloads with
      // `type: 'function-published'` to `buildPublishedFunctionNode`.
      event.dataTransfer.setData(
        'application/wave-block',
        JSON.stringify({
          type: 'function-published',
          functionId: fn.id,
          name: fn.name,
          version: fn.latest_version,
          source: 'library-modal',
        }),
      )
      event.dataTransfer.effectAllowed = 'move'
    }
    onDragStart?.(fn, event)
  }

  const visibleTags = fn.tags.slice(0, MAX_VISIBLE_TAGS)
  const overflowTags = fn.tags.slice(MAX_VISIBLE_TAGS)

  return (
    <Card
      data-testid="library-card"
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md',
        'p-0',
      )}
    >
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 p-3 pb-1">
        <FunctionSquare
          className="h-4 w-4 shrink-0 text-indigo-500"
          aria-hidden="true"
        />
        <NameWithTooltip name={fn.name} />
      </CardHeader>
      <CardContent className="p-3 pt-1 space-y-2">
        {fn.description ? (
          <ConditionalTooltip content={fn.description} wide>
            <p className="text-xs text-muted-foreground line-clamp-1">
              {fn.description}
            </p>
          </ConditionalTooltip>
        ) : null}
        <CardTagsFooter fn={fn} visibleTags={visibleTags} overflowTags={overflowTags} />
      </CardContent>
    </Card>
  )
}
