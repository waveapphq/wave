/**
 * V-MCP-PROFILE-ACTIONS-FUNCTIONAL: declare-empty profile secrets are announced.
 * REQ: REQ-5.2.7.12
 *
 * create_profile/update_profile with a declare-empty secret credential return a manual
 * action item, since every masked readback shows the empty credential as filled.
 *
 * Pass Criteria:
 * 1. create_profile with a secret field declared without a value succeeds and
 *    returns an action_items entry naming the exact field and environment.
 * 2. A filled secret produces action_items: [].
 * 3. update_profile submitting a declare-empty secret returns the same item.
 */

import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'

const MCP_PORT = Number(BACKEND_PORT) + 765

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function environmentId(request: APIRequestContext): Promise<string> {
  await ensureEnvironment(request)
  const resp = await request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  expect(env, 'E2E environment must exist').toBeTruthy()
  return env.id as string
}

const createdProfiles: string[] = []

test.describe('V-MCP-PROFILE-ACTIONS: declare-empty secrets return action items', () => {
  test.afterEach(async ({ page, request }) => {
    for (const id of createdProfiles.splice(0)) {
      await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => {})
    }
    await resetMcpSettings(page)
  })

  test('declare-empty secret on create returns the manual action item', async ({
    page,
    request,
  }) => {
    const envId = await environmentId(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const result = callTool(MCP_PORT, 'create_profile', {
      name: uniqueName('MCP Actions Deferred'),
      profile_type: 'custom',
      environment_values: {
        [envId]: {
          username: { type: 'string', secret: false, value: 'svc' },
          password: { type: 'string', secret: true },
        },
      },
    })
    expect(result.isError).toBe(false)
    expect(result.payload.created).toBe(true)
    if (result.payload.profile_id) createdProfiles.push(String(result.payload.profile_id))

    const items = result.payload.action_items as Array<Record<string, unknown>>
    expect(items, 'declare-empty must be announced as an action item').toBeTruthy()
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe('NO_VALUE_SECRET')
    expect(items[0].step).toBe(`environment_values.${envId}.password`)
  })

  test('a filled secret produces no action items', async ({ page, request }) => {
    const envId = await environmentId(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const result = callTool(MCP_PORT, 'create_profile', {
      name: uniqueName('MCP Actions Filled'),
      profile_type: 'custom',
      environment_values: {
        [envId]: { password: { type: 'string', secret: true, value: 'hunter2' } },
      },
    })
    expect(result.isError).toBe(false)
    expect(result.payload.created).toBe(true)
    if (result.payload.profile_id) createdProfiles.push(String(result.payload.profile_id))
    expect(result.payload.action_items).toEqual([])
  })

  test('declare-empty secret on update returns the manual action item', async ({
    page,
    request,
  }) => {
    const envId = await environmentId(request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const created = callTool(MCP_PORT, 'create_profile', {
      name: uniqueName('MCP Actions Update'),
      profile_type: 'custom',
      environment_values: {
        [envId]: { password: { type: 'string', secret: true, value: 'hunter2' } },
      },
    })
    expect(created.payload.created).toBe(true)
    const profileId = String(created.payload.profile_id)
    createdProfiles.push(profileId)

    const updated = callTool(MCP_PORT, 'update_profile', {
      profile_ref: profileId,
      environment_values: { [envId]: { password: { type: 'string', secret: true } } },
    })
    expect(updated.isError).toBe(false)
    expect(updated.payload.updated).toBe(true)
    const items = updated.payload.action_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0].code).toBe('NO_VALUE_SECRET')
    expect(items[0].step).toBe(`environment_values.${envId}.password`)
  })
})
