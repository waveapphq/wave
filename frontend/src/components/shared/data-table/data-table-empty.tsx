/**
 * Empty state for DataTable.
 *
 * Rendered inside the table body when there is no data and loading is false.
 */

import type { ReactNode } from 'react'

interface DataTableEmptyProps {
  colSpan: number
  icon?: ReactNode
  message?: string
  action?: ReactNode
}

export function DataTableEmpty({
  colSpan,
  icon,
  message = 'No data to display',
  action,
}: Readonly<DataTableEmptyProps>) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center">
        <div className="flex flex-col items-center gap-3">
          {icon && <div className="text-muted-foreground/40">{icon}</div>}
          <span className="text-muted">{message}</span>
          {action}
        </div>
      </td>
    </tr>
  )
}
