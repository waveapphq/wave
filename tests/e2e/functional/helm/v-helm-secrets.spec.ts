/**
 * V-HELM-SECRETS: a Repository Password planted as a secret variable surfaces
 * nowhere the run is recorded.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test,
 * installs into the run's own namespace under a release name of its own, and
 * tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: HELM-1, HELM-5
 *
 * The canary is a run-unique value of the spec's own making, never the stack's
 * shared chart-repository password, which other suites also use - a sweep for a
 * shared value proves nothing about this run. It is declared as a secret Test
 * variable and read into Helm Install's Repository Password as an expression,
 * so it travels the whole way a real credential does: through the resolver,
 * into helm's argv and out to the repository, which refuses it. The refusal is
 * the point: the credential really left the machine, and the run still has to
 * come back with it nowhere in cleartext.
 *
 * The sweep alone would pass on a run that did nothing, so every surface also
 * carries a positive control: a second install from the credential-free
 * listener puts a real release on the cluster, a Helm Status reads it back, and
 * each surface is asserted to carry that evidence before it is asserted to
 * carry no canary.
 *
 * The websocket feed has no replay for a late subscriber, so a Delay Block
 * sits between the Connect and the first Helm leg while the collector
 * subscribes.
 *
 * Pass Criteria:
 *   HL-12  the planted Repository Password reaches the repository (the leg is
 *          refused with Reason Forbidden) and appears in cleartext on none of
 *          the surfaces the run is recorded on - not the console, not the
 *          websocket feed, not the session variables, not the generated report,
 *          not either Test export mode, and not the store on disk - while the
 *          same surfaces all carry the run's real evidence and the variables
 *          API reads the planted value back as the mask.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { openSessionEventCollector } from '../../helpers/ws-events'
import {
  expectNoSecret,
  SECRET_ENVELOPE,
  SECRET_MASK,
  sweepStore,
} from '../../helpers/secret-canary'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { delayNode, type WorkflowNode } from '../../helpers/k8s-nodes'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  CHART_REPO_USER,
  K8S_ADMIN_TOKEN,
} from '../../helpers/config'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_TLS_URL,
  CHART_REPO_URL,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  markerLine,
  nodeId,
  readReleaseLine,
  releaseName,
  statusOf,
  uninstalledLine,
  uninstallQuietly,
  type HelmLeg,
  type SessionVariables,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const CANARY_MARKER = 'helm-secret-canary-done'

/** The Test variable the Repository Password row reads. */
const PASSWORD_VARIABLE = 'helm_repo_password'

/** The Delay that holds the run open while the collector subscribes. */
const HOLD_ID = 'delay-hold'
const HOLD_MS = 3000

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

let run: SeededRun
/** Unique per run, so a parallel shard's canary cannot answer this sweep. */
let canary: string
let release: string

/** HL-12: send the planted credential, then prove the run really ran. */
function canaryLegs(name: string): HelmLeg[] {
  const chart = { chart: CHART.demo, version: V_0_1, release: name }
  return [
    {
      key: 'plant',
      ids: ['HL-12'],
      what: 'install with the planted password',
      block: 'install',
      records: true,
      values: {
        ...chart,
        repo: CHART_REPO_TLS_URL,
        repo_username: CHART_REPO_USER,
        repo_password: PASSWORD_VARIABLE,
        repo_ca_cert: CA_CERT_PEM,
        on_error: 'record',
      },
    },
    {
      key: 'install',
      ids: ['HL-12'],
      what: 'install from the open listener',
      block: 'install',
      values: { ...chart, repo: CHART_REPO_URL },
    },
    {
      key: 'read',
      ids: ['HL-12'],
      what: 'read the release back',
      block: 'status',
      values: { release: name },
    },
    {
      key: 'gone',
      ids: ['HL-12'],
      what: 'uninstall the release',
      block: 'uninstall',
      values: { release: name },
    },
  ]
}

/** The builder wires only `session` as an expression, so the Repository
 *  Password row is turned into one here: the planted value has to arrive as a
 *  secret VARIABLE, not as a literal typed into the Block. */
function readsPasswordFromVariable(
  fixture: Record<string, unknown>,
  blockId: string,
): Record<string, unknown> {
  const workflow = fixture.workflow as { nodes: WorkflowNode[] }
  const node = workflow.nodes.find((entry) => entry.id === blockId)
  expect(node, `no Block "${blockId}" to wire the password into`).toBeTruthy()
  const declared = node!.data.expressionFields as string[]
  node!.data.expressionFields = [...declared, 'repo_password']
  return fixture
}

test.describe('Helm Install: a planted Repository Password (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    canary = `wave-helm-repo-canary-${run.suffix}`
    release = releaseName('hl12', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) await uninstallQuietly(request, { namespace: run.namespace, release })
    await run?.teardown()
  })

  test('the planted Repository Password surfaces on nothing the run is recorded on (HL-12)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const legs = canaryLegs(release)
    const fixture = readsPasswordFromVariable(
      buildHelmFixture(legs, {
        name: 'Helm Repository Password Canary E2E Test',
        bookend: CANARY_MARKER,
        namespace: run.namespace,
        variables: {
          [PASSWORD_VARIABLE]: {
            value: canary,
            type: 'string',
            scope: 'test',
            secret: true,
          },
        },
        before: [
          delayNode({
            id: HOLD_ID,
            description: 'WS subscribe window',
            durationMs: HOLD_MS,
          }),
        ],
      }),
      nodeId(legs[0]),
    )

    const testId = await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])
    const logs = await finishRun(page, status, CANARY_MARKER, 240_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    /** The console line the planted leg stamped; the sweep's positive control. */
    const plantedLine = markerLine(legs[0])

    await test.step('HL-12: the planted credential reached the repository and was refused', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      expectRecorded(vars, 'plant', { reason: 'Forbidden' })
      expect(statusOf(vars, 'plant'), `a refused install reports no status.\n${all}`).toBe('')
    })

    await test.step('HL-12: the run really ran - a release was installed and read back', () => {
      const row = {
        name: release,
        namespace: run.namespace,
        revision: 1,
        status: DEPLOYED,
        chart: CHART_0_1,
        appVersion: APP_1,
      }
      expectReleaseRow(vars, 'install', row)
      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(release, 1))
      expectLine(logs, readReleaseLine(release, 1))
      expectLine(logs, uninstalledLine(release))
    })

    await test.step('HL-12: the console carries the run and not the canary', () => {
      expect(all, 'the console must carry the planted leg').toContain(plantedLine)
      // The cluster token rides the same run: a canary that only proved its own
      // masking would not prove the family's.
      expectNoSecret(all, 'console log', [canary, K8S_ADMIN_TOKEN])
    })

    await test.step('HL-12: the websocket feed carries the run and not the canary', async () => {
      const events = await collector.harvest()
      await collector.close()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      const feed = JSON.stringify(events)
      expect(feed, 'the feed must carry the real run').toContain(plantedLine)
      expectNoSecret(feed, 'WS stream', [canary])
    })

    await test.step('HL-12: the variables API reads the planted value back as the mask', () => {
      expect(
        vars[PASSWORD_VARIABLE]?.value,
        'the planted Repository Password must mask in the variables API',
      ).toBe(SECRET_MASK)
      expectNoSecret(JSON.stringify(vars), 'session variables', [canary])
    })

    await test.step('HL-12: the report carries the run and not the canary', async () => {
      const report = await fetchSessionReport(page)
      expect(report, 'the report must carry the real run').toContain(plantedLine)
      expectNoSecret(report, 'report', [canary])
    })

    await test.step('HL-12: every Test export ships the safe form, never the canary', async () => {
      for (const mode of ['mask', 'encrypted'] as const) {
        const resp = await page.request.post(`${BACKEND_URL}/tests/export`, {
          data: { test_ids: [testId], format: 'json', secrets: mode },
        })
        expect(resp.ok(), `test export (${mode}) failed: ${resp.status()}`).toBeTruthy()
        const text = await resp.text()
        expect(text, `test export (${mode}) must carry the safe form`).toContain(
          mode === 'mask' ? SECRET_MASK : SECRET_ENVELOPE,
        )
        expect(text, `test export (${mode}) must carry the real Test`).toContain(release)
        expectNoSecret(text, `test export (${mode})`, [canary])
      }
    })

    await test.step('HL-12: nothing on disk holds the canary in cleartext', () => {
      expect(sweepStore(canary), 'the planted password was persisted in cleartext').toEqual([])
    })
  })
})
