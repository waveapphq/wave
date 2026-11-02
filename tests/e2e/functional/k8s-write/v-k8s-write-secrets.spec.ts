/**
 * V-K8S-WRITE-SECRETS: a Secret written through the K8s Apply form surfaces in
 * neither of its two forms.
 *
 * Phase: functional-workflow (parallel) - the test imports its own Test, writes
 * only inside the run's own namespace, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-3
 *
 * A Secret written from the form goes to the cluster as plaintext in
 * `stringData`, and the cluster answers with the same value base64-encoded in
 * `data`. Both forms have to register with the run's secret registry, so this
 * run plants one value and then sweeps every surface the run is recorded on for
 * BOTH the value and its base64 encoding: the console, the websocket feed, the
 * session variables and the generated report. The form's Secret Data is a
 * declared secret field of its own, so the Block's Inputs line is masked before
 * the plugin runs.
 *
 * The sweep alone would pass on a run that wrote nothing, so every surface also
 * carries a positive control: the Summary names the object the cluster made, a
 * K8s Get reads the stored value back, the console line prints the whole
 * result, and the mask stands where the value would be.
 *
 * The websocket feed has no replay for a late subscriber, so a Delay Block at
 * the head of the chain holds the run open while the collector subscribes.
 *
 * Pass Criteria:
 *   KW-28  an Opaque Secret written from the form is created, and a K8s Get
 *          reads the stored key back off the cluster
 *   KW-29  the planted value appears nowhere in cleartext and nowhere as its
 *          base64 encoding - not on the console, not in the websocket feed,
 *          not in the session variables and not in the report - and every
 *          surface that would have shown it shows the mask
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { delayNode, edge, type WorkflowEdge, type WorkflowNode } from '../../helpers/k8s-nodes'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, K8S_LIMITED_TOKEN } from '../../helpers/config'
import {
  buildWriteFixture,
  countOf,
  expectLegStatuses,
  expectMarkers,
  expectSummary,
  namesOf,
  resultOf,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
  type SessionVariables,
  type WriteLeg,
  type WriteMaterial,
} from './cases-write'

/** The bookend the run harvests its console against. */
const CANARY_MARKER = 'k8s-write-canary-done'

/** The implicit node every chain leaves from. */
const START_NODE = 'start-node'

/** The Delay Block that holds the run open while the collector subscribes. */
const HOLD_ID = 'delay-hold'
const HOLD_MS = 3000

const SECRET_NAME = 'wave-canary-secret'
const SECRET_KEY = 'canary'

/** The console lines the two legs print, so the sweep has something to sweep. */
const PLANT_LINE = '[KW-28|KW-29] plant'
const REREAD_LINE = '[KW-29] reread'

let run: SeededRun
/** Unique per run, so a parallel shard's canary cannot answer this sweep. */
let canary: string
let encoded: string

function material(
  overrides: Partial<WriteMaterial> & Pick<WriteMaterial, 'name' | 'bookend'>,
): WriteMaterial {
  return {
    adminToken: K8S_ADMIN_TOKEN,
    limitedToken: K8S_LIMITED_TOKEN,
    caCert: K8S_CA_PEM,
    namespace: run.namespace,
    connects: ['admin'],
    ...overrides,
  }
}

/** KW-28, KW-29: plant the value, then read it back off the cluster. */
function canaryLegs(): WriteLeg[] {
  return [
    {
      key: 'plant',
      ids: ['KW-28', 'KW-29'],
      what: 'Opaque Secret by form',
      block: 'apply',
      values: {
        define_with: 'form',
        kind: 'Secret',
        name: SECRET_NAME,
        secret_data: { [SECRET_KEY]: canary },
        secret_type: 'Opaque',
        if_exists: 'update',
        output_format: 'map',
      },
      // The whole result rides the console on purpose: the written value has to
      // come back masked there too, not only in the stored record.
      marker: `f'${PLANT_LINE} count={plant_count} data={plant_result}'`,
    },
    {
      key: 'reread',
      ids: ['KW-29'],
      what: 'read the Secret back off the cluster',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Secret',
        search_by: 'name',
        name: SECRET_NAME,
        output_format: 'map',
      },
      marker: `f'${REREAD_LINE} count={reread_count} data={reread_result}'`,
    },
  ]
}

/** Put a Delay at the head of the built chain, so the websocket collector can
 *  subscribe before the Apply runs. */
function withSubscribeWindow(fixture: Record<string, any>): Record<string, unknown> {
  const nodes = fixture.workflow.nodes as WorkflowNode[]
  const edges = fixture.workflow.edges as WorkflowEdge[]
  const first = edges.find((entry) => entry.source === START_NODE)
  expect(first, 'the built chain must leave the start node').toBeTruthy()
  const head = first!.target
  first!.id = `edge-start-${HOLD_ID}`
  first!.target = HOLD_ID
  nodes.unshift(
    delayNode({
      id: HOLD_ID,
      description: 'WS subscribe window',
      durationMs: HOLD_MS,
      position: { x: -75, y: 30 },
    }),
  )
  edges.push(edge(HOLD_ID, head))
  return fixture as Record<string, unknown>
}

test.describe('K8s Apply: a Secret written from the form (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    canary = `wave-apply-canary-${run.suffix}`
    encoded = Buffer.from(canary).toString('base64')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('the planted value surfaces in neither form on any surface the run is recorded on (KW-28, KW-29)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = canaryLegs()
    const fixture = withSubscribeWindow(
      buildWriteFixture(
        legs,
        material({ name: 'K8s Apply Secret Canary E2E Test', bookend: CANARY_MARKER }),
      ) as Record<string, any>,
    )

    await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])
    const logs = await finishRun(page, status, CANARY_MARKER, 180_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('KW-28: the Secret is created as Opaque, and the cluster holds the key', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      expectSummary(vars, 'plant', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('Secret', '', SECRET_NAME), 'created']],
      })
      expect(namesOf(vars, 'plant')).toEqual([SECRET_NAME])
      expect(countOf(vars, 'plant')).toBe(1)

      const applied = resultOf(vars, 'plant').value as Record<string, any>
      expect(applied.type, `the Secret type reaches the cluster.\n${all}`).toBe('Opaque')

      const stored = resultOf(vars, 'reread').value as Record<string, any>
      expect(countOf(vars, 'reread'), `the Secret must exist.\n${all}`).toBe(1)
      expect(
        Object.keys(stored.data ?? {}),
        `the cluster must hold the key the form typed.\n${all}`,
      ).toEqual([SECRET_KEY])
    })

    await test.step('KW-29: the console carries the result, and the value reads as the mask', () => {
      expectNoSecret(all, 'console log', [canary, encoded])
      const planted = logs.find((text) => text.includes(PLANT_LINE)) ?? ''
      expect(planted, `the applied Secret was never printed.\n${all}`).toContain(SECRET_MASK)
      const reread = logs.find((text) => text.includes(REREAD_LINE)) ?? ''
      expect(reread, `the stored Secret was never printed.\n${all}`).toContain(SECRET_MASK)
    })

    await test.step('KW-29: the websocket feed carries the run and not the value', async () => {
      const events = await collector.harvest()
      await collector.close()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      const feed = JSON.stringify(events)
      expect(feed, 'the feed must carry the real run').toContain(PLANT_LINE)
      expectNoSecret(feed, 'WS stream', [canary, encoded])
    })

    await test.step('KW-29: the session variables mask both the written and the stored form', () => {
      const written = JSON.stringify(resultOf(vars, 'plant').value)
      expectNoSecret(written, 'the applied Secret result', [canary, encoded])
      expect(written, 'the written value must read as the mask').toContain(SECRET_MASK)

      const stored = JSON.stringify(resultOf(vars, 'reread').value)
      expectNoSecret(stored, 'the stored Secret result', [canary, encoded])
      expect(stored, 'the encoded value must read as the mask').toContain(SECRET_MASK)

      expectNoSecret(JSON.stringify(vars), 'session variables', [canary, encoded])
    })

    await test.step('KW-29: the report carries the run and not the value', async () => {
      const report = await fetchSessionReport(page)
      expect(report, 'the report must carry the real run').toContain(PLANT_LINE)
      expectNoSecret(report, 'report', [canary, encoded])
    })
  })
})
