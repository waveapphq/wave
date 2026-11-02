/**
 * Tests for the Python inline rename CodeMirror module (PYRUN-19).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorSelection, EditorState, StateEffect, type Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

vi.mock('@/features/workbench/api/python-tools', () => ({
  completePython: vi.fn(),
  renamePython: vi.fn(),
}))

import { renamePython } from '@/features/workbench/api/python-tools'
import {
  createPythonRenameExtension,
  type PythonRenameOptions,
} from '@/features/workbench/lib/codemirror/python-rename'

// ============================================
// Fixtures
// ============================================

const RENAME_HINT = 'Rename symbol · Enter to apply · Esc to cancel'

const DOC = ['value = 1', 'other = value + 2', 'print(value)'].join('\n')
const RENAMED = ['count = 1', 'other = count + 2', 'print(count)'].join('\n')

/** Offset 2 sits inside the `value` on line 1 (line 1, column 2). */
const CURSOR_IN_VALUE = 2

const EDITS = [
  { from_line: 1, from_column: 0, to_line: 1, to_column: 5, text: 'count' },
  { from_line: 2, from_column: 8, to_line: 2, to_column: 13, text: 'count' },
  { from_line: 3, from_column: 6, to_line: 3, to_column: 11, text: 'count' },
]

const INTERPRETER = '{{py}}'

// ============================================
// Test Helpers
// ============================================

const views: EditorView[] = []
const parents: HTMLElement[] = []
let transactions: Transaction[] = []

function renameExtension(options: Partial<PythonRenameOptions> = {}) {
  return createPythonRenameExtension({
    interpreter: INTERPRETER,
    inputVariableNames: [],
    exportNames: [],
    ...options,
  })
}

/** What the sheet does when its extension memo re-runs: a full reconfiguration. */
function rebuildExtensions(view: EditorView, options: Partial<PythonRenameOptions> = {}): void {
  view.dispatch({ effects: StateEffect.reconfigure.of([renameExtension(options)]) })
}

function mountEditor(
  doc: string,
  cursor: number,
  options: Partial<PythonRenameOptions> = {}
): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(cursor, cursor),
    extensions: [renameExtension(options)],
  })
  const view = new EditorView({
    state,
    parent,
    dispatchTransactions: (trs, target) => {
      transactions.push(...trs)
      target.update(trs)
    },
  })
  views.push(view)
  parents.push(parent)
  return view
}

function pressF2(view: EditorView): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })
  )
}

function renameBox(): HTMLElement | null {
  return document.body.querySelector('[data-testid="python-rename-box"]')
}

function renameInput(): HTMLInputElement {
  const element = document.body.querySelector('[data-testid="python-rename-input"]')
  if (!element) throw new Error('The rename box is not open')
  return element as HTMLInputElement
}

function renameHint(): HTMLElement | null {
  return document.body.querySelector('[data-testid="python-rename-hint"]')
}

function renameError(): HTMLElement | null {
  return document.body.querySelector('[data-testid="python-rename-error"]')
}

function typeNewName(name: string): void {
  const input = renameInput()
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function pressInBox(key: string): void {
  renameInput().dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  )
}

function occurrences(view: EditorView): string[] {
  return [...view.dom.querySelectorAll('.cm-python-rename-occurrence')].map(
    (node) => node.textContent ?? ''
  )
}

function docChangingTransactions(): Transaction[] {
  return transactions.filter((tr) => tr.docChanged)
}

function resolvedRename() {
  return vi.mocked(renamePython).mockResolvedValue({ edits: EDITS })
}

function rejectedRename(message: string) {
  return vi.mocked(renamePython).mockRejectedValue(Object.assign(new Error(message), {
    type: 'validation',
    status: 400,
    isRetryable: false,
  }))
}

afterEach(() => {
  for (const view of views) view.destroy()
  for (const parent of parents) parent.remove()
  views.length = 0
  parents.length = 0
  transactions = []
  vi.clearAllMocks()
})

// ============================================
// F2 opens the rename box
// ============================================

describe('F2 opens the rename box', () => {
  it('opens the box with the current name pre-filled', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(renameBox()).not.toBeNull()
    expect(renameInput().value).toBe('value')
  })

  it('moves focus into the rename input', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(document.activeElement).toBe(renameInput())
  })

  it('selects the pre-filled name, so the first keystroke replaces it', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    const input = renameInput()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
  })

  it('shows the hint verbatim', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(renameHint()?.textContent).toBe(RENAME_HINT)
  })

  it('labels the input and describes it with the hint', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(renameInput()).toHaveAccessibleName()
    expect(renameInput()).toHaveAccessibleDescription(RENAME_HINT)
  })

  it('highlights every occurrence of the symbol', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(occurrences(view)).toEqual(['value', 'value', 'value'])
  })

  it('does not highlight a longer identifier that starts with the name', () => {
    const doc = ['value = 1', 'values = 2', 'print(value)'].join('\n')
    const view = mountEditor(doc, CURSOR_IN_VALUE)

    pressF2(view)

    expect(occurrences(view)).toEqual(['value', 'value'])
  })

  it('does not open when the cursor is not on an identifier', () => {
    const view = mountEditor(DOC, 6)

    pressF2(view)

    expect(renameBox()).toBeNull()
  })

  it('does not ask the server before the name is confirmed', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(renamePython).not.toHaveBeenCalled()
  })

  it('shows no error when it opens', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)

    expect(renameError()).toBeNull()
  })

  it('runs the pending measure pass before it returns, so the box is placed, not parked', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    const measured: string[] = []
    view.requestMeasure({
      read: () => {
        measured.push('read')
        return null
      },
      write: () => {
        measured.push('write')
      },
    })

    pressF2(view)

    expect(renameBox()).not.toBeNull()
    expect(measured).toEqual(['read', 'write'])
  })
})

// ============================================
// Enter applies the rename
// ============================================

describe('Enter applies the rename', () => {
  it('sends the cursor position, the new name and the raw interpreter text', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renamePython).toHaveBeenCalledWith({
        script: DOC,
        line: 1,
        column: 2,
        new_name: 'count',
        interpreter: INTERPRETER,
      })
    })
  })

  it('applies every returned edit', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(RENAMED)
    })
  })

  it('applies the edits as one undoable transaction', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(RENAMED)
    })
    expect(docChangingTransactions()).toHaveLength(1)
  })

  it('a single undo of that transaction restores the original document', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(RENAMED)
    })
    const applied = docChangingTransactions()[0]
    const undone = applied.changes.invert(applied.startState.doc).apply(view.state.doc)
    expect(undone.toString()).toBe(DOC)
  })

  it('closes the box once the edits are applied', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameBox()).toBeNull()
    })
  })
})

// ============================================
// Esc cancels
// ============================================

describe('Esc cancels the rename', () => {
  it('closes the box', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Escape')

    expect(renameBox()).toBeNull()
  })

  it('leaves the document untouched', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Escape')

    expect(view.state.doc.toString()).toBe(DOC)
    expect(docChangingTransactions()).toHaveLength(0)
  })

  it('never asks the server', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Escape')

    expect(renamePython).not.toHaveBeenCalled()
  })

  it('does not let Escape reach the surrounding sheet', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    const seen: string[] = []
    const listener = (event: Event) => seen.push((event as KeyboardEvent).key)
    document.addEventListener('keydown', listener)

    try {
      pressInBox('Escape')
    } finally {
      document.removeEventListener('keydown', listener)
    }

    expect(seen).toEqual([])
  })

  it('removes the occurrence highlighting', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    pressInBox('Escape')

    expect(occurrences(view)).toEqual([])
  })
})

// ============================================
// A rejected rename
// ============================================

describe('a rejected rename', () => {
  const MESSAGE = 'Cannot rename: no symbol at the cursor'

  it('shows the server message inside the box', async () => {
    rejectedRename(MESSAGE)
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameError()?.textContent).toBe(MESSAGE)
    })
  })

  it('keeps the box open with the typed name', async () => {
    rejectedRename(MESSAGE)
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameError()).not.toBeNull()
    })
    expect(renameBox()).not.toBeNull()
    expect(renameInput().value).toBe('count')
  })

  it('leaves the document untouched', async () => {
    rejectedRename(MESSAGE)
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameError()).not.toBeNull()
    })
    expect(view.state.doc.toString()).toBe(DOC)
    expect(docChangingTransactions()).toHaveLength(0)
  })

  it('shows the message of an invalid new name', async () => {
    const invalid = "Invalid variable name: '__x'"
    rejectedRename(invalid)
    const view = mountEditor(DOC, CURSOR_IN_VALUE)

    pressF2(view)
    typeNewName('__x')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameError()?.textContent).toBe(invalid)
    })
  })
})

// ============================================
// onRenameSymbol
// ============================================

describe('onRenameSymbol', () => {
  it('is called when the old name is an Input Variable key', async () => {
    resolvedRename()
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE, {
      inputVariableNames: ['value'],
      onRenameSymbol,
    })

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(onRenameSymbol).toHaveBeenCalledWith('value', 'count')
    })
  })

  it('is called when the old name is an export row name', async () => {
    resolvedRename()
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE, {
      exportNames: ['value'],
      onRenameSymbol,
    })

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(onRenameSymbol).toHaveBeenCalledWith('value', 'count')
    })
  })

  it('is not called for any other symbol', async () => {
    resolvedRename()
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE, {
      inputVariableNames: ['threshold'],
      exportNames: ['summary'],
      onRenameSymbol,
    })

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(RENAMED)
    })
    expect(onRenameSymbol).not.toHaveBeenCalled()
  })

  it('is not called when the rename is rejected', async () => {
    rejectedRename('Cannot rename: no symbol at the cursor')
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE, {
      inputVariableNames: ['value'],
      onRenameSymbol,
    })

    pressF2(view)
    typeNewName('count')
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(renameError()).not.toBeNull()
    })
    expect(onRenameSymbol).not.toHaveBeenCalled()
  })

  it('is not called when Esc cancels the rename', () => {
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE, {
      inputVariableNames: ['value'],
      onRenameSymbol,
    })

    pressF2(view)
    typeNewName('count')
    pressInBox('Escape')

    expect(onRenameSymbol).not.toHaveBeenCalled()
  })
})

// ============================================
// An extension rebuild while the box is open
// ============================================

describe('an extension rebuild while the box is open', () => {
  it('keeps the same box instead of building a new one', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    const opened = renameInput()

    rebuildExtensions(view)

    expect(renameInput()).toBe(opened)
  })

  it('keeps the name typed so far', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('cou')

    rebuildExtensions(view)

    expect(renameInput().value).toBe('cou')
  })

  it('leaves the caret where the typing left it, so the next keystroke adds to it', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('cou')

    rebuildExtensions(view)

    const input = renameInput()
    expect(input.selectionStart).toBe(3)
    expect(input.selectionEnd).toBe(3)
  })

  it('keeps focus in the box', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('cou')

    rebuildExtensions(view)

    expect(document.activeElement).toBe(renameInput())
  })

  it('keeps highlighting every occurrence', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)

    rebuildExtensions(view)

    expect(occurrences(view)).toEqual(['value', 'value', 'value'])
  })

  it('applies the name typed before the rebuild', async () => {
    resolvedRename()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('count')

    rebuildExtensions(view)
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(RENAMED)
    })
    expect(renamePython).toHaveBeenCalledWith({
      script: DOC,
      line: 1,
      column: 2,
      new_name: 'count',
      interpreter: INTERPRETER,
    })
  })

  it('applies with the options the rebuild brought, not the ones the box opened with', async () => {
    resolvedRename()
    const onRenameSymbol = vi.fn()
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('count')

    rebuildExtensions(view, {
      interpreter: '{{py3}}',
      inputVariableNames: ['value'],
      onRenameSymbol,
    })
    pressInBox('Enter')

    await vi.waitFor(() => {
      expect(onRenameSymbol).toHaveBeenCalledWith('value', 'count')
    })
    expect(renamePython).toHaveBeenCalledWith({
      script: DOC,
      line: 1,
      column: 2,
      new_name: 'count',
      interpreter: '{{py3}}',
    })
  })

  it('still closes on Esc', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)

    rebuildExtensions(view)
    pressInBox('Escape')

    expect(renameBox()).toBeNull()
    expect(occurrences(view)).toEqual([])
  })

  it('opens a fresh box for the next rename after the rebuild', () => {
    const view = mountEditor(DOC, CURSOR_IN_VALUE)
    pressF2(view)
    typeNewName('cou')
    rebuildExtensions(view)
    pressInBox('Escape')

    pressF2(view)

    expect(renameInput().value).toBe('value')
  })
})
