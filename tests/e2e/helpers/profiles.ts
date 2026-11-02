/**
 * Profiles page helpers.
 *
 * Every spec that drives the Profile create dialog clears the same gate: the
 * page refuses to open the dialog (warning toast) until it knows of at least
 * one environment, and it commits that list only once ALL FOUR of its mount
 * fetches have answered - profiles, types, tags and environments go out in one
 * `Promise.all`, so the slowest of the four governs.
 *
 * `aria-busy` cannot stand in for that wait. It is driven by
 * useDebouncedLoading, which starts false and only flips true after 150ms, so
 * the page sits in the DOM reading `aria-busy="false"` from its very first
 * commit - before any data exists. Waiting for a busy-then-idle transition is
 * worse still: when the fetches are fast the busy state never happens at all.
 */

import { expect, type Locator, type Page } from './playwright-fixtures'

/**
 * Resolve when every request the profiles page issues on mount has answered
 * and its body is on the client.
 *
 * Matching is on the decoded pathname of a fetch, never a raw-URL substring:
 * the navigation to /profiles is a document response carrying that same
 * pathname, and query strings arrive percent-encoded.
 */
function profilesPageAnswered(page: Page): Promise<unknown> {
  const answered = (pathname: string) =>
    page
      .waitForResponse(
        (response) =>
          response.request().resourceType() === 'fetch' &&
          new URL(response.url()).pathname.endsWith(pathname),
      )
      .then((response) => response.finished())
  return Promise.all([
    answered('/environments/names'),
    answered('/profiles'),
    answered('/profiles/types'),
    answered('/profiles/tags'),
  ])
}

/** Open the Profile create dialog from a settled profiles list. */
export async function openProfileCreateDialog(page: Page): Promise<Locator> {
  // Arm the waits BEFORE navigating: the four fetches fire in the same tick
  // the container mounts, which is the same tick the lazy route commits.
  const answered = profilesPageAnswered(page)
  await page.goto('/profiles')
  await page.waitForSelector('[data-testid="profiles-page"]', { state: 'visible' })
  await answered

  const dialog = page.locator('[role="dialog"]').first()
  // The wait above removes the environments race; the retry covers the render
  // commit that follows the last answer, and re-clicks only while the dialog
  // is still closed so an open modal never eats a second click.
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.locator('[data-testid="new-profile-button"]').click()
    }
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  return dialog
}

/** Pick a profile Type in the open create dialog and wait for its seeded rows. */
export async function selectProfileType(
  page: Page,
  dialog: Locator,
  type: string,
  rowCount: number,
): Promise<void> {
  // The portaled type list is the listbox offering `custom`, which every type list has.
  const listbox = page
    .getByRole('listbox')
    .filter({ has: page.getByRole('option', { name: 'custom', exact: true }) })
  await expect(async () => {
    if (!(await listbox.isVisible())) {
      await dialog.locator('[data-testid="type-selector"]').click()
    }
    await expect(listbox).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await listbox.getByRole('option', { name: type, exact: true }).click()
  await expect(dialog.locator('tbody tr[data-parameter-id]')).toHaveCount(rowCount)
}

/** The database profile's ten fields, in the order the form renders them (SQL-14). */
export const DATABASE_PROFILE_FIELDS = [
  'host',
  'port',
  'database',
  'username',
  'password',
  'verify_ssl',
  'ca_cert',
  'client_cert',
  'client_key',
  'driver_options',
] as const

export type DatabaseProfileField = (typeof DATABASE_PROFILE_FIELDS)[number]

/** Open Create Profile and pick Type database, waiting for its ten rows. */
export async function openDatabaseProfileForm(page: Page): Promise<Locator> {
  const dialog = await openProfileCreateDialog(page)
  await selectProfileType(page, dialog, 'database', DATABASE_PROFILE_FIELDS.length)
  return dialog
}

/** Pick an environment in the open profile modal (it opens on the first one). */
export async function selectProfileModalEnvironment(
  page: Page,
  dialog: Locator,
  environmentName: string,
): Promise<void> {
  const selector = dialog.locator('[data-testid="env-selector"]')
  const popover = page.locator('[role="dialog"]').filter({ has: page.locator('[role="listbox"]') })
  await expect(async () => {
    await selector.click({ timeout: 5000 })
    await expect(popover).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15_000 })
  await popover.locator('[role="listbox"] button').filter({ hasText: environmentName }).first().click()
  await expect(popover).not.toBeVisible()
}

/** Open an existing profile's edit modal on one environment's values. */
export async function openProfileEditor(
  page: Page,
  profileName: string,
  environmentName: string,
): Promise<Locator> {
  await page.goto(`/profiles?search=${encodeURIComponent(profileName)}`)
  await page.waitForSelector('[data-testid="profiles-page"][aria-busy="false"]', { state: 'attached' })
  const row = page.locator('[data-testid="profile-row"]', { hasText: profileName })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.locator('[data-testid="action-edit"]').click()
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog.locator('tbody tr[data-parameter-id]').first()).toBeVisible({ timeout: 10_000 })
  await selectProfileModalEnvironment(page, dialog, environmentName)
  return dialog
}

/** Open the value sheet of the profile parameter named `field`. */
export async function openProfileFieldSheet(page: Page, dialog: Locator, field: string): Promise<Locator> {
  const rows = dialog.locator('tbody tr[data-parameter-id]')
  const total = await rows.count()
  for (let i = 0; i < total; i++) {
    if ((await rows.nth(i).locator('[aria-label="Parameter name"]').inputValue()) === field) {
      await rows.nth(i).locator('[data-testid^="param-edit-value-"]').click()
      const sheet = page.locator('[data-testid="value-editor-sheet"]')
      await expect(sheet).toBeVisible()
      return sheet
    }
  }
  throw new Error(`profile parameter "${field}" not found`)
}
