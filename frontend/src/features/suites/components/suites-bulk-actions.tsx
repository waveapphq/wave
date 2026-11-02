/**
 * SuitesBulkActions Component
 *
 * Bulk action dropdown for selected suites.
 * - BULK-1: Selection button 118px, dropdown 155px
 * - BULK-3: Actions grouped with separator before Delete (red)
 * - BULK-4: 0 selected = disabled items, menu still opens
 * - NO Move to Suite (suites have no parent entity)
 */

import { BulkActionsDropdown, BulkActionMenuItems } from '@/components/shared/actions/bulk-actions-dropdown'

export interface SuitesBulkActionsProps {
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

export function SuitesBulkActions({
  selectedCount,
  totalCount,
  selectionModeActive,
  onRun,
  onExport,
  onDuplicate,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
}: Readonly<SuitesBulkActionsProps>) {
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
