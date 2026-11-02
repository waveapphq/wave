/**
 * V-K8S-REMOTE-WORKER-START: a worker that cannot start says why.
 *
 * The host answers the interpreter version probe correctly and then fails
 * every other command, printing its own reason on stderr and nothing on
 * stdout - what a stripped Python build on a hardened host does. The user must
 * be given that reason. A worker that never speaks is not a malformed answer
 * to complain about; it is a host that could not start it.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1
 *
 * Pass Criteria:
 *   KR-6  the SSH session opens, the run fails, and the surfaced message
 *         carries the host's own failure text; nothing claims the host has no
 *         compatible Python interpreter
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { waitForLogText } from '../../helpers/log-reader'
import { expectNodeStatus, startRun } from '../../helpers/k8s-run'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, SSH_BADPY_STDERR_LINE } from '../../helpers/config'
import { randomUUID } from 'node:crypto'
import {
  BADPY_DONE_MARKER,
  BLOCK_FAILED_MARKER,
  buildBadpyFixture,
  expectLocusBadges,
  NO_INTERPRETER_CLAIM,
  SHARED_IDS,
} from './cases-remote'

test.describe('Remote Execution on a host whose interpreter cannot run the worker', () => {
  test('KR-6: the failure carries the host own reason', async ({ page }) => {
    test.setTimeout(180_000)

    const fixture = buildBadpyFixture({
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
        logs.some((text) => text.includes(BADPY_DONE_MARKER)),
        `the then branch must not run.\n${all}`,
      ).toBeFalsy()
      await expect(status).toHaveAttribute('data-status', 'failed')
    })

    await test.step('the host own failure text reaches the user', () => {
      expect(
        logs.some((text) => text.includes(SSH_BADPY_STDERR_LINE)),
        `the console must carry the host's reason: ${SSH_BADPY_STDERR_LINE}\n${all}`,
      ).toBeTruthy()
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
