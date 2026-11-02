/**
 * V-FIELD-SWITCH-WARNING: the switch warning asked before a field holding a value changes mode
 * Design Decisions: FIELD-7, FIELD-1
 * REQ: REQ-3.1.1.5
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-11541-s1-` Test holding the Local Function Block
 * `deploy_check`, as V-FIELD-BLOCK-STATES seeds it; each test seeds its own Test, checks it validates with zero
 * errors and deletes it afterwards. One test per theme: the dark project's theme, then the light theme through
 * the shell toggle.
 *
 * Pass Criteria (in both themes):
 * 1. {x} on `owner` (holds `qa-team`, has a default) asks the switch warning over the Block window: the window
 *    sits dimmed under the backdrop, the red X icon on top, the title `Switch the field to an expression?` in the
 *    normal title color (not the accent), the body `The current value is cleared.`; the dialog never names the
 *    field.
 * 2. The buttons read `Cancel`, `Clear & Default`, `Clear & Empty` left to right, each label on one line;
 *    `Clear & Default` is outlined and `Clear & Empty` is the primary button; focus starts on `Cancel`.
 * 3. Cancel closes the dialog and keeps `qa-team` in plain mode.
 * 4. {x} on `prefix` (holds empty text, no default) asks with `Cancel`, `Clear`, `Clear & Empty`.
 * 5. Nothing is stored by asking and canceling.
 * 6. A screenshot of the dialog in each theme is attached.
 */

import { test, expect, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { elementColor, resolvedColor } from '../../helpers/config-sheet'
import { openTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  SWITCH_BODY,
  SWITCH_TO_EXPRESSION_TITLE,
  answerSwitch,
  askSwitch,
  expressionToggle,
  fieldInput,
  stateMarker,
  switchWarningButtons,
} from '../../helpers/value-field'
import { deleteSeededTest, openDeployCheckWindow, seedDeployCheck, storedDeployCheck } from './deploy-check-seed'

type Theme = 'dark' | 'light'

/** How many lines a button's label text takes. */
const labelLines = (button: Locator): Promise<number> =>
  button.evaluate((el) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) tops.add(Math.round(rect.top))
    }
    return tops.size
  })

/** The window under the dialog: the element on top of its title is the backdrop, a dark see-through layer. */
async function expectDimmedWindow(sheet: Locator): Promise<void> {
  const top = await sheet.evaluate((root) => {
    const title = root.querySelector('h2') as HTMLElement
    const rect = title.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + 4, rect.y + rect.height / 2) as HTMLElement
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(hit).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    return { inWindow: root.contains(hit), rgba: Array.from(ctx.getImageData(0, 0, 1, 1).data) }
  })
  expect(top.inWindow, 'the backdrop covers the Block window').toBe(false)
  const [r, g, b, alpha] = top.rgba
  expect([r, g, b], 'the backdrop is dark').toEqual([0, 0, 0])
  expect(alpha, 'the backdrop is see-through').toBeGreaterThan(0)
  expect(alpha, 'the backdrop is see-through').toBeLessThan(255)
}

/** Criteria 1 and 2: the dialog's look, texts and buttons (FIELD-7). */
async function expectDialog(page: Page, dialog: Locator, clearLabel: 'Clear & Default' | 'Clear'): Promise<void> {
  await expect(dialog).toHaveAttribute('role', 'alertdialog')
  await expect(dialog).toHaveAccessibleName(SWITCH_TO_EXPRESSION_TITLE)
  const icon = dialog.locator('[data-confirmation-icon]')
  await expect(icon).toHaveAttribute('data-icon', 'x')
  await expect(icon.locator('svg.lucide-x')).toHaveCount(1)
  expect(await elementColor(icon, 'color'), 'the X is red').toBe(await resolvedColor(page, 'var(--color-error-text)'))

  const title = dialog.locator('h2')
  await expect(title).toHaveText(SWITCH_TO_EXPRESSION_TITLE)
  const titleColor = await elementColor(title, 'color')
  expect(titleColor, 'the title takes the normal title color').toBe(
    await resolvedColor(page, 'var(--color-text-primary)'),
  )
  expect(titleColor, 'the title is not the accent color').not.toBe(await resolvedColor(page, 'var(--color-primary)'))
  const body = dialog.locator('p').filter({ hasText: SWITCH_BODY })
  await expect(body).toHaveText(SWITCH_BODY)
  await expect(dialog, 'the dialog never names the field').not.toContainText(/owner|prefix/)
  const iconBox = (await icon.boundingBox())!
  const titleBox = (await title.boundingBox())!
  const bodyBox = (await body.boundingBox())!
  expect(iconBox.y + iconBox.height, 'the X sits on top').toBeLessThanOrEqual(titleBox.y)
  expect(titleBox.y + titleBox.height, 'the body sits under the title').toBeLessThanOrEqual(bodyBox.y)

  const buttons = switchWarningButtons(dialog)
  await expect(buttons).toHaveText(['Cancel', clearLabel, 'Clear & Empty'])
  const boxes = await Promise.all([0, 1, 2].map(async (index) => (await buttons.nth(index).boundingBox())!))
  expect(boxes[0].x + boxes[0].width, 'Cancel comes first').toBeLessThanOrEqual(boxes[1].x)
  expect(boxes[1].x + boxes[1].width, `${clearLabel} comes second`).toBeLessThanOrEqual(boxes[2].x)
  for (const index of [0, 1, 2]) {
    const button = buttons.nth(index)
    expect(await labelLines(button), `${await button.textContent()} sits on one line`).toBe(1)
    expect(Math.abs(boxes[index].y - boxes[0].y), 'the buttons share one row').toBeLessThanOrEqual(1)
  }
  await expect(buttons.nth(0), 'focus starts on Cancel').toBeFocused()

  const clearEmpty = buttons.nth(2)
  const primary = await resolvedColor(page, 'var(--color-primary)')
  expect(
    await clearEmpty.evaluate((el) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.fillStyle = getComputedStyle(el).backgroundColor
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    }),
    'Clear & Empty is the primary button',
  ).toBe(primary)
  const outline = await buttons.nth(1).evaluate((el) => {
    const style = getComputedStyle(el)
    return { width: Number.parseFloat(style.borderTopWidth), style: style.borderTopStyle }
  })
  expect(outline, `${clearLabel} is outlined`).toEqual({ width: 1, style: 'solid' })
}

async function attach(testInfo: TestInfo, name: string, page: Page): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.describe('V-FIELD-SWITCH-WARNING: the switch warning', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteSeededTest(request, testId)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`switching a field that holds a value asks first in the ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      testId = await seedDeployCheck(request, 'switch-warning')
      const stored = await storedDeployCheck(request, testId)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const sheet = await openDeployCheckWindow(page)

      await test.step('owner: a value with a default', async () => {
        const dialog = await askSwitch(page, sheet, 'owner')
        await expectDimmedWindow(sheet)
        await expectDialog(page, dialog, 'Clear & Default')
        await attach(testInfo, `field-switch-warning-${theme}.png`, page)
        await answerSwitch(page, 'Cancel')
        await expect(fieldInput(sheet, 'owner'), 'Cancel keeps the value').toHaveValue('qa-team')
        await expect(expressionToggle(sheet, 'owner'), 'Cancel keeps plain mode').toHaveAttribute('aria-pressed', 'false')
      })

      await test.step('prefix: a value with no default', async () => {
        const dialog = await askSwitch(page, sheet, 'prefix')
        await expectDialog(page, dialog, 'Clear')
        await answerSwitch(page, 'Cancel')
        await expect(stateMarker(sheet, 'prefix'), 'Cancel keeps the empty text').toHaveText('<empty string>')
        await expect(expressionToggle(sheet, 'prefix')).toHaveAttribute('aria-pressed', 'false')
      })

      await expect(sheet.getByRole('button', { name: 'Save', exact: true }), 'asking changed nothing').toBeDisabled()
      await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(sheet).toHaveCount(0)
      expect(await storedDeployCheck(request, testId), 'nothing is stored').toEqual(stored)
    })
  }
})
