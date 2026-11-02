import type { ReactNode } from 'react'
import { TagsInput } from '@/components/ui/tags-input'
import { EditDialog } from '@/components/ui/edit-dialog'
import { NameField } from '@/components/shared/fields/name-field'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'

export function EditDetailsDialog({
  open,
  onOpenChange,
  title,
  description,
  isDirty,
  onSave,
  onDiscard,
  editName,
  onEditNameChange,
  editDescription,
  onEditDescriptionChange,
  editTags,
  allTags,
  onEditTagsChange,
}: Readonly<{
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  isDirty: boolean
  onSave: () => Promise<void>
  onDiscard: () => void
  editName: string
  onEditNameChange: (value: string) => void
  editDescription: string
  onEditDescriptionChange: (value: string) => void
  editTags: string[]
  allTags: string[]
  onEditTagsChange: (tags: string[]) => void
}>): ReactNode {
  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      isDirty={isDirty}
      onSave={onSave}
      onDiscard={onDiscard}
      saveDisabled={!editName.trim()}
      className="sm:max-w-md"
      data-testid="edit-details-dialog"
    >
      <div className="space-y-4">
        <div className="min-w-0">
          <label htmlFor="edit-name" className="text-sm font-medium mb-1.5 block">
            Name
          </label>
          <NameField
            id="edit-name"
            data-testid="edit-details-name"
            value={editName}
            onChange={onEditNameChange}
            maxLength={MAX_ENTITY_NAME_LENGTH}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="edit-description" className="text-sm font-medium mb-1.5 block">
            Description
          </label>
          <DescriptionField
            id="edit-description"
            data-testid="edit-details-description"
            value={editDescription}
            onChange={onEditDescriptionChange}
            placeholder="Add a description…"
          />
        </div>
        <div>
          <label htmlFor="edit-tags" className="text-sm font-medium mb-1.5 block">Tags</label>
          <TagsInput
            triggerId="edit-tags"
            data-testid="edit-details-tags"
            value={editTags}
            availableTags={allTags}
            onChange={onEditTagsChange}
            placeholder="Add tags…"
          />
        </div>
      </div>
    </EditDialog>
  )
}
