/**
 * TestFormDialog Component
 *
 * Unified dialog for creating, editing, and editing metadata of tests.
 * Consolidates SaveTestDialog and EditTestMetadataDialog into a single
 * component using Shadcn Dialog (Radix-based).
 *
 * Modes:
 * - create: New test creation with workflow data
 * - edit: Edit existing test (name, description, tags, workflow)
 * - edit-metadata: Edit metadata only (name, description, tags) - fetches test details on open
 *
 * Built on Radix Dialog which provides:
 * - Portal rendering (no manual createPortal)
 * - Focus trapping (no manual Tab/Shift+Tab handling)
 * - Scroll lock (no manual body overflow manipulation)
 * - ESC to dismiss (handled by onOpenChange)
 */

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TagsInput } from '@/components/ui/tags-input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { NameField } from '@/components/shared/fields/name-field'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { MAX_TEST_NAME_LENGTH } from '@/lib/field-constraints'
import type { TestFormDialogProps } from './types'
import { useTestForm } from './use-test-form'
import { RequiredMark } from '@/components/shared/fields/required-mark'

export function TestFormDialog(props: Readonly<TestFormDialogProps>): ReactNode {
  const { isOpen, onClose, mode } = props
  const {
    name,
    description,
    tags,
    availableTags,
    nameError,
    apiError,
    isSaving,
    testDetailsLoading,
    isEditMetadata,
    title,
    submitLabel,
    nameInputRef,
    nameErrorId,
    handleOpenChange,
    handleNameChange,
    handleDescriptionChange,
    handleTagsChange,
    handleSubmit,
    reportSaveFailure,
  } = useTestForm(props)

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'create'
              ? 'Create a new test with name, description, and tags'
              : 'Edit test name, description, and tags'}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="space-y-4">
          {/* Name field */}
          <div className="min-w-0">
            <label htmlFor="test-name" className="block text-sm font-medium mb-1.5">
              Test Name <RequiredMark />
            </label>
            <NameField
              ref={nameInputRef}
              id="test-name"
              value={name}
              onChange={handleNameChange}
              disabled={isSaving}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? nameErrorId : undefined}
              placeholder="Enter test name…"
              maxLength={MAX_TEST_NAME_LENGTH}
            />
            {nameError && (
              <p id={nameErrorId} role="alert" className="mt-1 text-sm text-destructive">
                {nameError}
              </p>
            )}
          </div>

          {/* Description field */}
          <div>
            <label htmlFor="test-description" className="block text-sm font-medium mb-1.5">
              Description
            </label>
            {isEditMetadata && testDetailsLoading ? (
              <Skeleton data-testid="description-skeleton" className="h-20 w-full" />
            ) : (
              <DescriptionField
                id="test-description"
                value={description}
                onChange={handleDescriptionChange}
                disabled={isSaving}
                placeholder="Enter description (optional)…"
              />
            )}
          </div>

          {/* Tags field */}
          <div>
            <label htmlFor="test-tags-input" className="block text-sm font-medium mb-1.5">Tags</label>
            {isEditMetadata && testDetailsLoading ? (
              <Skeleton data-testid="tags-skeleton" className="h-10 w-full" />
            ) : (
              <TagsInput
                triggerId="test-tags-input"
                data-testid="tags-input"
                value={tags}
                availableTags={availableTags}
                onChange={handleTagsChange}
                placeholder="Add tags…"
                disabled={isSaving}
              />
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          {/* API Error */}
          {apiError && (
            <p data-testid="api-error" role="alert" className="text-sm text-destructive mr-4 flex-1">
              {apiError}
            </p>
          )}
          {!apiError && <div className="flex-1" />}

          {/* Buttons */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => { handleSubmit().catch(reportSaveFailure) }}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 data-testid="save-spinner" className="mr-2 h-4 w-4 animate-spin" />
                  {submitLabel}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
