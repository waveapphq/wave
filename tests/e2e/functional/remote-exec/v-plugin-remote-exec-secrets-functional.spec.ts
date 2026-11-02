/**
 * V-PLUGIN-REMOTE-EXEC-SECRETS-FUNCTIONAL: remote-path secret canary.
 *
 * REQ: REQ-3.1.3.5 (uniform plugin I/O logging over the remote-execution path).
 *
 * Each remote body block routes through the same masked-echo +
 * secret-registration machinery as a local block. This canary drives a Remote
 * Execution container whose body HTTP blocks REALLY run on the sshd host
 * (real pushed bundle under python3) against the internal `http-target`
 * service's canary endpoints:
 * `/secret-payload` plants a secret in the response body; `/cookie` issues a
 * Set-Cookie credential header. Both canary values are the simulator's
 * server-side defaults so they never ride a request URL. Three remote-path
 * secrets must never leak in cleartext:
 *   - a marked-secret remote OUTPUT (the http body, output_secret_fields),
 *   - a remote HTTP response Set-Cookie header (a catalog credential auto-
 *     registered WAVE-side, B4c),
 *   - a profile credential used over the remote path (in the remote request URL,
 *     which also masks in the worker's own replayed log line).
 * None appears in the block's DEBUG echo, the console, the WS stream, the report
 * or on disk. Positive controls (real 200s from the stack-only target, the
 * replayed worker line, then-branch bookend) keep the absence sweep honest.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForLogText, getLogTexts } from '../../helpers/log-reader'
import { getActiveSessionId, getSessionVariables, injectServiceHost } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { expectNoSecret, sweepStore, SECRET_MASK } from '../../helpers/secret-canary'
import fs from 'fs'
import path from 'path'

const MASK = SECRET_MASK
// The http-target simulator's server-side canary defaults (server.ts /secret-payload, /cookie).
const REMOTE_BODY = 'cnr6-body-a1b2c3d4-epsilon-real-bytes'
const REMOTE_COOKIE = 'wave-c00kie-s3cr3t-4417'
const PROFILE_TOKEN = 'rex-profile-token-a9b8c7'
const SECRETS = [REMOTE_BODY, REMOTE_COOKIE, PROFILE_TOKEN]

async function getEnvironmentId(page: Page): Promise<string> {
  const resp = await page.request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  expect(env, `environment "${E2E_ENV_NAME}" must exist`).toBeTruthy()
  return env.id as string
}

async function createProfile(page: Page, environmentId: string): Promise<{ id: string; name: string }> {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'profile-secrets.json'), 'utf-8'),
  ) as Record<string, any>
  profile.name = `${profile.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  profile.environment_values = { [environmentId]: profile.config }
  const resp = await page.request.post(`${BACKEND_URL}/profiles`, { data: profile })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return { id: (body.data?.id || body.id) as string, name: profile.name as string }
}

function loadFixture(profileId: string, profileName: string): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, 'fixture-secrets.json'), 'utf-8')
    .replace(/__PROFILE_ID__/g, profileId)
    .replace(/__PROFILE_NAME__/g, profileName)
  const fixture = injectServiceHost(JSON.parse(raw)) as Record<string, any>
  fixture.name = `${fixture.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

function debugMessages(events: Array<Record<string, unknown>>): string[] {
  return events
    .map((event) => event.message)
    .filter((message): message is string => typeof message === 'string')
}

test.describe('V-PLUGIN-REMOTE-EXEC-SECRETS-FUNCTIONAL', () => {
  test('marked remote output, response Set-Cookie and profile cred all mask over the remote path', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(180_000)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profile = await createProfile(page, environmentId)

    const createResp = await page.request.post(`${BACKEND_URL}/tests`, {
      data: loadFixture(profile.id, profile.name),
    })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    const validateResp = await page.request.post(`${BACKEND_URL}/tests/${testId}/validate?context=run`)
    const validateBody = await validateResp.json().catch(() => null)
    expect(validateResp.ok(), `validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`).toBeTruthy()
    expect(validateBody.data?.errors ?? []).toEqual([])

    try {
      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)

      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      const status = page.locator('[data-testid="workflow-status"]')
      await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
      const sessionId = await getActiveSessionId(page)
      const collector = await openSessionEventCollector(page, sessionId, [
        `log:${sessionId}`,
        `variable:${sessionId}`,
      ])

      await test.step('run passes; the body blocks ran on the remote host (positive controls)', async () => {
        await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 90_000 })
        const logTexts = await waitForLogText(page, 'remote-secrets-done')
        const all = logTexts.join('\n')
        expect(await status.getAttribute('data-status'), `run failed.\n${all}`).toBe('passed')
        // http-target resolves only inside the stack: real 200s prove the
        // bundle's urllib executed on the host, never locally on WAVE.
        expect(logTexts.some((t) => t.includes('in-body rx=200')), `remote status must bind.\n${all}`).toBeTruthy()
        expect(logTexts.some((t) => t.includes('ck=200')), `cookie status must bind.\n${all}`).toBeTruthy()
        // The worker's replayed log masks the profile cred riding the URL.
        expect(
          logTexts.some((t) => t.includes(`HTTP 200 https://http-target:9443/secret-payload?tok=${MASK}`)),
          `the replayed worker line must mask the profile cred.\n${all}`
        ).toBeTruthy()
      })

      await test.step('marked remote output + response Set-Cookie + profile cred mask in the console', async () => {
        const logTexts = await getLogTexts(page)
        const all = logTexts.join('\n')
        const bodyLine = logTexts.find((t) => t.includes('bodycheck=')) ?? ''
        // The marked remote body output masks; the profile cred masks; the response
        // Set-Cookie (inside the logged headers map) masks - all as `********`.
        expect(bodyLine, `body log line missing.\n${all}`).toContain('bodycheck=')
        expect(bodyLine, 'the marked remote body output must mask').toContain(`bodycheck=${MASK}`)
        expect(bodyLine, 'the profile credential over the remote path must mask').toContain(`tok=${MASK}`)
        expectNoSecret(all, 'console log', SECRETS)
      })

      await test.step('session variables: the marked remote output is masked', async () => {
        const variables = await getSessionVariables(page, sessionId)
        expect(variables.rx_body.value, 'the marked remote body output must be masked').toBe(MASK)
        expectNoSecret(JSON.stringify(variables), 'session variables', SECRETS)
      })

      await test.step('remote block DEBUG Outputs echo masks the body + response cred', async () => {
        const messages = debugMessages(await collector.harvest())
        const outputs = messages.find((m) => m.startsWith('Outputs:') && m.includes(`"body":"${MASK}"`))
        expect(
          outputs,
          `a masked Outputs line for the remote HTTP block must broadcast at DEBUG. Got:\n${messages.join('\n')}`,
        ).toBeTruthy()
        expectNoSecret(outputs!, 'remote HTTP Outputs line', SECRETS)
      })

      await test.step('WS + report + disk sweeps clean', async () => {
        const events = await collector.harvest()
        await collector.close()
        expectNoSecret(JSON.stringify(events), 'WS stream', SECRETS)

        const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
        expect(genResp.status(), await genResp.text()).toBe(200)
        const contentResp = await page.request.get(
          `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
        )
        expect(contentResp.ok()).toBeTruthy()
        expectNoSecret(await contentResp.text(), 'report', SECRETS)

        for (const needle of SECRETS) {
          expect(sweepStore(needle), `canary ${needle} persisted by the run`).toEqual([])
        }
      })
    } finally {
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
      await page.request.delete(`${BACKEND_URL}/profiles/${profile.id}`).catch(() => {})
    }
  })
})
