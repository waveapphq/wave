/**
 * V-CSV-SECRET-MASKING-FUNCTIONAL: secret-masking guards.
 *
 * REQ: REQ-3.1.3.5 / REQ-4.5.3 (secret masking on every runtime surface)
 *
 * Scrub-before-truncate and both-quote-context escaped forms, end to end. A multiline
 * CSV-content secret makes the CSV plugin the natural vehicle; backend unit tests cover
 * the masking itself.
 *
 * Each secret carries a distinctive family token that survives BOTH its raw value and its
 * repr-escaped form (\n, \t, \", \', a >2048 prefix), so a single family-token sweep across
 * the INFO console + the DEBUG WS Inputs echo guards the escaped-form AND scrub-before-truncate
 * leaks in one assertion. The secrets ride a plugin's DEBUG Inputs echo as NON-declared-secret
 * inputs (CSV csv_content / Log message); a secret variable auto-registers, so the echo masks it.
 *
 * Pass Criteria:
 *  G-1 newline  secret CSV content masks in the Inputs echo; raw + \n-escaped forms absent
 *  G-2 special  tab / quote / backslash secret masks; every repr-escaped form absent
 *  G-3 apostrophe secret in a composed string masks (quote-flip); \'-escaped form absent
 *  G-4 >2048    long secret masks to ******** (scrub-before-truncate), never a plaintext prefix
 *  G-6 short    a 4-char PIN masks (no length floor for a directly-registered secret)
 *  positive control: a non-secret sibling stays cleartext (masking is selective, not blanket)
 *
 * G-5 (a secret bound to an ENUM param that fails validation surfaces only a length, never
 * content) and G-7 (per-field reveal shows one secret raw while a DIFFERENT protected secret in
 * the same field stays masked) are behaviors of the shared enum validator and the declared-
 * secret-param per-field reveal, which the CSV plugin does not have (no base-validator enum
 * param, no declared secret param). They are covered end-to-end by the existing secret suites
 * (validation-runtime-enum, secret-field-cycle, secret-field-masking, secret-reveal-controls)
 * and at the backend by tests/plugins/test_enum_validator.py + tests/api/workbench/test_secret_runtime.py.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/csv-secret-masking/v-csv-secret-masking-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate, getActiveSessionId } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { ensureEnvironment } from '../../helpers/config'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import fs from 'fs'
import path from 'path'

const PIN = '8342'
const PLAIN = 'plain-ok-visible-77'
const MASK = SECRET_MASK

// Each secret-consuming node's DEBUG Inputs echo must carry the masked secret and
// NEVER the family token (which survives the raw value AND every repr-escaped form),
// so one per-node check guards the newline / tab-quote-backslash / apostrophe (quote-flip)
// / scrub-before-truncate leaks. Scoped to the Inputs line (G-1..G-4 are
// about the plugin INPUT echo). The parsed table OUTPUT is a transform of the secret whose
// cells are substrings of the registered value - visible by WAVE's documented model (the
// registry scrubs the exact registered value, not its substrings), so it is out of scope.
const INPUT_MASK_NODES: Array<{ node: string; token: string }> = [
  { node: 'csv-g1', token: 'CSVNL-' }, // G-1 newline
  { node: 'csv-g2', token: 'CSVSP-' }, // G-2 tab / quote / backslash
  { node: 'csv-g4', token: 'CSVLG-' }, // G-4 > 2048 (scrub-before-truncate)
  { node: 'log-g3', token: 'CSVAP-' }, // G-3 apostrophe (quote-flip)
]

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

test.describe('V-CSV-SECRET-MASKING-FUNCTIONAL', () => {
  test('secret CSV content / composed / long / short values mask on every console + WS surface', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    await importValidateAndNavigate(page, loadFixture())

    // The leading Delay holds the run while we grab the session and subscribe, so
    // the DEBUG Inputs echoes for the CSV/Log nodes flow into the collector.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [`log:${sessionId}`])

    await test.step('run passes (computed on the real secret bytes)', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')
    })

    const logTexts = await getLogTexts(page)
    const events = await collector.harvest()
    await collector.close()
    const wsMessages = events
      .map((e) => (e as { message?: unknown }).message)
      .filter((m): m is string => typeof m === 'string')

    await test.step('G-1..G-4: each secret masks in its node Inputs echo; no raw/escaped form there', async () => {
      for (const { node, token } of INPUT_MASK_NODES) {
        const inputsLines = (
          events.filter(
            (e) =>
              (e as { blockId?: string }).blockId === node &&
              typeof (e as { message?: unknown }).message === 'string' &&
              (e as { message: string }).message.startsWith('Inputs:'),
          ) as Array<{ message: string }>
        ).map((l) => l.message)
        expect(
          inputsLines.length,
          `expected a DEBUG Inputs echo for node ${node}. Got:\n${wsMessages.join('\n')}`,
        ).toBeGreaterThan(0)
        const joined = inputsLines.join('\n')
        expect(joined, `node ${node} Inputs echo must carry the masked secret`).toContain(MASK)
        expect(
          joined,
          `node ${node} Inputs echo leaked ${token} (raw or repr-escaped form)`,
        ).not.toContain(token)
      }
    })

    await test.step('G-3/G-6: composed + short secrets mask in the INFO console; plain sibling visible', async () => {
      const infoJoined = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === `g3=${MASK}`),
        `apostrophe secret must mask in the composed console line. Got:\n${infoJoined}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `g6=${MASK}`),
        `short (4-char) secret must mask - no length floor. Got:\n${infoJoined}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `plain=${PLAIN}`),
        `non-secret sibling must stay cleartext (masking is selective). Got:\n${infoJoined}`,
      ).toBeTruthy()
      // The INFO console (Log outputs, no parsed table) must carry neither the short
      // PIN nor the apostrophe secret in any form.
      expectNoSecret(infoJoined, 'INFO console', [PIN, 'CSVAP-'], undefined)
    })
  })
})
