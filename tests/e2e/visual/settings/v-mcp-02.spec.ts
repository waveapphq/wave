/**
 * V-MCP-02: Settings > MCP Server - live stage / save / restart / disable flow
 *
 * Phase: fixture (serial, mutation group) - starts and stops the real backend MCP listener
 * (binds 127.0.0.1:8765/8766 inside the CI container) and asserts live
 * backend behavior (status text, address URLs, persisted settings), not mere
 * control rendering. Resets the MCP settings to defaults in beforeEach and
 * afterEach so the spec ends with everything disabled (global state clean).
 * Design Decisions: MCP-2, MCP-3, MCP-4, MCP-5, MCP-6, MCP-7, SETTINGS-18, NET-11
 * REQ: REQ-5.2.7.1, REQ-5.2.7.14, REQ-4.7.16
 *
 * Pass Criteria:
 * 1. Staged port validation is immediate: port 80 shows
 *    "Port must be between 1024 and 65535" (testid mcp-port-error) with Save on the
 *    "MCP Server" heading line disabled and faded while Cancel stays enabled. The message is
 *    no alert: the field is `aria-invalid` and described by its help line and the message, which
 *    sits under the field in the error text color (12px), ends at the field's right edge and
 *    leaves the field centered against label + help (NET-11). The backend's
 *    own port shows "Port <n> is used by WAVE itself"; non-digits are stripped from the
 *    field; a valid free port clears the error and enables Save; Cancel, pressed while the
 *    port is invalid, restores the saved port and fades both buttons. Nothing is saved (MCP-4).
 * 2. Enablement is staged (MCP-3): switching "Enable until restart" on sends nothing, shows no
 *    Active cue and leaves the endpoint Stopped; Save, without a dialog, flips the live status
 *    bar to Running (green dot, "0 clients connected") with the loopback address chip
 *    http://127.0.0.1:8765/mcp whose copy button (aria-label "Copy <url>") copies the URL;
 *    the live /mcp/status agrees (MCP-2).
 * 3. The enablement modes are either-or in the page: staging one on turns the other off, the
 *    Active cue and the backend keep the saved mode until Save, and after each Save exactly
 *    one Active cue shows and the endpoint is still Running, in both flip directions.
 * 4. Frame mcp-save-confirm: saving a staged port on the running endpoint opens
 *    "Save MCP server changes?" (warning triangle) with the restart sentence, no exposure
 *    warning and the buttons Cancel and a red "Save and restart", and nothing else; Cancel
 *    keeps the staged port and saves nothing; "Save and restart" restarts the listener onto
 *    the new port - the status bar chip moves to http://127.0.0.1:8766/mcp (MCP-5).
 * 5. Staging Bind scope = Network on the running endpoint adds the amber exposure warning to
 *    the same dialog, still confirmed with "Save and restart" (MCP-6); Cancel saves nothing -
 *    the live backend keeps bind local and only the loopback URL, the staged scope stays in
 *    the page and the heading line's Cancel discards it.
 * 6. Password staged reveal: with auth staged on, the eye toggle appears only while a
 *    replacement is typed (aria-labels "Show password" / "Hide password", switching the
 *    input type), and disappears when the field is cleared (MCP-7).
 * 7. Turning the active mode off is staged too: the endpoint keeps running until Save; Save,
 *    without a dialog, returns the bar to Stopped with the disabled message and no
 *    address-chip row; the live backend reports running false, empty urls, and both
 *    enablement modes off (clean end state).
 * 8. Frame mcp-server-save-running: on the running endpoint the green "Active" cue sits on the
 *    saved mode and stays there while authentication, a username and a new password are
 *    staged; the score under the Password input is four equal 4px segments, all filled in the
 *    success color, and the one word "Very strong" with no other text; the Password label, its
 *    help and the input do not move when the score appears; Cancel removes it (MCP-7).
 * 9. Frame mcp-save-confirm-exposure: on a stopped endpoint, Bind scope = Network opens the
 *    same dialog with the amber exposure warning only and the buttons Cancel and Save; Cancel
 *    keeps the staged scope and saves nothing; Save stores bind network and the endpoint
 *    stays Stopped (MCP-6).
 * 10. In the other theme (flipped from the sidebar) the dialogs of criteria 4 and 9 and the
 *    frame of criterion 8 hold, with that theme's amber, red, green and score colors.
 * 11. Frame mcp-server-password-saved: authentication, a username and a password saved on the
 *    running endpoint (through "Save and restart") leave the endpoint Running with its Active cue
 *    and the Password row holding the masked field in place of the input: pencil, eight dots, a
 *    lock at the right end, as wide as the Username input, 40px tall, centered against label +
 *    help (NET-11), with no score and no eye toggle; Cancel and Save are faded and the backend
 *    reports the password as set (MCP-7).
 * 12. A click on the masked field opens "Edit Protected Value?" (its warning, Cancel, a red
 *    "Delete & Edit"). Cancel keeps the masked field and sends nothing. "Delete & Edit" puts an
 *    empty password input exactly where the masked field was and enables Cancel and Save;
 *    Cancel on the heading line brings the masked field back. Criteria 11 and 12 hold in the
 *    other theme.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT } from '../../helpers/config'
import { resetMcpSettings } from '../../helpers/mcp'
import { toggleTheme } from '../../helpers/theme'

const LOOPBACK_URL_8765 = 'http://127.0.0.1:8765/mcp'
const LOOPBACK_URL_8766 = 'http://127.0.0.1:8766/mcp'
const PORT_RANGE_ERROR = 'Port must be between 1024 and 65535'
const LOCAL_BIND = 'Local only (127.0.0.1)'

const CONFIRM_TITLE = 'Save MCP server changes?'
const RESTART_SENTENCE =
  'The MCP server restarts with the new configuration. Connected assistants are ' +
  'disconnected and must reconnect. The main WAVE server and running executions ' +
  'are not affected.'
const EXPOSURE_WARNING =
  'Bind scope changes to Network: any machine that can reach this server can contact the ' +
  'endpoint. Require authentication to control who may act through WAVE.'

const PORT_HELP = 'The port the MCP endpoint listens on.'
const PASSWORD_HELP = 'Stored sealed; shown write-only like other credentials.'
const MASKED_FIELD_NAME = 'Password: Edit protected value'
const PROTECTED_TITLE = 'Edit Protected Value?'
const PROTECTED_WARNING =
  'Editing will permanently delete the existing protected value. You will need to enter a new ' +
  'value. This action cannot be undone.'
const STRONG_PASSWORD = 'correct-horse-9-Zx'
const CENTER_TOLERANCE_PX = 2

async function gotoMcpSection(page: Page) {
  await page.goto('/settings/mcp')
  await page.waitForSelector('[data-testid="mcp-server-tab"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="mcp-status-bar"]', { state: 'visible' })
}

async function fetchJson(page: Page, path: string): Promise<any> {
  const response = await page.request.get(`${BACKEND_URL}${path}`)
  return response.json()
}

/** Cancel or Save on the "MCP Server" heading line (SETTINGS-18). */
function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return page
    .locator('[data-testid="mcp-server-tab"]')
    .getByRole('heading', { level: 2, name: 'MCP Server', exact: true })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })
}

function passwordInput(page: Page): Locator {
  return page.getByLabel('Password', { exact: true })
}

/** Every PUT of the MCP settings the page sends. */
function recordSaves(page: Page): string[] {
  const saves: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/mcp/settings')) {
      saves.push(request.url())
    }
  })
  return saves
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
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

async function isDark(page: Page): Promise<boolean> {
  return (await page.locator('html').getAttribute('data-theme')) === 'dark'
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

async function stageNetworkBind(page: Page): Promise<void> {
  await page.locator('[data-testid="mcp-bind-select"]').click()
  await page.getByRole('option', { name: 'Network', exact: true }).click()
  await expect(page.locator('[data-testid="mcp-bind-select"]')).toContainText('Network')
}

/** MCP-5, MCP-6: the one Save confirmation with exactly the parts the staged change calls for. */
async function expectConfirmation(page: Page, parts: { restart: boolean; exposure: boolean }): Promise<void> {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText(CONFIRM_TITLE)
  await expect(dialog.locator('[data-confirmation-icon]')).toHaveAttribute('data-icon', 'alert-triangle')

  const sentence = dialog.getByText(RESTART_SENTENCE, { exact: true })
  if (parts.restart) await expect(sentence).toBeVisible()
  else await expect(sentence, 'no restart sentence on a stopped endpoint').toHaveCount(0)

  const exposure = dialog.locator('[data-testid="mcp-exposure-warning"]')
  if (parts.exposure) {
    await expect(exposure).toHaveText(EXPOSURE_WARNING)
    await expect(exposure.locator('strong')).toHaveText('Network')
    await expect(exposure.locator('svg'), 'the warning carries its icon').toHaveCount(1)
    const amber = (await isDark(page)) ? '--color-amber-100' : '--color-amber-900'
    await expect(exposure, 'the warning reads in the amber of the theme').toHaveCSS(
      'color',
      await tokenColor(page, amber),
    )
  } else {
    await expect(exposure, 'no exposure warning while the bind scope stays').toHaveCount(0)
  }

  await expect(
    dialog.locator(':scope > :not([aria-hidden="true"]):not(.sr-only)'),
    'the title, the stated parts and the buttons, nothing else',
  ).toHaveCount(2 + Number(parts.restart) + Number(parts.exposure))
  const confirmLabel = parts.restart ? 'Save and restart' : 'Save'
  await expect(dialog.getByRole('button')).toHaveText(['Cancel', confirmLabel])
  await expect(
    dialog.getByRole('button', { name: confirmLabel, exact: true }),
    'the confirm button reads in the red of the theme',
  ).toHaveCSS('background-color', await tokenColor(page, '--color-error-text'))
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

/** NET-11: the Password label and help are centered on the input itself, score or not. */
async function expectPasswordRowCentered(page: Page, control: Locator = passwordInput(page)): Promise<void> {
  const row = page.locator('[data-testid="mcp-auth-password-row"]')
  const label = await boxOf(row.getByText('Password', { exact: true }))
  const help = await boxOf(row.getByText(PASSWORD_HELP, { exact: true }))
  const input = await boxOf(control)
  const offset = Math.abs(input.y + input.height / 2 - (label.y + help.y + help.height) / 2)
  expect(offset, 'the Password label and help are centered on the input (NET-11)').toBeLessThanOrEqual(
    CENTER_TOLERANCE_PX,
  )
}

/** MCP-7: four equal thin segments, all filled in the success color, the one word "Very strong". */
async function expectVeryStrongScore(page: Page): Promise<void> {
  const host = page.locator('#mcp-password-strength')
  await expect(host, 'the score reads one word').toHaveText('Very strong')
  await expect(host.locator('xpath=..'), 'no other text under the Password input').toHaveText('Very strong')
  await expect(page.getByRole('meter', { name: 'Password strength' })).toHaveAttribute(
    'aria-valuetext',
    'Very strong',
  )

  const bar = host.locator('[aria-hidden="true"]')
  const segments = bar.locator('span')
  await expect(segments).toHaveCount(4)
  const filled = await tokenColor(page, '--color-success-text')
  expect(filled, 'a filled segment differs from an empty one').not.toBe(await tokenColor(page, '--input'))
  const widths: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const segment = segments.nth(index)
    await expect(segment, `segment ${index + 1} is thin`).toHaveCSS('height', '4px')
    await expect(segment, `segment ${index + 1} is filled`).toHaveCSS('background-color', filled)
    widths.push((await boxOf(segment)).width)
  }
  expect(Math.max(...widths) - Math.min(...widths), 'the four segments are equal').toBeLessThanOrEqual(0.5)

  const input = await boxOf(passwordInput(page))
  const barBox = await boxOf(bar)
  const gap = barBox.y - (input.y + input.height)
  expect(gap, 'the score sits under the input').toBeGreaterThanOrEqual(0)
  expect(gap, 'the score sits directly under the input').toBeLessThanOrEqual(12)
  expect(Math.abs(barBox.width - input.width), 'the score is as wide as the input').toBeLessThanOrEqual(1)
}

/** Stages "Enable MCP server" and saves it: the endpoint runs in the persistent mode. */
async function startPersistent(page: Page): Promise<void> {
  await page.getByRole('switch', { name: 'Enable MCP server' }).click()
  await expectDirty(page)
  await headerButton(page, 'Save').click()
  await expect(
    page.locator('[data-testid="mcp-status-bar"]').getByText('Running', { exact: true }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('alertdialog'), 'starting a stopped endpoint asks nothing').toBeHidden()
  await expectClean(page)
}

/** Frame mcp-server-save-running: stage the frame, check it, then Cancel back to the saved state. */
async function expectRunningFrame(page: Page): Promise<void> {
  const cue = page.locator('[data-testid="mcp-persistent-active"]')
  const authSwitch = page.getByRole('switch', { name: 'Require authentication' })
  const green = (await isDark(page)) ? '--color-emerald-400' : '--color-emerald-600'
  await expect(cue).toHaveText('Active')
  await expect(cue, 'the cue reads in the green of the theme').toHaveCSS('color', await tokenColor(page, green))
  await expect(page.locator('[data-testid="mcp-until-restart-active"]')).toHaveCount(0)

  await authSwitch.click()
  await expect(authSwitch).toHaveAttribute('data-state', 'checked')
  await page.getByRole('textbox', { name: 'Username' }).fill('mcp')
  const before = await passwordRowOffsets(page)
  await passwordInput(page).fill(STRONG_PASSWORD)
  await expectVeryStrongScore(page)
  const after = await passwordRowOffsets(page)
  for (const part of ['label', 'help', 'input'] as const) {
    expect(
      Math.abs(after[part] - before[part]),
      `the Password ${part} stays put when the score appears`,
    ).toBeLessThanOrEqual(0.5)
  }
  await expectPasswordRowCentered(page)

  await expectDirty(page)
  await expect(cue, 'the cue stays on the saved mode with a change staged').toBeVisible()
  const settings = await fetchJson(page, '/mcp/settings')
  expect(settings.auth_enabled, 'the staged authentication is not saved').toBe(false)
  expect(settings.running).toBe(true)

  await headerButton(page, 'Cancel').click()
  await expect(passwordInput(page)).toHaveValue('')
  await expect(page.locator('#mcp-password-strength > *'), 'Cancel removes the score').toHaveCount(0)
  await expect(authSwitch).toHaveAttribute('data-state', 'unchecked')
  await expect(cue).toBeVisible()
  await expectClean(page)
}

/** MCP-4: the Port message is linked to the field, sits under it and leaves the row centered. */
async function expectPortMessage(page: Page, message: string): Promise<void> {
  const tab = page.locator('[data-testid="mcp-server-tab"]')
  const portInput = page.getByRole('textbox', { name: 'Port' })
  const portError = page.locator('[data-testid="mcp-port-error"]')
  const error = await tokenColor(page, '--color-error-text')
  await expect(portError).toHaveText(message)
  await expect(portError, 'the message is no alert').not.toHaveAttribute('role', 'alert')
  await expect(tab.getByRole('alert'), 'the page raises no alert for a staged port').toHaveCount(0)
  await expect(portInput).toHaveAttribute('aria-invalid', 'true')
  await expect(portInput, 'the help line and the message describe the field').toHaveAccessibleDescription(
    `${PORT_HELP} ${message}`,
  )
  await expect(portError).toHaveCSS('color', error)
  await expect(portError).toHaveCSS('font-size', '12px')

  const input = await boxOf(portInput)
  const text = await boxOf(portError)
  const label = await boxOf(tab.getByText('Port', { exact: true }))
  const help = await boxOf(tab.getByText(PORT_HELP, { exact: true }))
  expect(text.y, 'the message sits under the field').toBeGreaterThanOrEqual(input.y + input.height)
  expect(
    Math.abs(text.x + text.width - (input.x + input.width)),
    'the message ends at the field edge',
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(input.y + input.height / 2 - (label.y + help.y + help.height) / 2),
    'the field stays centered against label + help (NET-11)',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
}

/** Where a control sits inside its row, and its size. */
async function placeInRow(row: Locator, control: Locator): Promise<number[]> {
  const rowBox = await boxOf(row)
  const box = await boxOf(control)
  return [box.x - rowBox.x, box.y - rowBox.y, box.width, box.height]
}

function maskedPassword(page: Page): Locator {
  return page
    .locator('[data-testid="mcp-auth-password-row"]')
    .getByRole('button', { name: MASKED_FIELD_NAME, exact: true })
}

/** Frame mcp-server-password-saved: Running, the Active cue and the masked field (MCP-7). */
async function expectPasswordSavedFrame(page: Page): Promise<void> {
  // A hovered masked field shows its hint; the frame is drawn with the pointer elsewhere.
  await page.mouse.move(0, 0)
  const row = page.locator('[data-testid="mcp-auth-password-row"]')
  const field = maskedPassword(page)
  const username = page.getByRole('textbox', { name: 'Username' })

  await expect(
    page.locator('[data-testid="mcp-status-bar"]').getByText('Running', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('[data-testid="mcp-persistent-active"]')).toHaveText('Active')
  await expect(page.getByRole('switch', { name: 'Require authentication' })).toHaveAttribute('data-state', 'checked')
  await expect(username).toHaveValue('mcp')
  await expect(row, 'the row is not faded while authentication is on').toHaveCSS('opacity', '1')
  await expect(field).toBeEnabled()
  await expect(row.locator('input'), 'a stored password shows no input').toHaveCount(0)
  await expect(field, 'the Password label points at the masked field').toHaveAttribute(
    'id',
    (await row.locator('label').getAttribute('for')) ?? '',
  )
  await expect(page.locator('#mcp-password-strength > *'), 'a stored password has no score').toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(Show|Hide) password$/ })).toHaveCount(0)

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
  expect(
    fieldBox.x + fieldBox.width - (lockBox.x + lockBox.width),
    'the lock sits inside the field, at its right end',
  ).toBeGreaterThan(0)
  expect(
    fieldBox.x + fieldBox.width - (lockBox.x + lockBox.width),
    'the lock sits inside the field, at its right end',
  ).toBeLessThanOrEqual(16)

  await expectPasswordRowCentered(page, field)
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

test.describe('V-MCP-02: MCP Server live flow', () => {
  // The frames are drawn at this scale.
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test.afterEach(async ({ page }) => {
    // The spec must leave everything disabled even if an assertion failed.
    await resetMcpSettings(page)
  })

  test('staged port edits validate immediately and gate Save while Cancel stays enabled', async ({ page }) => {
    await gotoMcpSection(page)
    const saves = recordSaves(page)

    const portInput = page.getByRole('textbox', { name: 'Port' })
    const portError = page.locator('[data-testid="mcp-port-error"]')
    const save = headerButton(page, 'Save')
    const cancel = headerButton(page, 'Cancel')

    // Out-of-range port: inline range error, Save disabled and faded, Cancel still enabled
    await expect(portInput, 'a valid port is described by its help line alone').toHaveAccessibleDescription(PORT_HELP)
    await portInput.fill('80')
    await expectPortMessage(page, PORT_RANGE_ERROR)
    await expect(save).toBeDisabled()
    await expect(save).toHaveCSS('opacity', '0.5')
    await expect(save).toHaveCSS('cursor', 'not-allowed')
    await expect(cancel).toBeEnabled()
    await expect(cancel).toHaveCSS('opacity', '1')

    // WAVE's own serving port is rejected as staged
    await portInput.fill(BACKEND_PORT)
    await expectPortMessage(page, `Port ${BACKEND_PORT} is used by WAVE itself`)
    await expect(save).toBeDisabled()
    await expect(cancel).toBeEnabled()

    // One number rule: a whole text holding letters is refused and the port keeps its value;
    // typed key by key, each letter is refused and the digits stay.
    await portInput.fill('12ab34')
    await expect(portInput).toHaveValue(BACKEND_PORT)
    await portInput.selectText()
    await portInput.pressSequentially('12ab34')
    await expect(portInput).toHaveValue('1234')
    await expect(portError).toHaveCount(0)
    await expect(portInput, 'a valid port loses its mark').not.toHaveAttribute('aria-invalid')
    await expect(portInput).toHaveAccessibleDescription(PORT_HELP)
    await expect(save).toBeEnabled()
    await expect(cancel).toBeEnabled()

    // Cancel, pressed while the port is invalid, restores the saved port and fades both buttons
    await portInput.fill('80')
    await expect(portError).toHaveText(PORT_RANGE_ERROR)
    await expect(save).toBeDisabled()
    await cancel.click()
    await expect(portInput).toHaveValue('8765')
    await expect(portError).toHaveCount(0)
    await expectClean(page)

    expect(saves, 'a staged port sends nothing').toEqual([])
    expect((await fetchJson(page, '/mcp/settings')).port).toBe(8765)
  })

  test('stage and save: enable -> either-or flip -> port restart -> Network dialog cancel -> staged reveal -> disable', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await gotoMcpSection(page)
    const saves = recordSaves(page)

    const statusBar = page.locator('[data-testid="mcp-status-bar"]')
    const statusDot = statusBar.locator('span[aria-hidden="true"]').first()
    const persistentSwitch = page.getByRole('switch', { name: 'Enable MCP server' })
    const untilRestartSwitch = page.getByRole('switch', { name: 'Enable until restart' })
    const persistentActive = page.locator('[data-testid="mcp-persistent-active"]')
    const untilRestartActive = page.locator('[data-testid="mcp-until-restart-active"]')
    const portInput = page.getByRole('textbox', { name: 'Port' })
    const bindSelect = page.locator('[data-testid="mcp-bind-select"]')
    const save = headerButton(page, 'Save')
    const cancel = headerButton(page, 'Cancel')
    const dialog = page.getByRole('alertdialog')

    await test.step('MCP-2/3: "Enable until restart" is staged; Save flips the live status to Running with the loopback chip', async () => {
      await untilRestartSwitch.click()
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'checked')
      await expectDirty(page)

      // Nothing acts before Save: no request, no cue, the listener stays down
      await expect(untilRestartActive).toHaveCount(0)
      await expect(statusBar.getByText('Stopped', { exact: true })).toBeVisible()
      const staged = await fetchJson(page, '/mcp/status')
      expect(staged.running).toBe(false)
      expect(staged.until_restart_active).toBe(false)
      expect(saves, 'the switch sends nothing').toHaveLength(0)

      await save.click()
      await expect(statusBar.getByText('Running', { exact: true })).toBeVisible({
        timeout: 10_000,
      })
      await expect(dialog, 'starting a stopped endpoint asks nothing').toBeHidden()
      expect(saves, 'one Save, one request').toHaveLength(1)
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'checked')
      await expect(untilRestartActive).toBeVisible()
      await expectClean(page)
      // Chromium serializes the Tailwind emerald token as oklch; assert the class token instead
      await expect(statusDot).toHaveClass(/bg-emerald-500/)
      await expect(statusBar.getByText('0 clients connected')).toBeVisible()

      // Running shows an address-chip list with a per-chip Copy <url> button
      await expect(statusBar.getByText(LOOPBACK_URL_8765)).toBeVisible()
      const copyButton = statusBar.getByRole('button', { name: `Copy ${LOOPBACK_URL_8765}` })
      await expect(copyButton).toBeVisible()
      await copyButton.click()
      await expect(statusBar.locator('[data-testid="mcp-copy-success"]')).toBeVisible()
      const clipboard = await page.evaluate(() => navigator.clipboard.readText())
      expect(clipboard, 'copy button should copy the chip URL').toBe(LOOPBACK_URL_8765)

      // Live backend agreement: the listener is really up on the loopback URL
      const status = await fetchJson(page, '/mcp/status')
      expect(status.running).toBe(true)
      expect(status.urls).toEqual([LOOPBACK_URL_8765])
      expect(status.last_error).toBeNull()
    })

    await test.step('MCP-3: the modes are either-or in the page; each saved flip moves the Active cue and keeps the endpoint Running', async () => {
      const sent = saves.length

      // Staging persistent on turns until-restart off in the page only
      await persistentSwitch.click()
      await expect(persistentSwitch).toHaveAttribute('data-state', 'checked')
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'unchecked')
      await expect(untilRestartActive, 'the cue stays on the saved mode until Save').toBeVisible()
      await expect(persistentActive).toHaveCount(0)
      let status = await fetchJson(page, '/mcp/status')
      expect(status.enabled).toBe(false)
      expect(status.until_restart_active).toBe(true)
      expect(saves).toHaveLength(sent)

      await save.click()
      await expect(persistentActive).toBeVisible()
      await expect(untilRestartActive).toHaveCount(0)
      await expect(dialog, 'a mode flip asks nothing').toBeHidden()
      await expect(statusBar.getByText('Running', { exact: true })).toBeVisible()
      await expect(statusBar.getByText(LOOPBACK_URL_8765)).toBeVisible()
      await expectClean(page)
      status = await fetchJson(page, '/mcp/status')
      expect(status.running).toBe(true)
      expect(status.enabled).toBe(true)
      expect(status.until_restart_active).toBe(false)
      expect(saves).toHaveLength(sent + 1)

      // The reverse flip keeps it Running too
      await untilRestartSwitch.click()
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'checked')
      await expect(persistentSwitch).toHaveAttribute('data-state', 'unchecked')
      await expect(persistentActive, 'the cue stays on the saved mode until Save').toBeVisible()
      await expect(untilRestartActive).toHaveCount(0)
      expect((await fetchJson(page, '/mcp/status')).enabled).toBe(true)
      expect(saves).toHaveLength(sent + 1)

      await save.click()
      await expect(untilRestartActive).toBeVisible()
      await expect(persistentActive).toHaveCount(0)
      await expect(statusBar.getByText('Running', { exact: true })).toBeVisible()
      await expectClean(page)
      status = await fetchJson(page, '/mcp/status')
      expect(status.running).toBe(true)
      expect(status.enabled).toBe(false)
      expect(status.until_restart_active).toBe(true)
      expect(saves).toHaveLength(sent + 2)
    })

    await test.step('MCP-5: frame mcp-save-confirm - a staged port asks first, then restarts onto the new port', async () => {
      const sent = saves.length
      await portInput.fill('8766')
      await expectDirty(page)
      await save.click()
      // A port-only change carries the restart sentence and no exposure warning
      await expectConfirmation(page, { restart: true, exposure: false })

      // Cancel in the dialog keeps the staged port and saves nothing
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await expect(portInput).toHaveValue('8766')
      await expectDirty(page)
      expect(saves).toHaveLength(sent)
      expect((await fetchJson(page, '/mcp/status')).urls).toEqual([LOOPBACK_URL_8765])

      await save.click()
      await expectConfirmation(page, { restart: true, exposure: false })
      await dialog.getByRole('button', { name: 'Save and restart' }).click()
      await expect(dialog).toBeHidden()

      // Live behavior: the listener restarted onto 8766 (chip moved, old URL gone)
      await expect(statusBar.getByText(LOOPBACK_URL_8766)).toBeVisible({ timeout: 10_000 })
      await expect(statusBar.getByText('Running', { exact: true })).toBeVisible()
      await expect(statusBar.getByText(LOOPBACK_URL_8765)).toHaveCount(0)
      await expectClean(page)

      const status = await fetchJson(page, '/mcp/status')
      expect(status.running).toBe(true)
      expect(status.port).toBe(8766)
      expect(status.urls).toEqual([LOOPBACK_URL_8766])
      expect(saves).toHaveLength(sent + 1)
    })

    await test.step('MCP-6: staging Network adds the amber exposure warning to the restart dialog; Cancel keeps Local', async () => {
      const sent = saves.length
      await stageNetworkBind(page)
      await expectDirty(page)
      await save.click()
      await expectConfirmation(page, { restart: true, exposure: true })

      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()

      // Nothing saved: the live backend keeps bind local with only the loopback URL
      expect(saves).toHaveLength(sent)
      const settings = await fetchJson(page, '/mcp/settings')
      expect(settings.bind).toBe('local')
      const status = await fetchJson(page, '/mcp/status')
      expect(status.urls).toEqual([LOOPBACK_URL_8766])

      // The staged scope stays in the page; the heading line's Cancel discards it
      await expect(bindSelect).toContainText('Network')
      await expectDirty(page)
      await cancel.click()
      await expect(bindSelect).toContainText(LOCAL_BIND)
      await expectClean(page)
    })

    await test.step('MCP-7: password staged reveal appears only while a replacement is typed', async () => {
      await page.getByRole('switch', { name: 'Require authentication' }).click()
      const password = passwordInput(page)
      await expect(password).toBeEnabled()

      // No eye toggle before anything is typed
      await expect(page.getByRole('button', { name: /^(Show|Hide) password$/ })).toHaveCount(0)

      await password.fill('e2e-staged-secret')
      const showButton = page.getByRole('button', { name: 'Show password' })
      await expect(showButton).toBeVisible()
      await expect(password).toHaveAttribute('type', 'password')

      // The toggle switches the input type both ways
      await showButton.click()
      await expect(password).toHaveAttribute('type', 'text')
      await expect(password).toHaveValue('e2e-staged-secret')
      const hideButton = page.getByRole('button', { name: 'Hide password' })
      await expect(hideButton).toBeVisible()
      await hideButton.click()
      await expect(password).toHaveAttribute('type', 'password')

      // Clearing the field removes the toggle
      await password.fill('')
      await expect(page.getByRole('button', { name: /^(Show|Hide) password$/ })).toHaveCount(0)

      // Discard the staged auth edit before the shutdown step
      await cancel.click()
      await expect(page.getByRole('switch', { name: 'Require authentication' })).toHaveAttribute(
        'data-state',
        'unchecked',
      )
    })

    await test.step('MCP-3: turning the mode off is staged; Save returns Stopped with no address chips and a clean backend state', async () => {
      const sent = saves.length
      await untilRestartSwitch.click()
      await expect(untilRestartSwitch).toHaveAttribute('data-state', 'unchecked')

      // The endpoint keeps running until Save
      await expect(untilRestartActive).toBeVisible()
      await expect(statusBar.getByText('Running', { exact: true })).toBeVisible()
      expect((await fetchJson(page, '/mcp/status')).running).toBe(true)
      expect(saves).toHaveLength(sent)

      await save.click()
      await expect(statusBar.getByText('Stopped', { exact: true })).toBeVisible({
        timeout: 10_000,
      })
      await expect(dialog, 'stopping the endpoint asks nothing').toBeHidden()
      await expect(untilRestartActive).toHaveCount(0)
      await expect(statusBar.getByText('The MCP endpoint is disabled.')).toBeVisible()
      // The chip row is absent when Stopped
      await expect(statusBar.getByText(/^http:\/\//)).toHaveCount(0)
      await expect(statusBar.getByRole('button', { name: /^Copy http/ })).toHaveCount(0)
      await expectClean(page)

      // Live backend clean: everything disabled, no listener, no URLs
      const settings = await fetchJson(page, '/mcp/settings')
      expect(settings.enabled).toBe(false)
      expect(settings.until_restart_active).toBe(false)
      expect(settings.running).toBe(false)
      const status = await fetchJson(page, '/mcp/status')
      expect(status.running).toBe(false)
      expect(status.urls).toEqual([])
      expect(saves).toHaveLength(sent + 1)
    })
  })

  test('frame mcp-server-save-running: the Active cue stays on the saved mode while a Very strong password is staged', async ({
    page,
  }) => {
    await gotoMcpSection(page)
    const saves = recordSaves(page)

    await startPersistent(page)
    const status = await fetchJson(page, '/mcp/status')
    expect(status.running).toBe(true)
    expect(status.enabled).toBe(true)

    await expectRunningFrame(page)
    expect(saves, 'the page sent one Save, the start').toHaveLength(1)
  })

  test('frame mcp-server-password-saved: a saved password shows the masked field and "Edit Protected Value?" guards it', async ({
    page,
  }) => {
    await gotoMcpSection(page)
    const saves = recordSaves(page)
    const restart = page.getByRole('alertdialog')
    const row = page.locator('[data-testid="mcp-auth-password-row"]')

    await startPersistent(page)

    await test.step('11. authentication with a password is saved on the running endpoint', async () => {
      await page.getByRole('switch', { name: 'Require authentication' }).click()
      await page.getByRole('textbox', { name: 'Username' }).fill('mcp')
      await passwordInput(page).fill(STRONG_PASSWORD)
      await expectDirty(page)
      await headerButton(page, 'Save').click()
      await expectConfirmation(page, { restart: true, exposure: false })
      await restart.getByRole('button', { name: 'Save and restart' }).click()
      await expect(restart).toBeHidden()
      await expect(maskedPassword(page)).toBeVisible({ timeout: 10_000 })
      expect(saves, 'the start and the authentication').toHaveLength(2)
      expect(await fetchJson(page, '/mcp/settings'), 'the backend holds the saved authentication').toMatchObject({
        enabled: true,
        running: true,
        auth_enabled: true,
        auth_username: 'mcp',
        auth_password_set: true,
      })
    })

    await test.step('11. frame mcp-server-password-saved', async () => {
      await expectPasswordSavedFrame(page)
    })

    await test.step('12. a click asks "Edit Protected Value?"; Cancel keeps the masked field', async () => {
      await maskedPassword(page).click()
      const dialog = await expectProtectedValueConfirm(page)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect(maskedPassword(page)).toBeVisible()
      await expectClean(page)
      expect(saves, 'the question sends nothing').toHaveLength(2)
    })

    const theme = await toggleTheme(page)
    let maskedPlace: number[] = []

    await test.step(`${theme}: the frame and the confirm`, async () => {
      await expectPasswordSavedFrame(page)
      maskedPlace = await placeInRow(row, maskedPassword(page))
      await maskedPassword(page).click()
      await expectProtectedValueConfirm(page)
    })

    await test.step('12. "Delete & Edit" puts an empty input where the masked field was; Cancel brings it back', async () => {
      const dialog = page.getByRole('dialog', { name: PROTECTED_TITLE, exact: true })
      await dialog.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
      await expect(dialog).toBeHidden()

      const input = row.locator('input')
      await expect(input).toHaveCount(1)
      await expect(input).toHaveAttribute('type', 'password')
      await expect(input).toHaveValue('')
      await expect(input).toBeEnabled()
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(row.locator('svg.lucide-lock'), 'the lock leaves with the stored value').toHaveCount(0)
      await expect(page.locator('#mcp-password-strength > *'), 'an empty input has no score').toHaveCount(0)
      const typedPlace = await placeInRow(row, input)
      for (const [index, what] of ['x', 'y', 'width', 'height'].entries()) {
        expect(
          Math.abs(typedPlace[index] - maskedPlace[index]),
          `the input takes the masked field's ${what}`,
        ).toBeLessThanOrEqual(1)
      }
      await expectPasswordRowCentered(page)
      await expectDirty(page)
      expect(saves, 'the emptied field waits for Save').toHaveLength(2)
      expect((await fetchJson(page, '/mcp/settings')).auth_password_set, 'the stored password is still there').toBe(true)

      await headerButton(page, 'Cancel').click()
      await expect(maskedPassword(page)).toBeVisible()
      await expect(row.locator('input')).toHaveCount(0)
      await expectClean(page)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  })

  test('frame mcp-save-confirm-exposure: a stopped endpoint widened to Network asks with the exposure warning only', async ({
    page,
  }) => {
    await gotoMcpSection(page)
    const saves = recordSaves(page)

    const statusBar = page.locator('[data-testid="mcp-status-bar"]')
    const bindSelect = page.locator('[data-testid="mcp-bind-select"]')
    const dialog = page.getByRole('alertdialog')

    await stageNetworkBind(page)
    await expectDirty(page)
    await headerButton(page, 'Save').click()
    await expectConfirmation(page, { restart: false, exposure: true })

    // Cancel in the dialog keeps the staged scope and saves nothing
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(bindSelect).toContainText('Network')
    await expectDirty(page)
    expect(saves).toHaveLength(0)
    expect((await fetchJson(page, '/mcp/settings')).bind).toBe('local')

    // Save stores the wider scope; nothing starts
    await headerButton(page, 'Save').click()
    await expectConfirmation(page, { restart: false, exposure: true })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => (await fetchJson(page, '/mcp/settings')).bind, {
        message: 'the confirmed Save stores bind network',
      })
      .toBe('network')
    await expectClean(page)
    await expect(bindSelect).toContainText('Network')
    await expect(statusBar.getByText('Stopped', { exact: true })).toBeVisible()
    expect((await fetchJson(page, '/mcp/status')).running).toBe(false)
    expect(saves).toHaveLength(1)
  })

  test('the running frame and both confirmations hold in the other theme', async ({ page }) => {
    await gotoMcpSection(page)
    const theme = await toggleTheme(page)
    const saves = recordSaves(page)
    const dialog = page.getByRole('alertdialog')

    await test.step(`${theme}: frame mcp-save-confirm-exposure on the stopped endpoint`, async () => {
      await stageNetworkBind(page)
      await headerButton(page, 'Save').click()
      await expectConfirmation(page, { restart: false, exposure: true })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await headerButton(page, 'Cancel').click()
      await expectClean(page)
      expect(saves).toHaveLength(0)
    })

    await test.step(`${theme}: frame mcp-server-save-running`, async () => {
      await startPersistent(page)
      await expectRunningFrame(page)
    })

    await test.step(`${theme}: frame mcp-save-confirm on the running endpoint`, async () => {
      await page.getByRole('textbox', { name: 'Port' }).fill('8766')
      await headerButton(page, 'Save').click()
      await expectConfirmation(page, { restart: true, exposure: false })
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await headerButton(page, 'Cancel').click()
      await expectClean(page)
      expect((await fetchJson(page, '/mcp/status')).urls).toEqual([LOOPBACK_URL_8765])
      expect(saves, 'the page sent one Save, the start').toHaveLength(1)
    })

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  })
})
