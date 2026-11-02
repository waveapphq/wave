/** Reads of a Block row's one value field (FIELD-1, FIELD-9, FIELD-10): its box, its line, its icons and its look. */

import { expect, type APIRequestContext, type Locator, type Page } from './playwright-fixtures'
import { BACKEND_URL } from './config'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const fieldRow = (sheet: Locator, name: string): Locator => sheet.locator(`[data-testid="param-row-${name}"]`)

/** The bordered field group: left icon, text box, reset / null buttons. */
export const fieldGroup = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator('[data-slot="input-group"]').first()

/** The field's text box; a drawn line keeps its whole text here under the colored overlay. */
export const fieldBox = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator('input[data-slot="input-group-control"]').first()

export const fieldExpand = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-expand-${name}"]`)

export const fieldReset = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-reset-${name}"]`)

export const fieldToggle = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator('[data-testid="expression-toggle"]')

/** The row's name cell text (label and any required star). */
export const fieldLabel = (sheet: Locator, name: string): Locator =>
  fieldRow(sheet, name).locator('td:nth-child(2) > span').first()

/** A list or map written on one line the way the field writes it: `, ` between entries, `: ` after a key. */
export function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${oneLine(item)}`).join(', ')}}`
  }
  return JSON.stringify(value)
}

export async function rectOf(target: Locator, what: string): Promise<Rect> {
  const found = await target.boundingBox()
  expect(found, `${what} has a box`).not.toBeNull()
  return found!
}

export function expectNear(actual: number, expected: number, what: string, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

/** Waits until the element's own and its children's animations (an opening zoom or fade) have run out. */
export async function settled(target: Locator): Promise<void> {
  await target.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))),
  )
}

/** `inner` lies wholly inside `outer`. */
export async function expectInside(inner: Locator, outer: Locator, what: string): Promise<void> {
  const a = await rectOf(inner, what)
  const b = await rectOf(outer, `the box around ${what}`)
  expect(a.x, `${what}: left edge inside`).toBeGreaterThanOrEqual(b.x - 0.5)
  expect(a.y, `${what}: top edge inside`).toBeGreaterThanOrEqual(b.y - 0.5)
  expect(a.x + a.width, `${what}: right edge inside`).toBeLessThanOrEqual(b.x + b.width + 0.5)
  expect(a.y + a.height, `${what}: bottom edge inside`).toBeLessThanOrEqual(b.y + b.height + 0.5)
}

/** Nothing covers the element: the topmost element at its center is the element or a child of it. */
export async function expectUncovered(target: Locator, what: string): Promise<void> {
  await expect(target, `${what} is shown`).toBeVisible()
  const onTop = await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return hit !== null && (hit === el || el.contains(hit))
  })
  expect(onTop, `${what} is not covered`).toBe(true)
}

/** The text runs past the box and is cut with "…" at its end. */
export async function expectCut(box: Locator, what: string): Promise<void> {
  const cut = await box.evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    wrap: getComputedStyle(el).whiteSpace,
    wider: el.scrollWidth > el.clientWidth,
  }))
  expect(cut, `${what} is cut with "…"`).toEqual({ overflow: 'ellipsis', wrap: 'nowrap', wider: true })
}

/** How many lines an element's text takes. */
export function lineCount(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    const height = el.getBoundingClientRect().height
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
    return Math.round(height / lineHeight)
  })
}

/** The colored runs of a drawn line (`{{ }}` entries in their own color), as text and sRGB hex color. */
export function lineSegments(sheet: Locator, name: string): Promise<Array<{ text: string; color: string }>> {
  return fieldRow(sheet, name)
    .locator('[data-slot="input-group"] span.truncate')
    .first()
    .evaluate((line) => {
      const hex = (css: string): string => {
        const ctx = document.createElement('canvas').getContext('2d')!
        ctx.fillStyle = css
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
        return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
      }
      return Array.from(line.childNodes).map((node) => ({
        text: node.textContent ?? '',
        color: hex(getComputedStyle(node instanceof Element ? node : line).color),
      }))
    })
}

/** Open a collapsed group card of the window. */
export async function openGroup(sheet: Locator, group: string): Promise<void> {
  const header = sheet.locator(`[data-testid="group-header-${group}"]`)
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Close a Block window that holds no change. */
export async function closeUnchangedSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)
}

/** A Block of the stored Test, as GET /tests/{id} returns it. */
export async function storedBlock(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
): Promise<Record<string, any>> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(response.ok(), `GET /tests/${testId} answered ${response.status()}`).toBeTruthy()
  const nodes = ((await response.json()).data?.workflow?.nodes ?? []) as Array<Record<string, any>>
  const node = nodes.find((entry) => entry.id === nodeId)
  expect(node, `Block ${nodeId} is in the stored Test`).toBeTruthy()
  return node!.data as Record<string, any>
}

export interface TlsCapabilities {
  ciphers: Array<{ openssl: string; iana: string; min_version: string; max_version: string }>
  defaults: Record<string, Record<string, string[]>>
}

/** The TLS cipher catalog and each Block's unset Cipher Suites list per TLS range. */
export async function tlsCapabilities(request: APIRequestContext): Promise<TlsCapabilities> {
  const response = await request.get(`${BACKEND_URL}/api/v1/system/tls-capabilities`)
  expect(response.ok(), `GET /api/v1/system/tls-capabilities answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body) as TlsCapabilities
}

/** Delete a seeded Test and the workbench draft that holds it. */
export async function deleteSeededTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  if (!testId) return
  const response = await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect([204, 404], `teardown DELETE /tests/${testId} answered ${response.status()}`).toContain(response.status())
}
