/**
 * V-NUMBER-SETTINGS-BOXES: the Settings number boxes take only what the one number rule allows
 * Wireframe: N/A (each box keeps its look; Max Backups to Keep is a text box with no spinner arrows)
 * Design Decisions: SETTINGS-21, MCP-3, NET-1, NET-4
 * REQ: REQ-3.1.3.14, REQ-4.7.20
 *
 * Every box is typed into one key at a time, as a person does. The backup schedule is stored on with
 * Max Backups to Keep 7 for its test and put back as it was found; the MCP Server, Proxy and SSH Hosts
 * pages are only staged and canceled.
 *
 * Pass Criteria:
 * 1. Max Backups to Keep is a text box with a number keyboard (`type="text"`, `inputmode="numeric"`)
 *    showing the saved 7.
 * 2. Typing `1.5`, `-1` and `1e3` into the emptied box leaves `15`, `1` and `13`: the dot, the minus and
 *    the letter never enter; Cancel shows 7 again.
 * 3. `0` and an emptied box are shown but not staged (Cancel and Save stay disabled); leaving the box
 *    shows the saved 7 again.
 * 4. A 19-digit count is staged as typed, a 20th digit is dropped; Save stores every digit (the API answers
 *    `"1234567890123456789"`) and the box shows all 19 digits after a reload.
 * 5. MCP Port refuses a minus, a dot and letters (`-9.0x12` leaves `9012`); a paste of `80-80` over the
 *    saved 8765 is refused, never rewritten to `8080`, and stages nothing.
 * 6. Proxy Port (Custom) refuses a minus, a dot and letters (`-3.1x28` leaves `3128`); a digit typed in
 *    front of `65535` changes nothing.
 * 7. The Add Hosts dialog's Detect Port refuses a minus, a dot and letters (`-2.2x5` leaves `225`).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { MCP_DEFAULTS, resetMcpSettings } from '../../helpers/mcp'
import { resetNetworkSettings } from '../../helpers/network-settings'
import { expectTypedAs, pasteOver, rawBody, typeKeys } from '../../helpers/number-entry'

const YEARLY_CRON = '0 3 1 1 *'
const SAVED_COUNT = '7'
const NINETEEN_DIGITS = '1234567890123456789'

type Schedule = Record<string, unknown>

// The schedule fields a PUT takes back; the run fields are written by WAVE.
const SCHEDULE_FIELDS = [
  'enabled',
  'cron',
  'entity_types',
  'max_backups',
  'save_directory',
  'format',
  'compression_method',
  'compression_level',
  'secrets',
] as const

async function readSchedule(page: Page): Promise<Schedule> {
  const response = await page.request.get(`${BACKEND_URL}/api/backup/schedule`)
  expect(response.ok(), `GET /api/backup/schedule answered ${response.status()}`).toBeTruthy()
  return (await response.json()).data as Schedule
}

async function putSchedule(page: Page, body: Schedule): Promise<void> {
  const response = await page.request.put(`${BACKEND_URL}/api/backup/schedule`, { data: body })
  expect(response.ok(), `PUT /api/backup/schedule answered ${response.status()} ${await response.text()}`).toBeTruthy()
}

/** The schedule as it was found: an off schedule keeps none of its hidden fields. */
async function restoreSchedule(page: Page, found: Schedule): Promise<void> {
  if (found.enabled !== true) {
    await putSchedule(page, { enabled: false })
    return
  }
  await putSchedule(page, Object.fromEntries(SCHEDULE_FIELDS.map((field) => [field, found[field]])))
}

const periodicSection = (page: Page): Locator => page.getByTestId('periodic-backup-section')
const maxBackups = (page: Page): Locator => periodicSection(page).getByTestId('max-backups-input')
const scheduleButton = (page: Page, name: 'Cancel' | 'Save'): Locator =>
  periodicSection(page)
    .getByRole('heading', { name: 'Periodic Backup', exact: true })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })

async function openBackupPage(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', { state: 'attached' })
  await expect(maxBackups(page)).toBeVisible({ timeout: 15_000 })
}

async function expectScheduleClean(page: Page): Promise<void> {
  await expect(scheduleButton(page, 'Cancel')).toBeDisabled()
  await expect(scheduleButton(page, 'Save')).toBeDisabled()
}

async function expectScheduleStaged(page: Page): Promise<void> {
  await expect(scheduleButton(page, 'Cancel')).toBeEnabled()
  await expect(scheduleButton(page, 'Save')).toBeEnabled()
}

const mcpTab = (page: Page): Locator => page.getByTestId('mcp-server-tab')
const mcpButton = (page: Page, name: 'Cancel' | 'Save'): Locator =>
  mcpTab(page)
    .getByRole('heading', { name: 'MCP Server', exact: true, level: 2 })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })
const mcpPort = (page: Page): Locator => mcpTab(page).getByRole('textbox', { name: 'Port', exact: true })

const proxyTab = (page: Page): Locator => page.getByTestId('network-proxy-setup-tab')
const proxyPort = (page: Page): Locator => proxyTab(page).locator('input[name="proxy-port"]')

test.describe('V-NUMBER-SETTINGS-BOXES: the Settings number boxes', () => {
  test.describe.configure({ mode: 'serial' })

  test('Max Backups to Keep: a text box that drops refused keys, shows 0 and empty unstaged, and keeps 19 digits', async ({
    page,
  }) => {
    const found = await readSchedule(page)
    try {
      await putSchedule(page, {
        enabled: true,
        cron: YEARLY_CRON,
        max_backups: Number(SAVED_COUNT),
        save_directory: found.save_directory,
      })
      await openBackupPage(page)
      const box = maxBackups(page)

      await test.step('1. a text box with a number keyboard shows the saved count', async () => {
        await expect(box).toHaveAttribute('type', 'text')
        await expect(box).toHaveAttribute('inputmode', 'numeric')
        await expect(box).toHaveValue(SAVED_COUNT)
        await expectScheduleClean(page)
      })

      await test.step('2. a dot, a minus and a letter never enter the box', async () => {
        await expectTypedAs(box, '1.5', '15')
        await expectScheduleStaged(page)
        await expectTypedAs(box, '-1', '1')
        await expectTypedAs(box, '1e3', '13')
        await scheduleButton(page, 'Cancel').click()
        await expect(box).toHaveValue(SAVED_COUNT)
        await expectScheduleClean(page)
      })

      await test.step('3. 0 and an emptied box are shown, never staged, and leaving the box shows 7 again', async () => {
        await typeKeys(box, '0')
        await expect(box).toHaveValue('0')
        await expectScheduleClean(page)
        await box.press('Tab')
        await expect(box).toHaveValue(SAVED_COUNT)

        await typeKeys(box, '')
        await expect(box).toHaveValue('')
        await expectScheduleClean(page)
        await box.press('Tab')
        await expect(box).toHaveValue(SAVED_COUNT)
      })

      await test.step('4. 19 digits are staged and saved with every digit; a 20th is dropped', async () => {
        await expectTypedAs(box, `${NINETEEN_DIGITS}0`, NINETEEN_DIGITS)
        await expectScheduleStaged(page)
        const written = page.waitForResponse(
          (response) =>
            response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/backup/schedule',
        )
        await scheduleButton(page, 'Save').click()
        const answer = await written
        expect(await rawBody(answer, 'the schedule Save')).toMatch(new RegExp(`"max_backups":\\s*"${NINETEEN_DIGITS}"`))
        await expectScheduleClean(page)
        const reread = await page.request.get(`${BACKEND_URL}/api/backup/schedule`)
        expect(await rawBody(reread, 'GET /api/backup/schedule')).toMatch(
          new RegExp(`"max_backups":\\s*"${NINETEEN_DIGITS}"`),
        )
        await openBackupPage(page)
        await expect(maxBackups(page)).toHaveValue(NINETEEN_DIGITS)
      })
    } finally {
      await restoreSchedule(page, found)
    }
  })

  test('MCP Port: a minus, a dot and letters never enter, and a paste of 80-80 is refused whole', async ({ page }) => {
    await resetMcpSettings(page)
    try {
      await page.goto('/settings/mcp')
      await expect(page.getByTestId('mcp-status-bar')).toBeVisible()
      const port = mcpPort(page)
      await expect(port).toHaveValue(String(MCP_DEFAULTS.port))

      await test.step('5. the keys a port cannot hold are dropped', async () => {
        await expectTypedAs(port, '-9.0x12', '9012')
        await mcpButton(page, 'Cancel').click()
        await expect(port).toHaveValue(String(MCP_DEFAULTS.port))
      })

      await test.step('5. a paste of 80-80 leaves the saved port and stages nothing', async () => {
        await pasteOver(page, port, '80-80')
        await expect(port).toHaveValue(String(MCP_DEFAULTS.port))
        await expect(mcpButton(page, 'Save')).toBeDisabled()
        await expect(mcpButton(page, 'Cancel')).toBeDisabled()
      })
    } finally {
      await resetMcpSettings(page)
    }
  })

  test('Proxy Port: a minus, a dot and letters never enter, and a digit in front of 65535 changes nothing', async ({
    page,
  }) => {
    await resetNetworkSettings(BACKEND_URL)
    try {
      await page.goto('/settings/network/proxy/setup')
      const useProxy = proxyTab(page).getByRole('switch', { name: 'Use a proxy', exact: true })
      await expect(useProxy).toBeVisible({ timeout: 15_000 })
      await useProxy.click()
      const source = proxyTab(page).getByRole('group', { name: 'Source', exact: true })
      await source.getByRole('button', { name: 'Custom', exact: true }).click()
      const port = proxyPort(page)
      await expect(port).toBeVisible()

      await test.step('6. the keys a port cannot hold are dropped', async () => {
        await expectTypedAs(port, '-3.1x28', '3128')
      })

      await test.step('6. a digit typed in front of 65535 changes nothing', async () => {
        await typeKeys(port, '65535')
        await expect(port).toHaveValue('65535')
        await port.press('Home')
        await port.press('1')
        await expect(port).toHaveValue('65535')
      })

      await proxyTab(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(useProxy).not.toBeChecked()
    } finally {
      await resetNetworkSettings(BACKEND_URL)
    }
  })

  test('Detect Port: a minus, a dot and letters never enter the Add Hosts port box', async ({ page }) => {
    await page.goto('/settings/network/ssh-hosts')
    const table = page.getByTestId('trusted-hosts-table')
    await expect(table).toBeVisible({ timeout: 15_000 })
    await table.getByRole('button', { name: 'Add hosts', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add Hosts' })
    await expect(dialog).toBeVisible()
    const port = dialog.getByLabel('Port', { exact: true })
    await expect(port).toHaveValue('22')

    await test.step('7. the keys a port cannot hold are dropped', async () => {
      await expectTypedAs(port, '-2.2x5', '225')
    })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
