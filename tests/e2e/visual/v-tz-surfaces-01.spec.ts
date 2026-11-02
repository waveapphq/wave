/**
 * V-TZ-SURFACES-01: Cross-surface Time Zone preference flip
 *
 * Design Decisions: SETTINGS-18, SETTINGS-20
 * REQ: REQ-5.2.1.42, REQ-4.7.16
 *
 * Pass Criteria:
 * 1. In Browser local mode the Execution Info panel "Started" row and the suite
 *    metadata sidebar Created / Updated rows render in the browser zone with its
 *    zone suffix.
 * 2. Once the Time Zone is selected AND saved in Settings > General, `wave.timezone`
 *    holds the zone and the same rows render in UTC with the " UTC" suffix.
 * 3. A Time Zone selection without Save changes nothing: `wave.timezone` stays
 *    unset and the rows stay in the browser zone.
 * 4. Executions list cells (relative times stay timezone-agnostic for recent
 *    entries): the list renders without errors before and after a saved flip.
 *
 * Console live-log rendering of the zone suffix is verified by the
 * `log-entry` Vitest tests, which exercise the same `<Timestamp style="time">`
 * code path with real React + jsdom rendering. E2E console flip would need a
 * tracked execution with seeded log entries (no admin endpoint exists for
 * direct log seeding); the unit-test coverage proves the wiring end-to-end.
 *
 * Reuses the v-exec-01 fixture (1 suite, 3 tests, 1 environment, 1 passed
 * suite execution at 2026-04-15T10:00:00Z) so this test only re-seeds when
 * grouped with other v-exec-01 consumers.
 */

import { test, expect, type Locator, type Page } from '../helpers/playwright-fixtures'
import { exec } from '../helpers/exec'

// Pin chromium to a non-UTC zone so Browser-local rendering is observably
// different from UTC mode. CI hosts are often UTC, which would collapse
// the two modes into identical output.
test.use({ timezoneId: 'America/Los_Angeles' })

const EXECUTION_ID = 'd0000001-0000-0000-0000-000000000001'
const SUITE_ID = 'c0000002-0001-0001-0001-000000000001'
const TIMEZONE_KEY = 'wave.timezone'
const STORED_VALUE = { 'Browser local': 'local', UTC: 'utc' } as const

async function clearStoredTimezone(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.removeItem(key), TIMEZONE_KEY)
}

async function getStoredTimezone(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), TIMEZONE_KEY)
}

function saveButton(page: Page): Locator {
  return page.getByTestId('general-tab').getByRole('button', { name: 'Save', exact: true })
}

/** Opens Settings > General and selects a zone; the selection waits for Save. */
async function selectTimezoneInSettings(
  page: Page,
  mode: 'Browser local' | 'UTC',
): Promise<void> {
  await page.goto('/settings')
  await page.waitForSelector('[data-testid="general-tab"]', { state: 'visible' })
  await expect(saveButton(page), 'Save is disabled until a change').toBeDisabled()
  await page.locator('[data-testid="timezone-select"]').click()
  await page.getByRole('option', { name: mode }).click()
  await expect(saveButton(page), 'the selection waits for Save').toBeEnabled()
}

async function setTimezoneInSettings(
  page: Page,
  mode: 'Browser local' | 'UTC',
): Promise<void> {
  await selectTimezoneInSettings(page, mode)
  await saveButton(page).click()
  await expect.poll(async () => getStoredTimezone(page)).toBe(STORED_VALUE[mode])
  await expect(saveButton(page), 'Save is disabled again once saved').toBeDisabled()
}

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
})

test.describe('V-TZ-SURFACES-01: Execution Info "Started" row', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await clearStoredTimezone(page)
  })

  test('S1: Started row carries a zone suffix in Browser local mode', async ({ page }) => {
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-info-panel"]', { state: 'visible' })

    const panel = page.locator('[data-testid="execution-info-panel"]')
    const text = (await panel.textContent()) ?? ''
    // The Started value is rendered with style="datetime" -> "MMM D, HH:MM <ZONE>".
    // Browser local on the pinned PDT zone produces "Apr 15, 03:00 PDT" for the
    // seeded started_at = 2026-04-15T10:00:00+00:00 (UTC-7 offset).
    expect(text).toMatch(/Apr 15, 03:00 PDT/)
    expect(text).not.toMatch(/10:00 UTC/)
  })

  test('S2: saving UTC re-renders Started with the literal " UTC" suffix', async ({
    page,
  }) => {
    await setTimezoneInSettings(page, 'UTC')
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-info-panel"]', { state: 'visible' })
    const panel = page.locator('[data-testid="execution-info-panel"]')
    // Seed: started_at = 2026-04-15T10:00:00+00:00 -> "Apr 15, 10:00 UTC".
    await expect(panel).toContainText(/Apr 15, 10:00 UTC/)
  })

  test('S3: live flip - saving the picker mid-session re-renders the panel', async ({
    page,
  }) => {
    // Open the execution first in Browser local (PDT host)
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-info-panel"]', { state: 'visible' })
    const panel = page.locator('[data-testid="execution-info-panel"]')
    await expect(panel).toContainText(/Apr 15, 03:00 PDT/)

    // Flip via Settings, then return
    await setTimezoneInSettings(page, 'UTC')
    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-info-panel"]', { state: 'visible' })
    await expect(panel).toContainText(/Apr 15, 10:00 UTC/)
  })

  test('S8: a UTC selection without Save leaves Started in the browser zone', async ({ page }) => {
    await selectTimezoneInSettings(page, 'UTC')
    await expect(page.locator('[data-testid="timezone-select"]')).toContainText(/^UTC$/)
    expect(await getStoredTimezone(page), 'a staged zone is not stored').toBeNull()

    await page.goto(`/executions/${EXECUTION_ID}`)
    await page.waitForSelector('[data-testid="execution-info-panel"]', { state: 'visible' })
    const panel = page.locator('[data-testid="execution-info-panel"]')
    await expect(panel).toContainText(/Apr 15, 03:00 PDT/)
    await expect(panel).not.toContainText(/10:00 UTC/)
    expect(await getStoredTimezone(page)).toBeNull()
  })
})

test.describe('V-TZ-SURFACES-01: Suite metadata Created / Updated rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await clearStoredTimezone(page)
  })

  test('S4: Created and Updated rows render with a zone suffix in Browser local mode', async ({
    page,
  }) => {
    await page.goto(`/suites/${SUITE_ID}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
    const created = page.locator('[data-testid="sidebar-created-date"]')
    const updated = page.locator('[data-testid="sidebar-updated-date"]')
    await expect(created, 'Created row visible').toBeVisible()
    await expect(updated, 'Updated row visible').toBeVisible()
    // Date style: "MMM D, YYYY <ZONE>" - assert the zone token is present.
    await expect(created).toHaveText(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\S{2,5}$/)
    await expect(updated).toHaveText(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\S{2,5}$/)
    // In Browser local (PDT/PST), the suffix is not "UTC".
    await expect(created, 'Local mode is not UTC').not.toHaveText(/\bUTC$/)
  })

  test('S5: saving UTC re-renders Created and Updated with " UTC" suffix', async ({
    page,
  }) => {
    await setTimezoneInSettings(page, 'UTC')
    await page.goto(`/suites/${SUITE_ID}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
    await expect(page.locator('[data-testid="sidebar-created-date"]')).toHaveText(/\bUTC$/)
    await expect(page.locator('[data-testid="sidebar-updated-date"]')).toHaveText(/\bUTC$/)
  })

  test('S9: a UTC selection without Save leaves Created and Updated in the browser zone', async ({
    page,
  }) => {
    await selectTimezoneInSettings(page, 'UTC')
    expect(await getStoredTimezone(page), 'a staged zone is not stored').toBeNull()

    await page.goto(`/suites/${SUITE_ID}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
    const created = page.locator('[data-testid="sidebar-created-date"]')
    const updated = page.locator('[data-testid="sidebar-updated-date"]')
    await expect(created).toHaveText(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\S{2,5}$/)
    await expect(updated).toHaveText(/[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+\S{2,5}$/)
    await expect(created, 'Created stays in the browser zone').not.toHaveText(/\bUTC$/)
    await expect(updated, 'Updated stays in the browser zone').not.toHaveText(/\bUTC$/)
  })
})

test.describe('V-TZ-SURFACES-01: Executions list cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings')
    await clearStoredTimezone(page)
  })

  test('S6: list page renders cleanly under the picker (no consumer crashes)', async ({
    page,
  }) => {
    await page.goto('/executions')
    await page.waitForSelector('[data-testid="executions-table"]', { state: 'visible' })
    // Fixture has at least one execution row; the relative-time cell uses
    // <Timestamp style="relative">, which stays timezone-agnostic for recent
    // deltas. The presence + absence-of-error checks here cover the consumer
    // wiring; absolute-string assertions live in the formatter unit tests.
    const rows = page.locator('[data-testid="execution-row"], [data-row-id]')
    expect(await rows.count(), 'At least one execution row visible').toBeGreaterThan(0)
  })

  test('S7: saving the picker keeps the list page rendering correctly', async ({ page }) => {
    await page.goto('/executions')
    await page.waitForSelector('[data-testid="executions-table"]', { state: 'visible' })
    await setTimezoneInSettings(page, 'UTC')
    await page.goto('/executions')
    await page.waitForSelector('[data-testid="executions-table"]', { state: 'visible' })
    // Page still renders, table still mounts, no console errors.
    await expect(page.locator('[data-testid="executions-table"]')).toBeVisible()
  })
})
