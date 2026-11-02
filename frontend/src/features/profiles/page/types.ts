/**
 * Type definitions for the Profiles page.
 *
 * REQ-4.7.4: Profile management UI
 */

import type { OnChangeFn, RowSelectionState, SortingState, VisibilityState } from '@tanstack/react-table'
import type { Filters, Column } from '@/features/profiles/components/profiles-filters'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import type { Profile } from '@/features/profiles/api/types'

export type { Profile } from '@/features/profiles/api/types'
export type { PageInfo } from '@/components/shared/tables/table-utils'

export interface ProfilesPageProps {
  profiles: Profile[]
  pageInfo: PageInfo
  filters: Filters
  profileTypes: string[]
  allTags: string[]
  loading?: boolean
  /** False until the first read has finished; skeletons stand in until it has. */
  settled?: boolean
  error?: string
  className?: string
  // Sorting (TanStack native)
  sorting: SortingState
  onSortingChange: OnChangeFn<SortingState>
  // Column visibility (TanStack native)
  columnVisibility: VisibilityState
  onColumnVisibilityChange: OnChangeFn<VisibilityState>
  visibleColumns: string[]
  // Selection (TanStack native)
  enableSelection?: boolean
  rowSelection?: RowSelectionState
  onRowSelectionChange?: OnChangeFn<RowSelectionState>
  selectedIds?: string[]
  // Actions
  onNewProfile: () => void
  onEditProfile: (profileId: string) => void
  onDeleteProfile: (profileId: string) => void
  onDuplicateProfile: (profileId: string) => void
  // Export/Import
  onExportProfile?: (profileId: string) => void
  onImport?: () => void
  // Bulk actions
  onBulkExport?: () => void
  onBulkDuplicate?: () => void
  onBulkDelete?: () => void
  onEnterSelectionMode?: () => void
  onExitSelectionMode?: () => void
  // Filter/pagination
  onFilterChange: (filters: Filters) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onColumnToggle: (columnId: string, visible: boolean) => void
  onRetry: () => void
}

// Columns available for toggle (Name is always visible like Actions)
export const TOGGLEABLE_COLUMNS: Column[] = [
  { id: 'type', label: 'Type', visible: true },
  { id: 'tags', label: 'Tags', visible: true },
  { id: 'environments', label: 'Environments', visible: true },
  { id: 'usage', label: 'Usage', visible: true },
]

// Default visible columns
export const DEFAULT_VISIBLE_COLUMNS = ['name', 'type', 'tags', 'environments', 'usage']
