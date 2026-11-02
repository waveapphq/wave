/**
 * EnvironmentForm Component
 *
 * REQ-5.2.1.42: Settings and preferences screen - Environment create/edit form
 *
 * Dialog form for creating and editing environments:
 * - SETTINGS-6: Environments = name + description only
 * - SETTINGS-8: "+ New Environment" button opens creation dialog
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TagsInput } from '@/components/ui/tags-input'
import { NameField } from '@/components/shared/fields/name-field'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { MAX_ENTITY_NAME_LENGTH } from '@/lib/field-constraints'

// ============================================================================
// Types
// ============================================================================

export interface Environment {
  id: string
  name: string
  description: string | null
  tags: string[]
  usage: number
  createdAt: string
  updatedAt: string
}

export interface EnvironmentFormData {
  name: string
  description: string | null
  tags: string[]
}

export interface EnvironmentFormProps {
  open: boolean
  mode: 'create' | 'edit'
  environment?: Environment
  allTags: string[]
  onClose: () => void
  onSubmit: (data: EnvironmentFormData) => void
  loading: boolean
  error?: string
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function EnvironmentForm({
  open,
  mode,
  environment,
  allTags,
  onClose,
  onSubmit,
  loading,
  error,
  className,
}: Readonly<EnvironmentFormProps>) {
  const nameId = useId()
  const nameErrorId = useId()
  const descriptionId = useId()
  const nameInputRef = useRef<HTMLTextAreaElement>(null)

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)

  // Reset form when dialog opens/closes or mode changes
  useEffect(() => {
    if (open) {
      if (mode === 'edit' && environment) {
        setName(environment.name)
        setDescription(environment.description || '')
        /* v8 ignore next - COV-DEF-030 */
        setTags(environment.tags || [])
      } else {
        setName('')
        setDescription('')
        setTags([])
      }
      setNameError(null)
      setNameTouched(false)
      // Focus the name input when dialog opens
      setTimeout(() => nameInputRef.current?.focus(), 0)
    }
  }, [open, mode, environment])

  // Validate name
  const validateName = useCallback((value: string): string | null => {
    const trimmed = value.trim()
    if (!trimmed) {
      return 'Name is required'
    }
    if (trimmed.length > MAX_ENTITY_NAME_LENGTH) {
      return `Name must not exceed ${MAX_ENTITY_NAME_LENGTH} characters`
    }
    return null
  }, [])

  // Handle name change
  const handleNameChange = (value: string) => {
    setName(value)
    if (nameTouched) {
      setNameError(validateName(value))
    }
  }

  // Handle name blur
  const handleNameBlur = () => {
    setNameTouched(true)
    setNameError(validateName(name))
  }

  // Check if form is valid
  const isValid = !validateName(name)

  // Handle form submit. The event parameter only needs ``preventDefault``
  // (covers both the onSubmit form event and the Enter-key shortcut),
  // so we type it structurally rather than reach for React's deprecated
  // ``FormEvent``.
  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()

    const validationError = validateName(name)
    if (validationError) {
      setNameTouched(true)
      setNameError(validationError)
      return
    }

    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      tags,
    })
  }

  // Handle key down for form submission
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isValid && !loading) {
        handleSubmit(e)
      }
    }
  }

  const dialogTitle = mode === 'create' ? 'New Environment' : 'Edit Environment'
  const submitLabel = mode === 'create' ? 'Create' : 'Save Changes'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === 'create' ? 'Create a new environment' : 'Edit environment details'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Field */}
          <div className="space-y-2 min-w-0">
            <label htmlFor={nameId} className="text-sm font-medium">
              Name
            </label>
            <NameField
              ref={nameInputRef}
              id={nameId}
              value={name}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              onKeyDown={handleKeyDown}
              placeholder="Enter environment name"
              disabled={loading}
              aria-required
              aria-invalid={!!nameError}
              aria-describedby={nameError ? nameErrorId : undefined}
              maxLength={MAX_ENTITY_NAME_LENGTH}
            />
            {nameError && (
              <p id={nameErrorId} className="text-sm text-error" role="alert">
                {nameError}
              </p>
            )}
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <label htmlFor={descriptionId} className="text-sm font-medium">
              Description
            </label>
            <DescriptionField
              id={descriptionId}
              value={description}
              onChange={setDescription}
              placeholder="Enter description (optional)"
              disabled={loading}
            />
          </div>

          {/* Tags Field */}
          <div className="space-y-2">
            <label htmlFor="env-form-tags" className="text-sm font-medium">Tags</label>
            <TagsInput
              triggerId="env-form-tags"
              value={tags}
              availableTags={allTags}
              onChange={setTags}
              placeholder="Add tags…"
              disabled={loading}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div data-testid="form-error" className="text-sm text-error" role="alert">
              {error}
            </div>
          )}

          {/* Footer */}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || loading}>
              {loading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" data-testid="submit-loading" />
              )}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
