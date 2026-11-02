/** Leaving a code editor (CodeMirror) without a click or a key that could close the sheet or window around it. */

import { expect, type Locator } from './playwright-fixtures'

/** Every suggestion list on the page; the lists are parented on the body, not in the editor. */
export const SUGGESTION_LIST = '.cm-tooltip-autocomplete'

/**
 * Move focus off the editor, then assert no suggestion list is open. The editor closes its list on
 * blur, and a list still waiting to open never opens, so nothing can cover the next click.
 * `editor` is the editor's `.cm-content` or any element around it, such as a sheet or a window.
 */
export async function leaveExpressionEditor(editor: Locator): Promise<void> {
  await editor.first().evaluate((element) => {
    const active = element.ownerDocument.activeElement
    if (!(active instanceof HTMLElement) || active.closest('.cm-editor') === null) return
    if (element === active || element.contains(active)) active.blur()
  })
  await expect(editor.page().locator(SUGGESTION_LIST), 'no suggestion list is open').toHaveCount(0)
}
