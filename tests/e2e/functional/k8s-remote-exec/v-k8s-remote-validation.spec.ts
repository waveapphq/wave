/**
 * V-K8S-REMOTE-VALIDATION: a K8s Connect the plugin refuses fails the same way
 * inside a Remote Execution container as it does locally.
 *
 * The Connect's own validation runs before any request leaves, and the remote
 * path must not soften it: the exact refusal reaches the run surface, nothing
 * connects, nothing after it in the body runs, and the run fails. The rule
 * exercised is the timeout floor, which the import and the pre-run gate both
 * let through (neither calls a plugin's validation), so the refusal can only
 * come from the Block at run time.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1
 *
 * Pass Criteria:
 *   KR-4  the SSH session opens, the Connect inside the container fails with
 *         `Parameter 'timeout' must be positive` at ERROR level on the console
 *         and reads failed on the canvas, no Connected line is printed, the
 *         Get after it never runs, and the run fails
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { getLogEntries, waitForLogText } from '../../helpers/log-reader'
import { expectNodeStatus, startRun } from '../../helpers/k8s-run'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import { randomUUID } from 'node:crypto'
import {
  blockFailedLine,
  buildValidationFixture,
  expectLocusBadges,
  SHARED_IDS,
  TIMEOUT_REFUSAL,
  VALIDATION_CONNECT_NAME,
  VALIDATION_DONE_MARKER,
  VALIDATION_IDS,
} from './cases-remote'

/** The Connect never reaches the cluster, so no object is seeded: the run
 *  only needs a namespace name to carry. */
const NAMESPACE = 'default'

test.describe('K8s Connect refused inside a Remote Execution container', () => {
  test('KR-4: the exact refusal reaches the run surface before any request, and the run fails', async ({
    page,
  }) => {
    test.setTimeout(180_000)

    const fixture = buildValidationFixture({
      suffix: randomUUID().slice(0, 8),
      namespace: NAMESPACE,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })
    await expectLocusBadges(page, fixture)

    const failedLine = blockFailedLine(VALIDATION_CONNECT_NAME, TIMEOUT_REFUSAL)
    const status = await startRun(page)
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
    const logs = await waitForLogText(page, failedLine, 30_000)
    const all = logs.join('\n')

    await test.step('the Connect fails with the exact refusal at ERROR level', async () => {
      const entries = await getLogEntries(page)
      const refusals = entries.filter((entry) => entry.message === failedLine)
      expect(refusals.length, `expected exactly one failure line.\n${all}`).toBe(1)
      expect(refusals[0].level, 'the refusal is reported at ERROR level').toBe('ERROR')
    })

    await test.step('nothing connected and nothing after the Connect ran', () => {
      expect(
        logs.some((text) => text.includes('Connected to Kubernetes')),
        `no Connect may succeed.\n${all}`,
      ).toBeFalsy()
      expect(
        logs.some((text) => text.startsWith('Read ')),
        `no read may run after the refused Connect.\n${all}`,
      ).toBeFalsy()
      expect(
        logs.some((text) => text.includes(VALIDATION_DONE_MARKER)),
        `the then branch must not run.\n${all}`,
      ).toBeFalsy()
    })

    await test.step('the canvas reads the failure on the Connect, and the run failed', async () => {
      await expectNodeStatus(page, SHARED_IDS.openSession, 'success')
      const connect = page.locator(`[data-testid="workflow-node-${VALIDATION_IDS.connect}"]`)
      await expect(connect).toHaveAttribute('data-execution-status', 'failed')
      await expect(connect.locator('[data-testid="node-run-state-badge"]')).toHaveAttribute(
        'data-state',
        'fail',
      )
      await expect(
        page.locator(`[data-testid="workflow-node-${VALIDATION_IDS.after}"]`),
      ).not.toHaveAttribute('data-execution-status', 'success')
      await expectNodeStatus(page, SHARED_IDS.container, 'failed')
      await expect(status).toHaveAttribute('data-status', 'failed')
    })
  })
})
