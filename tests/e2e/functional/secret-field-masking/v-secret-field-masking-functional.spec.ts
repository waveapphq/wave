/**
 * V-SECRET-FIELD-MASKING-FUNCTIONAL: per-block Secret masking end-to-end.
 *
 * REQ: REQ-3.1.3.16 (per-block protocol-field masking control)
 *
 * Two HTTP blocks hit the http-echo cookie endpoint; each binds its response headers
 * map to a variable a downstream Log prints. The two blocks differ ONLY in
 * whether they reveal the Set-Cookie field:
 *
 *  - Block A (default, Set-Cookie CHECKED): the plugin masks Set-Cookie in its
 *    own log AND registers the value with the run's secret registry, so the
 *    cookie token is scrubbed everywhere. The headers map itself stays viewable
 *    (structure + non-credential values), only the credential renders masked.
 *  - Block B (Set-Cookie REVEALED via unmasked_secret_fields): the value still
 *    registers run-wide; the reveal exempts ONLY Block B's own display lines.
 *    Any other block echoing the (distinct) token masks it.
 *
 * The two blocks carry DISTINCT tokens by construction so each side's
 * assertions can't be satisfied by the other block's registration.
 *
 * Pass Criteria (asserted on persisted execution output - logs + report):
 * 1. Block A's cookie token appears NOWHERE in the run's logs or report.
 * 2. Block A's headers map is still viewable: Set-Cookie renders as the
 *    placeholder while a non-credential header (Content-Type) stays readable.
 * 3. Block B's token is masked in the downstream Log block's echo - a
 *    per-field reveal never unmasks any other block.
 * 4. The report carries Block B's OWN Outputs line cleartext (the reveal
 *    works where it belongs) and Block A's token nowhere.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// Block A uses http-echo's server-side default cookie value (never in a
// request URL, so it can only leak via the response path this test guards).
const MASKED_TOKEN = 'wave-c00kie-s3cr3t-4417'
// Block B's revealed token (fixture URL ?value=...), distinct from MASKED_TOKEN.
const REVEALED_TOKEN = 'rev34l-c00kie-t0k3n-5591'
const MASK = '********'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

test.describe('V-SECRET-FIELD-MASKING-FUNCTIONAL', () => {
  test('a masked field is scrubbed run-wide while a revealed field flows visible', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })

    await test.step('Run workflow to passed', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')
    })

    const logTexts = await getLogTexts(page)
    const all = logTexts.join('\n')

    await test.step('Criteria 1+2: masked block - token nowhere, container still viewable', async () => {
      // The masked headers-map log line: Set-Cookie collapses to the placeholder.
      const maskedLine = logTexts.find((t) => /set-cookie'?: '?\*{8}/i.test(t))
      expect(
        maskedLine,
        `Expected a masked headers line carrying "Set-Cookie: ${MASK}". Got:\n${all}`,
      ).toBeTruthy()
      // Non-credential header stays readable (container viewable - SECMASK-3 / UX1).
      expect(
        maskedLine!.toLowerCase(),
        `Non-credential headers must stay readable in the masked map. Got:\n${maskedLine}`,
      ).toContain('application/json')
      // The masked token never appears anywhere in the run's logs.
      expect(all, `masked cookie token leaked into logs:\n${all}`).not.toContain(MASKED_TOKEN)
    })

    await test.step('Criteria 3: revealed block - other blocks still mask its credential', async () => {
      // A per-field reveal must not disable run-wide
      // scrubbing - both downstream Log echoes of the headers maps mask.
      // httpx normalizes header names to lowercase, so the echoed key is 'set-cookie'.
      const mapEchoes = logTexts.filter((t) => t.toLowerCase().includes("'set-cookie'"))
      expect(
        mapEchoes.length,
        `both headers maps must echo through the Log blocks. Got:\n${all}`,
      ).toBeGreaterThanOrEqual(2)
      for (const line of mapEchoes) {
        expect(line, 'an echoed headers map leaked the revealed credential').not.toContain(
          REVEALED_TOKEN,
        )
        expect(
          line.toLowerCase(),
          `echoed Set-Cookie must render ${MASK}`,
        ).toContain(`'set-cookie': '${MASK}'`)
      }
    })

    await test.step('Criteria 4: report - reveal visible only in Block B\'s own line', async () => {
      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)

      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()

      expect(report, 'masked cookie token leaked into the report').not.toContain(MASKED_TOKEN)
      // Positive control: Block B's OWN Outputs line carries its cookie
      // cleartext - the reveal still works where it belongs.
      expect(report, 'the revealing block must show its own cookie').toContain(
        `wave_session=${REVEALED_TOKEN}`,
      )
    })
  })
})
