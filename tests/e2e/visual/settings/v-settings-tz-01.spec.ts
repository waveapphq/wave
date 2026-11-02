/**
 * V-SETTINGS-TZ-01: User-selectable Time Zone preference
 *
 * The Time Zone section sits beneath Logging.
 * Design Decisions: SETTINGS-14, SETTINGS-18, SETTINGS-20, SETTINGS-22
 * REQ: REQ-5.2.1.42, REQ-4.7.16
 *
 * Pass Criteria:
 * 1. Settings/General renders the Time Zone section: header "Time Zone", the one
 *    subtitle "How timestamps are shown in this browser.", and a row that is the
 *    label "Time Zone" and a select with no help line, with two options
 *    Browser local (default) and UTC.
 * 2. Save applies the selected zone in both directions and shows no toast: the
 *    picker keeps the zone and Cancel and Save disable again.
 * 3. A saved choice persists to localStorage under key `wave.timezone` and
 *    survives a full page reload.
 * 4. A selection without Save changes nothing: `wave.timezone` stays unset, a
 *    reload shows the saved zone again, and Cancel restores the saved zone.
 * 5. A `storage` event from another tab updates the picker (cross-tab sync).
 * 6. About > Build Date follows the saved preference: a discarded selection
 *    leaves it in the browser zone.
 *
 * No fixture needed - the General tab and the About tab read live system
 * info from the running backend; no entity seeding required.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'

// Pin the chromium browser to a non-UTC zone so the Browser-local vs UTC
// rendering is observably different. Without this the host machine's TZ
// (often UTC in CI) makes Browser local and UTC produce identical output.
test.use({ timezoneId: 'America/Los_Angeles' })

const TIMEZONE_KEY = 'wave.timezone'
const TIME_ZONE_SUBTITLE = 'How timestamps are shown in this browser.'
const STORED_VALUE = { 'Browser local': 'local', UTC: 'utc' } as const

type ZoneLabel = keyof typeof STORED_VALUE

function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return page.getByTestId('general-tab').getByRole('button', { name, exact: true })
}

/** Cancel and Save show only once the first read has answered. */
async function waitForGeneralLoaded(page: Page) {
  await page.waitForSelector('[data-testid="general-tab"]', { state: 'visible' })
  await expect(headerButton(page, 'Save')).toBeVisible()
}

async function gotoGeneral(page: Page) {
  await page.goto('/settings')
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
  await waitForGeneralLoaded(page)
}

async function getStoredTimezone(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), TIMEZONE_KEY)
}

async function clearStoredTimezone(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.removeItem(key), TIMEZONE_KEY)
}

async function selectZone(page: Page, zone: ZoneLabel): Promise<void> {
  await page.locator('[data-testid="timezone-select"]').click()
  await page.getByRole('option', { name: zone }).click()
}

async function expectClean(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    await expect(headerButton(page, name), `${name} is disabled while clean`).toBeDisabled()
    await expect(headerButton(page, name), `${name} is faded while clean`).toHaveCSS('opacity', '0.5')
  }
}

async function expectDirty(page: Page): Promise<void> {
  await expect(headerButton(page, 'Cancel')).toBeEnabled()
  await expect(headerButton(page, 'Save')).toBeEnabled()
}

/** Selects a zone and saves it; returns once the browser holds the choice. */
async function saveZone(page: Page, zone: ZoneLabel): Promise<void> {
  await selectZone(page, zone)
  await expectDirty(page)
  await headerButton(page, 'Save').click()
  await expect.poll(async () => getStoredTimezone(page)).toBe(STORED_VALUE[zone])
  await expectClean(page)
}

test.describe('V-SETTINGS-TZ-01: Time Zone picker rendering', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGeneral(page)
    await clearStoredTimezone(page)
    await page.reload()
    await waitForGeneralLoaded(page)
  })

  test('S1: section header, the one subtitle, and a label-only select row are visible', async ({ page }) => {
    const section = page.locator('[data-testid="timezone-section"]')
    await expect(section, 'Time Zone section visible').toBeVisible()
    await expect(
      section.getByRole('heading', { level: 2, name: /^Time Zone$/ }),
      'Section heading text',
    ).toBeVisible()
    await expect(
      section.locator('p'),
      'The subtitle is the only text line of the section (SETTINGS-20, SETTINGS-22)',
    ).toHaveText([TIME_ZONE_SUBTITLE])
    await expect(section.locator('label'), 'The row label').toHaveText(['Time Zone'])
    const trigger = page.locator('[data-testid="timezone-select"]')
    await expect(trigger, 'Picker trigger present').toBeVisible()
    await expect(
      section.getByRole('combobox', { name: 'Time Zone', exact: true }),
      'The label names the picker',
    ).toHaveAttribute('data-testid', 'timezone-select')
    await expect(trigger, 'No help line describes the picker').not.toHaveAttribute('aria-describedby')
  })

  test('S2: default selection is Browser local', async ({ page }) => {
    const trigger = page.locator('[data-testid="timezone-select"]')
    await expect(trigger, 'Picker shows the Browser local label by default').toContainText(
      /Browser local/i,
    )
  })

  test('S3: opening the dropdown shows both options', async ({ page }) => {
    await page.locator('[data-testid="timezone-select"]').click()
    await expect(
      page.getByRole('option', { name: 'Browser local' }),
      'Browser local option present',
    ).toBeVisible()
    await expect(
      page.getByRole('option', { name: 'UTC' }),
      'UTC option present',
    ).toBeVisible()
  })

  test('S4: Time Zone row sits beneath Logging row', async ({ page }) => {
    const log = page.locator('[data-testid="log-level-section"]')
    const tz = page.locator('[data-testid="timezone-section"]')
    const logBox = await log.boundingBox()
    const tzBox = await tz.boundingBox()
    expect(logBox).toBeTruthy()
    expect(tzBox).toBeTruthy()
    expect(tzBox!.y, 'Time Zone section is below Logging section').toBeGreaterThan(logBox!.y)
  })
})

test.describe('V-SETTINGS-TZ-01: Save applies the selection without a toast', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGeneral(page)
    await clearStoredTimezone(page)
    await page.reload()
    await waitForGeneralLoaded(page)
  })

  test('S5: saving UTC shows no toast; the picker keeps UTC and Cancel and Save disable again', async ({
    page,
  }) => {
    await expectClean(page)
    await saveZone(page, 'UTC')
    await expect(page.locator('[data-toast]'), 'A successful Save shows no toast (SETTINGS-18)').toHaveCount(0)
    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'Picker trigger reflects the saved value',
    ).toContainText(/^UTC$/i)
  })

  test('S6: saving Browser local again shows no toast and the picker keeps Browser local', async ({
    page,
  }) => {
    // Start in UTC
    await saveZone(page, 'UTC')
    // Now flip back
    await saveZone(page, 'Browser local')
    await expect(page.locator('[data-toast]'), 'A successful Save shows no toast (SETTINGS-18)').toHaveCount(0)
    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'Picker trigger reflects the saved value',
    ).toContainText(/Browser local/i)
  })
})

test.describe('V-SETTINGS-TZ-01: Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await gotoGeneral(page)
    await clearStoredTimezone(page)
    await page.reload()
    await waitForGeneralLoaded(page)
  })

  test('S7: a saved selection writes wave.timezone=utc to localStorage', async ({ page }) => {
    await selectZone(page, 'UTC')
    await headerButton(page, 'Save').click()
    await expect
      .poll(async () => getStoredTimezone(page))
      .toBe('utc')
  })

  test('S8: a saved choice survives a full page reload', async ({ page }) => {
    await saveZone(page, 'UTC')
    await page.reload()
    await waitForGeneralLoaded(page)
    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'Picker rehydrates UTC from localStorage on reload',
    ).toContainText(/^UTC$/i)
    await expectClean(page)
  })

  test('S9: saving Browser local again persists wave.timezone=local to localStorage', async ({ page }) => {
    await saveZone(page, 'UTC')
    await selectZone(page, 'Browser local')
    await headerButton(page, 'Save').click()
    await expect.poll(async () => getStoredTimezone(page)).toBe('local')
  })

  test('S13: a selection without Save writes nothing and is gone after a reload', async ({ page }) => {
    await selectZone(page, 'UTC')
    await expect(page.locator('[data-testid="timezone-select"]')).toContainText(/^UTC$/i)
    await expectDirty(page)
    expect(await getStoredTimezone(page), 'A staged zone is not stored').toBeNull()

    await page.reload()
    await waitForGeneralLoaded(page)
    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'The picker shows the saved zone again',
    ).toContainText(/Browser local/i)
    expect(await getStoredTimezone(page)).toBeNull()
    await expectClean(page)
  })

  test('S14: Cancel restores the saved zone and stores nothing', async ({ page }) => {
    await saveZone(page, 'UTC')
    await selectZone(page, 'Browser local')
    await expect(page.locator('[data-testid="timezone-select"]')).toContainText(/Browser local/i)
    await expectDirty(page)

    await headerButton(page, 'Cancel').click()
    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'Cancel brings the saved zone back',
    ).toContainText(/^UTC$/i)
    await expectClean(page)
    expect(await getStoredTimezone(page), 'The saved zone is untouched').toBe('utc')
  })
})

test.describe('V-SETTINGS-TZ-01: Cross-tab sync', () => {
  test('S10: a storage event from another tab flips the picker', async ({ page }) => {
    await gotoGeneral(page)
    await clearStoredTimezone(page)
    await page.reload()
    await waitForGeneralLoaded(page)

    // Default is Browser local
    await expect(page.locator('[data-testid="timezone-select"]')).toContainText(
      /Browser local/i,
    )

    // Simulate another tab writing to localStorage and dispatching the storage event.
    // The store's initializeFromStorage attaches a listener at mount time.
    await page.evaluate((key) => {
      window.localStorage.setItem(key, 'utc')
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          newValue: 'utc',
          oldValue: 'local',
          storageArea: window.localStorage,
        }),
      )
    }, TIMEZONE_KEY)

    await expect(
      page.locator('[data-testid="timezone-select"]'),
      'Picker reflects the value written by the other tab',
    ).toContainText(/^UTC$/i)
  })
})

test.describe('V-SETTINGS-TZ-01: About > Build Date follows preference', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/about')
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="about-tab"]', { state: 'visible' })
    await clearStoredTimezone(page)
    await page.reload()
    await page.waitForSelector('[data-testid="about-tab"]', { state: 'visible' })
  })

  test('S15: a discarded UTC selection leaves Build Date in the browser zone', async ({ page }) => {
    const buildDate = page.locator('[data-testid="build-date"]')
    await expect(buildDate).toBeVisible()
    const localText = (await buildDate.textContent()) ?? ''
    expect(localText, 'Browser local does not say "UTC"').not.toMatch(/\bUTC$/)

    await page.locator('[data-testid="settings-nav-general"]').click()
    await waitForGeneralLoaded(page)
    await selectZone(page, 'UTC')
    await expectDirty(page)

    // Leaving with a staged zone asks first; Discard drops it.
    await page.locator('[data-testid="settings-nav-about"]').click()
    await expect(page.getByTestId('leave-unsaved-dialog')).toBeVisible()
    await page.getByTestId('leave-unsaved-discard').click()
    await page.waitForSelector('[data-testid="about-tab"]', { state: 'visible' })

    await expect(buildDate, 'Build Date keeps the browser zone').toHaveText(localText)
    expect(await getStoredTimezone(page), 'A discarded zone is not stored').toBeNull()
  })
})
