/**
 * V-VMGR-10: Watchers - Null and Empty Bodies Centered
 * Design Decisions: VMGR-93 (one null look, a null item inside a grid included), VMGR-94 (null / no
 * items centered at any watcher size; the view select stays for null), VMGR-106 (the watcher only shows
 * values: no Edit)
 * REQ: REQ-3.1.3.20 (null is the only empty value), REQ-3.1.3.11 (variable watching UI panel)
 *
 * Pass Criteria:
 * 1. The stored Test holds null for null_string, null_integer, null_table and null_array, [] for
 *    empty_array and ["a", null, "c"] for arr_null_item.
 * 2. Each null watcher's body reads `null` in the null look (italic, mono, Text Muted, FIELD-5); the empty array
 *    reads `no items`, italic and muted. As opened, null_integer is the narrowest and shortest watcher
 *    and null_table and null_array are taller than null_string.
 * 3. For each of the five watchers, the center of the `null` / `no items` text lies within 2px of the
 *    body's center on both axes (horizontally the body box, vertically between header and footer).
 * 4. Footers, left to right: null_string `Current` pill, `Auto` format select; null_integer
 *    `Current`; null_table and null_array `Current`, `Visual` view select; empty_array
 *    `Current`, `Visual`, `0 items`. The null watchers show no count; no watcher has an Edit button.
 * 5. After null_table and null_string are resized larger and null_array smaller (both axes), every text
 *    is still centered within 2px.
 * 6. The null array's view select offers Visual and Code; Code shows `null` with no count; back on
 *    Visual the text is centered again (VMGR-94).
 * 7. An array holding a null item shows that item `null` in the null look while its string items stay
 *    upright (VMGR-93); footer `3 items`.
 * 8. Screenshots of the five watchers before and after the resize and of the null-item array are attached.
 */

import {
  test,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { getTest } from '../../helpers/element-types'
import { expandVariableManager } from '../../helpers/variable-create'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/canvas/v-vmgr-10/fixture.json')
const VIEWPORT = { width: 1800, height: 1200 }
const CENTER_TOLERANCE = 2

type WatchedName = 'null_string' | 'null_integer' | 'null_array' | 'empty_array' | 'null_table'

// Top-left slots over the canvas, clear of each other and of the Variable Manager on the right.
const SLOTS: Array<[WatchedName, { x: number; y: number }]> = [
  ['null_string', { x: 300, y: 80 }],
  ['null_integer', { x: 760, y: 80 }],
  ['null_array', { x: 300, y: 300 }],
  ['empty_array', { x: 760, y: 300 }],
  ['null_table', { x: 300, y: 640 }],
]
const SLOTS_RIGHT_EDGE = 1160

const BODY_TEXT: Record<WatchedName, string> = {
  null_string: 'null',
  null_integer: 'null',
  null_array: 'null',
  empty_array: 'no items',
  null_table: 'null',
}

type FooterSelect = { testId: 'format-dropdown' | 'view-dropdown'; text: string } | null

const FOOTERS: Record<WatchedName, { select: FooterSelect; metric: string | null }> = {
  null_string: { select: { testId: 'format-dropdown', text: 'Auto' }, metric: null },
  null_integer: { select: null, metric: null },
  null_array: { select: { testId: 'view-dropdown', text: 'Visual' }, metric: null },
  empty_array: { select: { testId: 'view-dropdown', text: 'Visual' }, metric: '0 items' },
  null_table: { select: { testId: 'view-dropdown', text: 'Visual' }, metric: null },
}

const createdTests: string[] = []

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
}

// ---------------------------------------------------------------------------
// Locators and readers
// ---------------------------------------------------------------------------

const rowFor = (page: Page, name: string): Locator =>
  page.locator(`[data-testid="variable-manager-content"] [aria-label="Variable ${name}"]`)

const watcherFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

async function openWatcher(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const watcher = watcherFor(page, name)
  await expect(watcher).toBeVisible()
  return watcher
}

/** The muted-foreground color as the browser resolves it in the current theme. */
async function mutedForeground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.className = 'text-muted-foreground'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
}

/** Text Muted, the one gray of null (FIELD-5), as the browser resolves it in the current theme. */
async function textMutedColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-text-muted)'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
}

/** Drag a watcher by its header until its top-left corner sits at `to`. */
async function moveWatcherTo(page: Page, watcher: Locator, to: { x: number; y: number }): Promise<void> {
  const handle = watcher.locator('[data-testid$="-drag-handle"]')
  await expect(async () => {
    const sheet = (await watcher.boundingBox())!
    if (Math.abs(sheet.x - to.x) > 4 || Math.abs(sheet.y - to.y) > 4) {
      const grip = (await handle.boundingBox())!
      const startX = grip.x + 12
      const startY = grip.y + grip.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX + to.x - sheet.x, startY + to.y - sheet.y, { steps: 8 })
      await page.mouse.up()
    }
    const placed = (await watcher.boundingBox())!
    expect(Math.abs(placed.x - to.x)).toBeLessThanOrEqual(4)
    expect(Math.abs(placed.y - to.y)).toBeLessThanOrEqual(4)
  }).toPass({ timeout: 15_000 })
}

/** Drag the corner grip until the watcher is larger (dx, dy > 0) or smaller on both axes. */
async function resizeWatcher(
  page: Page,
  watcher: Locator,
  dx: number,
  dy: number,
): Promise<{ before: { width: number; height: number }; after: { width: number; height: number } }> {
  const before = (await watcher.boundingBox())!
  const grow = dx > 0
  const changed = (box: { width: number; height: number }): boolean =>
    grow
      ? box.width > before.width + 10 && box.height > before.height + 10
      : box.width < before.width - 10 && box.height < before.height - 10
  const grip = watcher.locator('[data-testid="dialog-resize-corner"]')
  await expect(async () => {
    if (!changed((await watcher.boundingBox())!)) {
      const box = (await grip.boundingBox())!
      const startX = box.x + box.width / 2
      const startY = box.y + box.height / 2
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.mouse.move(startX + dx, startY + dy, { steps: 6 })
      await page.mouse.up()
    }
    expect(changed((await watcher.boundingBox())!)).toBe(true)
  }).toPass({ timeout: 15_000 })
  const after = (await watcher.boundingBox())!
  return {
    before: { width: before.width, height: before.height },
    after: { width: after.width, height: after.height },
  }
}

interface Centering {
  text: string | null
  dx: number
  dy: number
  sheet: string
}

/** Where the body text sits against the body: its box horizontally, header bottom to footer top vertically. */
async function measureCentering(watcher: Locator, wanted: string): Promise<Centering> {
  return watcher.evaluate((section, label) => {
    const children = Array.from(section.children)
    const header = section.querySelector(':scope > [data-testid$="-drag-handle"]')
    const mode = section.querySelector('[data-testid="mode-dropdown"]')
    const footer = children.find((child) => mode !== null && child.contains(mode))
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT)
    let textNode: Node | null = null
    while (walker.nextNode()) {
      const node = walker.currentNode
      const inEditor = node.parentElement?.closest('.cm-content') ?? null
      if (node.textContent?.trim() === label && !inEditor && !header?.contains(node)) {
        textNode = node
        break
      }
    }
    const sheetBox = section.getBoundingClientRect()
    const sheet = `${Math.round(sheetBox.width)}x${Math.round(sheetBox.height)}`
    const body = children.find((child) => textNode !== null && child.contains(textNode))
    if (!textNode || !header || !footer || !body) return { text: null, dx: NaN, dy: NaN, sheet }
    const range = document.createRange()
    range.selectNodeContents(textNode)
    const text = range.getBoundingClientRect()
    const bodyBox = body.getBoundingClientRect()
    const top = header.getBoundingClientRect().bottom
    const bottom = footer.getBoundingClientRect().top
    return {
      text: label,
      dx: text.left + text.width / 2 - (bodyBox.left + bodyBox.right) / 2,
      dy: text.top + text.height / 2 - (top + bottom) / 2,
      sheet,
    }
  }, wanted)
}

async function expectCentered(watcher: Locator, name: WatchedName, when: string): Promise<void> {
  await expect(async () => {
    const seen = await measureCentering(watcher, BODY_TEXT[name])
    expect(seen.text, `${name} ${when}: body text`).toBe(BODY_TEXT[name])
    expect(
      Math.abs(seen.dx),
      `${name} ${when}: horizontal offset ${seen.dx.toFixed(2)}px in ${seen.sheet}`,
    ).toBeLessThanOrEqual(CENTER_TOLERANCE)
    expect(
      Math.abs(seen.dy),
      `${name} ${when}: vertical offset ${seen.dy.toFixed(2)}px in ${seen.sheet}`,
    ).toBeLessThanOrEqual(CENTER_TOLERANCE)
  }).toPass({ timeout: 5_000 })
}

async function expectFooter(watcher: Locator, name: WatchedName): Promise<void> {
  const { select, metric } = FOOTERS[name]
  const mode = watcher.locator('[data-testid="mode-dropdown"]')
  await expect(mode, `${name} Current pill`).toHaveText('Current')
  await expect(mode, `${name} Current pill color`).toHaveClass(/\bbg-amber-/)
  await expect(watcher.getByRole('button', { name: 'Edit', exact: true }), `${name} has no Edit`).toHaveCount(0)

  const format = watcher.locator('[data-testid="format-dropdown"]')
  const view = watcher.locator('[data-testid="view-dropdown"]')
  await expect(format, `${name} format select`).toHaveCount(select?.testId === 'format-dropdown' ? 1 : 0)
  await expect(view, `${name} view select`).toHaveCount(select?.testId === 'view-dropdown' ? 1 : 0)

  const count = watcher.locator('[data-testid="inspect-metric"]')
  if (metric === null) {
    await expect(count, `${name} shows no count`).toHaveCount(0)
  } else {
    await expect(count, `${name} count`).toHaveText(metric)
  }

  const order: Locator[] = [mode]
  if (select) {
    const control = watcher.locator(`[data-testid="${select.testId}"]`)
    await expect(control, `${name} ${select.testId}`).toHaveText(select.text)
    await expect(control).toBeEnabled()
    order.push(control)
  }
  if (metric !== null) order.push(count)
  const lefts = await Promise.all(order.map(async (el) => (await el.boundingBox())!.x))
  expect(lefts, `${name} footer order left to right`).toEqual([...lefts].sort((a, b) => a - b))
}

async function attachUnionShot(
  page: Page,
  testInfo: TestInfo,
  watchers: Locator[],
  name: string,
): Promise<void> {
  const boxes = await Promise.all(watchers.map(async (w) => (await w.boundingBox())!))
  const pad = 12
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const right = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const bottom = Math.min(VIEWPORT.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  const clip = { x: left, y: top, width: right - left, height: bottom - top }
  await testInfo.attach(name, { body: await page.screenshot({ clip }), contentType: 'image/png' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-10: null and empty watcher bodies', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    while (createdTests.length > 0) {
      const testId = createdTests.pop()!
      const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `DELETE /tests/${testId}: ${resp.status()}`).toBeTruthy()
    }
  })

  test('null / no items stay centered at every watcher size; footers keep their controls (VMGR-93, VMGR-94)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize(VIEWPORT)
    const testId = await importValidateAndNavigate(page, loadFixture())
    createdTests.push(testId)
    await expandVariableManager(page)

    await test.step('the stored Test holds the seeded null and empty values', async () => {
      const stored = await getTest(page.request, testId)
      for (const name of ['null_string', 'null_integer', 'null_table', 'null_array']) {
        expect(stored.variables[name]?.value ?? null, `${name} is stored null`).toBeNull()
      }
      expect(stored.variables.empty_array?.value).toEqual([])
      expect(stored.variables.arr_null_item?.value).toEqual(['a', null, 'c'])
    })

    const muted = await mutedForeground(page)
    const nullGray = await textMutedColor(page)
    const vmBox = (await page.locator('[data-testid="variable-manager"]').boundingBox())!
    expect(vmBox.x, 'the watcher slots stay clear of the Variable Manager').toBeGreaterThan(
      SLOTS_RIGHT_EDGE,
    )

    const watchers = {} as Record<WatchedName, Locator>
    await test.step('open the five watchers and lay them out side by side', async () => {
      for (const [name, slot] of SLOTS) {
        watchers[name] = await openWatcher(page, name)
        await moveWatcherTo(page, watchers[name], slot)
      }
    })

    await test.step('each body reads null / no items in the null look', async () => {
      for (const [name] of SLOTS) {
        const text = watchers[name].getByText(BODY_TEXT[name], { exact: true })
        await expect(text, `${name} body text`).toHaveCount(1)
        await expect(text).toHaveCSS('font-style', 'italic')
        await expect(text).toHaveCSS('font-family', /mono/i)
        await expect(text).toHaveCSS('color', BODY_TEXT[name] === 'null' ? nullGray : muted)
      }
    })

    await test.step('null_integer opens narrow and short; the complex watchers open tall', async () => {
      const boxes = {} as Record<WatchedName, { width: number; height: number }>
      for (const [name] of SLOTS) boxes[name] = (await watchers[name].boundingBox())!
      for (const [name] of SLOTS) {
        if (name === 'null_integer') continue
        expect(boxes.null_integer.width, `null_integer is narrower than ${name}`).toBeLessThan(boxes[name].width)
        expect(boxes.null_integer.height, `null_integer is shorter than ${name}`).toBeLessThan(boxes[name].height)
      }
      for (const name of ['null_table', 'null_array'] as const) {
        expect(boxes[name].height, `${name} is taller than null_string`).toBeGreaterThan(boxes.null_string.height)
      }
    })

    await test.step('each body text is centered both ways as opened (VMGR-94)', async () => {
      for (const [name] of SLOTS) await expectCentered(watchers[name], name, 'as opened')
    })

    await test.step('footers keep Current, their select and the count rule; no Edit (VMGR-94, VMGR-106)', async () => {
      for (const [name] of SLOTS) await expectFooter(watchers[name], name)
    })

    await attachUnionShot(
      page,
      testInfo,
      SLOTS.map(([name]) => watchers[name]),
      'watchers-null-centered.png',
    )

    await test.step('resize null_array smaller, null_string and null_table larger', async () => {
      const shrunk = await resizeWatcher(page, watchers.null_array, -30, -60)
      const grownString = await resizeWatcher(page, watchers.null_string, 50, 50)
      const grownTable = await resizeWatcher(page, watchers.null_table, 60, 80)
      testInfo.annotations.push({
        type: 'resize',
        description: JSON.stringify({ null_array: shrunk, null_string: grownString, null_table: grownTable }),
      })
    })

    await test.step('each body text is still centered both ways after the resize (VMGR-94)', async () => {
      for (const [name] of SLOTS) await expectCentered(watchers[name], name, 'after the resize')
    })

    await attachUnionShot(
      page,
      testInfo,
      SLOTS.map(([name]) => watchers[name]),
      'watchers-null-resized.png',
    )

    await test.step('the null array view select switches to Code and back (VMGR-94)', async () => {
      const watcher = watchers.null_array
      const view = watcher.locator('[data-testid="view-dropdown"]')
      await view.click()
      const options = page.getByRole('option')
      await expect(options).toHaveCount(2)
      await expect(options.nth(0)).toHaveText('Visual')
      await expect(options.nth(1)).toHaveText('Code')
      await page.getByRole('option', { name: 'Code', exact: true }).click()
      await expect(view).toHaveText('Code')
      await expect(watcher.locator('[data-testid="code-body"] .cm-content')).toHaveText('null')
      await expect(watcher.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
      await view.click()
      await page.getByRole('option', { name: 'Visual', exact: true }).click()
      await expect(view).toHaveText('Visual')
      await expect(watcher.locator('[data-testid="code-body"]')).toHaveCount(0)
      await expectCentered(watcher, 'null_array', 'back on Visual')
    })

    await test.step('an array holding a null item shows that item in the null look (VMGR-93)', async () => {
      for (const [name] of SLOTS) {
        await page.locator(`button[aria-label="Close inspector for ${name}"]`).click()
        await expect(watcherFor(page, name)).toHaveCount(0)
      }
      const watcher = await openWatcher(page, 'arr_null_item')
      const rows = watcher.locator('[data-testid="array-row"]')
      await expect(rows).toHaveCount(3)
      const valueAt = (i: number): Locator => rows.nth(i).locator('span').nth(1)
      await expect(valueAt(1)).toHaveText('null')
      await expect(valueAt(1)).toHaveCSS('font-style', 'italic')
      await expect(valueAt(1)).toHaveCSS('font-family', /mono/i)
      await expect(valueAt(1)).toHaveCSS('color', nullGray)
      for (const [index, text] of [
        [0, '"a"'],
        [2, '"c"'],
      ] as const) {
        await expect(valueAt(index)).toHaveText(text)
        await expect(valueAt(index)).toHaveCSS('font-style', 'normal')
      }
      await expect(watcher.locator('[data-testid="inspect-metric"]')).toHaveText('3 items')
      await testInfo.attach('watcher-null-item.png', {
        body: await watcher.screenshot(),
        contentType: 'image/png',
      })
    })
  })
})
