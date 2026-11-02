/**
 * V-K8S-REMOTE-GATEWAY: a K8s Connect through a plain-HTTP, path-prefixed
 * gateway inside a Remote Execution container.
 *
 * The stack fronts the kwok cluster with an nginx gateway that speaks plain
 * HTTP on a non-standard port and joins every API path under a prefix. The
 * gateway is named by its compose DNS name (`k8s-gateway`), which resolves
 * only inside the stack network, so the Connect and the reads riding it can
 * only have run on the SSH host. The base URL's prefix has to survive the
 * remote path on every request: the version read, discovery, the list and the
 * miss.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-5.1.5
 *
 * Pass Criteria:
 *   KR-3  a Connect through the plain-HTTP gateway reads the cluster version
 *         on the host, a Namespace list riding it names the run's namespace,
 *         and a Get of a namespace that does not exist records the cluster's
 *         NotFound wording with one WARN line, the Block amber and the run
 *         passed
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  buildGatewayFixture,
  cell,
  connectedLine,
  expectLocusBadges,
  expectRecordedMiss,
  expectStatuses,
  GATEWAY_DONE_MARKER,
  GATEWAY_IDS,
  GATEWAY_MARKER,
  GATEWAY_VARS,
  K8S_GATEWAY_URL,
  K8S_VERSION,
  numberOf,
  textOf,
  type SessionVariables,
} from './cases-remote'

test.describe('K8s Connect through the plain-HTTP gateway inside a Remote Execution container', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'get')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-3: the gateway Connect and the reads riding it run on the host', async ({ page }) => {
    test.setTimeout(240_000)
    const v = GATEWAY_VARS

    const fixture = buildGatewayFixture({
      suffix: run.suffix,
      namespace: run.namespace,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })
    await expectLocusBadges(page, fixture)

    const status = await startRun(page)
    const logs = await finishRun(page, status, GATEWAY_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('the Connect reads the cluster version through the gateway', () => {
      expect(textOf(vars, v.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expect(
        logs.includes(connectedLine(K8S_GATEWAY_URL)),
        `the Connect line must name the gateway URL.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('the Namespace list riding it names the run namespace', () => {
      const names = cell(vars, v.names).value as string[]
      const count = numberOf(vars, v.count)
      expect(count, `the namespace count.\n${all}`).toBeGreaterThanOrEqual(1)
      expect(names.length, 'count matches the names').toBe(count)
      expect(names, `the run namespace must be listed.\n${all}`).toContain(run.namespace)
    })

    await test.step('a missing namespace is recorded, and the run stays passed', async () => {
      await expectRecordedMiss(
        page,
        vars,
        { ok: v.missOk, reason: v.missReason, error: v.missError },
        GATEWAY_IDS.missing,
        run.suffix,
      )
    })

    await test.step('the summary marker and the Block statuses', async () => {
      const marker = logs.find((text) => text.startsWith(GATEWAY_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${GATEWAY_MARKER} ver=${K8S_VERSION} namespaces=${numberOf(vars, v.count)} miss=NotFound`,
      )
      await expectStatuses(page, fixture, { [GATEWAY_IDS.missing]: 'warning' })
    })
  })
})
