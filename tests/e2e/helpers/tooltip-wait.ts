/** Frame-rate waits on the shared tooltip; each runs just before a spec's own tooltip assertion, with that assertion's condition and timeout. */

import { errors } from '@playwright/test'
import type { Locator, Page } from './playwright-fixtures'

const OPEN_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'

type TooltipCheck = { selector: string; want: 'visible' | 'text' | 'none'; text: string }

// Runs in the page: Playwright's strict single match, its visibility rule and its whitespace-normalized exact text.
function tooltipMatches(check: TooltipCheck): boolean {
  const found = document.querySelectorAll(check.selector)
  if (check.want === 'none') return found.length === 0
  if (found.length !== 1) return false
  const el = found[0] as HTMLElement
  if (check.want === 'text') {
    const normalize = (value: string) => value.replace(/[​­]/g, '').trim().replace(/\s+/g, ' ')
    return normalize(el.textContent ?? '') === normalize(check.text)
  }
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false
  if (getComputedStyle(el).visibility !== 'visible') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

async function waitOnFrames(page: Page, check: TooltipCheck, label: string, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(tooltipMatches, check, { polling: 'raf', timeout: timeoutMs })
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error
    const open = await page
      .evaluate((selector) => Array.from(document.querySelectorAll(selector), (el) => el.textContent ?? ''), OPEN_TOOLTIP)
      .catch(() => [] as string[])
    const wanted = check.want === 'text' ? `one open tooltip reading ${JSON.stringify(check.text)}` : check.want === 'none' ? 'no open tooltip' : 'one visible open tooltip'
    throw new Error(`${label}: expected ${wanted} within ${timeoutMs} ms; open tooltips now: ${JSON.stringify(open)}`)
  }
}

/** Resolve on the first frame where exactly one open tooltip is visible. */
export function waitForTooltipVisible(page: Page, label: string, timeoutMs: number): Promise<void> {
  return waitOnFrames(page, { selector: OPEN_TOOLTIP, want: 'visible', text: '' }, label, timeoutMs)
}

/** Resolve on the first frame where the one open tooltip's accessible copy reads `text` exactly. */
export function waitForTooltipText(page: Page, text: string, label: string, timeoutMs: number): Promise<void> {
  return waitOnFrames(page, { selector: `${OPEN_TOOLTIP} [role="tooltip"]`, want: 'text', text }, label, timeoutMs)
}

/** Resolve on the first frame with no open tooltip. */
export function waitForTooltipClosed(page: Page, label: string, timeoutMs: number): Promise<void> {
  return waitOnFrames(page, { selector: OPEN_TOOLTIP, want: 'none', text: '' }, label, timeoutMs)
}

/** Scroll `box` into view, let the scroll events land, then click it: a scroll seen after a key press closes the tooltip that key opens. */
export async function clickScrolledIntoView(box: Locator): Promise<void> {
  await box.scrollIntoViewIfNeeded()
  await box.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await box.click()
}
