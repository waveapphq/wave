/**
 * useDraftPersistence Hook
 *
 * V-SAVE-03: Draft persistence verification
 *
 * Provides localStorage persistence for workflow canvas drafts.
 * Features:
 * - Auto-save draft state to localStorage
 * - Restore exact state on return to Workbench
 * - Clear draft on save success or discard
 * - Handle browser refresh gracefully
 */

import { useState, useCallback, useEffect, useRef } from 'react'

// ===========================================================================
// Types
// ===========================================================================

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  width?: number
  height?: number
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  animated?: boolean
  label?: string
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface WorkflowVariable {
  id: string
  name: string
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  isSecret?: boolean
}

export interface DraftState {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport: ViewportState
  testId: string | null
  testName: string | null
  isDirty: boolean
  variables: WorkflowVariable[]
}

export interface UseDraftPersistenceOptions {
  /** Debounce delay in ms for auto-save (default: 500) */
  debounceMs?: number
  /** Whether auto-save is enabled (default: true) */
  autoSave?: boolean
}

export interface UseDraftPersistenceReturn {
  /** Current draft state from localStorage */
  draft: DraftState | null
  /** Whether a draft exists */
  hasDraft: boolean
  /** Save draft to localStorage */
  saveDraft: (state: DraftState) => void
  /** Clear draft from localStorage */
  clearDraft: () => void
  /** Load draft from localStorage (call on mount) */
  loadDraft: () => DraftState | null
}

// ===========================================================================
// Constants
// ===========================================================================

const DRAFT_STORAGE_KEY = 'wave-workbench-draft'
const DEFAULT_DEBOUNCE_MS = 500

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Load draft from localStorage synchronously
 */
function loadDraftFromStorage(): DraftState | null {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      return {
        ...parsed,
        variables: parsed.variables ?? [],
      } as DraftState
    }
  } catch (error) {
    console.warn('Failed to load draft from localStorage:', error)
  }
  return null
}

/**
 * Save draft to localStorage synchronously
 */
function saveDraftToStorage(state: DraftState): boolean {
  try {
    const serialized = JSON.stringify(state)
    localStorage.setItem(DRAFT_STORAGE_KEY, serialized)
    return true
  } catch (error) {
    console.warn('Failed to save draft to localStorage:', error)
    return false
  }
}

/**
 * Clear draft from localStorage synchronously
 */
function clearDraftFromStorage(): boolean {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    return true
  } catch (error) {
    console.warn('Failed to clear draft from localStorage:', error)
    return false
  }
}

// ===========================================================================
// Hook
// ===========================================================================

export function useDraftPersistence(
  options: UseDraftPersistenceOptions = {}
): UseDraftPersistenceReturn {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, autoSave = true } = options
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [draft, setDraft] = useState<DraftState | null>(() => {
    // Load draft from localStorage on initial render
    return loadDraftFromStorage()
  })

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [])

  // Load draft from localStorage
  /* v8 ignore start - COV-HOOK-001 */
  const loadDraft = useCallback((): DraftState | null => {
    const loaded = loadDraftFromStorage()
    setDraft(loaded)
    return loaded
  }, [])
  /* v8 ignore stop */

  // Save draft to localStorage (debounced if autoSave is enabled)
  const saveDraft = useCallback(
    (state: DraftState) => {
      if (autoSave) {
        // Clear existing timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }

        // Debounced save
        debounceTimerRef.current = setTimeout(() => {
          if (saveDraftToStorage(state)) {
            setDraft(state)
          }
          debounceTimerRef.current = null
        }, debounceMs)
      } else if (saveDraftToStorage(state)) {
        // Immediate save
        setDraft(state)
      }
    },
    [autoSave, debounceMs]
  )

  // Clear draft from localStorage
  const clearDraft = useCallback(() => {
    // Clear any pending save
    /* v8 ignore start - COV-DEF-064 */
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    /* v8 ignore stop */
    if (clearDraftFromStorage()) {
      setDraft(null)
    }
  }, [])

  // Compute whether draft exists
  const hasDraft = draft !== null

  return {
    draft,
    hasDraft,
    saveDraft,
    clearDraft,
    loadDraft,
  }
}
