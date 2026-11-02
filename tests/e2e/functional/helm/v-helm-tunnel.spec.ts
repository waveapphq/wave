/**
 * V-HELM-TUNNEL: Helm Blocks against a cluster that is only reachable through
 * an SSH tunnel.
 *
 * Phase: functional-workflow (parallel) - one Test, one release, and a
 * namespace the workflow creates and removes on the far cluster itself.
 * REQ: REQ-3.5.3.1, REQ-3.5.3.4, REQ-5.1.5, REQ-3.4.1.5
 * Design Decisions: HELM-1, K8SWRITE-5
 *
 * The Helm family reaches a cluster the same way every other K8s Block does:
 * through the session K8s Connect hands it. So a tunnel is not a Helm feature -
 * it is a Connect feature the Helm Blocks have to inherit. The run proves they
 * do. It opens an SSH session, forwards a free local port to `kwok-internal`
 * (an unpublished second cluster with no route from the test process or the
 * WAVE server), and Connects over that port carrying the TLS server name.
 * Everything after rides that session: Helm Install creates the release
 * namespace and the release, Helm Status reads it back, Helm Uninstall removes
 * it and a K8s Delete takes the namespace with it, all on the far side.
 *
 * The tunnel head is the one the K8s tunnel suite proved; only what rides it
 * is new here.
 *
 * Pass Criteria:
 *   HL-8a  The Connect reads the cluster version through the local tunnel
 *          port, which is the only route to it.
 *   HL-8b  Helm Install lands the release on the far cluster: the one-row
 *          release table (Namespace = the run namespace, Revision 1, Status
 *          deployed, Chart wave-demo-0.1.0, App Version 1.0.0), Status
 *          deployed, and the INFO line naming the revision.
 *   HL-8c  Helm Status reads the same row back through the same tunnel.
 *   HL-8d  Helm Uninstall removes it, the workflow removes the namespace it
 *          made, the tunnel is still open when the workflow closes it, and
 *          every Block went green with the run passed.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  K8S_INTERNAL_PORT,
  K8S_INTERNAL_SERVICE,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import {
  chainEdges,
  helmInstallNode,
  helmStatusNode,
  helmUninstallNode,
  k8sConnectNode,
  k8sDeleteNode,
  markerNode,
  pluginNode,
  sshSessionOpenNode,
  stackNodes,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { K8S_VERSION_PREFIX, TUNNELED_API_URL } from '../k8s-tunnel/cases-tunnel'
import {
  CHART,
  CHART_REPO_URL,
  expectLine,
  expectNoAmber,
  expectReleaseRow,
  installedLine,
  readReleaseLine,
  releaseName,
  SESSION_VARIABLE,
  statusOf,
  uninstalledLine,
  type SessionVariables,
} from './cases-helm'

/** The bookend the console harvest gates on. */
const TUNNEL_MARKER = 'helm-tunnel-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** Every Block the run drives, in chain order. */
const NODE_IDS = [
  'open-session',
  'tunnel-open',
  'connect-tunnel',
  'install-tunneled',
  'log-install',
  'read-tunneled',
  'log-read',
  'gone-tunneled',
  'delete-ns',
  'tunnel-close',
  'close-session',
  'log-done',
] as const

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

const stringVar = (value = ''): FixtureVariable => ({ value, type: 'string', scope: 'test' })
const secretVar = (value = ''): FixtureVariable => ({
  value,
  type: 'string',
  scope: 'test',
  secret: true,
})

/** Build the whole run: the tunnel head, the Helm round trip riding it, the
 *  namespace teardown on the far cluster, and the two closes. */
function buildTunnelHelmFixture(opts: {
  namespace: string
  release: string
}): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    ssh_pwd: secretVar(SSH_STACK_PASSWORD),
    k8s_admin_token: secretVar(K8S_ADMIN_TOKEN),
    k8s_ca: stringVar(K8S_CA_PEM),
    sid: stringVar(),
    tid: stringVar(),
    lport: { value: 0, type: 'integer', scope: 'test' },
    [SESSION_VARIABLE]: secretVar(),
    ver: stringVar(),
    install_result: { value: [], type: 'table', scope: 'test' },
    install_status: stringVar(),
    read_result: { value: [], type: 'table', scope: 'test' },
    read_status: stringVar(),
    ns_del_count: { value: 0, type: 'integer', scope: 'test' },
    tunnel_closed: { value: false, type: 'boolean', scope: 'test' },
  }

  const nodes: WorkflowNode[] = [
    sshSessionOpenNode({
      id: 'open-session',
      description: 'SSH session the tunnel rides',
      expressionFields: ['password'],
      values: {
        host: SSH_FIXTURE_HOST_SENTINEL,
        port: Number(SSH_MAIN_PORT),
        username: SSH_STACK_USER,
        password: 'ssh_pwd',
        host_key_verification: 'disabled',
      },
      outputBindings: { session_id: 'sid' },
    }),
    pluginNode({
      id: 'tunnel-open',
      label: 'SSH Tunnel Open',
      elementType: 'ssh-tunnel-open',
      category: 'network',
      description: 'Tunnel to the unpublished cluster',
      expressionFields: ['session_id'],
      values: {
        session_id: 'sid',
        local_port: 0,
        remote_host: K8S_INTERNAL_SERVICE,
        remote_port: Number(K8S_INTERNAL_PORT),
      },
      outputBindings: { tunnel_id: 'tid', local_port: 'lport' },
    }),
    k8sConnectNode({
      id: 'connect-tunnel',
      description: 'Connect through the local tunnel port',
      expressionFields: ['api_url', 'token', 'ca_cert'],
      values: {
        api_url: TUNNELED_API_URL,
        namespace: opts.namespace,
        timeout: 30,
        token: 'k8s_admin_token',
        verify_ssl: true,
        ca_cert: 'k8s_ca',
        tls_server_name: K8S_INTERNAL_SERVICE,
      },
      outputBindings: { session: SESSION_VARIABLE, cluster_version: 'ver' },
    }),
    helmInstallNode({
      id: 'install-tunneled',
      description: 'Install the chart on the tunneled cluster',
      expressionFields: ['session'],
      values: {
        session: SESSION_VARIABLE,
        release: opts.release,
        chart: CHART.demo,
        version: V_0_1,
        repo: CHART_REPO_URL,
        namespace: opts.namespace,
        create_namespace: true,
      },
      outputBindings: { result: 'install_result', status: 'install_status' },
    }),
    markerNode({
      id: 'log-install',
      description: 'Install marker',
      expression: "f'[HL-8] install ver={ver} status={install_status}'",
    }),
    helmStatusNode({
      id: 'read-tunneled',
      description: 'Read the release back through the tunnel',
      expressionFields: ['session'],
      values: {
        session: SESSION_VARIABLE,
        release: opts.release,
        namespace: opts.namespace,
      },
      outputBindings: { result: 'read_result', status: 'read_status' },
    }),
    markerNode({
      id: 'log-read',
      description: 'Read-back marker',
      expression: "f'[HL-8] read status={read_status}'",
    }),
    helmUninstallNode({
      id: 'gone-tunneled',
      description: 'Uninstall the release on the far cluster',
      expressionFields: ['session'],
      values: {
        session: SESSION_VARIABLE,
        release: opts.release,
        namespace: opts.namespace,
      },
    }),
    k8sDeleteNode({
      id: 'delete-ns',
      description: 'Remove the namespace the install created',
      expressionFields: ['session'],
      values: {
        session: SESSION_VARIABLE,
        timeout: 30,
        resource_type: 'default',
        kind: 'Namespace',
        delete_by: 'name',
        name: opts.namespace,
        ignore_not_found: true,
        cascade: 'background',
        // The namespace drains after the run, so the Block must not sit on it.
        wait_until_gone: false,
        on_error: 'fail',
      },
      outputBindings: { count: 'ns_del_count' },
    }),
    pluginNode({
      id: 'tunnel-close',
      label: 'SSH Tunnel Close',
      elementType: 'ssh-tunnel-close',
      category: 'network',
      description: 'Close the tunnel',
      expressionFields: ['tunnel_id'],
      values: { tunnel_id: 'tid' },
      outputBindings: { closed: 'tunnel_closed' },
    }),
    pluginNode({
      id: 'close-session',
      label: 'SSH Session Close',
      elementType: 'ssh-session-close',
      category: 'remote',
      description: 'Close the SSH session',
      expressionFields: ['session_id'],
      values: { session_id: 'sid' },
    }),
    markerNode({ id: 'log-done', description: 'Bookend', text: TUNNEL_MARKER }),
  ]

  const emitted = nodes.map((node) => node.id)
  if (emitted.join(',') !== NODE_IDS.join(',')) {
    throw new Error(`NODE_IDS is [${NODE_IDS.join(', ')}] but the run holds [${emitted.join(', ')}]`)
  }

  const laidOut = stackNodes(nodes)
  return {
    name: 'Helm Through an SSH Tunnel E2E Test',
    version: '1.0.0',
    description: '',
    workflow: { nodes: laidOut, edges: chainEdges(emitted) },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

let run: SeededRun
let release: string

test.describe('Helm Blocks through an SSH tunnel to an unpublished cluster', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    // The published cluster only lends this run its namespace NAME; every
    // object the run touches lives on the tunneled cluster, which the test
    // process cannot reach, so the workflow cleans that side up itself.
    run = await seedRun(request, 'minimal')
    release = releaseName('hl8', run.suffix)
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('install and read a release on a cluster only the tunnel reaches (HL-8)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const fixture = buildTunnelHelmFixture({ namespace: run.namespace, release })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, TUNNEL_MARKER, 240_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const row = {
      name: release,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    }

    await test.step('HL-8a: the Connect read the cluster through the local tunnel port', () => {
      expect(Number(vars.lport?.value), `the tunnel bound no local port.\n${all}`).toBeGreaterThan(0)
      expect(String(vars.ver?.value), `the tunneled cluster version.\n${all}`).toContain(
        K8S_VERSION_PREFIX,
      )
      expect(
        logs.some((text) =>
          text.startsWith(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`) &&
          text.includes('at https://127.0.0.1:'),
        ),
        `the Connect must report the loopback the tunnel bound.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('HL-8b: Helm Install lands the release on the far cluster', () => {
      expectReleaseRow(vars, 'install', row)
      expect(statusOf(vars, 'install'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(release, 1))
    })

    await test.step('HL-8c: Helm Status reads the same row back through the same tunnel', () => {
      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(release, 1))
    })

    await test.step('HL-8d: the run cleans the far cluster up and closes the tunnel it opened', async () => {
      expectLine(logs, uninstalledLine(release))
      expect(Number(vars.ns_del_count?.value), `the namespace Delete count.\n${all}`).toBe(1)
      expect(
        vars.tunnel_closed?.value,
        `the tunnel must still be open when the workflow closes it.\n${all}`,
      ).toBe(true)

      for (const id of NODE_IDS) await expectNodeStatus(page, id, 'success')
      await expectNoAmber(page)
    })
  })
})
