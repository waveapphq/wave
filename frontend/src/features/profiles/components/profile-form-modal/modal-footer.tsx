/**
 * ModalFooter - Footer buttons for create/edit profile modal
 *
 * PROFILE-51: Create: Cancel + Create
 * PROFILE-52: Edit: "Delete Profile" (red, left) + Cancel + Save Changes
 * PROFILE-53: Delete blocked when Usage > 0
 */

import { Loader2, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { SaveBlockedNote } from '@/components/shared/child-editors/save-blocked-note'

export interface ModalFooterProps {
  isEditMode: boolean
  loading: boolean
  canSubmit: boolean
  /** What blocks the submit button, named under it. */
  saveBlockedNote: string | null
  canDelete: boolean
  deleteTitle: string
  onClose: () => void
  onDelete: () => void
}

export function ModalFooter({
  isEditMode,
  loading,
  canSubmit,
  saveBlockedNote,
  canDelete,
  deleteTitle,
  onClose,
  onDelete,
}: Readonly<ModalFooterProps>) {
  return (
    <div data-testid="modal-footer" className="flex flex-wrap items-center justify-between gap-y-2 pt-4 border-t">
      {isEditMode && (
        <ConditionalTooltip content={deleteTitle} disabled={!canDelete} wide>
          <span className="inline-flex">
            <Button
              type="button"
              variant="ghost"
              onClick={onDelete}
              disabled={!canDelete || loading}
              className="hover:bg-error/10"
              style={{ color: 'var(--color-error-text)' }}
            >
              <Trash2 className="h-4 w-4" />
              Delete Profile
            </Button>
          </span>
        </ConditionalTooltip>
      )}

      <div className={cn('flex items-center gap-2', !isEditMode && 'ml-auto')}>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit}
          className="relative"
        >
          {loading && (
            <span data-testid="submit-loading" className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          )}
          <span className={loading ? 'invisible' : ''}>
            {isEditMode ? 'Save Changes' : 'Create'}
          </span>
        </Button>
      </div>
      <SaveBlockedNote note={saveBlockedNote} className="basis-full text-right" />
    </div>
  )
}
