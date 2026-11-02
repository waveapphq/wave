/**
 * V-HELM-PROFILE: a kubernetes profile supplies the session every Helm Block
 * rides, against the real kwok cluster and the fixture chart repository.
 *
 * Phase: functional-workflow (parallel) - the test creates its own profile,
 * imports its own Test, installs into the run's own namespace under a release
 * name of its own, and tears all three down.
 * REQ: REQ-3.5.3.1, REQ-3.5.3.4, REQ-3.4.1.5, REQ-3.4 (Profiles)
 * Design Decisions: HELM-1, HELM-2
 *
 * The Test carries NO cluster material of its own: the builder's token and CA
 * variables are dropped before the import, so the api_url, the namespace, the
 * token and the trust anchor can only have reached the Connect through the
 * bound profile. The Helm Blocks carry no Namespace row either, so the
 * namespace their Result reports is the profile's, forwarded by the session.
 *
 * Pass Criteria:
 *   HL-9  a kubernetes profile bound to the K8s Connect supplies the whole
 *         credential set, the Test itself carries none of it, and a Helm
 *         Install, a Helm Status and a Helm Uninstall riding that session all
 *         succeed - the Result rows naming the profile's own namespace, the
 *         Status scalar reading deployed, and the token never reaching the
 *         console in cleartext.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { k8sConnectNode, type WorkflowNode } from '../../helpers/k8s-nodes'
import { expectNoSecret } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  K8S_ADMIN_TOKEN,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_CA_PEM,
} from '../../helpers/config'
import {
  buildHelmFixture,
  CHART,
  CHART_REPO_URL,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectNoAmber,
  expectReleaseRow,
  installedLine,
  readReleaseLine,
  releaseName,
  runHelmFixture,
  SESSION_VARIABLE,
  statusOf,
  uninstalledLine,
  uninstallQuietly,
  type HelmLeg,
} from './cases-helm'

/** The bookend the run harvests its console against. */
const PROFILE_MARKER = 'helm-profile-done'

/** The alias the Connect reads every credential through. */
const ALIAS = 'k8s_prof'

const V_0_1 = '0.1.0'
const CHART_0_1 = `${CHART.demo}-${V_0_1}`
const APP_1 = '1.0.0'
const DEPLOYED = 'deployed'

/** The cluster as the profile states it. Built from the mode-correct host, so
 *  it needs no fixture rewrite: the profile is created through the API. */
const PROFILE_API_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`

let run: SeededRun
let release: string
let profileId: string
let profileName: string

async function createKubernetesProfile(
  request: APIRequestContext,
  opts: { name: string; namespace: string; environmentId: string },
): Promise<string> {
  const config = {
    api_url: PROFILE_API_URL,
    token: K8S_ADMIN_TOKEN,
    ca_cert: K8S_CA_PEM,
    verify_ssl: true,
    namespace: opts.namespace,
  }
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name: opts.name,
      type: 'kubernetes',
      description: 'Cluster access for the Helm profile case',
      config,
      environment_values: { [opts.environmentId]: config },
      tags: ['e2e', 'helm'],
    },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const id = (body?.data?.id ?? body?.id) as string
  expect(id, 'the created profile must report an id').toBeTruthy()
  return id
}

/** The Connect that reads every credential off the bound profile. */
function profileConnectNode(): WorkflowNode {
  const node = k8sConnectNode({
    id: 'connect-profile',
    description: 'Session built from the kubernetes profile',
    expressionFields: ['api_url', 'namespace', 'token', 'ca_cert'],
    values: {
      api_url: `${ALIAS}.api_url`,
      namespace: `${ALIAS}.namespace`,
      timeout: 30,
      verify_ssl: true,
      ca_cert: `${ALIAS}.ca_cert`,
      token: `${ALIAS}.token`,
    },
    outputBindings: { session: SESSION_VARIABLE },
  })
  const config = node.data.config as Record<string, unknown>
  config.profileBindings = [
    { profileId, alias: ALIAS, profileName, profileType: 'kubernetes' },
  ]
  return node
}

/** Drop every variable the builder pre-loaded with cluster material: the
 *  profile has to be the only place this Test can get a credential from. */
function withoutCarriedCredentials(
  fixture: Record<string, unknown>,
): Record<string, unknown> {
  const carried: unknown[] = [K8S_ADMIN_TOKEN, K8S_CA_PEM]
  const declared = fixture.variables as Record<string, { value: unknown }>
  const variables = Object.fromEntries(
    Object.entries(declared).filter(([, entry]) => !carried.includes(entry.value)),
  )
  return { ...fixture, variables }
}

/** HL-9: install, read back and remove, every Block riding the profile session.
 *  No leg carries a Namespace row, so the namespace can only come from the
 *  session the profile built. */
function profileLegs(name: string): HelmLeg[] {
  return [
    {
      key: 'install',
      ids: ['HL-9'],
      what: 'install wave-demo 0.1.0',
      block: 'install',
      values: { release: name, chart: CHART.demo, version: V_0_1, repo: CHART_REPO_URL },
    },
    {
      key: 'read',
      ids: ['HL-9'],
      what: 'read the release back',
      block: 'status',
      values: { release: name },
    },
    {
      key: 'gone',
      ids: ['HL-9'],
      what: 'uninstall the release',
      block: 'uninstall',
      values: { release: name },
    },
  ]
}

test.describe('Helm Blocks on a profile-supplied session (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    release = releaseName('hl9', run.suffix)
    profileName = `Helm E2E Cluster ${run.suffix}`
    profileId = await createKubernetesProfile(request, {
      name: profileName,
      namespace: run.namespace,
      environmentId: await resolveEnvironmentId(request),
    })
  })

  test.afterAll(async ({ request }) => {
    if (run) await uninstallQuietly(request, { namespace: run.namespace, release })
    await run?.teardown()
    if (profileId) {
      await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
    }
  })

  test('a kubernetes profile supplies the session the Helm Blocks ride (HL-9)', async ({
    page,
  }) => {
    test.setTimeout(300_000)
    const legs = profileLegs(release)
    const fixture = withoutCarriedCredentials(
      buildHelmFixture(legs, {
        name: 'Helm Profile Session E2E Test',
        bookend: PROFILE_MARKER,
        namespace: run.namespace,
        connect: false,
        before: [profileConnectNode()],
      }),
    )

    await test.step('HL-9: the Test itself carries no cluster credential', () => {
      const document = JSON.stringify(fixture)
      expect(document, 'the Test must not carry the cluster token').not.toContain(
        K8S_ADMIN_TOKEN,
      )
      expect(document, 'the Test must not carry the cluster trust anchor').not.toContain(
        'BEGIN CERTIFICATE',
      )
      expect(document, 'the Test must not carry the api_url either').not.toContain(
        PROFILE_API_URL,
      )
      expect(document, 'the Connect must read the profile alias').toContain(`${ALIAS}.token`)
    })

    const { logs, all, vars } = await runHelmFixture(page, fixture, PROFILE_MARKER)
    const row = {
      name: release,
      namespace: run.namespace,
      revision: 1,
      status: DEPLOYED,
      chart: CHART_0_1,
      appVersion: APP_1,
    }

    await test.step('every leg reported its ids and its Block went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
      await expectNoAmber(page)
    })

    await test.step('HL-9: the install lands in the profile namespace', () => {
      expectReleaseRow(vars, 'install', row)
      expect(statusOf(vars, 'install'), `the Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, installedLine(release, 1))
    })

    await test.step('HL-9: Helm Status reads the same release back off that session', () => {
      expectReleaseRow(vars, 'read', row)
      expect(statusOf(vars, 'read'), `the read-back Status scalar.\n${all}`).toBe(DEPLOYED)
      expectLine(logs, readReleaseLine(release, 1))
    })

    await test.step('HL-9: the uninstall removes it and says so', () => {
      expectLine(logs, uninstalledLine(release))
    })

    await test.step('HL-9: the profile token never reaches the console in cleartext', () => {
      expectNoSecret(all, 'console log', [K8S_ADMIN_TOKEN])
    })
  })
})
