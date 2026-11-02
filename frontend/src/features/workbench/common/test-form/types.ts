/**
 * TestFormDialog Types
 *
 * Shared type definitions for the test form dialog component.
 */

import type { RefObject } from 'react'

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface WorkflowData {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface TestFormPayload {
  name: string
  description: string
  tags: string[]
  workflowData?: WorkflowData
  testId?: string
}

export interface TestFormInitialValues {
  name?: string
  description?: string
  tags?: string[]
}

export interface TestFormDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Called when dialog should close */
  onClose: () => void
  /** Called when save is submitted */
  onSave: (payload: TestFormPayload) => Promise<void>
  /** Dialog mode */
  mode: 'create' | 'edit' | 'edit-metadata'
  /** Workflow data to save (required for create/edit) */
  workflowData?: WorkflowData
  /** Test ID (required for edit/edit-metadata) */
  testId?: string
  /** Initial values for the form */
  initialValues?: TestFormInitialValues
}

export interface UseTestFormReturn {
  // Form values
  name: string
  description: string
  tags: string[]
  availableTags: string[]

  // State
  nameError: string | null
  apiError: string | null
  isSaving: boolean
  testDetailsLoading: boolean
  isEditMetadata: boolean

  // Computed
  title: string
  submitLabel: string

  // Refs
  nameInputRef: RefObject<HTMLTextAreaElement | null>

  // IDs
  nameErrorId: string

  // Handlers
  handleOpenChange: (open: boolean) => void
  handleNameChange: (value: string) => void
  handleDescriptionChange: (value: string) => void
  handleTagsChange: (tags: string[]) => void
  handleSubmit: () => Promise<void>
  /** Names a save failure on the dialog's error line. */
  reportSaveFailure: (err: unknown) => void
}
