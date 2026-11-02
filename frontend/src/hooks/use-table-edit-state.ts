import { useState } from 'react'
import type { OnChangeFn, RowSelectionState, SortingState } from '@tanstack/react-table'

/**
 * Pair of TanStack-compatible state slots used by detail pages that switch
 * between a view-mode DataTable and an edit-mode DataTable.
 *
 * ``sorting`` drives the view-mode table. ``editRowSelection`` drives
 * bulk-exclude in edit mode. The `on*Change` handlers are simply the React
 * setters - TanStack's ``OnChangeFn<T>`` is structurally compatible with
 * ``Dispatch<SetStateAction<T>>`` so no wrapping is required.
 */
export function useTableEditState() {
  const [sorting, setSorting] = useState<SortingState>([])
  const [editRowSelection, setEditRowSelection] = useState<RowSelectionState>({})

  const onSortingChange: OnChangeFn<SortingState> = setSorting
  const onEditRowSelectionChange: OnChangeFn<RowSelectionState> = setEditRowSelection

  return {
    sorting,
    onSortingChange,
    editRowSelection,
    setEditRowSelection,
    onEditRowSelectionChange,
  }
}
