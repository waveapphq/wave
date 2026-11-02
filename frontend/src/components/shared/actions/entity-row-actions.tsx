/**
 * EntityRowActions Component
 *
 * Shared row-level actions for entity tables (regressions, suites, etc.).
 * - Run button (primary action, always visible, optional)
 * - Overflow menu with: Edit, Duplicate, optional children, separator, Delete
 * - Supports entity-specific extra menu items via children prop
 */

/* v8 ignore next 2 - COV-V8-001 */
import { type ReactNode } from 'react'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
} from '@/components/ui/dropdown'
import { Button } from '@/components/ui/button'
import { Icon, PlayIcon, EditIcon, CopyIcon, TrashIcon } from '@/components/ui/icon'
import { MoreHorizontal } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface EntityRowActionsProps {
  entityId: string
  entityName: string
  onEdit: (entityId: string) => void
  onDelete: (entityId: string) => void
  onDuplicate: (entityId: string) => void
  onRun?: (entityId: string) => void
  runDisabled?: boolean
  runDisabledReason?: string
  children?: ReactNode
}

export function EntityRowActions({
  entityId,
  entityName,
  onRun,
  onEdit,
  onDelete,
  onDuplicate,
  runDisabled = false,
  runDisabledReason,
  children,
}: Readonly<EntityRowActionsProps>) {
  const handleRun = () => {
    onRun?.(entityId)
  }

  const handleEdit = () => {
    onEdit(entityId)
  }

  const handleDuplicate = () => {
    onDuplicate(entityId)
  }

  const handleDelete = () => {
    onDelete(entityId)
  }

  return (
    <div data-testid="row-actions" className="flex items-center gap-1">
      {onRun && (
        <ConditionalTooltip content={runDisabled ? runDisabledReason : undefined} disabled wide>
          <span className="inline-flex">
            <Button
              size="sm"
              data-testid="row-action-run"
              aria-label={`Run ${entityName}`}
              onClick={handleRun}
              disabled={runDisabled}
              className="h-8 w-8 p-0 transition-[transform,box-shadow] duration-200 hover:scale-110 hover:shadow-md"
            >
              <Icon icon={PlayIcon} size="sm" />
            </Button>
          </span>
        </ConditionalTooltip>
      )}
      <Dropdown placement="bottom-end">
        <DropdownTrigger
          data-testid="row-actions-menu"
          aria-label={`More actions for ${entityName}`}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-subtle transition-[transform,background-color] duration-200 hover:scale-110"
        >
          <Icon icon={MoreHorizontal} size="sm" />
        </DropdownTrigger>
        <DropdownMenu>
          <DropdownItem onSelect={handleEdit}>
            <Icon icon={EditIcon} size="sm" className="mr-2" />
            Edit
          </DropdownItem>
          <DropdownItem onSelect={handleDuplicate}>
            <Icon icon={CopyIcon} size="sm" className="mr-2" />
            Duplicate
          </DropdownItem>
          {children}
          <DropdownDivider />
          <DropdownItem onSelect={handleDelete} className="text-error">
            <Icon icon={TrashIcon} size="sm" className="mr-2" />
            Delete
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    </div>
  )
}
