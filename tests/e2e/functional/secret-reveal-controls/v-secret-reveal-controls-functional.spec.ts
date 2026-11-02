/**
 * V-SECRET-REVEAL-CONTROLS-FUNCTIONAL: controlled secret reveal end-to-end.
 *
 * REQ: REQ-3.1.3.5 / REQ-4.5.3 (per-block run-output masking control) +
 *      REQ-3.1.3.17 (system-wide per-surface reveal controls).
 *
 * One fixture chains three Log blocks that print the same secret with distinct
 * tri-state settings (Always reveal / Use system setting / Always mask), plus a
 * leading Delay and a Var Setter, and declares a saved secret variable
 * (`api_token`) the panel and watcher reveal.
 *
 * The scope-based controls:
 *   - `test_variables`  -> the whole workbench Variable Manager surface (the panel
 *                          rows AND the inspect/watcher modal, together).
 *   - `shared_variables`-> the global / regression / suite variable editors.
 * `run_output` (per-block + system run-output reveal) is unchanged.
 *
 * Every assertion is on the RENDERED UI (console text, the session panel cell, the
 * inspect modal, the entity read-only table), so a surface that fails to reveal
 * fails here. All flags reset in beforeEach/afterEach so a revealed flag never
 * leaks to another spec on the same backend.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, clearConsoleLogs } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const RAW_TOKEN = 's3cr3t-Bearer-Tok3n-9917'
const REVEAL_FRAGMENT = 's3cr3t-Bearer' // survives value-cell truncation
const MASK = '********'

// Exact WARN strings (backend execution.py; asserted verbatim).
const RUN_START_WARN =
  "Secret masking bypassed for 1 block(s): Log. Secret values appear in cleartext in this run's logs and reports."
const PRE_BLOCK_WARN =
  'Secret masking bypassed for this block - secret values appear in cleartext in its logs and reports.'

type MaskingFlags = Partial<{
  run_output: boolean
  test_variables: boolean
  shared_variables: boolean
  credential_inputs: boolean
}>

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function setMaskingFlags(page: Page, partial: MaskingFlags): Promise<void> {
  const resp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: partial })
  expect(
    resp.ok(),
    `PUT /admin/secret-masking failed: ${resp.status()} - ${await resp.text()}`,
  ).toBeTruthy()
}

async function resetMaskingFlags(page: Page): Promise<void> {
  await setMaskingFlags(page, {
    run_output: false,
    test_variables: false,
    shared_variables: false,
    credential_inputs: false,
  })
}

async function runToPassed(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  // The fixture's leading Delay guarantees a catchable 'running' window even on a re-run.
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 15_000 })
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 90_000 })
}

/** Flip system flags via the admin API, then reload the workbench so the client
 *  masking store re-hydrates to the new flags, leaving a fresh session ready to run. */
async function setFlagsAndReloadWorkbench(
  page: Page,
  testId: string,
  flags: MaskingFlags,
): Promise<void> {
  await setMaskingFlags(page, flags)
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  await selectEnvironment(page)
  await expandVariableManager(page)
}

let testId: string

test.describe('V-SECRET-REVEAL-CONTROLS-FUNCTIONAL', () => {
  test.beforeEach(async ({ page }) => {
    await resetMaskingFlags(page)
    testId = await importValidateAndNavigate(page, loadFixture())
  })

  test.afterEach(async ({ page }) => {
    await resetMaskingFlags(page)
  })

  test('block-level tri-state: Always-reveal shows cleartext, system(off) + Always-mask stay masked, with run-start + pre-block warnings', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await selectEnvironment(page)
    await runToPassed(page)

    const logTexts = await getLogTexts(page)
    const all = logTexts.join('\n')

    expect(
      logTexts.some((t) => t === `REVEAL:${RAW_TOKEN}`),
      `Always-reveal block must show cleartext. Got:\n${all}`,
    ).toBeTruthy()
    expect(
      logTexts.some((t) => t === `SYSTEM:${MASK}`),
      `Use-system-setting block must mask (run_output off). Got:\n${all}`,
    ).toBeTruthy()
    expect(all, 'Use-system-setting block leaked the token').not.toContain(`SYSTEM:${RAW_TOKEN}`)
    expect(
      logTexts.some((t) => t === `MASK:${MASK}`),
      `Always-mask block must mask. Got:\n${all}`,
    ).toBeTruthy()
    expect(all, 'Always-mask block leaked the token').not.toContain(`MASK:${RAW_TOKEN}`)

    expect(logTexts, `run-start WARN missing. Got:\n${all}`).toContain(RUN_START_WARN)
    expect(logTexts, `pre-block WARN missing. Got:\n${all}`).toContain(PRE_BLOCK_WARN)
  })

  test('run_output toggle: OFF masks the Use-system-setting block, ON reveals it and suppresses warnings', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    await selectEnvironment(page)

    await runToPassed(page)
    let logTexts = await getLogTexts(page)
    expect(
      logTexts.some((t) => t === `SYSTEM:${MASK}`),
      'baseline: Use-system-setting block masked while run_output off',
    ).toBeTruthy()
    expect(logTexts).toContain(RUN_START_WARN)

    await setMaskingFlags(page, { run_output: true })
    await clearConsoleLogs(page)
    await runToPassed(page)

    logTexts = await getLogTexts(page)
    const all = logTexts.join('\n')
    expect(
      logTexts.some((t) => t === `SYSTEM:${RAW_TOKEN}`),
      `run_output ON must reveal the Use-system-setting block. Got:\n${all}`,
    ).toBeTruthy()
    // A block explicitly Always-mask stays masked under a system reveal.
    expect(
      logTexts.some((t) => t === `MASK:${MASK}`),
      `Always-mask block must stay masked under system reveal. Got:\n${all}`,
    ).toBeTruthy()
    expect(all, 'Always-mask block leaked the token under system reveal').not.toContain(
      `MASK:${RAW_TOKEN}`,
    )
    expect(all, 'run-start WARN must be suppressed under system reveal').not.toContain(RUN_START_WARN)
    expect(all, 'pre-block WARN must be suppressed under system reveal').not.toContain(PRE_BLOCK_WARN)
  })

  test('test_variables toggle: OFF masks the panel + locks the watcher; ON reveals BOTH together', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await selectEnvironment(page)
    await expandVariableManager(page)
    await runToPassed(page)

    // OFF baseline: the panel masks the saved secret and its watcher is not inspectable.
    const maskedCell = variableRow(page, 'api_token').locator('[data-testid^="variable-value-"]')
    await expect(maskedCell, 'panel must mask the secret while test_variables off').toHaveText(MASK)
    await expect(
      variableRow(page, 'api_token').locator('[data-testid^="expand-button-"]'),
      'test_variables off must keep a saved secret un-inspectable',
    ).toBeDisabled()

    // Flip test_variables ON, reload to re-hydrate the store, re-run.
    await setFlagsAndReloadWorkbench(page, testId, { test_variables: true })
    await runToPassed(page)

    const row = variableRow(page, 'api_token')
    await expect(
      row.locator('[data-testid^="variable-value-"]'),
      'the panel row must reveal the plaintext when test_variables on',
    ).toContainText(REVEAL_FRAGMENT)

    const expandBtn = row.locator('[data-testid^="expand-button-"]')
    await expect(expandBtn, 'test_variables on must make the secret inspectable').toBeEnabled()
    await expandBtn.click()
    const modal = page.locator('section[aria-label="Inspect variable api_token"]')
    await expect(modal).toBeVisible()
    await expect(
      modal.locator('[data-testid="inspect-secret-masked"]'),
      'the watcher must not render the masked-secret placeholder when revealed',
    ).toHaveCount(0)
    await expect(modal, 'the watcher must render the revealed value').toContainText(REVEAL_FRAGMENT)
  })

  test('shared_variables toggle: reveals a system variable while a workbench test variable stays masked (scope isolation)', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const SYS_SECRET = 's3cr3t-sysvar-reveal-4242'

    const seed = await page.request.post(`${BACKEND_URL}/variables/system`, {
      data: {
        variables: {
          sv_sys_secret: { value: SYS_SECRET, type: 'string', scope: 'system', secret: true },
        },
      },
    })
    expect(seed.ok(), `seed system secret failed: ${seed.status()} - ${await seed.text()}`).toBeTruthy()

    const sysRow = (p: Page) =>
      p
        .locator('[data-testid="variable-readonly-table"] [data-testid="variable-row"]')
        .filter({ hasText: 'sv_sys_secret' })

    try {
      // Masked baseline: the system read-only table shows ********.
      await page.goto('/settings/variables')
      await expect(sysRow(page)).toBeVisible()
      await expect(sysRow(page), 'system var must mask while shared_variables off').toContainText(MASK)
      await expect(sysRow(page)).not.toContainText('4242')

      // Flip shared_variables ON, reload settings (re-hydrate store + re-fetch).
      await setMaskingFlags(page, { shared_variables: true })
      await page.goto('/settings/variables')
      await expect(
        sysRow(page),
        'system var must reveal plaintext when shared_variables on',
      ).toContainText('4242')

      // Scope isolation: a workbench TEST variable stays masked - shared_variables
      // does not reveal the test-variable surface (that is test_variables).
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
      await expandVariableManager(page)
      await expect(
        variableRow(page, 'api_token').locator('[data-testid^="variable-value-"]'),
        'a test variable must stay masked under shared_variables only',
      ).toHaveText(MASK)
    } finally {
      await page.request.delete(`${BACKEND_URL}/variables/system/sv_sys_secret`).catch(() => {})
    }
  })
})
