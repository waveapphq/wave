/**
 * V-MCP-LIST-VARIABLES-FUNCTIONAL: list_variables answers the shared System variables by name, secrets masked
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.8, REQ-5.2.7.13, REQ-3.1.3.17
 *
 * Pass Criteria:
 * 1. Scope `system` answers one row per seeded System variable carrying its `name` and its declaration:
 *    type, value and secret mark.
 * 2. The secret variable reads masked and its value appears nowhere in the answer.
 * 3. Each row is the declaration GET /variables/system answers for the same name.
 * 4. Scope `global` answers the same rows as `system`: both name the one shared store.
 * 5. An unknown scope is refused with "Scope must be 'system' or 'global'".
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MASK, MCP_PORT, callMcp, expectRaised, own, rowsOf } from './list-client'

// Variable names take no hyphen, so the seeded names use underscores.
const PREFIX = 'zz_mcp_list_variables_'
const SECRET = 'zz-mcp-list-variables-secret-8830'
const SYSTEM_ENTITY_ID = '00000000-0000-0000-0000-000000000000'

const SEEDED: Record<string, Record<string, unknown>> = {
  [`${PREFIX}1`]: { type: 'string', value: 'eu-west', secret: false },
  [`${PREFIX}2`]: { type: 'integer', value: 7, secret: false },
  [`${PREFIX}3`]: { type: 'string', value: SECRET, secret: true },
}

async function storedSystemVariables(request: APIRequestContext): Promise<Record<string, Record<string, unknown>>> {
  const resp = await request.get(`${BACKEND_URL}/variables/system`)
  expect(resp.ok(), `GET /variables/system: ${resp.status()}`).toBeTruthy()
  return ((await resp.json()).data?.variables ?? {}) as Record<string, Record<string, unknown>>
}

/** Add the seeded variables next to whatever the shared store holds. */
async function seedVariables(request: APIRequestContext): Promise<void> {
  const existing = await storedSystemVariables(request)
  const resp =
    Object.keys(existing).length === 0
      ? await request.post(`${BACKEND_URL}/variables/system`, { data: { variables: SEEDED } })
      : await request.patch(`${BACKEND_URL}/variables/system/${SYSTEM_ENTITY_ID}`, { data: { variables: SEEDED } })
  expect(resp.ok(), `seeding System variables failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

async function purge(request: APIRequestContext): Promise<void> {
  for (const name of Object.keys(await storedSystemVariables(request)).filter((key) => key.startsWith(PREFIX))) {
    await request.delete(`${BACKEND_URL}/variables/system/${name}`).catch(() => undefined)
  }
}

test.describe('V-MCP-LIST-VARIABLES-FUNCTIONAL: list_variables against the shared System variables', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await purge(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await purge(request)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('system and global list the seeded variables by name with their declarations, the secret masked', async ({
    request,
  }) => {
    test.setTimeout(120_000)
    await seedVariables(request)
    const answer = callMcp('list_variables', { scope: 'system' })
    const rows = own(rowsOf(answer, 'list_variables'), PREFIX)

    await test.step('one row per seeded variable with its name and declaration', () => {
      expect(rows.map((row) => row.name).sort()).toEqual(Object.keys(SEEDED))
      const byName = new Map(rows.map((row) => [row.name, row]))
      expect(byName.get(`${PREFIX}1`)).toMatchObject({ name: `${PREFIX}1`, type: 'string', value: 'eu-west', secret: false })
      expect(byName.get(`${PREFIX}2`)).toMatchObject({ name: `${PREFIX}2`, type: 'integer', value: 7, secret: false })
      expect(byName.get(`${PREFIX}3`)).toMatchObject({ name: `${PREFIX}3`, type: 'string', value: MASK, secret: true })
    })

    await test.step('the secret value appears nowhere in the answer', () => {
      expect(answer.texts.join('\n')).not.toContain(SECRET)
    })

    await test.step('each row is the declaration GET /variables/system answers', async () => {
      const stored = await storedSystemVariables(request)
      for (const row of rows) {
        const { name, ...declaration } = row
        expect(declaration, `${name} reads as stored`).toEqual(stored[name])
      }
    })

    await test.step('scope global answers the same rows as system', () => {
      const all = rowsOf(answer, 'list_variables')
      expect(rowsOf(callMcp('list_variables', { scope: 'global' }), 'list_variables')).toEqual(all)
    })

    await test.step('an unknown scope is refused with its exact text', () => {
      expectRaised(callMcp('list_variables', { scope: 'suite' }), 'list_variables', "Scope must be 'system' or 'global'")
    })
  })
})
