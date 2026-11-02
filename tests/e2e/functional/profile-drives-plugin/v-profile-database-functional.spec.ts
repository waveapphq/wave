/**
 * V-PROFILE-DATABASE-FUNCTIONAL: a Database Profile drives a real SQL run.
 * Wireframe: N/A
 * Design Decisions: K8SPROF-9 (a profile must be proven to drive a plugin), SQL-14 (the
 *   database profile's ten fields), SQL-8 (the connection and TLS rows they feed)
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-3.4.1.6, REQ-5.1.4
 *
 * The profile's own ten fields - host, port, database, username, password, verify_ssl,
 * ca_cert, client_cert, client_key and driver_options - are the only source of the
 * connection. Only the choices the profile never carries (Operation, Database type and the
 * TLS toggle) and the SQL are typed into the Block. The run goes to the stack's real
 * PostgreSQL, which offers TLS on a leaf signed by the WAVE Test CA and verifies a client
 * certificate when one is sent, and the SQL asks the server what it saw of the session.
 *
 *   profile leg -> every field bound: the server reports the profile's user and database,
 *     a TLS session carrying the profile's client certificate, and the profile's
 *     application_name driver option.
 *   no-CA leg -> the same profile with its CA left unbound: the certificate check the
 *     profile's verify_ssl keeps on refuses the server, which is what makes the profile
 *     leg's CA the trust anchor that let it through.
 *
 * Pass Criteria:
 * 1. The profile is created with its ten fields; its API reads mask password and client_key.
 * 2. The fixture validates with zero errors and the run passes.
 * 3. The profile SQL Block reports success and logs `Connected to PostgreSQL {version} at
 *    {host}:{port}` with the profile's host and port.
 * 4. The server saw the profile's username and database, in one row.
 * 5. The session is TLS and the client certificate the server verified is the profile's own
 *    (pg_stat_ssl.client_dn names wave-e2e-client).
 * 6. The profile's application_name driver option reads back from the server.
 * 7. The DEBUG Inputs echo shows the profile's host, port, database, username, verify_ssl,
 *    CA, client certificate and driver options arriving at the Block, with password and
 *    client_key masked.
 * 8. Without the CA the Block records Unreachable with the certificate-verify failure,
 *    paints the warning state and the run continues.
 * 9. Neither the password nor the client key appears in cleartext on the console, the
 *    session variables, the workbench session, the session report or the profile and Test
 *    API reads.
 * 10. A tracked run of the same Test passes, and its execution record, log, variables,
 *     export and report carry neither secret.
 * 11. Nothing outlives the run: the tracked execution, the Test and the profile are gone.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-drives-plugin/v-profile-database-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts, setConsoleMinimumLevel } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  expectNodeStatus,
  expectNodesSuccess,
  fetchExecutionReport,
  fetchSessionReport,
  finishRun,
  resolveEnvironmentId,
  runTrackedTest,
  startRun,
} from '../../helpers/k8s-run'
import { DATABASE_PROFILE_FIELDS } from '../../helpers/profiles'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const PROFILE_BLOCK = '6aea51e3-9ddd-47cd-9d81-0a59173b6217'
const NO_CA_BLOCK = 'dd5fe5e4-97de-4645-bc5b-ceb3128e6701'
const LOG_BLOCKS = [
  'eca1cbc6-b55d-4825-8cd7-4db56e447b57',
  '405d5262-489c-4bb4-bac1-303513179807',
  '263c1b2c-9307-4d20-9ba7-2c27ba951fa2',
]

/** The driver option the profile declares; the server reports it back as application_name. */
const APPLICATION_NAME = 'wave-e2e-profile-db'

/** The CN of the committed TEST-ONLY tls-lab client identity the profile carries. */
const CLIENT_CN = 'wave-e2e-client'

/** The client key's first two base64 body lines: no masked or sealed form can contain them. */
const CLIENT_KEY_BODY = TLS_LAB_CLIENT_KEY_PEM.split('\n')
  .filter((line) => line.trim() !== '' && !line.startsWith('-----'))
  .slice(0, 2)
const SECRETS = [SQL_STACK_PASSWORD, ...CLIENT_KEY_BODY]

/** The profile JSON with its empty host, port, credentials and PEMs filled from config. */
function loadProfile(): Record<string, any> {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'profile-database.json'), 'utf-8'),
  ) as Record<string, any>
  profile.config.host = SQL_TARGET_HOST
  profile.config.port = Number(POSTGRES_PORT)
  profile.config.database = SQL_STACK_DATABASE
  profile.config.username = SQL_STACK_USER
  profile.config.password = SQL_STACK_PASSWORD
  profile.config.ca_cert = CA_CERT_PEM
  profile.config.client_cert = TLS_LAB_CLIENT_CERT_PEM
  profile.config.client_key = TLS_LAB_CLIENT_KEY_PEM
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
    .readFileSync(path.resolve(__dirname, 'fixture-database.json'), 'utf-8')
    .replace(/__DB_PROFILE_ID__/g, profileId)
    .replace(/__DB_PROFILE_NAME__/g, profileName)
  return JSON.parse(raw) as Record<string, unknown>
}

/** The body of a GET as text, asserting it answered. */
async function readText(page: Page, url: string): Promise<string> {
  const resp = await page.request.get(url)
  expect(resp.ok(), `GET ${url} failed: ${resp.status()}`).toBeTruthy()
  return resp.text()
}

/** Delete what the run made; the Test goes first, since a referenced profile will not delete. */
async function cleanUp(
  page: Page,
  executionId: string,
  testId: string,
  profileIds: string[],
): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  if (executionId) {
    await page.request.delete(`${BACKEND_URL}/executions/${executionId}`).catch(() => {})
  }
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

/** Positive control: the search finds a profile that exists, so the gone check cannot pass vacuously. */
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

test.describe('V-PROFILE-DATABASE-FUNCTIONAL', () => {
  test('a database profile drives a real PostgreSQL run over verified TLS', async ({ page }) => {
    test.setTimeout(240_000)
    const environmentId = await resolveEnvironmentId(page.request)
    const profile = await createProfile(page, environmentId)
    await expectProfileListed(page, profile.name)
    let testId = ''
    let executionId = ''

    try {
      await test.step('the profile holds its ten fields and its API read masks the secrets', async () => {
        const text = await readText(page, `${BACKEND_URL}/profiles/${profile.id}`)
        const body = JSON.parse(text)
        const stored = (body.data ?? body) as {
          type: string
          environment_values: Record<string, Record<string, unknown>>
        }
        expect(stored.type).toBe('database')
        const config = stored.environment_values[environmentId]
        expect(Object.keys(config).sort()).toEqual([...DATABASE_PROFILE_FIELDS].sort())
        expect(config.password).toBe(SECRET_MASK)
        expect(config.client_key).toBe(SECRET_MASK)
        expectNoSecret(text, 'GET /profiles/{id}', SECRETS)
      })

      testId = await importValidateAndNavigate(page, loadFixture(profile.id, profile.name))
      await setConsoleMinimumLevel(page, 'DEBUG')

      const status = await startRun(page)
      const sessionId = await getActiveSessionId(page)
      const logs = await finishRun(page, status, 'profile-db-e2e-done')
      const all = logs.join('\n')
      const line = (marker: string) => logs.find((t) => t.includes(marker)) ?? ''
      const copy = await getLogCopyTexts(page)

      await test.step('the profile-driven Block connected to the profile host and port', async () => {
        await expectNodesSuccess(page, [PROFILE_BLOCK, ...LOG_BLOCKS])
        expect(
          logs.some((t) =>
            new RegExp(
              `^Connected to PostgreSQL \\S+.* at ${SQL_TARGET_HOST.replace(/\./g, '\\.')}:${POSTGRES_PORT}$`,
            ).test(t),
          ),
          all,
        ).toBeTruthy()
      })

      await test.step("the server saw the profile's user and database", () => {
        expect(line('dbprof ok='), all).toContain('ok=True count=1')
        expect(line('dbprof ok='), all).toContain(`who=${SQL_STACK_USER} db=${SQL_STACK_DATABASE}`)
      })

      await test.step("the session is TLS and carries the profile's client certificate", () => {
        expect(line('dbprof ok='), all).toContain('tls=True')
        expect(line('dbprof ok='), all).toMatch(new RegExp(`dn=\\[[^\\]]*CN=${CLIENT_CN}[^\\]]*\\]`))
      })

      await test.step("the profile's driver option reaches the server", () => {
        expect(line('dbprof ok='), all).toContain(`app=${APPLICATION_NAME}`)
      })

      await test.step('the Inputs echo shows every profile field arriving, secrets masked', () => {
        const inputs = copy.find(
          (t) => t.includes('Inputs:') && t.includes('SELECT current_user AS who'),
        )
        expect(inputs, `no Inputs echo for the profile Block.\n${copy.join('\n@@\n')}`).toBeTruthy()
        for (const expected of [
          `"host":"${SQL_TARGET_HOST}"`,
          `"port":${POSTGRES_PORT},`,
          `"database":"${SQL_STACK_DATABASE}"`,
          `"username":"${SQL_STACK_USER}"`,
          `"password":"${SECRET_MASK}"`,
          '"verify_ssl":true',
          '"ca_cert":"-----BEGIN CERTIFICATE-----',
          '"client_cert":"-----BEGIN CERTIFICATE-----',
          `"client_key":"${SECRET_MASK}"`,
          `"driver_options":{"application_name":"${APPLICATION_NAME}"}`,
        ]) {
          expect(inputs!, `Inputs echo lacks ${expected}`).toContain(expected)
        }
      })

      await test.step('without the CA the profile certificate check refuses the server', async () => {
        await expectNodeStatus(page, NO_CA_BLOCK, 'warning')
        expect(line('dbprof-noca'), all).toContain('ok=False reason=Unreachable')
        expect(line('dbprof-noca'), all).toContain(
          `error=[Could not connect to PostgreSQL at ${SQL_TARGET_HOST}:${POSTGRES_PORT}: `,
        )
        expect(line('dbprof-noca'), all).toContain('CERTIFICATE_VERIFY_FAILED')
        const variables = await getSessionVariables(page, sessionId)
        expect(variables.id_ok.value).toBe(true)
        expect(variables.id_count.value).toBe(1)
        expect(variables.noca_ok.value).toBe(false)
        expect(variables.noca_reason.value).toBe('Unreachable')
      })

      await test.step('no surface of the workbench run carries a secret', async () => {
        expectNoSecret([...logs, ...copy].join('\n'), 'run console', SECRETS)
        const variables = await getSessionVariables(page, sessionId)
        expectNoSecret(JSON.stringify(variables), 'session variables', SECRETS)
        expectNoSecret(
          await readText(page, `${BACKEND_URL}/workbench/session`),
          'workbench session',
          SECRETS,
        )
        const report = await fetchSessionReport(page)
        expect(report, 'the session report lacks the profile leg').toContain('dbprof ok=True')
        expectNoSecret(report, 'session report', SECRETS)
        expectNoSecret(await readText(page, `${BACKEND_URL}/tests/${testId}`), 'GET /tests/{id}', SECRETS)
        expectNoSecret(
          await readText(page, `${BACKEND_URL}/profiles?search=${encodeURIComponent(profile.name)}`),
          'GET /profiles',
          SECRETS,
        )
      })

      await test.step('a tracked run passes and no part of its record carries a secret', async () => {
        const run = await runTrackedTest(page.request, testId)
        executionId = run.executionId
        expect(run.verdict).toBe('passed')
        const record = await readText(page, `${BACKEND_URL}/executions/${executionId}`)
        const log = await readText(page, `${BACKEND_URL}/executions/${executionId}/logs?limit=1000`)
        expect(log, 'the execution log lacks the profile leg').toContain('dbprof ok=True count=1')
        const logMessages = (JSON.parse(log).data.entries as Array<{ message: string }>)
          .map((entry) => entry.message)
          .join('\n')
        expect(logMessages, 'the execution log lacks the masked Inputs echo').toContain(
          `"client_key":"${SECRET_MASK}"`,
        )
        const variables = await readText(page, `${BACKEND_URL}/executions/${executionId}/variables`)
        const exported = await readText(
          page,
          `${BACKEND_URL}/executions/${executionId}/export?format=json`,
        )
        const report = await fetchExecutionReport(page.request, executionId)
        for (const [where, text] of [
          ['execution record', record],
          ['execution log', log],
          ['execution variables', variables],
          ['execution export', exported],
          ['execution report', report],
        ] as const) {
          expectNoSecret(text, where, SECRETS)
        }
      })
    } finally {
      await cleanUp(page, executionId, testId, [profile.id])
    }

    await expectProfileGone(page, profile.name)
    const testGone = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(testGone.status(), 'the imported Test outlived its run').toBe(404)
    const executionGone = await page.request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(executionGone.status(), 'the tracked execution outlived its run').toBe(404)
  })
})
