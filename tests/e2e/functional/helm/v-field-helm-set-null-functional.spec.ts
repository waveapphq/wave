/**
 * V-FIELD-HELM-SET-NULL-FUNCTIONAL: a null `set` entry removes the chart default
 * Wireframe: none (functional)
 * Design Decisions: FIELD-13, HELM-1, HELM-2
 * REQ: REQ-3.1.3.21, REQ-3.5.3.1
 *
 * Phase: functional-workflow (parallel) - the run installs into its own namespace under release
 * names of its own, and the namespace is torn down after.
 *
 * Real stack: `kwok` (direct) and the `tls-lab` chart repository. One run installs `wave-demo`
 * 0.1.0 three times. The chart renders `.Values.marker` (chart default `chart-default`) into the
 * pod template annotation `wave.e2e/marker`. Helm Install passes a null `set` entry as `key=null`,
 * which helm reads as removing the key from the chart defaults.
 *
 * Pass Criteria:
 * 1. The built Test imports through POST /tests and validates with zero errors; the stored Test
 *    keeps the literal null `set` entry as null.
 * 2. The run passes and the three Helm Install Blocks succeed, each release deployed.
 * 3. Control: a `set` with only `replicaCount: 2` keeps the chart default: the release's user
 *    values hold no `marker` and the Deployment's pod template carries `chart-default`.
 * 4. A literal null `marker` entry is passed as `marker=null`: the release's user values hold
 *    `marker: null`, the rendered manifest no longer carries `chart-default`, and the Deployment's
 *    pod template annotation is not `chart-default`; `replicaCount: 2` beside it still applies.
 * 5. The same holds for a `marker` entry in expression mode giving `None`.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, K8S_ADMIN_TOKEN, K8S_API_HOST, K8S_API_PORT } from '../../helpers/config'
import { deleteTest, getTest } from '../../helpers/element-types'
import { getActiveSessionId, getSessionVariables, importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  installedLine,
  nodeId,
  releaseDoc,
  releaseName,
  statusOf,
  uninstallQuietly,
  type HelmLeg,
  type SessionVariables,
} from './cases-helm'

const DONE_MARKER = 'helm-set-null-done'
const V_0_1 = '0.1.0'
const DEPLOYED = 'deployed'
const CHART_DEFAULT = 'chart-default'
const MARKER_ANNOTATION = 'wave.e2e/marker'
const K8S_ROOT = `https://${K8S_API_HOST}:${K8S_API_PORT}`

type Releases = { control: string; literal: string; expression: string }

let run: SeededRun
let releases: Releases
let testId = ''

function installLeg(key: string, release: string, set: Record<string, unknown>): HelmLeg {
  return {
    key,
    ids: ['FIELD-13'],
    what: `install with set ${key}`,
    block: 'install',
    values: {
      release,
      chart: CHART.demo,
      version: V_0_1,
      repo: CHART_REPO_URL,
      set,
      output_format: 'map',
    },
  }
}

function legsFor(names: Releases): HelmLeg[] {
  return [
    installLeg('control', names.control, { replicaCount: 2 }),
    installLeg('literal', names.literal, { marker: null, replicaCount: 2 }),
    installLeg('expression', names.expression, { marker: 'None', replicaCount: 2 }),
  ]
}

/** The built Test, with the expression leg's `marker` entry switched to expression mode. */
function fixtureFor(legs: readonly HelmLeg[]): Record<string, unknown> {
  const fixture = buildHelmFixture(legs, {
    name: 'zz-11541-s3-helm-set-null',
    bookend: DONE_MARKER,
    namespace: run.namespace,
  })
  const nodes = (fixture.workflow as { nodes: Array<{ id: string; data: Record<string, any> }> }).nodes
  const expressionLeg = nodes.find((node) => node.id === nodeId(legs[2]))
  expect(expressionLeg, 'the expression leg is built').toBeTruthy()
  expressionLeg!.data.expressionFields = [...expressionLeg!.data.expressionFields, 'set.marker']
  return fixture
}

/** The Deployment a release renders, read from the cluster. */
async function deploymentOf(request: APIRequestContext, release: string): Promise<Record<string, any>> {
  const path = `/apis/apps/v1/namespaces/${run.namespace}/deployments/${release}-wave-demo`
  const resp = await request.get(`${K8S_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${K8S_ADMIN_TOKEN}` },
  })
  expect(resp.ok(), `GET ${path}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return (await resp.json()) as Record<string, any>
}

function templateMarker(deployment: Record<string, any>): unknown {
  return (deployment.spec?.template?.metadata?.annotations ?? {})[MARKER_ANNOTATION]
}

/** A null entry reached helm as `key=null`: the user values hold null and the chart default is gone. */
async function expectMarkerRemoved(
  request: APIRequestContext,
  vars: SessionVariables,
  key: string,
  release: string,
): Promise<void> {
  const document = releaseDoc(vars, key)
  expect(document.info?.status, `${key}: the release is deployed`).toBe(DEPLOYED)
  expect(document.config ?? {}, `${key}: helm got marker=null`).toHaveProperty('marker', null)
  expect(document.config?.replicaCount, `${key}: the entry beside the null one applies`).toBe(2)
  if (typeof document.manifest === 'string') {
    expect(document.manifest, `${key}: the rendered manifest drops the chart default`).not.toContain(CHART_DEFAULT)
  }
  const deployment = await deploymentOf(request, release)
  expect(templateMarker(deployment), `${key}: the pod template no longer carries the chart default`).not.toBe(
    CHART_DEFAULT,
  )
  expect(['', undefined], `${key}: the annotation is empty or gone`).toContain(templateMarker(deployment))
  expect(deployment.spec?.replicas, `${key}: replicaCount=2 reached the Deployment`).toBe(2)
}

test.describe('V-FIELD-HELM-SET-NULL-FUNCTIONAL: a null set entry is passed as key=null', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    releases = {
      control: releaseName('fset-ctl', run.suffix),
      literal: releaseName('fset-lit', run.suffix),
      expression: releaseName('fset-expr', run.suffix),
    }
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    if (run) {
      for (const release of Object.values(releases)) {
        await uninstallQuietly(request, { namespace: run.namespace, release })
      }
    }
    await run?.teardown()
  })

  test('Helm Install with a null set entry removes the chart default for that key', async ({ page, request }) => {
    test.setTimeout(300_000)
    const legs = legsFor(releases)
    testId = await importValidateAndNavigate(page, fixtureFor(legs), { injectHttp: true })

    await test.step('the stored Test keeps the literal null set entry', async () => {
      const stored = await getTest(request, testId)
      const literal = (stored.workflow.nodes as Array<{ id: string; data: Record<string, any> }>).find(
        (node) => node.id === nodeId(legs[1]),
      )
      expect(literal?.data.config.values.set).toEqual({ marker: null, replicaCount: 2 })
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(page, await getActiveSessionId(page))) as SessionVariables

    await test.step('the three installs succeed and each release is deployed', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      for (const leg of legs) {
        expect(statusOf(vars, leg.key), `${leg.key}: the Status scalar.\n${all}`).toBe(DEPLOYED)
        expectLine(logs, installedLine(String(leg.values.release), 1))
      }
    })

    await test.step('control: without a null entry the chart default stays', async () => {
      const document = releaseDoc(vars, 'control')
      expect(document.config ?? {}, 'the control passes no marker').not.toHaveProperty('marker')
      const deployment = await deploymentOf(request, releases.control)
      expect(templateMarker(deployment), 'the chart default renders').toBe(CHART_DEFAULT)
    })

    await test.step('a literal null set entry is passed as marker=null and drops the chart default', async () => {
      await expectMarkerRemoved(request, vars, 'literal', releases.literal)
    })

    await test.step('an expression set entry giving None does the same', async () => {
      await expectMarkerRemoved(request, vars, 'expression', releases.expression)
    })
  })
})
