/** Shared paginated, infinite-scroll modal for picking entities (tests, suites) to add to a parent. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckboxIndicator } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { SearchInput } from '@/components/ui/search-input'
import { Icon, ChevronDownIcon, CheckIcon } from '@/components/ui/icon'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'
import { Loader2, X, RefreshCw } from 'lucide-react'
import { ListErrorState } from '@/components/shared/list-page-states'

const PER_PAGE = 25
// Distance (px) from the bottom of the list that triggers the next-page load.
const SCROLL_THRESHOLD = 100

function formatTagLabel(count: number): string {
  if (count === 0) return 'Tags'
  return `${count} tag${count === 1 ? '' : 's'}`
}

const STATUS_LABEL: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  never_run: 'Never Run',
}

const STATUS_VARIANT: Record<string, 'success' | 'error' | 'default'> = {
  passed: 'success',
  failed: 'error',
  never_run: 'default',
}

export interface PickerItem {
  id: string
  name: string
  status?: string
  tags?: string[]
}

export interface PickerFetchParams {
  search?: string
  tags?: string[]
  page: number
  perPage: number
}

export interface PickerFetchResult {
  items: PickerItem[]
  total: number
}

interface PickerQuery {
  search: string
  tags: string[]
}

const EMPTY_QUERY: PickerQuery = { search: '', tags: [] }

type PickerStatus = 'loading' | 'loading-more' | 'ready' | 'error' | 'load-more-error'

/** Names the read that failed, so a failed tag list never reads as a failed item list. */
function failedReadLabel(
  itemsFailed: boolean,
  tagsFailed: boolean,
  entityNamePlural: string
): string {
  if (itemsFailed && tagsFailed) return `${entityNamePlural} and tags`
  return itemsFailed ? entityNamePlural : 'tags'
}

export interface EntityPickerModalProps {
  open: boolean
  onClose: () => void
  onSelect: (items: Array<{ id: string; name: string }>) => void
  excludeIds: string[]
  /** Dialog title, e.g. "Add Tests to Suite" */
  title: string
  /** Dialog description */
  description: string
  /** Placeholder for search input */
  searchPlaceholder: string
  /** Label for excluded items, e.g. "(in suite)" */
  excludedLabel: string
  /** Icon for empty state */
  emptyIcon: ReactNode
  /** Test ID prefix. Individual elements get suffixes:
   * `{prefix}-modal`, `{prefix}-search`, `{prefix}-add-btn`, `{prefix}-empty`,
   * `{prefix}-loading`, `{prefix}-list`, `{prefix}-tag-filter`, `{prefix}-tag-clear`,
   * and rows use `{prefix}-{itemKind}-row` so existing E2E selectors that
   * encode the item type (e.g. "test-picker-test-row") keep working. */
  testId: string
  /** Item kind segment used in the row testid (e.g. "test", "suite"). */
  itemKind: string
  /** Plural entity noun for nudge/error copy (e.g. "tests", "suites"). */
  entityNamePlural: string
  /** Fetch one page of items - receives search, tags, page, perPage. */
  fetchItems: (params: PickerFetchParams) => Promise<PickerFetchResult>
  /** Fetch all available tags */
  fetchTags: () => Promise<string[]>
}

export function EntityPickerModal({
  open,
  onClose,
  onSelect,
  excludeIds,
  title,
  description,
  searchPlaceholder,
  excludedLabel,
  emptyIcon,
  testId,
  itemKind,
  entityNamePlural,
  fetchItems,
  fetchTags,
}: Readonly<EntityPickerModalProps>): ReactNode {
  const [items, setItems] = useState<PickerItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<PickerStatus>('loading')
  const [failedLabel, setFailedLabel] = useState(entityNamePlural)
  const [allTags, setAllTags] = useState<string[]>([])
  const [selected, setSelected] = useState<Map<string, { id: string; name: string }>>(new Map())
  const [search, setSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)

  const excludeSet = useRef(new Set<string>())
  excludeSet.current = new Set(excludeIds)

  // Nothing here can await, so the read carries its own reporting catch: a
  // failed item or tag read lands in the picker's own error state.
  const loadPage = useCallback(
    (pageNum: number, append: boolean, query: PickerQuery, withTags: boolean): void => {
      setStatus(append ? 'loading-more' : 'loading')
      const params: PickerFetchParams = { page: pageNum, perPage: PER_PAGE }
      if (query.search) params.search = query.search
      if (query.tags.length > 0) params.tags = query.tags
      let itemsFailed = false
      let tagsFailed = false
      const read = async (): Promise<void> => {
        const [result, tags] = await Promise.allSettled([
          fetchItems(params),
          withTags ? fetchTags() : Promise.resolve(null),
        ])
        itemsFailed = result.status === 'rejected'
        tagsFailed = tags.status === 'rejected'
        if (result.status === 'rejected') throw result.reason
        if (tags.status === 'rejected') throw tags.reason
        if (tags.value !== null) setAllTags(tags.value)
        setTotal(result.value.total)
        setPage(pageNum)
        setItems(prev => (append ? [...prev, ...result.value.items] : result.value.items))
        setStatus('ready')
      }
      read().catch(() => {
        setFailedLabel(failedReadLabel(itemsFailed, tagsFailed, entityNamePlural))
        setStatus(append ? 'load-more-error' : 'error')
      })
    },
    [fetchItems, fetchTags, entityNamePlural],
  )

  useEffect(() => {
    if (!open) return
    setSelected(new Map())
    setSearch('')
    setSelectedTags([])
    setItems([])
    setTotal(0)
    setPage(1)
    // The tag read is part of the initial load, so a tag failure surfaces in
    // the same error state and is retried by the same Try Again.
    loadPage(1, false, EMPTY_QUERY, true)
  }, [open, loadPage])

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value)
      loadPage(1, false, { search: value, tags: selectedTags }, false)
    },
    [loadPage, selectedTags],
  )

  const handleTagToggle = useCallback(
    (tag: string) => {
      setSelectedTags(prev => {
        const next = prev.includes(tag)
          ? prev.filter(t => t !== tag)
          : [...prev, tag]
        loadPage(1, false, { search, tags: next }, false)
        return next
      })
    },
    [loadPage, search],
  )

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distanceFromBottom >= SCROLL_THRESHOLD || status !== 'ready' || items.length >= total) {
        return
      }
      loadPage(page + 1, true, { search, tags: selectedTags }, false)
    },
    [status, items.length, total, page, search, selectedTags, loadPage],
  )

  const handleRetryPage1 = useCallback(() => {
    loadPage(1, false, { search, tags: selectedTags }, true)
  }, [loadPage, search, selectedTags])

  const handleRetryLoadMore = useCallback(() => {
    loadPage(page + 1, true, { search, tags: selectedTags }, false)
  }, [loadPage, page, search, selectedTags])

  const handleToggle = useCallback((item: PickerItem) => {
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(item.id)) {
        next.delete(item.id)
      } else {
        next.set(item.id, { id: item.id, name: item.name })
      }
      return next
    })
  }, [])

  const handleAdd = useCallback(() => {
    onSelect([...selected.values()])
    onClose()
  }, [selected, onSelect, onClose])

  const rowTestId = `${testId}-${itemKind}-row`

  let listBody: ReactNode
  if (status === 'error') {
    listBody = (
      <div className="flex h-full items-center justify-center">
        <ListErrorState entityName={failedLabel} onRetry={handleRetryPage1} />
      </div>
    )
  } else if (status === 'loading') {
    listBody = (
      <div data-testid={`${testId}-loading`} className="flex items-center justify-center py-12">
        <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  } else if (items.length === 0) {
    listBody = (
      <div data-testid={`${testId}-empty`} className="flex flex-col items-center justify-center py-12 text-center">
        <div className="h-8 w-8 text-muted-foreground/40 mb-2">{emptyIcon}</div>
        <p className="text-sm text-muted-foreground">No items found</p>
      </div>
    )
  } else {
    listBody = (
      <div className="divide-y">
        {items.map(item => {
          const isExcluded = excludeSet.current.has(item.id)
          const isSelected = selected.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              data-testid={rowTestId}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                isExcluded
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-muted/30 cursor-pointer'
              }`}
              onClick={() => !isExcluded && handleToggle(item)}
              disabled={isExcluded}
            >
              <CheckboxIndicator checked={isSelected} />
              <span className="flex-1 text-sm font-medium truncate">{item.name}</span>
              {isExcluded ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">{excludedLabel}</span>
              ) : (
                <>
                  {item.tags?.map(tag => (
                    <Badge key={tag} variant="default" className="text-xs shrink-0">
                      {tag}
                    </Badge>
                  ))}
                  {item.status && (
                    <Badge variant={STATUS_VARIANT[item.status] ?? 'default'} className="text-xs shrink-0">
                      {STATUS_LABEL[item.status] ?? 'Never Run'}
                    </Badge>
                  )}
                </>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent
        data-testid={`${testId}-modal`}
        className="sm:max-w-2xl flex flex-col max-h-[80vh]"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <SearchInput
            data-testid={`${testId}-search`}
            placeholder={searchPlaceholder}
            size="sm"
            debounceMs={300}
            onSearch={handleSearch}
            onClear={() => handleSearch('')}
            className="flex-1"
          />
          <div className="relative">
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid={`${testId}-tag-filter`}
                  className={`flex h-9 w-[140px] items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent py-2 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${selectedTags.length > 0 ? 'pl-3 pr-7' : 'px-3'}`}
                >
                  <span>{formatTagLabel(selectedTags.length)}</span>
                  <Icon icon={ChevronDownIcon} size="sm" className="ml-2 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" role="dialog">
                <Command>
                  <CommandInput placeholder="Search tags…" />
                  <CommandList>
                    <CommandEmpty>No tags found.</CommandEmpty>
                    {allTags.map(tag => (
                      <CommandItem key={tag} value={tag} onSelect={() => handleTagToggle(tag)}>
                        <div className="flex items-center gap-2">
                          {selectedTags.includes(tag) && <Icon icon={CheckIcon} size="sm" />}
                          <span className={selectedTags.includes(tag) ? '' : 'ml-5'}>{tag}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedTags.length > 0 && (
              <button
                type="button"
                data-testid={`${testId}-tag-clear`}
                aria-label="Clear tag filters"
                className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelectedTags([])
                  loadPage(1, false, { search, tags: [] }, false)
                }}
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Item list - scrolls internally; the loading / retry pill floats over it. */}
        <div className="relative flex-1 min-h-[200px] max-h-[400px] overflow-hidden rounded-lg border">
          <div
            data-testid={`${testId}-list`}
            className="absolute inset-0 overflow-y-auto overscroll-contain"
            onScroll={handleScroll}
          >
            {listBody}
          </div>

          {/* Bottom-center pill: shows while a next page loads or after it fails. */}
          {status === 'loading-more' && (
            <div aria-hidden="true" className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none select-none">
              <div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-lg">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </div>
            </div>
          )}
          {status === 'load-more-error' && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
              <button
                type="button"
                data-testid={`${testId}-load-more-retry`}
                onClick={handleRetryLoadMore}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground shadow-lg hover:bg-muted/50"
              >
                <RefreshCw aria-hidden="true" className="h-3 w-3" />
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Refine nudge - shown only while more results remain than are loaded. */}
        {items.length < total && (
          <p className="text-sm text-muted-foreground">
            {total} {entityNamePlural} - refine your search to narrow down
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid={`${testId}-add-btn`}
            onClick={handleAdd}
            disabled={selected.size === 0}
          >
            Add Selected{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
