/** What a Shared Function Block's window shows of the library Function it came from (REQ-3.1.1.5). */

import { expect, type Locator, type Page } from './playwright-fixtures'

/** The window's From library link, its Changelog and Documentation dialogs and the library it opens all name `name`;
 *  a read-only window has no link, so there only the two dialogs name it. */
export async function expectLibraryName(page: Page, sheet: Locator, name: string, readOnly = false): Promise<void> {
  const link = sheet.locator('[data-testid="function-from-library-link"]')
  if (readOnly) await expect(link, 'the read-only window has no From library link').toHaveCount(0)
  else await expect(link).toHaveText(`From library: ${name}`)

  await sheet.locator('[data-testid="function-changelog-button"]').click()
  const changelog = page.getByRole('dialog', { name: `${name} - Changelog`, exact: true })
  await expect(changelog).toBeVisible()
  await changelog.getByRole('button', { name: 'Close' }).first().click()
  await expect(changelog).toHaveCount(0)

  await sheet.locator('[data-testid="function-details-button"]').click()
  const details = page.getByRole('dialog', { name: `${name} - Documentation`, exact: true })
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: 'Close' }).first().click()
  await expect(details).toHaveCount(0)

  if (readOnly) return
  await link.click()
  const library = page.locator('[data-testid="functions-library"]')
  await expect(library).toBeVisible({ timeout: 10_000 })
  await expect(
    library.locator('textarea[aria-label="Search Functions"], input[aria-label="Search Functions"]').first(),
    'the library opens on the library name',
  ).toHaveValue(name)
  await library.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(library).toHaveCount(0)
}

/** With the library Function gone, the window's banner names it. */
export async function expectMissingBanner(sheet: Locator, name: string): Promise<void> {
  const banner = sheet.locator('[data-testid="missing-function-banner"]')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toContainText(`Function '${name}' is no longer available in the library`)
}
