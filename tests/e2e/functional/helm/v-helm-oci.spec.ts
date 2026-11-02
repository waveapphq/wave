/**
 * V-HELM-OCI: a chart in an OCI registry is pulled with the Block's own login,
 * never with a login stored on the WAVE host.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test and
 * installs into the run's own namespace under release names of its own. The
 * registry is read-only.
 * Wireframe: N/A
 * Design Decisions: HELM-5 (the Auth & TLS group), HELM-1
 * REQ: REQ-3.5.3.1, REQ-3.5.3.6
 *
 * Every leg names the same chart reference on the real registry (HTTPS on the
 * lab CA, basic login), so the only thing that changes between legs is the
 * login the Block carries. This case asserts helm's own sentence for a pull
 * that carried no login: it is the text a person reads when the Repository
 * Username and Password rows are empty.
 *
 * Pass Criteria:
 *   HL-15 Repository Username and Password with the lab CA as the Repository
 *         CA Certificate deploy the OCI chart: Result is the one-row release
 *         table (Revision 1, Status deployed, Chart wave-demo-0.1.0, App
 *         Version 1.0.0), Status reads deployed, and the INFO line names the
 *         revision.
 *         Helm Status reads the same release row back.
 *         The same install with no Repository Username and Password, under
 *         Record and continue, reports success false, Reason Forbidden, the
 *         error `INSTALLATION FAILED: failed to perform "FetchReference" on
 *         source: GET "https://<registry>/v2/charts/wave-demo/manifests/0.1.0":
 *         basic credential not found`, an empty Status and the release table
 *         with no row, and writes exactly one WARN line.
 *         With a login for that registry stored on the WAVE host (a Shell
 *         Exec Block runs `helm registry login`, and a pull by that host's own
 *         helm then reads the chart with no login passed), the install with no
 *         Repository Username and Password fails with the same Reason, the
 *         same error and one WARN line: the stored login is ignored.
 *         The stored login is removed again after the test.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { getLogEntries } from '../../helpers/log-reader'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { validateTest } from '../../helpers/fn-seed'
import {
  clearSettledWorkbenchSession,
  expectNodeStatus,
  runTrackedTest,
} from '../../helpers/k8s-run'
import { pluginNode, stackNodes, type WorkflowNode } from '../../helpers/k8s-nodes'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  CHART_REPO_HOST,
  OCI_CHART_REF,
  OCI_REGISTRY_PASSWORD,
  OCI_REGISTRY_PORT,
  OCI_REGISTRY_USER,
} from '../../helpers/config'
import {
  buildHelmFixture,
  cell,
  CHART,
  expectEmptyRelease,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectReleaseRow,
  installedLine,
  okVar,
  readReleaseLine,
  reasonVar,
  recordedLine,
  releaseName,
  runHelmFixture,
  statusOf,
  uninstallQuietly,
  uninstalledLine,
  type HelmLeg,
} from './cases-helm'

/** The bookends the runs harvest their consoles against. */
const OCI_MARKER = 'helm-oci-done'
const STORED_MARKER = 'helm-oci-stored-login-done'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** The registry as `helm registry login` names it. */
const REGISTRY = `${CHART_REPO_HOST}:${OCI_REGISTRY_PORT}`

/** helm's own sentence for a pull that carried no login. */
const NO_LOGIN_MESSAGE =
  'INSTALLATION FAILED: failed to perform "FetchReference" on source: ' +
  `GET "https://${REGISTRY}/v2/charts/${CHART.demo}/manifests/${V_0_1}": basic credential not found`

/** The WARN line the refused install writes. */
const NO_LOGIN_WARNING = recordedLine('Helm Install', 'Forbidden', NO_LOGIN_MESSAGE)

/** The one line the stored-login pull prints: the chart's name from its Chart.yaml. */
const PULLED_CHART_LINE = `name: ${CHART.demo}`

const PLANT_NODE = 'shell-plant-login'
const LOGOUT_NODE = 'shell-logout'
const STORED_PULL_VARIABLE = 'stored_login_pull'

/** What the Shell Exec Blocks read from their environment, so nothing is quoted into a command line. */
const REGISTRY_ENVIRONMENT = {
  OCI_LAB_REGISTRY: REGISTRY,
  OCI_LAB_USER: OCI_REGISTRY_USER,
  OCI_LAB_PASSWORD: OCI_REGISTRY_PASSWORD,
  OCI_LAB_CHART: OCI_CHART_REF,
  OCI_LAB_VERSION: V_0_1,
  OCI_LAB_CA: CA_CERT_PEM,
}

/** Log in as a person at the WAVE host would, then pull with that host's own helm and no login passed. */
const PLANT_COMMAND = [
  `ca="$(mktemp)" && printf '%s' "$OCI_LAB_CA" > "$ca" &&`,
  `printf '%s' "$OCI_LAB_PASSWORD" | helm registry login "$OCI_LAB_REGISTRY"`,
  `--username "$OCI_LAB_USER" --password-stdin --ca-file "$ca" > /dev/null &&`,
  `helm show chart "$OCI_LAB_CHART" --version "$OCI_LAB_VERSION" --ca-file "$ca" | grep '^name: ';`,
  `code=$?; rm -f "$ca"; exit $code`,
].join(' ')

const LOGOUT_COMMAND = 'helm registry logout "$OCI_LAB_REGISTRY"'

let run: SeededRun
let releases: { login: string; nologin: string; stored: string }

function shellExecNode(
  id: string,
  description: string,
  command: string,
  outputBindings: Record<string, string> = {},
): WorkflowNode {
  return pluginNode({
    id,
    label: 'Shell Exec',
    elementType: 'shell-exec',
    category: 'system',
    description,
    values: { command, env_vars: { ...REGISTRY_ENVIRONMENT } },
    outputBindings,
  })
}

/** The chart source every install leg shares: the reference, its version and the lab CA. */
function ociSource(): { chart: string; version: string; repo_ca_cert: string } {
  return { chart: OCI_CHART_REF, version: V_0_1, repo_ca_cert: CA_CERT_PEM }
}

/** The install that carries no login, under Record and continue. */
function noLoginLeg(key: string, what: string, release: string): HelmLeg {
  return {
    key,
    ids: ['HL-15'],
    what,
    block: 'install',
    records: true,
    values: { ...ociSource(), release, on_error: 'record' },
    marker: `f'[HL-15] ${key} ok={${okVar(key)}} reason={${reasonVar(key)}}'`,
  }
}

/** The Block's own login, the read back, the same install with no login, and the removal. */
function loginLegs(): HelmLeg[] {
  return [
    {
      key: 'login',
      ids: ['HL-15'],
      what: 'install with the registry login and the lab CA',
      block: 'install',
      values: {
        ...ociSource(),
        release: releases.login,
        repo_username: OCI_REGISTRY_USER,
        repo_password: OCI_REGISTRY_PASSWORD,
      },
    },
    {
      key: 'read',
      ids: ['HL-15'],
      what: 'read the installed release back',
      block: 'status',
      values: { release: releases.login },
    },
    noLoginLeg('nologin', 'install with no registry login', releases.nologin),
    {
      key: 'drop',
      ids: ['HL-15'],
      what: 'remove the release the login deployed',
      block: 'uninstall',
      values: { release: releases.login },
    },
  ]
}

/** The `Helm Install failed` WARN lines the console carries. */
async function refusedInstalls(page: Page): Promise<string[]> {
  const entries = await getLogEntries(page)
  return entries
    .filter((entry) => entry.level === 'WARN' && entry.message.startsWith('Helm Install failed'))
    .map((entry) => entry.message)
}

/** Remove the registry login from the WAVE host in a headless run of a one-Block Test. */
async function logOutOfRegistry(request: APIRequestContext): Promise<void> {
  const fixture = {
    name: `Helm OCI Registry Logout ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: stackNodes([
        shellExecNode(LOGOUT_NODE, 'Remove the stored registry login', LOGOUT_COMMAND),
      ]),
      edges: [{ id: `edge-start-${LOGOUT_NODE}`, source: 'start-node', target: LOGOUT_NODE }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
  const created = await request.post(`${BACKEND_URL}/tests`, { data: fixture })
  const body = await created.json().catch(() => null)
  expect(
    created.ok(),
    `POST /tests (registry logout): ${created.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = (body?.data?.id ?? body?.id) as string
  try {
    const validation = await validateTest(request, testId, 'run')
    expect(
      validation.errors,
      `run validation of the logout Test: ${JSON.stringify(validation.errors)}`,
    ).toEqual([])
    const { verdict } = await runTrackedTest(request, testId)
    expect(verdict, 'the registry logout run must pass').toBe('passed')
  } finally {
    await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    await clearSettledWorkbenchSession(request)
  }
}

test.describe('Helm chart from an OCI registry (real registry, HTTPS on the lab CA, basic login)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    releases = {
      login: releaseName('ocilogin', run.suffix),
      nologin: releaseName('ocinone', run.suffix),
      stored: releaseName('ocistored', run.suffix),
    }
  })

  test.afterAll(async ({ request }) => {
    if (run) {
      for (const release of Object.values(releases)) {
        await uninstallQuietly(request, { namespace: run.namespace, release })
      }
    }
    await run?.teardown()
  })

  test("the Block's own login deploys the OCI chart, and no login is refused (HL-15)", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const legs = loginLegs()
    const fixture = buildHelmFixture(legs, {
      name: 'Helm OCI Registry E2E Test',
      bookend: OCI_MARKER,
      namespace: run.namespace,
    })
    const { logs, all, vars } = await runHelmFixture(page, fixture, OCI_MARKER)

    const row = {
      name: releases.login,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    }

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('HL-15: Repository Username and Password with the lab CA deploy the OCI chart', () => {
      expectReleaseRow(vars, 'login', row)
      expect(statusOf(vars, 'login'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(releases.login, 1))
    })

    await test.step('HL-15: Helm Status reads the same release back', () => {
      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(releases.login, 1))
    })

    await test.step("HL-15: the same install with no login is refused in helm's own words", async () => {
      expectRecorded(vars, 'nologin', { reason: 'Forbidden', message: NO_LOGIN_MESSAGE })
      expect(statusOf(vars, 'nologin'), `a refused install reports no status.\n${all}`).toBe('')
      expectEmptyRelease(vars, 'nologin')
      expect(await refusedInstalls(page), `one WARN line for the refused install.\n${all}`).toEqual([
        NO_LOGIN_WARNING,
      ])
    })

    await test.step('HL-15: the deployed release is removed before the run ends', () => {
      expectLine(logs, uninstalledLine(releases.login))
    })
  })

  test.describe('with a login for the registry stored on the WAVE host', () => {
    test.afterEach(async ({ request }) => {
      await logOutOfRegistry(request)
    })

    test('the stored login is ignored: the install with no login is still refused (HL-15)', async ({
      page,
    }) => {
      test.setTimeout(300_000)
      const legs = [
        noLoginLeg('stored', 'install with no login, one stored on host', releases.stored),
      ]
      const fixture = buildHelmFixture(legs, {
        name: 'Helm OCI Stored Login E2E Test',
        bookend: STORED_MARKER,
        namespace: run.namespace,
        variables: { [STORED_PULL_VARIABLE]: { value: '', type: 'string', scope: 'test' } },
        before: [
          shellExecNode(PLANT_NODE, 'Store a registry login on the WAVE host', PLANT_COMMAND, {
            stdout: STORED_PULL_VARIABLE,
          }),
        ],
      })
      const { logs, all, vars } = await runHelmFixture(page, fixture, STORED_MARKER)

      await test.step("the login is stored: the WAVE host's own helm pulls the chart with no login passed", async () => {
        await expectNodeStatus(page, PLANT_NODE, 'success')
        expect(
          String(cell(vars, STORED_PULL_VARIABLE).value).trim(),
          `the pull that used the stored login must print the chart's name.\n${all}`,
        ).toBe(PULLED_CHART_LINE)
      })

      await test.step('the leg reported its ids and ended amber', async () => {
        expectMarkers(logs, legs)
        await expectLegStatuses(page, legs)
      })

      await test.step('HL-15: the Block ignores the stored login and is refused the same way (REQ-3.5.3.6)', async () => {
        expectRecorded(vars, 'stored', { reason: 'Forbidden', message: NO_LOGIN_MESSAGE })
        expect(statusOf(vars, 'stored'), `a refused install reports no status.\n${all}`).toBe('')
        expectEmptyRelease(vars, 'stored')
        expect(await refusedInstalls(page), `one WARN line for the refused install.\n${all}`).toEqual([
          NO_LOGIN_WARNING,
        ])
      })
    })
  })
})
