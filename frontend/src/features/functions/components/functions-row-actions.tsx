/**
 * FunctionsRowActions - row-level actions for the Functions table.
 *
 * View (primary, always visible) + an overflow menu with Export and Delete.
 * Functions have no Run / Duplicate (they are invoked from a Test, not run
 * standalone, and are not duplicated from the library).
 */

import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
} from '@/components/ui/dropdown'
import { Button } from '@/components/ui/button'
import { Icon, TrashIcon } from '@/components/ui/icon'
import { MoreHorizontal, Eye, Download } from 'lucide-react'

export interface FunctionsRowActionsProps {
  functionId: string
  functionName: string
  onView: (functionId: string) => void
  onExport: (functionId: string) => void
  onDelete: (functionId: string) => void
}

export function FunctionsRowActions({
  functionId,
  functionName,
  onView,
  onExport,
  onDelete,
}: Readonly<FunctionsRowActionsProps>) {
  return (
    <div data-testid="row-actions" className="flex items-center gap-1">
      <Button
        size="sm"
        data-testid="action-view"
        aria-label={`View ${functionName}`}
        onClick={() => onView(functionId)}
        className="h-8 w-8 p-0 transition-[transform,box-shadow] duration-200 hover:scale-110 hover:shadow-md"
      >
        <Icon icon={Eye} size="sm" />
      </Button>
      <Dropdown placement="bottom-end">
        <DropdownTrigger
          data-testid="action-menu-trigger"
          aria-label={`More actions for ${functionName}`}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle transition-[transform,background-color] duration-200 hover:scale-110"
        >
          <Icon icon={MoreHorizontal} size="sm" />
        </DropdownTrigger>
        <DropdownMenu className="min-w-[160px]">
          <DropdownItem onSelect={() => onExport(functionId)} data-testid="action-export">
            <Icon icon={Download} size="sm" className="mr-2" />
            Export
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem
            onSelect={() => onDelete(functionId)}
            data-testid="action-delete"
            className="text-error"
          >
            <Icon icon={TrashIcon} size="sm" className="mr-2" />
            Delete
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    </div>
  )
}
