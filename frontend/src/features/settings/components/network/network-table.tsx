/**
 * Network page table (NET-3): search on the left and an actions slot on the
 * right over the shared DataTable, with client-side search, sorting and 10 rows
 * per page. Pass module-level `getRowId` and `searchText` so the page index
 * survives a parent render.
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  functionalUpdate,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import { SearchInput } from '@/components/ui/search-input'

const PAGE_SIZE = 10
const NO_SORTING: SortingState = []

export interface NetworkTableSelection {
  active: boolean
  selected: RowSelectionState
  onChange: (next: RowSelectionState) => void
}

export interface NetworkTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  getRowId: (row: T) => string
  getRowLabel: (row: T) => string
  searchPlaceholder: string
  /** The text a search matches, case-insensitive; it may hold fields no column shows. */
  searchText: (row: T) => string
  /** Plural, lower case: "hosts" reads "Showing 1-10 of 27 hosts". */
  entityName: string
  emptyMessage: string
  emptyAction?: ReactNode
  actions?: ReactNode
  selection?: NetworkTableSelection
  loading?: boolean
  /** The sort the table opens with; headers change it from there. */
  defaultSorting?: SortingState
  'data-testid': string
}

export function NetworkTable<T>({
  columns,
  data,
  getRowId,
  getRowLabel,
  searchPlaceholder,
  searchText,
  entityName,
  emptyMessage,
  emptyAction,
  actions,
  selection,
  loading = false,
  defaultSorting = NO_SORTING,
  'data-testid': testId,
}: Readonly<NetworkTableProps<T>>) {
  const [query, setQuery] = useState('')
  const [sorting, setSorting] = useState<SortingState>(defaultSorting)

  const needle = query.trim().toLowerCase()
  const rows = useMemo(
    () => (needle ? data.filter((row) => searchText(row).toLowerCase().includes(needle)) : data),
    [data, needle, searchText],
  )
  const searchMissed = needle !== '' && rows.length === 0 && data.length > 0

  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          size="sm"
          className="w-64"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder.replace(/…$/, '')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        sorting={sorting}
        onSortingChange={setSorting}
        entityName={entityName}
        defaultPageSize={PAGE_SIZE}
        enableSelection={selection?.active ?? false}
        rowSelection={selection?.selected}
        onRowSelectionChange={
          selection && ((updater) => selection.onChange(functionalUpdate(updater, selection.selected)))
        }
        loading={loading}
        emptyMessage={searchMissed ? `No matching ${entityName} found` : emptyMessage}
        emptyAction={searchMissed ? undefined : emptyAction}
        getRowId={getRowId}
        getRowLabel={getRowLabel}
      />
    </div>
  )
}
