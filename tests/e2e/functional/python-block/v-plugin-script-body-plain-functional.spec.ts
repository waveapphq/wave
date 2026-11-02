/**
 * V-PLUGIN-SCRIPT-BODY-PLAIN: the script bodies take plain text only, so their value editor
 * shows no Format control, and a noExpression parameter offers no value Kind.
 * Wireframe: none
 * Design Decisions: PYRUN-15, PYRUN-16, PYRUN-13
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. The Shell Script, K8s Script and SSH Session Script bodies open an "Edit value"
 *    sheet with no Format picker, so JSON, YAML, XML and Auto cannot be reached. A
 *    parameter that is not one of those bodies (the Python Interpreter row) opens a
 *    sheet whose Format picker is enabled and offers Auto, Plain, JSON, XML and YAML,
 *    which is what makes the absence above meaningful.
 * 2. All three bodies still offer the value Kind: the dropdown reads Literal and its
 *    menu holds Literal and Template.
 * 3. The Python Script body, declared noExpression, shows NO Kind dropdown (and no
 *    Format dropdown, because the sheet is in Python mode); the Python Interpreter row,
 *    which is not noExpression, still shows the Kind dropdown.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openStringParamSheet, valueEditorSheet } from '../../helpers/param-config'
import { closeConfig, deleteTest, openConfig } from '../file-picker/picker'

const FORMAT_MENU = ['Auto', 'Plain', 'JSON', 'XML', 'YAML']
const KIND_MENU = ['Literal', 'Template']

/** Every block whose Script body takes plain text only, with the group card it sits in. */
const PLAIN_BODIES = [
  { node: 'sb-shell', block: 'Shell Script', group: 'Script' },
  { node: 'sb-k8s', block: 'K8s Script', group: 'Script' },
  { node: 'sb-ssh', block: 'SSH Session Script', group: '' },
] as const

const createdTests: string[] = []

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-script-body.json'), 'utf-8'),
  ) as Record<string, unknown>
}

async function importFixture(page: Page): Promise<void> {
  createdTests.push(await importValidateAndNavigate(page, loadFixture()))
}

/** Reveal a parameter row, expanding its group card first when it has one. */
async function revealRow(dialog: Locator, group: string, row: string): Promise<void> {
  const edit = dialog.getByTestId(`param-expand-${row}`)
  if (await edit.isVisible()) return
  if (group !== '') {
    const header = dialog.getByTestId(`group-header-${group}`)
    if ((await header.getAttribute('aria-expanded')) === 'false') await header.click()
  }
  await expect(edit).toBeVisible()
}

/** The entries a Select offers, read from the open menu, which is then left as it was. */
async function menuEntries(page: Page, trigger: Locator): Promise<string[]> {
  const selected = (await trigger.innerText()).trim()
  await trigger.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const entries = (await listbox.getByRole('option').allInnerTexts()).map((text) => text.trim())
  // Re-picking the entry already selected closes the menu without changing the value.
  await listbox.getByRole('option', { name: selected, exact: true }).click()
  await expect(listbox).toBeHidden()
  return entries
}

async function closeSheet(sheet: Locator): Promise<void> {
  await sheet.getByTestId('value-editor-cancel-button').click()
  await expect(sheet).toBeHidden()
}

test.describe('V-PLUGIN-SCRIPT-BODY-PLAIN: no Format control and the Kind dropdown', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) await deleteTest(request, createdTests.pop() as string)
  })

  test('PYRUN-15: the three script bodies show no Format control and still offer Template', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importFixture(page)

    for (const body of PLAIN_BODIES) {
      await test.step(`${body.block}: the Script body shows no Format control`, async () => {
        const dialog = await openConfig(page, body.node)
        await revealRow(dialog, body.group, 'script')
        const sheet = await openStringParamSheet(dialog, page, 'script')

        const kind = sheet.getByTestId('kind-dropdown')
        await expect(kind, `${body.block} Script still offers the value Kind`).toBeVisible()
        await expect(kind).toHaveText('Literal')
        expect(await menuEntries(page, kind)).toEqual(KIND_MENU)

        await expect(
          sheet.getByTestId('format-dropdown'),
          `${body.block} Script shows no Format picker, so JSON, YAML, XML and Auto are out of reach`,
        ).toHaveCount(0)

        await closeSheet(sheet)
        await closeConfig(dialog)
      })
    }

    await test.step('a row that is not one of those bodies offers the whole Format menu', async () => {
      const dialog = await openConfig(page, 'sb-python')
      await revealRow(dialog, 'Script', 'interpreter')
      const sheet = await openStringParamSheet(dialog, page, 'interpreter')

      const format = sheet.getByTestId('format-dropdown')
      await expect(format, 'an unrestricted row leaves the Format picker live').toBeEnabled()
      expect(await menuEntries(page, format)).toEqual(FORMAT_MENU)

      await closeSheet(sheet)
      await closeConfig(dialog)
    })
  })

  test('PYRUN-16: a noExpression parameter shows no Kind dropdown', async ({ page }) => {
    test.setTimeout(180_000)
    await importFixture(page)
    const dialog = await openConfig(page, 'sb-python')

    await test.step('the Python Script body, declared noExpression, offers no Kind', async () => {
      await revealRow(dialog, 'Script', 'script')
      const sheet = await openStringParamSheet(dialog, page, 'script')
      // The Python-mode furniture proves the sheet opened before the absences are read.
      await expect(sheet.getByTestId('value-editor-help-chip')).toBeVisible()
      await expect(sheet.getByTestId('value-editor-run-button')).toBeVisible()
      await expect(sheet.getByTestId('kind-dropdown')).toHaveCount(0)
      await expect(sheet.getByTestId('format-dropdown')).toHaveCount(0)
      await closeSheet(sheet)
    })

    await test.step('the Interpreter row, which is not noExpression, still offers Kind', async () => {
      await revealRow(dialog, 'Script', 'interpreter')
      const sheet = await openStringParamSheet(dialog, page, 'interpreter')
      const kind = sheet.getByTestId('kind-dropdown')
      await expect(kind).toBeVisible()
      await expect(kind).toHaveText('Literal')
      expect(await menuEntries(page, kind)).toEqual(KIND_MENU)
      await closeSheet(sheet)
    })

    await expect(valueEditorSheet(page)).toBeHidden()
    await closeConfig(dialog)
  })
})
