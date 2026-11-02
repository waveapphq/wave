/**
 * V-MCP-01: Settings > MCP Server section - default state and the staged frame
 *
 * Phase: no-data (parallel) - stages edits in the page and never saves them: a PUT of the
 * MCP settings sent by the page fails the test. The saved-password frame is set up through the
 * API before the page opens. Resets the MCP settings to defaults around each test so a mutated
 * endpoint state never leaks into or out of this spec.
 * Design Decisions: MCP-1, MCP-2, MCP-3, MCP-4, MCP-7, MCP-8, MCP-9, SETTINGS-18, NET-11
 * REQ: REQ-5.2.7.1, REQ-5.2.7.14, REQ-4.7.16
 *
 * Pass Criteria:
 * 1. Settings nav shows an "MCP Server" entry with the Bot icon between
 *    the Network group and WAVE Server (7 sections plus the Network toggle); clicking it opens
 *    /settings/mcp with the section rendered (MCP-1).
 * 2. Default status bar is Stopped: non-green dot, bold "Stopped", muted
 *    "The MCP endpoint is disabled.", no client/activity meta, and no
 *    address-chip row (MCP-2).
 * 3. Both enablement switches ("Enable MCP server", "Enable until restart")
 *    are off with no green "Active" cue (MCP-3).
 * 4. Endpoint defaults: Port input reads 8765, Bind scope shows
 *    "Local only (127.0.0.1)", "Require authentication" is off (MCP-4).
 * 5. Username and Password rows are visually disabled while auth is off:
 *    opacity 0.5 + cursor not-allowed, inputs disabled (MCP-7).
 * 6. Sessions shows the "No connected clients." empty state and Recent
 *    Activity shows "No activity yet." (MCP-8, MCP-9).
 * 7. "MCP Server" is the section's first heading. Cancel then Save (save icon) sit at the
 *    right end of its line, on its centerline, with the page description under the line; they
 *    are the only Cancel and Save in the section, and both are disabled and faded (opacity
 *    0.5, cursor not-allowed) while nothing is staged (SETTINGS-18, MCP-4).
 * 8. Enablement and Endpoint each carry their exact subtitle and their rows' help lines and
 *    no other text; the Endpoint section is its heading, its subtitle and the row group that
 *    ends with the Password row: no footer bar and no note under it (MCP-4).
 * 9. Every control is centered vertically against its label + help (NET-11, centers within
 *    2px): the two Enablement switches, Port, Bind scope, Require authentication and
 *    Password; the Username label sits on its input's centerline.
 * 10. Frame mcp-server-save: "Enable MCP server" staged on, Require authentication on, the
 *    username "mcp" and a new password enable Cancel and Save; the status stays Stopped with
 *    no Active cue and the backend still reports everything off (MCP-3). Under the Password
 *    input the score is four equal 4px segments at the input's width, the first filled in the
 *    error color, and the one word "Weak" with no other text (MCP-7); the Password label, its
 *    help and the input stay where they were when the score appears. Cancel restores the
 *    defaults, removes the score and fades both buttons again.
 * 11. In the other theme (flipped from the sidebar) criteria 7, 9, 10, 13 and 14 hold.
 * 12. No switch carries an `aria-label`: each is named by its row label and described by its
 *    help line, and a click on the label flips it.
 * 13. Frame mcp-server-password-saved, with authentication and a password stored: the Password
 *    row is not faded and holds the masked field in place of an input (pencil, eight dots, a lock
 *    at the right end; as wide as the Username input and 40px tall), with no score and no eye
 *    toggle; the Password label's `for` names it and it is centered against label + help (NET-11);
 *    Cancel and Save are disabled and faded.
 * 14. A click on the masked field opens "Edit Protected Value?" with its warning, Cancel and a
 *    red "Delete & Edit"; Cancel and Escape close it and leave the masked field and the stored
 *    password as they were.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { MCP_DEFAULTS, resetMcpSettings } from '../../helpers/mcp'
import { toggleTheme } from '../../helpers/theme'

const CENTER_TOLERANCE_PX = 2

const PAGE_DESCRIPTION =
  'Let AI assistants connect to WAVE as ordinary clients over the Model Context Protocol. ' +
  'Assistants use the same services, validation, and secret masking as the web UI; their ' +
  'runs are tracked in Executions.'
const ENABLEMENT_SUBTITLE = 'Turn the MCP endpoint on or off without restarting the WAVE server.'
const ENDPOINT_SUBTITLE = 'Where the MCP server listens and how clients must authenticate.'

const PERSISTENT_LABEL = 'Enable MCP server'
const PERSISTENT_HELP = 'Persistent: the endpoint stays enabled across WAVE restarts.'
const UNTIL_RESTART_LABEL = 'Enable until restart'
const UNTIL_RESTART_HELP = 'Turns off automatically the next time the WAVE server restarts.'
const PORT_HELP = 'The port the MCP endpoint listens on.'
const BIND_HELP = 'Local only keeps the endpoint reachable solely from this machine.'
const AUTH_LABEL = 'Require authentication'
const AUTH_HELP = 'Clients must send HTTP Basic credentials with every request.'
const PASSWORD_HELP = 'Stored sealed; shown write-only like other credentials.'

const WEAK_PASSWORD = 'wave1234'
const STORED_PASSWORD = 'correct-horse-9-Zx'

const MASKED_FIELD_NAME = 'Password: Edit protected value'
const PROTECTED_TITLE = 'Edit Protected Value?'
const PROTECTED_WARNING =
  'Editing will permanently delete the existing protected value. You will need to enter a new ' +
  'value. This action cannot be undone.'

interface Score {
  word: string
  filled: number
  token: string
}

const WEAK: Score = { word: 'Weak', filled: 1, token: '--color-error-text' }

async function gotoMcpSection(page: Page) {
  await page.goto('/settings/mcp')
  await page.waitForSelector('[data-testid="mcp-server-tab"]', { state: 'visible' })
  // The status bar replaces the loading skeleton once settings + status load.
  await page.waitForSelector('[data-testid="mcp-status-bar"]', { state: 'visible' })
}

function mcpTab(page: Page): Locator {
  return page.locator('[data-testid="mcp-server-tab"]')
}

function headingLine(page: Page): Locator {
  return mcpTab(page).getByRole('heading', { level: 2, name: 'MCP Server', exact: true }).locator('xpath=..')
}

/** Cancel or Save on the "MCP Server" heading line (SETTINGS-18). */
function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return headingLine(page).getByRole('button', { name, exact: true })
}

function passwordInput(page: Page): Locator {
  return mcpTab(page).getByLabel('Password', { exact: true })
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
}

async function centerY(locator: Locator): Promise<number> {
  const box = await boxOf(locator)
  return box.y + box.height / 2
}

/** The computed color of a theme token, read through a probe element. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

async function expectClean(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is disabled while clean`).toBeDisabled()
    await expect(button, `${name} is faded while clean`).toHaveCSS('opacity', '0.5')
    await expect(button).toHaveCSS('cursor', 'not-allowed')
  }
}

async function expectDirty(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is enabled with a change staged`).toBeEnabled()
    await expect(button).toHaveCSS('opacity', '1')
  }
}

/** SETTINGS-18: Cancel then Save at the right end of the first heading line. */
async function expectHeadingLine(page: Page): Promise<void> {
  const tab = mcpTab(page)
  const line = headingLine(page)
  await expect(tab.getByRole('heading').first(), 'the first heading of the section').toHaveText('MCP Server')
  await expect(line.getByRole('button')).toHaveText(['Cancel', 'Save'])
  await expect(headerButton(page, 'Save').locator('svg'), 'Save carries the save icon').toHaveCount(1)
  await expect(line.locator('xpath=following-sibling::p')).toHaveText(PAGE_DESCRIPTION)

  const headingCenter = await centerY(line.getByRole('heading'))
  for (const name of ['Cancel', 'Save'] as const) {
    await expect(tab.getByRole('button', { name, exact: true }), `one ${name} in the section`).toHaveCount(1)
    const offset = Math.abs((await centerY(headerButton(page, name))) - headingCenter)
    expect(offset, `${name} sits on the heading's centerline`).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  }
  const cancel = await boxOf(headerButton(page, 'Cancel'))
  const save = await boxOf(headerButton(page, 'Save'))
  const statusBar = await boxOf(page.locator('[data-testid="mcp-status-bar"]'))
  expect(cancel.x + cancel.width, 'Cancel comes before Save').toBeLessThanOrEqual(save.x)
  expect(
    Math.abs(save.x + save.width - (statusBar.x + statusBar.width)),
    'Save ends the heading line at the right edge of the section',
  ).toBeLessThanOrEqual(1)
}

/** NET-11: the control's center sits on the center of label + help. */
async function expectRowCentered(page: Page, label: string, help: string, control: Locator): Promise<void> {
  const tab = mcpTab(page)
  const labelBox = await boxOf(tab.getByText(label, { exact: true }))
  const helpBox = await boxOf(tab.getByText(help, { exact: true }))
  const textCenter = (labelBox.y + helpBox.y + helpBox.height) / 2
  const offset = Math.abs((await centerY(control)) - textCenter)
  expect(offset, `"${label}" control is centered against label + help (NET-11)`).toBeLessThanOrEqual(
    CENTER_TOLERANCE_PX,
  )
}

async function expectRowsCentered(page: Page, password: Locator = passwordInput(page)): Promise<void> {
  const tab = mcpTab(page)
  const rows: Array<[string, string, Locator]> = [
    [PERSISTENT_LABEL, PERSISTENT_HELP, tab.getByRole('switch', { name: PERSISTENT_LABEL })],
    [UNTIL_RESTART_LABEL, UNTIL_RESTART_HELP, tab.getByRole('switch', { name: UNTIL_RESTART_LABEL })],
    ['Port', PORT_HELP, tab.getByRole('textbox', { name: 'Port' })],
    ['Bind scope', BIND_HELP, tab.locator('[data-testid="mcp-bind-select"]')],
    [AUTH_LABEL, AUTH_HELP, tab.getByRole('switch', { name: AUTH_LABEL })],
    ['Password', PASSWORD_HELP, password],
  ]
  for (const [label, help, control] of rows) await expectRowCentered(page, label, help, control)

  const usernameLabel = await centerY(tab.getByText('Username', { exact: true }))
  const usernameInput = await centerY(tab.getByRole('textbox', { name: 'Username' }))
  expect(
    Math.abs(usernameInput - usernameLabel),
    'the Username label sits on its input centerline',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
}

/** Where the Password label, its help and the input sit below the top of their row. */
async function passwordRowOffsets(page: Page): Promise<Record<'label' | 'help' | 'input', number>> {
  const row = page.locator('[data-testid="mcp-auth-password-row"]')
  const top = (await boxOf(row)).y
  return {
    label: (await boxOf(row.getByText('Password', { exact: true }))).y - top,
    help: (await boxOf(row.getByText(PASSWORD_HELP, { exact: true }))).y - top,
    input: (await boxOf(passwordInput(page))).y - top,
  }
}

/** MCP-7: four equal thin segments, the filled ones in the score's color, one word, no other text. */
async function expectScore(page: Page, score: Score): Promise<void> {
  const host = page.locator('#mcp-password-strength')
  await expect(host, 'the score reads one word').toHaveText(score.word)
  await expect(host.locator('xpath=..'), 'no other text under the Password input').toHaveText(score.word)
  await expect(page.getByRole('meter', { name: 'Password strength' })).toHaveAttribute(
    'aria-valuetext',
    score.word,
  )

  const bar = host.locator('[aria-hidden="true"]')
  const segments = bar.locator('span')
  await expect(segments).toHaveCount(4)
  const filled = await tokenColor(page, score.token)
  const empty = await tokenColor(page, '--input')
  expect(filled, 'a filled segment differs from an empty one').not.toBe(empty)
  const widths: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const segment = segments.nth(index)
    await expect(segment, `segment ${index + 1} is thin`).toHaveCSS('height', '4px')
    await expect(segment, `segment ${index + 1} fill`).toHaveCSS(
      'background-color',
      index < score.filled ? filled : empty,
    )
    widths.push((await boxOf(segment)).width)
  }
  expect(Math.max(...widths) - Math.min(...widths), 'the four segments are equal').toBeLessThanOrEqual(0.5)

  const input = await boxOf(passwordInput(page))
  const barBox = await boxOf(bar)
  const gap = barBox.y - (input.y + input.height)
  expect(gap, 'the score sits under the input').toBeGreaterThanOrEqual(0)
  expect(gap, 'the score sits directly under the input').toBeLessThanOrEqual(12)
  expect(Math.abs(barBox.x - input.x), 'the score starts at the input left edge').toBeLessThanOrEqual(1)
  expect(Math.abs(barBox.width - input.width), 'the score is as wide as the input').toBeLessThanOrEqual(1)
  expect((await boxOf(host.locator('p'))).y, 'the word sits under the segments').toBeGreaterThanOrEqual(
    barBox.y + barBox.height,
  )
}

/** Types a new password; the score shows and the label, help and input stay level (MCP-7). */
async function typeNewPassword(page: Page, password: string, score: Score): Promise<void> {
  const before = await passwordRowOffsets(page)
  await passwordInput(page).fill(password)
  await expectScore(page, score)
  const after = await passwordRowOffsets(page)
  for (const part of ['label', 'help', 'input'] as const) {
    expect(
      Math.abs(after[part] - before[part]),
      `the Password ${part} stays put when the score appears`,
    ).toBeLessThanOrEqual(0.5)
  }
  await expectRowCentered(page, 'Password', PASSWORD_HELP, passwordInput(page))
}

/** Frame mcp-server-save: stage the frame, check it, then Cancel back to the defaults. */
async function expectSaveFrame(page: Page): Promise<void> {
  const tab = mcpTab(page)
  const statusBar = page.locator('[data-testid="mcp-status-bar"]')
  const persistentSwitch = tab.getByRole('switch', { name: PERSISTENT_LABEL })
  const untilRestartSwitch = tab.getByRole('switch', { name: UNTIL_RESTART_LABEL })
  const authSwitch = tab.getByRole('switch', { name: AUTH_LABEL })
  const username = tab.getByRole('textbox', { name: 'Username' })

  await persistentSwitch.click()
  await expect(persistentSwitch).toHaveAttribute('data-state', 'checked')
  await expectDirty(page)
  await authSwitch.click()
  await expect(authSwitch).toHaveAttribute('data-state', 'checked')
  await username.fill('mcp')
  await typeNewPassword(page, WEAK_PASSWORD, WEAK)
  await expect(tab.getByRole('button', { name: 'Show password' })).toBeVisible()
  await expectDirty(page)
  await expectHeadingLine(page)
  await expectRowsCentered(page)

  // MCP-3: the staged switch acts on nothing until Save
  await expect(untilRestartSwitch).toHaveAttribute('data-state', 'unchecked')
  await expect(statusBar.getByText('Stopped', { exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="mcp-persistent-active"]')).toHaveCount(0)
  const settings = await (await page.request.get(`${BACKEND_URL}/mcp/settings`)).json()
  expect(settings, 'the backend holds the saved values').toMatchObject({
    enabled: false,
    until_restart_active: false,
    running: false,
    auth_enabled: false,
    auth_username: '',
  })

  await headerButton(page, 'Cancel').click()
  await expect(persistentSwitch).toHaveAttribute('data-state', 'unchecked')
  await expect(authSwitch).toHaveAttribute('data-state', 'unchecked')
  await expect(username).toHaveValue('')
  await expect(passwordInput(page)).toHaveValue('')
  await expect(page.locator('#mcp-password-strength > *'), 'Cancel removes the score').toHaveCount(0)
  await expectClean(page)
}

/** Stores authentication with a password through the API; the endpoint stays stopped. */
async function storeAuthentication(page: Page): Promise<void> {
  const response = await page.request.put(`${BACKEND_URL}/mcp/settings`, {
    data: { ...MCP_DEFAULTS, auth_enabled: true, auth_username: 'mcp', auth_password: STORED_PASSWORD },
  })
  expect(response.ok(), 'PUT /mcp/settings').toBe(true)
}

function maskedPassword(page: Page): Locator {
  return page
    .locator('[data-testid="mcp-auth-password-row"]')
    .getByRole('button', { name: MASKED_FIELD_NAME, exact: true })
}

/** Frame mcp-server-password-saved: the stored password as the masked field (MCP-7). */
async function expectPasswordSavedFrame(page: Page): Promise<void> {
  // A hovered masked field shows its hint; the frame is drawn with the pointer elsewhere.
  await page.mouse.move(0, 0)
  const tab = mcpTab(page)
  const row = page.locator('[data-testid="mcp-auth-password-row"]')
  const field = maskedPassword(page)
  const username = tab.getByRole('textbox', { name: 'Username' })

  await expect(tab.getByRole('switch', { name: AUTH_LABEL })).toHaveAttribute('data-state', 'checked')
  await expect(username).toHaveValue('mcp')
  await expect(row, 'the row is not faded while authentication is on').toHaveCSS('opacity', '1')
  await expect(field).toBeEnabled()
  await expect(row.locator('input'), 'a stored password shows no input').toHaveCount(0)
  await expect(field, 'the Password label points at the masked field').toHaveAttribute(
    'id',
    (await row.locator('label').getAttribute('for')) ?? '',
  )
  await expect(page.locator('#mcp-password-strength > *'), 'a stored password has no score').toHaveCount(0)
  await expect(tab.getByRole('button', { name: /^(Show|Hide) password$/ })).toHaveCount(0)

  const pencil = field.locator('svg')
  const dots = field.locator('span[aria-hidden="true"]')
  const lock = row.locator('svg.lucide-lock')
  await expect(pencil, 'the field holds the pencil').toHaveCount(1)
  await expect(dots).toHaveText('•'.repeat(8))
  await expect(lock, 'one lock marks the stored password').toHaveCount(1)

  const fieldBox = await boxOf(field)
  const usernameBox = await boxOf(username)
  const dotsBox = await boxOf(dots)
  const lockBox = await boxOf(lock)
  expect(Math.abs(fieldBox.x - usernameBox.x), 'the field starts where the Username input starts').toBeLessThanOrEqual(1)
  expect(Math.abs(fieldBox.width - usernameBox.width), 'the field is as wide as the Username input').toBeLessThanOrEqual(1)
  expect(Math.abs(fieldBox.height - 40), 'the field is 40px tall').toBeLessThanOrEqual(1)
  expect((await boxOf(pencil)).x, 'the pencil comes before the dots').toBeLessThan(dotsBox.x)
  expect(lockBox.x, 'the lock sits after the dots').toBeGreaterThan(dotsBox.x + dotsBox.width)
  expect(lockBox.x + lockBox.width, 'the lock sits inside the field').toBeLessThan(fieldBox.x + fieldBox.width)
  expect(
    fieldBox.x + fieldBox.width - (lockBox.x + lockBox.width),
    'the lock sits at the right end of the field',
  ).toBeLessThanOrEqual(16)
  expect(
    Math.abs(lockBox.y + lockBox.height / 2 - (fieldBox.y + fieldBox.height / 2)),
    'the lock sits on the field centerline',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)

  await expectRowsCentered(page, field)
  await expectHeadingLine(page)
  await expectClean(page)
}

/** REQ-3.1.3.5: the confirm that guards a stored secret, with its two answers. */
async function expectProtectedValueConfirm(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: PROTECTED_TITLE, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText(PROTECTED_TITLE)
  await expect(dialog).toHaveAccessibleDescription(PROTECTED_WARNING)
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const confirm = dialog.getByRole('button', { name: 'Delete & Edit', exact: true })
  await expect(cancel).toBeEnabled()
  await expect(confirm, 'the confirm button reads in the red of the theme').toHaveCSS(
    'background-color',
    await tokenColor(page, '--color-error-text'),
  )
  const cancelBox = await boxOf(cancel)
  expect(cancelBox.x + cancelBox.width, 'Cancel comes before Delete & Edit').toBeLessThanOrEqual(
    (await boxOf(confirm)).x,
  )
  return dialog
}

/** The masked field is still the Password control and nothing waits for Save. */
async function expectStillMasked(page: Page): Promise<void> {
  await expect(maskedPassword(page)).toBeVisible()
  await expect(page.locator('[data-testid="mcp-auth-password-row"]').locator('input')).toHaveCount(0)
  await expectClean(page)
}

let savesFromPage: string[]

test.describe('V-MCP-01: MCP Server section default state', () => {
  // One test stores a password in the backend that the other tests read at its defaults.
  test.describe.configure({ mode: 'default' })
  // The frames are drawn at this scale.
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await resetMcpSettings(page)
    savesFromPage = []
    page.on('request', (request) => {
      if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/mcp/settings')) {
        savesFromPage.push(request.url())
      }
    })
  })

  test.afterEach(async ({ page }) => {
    await resetMcpSettings(page)
    expect(savesFromPage, 'this spec stages and never saves the MCP settings').toEqual([])
  })

  test('MCP-1: nav entry "MCP Server" with Bot icon sits between Variables and WAVE Server and opens the section', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })

    const navItems = page.locator('[data-testid="settings-nav"] button')
    // Seven section entries plus the collapsed Network group's toggle (NET-1).
    await expect(navItems, 'Settings nav should have 7 sections plus the Network toggle').toHaveCount(8)

    const mcpNav = page.locator('[data-testid="settings-nav-mcp"]')
    await expect(mcpNav).toBeVisible()
    await expect(mcpNav).toHaveText('MCP Server')
    await expect(mcpNav.locator('[data-testid="icon-bot"]')).toBeVisible()

    // Below Variables and the Network group, above WAVE Server
    const variablesBox = await page
      .locator('[data-testid="settings-nav-variables"]')
      .boundingBox()
    const mcpBox = await mcpNav.boundingBox()
    const serverBox = await page.locator('[data-testid="settings-nav-server"]').boundingBox()
    expect(variablesBox!.y, 'Variables should be above MCP Server').toBeLessThan(mcpBox!.y)
    expect(mcpBox!.y, 'MCP Server should be above WAVE Server').toBeLessThan(serverBox!.y)

    // Clicking the entry routes to /settings/mcp and renders the section
    await mcpNav.click()
    await expect(page).toHaveURL(/\/settings\/mcp$/)
    await expect(mcpNav).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('[data-testid="mcp-server-tab"]')).toBeVisible()
    await expect(
      page.locator('[data-testid="mcp-server-tab"]').getByRole('heading', { name: 'MCP Server' }),
    ).toBeVisible()
  })

  test('MCP-2/3/4/7/8/9: default section renders Stopped with everything off, staged defaults, and empty states', async ({
    page,
  }) => {
    await gotoMcpSection(page)

    const tab = mcpTab(page)
    const statusBar = page.locator('[data-testid="mcp-status-bar"]')

    await test.step('MCP-2: Stopped status bar with disabled message and no address chips', async () => {
      await expect(statusBar.getByText('Stopped', { exact: true })).toBeVisible()
      await expect(statusBar.getByText('The MCP endpoint is disabled.')).toBeVisible()
      // The state dot must not carry the running green (emerald token)
      const dot = statusBar.locator('span[aria-hidden="true"]').first()
      await expect(dot).not.toHaveClass(/bg-emerald-500/)
      // No running-only meta and no address-chip row when stopped
      await expect(statusBar.getByText(/clients? connected/)).toHaveCount(0)
      await expect(statusBar.getByRole('button', { name: /^Copy http/ })).toHaveCount(0)
      await expect(statusBar.getByText(/^http:\/\//)).toHaveCount(0)
    })

    await test.step('MCP-3: both enablement switches off, no Active cue', async () => {
      const persistentSwitch = page.getByRole('switch', { name: 'Enable MCP server' })
      const untilRestartSwitch = page.getByRole('switch', { name: 'Enable until restart' })
      await expect(persistentSwitch).toHaveAttribute('data-state', 'unchecked')
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'unchecked')
      await expect(page.locator('[data-testid="mcp-persistent-active"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="mcp-until-restart-active"]')).toHaveCount(0)
    })

    await test.step('MCP-4: endpoint defaults - port 8765, Local only bind, auth off', async () => {
      await expect(page.getByRole('textbox', { name: 'Port' })).toHaveValue('8765')
      await expect(page.locator('[data-testid="mcp-bind-select"]')).toContainText(
        'Local only (127.0.0.1)',
      )
      await expect(page.getByRole('switch', { name: 'Require authentication' })).toHaveAttribute(
        'data-state',
        'unchecked',
      )
      await expect(page.locator('[data-testid="mcp-port-error"]')).toHaveCount(0)
    })

    await test.step('MCP-7: auth rows visually disabled while auth is off', async () => {
      for (const rowId of ['mcp-auth-username-row', 'mcp-auth-password-row']) {
        const row = page.locator(`[data-testid="${rowId}"]`)
        await expect(row).toHaveCSS('opacity', '0.5')
        await expect(row).toHaveCSS('cursor', 'not-allowed')
      }
      await expect(page.getByRole('textbox', { name: 'Username' })).toBeDisabled()
      await expect(page.getByLabel('Password', { exact: true })).toBeDisabled()
      await expect(page.locator('#mcp-password-strength > *'), 'no score before a password is typed').toHaveCount(0)
    })

    await test.step('SETTINGS-18: Cancel and Save sit faded on the "MCP Server" heading line', async () => {
      await expectHeadingLine(page)
      await expectClean(page)
    })

    await test.step('MCP-4: exact subtitles and help lines, no footer bar and no note under the Endpoint group', async () => {
      const enablement = tab.getByRole('heading', { level: 3, name: 'Enablement', exact: true }).locator('xpath=..')
      await expect(enablement.locator('p')).toHaveText([ENABLEMENT_SUBTITLE, PERSISTENT_HELP, UNTIL_RESTART_HELP])

      const endpoint = tab.getByRole('heading', { level: 3, name: 'Endpoint', exact: true }).locator('xpath=..')
      await expect(endpoint.locator('p')).toHaveText([
        ENDPOINT_SUBTITLE,
        PORT_HELP,
        BIND_HELP,
        AUTH_HELP,
        PASSWORD_HELP,
      ])
      const parts = endpoint.locator(':scope > *')
      await expect(parts, 'the Endpoint section is its heading, its subtitle and the row group').toHaveCount(3)
      await expect(
        parts.last().locator(':scope > *').last(),
        'the Password row closes the Endpoint section',
      ).toHaveAttribute('data-testid', 'mcp-auth-password-row')
      await expect(endpoint.getByRole('button'), 'no footer bar in the Endpoint group').toHaveCount(0)
      await expect(tab.getByRole('button', { name: /apply/i })).toHaveCount(0)
    })

    await test.step('NET-11: every control is centered against its label and help', async () => {
      await expectRowsCentered(page)
    })

    await test.step('MCP-8/9: empty sessions and activity states', async () => {
      await expect(
        page
          .locator('[data-testid="mcp-sessions-section"]')
          .getByText('No connected clients.'),
      ).toBeVisible()
      await expect(page.getByText('No activity yet.')).toBeVisible()
      await expect(page.locator('[data-testid="mcp-activity-feed"]')).toHaveCount(0)
    })
  })

  test('frame mcp-server-save: staged enablement, authentication and a Weak password wait for Save', async ({
    page,
  }) => {
    await gotoMcpSection(page)
    await expectSaveFrame(page)
  })

  test('each switch is named and described by its row, and the row label flips it', async ({ page }) => {
    await gotoMcpSection(page)
    const tab = mcpTab(page)
    const rows: Array<[string, string]> = [
      [PERSISTENT_LABEL, PERSISTENT_HELP],
      [UNTIL_RESTART_LABEL, UNTIL_RESTART_HELP],
      [AUTH_LABEL, AUTH_HELP],
    ]

    await test.step('12. no aria-label: the row label names the switch, the help line describes it', async () => {
      await expect(tab.getByRole('switch')).toHaveCount(rows.length)
      for (const [label, help] of rows) {
        const toggle = tab.getByRole('switch', { name: label, exact: true })
        await expect(toggle, `${label} carries no aria-label`).not.toHaveAttribute('aria-label')
        await expect(toggle).toHaveAccessibleName(label)
        await expect(toggle).toHaveAccessibleDescription(help)
        await expect(tab.getByLabel(label, { exact: true }), `the ${label} label points at its switch`).toHaveRole(
          'switch',
        )
      }
    })

    await test.step('12. a click on the row label flips the switch, staged only', async () => {
      const auth = tab.getByRole('switch', { name: AUTH_LABEL, exact: true })
      const username = tab.getByRole('textbox', { name: 'Username' })
      await tab.getByText(AUTH_LABEL, { exact: true }).click()
      await expect(auth).toHaveAttribute('aria-checked', 'true')
      await expect(username, 'the staged switch enables the Username input').toBeEnabled()
      await expect(headerButton(page, 'Cancel')).toBeEnabled()
      await tab.getByText(AUTH_LABEL, { exact: true }).click()
      await expect(auth).toHaveAttribute('aria-checked', 'false')
      await expect(username).toBeDisabled()
      await expectClean(page)
    })
  })

  test('frame mcp-server-password-saved: a stored password shows the masked field and a click asks before editing', async ({
    page,
  }) => {
    await storeAuthentication(page)
    await gotoMcpSection(page)

    await test.step('13. the masked field stands in place of the input, centered, on a clean page', async () => {
      await expectPasswordSavedFrame(page)
      await expect(maskedPassword(page), 'the help line describes the masked field').toHaveAccessibleDescription(
        PASSWORD_HELP,
      )
    })

    await test.step('14. a click asks "Edit Protected Value?"; Cancel and Escape keep the stored password', async () => {
      await maskedPassword(page).click()
      const dialog = await expectProtectedValueConfirm(page)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expectStillMasked(page)

      await maskedPassword(page).click()
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expectStillMasked(page)
    })

    const theme = await toggleTheme(page)

    await test.step(`${theme}: the frame and the confirm`, async () => {
      await expectPasswordSavedFrame(page)
      await maskedPassword(page).click()
      const dialog = await expectProtectedValueConfirm(page)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expectStillMasked(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })

    const stored = await (await page.request.get(`${BACKEND_URL}/mcp/settings`)).json()
    expect(stored, 'the stored authentication is untouched').toMatchObject({
      auth_enabled: true,
      auth_username: 'mcp',
      auth_password_set: true,
      running: false,
    })
  })

  test('the heading line, the centered rows and the staged frame hold in the other theme', async ({ page }) => {
    await gotoMcpSection(page)
    const theme = await toggleTheme(page)

    await test.step(`${theme}: faded Cancel and Save on the heading line, centered rows`, async () => {
      await expectHeadingLine(page)
      await expectClean(page)
      await expectRowsCentered(page)
    })

    await test.step(`${theme}: frame mcp-server-save`, async () => {
      await expectSaveFrame(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  })
})
