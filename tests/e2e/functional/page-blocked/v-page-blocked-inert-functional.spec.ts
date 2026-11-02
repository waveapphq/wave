/**
 * V-PAGE-BLOCKED-INERT: a page blocked by a failed load step is dead, not covered
 *
 * Phase: functional-workflow. Seeds one profile so the list has a row to act
 * on, then forces GET /environments/names to fail so the Profiles page blocks.
 *
 * Design Decisions: LIST-13 (blocked means inert, not covered), LIST-14 (the
 * sidebar stays usable).
 *
 * Pass Criteria:
 *  1. The route content carries the inert attribute while the page is blocked,
 *     and the card lives outside that region.
 *  2. With the card and every other layer deleted from the DOM, a real mouse
 *     click on a row action does nothing and typing into the search field
 *     changes nothing.
 *  3. Removing only the inert attribute makes that same click work, so inert -
 *     not a cover - is what kills the page.
 *  4. Tab never lands inside the route content, and a programmatic focus
 *     attempt does not move focus there either.
 *  5. The sidebar stays usable: a nav link navigates while the page is blocked.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import {
  blockedCard,
  blockedRouteContent,
  failEnvironmentNames,
  focusLocation,
  isRouteContentInert,
  stripBlockedOverlay,
} from '../../helpers/page-block'

const PROFILE_NAME = 'PBLK Inert Row Profile'
const FAILURE_DETAIL = 'Environment registry unavailable'

// Enough presses to walk the whole sidebar and wrap round.
const TAB_PRESSES = 30

async function environmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  const environments = Array.isArray(body) ? body : (body.data ?? [])
  const match = environments.find((env: { name: string }) => env.name === E2E_ENV_NAME)
  expect(match, `environment ${E2E_ENV_NAME} must exist`).toBeTruthy()
  return match.id
}

async function deleteProfilesNamed(request: APIRequestContext, name: string): Promise<void> {
  const response = await request.get(`${BACKEND_URL}/profiles?per_page=200`)
  const body = await response.json()
  const profiles = Array.isArray(body) ? body : (body.data ?? [])
  for (const profile of profiles) {
    if (profile.name === name) {
      await request.delete(`${BACKEND_URL}/profiles/${profile.id}`).catch(() => undefined)
    }
  }
}

async function seedProfile(request: APIRequestContext): Promise<void> {
  await deleteProfilesNamed(request, PROFILE_NAME)
  const envId = await environmentId(request)
  const response = await request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name: PROFILE_NAME,
      type: 'custom',
      tags: [],
      environment_values: {
        [envId]: { host: { type: 'string', secret: false, value: 'blocked.example.com' } },
      },
    },
  })
  expect(
    response.ok(),
    `seed profile: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
}

/** Land on a blocked Profiles page with one row in the table. */
async function gotoBlockedProfiles(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await failEnvironmentNames(page, { detail: FAILURE_DETAIL })
  await page.goto('/profiles')
  await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
  await expect(page.locator('[data-testid="profile-row"]').first()).toBeVisible()
}

test.describe('V-PAGE-BLOCKED-INERT: blocked route content is genuinely dead', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    await seedProfile(request)
  })

  test.afterAll(async ({ request }) => {
    await deleteProfilesNamed(request, PROFILE_NAME)
  })

  test('S1: pointer input is refused with the overlay deleted, and inert is the only reason', async ({
    page,
  }) => {
    await gotoBlockedProfiles(page)

    // The card must sit outside the region it blocks, or it dies with it.
    expect(await isRouteContentInert(page), 'route content must be inert').toBe(true)
    expect(
      await blockedCard(page).evaluate(
        (el) => !!el.closest('[data-testid="route-content"]'),
      ),
      'the card must not live inside the inert region',
    ).toBe(false)

    const kebab = page
      .locator('[data-testid="profile-row"] [data-testid="action-menu-trigger"]')
      .first()
    const search = page.locator('[data-testid="search-input"] input')
    const kebabBox = await kebab.boundingBox()
    const searchBox = await search.boundingBox()
    expect(kebabBox, 'row kebab must be laid out').toBeTruthy()
    expect(searchBox, 'search field must be laid out').toBeTruthy()
    const kebabPoint = {
      x: kebabBox!.x + kebabBox!.width / 2,
      y: kebabBox!.y + kebabBox!.height / 2,
    }
    const rowsBefore = await page.locator('[data-testid="profile-row"]').count()
    const menus = page.locator('[role="menu"]')
    const menusBefore = await menus.count()

    // Delete the card and every other layer, so nothing can be sitting on top.
    const removedLayers = await stripBlockedOverlay(page)
    expect(removedLayers, 'the blocked page must have had a layer over it').toBeGreaterThan(0)
    await expect(blockedCard(page)).toHaveCount(0)

    // A real mouse click on the row action must do nothing at all.
    await page.mouse.click(kebabPoint.x, kebabPoint.y)
    await page.waitForTimeout(500)
    expect(await menus.count(), 'the row menu must not open').toBe(menusBefore)
    expect(
      (await focusLocation(page)).inRouteContent,
      'clicking must not move focus into the blocked region',
    ).toBe(false)

    // Typing into the search field must change neither the field nor the list.
    await page.mouse.click(
      searchBox!.x + searchBox!.width / 2,
      searchBox!.y + searchBox!.height / 2,
    )
    await page.keyboard.type('zzzz')
    await page.waitForTimeout(500)
    expect(await search.inputValue(), 'search field must stay empty').toBe('')
    expect(
      await page.locator('[data-testid="profile-row"]').count(),
      'the list must not react to typing',
    ).toBe(rowsBefore)

    // Control: drop the inert attribute and the identical click works. That
    // proves the coordinates were right and nothing was covering the row, so
    // inert was the only thing refusing the input.
    await blockedRouteContent(page).evaluate((el) => el.removeAttribute('inert'))
    await page.mouse.click(kebabPoint.x, kebabPoint.y)
    await expect(
      menus,
      'with inert removed the same click must open the row menu',
    ).toHaveCount(menusBefore + 1)
    await page.keyboard.press('Escape')
  })

  test('S2: keyboard and programmatic focus never reach the blocked region', async ({
    page,
  }) => {
    await gotoBlockedProfiles(page)
    expect(await isRouteContentInert(page), 'route content must be inert').toBe(true)

    const removedLayers = await stripBlockedOverlay(page)
    expect(removedLayers, 'the blocked page must have had a layer over it').toBeGreaterThan(0)

    // Tab from the top of the document, over and over.
    const trapped: string[] = []
    let reachedSidebar = false
    for (let press = 0; press < TAB_PRESSES; press++) {
      await page.keyboard.press('Tab')
      const where = await focusLocation(page)
      if (where.inRouteContent) trapped.push(`press ${press + 1}: ${where.description}`)
      if (where.inSidebar) reachedSidebar = true
    }
    expect(trapped, 'Tab must never land inside the blocked region').toEqual([])
    expect(reachedSidebar, 'Tab must still reach the sidebar, or the walk proved nothing').toBe(
      true,
    )

    // A direct focus() call is refused too.
    for (const selector of [
      '[data-testid="search-input"] input',
      '[data-testid="profile-row"] [data-testid="action-menu-trigger"]',
      '[data-testid="new-profile-button"]',
    ]) {
      await page.locator(selector).first().evaluate((el) => (el as HTMLElement).focus())
      const where = await focusLocation(page)
      expect(where.inRouteContent, `focus() on ${selector} must be refused`).toBe(false)
    }
  })

  test('S3: the sidebar still navigates while the page is blocked', async ({ page }) => {
    await gotoBlockedProfiles(page)
    await expect(blockedCard(page)).toBeVisible()

    const dashboardLink = page.locator('[data-testid="sidebar"] a[href="/dashboard"]')
    await expect(dashboardLink, 'sidebar link must be visible while blocked').toBeVisible()
    await expect(dashboardLink, 'sidebar link must be enabled while blocked').toBeEnabled()

    await dashboardLink.click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // Leaving is the way out, so the block must not follow the user.
    await expect(blockedCard(page)).toHaveCount(0)
    expect(await isRouteContentInert(page), 'the new page must not be inert').toBe(false)
  })
})
