/**
 * V-SECRET-FIELD-CYCLE-FUNCTIONAL: per-field reveal then re-mask cycle end-to-end.
 *
 * REQ: REQ-3.1.3.16 (per-block protocol-field masking control).
 *
 * Drives the "Mask specific fields" list in the block "Secrets" section through
 * the config modal (not a pre-set fixture): unmask Set-Cookie, run, prove the
 * cookie renders cleartext in the HTTP block's OWN output (report carries its
 * Outputs line) while every other block still masks it - the reveal is
 * block-scoped, the credential registers run-wide either way. Re-mask it,
 * RESET the console (entries accumulate across runs), run again, prove the
 * placeholder everywhere.
 *
 * Phase: functional-workflow (imports its own fixture; two runs + config edits).
 * Run: ./scripts/e2e-targeted-local.sh functional/secret-field-cycle/v-secret-field-cycle-functional.spec.ts
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { getLogTexts, clearConsoleLogs } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment, configSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// The http-echo service's server-side default cookie value, delivered as
// `Set-Cookie: wave_session=<value>` (never in a request URL).
const COOKIE_SECRET = 'wave-c00kie-s3cr3t-4417'
const MASK = '********'
const HTTP_ID = 'http-cookie'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** Open the HTTP node's config sheet and expand the "Secrets" section. */
async function openHttpSecrets(page: Page): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${HTTP_ID}"]`).locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog.locator('[data-testid="secrets-section-trigger"]').click()
  await expect(dialog.locator('[data-testid="secret-mask-field-set-cookie"]')).toBeVisible()
  return dialog
}

/** Apply the config sheet, then persist the workbench draft. */
async function saveConfigAndWorkbench(page: Page, dialog: Locator): Promise<void> {
  const configSave = dialog.getByRole('button', { name: /^Save$/ }).last()
  await expect(configSave).toBeEnabled()
  await configSave.click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
}

const MASKED_COOKIE = /set-cookie'?: '?\*{8}/i

/** Console texts once the masked Set-Cookie echo has rendered; the console can trail the passed status. */
async function textsAfterCookieEcho(page: Page): Promise<string[]> {
  let texts: string[] = []
  await expect
    .poll(async () => {
      texts = await getLogTexts(page)
      return texts.some((t) => MASKED_COOKIE.test(t))
    }, { timeout: 15_000 })
    .toBeTruthy()
    .catch(() => undefined)
  return texts
}

async function runToPassed(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
  await expect(status).toHaveAttribute('data-status', 'passed')
}

test.describe('V-SECRET-FIELD-CYCLE-FUNCTIONAL', () => {
  test('Set-Cookie reveal then re-mask: unmask runs cleartext, re-mask runs placeholder', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })
    await selectEnvironment(page)

    // Reveal Set-Cookie via "Mask specific fields" (uncheck = reveal).
    let dialog = await openHttpSecrets(page)
    const setCookie = dialog.locator('[data-testid="secret-mask-field-set-cookie"]')
    await expect(setCookie, 'Set-Cookie starts masked (checked)').toHaveAttribute(
      'data-state',
      'checked',
    )
    await setCookie.click()
    await expect(setCookie, 'unchecking reveals the field').toHaveAttribute('data-state', 'unchecked')
    await saveConfigAndWorkbench(page, dialog)

    await runToPassed(page)
    // A per-field reveal must not disable run-wide scrubbing -
    // the downstream Log block still masks the cookie it echoes.
    let texts = await textsAfterCookieEcho(page)
    let all = texts.join('\n')
    expect(all, `another block's echo must stay masked. Got:\n${all}`).not.toContain(COOKIE_SECRET)
    expect(
      texts.find((t) => MASKED_COOKIE.test(t)),
      `the echoed headers map must render Set-Cookie as ${MASK}. Got:\n${all}`,
    ).toBeTruthy()

    // Positive control the reveal still works: the HTTP block's OWN Outputs
    // line (DEBUG, report-visible) carries the cleartext cookie.
    const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
    expect(genResp.status(), await genResp.text()).toBe(200)
    const contentResp = await page.request.get(
      `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
    )
    expect(contentResp.ok()).toBeTruthy()
    const report = await contentResp.text()
    expect(report, 'the revealing block must show its own cookie in the report').toContain(
      `wave_session=${COOKIE_SECRET}`,
    )

    // Re-mask Set-Cookie (re-check = mask).
    dialog = await openHttpSecrets(page)
    const setCookieAgain = dialog.locator('[data-testid="secret-mask-field-set-cookie"]')
    await expect(setCookieAgain, 'still revealed from the prior edit').toHaveAttribute(
      'data-state',
      'unchecked',
    )
    await setCookieAgain.click()
    await expect(setCookieAgain, 're-checking re-masks the field').toHaveAttribute(
      'data-state',
      'checked',
    )
    await saveConfigAndWorkbench(page, dialog)

    // RESET the console (entries accumulate across runs) and re-run.
    await clearConsoleLogs(page)
    await runToPassed(page)
    texts = await textsAfterCookieEcho(page)
    all = texts.join('\n')
    expect(all, `re-masked run leaked the cookie token:\n${all}`).not.toContain(COOKIE_SECRET)
    expect(
      texts.find((t) => MASKED_COOKIE.test(t)),
      `re-masked Set-Cookie must render ${MASK}. Got:\n${all}`,
    ).toBeTruthy()
  })
})
