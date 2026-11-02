/**
 * BulkActionsDropdown - Shared shell for bulk action dropdowns.
 *
 * Handles the common UI pattern across entity list pages:
 * - "Mass Action" button when not in selection mode
 * - "N selected" dropdown trigger with chevron when in selection mode
 * - Exit selection mode (X) button
 * - Dropdown menu shell that accepts children for entity-specific menu items
 *
 * BulkActionMenuItems - Shared menu items for Run/Export/Duplicate/Delete.
 *
 * Used by: EnvironmentsBulkActions, ProfilesBulkActions, SuitesBulkActions, TestsBulkActions
 */

import { type ReactNode } from 'react'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
} from '@/components/ui/dropdown'
import { Icon, ChevronDownIcon } from '@/components/ui/icon'
import { Play, Download, Copy, Trash, X } from 'lucide-react'

export interface BulkActionsDropdownProps {
  /** Number of currently selected items */
  selectedCount: number
  /** Whether selection mode is active */
  selectionModeActive: boolean
  /** Custom label for the selection trigger (overrides default "N selected") */
  selectionLabel?: string
  /** Called when user clicks "Mass Action" to enter selection mode */
  onEnterSelectionMode: () => void
  /** Called when user clicks the X button to exit selection mode */
  onExitSelectionMode: () => void
  /** Menu items to render inside the dropdown (entity-specific) */
  children: ReactNode
  /** Additional content rendered after the X button (e.g., confirmation dialogs) */
  extraContent?: ReactNode
  /** Disables the Mass Action button and the selection trigger */
  disabled?: boolean
}

export function BulkActionsDropdown({
  selectedCount,
  selectionModeActive,
  selectionLabel,
  onEnterSelectionMode,
  onExitSelectionMode,
  children,
  extraContent,
  disabled = false,
}: Readonly<BulkActionsDropdownProps>) {
  const resolvedLabel = selectionLabel ?? `${selectedCount} selected`

  if (!selectionModeActive) {
    return (
      <button
        type="button"
        onClick={onEnterSelectionMode}
        disabled={disabled}
        aria-label="Mass Action - click to enter selection mode"
        className="flex h-9 w-[118px] items-center justify-center rounded-md border border-input bg-transparent px-3 text-sm shadow-sm enabled:hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
      >
        Mass Action
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <div data-testid="bulk-actions-dropdown">
        <Dropdown placement="bottom-end">
          <DropdownTrigger
            aria-label={resolvedLabel}
            aria-live="polite"
            data-testid="selection-counter"
            disabled={disabled}
            className="flex h-9 min-w-[118px] items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm enabled:hover:bg-subtle whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolvedLabel}
            <Icon icon={ChevronDownIcon} size="sm" className="opacity-50" />
          </DropdownTrigger>
          <DropdownMenu data-testid="bulk-actions-menu" className="w-[190px]">
            {children}
          </DropdownMenu>
        </Dropdown>
      </div>
      <button
        type="button"
        onClick={onExitSelectionMode}
        aria-label="Exit selection mode"
        data-testid="selection-close"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-transparent text-muted shadow-sm hover:bg-subtle hover:text-primary"
      >
        <Icon icon={X} size="sm" />
      </button>
      {extraContent}
    </div>
  )
}

// ===========================================================================
// BulkActionMenuItems - Common Run/Export/Duplicate/Delete menu items
// ===========================================================================

export interface BulkActionMenuItemsProps {
  /** Whether all actions are disabled (0 selected) */
  isDisabled: boolean
  /** Called when Run is selected (omit to hide the Run item) */
  onRun?: () => void
  /** Called when Export is selected (omit to hide the Export item) */
  onExport?: () => void
  /** Called when Duplicate is selected (omit to hide the Duplicate item) */
  onDuplicate?: () => void
  /** Called when Delete is selected */
  onDelete: () => void
  /** Additional items rendered between Duplicate and the Delete separator */
  extraItems?: ReactNode
}

export function BulkActionMenuItems({
  isDisabled,
  onRun,
  onExport,
  onDuplicate,
  onDelete,
  extraItems,
}: Readonly<BulkActionMenuItemsProps>) {
  const disabledClass = isDisabled ? 'text-muted' : ''
  const itemsPrecedeDelete = Boolean(onRun || onExport || onDuplicate || extraItems)

  return (
    <>
      {onRun && (
        <DropdownItem
          disabled={isDisabled}
          onSelect={() => { if (!isDisabled) onRun?.() }}
          data-testid="bulk-action-run"
          className={disabledClass}
        >
          <Icon icon={Play} size="sm" className="mr-2" />
          Run
        </DropdownItem>
      )}
      {onExport && (
        <DropdownItem
          disabled={isDisabled}
          onSelect={() => { if (!isDisabled) onExport() }}
          data-testid="bulk-action-export"
          className={disabledClass}
        >
          <Icon icon={Download} size="sm" className="mr-2" />
          Export
        </DropdownItem>
      )}
      {onDuplicate && (
        <DropdownItem
          disabled={isDisabled}
          onSelect={() => { if (!isDisabled) onDuplicate() }}
          data-testid="bulk-action-duplicate"
          className={disabledClass}
        >
          <Icon icon={Copy} size="sm" className="mr-2" />
          Duplicate
        </DropdownItem>
      )}
      {extraItems}
      {itemsPrecedeDelete && <DropdownDivider data-testid="bulk-actions-separator" />}
      <DropdownItem
        disabled={isDisabled}
        onSelect={() => { if (!isDisabled) onDelete() }}
        data-testid="bulk-action-delete"
        className={`text-error ${isDisabled ? 'opacity-50' : ''}`}
      >
        <Icon icon={Trash} size="sm" className="mr-2" />
        Delete
      </DropdownItem>
    </>
  )
}
