/**
 * V-VMGR-CREATE-01: the variable window's labeled-form layout in Add
 * Design Decisions: VMGR-106, VMGR-110, VMGR-112
 * REQ: REQ-3.1.3.11, REQ-3.1.2.1
 *
 * Phase: no-data (seeds its own Test via POST /tests + drills, no run).
 *
 * Pass Criteria:
 * 1. A New variable window shows Name, Type and Kind, then Mark as secret above the one-line value field,
 *    which spans the form.
 * 2. At the resize floor the form scrolls: the value field keeps its 36 px line and, scrolled to, sits above
 *    the footer inside the window (String and Table).
 * 3. An array or map growing in the "Edit value" window scrolls inside its own box: every new row is in view,
 *    and Add and the window's Save stay inside the window.
 * 4. A New input parameter window has the IN badge, Description and Required; a String input offers Create
 *    enum, which shows Allowed values and turns the default into a select; an Array input has no Create enum.
 * 5. A New output parameter window has the OUT badge and Description, and no Required.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest, logNode, localFunctionNode, startEdge } from '../../helpers/fn-seed'
import { digIn } from '../../helpers/workbench'
import {
  openCreateModal,
  openFunctionCreateModal,
  setCreateName,
  setCreateType,
  cancelCreate,
  closeValueEditor,
  openValueEditor,
  setWindowCheckbox,
  valueField,
  windowCheckbox,
} from '../../helpers/variable-create'

async function seedWithFunction(page: Page, request: APIRequestContext): Promise<void> {
  const testId = await createValidTest(request, {
    name: `V-VMGR-CREATE-01 ${Date.now()}`,
    nodes: [
      logNode('log1', 'Log', '"ok"'),
      localFunctionNode('fn1', 'MyFn', {
        nodes: [logNode('inner', 'Inner', '"x"')],
        edges: [startEdge('inner')],
      }),
    ],
    edges: [startEdge('log1')],
  })
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await openTest(page, testId)
}

test.describe('V-VMGR-CREATE-01: create modal layout', () => {
  test('variable mode: Name, Type and Kind, then Mark as secret above the one-line value field', async ({
    page,
    request,
  }) => {
    await seedWithFunction(page, request)
    const modal = await openCreateModal(page)
    await expect(modal.locator('[data-testid="create-variable-name"]')).toBeVisible()
    await expect(modal.locator('[data-testid="create-type-select"]')).toBeVisible()
    await expect(modal.locator('[data-testid="create-kind-select"]')).toBeVisible()
    await expect(windowCheckbox(modal, 'secret')).toBeVisible()

    const secretBox = await windowCheckbox(modal, 'secret').boundingBox()
    const valueBox = await valueField(modal).boundingBox()
    const nameBox = await modal.locator('[data-testid="create-variable-name"]').boundingBox()
    // The secret control sits ABOVE the value field.
    expect(secretBox!.y).toBeLessThan(valueBox!.y)
    // Per VMGR-110: the value is one field line that spans the form.
    expect(Math.abs(valueBox!.height - 36), 'the value field is one 36 px line').toBeLessThanOrEqual(1)
    expect(Math.abs(valueBox!.width - nameBox!.width), 'the value line spans the form').toBeLessThanOrEqual(1)
    await cancelCreate(page)
  })

  test('at the resize floor the form scrolls to the value field above the footer', async ({ page, request }) => {
    await seedWithFunction(page, request)
    for (const type of ['string', 'table']) {
      const modal = await openCreateModal(page)
      await setCreateName(page, `sz_${type}`)
      if (type !== 'string') await setCreateType(page, type)
      const footer = modal.locator('[data-testid="create-submit-button"]')

      // Drag the corner grip far up-left to clamp the sheet to its floor.
      const grip = modal.locator('[data-testid="dialog-resize-corner"]')
      const gripBox = await grip.boundingBox()
      await page.mouse.move(gripBox!.x + 4, gripBox!.y + 4)
      await page.mouse.down()
      await page.mouse.move(gripBox!.x - 500, gripBox!.y - 500, { steps: 12 })
      await page.mouse.up()

      // The window opens tall enough for its fields and scrolls when made shorter.
      await valueField(modal).scrollIntoViewIfNeeded()
      const value = await valueField(modal).boundingBox()
      const footerBox = await footer.boundingBox()
      const sheetBox = await modal.boundingBox()
      expect(value, `${type} value field present at floor`).not.toBeNull()
      expect(Math.abs(value!.height - 36), `${type} value keeps its 36 px line`).toBeLessThanOrEqual(1)
      expect(value!.y, `${type} value sits inside the window`).toBeGreaterThanOrEqual(sheetBox!.y)
      expect(value!.y + value!.height, `${type} value ends above the footer`).toBeLessThanOrEqual(footerBox!.y)
      expect(footerBox!.y + footerBox!.height, `${type} footer stays inside the window`).toBeLessThanOrEqual(
        sheetBox!.y + sheetBox!.height,
      )
      await cancelCreate(page)
    }
  })

  test('array and map grids in the "Edit value" window scroll inside their box instead of pushing Add and Save out', async ({
    page,
    request,
  }) => {
    await seedWithFunction(page, request)

    // Grow each list past its bound and prove the chrome around it stays inside the window.
    // Blank list items are a change the window asks about; blank map entries hold no key, so they are none.
    const shapes = [
      { type: 'array', add: 'array-add-item', row: (i: number) => `array-edit-input-${i}`, close: 'Close' },
      { type: 'map', add: 'map-add-entry', row: (i: number) => `map-edit-key-${i}`, close: undefined },
    ] as const

    for (const shape of shapes) {
      const modal = await openCreateModal(page)
      await setCreateName(page, `grow_${shape.type}`)
      await setCreateType(page, shape.type)
      const sheet = await openValueEditor(page, modal)
      const addButton = sheet.locator(`[data-testid="${shape.add}"]`)
      const footer = sheet.locator('[data-testid="value-editor-save-button"]')

      for (let i = 0; i < 10; i++) {
        await addButton.click()
        const row = sheet.locator(`[data-testid="${shape.row(i)}"]`)
        await expect(row).toBeVisible()

        // Each new row is revealed rather than left below the fold: it sits
        // inside its scroll container's visible band.
        const band = await row.evaluate((el) => {
          let node = el.parentElement
          while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
          const box = node ? node.getBoundingClientRect() : el.getBoundingClientRect()
          const own = el.getBoundingClientRect()
          return {
            scrolls: !!node,
            top: box.top,
            bottom: box.bottom,
            rowTop: own.top,
            rowBottom: own.bottom,
          }
        })
        expect(band.rowTop, `${shape.type} row ${i} is scrolled into view`).toBeGreaterThanOrEqual(
          band.top - 2,
        )
        expect(band.rowBottom, `${shape.type} row ${i} is scrolled into view`).toBeLessThanOrEqual(
          band.bottom + 2,
        )
      }

      // The grid scrolls rather than growing without limit.
      const scrolls = await sheet
        .locator(`[data-testid="${shape.row(0)}"]`)
        .evaluate((el) => {
          let node = el.parentElement
          while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement
          return !!node
        })
      expect(scrolls, `the ${shape.type} grid scrolls once it outgrows its box`).toBe(true)

      // Add and the window's Save both stay inside the window's own box.
      const sheetBox = await sheet.boundingBox()
      const addBox = await addButton.boundingBox()
      const footerBox = await footer.boundingBox()
      const inside = (box: { y: number; height: number }, label: string) => {
        expect(box.y, `${label} starts inside the window`).toBeGreaterThanOrEqual(sheetBox!.y - 2)
        expect(
          box.y + box.height,
          `${label} ends inside the window`,
        ).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height + 2)
      }
      inside(addBox!, `${shape.type} Add control`)
      inside(footerBox!, `${shape.type} window Save`)
      expect(addBox!.y, `${shape.type} Add sits above Save`).toBeLessThan(footerBox!.y)

      await closeValueEditor(page, sheet, shape.close)
      await cancelCreate(page)
    }
  })

  test('input param mode: IN badge, Description, Required, Create enum reveals Allowed values', async ({
    page,
    request,
  }) => {
    await seedWithFunction(page, request)
    await digIn(page, 'fn1')
    const modal = await openFunctionCreateModal(page, 'input')
    await expect(modal.locator('[data-testid="create-role-badge"]')).toHaveText('IN')
    await expect(modal.locator('[data-testid="param-description"]')).toBeVisible()
    await expect(windowCheckbox(modal, 'required')).toBeVisible()
    // Per VMGR-112: a String input offers Create enum; ticking it shows Allowed values and a default select.
    const createEnum = windowCheckbox(modal, 'create-enum')
    await expect(createEnum).toBeVisible()
    await setWindowCheckbox(modal, 'create-enum', true)
    await expect(valueField(modal, 'allowed-values')).toBeVisible()
    await expect(modal.locator('[data-testid="enum-value-select"]')).toBeVisible()
    await setWindowCheckbox(modal, 'create-enum', false)
    await setCreateType(page, 'array', modal)
    await expect(createEnum, 'an Array input has no Create enum').toHaveCount(0)
    await cancelCreate(page)
  })

  test('output param mode: OUT badge, Description, no Required', async ({ page, request }) => {
    await seedWithFunction(page, request)
    await digIn(page, 'fn1')
    const modal = await openFunctionCreateModal(page, 'output')
    await expect(modal.locator('[data-testid="create-role-badge"]')).toHaveText('OUT')
    await expect(modal.locator('[data-testid="param-description"]')).toBeVisible()
    await expect(modal.locator('[data-testid="param-required-checkbox"]')).toHaveCount(0)
    await cancelCreate(page)
  })
})
