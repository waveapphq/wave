/**
 * V-PROFILE-BINDING-FUNCTIONAL: an HTTP and a Custom profile bound to Log Blocks are read as `alias.field`
 * Design Decisions: PROFILE-25
 * REQ: REQ-4.7.3, REQ-4.7.10, REQ-4.7.11, REQ-3.1.3.5
 *
 * Setup (API): one HTTP and one Custom profile (`profile-http.json`, `profile-custom.json`) under unique names
 * with their values for the shared E2E environment, and one `v-profile-binding-` Test whose Log Blocks bind them
 * as `http_prof` and `custom_prof` (zero validation errors); all removed after.
 *
 * Pass Criteria:
 * 1. The run passes and the console reads, exactly: `HTTP base_url=https://api.example.com/v2`,
 *    `HTTP timeout=30 next=31` (the integer field is a number), `CUSTOM app_name=wave-e2e-app` and
 *    `CUSTOM region=us-east-1`.
 * 2. The secret `auth_key` reaches the expression as its real value (`HTTP auth_key matches=True`), prints as
 *    `HTTP auth_key=********`, and its value is in no console line.
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { SECRET_MASK } from '../../helpers/secret-canary'
import { runToEnd, selectEnvironment } from '../../helpers/workbench'

type Rec = Record<string, any>

const AUTH_KEY = 'e2e-secret-key-42'

interface Binding {
  profileId: string
  alias: string
  profileName: string
  profileType: string
}

function token(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
}

/** Create the profile in `file` under a unique name, its values set for the E2E environment. */
async function createProfile(request: APIRequestContext, file: string, envId: string, alias: string): Promise<Binding> {
  const profile = JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Rec
  profile.name = `${profile.name} ${token()}`
  profile.environment_values = { [envId]: profile.config }
  const resp = await request.post(`${BACKEND_URL}/profiles`, { data: profile })
  expect(resp.ok(), `POST /profiles ${profile.name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const id = (await resp.json()).data.id as string
  return { profileId: id, alias, profileName: profile.name, profileType: profile.type }
}

/** A Log Block bound to one profile, printing `message`. */
function boundLog(id: string, message: string, binding: Binding, y: number): Rec {
  const node = logNode(id, 'Log', message, { x: 400, y }) as Rec
  node.data.config.profileBindings = [binding]
  return node
}

test.describe('V-PROFILE-BINDING-FUNCTIONAL: bound profile fields read as alias.field', () => {
  let testId = ''
  const profileIds: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    for (const id of profileIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => undefined)
    }
    testId = ''
  })

  test('HTTP and Custom profile fields reach the run; the HTTP secret prints masked', async ({ page, request }) => {
    test.setTimeout(180_000)
    const envId = await resolveEnvironmentId(request)
    const http = await createProfile(request, 'profile-http.json', envId, 'http_prof')
    profileIds.push(http.profileId)
    const custom = await createProfile(request, 'profile-custom.json', envId, 'custom_prof')
    profileIds.push(custom.profileId)

    const logs: Array<[string, Binding]> = [
      ['f"HTTP base_url={http_prof.base_url}"', http],
      ['f"HTTP timeout={http_prof.timeout} next={http_prof.timeout + 1}"', http],
      ['f"HTTP auth_key={http_prof.auth_key}"', http],
      [`f"HTTP auth_key matches={http_prof.auth_key == '${AUTH_KEY}'}"`, http],
      ['f"CUSTOM app_name={custom_prof.app_name}"', custom],
      ['f"CUSTOM region={custom_prof.region}"', custom],
    ]
    const ids = logs.map(() => randomUUID())
    testId = await createValidTest(request, {
      name: `v-profile-binding-${token()}`,
      nodes: logs.map(([message, binding], i) => boundLog(ids[i], message, binding, 120 + i * 130)),
      edges: [
        startEdge(ids[0]),
        ...ids.slice(1).map((target, i) => ({ id: randomUUID(), source: ids[i], target, type: 'default' })),
      ],
    })
    const validation = await validateTest(request, testId)
    expect(validation.errors, `the seed validates clean: ${JSON.stringify(validation.errors)}`).toEqual([])

    await openTest(page, testId)
    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')

    await test.step('PROFILE-25: the HTTP and the Custom fields read as alias.field', async () => {
      expectConsoleLine(entries, 'INFO', 'HTTP base_url=https://api.example.com/v2')
      expectConsoleLine(entries, 'INFO', 'HTTP timeout=30 next=31')
      expectConsoleLine(entries, 'INFO', 'CUSTOM app_name=wave-e2e-app')
      expectConsoleLine(entries, 'INFO', 'CUSTOM region=us-east-1')
    })

    await test.step('REQ-3.1.3.5: the secret auth_key runs with its real value and prints masked', async () => {
      expectConsoleLine(entries, 'INFO', 'HTTP auth_key matches=True')
      expectConsoleLine(entries, 'INFO', `HTTP auth_key=${SECRET_MASK}`)
      const leaks = entries.filter((entry) => entry.message.includes(AUTH_KEY))
      expect(leaks, `no console line holds the secret value.\n${formatEntries(leaks)}`).toEqual([])
    })
  })
})
