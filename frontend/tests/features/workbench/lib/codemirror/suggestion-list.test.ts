/**
 * The shared suggestion list belongs to the editor that has focus: a list still being fetched
 * when the editor loses focus never opens, and an open list closes on blur.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { completionStatus, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'

import { suggestionList } from '@/features/workbench/lib/codemirror/suggestion-list'

const RESULT: CompletionResult = { from: 0, options: [{ label: 't_src' }] }
// Past the library's typing delay (100 ms) and its result sync time (100 ms).
const PAST_DELAY_MS = 300

let view: EditorView
let source: ReturnType<typeof vi.fn<(context: CompletionContext) => Promise<CompletionResult | null>>>
let release: (result: CompletionResult | null) => void

function mount(): void {
  view = new EditorView({
    state: EditorState.create({ doc: '', extensions: [suggestionList({ override: [source], activateOnTyping: true })] }),
    parent: document.body,
  })
}

function type(text: string): void {
  view.dispatch({
    changes: { from: view.state.doc.length, insert: text },
    selection: { anchor: view.state.doc.length + text.length },
    userEvent: 'input.type',
  })
}

function blur(relatedTarget: EventTarget | null = null): void {
  view.contentDOM.dispatchEvent(new FocusEvent('blur', { relatedTarget }))
}

beforeEach(() => {
  vi.useFakeTimers()
  source = vi.fn(
    () =>
      new Promise<CompletionResult | null>((resolve) => {
        release = resolve
      }),
  )
  mount()
})

afterEach(() => {
  view.destroy()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('suggestionList', () => {
  it('opens the list while the editor keeps focus', async () => {
    type('t_s')
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    release(RESULT)
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    expect(completionStatus(view.state)).toBe('active')
  })

  it('never opens a list whose fetch ends after the editor lost focus', async () => {
    type('t_s')
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    expect(source).toHaveBeenCalledTimes(1)
    blur()
    release(RESULT)
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    expect(completionStatus(view.state)).toBeNull()
  })

  it('never starts a fetch when the editor loses focus inside the typing delay', async () => {
    type('t_s')
    blur()
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    expect(source).not.toHaveBeenCalled()
    expect(completionStatus(view.state)).toBeNull()
  })

  it('closes an open list at once when the editor loses focus', async () => {
    type('t_s')
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    release(RESULT)
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    expect(completionStatus(view.state)).toBe('active')
    blur()
    expect(completionStatus(view.state)).toBeNull()
  })

  it('closes an open list when focus moves to another field', async () => {
    type('t_s')
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    release(RESULT)
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    const other = document.createElement('input')
    document.body.appendChild(other)
    blur(other)
    expect(completionStatus(view.state)).toBeNull()
  })

  it('keeps the list open when focus moves into the list itself', async () => {
    type('t_s')
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    release(RESULT)
    await vi.advanceTimersByTimeAsync(PAST_DELAY_MS)
    const list = document.createElement('div')
    list.className = 'cm-tooltip-autocomplete'
    const option = document.createElement('button')
    list.appendChild(option)
    document.body.appendChild(list)
    blur(option)
    expect(completionStatus(view.state)).toBe('active')
  })
})
