/**
 * Autocomplete Tooltip Width Sync
 *
 * CodeMirror's autocomplete tooltip is rendered in document.body and sizes
 * itself to the longest completion item by default. Long variable names blow
 * the dropdown out far past the input field, overlapping adjacent UI.
 *
 * This module mirrors the contract of VariableComboboxBase (used for output-
 * binding and variable-ref pickers): the dropdown width tracks the trigger
 * input's width with a 320 px floor, and long item labels truncate via the
 * autocomplete theme rules in expression-theme.ts.
 *
 * Implementation:
 *   - A document-level MutationObserver watches for new .cm-tooltip-autocomplete
 *     nodes added under body and sizes each one to the currently focused
 *     CodeMirror editor's width.
 *   - A per-editor ViewPlugin re-syncs on editor resize (so a modal-resize
 *     while autocomplete is open keeps the dropdown in step with the field).
 */

import { EditorView, ViewPlugin } from '@codemirror/view'

export const MIN_DROPDOWN_WIDTH = 320

/** Apply width and max-width to the tooltip based on the editor's width. */
export function sizeTooltipForEditor(tooltip: HTMLElement, editorDom: HTMLElement) {
  const width = Math.max(editorDom.offsetWidth, MIN_DROPDOWN_WIDTH)
  tooltip.style.width = `${width}px`
  tooltip.style.maxWidth = `${width}px`
}

/** Find the focused CodeMirror editor wrapper, if any. */
export function focusedEditorDom(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cm-editor.cm-focused')
}

/** Process a node added to body: if it (or a descendant) is the autocomplete
 * tooltip, size it to the focused editor's width. Exported for unit testing. */
export function handleAddedNode(node: Node) {
  if (!(node instanceof HTMLElement)) return
  const tooltip = node.classList.contains('cm-tooltip-autocomplete')
    ? node
    : node.querySelector<HTMLElement>('.cm-tooltip-autocomplete')
  if (!tooltip) return
  const editor = focusedEditorDom()
  if (!editor) return
  sizeTooltipForEditor(tooltip, editor)
}

let bodyWatcher: MutationObserver | null = null

export function installBodyWatcher() {
  if (bodyWatcher) return
  bodyWatcher = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(handleAddedNode)
    }
  })
  bodyWatcher.observe(document.body, { childList: true, subtree: false })
}

/** Test-only: reset the global watcher state between tests. */
export function _resetBodyWatcherForTests() {
  bodyWatcher?.disconnect()
  bodyWatcher = null
}

/**
 * Per-editor plugin class: ensures the body watcher is installed and re-syncs
 * the tooltip width when the editor itself is resized (e.g., user drags the
 * modal's resize handle while autocomplete is open).
 *
 * Exported for direct unit testing - in production it is wrapped via
 * ViewPlugin.fromClass below.
 */
export class AutocompleteWidthSyncPlugin {
  private readonly resizeObserver: ResizeObserver

  constructor(view: EditorView) {
    installBodyWatcher()
    this.resizeObserver = new ResizeObserver(() => {
      const tooltip = document.querySelector<HTMLElement>('.cm-tooltip-autocomplete')
      if (tooltip) sizeTooltipForEditor(tooltip, view.dom)
    })
    this.resizeObserver.observe(view.dom)
  }

  destroy() {
    this.resizeObserver.disconnect()
  }
}

/**
 * ViewPlugin: ensures the body-level watcher is installed and re-syncs the
 * tooltip width when the editor is resized.
 */
export const autocompleteWidthSync = ViewPlugin.fromClass(AutocompleteWidthSyncPlugin)
