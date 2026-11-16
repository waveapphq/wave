/**
 * V-VMGR-EDIT-TOOLTIP: an icon button's tooltip shows on hover and keyboard focus, never when its window closes
 * Wireframe: none (functional)
 * Design Decisions: SHELL-7b
 * REQ: REQ-5.2.1.17
 *
 * Setup (API): one `zz-` Test per test (`POST /tests`), deleted after: the pencil tests hold one String variable
 * `greeting`; the Configure tests also hold a Log Block `Say Greeting` that prints it.
 *
 * Pass Criteria:
 * 1. The pencil opens the Edit window; Cancel closes it and hands focus back to the pencil, and no
 *    "Edit variable" tooltip shows; hovering the pencil then shows it.
 * 2. The same after a value change and Save.
 * 3. Tab from the row's Inspect button onto the pencil gives it keyboard focus and shows the
 *    "Edit variable" tooltip.
 * 4. A click on the Block's Configure button opens its window; Cancel closes it and hands focus back to
 *    Configure, and no "Configure" tooltip shows; hovering Configure then shows it.
 * 5. The same after a rename and Save; the Block shows its new name.
 * 6. Shift+Tab from the Block's More options button onto Configure gives it keyboard focus and shows the
 *    "Configure" tooltip.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import {
  cancelWindow,
  editPencil,
  expandVariableManager,
  openEditWindow,
  saveWindow,
  setWindowValue,
  variableRow,
} from '../../helpers/variable-create'
import { uniqueName } from './references-helpers'

const NAME = 'greeting'
const BLOCK_ID = 'tooltip-log'
const BLOCK_NAME = 'Say Greeting'
const RENAMED = 'Say Greeting Again'
const OPEN_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'

function openTooltip(page: Page, text: string): Locator {
  return page.locator(OPEN_TOOLTIP).filter({ hasText: text })
}

function editTooltip(page: Page): Locator {
  return openTooltip(page, 'Edit variable')
}

function configureTooltip(page: Page): Locator {
  return openTooltip(page, 'Configure')
}

function blockCard(page: Page): Locator {
  return page.getByTestId(`workflow-node-${BLOCK_ID}`)
}

function configureButton(page: Page): Locator {
  return blockCard(page).getByRole('button', { name: 'Configure', exact: true })
}

/** Focus is back on `control`, and past the hover delay its tooltip is not open. */
async function expectFocusBackWithNoTooltip(page: Page, control: Locator, tooltip: Locator, what: string): Promise<void> {
  await expect(control, `${what}: the closed window hands focus back to the button that opened it`).toBeFocused()
  // Proving a negative: a hover tooltip would open 500 ms after the pointer settles.
  await page.waitForTimeout(1_500)
  await expect(tooltip, `${what}: no tooltip after a mouse close`).toHaveCount(0)
}

async function expectTooltipOnHover(page: Page, control: Locator, tooltip: Locator): Promise<void> {
  await page.mouse.move(1, 1)
  await control.hover()
  await expect(tooltip, 'hovering the button shows its tooltip').toBeVisible()
}

/** Click Configure with the mouse and return the Block window it opens. */
async function openBlockWindowByClick(page: Page): Promise<Locator> {
  await configureButton(page).click()
  const win = page.getByTestId('element-config-sheet')
  await expect(win, 'Configure opens the Block window').toBeVisible()
  return win
}

test.describe('V-VMGR-EDIT-TOOLTIP: the row pencil tooltip after its window closes', () => {
  let testId = ''

  test.beforeEach(async ({ page, request }) => {
    testId = await createValidTest(request, {
      name: uniqueName('v-vmgr-edit-tooltip'),
      nodes: [],
      variables: { [NAME]: { type: 'string', value: 'hello' } },
    })
    await openTest(page, testId)
    await expandVariableManager(page)
    await expect(variableRow(page, NAME)).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('Cancel closes the Edit window with no tooltip on the pencil', async ({ page }) => {
    const pencil = editPencil(page, NAME)
    const win = await openEditWindow(page, NAME)
    await cancelWindow(page, win)
    await expectFocusBackWithNoTooltip(page, pencil, editTooltip(page), 'Cancel')
    await expectTooltipOnHover(page, pencil, editTooltip(page))
  })

  test('Save closes the Edit window with no tooltip on the pencil', async ({ page }) => {
    const pencil = editPencil(page, NAME)
    const win = await openEditWindow(page, NAME)
    await setWindowValue(page, win, 'hello again')
    await saveWindow(page, win)
    await expect(variableRow(page, NAME)).toContainText('hello again')
    await expectFocusBackWithNoTooltip(page, pencil, editTooltip(page), 'Save')
    await expectTooltipOnHover(page, pencil, editTooltip(page))
  })

  test('Tab onto the pencil shows its tooltip', async ({ page }) => {
    const pencil = editPencil(page, NAME)
    const inspect = variableRow(page, NAME).locator('[data-testid^="expand-button-"]')
    await inspect.focus()
    await page.keyboard.press('Tab')
    await expect(pencil, 'Tab moves focus from Inspect to the pencil').toBeFocused()
    expect(await pencil.evaluate((el) => el.matches(':focus-visible')), 'Tab gives the pencil keyboard focus').toBe(true)
    await expect(editTooltip(page), 'keyboard focus shows the tooltip').toBeVisible()
  })
})

test.describe('V-VMGR-EDIT-TOOLTIP: the Block Configure tooltip after its window closes', () => {
  let testId = ''

  test.beforeEach(async ({ page, request }) => {
    testId = await createValidTest(request, {
      name: uniqueName('v-vmgr-configure-tooltip'),
      nodes: [logNode(BLOCK_ID, BLOCK_NAME, NAME, { x: 300, y: 200 })],
      edges: [startEdge(BLOCK_ID)],
      variables: { [NAME]: { type: 'string', value: 'hello' } },
    })
    await openTest(page, testId)
    await expect(configureButton(page)).toBeVisible()
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('Cancel closes the Block window with no tooltip on Configure', async ({ page }) => {
    const configure = configureButton(page)
    const win = await openBlockWindowByClick(page)
    await win.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(win).toHaveCount(0)
    await expectFocusBackWithNoTooltip(page, configure, configureTooltip(page), 'Cancel')
    await expectTooltipOnHover(page, configure, configureTooltip(page))
  })

  test('Save closes the Block window with no tooltip on Configure', async ({ page }) => {
    const configure = configureButton(page)
    const win = await openBlockWindowByClick(page)
    await win.getByTestId('element-name-input').fill(RENAMED)
    await win.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(win).toHaveCount(0)
    await expect(blockCard(page), 'the Block shows its new name').toContainText(RENAMED)
    await expectFocusBackWithNoTooltip(page, configure, configureTooltip(page), 'Save')
    await expectTooltipOnHover(page, configure, configureTooltip(page))
  })

  test('Shift+Tab onto Configure shows its tooltip', async ({ page }) => {
    const configure = configureButton(page)
    await blockCard(page).getByRole('button', { name: 'More options', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(configure, 'Shift+Tab moves focus from More options to Configure').toBeFocused()
    expect(await configure.evaluate((el) => el.matches(':focus-visible')), 'Shift+Tab gives Configure keyboard focus').toBe(
      true,
    )
    await expect(configureTooltip(page), 'keyboard focus shows the tooltip').toBeVisible()
  })
})
