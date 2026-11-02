/**
 * V-K8S-REMOTE-NOISY-HOST: the container's diagnosis of a host that prints a
 * notice ahead of every command's output.
 *
 * The host's python3 is fine and answers the version probe correctly - the
 * notice just arrives first on the same stream. The container must not tell
 * the user this host has no compatible Python interpreter.
 *
 * A host that prints on stdout for EVERY exec channel poisons the worker's own
 * stream too, not just the probe, so this leg asserts the DIAGNOSIS, never that
 * the run passes: an honest message is what is owed here, not a usable host.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1
 *
 * Pass Criteria:
 *   KR-5  the SSH session opens, the run fails, the container reads failed,
 *         and no line anywhere on the console claims the host has no
 *         compatible Python interpreter
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { waitForLogText } from '../../helpers/log-reader'
import { expectNodeStatus, startRun } from '../../helpers/k8s-run'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import { randomUUID } from 'node:crypto'
import {
  BANNER_DONE_MARKER,
  BLOCK_FAILED_MARKER,
  buildBannerFixture,
  expectLocusBadges,
  NO_INTERPRETER_CLAIM,
  SHARED_IDS,
} from './cases-remote'

test.describe('Remote Execution on a host that prints ahead of every command', () => {
  test('KR-5: the failure never claims the host has no Python interpreter', async ({ page }) => {
    test.setTimeout(180_000)

    const fixture = buildBannerFixture({
      suffix: randomUUID().slice(0, 8),
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })
    await expectLocusBadges(page, fixture)

    const status = await startRun(page)
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
    const logs = await waitForLogText(page, BLOCK_FAILED_MARKER, 30_000)
    const all = logs.join('\n')

    await test.step('the session opened and the run failed inside the container', async () => {
      await expectNodeStatus(page, SHARED_IDS.openSession, 'success')
      await expectNodeStatus(page, SHARED_IDS.container, 'failed')
      expect(
        logs.some((text) => text.includes(BANNER_DONE_MARKER)),
        `the then branch must not run.\n${all}`,
      ).toBeFalsy()
      await expect(status).toHaveAttribute('data-status', 'failed')
    })

    await test.step('nothing told the user this host has no Python interpreter', () => {
      const wrong = logs.filter((text) => text.includes(NO_INTERPRETER_CLAIM))
      expect(
        wrong,
        `the host's python3 answers the probe, so nothing may say otherwise.\n${all}`,
      ).toEqual([])
    })
  })
})
