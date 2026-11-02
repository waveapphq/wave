/**
 * V-SETTINGS-SECTIONS-FUNCTIONAL: Settings section read failures, the Data folder row and Secret Masking
 *
 * Phase: functional-workflow. One section read at a time is forced to fail with
 * page.route; every other request reaches this stack's real backend. The Secret
 * Masking flags are settings of that backend, so the spec puts back the
 * flags it read before each test.
 * Design Decisions: LIST-5, LIST-20, WSRV-2, WSRV-10, SECREV-6, NET-1, NET-11, SETTINGS-18
 * REQ: REQ-3.7.2.6 (log level), REQ-4.7.13 (data folder), REQ-4.7.16 (staged Save)
 *
 * Pass Criteria:
 * 1. Log Level: with GET /admin/log-level answering an error envelope,
 *    Settings > General shows the heading "Logging" alone, with no Cancel and
 *    no Save on its line, and right under it one section error for the whole
 *    page - alert icon, exactly the API's reason and "Try Again" - and nothing
 *    else: no other heading, no select, no switch. With the route removed, Try
 *    Again reads again, the three headings show, Cancel and Save sit disabled
 *    on the Logging line, the Log Level select shows the level
 *    GET /admin/log-level reports, the four masking switches show, and the
 *    error is gone.
 * 2. Secret Masking: the same with GET /admin/secret-masking; the error reads
 *    exactly the API's reason under the heading "Logging"; after Try Again the
 *    four switches show the flags GET /admin/secret-masking reports, the Log
 *    Level select shows, and the error is gone.
 * 3. WAVE Server: the same with GET /server/status; a failed status poll keeps
 *    the error; after Try Again both server cards render with the backend port
 *    and data folder GET /server/status reports, and the error is gone.
 * 4. Data folder (WSRV-10): the Backend Server card's Data folder row shows the
 *    lock icon and exactly the absolute data_folder GET /server/status reports,
 *    in a monospace font; its copy button puts exactly that path on the
 *    clipboard.
 * 5. Secret Masking is staged (SETTINGS-18): switching "Reveal test variables"
 *    on enables Cancel and Save, sends no PUT /admin/secret-masking and leaves
 *    GET /admin/secret-masking reading false. Save sends one PUT carrying only
 *    that flag; the API reads true, Cancel and Save are disabled again, and
 *    after a reload the switch is on with the "Revealing" cue. Switching it
 *    off is staged the same way and Save stores false.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { apiPathMatcher, countApiFetches, failApiRoute } from '../../helpers/api-route'

const LOG_LEVEL_ROUTE = apiPathMatcher('/admin/log-level')
const MASKING_ROUTE = apiPathMatcher('/admin/secret-masking')
const SERVER_STATUS_ROUTE = apiPathMatcher('/server/status')

const LOG_LEVEL_REASON = 'Log level store unreadable: settings-sections E2E 4f1c'
const MASKING_REASON = 'Secret masking store unreadable: settings-sections E2E 8b2e'
const SERVER_REASON = 'Server status unreadable: settings-sections E2E 3d7a'

const MASKING_KEYS = {
  run_output: 'run-output',
  test_variables: 'test-variables',
  shared_variables: 'shared-variables',
  credential_inputs: 'credential-inputs',
} as const

type MaskingFlags = Record<keyof typeof MASKING_KEYS, boolean>

interface ServerStatusBody {
  backend: { port: number }
  data_folder: string
}

async function readMaskingFlags(page: Page): Promise<MaskingFlags> {
  const response = await page.request.get(`${BACKEND_URL}/admin/secret-masking`)
  expect(response.status(), 'GET /admin/secret-masking').toBe(200)
  const body = (await response.json()) as MaskingFlags
  return {
    run_output: body.run_output,
    test_variables: body.test_variables,
    shared_variables: body.shared_variables,
    credential_inputs: body.credential_inputs,
  }
}

async function writeMaskingFlags(page: Page, flags: MaskingFlags): Promise<void> {
  const response = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: flags })
  expect(response.status(), 'PUT /admin/secret-masking').toBe(200)
}

async function readServerStatus(page: Page): Promise<ServerStatusBody> {
  const response = await page.request.get(`${BACKEND_URL}/server/status`)
  expect(response.status(), 'GET /server/status').toBe(200)
  return (await response.json()) as ServerStatusBody
}

/** The shared section error: alert icon, exactly `message`, and a Try Again button. */
async function expectSectionError(card: Locator, message: string): Promise<void> {
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('role', 'alert')
  await expect(card.locator('svg.text-error'), 'the alert icon').toBeVisible()
  await expect(card.locator('p'), 'the card states exactly the API reason').toHaveText(message, {
    useInnerText: true,
  })
  await expect(card.getByRole('button')).toHaveCount(1)
  await expect(card.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible()
}

function isRead(matcher: (url: URL) => boolean) {
  return (response: { url(): string; request(): { method(): string } }) =>
    response.request().method() === 'GET' && matcher(new URL(response.url()))
}

function isMaskingWrite(response: { url(): string; request(): { method(): string } }): boolean {
  return response.request().method() === 'PUT' && MASKING_ROUTE(new URL(response.url()))
}

async function gotoGeneral(page: Page): Promise<void> {
  await page.goto('/settings')
  await page.waitForSelector('[data-testid="general-tab"]', { state: 'visible' })
}

/** A failed first read leaves the "Logging" heading alone, with the section error right under it. */
async function expectErrorAlone(tab: Locator): Promise<void> {
  const headings = tab.getByRole('heading')
  await expect(headings, 'the first heading is the only one').toHaveText(['Logging'])
  const headingLine = headings.locator('xpath=..')
  await expect(headingLine.getByRole('button'), 'no Cancel and no Save').toHaveCount(0)
  await expect(tab.locator(':scope > *'), 'the heading line and the error').toHaveCount(2)
  await expect(
    headingLine.locator('xpath=following-sibling::*[1]'),
    'the section error sits right under the heading line',
  ).toHaveAttribute('role', 'alert')
  await expect(tab.getByRole('combobox')).toHaveCount(0)
  await expect(tab.getByRole('switch')).toHaveCount(0)
  await expect(tab.getByRole('button'), 'Try Again is the only button').toHaveText(['Try Again'])
}

/** The loaded General page: its three headings, with Cancel and Save disabled on the Logging line. */
async function expectLoadedPage(page: Page, tab: Locator): Promise<void> {
  await expect(tab.getByRole('heading')).toHaveText(['Logging', 'Time Zone', 'Secret Masking'])
  await expect(headerButton(page, 'Cancel')).toBeDisabled()
  await expect(headerButton(page, 'Save')).toBeDisabled()
}

/** Cancel or Save on the Logging heading line; the pair covers the whole General page. */
function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return page
    .locator('[data-testid="general-tab"]')
    .getByRole('heading', { name: 'Logging', exact: true })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })
}

test.describe('V-SETTINGS-SECTIONS-FUNCTIONAL: section errors, Data folder, Secret Masking', () => {
  let originalMasking: MaskingFlags | undefined

  test.beforeEach(async ({ page }) => {
    originalMasking = await readMaskingFlags(page)
  })

  test.afterEach(async ({ page }) => {
    if (originalMasking) await writeMaskingFlags(page, originalMasking)
  })

  test('Log Level: a failed read shows one page error with the reason and Try Again loads the real level', async ({
    page,
  }) => {
    const levelResponse = await page.request.get(`${BACKEND_URL}/admin/log-level`)
    expect(levelResponse.status()).toBe(200)
    const { level } = (await levelResponse.json()) as { level: string }

    await failApiRoute(page, LOG_LEVEL_ROUTE, { detail: LOG_LEVEL_REASON })
    await gotoGeneral(page)

    const tab = page.locator('[data-testid="general-tab"]')
    const card = tab.getByRole('alert')

    await test.step('1. one section error for the whole page states exactly the API reason', async () => {
      await expect(card).toHaveCount(1)
      await expectSectionError(card, LOG_LEVEL_REASON)
      await expectErrorAlone(tab)
    })

    await test.step('1. route removed, Try Again shows the real level and drops the error', async () => {
      await page.unroute(LOG_LEVEL_ROUTE)
      await Promise.all([
        page.waitForResponse((r) => isRead(LOG_LEVEL_ROUTE)(r) && r.status() === 200),
        card.getByRole('button', { name: 'Try Again', exact: true }).click(),
      ])
      await expect(tab.locator('[data-testid="log-level-select"]')).toHaveText(level)
      await expect(tab.getByRole('switch')).toHaveCount(4)
      await expect(card).toHaveCount(0)
      await expectLoadedPage(page, tab)
    })
  })

  test('Secret Masking: a failed read shows one page error with the reason and Try Again loads the real flags', async ({
    page,
  }) => {
    await failApiRoute(page, MASKING_ROUTE, { detail: MASKING_REASON })
    await gotoGeneral(page)

    const tab = page.locator('[data-testid="general-tab"]')
    const card = tab.getByRole('alert')

    await test.step('2. one section error for the whole page states exactly the API reason', async () => {
      await expect(card).toHaveCount(1)
      await expectSectionError(card, MASKING_REASON)
      await expectErrorAlone(tab)
    })

    await test.step('2. route removed, Try Again shows the stored flags and drops the error', async () => {
      await page.unroute(MASKING_ROUTE)
      await Promise.all([
        page.waitForResponse((r) => isRead(MASKING_ROUTE)(r) && r.status() === 200),
        card.getByRole('button', { name: 'Try Again', exact: true }).click(),
      ])
      await expect(card).toHaveCount(0)
      const flags = await readMaskingFlags(page)
      await expect(tab.getByRole('switch')).toHaveCount(4)
      for (const [flag, testKey] of Object.entries(MASKING_KEYS)) {
        await expect(
          page.locator(`[data-testid="masking-${testKey}-toggle"]`),
          `${flag} shows the stored flag`,
        ).toHaveAttribute('data-state', flags[flag as keyof MaskingFlags] ? 'checked' : 'unchecked')
      }
      await expect(tab.locator('[data-testid="log-level-select"]')).toBeVisible()
      await expectLoadedPage(page, tab)
    })
  })

  test('WAVE Server: a failed read shows the reason and Try Again loads the real server facts', async ({
    page,
  }) => {
    const status = await readServerStatus(page)

    await failApiRoute(page, SERVER_STATUS_ROUTE, { detail: SERVER_REASON })
    await page.goto('/settings/server')
    await page.waitForSelector('[data-testid="wave-server-tab"]', { state: 'visible' })

    const card = page.locator('[data-testid="wave-server-error"]')
    const backendCard = page.locator('[data-testid="server-card-backend"]')

    await test.step('3. the section error states exactly the API reason', async () => {
      await expectSectionError(card, SERVER_REASON)
      await expect(backendCard).toHaveCount(0)
    })

    await test.step('3. a failed status poll keeps the error', async () => {
      const poll = await page.waitForResponse(isRead(SERVER_STATUS_ROUTE), { timeout: 15_000 })
      expect(poll.status()).toBe(500)
      await expectSectionError(card, SERVER_REASON)
    })

    // The next poll is about five seconds away, so Try Again is the read that recovers the section.
    await test.step('3. route removed, Try Again shows the real cards and drops the error', async () => {
      await page.unroute(SERVER_STATUS_ROUTE)
      await Promise.all([
        page.waitForResponse((r) => isRead(SERVER_STATUS_ROUTE)(r) && r.status() === 200),
        card.getByRole('button', { name: 'Try Again', exact: true }).click(),
      ])
      await expect(card).toHaveCount(0)
      await expect(page.locator('[data-testid="server-card-frontend"]')).toBeVisible()
      await expect(backendCard).toContainText('Backend Server')
      await expect(
        backendCard.getByText(String(status.backend.port), { exact: true }),
        'the Port fact shows the real backend port',
      ).toBeVisible()
      await expect(
        backendCard
          .locator('[data-testid="server-data-folder"]')
          .getByText(status.data_folder, { exact: true }),
      ).toBeVisible()
    })
  })

  test('Data folder: the Backend Server card shows the real data folder and copies it', async ({
    page,
  }) => {
    const { data_folder: dataFolder } = await readServerStatus(page)
    expect(dataFolder, 'GET /server/status names an absolute data folder').toMatch(/^\//)

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/settings/server')
    const backendCard = page.locator('[data-testid="server-card-backend"]')
    await expect(backendCard).toBeVisible()

    const row = backendCard.locator('[data-testid="server-data-folder"]')
    const value = row.getByText(dataFolder, { exact: true })

    await test.step('4. lock icon, label and exactly the real path in mono', async () => {
      await expect(page.locator('[data-testid="server-data-folder"]')).toHaveCount(1)
      await expect(row).toContainText('Data folder')
      await expect(row.locator('svg.lucide-lock')).toBeVisible()
      await expect(value).toBeVisible()
      const fontFamily = await value.evaluate((el) => getComputedStyle(el).fontFamily)
      expect(fontFamily, 'the path is set in the monospace font').toMatch(/mono/i)
    })

    await test.step('4. the copy button copies exactly that path', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''))
      const copy = row.getByRole('button', { name: 'Copy Data folder', exact: true })
      await copy.click()
      await expect(copy).toHaveAttribute('data-copied', 'true')
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toBe(dataFolder)
    })
  })

  test('Secret Masking: a reveal switch is staged, Save stores it, and it survives a reload', async ({
    page,
  }) => {
    await writeMaskingFlags(page, { ...originalMasking!, test_variables: false })
    await gotoGeneral(page)

    const toggle = page.locator('[data-testid="masking-test-variables-toggle"]')
    const cancel = headerButton(page, 'Cancel')
    const save = headerButton(page, 'Save')
    const maskingWrites = countApiFetches(page, MASKING_ROUTE, 'PUT')

    await expect(toggle).toHaveAttribute('data-state', 'unchecked')
    await expect(cancel).toBeDisabled()
    await expect(save).toBeDisabled()

    await test.step('5. switching on is staged: nothing is sent and nothing is stored', async () => {
      await toggle.click()
      await expect(toggle).toHaveAttribute('data-state', 'checked')
      await expect(cancel).toBeEnabled()
      await expect(save).toBeEnabled()
      expect((await readMaskingFlags(page)).test_variables).toBe(false)
      expect(maskingWrites(), 'no PUT /admin/secret-masking before Save').toBe(0)
    })

    await test.step('5. Save sends the staged flag alone and the API stores it', async () => {
      const [write] = await Promise.all([page.waitForResponse(isMaskingWrite), save.click()])
      expect(write.status(), 'PUT /admin/secret-masking').toBe(200)
      expect(write.request().postDataJSON()).toEqual({ test_variables: true })
      await expect(save).toBeDisabled()
      await expect(cancel).toBeDisabled()
      await expect(toggle).toHaveAttribute('data-state', 'checked')
      expect((await readMaskingFlags(page)).test_variables).toBe(true)
      expect(maskingWrites(), 'the click sent nothing; Save sent one PUT').toBe(1)
    })

    await test.step('5. the stored state survives a reload', async () => {
      await page.reload()
      await page.waitForSelector('[data-testid="general-tab"]', { state: 'visible' })
      await expect(toggle).toHaveAttribute('data-state', 'checked')
      await expect(page.locator('[data-testid="masking-test-variables-revealing"]')).toBeVisible()
      await expect(save).toBeDisabled()
    })

    await test.step('5. switching off is staged, and Save stores false', async () => {
      await toggle.click()
      await expect(toggle).toHaveAttribute('data-state', 'unchecked')
      await expect(save).toBeEnabled()
      expect((await readMaskingFlags(page)).test_variables).toBe(true)
      expect(maskingWrites(), 'no PUT /admin/secret-masking before the second Save').toBe(1)

      const [write] = await Promise.all([page.waitForResponse(isMaskingWrite), save.click()])
      expect(write.status(), 'PUT /admin/secret-masking').toBe(200)
      expect(write.request().postDataJSON()).toEqual({ test_variables: false })
      await expect(save).toBeDisabled()
      await expect(toggle).toHaveAttribute('data-state', 'unchecked')
      expect((await readMaskingFlags(page)).test_variables).toBe(false)
    })
  })
})
