/**
 * V-K8S-REMOTE-SECRETS: a Secret read inside a Remote Execution container
 * surfaces in neither of its two forms.
 *
 * The seeded Secret carries one planted value. A K8s Get reads it on the SSH
 * host, and the result crosses back from the remote worker. The cluster serves
 * the value base64-encoded and the Block decodes it, so both forms have to
 * register with the run's secret registry on the remote path as well. This run
 * sweeps every surface the run is recorded on for BOTH forms, plus the admin
 * token and the SSH password: the console, the websocket feed, the session
 * variables, the generated report and the raw store.
 *
 * The sweep alone would pass on a run that read nothing, so every surface also
 * carries a positive control: the Get's names and count prove the object came
 * back, the summary line prints the whole result, and the mask stands where
 * the value would be.
 *
 * The websocket feed has no replay for a late subscriber, so a Delay Block at
 * the head of the chain holds the run open while the collector subscribes.
 *
 * REQ: REQ-3.4.1.3, REQ-4.5.5, REQ-4.5.6, REQ-3.4.1.5
 *
 * Pass Criteria:
 *   KR-2  the Get inside the container reads the seeded Secret, and the
 *         planted value appears nowhere in cleartext and nowhere as its base64
 *         encoding - not on the console, not in the websocket feed, not in the
 *         session variables, not in the report and not in the store - while
 *         every surface that would have shown it shows the mask; the admin
 *         token and the SSH password never appear in cleartext either
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNoSecret, SECRET_MASK, sweepStore } from '../../helpers/secret-canary'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import { SEEDED, seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, SSH_STACK_PASSWORD } from '../../helpers/config'
import {
  buildSecretsFixture,
  cell,
  connectedLine,
  expectLocusBadges,
  expectStatuses,
  K8S_DIRECT_URL,
  K8S_VERSION,
  numberOf,
  objectOf,
  SECRETS_DONE_MARKER,
  SECRETS_MARKER,
  SECRETS_VARS,
  textOf,
  type SessionVariables,
} from './cases-remote'

/** How long the Delay holds the run open while the collector subscribes. */
const HOLD_MS = 3000

/** The planted value in both forms the cluster and the Block handle it in. */
const canary = SEEDED.secretValue
const encoded = Buffer.from(canary).toString('base64')

/** Everything that must never cross a surface in cleartext. */
const NEEDLES = [canary, encoded, K8S_ADMIN_TOKEN, SSH_STACK_PASSWORD]

test.describe('K8s Get of a Secret inside a Remote Execution container', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'get')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-2: the planted value surfaces in neither form on any surface the run is recorded on', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const v = SECRETS_VARS

    const fixture = buildSecretsFixture({
      suffix: run.suffix,
      namespace: run.namespace,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
      holdMs: HOLD_MS,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })
    await expectLocusBadges(page, fixture)

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])
    const logs = await finishRun(page, status, SECRETS_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('the Get on the host read the seeded Secret', async () => {
      expect(textOf(vars, v.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expect(logs.includes(connectedLine(K8S_DIRECT_URL)), `the Connect line.\n${all}`).toBeTruthy()
      expect(numberOf(vars, v.count), `the Secret count.\n${all}`).toBe(1)
      expect(cell(vars, v.names).value, 'the Secret names').toEqual([SEEDED.secret])
      const stored = objectOf(vars, v.result)
      expect(stored.metadata?.name).toBe(SEEDED.secret)
      expect(stored.metadata?.namespace).toBe(run.namespace)
      expect(stored.type, 'the Secret type reaches the result').toBe('Opaque')
      expect(Object.keys(stored.data ?? {}), 'the cluster holds the seeded key').toEqual([
        SEEDED.secretKey,
      ])
      await expectStatuses(page, fixture, {})
    })

    await test.step('the console carries the result, and the value reads as the mask', () => {
      expectNoSecret(all, 'console log', NEEDLES)
      const summary = logs.find((text) => text.startsWith(SECRETS_MARKER)) ?? ''
      expect(summary, `the summary line is missing.\n${all}`).toContain(`count=1`)
      expect(summary, 'the stored Secret was never printed').toContain(SECRET_MASK)
    })

    await test.step('the websocket feed carries the run and not the value', async () => {
      const events = await collector.harvest()
      await collector.close()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      const feed = JSON.stringify(events)
      expect(feed, 'the feed must carry the real run').toContain(SECRETS_MARKER)
      expectNoSecret(feed, 'WS stream', NEEDLES)
    })

    await test.step('the session variables mask the stored form and the credentials', () => {
      const stored = JSON.stringify(cell(vars, v.result).value)
      expectNoSecret(stored, 'the stored Secret result', NEEDLES)
      expect(stored, 'the encoded value must read as the mask').toContain(SECRET_MASK)
      expect(cell(vars, v.session).value, 'the session output masks').toBe(SECRET_MASK)
      expect(cell(vars, 'k8s_admin_token').value, 'the token variable masks').toBe(SECRET_MASK)
      expect(cell(vars, 'ssh_pwd').value, 'the password variable masks').toBe(SECRET_MASK)
      expectNoSecret(JSON.stringify(vars), 'session variables', NEEDLES)
    })

    await test.step('the report carries the run and not the value', async () => {
      const report = await fetchSessionReport(page)
      expect(report, 'the report must carry the real run').toContain(SECRETS_MARKER)
      expectNoSecret(report, 'report', NEEDLES)
    })

    await test.step('the store holds neither form nor the admin token', () => {
      for (const needle of [canary, encoded, K8S_ADMIN_TOKEN]) {
        expect(sweepStore(needle), `${needle} persisted by the run`).toEqual([])
      }
    })
  })
})
