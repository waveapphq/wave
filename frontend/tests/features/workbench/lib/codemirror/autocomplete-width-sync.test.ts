/**
 * Autocomplete Tooltip Width Sync Tests
 *
 * Pins the contract that the CodeMirror autocomplete dropdown width tracks
 * the focused editor's width with a 320 px floor (mirrors VariableComboboxBase
 * via `var(--radix-popover-trigger-width)` + `min-width: 320px`).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { EditorView } from '@codemirror/view'
import {
  MIN_DROPDOWN_WIDTH,
  sizeTooltipForEditor,
  focusedEditorDom,
  handleAddedNode,
  installBodyWatcher,
  AutocompleteWidthSyncPlugin,
  autocompleteWidthSync,
  _resetBodyWatcherForTests,
} from '@/features/workbench/lib/codemirror/autocomplete-width-sync'

function makeEditor(width: number): HTMLElement {
  const editor = document.createElement('div')
  editor.classList.add('cm-editor', 'cm-focused')
  Object.defineProperty(editor, 'offsetWidth', { value: width, configurable: true })
  document.body.appendChild(editor)
  return editor
}

function makeTooltip(): HTMLElement {
  const tooltip = document.createElement('div')
  tooltip.classList.add('cm-tooltip-autocomplete')
  return tooltip
}

beforeEach(() => {
  _resetBodyWatcherForTests()
  document.body.innerHTML = ''
})

afterEach(() => {
  _resetBodyWatcherForTests()
  document.body.innerHTML = ''
})

describe('sizeTooltipForEditor', () => {
  it('sizes the tooltip to the editor width when above the 320 px floor', () => {
    const editor = makeEditor(420)
    const tooltip = makeTooltip()
    sizeTooltipForEditor(tooltip, editor)
    expect(tooltip.style.width).toBe('420px')
    expect(tooltip.style.maxWidth).toBe('420px')
  })

  it('floors at the 320 px minimum when the editor is narrower', () => {
    const editor = makeEditor(180)
    const tooltip = makeTooltip()
    sizeTooltipForEditor(tooltip, editor)
    expect(tooltip.style.width).toBe(`${MIN_DROPDOWN_WIDTH}px`)
    expect(tooltip.style.maxWidth).toBe(`${MIN_DROPDOWN_WIDTH}px`)
  })

  it('caps at exactly the editor width when editor matches the floor', () => {
    const editor = makeEditor(MIN_DROPDOWN_WIDTH)
    const tooltip = makeTooltip()
    sizeTooltipForEditor(tooltip, editor)
    expect(tooltip.style.width).toBe(`${MIN_DROPDOWN_WIDTH}px`)
  })
})

describe('focusedEditorDom', () => {
  it('returns the .cm-editor.cm-focused element when one is present', () => {
    const editor = makeEditor(400)
    const found = focusedEditorDom()
    expect(found).toBe(editor)
  })

  it('returns null when no editor is focused', () => {
    expect(focusedEditorDom()).toBeNull()
  })

  it('ignores non-focused .cm-editor elements', () => {
    const blurred = document.createElement('div')
    blurred.classList.add('cm-editor')
    document.body.appendChild(blurred)
    expect(focusedEditorDom()).toBeNull()
  })
})

describe('handleAddedNode', () => {
  it('sizes a directly-added .cm-tooltip-autocomplete to the focused editor width', () => {
    makeEditor(500)
    const tooltip = makeTooltip()
    handleAddedNode(tooltip)
    expect(tooltip.style.width).toBe('500px')
  })

  it('sizes a tooltip nested inside the added node', () => {
    makeEditor(500)
    const wrapper = document.createElement('div')
    const tooltip = makeTooltip()
    wrapper.appendChild(tooltip)
    handleAddedNode(wrapper)
    expect(tooltip.style.width).toBe('500px')
  })

  it('does nothing when the added node is unrelated', () => {
    makeEditor(500)
    const div = document.createElement('div')
    handleAddedNode(div)
    expect(div.style.width).toBe('')
  })

  it('does nothing when no editor is focused (no width to track)', () => {
    const tooltip = makeTooltip()
    handleAddedNode(tooltip)
    expect(tooltip.style.width).toBe('')
  })

  it('ignores non-element nodes (e.g. text nodes from MutationRecord lists)', () => {
    makeEditor(500)
    const text = document.createTextNode('garbage')
    expect(() => handleAddedNode(text)).not.toThrow()
  })
})

describe('AutocompleteWidthSyncPlugin', () => {
  function fakeView(editorDom: HTMLElement): EditorView {
    return { dom: editorDom } as EditorView
  }

  it('installs the body watcher on construction so tooltips appended after mount get sized', async () => {
    const editor = makeEditor(360)
    const plugin = new AutocompleteWidthSyncPlugin(fakeView(editor))

    const tooltip = makeTooltip()
    document.body.appendChild(tooltip)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(tooltip.style.width).toBe('360px')
    plugin.destroy()
  })

  it('re-syncs an open tooltip when the editor is resized (ResizeObserver fires)', () => {
    const editor = makeEditor(280)
    // Tooltip is already in DOM (autocomplete was already open) when plugin mounts.
    const tooltip = makeTooltip()
    document.body.appendChild(tooltip)

    new AutocompleteWidthSyncPlugin(fakeView(editor))

    // The mock ResizeObserver fires synchronously on observe(); the callback
    // queries for the tooltip and sizes it. Editor is 280 px → floor at 320.
    expect(tooltip.style.width).toBe(`${MIN_DROPDOWN_WIDTH}px`)
  })

  it('handles destroy() cleanly', () => {
    const editor = makeEditor(360)
    const plugin = new AutocompleteWidthSyncPlugin(fakeView(editor))
    expect(() => plugin.destroy()).not.toThrow()
  })

  it('exposes a non-null ViewPlugin from ViewPlugin.fromClass(...)', () => {
    expect(autocompleteWidthSync).toBeTruthy()
  })
})

describe('installBodyWatcher', () => {
  it('sizes a tooltip appended to body asynchronously', async () => {
    makeEditor(450)
    installBodyWatcher()

    const tooltip = makeTooltip()
    document.body.appendChild(tooltip)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tooltip.style.width).toBe('450px')
  })

  it('is idempotent - calling twice does not double-fire on a single mutation', async () => {
    makeEditor(450)
    installBodyWatcher()
    installBodyWatcher()

    const tooltip = makeTooltip()
    document.body.appendChild(tooltip)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(tooltip.style.width).toBe('450px')
  })
})
