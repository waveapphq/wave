/**
 * V-PROFILE-K8S-FUNCTIONAL: a Kubernetes Profile connects a real cluster.
 *
 * One profile built from the eight explicit kubernetes fields - api_url, token,
 * client_cert, client_key, ca_cert, verify_ssl, tls_server_name and namespace -
 * drives two K8s Connect Blocks against the real kwok cluster. No kubeconfig
 * document and no context name appears anywhere: this is the assertion for the
 * kubernetes field swap.
 *
 *   token leg -> binds api_url, token, ca_cert, verify_ssl, tls_server_name and
 *     namespace. The bearer token is the only credential.
 *   client-certificate leg -> binds the profile's client_cert and client_key
 *     instead, and binds NO token at all.
 *
 * K8s Connect hard-fails, so a failed connect fails the run: the passing verdict
 * is itself the backstop under the version assertions. The suite reads /version
 * only and creates no cluster object, so it needs no per-test namespace.
 *
 * Pass criteria:
 *   1. The fixture validates with zero errors and the run passes.
 *   2. Both K8s Connect Blocks report success.
 *   3. The token leg reports the kwok server version.
 *   4. The client-certificate leg reports the kwok server version.
 *   5. The plugin's own connected line names that version.
 *   6. The profile's bearer token never renders in cleartext on any surface.
 *   7. Nothing outlives the run: the imported Test and the profile are gone.
 *
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-5.1.1, REQ-3.4.1.5
 * Design decisions: K8SPROF-9 (a profile must be proven to drive a plugin)
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-drives-plugin/v-profile-k8s-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { startRun, finishRun, expectNodesSuccess, resolveEnvironmentId } from '../../helpers/k8s-run'
import { expectNoSecret } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  K8S_API_HOST,
  K8S_API_PORT,
  K8S_ADMIN_TOKEN,
  K8S_CA_PEM,
  K8S_CLIENT_CERT_PEM,
  K8S_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** kwok is pinned to Kubernetes 1.33 - every version read starts with this. */
const K8S_VERSION_PREFIX = 'v1.33'

/** Read the profile JSON and fill its deliberately empty fields from the stack
 *  constants - no endpoint, PEM or token is ever committed to the file. */
function loadProfile(): Record<string, any> {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'profile-k8s.json'), 'utf-8'),
  ) as Record<string, any>
  profile.config.api_url = `https://${K8S_API_HOST}:${K8S_API_PORT}`
  profile.config.token = K8S_ADMIN_TOKEN
  profile.config.ca_cert = K8S_CA_PEM
  profile.config.client_cert = K8S_CLIENT_CERT_PEM
  profile.config.client_key = K8S_CLIENT_KEY_PEM
  return profile
}

/** Create the profile under a per-run unique name, for the shared E2E environment. */
async function createProfile(
  page: Page,
  environmentId: string,
): Promise<{ id: string; name: string }> {
  const profile = loadProfile()
  profile.name = `${profile.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  profile.environment_values = { [environmentId]: profile.config }
  const resp = await page.request.post(`${BACKEND_URL}/profiles`, { data: profile })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return { id: (body.data?.id ?? body.id) as string, name: profile.name as string }
}

/** The fixture references the profile by placeholder until it is created. */
function loadFixture(profileId: string, profileName: string): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, 'fixture-k8s.json'), 'utf-8')
    .replace(/__K8S_PROFILE_ID__/g, profileId)
    .replace(/__K8S_PROFILE_NAME__/g, profileName)
  return JSON.parse(raw) as Record<string, unknown>
}


/** A profile only deletes once no Test references it, so the imported Test goes
 *  first. Nothing this suite creates may outlive it on the shared stack. */
async function cleanUp(page: Page, testId: string, profileIds: string[]): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  for (const id of profileIds) {
    await page.request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => {})
  }
}

/** Whether the shared store still lists a profile under this exact name. */
async function profileExists(page: Page, name: string): Promise<boolean> {
  const resp = await page.request.get(
    `${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`,
  )
  const body = await resp.json().catch(() => null)
  const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ name?: string }>
  return rows.some((p) => p.name === name)
}

/** Positive control for the cleanup sweep: the query really does find a profile
 *  that exists, so the absence check below cannot pass vacuously. */
async function expectProfileListed(page: Page, name: string): Promise<void> {
  expect(await profileExists(page, name), `profile "${name}" was not created`).toBeTruthy()
}

/** Assert the named profile is really gone from the shared store. */
async function expectProfileGone(page: Page, name: string): Promise<void> {
  expect(
    await profileExists(page, name),
    `profile "${name}" outlived its test on the shared stack`,
  ).toBeFalsy()
}

test.describe('V-PROFILE-K8S-FUNCTIONAL', () => {
  test('a kubernetes profile connects kwok by token and by client certificate', async ({
    page,
  }) => {
    const environmentId = await resolveEnvironmentId(page.request)
    const profile = await createProfile(page, environmentId)
    await expectProfileListed(page, profile.name)
    let testId = ''

    try {
      testId = await importValidateAndNavigate(page, loadFixture(profile.id, profile.name))

      const status = await startRun(page)
      const logs = await finishRun(page, status, 'profile-k8s-e2e-done')
      const all = logs.join('\n')
      const line = (marker: string) => logs.find((t) => t.includes(marker)) ?? ''

      await test.step('both profile-driven Connect Blocks succeeded', async () => {
        await expectNodesSuccess(page, ['connect-token', 'connect-cert'])
      })

      await test.step('the token leg read the cluster version', () => {
        expect(line('k8sprof-token'), all).toContain(`ver=${K8S_VERSION_PREFIX}`)
      })

      await test.step('the client-certificate leg read the cluster version', () => {
        expect(line('k8sprof-cert'), all).toContain(`ver=${K8S_VERSION_PREFIX}`)
      })

      await test.step('the plugin reports the connected cluster', () => {
        expect(all).toContain(`Connected to Kubernetes ${K8S_VERSION_PREFIX}`)
      })

      await test.step('the profile bearer token never renders in cleartext', async () => {
        const copy = await getLogCopyTexts(page)
        expectNoSecret([...logs, ...copy].join('\n'), 'run console', [K8S_ADMIN_TOKEN])
      })
    } finally {
      await cleanUp(page, testId, [profile.id])
    }

    await expectProfileGone(page, profile.name)
  })
})
