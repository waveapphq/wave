/**
 * CipherRow - one selectable cipher: checkbox, OpenSSL name (primary, mono),
 * IANA name (muted), and an optional right-aligned compat tag badge (table 1).
 * Unselected rows use the plain row; the per-family preference list uses
 * SortableCipherRow, which adds a drag handle (dnd-kit).
 */

import { GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

function CipherTag({ openssl, tag }: Readonly<{ openssl: string; tag: string }>) {
  return (
    <span
      data-testid={`cipher-tag-${openssl}`}
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]',
        tag.includes('-')
          ? 'border border-border/60 bg-muted text-muted-foreground'
          : 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      )}
    >
      {tag}
    </span>
  )
}

interface CipherRowBodyProps {
  openssl: string
  iana?: string
  tag?: string
  selected: boolean
  onToggle: (openssl: string, selected: boolean) => void
  handle?: React.ReactNode
}

/** Shared row contents (drag handle slot + checkbox + names + tag badge). */
function CipherRowBody({ openssl, iana, tag, selected, onToggle, handle }: Readonly<CipherRowBodyProps>) {
  return (
    <>
      {handle}
      <Checkbox
        data-testid={`cipher-toggle-${openssl}`}
        checked={selected}
        onCheckedChange={(checked) => onToggle(openssl, checked === true)}
        aria-label={`Select ${openssl}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm">{openssl}</span>
        {iana && (
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{iana}</span>
        )}
      </span>
      {tag && <CipherTag openssl={openssl} tag={tag} />}
    </>
  )
}

export interface CipherRowProps {
  openssl: string
  iana?: string
  tag?: string
  selected: boolean
  onToggle: (openssl: string, selected: boolean) => void
}

/** Plain (non-reorderable) row used for unselected ciphers. */
export function CipherRow({ openssl, iana, tag, selected, onToggle }: Readonly<CipherRowProps>) {
  return (
    <div
      data-testid={`cipher-row-${openssl}`}
      className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 last:border-b-0"
    >
      <CipherRowBody openssl={openssl} iana={iana} tag={tag} selected={selected} onToggle={onToggle} />
    </div>
  )
}

export interface SortableCipherRowProps {
  openssl: string
  iana?: string
  tag?: string
  onToggle: (openssl: string, selected: boolean) => void
}

/** Reorderable row (drag handle + checkbox) used by the preference list. */
export function SortableCipherRow({ openssl, iana, tag, onToggle }: Readonly<SortableCipherRowProps>) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: openssl })
  /* v8 ignore start - COV-V8-003: dnd-kit transform/isDragging only vary during a real drag */
  const style = { transform: CSS.Transform.toString(transform), transition }
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      data-testid={`cipher-drag-${openssl}`}
      aria-label={`Reorder ${openssl}`}
      className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  )
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`cipher-row-${openssl}`}
      className={cn(
        'flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5 last:border-b-0',
        isDragging && 'relative z-10 bg-background opacity-80',
      )}
    >
      <CipherRowBody openssl={openssl} iana={iana} tag={tag} selected onToggle={onToggle} handle={handle} />
    </div>
  )
  /* v8 ignore stop */
}
