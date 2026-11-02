/**
 * Landing-list row actions: a chevron that opens the drill plus a kebab menu
 * (Download .zip, Delete artifacts). The destructive delete is gated behind the
 * shared type-to-confirm dialog; an in-progress execution's delete is disabled.
 */

import { useState } from 'react'
import { ChevronRight, Download, MoreVertical, Trash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/dropdown'
import { Icon } from '@/components/ui/icon'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

const IN_PROGRESS_STATUSES = new Set(['running', 'paused'])
const CONFIRM_PHRASE = 'delete'

export interface ArtifactsRowActionsProps {
  execution: ExecutionArtifactSummary
  onOpen: (execution: ExecutionArtifactSummary) => void
  onDownloadZip: (execution: ExecutionArtifactSummary) => void
  onDelete: (execution: ExecutionArtifactSummary) => void
}

export function ArtifactsRowActions({
  execution,
  onOpen,
  onDownloadZip,
  onDelete,
}: Readonly<ArtifactsRowActionsProps>) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const inProgress = IN_PROGRESS_STATUSES.has(execution.status as string)

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Open ${execution.name}`}
        onClick={() => onOpen(execution)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Dropdown placement="bottom-end">
        <DropdownTrigger
          aria-label="More actions"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-primary"
        >
          <Icon icon={MoreVertical} size="sm" />
        </DropdownTrigger>
        <DropdownMenu>
          <DropdownItem
            onSelect={() => onDownloadZip(execution)}
            data-testid="artifact-row-download"
          >
            <Icon icon={Download} size="sm" className="mr-2" />
            Download .zip
          </DropdownItem>
          <DropdownItem
            disabled={inProgress}
            onSelect={() => setConfirmOpen(true)}
            data-testid="artifact-row-delete"
            className={`text-error ${inProgress ? 'opacity-50' : ''}`}
          >
            <Icon icon={Trash} size="sm" className="mr-2" />
            Delete artifacts
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
      <ConfirmationDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => onDelete(execution)}
        variant="delete"
        requireConfirmation={CONFIRM_PHRASE}
        title={`Delete artifacts of ${execution.name}?`}
        description="This soft-deletes every artifact of this execution. Removed artifacts stay as an audit record and cannot be restored."
        confirmLabel="Delete artifacts"
      />
    </div>
  )
}
