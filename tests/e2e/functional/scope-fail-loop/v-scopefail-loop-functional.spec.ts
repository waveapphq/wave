/**
 * V-SCOPEFAIL-LOOP-FUNCTIONAL: a split fail_current_scope assert inside a loop
 * body fails the run while the flow keeps going down its fail branch.
 * Design Decisions: CANVAS-74..78
 * REQ: REQ-3.5.1.11
 *
 * A split-mode fail_current_scope assert inside a for-each body marks the Test
 * failed and its flow continues down the fail branch. A plain failed assert in
 * a loop paints warning. This run must end FAILED with the gate assert painted
 * red, the plain assert painted amber, and every later block still executed.
 *
 * Pass Criteria:
 * 1. Fixture imports and validates with zero errors.
 * 2. The run ends with session outcome failed.
 * 3. The scope-fail assert paints failed; the plain assert paints warning.
 * 4. Body blocks after the failing assert still execute on every pass
 *    (green-green-red shape: evidence + close lines for all three hosts), and
 *    the fail branch records the blocking node.
 * 5. The post-loop spine executes and the verdict takes the blocked branch:
 *    the FATAL sign-off line is present, the cleared line is absent.
 * 6. The assert writes its failure detail to the console
 *    ("Assertion failed: 1 of 3 assertions failed" + the expression line).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogEntries } from '../../helpers/log-reader'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

function nodeStatus(page: Page, nodeId: string) {
  return page.locator(`[data-testid="workflow-node-${nodeId}"]`)
}

test.describe('V-SCOPEFAIL-LOOP-FUNCTIONAL: loop scope-fail paints red and fails the run', () => {
  test('for-each scope-fail: red gate, amber plain assert, flow continues, run fails', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const createResp = await request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = (createBody.data?.id ?? createBody.id) as string

    const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
    const validateBody = await validateResp.json().catch(() => null)
    const errors =
      validateBody?.data?.errors ??
      validateBody?.error?.details?.[0]?.errors ??
      validateBody?.errors ??
      []
    expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
    await expect(status, 'the scope-fail must fail the session').toHaveAttribute(
      'data-status',
      'failed',
    )

    await test.step('block paint: red gate, amber plain assert, green continuation', async () => {
      await expect(nodeStatus(page, 'assert-gate')).toHaveAttribute(
        'data-execution-status',
        'failed',
      )
      await expect(nodeStatus(page, 'assert-warn')).toHaveAttribute(
        'data-execution-status',
        'warning',
      )
      for (const green of [
        'varset-pin',
        'log-evidence',
        'varset-record',
        'log-close',
        'log-after',
        'verdict-if',
        'log-fatal',
        'log-start',
      ]) {
        await expect(nodeStatus(page, green)).toHaveAttribute('data-execution-status', 'success')
      }
      await expect(nodeStatus(page, 'log-clear')).not.toHaveAttribute(
        'data-execution-status',
        'success',
      )
    })

    await test.step('console: continuation lines, verdict, assert detail', async () => {
      const entries = await getLogEntries(page)
      const messages = entries.map((e) => e.message)
      const all = messages.join('\n')

      for (const host of ['node-1', 'node-2', 'node-3']) {
        expect(all, `evidence line for ${host}`).toContain(`${host} evidence line`)
        expect(all, `close line for ${host} (the flow continued)`).toContain(`closed ${host}`)
      }
      expect(all).toContain('scopefail-after-loop')
      expect(all).toContain('SIGN-OFF BLOCKED scopefail-verdict: node-3')
      expect(all, 'the cleared branch must not run').not.toContain('SIGN-OFF CLEARED')
      // The summary names every declared condition even though AND-segments
      // short-circuit: the gate declares 3, the plain health check declares 1.
      expect(all).toContain('Assertion failed: 1 of 3 assertions failed')
      expect(all).toContain('Assertion failed: 1 of 1 assertions failed')
      expect(all).toContain("Expression: node_host != 'node-3'")

      const fatal = entries.find((e) => e.message.includes('SIGN-OFF BLOCKED scopefail-verdict'))
      expect(fatal, 'the verdict line exists').toBeTruthy()
      expect(fatal!.level.toUpperCase()).toBe('FATAL')
    })
  })
})
