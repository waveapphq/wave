/**
 * Blocked-page helpers.
 *
 * When a supporting load step fails, the route content goes inert and a card
 * takes over. These locators and waits are shared by every spec that drives
 * that state.
 */

import { apiPathMatcher, failApiRoute, type ApiFailureSource, type ApiUrlMatcher } from './api-route'
import { expect, type Locator, type Page } from './playwright-fixtures'

/** Typed into a recovered page's filter bar to prove it takes input again. */
const LIVE_PROBE = 'pblk-live'

/** The supporting read the Profiles page blocks on. */
export const ENVIRONMENT_NAMES_ROUTE: ApiUrlMatcher = apiPathMatcher('/environments/names')

/** The Profiles page's primary read, used to prove a retry does not re-run it. */
export const PROFILES_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/profiles')

/** The Suites page's primary read. */
export const SUITES_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/suites')

/** The Tests page's primary read. */
export const TESTS_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/tests')

/** The Functions library read, shared by the Functions page and the library modal. */
export const FUNCTIONS_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/functions')

/** Supporting reads, one constant per API path: a failure blocks its surface. */
export const PROFILE_TYPES_ROUTE: ApiUrlMatcher = apiPathMatcher('/profiles/types')
export const PROFILE_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/profiles/tags')
export const SUITE_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/suites/tags')
export const SUITE_NAMES_ROUTE: ApiUrlMatcher = apiPathMatcher('/suites/names')
export const FUNCTION_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/functions/tags')
export const ENVIRONMENT_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/environments/tags')
export const TEST_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/tests/tags')
export const REGRESSION_TAGS_ROUTE: ApiUrlMatcher = apiPathMatcher('/regressions/tags')
export const SYSTEM_VARIABLES_ROUTE: ApiUrlMatcher = apiPathMatcher('/variables/system')

/** The live workbench's session restore read, owned by the run hook. */
export const WORKBENCH_SESSION_ROUTE: ApiUrlMatcher = apiPathMatcher('/workbench/session')

/** The Settings > Environments section's primary read. */
export const ENVIRONMENTS_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/environments')

/** The Executions page's primary read. */
export const EXECUTIONS_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/executions')

/** The users facet read feeding the User filter on Executions and Reports. */
export const EXECUTION_USERS_ROUTE: ApiUrlMatcher = apiPathMatcher('/executions/users')

/** The Reports page's primary read. */
export const REPORTS_LIST_ROUTE: ApiUrlMatcher = apiPathMatcher('/reports')

/** The live session's artifact list read (sheet refresh + mid-run poll). */
export const SESSION_ARTIFACTS_ROUTE: ApiUrlMatcher = apiPathMatcher('/workbench/session/artifacts')

/** The workbench mount's ownership claim (a POST). */
export const OWNERSHIP_CLAIM_ROUTE: ApiUrlMatcher = apiPathMatcher('/workbench/ownership/claim')

/** The requester's take-over retraction (a POST). */
export const OWNERSHIP_TAKEOVER_CANCEL_ROUTE: ApiUrlMatcher = apiPathMatcher(
  '/workbench/ownership/takeover/cancel',
)

/** The workbench's validation read for one test (a POST). */
export function testValidateRoute(testId: string): ApiUrlMatcher {
  return apiPathMatcher(`/tests/${testId}/validate`)
}

/** One Test's saved workflow, re-read to revert the canvas on Discard and Stay. */
export function testWorkflowRoute(testId: string): ApiUrlMatcher {
  return apiPathMatcher(`/tests/${testId}/workflow`)
}

/** One Function's per-version usage read, which gates both delete paths. */
export function functionUsageRoute(functionId: string): ApiUrlMatcher {
  return apiPathMatcher(`/functions/${functionId}/dependents/by-version`)
}

/** One Function's per-version delete (a DELETE). */
export function functionVersionRoute(functionId: string, version: string): ApiUrlMatcher {
  return apiPathMatcher(`/functions/${functionId}/versions/${version}`)
}

/** One whole Function's delete (a DELETE). */
export function functionRoute(functionId: string): ApiUrlMatcher {
  return apiPathMatcher(`/functions/${functionId}`)
}

/** Force the Profiles page's environment read to fail. */
export function failEnvironmentNames(page: Page, source: ApiFailureSource): Promise<void> {
  return failApiRoute(page, ENVIRONMENT_NAMES_ROUTE, source)
}

/** Land on the app shell with a clean client store, before forcing a failure. */
export async function startAtRoot(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
}

export function blockedCard(page: Page): Locator {
  return page.getByTestId('page-blocked-card')
}

export function blockedTitle(page: Page): Locator {
  return page.getByTestId('page-blocked-title')
}

export function blockedRouteContent(page: Page): Locator {
  return page.getByTestId('route-content')
}

/** True while the route content carries the inert attribute AND the live inert property. */
export async function isRouteContentInert(page: Page): Promise<boolean> {
  return blockedRouteContent(page).evaluate(
    (el) => el.hasAttribute('inert') && (el as HTMLElement).inert === true,
  )
}

/** The computed filter on the route content: `none` unless the page is blurred. */
export function routeContentFilter(page: Page): Promise<string> {
  return blockedRouteContent(page).evaluate((el) => getComputedStyle(el).filter)
}

/** The card is up, it names the read that failed, and the page under it is dead. */
export async function expectBlockedWith(page: Page, title: string): Promise<void> {
  await expect(blockedCard(page)).toBeVisible({ timeout: 20000 })
  await expect(blockedTitle(page)).toHaveText(title)
  expect(await isRouteContentInert(page), 'a blocked page must be inert').toBe(true)
}

/** No card, nothing inert, nothing blurred. */
export async function expectNotBlocked(page: Page): Promise<void> {
  await expect(blockedCard(page)).toHaveCount(0)
  expect(await isRouteContentInert(page), 'the route content must stay live').toBe(false)
  expect(await routeContentFilter(page), 'the route content must not be blurred').toBe('none')
}

/** Prove a recovered page takes input again: its filter bar accepts typing. */
export async function expectSurfaceLive(page: Page): Promise<void> {
  expect(await isRouteContentInert(page), 'a recovered page must not be inert').toBe(false)
  const search = page.locator('[data-testid="search-input"] input').first()
  await expect(search).toBeVisible()
  await search.fill(LIVE_PROBE)
  await expect(search).toHaveValue(LIVE_PROBE)
  await search.fill('')
}

/** Click Try Again on the blocked card. */
export function retryBlockedPage(page: Page): Promise<void> {
  return page.getByTestId('page-blocked-retry').click()
}

/**
 * Open the details disclosure and return its panel. The disclosure is folded
 * by default and a re-blocked card may come back folded, so the click is
 * retried only while the panel is still closed.
 */
export async function openBlockedDetails(page: Page): Promise<Locator> {
  const panel = page.getByTestId('page-blocked-details-panel')
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await page.getByTestId('page-blocked-details-trigger').click()
    }
    await expect(panel).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  return panel
}

/**
 * Delete the card and everything else layered over the route content, leaving
 * only the route content itself. Returns how many elements were removed, so a
 * spec can prove the overlay really was there.
 */
export async function stripBlockedOverlay(page: Page): Promise<number> {
  return page.evaluate(() => {
    const content = document.querySelector('[data-testid="route-content"]')
    const wrapper = content?.parentElement
    if (!content || !wrapper) return -1
    const layers = Array.from(wrapper.children).filter((child) => child !== content)
    for (const layer of layers) layer.remove()
    return layers.length
  })
}

/** Describe where focus currently sits, relative to the inert region and the sidebar. */
export async function focusLocation(page: Page): Promise<{
  inRouteContent: boolean
  inSidebar: boolean
  description: string
}> {
  return page.evaluate(() => {
    const active = document.activeElement
    return {
      inRouteContent: !!active?.closest('[data-testid="route-content"]'),
      inSidebar: !!active?.closest('[data-testid="sidebar"]'),
      description: active
        ? `${active.tagName.toLowerCase()}[${active.getAttribute('data-testid') ?? active.getAttribute('href') ?? active.getAttribute('aria-label') ?? ''}]`
        : 'none',
    }
  })
}
