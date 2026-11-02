/**
 * useTestForm Hook
 *
 * Manages form state and callbacks for the TestFormDialog component.
 * Handles name/description/tags state, validation, test details loading,
 * and form submission.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useId,
} from 'react'
import { fetchTest, fetchTestsTags } from '@/features/tests/api/crud'
import type { TestFormDialogProps, TestFormPayload, UseTestFormReturn } from './types'
import { validateName, getDialogTitle, getSubmitLabel } from './helpers'

export { getDialogTitle, getSubmitLabel } from './helpers'

/** The dialog owns these reads, so it reports and refuses inside the dialog. */
const REOPEN_TO_RETRY = 'Close and reopen this dialog to try again.'

function failedReadMessage(detailsFailed: boolean, tagsFailed: boolean): string | null {
  const failed = [detailsFailed ? 'test details' : null, tagsFailed ? 'tags' : null].filter(
    (label): label is string => label !== null
  )
  return failed.length === 0 ? null : `Could not load ${failed.join(' and ')}. ${REOPEN_TO_RETRY}`
}

export function useTestForm({
  isOpen,
  onClose,
  onSave,
  mode,
  workflowData,
  testId,
  initialValues,
}: TestFormDialogProps): UseTestFormReturn {
  // Form state
  const [name, setName] = useState(initialValues?.name ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? [])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [tagsFailed, setTagsFailed] = useState(false)
  const [detailsFailed, setDetailsFailed] = useState(false)

  // Test details loading state (edit-metadata mode only)
  const [testDetailsLoading, setTestDetailsLoading] = useState(mode === 'edit-metadata')

  // Form validation/error state
  const [nameError, setNameError] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Refs
  const nameInputRef = useRef<HTMLTextAreaElement>(null)

  // IDs for accessibility
  const nameErrorId = useId()

  const isEditMetadata = mode === 'edit-metadata'

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName(initialValues?.name ?? '')
      setDescription(initialValues?.description ?? '')
      setTags(initialValues?.tags ?? [])
      setNameError(null)
      setApiError(null)
      setIsSaving(false)
      setTagsFailed(false)
      setDetailsFailed(false)
      setTestDetailsLoading(isEditMetadata)

      // Focus name input after mount
      setTimeout(() => {
        nameInputRef.current?.focus()
      }, 0)
    }
  }, [isOpen, initialValues, isEditMetadata])

  // Fetch test details on open (edit-metadata mode only)
  useEffect(() => {
    if (!isOpen || !isEditMetadata || !testId) return

    let canceled = false
    setTestDetailsLoading(true)

    fetchTest(testId)
      .then((result) => {
        if (!canceled) {
          setDescription(result.description ?? '')
          /* v8 ignore next - COV-DEF-044 */
          setTags(result.tags ?? result.metadata?.tags ?? [])
          setDetailsFailed(false)
          setTestDetailsLoading(false)
        }
      })
      .catch((err) => {
        if (!canceled) {
          // Saving now would write the empty form over the stored values.
          console.error('Failed to fetch test details:', err)
          setDetailsFailed(true)
          setTestDetailsLoading(false)
        }
      })

    return () => {
      canceled = true
    }
  }, [isOpen, isEditMetadata, testId])

  // Handle dialog open/close (Radix)
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !isSaving) {
        onClose()
      }
    },
    [isSaving, onClose]
  )

  // Clear errors when form changes
  const handleNameChange = useCallback((value: string) => {
    setName(value)
    setNameError(null)
    setApiError(null)
  }, [])

  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value)
    setApiError(null)
  }, [])

  // Fetch available tags when dialog opens
  useEffect(() => {
    if (!isOpen) return
    let canceled = false
    fetchTestsTags()
      .then((tags) => {
        if (canceled) return
        setAvailableTags(tags)
        setTagsFailed(false)
      })
      .catch(() => {
        if (canceled) return
        setTagsFailed(true)
      })
    return () => {
      canceled = true
    }
  }, [isOpen])

  // Tags handling
  /* v8 ignore next 4 - COV-V8-003: V8 tracks useCallback body as branch */
  const handleTagsChange = useCallback((newTags: string[]) => {
    setTags(newTags)
    setApiError(null)
  }, [])

  // A read that did not land must never be saved back over what is stored.
  const loadFailure = failedReadMessage(detailsFailed, tagsFailed)

  /** A save that failed is named on the dialog's own error line. */
  const reportSaveFailure = useCallback((err: unknown) => {
    setIsSaving(false)
    const error = err as Error & { status?: number }
    /* v8 ignore next - COV-DEF-040 */
    const message = error.message || 'Failed to save test. Please try again.'

    // Check for duplicate name or conflict errors
    if (message.toLowerCase().includes('already exists') || message.toLowerCase().includes('duplicate')) {
      setNameError(message)
    } else if (error.status === 409 || message.toLowerCase().includes('conflict')) {
      setApiError(message)
    } else {
      /* v8 ignore next - COV-DEF-040 */
      setApiError(message || 'Failed to save test. Please try again.')
    }
  }, [])

  const handleSubmit = useCallback(async () => {
    if (detailsFailed || tagsFailed) return

    // Validate name
    const error = validateName(name)
    if (error) {
      setNameError(error)
      return
    }

    // Prevent double submission
    /* v8 ignore next - COV-DEF-039 */
    if (isSaving) return

    setIsSaving(true)
    setApiError(null)

    try {
      const payload: TestFormPayload = {
        name: name.trim(),
        description: description.trim(),
        tags,
      }

      // Include workflowData for create/edit modes
      if (mode !== 'edit-metadata' && workflowData) {
        payload.workflowData = workflowData
      }

      // Include testId for edit/edit-metadata modes
      if (testId && mode !== 'create') {
        payload.testId = testId
      }

      await onSave(payload)
      onClose()
    } catch (err) {
      reportSaveFailure(err)
    }
  }, [name, description, tags, workflowData, testId, mode, isSaving, detailsFailed, tagsFailed, onSave, onClose, reportSaveFailure])

  const title = getDialogTitle(mode)
  const submitLabel = getSubmitLabel(mode, isSaving)

  return {
    name,
    description,
    tags,
    availableTags,
    nameError,
    apiError: loadFailure ?? apiError,
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
  }
}
