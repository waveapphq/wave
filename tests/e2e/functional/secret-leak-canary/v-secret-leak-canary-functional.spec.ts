/**
 * V-SECRET-LEAK-CANARY-FUNCTIONAL: the leak-proof truth-gate.
 *
 * REQ: REQ-4.5.1 (credential encryption + masking end-to-end).
 *
 * The definitive holistic sweep: one family of unique canaries (`cnr6-`) is
 * planted in every storable secret carrier - a secret test variable, a profile
 * credential, a Variable Setter secret literal and a secret Global Variable -
 * plus two runtime-only carriers an HTTP block marks secret: its response body
 * (plain content) and a custom response header (X-Custom-Session, outside the
 * plugin's credential catalog). Both prove the engine's common secret-aware I/O
 * logging (REQ-3.1.3.5): user-marking alone, not a per-plugin catalog, masks
 * them in the DEBUG Inputs/Outputs lines and registers them run-wide. Everything
 * is driven through a run that deliberately touches every leak-prone surface.
 * The canary must appear NOWHERE in cleartext across on-disk storage, run logs
 * (INFO console AND the DEBUG harness I/O lines), error messages, the WS stream,
 * the step-debugger paused state, the generated report and every export flow in
 * its safe (mask / encrypted) mode.
 *
 * This is the truth-gate the "secrets masked" claim rests on. The per-batch
 * canaries (secrets-at-rest, secret-new-carriers, secret-field-masking,
 * export-secrets) each prove one mechanism; this proves the whole invariant and
 * covers the surfaces they never reach - the error path and cross-export wiring.
 *
 * Positive controls keep every absence assertion honest: the slice-proof lines
 * (`v-proof=`, `c-proof=`, `s-proof=`) print the real trailing bytes (an
 * envelope or the mask placeholder would slice to different text), the plain
 * sibling logs raw, and the error line carries the genuine `invalid literal for
 * int()` text next to the `********` placeholder - so the sweep is provably live.
 *
 * Surfaces: logs (INFO + DEBUG harness I/O), errors, WS, step-debugger,
 * report, every export.
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
import {
  expectNoSecret as sweepForSecret,
  sweepStore,
  dirBytes,
  SECRET_MASK,
  SECRET_ENVELOPE,
} from '../../helpers/secret-canary'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Planted canaries (must match fixture.json / fixture-error.json / profile).
// Distinct per carrier so a leak names its carrier; all share the `cnr6-`
// family so a single family-prefix sweep is a backstop. The `-` in the family
// token can never appear in a base64 envelope body, so `wave:enc:v1:` ciphertext
// never false-positives the family check.
// ---------------------------------------------------------------------------
const CANARY_VAR = 'cnr6-var-a1b2c3d4-alpha-real-bytes'
const CANARY_CRED = 'cnr6-cred-a1b2c3-bravo-real-bytes'
const CANARY_SET = 'cnr6-set-a1b2c3d4-gamma-real-bytes'
const CANARY_GV = 'cnr6-gv-a1b2c3d4-delta-real-bytes'
// Runtime-only HTTP response carriers - must equal http-echo's server-side
// defaults for GET /secret-payload (never ride the request URL, same as /cookie).
const CANARY_HTTP_BODY = 'cnr6-body-a1b2c3d4-epsilon-real-bytes'
const CANARY_HTTP_HDR = 'cnr6-hdr-a1b2c3d4-zeta-real-bytes'
const PLAIN_MARKER = 'plain-sibling-e5b7a0-cleartext'
const FAMILY = 'cnr6-'
const MASK = SECRET_MASK
const ENVELOPE = SECRET_ENVELOPE
const PROFILE_BASE_URL = 'https://leak-canary.example.local/v1'

// Secrets exercised by the main run fixture (var + credential + setter literal
// + the HTTP block's marked response body and custom header).
const RUN_SECRETS = [CANARY_VAR, CANARY_CRED, CANARY_SET, CANARY_HTTP_BODY, CANARY_HTTP_HDR]
// Every planted secret, across all carriers.
const ALL_SECRETS = [CANARY_VAR, CANARY_CRED, CANARY_SET, CANARY_GV, CANARY_HTTP_BODY, CANARY_HTTP_HDR]

/** Assert none of the given secrets (nor the `cnr6-` family) sits in `haystack`.
 *  Binds the family sweep + default carrier list on the shared canary helper. */
function expectNoSecret(
  haystack: string,
  where: string,
  needles: string[] = ALL_SECRETS,
): void {
  sweepForSecret(haystack, where, needles, FAMILY)
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
  expect(
    resp.ok(),
    `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return (body.data?.id || body.id) as string
}

function loadFixture(
  file: string,
  profileId = '',
): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, file), 'utf-8')
    .replace(/__PROFILE_ID__/g, profileId)
    .replace(/__PROFILE_NAME__/g, 'Secret Leak Canary Profile')
  return JSON.parse(raw) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Debug-step interactions (inline; mirror tests/e2e/functional/debug-step).
// ---------------------------------------------------------------------------

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-SECRET-LEAK-CANARY-FUNCTIONAL', () => {
  test('secrets sealed at rest, run computes on real values, nothing leaks in logs/WS/report/session', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importValidateAndNavigate(
      page,
      loadFixture('fixture.json', profileId),
      { injectHttp: true },
    )

    await test.step('sealed on disk: envelopes present, canaries nowhere, plain sibling cleartext', async () => {
      const testBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_tests', testId))
      expect(testBytes.includes(ENVELOPE), 'test definition must carry an envelope').toBeTruthy()
      expect(
        testBytes.includes(PLAIN_MARKER),
        'non-secret sibling variable must stay cleartext',
      ).toBeTruthy()
      for (const needle of [CANARY_VAR, CANARY_SET]) {
        expect(testBytes.includes(needle), `canary ${needle} must not sit in the definition`).toBeFalsy()
      }

      const profileBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_profiles', profileId))
      expect(profileBytes.includes(ENVELOPE), 'profile credential must carry an envelope').toBeTruthy()
      expect(profileBytes.includes(CANARY_CRED), 'canary cred must not sit in the profile').toBeFalsy()
      expect(
        profileBytes.includes(PROFILE_BASE_URL),
        'non-secret profile field must stay cleartext',
      ).toBeTruthy()

      for (const needle of RUN_SECRETS) {
        expect(sweepStore(needle), `canary ${needle} found in the store`).toEqual([])
      }
    })

    // The session exists only once the run starts and there is no event replay
    // for late subscribers - the leading Delay node holds the run while we grab
    // the session id and subscribe.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('run passes, computed on the real unsealed bytes', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')

      const logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      // Slice-proofs only match if the run held the REAL bytes.
      expect(logTexts.some((t) => t === 'v-proof=alpha-real-bytes'), `secret-var slice proof missing. Got:\n${all}`).toBeTruthy()
      expect(logTexts.some((t) => t === 'c-proof=bravo-real-bytes'), `credential slice proof missing. Got:\n${all}`).toBeTruthy()
      expect(logTexts.some((t) => t === 's-proof=gamma-real-bytes'), `setter-literal slice proof missing. Got:\n${all}`).toBeTruthy()
      expect(logTexts.some((t) => t === `plain=${PLAIN_MARKER}`), `plain sibling missing. Got:\n${all}`).toBeTruthy()
    })

    await test.step('console masked: direct print collapses, no canary in any log line', async () => {
      const logTexts = await getLogTexts(page)
      expect(
        logTexts.some((t) => t === MASK),
        `direct secret log must render as bare ${MASK}. Got:\n${logTexts.join('\n')}`,
      ).toBeTruthy()
      // Profile credentials must register with the run scrub registry.
      expect(
        logTexts.some((t) => t === `cred-direct=${MASK}`),
        `full credential echo must render as cred-direct=${MASK}. Got:\n${logTexts.join('\n')}`,
      ).toBeTruthy()
      expectNoSecret(logTexts.join('\n'), 'console log', RUN_SECRETS)
    })

    await test.step('WS payload sweep', async () => {
      const events = await collector.harvest()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      expectNoSecret(JSON.stringify(events), 'WS stream', RUN_SECRETS)
    })

    await test.step('HTTP block: engine masks body+headers in the DEBUG Outputs line, status_code stays visible', async () => {
      // The console DOM defaults to INFO, but the raw log:<sid> WS topic carries
      // every level, so the collector's events include the DEBUG harness I/O
      // lines. Assert on them directly.
      const messages = ((await collector.harvest()) as Array<{ message?: unknown }>)
        .map((event) => event.message)
        .filter((message): message is string => typeof message === 'string')
      await collector.close()

      const httpOutputs = messages.find(
        (message) =>
          message.startsWith('Outputs:') &&
          message.includes(`"body":"${MASK}"`) &&
          message.includes(`"headers":"${MASK}"`),
      )
      expect(
        httpOutputs,
        `a masked Outputs line for the HTTP block must broadcast at DEBUG. Got:\n${messages.join('\n')}`,
      ).toBeTruthy()
      // Positive control: the block genuinely ran and surfaced a non-secret output.
      expect(
        httpOutputs!,
        'the non-secret status_code stays visible in the Outputs line',
      ).toContain('"status_code":200')
      expectNoSecret(httpOutputs!, 'HTTP Outputs line', [CANARY_HTTP_BODY, CANARY_HTTP_HDR])
    })

    await test.step('session variables masked; no injected credential aliases', async () => {
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.canary_var.value).toBe(MASK)
      expect(variables.plain_marker.value).toBe(PLAIN_MARKER)
      // The HTTP block's marked outputs mask; its non-secret status_code stays
      // visible - keeping the absence sweep honest.
      expect(variables.http_body.value, 'the marked HTTP body output must be masked').toBe(MASK)
      expect(variables.http_headers.value, 'the marked HTTP headers output must be masked').toBe(MASK)
      expect(
        String(variables.http_status.value),
        'the non-secret status_code stays visible',
      ).toBe('200')
      const json = JSON.stringify(variables)
      expectNoSecret(json, 'session variables', RUN_SECRETS)
      expect(json, 'engine-injected profile aliases must not surface').not.toContain('creds.')
    })

    await test.step('report content masked but computed on real bytes', async () => {
      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)
      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()
      expect(report).toContain('v-proof=alpha-real-bytes')
      expectNoSecret(report, 'report', RUN_SECRETS)
    })

    await test.step('post-run store sweep still clean', async () => {
      for (const needle of RUN_SECRETS) {
        expect(sweepStore(needle), `canary ${needle} persisted by the run`).toEqual([])
      }
    })
  })

  test('a secret-bearing node error is masked on every error surface', async ({ page }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    await importValidateAndNavigate(page, loadFixture('fixture-error.json'))

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    // The failing node embeds the secret in a real ValueError; the try/catch
    // catches it and the run reaches a terminal state. The masking assertions
    // below hold regardless of the final pass/fail verdict - the catch branch
    // (and thus the error surfaces) runs either way.
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(status).not.toHaveAttribute('data-status', 'idle')

    await test.step('the error genuinely fired and is masked on every error surface', async () => {
      const logTexts = await getLogTexts(page)
      const events = await collector.harvest()
      const variables = await getSessionVariables(page, sessionId)
      await collector.close()

      const all = logTexts.join('\n')
      const eventsJson = JSON.stringify(events)
      const varsJson = JSON.stringify(variables)

      // Positive controls - the genuine ValueError really fired and surfaced on
      // each channel (an empty/absent error would pass the sweeps vacuously):
      //   - the block-failure console line + the try-path caught line,
      //   - the same two broadcast as WS ERROR/WARN events,
      //   - the caught error bound into the tc_error map (message + stack trace).
      expect(all, `console must carry the failure line. Got:\n${all}`).toContain(
        'invalid literal for int()',
      )
      expect(eventsJson, 'WS must broadcast the failure').toContain('invalid literal for int()')
      expect(varsJson, 'the caught error must be bound to tc_error').toContain(
        'invalid literal for int()',
      )
      expect(variables.tc_caught.value, 'the error must have been caught').toBe(true)
      // ...and the secret bytes inside every one of them collapsed to the placeholder.
      expect(all, 'the masked placeholder must appear where the secret was').toContain(MASK)

      // The canary must appear nowhere: not the console, not a WS event, and not
      // the tc_error map - including its embedded Python stack trace, the deepest
      // place a raw secret could hide.
      expectNoSecret(all, 'error console', [CANARY_VAR])
      expectNoSecret(eventsJson, 'WS error stream', [CANARY_VAR])
      expectNoSecret(varsJson, 'error session variables (incl. tc_error stack trace)', [CANARY_VAR])
    })
  })

  test('the step-debugger paused state masks secrets', async ({ page }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    await importValidateAndNavigate(page, loadFixture('fixture.json', profileId), { injectHttp: true })

    await toggleBreakpoint(page, 'log-var-proof')
    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()

    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('paused at the breakpoint with the secret in scope, masked', async () => {
      await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
      await expect(
        page.locator('[data-testid="workflow-node-log-var-proof"]'),
      ).toHaveAttribute('data-paused', 'true')

      const variables = await getSessionVariables(page, sessionId)
      expect(variables.canary_var.value, 'the paused secret variable must be masked').toBe(MASK)
      expectNoSecret(JSON.stringify(variables), 'paused session variables', RUN_SECRETS)

      const events = await collector.harvest()
      expectNoSecret(JSON.stringify(events), 'debug WS stream', RUN_SECRETS)
    })

    await test.step('resume runs to completion, still no leak', async () => {
      await page.locator('[data-testid="action-continue-button"]').click()
      await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 60_000 })

      const events = await collector.harvest()
      expectNoSecret(JSON.stringify(events), 'post-resume WS stream', RUN_SECRETS)
      const logTexts = await getLogTexts(page)
      expectNoSecret(logTexts.join('\n'), 'post-resume console', RUN_SECRETS)
      await collector.close()

      for (const needle of RUN_SECRETS) {
        expect(sweepStore(needle), `canary ${needle} persisted by the debug run`).toEqual([])
      }
    })
  })

  test('every export keeps secrets sealed or masked, never cleartext', async ({ page }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importFixtureTest(page, loadFixture('fixture.json', profileId), { injectHttp: true })

    // Seed a secret Global (system) variable for the GV + backup export sweeps.
    await page.request.delete(`${BACKEND_URL}/variables/system`)
    const gvResp = await page.request.post(`${BACKEND_URL}/variables/system`, {
      data: {
        variables: {
          gv_secret: { type: 'string', value: CANARY_GV, secret: true },
          gv_plain: { type: 'string', value: 'gv-plain-visible' },
        },
      },
    })
    expect(gvResp.ok(), `POST /variables/system failed: ${gvResp.status()}`).toBeTruthy()

    try {
      await test.step('test export: secret var + setter literal sealed/masked in mask + encrypted', async () => {
        for (const mode of ['mask', 'encrypted'] as const) {
          const resp = await page.request.post(`${BACKEND_URL}/tests/export`, {
            data: { test_ids: [testId], format: 'json', secrets: mode },
          })
          expect(resp.ok(), `test export (${mode}) failed: ${resp.status()}`).toBeTruthy()
          const text = await resp.text()
          expect(text, `test export (${mode}) must carry the safe form`).toContain(
            mode === 'mask' ? MASK : ENVELOPE,
          )
          expectNoSecret(text, `test export (${mode})`, [CANARY_VAR, CANARY_SET])
        }
      })

      await test.step('test export: workflow-embedded setter secret obeys every mode', async () => {
        // The export secrets mode must reach the setter
        // literal embedded in the workflow, not just top-level variables. Mask
        // must ship the placeholder (not recoverable ciphertext); plaintext must
        // unseal; encrypted keeps the envelope.
        const setterValue = async (mode: 'mask' | 'encrypted' | 'plaintext') => {
          const resp = await page.request.post(`${BACKEND_URL}/tests/export`, {
            data: { test_ids: [testId], format: 'json', secrets: mode },
          })
          expect(resp.ok(), `test export (${mode}) failed: ${resp.status()}`).toBeTruthy()
          const doc = JSON.parse(await resp.text())
          const test = Array.isArray(doc) ? doc[0] : (doc.tests?.[0] ?? doc)
          const node = test.workflow.nodes.find(
            (n: { id: string }) => n.id === 'setter-secret',
          )
          return node.data.config.values.variables.setter_secret as string
        }

        expect(await setterValue('mask'), 'mask mode must strip the setter secret').toBe(MASK)
        expect(
          await setterValue('encrypted'),
          'encrypted mode keeps the setter envelope',
        ).toContain(ENVELOPE)
        expect(
          await setterValue('plaintext'),
          'plaintext mode unseals the setter secret',
        ).toBe(CANARY_SET)
      })

      await test.step('profile export: credential sealed/masked in mask + encrypted', async () => {
        for (const mode of ['mask', 'encrypted'] as const) {
          const resp = await page.request.get(
            `${BACKEND_URL}/profiles/${profileId}/export?format=json&secrets=${mode}`,
          )
          expect(resp.ok(), `profile export (${mode}) failed: ${resp.status()}`).toBeTruthy()
          const text = await resp.text()
          expect(text).toContain(mode === 'mask' ? MASK : ENVELOPE)
          expect(text, 'non-secret profile field stays cleartext').toContain(PROFILE_BASE_URL)
          expectNoSecret(text, `profile export (${mode})`, [CANARY_CRED])
        }
      })

      await test.step('global-variable export: secret GV sealed/masked in mask + encrypted', async () => {
        for (const mode of ['mask', 'encrypted'] as const) {
          const resp = await page.request.get(
            `${BACKEND_URL}/variables/system/export?format=json&secrets=${mode}`,
          )
          expect(resp.ok(), `GV export (${mode}) failed: ${resp.status()}`).toBeTruthy()
          const text = await resp.text()
          expect(text).toContain(mode === 'mask' ? MASK : ENVELOPE)
          expect(text, 'non-secret GV stays cleartext').toContain('gv-plain-visible')
          expectNoSecret(text, `GV export (${mode})`, [CANARY_GV])
        }
      })

      await test.step('backup archive: every carrier sealed/masked in mask + encrypted', async () => {
        for (const mode of ['mask', 'encrypted'] as const) {
          const resp = await page.request.post(`${BACKEND_URL}/api/backup/create`, {
            data: {
              entity_types: ['tests', 'profiles', 'system_variables'],
              format: 'json',
              compression_method: 'stored', // uncompressed: raw bytes are searchable
              secrets: mode,
            },
          })
          expect(resp.ok(), `backup (${mode}) failed: ${resp.status()}`).toBeTruthy()
          const zip = Buffer.from(await resp.body())
          for (const needle of ALL_SECRETS) {
            expect(
              zip.includes(needle),
              `backup archive (${mode}) leaked secret ${needle}`,
            ).toBeFalsy()
          }
          expect(zip.includes(FAMILY), `backup archive (${mode}) leaked a ${FAMILY} secret`).toBeFalsy()
        }
      })
    } finally {
      await page.request.delete(`${BACKEND_URL}/variables/system`)
      await page.request.delete(`${BACKEND_URL}/profiles/${profileId}`)
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
    }
  })

  test('a tracked execution persists no secret in cleartext', async ({ page }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importFixtureTest(page, loadFixture('fixture.json', profileId), { injectHttp: true })

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
    expectNoSecret(varsJson, 'execution variables', RUN_SECRETS)
    expect(varsJson, 'engine-injected aliases must not persist').not.toContain('creds.')

    const execBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_executions', executionId))
    expect(execBytes.length, 'execution record must exist on disk').toBeGreaterThan(0)
    for (const needle of RUN_SECRETS) {
      expect(execBytes.includes(needle), `execution record leaked ${needle}`).toBeFalsy()
      expect(sweepStore(needle), `canary ${needle} persisted by the tracked run`).toEqual([])
    }
  })

  test('a tracked execution persists masked on disk even under run-output reveal', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(page.request)
    const environmentId = await getEnvironmentId(page)
    const profileId = await createProfile(page, environmentId)
    const testId = await importFixtureTest(page, loadFixture('fixture.json', profileId), { injectHttp: true })

    // Reveal is a live-display concern; the persisted execution record - logs,
    // snapshot, and end-of-run variables - is a masked surface, so a temporary
    // reveal must never bake plaintext into any of those files.
    const revealResp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
      data: { run_output: true },
    })
    expect(revealResp.ok(), `enabling run_output failed: ${revealResp.status()}`).toBeTruthy()

    try {
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

      // The ENTIRE persisted execution record the export ships - persisted logs
      // included - stays masked even though the reveal was on during the run.
      const execBytes = dirBytes(path.join(STORAGE_BASE_PATH, 'api_executions', executionId))
      expect(execBytes.length, 'execution record must exist on disk').toBeGreaterThan(0)
      for (const needle of RUN_SECRETS) {
        expect(
          execBytes.includes(needle),
          `execution record leaked ${needle} under run-output reveal`,
        ).toBeFalsy()
        expect(sweepStore(needle), `canary ${needle} persisted under reveal`).toEqual([])
      }
      // The REST variables view is served exactly as masked on write.
      const varsResp = await page.request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
      const varsJson = JSON.stringify(await varsResp.json())
      expectNoSecret(varsJson, 'execution variables under reveal', RUN_SECRETS)
    } finally {
      // Never leak a revealed flag to another spec sharing this backend process.
      await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
        data: { run_output: false },
      })
      await page.request.delete(`${BACKEND_URL}/profiles/${profileId}`)
      await page.request.delete(`${BACKEND_URL}/tests/${testId}`)
    }
  })
})
