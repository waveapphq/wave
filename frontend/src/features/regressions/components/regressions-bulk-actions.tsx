/**
 * RegressionsBulkActions Component
 *
 * Bulk action dropdown for selected regressions.
 * Same pattern as SuitesBulkActions.
 */

import { BulkActionsDropdown, BulkActionMenuItems } from '@/components/shared/actions/bulk-actions-dropdown'

export interface RegressionsBulkActionsProps {
  selectedCount: number
  totalCount: number
  selectionModeActive: boolean
  onRun: () => void
  onExport: () => void
  onDuplicate: () => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
}

export function RegressionsBulkActions({
  selectedCount,
  totalCount,
  selectionModeActive,
  onRun,
  onExport,
  onDuplicate,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
}: Readonly<RegressionsBulkActionsProps>) {
  const isDisabled = selectedCount === 0
  const isAllSelected = selectedCount === totalCount && totalCount > 0

  const selectionLabel = isAllSelected
    ? `All ${selectedCount} selected`
    : `${selectedCount} selected`

  return (
    <BulkActionsDropdown
      selectedCount={selectedCount}
      selectionModeActive={selectionModeActive}
      selectionLabel={selectionLabel}
      onEnterSelectionMode={onEnterSelectionMode}
      onExitSelectionMode={onExitSelectionMode}
    >
      <BulkActionMenuItems
        isDisabled={isDisabled}
        onRun={onRun}
        onExport={onExport}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </BulkActionsDropdown>
  )
}
