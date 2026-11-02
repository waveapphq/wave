/**
 * The null look (VMGR-93, FIELD-5, REQ-3.1.3.20): the text `null`, italic, monospace, in Text Muted
 * (`--color-text-muted`), never dimmed. Asserted through computed style, not class names.
 */

import { expect, type Locator } from './playwright-fixtures'

interface RenderedLook {
  fontStyle: string
  monospace: boolean
  muted: boolean
  opacity: number
}

/** The look of the innermost element that renders `target`'s whole text, and its effective opacity. */
async function readLook(target: Locator): Promise<RenderedLook> {
  return target.evaluate((host) => {
    const whole = host.textContent ?? ''
    let el: Element = host
    while (el.children.length === 1 && (el.children[0].textContent ?? '') === whole) {
      el = el.children[0]
    }
    const style = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-text-muted)'
    document.body.appendChild(probe)
    const mutedColor = getComputedStyle(probe).color
    probe.remove()
    let opacity = 1
    for (let node: Element | null = el; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return {
      fontStyle: style.fontStyle,
      monospace: /monospace/i.test(style.fontFamily),
      muted: style.color === mutedColor,
      opacity: Math.round(opacity * 1000) / 1000,
    }
  })
}

/** `target` reads exactly `null` in the null look and nothing above it dims it. */
export async function expectNullLook(target: Locator, what: string): Promise<void> {
  await expect(target, `${what} reads null`).toHaveText('null')
  await expect(async () => {
    expect(await readLook(target), `${what} is in the null look and not dimmed (VMGR-93)`).toEqual({
      fontStyle: 'italic',
      monospace: true,
      muted: true,
      opacity: 1,
    })
  }).toPass({ timeout: 10_000 })
}
