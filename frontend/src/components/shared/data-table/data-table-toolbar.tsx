/**
 * Selection toolbar for DataTable.
 *
 * Renders above the table when rows are selected, showing
 * the selection count and custom bulk action buttons.
 */

import type { ReactNode } from 'react'

interface DataTableToolbarProps {
  selectedCount: number
  children: ReactNode
}

export function DataTableToolbar({
  selectedCount,
  children,
}: Readonly<DataTableToolbarProps>) {
  if (selectedCount === 0) return null

  return (
    <div
      data-testid="data-table-toolbar"
      className="flex items-center gap-2 p-2 bg-muted rounded-md mb-2"
    >
      <span className="text-sm text-muted-foreground">
        {selectedCount} selected
      </span>
      {children}
    </div>
  )
}
