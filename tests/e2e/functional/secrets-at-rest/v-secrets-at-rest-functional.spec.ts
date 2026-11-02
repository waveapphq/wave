/**
 * V-SECRETS-AT-REST-FUNCTIONAL: encrypt-at-rest end-to-end canary.
 *
 * REQ: REQ-4.5.1 (credential encryption at rest)
 *
 * Plants two unique canary strings - A in a secret test variable, B in an
 * http-profile credential (the two surfaces sealed at rest) - then proves:
 *
 * Pass Criteria:
 *  1. Import + profile create succeed; the fixture passes validation with
 *     zero errors
 *  2. At rest: the stored test definition and profile files carry
 *     wave:enc:v1: envelopes; canaries A and B appear NOWHERE in the raw
 *     store; non-secret siblings (plain variable, base_url) stay cleartext
 *  3. The run executes on the REAL unsealed values: slice-transforms of A
 *     and B print the expected plaintext suffixes (an envelope or the mask
 *     placeholder would fail them) and the run completes as passed
 *  4. Masking still holds over sealed storage: a direct log of A renders
 *     the bare placeholder; A and B appear in no console line, WS payload,
 *     session-variable read, or report content
 *  5. A tracked execution persists and serves NO engine-injected profile
 *     alias entries (creds.*), and the post-run store sweep still finds
 *     neither canary anywhere on disk
 *
 * Criterion 4's log-direct assertion covers the param-resolution masking
 * intent (a param resolving a secret still masks under sealing).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importFixtureTest,
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  STORAGE_BASE_PATH,
  ensureEnvironment,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// Planted canaries (must match fixture.json / profile-http.json).
const CANARY_A = 'cnrA-4d1f9b2e77c1-alpha-real-bytes'
const CANARY_B = 'cnrB-8c2a6e51d0f3-bravo-real-bytes'
const PLAIN_MARKER = 'plain-sibling-1e6f00d5-cleartext'
const PROFILE_BASE_URL = 'https://at-rest.example.local/v1'
const MASK = '********'
const ENVELOPE = 'wave:enc:v1:'

// ---------------------------------------------------------------------------
// Raw store inspection
// ---------------------------------------------------------------------------

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** Every store file whose raw bytes contain the needle. */
function sweepStore(needle: string): string[] {
  return listFiles(STORAGE_BASE_PATH).filter((file) =>
    fs.readFileSync(file).includes(needle),
  )
}

function dirBytes(dir: string): Buffer {
  return Buffer.concat(listFiles(dir).map((file) => fs.readFileSync(file)))
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function getEnvironmentId(page: Page): Promise<string> {
  const resp = await page.request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  expect(env, `environment "${E2E_ENV_NAME}" must exist`).toBeTruthy()
  return env.id as string
}

async function createProfile(page: Page, environmentId: string): Promise<string> {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'profile-http.json'), 'utf-8'),
  ) as Record<string, any>
  profile.name = `${profile.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  profile.environment_values = { [environmentId]: profile.config }
  const resp = await page.request.post(`${BACKEND_URL}/profiles`, { data: profile })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return (body.data?.id || body.id) as string
}

function loadFixture(profileId: string): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
    .replace(/__PROFILE_ID__/g, profileId)
    .replace(/__PROFILE_NAME__/g, 'Secrets At Rest Profile')
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-SECRETS-AT-REST-FUNCTIONAL', () => {
  test('canaries sealed at rest, run computes on real values, nothing leaks', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importValidateAndNavigate(page, loadFixture(profileId))

    await test.step('Criterion 2: definitions sealed on disk, canaries nowhere in the store', async () => {
      const testBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_tests', testId))
      expect(testBytes.includes(ENVELOPE), 'test definition must carry an envelope').toBeTruthy()
      expect(testBytes.includes(CANARY_A), 'canary A must not sit in the definition').toBeFalsy()
      expect(
        testBytes.includes(PLAIN_MARKER),
        'non-secret sibling variable must stay cleartext',
      ).toBeTruthy()

      const profileBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_profiles', profileId))
      expect(profileBytes.length, 'profile file must exist').toBeGreaterThan(0)
      expect(profileBytes.includes(ENVELOPE), 'profile credential must carry an envelope').toBeTruthy()
      expect(profileBytes.includes(CANARY_B), 'canary B must not sit in the profile').toBeFalsy()
      expect(
        profileBytes.includes(PROFILE_BASE_URL),
        'non-secret profile field must stay cleartext',
      ).toBeTruthy()

      expect(sweepStore(CANARY_A), 'canary A found in the store').toEqual([])
      expect(sweepStore(CANARY_B), 'canary B found in the store').toEqual([])
    })

    // The backend session exists only once the run starts and there is no
    // event replay for late subscribers - the fixture's leading Delay node
    // holds the run while we grab the session id and subscribe.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('Criterion 3: run passes, computed on the real unsealed values', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')

      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      // Slice-transforms only match if the run held the REAL bytes: an
      // envelope or the mask placeholder would slice to different text.
      expect(
        logTexts.some((t) => t === 'a-proof=alpha-real-bytes'),
        `Expected the secret-variable slice proof. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === 'b-proof=bravo-real-bytes'),
        `Expected the profile-credential slice proof. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        logTexts.some((t) => t === `plain=${PLAIN_MARKER}`),
        `Expected the plain sibling logged raw. Got:\n${all}`,
      ).toBeTruthy()
    })

    let logTexts: string[] = []
    await test.step('Criterion 4: console masked - direct print collapses, no canary in any line', async () => {
      logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === MASK),
        `Expected the direct secret log line to render as bare ${MASK}. Got:\n${all}`,
      ).toBeTruthy()
      expect(all).not.toContain(CANARY_A)
      expect(all).not.toContain(CANARY_B)
    })

    await test.step('Criterion 4: WS payload sweep', async () => {
      const events = await collector.harvest()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      for (const evt of events) {
        const json = JSON.stringify(evt)
        expect(json, `WS payload leaked canary A: ${json}`).not.toContain(CANARY_A)
        expect(json, `WS payload leaked canary B: ${json}`).not.toContain(CANARY_B)
      }
      await collector.close()
    })

    await test.step('Criterion 4: session variables masked; profile alias entries absent', async () => {
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.canary_a.value).toBe(MASK)
      expect(variables.plain_marker.value).toBe(PLAIN_MARKER)
      const json = JSON.stringify(variables)
      expect(json).not.toContain(CANARY_A)
      expect(json).not.toContain(CANARY_B)
      expect(json, 'engine-injected profile aliases must not surface').not.toContain('creds.')
    })

    await test.step('Criterion 4: report content masked', async () => {
      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)
      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()
      expect(report).toContain('a-proof=alpha-real-bytes')
      expect(report).not.toContain(CANARY_A)
      expect(report).not.toContain(CANARY_B)
    })

    await test.step('Criterion 5: post-run store sweep still clean', async () => {
      expect(sweepStore(CANARY_A), 'canary A persisted by the run').toEqual([])
      expect(sweepStore(CANARY_B), 'canary B persisted by the run').toEqual([])
    })
  })

  test('tracked execution persists no profile-alias credentials', async ({ page }) => {
    // Profile-injected alias entries (creds.auth_key, real
    // bytes) are never persisted cleartext to api_executions/<id>/variables.yaml
    // + snapshots nor served raw by GET /executions/{id}/variables.
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importFixtureTest(page, loadFixture(profileId))

    const startResp = await page.request.post(`${BACKEND_URL}/executions`, {
      data: { type: 'test', id: testId, environment_id: environmentId },
    })
    expect(startResp.ok(), `POST /executions failed: ${await startResp.text()}`).toBeTruthy()
    const executionId = ((await startResp.json()).data ?? {}).id as string
    expect(executionId).toBeTruthy()

    await expect
      .poll(
        async () => {
          const resp = await page.request.get(`${BACKEND_URL}/executions/${executionId}`)
          return (((await resp.json()).data ?? {}) as { status?: string }).status
        },
        { timeout: 120_000, intervals: [1000] },
      )
      .toBe('passed')

    const varsResp = await page.request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
    expect(varsResp.ok()).toBeTruthy()
    const varsJson = JSON.stringify(await varsResp.json())
    expect(varsJson, 'execution variables leaked canary B').not.toContain(CANARY_B)
    expect(varsJson, 'execution variables leaked canary A').not.toContain(CANARY_A)
    expect(varsJson, 'engine-injected aliases must not persist').not.toContain('creds.')

    // The persisted snapshot embeds node configs, so the EXPRESSION text
    // "creds.auth_key[18:]" legitimately appears - only the credential VALUE
    // must be absent from the execution record.
    const execBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_executions', executionId))
    expect(execBytes.length, 'execution record must exist on disk').toBeGreaterThan(0)
    expect(execBytes.includes(CANARY_B), 'execution record leaked canary B').toBeFalsy()
    expect(execBytes.includes(CANARY_A), 'execution record leaked canary A').toBeFalsy()

    expect(sweepStore(CANARY_A), 'canary A persisted by the tracked run').toEqual([])
    expect(sweepStore(CANARY_B), 'canary B persisted by the tracked run').toEqual([])
  })
})
