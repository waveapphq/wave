/**
 * Tests for the plain-text editor base every inspect / value editor loads.
 *
 * Contract under test:
 *   - the scroller keeps its own wheel: overscroll-behavior contain, so a wheel
 *     at the editor's end never reaches the page behind the sheet
 *   - the value color follows the valueColor flag (a script body reads as code)
 *   - code reads in var(--foreground) as is: the token is an oklch value
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { createPlainTextEditorExtensions } from '@/lib/codemirror/plain-text-editor'

const views: EditorView[] = []
const parents: HTMLElement[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  views.length = 0
  for (const parent of parents) parent.remove()
  parents.length = 0
})

function mount(options: { valueColor?: boolean } = {}): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const view = new EditorView({
    state: EditorState.create({
      doc: 'a = 1',
      extensions: createPlainTextEditorExtensions(options),
    }),
    parent,
  })
  views.push(view)
  parents.push(parent)
  return view
}

describe('createPlainTextEditorExtensions', () => {
  it('contains the scroller overscroll so a wheel never reaches the page', () => {
    const scroller = mount().dom.querySelector('.cm-scroller') as HTMLElement

    expect(scroller).not.toBeNull()
    expect(getComputedStyle(scroller).overscrollBehavior).toBe('contain')
  })

  it('paints the content as a value or as code', () => {
    const asValue = mount({ valueColor: true }).dom.querySelector('.cm-content') as HTMLElement
    const asCode = mount({ valueColor: false }).dom.querySelector('.cm-content') as HTMLElement

    expect(getComputedStyle(asValue).color).toBe('rgb(125, 211, 252)')
    expect(getComputedStyle(asCode).color).not.toBe('rgb(125, 211, 252)')
  })

  it('paints code in var(--foreground) unwrapped, since the token is an oklch value', () => {
    const view = mount({ valueColor: false })

    expect(contentColorRule(view)).toBe('var(--foreground)')
  })

  it('keeps the value color for a value body', () => {
    const view = mount({ valueColor: true })

    expect(contentColorRule(view)).toBe('rgb(125, 211, 252)')
  })
})

function contentColorRule(view: EditorView): string | undefined {
  const themeClasses = new Set(view.dom.classList)
  const colors: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      const match = /^\.(\S+) \.cm-content$/.exec(rule.selectorText)
      if (!match || !themeClasses.has(match[1])) continue
      const color = rule.style.getPropertyValue('color')
      if (color) colors.push(color)
    }
  }
  return colors.at(-1)
}
