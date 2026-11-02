/**
 * Sortable column header label for DataTable.
 *
 * Renders a label with sort direction indicator (chevron icon).
 * Sort interaction (click/keyboard) is handled by the parent <th>
 * in the DataTable component.
 */

import type { Column } from '@tanstack/react-table'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

interface DataTableColumnHeaderProps<TData> {
  column: Column<TData>
  label: string
  className?: string
}

export function DataTableColumnHeader<TData>({
  column,
  label,
  className = '',
}: Readonly<DataTableColumnHeaderProps<TData>>) {
  if (!column.getCanSort()) {
    return <span className={className}>{label}</span>
  }

  const direction = column.getIsSorted()

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {label}
      {direction === 'asc' && <ChevronUpIcon className="h-4 w-4" aria-hidden="true" />}
      {direction === 'desc' && <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />}
    </span>
  )
}
