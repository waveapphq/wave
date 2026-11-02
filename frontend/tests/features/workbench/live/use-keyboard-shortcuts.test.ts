/**
 * Tests for useKeyboardShortcuts hook
 *
 * Verifies that the hook correctly derives hasSelection and hasClipboard
 * from workflow store state, and delegates undo/redo to store actions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useKeyboardShortcuts } from '@/features/workbench/live/use-keyboard-shortcuts'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useUndoRedoShortcuts } from '@/features/workbench/hooks/use-undo-redo-shortcuts'
import { useCanvasShortcuts } from '@/features/workbench/hooks/use-canvas-shortcuts'

vi.mock('@/features/workbench/stores/workflow-store')
vi.mock('@/features/workbench/hooks/use-undo-redo-shortcuts', () => ({ useUndoRedoShortcuts: vi.fn() }))
vi.mock('@/features/workbench/hooks/use-canvas-shortcuts', () => ({ useCanvasShortcuts: vi.fn() }))

function buildMockState(overrides: Record<string, unknown> = {}) {
  const undoFn = vi.fn()
  const redoFn = vi.fn()
  const state = {
    canUndo: () => false,
    canRedo: () => false,
    undo: undoFn,
    redo: redoFn,
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    duplicate: vi.fn(),
    selectAll: vi.fn(),
    clipboard: null as { nodes: { id: string }[]; edges: { id: string }[] } | null,
    selectedNodeIds: [] as string[],
    selectedEdgeIds: [] as string[],
    ...overrides,
  }
  return { state, undoFn, redoFn }
}

function setupStore(overrides: Record<string, unknown> = {}) {
  const { state, undoFn, redoFn } = buildMockState(overrides)
  vi.mocked(useWorkflowStore).mockImplementation((selector: unknown) => {
    return (selector as (s: typeof state) => unknown)(state)
  })
  return { state, undoFn, redoFn }
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- hasSelection ---

  it('passes hasSelection=true when nodes are selected', () => {
    setupStore({ selectedNodeIds: ['node-1'] })
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasSelection: true }),
    )
  })

  it('passes hasSelection=true when edges are selected', () => {
    setupStore({ selectedEdgeIds: ['edge-1'] })
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasSelection: true }),
    )
  })

  it('passes hasSelection=false when nothing is selected', () => {
    setupStore()
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasSelection: false }),
    )
  })

  // --- hasClipboard ---

  it('passes hasClipboard=true when clipboard has nodes', () => {
    setupStore({
      clipboard: { nodes: [{ id: 'n1' }], edges: [] },
    })
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasClipboard: true }),
    )
  })

  it('passes hasClipboard=false when clipboard is null', () => {
    setupStore({ clipboard: null })
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasClipboard: false }),
    )
  })

  it('passes hasClipboard=false when clipboard has empty nodes array', () => {
    setupStore({ clipboard: { nodes: [], edges: [] } })
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({ hasClipboard: false }),
    )
  })

  // --- handleUndo / handleRedo ---

  it('handleUndo calls store undo', () => {
    const { undoFn } = setupStore()
    const { result } = renderHook(() => useKeyboardShortcuts())

    result.current.handleUndo()

    expect(undoFn).toHaveBeenCalledOnce()
  })

  it('handleRedo calls store redo', () => {
    const { redoFn } = setupStore()
    const { result } = renderHook(() => useKeyboardShortcuts())

    result.current.handleRedo()

    expect(redoFn).toHaveBeenCalledOnce()
  })

  // --- Delegates to sub-hooks ---

  it('passes undo/redo callbacks and flags to useUndoRedoShortcuts', () => {
    setupStore({ canUndo: () => true, canRedo: () => true })
    renderHook(() => useKeyboardShortcuts())

    expect(useUndoRedoShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({
        canUndo: true,
        canRedo: true,
        onUndo: expect.any(Function),
        onRedo: expect.any(Function),
      }),
    )
  })

  it('passes clipboard actions to useCanvasShortcuts', () => {
    const { state } = setupStore()
    renderHook(() => useKeyboardShortcuts())

    expect(useCanvasShortcuts).toHaveBeenCalledWith(
      expect.objectContaining({
        onCopy: state.copy,
        onCut: state.cut,
        onPaste: state.paste,
        onDuplicate: state.duplicate,
        onSelectAll: state.selectAll,
      }),
    )
  })
})
