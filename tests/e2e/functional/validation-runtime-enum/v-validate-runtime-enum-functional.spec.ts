/**
 * V-VALIDATE-RUNTIME-ENUM-FUNCTIONAL: Runtime enum validator end-to-end
 *
 * Imports a fixture with two HTTP nodes whose `method` is an expression giving a
 * value outside the list (3-char and 60-char), each wrapped in try-catch so the
 * workflow completes and the catch path logs the captured error message.
 *
 * Verifies:
 *  - The same value saved as a literal is refused at save with INVALID_ENUM_VALUE
 *    and its exact text; nothing is stored.
 *  - The expression fixture passes validation (an expression is checked when the Block runs).
 *  - Both HTTP nodes fail at runtime, the try-catch handles the error, the
 *    workflow completes successfully.
 *  - The captured error message matches the anchored format exactly:
 *      ^Parameter 'method' must be one of: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; Actual value was '<value>'\.$
 *  - For the 60-character method value, the error shows only the value's LENGTH
 *    ("a 60-character value"), never a truncated prefix (secret-safe enum fix).
 *
 * REQ: REQ-3.4.2.3, REQ-3.1.2.4
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('Validation: runtime enum validator', () => {
  test('HTTP method enum: short + 50-char-truncated values produce exact anchored error', async ({
    page,
  }) => {
    const fixture = loadFixture()

    // Reset workbench session and ensure shared environment exists.
    await page.request
      .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
      .catch(() => {})
    await ensureEnvironment(page.request)

    // ------------------------------------------------------------------
    // STEP 0: the same value saved as a literal is refused at save.
    // ------------------------------------------------------------------
    const literal = structuredClone(fixture) as { name: string; workflow: { nodes: Array<Record<string, any>> } }
    literal.name = `${literal.name} literal ${Date.now()}`
    const literalNode = literal.workflow.nodes.find((node) => node.id === 'http-xyz')!
    literalNode.data.expressionFields = []
    literalNode.data.config.values.method = 'xyz'
    const refused = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: literal })
    expect(refused.status(), 'a literal method outside the list is refused at save').toBe(422)
    const refusedBody = await refused.json()
    expect(
      (refusedBody.error.details as Array<{ code: string; message: string; node_id: string }>).map((d) => [
        d.code,
        d.node_id,
        d.message,
      ]),
    ).toEqual([
      [
        'INVALID_ENUM_VALUE',
        'http-xyz',
        `Setting 'method' of block 'http-client' must be one of: ${ALLOWED_METHODS}`,
      ],
    ])

    // ------------------------------------------------------------------
    // STEP 1: Import fixture via POST /tests
    // The method is an expression, so the value is checked when the Block runs.
    // ------------------------------------------------------------------
    const createResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests`,
      { data: fixture }
    )
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`
    ).toBeTruthy()
    const testId = createBody.data?.id || createBody.id
    expect(testId).toBeTruthy()

    // Validate: an expression is not checked against the list until the Block runs.
    const validateResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests/${testId}/validate?context=run`
    )
    expect(validateResp.ok()).toBeTruthy()
    const validateBody = await validateResp.json()
    expect(validateBody.data.fatal).toBe(false)
    expect(validateBody.data.errors).toHaveLength(0)

    // ------------------------------------------------------------------
    // STEP 2: Open in workbench and run with the shared env.
    // ------------------------------------------------------------------
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') {
      const lines = await getLogLines(page)
      test.info().annotations.push({ type: 'workflow-status', description: statusVal ?? 'null' })
      test.info().annotations.push({ type: 'logs', description: JSON.stringify(lines) })
    }
    expect(statusVal).toBe('passed')

    // ------------------------------------------------------------------
    // STEP 3: Verify the captured error messages match exactly.
    // ------------------------------------------------------------------
    const lines = await getLogLines(page)

    // A short value is echoed verbatim; a value over the display limit shows only
    // its LENGTH ("a N-character value"), never a truncated prefix - a truncated
    // prefix could leak the first chars of a secret bound to the enum param (the
    // 2026-07-24 secret-safe enum fix; backend contract: test_enum_validator.py).
    const expectedXyz = `^\\[WARN\\] SYSTEM: Try-path error caught: Parameter 'method' must be one of: ${ALLOWED_METHODS}; Actual value was 'xyz'\\.$`
    const expectedLong = `^\\[WARN\\] SYSTEM: Try-path error caught: Parameter 'method' must be one of: ${ALLOWED_METHODS}; Actual value was a 60-character value\\.$`

    const xyzRe = new RegExp(expectedXyz)
    const longRe = new RegExp(expectedLong)

    const matchedXyz = lines.find((line) => xyzRe.test(line))
    const matchedLong = lines.find((line) => longRe.test(line))

    expect(
      matchedXyz,
      `Expected log line matching ${xyzRe.source}\nGot:\n${lines.join('\n')}`
    ).toBeTruthy()
    expect(
      matchedLong,
      `Expected log line matching ${longRe.source}\nGot:\n${lines.join('\n')}`
    ).toBeTruthy()

    // Catch markers prove both try-catch blocks fired the catch path.
    expect(lines.some((l) => l.includes('xyz-caught'))).toBeTruthy()
    expect(lines.some((l) => l.includes('long-caught'))).toBeTruthy()

    // Bookends prove the test reached the post-try-catch chain.
    expect(lines.some((l) => l.includes('before-all'))).toBeTruthy()
    expect(lines.some((l) => l.includes('after-all'))).toBeTruthy()
  })
})
