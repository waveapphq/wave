/**
 * V-WAVE-SERVER-01: Settings > WAVE Server section
 *
 * Phase: no-data (parallel) - the browser-session roster (3 sessions with
 * distinct roles) cannot be produced from a single browser, so GET
 * /server/status is intercepted (rawResponse payload) and the browser's own
 * session ids are seeded into localStorage so the "You" marker renders. No DB.
 * Criterion 9 alone reads the live GET /server/status of this stack's backend.
 * Design Decisions: WSRV-1..11
 * REQ: REQ-5.2.7.15, REQ-4.7.13, REQ-4.7.15
 *
 * Pass Criteria:
 * 1. Settings nav shows a "WAVE Server" entry with the Server icon between
 *    MCP Server and Backup (seven section entries plus the collapsed Network
 *    group, 8 nav buttons); clicking it opens
 *    /settings/server with the section rendered (WSRV-1).
 * 2. Two read-only fact cards render: Frontend Server ("serves the WAVE
 *    interface") and Backend Server ("handles the API and live sessions",
 *    with the connected-session count). Neither card exposes an input
 *    (textbox/combobox); Port + Bind scope are shown as read-only facts
 *    (WSRV-2, WSRV-3).
 * 3. The Workbench Sessions roster lists one row per session, the holder row
 *    reads "Active" and the mirror rows read "Watching", and Disconnect
 *    Others / Disconnect All sit at the section header (WSRV-3..8).
 * 4. Every session this browser opened is marked "You" (browser-scoped: both
 *    of this browser's rows read You; the other browser's row does not)
 *    (WSRV-5).
 * 5. Per-row Disconnect is confirmation-gated: clicking Disconnect opens a
 *    confirm dialog; Cancel is a no-op and the row survives (WSRV-5).
 * 6. Arriving via ?session=<id> rings + scrolls to that row and labels it by
 *    its role (Active); the WAVE Server roster carries NO "From your
 *    workbench" chip (that chip is MCP-only) (WSRV-9).
 * 7. The Backend Server card shows a "Data folder" row under Port / Bind
 *    scope, left-aligned with Port: label, lock icon, the path in the
 *    monospace font and a copy icon button; the Frontend card has none
 *    (WSRV-10).
 * 8. The Backend Server card shows a "Config file" row directly under the
 *    Data folder row and left-aligned with it, in the same pattern: label,
 *    lock icon, the absolute path in the monospace font and a copy icon
 *    button; the Frontend card has none. The row keeps the pattern in the
 *    other theme (flipped from the sidebar), and its copy button puts
 *    exactly the path on the clipboard (WSRV-11).
 * 9. On the live backend the Config file row shows exactly the config_file
 *    GET /server/status reports, an absolute path that is not
 *    backend/config/config.yaml, and its copy button copies that path
 *    (WSRV-11, REQ-4.7.15).
 */

import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { stackPaths } from '../../helpers/config-file'
import { toggleTheme } from '../../helpers/theme'

// A holder + two same-browser mirror tabs + (implicitly) the holder is a third
// browser. The two OWN ids share this browser, so both must read "You".
const HOLDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OWN_ID = '11111111-1111-1111-1111-111111111111'
const OWN_ID_2 = '22222222-2222-2222-2222-222222222222'
const DATA_FOLDER = '/srv/wave/data'
const CONFIG_FILE = '/srv/wave/config/config.yaml'

function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

const SERVER_STATUS = {
  frontend: {
    running: true,
    urls: ['http://localhost:3000'],
    port: 3000,
    bind: 'local',
  },
  backend: {
    running: true,
    urls: ['http://192.0.2.20:8000', 'http://127.0.0.1:8000'],
    port: 8000,
    bind: 'network',
  },
  session_count: 3,
  sessions: [
    {
      session_id: HOLDER_ID,
      client: 'Firefox (Windows)',
      ip: '10.0.0.42',
      connected_at: isoAgo(24 * 60_000),
      last_activity: isoAgo(90_000),
    },
    {
      session_id: OWN_ID,
      client: 'Chrome (macOS)',
      ip: '192.0.2.20',
      connected_at: isoAgo(11 * 60_000),
      last_activity: isoAgo(2_000),
    },
    {
      session_id: OWN_ID_2,
      client: 'Chrome (macOS)',
      ip: '192.0.2.20',
      connected_at: isoAgo(4 * 60_000),
      last_activity: isoAgo(30_000),
    },
  ],
  active_session_id: HOLDER_ID,
  watching_session_ids: [OWN_ID, OWN_ID_2],
  data_folder: DATA_FOLDER,
  config_file: CONFIG_FILE,
}

async function seedAndMock(page: Page) {
  await page.addInitScript(
    (ids) => {
      try {
        globalThis.localStorage.setItem('wave.own-session-ids', JSON.stringify(ids))
      } catch {
        /* localStorage may be unavailable; the You marker just won't show */
      }
    },
    [OWN_ID, OWN_ID_2],
  )
  await page.route(
    (url) => url.pathname === '/server/status',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: SERVER_STATUS })
        : route.continue(),
  )
}

async function gotoServerSection(page: Page) {
  await page.goto('/settings/server')
  await page.waitForSelector('[data-testid="wave-server-tab"]', { state: 'visible' })
  await page.waitForSelector(`[data-testid="server-session-row-${HOLDER_ID}"]`, { state: 'visible' })
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box, 'the element has a layout box').not.toBeNull()
  return box!
}

async function textStyle(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color }
  })
}

/** WSRV-11: the Config file row sits directly under Data folder and is set like it. */
async function expectConfigFileRow(page: Page): Promise<void> {
  const backendCard = page.locator('[data-testid="server-card-backend"]')
  const dataRow = backendCard.locator('[data-testid="server-data-folder"]')
  const row = backendCard.locator('[data-testid="server-config-file"]')
  const value = row.getByText(CONFIG_FILE, { exact: true })
  const lock = row.locator('svg.lucide-lock')
  const copy = row.getByRole('button', { name: 'Copy Config file', exact: true })

  await expect(
    page.locator('[data-testid="server-config-file"]'),
    'one Config file row, in the Backend Server card only',
  ).toHaveCount(1)
  await expect(row, 'the label, then exactly the path').toHaveText(`Config file${CONFIG_FILE}`)
  await expect(lock).toBeVisible()
  await expect(value).toBeVisible()
  await expect(copy.locator('svg.lucide-copy')).toBeVisible()

  const valueStyle = await textStyle(value)
  expect(valueStyle.fontFamily, 'the path is set in the monospace font').toMatch(/mono/i)
  expect(valueStyle, 'the path is set like the Data folder path').toEqual(
    await textStyle(dataRow.getByText(DATA_FOLDER, { exact: true })),
  )
  expect(await textStyle(row), 'the label is set like the Data folder label').toEqual(
    await textStyle(dataRow),
  )

  const lockBox = await boxOf(lock)
  const valueBox = await boxOf(value)
  const copyBox = await boxOf(copy)
  expect(lockBox.x + lockBox.width, 'the lock sits before the path').toBeLessThanOrEqual(valueBox.x)
  expect(valueBox.x + valueBox.width, 'the copy button sits after the path').toBeLessThanOrEqual(
    copyBox.x,
  )

  const dataBox = await boxOf(dataRow)
  const rowBox = await boxOf(row)
  const gap = rowBox.y - (dataBox.y + dataBox.height)
  expect(gap, 'Config file sits below Data folder').toBeGreaterThanOrEqual(0)
  expect(gap, 'no other row fits between Data folder and Config file').toBeLessThan(dataBox.height)
  expect(Math.abs(rowBox.x - dataBox.x), 'Config file starts where Data folder starts').toBeLessThanOrEqual(1)
}

test.describe('V-WAVE-SERVER-01: WAVE Server section', () => {
  test.beforeEach(async ({ page }) => {
    await seedAndMock(page)
  })

  test('WSRV-1: nav entry "WAVE Server" with Server icon sits between MCP Server and Backup and opens the section', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })

    // Seven section entries plus the collapsed Network group's toggle.
    const nav = page.locator('[data-testid="settings-nav"]')
    await expect(nav.locator('[data-testid^="settings-nav-"]'), 'seven section entries').toHaveCount(7)
    await expect(nav.getByRole('button', { name: 'Network', exact: true })).toBeVisible()
    await expect(nav.locator('button'), 'the entries plus the Network toggle').toHaveCount(8)

    const serverNav = page.locator('[data-testid="settings-nav-server"]')
    await expect(serverNav).toBeVisible()
    await expect(serverNav).toHaveText('WAVE Server')
    await expect(serverNav.locator('[data-testid="icon-server"]')).toBeVisible()

    // Order: MCP Server -> WAVE Server -> Backup.
    const mcpBox = await page.locator('[data-testid="settings-nav-mcp"]').boundingBox()
    const serverBox = await serverNav.boundingBox()
    const backupBox = await page.locator('[data-testid="settings-nav-backup"]').boundingBox()
    expect(mcpBox!.y, 'MCP Server should be above WAVE Server').toBeLessThan(serverBox!.y)
    expect(serverBox!.y, 'WAVE Server should be above Backup').toBeLessThan(backupBox!.y)

    await serverNav.click()
    await expect(page).toHaveURL(/\/settings\/server$/)
    await expect(serverNav).toHaveAttribute('aria-current', 'page')
    await expect(
      page.locator('[data-testid="wave-server-tab"]').getByRole('heading', { name: 'WAVE Server' }),
    ).toBeVisible()
  })

  test('WSRV-2/3: two read-only fact cards (Frontend + Backend) with the session count', async ({
    page,
  }) => {
    await gotoServerSection(page)

    const frontendCard = page.locator('[data-testid="server-card-frontend"]')
    const backendCard = page.locator('[data-testid="server-card-backend"]')

    await test.step('WSRV-2: Frontend + Backend cards render, running', async () => {
      await expect(frontendCard).toContainText('Frontend Server')
      await expect(frontendCard).toContainText('serves the WAVE interface')
      await expect(frontendCard).toContainText('Running')
      await expect(backendCard).toContainText('Backend Server')
      await expect(backendCard).toContainText('handles the API and live sessions')
    })

    await test.step('WSRV-3: Backend card carries the connected-session count', async () => {
      await expect(backendCard).toContainText('3 sessions')
    })

    await test.step('WSRV-2: cards are read-only (no inputs) with Port + Bind facts', async () => {
      for (const card of [frontendCard, backendCard]) {
        await expect(card.getByRole('textbox')).toHaveCount(0)
        await expect(card.getByRole('combobox')).toHaveCount(0)
        await expect(card).toContainText('Port')
        await expect(card).toContainText('Bind scope')
      }
      // Frontend advertises a single origin + Local bind; Backend Network bind.
      await expect(frontendCard).toContainText('Local')
      await expect(frontendCard.getByRole('button', { name: /^Copy / })).toHaveCount(1)
      await expect(backendCard).toContainText('Network')
    })
  })

  test('WSRV-10: the Backend Server card shows the Data folder row under Port / Bind scope', async ({
    page,
  }) => {
    await gotoServerSection(page)

    const backendCard = page.locator('[data-testid="server-card-backend"]')
    const row = backendCard.locator('[data-testid="server-data-folder"]')

    await test.step('one Data folder row, in the Backend Server card only', async () => {
      await expect(page.locator('[data-testid="server-data-folder"]')).toHaveCount(1)
      await expect(row).toBeVisible()
    })

    await test.step('label, lock icon, mono path and copy icon', async () => {
      await expect(row).toContainText('Data folder')
      await expect(row.locator('svg.lucide-lock')).toBeVisible()
      const value = row.getByText(DATA_FOLDER, { exact: true })
      await expect(value).toBeVisible()
      const fontFamily = await value.evaluate((el) => getComputedStyle(el).fontFamily)
      expect(fontFamily, 'the path is set in the monospace font').toMatch(/mono/i)
      const copy = row.getByRole('button', { name: 'Copy Data folder', exact: true })
      await expect(copy).toBeVisible()
      await expect(copy.locator('svg.lucide-copy')).toBeVisible()
    })

    await test.step('under Port / Bind scope, left-aligned with Port', async () => {
      const portFact = backendCard.getByText('8000', { exact: true }).locator('..')
      const bindFact = backendCard.getByText('Network', { exact: true }).locator('..')
      const portBox = (await portFact.boundingBox())!
      const bindBox = (await bindFact.boundingBox())!
      const rowBox = (await row.boundingBox())!
      expect(rowBox.y, 'Data folder sits below Port').toBeGreaterThanOrEqual(portBox.y + portBox.height)
      expect(rowBox.y, 'Data folder sits below Bind scope').toBeGreaterThanOrEqual(
        bindBox.y + bindBox.height,
      )
      expect(Math.abs(rowBox.x - portBox.x), 'Data folder starts where Port starts').toBeLessThanOrEqual(1)
    })
  })

  test('WSRV-11: the Backend Server card shows the Config file row directly under the Data folder row', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await gotoServerSection(page)

    await test.step('8. label, lock icon, mono path and copy icon, directly under Data folder', async () => {
      await expectConfigFileRow(page)
    })

    const theme = await toggleTheme(page)
    await test.step(`8. ${theme}: the row keeps the pattern in the other theme`, async () => {
      await expectConfigFileRow(page)
    })

    await test.step('8. the copy button copies exactly the path', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''))
      const copy = page
        .locator('[data-testid="server-config-file"]')
        .getByRole('button', { name: 'Copy Config file', exact: true })
      await copy.click()
      await expect(copy).toHaveAttribute('data-copied', 'true')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CONFIG_FILE)
    })
  })

  test('WSRV-3..8: roster rows, browser-scoped You, Active/Watching roles, and the bulk buttons', async ({
    page,
  }) => {
    await gotoServerSection(page)

    const holderRow = page.locator(`[data-testid="server-session-row-${HOLDER_ID}"]`)
    const ownRow = page.locator(`[data-testid="server-session-row-${OWN_ID}"]`)
    const ownRow2 = page.locator(`[data-testid="server-session-row-${OWN_ID_2}"]`)

    await test.step('WSRV-3: one row per session', async () => {
      await expect(
        page.locator('[data-testid="server-sessions-section"] [data-testid^="server-session-row-"]'),
      ).toHaveCount(3)
      await expect(page.getByRole('heading', { name: 'Workbench Sessions' })).toBeVisible()
    })

    await test.step('WSRV-5: browser-scoped "You" - both this browser\'s rows, not the other', async () => {
      await expect(ownRow.getByText('You', { exact: true })).toBeVisible()
      await expect(ownRow2.getByText('You', { exact: true })).toBeVisible()
      await expect(holderRow.getByText('You', { exact: true })).toHaveCount(0)
    })

    await test.step('WSRV-3/4: Active (holder) vs Watching (mirrors) role pills', async () => {
      await expect(holderRow.getByText('Active', { exact: true })).toBeVisible()
      await expect(ownRow.getByText('Watching', { exact: true })).toBeVisible()
      await expect(ownRow2.getByText('Watching', { exact: true })).toBeVisible()
    })

    await test.step('WSRV-6/7: Disconnect Others + Disconnect All at the header', async () => {
      const others = page.locator('[data-testid="server-disconnect-others"]')
      const all = page.locator('[data-testid="server-disconnect-all"]')
      await expect(others).toBeVisible()
      await expect(others).toHaveText('Disconnect Others')
      await expect(all).toBeVisible()
      await expect(all).toHaveText('Disconnect All')
    })
  })

  test('WSRV-5: per-row Disconnect is confirmation-gated (Cancel is a no-op)', async ({ page }) => {
    await gotoServerSection(page)

    const ownRow = page.locator(`[data-testid="server-session-row-${OWN_ID}"]`)
    await ownRow.getByRole('button', { name: 'Disconnect' }).click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    // Own-session-aware copy for the browser's own row.
    await expect(dialog).toContainText(/your own session/i)

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)
    // Cancel changed nothing: the row is still present.
    await expect(ownRow).toBeVisible()
  })

  test('WSRV-9: ?session deep-link rings the target row and labels it Active, with no "From your workbench" chip', async ({
    page,
  }) => {
    await page.goto(`/settings/server?session=${HOLDER_ID}`)
    await page.waitForSelector('[data-testid="wave-server-tab"]', { state: 'visible' })

    const holderRow = page.locator(`[data-testid="server-session-row-${HOLDER_ID}"]`)
    await expect(holderRow).toHaveAttribute('data-highlighted', 'true')
    await expect(holderRow.getByText('Active', { exact: true })).toBeVisible()
    await expect(
      holderRow,
      'the WAVE Server roster conveys role via pills, never the MCP "From your workbench" chip',
    ).not.toContainText('From your workbench')
    // Non-target rows are not highlighted.
    await expect(
      page.locator(`[data-testid="server-session-row-${OWN_ID}"]`),
    ).not.toHaveAttribute('data-highlighted', 'true')
  })
})

test.describe('V-WAVE-SERVER-01: Config file row on the live backend', () => {
  test('WSRV-11: the Config file row shows the config file this backend runs on and copies it', async ({
    page,
    request,
  }) => {
    const { configFile } = await stackPaths(request)

    await test.step('9. GET /server/status names an absolute config file of the stack', async () => {
      expect(path.isAbsolute(configFile), `config_file "${configFile}" is absolute`).toBe(true)
      expect(configFile, 'not the config file of the repository').not.toMatch(
        /backend[\\/]config[\\/]config\.yaml$/,
      )
    })

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/settings/server')
    const row = page.locator('[data-testid="server-card-backend"] [data-testid="server-config-file"]')

    await test.step('9. the row shows exactly that path', async () => {
      await expect(page.locator('[data-testid="server-config-file"]')).toHaveCount(1)
      await expect(row).toHaveText(`Config file${configFile}`)
      await expect(row.getByText(configFile, { exact: true })).toBeVisible()
    })

    await test.step('9. the copy button copies exactly that path', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''))
      const copy = row.getByRole('button', { name: 'Copy Config file', exact: true })
      await copy.click()
      await expect(copy).toHaveAttribute('data-copied', 'true')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(configFile)
    })
  })
})
