/**
 * Functions Library modal.
 *
 * Rendered on the shared DraggableSheet primitive: non-blocking (canvas
 * behind stays interactive), draggable by the header, width-resizable.
 *
 * The body renders a search input, a Tags multi-select popover (AND
 * semantics), a responsive card grid (one card per published Function), and
 * empty / filtered-empty states.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { pluralize } from '@/lib/pluralize'
import { ChevronDown, Check, RefreshCw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ListErrorState } from '@/components/shared/list-page-states'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { TextField } from '@/components/shared/fields/text-field'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { cn } from '@/lib/utils'

import { listFunctions } from '@/features/functions/api/functions-api'
import type { FunctionSummary } from '@/features/functions/api/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

import { LibraryCard } from './library-card'
import { useLibraryFilters } from './use-library-filters'

interface FunctionsLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  /** Optional search seed applied on each open. When omitted, the modal
   *  opens with an empty filter so the user sees the full library. The
   *  From-library link on the Function Block window uses this to pre-locate
   *  the source library entry. */
  initialSearch?: string
}

const EMPTY_COPY =
  'No published Functions yet. Build one in the canvas, then Publish it.'

const FILTERED_EMPTY_COPY = 'No Functions match these filters.'

export function FunctionsLibraryModal({
  isOpen,
  onClose,
  initialSearch = '',
}: Readonly<FunctionsLibraryModalProps>) {
  const [allFunctions, setAllFunctions] = useState<FunctionSummary[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const filters = useLibraryFilters(allFunctions, initialSearch)

  // Revision counter bumped externally on publish (and by the in-modal
  // Refresh button) so we re-fetch the catalog without the user having
  // to close/reopen the modal.
  const libraryRevision = useWorkflowStore((s) => s.functionLibraryRevision)
  const bumpLibraryRevision = useWorkflowStore(
    (s) => s.bumpFunctionLibraryRevision,
  )

  // Brief spin animation flag for the Refresh button. The icon rotates
  // while a fetch is in flight; we keep the flag on for at least 400 ms
  // so the user sees the motion even when the network call resolves
  // instantly (the visible feedback IS the point of the click).
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Apply the parent-provided seed whenever it (or the open flag) changes.
  // This covers: (a) opening the modal via the palette button (seed=''),
  // (b) the From-library link on the Function Block window (seed = library name),
  // and (c) clicking a DIFFERENT From-library link while the modal is
  // already open (seed swaps mid-session). User typing in the search field
  // does not re-trigger this because neither dep changes when typing.
  useEffect(() => {
    if (!isOpen) return
    filters.setSearch(initialSearch)
    // filters.setSearch is stable across renders (from useState); listing
    // the whole `filters` object would re-fire the effect on every keystroke.
  }, [isOpen, initialSearch])

  useEffect(() => {
    if (!isOpen) return
    let canceled = false
    const fetchStart = Date.now()
    listFunctions({ page: 1, per_page: 100 })
      .then((result) => {
        if (canceled) return
        setAllFunctions(result.functions)
        setLoadFailed(false)
      })
      .catch(() => {
        if (canceled) return
        // A failed read is a failure, never an empty library.
        setLoadFailed(true)
      })
      .finally(() => {
        if (canceled) return
        // Keep the spinner on for at least 400 ms total so the user sees
        // the icon rotate even when the BE responds in single digits of ms.
        const elapsed = Date.now() - fetchStart
        const remaining = Math.max(0, 400 - elapsed)
        setTimeout(() => {
          if (!canceled) setIsRefreshing(false)
        }, remaining)
      })
    return () => {
      canceled = true
    }
    // `libraryRevision` re-fires the fetch whenever an external change has
    // occurred (publish, publish-edit-mode draft, refresh button click).
  }, [isOpen, libraryRevision])

  let body: ReactNode
  if (loadFailed) {
    body = (
      <div data-testid="functions-library-error" className="flex flex-1 items-center justify-center">
        <ListErrorState entityName="Functions" onRetry={bumpLibraryRevision} />
      </div>
    )
  } else if (allFunctions.length === 0) {
    body = (
      <div className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
        {EMPTY_COPY}
      </div>
    )
  } else {
    body = (
      <>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <TextField
              value={filters.search}
              onChange={filters.setSearch}
              placeholder="Search Functions…"
              aria-label="Search Functions"
            />
          </div>
          <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-9 w-[120px] items-center justify-between whitespace-nowrap',
                  'rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  filters.selectedTags.length > 0 && 'border-primary text-primary',
                )}
              >
                <span>
                  {filters.selectedTags.length > 0
                    ? pluralize(filters.selectedTags.length, 'tag')
                    : 'Tags'}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-0" role="dialog">
              <Command>
                <CommandInput placeholder="Search tags…" />
                <CommandList>
                  <CommandEmpty>No tags found.</CommandEmpty>
                  {filters.allTags.map((tag) => (
                    <CommandItem
                      key={tag}
                      value={tag}
                      chosen={filters.selectedTags.includes(tag)}
                      onSelect={() => filters.toggleTag(tag)}
                    >
                      <div className="flex items-center gap-2">
                        {filters.selectedTags.includes(tag) ? (
                          <Check className="h-3.5 w-3.5" data-testid="check-icon" />
                        ) : (
                          <span className="inline-block w-3.5" />
                        )}
                        <span>{tag}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {filters.hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={filters.clearFilters}
              className="text-warning border-warning hover:bg-warning/10"
            >
              Clear Filters
            </Button>
          )}
        </div>
        {filters.filtered.length === 0 ? (
          <div className="flex-1 px-4 py-10 text-center text-sm text-muted-foreground">
            {FILTERED_EMPTY_COPY}
          </div>
        ) : (
          <div
            data-testid="functions-library-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.5rem',
              overflowY: 'auto',
            }}
            className="flex-1 min-h-0 overscroll-contain"
          >
            {filters.filtered.map((fn) => (
              <LibraryCard key={fn.id} function={fn} />
            ))}
          </div>
        )}
      </>
    )
  }

  return (
    <DraggableSheet
      open={isOpen}
      onClose={onClose}
      sheetId="functions-library"
      ariaLabel="Functions Library"
      data-testid="functions-library"
      initialWidth={640}
      minWidth={520}
      minHeight={360}
      className="max-w-[90vw] max-h-[80vh]"
      header={
        <>
          <h2 className="text-base font-semibold">Functions Library</h2>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh"
              aria-busy={isRefreshing || undefined}
              data-testid="functions-library-refresh-button"
              onClick={(event) => {
                // The header is the drag handle; intercept the pointer events
                // so clicking Refresh does not start a drag gesture.
                event.stopPropagation()
                // The spinner stays on for at least 400 ms (see the fetch
                // effect's `finally` block) so the user sees the rotation
                // even when the network responds instantly.
                setIsRefreshing(true)
                bumpLibraryRevision()
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <RefreshCw
                className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
                data-testid="functions-library-refresh-icon"
                data-spinning={isRefreshing || undefined}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={onClose}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      <div className="flex-1 min-h-0 flex flex-col gap-3 p-3">
        {body}
      </div>
    </DraggableSheet>
  )
}
