/**
 * V-HELM-REMOTE: Helm Blocks inside a Remote Execution container, running the
 * execution host's own helm.
 *
 * Phase: functional-workflow (parallel) - one Test per run, one run namespace,
 * one release name per leg, torn down at the end.
 * REQ: REQ-3.4.1.3, REQ-3.5.3.1, REQ-3.5.3.4, REQ-3.4.1.5
 * Design Decisions: HELM-1
 *
 * The workflow opens an SSH session to the stack's sshd host and puts a K8s
 * Connect and four Helm Blocks inside a Remote Execution container. The
 * cluster is named by its compose DNS name and the chart comes from the
 * repository's in-stack address, so neither is reachable from the WAVE server:
 * a release that lands can only have been installed by the helm on the
 * execution host. That host runs helm 3.21.4 while WAVE runs helm 4.2.4, so
 * the run also proves the family is not pinned to one helm major.
 *
 * The two Helm Path legs are the point: an empty row runs the host's helm from
 * its PATH, and a row that names the host's real helm runs that file. A row
 * that names a path the host does not have refuses with the REMOTE wording,
 * which carries the host's own name - and it refuses under both Failure
 * Handling settings, because a missing helm is a plain Block failure, never a
 * recorded one. Those two legs stop the run dead, so each gets a run of its
 * own.
 *
 * Pass Criteria:
 *   HL-7a  Every Block inside the container carries the R locus badge and
 *          nothing outside it carries one.
 *   HL-7b  With Helm Path empty, Helm Install lands the release on the host:
 *          the one-row release table (Revision 1, Status deployed, Chart
 *          wave-demo-0.1.0, App Version 1.0.0), Status deployed, the INFO
 *          line naming the revision; Helm Status reads the same row back and
 *          Helm Uninstall removes it.
 *   HL-7c  With Helm Path set to the host's real helm, the same three Blocks
 *          behave identically on a release of their own.
 *   HL-7d  With Helm Path set to a path the host does not have, under Fail the
 *          block, the Block fails with exactly
 *          `helm not found: /nonexistent/helm on wave-e2e-host. Set Helm Path
 *          or install helm`, the container fails, the then branch never runs
 *          and the run fails.
 *   HL-7e  The same row under Record and continue fails the same way with the
 *          same sentence.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { getLogEntries, waitForLogText } from '../../helpers/log-reader'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from '../../helpers/config'
import {
  chainEdges,
  edge,
  handleEdge,
  helmInstallNode,
  helmStatusNode,
  helmUninstallNode,
  k8sConnectNode,
  markerNode,
  remoteExecutionNode,
  sshSessionOpenNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import {
  blockFailedLine,
  connectedLine,
  expectLocusBadges,
  K8S_DIRECT_URL,
  nodeIds,
} from '../k8s-remote-exec/cases-remote'
import {
  CHART,
  CHART_REPO_INTERNAL_URL,
  expectLine,
  expectReleaseRow,
  HELM_ON_PATH,
  installedLine,
  readReleaseLine,
  releaseName,
  SESSION_VARIABLE,
  SSH_REMOTE_HOSTNAME,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
  type SessionVariables,
} from './cases-helm'

/** The bookends each run harvests its console against. */
const HOST_MARKER = 'helm-remote-host-done'
const REFUSAL_MARKER = 'helm-remote-refusal-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** A path the sshd image does not have, so the row can only refuse. */
const MISSING_HELM_PATH = '/nonexistent/helm'

/** Per B14b, the remote wording: what was tried, WHERE, and what to do. The
 *  host clause is the whole difference from the WAVE-side sentence. */
const MISSING_HELM_REMOTE =
  `helm not found: ${MISSING_HELM_PATH} on ${SSH_REMOTE_HOSTNAME}. ` +
  'Set Helm Path or install helm'

/** `remoteBodyIds` keys the body walk on this id, so the container keeps it. */
const CONTAINER_ID = 'container'
const OPEN_SESSION_ID = 'open-session'

/** The Name the refusal line calls the Block by (EXEC-26), and its Description. */
const REFUSED_BLOCK_NAME = 'Read with no helm at that path'
const REFUSED_BLOCK_DESCRIPTION = 'Read a release with no helm at that path'

type FixtureVariable = { value: unknown; type: string; scope: string; secret?: boolean }

const stringVar = (value = ''): FixtureVariable => ({ value, type: 'string', scope: 'test' })
const secretVar = (value = ''): FixtureVariable => ({
  value,
  type: 'string',
  scope: 'test',
  secret: true,
})
const tableVar = (): FixtureVariable => ({ value: [], type: 'table', scope: 'test' })

/** Vertical spacing of the stacked columns, as the remote suite lays them out. */
const ROW_STEP = 70
const HEAD_X = -75
const BODY_X = 120

interface RemoteSpec {
  name: string
  bookend: string
  /** The Blocks inside the container, in chain order. */
  body: readonly WorkflowNode[]
  /** The Blocks on the then branch; the bookend follows them. */
  after: readonly WorkflowNode[]
  variables: Record<string, FixtureVariable>
}

/** The K8s Connect the container body opens with: the cluster by its in-stack
 *  name, which only a Block running on the SSH host can resolve. */
function connectInStack(namespace: string): WorkflowNode {
  return k8sConnectNode({
    id: 'connect-remote',
    description: 'Connect to the cluster by its stack name',
    expressionFields: ['token', 'ca_cert'],
    values: {
      api_url: K8S_DIRECT_URL,
      namespace,
      timeout: 30,
      token: 'k8s_admin_token',
      verify_ssl: true,
      ca_cert: 'k8s_ca',
    },
    outputBindings: { session: SESSION_VARIABLE, cluster_version: 'ver' },
  })
}

/** Build one remote workflow: the SSH open, the container, its body and its
 *  then branch, the bookend, and the variables every leg shares. */
function remoteFixture(spec: RemoteSpec): Record<string, unknown> {
  const variables: Record<string, FixtureVariable> = {
    ssh_pwd: secretVar(SSH_STACK_PASSWORD),
    k8s_admin_token: secretVar(K8S_ADMIN_TOKEN),
    k8s_ca: stringVar(K8S_CA_PEM),
    sid: stringVar(),
    rsid: stringVar(),
    [SESSION_VARIABLE]: secretVar(),
    ver: stringVar(),
    ...spec.variables,
  }

  const head: WorkflowNode[] = [
    sshSessionOpenNode({
      id: OPEN_SESSION_ID,
      description: 'SSH session the Helm Blocks ride',
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
    remoteExecutionNode({
      id: CONTAINER_ID,
      description: 'Run the Helm Blocks on the SSH host',
      expressionFields: ['session_id'],
      values: { session_id: 'sid' },
      outputBindings: { remote_session_id: 'rsid' },
    }),
  ]
  const after: WorkflowNode[] = [
    ...spec.after,
    markerNode({ id: 'log-done', description: 'Bookend', text: spec.bookend }),
  ]

  const headOut = stackNodes(head, { x: HEAD_X, startY: 100, step: ROW_STEP })
  const bodyOut = stackNodes(spec.body, {
    x: BODY_X,
    startY: 100 + head.length * ROW_STEP,
    step: ROW_STEP,
  })
  const afterOut = stackNodes(after, {
    x: HEAD_X,
    startY: 100 + (head.length + spec.body.length) * ROW_STEP,
    step: ROW_STEP,
  })

  const chain = (ids: readonly string[]): WorkflowEdge[] =>
    ids.slice(1).map((id, index) => edge(ids[index], id))
  const bodyIds = spec.body.map((node) => node.id)
  const afterIds = after.map((node) => node.id)
  const edges: WorkflowEdge[] = [
    ...chainEdges(head.map((node) => node.id)),
    handleEdge(CONTAINER_ID, 'body', bodyIds[0]),
    ...chain(bodyIds),
    handleEdge(CONTAINER_ID, 'then', afterIds[0]),
    ...chain(afterIds),
  ]

  return {
    name: spec.name,
    version: '1.0.0',
    description: '',
    workflow: { nodes: [...headOut, ...bodyOut, ...afterOut], edges },
    variables,
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** One Helm Path leg: install the fixture chart, read it back, remove it. */
function helmPathLeg(
  key: 'empty' | 'set',
  release: string,
  namespace: string,
  helmPath: string,
  what: string,
): WorkflowNode[] {
  return [
    helmInstallNode({
      id: `install-${key}`,
      description: `Install with Helm Path ${what}`,
      expressionFields: ['session'],
      values: {
        session: SESSION_VARIABLE,
        release,
        chart: CHART.demo,
        version: V_0_1,
        repo: CHART_REPO_INTERNAL_URL,
        namespace,
        helm_path: helmPath,
      },
      outputBindings: { result: `install_${key}_result`, status: `install_${key}_status` },
    }),
    helmStatusNode({
      id: `read-${key}`,
      description: `Read the release back, Helm Path ${what}`,
      expressionFields: ['session'],
      values: { session: SESSION_VARIABLE, release, namespace, helm_path: helmPath },
      outputBindings: { result: `read_${key}_result`, status: `read_${key}_status` },
    }),
    helmUninstallNode({
      id: `gone-${key}`,
      description: `Uninstall the Helm Path ${what} release`,
      expressionFields: ['session'],
      values: { session: SESSION_VARIABLE, release, namespace, helm_path: helmPath },
    }),
  ]
}

/** HL-7b + HL-7c: both Helm Path legs on one host, in one container. */
function buildHostFixture(opts: {
  namespace: string
  emptyRelease: string
  setRelease: string
}): Record<string, unknown> {
  const body: WorkflowNode[] = [
    connectInStack(opts.namespace),
    ...helmPathLeg('empty', opts.emptyRelease, opts.namespace, '', 'empty'),
    ...helmPathLeg('set', opts.setRelease, opts.namespace, HELM_ON_PATH, 'set'),
  ]
  return remoteFixture({
    name: 'Helm Remote Execution Host E2E Test',
    bookend: HOST_MARKER,
    body,
    after: [
      markerNode({
        id: 'log-summary',
        description: 'Summary marker',
        expression:
          "f'[HL-7] ver={ver} empty={install_empty_status}" +
          " set={install_set_status} read={read_set_status}'",
      }),
    ],
    variables: {
      install_empty_result: tableVar(),
      install_empty_status: stringVar(),
      read_empty_result: tableVar(),
      read_empty_status: stringVar(),
      install_set_result: tableVar(),
      install_set_status: stringVar(),
      read_set_result: tableVar(),
      read_set_status: stringVar(),
    },
  })
}

/** HL-7d / HL-7e: one Helm Status whose Helm Path the host does not have. */
function buildRefusalFixture(opts: {
  namespace: string
  release: string
  onError: 'fail' | 'record'
}): Record<string, unknown> {
  return remoteFixture({
    name: `Helm Remote Missing Executable ${opts.onError} E2E Test`,
    bookend: REFUSAL_MARKER,
    body: [
      connectInStack(opts.namespace),
      helmStatusNode({
        id: 'miss-helm',
        label: REFUSED_BLOCK_NAME,
        description: REFUSED_BLOCK_DESCRIPTION,
        expressionFields: ['session'],
        values: {
          session: SESSION_VARIABLE,
          release: opts.release,
          namespace: opts.namespace,
          helm_path: MISSING_HELM_PATH,
          on_error: opts.onError,
        },
        outputBindings: { result: 'miss_result', status: 'miss_status' },
      }),
    ],
    after: [],
    variables: { miss_result: tableVar(), miss_status: stringVar() },
  })
}

/** Run a fixture that is meant to fail on the missing executable, and assert
 *  the exact refusal, where it stopped, and the verdict. */
async function expectRefused(page: Page, fixture: Record<string, unknown>): Promise<void> {
  await importValidateAndNavigate(page, fixture, { injectSsh: true })
  const failedLine = blockFailedLine(REFUSED_BLOCK_NAME, MISSING_HELM_REMOTE)

  const status = await startRun(page)
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 240_000 })
  const logs = await waitForLogText(page, failedLine, 30_000)
  const all = logs.join('\n')

  const entries = await getLogEntries(page)
  const refusals = entries.filter((entry) => entry.message === failedLine)
  expect(refusals.length, `expected exactly one refusal line.\n${all}`).toBe(1)
  expect(refusals[0].level, 'the refusal is reported at ERROR level').toBe('ERROR')

  expect(
    logs.some((text) => text.includes(REFUSAL_MARKER)),
    `the then branch must not run.\n${all}`,
  ).toBeFalsy()

  await expectNodeStatus(page, OPEN_SESSION_ID, 'success')
  await expectNodeStatus(page, 'miss-helm', 'failed')
  await expectNodeStatus(page, CONTAINER_ID, 'failed')
  await expect(status).toHaveAttribute('data-status', 'failed')
}

let run: SeededRun
let emptyRelease: string
let setRelease: string

test.describe("Helm Blocks on the execution host's own helm", () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    emptyRelease = releaseName('h7a', run.suffix)
    setRelease = releaseName('h7b', run.suffix)
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      await uninstallQuietly(request, { namespace: run.namespace, release: emptyRelease })
      await uninstallQuietly(request, { namespace: run.namespace, release: setRelease })
    }
    await run?.teardown()
  })

  test('the host runs both Helm Path legs and the canvas paints them remote (HL-7)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const fixture = buildHostFixture({
      namespace: run.namespace,
      emptyRelease,
      setRelease,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    await test.step('HL-7a: every Block inside the container carries the R badge', async () => {
      await expectLocusBadges(page, fixture)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, HOST_MARKER, 240_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const row = (release: string) => ({
      name: release,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    })

    await test.step('the Connect reached the cluster by its stack name, so the body ran on the host', () => {
      expect(
        logs.includes(connectedLine(K8S_DIRECT_URL)),
        `the Connect must report the cluster by its stack name.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('HL-7b: an empty Helm Path runs the host helm, and the release round-trips', () => {
      expectReleaseRow(vars, 'install_empty', row(emptyRelease))
      expect(statusOf(vars, 'install_empty'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(emptyRelease, 1))

      expectReleaseRow(vars, 'read_empty', row(emptyRelease))
      expect(statusOf(vars, 'read_empty'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(emptyRelease, 1))
      expectLine(logs, uninstalledLine(emptyRelease))
    })

    await test.step("HL-7c: a Helm Path naming the host's real helm behaves identically", () => {
      expectReleaseRow(vars, 'install_set', row(setRelease))
      expect(statusOf(vars, 'install_set'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(setRelease, 1))

      expectReleaseRow(vars, 'read_set', row(setRelease))
      expect(statusOf(vars, 'read_set'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(setRelease, 1))
      expectLine(logs, uninstalledLine(setRelease))
    })

    await test.step('every Block in the run went green', async () => {
      for (const id of nodeIds(fixture)) await expectNodeStatus(page, id, 'success')
    })
  })

  test('a Helm Path the host does not have refuses, naming the host (HL-7)', async ({ page }) => {
    test.setTimeout(300_000)
    await expectRefused(
      page,
      buildRefusalFixture({
        namespace: run.namespace,
        release: emptyRelease,
        onError: 'fail',
      }),
    )
  })

  test('Record and continue does not soften a missing helm on the host (HL-7)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await expectRefused(
      page,
      buildRefusalFixture({
        namespace: run.namespace,
        release: emptyRelease,
        onError: 'record',
      }),
    )
  })
})
