/**
 * V-NUMBER-GLOBAL-VARS: a System variable whose integer is no whole number of at most 19 digits is refused by name
 * Wireframe: N/A (the System Variables Import dialog keeps its look)
 * Design Decisions: N/A (the import review follows the shared Import dialog)
 * REQ: REQ-3.1.3.14
 *
 * The file and the API write hold one good integer and two that break the rule: `80.5` and a 20-digit
 * integer. Nothing is imported; every name the spec could have written is deleted afterwards.
 *
 * Pass Criteria:
 * 1. The System Variables Import dialog's dry run lists the good variable as importable and blocks the
 *    other two, each with its own message: `Value for variable '<v>' is not a valid integer` and
 *    `Value for variable '<v>' allows at most 19 digits, got 20`; their rows read Blocked and the summary
 *    reads `1 importable, 2 blocked`.
 * 2. Importing the same file is refused 400 naming the first bad variable, and no variable of the file is
 *    stored.
 * 3. Saving a System variable through the API with the integer `80.5` is refused 400
 *    `Value for variable '<v>' is not a valid integer`; with 20 digits it is refused
 *    `Value for variable '<v>' allows at most 19 digits, got 20`; nothing is stored.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { expectBlocked, refusalOf, validateInDialog } from '../../helpers/number-entry'

const GOOD = 'zz_11541_s9_good'
const FRACTION = 'zz_11541_s9_fraction'
const TWENTY = 'zz_11541_s9_twenty'
const NAMES = [GOOD, FRACTION, TWENTY]

const notInteger = (name: string): string => `Value for variable '${name}' is not a valid integer`
const pastTheCap = (name: string): string => `Value for variable '${name}' allows at most 19 digits, got 20`

// Raw JSON text, so the 20-digit integer reaches the server with every digit.
const FILE_TEXT = `{"variables": {
  "${GOOD}": {"type": "integer", "value": 12},
  "${FRACTION}": {"type": "integer", "value": 80.5},
  "${TWENTY}": {"type": "integer", "value": 12345678901234567890}
}}`

const importFile = () => ({
  name: 'zz-11541-s9-system-variables.json',
  mimeType: 'application/json',
  buffer: Buffer.from(FILE_TEXT, 'utf-8'),
})

async function storedNames(page: Page): Promise<string[]> {
  const response = await page.request.get(`${BACKEND_URL}/variables/system`)
  expect(response.ok(), `GET /variables/system answered ${response.status()}`).toBeTruthy()
  const variables = ((await response.json()).data?.variables ?? {}) as Record<string, unknown>
  return Object.keys(variables).filter((name) => NAMES.includes(name))
}

test.describe('V-NUMBER-GLOBAL-VARS: System variables and the one number rule', () => {
  test.afterEach(async ({ page }) => {
    for (const name of NAMES) {
      await page.request.delete(`${BACKEND_URL}/variables/system/${name}`).catch(() => undefined)
    }
  })

  test('the import dry run blocks each bad integer by name and the import stores nothing', async ({ page }) => {
    await test.step('1. the dry run blocks the two bad integers with their own messages', async () => {
      await page.goto('/settings/variables')
      await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({ timeout: 15_000 })
      const opener = page.locator('[data-testid="system-variables-import-btn"]')
      await expect(opener).toBeEnabled({ timeout: 15_000 })
      await opener.click()
      const dialog = page.locator('[data-testid="import-dialog"]')
      await expect(dialog).toBeVisible()
      await dialog.locator('[data-testid="file-input"]').setInputFiles(importFile())
      const dryRun = await validateInDialog(page, dialog, 'items')

      const good = dryRun.items.find((item) => item.name === GOOD)
      expect(good?.status, 'the good integer can be imported').toBe('ok')
      expect(good?.fatal_errors).toEqual([])
      await expectBlocked(dryRun, FRACTION, notInteger(FRACTION))
      await expectBlocked(dryRun, TWENTY, pastTheCap(TWENTY))
      await expect(dialog.locator('[data-testid="import-summary"]')).toHaveText('1 importable, 2 blocked')

      await dialog.locator('[data-testid="back-button"]').click()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('2. importing the file is refused by the first bad name and stores nothing', async () => {
      const refusal = await refusalOf(
        await page.request.post(`${BACKEND_URL}/variables/system/import`, { multipart: { file: importFile() } }),
        'POST /variables/system/import',
      )
      expect(refusal.status).toBe(400)
      expect(refusal.message).toBe(notInteger(FRACTION))
      expect(await storedNames(page), 'no variable of the file is stored').toEqual([])
    })
  })

  test('a System variable saved through the API with 80.5 or 20 digits is refused by name', async ({ page }) => {
    // The Settings page's own write: the whole collection, the new variable beside the stored ones.
    const save = async (name: string, value: unknown) => {
      const current = await page.request.get(`${BACKEND_URL}/variables/system`)
      const stored = ((await current.json()).data?.variables ?? {}) as Record<string, unknown>
      return page.request.post(`${BACKEND_URL}/variables/system`, {
        data: { variables: { ...stored, [name]: { type: 'integer', value } } },
      })
    }

    await test.step('3. 80.5 is no integer', async () => {
      const refusal = await refusalOf(await save(FRACTION, '80.5'), 'PATCH a System integer of 80.5')
      expect(refusal.status).toBe(400)
      expect(refusal.message).toBe(notInteger(FRACTION))
    })

    await test.step('3. 20 digits are past the cap', async () => {
      const refusal = await refusalOf(await save(TWENTY, '12345678901234567890'), 'PATCH a System integer of 20 digits')
      expect(refusal.status).toBe(400)
      expect(refusal.message).toBe(pastTheCap(TWENTY))
    })

    expect(await storedNames(page), 'nothing is stored').toEqual([])
  })
})
