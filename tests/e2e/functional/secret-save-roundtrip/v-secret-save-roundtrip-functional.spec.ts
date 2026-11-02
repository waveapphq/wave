/**
 * V-SECRET-SAVE-ROUNDTRIP-FUNCTIONAL: a masked re-save keeps the stored secret
 * Design Decisions: SECUI-1, SECUI-7, SECUI-9
 * REQ: REQ-3.1.3.5
 *
 * The frontend echoes a saved secret back as the mask placeholder (it never holds the real
 * value); the save path keeps the stored sealed value whenever the submitted secret equals it.
 *
 * Pass Criteria:
 *  1. Import seals the secret; a run slices the REAL suffix and the canary appears in no log line
 *  2. After editing an UNRELATED variable in its Edit window and saving the test (the secret
 *     rides along as the mask), the persisted secret envelope is BYTE-IDENTICAL to before, the
 *     unrelated edit persisted, and the masked read still shows ********
 *  3. A second run after the masked re-save STILL slices the REAL suffix
 *  4. The watcher carries no secret control; the Edit window carries Mark as secret, unticked
 *     for a plain variable and ticked for a saved secret, whose value stays write-only (masked
 *     field, "Delete & Edit" opens it empty); the Add window carries Mark as secret too
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { selectEnvironment, runToTerminal, saveBtn } from '../../helpers/workbench'
import {
  variableRow,
  expandVariableManager,
  openCreateModal,
  createModal,
  cancelCreate,
  cancelWindow,
  editProtectedValue,
  openEditWindow,
  saveWindow,
  setWindowValue,
  valueEditor,
  valueField,
  windowCheckbox,
} from '../../helpers/variable-create'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const CANARY_RT = 'RTsec-3f9-mike-real-bytes'
const RT_SUFFIX = 'mike-real-bytes' // CANARY_RT[10:]
const MASK = '********'
const ENVELOPE = 'wave:enc:v1:'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

// --- raw store inspection -------------------------------------------------

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

function testDirBytes(testId: string): Buffer {
  const dir = path.join(STORAGE_BASE_PATH, 'api_tests', testId)
  return Buffer.concat(listFiles(dir).map((file) => fs.readFileSync(file)))
}

/** The unique set of sealed envelopes across the test's stored files. The guard
 *  preserves the exact stored envelope (idempotent), so a masked re-save must
 *  not grow this set; a regression seals the placeholder into a new envelope. */
function sealedEnvelopes(testId: string): string[] {
  const text = testDirBytes(testId).toString('utf-8')
  const matches = text.match(/wave:enc:v1:[A-Za-z0-9+/=_-]+/g) ?? []
  return [...new Set(matches)].sort()
}

function sweepStore(needle: string): string[] {
  return listFiles(STORAGE_BASE_PATH).filter((file) => fs.readFileSync(file).includes(needle))
}

// --- workbench reload (same test, fresh session) --------------------------

async function reloadTest(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function runAndReadLogs(page: Page): Promise<string[]> {
  await selectEnvironment(page)
  await runToTerminal(page)
  return getLogTexts(page)
}

test.describe('V-SECRET-SAVE-ROUNDTRIP-FUNCTIONAL', () => {
  test('a masked re-save preserves the stored secret; both runs compute on the real bytes', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, loadFixture())

    await test.step('Criterion 1: import sealed the secret and it is absent from the store', async () => {
      const bytes = testDirBytes(testId)
      expect(bytes.includes(ENVELOPE), 'test definition must carry a sealed envelope').toBeTruthy()
      expect(bytes.includes(CANARY_RT), 'the secret must not sit in the definition').toBeFalsy()
      expect(sweepStore(CANARY_RT), 'the secret leaked into the store').toEqual([])
    })

    const envelopeBefore = sealedEnvelopes(testId)
    expect(envelopeBefore.length, 'the secret must be sealed on disk').toBeGreaterThan(0)

    await test.step('Criterion 1: the first run slices the REAL suffix; the direct log masks', async () => {
      const logs = await runAndReadLogs(page)
      const all = logs.join('\n')
      expect(
        logs.some((t) => t === `rt-proof=${RT_SUFFIX}`),
        `Expected the real slice proof. Got:\n${all}`,
      ).toBeTruthy()
      expect(logs.some((t) => t === MASK), `Expected the masked direct log. Got:\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'plain=7'), `Expected the plain log. Got:\n${all}`).toBeTruthy()
      expect(all).not.toContain(CANARY_RT)
    })

    await test.step('Criterion 2: edit an UNRELATED variable in the workbench and save (secret rides along masked)', async () => {
      await reloadTest(page, testId)
      await expandVariableManager(page)

      // The masked read renders the secret as ******** after the reload.
      await expect(
        variableRow(page, 'secret_token').locator('[data-testid^="variable-value-"]'),
      ).toHaveText(MASK)

      // Edit the plain integer var through its Edit window (an unrelated change).
      const win = await openEditWindow(page, 'plain_counter')
      await expect(valueEditor(page, win)).toHaveValue('7')
      await setWindowValue(page, win, 99)
      await saveWindow(page, win)
      await expect(variableRow(page, 'plain_counter').locator('[data-testid^="variable-value-"]')).toHaveText('99')

      // The variable edit dirtied the workbench - the toolbar Save persists the
      // whole definition, secret included (as ********), through the guard.
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
    })

    await test.step('Criterion 2: the unrelated edit persisted, the secret stays masked, and its envelope is unchanged', async () => {
      const read = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(read.ok()).toBeTruthy()
      const vars = (await read.json()).data.variables as Record<string, { value: unknown }>
      expect(Number(vars.plain_counter.value), 'the unrelated edit must have persisted').toBe(99)
      expect(vars.secret_token.value, 'the secret must read back masked').toBe(MASK)

      const bytes = testDirBytes(testId)
      expect(bytes.includes(CANARY_RT), 'the re-save must not leak the secret').toBeFalsy()
      expect(sweepStore(CANARY_RT), 'the secret leaked after the re-save').toEqual([])
      expect(
        sealedEnvelopes(testId),
        'the sealed secret envelope must be byte-identical (no placeholder re-seal)',
      ).toEqual(envelopeBefore)
    })

    await test.step('Criterion 3: a run after the masked re-save STILL slices the real bytes', async () => {
      await reloadTest(page, testId)
      const logs = await runAndReadLogs(page)
      const all = logs.join('\n')
      expect(
        logs.some((t) => t === `rt-proof=${RT_SUFFIX}`),
        `The guard regressed: the run sliced the placeholder, not the real secret. Got:\n${all}`,
      ).toBeTruthy()
      expect(logs.some((t) => t === 'plain=99'), `Expected the re-saved plain value. Got:\n${all}`).toBeTruthy()
      expect(all).not.toContain(CANARY_RT)
    })
  })

  test('Mark as secret lives in the window, never the watcher; a saved secret stays write-only', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    const secretControls = (root: ReturnType<Page['locator']>) =>
      root.locator(
        '[data-testid*="secret-checkbox"], [data-testid*="secret-toggle"], [aria-label="Secret"]',
      )

    await test.step('a plain variable: the watcher carries no secret control, the Edit window an unticked Mark as secret', async () => {
      const row = variableRow(page, 'plain_counter')
      await row.locator('[data-testid^="expand-button-"]').click()
      const seen = page.locator('section[aria-label="Inspect variable plain_counter"]')
      await expect(seen).toBeVisible()
      await expect(secretControls(seen)).toHaveCount(0)
      await seen.locator('[aria-label="Close inspector for plain_counter"]').click()
      await expect(seen).toHaveCount(0)

      const win = await openEditWindow(page, 'plain_counter')
      await expect(windowCheckbox(win, 'secret')).toHaveAttribute('data-state', 'unchecked')
      await cancelWindow(page, win)
    })

    await test.step('a saved secret opens masked with Mark as secret ticked; Delete & Edit opens it empty', async () => {
      const win = await openEditWindow(page, 'secret_token')
      await expect(windowCheckbox(win, 'secret')).toHaveAttribute('data-state', 'checked')
      await expect(
        valueField(win).getByRole('button', { name: 'Value: Edit protected value', exact: true }),
      ).toBeVisible()
      await expect(win).not.toContainText(CANARY_RT)
      // Write-only: the stored value never seeds the field.
      await editProtectedValue(page, win, 'Delete & Edit')
      await expect(valueEditor(page, win)).toHaveValue('')
      await cancelWindow(page, win, 'Close')
    })

    await test.step('the Add window carries Mark as secret', async () => {
      await openCreateModal(page)
      await expect(createModal(page).locator('[data-testid="create-secret-checkbox"]')).toBeVisible()
      await cancelCreate(page)
    })
  })
})
