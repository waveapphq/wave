/**
 * V-MCP-LIST-PROFILES-FUNCTIONAL: list_profiles answers each profile with its type and fields, secrets masked
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.8, REQ-5.2.7.13, REQ-3.1.3.17
 *
 * Pass Criteria:
 * 1. A seeded custom profile is one row of list_profiles holding its id, name, description, tags,
 *    `profile_type` `custom` (the name create_profile takes) and its fields per environment, each
 *    with its type and secret mark.
 * 2. Its secret field reads masked and the secret value appears nowhere in the answer; the plain field
 *    reads its stored value.
 * 3. The row is what GET /profiles/{id} answers for the same profile, with the type named `profile_type`.
 * 4. An argument the tool does not declare is refused with the error that names it.
 * 5. update_profile with a profile name that list_profiles does not answer is refused with
 *    "Profile '<ref>' not found".
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MASK, MCP_PORT, callMcp, expectRaised, own, rowsOf } from './list-client'

const PREFIX = 'zz-mcp-list_profiles-'
const PROFILE_NAME = `${PREFIX}1`
const UNKNOWN_PROFILE = `${PREFIX}2`
const TAG = 'zz-mcp-list_profiles-tag'
const SECRET = 'zz-mcp-list-profiles-secret-5521'

async function purge(request: APIRequestContext): Promise<void> {
  const body = await (await request.get(`${BACKEND_URL}/profiles?search=${PREFIX}`)).json().catch(() => null)
  for (const profile of own((body?.data ?? []) as Array<{ id: string; name: string }>, PREFIX)) {
    await request.delete(`${BACKEND_URL}/profiles/${profile.id}`).catch(() => undefined)
  }
}

test.describe('V-MCP-LIST-PROFILES-FUNCTIONAL: list_profiles against the stored profile', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await purge(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await purge(request)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('the seeded profile is listed with its type and fields, the secret masked', async ({ request }) => {
    test.setTimeout(120_000)
    const envId = await resolveEnvironmentId(request)
    const description = 'Listing probe profile'
    const createdResp = await request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name: PROFILE_NAME,
        type: 'custom',
        description,
        tags: [TAG],
        environment_values: {
          [envId]: {
            host: { type: 'string', secret: false, value: 'db.local' },
            port: { type: 'integer', secret: false, value: 5432 },
            token: { type: 'string', secret: true, value: SECRET },
          },
        },
      },
    })
    expect(createdResp.ok(), `POST /profiles failed: ${createdResp.status()} ${await createdResp.text()}`).toBeTruthy()
    const profileId = String((await createdResp.json()).data.id)

    const answer = callMcp('list_profiles')
    const rows = own(rowsOf(answer, 'list_profiles'), PREFIX)

    await test.step('the row holds the type and every field with its type and secret mark', () => {
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: profileId, name: PROFILE_NAME, description, tags: [TAG], profile_type: 'custom' })
      expect(rows[0]).not.toHaveProperty('type')
      expect(rows[0].environment_values[envId]).toEqual({
        host: expect.objectContaining({ type: 'string', secret: false, value: 'db.local' }),
        port: expect.objectContaining({ type: 'integer', secret: false, value: 5432 }),
        token: expect.objectContaining({ type: 'string', secret: true, value: MASK }),
      })
    })

    await test.step('the secret value appears nowhere in the answer', () => {
      expect(answer.texts.join('\n')).not.toContain(SECRET)
    })

    await test.step('the row is what GET /profiles/{id} answers, the type named profile_type', async () => {
      const { type, ...stored } = (await (await request.get(`${BACKEND_URL}/profiles/${profileId}`)).json()).data
      expect(rows[0]).toEqual({ ...stored, profile_type: type })
    })

    await test.step('an argument the tool does not declare is refused with the error that names it', () => {
      expectRaised(
        callMcp('list_profiles', { profile_type: 'http' }),
        'list_profiles',
        "Unknown argument 'profile_type'; this tool takes no arguments",
      )
    })

    await test.step('update_profile with a name list_profiles does not answer is refused', () => {
      expectRaised(
        callMcp('update_profile', { profile_ref: UNKNOWN_PROFILE, description: 'never stored' }),
        'update_profile',
        `Profile '${UNKNOWN_PROFILE}' not found`,
      )
    })
  })
})
