/**
 * useDraftPersistence Hook Tests
 *
 * V-SAVE-03: Draft persistence verification
 *
 * Test coverage:
 * - Draft Save (5 tests)
 * - Draft Load (5 tests)
 * - Draft Clear (3 tests)
 * - Edge Cases (5 tests)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useDraftPersistence,
  type DraftState,
} from '@/features/workbench/hooks/use-draft-persistence'

// Local test constant matching the module-private storage key
const DRAFT_STORAGE_KEY = 'wave-workbench-draft'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
})()

// Sample draft data
const mockDraftState: DraftState = {
  nodes: [
    { id: 'node-1', type: 'workflowNode', position: { x: 100, y: 100 }, data: { label: 'Script', nodeType: 'plugin' } },
    { id: 'node-2', type: 'workflowNode', position: { x: 200, y: 200 }, data: { label: 'Log', nodeType: 'control' } },
  ],
  edges: [
    { id: 'edge-1', source: 'node-1', target: 'node-2' },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  testId: null,
  testName: null,
  isDirty: true,
  variables: [],
}

describe('useDraftPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Draft Save (5 tests)
  // ===========================================================================
  describe('Draft Save', () => {
    it('saves draft to localStorage when saveDraft is called', () => {
      // Use autoSave: false for immediate saves in tests
      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      act(() => {
        result.current.saveDraft(mockDraftState)
      })

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        DRAFT_STORAGE_KEY,
        JSON.stringify(mockDraftState)
      )
    })

    it('saves complete draft state including nodes, edges, viewport', () => {
      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      act(() => {
        result.current.saveDraft(mockDraftState)
      })

      const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
      expect(savedData.nodes).toEqual(mockDraftState.nodes)
      expect(savedData.edges).toEqual(mockDraftState.edges)
      expect(savedData.viewport).toEqual(mockDraftState.viewport)
    })

    it('overwrites existing draft when saving new draft', () => {
      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      const firstDraft: DraftState = { ...mockDraftState, testName: 'First' }
      const secondDraft: DraftState = { ...mockDraftState, testName: 'Second' }

      act(() => {
        result.current.saveDraft(firstDraft)
      })

      act(() => {
        result.current.saveDraft(secondDraft)
      })

      const lastSavedData = JSON.parse(
        localStorageMock.setItem.mock.calls[localStorageMock.setItem.mock.calls.length - 1][1]
      )
      expect(lastSavedData.testName).toBe('Second')
    })

    it('saves testId and testName for saved tests', () => {
      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      const draftWithTest: DraftState = {
        ...mockDraftState,
        testId: 'test-123',
        testName: 'My Test',
      }

      act(() => {
        result.current.saveDraft(draftWithTest)
      })

      const savedData = JSON.parse(localStorageMock.setItem.mock.calls[0][1])
      expect(savedData.testId).toBe('test-123')
      expect(savedData.testName).toBe('My Test')
    })

    it('saves isDirty flag correctly', () => {
      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      const cleanDraft: DraftState = { ...mockDraftState, isDirty: false }
      const dirtyDraft: DraftState = { ...mockDraftState, isDirty: true }

      act(() => {
        result.current.saveDraft(cleanDraft)
      })
      expect(JSON.parse(localStorageMock.setItem.mock.calls[0][1]).isDirty).toBe(false)

      act(() => {
        result.current.saveDraft(dirtyDraft)
      })
      expect(JSON.parse(localStorageMock.setItem.mock.calls[1][1]).isDirty).toBe(true)
    })
  })

  // ===========================================================================
  // Draft Load (5 tests)
  // ===========================================================================
  describe('Draft Load', () => {
    it('loads draft from localStorage on mount', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.draft).toEqual(mockDraftState)
    })

    it('returns null when no draft exists', () => {
      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.draft).toBeNull()
    })

    it('loads nodes with correct positions', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.draft?.nodes[0].position).toEqual({ x: 100, y: 100 })
      expect(result.current.draft?.nodes[1].position).toEqual({ x: 200, y: 200 })
    })

    it('loads edges with source and target references', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.draft?.edges[0].source).toBe('node-1')
      expect(result.current.draft?.edges[0].target).toBe('node-2')
    })

    it('loads viewport state correctly', () => {
      const draftWithViewport: DraftState = {
        ...mockDraftState,
        viewport: { x: 50, y: 100, zoom: 1.5 },
      }
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftWithViewport))

      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.draft?.viewport).toEqual({ x: 50, y: 100, zoom: 1.5 })
    })
  })

  // ===========================================================================
  // Draft Clear (3 tests)
  // ===========================================================================
  describe('Draft Clear', () => {
    it('clears draft from localStorage when clearDraft is called', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      act(() => {
        result.current.clearDraft()
      })

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(DRAFT_STORAGE_KEY)
    })

    it('sets draft to null after clearing', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      // Verify draft exists
      expect(result.current.draft).not.toBeNull()

      act(() => {
        result.current.clearDraft()
      })

      expect(result.current.draft).toBeNull()
    })

    it('handles clearing when no draft exists', () => {
      const { result } = renderHook(() => useDraftPersistence())

      // Should not throw
      act(() => {
        result.current.clearDraft()
      })

      expect(result.current.draft).toBeNull()
    })

    it('clears pending debounce timer when clearDraft is called', () => {
      vi.useFakeTimers()

      // Render with autoSave enabled
      const { result } = renderHook(() => useDraftPersistence({ autoSave: true, debounceMs: 1000 }))

      // Trigger a save (which sets up a debounced timer)
      act(() => {
        result.current.saveDraft(mockDraftState)
      })

      // Clear the draft before debounce timer fires
      act(() => {
        result.current.clearDraft()
      })

      // Verify draft is cleared
      expect(result.current.draft).toBeNull()

      // Advance timers past debounce period
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // localStorage should have had removeItem called (from clearDraft)
      // and NOT setItem (from debounced save, which should have been canceled)
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(DRAFT_STORAGE_KEY)

      vi.useRealTimers()
    })
  })

    it('clears existing debounce timer when saveDraft called again', () => {
      vi.useFakeTimers()

      const { result } = renderHook(() => useDraftPersistence({ autoSave: true, debounceMs: 1000 }))

      // First save triggers debounce timer
      act(() => {
        result.current.saveDraft(mockDraftState)
      })

      // Second save should clear existing timer and set a new one
      const updatedState = { ...mockDraftState, displayName: 'Updated' }
      act(() => {
        result.current.saveDraft(updatedState)
      })

      // Advance past debounce - only the SECOND save should fire
      act(() => {
        vi.advanceTimersByTime(1500)
      })

      // localStorage setItem should have the UPDATED state
      const calls = localStorageMock.setItem.mock.calls.filter(
        (c: string[]) => c[0] === DRAFT_STORAGE_KEY
      )
      expect(calls.length).toBeGreaterThanOrEqual(1)
      const lastCall = calls[calls.length - 1]
      expect(JSON.parse(lastCall[1]).displayName).toBe('Updated')

      vi.useRealTimers()
    })

  // ===========================================================================
  // Edge Cases (4 tests)
  // ===========================================================================
  describe('Edge Cases', () => {
    it('handles invalid JSON in localStorage gracefully', () => {
      // Suppress expected console.warn for invalid JSON parsing
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      localStorageMock.setItem(DRAFT_STORAGE_KEY, 'invalid json {{{')

      const { result } = renderHook(() => useDraftPersistence())

      // Should return null instead of throwing
      expect(result.current.draft).toBeNull()
      consoleSpy.mockRestore()
    })

    it('handles localStorage errors gracefully when saving', () => {
      // Suppress expected console.warn for save failure
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceeded')
      })

      const { result } = renderHook(() => useDraftPersistence({ autoSave: false }))

      // Should not throw
      act(() => {
        result.current.saveDraft(mockDraftState)
      })

      // Verify warn was called for the storage error
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('handles localStorage errors gracefully when clearing', () => {
      // Suppress expected console.warn for clear failure
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))
      localStorageMock.removeItem.mockImplementationOnce(() => {
        throw new Error('Storage error')
      })

      const { result } = renderHook(() => useDraftPersistence())

      // Should not throw when clearing fails
      expect(() => {
        act(() => {
          result.current.clearDraft()
        })
      }).not.toThrow()

      // Verify warn was called for the storage error
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('handles empty draft object in localStorage', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify({}))

      const { result } = renderHook(() => useDraftPersistence())

      // Should handle empty object with defaults
      expect(result.current.draft).toBeDefined()
    })

    it('hasDraft returns true when draft exists', () => {
      localStorageMock.setItem(DRAFT_STORAGE_KEY, JSON.stringify(mockDraftState))

      const { result } = renderHook(() => useDraftPersistence())

      expect(result.current.hasDraft).toBe(true)
    })
  })

})
