/**
 * QuickAddPopover (REQ-4.2.5, CANVAS-231..237): Ctrl+Space insert surface.
 *
 * Movable Quick Insert window on the shared draggable sheet: header bar with a
 * close control, its own substring search (the command library's fuzzy ranking
 * is disabled), grouped catalog (PLUGINS / CONTROLS / FUNCTIONS), a caret that
 * never leaves the search box, Tab / PgUp / PgDn as highlight movers, footer
 * key hints naming the anchor in force. Enter inserts at the resolved anchor,
 * Ctrl+Enter at viewport center; rows are HTML5 drag sources emitting the
 * palette `application/wave-block` payloads.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type UIEvent,
} from 'react'
import { AlertTriangle, Mouse, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { cn } from '@/lib/utils'
import { formatShortcut } from '@/lib/platform'
import { filterByBlockQuery } from '@/features/workbench/lib/block-search'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import type {
  QuickAddGroup,
  QuickAddItem,
} from '@/features/workbench/lib/quick-add-catalog'
import type { QuickAddFunctionsState } from '@/features/workbench/common/canvas/quick-add/use-quick-add-functions'
import type { DropPayload } from '@/features/workbench/common/canvas/workflow-canvas/node-builders'

export type QuickAddInsertMode = 'anchor' | 'center'

export interface QuickAddPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (item: QuickAddItem, mode: QuickAddInsertMode) => void
  /** The fixed rows: plugins, controls, the creator row. Filtered in place. */
  items: ReadonlyArray<QuickAddItem>
  /** The server-paged published-Function half. */
  functions: QuickAddFunctionsState
  /** Whether exactly one block is selected; only the footer copy depends on it. */
  hasSelection: boolean
}

const GROUPS: ReadonlyArray<{ key: QuickAddGroup; heading: string }> = [
  { key: 'plugins', heading: 'PLUGINS' },
  { key: 'controls', heading: 'CONTROLS' },
  { key: 'functions', heading: 'FUNCTIONS' },
]

/** Page step for a list the browser has not laid out yet. */
const UNMEASURED_PAGE_STEP = 10

const ROW_TESTID_PREFIX = 'quick-add-item-'

/** Distance (px) from the bottom of the list that loads the next page. */
const LOAD_MORE_THRESHOLD_PX = 100

/** Fixed height keeps the footer hints still while the status text changes. */
const STATUS_LINE_CLASS =
  'flex h-7 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground'

function findRow(body: HTMLElement | null, id: string): HTMLElement | null {
  return body?.querySelector<HTMLElement>(`[data-testid="${ROW_TESTID_PREFIX}${id}"]`) ?? null
}

/**
 * First and last row shown whole, both -1 when none is. Group headings share
 * the box, so only real rows can be counted.
 */
function visibleRowRange(list: HTMLElement): { first: number; last: number } {
  const top = list.getBoundingClientRect().top + list.clientTop
  const bottom = top + list.clientHeight
  let first = -1
  let last = -1
  list
    .querySelectorAll<HTMLElement>(`[data-testid^="${ROW_TESTID_PREFIX}"]`)
    .forEach((row, index) => {
      const box = row.getBoundingClientRect()
      if (box.height > 0 && box.top >= top && box.bottom <= bottom) {
        if (first < 0) first = index
        last = index
      }
    })
  return { first, last }
}

/**
 * Where a page key lands: the far edge of what is on screen, or one row past
 * it when the highlight is already there.
 */
function pageTarget(
  list: HTMLElement | null,
  index: number,
  direction: 1 | -1,
): number {
  if (!list || list.clientHeight === 0) return index + direction * UNMEASURED_PAGE_STEP
  const { first, last } = visibleRowRange(list)
  if (first < 0) return index + direction
  if (direction === 1) return Math.max(last, index + 1)
  return Math.min(first, index - 1)
}

/** Reveals a moved highlight; no row is ever virtualized, so it is always mounted. */
function revealRow(
  body: HTMLElement | null,
  id: string,
  block: ScrollLogicalPosition,
) {
  const row = findRow(body, id)
  if (!row) return
  row.scrollIntoView({ block })
  // As the command library does: a row that opens its group reveals its heading.
  if (row.previousElementSibling === null) {
    row
      .closest('[cmdk-group=""]')
      ?.querySelector('[cmdk-group-heading=""]')
      ?.scrollIntoView({ block: 'nearest' })
  }
}

/** Same payload shapes the palette / library drag sources emit. */
function buildDropPayload(item: QuickAddItem): DropPayload {
  if (item.type === 'function') {
    return {
      type: 'function-published',
      functionId: item.functionId as string,
      name: item.name,
      version: item.version,
      source: 'quick-add',
    }
  }
  if (item.type === 'new-function') {
    return { type: 'function-new-local' }
  }
  return {
    id: item.id,
    name: item.name,
    type: item.type,
  }
}

function QuickAddRow({
  item,
  onSelect,
  onRowDragStart,
}: Readonly<{
  item: QuickAddItem
  onSelect: () => void
  onRowDragStart: (event: DragEvent<HTMLDivElement>) => void
}>) {
  const Icon = getIconComponent(item.iconName)
  return (
    <CommandItem
      value={item.id}
      onSelect={onSelect}
      draggable
      onDragStart={onRowDragStart}
      data-testid={`${ROW_TESTID_PREFIX}${item.id}`}
      className="gap-2"
    >
      <Icon className={cn('h-4 w-4 shrink-0', item.colorClass)} aria-hidden="true" />
      <span className="truncate">{item.name}</span>
      <span className="ml-auto flex items-center text-xs text-muted-foreground">
        {item.type === 'function' && item.version ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border-indigo-500/25 shrink-0">
            v{item.version}
          </span>
        ) : null}
        {item.type === 'new-function' ? 'empty Local Function' : null}
        {item.categoryLabel ?? null}
      </span>
    </CommandItem>
  )
}

function functionsStatusLabel(functions: QuickAddFunctionsState): string {
  if (functions.status === 'loading') return 'Loading Functions…'
  if (functions.status === 'loading-more') return 'Loading more Functions…'
  if (functions.total === 0) {
    return functions.appliedQuery === ''
      ? 'No Functions published yet'
      : 'No Functions match'
  }
  if (functions.items.length < functions.total) {
    return `${functions.total} Functions - refine your search to narrow down`
  }
  return `${functions.total} Functions`
}

/** Permanent line under the list; always describes the Functions half. */
function FunctionsStatusLine({
  functions,
}: Readonly<{ functions: QuickAddFunctionsState }>) {
  if (functions.status === 'error') {
    return (
      <div data-testid="quick-add-functions-status" className={STATUS_LINE_CLASS}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-error" />
        <span className="flex-1 truncate text-foreground">
          Couldn&apos;t load Functions
        </span>
        <button
          type="button"
          data-testid="quick-add-functions-retry"
          onClick={functions.onRetry}
          className="shrink-0 rounded-sm font-medium text-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try Again
        </button>
      </div>
    )
  }
  return (
    <div data-testid="quick-add-functions-status" className={STATUS_LINE_CLASS}>
      <span className="truncate">{functionsStatusLabel(functions)}</span>
    </div>
  )
}

function FooterHint({
  label,
  keys,
  badge,
  testId,
}: Readonly<{
  label: string
  keys?: string[]
  badge?: ReactNode
  testId?: string
}>) {
  return (
    <span data-testid={testId} className="inline-flex items-center gap-1">
      {badge}
      {keys?.map((key) => (
        <Kbd key={key} aria-hidden="true">
          {key}
        </Kbd>
      ))}
      <span>{label}</span>
    </span>
  )
}

export function QuickAddPopover({
  open,
  onOpenChange,
  onInsert,
  items,
  functions,
  hasSelection,
}: Readonly<QuickAddPopoverProps>) {
  const [query, setQuery] = useState('')
  // The explicit pick is keyed to the query it was made under, so any query
  // change falls back to the first remaining row without an effect.
  const [picked, setPicked] = useState<{ query: string; id: string } | null>(null)
  const [lastOpen, setLastOpen] = useState(open)
  const inputRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset in the reopening render, not after it: a post-commit reset lets the
  // list mount on the stale highlight, which scrolls it there.
  if (open !== lastOpen) {
    setLastOpen(open)
    setQuery('')
    setPicked(null)
  }

  // The caret never leaves the search box: any press inside the window
  // (header, heading, footer, blank space) returns it to the input.
  useEffect(() => {
    if (!open) return
    const section = bodyRef.current?.parentElement
    /* v8 ignore next - COV-V8-003: ref attachment race */
    if (!section) return
    const keepCaret = (event: Event) => {
      const input = inputRef.current
      if (!input || event.target === input) return
      // A row press is a click-insert or the start of a drag onto the canvas,
      // and either way this window is closing: touching focus there cancels
      // the drag gesture.
      if ((event.target as Element).closest?.('[draggable="true"]')) return
      // The drag handle cancels the mouse event to drive its own drag, so the
      // caret has to be restored from the pointer event as well.
      if (event.type === 'mousedown') event.preventDefault()
      input.focus()
    }
    section.addEventListener('pointerdown', keepCaret, true)
    section.addEventListener('mousedown', keepCaret)
    return () => {
      section.removeEventListener('pointerdown', keepCaret, true)
      section.removeEventListener('mousedown', keepCaret)
    }
  }, [open])

  const serverRows = functions.items
  const ordered = useMemo(() => {
    // Loaded Function rows are narrowed with the same predicate as the
    // built-ins, so what shows is always a subset of what matches.
    const filtered = [
      ...filterByBlockQuery(items, query),
      ...filterByBlockQuery(serverRows, query),
    ]
    return GROUPS.flatMap((group) => filtered.filter((item) => item.group === group.key))
  }, [items, serverRows, query])

  const highlightedId =
    picked?.query === query && ordered.some((item) => item.id === picked.id)
      ? picked.id
      : (ordered[0]?.id ?? '')

  const initialOffset = useMemo(
    () => ({ x: 0, y: -(globalThis.innerHeight || 800) / 2 + 260 }),
    [],
  )

  const insertAndClose = (item: QuickAddItem, mode: QuickAddInsertMode) => {
    onInsert(item, mode)
    onOpenChange(false)
  }

  // Scrolls here and not in an effect, which would re-scroll on mount and reopen.
  const moveHighlight = (
    resolveTarget: (index: number) => number,
    block: ScrollLogicalPosition,
  ) => {
    if (ordered.length === 0) return
    const index = ordered.findIndex((item) => item.id === highlightedId)
    const next = Math.min(ordered.length - 1, Math.max(0, resolveTarget(index)))
    setPicked({ query, id: ordered[next].id })
    revealRow(bodyRef.current, ordered[next].id, block)
  }

  // Capture phase: the command library's own key handling ignores modifiers
  // and would let Tab move focus, so both are intercepted before it.
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      const step = event.shiftKey ? -1 : 1
      moveHighlight((index) => index + step, 'nearest')
      return
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault()
      event.stopPropagation()
      const down = event.key === 'PageDown'
      // The row lands on the edge it traveled to, which shows a whole new
      // screenful behind it.
      moveHighlight(
        (index) => pageTarget(listRef.current, index, down ? 1 : -1),
        down ? 'start' : 'end',
      )
      return
    }
    if (event.key !== 'Enter') return
    if (!event.ctrlKey && !event.metaKey && !event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    if (event.altKey) return
    const item = ordered.find((candidate) => candidate.id === highlightedId)
    if (!item) return
    insertAndClose(item, 'center')
  }

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget
    const fromBottom = list.scrollHeight - list.scrollTop - list.clientHeight
    if (fromBottom >= LOAD_MORE_THRESHOLD_PX) return
    functions.onLoadMore()
  }

  const handleRowDragStart =
    (item: QuickAddItem) => (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData(
        'application/wave-block',
        JSON.stringify(buildDropPayload(item)),
      )
      event.dataTransfer.effectAllowed = 'move'
      // Keep the row mounted through dragstart (Chrome cancels drags whose
      // source unmounts synchronously); close on the first canvas dragover.
      document.addEventListener(
        'dragover',
        () => onOpenChange(false),
        { once: true },
      )
    }

  return (
    <DraggableSheet
      open={open}
      onClose={() => onOpenChange(false)}
      sheetId="quick-add"
      ariaLabel="Quick Insert"
      data-testid="quick-add-popover"
      initialOffset={initialOffset}
      initialWidth={560}
      resizable={false}
      headerClassName="bg-muted/40 py-2.5"
      header={
        <>
          <h2 className="text-base font-semibold">Quick Insert</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Close"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="flex min-h-0 flex-col" onKeyDownCapture={handleKeyDownCapture}>
        <Command
          shouldFilter={false}
          value={highlightedId}
          onValueChange={(id) => setPicked({ query, id })}
          className="bg-transparent"
        >
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={(value) => {
              setQuery(value)
              functions.onQueryChange(value)
            }}
            placeholder="Search blocks…"
            aria-label="Search blocks"
            autoFocus
          />
          <CommandList
            ref={listRef}
            data-testid="quick-add-list"
            className="max-h-[320px]"
            onScroll={handleListScroll}
          >
            <CommandEmpty>No matching items</CommandEmpty>
            {GROUPS.map((group) => {
              const groupItems = ordered.filter((item) => item.group === group.key)
              if (groupItems.length === 0) return null
              return (
                <CommandGroup key={group.key} heading={group.heading}>
                  {groupItems.map((item) => (
                    <QuickAddRow
                      key={item.id}
                      item={item}
                      onSelect={() => insertAndClose(item, 'anchor')}
                      onRowDragStart={handleRowDragStart(item)}
                    />
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
        <FunctionsStatusLine functions={functions} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
          <FooterHint keys={['↑', '↓', 'Tab']} label="navigate" />
          <FooterHint
            keys={['Enter']}
            label={hasSelection ? 'add after selection' : 'add after last block'}
          />
          <FooterHint keys={[formatShortcut('Enter')]} label="add at center" />
          <FooterHint keys={['PgUp', 'PgDn']} label="page" />
          <FooterHint keys={['Esc']} label="close" />
          <FooterHint
            testId="quick-add-hint-click"
            badge={
              <Kbd aria-hidden="true">
                <Mouse className="h-3 w-3" />
              </Kbd>
            }
            label="click a row to add"
          />
          <FooterHint
            testId="quick-add-hint-pointer"
            badge={
              <Kbd aria-hidden="true">
                <Mouse className="h-3 w-3" />
              </Kbd>
            }
            label="drag a row onto the canvas"
          />
        </div>
      </div>
    </DraggableSheet>
  )
}
