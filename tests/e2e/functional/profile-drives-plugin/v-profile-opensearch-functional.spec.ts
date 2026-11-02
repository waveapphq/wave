/**
 * V-PROFILE-OPENSEARCH-FUNCTIONAL: OpenSearch profiles drive real Searches and an Aggregate
 * Wireframe: N/A
 * Design Decisions: OS-15, K8SPROF-7, K8SPROF-9
 * REQ: REQ-4.7.3, REQ-5.1.2
 *
 * The run's own F-LOGS index is read with the fixed window and DQL `log.level: "ERROR"` typed on
 * each block; every connection row a block uses is an expression on its bound profile, none typed.
 * Endpoints, PEMs, secrets and the minted API token are filled into the profiles at load.
 *
 * Pass Criteria:
 * 1. The fixture imports through POST /tests with no repairs and validates with zero findings.
 * 2. BASIC: url, username, password, verify_ssl true and ca_cert from `profile-opensearch.json`: Total 6.
 * 3. TOKEN: url, bearer_token and ca_cert from `profile-opensearch-token.json`: Total 6.
 * 4. APIKEY: url, a minted api_key and verify_ssl false from `profile-opensearch-apikey.json`: Total 6.
 * 5. CERT: url, ca_cert, client_cert and client_key from `profile-opensearch-cert.json`: Total 6.
 * 6. WRONG: `profile-opensearch.json` with a wrong password, Record and continue: Reason AuthFailed,
 *    so the profile's value is the one sent. Together the profiles bind all nine fields.
 * 7. No profile secret reaches the run log, DEBUG included.
 * 8. UI-built: on the Profiles page a new opensearch profile lists exactly the nine fields with no
 *    required marker; with only url (the plain-http gateway), username and password filled for the
 *    environment it saves.
 * 9. UI-built: bound through the Aggregate block's sheet in place of the block's own Cluster URL,
 *    Username and Password, the errors-per-minute run gives counts 2, 0, 4, 0, 0, Total results 6,
 *    every request goes through the gateway prefix and the Assert `max(...col('count')) <= 5` passes.
 * 10. Each Test is deleted first, then its profiles, and no profile outlives the suite.
 * 11. The block's API Key and Bearer Token, saved empty, show empty in the sheet, not masked (VMGR-87).
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  CA_CERT_PEM,
  E2E_ENV_NAME,
  OPENSEARCH_GATEWAY_PORT,
  OPENSEARCH_GATEWAY_PREFIX,
  OPENSEARCH_JWT,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
  OPENSEARCH_USER,
  TLS_LAB_CLIENT_CERT_PEM,
  TLS_LAB_CLIENT_KEY_PEM,
} from '../../helpers/config'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionTable,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { openTest, validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, resolveEnvironmentId, startRun } from '../../helpers/k8s-run'
import { formatEntries, getLogCopyTexts, setConsoleMinimumLevel, type LogEntry } from '../../helpers/log-reader'
import {
  createOpenSearchIndex,
  deleteOpenSearchIndexes,
  F_LOGS,
  MAP_LOGS,
  mintOpenSearchApiToken,
  openSearchIndexName,
  revokeOpenSearchApiToken,
  seedOpenSearch,
  type OpenSearchApiToken,
} from '../../helpers/opensearch-stack'
import {
  openProfileCreateDialog,
  openProfileFieldSheet,
  selectProfileModalEnvironment,
  selectProfileType,
} from '../../helpers/profiles'
import { selectEnvironment } from '../../helpers/workbench'
import { exprToggle, paramRow } from '../../helpers/config-sheet'
import { answerSwitch } from '../../helpers/value-field'
import { expandGroup, persistedNodes, saveConfig, saveWorkbench } from '../file-picker/picker'
import { openSearchNode, openSheetOf, seedTest } from '../../visual/canvas/opensearch-sheet-seed'
import { blockSource, consoleEntriesFromCopy, newToken, withToken } from '../shell-blocks/shell-helpers'

interface FixtureNode {
  id: string
  data: { elementType: string; description: string }
}

interface Fixture {
  workflow: { nodes: FixtureNode[] }
  [key: string]: unknown
}

interface CreatedProfile {
  id: string
  name: string
}

type ProfileConfig = Record<string, unknown>

const OPENSEARCH_FIELDS = [
  'url',
  'username',
  'password',
  'api_key',
  'bearer_token',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
]

const DIRECT_URL = `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`
const GATEWAY_URL = `http://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_GATEWAY_PORT}${OPENSEARCH_GATEWAY_PREFIX}`
const UNAUTHORIZED = 'HTTP 401: Unauthorized'
const BOOKEND = 'os-prof-done'
const UI_BOOKEND = 'os-prof-ui-done'

/** Search cases: the block's Name (also its Description), its variable prefix, and whether it records its failure. */
const CASES = [
  { block: 'Basic profile', key: 'basic', record: false },
  { block: 'Bearer profile', key: 'token', record: false },
  { block: 'API key profile', key: 'apikey', record: false },
  { block: 'Client certificate profile', key: 'cert', record: false },
  { block: 'Wrong password profile', key: 'wrong', record: true },
]

/** The newest of the six ERROR documents, the first Results row of every passing Search. */
const NEWEST_ERROR = F_LOGS.filter((doc) => (doc.log as { level: string }).level === 'ERROR').sort((a, b) =>
  String(b['@timestamp']).localeCompare(String(a['@timestamp'])),
)[0]

const createdTests: string[] = []
const createdProfiles: string[] = []
let token = ''
let apiToken: OpenSearchApiToken | null = null

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as T
}

/** A profile JSON with its blank host-specific and secret fields filled; each blank must be one it declares. */
function loadProfile(file: string, fills: ProfileConfig): Record<string, any> {
  const profile = readJson<Record<string, any>>(file)
  for (const [field, value] of Object.entries(fills)) {
    expect(profile.config[field], `${file} declares ${field} blank`).toBe('')
    profile.config[field] = value
  }
  return profile
}

async function createProfile(
  request: APIRequestContext,
  environmentId: string,
  profile: Record<string, any>,
  label = '',
): Promise<CreatedProfile> {
  const name = `${profile.name}${label} ${token}`
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { ...profile, name, environment_values: { [environmentId]: profile.config } },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const id = String(body.data?.id ?? body.id)
  createdProfiles.push(id)
  return { id, name }
}

async function profileListed(request: APIRequestContext, name: string): Promise<boolean> {
  const resp = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`)
  const body = await resp.json().catch(() => null)
  const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ name?: string }>
  return rows.some((p) => p.name === name)
}

/** The Test goes first: a profile a Test still binds cannot be deleted. */
async function deleteTestThenProfiles(
  request: APIRequestContext,
  testId: string,
  profiles: CreatedProfile[],
): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const testDelete = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect([200, 204], `DELETE /tests/${testId} answered ${testDelete.status()}`).toContain(testDelete.status())
  createdTests.splice(createdTests.indexOf(testId), 1)
  for (const profile of profiles) {
    expect(await profileListed(request, profile.name), `profile "${profile.name}" was listed`).toBe(true)
    const resp = await request.delete(`${BACKEND_URL}/profiles/${profile.id}`)
    expect([200, 204], `DELETE /profiles/${profile.id} answered ${resp.status()}`).toContain(resp.status())
    createdProfiles.splice(createdProfiles.indexOf(profile.id), 1)
    expect(await profileListed(request, profile.name), `profile "${profile.name}" outlived its test`).toBe(false)
  }
}

function blockEntries(entries: readonly LogEntry[], name: string): LogEntry[] {
  const source = blockSource('OpenSearch', name)
  return entries.filter((entry) => entry.source === source)
}

/** The DEBUG request lines a block wrote, cut to method and path, sorted: the harvest does not keep their order. */
function requestLines(entries: readonly LogEntry[], name: string): string[] {
  return blockEntries(entries, name)
    .filter((entry) => entry.level === 'DEBUG' && /^(GET|POST) \//.test(entry.message))
    .map((entry) => entry.message.split(' ').slice(0, 2).join(' '))
    .sort()
}

function expectNoLeak(entries: readonly LogEntry[], needles: Record<string, string>): void {
  const text = entries.map((entry) => `${entry.source} ${entry.message}`).join('\n')
  for (const [what, needle] of Object.entries(needles)) {
    expect(needle.length, `the ${what} needle is not empty`).toBeGreaterThan(8)
    expect(text.includes(needle), `the run log leaked the ${what}`).toBe(false)
  }
}

async function runAndHarvest(
  page: Page,
  bookend: string,
): Promise<{ variables: SessionVariables; entries: LogEntry[] }> {
  await setConsoleMinimumLevel(page, 'DEBUG')
  const status = await startRun(page)
  await finishRun(page, status, bookend, 180_000)
  const variables = await getSessionVariables(page, await getActiveSessionId(page))
  const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
  return { variables, entries }
}

// --- the UI-built case -------------------------------------------------------

const AGG_NODE_ID = '5c2f3a6e-8d41-4b7a-9e0f-2a6b1c7d9e34'
const AGG_ASSERT_ID = 'b8e4d1f2-3c5a-4e6b-8f9d-0a1b2c3d4e5f'
const AGG_LOG_ID = '7a9c2e4f-1b3d-4c5e-a6f8-9b0d1e2f3a4c'
const AGG_DONE_ID = 'e1d2c3b4-a596-4877-8f6e-5d4c3b2a1f0e'

function flowNode(
  id: string,
  label: string,
  elementType: string,
  values: Record<string, unknown>,
  y: number,
): Record<string, unknown> {
  const control = elementType === 'assert'
  return {
    id,
    type: 'workflowNode',
    position: { x: -75, y },
    data: {
      label,
      elementType,
      nodeType: control ? 'control' : 'plugin',
      category: control ? 'flow' : 'system',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: elementType === 'log' ? ['message'] : [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

/** The errors-per-minute Test: Count per minute over the fixed window, its own direct connection rows filled. */
function errorsPerMinuteTest(index: string): Record<string, unknown> {
  const aggregate = openSearchNode(
    AGG_NODE_ID,
    {
      url: DIRECT_URL,
      index,
      from: '2026-09-25T10:00:00Z',
      to: '2026-09-25T10:04:59Z',
      query_language: 'dql',
      query: 'log.level: "ERROR"',
      mode: 'aggregate',
      group_by_time: '1m',
      group_by_field: '',
      stats: [{ value: { stat: 'count' } }],
      top_values: 10,
      timeout: 60,
      username: OPENSEARCH_USER,
      password: OPENSEARCH_PASSWORD,
      api_key: '',
      bearer_token: '',
      verify_ssl: false,
      ca_cert: '',
      client_cert: '',
      client_key: '',
      on_error: 'fail',
    },
    { outputBindings: { success: 'epm_ok', results: 'errors_per_minute', total_results: 'errors_total' } },
  )
  const nodes = [
    aggregate,
    flowNode(
      AGG_ASSERT_ID,
      'Assert',
      'assert',
      {
        assertions: [
          {
            type: 'expression',
            expression: "max(errors_per_minute.col('count')) <= 5",
            id: '3e5f7a9b-2c4d-4e6f-8a0b-1c2d3e4f5a6b',
          },
        ],
        mode: 'single',
        fail_current_scope: true,
      },
      200,
    ),
    flowNode(AGG_LOG_ID, 'Log', 'log', { message: 'os-prof-ui total={{ errors_total }}', level: 'INFO' }, 300),
    flowNode(AGG_DONE_ID, 'Log', 'log', { message: UI_BOOKEND, level: 'INFO' }, 400),
  ]
  const chain = ['start-node', AGG_NODE_ID, AGG_ASSERT_ID, AGG_LOG_ID, AGG_DONE_ID]
  const edgeIds = [
    'c4a1e7b2-9d3f-4a5c-8e6b-7f0a1d2c3b4e',
    'f6b3d9e1-2a4c-4b7d-9e8f-0a1c2b3d4e5f',
    'a2c4e6f8-1b3d-4f5a-8c7e-9d0b1a2c3e4f',
    'd8f0b2a4-6c1e-4d3f-a5b7-c9e1f3a5b7d9',
  ]
  return {
    name: 'V-PROFILE-OPENSEARCH-FUNCTIONAL errors per minute',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes,
      edges: edgeIds.map((id, i) => ({ id, source: chain[i], target: chain[i + 1], type: 'default' })),
    },
    variables: {
      epm_ok: { value: false, type: 'boolean', scope: 'test' },
      errors_per_minute: { value: [], type: 'table', scope: 'test' },
      errors_total: { value: -1, type: 'integer', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** Type a value into a profile field through its Edit value sheet and apply it. */
async function fillProfileField(page: Page, dialog: Locator, field: string, value: string): Promise<void> {
  const sheet = await openProfileFieldSheet(page, dialog, field)
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.insertText(value)
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  await save.click()
  await expect(save).toBeDisabled()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

/** Replace a block row's literal with an expression on the bound profile; a stored secret is discarded first. */
async function bindRow(page: Page, sheet: Locator, field: string, expression: string, secret: boolean): Promise<void> {
  const toggle = exprToggle(sheet, field)
  await toggle.click()
  if (secret) {
    await expect(page.getByText('Discard protected value?')).toBeVisible()
    await page.getByRole('button', { name: 'Switch to expression' }).click()
    await expect(page.getByText('Discard protected value?')).toBeHidden()
  } else {
    // The row holds a literal, so the switch asks before it clears it (FIELD-7).
    await answerSwitch(page, 'Clear & Empty')
  }
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = paramRow(sheet, field).locator(`[data-testid="param-input-${field}"] .cm-content`)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(expression)
  const suggestions = page.locator('.cm-tooltip-autocomplete')
  await expect(
    suggestions.locator('.cm-completionLabel').filter({ hasText: expression }),
    `the bound profile offers ${expression}`,
  ).toBeVisible()
  await leaveExpressionEditor(editor)
  await expect(sheet, 'leaving the editor left the sheet open').toBeVisible()
  await expect(editor).toHaveText(expression)
}

test.describe('V-PROFILE-OPENSEARCH-FUNCTIONAL', () => {
  test.beforeAll(async () => {
    token = newToken()
    const index = openSearchIndexName(token, 'app-logs')
    await createOpenSearchIndex(index, MAP_LOGS)
    await seedOpenSearch(index, F_LOGS)
    apiToken = await mintOpenSearchApiToken(openSearchIndexName(token, 'profile-api-key'))
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of createdTests.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    }
    for (const profileId of createdProfiles.splice(0)) {
      await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
    }
    if (apiToken) await revokeOpenSearchApiToken(apiToken.id)
    if (token) await deleteOpenSearchIndexes(token)
  })

  test('BASIC, TOKEN, APIKEY, CERT and WRONG: every connection row comes from its profile', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    expect(apiToken, 'the API token was minted in beforeAll').not.toBeNull()
    const key = apiToken as OpenSearchApiToken
    const environmentId = await resolveEnvironmentId(request)
    const index = openSearchIndexName(token, 'app-logs')
    const wrongPassword = `Wrong-Pass-${token}`

    const basic = await createProfile(
      request,
      environmentId,
      loadProfile('profile-opensearch.json', {
        url: DIRECT_URL,
        username: OPENSEARCH_USER,
        password: OPENSEARCH_PASSWORD,
        ca_cert: CA_CERT_PEM,
      }),
    )
    const bearer = await createProfile(
      request,
      environmentId,
      loadProfile('profile-opensearch-token.json', { url: DIRECT_URL, bearer_token: OPENSEARCH_JWT, ca_cert: CA_CERT_PEM }),
    )
    const apiKey = await createProfile(
      request,
      environmentId,
      loadProfile('profile-opensearch-apikey.json', { url: DIRECT_URL, api_key: key.token }),
    )
    const cert = await createProfile(
      request,
      environmentId,
      loadProfile('profile-opensearch-cert.json', {
        url: DIRECT_URL,
        ca_cert: CA_CERT_PEM,
        client_cert: TLS_LAB_CLIENT_CERT_PEM,
        client_key: TLS_LAB_CLIENT_KEY_PEM,
      }),
    )
    const wrong = await createProfile(
      request,
      environmentId,
      loadProfile('profile-opensearch.json', {
        url: DIRECT_URL,
        username: OPENSEARCH_USER,
        password: wrongPassword,
        ca_cert: CA_CERT_PEM,
      }),
      ' Wrong',
    )
    const profiles = [basic, bearer, apiKey, cert, wrong]

    await test.step('together the four profile files carry all nine fields, verify_ssl both ways', () => {
      const files = ['profile-opensearch.json', 'profile-opensearch-token.json', 'profile-opensearch-apikey.json', 'profile-opensearch-cert.json']
      const configs = files.map((file) => readJson<{ type: string; config: ProfileConfig }>(file))
      for (const profile of configs) expect(profile.type).toBe('opensearch')
      const fields = new Set(configs.flatMap((profile) => Object.keys(profile.config)))
      expect([...fields].sort()).toEqual([...OPENSEARCH_FIELDS].sort())
      expect(configs.map((profile) => profile.config.verify_ssl).filter((v) => v !== undefined)).toEqual([true, false])
    })

    let raw = fs.readFileSync(path.resolve(__dirname, 'fixture-opensearch.json'), 'utf-8')
    for (const [placeholder, profile] of [
      ['BASIC', basic],
      ['TOKEN', bearer],
      ['APIKEY', apiKey],
      ['CERT', cert],
      ['WRONG', wrong],
    ] as const) {
      raw = raw.split(`__${placeholder}_PROFILE_ID__`).join(profile.id)
      raw = raw.split(`__${placeholder}_PROFILE_NAME__`).join(profile.name)
    }
    const fixture = withToken(JSON.parse(raw) as Fixture, token)

    const testId = await importValidateAndNavigate(page, fixture as unknown as Record<string, unknown>, {
      rejectRepairs: true,
    })
    createdTests.push(testId)
    const validation = await validateTest(request, testId, 'run')
    expect(validation.status, `validate answered ${validation.status}`).toBe(200)
    expect(validation.errors, `zero errors. Got: ${JSON.stringify(validation.errors)}`).toHaveLength(0)
    expect(validation.warnings, `zero warnings. Got: ${JSON.stringify(validation.warnings)}`).toHaveLength(0)

    const { variables, entries } = await runAndHarvest(page, BOOKEND)
    const messages = entries.map((entry) => entry.message)
    const expectLog = (line: string): void => {
      expect(messages, `the console must carry "${line}".\n${formatEntries(entries)}`).toContain(line)
    }

    await test.step('every block ends in its state: the passing Searches green, WRONG amber (OS-11)', async () => {
      for (const node of fixture.workflow.nodes) {
        const recorded = CASES.some((c) => c.record && c.block === node.data.description)
        await expectNodeStatus(page, node.id, recorded ? 'warning' : 'success')
      }
    })

    for (const c of CASES.filter((item) => !item.record)) {
      await test.step(`${c.key.toUpperCase()}: Total 6 through the profile (OS-15, K8SPROF-9)`, () => {
        expect(sessionValue(variables, `${c.key}_ok`), `${c.key}_ok`).toBe(true)
        expect(sessionValue(variables, `${c.key}_total`), `${c.key}_total`).toBe(6)
        const rows = sessionTable(variables, `${c.key}_rows`)
        expect(rows.rows, `${c.key}_rows holds the six ERROR documents`).toHaveLength(6)
        expect(rows.rows[0], `${c.key}_rows starts with the newest ERROR`).toEqual([
          NEWEST_ERROR['@timestamp'],
          'ERROR',
          NEWEST_ERROR.message,
        ])
        expect(requestLines(entries, c.block), `"${c.block}" read the field list and searched`).toEqual([
          `GET /${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`,
          `POST /${index}/_search`,
        ])
        expectLog(`os-prof-${c.key} total=6 first=${String(NEWEST_ERROR.message)}`)
      })
    }

    await test.step("WRONG: the profile's wrong password is the one sent, so AuthFailed (OS-11, OS-15)", () => {
      expect(sessionValue(variables, 'wrong_ok')).toBe(false)
      expect(sessionValue(variables, 'wrong_reason')).toBe('AuthFailed')
      expect(sessionValue(variables, 'wrong_error')).toBe(UNAUTHORIZED)
      expect(sessionValue(variables, 'wrong_total')).toBe(0)
      expectLog(`os-prof-wrong total=0 reason=AuthFailed error=${UNAUTHORIZED}`)
    })

    await test.step('no profile secret reaches the run log, DEBUG included (REQ-5.1.2)', () => {
      expectNoLeak(entries, {
        password: OPENSEARCH_PASSWORD,
        'wrong password': wrongPassword,
        JWT: OPENSEARCH_JWT,
        'minted API token': key.token,
        'client key': TLS_LAB_CLIENT_KEY_PEM.split('\n')[1],
      })
    })

    expectLog(BOOKEND)
    await deleteTestThenProfiles(request, testId, profiles)
  })

  test('UI-built: a profile made on the Profiles page, bound in the Aggregate sheet, drives errors per minute', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const environmentId = await resolveEnvironmentId(request)
    const index = openSearchIndexName(token, 'app-logs')
    const profileName = `OpenSearch UI ${token}`
    let profile: CreatedProfile = { id: '', name: profileName }

    await test.step('New profile, type opensearch: exactly the nine fields and no required marker (OS-15)', async () => {
      const dialog = await openProfileCreateDialog(page)
      await selectProfileType(page, dialog, 'opensearch', OPENSEARCH_FIELDS.length)
      const names = await dialog
        .locator('textarea[aria-label="Parameter name"]')
        .evaluateAll((els) => els.map((el) => (el as HTMLTextAreaElement).value))
      expect(names).toEqual(OPENSEARCH_FIELDS)
      const table = dialog.locator('table').first()
      await expect(table.getByText('*'), 'no required marker').toHaveCount(0)
      await expect(table.locator('[aria-required="true"]')).toHaveCount(0)
      const schema = (await (await request.get(`${BACKEND_URL}/profiles/types/opensearch/schema`)).json()).data
      expect(
        (schema.fields as Array<{ name: string; required: boolean }>).map((f) => `${f.name} ${String(f.required)}`),
      ).toEqual(OPENSEARCH_FIELDS.map((f) => `${f} false`))

      await dialog.locator('#name').fill(profileName)
      await selectProfileModalEnvironment(page, dialog, E2E_ENV_NAME)
      await fillProfileField(page, dialog, 'url', GATEWAY_URL)
      await fillProfileField(page, dialog, 'username', OPENSEARCH_USER)
      await fillProfileField(page, dialog, 'password', OPENSEARCH_PASSWORD)
      await expect(dialog.locator('[data-testid^="param-value-error-"]'), 'the six blank fields raise nothing').toHaveCount(0)

      const create = dialog.getByRole('button', { name: 'Create', exact: true })
      await expect(create, 'Save is allowed with the other six blank').toBeEnabled()
      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/profiles'),
      )
      await create.click()
      const response = await created
      const body = await response.json()
      expect(response.status(), `POST /profiles answered ${JSON.stringify(body)}`).toBe(201)
      profile = { id: String((body.data ?? body).id), name: profileName }
      createdProfiles.push(profile.id)
      await expect(dialog).toBeHidden()

      const stored = (await (await request.get(`${BACKEND_URL}/profiles/${profile.id}`)).json()).data
      expect(stored.type).toBe('opensearch')
      const values = stored.environment_values[environmentId] as ProfileConfig
      expect(values.url).toBe(GATEWAY_URL)
      expect(values.username).toBe(OPENSEARCH_USER)
      expect(values.password, 'the password is stored').toBeTruthy()
      expect(values.password, 'the password is never read back in clear').not.toBe(OPENSEARCH_PASSWORD)
      expect(values.verify_ssl, 'verify_ssl keeps its starting value').toBe(true)
      for (const field of ['ca_cert', 'client_cert']) {
        expect(['', null, undefined], `${field} stays blank`).toContain(values[field])
      }
    })

    const testId = await seedTest(request, errorsPerMinuteTest(index))
    createdTests.push(testId)
    const alias = profileName.toLowerCase().replaceAll(' ', '_')

    await test.step("bind the profile in the Aggregate sheet in place of the block's own rows", async () => {
      await openTest(page, testId)
      await selectEnvironment(page)
      const sheet = await openSheetOf(page, AGG_NODE_ID)

      await sheet.getByRole('button', { name: 'Profiles' }).click()
      const binding = page.getByTestId('profile-binding-sheet')
      await expect(binding).toBeVisible()
      await binding.getByTestId('profile-search').fill(profileName)
      await expect(binding.getByTestId('profiles-loading')).toHaveCount(0)
      await binding.getByTestId(`available-profile-${profile.id}`).getByRole('button', { name: /Add/ }).click()
      await expect(binding.getByTestId(`bound-profile-${profile.id}`)).toBeVisible()
      await expect(binding.getByTestId(`alias-input-${profile.id}`)).toHaveValue(alias)
      await binding.getByRole('button', { name: 'Done' }).click()
      await expect(binding).toBeHidden()

      await bindRow(page, sheet, 'url', `${alias}.url`, false)
      await expandGroup(sheet, 'Authentication')
      for (const field of ['api_key', 'bearer_token']) {
        await expect(
          paramRow(sheet, field).getByRole('button', { name: 'Edit protected value' }),
          `${field} was saved empty, so it shows empty, not masked (VMGR-87)`,
        ).toHaveCount(0)
      }
      await bindRow(page, sheet, 'username', `${alias}.username`, false)
      await bindRow(page, sheet, 'password', `${alias}.password`, true)
      await saveConfig(sheet)
      await saveWorkbench(page)

      const saved = (await persistedNodes(request, testId))[AGG_NODE_ID]
      expect([...(saved.expressionFields as string[])].sort()).toEqual(['password', 'url', 'username'])
      expect(saved.config.values).toMatchObject({
        url: `${alias}.url`,
        username: `${alias}.username`,
        password: `${alias}.password`,
      })
      expect(saved.config.profileBindings).toEqual([
        expect.objectContaining({ profileId: profile.id, alias, profileName, profileType: 'opensearch' }),
      ])
    })

    const { variables, entries } = await runAndHarvest(page, UI_BOOKEND)

    await test.step('Results counts 2, 0, 4, 0, 0 and Total results 6 through the gateway (OS-15)', async () => {
      await expectNodeStatus(page, AGG_NODE_ID, 'success')
      expect(sessionValue(variables, 'epm_ok')).toBe(true)
      expect(sessionValue(variables, 'errors_total')).toBe(6)
      const table = sessionTable(variables, 'errors_per_minute')
      expect(table.columns.map((column) => column.name)).toEqual(['@timestamp', 'count'])
      expect(table.rows.map((row) => row[1]), `per-minute counts.\n${formatEntries(entries)}`).toEqual([2, 0, 4, 0, 0])
      expect(requestLines(entries, ''), "every request went to the profile's gateway URL").toEqual([
        `GET ${OPENSEARCH_GATEWAY_PREFIX}/${index}/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=true`,
        `POST ${OPENSEARCH_GATEWAY_PREFIX}/${index}/_search`,
      ])
    })

    await test.step("the Assert max(errors_per_minute.col('count')) <= 5 passes", async () => {
      await expectNodeStatus(page, AGG_ASSERT_ID, 'success')
      expect(entries.map((entry) => entry.message)).toContain('os-prof-ui total=6')
    })

    await test.step('no profile secret reaches the run log (REQ-5.1.2)', () => {
      expectNoLeak(entries, { password: OPENSEARCH_PASSWORD })
    })

    await deleteTestThenProfiles(request, testId, [profile])
  })
})
