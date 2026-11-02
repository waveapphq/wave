/**
 * useQuickAddFunctions (REQ-4.2.5, PICKER-1): the published-Function half of
 * Quick Insert. 25 rows per request, the search runs on the server after a
 * 300ms pause, the next page appends, and a superseded response is dropped
 * instead of overwriting a newer one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { listFunctions } from '@/features/functions/api/functions-api'
import type { ListFunctionsParams } from '@/features/functions/api/types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import {
  buildFunctionRows,
  type QuickAddItem,
} from '@/features/workbench/lib/quick-add-catalog'

const FUNCTIONS_PER_PAGE = 25
const SEARCH_DEBOUNCE_MS = 300
const NO_ROWS: ReadonlyArray<QuickAddItem> = []

export type QuickAddFunctionsStatus =
  | 'loading'
  | 'loading-more'
  | 'ready'
  | 'error'

export interface QuickAddFunctionsState {
  /** Rows loaded so far for the applied search, in server order. */
  items: ReadonlyArray<QuickAddItem>
  /** Server total for the applied search. */
  total: number
  status: QuickAddFunctionsStatus
  /** Trimmed search the current rows and total describe. */
  appliedQuery: string
  onQueryChange: (query: string) => void
  onLoadMore: () => void
  onRetry: () => void
}

function sameRows(
  a: ReadonlyArray<QuickAddItem>,
  b: ReadonlyArray<QuickAddItem>,
): boolean {
  return (
    a.length === b.length &&
    a.every((row, index) => row.id === b[index].id && row.version === b[index].version)
  )
}

export function useQuickAddFunctions(open: boolean): QuickAddFunctionsState {
  const libraryRevision = useWorkflowStore((s) => s.functionLibraryRevision)

  const [items, setItems] = useState<ReadonlyArray<QuickAddItem>>(NO_ROWS)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<QuickAddFunctionsStatus>('loading')
  const [appliedQuery, setAppliedQuery] = useState('')

  // Issue-time sequence: only the newest request may write.
  const seqRef = useRef(0)
  const inFlightRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = useRef<QuickAddFunctionsStatus>('loading')
  const itemsRef = useRef<ReadonlyArray<QuickAddItem>>(NO_ROWS)
  const totalRef = useRef(0)
  const queryRef = useRef('')
  const pageRef = useRef(1)
  const lastRequestRef = useRef({ page: 1, append: false, search: '' })
  const openRef = useRef(false)
  const revisionRef = useRef(libraryRevision)

  const clearPending = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const setPhase = useCallback((next: QuickAddFunctionsStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const loadPage = useCallback(
    (page: number, append: boolean, search: string) => {
      const seq = ++seqRef.current
      inFlightRef.current = true
      lastRequestRef.current = { page, append, search }
      setPhase(append ? 'loading-more' : 'loading')
      const params: ListFunctionsParams = {
        page,
        per_page: FUNCTIONS_PER_PAGE,
        sort_by: 'name',
        sort_order: 'asc',
      }
      if (search !== '') params.search = search
      listFunctions(params)
        .then((result) => {
          if (seq !== seqRef.current) return
          const rows = buildFunctionRows(result.functions)
          const merged = append ? [...itemsRef.current, ...rows] : rows
          // Same rows back: keep the array identity so no row re-renders.
          const next = sameRows(itemsRef.current, merged) ? itemsRef.current : merged
          itemsRef.current = next
          totalRef.current = result.pagination.total
          pageRef.current = page
          setItems(next)
          setTotal(result.pagination.total)
          setAppliedQuery(search)
          setPhase('ready')
        })
        .catch(() => {
          if (seq !== seqRef.current) return
          // A failed replace has no valid rows left; a failed append keeps its.
          if (!append) {
            itemsRef.current = NO_ROWS
            totalRef.current = 0
            setItems(NO_ROWS)
            setTotal(0)
            setAppliedQuery(search)
          }
          setPhase('error')
        })
        .finally(() => {
          if (seq === seqRef.current) inFlightRef.current = false
        })
    },
    [setPhase],
  )

  // Fresh page 1 on every open; gated on the transition (StrictMode-safe).
  useEffect(() => {
    if (open === openRef.current) return
    openRef.current = open
    clearPending()
    if (!open) {
      seqRef.current += 1
      inFlightRef.current = false
      return
    }
    queryRef.current = ''
    pageRef.current = 1
    loadPage(1, false, '')
  }, [open, clearPending, loadPage])

  // A library change (publish, delete, ...) restarts at page 1, same search.
  useEffect(() => {
    if (libraryRevision === revisionRef.current) return
    revisionRef.current = libraryRevision
    if (!openRef.current) return
    clearPending()
    pageRef.current = 1
    loadPage(1, false, queryRef.current)
  }, [libraryRevision, clearPending, loadPage])

  useEffect(() => clearPending, [clearPending])

  const onQueryChange = useCallback(
    (raw: string) => {
      const trimmed = raw.trim()
      if (trimmed === queryRef.current) return
      queryRef.current = trimmed
      clearPending()
      pageRef.current = 1
      if (trimmed === '') {
        loadPage(1, false, '')
        return
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        loadPage(1, false, trimmed)
      }, SEARCH_DEBOUNCE_MS)
    },
    [clearPending, loadPage],
  )

  const onLoadMore = useCallback(() => {
    if (inFlightRef.current || timerRef.current !== null) return
    if (statusRef.current !== 'ready') return
    if (itemsRef.current.length >= totalRef.current) return
    loadPage(pageRef.current + 1, true, queryRef.current)
  }, [loadPage])

  const onRetry = useCallback(() => {
    const { page, append, search } = lastRequestRef.current
    loadPage(page, append, search)
  }, [loadPage])

  return { items, total, status, appliedQuery, onQueryChange, onLoadMore, onRetry }
}
