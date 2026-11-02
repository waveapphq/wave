/**
 * V-K8S-WRITE-CHAIN: the four K8s write Blocks against the real kwok cluster.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test,
 * writes only inside the run's own namespace, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-3.5.2.1, REQ-3.5.2.2, REQ-3.5.2.3,
 *      REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-1, K8SWRITE-2, K8SWRITE-3, K8SWRITE-5, K8SWRITE-6,
 *                   K8SWRITE-7, K8SWRITE-8
 *
 * Seven runs, one per dependency chain. A leg only shares a run with the legs
 * it genuinely needs - the object the leg before it wrote - so a failure names
 * one step rather than burying nineteen others.
 *
 * Two assertion surfaces, both exact. Summary is read back whole: its declared
 * columns, their types, and every cell, including kubectl's `type/name`
 * resource form and the outcome word the cluster's own status produced. The
 * plugin's INFO line carries the path it wrote, which is what proves the
 * cascade policy, the selector and the cluster scope.
 *
 * Pass Criteria:
 *   KW-01  the node factories emit the checked-in golden shape
 *   KW-02  Apply from the ConfigMap form creates the object: Summary is
 *          RESOURCE / OUTCOME with the one row `configmap/<name>` + `created`,
 *          and a K8s Get reads the written data back
 *   KW-03  the first apply of a name reports `created`
 *   KW-04  applying the same name again reports `configured`, not `created`,
 *          and the object carries the second apply's data
 *   KW-05  If exists = Fail on an object that is already there records
 *          AlreadyExists under Record and continue: success false, the
 *          cluster's sentence, empty Result / names / count / Summary, exactly
 *          one WARN line, an amber Block and a passed run
 *   KW-06  Apply from the Secret form creates an Opaque Secret
 *   KW-07  the written value is masked everywhere the run is recorded - the
 *          console, the bound Result and the report - and the form the cluster
 *          echoes back reaches no file in the store
 *   KW-08  a Deployment manifest applies as one document, and Result carries
 *          one entry per document
 *   KW-09  Scale writes the replica count: Summary carries RESOURCE / OUTCOME /
 *          PREVIOUS / REPLICAS with the one row scaled 2 -> 5, and a K8s Get
 *          reads 5 back
 *   KW-10  Rollout restart stamps kubectl's restartedAt annotation, and a
 *          K8s Get reads it back
 *   KW-11  Rollout status reports the cluster's own verdict: the Status output
 *          equals the OUTCOME cell and MESSAGE is kubectl's sentence for it
 *   KW-12  Delete with Cascade = Foreground and Wait until gone removes the
 *          workload and leaves none of its pods behind
 *   KW-13  Delete by name removes the object: Summary row `deleted`, one name,
 *          count 1, and the path carries propagationPolicy
 *   KW-14  deleting a name that is already gone fails the Block with the
 *          cluster's not-found sentence
 *   KW-15  Ignore not found turns that same delete into a pass with count 0,
 *          no WARN line and no amber Block
 *   KW-16  a selector matching nothing is a pass with count 0, with Ignore not
 *          found off and on alike
 *   KW-17  a Namespace manifest applies cluster-scoped, and a K8s Get reads it
 *          back at the cluster-scoped path
 *   KW-18  Delete removes a cluster-scoped object by name
 *   KW-19  a write under the view-only identity fails the Block with the
 *          cluster's own permission sentence
 *   KW-20  the same write under Record and continue records reason Forbidden,
 *          paints the Block amber and leaves the run passed
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNoSecret, SECRET_MASK, sweepStore } from '../../helpers/secret-canary'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  K8S_LIMITED_TOKEN,
} from '../../helpers/config'
import {
  alreadyExists,
  appliedLine,
  applyCycleLegs,
  appsPath,
  buildWriteFixture,
  cannotPatch,
  cell,
  clusterPath,
  clusterScopedLegs,
  corePath,
  countOf,
  deleteLegs,
  deleteNamespaceQuietly,
  deleteQuery,
  deletedLine,
  deploymentLegs,
  expectCaught,
  expectEmptyWrite,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectNoAmber,
  expectRecorded,
  expectSummary,
  goldenLegs,
  namesOf,
  notFound,
  permissionDenied,
  rbacLegs,
  readLine,
  recordedLine,
  resultOf,
  ROLLOUT_SUMMARY_COLUMNS,
  ROLLOUT_SUMMARY_TYPES,
  rolloutLine,
  SCALE_SUMMARY_COLUMNS,
  SCALE_SUMMARY_TYPES,
  scaledLine,
  secretLegs,
  statusOf,
  summaryVar,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
  WRITTEN,
  type SessionVariables,
  type WriteContext,
  type WriteLeg,
  type WriteMaterial,
} from './cases-write'

/** The bookend each run harvests its console against. */
const GOLDEN_MARKER = 'k8s-write-golden-done'
const CYCLE_MARKER = 'k8s-write-cycle-done'
const SECRET_MARKER = 'k8s-write-secret-done'
const DEPLOY_MARKER = 'k8s-write-deploy-done'
const DELETE_MARKER = 'k8s-write-delete-done'
const CLUSTER_MARKER = 'k8s-write-cluster-done'
const RBAC_MARKER = 'k8s-write-rbac-done'

/** kubectl's own restart annotation, RFC3339 in UTC with no fraction. */
const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt'
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const CONFIGMAPS = 'configmaps'
const DEPLOYMENTS = 'deployments'

let run: SeededRun
let ctx: WriteContext

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

function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

/** Import the built fixture, run it, and read back everything a proof needs. */
async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
  runTimeout = 180_000,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, runTimeout)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

/** Load the checked-in golden and write the run's material into it. */
function loadGolden(seeded: SeededRun): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-write-golden.json'), 'utf-8'),
  ) as Record<string, any>
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const nodes = fixture.workflow.nodes as Array<Record<string, any>>
  const connect = nodes.find((node) => node.id === 'connect-admin')
  expect(connect, 'the golden fixture must hold connect-admin').toBeTruthy()
  connect!.data.config.values.namespace = seeded.namespace
  return fixture as Record<string, unknown>
}

test.describe('K8s write Blocks (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    ctx = {
      namespace: run.namespace,
      namespaceC: `${run.namespace}-c`,
      canary: `wave-write-canary-${run.suffix}`,
    }
  })

  test.afterAll(async ({ request }) => {
    if (ctx) await deleteNamespaceQuietly(request, ctx.namespaceC)
    await run?.teardown()
  })

  test('golden fixture: the generated shape matches the checked-in one, and the form apply lands (KW-01, KW-02)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = goldenLegs()
    const golden = loadGolden(run)

    await test.step('KW-01: the node factories emit the checked-in shape', () => {
      const built = buildWriteFixture(
        legs,
        material({ name: 'K8s Write Golden', bookend: GOLDEN_MARKER }),
      )
      expect(built).toEqual(golden)
    })

    const { logs, all, vars } = await runFixture(page, golden, GOLDEN_MARKER)

    await test.step('KW-02: the ConfigMap is created, and the Summary names it', async () => {
      expectMarkers(logs, legs)
      expectSummary(vars, 'golden', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ConfigMap', '', WRITTEN.goldenConfigMap), 'created']],
      })
      expect(namesOf(vars, 'golden')).toEqual([WRITTEN.goldenConfigMap])
      expect(countOf(vars, 'golden')).toBe(1)
      expectLine(logs, appliedLine(1))
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-02: a K8s Get reads the written data back', () => {
      const applied = resultOf(vars, 'golden').value as Record<string, any>
      expect(applied.kind, `the applied object.\n${all}`).toBe('ConfigMap')
      expect(applied.data).toEqual({ [WRITTEN.goldenKey]: WRITTEN.goldenValue })

      const readBack = resultOf(vars, 'readback').value as Record<string, any>
      expect(readBack.data).toEqual({ [WRITTEN.goldenKey]: WRITTEN.goldenValue })
      expect(countOf(vars, 'readback')).toBe(1)
      expectLine(
        logs,
        readLine('ConfigMap', 1, `${corePath(run.namespace, CONFIGMAPS)}/${WRITTEN.goldenConfigMap}`),
      )
    })
  })

  test('apply cycle: create, update in place, and refuse an object that is already there (KW-03, KW-04, KW-05)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = applyCycleLegs(ctx)
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Apply Cycle E2E Test', bookend: CYCLE_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, CYCLE_MARKER)
    const resource = typeName('ConfigMap', '', WRITTEN.cycleConfigMap)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-03: the first apply of the name reports created', () => {
      expectSummary(vars, 'create', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'created']],
      })
      expect(namesOf(vars, 'create')).toEqual([WRITTEN.cycleConfigMap])
      expect(countOf(vars, 'create')).toBe(1)
    })

    await test.step('KW-04: the second apply of the same name reports configured', () => {
      expectSummary(vars, 'update', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'configured']],
      })
      expect(countOf(vars, 'update')).toBe(1)
      const reread = resultOf(vars, 'reread').value as Record<string, any>
      expect(reread.data, `the update must have taken.\n${all}`).toEqual({ round: 'two' })
    })

    await test.step('KW-05: If exists = Fail records AlreadyExists and leaves every output empty', async () => {
      const message = alreadyExists('ConfigMap', WRITTEN.cycleConfigMap, run.namespace)
      expectRecorded(vars, 'strict', { message, reason: 'AlreadyExists' })
      expectEmptyWrite(vars, 'strict', SUMMARY_COLUMNS)
      const empty = resultOf(vars, 'strict')
      expect(empty.type, 'a Form-mode Result stays a map').toBe('map')
      expect(empty.value).toEqual({})

      const line = recordedLine('Apply', 'AlreadyExists', message)
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry === line).length,
        `expected exactly one WARN line for the strict apply.\n${all}`,
      ).toBe(1)

      const badge = page.locator(
        '[data-testid="workflow-node-apply-strict"] [data-testid="node-run-state-badge"]',
      )
      await expect(badge).toHaveAttribute('data-state', 'warn')
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })

  test('a Secret written from the form is masked on every surface the run records (KW-06, KW-07)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = secretLegs(ctx)
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Apply Secret E2E Test', bookend: SECRET_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, SECRET_MARKER)
    const encoded = Buffer.from(ctx.canary).toString('base64')

    await test.step('KW-06: the Secret is created as Opaque', async () => {
      expectMarkers(logs, legs)
      expectSummary(vars, 'secret', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('Secret', '', WRITTEN.secret), 'created']],
      })
      expect(namesOf(vars, 'secret')).toEqual([WRITTEN.secret])
      expect(countOf(vars, 'secret')).toBe(1)
      const applied = resultOf(vars, 'secret').value as Record<string, any>
      expect(applied.type, `the Secret type reaches the cluster.\n${all}`).toBe('Opaque')
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-07: the value never surfaces in cleartext, and reads as the mask', () => {
      expectNoSecret(all, 'console log', [ctx.canary, encoded])
      const applied = JSON.stringify(resultOf(vars, 'secret').value)
      expectNoSecret(applied, 'the applied Secret result', [ctx.canary, encoded])
      expect(applied, 'the registered value must read as the mask').toContain(SECRET_MASK)

      // The leg logs its whole result, so the console really carries the value.
      const printed = logs.find((text) => text.includes('[KW-06|KW-07] secret count=')) ?? ''
      expect(printed, `the Secret result was never printed.\n${all}`).toContain(SECRET_MASK)
    })

    await test.step('KW-07: the report carries the run and not the value', async () => {
      const report = await fetchSessionReport(page)
      expect(report, 'the report must carry the real run').toContain('[KW-06|KW-07] secret count=')
      expectNoSecret(report, 'report', [ctx.canary, encoded])
    })

    await test.step('KW-07: the form the cluster echoes back reaches no file in the store', () => {
      expect(sweepStore(encoded), 'the encoded Secret value was written to the store').toEqual([])
    })
  })

  test('one Deployment through apply, scale, restart, status and a cascading delete (KW-08 to KW-12)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = deploymentLegs(ctx)
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Deployment Write E2E Test', bookend: DEPLOY_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, DEPLOY_MARKER, 240_000)
    const resource = typeName('Deployment', 'apps', WRITTEN.deployment)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      await expectNoAmber(page)
    })

    await test.step('KW-08: the manifest applies as one document', () => {
      expectSummary(vars, 'deploy', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'created']],
      })
      expect(namesOf(vars, 'deploy')).toEqual([WRITTEN.deployment])
      expect(countOf(vars, 'deploy')).toBe(1)
      expectLine(logs, appliedLine(1))
      const applied = resultOf(vars, 'deploy')
      expect(applied.type, 'a Manifest-mode Result is one entry per document').toBe('array')
      expect((applied.value as unknown[]).length).toBe(1)
    })

    await test.step('KW-09: Scale writes the count, and a read agrees', () => {
      expectSummary(vars, 'scaled', {
        columns: SCALE_SUMMARY_COLUMNS,
        types: SCALE_SUMMARY_TYPES,
        rows: [[resource, 'scaled', 2, 5]],
      })
      expectLine(logs, scaledLine(resource, 2, 5))
      const read = resultOf(vars, 'replicas').value as Record<string, any>
      expect(read.spec.replicas, `the cluster must hold the new count.\n${all}`).toBe(5)
    })

    await test.step('KW-10: Rollout restart stamps the annotation kubectl stamps', () => {
      expectSummary(vars, 'restart', {
        columns: ROLLOUT_SUMMARY_COLUMNS,
        types: ROLLOUT_SUMMARY_TYPES,
        rows: [[resource, 'restarted', `${resource} restarted`]],
      })
      expectLine(logs, rolloutLine('restart', resource))
      const read = resultOf(vars, 'stamped').value as Record<string, any>
      const annotations = read.spec.template.metadata.annotations as Record<string, string>
      expect(
        annotations[RESTART_ANNOTATION],
        `the restart annotation is missing.\n${all}`,
      ).toMatch(RFC3339_UTC)
    })

    await test.step('KW-11: Rollout status reports the cluster verdict, and Summary repeats it', () => {
      const verdict = statusOf(vars, 'rollstat')
      expect(['complete', 'progressing'], `unexpected verdict.\n${all}`).toContain(verdict)
      const table = cell(vars, summaryVar('rollstat')).value as {
        columns: Array<{ name: string }>
        rows: unknown[][]
      }
      expect(table.columns.map((column) => column.name)).toEqual([...ROLLOUT_SUMMARY_COLUMNS])
      expect(table.rows.length, 'Rollout reports one row').toBe(1)
      const [named, outcome, message] = table.rows[0] as [string, string, string]
      expect(named).toBe(resource)
      expect(outcome, 'the OUTCOME cell is the Status output').toBe(verdict)
      if (verdict === 'complete') {
        expect(message).toBe(`deployment "${WRITTEN.deployment}" successfully rolled out`)
      } else {
        expect(message.startsWith('Waiting for deployment'), message).toBeTruthy()
        expect(message.endsWith('...'), message).toBeTruthy()
      }
      expectLine(logs, rolloutLine('status', resource))
    })

    await test.step('KW-12: Foreground delete removes the workload and its pods', () => {
      expectSummary(vars, 'dropdeploy', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'deleted']],
      })
      expect(namesOf(vars, 'dropdeploy')).toEqual([WRITTEN.deployment])
      expect(countOf(vars, 'dropdeploy')).toBe(1)
      expectLine(
        logs,
        deletedLine(
          1,
          'Deployment',
          `${appsPath(run.namespace, DEPLOYMENTS)}/${WRITTEN.deployment}` +
            deleteQuery({ cascade: 'foreground' }),
        ),
      )
      expect(countOf(vars, 'nopods'), `a pod of the workload survived.\n${all}`).toBe(0)
      expect(namesOf(vars, 'nopods')).toEqual([])
    })
  })

  test('delete by name, then the same delete against nothing three ways (KW-13 to KW-16)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = deleteLegs()
    const gone = legs.find((leg) => leg.key === 'gone') as WriteLeg
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Delete Write E2E Test', bookend: DELETE_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, DELETE_MARKER)
    const resource = typeName('ConfigMap', '', WRITTEN.deleteConfigMap)
    const objectPath = `${corePath(run.namespace, CONFIGMAPS)}/${WRITTEN.deleteConfigMap}`
    const collectionPath = corePath(run.namespace, CONFIGMAPS)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-13: the named delete removes it and names what it removed', () => {
      expectSummary(vars, 'drop', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'deleted']],
      })
      expect(namesOf(vars, 'drop')).toEqual([WRITTEN.deleteConfigMap])
      expect(countOf(vars, 'drop')).toBe(1)
      expectLine(logs, deletedLine(1, 'ConfigMap', `${objectPath}${deleteQuery()}`))
    })

    await test.step('KW-14: deleting the same name again fails the Block', () => {
      expectCaught(logs, gone, notFound('ConfigMap', WRITTEN.deleteConfigMap, run.namespace))
    })

    await test.step('KW-15: Ignore not found makes it a pass with count 0', () => {
      expectEmptyWrite(vars, 'ignored', SUMMARY_COLUMNS)
      expectLine(logs, deletedLine(0, 'ConfigMap', `${objectPath}${deleteQuery()}`))
    })

    await test.step('KW-16: a selector matching nothing passes with Ignore not found off and on', () => {
      for (const key of ['selnone', 'selignore']) {
        expectEmptyWrite(vars, key, SUMMARY_COLUMNS)
      }
      expectLine(
        logs,
        deletedLine(
          0,
          'ConfigMap',
          `${collectionPath}${deleteQuery({ labelSelector: WRITTEN.absentSelector })}`,
        ),
      )
    })

    await test.step('KW-14, KW-15: a hard failure records nothing - no WARN line, no amber Block', async () => {
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry.startsWith('Delete failed')),
        `Fail the block must not write a recorded WARN line.\n${all}`,
      ).toEqual([])
      await expectNoAmber(page)
    })
  })

  test('the cluster-scoped write: a Namespace applied and deleted (KW-17, KW-18)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = clusterScopedLegs(ctx)
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Cluster Scoped Write E2E Test', bookend: CLUSTER_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, CLUSTER_MARKER)
    const resource = typeName('Namespace', '', ctx.namespaceC)
    const namespacePath = `${clusterPath('namespaces')}/${ctx.namespaceC}`

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-17: the Namespace manifest applies outside any namespace', () => {
      expectSummary(vars, 'nsmade', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'created']],
      })
      expect(namesOf(vars, 'nsmade')).toEqual([ctx.namespaceC])
      expect(countOf(vars, 'nsmade')).toBe(1)
      expectLine(logs, appliedLine(1))
      // The read path is the object's own cluster-scoped path: no run-namespace
      // segment stands in front of it.
      expectLine(logs, readLine('Namespace', 1, namespacePath))
      expect(countOf(vars, 'nsread'), `the Namespace must exist.\n${all}`).toBe(1)
    })

    await test.step('KW-18: the same Namespace is deleted by name', () => {
      expectSummary(vars, 'nsgone', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[resource, 'deleted']],
      })
      expect(namesOf(vars, 'nsgone')).toEqual([ctx.namespaceC])
      expect(countOf(vars, 'nsgone')).toBe(1)
      expectLine(
        logs,
        deletedLine(1, 'Namespace', `${namespacePath}${deleteQuery()}`),
      )
    })
  })

  test('a write under the view-only identity is refused, both ways (KW-19, KW-20)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = rbacLegs()
    const denied = legs.find((leg) => leg.key === 'denied') as WriteLeg
    const fixture = buildWriteFixture(
      legs,
      material({
        name: 'K8s Write RBAC E2E Test',
        bookend: RBAC_MARKER,
        connects: ['limited'],
      }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, RBAC_MARKER)
    const message = permissionDenied(
      cannotPatch(CONFIGMAPS, WRITTEN.rbacConfigMap, run.namespace),
    )

    await test.step('KW-19: the Block raises the cluster permission sentence, and the catch branch runs', async () => {
      expectMarkers(logs, legs)
      expectCaught(logs, denied, message)
      expect(
        await page
          .locator(`[data-testid="workflow-node-${denied.block}-${denied.key}"]`)
          .getAttribute('data-execution-status'),
        `a hard failure must not paint the Block amber.\n${all}`,
      ).not.toBe('warning')
    })

    await test.step('KW-20: Record and continue keeps the same sentence and reports Forbidden', async () => {
      expectRecorded(vars, 'recorded', { message, reason: 'Forbidden' })
      expectEmptyWrite(vars, 'recorded', SUMMARY_COLUMNS)

      const line = recordedLine('Apply', 'Forbidden', message)
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry === line).length,
        `expected exactly one WARN line for the recorded denial.\n${all}`,
      ).toBe(1)

      await expectLegStatuses(page, legs)
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })
  })
})
