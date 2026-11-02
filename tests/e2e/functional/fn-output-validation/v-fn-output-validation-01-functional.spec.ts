/**
 * V-FN-OUTPUT-VALIDATION-01 (functional): a declared output that no block
 * writes is a non-blocking WARNING - save, run, and publish all proceed -
 * and the message expresses the documented no-producer rule.
 *
 * REQ: REQ-3.1.2.4, REQ-3.1.2.7
 *
 * The runtime WARN for the unwritten output reaches the run console when the
 * call starts (FNCFG-5; asserted in v-fn-unused-param-warn-functional.spec.ts);
 * this functional test proves the user-facing non-blocking contract end-to-end.
 *
 * Phase: functional-workflow (runs the workflow via the UI).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  createValidTest,
  validateTest,
  codesOf,
  localFunctionNode,
  logNode,
  startEdge,
} from '../../helpers/fn-seed'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)
const FN_NODE_ID = 'fn-b6'
const NO_PRODUCER = 'OUTPUT_HAS_NO_PRODUCER'

/** A Test whose Local Function declares output `result` but only logs - nothing
 *  writes `output.result`, so the no-producer rule applies. */
function buildNoProducerTest(name: string) {
  return {
    name,
    nodes: [
      localFunctionNode(FN_NODE_ID, 'NoProducerFn', {
        nodes: [logNode('inner-log', 'Log', "'function ran'")],
        edges: [startEdge('inner-log')],
        inputs: [],
        outputs: [{ name: 'result', type: 'string', description: '' }],
        variables: [],
      }),
    ],
    edges: [startEdge(FN_NODE_ID)],
  }
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-FN-OUTPUT-VALIDATION-01: unproduced output is non-blocking', () => {
  test('save is non-blocking; validate flags it as a reworded WARNING', async ({ request }) => {
    // The no-producer is a WARNING (severity warning,
    // code OUTPUT_HAS_NO_PRODUCER), never an error - so the Save succeeds.
    const testId = await createValidTest(request, buildNoProducerTest(`No producer save ${RUN}`))

    const result = await validateTest(request, testId, 'run')
    expect(result.status, 'validate must not block (200, not 422)').toBe(200)
    expect(codesOf(result.warnings)).toContain(NO_PRODUCER)
    expect(codesOf(result.errors)).not.toContain(NO_PRODUCER)

    const warning = result.warnings.find((w) => w.code === NO_PRODUCER)
    expect(String(warning?.message)).toMatch(/^Declared output '.+' is not written by any block$/)
  })

  test('the Test runs to completion despite the unproduced output', async ({ page }) => {
    // Run is non-blocking - the Function still passes.
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await ensureEnvironment(page.request)
    const testId = await createValidTest(page.request, buildNoProducerTest(`No producer run ${RUN}`))

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 20_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 5_000 })
    await expect(page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)).toHaveAttribute(
      'data-execution-status',
      /passed|success/,
      { timeout: 5_000 },
    )
  })

  test('publishing the Function proceeds despite the unproduced output', async ({ request }) => {
    // Publish is non-blocking too.
    const testId = await createValidTest(request, buildNoProducerTest(`No producer publish ${RUN}`))
    const etag = (await request.get(`${BACKEND_URL}/tests/${testId}`)).headers()['etag']

    const pubResp = await request.post(`${BACKEND_URL}/tests/${testId}/functions/publish`, {
      headers: etag ? { 'If-Match': etag } : {},
      data: {
        node_id: FN_NODE_ID,
        name: `NoOutPub-${RUN}-${randomUUID().slice(0, 6)}`,
        version: '1.0.0',
        changelog: 'Initial',
        details: 'Published with an unproduced declared output (non-blocking)',
      },
    })
    expect(pubResp.ok(), `publish must proceed: ${pubResp.status()} ${await pubResp.text()}`).toBeTruthy()
  })
})
