/**
 * useRunConflictGuard - wraps run/resume actions so an unsaved
 * Current-edit holds the action behind the warning dialog (Cancel / Drop / Save).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useRunConflictGuard } from '@/features/workbench/live/use-run-conflict-guard'
import { SaveCanceledError, usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'

const mockToastError = vi.fn()
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: mockToastError }),
}))

/** An open Edit window registering its unsaved change in its scope (node ids), with its own Save and Drop. */
function registerWindow(
  name: string,
  functionPath?: string[],
  save: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  const entry = { name, functionPath, save, drop: vi.fn() }
  usePendingCurrentEdits.getState().setPending(entry)
  return entry
}

beforeEach(() => {
  vi.clearAllMocks()
  usePendingCurrentEdits.getState().clearAll()
})

describe('useRunConflictGuard - an open Edit window with unsaved changes holds the run (VMGR-64)', () => {
  const PATH_A = ['fn-a']

  function holdRun(guard: ReturnType<typeof useRunConflictGuard>, action: () => void | Promise<void>) {
    act(() => {
      guard.guard(action)()
    })
  }

  it('starts the run at once when no window holds a change', () => {
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()

    act(() => {
      result.current.guard(action)('all')
    })

    expect(action).toHaveBeenCalledWith('all')
    expect(result.current.isOpen).toBe(false)
    expect(result.current.entries).toEqual([])
  })

  it('names a run that rejects without reporting itself', async () => {
    const { result } = renderHook(() => useRunConflictGuard())

    holdRun(result.current, vi.fn().mockRejectedValue(new Error('the engine refused')))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('the engine refused', 'Run Control Failed'),
    )
  })

  it("holds the run and opens the dialog naming each window's variable and scope", () => {
    registerWindow('count', [])
    registerWindow('count', PATH_A)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()

    holdRun(result.current, action)

    expect(action).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(true)
    expect(result.current.entries).toMatchObject([
      { name: 'count', functionPath: [] },
      { name: 'count', functionPath: PATH_A },
    ])
  })

  it("Save Changes runs every window's own Save, then the held run", async () => {
    const root = registerWindow('count')
    const local = registerWindow('count', PATH_A)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    await act(async () => {
      result.current.onSave()
    })

    expect(root.save).toHaveBeenCalledTimes(1)
    expect(local.save).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(root.drop).not.toHaveBeenCalled()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(0)
    expect(result.current.isOpen).toBe(false)
  })

  it('Save Changes starts the run only once every window has saved', async () => {
    let finishSave: () => void = () => undefined
    registerWindow('count', undefined, vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve })))
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    act(() => {
      result.current.onSave()
    })

    expect(result.current.isSaving).toBe(true)
    expect(action).not.toHaveBeenCalled()

    await act(async () => {
      finishSave()
    })

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(result.current.isSaving).toBe(false)
  })

  it('Save Changes holds the run and reports it when a window cannot save', async () => {
    const edit = registerWindow('count', undefined, vi.fn().mockRejectedValue(new Error('Variable is locked')))
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    await act(async () => {
      result.current.onSave()
    })

    expect(edit.save).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        'The run did not start: Variable is locked',
        'Current Value Not Saved',
      ),
    )
    expect(action).not.toHaveBeenCalled()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(1)
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isSaving).toBe(false)
  })

  it('Save Changes can be pressed again after a window failed to save', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('409')).mockResolvedValue(undefined)
    registerWindow('count', undefined, save)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)
    await act(async () => {
      result.current.onSave()
    })
    expect(save).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1))

    await act(async () => {
      result.current.onSave()
    })

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledTimes(2)
    expect(usePendingCurrentEdits.getState().pending.size).toBe(0)
    expect(result.current.isOpen).toBe(false)
  })

  it('Save Changes pressed again saves only the windows still holding a change', async () => {
    // A window whose save landed leaves the registry itself, as the window does once its draft matches.
    const saved = registerWindow(
      'count',
      [],
      vi.fn(async () => {
        usePendingCurrentEdits.getState().clearPending('count', [])
      }),
    )
    const failing = registerWindow(
      'total',
      PATH_A,
      vi.fn().mockRejectedValueOnce(new Error('409')).mockResolvedValue(undefined),
    )
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)
    await act(async () => {
      result.current.onSave()
    })
    expect(failing.save).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('The run did not start: 409', 'Current Value Not Saved'),
    )
    expect(result.current.entries).toMatchObject([{ name: 'total', functionPath: PATH_A }])

    await act(async () => {
      result.current.onSave()
    })

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    expect(saved.save).toHaveBeenCalledTimes(1)
    expect(failing.save).toHaveBeenCalledTimes(2)
  })

  it('Save Changes ends like Cancel when a window\'s confirm is canceled: run held, dialog closed, nothing reported', async () => {
    const edit = registerWindow('count', undefined, vi.fn().mockRejectedValue(new SaveCanceledError()))
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    await act(async () => {
      result.current.onSave()
    })

    expect(edit.save).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.isOpen).toBe(false))
    expect(result.current.isSaving).toBe(false)
    expect(action).not.toHaveBeenCalled()
    expect(edit.drop).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(1)
  })

  it('Save Changes saves one window at a time and stops at a canceled confirm', async () => {
    let cancelConfirm: () => void = () => undefined
    const first = registerWindow(
      'count',
      [],
      vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            cancelConfirm = () => reject(new SaveCanceledError())
          }),
      ),
    )
    const second = registerWindow('total', PATH_A)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    act(() => {
      result.current.onSave()
    })

    expect(first.save).toHaveBeenCalledTimes(1)
    expect(second.save).not.toHaveBeenCalled()

    await act(async () => {
      cancelConfirm()
    })

    await waitFor(() => expect(result.current.isOpen).toBe(false))
    expect(second.save).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(2)
  })

  it('Save Changes still saves the next window after one cannot save', async () => {
    const failing = registerWindow('count', [], vi.fn().mockRejectedValue(new Error('409')))
    const next = registerWindow('total', PATH_A)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    await act(async () => {
      result.current.onSave()
    })

    expect(failing.save).toHaveBeenCalledTimes(1)
    expect(next.save).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('The run did not start: 409', 'Current Value Not Saved'),
    )
    expect(action).not.toHaveBeenCalled()
    expect(result.current.isOpen).toBe(true)
  })

  it('hands the dialog whether each held window holds a definition change', () => {
    usePendingCurrentEdits.getState().setPending({
      name: 'count', save: vi.fn().mockResolvedValue(undefined), drop: vi.fn(), definitionChanged: true,
    })
    usePendingCurrentEdits.getState().setPending({
      name: 'total', save: vi.fn().mockResolvedValue(undefined), drop: vi.fn(), definitionChanged: false,
    })
    const { result } = renderHook(() => useRunConflictGuard())
    holdRun(result.current, vi.fn())

    expect(result.current.entries).toMatchObject([
      { name: 'count', definitionChanged: true },
      { name: 'total', definitionChanged: false },
    ])
  })

  it('Drop Changes returns every window to its saved state and runs', () => {
    const root = registerWindow('count')
    const local = registerWindow('count', PATH_A)
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    act(() => {
      result.current.onDrop()
    })

    expect(root.drop).toHaveBeenCalledTimes(1)
    expect(local.drop).toHaveBeenCalledTimes(1)
    expect(root.save).not.toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
    expect(usePendingCurrentEdits.getState().pending.size).toBe(0)
    expect(result.current.isOpen).toBe(false)
  })

  it('Cancel keeps every window as it is and the run held', () => {
    const edit = registerWindow('count')
    const { result } = renderHook(() => useRunConflictGuard())
    const action = vi.fn()
    holdRun(result.current, action)

    act(() => {
      result.current.onCancel()
    })

    expect(edit.save).not.toHaveBeenCalled()
    expect(edit.drop).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
    expect(usePendingCurrentEdits.getState().pending.size).toBe(1)
    expect(result.current.isOpen).toBe(false)
  })

  it('names a held run that rejects once Drop Changes releases it', async () => {
    registerWindow('count')
    const { result } = renderHook(() => useRunConflictGuard())
    holdRun(result.current, vi.fn().mockRejectedValue(new Error('the engine refused')))

    act(() => {
      result.current.onDrop()
    })

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('the engine refused', 'Run Control Failed'),
    )
  })
})
