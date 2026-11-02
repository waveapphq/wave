/**
 * V-PLUGIN-PYTHON-SCROLL: the Python editor and the expression editor leave the page alone
 * Wireframe: none
 * Design Decisions: PYRUN-13, PYRUN-19
 * REQ: REQ-3.4.1.2
 *
 * The page's own scroller is `body` (both `html` and `body` compute to
 * `overflow-y: auto`, so `body` clips its own overflow and `documentElement` never
 * reports it). Every measurement below therefore reads `body` as well as
 * `documentElement`, and pushes each of them by 250 px to prove they do not move.
 *
 * Pass Criteria:
 * 1. With the Python editor sheet open the page behind it gains no scrollable height:
 *    `body.scrollHeight - body.clientHeight` and the same on `documentElement` stay 0,
 *    `window.scrollY` stays 0, pushing either scroller by 250 px leaves it at 0, and
 *    `#root` stays at y = 0. This holds again after typing enough to mount a completion
 *    tooltip.
 * 2. A mouse wheel over the Python editor scrolls the EDITOR: its `.cm-scroller`
 *    scrollTop grows, and the page behind it measures exactly as above.
 * 3. With the expression editor modal open the page behind it measures the same.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { answerSwitch } from '../../helpers/value-field'
import { openStringParamSheet } from '../../helpers/param-config'
import { deleteTest, openConfig } from '../file-picker/picker'

const NODE = 'py-scroll'

const createdTests: string[] = []

interface PageScroll {
  bodyExtent: number
  docExtent: number
  scrollY: number
  forcedBodyScrollTop: number
  forcedDocScrollTop: number
  rootTop: number
}

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-scroll.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** What the page behind the sheet can scroll, including a 250 px push that is undone. */
async function measurePageScroll(page: Page): Promise<PageScroll> {
  return page.evaluate(() => {
    const body = document.body
    const doc = document.documentElement
    const root = document.getElementById('root')
    const bodyWas = body.scrollTop
    const docWas = doc.scrollTop
    body.scrollTop = 250
    doc.scrollTop = 250
    const forcedBodyScrollTop = body.scrollTop
    const forcedDocScrollTop = doc.scrollTop
    const rootTop = root === null ? Number.NaN : Math.round(root.getBoundingClientRect().top)
    body.scrollTop = bodyWas
    doc.scrollTop = docWas
    return {
      bodyExtent: body.scrollHeight - body.clientHeight,
      docExtent: doc.scrollHeight - doc.clientHeight,
      scrollY: Math.round(globalThis.scrollY),
      forcedBodyScrollTop,
      forcedDocScrollTop,
      rootTop,
    }
  })
}

function expectPageStill(measured: PageScroll, where: string): void {
  const seen = JSON.stringify(measured)
  expect(measured.bodyExtent, `${where}: the page body gained scrollable height. ${seen}`).toBe(0)
  expect(measured.docExtent, `${where}: the document gained scrollable height. ${seen}`).toBe(0)
  expect(measured.scrollY, `${where}: the page is scrolled. ${seen}`).toBe(0)
  expect(measured.forcedBodyScrollTop, `${where}: the body moved when pushed. ${seen}`).toBe(0)
  expect(measured.forcedDocScrollTop, `${where}: the document moved when pushed. ${seen}`).toBe(0)
  expect(measured.rootTop, `${where}: the app shell moved. ${seen}`).toBe(0)
}

async function scrollerTop(scroller: Locator): Promise<number> {
  return scroller.evaluate((el) => el.scrollTop)
}

test.describe('V-PLUGIN-PYTHON-SCROLL: the editors never scroll the page', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) await deleteTest(request, createdTests.pop() as string)
  })

  test('the Python editor and the expression editor leave the page behind them still', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    createdTests.push(await importValidateAndNavigate(page, loadFixture()))
    const dialog = await openConfig(page, NODE)

    await test.step('the config sheet alone leaves the page as it was', async () => {
      expectPageStill(await measurePageScroll(page), 'with only the config sheet open')
    })

    const sheet = await openStringParamSheet(dialog, page, 'script')
    await expect(sheet.locator('.cm-content')).toBeVisible()

    await test.step('the open Python editor adds no scrollable height', async () => {
      expectPageStill(await measurePageScroll(page), 'with the Python editor open')
    })

    await test.step('a wheel over the editor scrolls the editor and nothing else', async () => {
      const scroller = sheet.locator('.cm-scroller').first()
      const box = await scroller.boundingBox()
      expect(box, 'the editor scroller has a box').not.toBeNull()
      const before = await scrollerTop(scroller)

      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.mouse.wheel(0, 300)

      await expect(async () => {
        expect(
          await scrollerTop(scroller),
          'the wheel must scroll the editor itself',
        ).toBeGreaterThan(before)
      }).toPass({ timeout: 10_000 })
      expectPageStill(await measurePageScroll(page), 'after a wheel over the Python editor')
    })

    await test.step('a mounted completion tooltip adds no scrollable height either', async () => {
      await sheet.locator('.cm-content').first().click()
      await page.keyboard.press('Control+End')
      await page.keyboard.type('.')
      await expect(
        page.locator('.cm-tooltip-autocomplete'),
        'a member list must mount for this measurement to mean anything',
      ).toBeVisible({ timeout: 30_000 })
      expectPageStill(await measurePageScroll(page), 'with a completion tooltip open')
    })

    await test.step('the expression editor modal adds no scrollable height', async () => {
      await sheet.getByTestId('value-editor-cancel-button').click()
      await page.getByTestId('value-editor-unsaved-discard-button').click()
      await expect(sheet).toBeHidden()

      const row = dialog.getByTestId('param-row-interpreter')
      await row.getByTestId('expression-toggle').click()
      // The row holds empty text, a value of its own, so the switch asks first (FIELD-7).
      await answerSwitch(page, 'Clear & Empty')
      await row.locator('.cm-content').first().click()
      await page.keyboard.press('Control+e')
      const modal = page.getByTestId('expression-editor-modal')
      await expect(modal).toBeVisible()

      expectPageStill(await measurePageScroll(page), 'with the expression editor modal open')
    })
  })
})
