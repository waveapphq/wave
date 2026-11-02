/**
 * V-PROFILE-HTTP-FUNCTIONAL: HTTP Profiles drive a real HTTP request.
 *
 * Three legs, one fixture, one run, all against real stack services. Every
 * plugin parameter that the http profile schema has a field for is bound from
 * the profile; only the two switches the schema has no field for (auth_enabled
 * and auth_mode) and the TLS version pins are typed into the Block.
 *
 *   plain (http-echo)  -> the request URL is COMPOSED from the profile's
 *     base_url, and timeout, verify_ssl and ca_cert are bound from it. This is
 *     the assertion for the corrected timeout unit: the profile carries 30 and
 *     the request completes, so 30 is thirty seconds.
 *   auth (http-echo)   -> auth_key and a NON-default auth_header_name are both
 *     bound from the profile. The echo service reflects the request headers, so
 *     the profile's own custom header name is the proof the profile drove the
 *     auth header rather than the plugin default.
 *   mTLS (tls-lab)     -> a second profile carries the client identity: ca_cert,
 *     client_cert, client_key and verify_ssl are all bound from it, and the
 *     listener echoes back the verified client DN.
 *
 * This is the assertion for the http `username`/`password`/`token`/`api_key`
 * -> `auth_*` renames and for `timeout` meaning seconds.
 *
 * Pass criteria:
 *   1. The fixture validates with zero errors and the run passes.
 *   2. All three HTTP Blocks report success.
 *   3. Plain leg: status 200 and an echo body that proves the request reached
 *      the echo endpoint with the profile-composed URL.
 *   4. Auth leg: status 200 and the echoed request headers carry the profile's
 *      custom header name.
 *   5. Auth leg: the API key's value is masked, never cleartext, on any surface.
 *   6. mTLS leg: status 200, the mtls listener answered, and the client DN it
 *      verified is the profile's own client identity.
 *   7. Nothing outlives the run: the imported Test and both profiles are gone.
 *
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-5.1.1, REQ-3.4.1.5
 * Design decisions: K8SPROF-9 (a profile must be proven to drive a plugin)
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-drives-plugin/v-profile-http-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { startRun, finishRun, expectNodesSuccess, resolveEnvironmentId } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  HTTP_TARGET_HOST,
  HTTP_MAIN_PORT,
  TLS_LAB_MTLS_PORT,
  CA_CERT_PEM,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** The CN of the committed TEST-ONLY tls-lab client identity the profile carries. */
const CLIENT_CN = 'wave-e2e-client'

/** The custom API-key header the profile declares - deliberately NOT the
 *  plugin's X-API-Key default, so the echoed name can only have come from the
 *  profile. Node lowercases every received header name. */
const CUSTOM_HEADER = 'x-wave-e2e-profile-key'

/** TEST-ONLY API key. It is injected at load; the profile JSON on disk carries
 *  an empty auth_key. */
const API_KEY = 'wave-e2e-profile-key-8f3a91'

/** Read a profile JSON and fill its deliberately empty fields from the stack
 *  constants - no endpoint, PEM or credential is ever committed to the file. */
function loadProfile(file: string, fill: (config: Record<string, any>) => void): Record<string, any> {
  const profile = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    any
  >
  fill(profile.config)
  return profile
}

/** Create a profile under a per-run unique name, for the shared E2E environment. */
async function createProfile(
  page: Page,
  environmentId: string,
  profile: Record<string, any>,
): Promise<{ id: string; name: string }> {
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

/** The fixture references both profiles by placeholder until they are created. */
function loadFixture(
  http: { id: string; name: string },
  tls: { id: string; name: string },
): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, 'fixture-http.json'), 'utf-8')
    .replace(/__HTTP_PROFILE_ID__/g, http.id)
    .replace(/__HTTP_PROFILE_NAME__/g, http.name)
    .replace(/__TLS_PROFILE_ID__/g, tls.id)
    .replace(/__TLS_PROFILE_NAME__/g, tls.name)
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

test.describe('V-PROFILE-HTTP-FUNCTIONAL', () => {
  test('http profiles drive a plain, an api-key and an mTLS request', async ({ page }) => {
    const environmentId = await resolveEnvironmentId(page.request)

    const httpProfile = await createProfile(
      page,
      environmentId,
      loadProfile('profile-http.json', (config) => {
        config.base_url = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}`
        config.ca_cert = CA_CERT_PEM
        config.auth_key = API_KEY
      }),
    )
    const tlsProfile = await createProfile(
      page,
      environmentId,
      loadProfile('profile-http-tls.json', (config) => {
        config.base_url = `https://${HTTP_TARGET_HOST}:${TLS_LAB_MTLS_PORT}`
        config.ca_cert = CA_CERT_PEM
        config.client_cert = TLS_LAB_CLIENT_CERT_PEM
        config.client_key = TLS_LAB_CLIENT_KEY_PEM
      }),
    )

    await expectProfileListed(page, httpProfile.name)
    await expectProfileListed(page, tlsProfile.name)
    let testId = ''

    try {
      testId = await importValidateAndNavigate(page, loadFixture(httpProfile, tlsProfile))

      const status = await startRun(page)
      const logs = await finishRun(page, status, 'profile-http-e2e-done')
      const all = logs.join('\n')
      const line = (marker: string) => logs.find((t) => t.includes(marker)) ?? ''

      await test.step('every profile-driven request Block succeeded', async () => {
        await expectNodesSuccess(page, ['http-plain', 'http-auth', 'http-mtls'])
      })

      await test.step('plain leg: the composed URL and bound timeout reach http-echo', () => {
        expect(line('httpprof-plain'), all).toContain('status=200')
        expect(line('httpprof-plain'), all).toContain('"path":"/echo"')
        expect(line('httpprof-plain'), all).toContain('"leg":"plain"')
      })

      await test.step("auth leg: the echoed headers carry the profile's own header name", () => {
        expect(line('httpprof-auth'), all).toContain('status=200')
        expect(line('httpprof-auth'), all).toContain('"leg":"auth"')
        expect(line('httpprof-auth').toLowerCase(), all).toContain(CUSTOM_HEADER)
      })

      await test.step('auth leg: the API key is masked, never cleartext', async () => {
        expect(line('httpprof-auth'), all).toContain(SECRET_MASK)
        const copy = await getLogCopyTexts(page)
        expectNoSecret([...logs, ...copy].join('\n'), 'run console', [API_KEY])
      })

      await test.step("mTLS leg: tls-lab verified the profile's client identity", () => {
        expect(line('httpprof-tls'), all).toContain('status=200')
        expect(line('httpprof-tls'), all).toContain('"listener":"mtls"')
        expect(line('httpprof-tls'), all).toContain(CLIENT_CN)
      })
    } finally {
      await cleanUp(page, testId, [httpProfile.id, tlsProfile.id])
    }

    await expectProfileGone(page, httpProfile.name)
    await expectProfileGone(page, tlsProfile.name)
  })
})
