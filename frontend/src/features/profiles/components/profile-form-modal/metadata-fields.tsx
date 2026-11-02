/**
 * MetadataFields - Name, description, and tags form fields
 *
 * PROFILE-28: Compact metadata: Name + Description side-by-side, Tags inline
 */

import * as React from 'react'
import { TagsInput } from '@/components/ui/tags-input'
import { NameField } from '@/components/shared/fields/name-field'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'
import { RequiredMark } from '@/components/shared/fields/required-mark'

export interface MetadataFieldsProps {
  nameInputRef: React.RefObject<HTMLTextAreaElement | null>
  name: string
  description: string
  tags: string[]
  allTags: string[]
  errors: Record<string, string>
  loading: boolean
  onFieldChange: (field: string, value: unknown) => void
  /** Called when the Name field loses focus. */
  onNameBlur?: () => void
  /** Called when the Name field takes focus or is clicked. */
  onNameVisit?: () => void
}

export function MetadataFields({
  nameInputRef,
  name,
  description,
  tags,
  allTags,
  errors,
  loading,
  onFieldChange,
  onNameBlur,
  onNameVisit,
}: Readonly<MetadataFieldsProps>) {
  const nameErrorId = React.useId()
  return (
    <>
      {/* Name field (full-width, stacked) */}
      <div data-field="name" className="min-w-0">
        <label htmlFor="name" className="block text-sm font-medium mb-1">
          Name <RequiredMark />
        </label>
        <NameField
          ref={nameInputRef}
          id="name"
          name="name"
          value={name}
          onChange={(value) => onFieldChange('name', value)}
          onBlur={onNameBlur}
          onFocus={onNameVisit}
          onClick={onNameVisit}
          placeholder="Enter profile name…"
          disabled={loading}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? nameErrorId : undefined}
          aria-required
          maxLength={MAX_ENTITY_NAME_LENGTH}
        />
        {errors.name && (
          <p id={nameErrorId} className="mt-1 text-sm text-destructive" role="alert">
            {errors.name}
          </p>
        )}
      </div>

      {/* Description field (full-width, under Name) */}
      <div data-field="description" className="min-w-0">
        <label htmlFor="description" className="block text-sm font-medium mb-1">
          Description
        </label>
        <DescriptionField
          id="description"
          name="description"
          value={description}
          onChange={(value) => onFieldChange('description', value)}
          placeholder="What does this profile contain?"
          disabled={loading}
        />
      </div>

      {/* Tags Input */}
      <div data-field="tags" className="pb-4 border-b border-border">
        <label htmlFor="profile-tags" className="block text-sm font-medium mb-1">Tags</label>
        <TagsInput
          triggerId="profile-tags"
          value={tags}
          availableTags={allTags}
          onChange={(newTags) => onFieldChange('tags', newTags)}
          placeholder="Add tags…"
          disabled={loading}
        />
      </div>
    </>
  )
}
