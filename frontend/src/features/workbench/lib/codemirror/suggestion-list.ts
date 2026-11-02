/** The suggestion list of every WAVE code editor: it belongs to the editor that has focus. */

import { autocompletion, closeCompletion } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

type CompletionConfig = NonNullable<Parameters<typeof autocompletion>[0]>

const LIST_SELECTOR = '.cm-tooltip-autocomplete'

// The library closes a list only if it is already on screen at blur; one still being fetched would open after.
const closeOnBlur = ViewPlugin.define(() => ({}), {
  eventObservers: {
    blur(event, view) {
      const next = event.relatedTarget
      if (next instanceof Element && next.closest(LIST_SELECTOR)) return
      closeCompletion(view)
    },
  },
})

/** Autocompletion with `config` whose list, open or pending, closes when the editor loses focus. */
export function suggestionList(config: CompletionConfig): Extension {
  return [autocompletion(config), closeOnBlur]
}
