/**
 * V-JSON-CONTENT-KINDS (functional): JSON parser json_content as literal / expression / template,
 * across combined + individual output modes.
 *
 * Proves end-to-end:
 *  - A json_content EXPRESSION body (`raw_json`) resolves and
 *    parses at runtime.
 *  - A json_content TEMPLATE body (`{{ who }}`) still renders and
 *    parses.
 *  - A json_content LITERAL still parses.
 *  - output_mode drives results both ways: combined yields a results map; individual
 *    yields per-query typed variables (float / integer / boolean coercion).
 *
 * Phase: functional-workflow (imports its own fixture via POST /tests, then runs it).
 * Run: ./scripts/e2e-targeted-local.sh functional/json-parser-content-kinds/v-plugin-json-content-kinds-functional.spec.ts
 *
 * REQ: REQ-3.4.2.2, REQ-3.6.2.2, REQ-3.1.3.13.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const PARSER_IDS = ['json-lit', 'json-expr', 'json-tmpl']
const LOG_IDS = [
  'log-lit-name',
  'log-lit-count',
  'log-expr-price',
  'log-expr-qty',
  'log-expr-active',
  'log-tmpl-store',
]

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  const fixture = JSON.parse(raw) as Record<string, unknown>
  fixture.name = `JSON Parser Content Kinds ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

test.describe('V-JSON-CONTENT-KINDS functional: json_content literal / expression / template', () => {
  test('imports, validates clean, runs, and proves expression + template + both output modes', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await ensureEnvironment(request)

    // ----------------------------------------------------------------------
    // Import + mandatory validation gate (zero errors).
    // ----------------------------------------------------------------------
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    const createResp = await request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
    const createBody = (await createResp.json().catch(() => null)) as Record<string, unknown> | null
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = ((createBody!.data as Record<string, unknown>)?.id ?? createBody!.id) as string

    const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
    const validateBody = (await validateResp.json().catch(() => null)) as Record<string, any> | null
    const errors =
      validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? validateBody?.errors ?? []
    expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

    // ----------------------------------------------------------------------
    // Open in the workbench and run to a terminal state.
    // ----------------------------------------------------------------------
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    if ((await status.getAttribute('data-status')) !== 'passed') {
      const errorLogs = (await getLogLines(page)).filter(
        (e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'),
      )
      test.info().annotations.push({ type: 'error-logs', description: JSON.stringify(errorLogs) })
    }
    expect(await status.getAttribute('data-status')).toBe('passed')

    // ----------------------------------------------------------------------
    // Console proves each json_content kind reached the parser and the queries
    // resolved against it.
    // ----------------------------------------------------------------------
    const logTexts = await getLogTexts(page)
    const allLogs = logTexts.join('\n')

    // Literal + combined: the results map carries the parsed values.
    expect(logTexts.some((t) => t === 'Ada'), `literal name "Ada" missing:\n${allLogs}`).toBeTruthy()
    expect(logTexts.some((t) => t === '7'), `literal count "7" missing:\n${allLogs}`).toBeTruthy()

    // Expression + individual: the json_content EXPRESSION (raw_json) resolved and
    // parsed, with per-query type coercion into typed variables.
    expect(
      logTexts.some((t) => t === '19.99'),
      `expression price_val (float) "19.99" missing:\n${allLogs}`,
    ).toBeTruthy()
    expect(
      logTexts.some((t) => t === '5'),
      `expression qty_val (integer) "5" missing:\n${allLogs}`,
    ).toBeTruthy()
    expect(
      logTexts.some((t) => t === 'True'),
      `expression active_val (boolean) "True" missing:\n${allLogs}`,
    ).toBeTruthy()

    // Template + combined: the {{ who }} template rendered to JSON and parsed.
    expect(
      logTexts.some((t) => t === 'BookShop'),
      `template store "BookShop" missing:\n${allLogs}`,
    ).toBeTruthy()

    // ----------------------------------------------------------------------
    // Every parser + log node succeeded.
    // ----------------------------------------------------------------------
    for (const id of [...PARSER_IDS, ...LOG_IDS]) {
      await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
        'data-execution-status',
        'success',
      )
    }
  })
})
