/**
 * V-PAGE-BLOCKED-PROFILES-GUARD: no profile write is built from environments
 * that never arrived
 *
 * Phase: functional-workflow. The Profiles page keeps a profile's values per
 * environment, so a failed environments read leaves the page unable to say
 * what any stored value belongs to. This is the surface the whole blocked-page
 * design started from: a write made over that gap erased configuration. The
 * card and the blur are removed from the DOM here, so what refuses the writes
 * is the guard itself and not the cover over the page.
 *
 * Design Decisions: LIST-11 (a failed read is never presented as a result),
 * LIST-13 (blocked means inert, not covered).
 *
 * Pass Criteria:
 *  1. With the environments read failed, the Profiles page blocks.
 *  2. Forced live again, the editor never opens: there is nothing to build an
 *     edit from.
 *  3. Duplicate issues no write.
 *  4. Delete opens its confirmation, and confirming issues no write either.
 *  5. The server still holds the profile with its stored environment values.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { apiPathMatcher, countApiFetches } from '../../helpers/api-route'
import {
  blockedRouteContent,
  expectBlockedWith,
  failEnvironmentNames,
  startAtRoot,
  stripBlockedOverlay,
} from '../../helpers/page-block'

const PROFILE_NAME = `PBLK Guard Profile ${Date.now()}`
const FAILURE_DETAIL = 'Environment registry unavailable'
const STORED_HOST = 'guarded.example.com'

// Long enough for a write that was going to happen to have been issued.
const SETTLE_MS = 700

let profileId = ''
let environmentId = ''

async function readEnvironmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  const environments = Array.isArray(body) ? body : (body.data ?? [])
  const match = environments.find((environment: { name: string }) => environment.name === E2E_ENV_NAME)
  expect(match, `environment ${E2E_ENV_NAME} must exist`).toBeTruthy()
  return match.id
}

async function seedProfile(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name: PROFILE_NAME,
      type: 'custom',
      tags: [],
      environment_values: {
        [environmentId]: {
          host: { type: 'string', secret: false, value: STORED_HOST },
        },
      },
    },
  })
  expect(
    response.ok(),
    `seed profile failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body) as { id: string }).id
}

function profileRow(page: Page) {
  return page.locator('[data-testid="profile-row"]').filter({ hasText: PROFILE_NAME })
}

test.describe('V-PAGE-BLOCKED-PROFILES-GUARD: the guard refuses the write, not the cover', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    environmentId = await readEnvironmentId(request)
    profileId = await seedProfile(request)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => undefined)
  })

  test('PG1: neither editing, duplicating nor deleting writes over a failed environments read', async ({
    page,
    request,
  }) => {
    await startAtRoot(page)
    await failEnvironmentNames(page, { detail: FAILURE_DETAIL })
    const profileDeletes = countApiFetches(page, apiPathMatcher(`/profiles/${profileId}`), 'DELETE')
    const profileDuplicates = countApiFetches(
      page,
      apiPathMatcher(`/profiles/${profileId}/duplicate`),
      'POST',
    )

    await page.goto('/profiles')
    await expectBlockedWith(page, 'Could not load environments')

    const row = profileRow(page)
    await expect(row, 'the seeded profile must be on the page').toHaveCount(1)

    // Take away the card, the wash and the inert attribute: from here on, only
    // the guard can refuse anything.
    const removed = await stripBlockedOverlay(page)
    expect(removed, 'the blocked page must have had a layer over it').toBeGreaterThan(0)
    await blockedRouteContent(page).evaluate((element) => element.removeAttribute('inert'))

    // 1. There is nothing to build an edit from, so the editor never opens.
    await row.locator('[data-testid="action-edit"]').click()
    await page.waitForTimeout(SETTLE_MS)
    await expect(
      page.locator('[role="dialog"]'),
      'no editor may open over environments that never arrived',
    ).toHaveCount(0)

    // 2. Duplicate issues no write.
    await row.locator('[data-testid="action-menu-trigger"]').click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await page.waitForTimeout(SETTLE_MS)
    expect(profileDuplicates(), 'no duplicate may be written').toBe(0)

    // 3. Delete asks first, and confirming still writes nothing.
    await row.locator('[data-testid="action-menu-trigger"]').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.waitForTimeout(SETTLE_MS)
    expect(profileDeletes(), 'no delete may be issued').toBe(0)

    // 4. The server still holds the profile, values intact.
    const check = await request.get(`${BACKEND_URL}/profiles/${profileId}`)
    expect(check.ok(), 'the profile must still exist').toBeTruthy()
    const body = await check.json()
    const stored = (body.data ?? body) as {
      name: string
      environment_values: Record<string, Record<string, { value: unknown }>>
    }
    expect(stored.name).toBe(PROFILE_NAME)
    expect(stored.environment_values[environmentId].host.value).toBe(STORED_HOST)
  })
})
