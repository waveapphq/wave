/**
 * V-NET-01: Settings > Network > SSH Hosts and the Add Hosts dialog
 *
 * Phase: no-data (parallel). Staged edits only, never saved: the GET of the trusted hosts
 * list is intercepted to draw 27 hosts (the stack's seeded entries plus synthetic rows), or
 * none for the empty table; a PATCH is refused by the spec; Detect and parse stay real and
 * write nothing.
 * Design Decisions: SETTINGS-2, NET-1, NET-2, NET-3, NET-4, NET-7, NET-10, NET-11
 * REQ: REQ-4.5.14, REQ-4.5.15
 *
 * Pass Criteria:
 * 1. Settings nav: a collapsible "Network" group (network icon, chevron) sits between Variables
 *    and MCP Server; expanding it shows SSH Hosts, Certificates and Proxy indented behind a left
 *    rule. Proxy is a group of its own (chevron, no icon): a click opens no page and shows Setup
 *    and Blocks, indented once more behind their own left rule; a second click hides them.
 *    SSH Hosts lands on /settings/network/ssh-hosts and is marked active (blue).
 * 2. Header "Host Key Policy" with Cancel and Save (save icon), both disabled and faded while
 *    clean. The Host Key Policy group shows the exact NET-2 labels (14px, normal weight) and help
 *    lines (12px, muted); the switch and the 208px select are centered against label + help
 *    (NET-11, centers within 2px); the select shows the stored default, Disabled.
 * 3. Lock: with Accept New chosen, switching "Lock trusted hosts" on turns the select to Strict;
 *    the open list reads Strict (selected), Accept New (disabled, faded), Disabled; Save and Cancel
 *    enable; switching Lock off keeps Strict (NET-2); Cancel restores the saved state (switch off,
 *    Disabled) and disables both buttons again.
 * 4. "Trusted SSH Hosts" table: columns Host (sorted ascending), Port, Key type, Fingerprint
 *    (monospace, ellipsis), Added and a trash column; search on the left, Mass Action and
 *    "Add hosts" on the right; 27 hosts read "Showing 1-10 of 27 hosts" and page through 3 pages.
 *    At the frames' 1440x900 scale and at a 1280x800 window every column shows without scrolling
 *    sideways and each header stays on one line. The stack's seeded host shows its real ED25519
 *    fingerprint.
 * 5. Selection mode: Mass Action shows row checkboxes; 3 checked rows read "3 selected"; the menu
 *    holds one red Delete item; Delete stages the removal at once (rows gone, 24 hosts, Save
 *    enabled) with no confirmation dialog; Cancel brings the 3 rows back.
 * 6. Search: part of a host name keeps only the matching rows; clearing it restores all 27.
 * 7. Add Hosts dialog (NET-4): 672px, title "Add Hosts", no description, no corner X; "Detect from
 *    host" pressed on open; Host, Port (22, 96px) and Detect share one centerline; footer Cancel
 *    then Add (40px, save icon). Detect against the sshd service lists one ED25519 row with the
 *    full SHA256 fingerprint (never cut), "Already trusted" muted after it, its checkbox disabled
 *    (opacity 0.5, not-allowed cursor) and Add disabled.
 * 8. Paste lines: the four-line fixture shows in a line-numbered editor (numbers 1-4, normal text
 *    color); the result table lists the three good lines checked, the two-name line as Host
 *    "jump-02, 10.20.4.40", every host name shown whole and the Key type header on one line (frame),
 *    fingerprints in full text but cut with an ellipsis on one line;
 *    "Line 3: not a known_hosts line" shows under the table in the error text color and no row
 *    holds line 3; Add is enabled. Add closes the dialog and the page lists one row per name
 *    (31 hosts) with "Unsaved" in Added and Save enabled; Cancel drops them again.
 * 9. In the other theme (flipped from the sidebar), the key layout holds: NET-11 centering, faded
 *    header buttons, toolbar sides, columns fit, the 27-host footer, the dialog's one-line Detect row and the
 *    bad-line message in that theme's error text color.
 * 10. With no trusted host the table reads "No trusted SSH hosts" over an "Add hosts" button that
 *    has the computed size, border and text style of the toolbar's "Add hosts" (the shared
 *    outlined button: 36px tall, 14px text, 1px border) and of "Add certificate" on the empty
 *    Additional Certificates table, in both themes; it opens the Add Hosts dialog.
 */

import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { apiPathMatcher } from '../../helpers/api-route'
import { BACKEND_URL, SSH_MAIN_PORT, SSH_TARGET_HOST } from '../../helpers/config'
import { SSH_HOST_KEY } from '../../helpers/network-settings'
import { toggleTheme } from '../../helpers/theme'

type KeyType = 'ED25519' | 'ECDSA' | 'RSA'

interface TrustedHostRow {
  id: string
  host: string
  port: number
  key_type: KeyType
  fingerprint: string
  added: string
}

interface SshHostsView {
  policy: { lock_trusted_hosts: boolean; default_block_action: string }
  hosts: TrustedHostRow[]
}

interface HostsRead {
  real: TrustedHostRow[]
  shown: TrustedHostRow[]
  saves: number
  /** Draws no host at all, for the empty table. */
  empty: boolean
}

const TOTAL_HOSTS = 27
const CENTER_TOLERANCE_PX = 2

const LOCK_LABEL = 'Lock trusted hosts'
const LOCK_HELP = 'No block can add hosts. New and existing SSH blocks using "Accept New" act as "Strict".'
const ACTION_LABEL = 'Default block action'
const ACTION_HELP =
  'New blocks are configured in this mode by default. Existing blocks keep their current setting.'

const PASTE_TEXT = fs
  .readFileSync(path.resolve(__dirname, '../../fixtures/settings/v-network-ssh-hosts-01/paste-lines.txt'), 'utf-8')
  .trimEnd()
const PASTE_LINES = PASTE_TEXT.split('\n')
const BAD_LINE_MESSAGE = 'Line 3: not a known_hosts line'

/** OpenSSH SHA256 fingerprint of "<algorithm> <base64>" key text. */
function fingerprintOf(key: string): string {
  const blob = Buffer.from(key.trim().split(/\s+/)[1], 'base64')
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`
}

function keyOfLine(line: string): string {
  return line.split(' ').slice(1).join(' ')
}

const PASTED_ROWS = [
  { host: 'jump-02, 10.20.4.40', keyType: 'ED25519', fingerprint: fingerprintOf(keyOfLine(PASTE_LINES[0])) },
  { host: 'etl-02.corp.example', keyType: 'ECDSA', fingerprint: fingerprintOf(keyOfLine(PASTE_LINES[1])) },
  { host: 'files.corp.example', keyType: 'RSA', fingerprint: fingerprintOf(keyOfLine(PASTE_LINES[3])) },
]
const PASTED_ENTRIES: ReadonlyArray<{ host: string; keyType: string }> = [
  { host: 'jump-02', keyType: 'ED25519' },
  { host: '10.20.4.40', keyType: 'ED25519' },
  { host: 'etl-02.corp.example', keyType: 'ECDSA' },
  { host: 'files.corp.example', keyType: 'RSA' },
]

const SYNTHETIC_HOSTS: ReadonlyArray<[string, number, KeyType, string]> = [
  ['10.20.4.15', 22, 'RSA', '2026-06-03'],
  ['10.20.4.16', 22, 'ED25519', '2026-06-03'],
  ['artifacts.corp.example', 22, 'ED25519', '2026-03-18'],
  ['bastion.corp.example', 22, 'ED25519', '2026-02-11'],
  ['build-01.lab.example', 22, 'ED25519', '2026-09-22'],
  ['build-02.lab.example', 22, 'ED25519', '2026-09-22'],
  ['db-jump.corp.example', 2222, 'ECDSA', '2026-04-27'],
  ['db-primary.corp.example', 22, 'ECDSA', '2026-05-09'],
  ['etl-runner.corp.example', 22, 'RSA', '2026-07-14'],
  ['gitlab.corp.example', 2222, 'ED25519', '2026-01-30'],
  ['jenkins.corp.example', 22, 'RSA', '2026-02-02'],
  ['k8s-master-01.lab.example', 22, 'ECDSA', '2026-08-12'],
  ['k8s-master-02.lab.example', 22, 'ECDSA', '2026-08-12'],
  ['logs.corp.example', 22, 'ED25519', '2026-05-21'],
  ['metrics.corp.example', 22, 'ED25519', '2026-05-21'],
  ['nfs-01.lab.example', 22, 'RSA', '2026-03-03'],
  ['proxy.corp.example', 3022, 'ED25519', '2026-06-30'],
  ['registry.corp.example', 22, 'ED25519', '2026-04-04'],
  ['repo.corp.example', 22, 'ECDSA', '2026-07-01'],
  ['s3-gw.corp.example', 22, 'ED25519', '2026-09-09'],
  ['vault.corp.example', 22, 'ED25519', '2026-01-15'],
  ['web-01.corp.example', 22, 'RSA', '2026-09-30'],
  ['web-02.corp.example', 22, 'RSA', '2026-09-30'],
  ['zookeeper-01.lab.example', 22, 'ECDSA', '2026-02-27'],
]

const SELECTED_HOSTS = ['10.20.4.15', 'artifacts.corp.example', 'bastion.corp.example']

function syntheticHosts(count: number): TrustedHostRow[] {
  return SYNTHETIC_HOSTS.slice(0, count).map(([host, port, keyType, day]) => ({
    id: createHash('sha256').update(`v-net-01:${host}:${port}`).digest('hex').slice(0, 32),
    host,
    port,
    key_type: keyType,
    fingerprint: `SHA256:${createHash('sha256').update(`v-net-01-key:${host}`).digest('base64').replace(/=+$/, '')}`,
    added: `${day}T09:30:00+00:00`,
  }))
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** Host, then port, then key type, in plain character order like the page. */
function byHostPortKeyType(a: TrustedHostRow, b: TrustedHostRow): number {
  return compareText(a.host, b.host) || a.port - b.port || compareText(a.key_type, b.key_type)
}

/** The real list plus synthetic rows up to 27, or no row; a save never reaches the backend. */
async function drawTrustedHosts(page: Page): Promise<HostsRead> {
  const read: HostsRead = { real: [], shown: [], saves: 0, empty: false }
  await page.route(apiPathMatcher('/network/ssh-hosts'), async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      read.saves += 1
      await route.abort()
      return
    }
    if (method !== 'GET') {
      await route.fallback()
      return
    }
    const response = await route.fetch()
    const view = (await response.json()) as SshHostsView
    read.real = view.hosts
    read.shown = read.empty ? [] : [...view.hosts, ...syntheticHosts(TOTAL_HOSTS - view.hosts.length)]
    await route.fulfill({ response, json: { ...view, hosts: read.shown } })
  })
  return read
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

function sshHostsTab(page: Page): Locator {
  return page.getByTestId('network-ssh-hosts-tab')
}

function hostsTable(page: Page): Locator {
  return sshHostsTab(page).getByTestId('trusted-hosts-table')
}

function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return sshHostsTab(page).getByRole('button', { name, exact: true })
}

function hostRow(page: Page, host: string): Locator {
  return hostsTable(page)
    .getByTestId('host-row')
    .filter({ has: page.getByText(host, { exact: true }) })
}

function itemCount(page: Page): Locator {
  return hostsTable(page).getByTestId('pagination-item-count')
}

async function openSshHosts(page: Page): Promise<void> {
  await page.goto('/settings/network/ssh-hosts')
  await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
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

/** NET-11: the control's center sits on the center of label + help. */
async function expectRowCentered(page: Page, label: string, help: string, control: Locator): Promise<void> {
  const tab = sshHostsTab(page)
  const labelBox = await boxOf(tab.getByText(label, { exact: true }))
  const helpBox = await boxOf(tab.getByText(help, { exact: true }))
  const textCenter = (labelBox.y + helpBox.y + helpBox.height) / 2
  const offset = Math.abs((await centerY(control)) - textCenter)
  expect(offset, `"${label}" control is centered against label + help (NET-11)`).toBeLessThanOrEqual(
    CENTER_TOLERANCE_PX,
  )
}

async function expectPolicyRowsCentered(page: Page): Promise<void> {
  const tab = sshHostsTab(page)
  await expectRowCentered(page, LOCK_LABEL, LOCK_HELP, tab.getByRole('switch', { name: LOCK_LABEL }))
  await expectRowCentered(page, ACTION_LABEL, ACTION_HELP, tab.getByRole('combobox', { name: ACTION_LABEL }))
}

/** Every column shows without scrolling sideways and headers stay on one line. */
async function expectColumnsFit(page: Page): Promise<void> {
  const grid = hostsTable(page).locator('table')
  const fits = await grid.evaluate((element) => {
    let node = element.parentElement
    while (node && !['auto', 'scroll'].includes(getComputedStyle(node).overflowX)) node = node.parentElement
    return node ? node.scrollWidth <= node.clientWidth + 1 : true
  })
  expect.soft(fits, 'every Trusted SSH Hosts column shows without scrolling sideways').toBe(true)
  const headers = grid.locator('thead th')
  for (let index = 0; index < 5; index += 1) {
    expect.soft(await textLineCount(headers.nth(index)), `header ${index + 1} stays on one line`).toBe(1)
  }
}

async function expectToolbarSides(page: Page): Promise<void> {
  const table = hostsTable(page)
  const tableBox = await boxOf(table)
  const searchBox = await boxOf(table.getByPlaceholder('Search hosts…'))
  const massBox = await boxOf(table.getByRole('button', { name: /^Mass Action/ }))
  const addBox = await boxOf(table.getByRole('button', { name: 'Add hosts', exact: true }))
  expect(Math.abs(searchBox.x - tableBox.x), 'search sits at the left edge').toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  expect(
    Math.abs(addBox.x + addBox.width - (tableBox.x + tableBox.width)),
    'Add hosts sits at the right edge',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  expect(massBox.x + massBox.width, 'Mass Action sits left of Add hosts').toBeLessThanOrEqual(addBox.x)
  expect(massBox.x, 'Mass Action is on the right side').toBeGreaterThan(searchBox.x + searchBox.width)
}

async function openAddHosts(page: Page): Promise<Locator> {
  await hostsTable(page).getByRole('button', { name: 'Add hosts', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Hosts' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function expectDetectRowOnOneLine(dialog: Locator): Promise<void> {
  const host = dialog.getByLabel('Host', { exact: true })
  const port = dialog.getByLabel('Port', { exact: true })
  const detect = dialog.getByRole('button', { name: 'Detect', exact: true })
  const hostCenter = await centerY(host)
  expect(Math.abs((await centerY(port)) - hostCenter), 'Port shares the Host centerline').toBeLessThanOrEqual(
    CENTER_TOLERANCE_PX,
  )
  expect(Math.abs((await centerY(detect)) - hostCenter), 'Detect shares the Host centerline').toBeLessThanOrEqual(
    CENTER_TOLERANCE_PX,
  )
  const hostBox = await boxOf(host)
  const portBox = await boxOf(port)
  const detectBox = await boxOf(detect)
  expect(hostBox.x + hostBox.width, 'Port follows Host').toBeLessThanOrEqual(portBox.x)
  expect(portBox.x + portBox.width, 'Detect follows Port').toBeLessThanOrEqual(detectBox.x)
}

/** How many rendered lines the element's text takes. */
async function textLineCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top))
    }
    return tops.size
  })
}

/** The dialog's failure lines (a Detect failure or a pasted bad line). */
function errorLines(dialog: Locator): Locator {
  return dialog.locator('[aria-live="polite"] p')
}

/** Pastes the text into the dialog's editor the way a clipboard paste arrives. */
async function pasteLines(dialog: Locator, text: string): Promise<void> {
  const editor = dialog.getByRole('textbox', { name: 'Host key lines' })
  await editor.click()
  await editor.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
  await expect
    .poll(async () => dialog.locator('.cm-content .cm-line').allTextContents(), {
      message: 'the editor holds every pasted line',
    })
    .toEqual(text.split('\n'))
}

async function visibleLineNumbers(dialog: Locator): Promise<string[]> {
  return dialog.locator('.cm-lineNumbers .cm-gutterElement').evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).visibility !== 'hidden' && element.getBoundingClientRect().height > 0)
      .map((element) => element.textContent ?? ''),
  )
}

/** NET-3, NET-7: what an outlined add button computes to, apart from its label's width. */
async function addButtonStyle(button: Locator): Promise<Record<string, string>> {
  await expect(button).toBeVisible()
  return button.evaluate((element) => {
    const style = getComputedStyle(element)
    const names = [
      'height',
      'padding-left',
      'padding-right',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'border-top-style',
      'border-top-color',
      'border-right-color',
      'border-bottom-color',
      'border-left-color',
      'border-top-left-radius',
      'background-color',
      'box-shadow',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'white-space',
    ]
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]))
  })
}

/** The empty table's "Add hosts" against the toolbar's; returns the style both share. */
async function expectEmptyTableAddButton(page: Page): Promise<Record<string, string>> {
  const table = hostsTable(page)
  await expect(itemCount(page)).toHaveText('Showing 0-0 of 0 hosts')
  await expect(table.getByTestId('host-row')).toHaveCount(0)
  await expect(table.getByRole('button', { name: 'Add hosts', exact: true })).toHaveCount(2)
  const toolbarAdd = table.getByRole('button', { name: 'Add hosts', exact: true }).first()
  const emptyAdd = table.locator('tbody').getByRole('button', { name: 'Add hosts', exact: true })
  const message = table.locator('tbody').getByText('No trusted SSH hosts', { exact: true })

  const shared = await addButtonStyle(toolbarAdd)
  expect(await addButtonStyle(emptyAdd), 'the empty table button computes like the toolbar button').toEqual(shared)
  expect(shared).toMatchObject({
    height: '36px',
    'padding-left': '12px',
    'padding-right': '12px',
    'border-top-width': '1px',
    'border-right-width': '1px',
    'border-bottom-width': '1px',
    'border-left-width': '1px',
    'border-top-style': 'solid',
    'font-size': '14px',
  })
  const toolbarBox = await boxOf(toolbarAdd)
  const emptyBox = await boxOf(emptyAdd)
  const messageBox = await boxOf(message)
  expect(Math.abs(emptyBox.width - toolbarBox.width), 'both buttons are equally wide').toBeLessThanOrEqual(0.5)
  expect(emptyBox.y, 'the button sits under the empty message').toBeGreaterThanOrEqual(
    messageBox.y + messageBox.height,
  )
  expect(
    Math.abs(emptyBox.x + emptyBox.width / 2 - (messageBox.x + messageBox.width / 2)),
    'the button is centered under the empty message',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  return shared
}

/** "Add certificate" of the empty Additional Certificates table computes to `shared`. */
async function expectAddCertificateMatches(page: Page, shared: Record<string, string>): Promise<void> {
  const table = page.getByTestId('additional-certificates-table')
  const emptyAdd = table.locator('tbody').getByRole('button', { name: 'Add certificate', exact: true })
  await expect(table.locator('tbody').getByText('No additional certificates', { exact: true })).toBeVisible()
  expect(await addButtonStyle(emptyAdd), '"Add certificate" computes like "Add hosts"').toEqual(shared)
}

async function expectBadLineUnderTable(page: Page, dialog: Locator): Promise<void> {
  const message = dialog.getByText(BAD_LINE_MESSAGE, { exact: true })
  await expect(message).toBeVisible()
  await expect(message).toHaveCSS('color', await tokenColor(page, '--color-error-text'))
  const tableBox = await boxOf(dialog.getByRole('table'))
  expect((await boxOf(message)).y, 'the bad line shows under the table').toBeGreaterThanOrEqual(
    tableBox.y + tableBox.height,
  )
}

let hostsRead: HostsRead

test.describe('V-NET-01: Settings > Network > SSH Hosts', () => {
  // The frames are drawn at this scale.
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page }) => {
    hostsRead = await drawTrustedHosts(page)
  })

  test.afterEach(() => {
    expect(hostsRead.saves, 'a visual spec never saves the trusted hosts list').toBe(0)
  })

  test('nav group, Host Key Policy rows and the Lock rule', async ({ page, request }) => {
    const stored = await request.get(`${BACKEND_URL}/network/ssh-hosts/policy`)
    expect(stored.ok()).toBe(true)
    expect(await stored.json(), 'the stack starts from the default policy').toEqual({
      lock_trusted_hosts: false,
      default_block_action: 'disabled',
    })

    await page.goto('/settings')
    await expect(page.getByTestId('general-tab')).toBeVisible()
    const nav = page.getByTestId('settings-sections')

    await test.step('1. Network sits between Variables and MCP Server and opens SSH Hosts', async () => {
      await expect(nav.locator(':scope > *')).toHaveText([
        'General',
        'Environments',
        'Variables',
        'Network',
        'MCP Server',
        'WAVE Server',
        'Backup',
        'About',
      ])
      const network = nav.getByRole('button', { name: 'Network', exact: true })
      await expect(network.locator('svg'), 'network icon and chevron').toHaveCount(2)
      await expect(network).toHaveAttribute('aria-expanded', 'false')
      await network.click()
      await expect(network).toHaveAttribute('aria-expanded', 'true')

      const pages = nav.getByRole('group', { name: 'Network', exact: true })
      await expect(pages.getByRole('button')).toHaveText(['SSH Hosts', 'Certificates', 'Proxy'])
      await expect(pages, 'children hang off a left rule').toHaveCSS('border-left-width', '1px')
      const sshHosts = pages.getByRole('button', { name: 'SSH Hosts', exact: true })
      expect((await boxOf(sshHosts)).x, 'children are indented').toBeGreaterThan((await boxOf(network)).x)

      const proxy = pages.getByRole('button', { name: 'Proxy', exact: true })
      await expect(proxy.locator('svg'), 'Proxy carries a chevron and no icon').toHaveCount(1)
      await expect(proxy).toHaveAttribute('aria-expanded', 'false')
      expect(Math.abs((await boxOf(proxy)).x - (await boxOf(sshHosts)).x), 'Proxy lines up with the pages').toBeLessThanOrEqual(1)
      await proxy.click()
      await expect(proxy).toHaveAttribute('aria-expanded', 'true')
      await expect(page, 'opening the Proxy group opens no page').toHaveURL(/\/settings$/)
      const proxyPages = pages.getByRole('group', { name: 'Proxy', exact: true })
      await expect(proxyPages.getByRole('button')).toHaveText(['Setup', 'Blocks'])
      await expect(proxyPages, 'the Proxy pages hang off their own left rule').toHaveCSS('border-left-width', '1px')
      expect(
        (await boxOf(proxyPages.getByRole('button', { name: 'Setup', exact: true }))).x,
        'the Proxy pages are indented once more',
      ).toBeGreaterThan((await boxOf(proxy)).x)
      await expect(pages.getByRole('button')).toHaveText(['SSH Hosts', 'Certificates', 'Proxy', 'Setup', 'Blocks'])
      await expect(nav.locator('[aria-current="page"]'), 'General stays the active page').toHaveText(['General'])
      await proxy.click()
      await expect(proxy).toHaveAttribute('aria-expanded', 'false')
      await expect(pages.getByRole('button')).toHaveText(['SSH Hosts', 'Certificates', 'Proxy'])

      await sshHosts.click()
      await expect(page).toHaveURL(/\/settings\/network\/ssh-hosts$/)
      await expect(sshHosts).toHaveAttribute('aria-current', 'page')
      await expect(sshHosts).toHaveCSS('background-color', 'rgb(37, 99, 235)')
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
    })

    const tab = sshHostsTab(page)
    const lock = tab.getByRole('switch', { name: LOCK_LABEL })
    const action = tab.getByRole('combobox', { name: ACTION_LABEL })

    await test.step('2. Header buttons, NET-2 copy, NET-11 centering, stored default', async () => {
      await expect(tab.getByRole('heading', { level: 2 })).toHaveText(['Host Key Policy', 'Trusted SSH Hosts'])
      await expectClean(page)
      await expect(headerButton(page, 'Save').locator('svg'), 'Save carries the save icon').toHaveCount(1)

      for (const label of [LOCK_LABEL, ACTION_LABEL]) {
        const text = tab.getByText(label, { exact: true })
        await expect(text).toHaveCSS('font-size', '14px')
        await expect(text).toHaveCSS('font-weight', '400')
      }
      const muted = await tokenColor(page, '--muted-foreground')
      for (const help of [LOCK_HELP, ACTION_HELP]) {
        const text = tab.getByText(help, { exact: true })
        await expect(text).toHaveCSS('font-size', '12px')
        await expect(text).toHaveCSS('color', muted)
      }
      await expectPolicyRowsCentered(page)

      await expect(lock).toHaveAttribute('aria-checked', 'false')
      await expect(action).toHaveText('Disabled')
      await expect(action).toHaveCSS('width', '208px')
    })

    await test.step('3. Lock turns Accept New into Strict and disables it; Cancel restores', async () => {
      const list = page.getByRole('listbox')
      await action.click()
      await list.getByRole('option', { name: 'Accept New' }).click()
      await expect(action).toHaveText('Accept New')
      await expectDirty(page)

      await lock.click()
      await expect(lock).toHaveAttribute('aria-checked', 'true')
      await expect(action).toHaveText('Strict')
      await expectDirty(page)

      await action.click()
      await expect(list.getByRole('option')).toHaveText(['Strict', 'Accept New', 'Disabled'])
      await expect(list.getByRole('option', { name: 'Strict' })).toHaveAttribute('data-state', 'checked')
      const acceptNew = list.getByRole('option', { name: 'Accept New' })
      await expect(acceptNew).toHaveAttribute('data-disabled', '')
      await expect(acceptNew).toHaveCSS('opacity', '0.5')
      await expect(list.getByRole('option', { name: 'Disabled' })).not.toHaveAttribute('data-disabled', '')
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()

      await lock.click()
      await expect(lock).toHaveAttribute('aria-checked', 'false')
      await expect(action, 'Lock off keeps the selected value (NET-2)').toHaveText('Strict')

      await headerButton(page, 'Cancel').click()
      await expect(lock).toHaveAttribute('aria-checked', 'false')
      await expect(action).toHaveText('Disabled')
      await expectClean(page)
    })
  })

  test('trusted hosts table: columns, paging, selection mode and search', async ({ page }) => {
    await openSshHosts(page)
    const table = hostsTable(page)
    const rows = table.getByTestId('host-row')

    await test.step('4. Columns, sort, toolbar, the seeded host and paging', async () => {
      await expect(table.locator('thead th')).toHaveText(['Host', 'Port', 'Key type', 'Fingerprint', 'Added', 'Actions'])
      await expectColumnsFit(page)
      await page.setViewportSize({ width: 1280, height: 800 })
      await expectColumnsFit(page)
      await page.setViewportSize({ width: 1440, height: 900 })
      const hostHeader = table.locator('thead th').first()
      await expect(hostHeader).toHaveAttribute('aria-sort', 'ascending')
      await expect(hostHeader.locator('svg'), 'sort chevron').toHaveCount(1)
      await expect(table.getByPlaceholder('Search hosts…')).toBeVisible()
      await expectToolbarSides(page)

      const firstPage = [...hostsRead.shown].sort(byHostPortKeyType).slice(0, 10)
      await expect(rows.locator('td:nth-child(1)')).toHaveText(firstPage.map((host) => host.host))
      await expect(rows.locator('td:nth-child(2)')).toHaveText(firstPage.map((host) => String(host.port)))
      await expect(rows.locator('td:nth-child(3)')).toHaveText(firstPage.map((host) => host.key_type))
      await expect(rows.getByRole('button', { name: /^Remove / }), 'a trash icon per row').toHaveCount(10)

      const fingerprint = rows.first().locator('td:nth-child(4) span')
      await expect(fingerprint).toHaveCSS('font-family', /monospace/)
      await expect(fingerprint).toHaveCSS('text-overflow', 'ellipsis')
      await expect(fingerprint).toHaveCSS('white-space', 'nowrap')
      await expect(hostRow(page, '10.20.4.15').locator('td:nth-child(5)'), 'Added shows the saved date').toContainText(
        '2026',
      )

      const seeded = hostsRead.real.find(
        (host) => host.host === SSH_TARGET_HOST && host.port === Number(SSH_MAIN_PORT) && host.key_type === 'ED25519',
      )
      expect(seeded, `the stack seeds ${SSH_TARGET_HOST}:${SSH_MAIN_PORT}`).toBeDefined()
      expect(seeded?.fingerprint).toBe(fingerprintOf(SSH_HOST_KEY))
      await expect(
        rows.locator('td:nth-child(4)').filter({ hasText: fingerprintOf(SSH_HOST_KEY) }),
        'the seeded host shows its real fingerprint',
      ).not.toHaveCount(0)

      const pagination = table.getByTestId('pagination-navigation')
      await expect(pagination).toContainText('Page 1 of 3')
      await pagination.getByRole('button', { name: 'Next page' }).click()
      await expect(itemCount(page)).toHaveText(`Showing 11-20 of ${TOTAL_HOSTS} hosts`)
      await expect(pagination).toContainText('Page 2 of 3')
      await pagination.getByRole('button', { name: 'Last page' }).click()
      await expect(itemCount(page)).toHaveText(`Showing 21-27 of ${TOTAL_HOSTS} hosts`)
      await expect(rows).toHaveCount(7)
      await pagination.getByRole('button', { name: 'First page' }).click()
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
    })

    await test.step('5. Mass Action Delete stages the removal; Cancel brings the rows back', async () => {
      await table.getByRole('button', { name: /^Mass Action/ }).click()
      await expect(table.getByTestId('select-all-checkbox')).toBeVisible()
      await expect(table.getByTestId('row-checkbox')).toHaveCount(10)
      for (const host of SELECTED_HOSTS) {
        await table.getByRole('checkbox', { name: `Select ${host}`, exact: true }).click()
      }
      const counter = table.getByTestId('selection-counter')
      await expect(counter).toHaveText('3 selected')

      await counter.click()
      const menu = page.getByTestId('bulk-actions-menu')
      await expect(menu.getByRole('menuitem')).toHaveText(['Delete'])
      const deleteItem = menu.getByRole('menuitem', { name: 'Delete' })
      await expect(deleteItem).toHaveCSS('color', await tokenColor(page, '--color-error-text'))
      await deleteItem.click()

      await expect(page.getByRole('alertdialog'), 'a staged removal asks for nothing').toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS - 3} hosts`)
      for (const host of SELECTED_HOSTS) {
        await expect(hostRow(page, host), `${host} is gone`).toHaveCount(0)
      }
      await expectDirty(page)
      await expect(table.getByRole('button', { name: /^Mass Action/ }), 'selection mode ends').toBeVisible()

      await headerButton(page, 'Cancel').click()
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
      for (const host of SELECTED_HOSTS) {
        await expect(hostRow(page, host), `${host} is back`).toHaveCount(1)
      }
      await expectClean(page)
    })

    await test.step('6. Search keeps only the matching rows', async () => {
      const search = table.getByPlaceholder('Search hosts…')
      await search.fill('build-0')
      await expect(rows.locator('td:nth-child(1)')).toHaveText(['build-01.lab.example', 'build-02.lab.example'])
      await expect(itemCount(page)).toHaveText('Showing 1-2 of 2 hosts')
      await search.fill('')
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
    })
  })

  test('Add Hosts: dialog shell and Detect from host', async ({ page }) => {
    await openSshHosts(page)
    const dialog = await openAddHosts(page)
    const add = dialog.getByTestId('edit-dialog-save')
    const keyRows = dialog.getByTestId('key-row')

    await test.step('7. Dialog shell and Detect against the sshd service', async () => {
      expect((await boxOf(dialog)).width, 'dialog is 672px wide').toBeCloseTo(672, 0)
      await expect(dialog.getByRole('heading', { name: 'Add Hosts', exact: true })).toBeVisible()
      await expect(dialog, 'no description').not.toHaveAttribute('aria-describedby', /.+/)
      await expect(dialog.getByRole('button', { name: 'Close' }), 'no corner X').toHaveCount(0)
      await expect(dialog.getByRole('button', { name: 'Detect from host' })).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByRole('button', { name: 'Paste lines' })).toHaveAttribute('aria-pressed', 'false')

      const port = dialog.getByLabel('Port', { exact: true })
      await expect(port).toHaveValue('22')
      await expect(port).toHaveCSS('width', '96px')
      await expectDetectRowOnOneLine(dialog)

      const cancel = dialog.getByTestId('edit-dialog-cancel')
      const cancelBox = await boxOf(cancel)
      expect(cancelBox.x + cancelBox.width, 'Cancel comes before Add').toBeLessThanOrEqual((await boxOf(add)).x)
      await expect(cancel).toHaveCSS('height', '40px')
      await expect(add).toHaveCSS('height', '40px')
      await expect(add).toHaveText('Add')
      await expect(add.locator('svg'), 'save icon before "Add"').toHaveCount(1)
      await expect(add).toBeDisabled()

      await dialog.getByLabel('Host', { exact: true }).fill(SSH_TARGET_HOST)
      await port.fill(SSH_MAIN_PORT)
      await dialog.getByRole('button', { name: 'Detect', exact: true }).click()

      await expect(keyRows.or(errorLines(dialog))).not.toHaveCount(0, { timeout: 15_000 })
      await expect(errorLines(dialog), 'Detect against the sshd service reports no failure').toHaveText([])
      await expect(keyRows).toHaveCount(1)
      const row = keyRows.first()
      await expect(row.locator('td').nth(1)).toHaveText('ED25519')
      const fingerprint = row.getByText(fingerprintOf(SSH_HOST_KEY), { exact: true })
      await expect(fingerprint).toBeVisible()
      await expect(fingerprint).toHaveCSS('font-family', /monospace/)
      expect(
        await fingerprint.evaluate((element) => element.scrollWidth <= element.clientWidth),
        'the full fingerprint is never cut',
      ).toBe(true)
      const dialogBox = await boxOf(dialog)
      const printBox = await boxOf(fingerprint)
      expect(printBox.x + printBox.width, 'the fingerprint fits in the dialog').toBeLessThanOrEqual(
        dialogBox.x + dialogBox.width,
      )

      const marker = row.getByText('Already trusted', { exact: true })
      await expect(marker).toBeVisible()
      await expect(marker).toHaveCSS('color', await tokenColor(page, '--muted-foreground'))
      expect((await boxOf(marker)).x, 'the marker follows the fingerprint').toBeGreaterThanOrEqual(
        printBox.x + printBox.width,
      )

      const checkbox = row.getByTestId('row-checkbox')
      await expect(checkbox).toBeDisabled()
      await expect(checkbox).toHaveAttribute('aria-checked', 'false')
      await expect(checkbox).toHaveCSS('opacity', '0.5')
      await expect(checkbox).toHaveCSS('cursor', 'not-allowed')
      await expect(add, 'nothing to add').toBeDisabled()
    })
  })

  test('Add Hosts: Paste lines with a bad line, Add, then Cancel', async ({ page }) => {
    await openSshHosts(page)
    const dialog = await openAddHosts(page)
    const add = dialog.getByTestId('edit-dialog-save')
    const keyRows = dialog.getByTestId('key-row')

    await test.step('8. Paste lines: rows, the bad line, Add, Unsaved rows, Cancel', async () => {
      await dialog.getByRole('button', { name: 'Paste lines' }).click()
      await expect(dialog.getByRole('button', { name: 'Paste lines' })).toHaveAttribute('aria-pressed', 'true')
      await pasteLines(dialog, PASTE_TEXT)
      expect(await visibleLineNumbers(dialog), 'one number per logical line').toEqual(['1', '2', '3', '4'])
      await expect(dialog.locator('.cm-content'), 'the editor text is the normal text color').toHaveCSS(
        'color',
        await tokenColor(page, '--foreground'),
      )

      await expect(keyRows).toHaveCount(PASTED_ROWS.length)
      await expect(dialog.locator('thead th')).toHaveText(['', 'Host', 'Key type', 'Fingerprint'])
      expect
        .soft(await textLineCount(dialog.locator('thead th').nth(2)), 'the Key type header stays on one line')
        .toBe(1)
      for (const [index, expected] of PASTED_ROWS.entries()) {
        const row = keyRows.nth(index)
        await expect(row.getByTestId('row-checkbox'), `${expected.host} is checked`).toHaveAttribute(
          'aria-checked',
          'true',
        )
        const host = row.locator('td').nth(1).locator('span')
        await expect(host).toHaveText(expected.host)
        expect
          .soft(await host.evaluate((element) => element.scrollWidth <= element.clientWidth), `${expected.host} is shown whole`)
          .toBe(true)
        await expect(row.locator('td').nth(2)).toHaveText(expected.keyType)
        const fingerprint = row.locator('td').nth(3).locator('span').first()
        await expect(fingerprint).toHaveText(expected.fingerprint)
        await expect(fingerprint).toHaveCSS('text-overflow', 'ellipsis')
        await expect(fingerprint).toHaveCSS('white-space', 'nowrap')
      }
      await expect(keyRows.filter({ hasText: 'ci-02' }), 'the bad line is not a row').toHaveCount(0)
      await expectBadLineUnderTable(page, dialog)
      await expect(add).toBeEnabled()

      await add.click()
      await expect(dialog).toBeHidden()
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS + PASTED_ENTRIES.length} hosts`)
      await expectDirty(page)

      const search = hostsTable(page).getByPlaceholder('Search hosts…')
      for (const entry of PASTED_ENTRIES) {
        await search.fill(entry.host)
        const row = hostRow(page, entry.host)
        await expect(row, `one row for ${entry.host}`).toHaveCount(1)
        await expect(row.locator('td')).toHaveText([entry.host, '22', entry.keyType, /^SHA256:/, 'Unsaved', ''])
      }
      await search.fill('')

      await headerButton(page, 'Cancel').click()
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
      await expectClean(page)
    })
  })

  test('empty table: Add hosts looks like the toolbar button and like Add certificate', async ({ page, request }) => {
    hostsRead.empty = true
    const stored = await request.get(`${BACKEND_URL}/network/certificates`)
    expect(stored.ok()).toBe(true)
    expect(
      ((await stored.json()) as { additional: unknown[] }).additional,
      'the stack starts with no additional certificates',
    ).toEqual([])

    await test.step('10. No trusted host: the two Add hosts buttons and Add certificate compute alike', async () => {
      await page.goto('/settings/network/ssh-hosts')
      const shared = await expectEmptyTableAddButton(page)
      await page.goto('/settings/network/certificates')
      await expectAddCertificateMatches(page, shared)
    })

    const theme = await toggleTheme(page)

    await test.step(`10. ${theme}: the three buttons still compute alike`, async () => {
      const table = page.getByTestId('additional-certificates-table')
      const certificateStyle = await addButtonStyle(
        table.locator('tbody').getByRole('button', { name: 'Add certificate', exact: true }),
      )
      await page.goto('/settings/network/ssh-hosts')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await expectEmptyTableAddButton(page), '"Add hosts" computes like "Add certificate"').toEqual(
        certificateStyle,
      )
    })

    await test.step('10. The empty table button opens the Add Hosts dialog', async () => {
      await hostsTable(page).locator('tbody').getByRole('button', { name: 'Add hosts', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Add Hosts' })
      await expect(dialog.getByRole('button', { name: 'Detect from host' })).toHaveAttribute('aria-pressed', 'true')
      await dialog.getByTestId('edit-dialog-cancel').click()
      await expect(dialog).toBeHidden()
      await expectClean(page)
    })
  })

  test('the key layout holds in the other theme', async ({ page }) => {
    await openSshHosts(page)
    const theme = await toggleTheme(page)

    await test.step(`9. ${theme}: policy rows, header, toolbar and footer`, async () => {
      await expectPolicyRowsCentered(page)
      await expectClean(page)
      await expectToolbarSides(page)
      await expectColumnsFit(page)
      await expect(itemCount(page)).toHaveText(`Showing 1-10 of ${TOTAL_HOSTS} hosts`)
    })

    await test.step(`9. ${theme}: Add Hosts Detect row and the bad-line color`, async () => {
      const dialog = await openAddHosts(page)
      await expectDetectRowOnOneLine(dialog)
      await dialog.getByRole('button', { name: 'Paste lines' }).click()
      await pasteLines(dialog, PASTE_TEXT)
      await expect(dialog.getByTestId('key-row')).toHaveCount(PASTED_ROWS.length)
      await expectBadLineUnderTable(page, dialog)
      await dialog.getByTestId('edit-dialog-cancel').click()
      await expect(dialog).toBeHidden()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expectClean(page)
    })
  })
})
