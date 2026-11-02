/**
 * V-MCP-SETTINGS-FUNCTIONAL: Settings > MCP Server saves into the config file and drives the real endpoint
 * Design Decisions: MCP-2, MCP-3, MCP-4, MCP-5, MCP-6, MCP-7, MCP-8, SETTINGS-18, NET-1, NET-10, NET-11
 * REQ: REQ-5.2.7.1, REQ-4.7.16, REQ-4.7.17, REQ-3.1.3.5
 *
 * Every change goes through the page on the stack. Its effect is proven by the stack's own config
 * file, by `GET /mcp/settings` and `GET /mcp/status`, and by a real MCP `initialize` sent to the
 * endpoint's port. The MCP settings are stored with the port `SAVED_PORT` before every test and
 * reset after it.
 *
 * Pass Criteria:
 * 1. Clean page: Cancel, then Save, sit on the "MCP Server" heading line and are disabled; the
 *    Enablement and Endpoint groups are a heading, one subtitle and their rows, with Sessions right
 *    after Endpoint; a staged port of 80 shows `Port must be between 1024 and 65535`, keeps Save
 *    disabled and Cancel enabled; Cancel restores the saved port and the file is unchanged.
 * 1a. The Port row holds a region with `aria-live="polite"` before any message. Port 80 puts
 *    `Port must be between 1024 and 65535` into that same region; the Port field is marked invalid
 *    and its description reads the help line and the message; the message is no alert. Two more
 *    digits that keep the message change nothing in the region; a valid port empties it. Each
 *    switch is named by its row label, carries no label of its own, and a click on the row label
 *    turns it.
 * 2. Enable MCP server on: the status stays Stopped, `GET /mcp/settings` reads `enabled: false` and
 *    nothing listens until Save; Save writes at once with no confirmation, the status reads Running,
 *    the file holds `enabled: true` and the port answers.
 * 3. Enable until restart turned on while Enable MCP server is staged on turns the latter off;
 *    Save starts the endpoint in that mode only and the file keeps `enabled: false`.
 * 4. A staged port on a running endpoint: Save opens `Save MCP server changes?` with the restart
 *    sentence, Cancel and `Save and restart`; Cancel keeps the staged port and writes nothing;
 *    confirming moves the endpoint to the new port (it answers, the old port refuses) and the file
 *    holds the port.
 * 5. Bind scope Network: on a stopped endpoint the confirmation carries the exposure warning alone
 *    with Cancel and Save, Cancel writes nothing and Save writes `bind: network`; on a running
 *    endpoint the warning joins the restart sentence and the confirm reads `Save and restart`.
 * 6. Typing `password` shows four empty segments and the one word `Very weak`; a long passphrase
 *    shows four filled segments and `Very strong`; nothing else is under the input; clearing the
 *    field hides the score; Save stays enabled and a Save with the weak password is stored.
 * 7. Authentication saved with a password: the file holds a `wave:enc:v1:` value and never the
 *    password, `auth_password_set` is true, the Password row shows the masked field "Edit protected
 *    value" with no input and no score, and the endpoint answers 401 without the credentials and
 *    200 with them.
 * 7a. A new password over a stored one: the masked field opens "Edit Protected Value?"; Cancel
 *    keeps the stored password; "Delete & Edit" shows an empty Password input and stores nothing;
 *    `Save and restart` sends the new password alone, the file holds another sealed value and
 *    never the password, and the endpoint refuses the old password and answers the new one.
 * 7b. "Delete & Edit", Require authentication off, `Save and restart`: the write carries
 *    `auth_enabled: false` and an empty password, the file holds no sealed value,
 *    `auth_password_set` is false and the endpoint answers without credentials; authentication
 *    turned on again shows an empty Password input.
 * 7c. With authentication on, "Delete & Edit" and a Save with nothing typed is refused: the write
 *    answers 400 and the toast "Could Not Save MCP Server" reads exactly `Password is required when
 *    authentication is enabled`; the empty input and the staged change stay, the file is unchanged
 *    and the endpoint still asks for the stored password.
 * 7d. Cancel on the page after "Delete & Edit", and again after a typed replacement shows its
 *    score: the masked field is back in the Password row with nothing under it, Cancel and Save are
 *    disabled, no write left the page, the file is unchanged and the stored password still opens
 *    the endpoint.
 * 7e. Keyboard only: Tab from Username lands on the masked Password and Enter asks the question;
 *    after Cancel and after Escape focus is on the masked field again; after "Delete & Edit" focus
 *    is in the Password input and typed keys land in it.
 * 7f. Mouse, with focus in Username and the question asked by a click that leaves focus where it
 *    is: after Cancel focus is on the masked field; after "Delete & Edit" focus is in the Password
 *    input, typed keys land in it and Username is unchanged.
 * 8. Enable MCP server off on a running endpoint: nothing stops until Save; Save writes at once
 *    with no confirmation, the status reads Stopped, the port refuses and the file holds
 *    `enabled: false`.
 * 9. With the config file read-only, a confirmed Save shows the toast "Could Not Save MCP Server"
 *    with exactly `Settings cannot be saved: the config file {path} is read-only`; the staged port
 *    stays, the file is unchanged and the endpoint still answers on the saved port.
 * 10. `POST /api/v1/system/password-strength` answers `score` and `label` only with
 *    `Cache-Control: no-store`; the same password scores lower with the username among
 *    `user_inputs`, and the page shows that lower score once the username is typed in its row.
 * 10a. Leaving with a staged port on a running endpoint asks "Unsaved changes"; its Save closes it
 *    and opens `Save MCP server changes?`; confirming saves, leaves and moves the endpoint;
 *    canceling the confirmation stays on MCP Server with the staged port; Discard leaves and
 *    saves nothing.
 * 11. `resetMcpSettings` puts the defaults back in the file, clears the stored password and stops
 *    the endpoint.
 * 12. A failed first read shows the API's reason and Try Again, with no Cancel or Save on the
 *    heading line; with the read answering again, Try Again shows the status bar and both groups.
 * 13. A failed status poll shows `{reason} (showing the last known state)` and keeps the status
 *    bar and both groups as they were, even when the endpoint stopped meanwhile; the next good
 *    poll clears the line and shows the real state.
 * 14. A refused Disconnect shows the toast "Could Not Disconnect Session" with the reason and keeps
 *    the row and the session; Disconnect removes the row and the endpoint refuses the session.
 */

import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { apiPathMatcher, countApiFetches, failApiRoute } from '../../helpers/api-route'
import { configSection, readConfigText, stackPaths, withMode } from '../../helpers/config-file'
import {
  MCP_DEFAULTS,
  askMcpEndpoint,
  askMcpSession,
  connectMcpClient,
  mcpEndpointUrl,
  resetMcpSettings,
  type McpCredentials,
} from '../../helpers/mcp'
import { BACKEND_DIR } from '../../helpers/spawn-backend'

// ============================================================================
// Constants
// ============================================================================

// Ports no other spec binds, ten apart so parallel stacks never share one.
const SAVED_PORT = Number(BACKEND_PORT) + 781
const NEW_PORT = Number(BACKEND_PORT) + 791
const THIRD_PORT = Number(BACKEND_PORT) + 801

const REPO_CONFIG_FILE = path.join(BACKEND_DIR, 'config', 'config.yaml')

const SETTINGS_ROUTE = apiPathMatcher('/mcp/settings')
const STATUS_ROUTE = apiPathMatcher('/mcp/status')
const STRENGTH_ROUTE = apiPathMatcher('/api/v1/system/password-strength')

const MCP_URL = /\/settings\/mcp$/
const ABOUT_URL = /\/settings\/about$/

const PORT_RANGE_MESSAGE = 'Port must be between 1024 and 65535'
const PORT_HELP = 'The port the MCP endpoint listens on.'
const ENABLEMENT_SUBTITLE = 'Turn the MCP endpoint on or off without restarting the WAVE server.'
const ENDPOINT_SUBTITLE = 'Where the MCP server listens and how clients must authenticate.'
const CONFIRM_TITLE = 'Save MCP server changes?'
const RESTART_SENTENCE =
  'The MCP server restarts with the new configuration. Connected assistants are disconnected and must reconnect. The main WAVE server and running executions are not affected.'
const EXPOSURE_WARNING =
  'Bind scope changes to Network: any machine that can reach this server can contact the endpoint. Require authentication to control who may act through WAVE.'
const SAVE_FAILED_TITLE = 'Could Not Save MCP Server'
const DISCONNECT_FAILED_TITLE = 'Could Not Disconnect Session'
const STALE_SUFFIX = '(showing the last known state)'
const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong']
const EDIT_QUESTION_TITLE = 'Edit Protected Value?'
const EDIT_QUESTION_TEXT =
  'Editing will permanently delete the existing protected value. You will need to enter a new value. This action cannot be undone.'
const AUTH_REFUSAL = 'Password is required when authentication is enabled'

const WEAK_PASSWORD = 'password'
const PASSPHRASE = 'seven quiet lanterns drift over violet harbors'
const NEW_PASSPHRASE = 'nine amber kestrels circle the northern lighthouse'
const AUTH_USERNAME = 'zq7-harbor-lantern-agent'
// Strong alone, weak once the username counts against it.
const PASSWORD_FROM_USERNAME = `${AUTH_USERNAME}9`
const TYPED_KEYS = 'kestrel-42'
const STORED_CREDENTIALS: McpCredentials = { username: AUTH_USERNAME, password: PASSPHRASE }
const SEALED_LINE = /^  auth_password: ["']?wave:enc:v1:[A-Za-z0-9+/=]+["']?$/

const READ_REASON = 'MCP settings unreadable: mcp-settings E2E 5c1d'
const POLL_REASON = 'MCP status unreadable: mcp-settings E2E 9a4f'
const DISCONNECT_REASON = 'Session cannot be closed: mcp-settings E2E 2e7b'
const CLIENT_NAME = 'wave-e2e-held-client'

// ============================================================================
// API and file reads
// ============================================================================

interface McpSettingsBody {
  enabled: boolean
  until_restart_active: boolean
  port: number
  bind: string
  auth_enabled: boolean
  auth_username: string
  auth_password_set: boolean
  running: boolean
}

interface McpStatusBody {
  running: boolean
  port: number
  bind: string
  urls: string[]
  sessions: { session_id: string; client: string }[]
}

interface StrengthData {
  score: number
  label: string
}

let configFile = ''

const mcpSection = (): string => configSection(configFile, 'mcp')

/** The `auth_password` line of the stack's config file. */
const passwordLine = (): string =>
  mcpSection()
    .split('\n')
    .find((line) => line.startsWith('  auth_password:')) ?? ''

async function readSettings(page: Page): Promise<McpSettingsBody> {
  const response = await page.request.get(`${BACKEND_URL}/mcp/settings`)
  expect(response.status(), 'GET /mcp/settings').toBe(200)
  return (await response.json()) as McpSettingsBody
}

async function readStatus(page: Page): Promise<McpStatusBody> {
  const response = await page.request.get(`${BACKEND_URL}/mcp/status`)
  expect(response.status(), 'GET /mcp/status').toBe(200)
  return (await response.json()) as McpStatusBody
}

/** Store the defaults on `SAVED_PORT` plus `change`, through the API. */
async function storeSettings(page: Page, change: Record<string, unknown> = {}): Promise<void> {
  const response = await page.request.put(`${BACKEND_URL}/mcp/settings`, {
    data: { ...MCP_DEFAULTS, port: SAVED_PORT, ...change },
  })
  expect(response.status(), `PUT /mcp/settings answered ${await response.text()}`).toBe(200)
}

async function scorePassword(page: Page, body: Record<string, unknown>): Promise<StrengthData> {
  const response = await page.request.post(`${BACKEND_URL}/api/v1/system/password-strength`, {
    data: body,
  })
  expect(response.status(), 'POST /api/v1/system/password-strength').toBe(200)
  return (await response.json()).data as StrengthData
}

const ANSWERED_BY_WAVE = '200 WAVE'
const UNAUTHORIZED = '401'
const REFUSED = 'refused'

/** What one MCP `initialize` sent to `port` meets: status and server name, `refused`, or the failure. */
async function probe(port: number, credentials?: McpCredentials): Promise<string> {
  try {
    const answer = await askMcpEndpoint(port, credentials)
    if (!answer) return REFUSED
    return [answer.status, answer.serverName].filter(Boolean).join(' ')
  } catch (error) {
    return `failed: ${String(error)}`
  }
}

/** A real MCP `initialize` sent to `port` meets exactly `answer`. */
async function expectAnswer(
  port: number,
  answer: string,
  credentials?: McpCredentials,
): Promise<void> {
  await expect
    .poll(() => probe(port, credentials), {
      message: `an MCP initialize sent to port ${port} meets "${answer}"`,
    })
    .toBe(answer)
}

const expectListening = (port: number): Promise<void> => expectAnswer(port, ANSWERED_BY_WAVE)
const expectNotListening = (port: number): Promise<void> => expectAnswer(port, REFUSED)

const AUTH_STORED = {
  auth_enabled: true,
  auth_username: AUTH_USERNAME,
  auth_password: PASSPHRASE,
}

/** A running endpoint on `SAVED_PORT` that asks for `STORED_CREDENTIALS`, stored through the API. */
async function storeAuthenticatedEndpoint(page: Page): Promise<void> {
  await storeSettings(page, { enabled: true, ...AUTH_STORED })
  await expectAnswer(SAVED_PORT, UNAUTHORIZED)
  await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, STORED_CREDENTIALS)
}

// ============================================================================
// Page
// ============================================================================

const tab = (page: Page): Locator => page.getByTestId('mcp-server-tab')
const pageHeading = (page: Page): Locator =>
  tab(page).getByRole('heading', { name: 'MCP Server', exact: true, level: 2 })
const headingLine = (page: Page): Locator => pageHeading(page).locator('xpath=..')
const cancelButton = (page: Page): Locator =>
  headingLine(page).getByRole('button', { name: 'Cancel', exact: true })
const saveButton = (page: Page): Locator =>
  headingLine(page).getByRole('button', { name: 'Save', exact: true })
const group = (page: Page, name: string): Locator =>
  tab(page).getByRole('heading', { name, exact: true, level: 3 }).locator('xpath=..')
const statusBar = (page: Page): Locator => page.getByTestId('mcp-status-bar')
const statusWord = (page: Page, word: 'Running' | 'Stopped'): Locator =>
  statusBar(page).getByText(word, { exact: true })
const addressChip = (page: Page, port: number): Locator =>
  statusBar(page).getByText(mcpEndpointUrl(port), { exact: true })
const persistentSwitch = (page: Page): Locator =>
  tab(page).getByRole('switch', { name: 'Enable MCP server', exact: true })
const untilRestartSwitch = (page: Page): Locator =>
  tab(page).getByRole('switch', { name: 'Enable until restart', exact: true })
const authSwitch = (page: Page): Locator =>
  tab(page).getByRole('switch', { name: 'Require authentication', exact: true })
const portInput = (page: Page): Locator => tab(page).getByRole('textbox', { name: 'Port', exact: true })
const portError = (page: Page): Locator => page.getByTestId('mcp-port-error')
const bindSelect = (page: Page): Locator => page.getByTestId('mcp-bind-select')
const usernameInput = (page: Page): Locator =>
  tab(page).getByRole('textbox', { name: 'Username', exact: true })
const passwordInput = (page: Page): Locator => tab(page).getByLabel('Password', { exact: true })
const passwordRow = (page: Page): Locator => page.getByTestId('mcp-auth-password-row')
const maskedPassword = (page: Page): Locator =>
  passwordRow(page).getByRole('button', { name: 'Password: Edit protected value', exact: true })
const editQuestion = (page: Page): Locator =>
  page.getByRole('dialog', { name: EDIT_QUESTION_TITLE, exact: true })
const strength = (page: Page): Locator => passwordRow(page).locator('#mcp-password-strength')
const strengthMeter = (page: Page): Locator =>
  tab(page).getByRole('meter', { name: 'Password strength', exact: true })
const confirmDialog = (page: Page): Locator =>
  page.getByRole('alertdialog', { name: CONFIRM_TITLE, exact: true })
const leaveDialog = (page: Page): Locator => page.getByTestId('leave-unsaved-dialog')
const sectionLink = (page: Page, section: 'about' | 'mcp'): Locator =>
  page.getByTestId(`settings-nav-${section}`)

async function openMcpPage(page: Page): Promise<void> {
  await page.goto('/settings/mcp')
  await expect(statusBar(page)).toBeVisible()
}

async function expectClean(page: Page): Promise<void> {
  await expect(cancelButton(page)).toBeDisabled()
  await expect(saveButton(page)).toBeDisabled()
}

async function expectDirty(page: Page): Promise<void> {
  await expect(cancelButton(page)).toBeEnabled()
  await expect(saveButton(page)).toBeEnabled()
}

async function chooseBind(page: Page, label: 'Network' | 'Local only (127.0.0.1)'): Promise<void> {
  await bindSelect(page).click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(bindSelect(page)).toHaveText(label)
}

/** Click `button` and return the answer to the `PUT /mcp/settings` that click sends. */
async function clickAndAwaitWrite(page: Page, button: Locator) {
  const [answer] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'PUT' && SETTINGS_ROUTE(new URL(response.url())),
    ),
    button.click(),
  ])
  return answer
}

/** The Save confirmation is up with exactly these parts (MCP-5, MCP-6). */
async function expectConfirmation(
  page: Page,
  parts: { restart: boolean; exposure: boolean },
): Promise<Locator> {
  const dialog = confirmDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(RESTART_SENTENCE, { exact: true })).toHaveCount(parts.restart ? 1 : 0)
  const warning = dialog.getByTestId('mcp-exposure-warning')
  if (parts.exposure) await expect(warning).toHaveText(EXPOSURE_WARNING)
  else await expect(warning).toHaveCount(0)
  await expect(dialog.getByRole('button')).toHaveText([
    'Cancel',
    parts.restart ? 'Save and restart' : 'Save',
  ])
  return dialog
}

/** The leave prompt is up, the page and its URL stayed, and it offers Cancel, Discard and Save. */
async function expectLeavePrompt(page: Page): Promise<Locator> {
  const dialog = leaveDialog(page)
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible()
  await expect(dialog.getByTestId('leave-unsaved-cancel')).toHaveText('Cancel')
  await expect(dialog.getByTestId('leave-unsaved-discard')).toHaveText('Discard')
  await expect(dialog.getByTestId('leave-unsaved-save')).toHaveText('Save')
  await expect(page).toHaveURL(MCP_URL)
  await expect(tab(page)).toBeVisible()
  return dialog
}

/** The failure toast with exactly this title and reason; it is dismissed so it covers nothing. */
async function expectFailureToast(page: Page, title: string, reason: string): Promise<void> {
  const toast = page.locator('[data-toast]').filter({ hasText: title })
  await expect(toast).toBeVisible()
  await expect(toast.locator('div.font-semibold')).toHaveText(title)
  await expect(toast.locator('div.text-sm').first()).toHaveText(reason)
  await toast.getByRole('button', { name: 'Dismiss notification', exact: true }).click()
  await expect(toast).toHaveCount(0)
}

/** The score under the Password input is `label` with `filled` of four segments, and nothing else. */
async function expectStrength(page: Page, label: string, filled: number): Promise<void> {
  const score = strength(page)
  await expect(score, 'the one word is the only text under the input').toHaveText(label)
  await expect(score.locator(':scope > *')).toHaveCount(1)
  await expect(score.locator(':scope > div > *')).toHaveCount(3)
  const segments = score.locator('[aria-hidden="true"] > span')
  await expect(segments).toHaveCount(4)
  const filledCount = await segments.evaluateAll(
    (nodes) => nodes.filter((node) => !node.classList.contains('bg-input')).length,
  )
  expect(filledCount, `${label} fills ${filled} of four segments`).toBe(filled)
  await expect(strengthMeter(page)).toHaveAttribute('aria-valuetext', label)
}

/** The Password row shows the masked stored password, which the row label points at, and no input or score (MCP-7). */
async function expectMaskedPassword(page: Page): Promise<void> {
  const masked = maskedPassword(page)
  await expect(masked).toBeVisible()
  await expect(masked).toBeEnabled()
  await expect(passwordRow(page).locator('input')).toHaveCount(0)
  const id = await masked.getAttribute('id')
  expect(id, 'the masked field carries the id the row label points at').toBeTruthy()
  await expect(passwordRow(page).locator(`label[for="${id}"]`)).toHaveText('Password')
  await expect(strength(page).locator(':scope > *'), 'nothing under the masked field').toHaveCount(0)
}

/** "Edit Protected Value?" is up and holds focus, with its warning, Cancel and "Delete & Edit". */
async function expectEditQuestion(page: Page): Promise<Locator> {
  const question = editQuestion(page)
  await expect(question).toBeVisible()
  await expect(question.locator('p')).toHaveText(EDIT_QUESTION_TEXT)
  await expect(question.getByRole('button')).toHaveText(['Cancel', 'Delete & Edit', 'Close'])
  await expect(question.locator(':focus'), 'the question holds focus').toHaveCount(1)
  return question
}

/** Answer the question asked from the masked Password with "Delete & Edit": the row shows an empty input. */
async function deleteAndEdit(page: Page): Promise<void> {
  await maskedPassword(page).click()
  const question = await expectEditQuestion(page)
  await question.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
  await expect(question).toHaveCount(0)
  await expect(maskedPassword(page)).toHaveCount(0)
  await expect(passwordInput(page)).toHaveValue('')
  await expect(passwordInput(page)).toHaveAttribute('type', 'password')
}

/** Press Tab until `target` holds focus; the question has three stops. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 3; presses += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

interface RegionWatchWindow {
  portRegionWatch: { observer: MutationObserver; seen: string[] }
}

/** Every change the watched Port message region has had since the watch began. */
const regionChanges = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const { observer, seen } = (window as unknown as RegionWatchWindow).portRegionWatch
    seen.push(...observer.takeRecords().map((record) => record.type))
    return [...seen]
  })

// ============================================================================
// Tests
// ============================================================================

test.describe('V-MCP-SETTINGS-FUNCTIONAL: Settings > MCP Server', () => {
  test.beforeEach(async ({ page }) => {
    configFile = (await stackPaths(page.request)).configFile
    expect(configFile, 'the stack runs on its own config file').not.toBe(REPO_CONFIG_FILE)
    await storeSettings(page)
  })

  test.afterEach(async ({ page }) => {
    await resetMcpSettings(page)
  })

  test('1. a clean page keeps Cancel and Save disabled on the heading line, and port 80 blocks Save until Cancel restores the saved port', async ({
    page,
  }) => {
    await openMcpPage(page)
    const textAtStart = readConfigText(configFile)

    await test.step('Cancel, then Save, sit on the "MCP Server" heading line and are disabled', async () => {
      await expect(headingLine(page).getByRole('button')).toHaveText(['Cancel', 'Save'])
      await expectClean(page)
      const headingBox = await pageHeading(page).boundingBox()
      const cancelBox = await cancelButton(page).boundingBox()
      const saveBox = await saveButton(page).boundingBox()
      if (!headingBox || !cancelBox || !saveBox) throw new Error('the heading line is not laid out')
      const middle = (box: { y: number; height: number }): number => box.y + box.height / 2
      expect(Math.abs(middle(cancelBox) - middle(headingBox))).toBeLessThanOrEqual(2)
      expect(Math.abs(middle(saveBox) - middle(headingBox))).toBeLessThanOrEqual(2)
      expect(cancelBox.x).toBeGreaterThanOrEqual(headingBox.x + headingBox.width)
      expect(saveBox.x).toBeGreaterThanOrEqual(cancelBox.x + cancelBox.width)
    })

    await test.step('each group is a heading, one subtitle and its rows; Sessions follows Endpoint', async () => {
      const enablement = group(page, 'Enablement')
      await expect(enablement.locator(':scope > *')).toHaveCount(3)
      await expect(enablement.locator(':scope > p')).toHaveText(ENABLEMENT_SUBTITLE)

      const endpoint = group(page, 'Endpoint')
      await expect(endpoint.locator(':scope > *')).toHaveCount(3)
      await expect(endpoint.locator(':scope > p')).toHaveText(ENDPOINT_SUBTITLE)
      await expect(endpoint.locator(':scope > div > *').last()).toHaveAttribute(
        'data-testid',
        'mcp-auth-password-row',
      )
      await expect(endpoint.getByRole('button')).toHaveCount(0)
      await expect(endpoint.locator('xpath=following-sibling::*[1]')).toBeEmpty()
      await expect(endpoint.locator('xpath=following-sibling::*[2]')).toHaveAttribute(
        'data-testid',
        'mcp-sessions-section',
      )
    })

    await test.step('port 80 shows the range message, keeps Save disabled and Cancel enabled', async () => {
      await portInput(page).fill('80')
      await expect(portError(page)).toHaveText(PORT_RANGE_MESSAGE)
      await expect(saveButton(page)).toBeDisabled()
      await expect(cancelButton(page)).toBeEnabled()
      expect((await readSettings(page)).port).toBe(SAVED_PORT)
    })

    await test.step('Cancel restores the saved port and the file is unchanged', async () => {
      await cancelButton(page).click()
      await expect(portInput(page)).toHaveValue(String(SAVED_PORT))
      await expect(portError(page)).toHaveCount(0)
      await expectClean(page)
      expect(readConfigText(configFile)).toBe(textAtStart)
    })
  })

  test('1a. the Port message arrives in a polite region that was on the page before it and stays linked to the field; each switch is named by its row label', async ({
    page,
  }) => {
    await openMcpPage(page)
    const port = portInput(page)
    const region = await port.evaluateHandle((input) => {
      let row = input.parentElement
      while (row && !row.querySelector(':scope > [aria-live]')) row = row.parentElement
      return row?.querySelector(':scope > [aria-live]') ?? null
    })
    const regionState = (): Promise<{
      onPage: boolean
      live: string | null
      text: string
      messageId: string | null
    }> =>
      region.evaluate((node) => ({
        onPage: node?.isConnected ?? false,
        live: node?.getAttribute('aria-live') ?? null,
        text: node?.textContent ?? '',
        messageId: node?.querySelector('[data-testid="mcp-port-error"]')?.getAttribute('id') ?? null,
      }))
    const emptyRegion = { onPage: true, live: 'polite', text: '', messageId: null }

    await test.step('the region is on the page, polite and empty, before any message', async () => {
      expect(await regionState()).toEqual(emptyRegion)
      await expect(portError(page)).toHaveCount(0)
      await expect(port).not.toHaveAttribute('aria-invalid', 'true')
      await expect(port).toHaveAccessibleDescription(PORT_HELP)
    })

    await test.step('port 80 puts the message into that same region and links it to the field', async () => {
      await port.fill('80')
      await expect(portError(page)).toHaveText(PORT_RANGE_MESSAGE)
      const state = await regionState()
      expect(state).toEqual({
        onPage: true,
        live: 'polite',
        text: PORT_RANGE_MESSAGE,
        messageId: expect.any(String),
      })
      const described = ((await port.getAttribute('aria-describedby')) ?? '').split(' ')
      expect(described, 'the field description names the message').toContain(state.messageId)
      await expect(port).toHaveAccessibleDescription(`${PORT_HELP} ${PORT_RANGE_MESSAGE}`)
      await expect(port).toHaveAttribute('aria-invalid', 'true')
      await expect(tab(page).getByRole('alert'), 'the message is no alert').toHaveCount(0)
    })

    await test.step('two more digits that keep the message change nothing in the region', async () => {
      await region.evaluate((node) => {
        const seen: string[] = []
        const observer = new MutationObserver((records) => {
          seen.push(...records.map((record) => record.type))
        })
        observer.observe(node as Element, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        })
        ;(window as unknown as RegionWatchWindow).portRegionWatch = { observer, seen }
      })
      await port.press('Home')
      await page.keyboard.type('00')
      await expect(port).toHaveValue('0080')
      await expect(portError(page)).toHaveText(PORT_RANGE_MESSAGE)
      expect(await regionChanges(page), 'the region was not touched').toEqual([])
    })

    await test.step('a valid port empties the region, and the watch sees that change', async () => {
      await port.fill(String(NEW_PORT))
      await expect(portError(page)).toHaveCount(0)
      expect((await regionChanges(page)).length).toBeGreaterThan(0)
      expect(await regionState()).toEqual(emptyRegion)
      await expect(port).not.toHaveAttribute('aria-invalid', 'true')
      await expect(port).toHaveAccessibleDescription(PORT_HELP)
    })

    await test.step('each switch is named by its row label and a click on the label turns it', async () => {
      const switches: [string, Locator][] = [
        ['Enable MCP server', persistentSwitch(page)],
        ['Enable until restart', untilRestartSwitch(page)],
        ['Require authentication', authSwitch(page)],
      ]
      for (const [name, toggle] of switches) {
        await expect(toggle).toHaveAccessibleName(name)
        await expect(toggle, `${name} carries no label of its own`).not.toHaveAttribute(
          'aria-label',
          /./,
        )
      }
      await expect(usernameInput(page)).toBeDisabled()
      await tab(page).locator('label').filter({ hasText: /^Require authentication$/ }).click()
      await expect(authSwitch(page)).toBeChecked()
      await expect(usernameInput(page)).toBeEnabled()
    })
  })

  test('2. Enable MCP server is staged: nothing starts until Save, and Save starts the endpoint without a confirmation', async ({
    page,
  }) => {
    await openMcpPage(page)

    await test.step('the switch alone starts nothing', async () => {
      await persistentSwitch(page).click()
      await expect(persistentSwitch(page)).toBeChecked()
      await expectDirty(page)
      await expect(statusWord(page, 'Stopped')).toBeVisible()
      const settings = await readSettings(page)
      expect(settings.enabled).toBe(false)
      expect(settings.running).toBe(false)
      expect(mcpSection()).toMatch(/^  enabled: false$/m)
      await expectNotListening(SAVED_PORT)
    })

    await test.step('Save writes at once and the endpoint runs', async () => {
      const written = await clickAndAwaitWrite(page, saveButton(page))
      expect(written.status()).toBe(200)
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(statusWord(page, 'Running')).toBeVisible()
      await expect(addressChip(page, SAVED_PORT)).toBeVisible()
      await expect(page.getByTestId('mcp-persistent-active')).toBeVisible()
      await expectClean(page)
      const settings = await readSettings(page)
      expect(settings.enabled).toBe(true)
      expect(settings.running).toBe(true)
      expect(mcpSection()).toMatch(/^  enabled: true$/m)
      await expectListening(SAVED_PORT)
    })
  })

  test('3. Enable until restart turns a staged Enable MCP server off, and Save starts that mode only', async ({
    page,
  }) => {
    await openMcpPage(page)

    await test.step('the second switch turns the first one off in the page', async () => {
      await persistentSwitch(page).click()
      await expect(persistentSwitch(page)).toBeChecked()
      await untilRestartSwitch(page).click()
      await expect(untilRestartSwitch(page)).toBeChecked()
      await expect(persistentSwitch(page)).not.toBeChecked()
      const settings = await readSettings(page)
      expect(settings.enabled).toBe(false)
      expect(settings.until_restart_active).toBe(false)
    })

    await test.step('Save starts the endpoint until restart and the file keeps enabled: false', async () => {
      const written = await clickAndAwaitWrite(page, saveButton(page))
      expect(written.status()).toBe(200)
      await expect(statusWord(page, 'Running')).toBeVisible()
      await expect(page.getByTestId('mcp-until-restart-active')).toBeVisible()
      await expect(page.getByTestId('mcp-persistent-active')).toHaveCount(0)
      const settings = await readSettings(page)
      expect(settings.enabled).toBe(false)
      expect(settings.until_restart_active).toBe(true)
      expect(settings.running).toBe(true)
      expect(mcpSection()).toMatch(/^  enabled: false$/m)
      await expectListening(SAVED_PORT)
    })
  })

  test('4. a staged port on a running endpoint asks "Save MCP server changes?"; Cancel keeps it staged, Save and restart moves the endpoint', async ({
    page,
  }) => {
    await storeSettings(page, { enabled: true })
    await expectListening(SAVED_PORT)
    await openMcpPage(page)
    await expect(statusWord(page, 'Running')).toBeVisible()

    await test.step('Save opens the restart confirmation', async () => {
      await portInput(page).fill(String(NEW_PORT))
      await saveButton(page).click()
      await expectConfirmation(page, { restart: true, exposure: false })
    })

    await test.step('Cancel in the confirmation keeps the staged port and writes nothing', async () => {
      await confirmDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmDialog(page)).toHaveCount(0)
      await expect(portInput(page)).toHaveValue(String(NEW_PORT))
      await expectDirty(page)
      expect((await readSettings(page)).port).toBe(SAVED_PORT)
      expect(mcpSection()).toMatch(new RegExp(`^  port: ${SAVED_PORT}$`, 'm'))
      await expectListening(SAVED_PORT)
      await expectNotListening(NEW_PORT)
    })

    await test.step('Save and restart moves the endpoint to the new port and writes it', async () => {
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(200)
      await expect(confirmDialog(page)).toHaveCount(0)
      await expect(addressChip(page, NEW_PORT)).toBeVisible()
      await expect(addressChip(page, SAVED_PORT)).toHaveCount(0)
      await expectClean(page)
      await expectListening(NEW_PORT)
      await expectNotListening(SAVED_PORT)
      const settings = await readSettings(page)
      expect(settings.port).toBe(NEW_PORT)
      expect(settings.running).toBe(true)
      expect(mcpSection()).toMatch(new RegExp(`^  port: ${NEW_PORT}$`, 'm'))
    })
  })

  test('5. Bind scope Network asks first with the exposure warning, alone on a stopped endpoint and beside the restart sentence on a running one', async ({
    page,
  }) => {
    await openMcpPage(page)

    await test.step('stopped: the warning alone with Cancel and Save; Cancel writes nothing', async () => {
      await chooseBind(page, 'Network')
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: false, exposure: true })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmDialog(page)).toHaveCount(0)
      await expect(bindSelect(page)).toHaveText('Network')
      await expectDirty(page)
      expect((await readSettings(page)).bind).toBe('local')
      expect(mcpSection()).toMatch(/^  bind: local$/m)
    })

    await test.step('stopped: Save in the confirmation writes bind: network', async () => {
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: false, exposure: true })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save', exact: true }),
      )
      expect(written.status()).toBe(200)
      await expectClean(page)
      await expect(statusWord(page, 'Stopped')).toBeVisible()
      expect((await readSettings(page)).bind).toBe('network')
      expect(mcpSection()).toMatch(/^  bind: network$/m)
    })

    await test.step('running: the warning joins the restart sentence and Save and restart applies it', async () => {
      await storeSettings(page, { enabled: true })
      await page.reload()
      await expect(statusWord(page, 'Running')).toBeVisible()
      await chooseBind(page, 'Network')
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: true })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(200)
      await expectClean(page)
      const status = await readStatus(page)
      expect(status.running).toBe(true)
      expect(status.bind).toBe('network')
      expect(status.urls[0]).toBe(mcpEndpointUrl(SAVED_PORT))
      expect(mcpSection()).toMatch(/^  bind: network$/m)
      await expectListening(SAVED_PORT)
    })
  })

  test('6. the strength score is four segments and one word while a new password is typed, and a weak password still saves', async ({
    page,
  }) => {
    await openMcpPage(page)
    await authSwitch(page).click()
    await usernameInput(page).fill(AUTH_USERNAME)

    await test.step('"password" fills no segment and reads Very weak; Save stays enabled', async () => {
      await passwordInput(page).fill(WEAK_PASSWORD)
      await expectStrength(page, 'Very weak', 0)
      await expect(saveButton(page)).toBeEnabled()
    })

    await test.step('a long passphrase fills four segments and reads Very strong', async () => {
      await passwordInput(page).fill(PASSPHRASE)
      await expectStrength(page, 'Very strong', 4)
    })

    await test.step('clearing the field hides the score', async () => {
      await passwordInput(page).fill('')
      await expect(strength(page)).toBeEmpty()
      await expect(strengthMeter(page)).toHaveCount(0)
    })

    await test.step('a Save with the weak password is stored', async () => {
      await passwordInput(page).fill(WEAK_PASSWORD)
      await expectStrength(page, 'Very weak', 0)
      const written = await clickAndAwaitWrite(page, saveButton(page))
      expect(written.status()).toBe(200)
      await expectClean(page)
      await expectMaskedPassword(page)
      const settings = await readSettings(page)
      expect(settings.auth_enabled).toBe(true)
      expect(settings.auth_password_set).toBe(true)
    })
  })

  test('7. authentication saved with a password is sealed in the file and the endpoint asks for it', async ({
    page,
  }) => {
    await openMcpPage(page)
    await persistentSwitch(page).click()
    await authSwitch(page).click()
    await usernameInput(page).fill(AUTH_USERNAME)
    await passwordInput(page).fill(PASSPHRASE)

    await test.step('Save stores the username and a sealed password, never the password itself', async () => {
      const written = await clickAndAwaitWrite(page, saveButton(page))
      expect(written.status()).toBe(200)
      await expectClean(page)
      await expectMaskedPassword(page)
      const settings = await readSettings(page)
      expect(settings.auth_enabled).toBe(true)
      expect(settings.auth_username).toBe(AUTH_USERNAME)
      expect(settings.auth_password_set).toBe(true)
      expect(JSON.stringify(settings)).not.toContain(PASSPHRASE)
      const section = mcpSection()
      expect(section).toMatch(/^  auth_enabled: true$/m)
      expect(section).toMatch(new RegExp(`^  auth_username: ["']?${AUTH_USERNAME}["']?$`, 'm'))
      expect(section).toMatch(/^  auth_password: ["']?wave:enc:v1:[A-Za-z0-9+/=]+["']?$/m)
      expect(readConfigText(configFile)).not.toContain(PASSPHRASE)
    })

    await test.step('the endpoint refuses a request without the credentials and answers one with them', async () => {
      await expectAnswer(SAVED_PORT, UNAUTHORIZED)
      await expectAnswer(SAVED_PORT, UNAUTHORIZED, { username: AUTH_USERNAME, password: WEAK_PASSWORD })
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, { username: AUTH_USERNAME, password: PASSPHRASE })
    })

    await test.step('a reload still shows the masked field, never the password', async () => {
      await page.reload()
      await expect(statusBar(page)).toBeVisible()
      await expectMaskedPassword(page)
      await expectClean(page)
      await expect(tab(page)).not.toContainText(PASSPHRASE)
    })
  })

  test('7a. a new password over a stored one goes through "Edit Protected Value?" and Delete & Edit, and the endpoint then takes the new password only', async ({
    page,
  }) => {
    await storeAuthenticatedEndpoint(page)
    const sealedBefore = passwordLine()
    expect(sealedBefore).toMatch(SEALED_LINE)
    await openMcpPage(page)
    const writes = countApiFetches(page, SETTINGS_ROUTE, 'PUT')

    await test.step('the stored password shows as the masked field on a clean page', async () => {
      await expectMaskedPassword(page)
      await expectClean(page)
    })

    await test.step('Cancel in the question keeps the stored password', async () => {
      await maskedPassword(page).click()
      const question = await expectEditQuestion(page)
      await question.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expectMaskedPassword(page)
      await expectClean(page)
    })

    await test.step('Delete & Edit shows an empty Password input and stores nothing', async () => {
      await deleteAndEdit(page)
      await expectDirty(page)
      expect(writes(), 'no PUT /mcp/settings before Save').toBe(0)
      expect((await readSettings(page)).auth_password_set).toBe(true)
      expect(passwordLine()).toBe(sealedBefore)
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, STORED_CREDENTIALS)
    })

    await test.step('Save and restart stores the new password alone; the endpoint refuses the old one', async () => {
      await passwordInput(page).fill(NEW_PASSPHRASE)
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(200)
      expect(written.request().postDataJSON()).toEqual({ auth_password: NEW_PASSPHRASE })
      await expectMaskedPassword(page)
      await expectClean(page)
      const sealedAfter = passwordLine()
      expect(sealedAfter).toMatch(SEALED_LINE)
      expect(sealedAfter).not.toBe(sealedBefore)
      expect(readConfigText(configFile)).not.toContain(NEW_PASSPHRASE)
      const settings = await readSettings(page)
      expect(settings.auth_password_set).toBe(true)
      expect(JSON.stringify(settings)).not.toContain(NEW_PASSPHRASE)
      await expectAnswer(SAVED_PORT, UNAUTHORIZED, STORED_CREDENTIALS)
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, {
        username: AUTH_USERNAME,
        password: NEW_PASSPHRASE,
      })
    })
  })

  test('7b. Delete & Edit, then Save with authentication off, removes the stored password', async ({
    page,
  }) => {
    await storeAuthenticatedEndpoint(page)
    await openMcpPage(page)

    await test.step('Delete & Edit and Require authentication off are staged only', async () => {
      await deleteAndEdit(page)
      await authSwitch(page).click()
      await expect(authSwitch(page)).not.toBeChecked()
      await expect(passwordInput(page)).toBeDisabled()
      await expectDirty(page)
      const settings = await readSettings(page)
      expect(settings.auth_enabled).toBe(true)
      expect(settings.auth_password_set).toBe(true)
      expect(passwordLine()).toMatch(SEALED_LINE)
      await expectAnswer(SAVED_PORT, UNAUTHORIZED)
    })

    await test.step('Save and restart removes the password from the file and the endpoint asks for none', async () => {
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(200)
      expect(written.request().postDataJSON()).toEqual({ auth_enabled: false, auth_password: '' })
      await expectClean(page)
      const settings = await readSettings(page)
      expect(settings.auth_enabled).toBe(false)
      expect(settings.auth_password_set).toBe(false)
      const section = mcpSection()
      expect(section).toMatch(/^  auth_enabled: false$/m)
      expect(section).toMatch(/^  auth_password:( null| ~)?$/m)
      expect(section).not.toContain('wave:enc:')
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE)
    })

    await test.step('authentication turned on again shows an empty Password input, also after a reload', async () => {
      await page.reload()
      await expect(statusBar(page)).toBeVisible()
      await authSwitch(page).click()
      await expect(authSwitch(page)).toBeChecked()
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(passwordInput(page)).toBeEnabled()
      await expect(passwordInput(page)).toHaveValue('')
    })
  })

  test('7c. with authentication on, a Save of the emptied Password is refused with the reason and the stored password stays', async ({
    page,
  }) => {
    await storeAuthenticatedEndpoint(page)
    await openMcpPage(page)
    const textBefore = readConfigText(configFile)

    await test.step('Delete & Edit, nothing typed, Save and restart: the write is refused', async () => {
      await deleteAndEdit(page)
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(400)
      expect(written.request().postDataJSON()).toEqual({ auth_password: '' })
      await expectFailureToast(page, SAVE_FAILED_TITLE, AUTH_REFUSAL)
    })

    await test.step('the empty input and the staged change stay; the file and the endpoint are unchanged', async () => {
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(passwordInput(page)).toHaveValue('')
      await expectDirty(page)
      expect(readConfigText(configFile)).toBe(textBefore)
      const settings = await readSettings(page)
      expect(settings.auth_enabled).toBe(true)
      expect(settings.auth_password_set).toBe(true)
      expect(settings.running).toBe(true)
      await expectAnswer(SAVED_PORT, UNAUTHORIZED)
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, STORED_CREDENTIALS)
    })
  })

  test('7d. Cancel on the page after Delete & Edit, and after a typed replacement, brings the masked field back and keeps the stored password', async ({
    page,
  }) => {
    await storeAuthenticatedEndpoint(page)
    await openMcpPage(page)
    const textBefore = readConfigText(configFile)
    const writes = countApiFetches(page, SETTINGS_ROUTE, 'PUT')

    await test.step('Delete & Edit, then Cancel on the page', async () => {
      await deleteAndEdit(page)
      await expectDirty(page)
      await cancelButton(page).click()
      await expectMaskedPassword(page)
      await expectClean(page)
    })

    await test.step('Delete & Edit, a typed replacement with its score, then Cancel on the page', async () => {
      await deleteAndEdit(page)
      await passwordInput(page).fill(NEW_PASSPHRASE)
      await expect(strengthMeter(page)).toHaveCount(1)
      await expect(strength(page).locator(':scope > *')).toHaveCount(1)
      await expectDirty(page)
      await cancelButton(page).click()
      await expectMaskedPassword(page)
      await expectClean(page)
    })

    await test.step('no write left the page and the stored password still opens the endpoint', async () => {
      expect(writes(), 'no PUT /mcp/settings').toBe(0)
      expect(readConfigText(configFile)).toBe(textBefore)
      expect((await readSettings(page)).auth_password_set).toBe(true)
      await expectAnswer(SAVED_PORT, ANSWERED_BY_WAVE, STORED_CREDENTIALS)
      await expectAnswer(SAVED_PORT, UNAUTHORIZED, {
        username: AUTH_USERNAME,
        password: NEW_PASSPHRASE,
      })
    })
  })

  test('7e. keyboard only: Cancel and Escape put focus back on the masked Password, and Delete & Edit puts it in the empty Password input', async ({
    page,
  }) => {
    await storeSettings(page, AUTH_STORED)
    await openMcpPage(page)
    await expectMaskedPassword(page)

    await test.step('Tab from Username lands on the masked Password and Enter asks the question', async () => {
      await usernameInput(page).focus()
      await page.keyboard.press('Tab')
      await expect(maskedPassword(page)).toBeFocused()
      await page.keyboard.press('Enter')
      await expectEditQuestion(page)
    })

    await test.step('Cancel puts focus back on the masked field', async () => {
      const question = editQuestion(page)
      await tabTo(page, question.getByRole('button', { name: 'Cancel', exact: true }))
      await page.keyboard.press('Enter')
      await expect(question).toHaveCount(0)
      await expect(maskedPassword(page)).toBeFocused()
      await expectClean(page)
    })

    await test.step('Enter asks again from there, and Escape puts focus back on the masked field', async () => {
      await page.keyboard.press('Enter')
      const question = await expectEditQuestion(page)
      await page.keyboard.press('Escape')
      await expect(question).toHaveCount(0)
      await expect(maskedPassword(page)).toBeFocused()
      await expectClean(page)
    })

    await test.step('Delete & Edit puts focus in the empty Password input and typed keys land in it', async () => {
      await page.keyboard.press('Enter')
      const question = await expectEditQuestion(page)
      await tabTo(page, question.getByRole('button', { name: 'Delete & Edit', exact: true }))
      await page.keyboard.press('Enter')
      await expect(question).toHaveCount(0)
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(passwordInput(page)).toBeFocused()
      await expect(passwordInput(page)).toHaveValue('')
      await page.keyboard.type(TYPED_KEYS)
      await expect(passwordInput(page)).toHaveValue(TYPED_KEYS)
      await expect(passwordInput(page)).toBeFocused()
      await expect(usernameInput(page)).toHaveValue(AUTH_USERNAME)
    })
  })

  test('7f. mouse with focus in Username: Cancel puts focus on the masked Password, and Delete & Edit puts it in the Password input, not back in Username', async ({
    page,
  }) => {
    await storeSettings(page, AUTH_STORED)
    await openMcpPage(page)
    await expectMaskedPassword(page)

    // Some browsers do not focus a clicked button: the click arrives while Username keeps focus.
    const askFromUsername = async (): Promise<Locator> => {
      await usernameInput(page).click()
      await expect(usernameInput(page)).toBeFocused()
      await maskedPassword(page).dispatchEvent('click')
      return expectEditQuestion(page)
    }

    await test.step('Cancel puts focus on the masked field the question was asked from', async () => {
      const question = await askFromUsername()
      await question.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(maskedPassword(page)).toBeFocused()
      await expectClean(page)
    })

    await test.step('Delete & Edit puts focus in the Password input and typed keys land there', async () => {
      const question = await askFromUsername()
      await question.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(passwordInput(page)).toBeFocused()
      await page.keyboard.type(TYPED_KEYS)
      await expect(passwordInput(page)).toHaveValue(TYPED_KEYS)
      await expect(usernameInput(page)).toHaveValue(AUTH_USERNAME)
    })
  })

  test('8. turning a running endpoint off saves without a confirmation and stops it', async ({ page }) => {
    await storeSettings(page, { enabled: true })
    await expectListening(SAVED_PORT)
    await openMcpPage(page)
    await expect(statusWord(page, 'Running')).toBeVisible()

    await test.step('the switch alone stops nothing', async () => {
      await persistentSwitch(page).click()
      await expect(persistentSwitch(page)).not.toBeChecked()
      await expectDirty(page)
      await expect(statusWord(page, 'Running')).toBeVisible()
      expect((await readSettings(page)).enabled).toBe(true)
      await expectListening(SAVED_PORT)
    })

    await test.step('Save writes at once and the endpoint stops', async () => {
      const written = await clickAndAwaitWrite(page, saveButton(page))
      expect(written.status()).toBe(200)
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await expect(statusWord(page, 'Stopped')).toBeVisible()
      await expect(statusBar(page).getByText('The MCP endpoint is disabled.', { exact: true })).toBeVisible()
      await expectClean(page)
      const settings = await readSettings(page)
      expect(settings.enabled).toBe(false)
      expect(settings.running).toBe(false)
      expect(mcpSection()).toMatch(/^  enabled: false$/m)
      await expectNotListening(SAVED_PORT)
    })
  })

  test('9. a read-only config file refuses the Save with the exact reason and the endpoint stays on its port', async ({
    page,
  }) => {
    await storeSettings(page, { enabled: true })
    await expectListening(SAVED_PORT)
    await openMcpPage(page)
    await portInput(page).fill(String(NEW_PORT))
    const textBefore = readConfigText(configFile)

    await withMode(configFile, 0o444, async () => {
      await saveButton(page).click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(500)
      await expectFailureToast(
        page,
        SAVE_FAILED_TITLE,
        `Settings cannot be saved: the config file ${configFile} is read-only`,
      )
      await expect(portInput(page)).toHaveValue(String(NEW_PORT))
      await expectDirty(page)
      await expect(statusWord(page, 'Running')).toBeVisible()
      expect(readConfigText(configFile)).toBe(textBefore)
      const settings = await readSettings(page)
      expect(settings.port).toBe(SAVED_PORT)
      expect(settings.running).toBe(true)
      await expectListening(SAVED_PORT)
      await expectNotListening(NEW_PORT)
    })
  })

  test('10. the strength endpoint answers a score and its label only, uncached, and a username typed in its row lowers the score shown', async ({
    page,
  }) => {
    await test.step('the answer holds score and label only and is never cached', async () => {
      const response = await page.request.post(`${BACKEND_URL}/api/v1/system/password-strength`, {
        data: { password: WEAK_PASSWORD },
      })
      expect(response.status()).toBe(200)
      expect(response.headers()['cache-control']).toBe('no-store')
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.data).toEqual({ score: 0, label: 'Very weak' })
      expect(await scorePassword(page, { password: '' })).toEqual({ score: 0, label: 'Very weak' })
      expect(await scorePassword(page, { password: PASSPHRASE })).toEqual({
        score: 4,
        label: 'Very strong',
      })
    })

    const alone = await scorePassword(page, { password: PASSWORD_FROM_USERNAME })
    const withUsername = await scorePassword(page, {
      password: PASSWORD_FROM_USERNAME,
      user_inputs: [AUTH_USERNAME],
    })

    await test.step('the username among user_inputs lowers the score of a password built from it', async () => {
      expect(withUsername.score).toBeLessThan(alone.score)
      expect(alone.label).toBe(STRENGTH_LABELS[alone.score])
      expect(withUsername.label).toBe(STRENGTH_LABELS[withUsername.score])
    })

    await test.step('the page sends the typed username and shows the lower score', async () => {
      await openMcpPage(page)
      await authSwitch(page).click()
      await usernameInput(page).fill(AUTH_USERNAME)
      const [asked] = await Promise.all([
        page.waitForRequest(
          (request) => request.method() === 'POST' && STRENGTH_ROUTE(new URL(request.url())),
        ),
        passwordInput(page).fill(PASSWORD_FROM_USERNAME),
      ])
      expect(asked.postDataJSON()).toEqual({
        password: PASSWORD_FROM_USERNAME,
        user_inputs: [AUTH_USERNAME],
      })
      await expectStrength(page, withUsername.label, withUsername.score)
    })
  })

  test('10a. leaving with a staged port on a running endpoint: Save goes through the restart confirmation, canceling it stays, Discard leaves unsaved', async ({
    page,
  }) => {
    await storeSettings(page, { enabled: true })
    await expectListening(SAVED_PORT)
    await openMcpPage(page)

    await test.step('Save in the leave prompt opens the confirmation; confirming saves, leaves and moves the endpoint', async () => {
      await portInput(page).fill(String(NEW_PORT))
      await sectionLink(page, 'about').click()
      const prompt = await expectLeavePrompt(page)
      await prompt.getByTestId('leave-unsaved-save').click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      await expect(leaveDialog(page)).toHaveCount(0)
      await expect(page).toHaveURL(MCP_URL)
      const written = await clickAndAwaitWrite(
        page,
        dialog.getByRole('button', { name: 'Save and restart', exact: true }),
      )
      expect(written.status()).toBe(200)
      await expect(page).toHaveURL(ABOUT_URL)
      await expect(tab(page)).toHaveCount(0)
      await expect(leaveDialog(page)).toHaveCount(0)
      await expectListening(NEW_PORT)
      await expectNotListening(SAVED_PORT)
      expect(mcpSection()).toMatch(new RegExp(`^  port: ${NEW_PORT}$`, 'm'))
    })

    await test.step('canceling the confirmation stays on MCP Server with the staged port', async () => {
      await sectionLink(page, 'mcp').click()
      await expect(portInput(page)).toHaveValue(String(NEW_PORT))
      await portInput(page).fill(String(THIRD_PORT))
      await sectionLink(page, 'about').click()
      const prompt = await expectLeavePrompt(page)
      await prompt.getByTestId('leave-unsaved-save').click()
      const dialog = await expectConfirmation(page, { restart: true, exposure: false })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirmDialog(page)).toHaveCount(0)
      await expect(leaveDialog(page)).toHaveCount(0)
      await expect(page).toHaveURL(MCP_URL)
      await expect(portInput(page)).toHaveValue(String(THIRD_PORT))
      await expectDirty(page)
      expect((await readSettings(page)).port).toBe(NEW_PORT)
      await expectListening(NEW_PORT)
      await expectNotListening(THIRD_PORT)
    })

    await test.step('Discard leaves and saves nothing', async () => {
      await sectionLink(page, 'about').click()
      const prompt = await expectLeavePrompt(page)
      await prompt.getByTestId('leave-unsaved-discard').click()
      await expect(page).toHaveURL(ABOUT_URL)
      await expect(leaveDialog(page)).toHaveCount(0)
      expect((await readSettings(page)).port).toBe(NEW_PORT)
      expect(mcpSection()).toMatch(new RegExp(`^  port: ${NEW_PORT}$`, 'm'))
      await expectListening(NEW_PORT)
      await expectNotListening(THIRD_PORT)
      await sectionLink(page, 'mcp').click()
      await expect(portInput(page)).toHaveValue(String(NEW_PORT))
      await expectClean(page)
    })
  })

  test('11. resetMcpSettings puts the defaults back in the file, clears the password and stops the endpoint', async ({
    page,
  }) => {
    await storeSettings(page, {
      enabled: true,
      port: NEW_PORT,
      auth_enabled: true,
      auth_username: AUTH_USERNAME,
      auth_password: PASSPHRASE,
    })
    await expectAnswer(NEW_PORT, UNAUTHORIZED)
    expect(mcpSection()).toContain('wave:enc:v1:')

    await resetMcpSettings(page)

    const settings = await readSettings(page)
    expect(settings).toMatchObject({
      enabled: false,
      until_restart_active: false,
      port: MCP_DEFAULTS.port,
      bind: 'local',
      auth_enabled: false,
      auth_username: '',
      auth_password_set: false,
      running: false,
    })
    const section = mcpSection()
    expect(section).toMatch(/^  enabled: false$/m)
    expect(section).toMatch(new RegExp(`^  port: ${MCP_DEFAULTS.port}$`, 'm'))
    expect(section).toMatch(/^  bind: local$/m)
    expect(section).toMatch(/^  auth_enabled: false$/m)
    expect(section).toMatch(/^  auth_username: (""|'')$/m)
    expect(section).toMatch(/^  auth_password:( null| ~)?$/m)
    expect(section).not.toContain('wave:enc:')
    await expectNotListening(NEW_PORT)
  })

  test('12. a failed first read shows the reason and Try Again with no Cancel or Save, and Try Again loads the page', async ({
    page,
  }) => {
    await failApiRoute(page, SETTINGS_ROUTE, { detail: READ_REASON })
    await page.goto('/settings/mcp')
    const failure = tab(page).getByRole('alert')

    await test.step('the page states exactly the reason and offers Try Again only', async () => {
      await expect(failure.locator('p')).toHaveText(READ_REASON)
      await expect(failure.getByRole('button')).toHaveText(['Try Again'])
      await expect(pageHeading(page)).toBeVisible()
      await expect(headingLine(page).getByRole('button')).toHaveCount(0)
      await expect(statusBar(page)).toHaveCount(0)
      await expect(tab(page).getByRole('heading', { level: 3 })).toHaveCount(0)
    })

    await test.step('with the read answering, Try Again shows the status bar and both groups', async () => {
      await page.unroute(SETTINGS_ROUTE)
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            SETTINGS_ROUTE(new URL(response.url())) &&
            response.status() === 200,
        ),
        failure.getByRole('button', { name: 'Try Again', exact: true }).click(),
      ])
      await expect(failure).toHaveCount(0)
      await expect(statusBar(page)).toBeVisible()
      await expect(group(page, 'Enablement')).toBeVisible()
      await expect(group(page, 'Endpoint')).toBeVisible()
      await expect(portInput(page)).toHaveValue(String(SAVED_PORT))
      await expect(headingLine(page).getByRole('button')).toHaveText(['Cancel', 'Save'])
      await expectClean(page)
    })
  })

  test('13. a failed status poll says so and keeps the last known state until a poll answers again', async ({
    page,
  }) => {
    await storeSettings(page, { enabled: true })
    await openMcpPage(page)
    await expect(statusWord(page, 'Running')).toBeVisible()
    const stale = page.getByTestId('mcp-status-stale')
    await expect(stale).toHaveCount(0)

    const expectLastState = async (): Promise<void> => {
      await expect(stale).toHaveText(`${POLL_REASON} ${STALE_SUFFIX}`)
      await expect(statusWord(page, 'Running')).toBeVisible()
      await expect(addressChip(page, SAVED_PORT)).toBeVisible()
      await expect(group(page, 'Enablement')).toBeVisible()
      await expect(group(page, 'Endpoint')).toBeVisible()
    }

    await test.step('the failed poll shows the reason and the page keeps what it showed', async () => {
      await failApiRoute(page, STATUS_ROUTE, { detail: POLL_REASON })
      await expect(stale).toHaveText(`${POLL_REASON} ${STALE_SUFFIX}`, { timeout: 15_000 })
      await expectLastState()
    })

    await test.step('the endpoint stops meanwhile and the page still shows the last state', async () => {
      await storeSettings(page, { enabled: false })
      await expectNotListening(SAVED_PORT)
      const failedPoll = await page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' && STATUS_ROUTE(new URL(response.url())),
        { timeout: 15_000 },
      )
      expect(failedPoll.status()).toBe(500)
      await expectLastState()
    })

    await test.step('the next poll that answers clears the line and shows the real state', async () => {
      await page.unroute(STATUS_ROUTE)
      await expect(stale).toHaveCount(0, { timeout: 15_000 })
      await expect(statusWord(page, 'Stopped')).toBeVisible()
    })
  })

  test('14. Disconnect ends a client session, and a refused disconnect is reported and keeps the row', async ({
    page,
  }) => {
    await storeSettings(page, { enabled: true })
    await expectListening(SAVED_PORT)
    const client = await connectMcpClient(page, mcpEndpointUrl(SAVED_PORT), CLIENT_NAME)
    try {
      const disconnectRoute = apiPathMatcher(`/mcp/sessions/${client.sessionId}`)
      const sessionIds = async (): Promise<string[]> =>
        (await readStatus(page)).sessions.map((session) => session.session_id)
      await openMcpPage(page)
      const row = page.getByTestId(`mcp-session-row-${client.sessionId}`)
      const disconnect = row.getByRole('button', { name: 'Disconnect', exact: true })
      await expect(row).toContainText(CLIENT_NAME)
      expect(await sessionIds()).toEqual([client.sessionId])

      await test.step('a refused disconnect shows the reason and keeps the row and the session', async () => {
        await failApiRoute(page, disconnectRoute, { detail: DISCONNECT_REASON }, 'DELETE')
        await disconnect.click()
        await expectFailureToast(page, DISCONNECT_FAILED_TITLE, DISCONNECT_REASON)
        await expect(row).toBeVisible()
        expect(await sessionIds()).toEqual([client.sessionId])
        expect((await askMcpSession(SAVED_PORT, client.sessionId)).status).toBe(200)
        await page.unroute(disconnectRoute)
      })

      await test.step('Disconnect removes the row and the endpoint refuses the session', async () => {
        const [answer] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.request().method() === 'DELETE' && disconnectRoute(new URL(response.url())),
          ),
          disconnect.click(),
        ])
        expect(answer.status()).toBe(204)
        await expect(row).toHaveCount(0)
        await expect(
          page.getByTestId('mcp-sessions-section').getByText('No connected clients.', { exact: true }),
        ).toBeVisible()
        expect(await sessionIds()).toEqual([])
        expect(await askMcpSession(SAVED_PORT, client.sessionId)).toEqual({
          status: 404,
          error: 'Session terminated',
        })
      })
    } finally {
      await client.close()
    }
  })
})
