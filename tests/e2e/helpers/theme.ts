/** Switches the app between the light and the dark theme through the shell's own toggle. */

import { expect, type Page } from './playwright-fixtures'

/** Clicks the theme toggle, waits for the page to carry the other theme, and returns it. */
export async function toggleTheme(page: Page): Promise<'light' | 'dark'> {
  const html = page.locator('html')
  const before = await html.getAttribute('data-theme')
  const name = before === 'dark' ? /switch to light mode/i : /switch to dark mode/i
  await page.getByRole('button', { name }).first().click()
  const after = before === 'dark' ? 'light' : 'dark'
  await expect(html).toHaveAttribute('data-theme', after)
  return after
}
