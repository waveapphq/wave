/**
 * V-NET-PROXY-FUNCTIONAL (pages): Settings > Network > Proxy > Setup and Blocks, every guard that needs no request through a proxy
 * Design Decisions: NET-1, NET-10, NET-11, SHELL-9, SHELL-10, MCP-7
 * REQ: REQ-4.7.14, REQ-4.7.16, REQ-5.2.1.50, REQ-3.1.3.5
 *
 * Pass Criteria:
 * 1. With the proxy on and Source "WAVE host's settings", a WAVE host that sets no proxy variable shows
 *    `This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off` under Source,
 *    Save stays disabled, the server refuses the same save with the same text and nothing is stored.
 * 2. A duplicate entry shows `The same address as entry 1` and an entry with a trailing slash shows
 *    `Remove everything after the host and port`, each under its own row with Save disabled; correcting the
 *    entry enables Save, and the saved list read back over the API holds the corrected entries.
 * 3. "Only the addresses in the list" with an empty list shows
 *    `Add at least one address, or choose "All addresses except the list"` under "Use the proxy for" with Save
 *    disabled; the other mode or one address enables Save, and the saved mode and entry are read back.
 * 4. A Username with a colon shows `Username must not contain a colon` under Username with Save disabled;
 *    the corrected name is saved, and the server refuses the colon with the same text.
 * 5. Proxy Blocks has no Cancel and no Save and shows every block once: HTTP under "Blocks that use this
 *    proxy", Shell Exec under "Blocks that do not use this proxy", "Not applicable" closed until its header
 *    is clicked; each section holds as many blocks as the server lists for it.
 * 6. The three Proxy Blocks sections come back as the user left them after another Settings page, after
 *    leaving Settings through the app navigation and after a page reload; a new browser context starts with
 *    the first two open and "Not applicable" closed.
 * 7. A Save with "Use a proxy" off stores nothing else: the API answers the defaults, the proxy part of the
 *    stack's config file is as it was before the proxy was saved, and turned on again the source and every
 *    Custom field are at their defaults, with Save refused until an address and a port are typed.
 * 8. A bad Custom value hidden by turning the proxy off does not keep Save disabled and is not stored.
 * 9. With a saved Custom proxy, choosing "WAVE host's settings" hides the Custom rows and is refused for the
 *    missing variable only; the server's check drops Custom values sent with that source and writes nothing.
 * 10. A message under IP or Hostname and under one list entry arrives in a polite live region that was on
 *     the page, empty, before it; the field names it as its description; two more characters that keep the
 *     same message change nothing in that region.
 * 11. Keyboard only, on the saved password: Escape and Cancel on "Edit Protected Value?" put focus back on the
 *     masked Password; "Delete & Edit" puts it in the empty Password input and typed keys land there.
 * 12. With focus left in Username and the question opened without moving focus: Cancel puts focus on the
 *     masked Password; "Delete & Edit" puts it in Password, and typed keys land there and not in Username.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  HTTP_TARGET_HOST,
  PROXY_AUTH_PORT,
  PROXY_AUTH_SECRET,
  PROXY_AUTH_USER,
  PROXY_PORT,
} from '../../helpers/config'
import { configSection, readConfigText, stackPaths } from '../../helpers/config-file'
import { resetNetworkSettings } from '../../helpers/network-settings'

// ============================================================================
// Texts
// ============================================================================

const NO_HOST_VARIABLE =
  'This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off'
const HOST_REQUIRED = 'IP or Hostname is required when the source is Custom'
const PORT_REQUIRED = 'Port is required when the source is Custom'
const HOST_FORM = 'IP or Hostname must be an IP address or a host name, with no protocol and no port'
const PORT_RANGE = 'Port must be a whole number from 1 to 65535'
const USERNAME_COLON = 'Username must not contain a colon'
const ENTRY_TRAILING = 'Remove everything after the host and port'
const ONLY_NEEDS_AN_ENTRY = 'Add at least one address, or choose "All addresses except the list"'
const sameAsEntry = (row: number): string => `The same address as entry ${row}`

const HOST_SOURCE = "WAVE host's settings"
const CUSTOM_SOURCE = 'Custom'
const EXCEPT_MODE = 'All addresses except the list'
const ONLY_MODE = 'Only the addresses in the list'

const CONFIRM_TITLE = 'Edit Protected Value?'
const CONFIRM_DELETE = 'Delete & Edit'
const CONFIRM_CANCEL = 'Cancel'

// ============================================================================
// Values
// ============================================================================

// Reserved names: nothing in this spec is ever connected to.
const LISTED = 'https://intranet.example.test'
const OTHER_LISTED = 'https://wiki.example.test:8443'
const BAD_HOST = 'http://proxy'
const TYPED_SECRET = 'typed-after-delete'

type Source = 'host' | 'custom'
type ListMode = 'except' | 'only'

interface ProxyEntry {
  kind: 'exact' | 'regex'
  address: string
}

interface SavedProxy {
  enabled: boolean
  source: Source
  host: string
  port: number | null
  username: string
  password_set: boolean
  list_mode: ListMode
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
}

interface HostValues {
  https_proxy: string | null
  http_proxy: string | null
  no_proxy: string | null
}

interface ProxyView extends SavedProxy {
  host_values: HostValues
}

interface ProxyProblem {
  field: string
  row: number | null
  message: string
}

type StagedChange = Partial<Omit<SavedProxy, 'password_set'> & { password: string }>

interface BlockRef {
  id: string
  name: string
  category: string
}

interface ProxyBlocks {
  supported: BlockRef[]
  unsupported: BlockRef[]
  not_applicable: BlockRef[]
}

const DEFAULT_PROXY: SavedProxy = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password_set: false,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
}

// "Only" with a reserved name keeps every real address of the stack connecting directly.
const LOGIN_PROXY: SavedProxy = {
  enabled: true,
  source: 'custom',
  host: HTTP_TARGET_HOST,
  port: Number(PROXY_AUTH_PORT),
  username: PROXY_AUTH_USER,
  password_set: true,
  list_mode: 'only',
  entries: [{ kind: 'exact', address: LISTED }],
  proxy_local_addresses: true,
}

// ============================================================================
// API
// ============================================================================

interface Reply {
  status: number
  text: string
}

async function send(method: string, path: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const reply = await send(method, path, body)
  if (reply.status < 200 || reply.status > 299) {
    throw new Error(`${method} ${path} failed: ${reply.status} ${reply.text}`)
  }
  return JSON.parse(reply.text) as T
}

/** The saved Proxy settings as the API answers them, without the WAVE host's variables. */
async function savedProxy(): Promise<SavedProxy> {
  const view = await api<ProxyView>('GET', '/network/proxy')
  return {
    enabled: view.enabled,
    source: view.source,
    host: view.host,
    port: view.port,
    username: view.username,
    password_set: view.password_set,
    list_mode: view.list_mode,
    entries: view.entries,
    proxy_local_addresses: view.proxy_local_addresses,
  }
}

async function problemsOf(change: StagedChange): Promise<ProxyProblem[]> {
  const answer = await api<{ problems: ProxyProblem[] }>('POST', '/network/proxy/validate', change)
  return answer.problems
}

/** The message of a refused PATCH, after checking that it was refused with 400. */
async function refusalOf(change: StagedChange): Promise<string> {
  const reply = await send('PATCH', '/network/proxy', change)
  expect(reply.status, reply.text).toBe(400)
  return (JSON.parse(reply.text) as { error: { message: string } }).error.message
}

async function seedLoginProxy(): Promise<void> {
  await api<ProxyView>('PATCH', '/network/proxy', {
    enabled: LOGIN_PROXY.enabled,
    source: LOGIN_PROXY.source,
    host: LOGIN_PROXY.host,
    port: LOGIN_PROXY.port,
    username: LOGIN_PROXY.username,
    password: PROXY_AUTH_SECRET,
    list_mode: LOGIN_PROXY.list_mode,
    entries: LOGIN_PROXY.entries,
    proxy_local_addresses: LOGIN_PROXY.proxy_local_addresses,
  })
  expect(await savedProxy()).toEqual(LOGIN_PROXY)
}

/** The `proxy:` part of the network section of the stack's config file. */
function proxySection(configFile: string): string {
  const lines = configSection(configFile, 'network').split('\n')
  const start = lines.findIndex((line) => /^ {2}proxy:/.test(line))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^ {2}[^\s#]/.test(line))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n').trimEnd()
}

// ============================================================================
// Proxy Setup page
// ============================================================================

const SETUP_PATH = '/settings/network/proxy/setup'

const setupTab = (page: Page): Locator => page.getByTestId('network-proxy-setup-tab')
const saveButton = (page: Page): Locator =>
  setupTab(page).getByRole('button', { name: 'Save', exact: true })
const cancelButton = (page: Page): Locator =>
  setupTab(page).getByRole('button', { name: 'Cancel', exact: true })
const useProxy = (page: Page): Locator =>
  setupTab(page).getByRole('switch', { name: 'Use a proxy', exact: true })
const localSwitch = (page: Page): Locator =>
  setupTab(page).getByRole('switch', { name: 'Use the proxy for local addresses too', exact: true })
const sourceGroup = (page: Page): Locator =>
  setupTab(page).getByRole('group', { name: 'Source', exact: true })
const listModeGroup = (page: Page): Locator =>
  setupTab(page).getByRole('group', { name: 'Use the proxy for', exact: true })
const part = (group: Locator, name: string): Locator =>
  group.getByRole('button', { name, exact: true })
const hostInput = (page: Page): Locator => setupTab(page).locator('input[name="proxy-host"]')
const portInput = (page: Page): Locator => setupTab(page).locator('input[name="proxy-port"]')
const usernameInput = (page: Page): Locator =>
  setupTab(page).locator('input[name="proxy-username"]')
const passwordInput = (page: Page): Locator => setupTab(page).locator('input[name="password"]')
const maskedPassword = (page: Page): Locator =>
  setupTab(page).locator('button[aria-label="Password: Edit protected value"]')
const entryInput = (page: Page, row: number): Locator =>
  setupTab(page).locator(`input[name="proxy-entry-${row}"]`)
const entryInputs = (page: Page): Locator => setupTab(page).locator('input[name^="proxy-entry-"]')
const addButton = (page: Page): Locator =>
  setupTab(page).getByRole('button', { name: 'Add entry', exact: true })
/** Every message line the page shows, top to bottom. */
const messages = (page: Page): Locator => setupTab(page).locator('[aria-live="polite"] p')
const confirm = (page: Page): Locator =>
  page.getByRole('dialog').filter({ hasText: CONFIRM_TITLE })
const confirmButton = (page: Page, name: string): Locator =>
  confirm(page).getByRole('button', { name, exact: true })

async function waitSetupLoaded(page: Page): Promise<void> {
  await expect(useProxy(page)).toBeVisible()
  await expect(page.getByTestId('proxy-setup-skeleton')).toHaveCount(0)
}

async function openSetup(page: Page): Promise<void> {
  await page.goto(SETUP_PATH)
  await expect(page.getByTestId('settings-nav-network-proxy-setup')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await waitSetupLoaded(page)
}

async function expectClean(page: Page): Promise<void> {
  await expect(saveButton(page)).toBeDisabled()
  await expect(cancelButton(page)).toBeDisabled()
}

async function turnOn(page: Page): Promise<void> {
  await useProxy(page).click()
  await expect(useProxy(page)).toBeChecked()
  await expect(sourceGroup(page)).toBeVisible()
}

async function turnOff(page: Page): Promise<void> {
  await useProxy(page).click()
  await expect(useProxy(page)).not.toBeChecked()
  await expect(sourceGroup(page)).toHaveCount(0)
}

async function chooseSource(page: Page, name: string): Promise<void> {
  await part(sourceGroup(page), name).click()
  await expect(part(sourceGroup(page), name)).toHaveAttribute('aria-pressed', 'true')
}

async function chooseListMode(page: Page, name: string): Promise<void> {
  await part(listModeGroup(page), name).click()
  await expect(part(listModeGroup(page), name)).toHaveAttribute('aria-pressed', 'true')
}

/** Turns the proxy on as Custom with an address and a port the server accepts. */
async function stageCustomAddress(page: Page, port: string): Promise<void> {
  await turnOn(page)
  await chooseSource(page, CUSTOM_SOURCE)
  await hostInput(page).fill(HTTP_TARGET_HOST)
  await portInput(page).fill(port)
  await expect(messages(page)).toHaveCount(0)
  await expect(saveButton(page)).toBeEnabled()
}

async function addEntry(page: Page, row: number, address: string): Promise<void> {
  await addButton(page).click()
  await expect(entryInput(page, row)).toBeVisible()
  await entryInput(page, row).fill(address)
}

/** Saves through the page and waits until the server stored it and the page is clean. */
async function saveOnPage(page: Page): Promise<void> {
  const written = page.waitForResponse(
    (response) =>
      response.url().endsWith('/network/proxy') && response.request().method() === 'PATCH',
  )
  await saveButton(page).click()
  const response = await written
  expect(response.status(), await response.text()).toBe(200)
  await expectClean(page)
}

/** The message is the field's description and its line sits under the field, in a polite region. */
async function expectFieldMessage(control: Locator, message: string): Promise<void> {
  await expect(control).toHaveAccessibleDescription(message)
  const line = await control.evaluate((field) => {
    const ids = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    const node = ids
      .map((id) => document.getElementById(id))
      .find((found) => found?.closest('[aria-live="polite"]'))
    if (!node) return null
    const fieldBox = field.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return {
      text: node.textContent,
      below: box.top >= fieldBox.bottom,
      overlaps: box.left < fieldBox.right && box.right > fieldBox.left,
    }
  })
  expect(line).toEqual({ text: message, below: true, overlaps: true })
}

async function expectNoFieldMessage(input: Locator): Promise<void> {
  await expect(input).toHaveAccessibleDescription('')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
}

// ============================================================================
// Message regions
// ============================================================================

interface RegionState {
  onPage: boolean
  live: string | null
  text: string
  messageId: string | null
}

interface RegionWatch {
  observer: MutationObserver
  seen: string[]
}

interface WatchedRegion {
  state(): Promise<RegionState>
  /** How many changes the region has had since the watch began; a screen reader speaks on a change. */
  changes(): Promise<number>
}

const EMPTY_REGION: RegionState = { onPage: true, live: 'polite', text: '', messageId: null }

/** The live region of the row a field sits in, watched from now on. */
async function watchRegion(field: Locator): Promise<WatchedRegion> {
  const region = await field.evaluateHandle((node) => {
    let row = node.parentElement
    while (row && !row.querySelector(':scope > [aria-live]')) row = row.parentElement
    const found = row?.querySelector(':scope > [aria-live]')
    if (!found) throw new Error('no live region beside the field')
    return found
  })
  const watch = await region.evaluateHandle((node): RegionWatch => {
    const seen: string[] = []
    const observer = new MutationObserver((records) => {
      seen.push(...records.map((record) => record.type))
    })
    observer.observe(node, { subtree: true, childList: true, characterData: true, attributes: true })
    return { observer, seen }
  })
  return {
    state: () =>
      region.evaluate((node) => ({
        onPage: node.isConnected,
        live: node.getAttribute('aria-live'),
        text: node.textContent ?? '',
        messageId: node.querySelector('p')?.getAttribute('id') ?? null,
      })),
    changes: () =>
      watch.evaluate(({ observer, seen }) => {
        seen.push(...observer.takeRecords().map((record) => record.type))
        return seen.length
      }),
  }
}

/** Resolves once the server's answer to the check of a matching staged change has fully arrived. */
async function checkAnswered(page: Page, matches: (change: StagedChange) => boolean): Promise<void> {
  const response = await page.waitForResponse((reply) => {
    const request = reply.request()
    if (request.method() !== 'POST' || !reply.url().endsWith('/network/proxy/validate')) return false
    return matches(request.postDataJSON() as StagedChange)
  })
  await response.finished()
}

/** The question is open and keyboard focus has moved into it. */
async function expectAsked(page: Page): Promise<void> {
  await expect(confirm(page)).toBeVisible()
  await expect(confirm(page).locator('*:focus')).toHaveCount(1)
}

/** Presses Tab until the target holds keyboard focus. */
async function tabTo(page: Page, target: Locator, most: number): Promise<void> {
  for (let presses = 0; presses < most; presses += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  await expect(target).toBeFocused()
}

// ============================================================================
// Proxy Blocks page
// ============================================================================

const BLOCKS_PATH = '/settings/network/proxy/blocks'
const BLOCKS_URL = /\/settings\/network\/proxy\/blocks$/
const BLOCKS_NAV = 'settings-nav-network-proxy-blocks'

interface BlockSection {
  list: keyof ProxyBlocks
  testId: string
  title: string
}

const USES: BlockSection = {
  list: 'supported',
  testId: 'proxy-blocks-supported',
  title: 'Blocks that use this proxy',
}
const USES_NOT: BlockSection = {
  list: 'unsupported',
  testId: 'proxy-blocks-unsupported',
  title: 'Blocks that do not use this proxy',
}
const NOT_APPLICABLE: BlockSection = {
  list: 'not_applicable',
  testId: 'proxy-blocks-not-applicable',
  title: 'Not applicable',
}
const SECTIONS: readonly BlockSection[] = [USES, USES_NOT, NOT_APPLICABLE]

type OpenStates = readonly [boolean, boolean, boolean]
const FIRST_STATE: OpenStates = [true, true, false]

const blocksTab = (page: Page): Locator => page.getByTestId('network-proxy-blocks-tab')
const sectionHeader = (page: Page, section: BlockSection): Locator =>
  page.getByTestId(section.testId).getByRole('button', { name: section.title, exact: true })
const sectionBlocks = (page: Page, section: BlockSection): Locator =>
  page.getByTestId(section.testId).getByTestId('proxy-block')
const groupNames = (page: Page, section: BlockSection): Locator =>
  page.getByTestId(section.testId).getByTestId('proxy-block-group-name')
const groupBlocks = (page: Page, section: BlockSection, group: string): Locator =>
  page
    .getByTestId(section.testId)
    .getByTestId('proxy-block-group')
    .filter({
      has: page.getByTestId('proxy-block-group-name').filter({ hasText: new RegExp(`^${group}$`) }),
    })
    .getByTestId('proxy-block')
const sidebarLink = (page: Page, name: string): Locator =>
  page.getByTestId('sidebar').getByRole('link', { name, exact: true })

async function waitBlocksLoaded(page: Page): Promise<void> {
  await expect(sectionHeader(page, USES)).toBeVisible()
  await expect(page.getByTestId('proxy-blocks-skeleton')).toHaveCount(0)
}

async function openBlocks(page: Page): Promise<void> {
  await page.goto(BLOCKS_PATH)
  await expect(page.getByTestId(BLOCKS_NAV)).toHaveAttribute('aria-current', 'page')
  await waitBlocksLoaded(page)
}

/** Opens Proxy Blocks from the Settings menu, wherever in Settings the page is. */
async function openBlocksFromMenu(page: Page): Promise<void> {
  for (const name of ['Network', 'Proxy']) {
    const group = page.getByTestId('settings-sections').getByRole('button', { name, exact: true })
    if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'true')
  }
  await page.getByTestId(BLOCKS_NAV).click()
  await expect(page).toHaveURL(BLOCKS_URL)
  await waitBlocksLoaded(page)
}

/** Each header carries its open state, and an open section alone shows its blocks. */
async function expectSections(page: Page, open: OpenStates): Promise<void> {
  for (const [index, section] of SECTIONS.entries()) {
    await expect(sectionHeader(page, section)).toHaveAttribute('aria-expanded', String(open[index]))
    if (open[index]) await expect(sectionBlocks(page, section)).not.toHaveCount(0)
    else await expect(sectionBlocks(page, section)).toHaveCount(0)
  }
}

// ============================================================================
// Tests
// ============================================================================

test.describe('V-NET-PROXY-FUNCTIONAL (pages): Settings > Network > Proxy > Setup and Blocks', () => {
  // The Proxy setting is shared by everything that runs against the same stack.
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test('1. Source "WAVE host\'s settings" on a WAVE host with no proxy variable shows the refusal under Source and keeps Save disabled', async ({
    page,
  }) => {
    const view = await api<ProxyView>('GET', '/network/proxy')
    expect(view.host_values, 'the stack backend sets no proxy variable').toEqual({
      https_proxy: null,
      http_proxy: null,
      no_proxy: null,
    })

    await openSetup(page)
    await expect(useProxy(page)).not.toBeChecked()
    await expect(sourceGroup(page)).toHaveCount(0)
    await expectClean(page)

    await test.step('turned on, the source is the WAVE host and the refusal shows under Source', async () => {
      await turnOn(page)
      await expect(part(sourceGroup(page), HOST_SOURCE)).toHaveAttribute('aria-pressed', 'true')
      await expect(part(sourceGroup(page), CUSTOM_SOURCE)).toHaveAttribute('aria-pressed', 'false')
      await expectFieldMessage(sourceGroup(page), NO_HOST_VARIABLE)
      await expect(messages(page)).toHaveText([NO_HOST_VARIABLE])
      for (const variable of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
        await expect(setupTab(page).getByText(variable, { exact: true })).toBeVisible()
      }
      await expect(setupTab(page).getByText('Not set', { exact: true })).toHaveCount(3)
      await expect(saveButton(page)).toBeDisabled()
      await expect(cancelButton(page)).toBeEnabled()
    })

    await test.step('Custom with an address and a port can be saved, the WAVE host chosen again cannot', async () => {
      await chooseSource(page, CUSTOM_SOURCE)
      await expect(messages(page)).toHaveText([HOST_REQUIRED, PORT_REQUIRED])
      await hostInput(page).fill(HTTP_TARGET_HOST)
      await portInput(page).fill(PROXY_PORT)
      await expect(messages(page)).toHaveCount(0)
      await expect(saveButton(page)).toBeEnabled()

      await chooseSource(page, HOST_SOURCE)
      await expect(hostInput(page)).toHaveCount(0)
      await expectFieldMessage(sourceGroup(page), NO_HOST_VARIABLE)
      await expect(messages(page)).toHaveText([NO_HOST_VARIABLE])
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('nothing was stored, and the server refuses the same save with the same text', async () => {
      expect(await savedProxy()).toEqual(DEFAULT_PROXY)
      expect(await refusalOf({ enabled: true, source: 'host' })).toBe(NO_HOST_VARIABLE)
      expect(await savedProxy()).toEqual(DEFAULT_PROXY)
    })

    await test.step('Cancel puts the saved state back', async () => {
      await cancelButton(page).click()
      await expect(useProxy(page)).not.toBeChecked()
      await expect(sourceGroup(page)).toHaveCount(0)
      await expectClean(page)
    })
  })

  test('2. a duplicate entry and an entry with a trailing slash show their message under the row and keep Save disabled until corrected', async ({
    page,
  }) => {
    await openSetup(page)
    await stageCustomAddress(page, PROXY_PORT)
    await addEntry(page, 1, LISTED)
    await chooseListMode(page, ONLY_MODE)
    await expect(messages(page)).toHaveCount(0)
    await expect(saveButton(page)).toBeEnabled()

    await test.step('the same address in a second row is refused under that row only', async () => {
      await addEntry(page, 2, LISTED)
      await expectFieldMessage(entryInput(page, 2), sameAsEntry(1))
      await expect(entryInput(page, 2)).toHaveAttribute('aria-invalid', 'true')
      await expect(messages(page)).toHaveText([sameAsEntry(1)])
      await expectNoFieldMessage(entryInput(page, 1))
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('another address in the second row enables Save', async () => {
      await entryInput(page, 2).fill(OTHER_LISTED)
      await expect(messages(page)).toHaveCount(0)
      await expectNoFieldMessage(entryInput(page, 2))
      await expect(saveButton(page)).toBeEnabled()
    })

    await test.step('a trailing slash is refused under its row, and removing it enables Save', async () => {
      await entryInput(page, 2).fill(`${OTHER_LISTED}/`)
      await expectFieldMessage(entryInput(page, 2), ENTRY_TRAILING)
      await expect(entryInput(page, 2)).toHaveAttribute('aria-invalid', 'true')
      await expect(messages(page)).toHaveText([ENTRY_TRAILING])
      await expectNoFieldMessage(entryInput(page, 1))
      await expect(saveButton(page)).toBeDisabled()

      await entryInput(page, 2).fill(OTHER_LISTED)
      await expect(messages(page)).toHaveCount(0)
      await expectNoFieldMessage(entryInput(page, 2))
      await expect(saveButton(page)).toBeEnabled()
    })

    await test.step('Save stores the corrected list, and a reload shows it', async () => {
      await saveOnPage(page)
      expect(await savedProxy()).toEqual({
        ...DEFAULT_PROXY,
        enabled: true,
        source: 'custom',
        host: HTTP_TARGET_HOST,
        port: Number(PROXY_PORT),
        list_mode: 'only',
        entries: [
          { kind: 'exact', address: LISTED },
          { kind: 'exact', address: OTHER_LISTED },
        ],
      })
      await page.reload()
      await waitSetupLoaded(page)
      await expect(entryInputs(page)).toHaveCount(2)
      await expect(entryInput(page, 1)).toHaveValue(LISTED)
      await expect(entryInput(page, 2)).toHaveValue(OTHER_LISTED)
      await expectClean(page)
    })
  })

  test('3. "Only the addresses in the list" with an empty list shows its message under "Use the proxy for" and keeps Save disabled', async ({
    page,
  }) => {
    await openSetup(page)
    await stageCustomAddress(page, PROXY_PORT)
    await expect(part(listModeGroup(page), EXCEPT_MODE)).toHaveAttribute('aria-pressed', 'true')
    await expect(entryInputs(page)).toHaveCount(0)

    await test.step('"Only" with no address is refused under "Use the proxy for"', async () => {
      await chooseListMode(page, ONLY_MODE)
      await expectFieldMessage(listModeGroup(page), ONLY_NEEDS_AN_ENTRY)
      await expect(messages(page)).toHaveText([ONLY_NEEDS_AN_ENTRY])
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('"All addresses except the list" enables Save again', async () => {
      await chooseListMode(page, EXCEPT_MODE)
      await expect(messages(page)).toHaveCount(0)
      await expect(saveButton(page)).toBeEnabled()
    })

    await test.step('"Only" with one address enables Save, and the mode and the address are stored', async () => {
      await chooseListMode(page, ONLY_MODE)
      await expectFieldMessage(listModeGroup(page), ONLY_NEEDS_AN_ENTRY)
      await expect(saveButton(page)).toBeDisabled()
      await addEntry(page, 1, LISTED)
      await expect(messages(page)).toHaveCount(0)
      await expect(saveButton(page)).toBeEnabled()

      await saveOnPage(page)
      expect(await savedProxy()).toEqual({
        ...DEFAULT_PROXY,
        enabled: true,
        source: 'custom',
        host: HTTP_TARGET_HOST,
        port: Number(PROXY_PORT),
        list_mode: 'only',
        entries: [{ kind: 'exact', address: LISTED }],
      })
    })
  })

  test('4. a Username with a colon shows its message under Username and keeps Save disabled', async ({
    page,
  }) => {
    const withColon = `${PROXY_AUTH_USER}:admin`
    await openSetup(page)
    await stageCustomAddress(page, PROXY_AUTH_PORT)
    await addEntry(page, 1, LISTED)
    await chooseListMode(page, ONLY_MODE)
    await expect(saveButton(page)).toBeEnabled()

    await test.step('the colon is refused under Username', async () => {
      await usernameInput(page).fill(withColon)
      await expectFieldMessage(usernameInput(page), USERNAME_COLON)
      await expect(usernameInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(messages(page)).toHaveText([USERNAME_COLON])
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('the name without the colon is saved', async () => {
      await usernameInput(page).fill(PROXY_AUTH_USER)
      await expect(messages(page)).toHaveCount(0)
      await expectNoFieldMessage(usernameInput(page))
      await expect(saveButton(page)).toBeEnabled()
      await saveOnPage(page)
    })

    await test.step('the server refuses the colon with the same text and keeps the saved name', async () => {
      const saved: SavedProxy = {
        ...DEFAULT_PROXY,
        enabled: true,
        source: 'custom',
        host: HTTP_TARGET_HOST,
        port: Number(PROXY_AUTH_PORT),
        username: PROXY_AUTH_USER,
        list_mode: 'only',
        entries: [{ kind: 'exact', address: LISTED }],
      }
      expect(await savedProxy()).toEqual(saved)
      expect(await refusalOf({ username: withColon })).toBe(USERNAME_COLON)
      expect(await savedProxy()).toEqual(saved)
    })
  })

  test('5. Proxy Blocks lists every block once: HTTP uses the proxy, Shell Exec does not, and "Not applicable" opens on a click', async ({
    page,
  }) => {
    const lists = await api<ProxyBlocks>('GET', '/network/proxy/blocks')
    expect(lists.supported.map((block) => block.id)).toContain('http-client')
    expect(lists.unsupported.map((block) => block.id)).toContain('shell-exec')

    await openBlocks(page)
    await expect(blocksTab(page).getByRole('heading', { level: 2 })).toHaveText('Proxy Blocks')
    await expect(blocksTab(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(blocksTab(page).getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
    await expectSections(page, FIRST_STATE)

    await test.step('HTTP sits under "Blocks that use this proxy", in its palette group', async () => {
      await expect(groupNames(page, USES)).toHaveText(['Network', 'Database', 'Kubernetes', 'Helm'])
      await expect(groupBlocks(page, USES, 'Network')).toHaveText(['HTTP'])
      await expect(sectionBlocks(page, USES)).toHaveCount(lists.supported.length)
      await expect(sectionBlocks(page, USES).filter({ hasText: /^Shell Exec$/ })).toHaveCount(0)
    })

    await test.step('Shell Exec sits under "Blocks that do not use this proxy"', async () => {
      await expect(groupNames(page, USES_NOT)).toHaveText(['System'])
      await expect(groupBlocks(page, USES_NOT, 'System')).toHaveText([
        'Shell Script',
        'Shell Exec',
        'Python',
      ])
      await expect(sectionBlocks(page, USES_NOT)).toHaveCount(lists.unsupported.length)
      await expect(sectionBlocks(page, USES_NOT).filter({ hasText: /^HTTP$/ })).toHaveCount(0)
    })

    await test.step('"Not applicable" shows nothing until its header is clicked', async () => {
      await expect(sectionBlocks(page, NOT_APPLICABLE)).toHaveCount(0)
      await sectionHeader(page, NOT_APPLICABLE).click()
      await expectSections(page, [true, true, true])
      await expect(groupNames(page, NOT_APPLICABLE)).toHaveText([
        'Network',
        'Remote',
        'Database',
        'System',
        'Data',
      ])
      await expect(groupBlocks(page, NOT_APPLICABLE, 'Network')).toHaveText(['Ping', 'Netcat'])
      await expect(sectionBlocks(page, NOT_APPLICABLE)).toHaveCount(lists.not_applicable.length)
    })

    await test.step('no block is listed twice', async () => {
      const shown = (
        await Promise.all(SECTIONS.map((section) => sectionBlocks(page, section).allTextContents()))
      ).flat()
      expect(shown).toHaveLength(
        lists.supported.length + lists.unsupported.length + lists.not_applicable.length,
      )
      expect(new Set(shown).size).toBe(shown.length)
    })

    await test.step('a click on the open header closes it again', async () => {
      await sectionHeader(page, NOT_APPLICABLE).click()
      await expectSections(page, FIRST_STATE)
    })
  })

  test('6. the Proxy Blocks sections come back as the user left them in the same tab, and a new browser context starts from the first state', async ({
    page,
    browser,
    baseURL,
  }) => {
    const left: OpenStates = [false, true, true]

    await openBlocks(page)
    await expectSections(page, FIRST_STATE)
    await sectionHeader(page, USES).click()
    await sectionHeader(page, NOT_APPLICABLE).click()
    await expectSections(page, left)

    await test.step('after another Settings page', async () => {
      await page.getByTestId('settings-nav-general').click()
      await expect(page).toHaveURL(/\/settings$/)
      await expect(blocksTab(page)).toHaveCount(0)
      await openBlocksFromMenu(page)
      await expectSections(page, left)
    })

    await test.step('after leaving Settings through the app navigation', async () => {
      await sidebarLink(page, 'Dashboard').click()
      await expect(page).toHaveURL(/\/dashboard$/)
      await sidebarLink(page, 'Settings').click()
      await expect(page).toHaveURL(/\/settings$/)
      await openBlocksFromMenu(page)
      await expectSections(page, left)
    })

    await test.step('after a page reload', async () => {
      await page.reload()
      await waitBlocksLoaded(page)
      await expectSections(page, left)
    })

    await test.step('the middle section is remembered closed as well', async () => {
      await sectionHeader(page, USES_NOT).click()
      await expectSections(page, [false, false, true])
      await page.reload()
      await waitBlocksLoaded(page)
      await expectSections(page, [false, false, true])
    })

    await test.step('a new browser context starts from the first state', async () => {
      const context = await browser.newContext({ baseURL })
      try {
        const fresh = await context.newPage()
        await openBlocks(fresh)
        await expectSections(fresh, FIRST_STATE)
      } finally {
        await context.close()
      }
    })
  })

  test('7. a Save with "Use a proxy" off stores nothing else, and turned on again every field is at its default', async ({
    page,
    request,
  }) => {
    const { configFile } = await stackPaths(request)
    const sectionAtStart = proxySection(configFile)
    expect(sectionAtStart, 'the stack starts with the proxy off').toMatch(/^ {4}enabled: false$/m)

    await openSetup(page)

    await test.step('a Custom proxy with a login, a list row and the local switch is saved', async () => {
      await stageCustomAddress(page, PROXY_AUTH_PORT)
      await usernameInput(page).fill(PROXY_AUTH_USER)
      await passwordInput(page).fill(PROXY_AUTH_SECRET)
      await addEntry(page, 1, LISTED)
      await chooseListMode(page, ONLY_MODE)
      await localSwitch(page).click()
      await expect(localSwitch(page)).toBeChecked()
      await saveOnPage(page)

      await expect(maskedPassword(page)).toHaveCount(1)
      await expect(passwordInput(page)).toHaveCount(0)
      expect(await savedProxy()).toEqual(LOGIN_PROXY)
      const stored = proxySection(configFile)
      expect(stored).toContain(LISTED)
      expect(stored).toMatch(/^ {4}password: wave:enc:/m)
      expect(stored).not.toContain(PROXY_AUTH_SECRET)
    })

    await test.step('turned off and saved, the server and the config file hold the defaults', async () => {
      await turnOff(page)
      await saveOnPage(page)
      await page.reload()
      await waitSetupLoaded(page)
      await expect(useProxy(page)).not.toBeChecked()
      await expect(sourceGroup(page)).toHaveCount(0)
      await expectClean(page)
      expect(await savedProxy()).toEqual(DEFAULT_PROXY)
      expect(proxySection(configFile)).toBe(sectionAtStart)
    })

    await test.step('turned on again, the source and every Custom field are at their defaults', async () => {
      await turnOn(page)
      await expect(part(sourceGroup(page), HOST_SOURCE)).toHaveAttribute('aria-pressed', 'true')
      await chooseSource(page, CUSTOM_SOURCE)
      await expect(hostInput(page)).toHaveValue('')
      await expect(portInput(page)).toHaveValue('')
      await expect(usernameInput(page)).toHaveValue('')
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(passwordInput(page)).toHaveValue('')
      await expect(part(listModeGroup(page), EXCEPT_MODE)).toHaveAttribute('aria-pressed', 'true')
      await expect(entryInputs(page)).toHaveCount(0)
      await expect(localSwitch(page)).not.toBeChecked()
    })

    await test.step('Save is refused until an address and a port are typed', async () => {
      await expect(messages(page)).toHaveText([HOST_REQUIRED, PORT_REQUIRED])
      await expect(saveButton(page)).toBeDisabled()
      await hostInput(page).fill(HTTP_TARGET_HOST)
      await expect(messages(page)).toHaveText([PORT_REQUIRED])
      await expect(saveButton(page)).toBeDisabled()
      await portInput(page).fill(PROXY_PORT)
      await expect(messages(page)).toHaveCount(0)
      await expect(saveButton(page)).toBeEnabled()
    })
  })

  test('8. a bad Custom value hidden by turning the proxy off does not keep Save disabled and is not stored', async ({
    page,
    request,
  }) => {
    const { configFile } = await stackPaths(request)
    await openSetup(page)

    await test.step('a bad address under Custom shows its message and keeps Save disabled', async () => {
      await turnOn(page)
      await chooseSource(page, CUSTOM_SOURCE)
      await hostInput(page).fill(BAD_HOST)
      await expectFieldMessage(hostInput(page), HOST_FORM)
      await expect(hostInput(page)).toHaveAttribute('aria-invalid', 'true')
      await expect(messages(page)).toHaveText([HOST_FORM, PORT_REQUIRED])
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('with the proxy turned off the hidden address no longer blocks Save', async () => {
      await turnOff(page)
      await expect(hostInput(page)).toHaveCount(0)
      await expect(messages(page)).toHaveCount(0)
      await expect(saveButton(page)).toBeEnabled()
      await saveOnPage(page)
      await expect(useProxy(page)).not.toBeChecked()
    })

    await test.step('the bad address is stored nowhere and does not come back', async () => {
      expect(await savedProxy()).toEqual(DEFAULT_PROXY)
      expect(readConfigText(configFile)).not.toContain(BAD_HOST)
      await turnOn(page)
      await expect(part(sourceGroup(page), HOST_SOURCE)).toHaveAttribute('aria-pressed', 'true')
      await chooseSource(page, CUSTOM_SOURCE)
      await expect(hostInput(page)).toHaveValue('')
      await expect(messages(page)).toHaveText([HOST_REQUIRED, PORT_REQUIRED])
    })
  })

  test('9. with a saved Custom proxy, "WAVE host\'s settings" hides the Custom rows and the server drops Custom values sent with that source', async ({
    page,
  }) => {
    const refused: ProxyProblem[] = [{ field: 'source', row: null, message: NO_HOST_VARIABLE }]
    const badCustom: StagedChange = {
      host: BAD_HOST,
      port: 70000,
      username: `${PROXY_AUTH_USER}:admin`,
      list_mode: 'only',
      entries: [],
    }

    await seedLoginProxy()
    await openSetup(page)

    await test.step('the saved Custom proxy shows', async () => {
      await expect(part(sourceGroup(page), CUSTOM_SOURCE)).toHaveAttribute('aria-pressed', 'true')
      await expect(hostInput(page)).toHaveValue(HTTP_TARGET_HOST)
      await expect(portInput(page)).toHaveValue(PROXY_AUTH_PORT)
      await expect(usernameInput(page)).toHaveValue(PROXY_AUTH_USER)
      await expect(maskedPassword(page)).toHaveCount(1)
      await expect(entryInput(page, 1)).toHaveValue(LISTED)
      await expectClean(page)
    })

    await test.step('the WAVE host as source hides the Custom rows and is refused for the missing variable only', async () => {
      await chooseSource(page, HOST_SOURCE)
      await expect(hostInput(page)).toHaveCount(0)
      await expect(maskedPassword(page)).toHaveCount(0)
      await expect(entryInputs(page)).toHaveCount(0)
      await expectFieldMessage(sourceGroup(page), NO_HOST_VARIABLE)
      await expect(messages(page)).toHaveText([NO_HOST_VARIABLE])
      await expect(saveButton(page)).toBeDisabled()
    })

    await test.step('the check drops Custom values sent with the WAVE host as source', async () => {
      expect(await problemsOf({ source: 'host' })).toEqual(refused)
      expect(await problemsOf({ source: 'host', ...badCustom })).toEqual(refused)
      expect(await problemsOf({ source: 'custom', ...badCustom })).toEqual([
        { field: 'host', row: null, message: HOST_FORM },
        { field: 'port', row: null, message: PORT_RANGE },
        { field: 'username', row: null, message: USERNAME_COLON },
        { field: 'entries', row: null, message: ONLY_NEEDS_AN_ENTRY },
      ])
    })

    await test.step('the refused save and the checks wrote nothing', async () => {
      expect(await refusalOf({ source: 'host' })).toBe(NO_HOST_VARIABLE)
      expect(await savedProxy()).toEqual(LOGIN_PROXY)
    })
  })

  test('10. a message under a field arrives in a polite live region that was on the page before it, and typing on with the same message changes nothing in it', async ({
    page,
  }) => {
    await seedLoginProxy()
    await openSetup(page)
    const host = hostInput(page)
    const entry = entryInput(page, 1)
    const hostRegion = await watchRegion(host)
    const entryRegion = await watchRegion(entry)
    let hostState = EMPTY_REGION
    let entryState = EMPTY_REGION
    let hostChanges = 0
    let entryChanges = 0

    await test.step('both regions are on the page, polite and empty, before any message', async () => {
      expect(await hostRegion.state()).toEqual(EMPTY_REGION)
      expect(await entryRegion.state()).toEqual(EMPTY_REGION)
      await expectNoFieldMessage(host)
      await expectNoFieldMessage(entry)
      await expectClean(page)
    })

    await test.step('a bad address puts its message into the IP or Hostname region and the field names it', async () => {
      await host.fill(BAD_HOST)
      await expectFieldMessage(host, HOST_FORM)
      await expect(host).toHaveAttribute('aria-invalid', 'true')
      hostState = await hostRegion.state()
      expect(hostState).toEqual({
        onPage: true,
        live: 'polite',
        text: HOST_FORM,
        messageId: expect.any(String),
      })
      expect(await host.getAttribute('aria-describedby')).toBe(hostState.messageId)
      await expect(setupTab(page).getByRole('alert'), 'the message is no alert').toHaveCount(0)
      hostChanges = await hostRegion.changes()
      expect(hostChanges, 'the arriving message is a change a screen reader speaks').toBeGreaterThan(0)
    })

    await test.step('two more characters that keep the message change nothing in that region', async () => {
      const answered = checkAnswered(page, (change) => change.host === `${BAD_HOST}12`)
      await host.press('End')
      await host.pressSequentially('12')
      await expect(host).toHaveValue(`${BAD_HOST}12`)
      await answered
      // The entry message is drawn by a later check, so the answer above has been applied by then.
      await entry.fill(`${LISTED}/`)
      await expectFieldMessage(entry, ENTRY_TRAILING)
      expect(await hostRegion.changes(), 'the region was not touched').toBe(hostChanges)
      expect(await hostRegion.state()).toEqual(hostState)
      await expect(host).toHaveAccessibleDescription(HOST_FORM)
    })

    await test.step('the entry message sits in the entry region and the entry names it', async () => {
      await expect(entry).toHaveAttribute('aria-invalid', 'true')
      entryState = await entryRegion.state()
      expect(entryState).toEqual({
        onPage: true,
        live: 'polite',
        text: ENTRY_TRAILING,
        messageId: expect.any(String),
      })
      expect(await entry.getAttribute('aria-describedby')).toBe(entryState.messageId)
      entryChanges = await entryRegion.changes()
      expect(entryChanges, 'the arriving message is a change a screen reader speaks').toBeGreaterThan(0)
    })

    await test.step('two more characters in the entry that keep the message change nothing in its region', async () => {
      const answered = checkAnswered(
        page,
        (change) => change.entries?.[0]?.address === `${LISTED}/ab`,
      )
      await entry.press('End')
      await entry.pressSequentially('ab')
      await expect(entry).toHaveValue(`${LISTED}/ab`)
      await answered
      // The address message leaves by a later check, so the answer above has been applied by then.
      await host.fill(HTTP_TARGET_HOST)
      await expectNoFieldMessage(host)
      expect(await entryRegion.changes(), 'the region was not touched').toBe(entryChanges)
      expect(await entryRegion.state()).toEqual(entryState)
      await expect(entry).toHaveAccessibleDescription(ENTRY_TRAILING)
    })

    await test.step('a corrected field empties its region, and the same region is still on the page', async () => {
      expect(await hostRegion.state()).toEqual(EMPTY_REGION)
      expect(await hostRegion.changes()).toBeGreaterThan(hostChanges)
      await entry.fill(LISTED)
      await expectNoFieldMessage(entry)
      expect(await entryRegion.state()).toEqual(EMPTY_REGION)
      expect(await entryRegion.changes()).toBeGreaterThan(entryChanges)
      await expectClean(page)
      expect(await savedProxy()).toEqual(LOGIN_PROXY)
    })
  })

  test('11. keyboard only: Escape and Cancel on "Edit Protected Value?" put focus back on the masked Password, "Delete & Edit" puts it in the empty Password input', async ({
    page,
  }) => {
    await seedLoginProxy()
    await openSetup(page)
    const masked = maskedPassword(page)
    await expect(masked).toHaveCount(1)

    await test.step('Tab reaches the masked Password, Enter asks, Escape returns focus to it', async () => {
      await tabTo(page, masked, 80)
      await page.keyboard.press('Enter')
      await expectAsked(page)
      await page.keyboard.press('Escape')
      await expect(confirm(page)).toHaveCount(0)
      await expect(masked).toBeFocused()
      await expectClean(page)
    })

    await test.step('Cancel returns focus to it as well', async () => {
      await page.keyboard.press('Enter')
      await expectAsked(page)
      await tabTo(page, confirmButton(page, CONFIRM_CANCEL), 6)
      await page.keyboard.press('Enter')
      await expect(confirm(page)).toHaveCount(0)
      await expect(masked).toBeFocused()
      await expectClean(page)
    })

    await test.step('"Delete & Edit" puts focus in the empty Password input and typed keys land in it', async () => {
      await page.keyboard.press('Enter')
      await expectAsked(page)
      await tabTo(page, confirmButton(page, CONFIRM_DELETE), 6)
      await page.keyboard.press('Enter')
      await expect(confirm(page)).toHaveCount(0)
      await expect(masked).toHaveCount(0)
      await expect(passwordInput(page)).toHaveValue('')
      await expect(passwordInput(page)).toBeFocused()
      await page.keyboard.type(TYPED_SECRET)
      await expect(passwordInput(page)).toHaveValue(TYPED_SECRET)
      await expect(usernameInput(page)).toHaveValue(PROXY_AUTH_USER)
    })

    await test.step('the answer alone stored nothing: Cancel on the page brings the masked field back', async () => {
      expect(await savedProxy()).toEqual(LOGIN_PROXY)
      await cancelButton(page).click()
      await expect(maskedPassword(page)).toHaveCount(1)
      await expect(passwordInput(page)).toHaveCount(0)
      await expectClean(page)
    })
  })

  test('12. mouse, with focus left in Username: Cancel puts focus on the masked Password, "Delete & Edit" puts it in Password and typed keys land there', async ({
    page,
  }) => {
    await seedLoginProxy()
    await openSetup(page)
    const masked = maskedPassword(page)
    const username = usernameInput(page)
    await expect(masked).toHaveCount(1)

    await test.step('Cancel puts focus on the masked Password, not back in Username', async () => {
      await username.click()
      await expect(username).toBeFocused()
      // A dispatched click moves no focus by itself, as a click on a button does in WebKit.
      await masked.dispatchEvent('click')
      await expectAsked(page)
      await confirmButton(page, CONFIRM_CANCEL).click()
      await expect(confirm(page)).toHaveCount(0)
      await expect(masked).toBeFocused()
      await expectClean(page)
    })

    await test.step('"Delete & Edit" puts focus in Password, and typed keys land there and not in Username', async () => {
      await username.click()
      await expect(username).toBeFocused()
      await masked.dispatchEvent('click')
      await expectAsked(page)
      await confirmButton(page, CONFIRM_DELETE).click()
      await expect(confirm(page)).toHaveCount(0)
      await expect(masked).toHaveCount(0)
      await expect(passwordInput(page)).toBeFocused()
      await page.keyboard.type(TYPED_SECRET)
      await expect(passwordInput(page)).toHaveValue(TYPED_SECRET)
      await expect(username).toHaveValue(PROXY_AUTH_USER)
    })

    await test.step('the answer alone stored nothing', async () => {
      expect(await savedProxy()).toEqual(LOGIN_PROXY)
    })
  })
})
