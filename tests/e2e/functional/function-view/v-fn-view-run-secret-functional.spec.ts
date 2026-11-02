/**
 * V-FN-VIEW-RUN-SECRET-FUNCTIONAL: a library View run uses each secret's real value
 * Wireframe: none
 * Design Decisions: FNCFG-8
 * REQ: REQ-3.2.1.1, REQ-3.1.3.5, REQ-4.5.1
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a library Function
 * through POST /functions whose secret local `token` and secret output `out_tok` (a default) are
 * read by its body Log for their length and last six characters only. Both runs go through the
 * library View's Run button.
 *
 * Pass Criteria:
 * 1. Running the Published version prints each secret's real length and tail: the run held the
 *    values, never the sealed envelope or `********`.
 * 2. Running the edit-mode draft (a draft run made from that version) prints the same.
 * 3. No console line holds either value or an envelope.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { logNode, openFunctionView, publishLibraryFunction, startEdge } from '../../helpers/fn-seed'
import { clearConsoleLogs, expectConsoleLine, formatEntries, getLogEntries, waitForLogText, type LogEntry } from '../../helpers/log-reader'
import { SECRET_ENVELOPE } from '../../helpers/secret-canary'
import { selectEnvironment } from '../../helpers/workbench'

/** Run from the View, wait for the body line and a passed verdict, and return the console. */
async function runFromView(page: Page): Promise<LogEntry[]> {
  await page.locator('[data-testid="run-button"]').click()
  await waitForLogText(page, 'len=', 60_000)
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'passed', {
    timeout: 30_000,
  })
  return getLogEntries(page)
}

function expectRealValueUsed(entries: LogEntry[], canary: string, output: string): void {
  expectConsoleLine(
    entries,
    'INFO',
    `len=${canary.length} tail=${canary.slice(-6)} olen=${output.length} otail=${output.slice(-6)}`,
  )
  const leaked = entries.filter(
    (entry) =>
      entry.message.includes(canary) || entry.message.includes(output) || entry.message.includes(SECRET_ENVELOPE),
  )
  expect(leaked, `no line holds the value or an envelope.\n${formatEntries(entries)}`).toEqual([])
}

test.describe('V-FN-VIEW-RUN-SECRET-FUNCTIONAL: a library View run and secret values', () => {
  let functionId: string | undefined

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (functionId) await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`).catch(() => undefined)
  })

  // Per FNCFG-8: a run alone starts from the Function's own values; a secret is its real value.
  test('the Published version and an edit-mode draft run on the real secret value', async ({ page, request }) => {
    test.setTimeout(150_000)
    await ensureEnvironment(request)
    const tag = randomUUID().slice(0, 8)
    const canary = `view-secret-${randomUUID()}`
    const output = `view-output-${randomUUID().slice(0, 13)}`
    const fn = await publishLibraryFunction(request, {
      name: `v-fn-view-run-secret-${tag}`,
      variables: [{ name: 'token', type: 'string', value: canary, secret: true }],
      outputs: [{ name: 'out_tok', type: 'string', secret: true, default: output }],
      workflow: {
        nodes: [
          logNode(
            'body-log',
            'Body',
            "f'len={len(token)} tail={token[-6:]} olen={len(out_tok)} otail={out_tok[-6:]}'",
          ),
        ],
        edges: [startEdge('body-log')],
      },
    })
    functionId = fn.functionId
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)

    await test.step('the Published version runs on the real value', async () => {
      expectRealValueUsed(await runFromView(page), canary, output)
    })

    await test.step('the edit-mode draft runs on the real value', async () => {
      await page.locator('[data-testid="action-bar-edit-function-button"]').click()
      await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
      await clearConsoleLogs(page)
      const runRequest = page.waitForRequest(
        (req) => req.method() === 'POST' && req.url().includes(`/functions/${fn.functionId}/run`),
      )
      const entries = runFromView(page)
      const sent = (await runRequest).postDataJSON()
      expect(sent.draft, 'the edit-mode Run runs the draft').toBeTruthy()
      expect(sent.version, 'the draft names the version it was made from').toBe(fn.version)
      expectRealValueUsed(await entries, canary, output)
    })
  })
})
