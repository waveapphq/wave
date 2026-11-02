/**
 * EnvironmentRowActions Component
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environment row actions
 *
 * Row actions for environment table:
 * - SETTINGS-11: Actions: Edit (pencil) + kebab (Duplicate, Delete)
 *
 * Delete is always enabled. When the environment is in use, the caller is
 * responsible for surfacing a type-to-confirm dialog (cascade-removes
 * per-environment values from referencing profiles).
 */

import { Pencil, MoreVertical, Copy, Trash2, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ============================================================================
// Types
// ============================================================================

export interface EnvironmentRowActionsProps {
  environmentId: string
  environmentName: string
  usage: number
  onEdit: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onExport?: (id: string) => void
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function EnvironmentRowActions({
  environmentId,
  environmentName,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  className,
}: Readonly<EnvironmentRowActionsProps>) {
  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(environmentId)
  }

  const handleDuplicateClick = () => {
    onDuplicate(environmentId)
  }

  const handleDeleteClick = () => {
    onDelete(environmentId)
  }

  return (
    <div
      data-testid="environment-row-actions"
      className={cn('flex items-center gap-1', className)}
    >
      <Button
        variant="ghost"
        size="icon"
        data-testid="action-edit"
        type="button"
        aria-label={`Edit ${environmentName}`}
        onClick={handleEditClick}
        className="h-8 w-8"
      >
        <Pencil className="h-4 w-4" data-testid="icon-pencil" />
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            data-testid="action-menu-trigger"
            type="button"
            aria-haspopup="menu"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreVertical className="h-4 w-4" data-testid="icon-more-vertical" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="action-menu-content">
          {onExport && (
            <DropdownMenuItem onClick={() => onExport(environmentId)}>
              <Download className="mr-2 h-4 w-4" data-testid="icon-download" />
              Export
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleDuplicateClick}>
            <Copy className="mr-2 h-4 w-4" data-testid="icon-copy" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeleteClick} className="text-error">
            <Trash2 className="mr-2 h-4 w-4" data-testid="icon-trash" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
