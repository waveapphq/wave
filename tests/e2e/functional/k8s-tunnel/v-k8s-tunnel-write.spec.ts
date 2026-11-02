/**
 * V-K8S-TUNNEL-WRITE: K8s writes over an SSH tunnel, with two K8s Sessions
 * alive in one run.
 *
 * One workflow opens an SSH session, forwards a free local port to the
 * unpublished `kwok-internal` cluster, and Connects over it (session A). It
 * then Connects straight to the published `kwok` cluster (session B) and
 * interleaves the two: A writes, B writes, A writes, B writes, then four reads
 * that alternate between them.
 *
 * The tunnel's reach on its own is proved in
 * `functional/k8s-connect/v-plugin-k8s-connect-functional.spec.ts` and is not
 * repeated here. What this file adds is a WRITE that lands on the far side of
 * the tunnel and reads back with the value it wrote, and the split between the
 * two clusters: they are separate apiservers, so both sides use the same
 * namespace name and the same object name, and the only thing that decides
 * which cluster a Block touches is the session it reads. A ConfigMap written
 * through one session is NotFound through the other, and the one written under
 * the same name in the same namespace on both carries a different value on
 * each. Those legs also make the tunnel load-bearing: had session A somehow
 * reached the published cluster, its miss leg would have hit.
 *
 * The test process has no route to the tunneled cluster, so session A creates
 * and removes its own namespace from inside the workflow, and every object it
 * writes carries the run suffix. The published side is seeded and torn down
 * through `helpers/k8s-seed.ts` as usual.
 *
 * Design Decisions: K8SWRITE-1, K8SWRITE-5
 * REQ: REQ-5.1.1, REQ-5.1.5, REQ-3.4.1.5, REQ-3.4.1.3
 *
 * Pass Criteria:
 *   KT-a  one run holds both sessions: the tunneled Connect and the direct
 *         Connect each read v1.33, the run stamps both versions on its marker,
 *         and every Block that is not a recording leg reports success
 *   KT-b  an Apply through the tunnel lands and reads back with the value it
 *         wrote, under the API path the read line names
 *   KT-c  the tunneled cluster's namespace is created and removed by the
 *         workflow itself, since nothing outside the run can reach it
 *   KT-d  the same ConfigMap name in the same namespace carries a different
 *         value on each cluster, chosen only by the session the Block reads
 *   KT-e  an object written through one session is not there through the
 *         other: the cluster's own NotFound wording, one WARN line each, both
 *         Blocks amber, and the run still passed
 *   KT-f  the tunnel carries the whole write sequence and the workflow closes
 *         it while it is still open
 *   KT-g  the node factories emit the checked-in workflow shape
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  APPLY_NODE_IDS,
  appliedLine,
  buildTunnelFixture,
  configMapPath,
  deleteLine,
  GOLDEN_NAMESPACE,
  GOLDEN_SUFFIX,
  K8S_VERSION_PREFIX,
  namespaceDeletePath,
  notFoundMessage,
  ORIGIN_PUBLISHED,
  ORIGIN_TUNNELED,
  originData,
  readLine,
  recordedReadLine,
  RECORDING_NODE_IDS,
  TUNNEL_DONE_MARKER,
  TUNNEL_MARKER,
  TUNNEL_NODE_IDS,
  tunnelNames,
  type TunnelContext,
} from './cases-tunnel'

type SessionVariables = Record<string, { value: unknown; type: string }>
type K8sObject = {
  metadata?: { name?: string; namespace?: string }
  data?: Record<string, string>
}

const GOLDEN_FILE = 'fixture-tunnel-write-golden.json'

/** The checked-in golden with the TEST-ONLY material filled in; PEM and token
 *  bytes are never committed inside fixture JSON. */
function loadGolden(): Record<string, unknown> {
  const golden = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, GOLDEN_FILE), 'utf-8'),
  ) as Record<string, any>
  golden.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  golden.variables.k8s_ca.value = K8S_CA_PEM
  return golden as Record<string, unknown>
}

function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

const numberOf = (vars: SessionVariables, name: string): number =>
  Number(cell(vars, name).value)
const textOf = (vars: SessionVariables, name: string): string =>
  String(cell(vars, name).value)
const objectOf = (vars: SessionVariables, name: string): K8sObject =>
  cell(vars, name).value as K8sObject

test('KT-g: the node factories emit the checked-in workflow shape', () => {
  const built = buildTunnelFixture({
    suffix: GOLDEN_SUFFIX,
    namespace: GOLDEN_NAMESPACE,
    caCert: K8S_CA_PEM,
    adminToken: K8S_ADMIN_TOKEN,
  })
  expect(built).toEqual(loadGolden())
})

test.describe('K8s writes through an SSH tunnel, two sessions in one run', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KT-a to KT-f: the tunneled write roundtrip and the two-cluster split', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const ctx: TunnelContext = { suffix: run.suffix, namespace: run.namespace }
    const names = tunnelNames(ctx)
    const tunneledData = originData(ctx, ORIGIN_TUNNELED)
    const publishedData = originData(ctx, ORIGIN_PUBLISHED)

    const fixture = buildTunnelFixture({
      ...ctx,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true, injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, TUNNEL_DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('KT-a: both sessions read the cluster and every non-recording Block succeeded', async () => {
      expect(textOf(vars, 'ver_a'), `the tunneled Connect version.\n${all}`).toContain(
        K8S_VERSION_PREFIX,
      )
      expect(textOf(vars, 'ver_b'), `the direct Connect version.\n${all}`).toContain(
        K8S_VERSION_PREFIX,
      )

      const connected = logs.filter((text) =>
        text.includes(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`),
      )
      expect(connected.length, `two Connects must report the cluster.\n${all}`).toBe(2)

      const marker = logs.find((text) => text.startsWith(TUNNEL_MARKER)) ?? ''
      expect(marker, `the run marker is missing.\n${all}`).toContain(
        `verA=${K8S_VERSION_PREFIX}`,
      )
      expect(marker).toContain(`verB=${K8S_VERSION_PREFIX}`)
      expect(marker).toContain('nsA=1 applyA=1 applyB=1 readA=1')
      expect(marker).toContain('missB=NotFound missA=NotFound')

      const recording = new Set<string>(RECORDING_NODE_IDS)
      for (const id of TUNNEL_NODE_IDS) {
        if (recording.has(id)) continue
        await expectNodeStatus(page, id, 'success')
      }
    })

    await test.step('KT-b: the tunneled Apply lands and reads back with the value it wrote', () => {
      expect(numberOf(vars, 'a_solo_count'), `the tunneled Apply count.\n${all}`).toBe(1)
      expect(cell(vars, 'a_solo_names').value, 'the tunneled Apply names').toEqual([
        names.tunnelOnly,
      ])
      expect(
        objectOf(vars, 'a_solo_applied').data,
        'the object the tunneled Apply reported writing',
      ).toEqual(tunneledData)

      expect(numberOf(vars, 'a_solo_read'), `the tunneled read-back count.\n${all}`).toBe(1)
      const readBack = objectOf(vars, 'a_solo_result')
      expect(readBack.data, 'the value read back through the tunnel').toEqual(tunneledData)
      expect(readBack.metadata?.name).toBe(names.tunnelOnly)
      expect(readBack.metadata?.namespace).toBe(run.namespace)

      expect(
        logs.includes(
          readLine('ConfigMap', 1, configMapPath(run.namespace, names.tunnelOnly)),
        ),
        `the tunneled read line is missing.\n${all}`,
      ).toBeTruthy()
      expect(
        logs.filter((text) => text === appliedLine(1)).length,
        `every Apply must report one object.\n${all}`,
      ).toBe(APPLY_NODE_IDS.length)
    })

    await test.step('KT-c: the workflow creates and removes the tunneled namespace itself', () => {
      expect(numberOf(vars, 'ns_a_count'), `the namespace Apply count.\n${all}`).toBe(1)
      expect(cell(vars, 'ns_a_names').value, 'the namespace Apply names').toEqual([
        run.namespace,
      ])

      expect(numberOf(vars, 'a_del_count'), `the namespace Delete count.\n${all}`).toBe(1)
      expect(cell(vars, 'a_del_names').value, 'the namespace Delete names').toEqual([
        run.namespace,
      ])
      expect(
        logs.includes(deleteLine('Namespace', 1, namespaceDeletePath(run.namespace))),
        `the namespace delete line is missing.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('KT-d: one name in one namespace, a different value on each cluster', () => {
      expect(numberOf(vars, 'a_both_count'), `the tunneled shared-name Apply.\n${all}`).toBe(1)
      expect(numberOf(vars, 'b_both_count'), `the direct shared-name Apply.\n${all}`).toBe(1)

      const throughTunnel = objectOf(vars, 'a_both_result')
      const throughDirect = objectOf(vars, 'b_both_result')
      expect(throughTunnel.metadata?.name).toBe(names.shared)
      expect(throughDirect.metadata?.name).toBe(names.shared)
      expect(throughTunnel.metadata?.namespace).toBe(run.namespace)
      expect(throughDirect.metadata?.namespace).toBe(run.namespace)
      expect(
        throughTunnel.data,
        `the shared name reads the tunneled value on session A.\n${all}`,
      ).toEqual(tunneledData)
      expect(
        throughDirect.data,
        `the shared name reads the published value on session B.\n${all}`,
      ).toEqual(publishedData)
    })

    await test.step('KT-e: each session cannot see what the other wrote', async () => {
      const missOnDirect = notFoundMessage('ConfigMap', names.tunnelOnly, run.namespace)
      const missOnTunnel = notFoundMessage('ConfigMap', names.publishedOnly, run.namespace)

      expect(cell(vars, 'b_miss_ok').value, 'session B must not find the tunneled object').toBe(
        false,
      )
      expect(textOf(vars, 'b_miss_reason')).toBe('NotFound')
      expect(textOf(vars, 'b_miss_err')).toBe(missOnDirect)
      expect(numberOf(vars, 'b_miss_count')).toBe(0)
      expect(cell(vars, 'b_miss_names').value).toEqual([])

      expect(cell(vars, 'a_miss_ok').value, 'session A must not find the published object').toBe(
        false,
      )
      expect(textOf(vars, 'a_miss_reason')).toBe('NotFound')
      expect(textOf(vars, 'a_miss_err')).toBe(missOnTunnel)
      expect(numberOf(vars, 'a_miss_count')).toBe(0)
      expect(cell(vars, 'a_miss_names').value).toEqual([])

      const entries = await getLogEntries(page)
      const warnings = entries
        .filter((entry) => entry.level === 'WARN')
        .map((entry) => entry.message)
      for (const message of [missOnDirect, missOnTunnel]) {
        const line = recordedReadLine('NotFound', message)
        expect(
          warnings.filter((text) => text === line).length,
          `expected exactly one WARN line for ${message}.\n${all}`,
        ).toBe(1)
      }

      for (const id of RECORDING_NODE_IDS) {
        await expectNodeStatus(page, id, 'warning')
      }
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
        'data-status',
        'passed',
      )
    })

    await test.step('KT-f: the tunnel stayed open for the whole sequence and the workflow closed it', () => {
      expect(numberOf(vars, 'lport'), `the tunnel bound no local port.\n${all}`).toBeGreaterThan(0)
      expect(
        cell(vars, 'tunnel_closed').value,
        `the tunnel must still be open when the workflow closes it.\n${all}`,
      ).toBe(true)
    })
  })
})
