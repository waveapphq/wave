/**
 * V-PROF-VALUE-FN-ENVIRONMENT-FUNCTIONAL: a profile-bound Block inside a Function uses the run's environment
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-4.7.10, REQ-4.7.12, REQ-3.1.2.1
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a second environment
 * through POST /environments/, a custom profile through POST /profiles holding a different `url`
 * in the shared E2E environment and in the second one, and a Test through POST /tests (zero
 * validation errors) with a profile-bound Log at the root followed by a Local Function whose
 * body holds a profile-bound Log. Both runs go through the toolbar.
 *
 * Pass Criteria:
 * 1. Run with the shared E2E environment: the root Log and the Log inside the Function both
 *    print that environment's `url`.
 * 2. Run with the second environment: both print the second environment's `url`.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { localFunctionNode, logNode, openTest, startEdge } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { runToEnd } from '../../helpers/workbench'

async function listEnvironments(request: APIRequestContext): Promise<Array<{ id: string; name: string }>> {
  const resp = await request.get(`${BACKEND_URL}/environments/`)
  expect(resp.ok(), `GET /environments/: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return Array.isArray(body) ? body : (body.data ?? [])
}

async function createEnvironment(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/environments/`, {
    data: { name, description: 'A second environment for the profile environment check' },
  })
  expect(resp.ok(), `POST /environments/: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const env = (await listEnvironments(request)).find((entry) => entry.name === name)
  expect(env, `environment ${name} exists`).toBeTruthy()
  return (env as { id: string }).id
}

async function createProfile(
  request: APIRequestContext,
  name: string,
  urls: Record<string, string>,
): Promise<string> {
  const environmentValues: Record<string, unknown> = {}
  for (const [envId, url] of Object.entries(urls)) {
    environmentValues[envId] = { url: { type: 'string', secret: false, value: url } }
  }
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { name, type: 'custom', tags: [], environment_values: environmentValues },
  })
  expect(resp.ok(), `POST /profiles: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id ?? body.id
}

/** A Log bound to the profile under the alias `prof`. */
function boundLog(id: string, message: string, profileId: string, profileName: string, y: number) {
  const node = logNode(id, 'Log', message, { x: 200, y }) as { data: { config: Record<string, unknown> } }
  node.data.config.profileBindings = [{ profileId, alias: 'prof', profileName, profileType: 'custom' }]
  return node as unknown as Record<string, unknown>
}

/** Pick an environment by name in the toolbar selector. */
async function pickEnvironment(page: Page, name: string): Promise<void> {
  const selector = page.locator('[data-testid="environment-selector"]')
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(selector).toBeEnabled({ timeout: 10_000 })
  await expect(async () => {
    await selector.click({ timeout: 5_000 })
    await expect(popover).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await popover.locator('button', { hasText: name }).first().click()
  await expect(popover).not.toBeVisible()
  await expect(selector).toContainText(name)
}

test.describe('V-PROF-VALUE-FN-ENVIRONMENT-FUNCTIONAL: profile values inside a Function body', () => {
  let environmentId: string | undefined
  let profileId: string | undefined
  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    if (profileId) await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
    if (environmentId) await request.delete(`${BACKEND_URL}/environments/${environmentId}`).catch(() => undefined)
  })

  test('a profile-bound Block inside a Function uses the environment the run started with, as at the root', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const tag = randomUUID().slice(0, 8)
    await ensureEnvironment(request)
    const sharedEnv = (await listEnvironments(request)).find((env) => env.name === E2E_ENV_NAME)
    expect(sharedEnv, 'the shared E2E environment exists').toBeTruthy()
    const secondName = `v-prof-fn-env-${tag}`
    environmentId = await createEnvironment(request, secondName)
    const urls = {
      shared: `https://alpha-${tag}.example`,
      second: `https://beta-${tag}.example`,
    }
    const profileName = `v-prof-fn-env-${tag}`
    profileId = await createProfile(request, profileName, {
      [(sharedEnv as { id: string }).id]: urls.shared,
      [environmentId]: urls.second,
    })
    testId = await importFixtureTest(page, {
      name: `v-prof-fn-env-${tag}`,
      version: '1.0.0',
      description: 'A profile-bound Log at the root and inside a Local Function',
      workflow: {
        nodes: [
          boundLog('root-log', "'root=' + prof.url", profileId, profileName, 100),
          localFunctionNode(
            'fn-1',
            'Function_1',
            {
              nodes: [boundLog('fn-log', "'fn=' + prof.url", profileId, profileName, 100)],
              edges: [startEdge('fn-log')],
            },
            { x: 200, y: 260 },
          ),
        ],
        edges: [startEdge('root-log'), { id: 'e-root-fn', source: 'root-log', target: 'fn-1' }],
      },
      variables: {},
      metadata: { tags: [], suite_id: null, parent_suite: null },
    })

    for (const [envName, url] of [
      [E2E_ENV_NAME, urls.shared],
      [secondName, urls.second],
    ] as const) {
      await test.step(`a run with ${envName === E2E_ENV_NAME ? 'the shared' : 'the second'} environment`, async () => {
        await openTest(page, testId as string)
        await pickEnvironment(page, envName)
        const { verdict, entries } = await runToEnd(page)
        expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
        expectConsoleLine(entries, 'INFO', `root=${url}`)
        expectConsoleLine(entries, 'INFO', `fn=${url}`)
      })
    }
  })
})
