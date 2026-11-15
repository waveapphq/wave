/**
 * V-MCP-LIST-ENVIRONMENTS-FUNCTIONAL: list_environments answers the environments Settings > Environments shows
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.8, REQ-5.2.7.2
 *
 * Pass Criteria:
 * 1. The seeded environment is one row of list_environments holding the id, name, description, tags
 *    and usage that GET /environments/{id} answers.
 * 2. Settings > Environments, searched to its name, shows one row with the same id, name and description.
 * 3. An argument the tool does not declare is refused with the error that names it.
 * 4. Credentials keyed by an environment id that list_environments does not answer are refused with
 *    the UNKNOWN_ENVIRONMENT finding that points at list_environments, and no profile is created.
 */

import { randomUUID } from 'crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MCP_PORT, callMcp, expectRaised, objectOf, own, rowsOf } from './list-client'

const PREFIX = 'zz-mcp-list_environments-'
const ENV_NAME = `${PREFIX}1`
const REFUSED_PROFILE = `${PREFIX}2`
const TAG = 'zz-mcp-list_environments-tag'

async function purge(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const envs = ((await (await request.get(`${BACKEND_URL}/environments?per_page=100`)).json()).data ?? []) as Array<{ id: string; name: string }>
  for (const env of own(envs, PREFIX)) await request.delete(`${BACKEND_URL}/environments/${env.id}`).catch(() => undefined)
  const profiles = ((await (await request.get(`${BACKEND_URL}/profiles?search=${PREFIX}`)).json()).data ?? []) as Array<{ id: string; name: string }>
  for (const profile of own(profiles, PREFIX)) await request.delete(`${BACKEND_URL}/profiles/${profile.id}`).catch(() => undefined)
}

test.describe('V-MCP-LIST-ENVIRONMENTS-FUNCTIONAL: list_environments against Settings > Environments', () => {
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

  test('the seeded environment row matches the settings page and the stored environment', async ({ page, request }) => {
    test.setTimeout(120_000)
    const description = 'Listing probe environment'
    const createdResp = await request.post(`${BACKEND_URL}/environments`, {
      data: { name: ENV_NAME, description, tags: [TAG] },
    })
    expect(createdResp.ok(), `POST /environments failed: ${createdResp.status()} ${await createdResp.text()}`).toBeTruthy()
    const envId = String((await createdResp.json()).data.id)

    const rows = rowsOf(callMcp('list_environments'), 'list_environments')

    await test.step('the row holds what GET /environments/{id} answers', async () => {
      const mine = own(rows, PREFIX)
      expect(mine).toHaveLength(1)
      const stored = (await (await request.get(`${BACKEND_URL}/environments/${envId}`)).json()).data
      expect(mine[0]).toMatchObject({ id: envId, name: ENV_NAME, description, tags: [TAG], usage: 0 })
      expect(mine[0]).toMatchObject({
        id: stored.id,
        name: stored.name,
        description: stored.description,
        tags: stored.tags,
        usage: stored.usage,
        created_at: stored.created_at,
      })
    })

    await test.step('Settings > Environments shows the same environment', async () => {
      await page.goto('/settings/environments')
      await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })
      await page.locator('[data-testid="environments-tab"] [data-testid="search-input"] input').fill(ENV_NAME)
      const shown = page.locator('[data-testid="environment-row"]')
      await expect(shown).toHaveCount(1, { timeout: 15_000 })
      await expect(shown).toHaveAttribute('data-row-id', envId)
      await expect(shown.getByTestId('environment-name')).toHaveText(ENV_NAME)
      await expect(shown.getByTestId('environment-description')).toHaveText(description)
    })

    await test.step('an argument the tool does not declare is refused with the error that names it', () => {
      expectRaised(
        callMcp('list_environments', { search: 'no-such-environment' }),
        'list_environments',
        "Unknown argument 'search'; this tool takes no arguments",
      )
    })

    await test.step('credentials keyed by an unknown environment id are refused with the finding', async () => {
      const unknownId = randomUUID()
      expect(rows.map((row) => row.id)).not.toContain(unknownId)
      const refused = objectOf(
        callMcp('create_profile', {
          name: REFUSED_PROFILE,
          profile_type: 'custom',
          environment_values: { [unknownId]: { host: { type: 'string', secret: false, value: 'db.local' } } },
        }),
        'create_profile',
      )
      expect(refused).toEqual({
        created: false,
        findings: [
          {
            step: 'input',
            code: 'UNKNOWN_ENVIRONMENT',
            severity: 'error',
            problem: `Environment '${unknownId}' not found`,
            fix: 'Use the list_environments tool for available environments',
          },
        ],
      })
      const profiles = (await (await request.get(`${BACKEND_URL}/profiles?search=${REFUSED_PROFILE}`)).json()).data ?? []
      expect(own(profiles as Array<{ name: string }>, REFUSED_PROFILE), 'nothing was created').toEqual([])
    })
  })
})
