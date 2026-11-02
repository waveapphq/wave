/**
 * ProfilesRowActions Component
 *
 * REQ-4.7.4: Profile management UI
 *
 * Row actions for profiles table:
 * - Edit button (pencil icon) as primary action
 * - Kebab menu with Duplicate and Delete options
 * - Delete disabled when profile is in use (usage > 0)
 * - No Run action (profiles are configuration, not executable)
 */

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Copy, Download, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface ProfilesRowActionsProps {
  profile: {
    id: string
    name: string
    type: string
    usage: number
  }
  onEdit: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onExport?: (id: string) => void
  loading?: boolean
}

export function ProfilesRowActions({
  profile,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  loading = false,
}: Readonly<ProfilesRowActionsProps>) {
  const canDelete = profile.usage === 0
  const usageLabel = profile.usage === 1 ? '1 test' : `${profile.usage} tests`
  const deleteTitle = canDelete
    ? 'Delete profile'
    : `Cannot delete: in use by ${usageLabel}`

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(profile.id)
  }

  const handleDuplicate = () => {
    onDuplicate(profile.id)
  }

  const handleDelete = () => {
    if (canDelete) {
      onDelete(profile.id)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        data-testid="action-edit"
        aria-label="Edit profile"
        disabled={loading}
        onClick={handleEdit}
      >
        <Pencil className="h-4 w-4" data-lucide="pencil" />
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="action-menu-trigger"
            aria-label="More actions"
            aria-haspopup="menu"
            disabled={loading}
          >
            <MoreVertical className="h-4 w-4" data-lucide="more-vertical" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onExport && (
            <DropdownMenuItem onClick={() => onExport(profile.id)}>
              <Download className="mr-2 h-4 w-4" data-lucide="download" />
              Export
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="mr-2 h-4 w-4" data-lucide="copy" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleDelete}
            disabled={!canDelete}
            // A disabled menu item swallows pointer events, so the reason it is
            // disabled could never be read; keep it hoverable, still dimmed.
            className={`text-error ${canDelete ? '' : 'opacity-50 data-[disabled]:pointer-events-auto'}`}
          >
            <ConditionalTooltip content={deleteTitle} disabled wide>
              <span className="inline-flex items-center">
                <Trash2 className="mr-2 h-4 w-4" data-lucide="trash-2" />
                Delete
              </span>
            </ConditionalTooltip>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
