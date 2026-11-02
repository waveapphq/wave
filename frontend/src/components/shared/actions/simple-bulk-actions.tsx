/**
 * SimpleBulkActions - Shared bulk action dropdown for entities with optional
 * Export and Duplicate plus Delete (no Run or Move to Suite).
 *
 * Used by: EnvironmentsBulkActions, ProfilesBulkActions and the Delete-only Network tables
 */

import { BulkActionsDropdown, BulkActionMenuItems } from '@/components/shared/actions/bulk-actions-dropdown'

export interface SimpleBulkActionsProps {
  selectedCount: number
  /** Total entity count. Not used by this component but accepted for consumer convenience. */
  totalCount?: number
  selectionModeActive: boolean
  /** Omit to hide the Export item */
  onExport?: () => void
  /** Omit to hide the Duplicate item */
  onDuplicate?: () => void
  onDelete: () => void
  onEnterSelectionMode: () => void
  onExitSelectionMode: () => void
  /** Disables the Mass Action button and the selection trigger */
  disabled?: boolean
}

export function SimpleBulkActions({
  selectedCount,
  selectionModeActive,
  onExport,
  onDuplicate,
  onDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  disabled,
}: Readonly<SimpleBulkActionsProps>) {
  return (
    <BulkActionsDropdown
      selectedCount={selectedCount}
      selectionModeActive={selectionModeActive}
      onEnterSelectionMode={onEnterSelectionMode}
      onExitSelectionMode={onExitSelectionMode}
      disabled={disabled}
    >
      <BulkActionMenuItems
        isDisabled={selectedCount === 0}
        onExport={onExport}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </BulkActionsDropdown>
  )
}
