/**
 * useUndoRedoToasts Hook Tests
 *
 * Verifies the toast subscription mirrors `announcementSeq` to a
 * stack-collapsing info toast and renders a `(×N)` repeat counter when
 * consecutive undo/redo operations share the same description string.
 *
 * The accessibility live region (`lastAnnouncement` verbatim) is untouched;
 * the count suffix exists only in the visible toast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useUndoRedoToasts } from '@/features/workbench/hooks/use-undo-redo-toasts'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { ToastProvider, useToast } from '@/components/ui/toast'

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
)

const TOAST_ID = 'workbench-undo-redo'

function useHookAndToasts() {
  useUndoRedoToasts()
  return useToast()
}

function pushAnnouncement(message: string) {
  act(() => {
    useWorkflowStore.setState((state) => ({
      lastAnnouncement: message,
      announcementSeq: state.announcementSeq + 1,
    }))
  })
}

describe('useUndoRedoToasts', () => {
  beforeEach(() => {
    act(() => {
      useWorkflowStore.setState({ lastAnnouncement: '', announcementSeq: 0 })
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    act(() => {
      useWorkflowStore.setState({ lastAnnouncement: '', announcementSeq: 0 })
    })
  })

  it('does not toast on mount when no announcement has fired', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('fires an info toast with id and duration when an announcement is published', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    pushAnnouncement('Undone: Add block')

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].id).toBe(TOAST_ID)
    expect(result.current.toasts[0].variant).toBe('info')
    expect(result.current.toasts[0].message).toBe('Undone: Add block')
    expect(result.current.toasts[0].duration).toBe(3500)
  })

  it('replaces the previous toast on a different announcement (stack-collapse)', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts).toHaveLength(1)

    pushAnnouncement('Undone: Add connection')

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Undone: Add connection')
  })

  it('renders (×N) repeat suffix for consecutive same-description announcements', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts[0].message).toBe('Undone: Add block')

    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Undone: Add block (×2)')

    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts[0].message).toBe('Undone: Add block (×3)')
  })

  it('resets the repeat count when the description changes', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    pushAnnouncement('Undone: Add block')
    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts[0].message).toBe('Undone: Add block (×2)')

    pushAnnouncement('Undone: Add connection')
    expect(result.current.toasts[0].message).toBe('Undone: Add connection')

    pushAnnouncement('Undone: Add connection')
    expect(result.current.toasts[0].message).toBe('Undone: Add connection (×2)')
  })

  it('ignores store setState that does not bump announcementSeq', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    // Fire a real announcement first so the toast hook is engaged.
    pushAnnouncement('Undone: Add block')
    expect(result.current.toasts).toHaveLength(1)

    // Now mutate the store WITHOUT touching announcementSeq. The hook must
    // not refire (this guards against unrelated state changes spamming
    // toasts every time the canvas updates).
    act(() => {
      useWorkflowStore.setState({ isDirty: true })
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Undone: Add block')
  })

  it('skips when announcementSeq bumps but lastAnnouncement is empty', () => {
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    act(() => {
      useWorkflowStore.setState((state) => ({
        lastAnnouncement: '',
        announcementSeq: state.announcementSeq + 1,
      }))
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('clears the repeat count across a canvas reset (seq goes backward)', () => {
    // The count refs clear on `reset()` (Discard and Close) along with
    // announcementSeq, so the next undo of an identical-description op starts fresh.
    const { result } = renderHook(useHookAndToasts, { wrapper: Wrapper })

    pushAnnouncement('Undone: Move block')
    expect(result.current.toasts[0].message).toBe('Undone: Move block')

    // Simulate reset(): the store flips back to a fresh baseline with
    // announcementSeq: 0 and lastAnnouncement: ''.
    act(() => {
      useWorkflowStore.setState({ announcementSeq: 0, lastAnnouncement: '' })
    })

    // First undo of the new session: same description, but the count must
    // restart at 1 (no `(×N)` suffix).
    pushAnnouncement('Undone: Move block')
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Undone: Move block')
  })
})
