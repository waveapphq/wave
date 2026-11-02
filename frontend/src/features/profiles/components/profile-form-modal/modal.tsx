/**
 * ProfileFormModal Component
 *
 * REQ-4.7.4: Profile management UI - Create/Edit modal
 * REQ-4.7.10: Environment-specific configurations
 *
 * V-PROF-02: Create/edit modal with type-specific config
 *
 * Design decisions:
 * - PROFILE-28: Compact metadata: Name + Description side-by-side, Tags inline
 * - PROFILE-29: Width ~460px (expanded for table)
 * - PROFILE-30: Title "Create/Edit Profile" + x
 * - PROFILE-31: "Environment:" + scrollable dropdown
 * - PROFILE-32: "Copy Values" button
 * - PROFILE-33: "PARAMETERS" label
 * - PROFILE-34: "+ Add" blue, right-aligned
 * - PROFILE-35: Columns: Name | Type | Lock | Value | Actions
 * - PROFILE-36: Name: text input
 * - PROFILE-37: Type: WAVE types dropdown
 * - PROFILE-38: Secret: checkbox
 * - PROFILE-39: Value: per-environment
 * - PROFILE-40: Secret: masked (dots), eye reveal
 * - PROFILE-41: Delete (-) per row
 * - PROFILE-42: Empty: "No parameters yet. Click + Add to create one."
 * - PROFILE-51: Create: Cancel + Create
 * - PROFILE-52: Edit: "Delete Profile" (red, left) + Cancel + Save Changes
 * - PROFILE-53: Delete blocked when Usage > 0
 */

import { useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SheetLayer } from '@/components/shared/sheet-layer'
import {
  ChildEditorsProvider,
  useChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { formErrorsNote, saveBlockedNote } from '@/lib/child-editors'

// Re-export types for backward compatibility
export type { WaveType, Parameter, Environment, Profile, ProfileFormData, ProfileTypeSchemaField, ProfileFormModalProps } from './types'
export { WAVE_TYPES } from './types'

import type { ProfileFormModalProps } from './types'
import { useProfileForm } from './use-profile-form'
import { MetadataFields } from './metadata-fields'
import { TypeSelector } from './type-selector'
import { EnvironmentBar } from './environment-bar'
import { ParametersSection } from './parameters-section'
import { ModalFooter } from './modal-footer'
import { CopyValuesModal } from './copy-values-modal'
import { ConvertTypeDialog } from './convert-type-dialog'
import { ChangeTypeDialog } from './change-type-dialog'

// ============================================================================
// Main Component
// ============================================================================

export function ProfileFormModal({
  open,
  mode,
  profile,
  profileTypes,
  environments,
  allTags,
  loading = false,
  error,
  onClose,
  onSubmit,
  onDelete,
  onFetchTypeSchema,
}: Readonly<ProfileFormModalProps>) {
  const form = useProfileForm({
    open,
    mode,
    profile,
    environments,
    onFetchTypeSchema,
    onSubmit,
    onDelete,
    loading,
  })
  const childEditors = useChildEditorScope()
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)

  // Children write through their own save paths first, so the submit must read the form after them.
  const submitRef = useRef(form.handleSubmit)
  submitRef.current = form.handleSubmit

  if (!open) {
    return null
  }

  const hasChanges = form.isDirty || childEditors.hasChanges
  const blockedNote = (action: string) =>
    saveBlockedNote(form.isFormValid ? null : formErrorsNote('settings', action), childEditors.children, action)
  const footerNote = blockedNote(form.isEditMode ? 'Save' : 'Create')

  const submitWithChildren = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    childEditors.applyAll()
    submitRef.current(event)
  }

  const requestClose = () => {
    if (hasChanges) {
      setShowUnsavedDialog(true)
      return
    }
    onClose()
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={(isOpen) => !isOpen && requestClose()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            data-testid="dialog-overlay"
            className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
          <DialogPrimitive.Content
            aria-busy={loading ? 'true' : 'false'}
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain p-4 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            {/* Flex-centered, not transform-centered, so the sheets in this layer stay viewport-relative. */}
            <SheetLayer>
            <ChildEditorsProvider scope={childEditors}>
            {/* my-auto centers while it fits and collapses on overflow, keeping the footer reachable. */}
            <div className="relative my-auto w-full max-w-2xl border bg-background p-6 shadow-lg sm:rounded-lg">
            {/* Header */}
            <div data-testid="modal-header" className="flex items-center justify-between mb-4">
              <DialogPrimitive.Title className="text-lg font-semibold">
                {form.isEditMode ? 'Edit Profile' : 'Create Profile'}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                {form.isEditMode ? 'Edit an existing connection profile' : 'Create a new connection profile'}
              </DialogPrimitive.Description>
              <DialogPrimitive.Close asChild>
                <Button
                  data-testid="modal-close"
                  variant="ghost"
                  size="sm"
                  aria-label="Close"
                  className="h-6 w-6 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            {/* Unsaved changes indicator */}
            {form.isEditMode && form.isDirty && (
              <div data-testid="unsaved-changes-indicator" className="text-sm text-warning mb-4">
                You have unsaved changes
              </div>
            )}

            {/* Error message */}
            {error && (
              <div data-testid="form-error" className="text-error text-sm rounded-md bg-error/10 p-3 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={submitWithChildren} className="space-y-4">
              <MetadataFields
                nameInputRef={form.nameInputRef}
                name={form.formData.name}
                description={form.formData.description}
                tags={form.formData.tags}
                allTags={allTags}
                errors={form.errors}
                loading={loading}
                onFieldChange={form.handleFieldChange}
                onNameBlur={form.handleNameBlur}
                onNameVisit={form.handleNameVisit}
              />

              <TypeSelector
                mode={mode}
                selectedType={form.formData.type}
                profileTypes={profileTypes}
                loading={loading}
                typeSelectOpen={form.typeSelectOpen}
                setTypeSelectOpen={form.setTypeSelectOpen}
                typeSearch={form.typeSearch}
                setTypeSearch={form.setTypeSearch}
                onTypeSelect={form.handleTypeSelect}
              />

              <EnvironmentBar
                environments={environments}
                selectedEnvId={form.selectedEnvId}
                selectedEnv={form.selectedEnv}
                loading={loading}
                parametersCount={form.formData.parameters.length}
                environmentHasValues={form.environmentHasValues}
                hasIncompleteEnvironments={form.hasIncompleteEnvironments}
                envsWithoutValues={form.envsWithoutValues}
                envSelectOpen={form.envSelectOpen}
                setEnvSelectOpen={form.setEnvSelectOpen}
                envSearch={form.envSearch}
                setEnvSearch={form.setEnvSearch}
                onEnvironmentSelect={form.handleEnvironmentSelect}
                onCopyValuesClick={() => form.setCopyModalOpen(true)}
              />

              {(() => {
                const profileUsage = profile?.usage ?? 0
                return (
                  <ParametersSection
                    parameters={form.formData.parameters}
                    selectedEnvId={form.selectedEnvId}
                    valueErrors={form.valueErrors}
                    plainTextNames={form.plainTextNames}
                    loading={loading}
                    structureLocked={form.isEditMode && profileUsage > 0}
                    usage={profileUsage}
                    onAddParameter={form.handleAddParameter}
                    onUpdateParameter={form.handleUpdateParameter}
                    onUpdateParameterValue={form.handleUpdateParameterValue}
                    onDeleteParameter={form.handleDeleteParameter}
                  />
                )
              })()}

              <ModalFooter
                isEditMode={form.isEditMode}
                loading={loading}
                canSubmit={form.canSubmit && hasChanges && footerNote === null}
                saveBlockedNote={footerNote}
                canDelete={form.canDelete}
                deleteTitle={form.deleteTitle}
                onClose={requestClose}
                onDelete={form.handleDelete}
              />
            </form>
            </div>
            </ChildEditorsProvider>
            </SheetLayer>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onKeepEditing={() => setShowUnsavedDialog(false)}
        onClose={() => {
          setShowUnsavedDialog(false)
          onClose()
        }}
        onSave={() => {
          setShowUnsavedDialog(false)
          submitWithChildren({ preventDefault: () => {} })
        }}
        saveDisabled={loading}
        saveBlockedNote={blockedNote('Save')}
      />

      {/* Copy Values Modal */}
      <CopyValuesModal
        open={form.copyModalOpen}
        currentEnvId={form.selectedEnvId}
        environments={environments}
        hasValues={form.environmentHasValues}
        onClose={() => form.setCopyModalOpen(false)}
        onConfirm={form.handleCopyValuesConfirm}
      />

      {/* Type Change Data-Loss Confirmation Dialog */}
      <ChangeTypeDialog
        open={form.pendingType !== ''}
        nextType={form.pendingType}
        onConfirm={form.handleConfirmTypeChange}
        onCancel={form.handleCancelTypeChange}
      />

      {/* Convert to Custom Type Confirmation Dialog */}
      <ConvertTypeDialog
        open={form.convertToCustomOpen}
        onOpenChange={form.setConvertToCustomOpen}
        currentType={form.formData.type}
        onConfirm={form.handleConfirmConvertToCustom}
        onCancel={form.handleCancelConvertToCustom}
      />
    </>
  )
}
