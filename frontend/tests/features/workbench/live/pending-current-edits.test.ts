/**
 * usePendingCurrentEdits - the registry of open Current-edits that
 * the run-conflict guard reads.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'

/** What an open Edit window registers: its variable, its scope (node ids), and its own Save and Drop. */
function windowEdit(name: string, functionPath?: string[] | null) {
  return { name, functionPath, save: vi.fn().mockResolvedValue(undefined), drop: vi.fn() }
}

beforeEach(() => {
  usePendingCurrentEdits.getState().clearAll()
})

describe('usePendingCurrentEdits - one entry per open Edit window, keyed by name and scope (VMGR-64)', () => {
  const PATH_A = ['fn-a']

  const entries = () => [...usePendingCurrentEdits.getState().pending.values()]

  it('registers an open window with an unsaved change', () => {
    const edit = windowEdit('count')

    usePendingCurrentEdits.getState().setPending(edit)

    expect(entries()).toEqual([edit])
  })

  it('keeps a Test variable window and a same-named Function local window apart', () => {
    usePendingCurrentEdits.getState().setPending(windowEdit('count'))
    usePendingCurrentEdits.getState().setPending(windowEdit('count', PATH_A))

    expect(entries().map((entry) => [entry.name, entry.functionPath])).toEqual([
      ['count', undefined],
      ['count', PATH_A],
    ])
  })

  it('keeps a nested Function instance apart from the Function holding it', () => {
    usePendingCurrentEdits.getState().setPending(windowEdit('count', PATH_A))
    usePendingCurrentEdits.getState().setPending(windowEdit('count', ['fn-a', 'fn-b']))

    expect(entries().map((entry) => entry.functionPath)).toEqual([PATH_A, ['fn-a', 'fn-b']])
  })

  it('replaces the entry the same window registered before', () => {
    const first = windowEdit('count', PATH_A)
    const second = windowEdit('count', ['fn-a'])

    usePendingCurrentEdits.getState().setPending(first)
    usePendingCurrentEdits.getState().setPending(second)

    expect(entries()).toEqual([second])
  })

  it('reads an absent, empty or null scope as the Test root', () => {
    const last = windowEdit('count', null)

    usePendingCurrentEdits.getState().setPending(windowEdit('count'))
    usePendingCurrentEdits.getState().setPending(windowEdit('count', []))
    usePendingCurrentEdits.getState().setPending(last)

    expect(entries()).toEqual([last])
  })

  it('clearPending removes only the entry of that name in that scope', () => {
    const root = windowEdit('count')
    usePendingCurrentEdits.getState().setPending(root)
    usePendingCurrentEdits.getState().setPending(windowEdit('count', PATH_A))

    usePendingCurrentEdits.getState().clearPending('count', PATH_A)

    expect(entries()).toEqual([root])
  })

  it('clearPending removes the Test root window however its scope is named', () => {
    const local = windowEdit('count', PATH_A)
    usePendingCurrentEdits.getState().setPending(windowEdit('count', []))
    usePendingCurrentEdits.getState().setPending(local)

    usePendingCurrentEdits.getState().clearPending('count', null)

    expect(entries()).toEqual([local])
  })

  it('clearPending is a no-op (same reference) for a window that is not registered', () => {
    const root = windowEdit('count')
    usePendingCurrentEdits.getState().setPending(root)
    const before = usePendingCurrentEdits.getState().pending

    usePendingCurrentEdits.getState().clearPending('count', PATH_A)

    expect(usePendingCurrentEdits.getState().pending).toBe(before)
    expect(entries()).toEqual([root])
  })

  it('clearAll empties every scope, and is a no-op (same reference) when already empty', () => {
    usePendingCurrentEdits.getState().setPending(windowEdit('count'))
    usePendingCurrentEdits.getState().setPending(windowEdit('count', PATH_A))

    usePendingCurrentEdits.getState().clearAll()

    expect(usePendingCurrentEdits.getState().pending.size).toBe(0)
    const empty = usePendingCurrentEdits.getState().pending
    usePendingCurrentEdits.getState().clearAll()
    expect(usePendingCurrentEdits.getState().pending).toBe(empty)
  })
})
