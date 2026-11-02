/**
 * TestFormDialog Helpers
 *
 * Validation and mode-specific configuration for the test form.
 */

import { MAX_TEST_NAME_LENGTH } from '@/lib/field-constraints'
import type { TestFormDialogProps } from './types'

// ===========================================================================
// Validation
// ===========================================================================

export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) {
    return 'Test name is required'
  }
  if (trimmed.length > MAX_TEST_NAME_LENGTH) {
    return `Name must be ${MAX_TEST_NAME_LENGTH} characters or less`
  }
  return null
}

// ===========================================================================
// Mode-specific configuration
// ===========================================================================

export function getDialogTitle(mode: TestFormDialogProps['mode']): string {
  switch (mode) {
    case 'create':
      return 'New Test'
    case 'edit':
      return 'Edit Test'
    case 'edit-metadata':
      return 'Edit Test Info'
  }
}

export function getSubmitLabel(mode: TestFormDialogProps['mode'], isSaving: boolean): string {
  if (mode === 'create') {
    return isSaving ? 'Creating…' : 'Create Test'
  }
  return isSaving ? 'Saving…' : 'Save'
}
