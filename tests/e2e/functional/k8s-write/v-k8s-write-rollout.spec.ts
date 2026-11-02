/**
 * V-K8S-WRITE-ROLLOUT: a rollout undo lands on the workload's own previous
 * revision and on nobody else's.
 *
 * Phase: functional-workflow (parallel) - the tests import their own Test,
 * write only inside the run's own namespace, and tear the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-3.5.2.3, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-7
 *
 * An undo finds its history by listing the namespace with the workload's own
 * selector and then keeping the revisions that workload controls. Two things
 * can go wrong there and neither shows on the sheet: a selector written with
 * matchExpressions can serialize to nothing and list the whole namespace, and a
 * revision object that merely carries the workload's uid can be counted as
 * history even though nothing about it is the workload's.
 *
 * The namespace this runs in is built to catch both. It holds a neighbor
 * workload whose ReplicaSets the first workload's selector really does list,
 * and one hand-written ReplicaSet that names the workload as an owner without
 * naming it as the controller. In both cases the observable is the same: the
 * image the workload carries after the undo.
 *
 * The revision histories are seeded from the spec, because a revision only
 * exists once the cluster's own controller has made the ReplicaSet for it, and
 * that is a condition to wait on rather than a step in the workflow. What the
 * workflow under test does is the undo and the read-back.
 *
 * Pass Criteria:
 *   KW-32  a rollout undo on a Deployment whose selector is written with
 *          matchExpressions rolls the workload back to its own previous
 *          revision, and Summary reports it as rolled back
 *   KW-33  the undo lands on its own previous revision while another
 *          workload's revisions sit in the same namespace and answer the same
 *          label query, and the neighbor is left exactly as it was
 *   KW-34  a revision object the workload owns but does not control is not
 *          history: the undo steps over it to the workload's own previous
 *          revision, even though the object carries the highest revision
 *          number in the namespace
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import type { WorkflowNode } from '../../helpers/k8s-nodes'
import {
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_CA_PEM,
  K8S_LIMITED_TOKEN,
} from '../../helpers/config'
import {
  appliedLine,
  buildWriteFixture,
  countOf,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectSummary,
  namesOf,
  resultOf,
  resultVar,
  rolloutLine,
  ROLLOUT_SUMMARY_COLUMNS,
  ROLLOUT_SUMMARY_TYPES,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
  type SessionVariables,
  type WriteLeg,
  type WriteMaterial,
} from './cases-write'

/** The bookend each run harvests its console against. */
const UNDO_MARKER = 'k8s-write-undo-done'
const GHOST_MARKER = 'k8s-write-ghost-done'

/** kubectl's own revision annotation on a Deployment's ReplicaSets. */
const REVISION_ANNOTATION = 'deployment.kubernetes.io/revision'

/** The label the first workload and its neighbor share, so one selector really
 *  does list the other's revisions. */
const SUITE = 'wave-undo'
/** The label only the third workload and its hand-written revision carry. */
const SUITE_SOLO = 'wave-undo-solo'

const DEPLOY_A = 'wave-undo-a'
const DEPLOY_B = 'wave-undo-b'
const DEPLOY_C = 'wave-undo-c'
const ANCHOR = 'wave-undo-anchor'
const GHOST = 'wave-undo-ghost'

/** Above every revision the cluster's controller writes, so a revision counted
 *  by ownership alone would change which revision "previous" means. */
const GHOST_REVISION = '99'

const IMAGE = {
  a1: 'busybox:1.36',
  a2: 'busybox:1.37',
  b1: 'alpine:3.19',
  b2: 'alpine:3.20',
  b3: 'alpine:3.21',
  c1: 'busybox:1.36',
  c2: 'busybox:1.37',
  ghost: 'alpine:3.18',
} as const

const CONTAINER = 'app'
const REPLICASETS = 'replicasets'
const DEPLOYMENTS = 'deployments'

const K8S_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`
const K8S_HEADERS = {
  Authorization: `Bearer ${K8S_ADMIN_TOKEN}`,
  'Content-Type': 'application/json',
}
const MERGE_HEADERS = {
  Authorization: `Bearer ${K8S_ADMIN_TOKEN}`,
  'Content-Type': 'application/strategic-merge-patch+json',
}

type K8sObject = Record<string, any>

const appsPath = (namespace: string, plural: string): string =>
  `/apis/apps/v1/namespaces/${namespace}/${plural}`

let run: SeededRun
let anchorUid = ''

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

// ---------------------------------------------------------------------------
// The cluster state the runs are pointed at
// ---------------------------------------------------------------------------

async function createObject(
  request: APIRequestContext,
  path: string,
  body: K8sObject,
): Promise<K8sObject> {
  const resp = await request.post(`${K8S_URL}${path}`, { headers: K8S_HEADERS, data: body })
  const text = await resp.text()
  expect(resp.ok(), `POST ${path} failed: ${resp.status()} ${text}`).toBeTruthy()
  return JSON.parse(text) as K8sObject
}

async function patchImage(
  request: APIRequestContext,
  namespace: string,
  name: string,
  image: string,
): Promise<void> {
  const path = `${appsPath(namespace, DEPLOYMENTS)}/${name}`
  const resp = await request.patch(`${K8S_URL}${path}`, {
    headers: MERGE_HEADERS,
    data: { spec: { template: { spec: { containers: [{ name: CONTAINER, image }] } } } },
  })
  expect(
    resp.ok(),
    `PATCH ${path} failed: ${resp.status()} ${await resp.text()}`,
  ).toBeTruthy()
}

/** Every ReplicaSet in the namespace this uid CONTROLS, by revision number. */
async function controlledRevisions(
  request: APIRequestContext,
  namespace: string,
  uid: string,
): Promise<string[]> {
  const resp = await request.get(`${K8S_URL}${appsPath(namespace, REPLICASETS)}`, {
    headers: K8S_HEADERS,
  })
  if (!resp.ok()) return []
  const body = (await resp.json().catch(() => null)) as { items?: K8sObject[] } | null
  return (body?.items ?? [])
    .filter((item) =>
      ((item.metadata?.ownerReferences ?? []) as K8sObject[]).some(
        (owner) => owner.controller === true && owner.uid === uid,
      ),
    )
    .map((item) => String(item.metadata?.annotations?.[REVISION_ANNOTATION] ?? ''))
    .filter((revision) => revision !== '')
    .sort()
}

/** Wait until the cluster's own controller has written every revision. */
async function waitForRevisions(
  request: APIRequestContext,
  namespace: string,
  uid: string,
  wanted: readonly string[],
): Promise<void> {
  await expect
    .poll(async () => (await controlledRevisions(request, namespace, uid)).join(','), {
      timeout: 60_000,
      intervals: [250, 500, 1_000],
      message: `revisions ${wanted.join(',')} were never written for ${uid}`,
    })
    .toBe([...wanted].join(','))
}

/** Create a Deployment and walk it through one revision per image. */
async function seedRevisionHistory(
  request: APIRequestContext,
  namespace: string,
  name: string,
  labels: Record<string, string>,
  selector: K8sObject,
  images: readonly string[],
): Promise<string> {
  const created = await createObject(request, appsPath(namespace, DEPLOYMENTS), {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace },
    spec: {
      replicas: 1,
      selector,
      template: {
        metadata: { labels: { ...labels } },
        spec: { containers: [{ name: CONTAINER, image: images[0] }] },
      },
    },
  })
  const uid = String(created.metadata.uid)
  await waitForRevisions(request, namespace, uid, ['1'])
  for (let index = 1; index < images.length; index++) {
    await patchImage(request, namespace, name, images[index])
    await waitForRevisions(
      request,
      namespace,
      uid,
      Array.from({ length: index + 1 }, (_, step) => String(step + 1)),
    )
  }
  return uid
}

/** The ReplicaSet the third workload owns without controlling. Its controller
 *  is a ConfigMap, so no workload controller ever adopts or releases it. */
function ghostManifest(deploymentVar: string): string {
  const lines = [
    'apiVersion: apps/v1',
    'kind: ReplicaSet',
    'metadata:',
    `  name: ${GHOST}`,
    '  labels:',
    `    suite: ${SUITE_SOLO}`,
    '    tier: c',
    '  annotations:',
    `    ${REVISION_ANNOTATION}: "${GHOST_REVISION}"`,
    '  ownerReferences:',
    '    - apiVersion: v1',
    '      kind: ConfigMap',
    `      name: ${ANCHOR}`,
    `      uid: ${anchorUid}`,
    '      controller: true',
    '    - apiVersion: apps/v1',
    '      kind: Deployment',
    `      name: ${DEPLOY_C}`,
    `      uid: {${deploymentVar}['metadata']['uid']}`,
    'spec:',
    '  replicas: 0',
    '  selector:',
    '    matchLabels:',
    '      ghost: only',
    '  template:',
    '    metadata:',
    '      labels:',
    '        ghost: only',
    '    spec:',
    '      containers:',
    `        - name: ${CONTAINER}`,
    `          image: ${IMAGE.ghost}`,
    '',
  ]
  return `f'''${lines.join('\n')}'''`
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

/** KW-32, KW-33: undo the matchExpressions workload beside its neighbor. */
function undoLegs(): WriteLeg[] {
  return [
    {
      key: 'undoa',
      ids: ['KW-32', 'KW-33'],
      what: 'roll the workload back one revision',
      block: 'rollout',
      values: { operation: 'undo', kind: 'Deployment', name: DEPLOY_A },
    },
    {
      key: 'reada',
      ids: ['KW-32', 'KW-33'],
      what: 'read the rolled-back workload',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: DEPLOY_A,
        output_format: 'map',
      },
    },
    {
      key: 'readb',
      ids: ['KW-33'],
      what: 'read the neighbor workload',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: DEPLOY_B,
        output_format: 'map',
      },
    },
  ]
}

/** KW-34: plant a revision the workload owns but does not control, then undo. */
function ghostLegs(): WriteLeg[] {
  return [
    {
      key: 'uid',
      ids: ['KW-34'],
      what: 'read the workload for its uid',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: DEPLOY_C,
        output_format: 'map',
      },
    },
    {
      key: 'ghost',
      ids: ['KW-34'],
      what: 'a revision owned but not controlled',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: ghostManifest(resultVar('uid')),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'listed',
      ids: ['KW-34'],
      what: 'every revision the undo can see',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'ReplicaSet',
        search_by: 'selector',
        label_selector: `suite=${SUITE_SOLO},tier=c`,
        output_format: 'map',
      },
    },
    {
      key: 'undoc',
      ids: ['KW-34'],
      what: 'roll the workload back one revision',
      block: 'rollout',
      values: { operation: 'undo', kind: 'Deployment', name: DEPLOY_C },
    },
    {
      key: 'readc',
      ids: ['KW-34'],
      what: 'read the rolled-back workload',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'default',
        kind: 'Deployment',
        search_by: 'name',
        name: DEPLOY_C,
        output_format: 'map',
      },
    },
  ]
}

/** The ghost manifest carries a uid only the run knows, so it is read as an
 *  expression rather than as typed text. */
function evaluateManifestOn(fixture: Record<string, any>, nodeId: string): Record<string, unknown> {
  const node = (fixture.workflow.nodes as WorkflowNode[]).find((entry) => entry.id === nodeId)
  expect(node, `${nodeId} must be in the built workflow`).toBeTruthy()
  ;(node!.data.expressionFields as string[]).push('manifest')
  return fixture as Record<string, unknown>
}

const imageOf = (deployment: K8sObject): string =>
  String(deployment.spec.template.spec.containers[0].image)

async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, 180_000)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

test.describe('K8s Rollout undo: whose history the undo reads (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000)
    run = await seedRun(request, 'minimal')

    await seedRevisionHistory(
      request,
      run.namespace,
      DEPLOY_A,
      { suite: SUITE },
      { matchExpressions: [{ key: 'suite', operator: 'In', values: [SUITE] }] },
      [IMAGE.a1, IMAGE.a2],
    )
    // The neighbor answers the first workload's own label query, and carries
    // more revisions than it does, so an ownership-blind undo cannot land right.
    await seedRevisionHistory(
      request,
      run.namespace,
      DEPLOY_B,
      { suite: SUITE, role: 'b' },
      { matchLabels: { role: 'b', suite: SUITE } },
      [IMAGE.b1, IMAGE.b2, IMAGE.b3],
    )
    await seedRevisionHistory(
      request,
      run.namespace,
      DEPLOY_C,
      { suite: SUITE_SOLO, tier: 'c' },
      {
        matchExpressions: [
          { key: 'suite', operator: 'In', values: [SUITE_SOLO] },
          { key: 'tier', operator: 'In', values: ['c'] },
        ],
      },
      [IMAGE.c1, IMAGE.c2],
    )

    const anchor = await createObject(request, `/api/v1/namespaces/${run.namespace}/configmaps`, {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: ANCHOR, namespace: run.namespace },
      data: { role: 'owner' },
    })
    anchorUid = String(anchor.metadata.uid)
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('an undo on a matchExpressions workload lands on its own previous revision, not a neighbor\'s (KW-32, KW-33)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = undoLegs()
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Rollout Undo E2E Test', bookend: UNDO_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, UNDO_MARKER)
    const resource = typeName('Deployment', 'apps', DEPLOY_A)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-32: the undo reports the workload as rolled back', () => {
      expectSummary(vars, 'undoa', {
        columns: ROLLOUT_SUMMARY_COLUMNS,
        types: ROLLOUT_SUMMARY_TYPES,
        rows: [[resource, 'rolled back', `${resource} rolled back`]],
      })
      expectLine(logs, rolloutLine('undo', resource))
    })

    await test.step('KW-32, KW-33: the workload carries its own previous revision', () => {
      const rolled = resultOf(vars, 'reada').value as K8sObject
      expect(
        imageOf(rolled),
        `the undo did not land on this workload's own previous revision.\n${all}`,
      ).toBe(IMAGE.a1)
    })

    await test.step('KW-33: the neighbor is exactly as it was', () => {
      const neighbor = resultOf(vars, 'readb').value as K8sObject
      expect(imageOf(neighbor), `the neighbor was rolled back too.\n${all}`).toBe(IMAGE.b3)
    })
  })

  test('a revision the workload owns but does not control is not history (KW-34)', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const legs = ghostLegs()
    const fixture = evaluateManifestOn(
      buildWriteFixture(
        legs,
        material({ name: 'K8s Rollout Ownership E2E Test', bookend: GHOST_MARKER }),
      ) as Record<string, any>,
      'apply-ghost',
    )
    const { logs, all, vars } = await runFixture(page, fixture, GHOST_MARKER)
    const resource = typeName('Deployment', 'apps', DEPLOY_C)

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-34: the planted revision reached the cluster with the run-time uid', () => {
      expectSummary(vars, 'ghost', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ReplicaSet', 'apps', GHOST), 'created']],
      })
      expect(namesOf(vars, 'ghost')).toEqual([GHOST])
      expect(countOf(vars, 'ghost')).toBe(1)
      expectLine(logs, appliedLine(1))
    })

    await test.step('KW-34: the undo really can see it, and it is owned without being controlled', () => {
      const listed = resultOf(vars, 'listed').value as K8sObject[]
      expect(
        namesOf(vars, 'listed'),
        `the planted revision is not in the listing the undo reads.\n${all}`,
      ).toContain(GHOST)

      const planted = listed.find((item) => item.metadata.name === GHOST) as K8sObject
      const deployment = resultOf(vars, 'uid').value as K8sObject
      expect(
        planted.metadata.annotations[REVISION_ANNOTATION],
        'the planted revision must outrank every revision the controller wrote',
      ).toBe(GHOST_REVISION)
      const owner = (planted.metadata.ownerReferences as K8sObject[]).find(
        (entry) => entry.uid === deployment.metadata.uid,
      )
      expect(owner, 'the planted revision must name the workload as an owner').toBeTruthy()
      expect(
        owner!.controller,
        'the planted revision must not name the workload as its controller',
      ).not.toBe(true)
    })

    await test.step('KW-34: the undo steps over it to the workload\'s own previous revision', () => {
      expectSummary(vars, 'undoc', {
        columns: ROLLOUT_SUMMARY_COLUMNS,
        types: ROLLOUT_SUMMARY_TYPES,
        rows: [[resource, 'rolled back', `${resource} rolled back`]],
      })
      const rolled = resultOf(vars, 'readc').value as K8sObject
      expect(
        imageOf(rolled),
        `a revision owned without being controlled was counted as history.\n${all}`,
      ).toBe(IMAGE.c1)
    })
  })
})
