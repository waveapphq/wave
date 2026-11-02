/**
 * FunctionsBulkActions - bulk action bar for selected Functions.
 *
 * Functions have only two bulk operations (Export, Delete), so they render as
 * direct buttons rather than the multi-item dropdown the larger entity pages
 * use. "Mass Action" enters selection mode; the X exits it.
 */

import { Button } from '@/components/ui/button'
import { Icon, TrashIcon } from '@/components/ui/icon'
import { Download, X } from 'lucide-react'

export interface FunctionsBulkActionsProps {
  selectedCount: number
  totalCount: number
  selectionModeActive: boolean
  onExport: () => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
}

export function FunctionsBulkActions({
  selectedCount,
  totalCount,
  selectionModeActive,
  onExport,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
}: Readonly<FunctionsBulkActionsProps>) {
  if (!selectionModeActive) {
    return (
      <button
        type="button"
        onClick={onEnterSelectionMode}
        aria-label="Mass Action - click to enter selection mode"
        className="flex h-9 w-[118px] items-center justify-center rounded-md border border-input bg-transparent px-3 text-sm shadow-sm hover:bg-subtle"
      >
        Mass Action
      </button>
    )
  }

  const isDisabled = selectedCount === 0
  // The bar only renders when the table has rows, so totalCount is always > 0.
  const isAllSelected = selectedCount === totalCount
  const label = isAllSelected ? `All ${selectedCount} selected` : `${selectedCount} selected`

  return (
    <div className="flex items-center gap-1">
      <span
        data-testid="selection-counter"
        aria-live="polite"
        className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-sm shadow-sm whitespace-nowrap"
      >
        {label}
      </span>
      <Button
        variant="outline"
        size="sm"
        data-testid="bulk-export"
        disabled={isDisabled}
        onClick={onExport}
        className="h-9"
      >
        <Icon icon={Download} size="sm" className="mr-2" />
        Export
      </Button>
      <Button
        variant="outline"
        size="sm"
        data-testid="bulk-delete"
        disabled={isDisabled}
        onClick={onDelete}
        className="h-9 text-error"
      >
        <Icon icon={TrashIcon} size="sm" className="mr-2" />
        Delete
      </Button>
      <button
        type="button"
        onClick={onExitSelectionMode}
        aria-label="Exit selection mode"
        data-testid="selection-close"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-transparent text-muted shadow-sm hover:bg-subtle hover:text-primary"
      >
        <Icon icon={X} size="sm" />
      </button>
    </div>
  )
}
