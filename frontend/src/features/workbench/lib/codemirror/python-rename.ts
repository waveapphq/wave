/**
 * Inline rename for the Python script body (PYRUN-19).
 *
 * F2 opens a box under the symbol at the cursor; Enter sends the rename to the
 * server and applies every returned edit as one undoable transaction.
 */

import { Facet, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'

import { renamePython, type PythonRenameEdit } from '@/features/workbench/api/python-tools'

// ============================================
// Types
// ============================================

export interface PythonRenameOptions {
  /** The Interpreter row text, raw and unresolved. */
  interpreter: string
  inputVariableNames: string[]
  exportNames: string[]
  onRenameSymbol?: (oldName: string, newName: string) => void
}

interface SymbolRange {
  from: number
  to: number
}

interface RenameSession {
  name: string
  cursor: number
  ranges: SymbolRange[]
}

const RENAME_HINT = 'Rename symbol · Enter to apply · Esc to cancel'

// ============================================
// State
// ============================================

const startRename = StateEffect.define<RenameSession>()
const stopRename = StateEffect.define<null>()

// Read at apply time, so an open box uses the latest options instead of the ones it opened with.
const renameOptions = Facet.define<PythonRenameOptions, PythonRenameOptions>({
  combine: (values) => values[0],
})

const occurrenceMark = Decoration.mark({ class: 'cm-python-rename-occurrence' })

function occurrenceDecorations(session: RenameSession): DecorationSet {
  return Decoration.set(session.ranges.map((range) => occurrenceMark.range(range.from, range.to)))
}

const renameSession = StateField.define<RenameSession | null>({
  create: () => null,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (effect.is(startRename)) next = effect.value
      if (effect.is(stopRename)) next = null
    }
    return next
  },
  provide: (field) =>
    EditorView.decorations.from(field, (session) =>
      session === null ? Decoration.none : occurrenceDecorations(session)
    ),
})

// ============================================
// Opening
// ============================================

function occurrencesOf(text: string, name: string): SymbolRange[] {
  const ranges: SymbolRange[] = []
  const pattern = new RegExp(String.raw`\b${name}\b`, 'g')
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    ranges.push({ from: match.index, to: match.index + name.length })
  }
  return ranges
}

function openRename(view: EditorView): boolean {
  const cursor = view.state.selection.main.head
  const word = view.state.wordAt(cursor)
  if (word === null) return false

  const name = view.state.sliceDoc(word.from, word.to)
  view.dispatch({
    effects: startRename.of({
      name,
      cursor,
      ranges: occurrencesOf(view.state.doc.toString(), name),
    }),
  })
  // Reading layout runs the pending measure pass, so the box is placed now, not a frame later off screen.
  view.coordsAtPos(cursor)
  return true
}

// ============================================
// Applying
// ============================================

function toChange(doc: Text, edit: PythonRenameEdit) {
  return {
    from: doc.line(edit.from_line).from + edit.from_column,
    to: doc.line(edit.to_line).from + edit.to_column,
    insert: edit.text,
  }
}

function isHostSymbol(name: string, options: PythonRenameOptions): boolean {
  return options.inputVariableNames.includes(name) || options.exportNames.includes(name)
}

function applyRename(
  view: EditorView,
  session: RenameSession,
  newName: string,
  options: PythonRenameOptions,
  showError: (message: string) => void
): void {
  const line = view.state.doc.lineAt(session.cursor)
  renamePython({
    script: view.state.doc.toString(),
    line: line.number,
    column: session.cursor - line.from,
    new_name: newName,
    interpreter: options.interpreter,
  }).then(
    ({ edits }) => {
      view.dispatch({
        changes: edits.map((edit) => toChange(view.state.doc, edit)),
        effects: stopRename.of(null),
      })
      const { onRenameSymbol } = options
      if (onRenameSymbol && isHostSymbol(session.name, options)) {
        onRenameSymbol(session.name, newName)
      }
    },
    (error: unknown) => {
      showError((error as Error).message)
    }
  )
}

// ============================================
// The box
// ============================================

let hintCount = 0

function createRenameBox(view: EditorView, session: RenameSession): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'cm-python-rename'
  dom.dataset.testid = 'python-rename-box'

  hintCount += 1
  const hintId = `python-rename-hint-${hintCount}`

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'cm-python-rename-input'
  input.value = session.name
  input.dataset.testid = 'python-rename-input'
  input.setAttribute('aria-label', 'New name')
  input.setAttribute('aria-describedby', hintId)

  const hint = document.createElement('div')
  hint.id = hintId
  hint.className = 'cm-python-rename-hint'
  hint.dataset.testid = 'python-rename-hint'
  hint.textContent = RENAME_HINT

  const errorSlot = document.createElement('div')
  errorSlot.className = 'cm-python-rename-error-slot'

  dom.append(input, hint, errorSlot)

  const showError = (message: string): void => {
    const error = document.createElement('div')
    error.className = 'cm-python-rename-error'
    error.dataset.testid = 'python-rename-error'
    error.setAttribute('role', 'alert')
    error.textContent = message
    errorSlot.replaceChildren(error)
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({ effects: stopRename.of(null) })
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      applyRename(view, session, input.value, view.state.facet(renameOptions), showError)
    }
  })

  // Per PYRUN-19 the name opens selected, so the first keystroke replaces it.
  return {
    dom,
    mount: () => {
      input.focus()
      input.select()
    },
  }
}

const boxFactories = new WeakMap<RenameSession, (view: EditorView) => TooltipView>()

// CodeMirror keeps an open tooltip only while its create keeps its identity, so one per session.
function boxFactory(session: RenameSession): (view: EditorView) => TooltipView {
  let create = boxFactories.get(session)
  if (create === undefined) {
    create = (view) => createRenameBox(view, session)
    boxFactories.set(session, create)
  }
  return create
}

function renameTooltip(session: RenameSession | null): Tooltip | null {
  if (session === null) return null
  return { pos: session.cursor, above: false, create: boxFactory(session) }
}

// ============================================
// Extension
// ============================================

const renameTheme = EditorView.baseTheme({
  '.cm-python-rename-occurrence': {
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: '2px',
  },
  '.cm-python-rename': {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '6px 8px',
  },
  '.cm-python-rename-input': {
    font: 'inherit',
    padding: '2px 4px',
  },
  '.cm-python-rename-hint': {
    fontSize: '11px',
    opacity: '0.75',
  },
  '.cm-python-rename-error': {
    fontSize: '11px',
    color: '#f87171',
  },
})

export function createPythonRenameExtension(options: PythonRenameOptions): Extension {
  return [
    renameSession,
    renameOptions.of(options),
    showTooltip.compute([renameSession], (state) => renameTooltip(state.field(renameSession))),
    keymap.of([{ key: 'F2', run: openRename }]),
    renameTheme,
  ]
}
