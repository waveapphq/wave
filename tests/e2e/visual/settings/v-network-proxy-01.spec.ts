/**
 * V-NET-03: Settings > Network > Proxy > Setup and Blocks
 *
 * Phase: no-data (parallel). Staged states only, never saved: the GET of the proxy setting is
 * decorated by the spec for the host, custom and invalid-input frames, the check of a staged
 * change is answered by the spec from the change the page sent, and a PATCH is refused. The read
 * of the block lists stays real.
 * Design Decisions: SETTINGS-2, SETTINGS-18, NET-1, NET-10, NET-11
 * REQ: REQ-4.7.14, REQ-4.7.16
 *
 * Pass Criteria (every frame is checked in both themes, flipped from the sidebar):
 * 1. Frame network-proxy-off: "Proxy Setup" is the page's only heading; Cancel then Save (save
 *    icon) end its line, both disabled and faded; one line (14px, muted) sits under it; one
 *    bordered group holds one row, "Use a proxy", a label with no help line and a switch that is
 *    off and centered against the label (NET-11).
 * 2. Frame network-proxy-host: with the switch on, Source shows "WAVE host's settings" pressed
 *    (filled primary, white text) and one full-width row of three facts, HTTPS_PROXY, HTTP_PROXY
 *    and NO_PROXY, one per line: a 12px muted label, a lock and a monospace value, with labels,
 *    locks and values in aligned columns. A proxy address shows its password as `********` (the
 *    frame draws `****`). Cancel and Save are enabled, and the check was asked about the switch
 *    alone. On a WAVE host with no proxy variable the three values read "Not set".
 * 3. Frame network-proxy-custom, the whole Settings page: the menu shows Network open with SSH
 *    Hosts, Certificates and Proxy, Proxy open behind its own left rule with Setup (active, blue)
 *    and Blocks. The group holds eight rows split by hairlines, every control at one right edge
 *    and centered: Use a proxy (on), Source (Custom pressed), IP or Hostname (256px), Port
 *    (112px, right-aligned, monospace), Username (256px), Password (the 256 x 40 masked field:
 *    pencil, eight dots, lock; its help line; no input), Use the proxy for (the default pressed)
 *    with the address list inside the same row, and Use the proxy for local addresses too (off).
 *    Each list row is a two-part Exact / Regex control (the pressed part filled like Source), a
 *    monospace address and a trash button on one centerline; "Add" sits under the last row. The
 *    fourth row is added in the page, so Cancel and Save are enabled.
 * 4. Handles: the menu items, the page and its fields answer to their test ids and input names;
 *    Port keeps digits only, five at most. Cancel brings the three stored rows back and fades
 *    both buttons.
 * 5. Frame network-proxy-custom-invalid: the error border and a 12px message in the error text
 *    color show under IP or Hostname (ending at the field's right edge) and under entries 2, 3
 *    and 4 (starting at the address's left edge); entry 1 and the other fields are unmarked.
 *    Each marked field is `aria-invalid` and described by its message, which sits in a polite
 *    live region. The IP or Hostname label and field keep their place and the field keeps focus
 *    when the message appears. Save is disabled and faded, Cancel is enabled.
 * 6. Source, keyboard focus: on the pressed and on the unpressed part the ring is a 2px solid
 *    outline drawn 4px inside the part, so all four sides lie inside the group that clips it.
 *    It is white on the pressed part and the app's focus color on the unpressed one, and stands
 *    out from the fill behind it (3:1 or more).
 * 7. Frame network-proxy-blocks, the whole Settings page with Blocks active in the menu: the
 *    title "Proxy Blocks" alone, no line under it, no Cancel and no Save. Three bordered cards,
 *    each with a chevron at the right end of its header: "Blocks that use this proxy" and
 *    "Blocks that do not use this proxy" open, "Not applicable" closed. A card lists the
 *    palette's groups as rows, the group name in capitals in its color, and the group's blocks
 *    (20px icon in the group color, then the name) in four aligned columns. Every block of GET
 *    /network/proxy/blocks shows in its section.
 * 8. Frame network-proxy-blocks-open: with "Blocks that use this proxy" closed and "Not
 *    applicable" open, the first card is its header alone and the third lists its five groups.
 * 9. While a first read is in flight each page shows its title over a one-row skeleton, with no
 *    Cancel, no Save and no control.
 * 10. Nothing is saved: no PATCH leaves the page and the stored setting is the default after
 *    every test.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { apiPathMatcher } from '../../helpers/api-route'
import { BACKEND_URL, FRONTEND_URL } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'

type Theme = 'light' | 'dark'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface ProxyEntry {
  kind: 'exact' | 'regex'
  address: string
}

interface ProxySettings {
  enabled: boolean
  source: 'host' | 'custom'
  host: string
  port: number | null
  username: string
  password_set: boolean
  list_mode: 'except' | 'only'
  entries: ProxyEntry[]
  proxy_local_addresses: boolean
  host_values: { https_proxy: string | null; http_proxy: string | null; no_proxy: string | null }
}

type ProxyChange = Partial<Omit<ProxySettings, 'password_set' | 'host_values'>>

interface ProxyProblem {
  field: 'host' | 'entries'
  row: number | null
  message: string
}

interface ProxyBlocks {
  supported: unknown[]
  unsupported: unknown[]
  not_applicable: unknown[]
}

interface ProxyStage {
  /** Fields laid over the real GET answer; empty leaves it as the backend sent it. */
  overlay: Partial<ProxySettings>
  /** Holds the GET back until it settles. */
  hold?: Promise<void>
  /** Every staged change the page asked the check about. */
  checks: ProxyChange[]
  saves: number
}

interface FrameGroup {
  name: string
  blocks: string[]
}

interface BlockSection {
  testId: string
  title: string
  groups: FrameGroup[]
}

const CENTER_TOLERANCE_PX = 2
const EDGE_TOLERANCE_PX = 1
const WHITE = 'rgb(255, 255, 255)'
const TRANSPARENT = 'rgba(0, 0, 0, 0)'
const NAV_ACTIVE = 'rgb(37, 99, 235)'

const TITLE = 'Proxy Setup'
const SUBTITLE =
  'For web requests (HTTP and HTTPS) made from the WAVE host. Your browser and blocks on a remote host do not use it.'
const USE_PROXY = 'Use a proxy'
const SOURCE = 'Source'
const HOST_SOURCE = "WAVE host's settings"
const CUSTOM_SOURCE = 'Custom'
const LIST_MODE = 'Use the proxy for'
const EXCEPT_MODE = 'All addresses except the list'
const ONLY_MODE = 'Only the addresses in the list'
const LOCAL_ADDRESSES = 'Use the proxy for local addresses too'
const PASSWORD_HELP = 'Stored sealed; shown write-only like other credentials.'
const CUSTOM_LABELS = [
  USE_PROXY,
  SOURCE,
  'IP or Hostname',
  'Port',
  'Username',
  'Password',
  LIST_MODE,
  LOCAL_ADDRESSES,
]
const HOST_FACTS = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']
const NOT_SET = 'Not set'

const DEFAULT_PROXY: ProxySettings = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password_set: false,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
  host_values: { https_proxy: null, http_proxy: null, no_proxy: null },
}

// Frame network-proxy-host, with the password mask the backend sends.
const MASKED_ADDRESS = 'http://svc-wave:********@proxy.corp.example:3128'
const NO_PROXY_VALUE = '.corp.example,localhost'
const MASKED_ADDRESS_SHAPE = /^http:\/\/[^:@/]+:\*{8}@[^:@/]+:\d+$/

// Frame network-proxy-custom: the stored state and the row the spec adds in the page.
const STORED_ENTRIES: ProxyEntry[] = [
  { kind: 'exact', address: 'https://registry.corp.example' },
  { kind: 'exact', address: 'http://10.20.0.15:9200' },
  { kind: 'exact', address: 'https://[2001:db8::1]:6443' },
]
const FOURTH_ENTRY: ProxyEntry = { kind: 'regex', address: String.raw`\.cluster\.local(:\d+)?$` }
const CUSTOM_STORED: Partial<ProxySettings> = {
  enabled: true,
  source: 'custom',
  host: 'proxy.corp.example',
  port: 3128,
  username: 'svc-wave',
  password_set: true,
  list_mode: 'except',
  entries: STORED_ENTRIES,
  proxy_local_addresses: false,
}

// Frame network-proxy-custom-invalid: the bad values and the message each one gets.
const INVALID_HOST = 'http://proxy.corp.example'
const HOST_MESSAGE = 'IP or Hostname must be an IP address or a host name, with no protocol and no port'
const INVALID_ENTRIES: ReadonlyArray<ProxyEntry & { row: number; message: string }> = [
  {
    row: 2,
    kind: 'exact',
    address: 'https://registry.corp.example/',
    message: 'Remove everything after the host and port',
  },
  {
    row: 3,
    kind: 'exact',
    address: 'HTTPS://Registry.corp.example:443',
    message: 'The same address as entry 1',
  },
  {
    row: 4,
    kind: 'regex',
    address: String.raw`\.cluster\.local(:\d+`,
    message: 'Not a valid regular expression: missing ), unterminated subpattern at position 15',
  },
]
const INVALID_LIST: ProxyEntry[] = [
  STORED_ENTRIES[0],
  ...INVALID_ENTRIES.map(({ kind, address }) => ({ kind, address })),
]

// Frames network-proxy-blocks and network-proxy-blocks-open: groups and blocks in the palette's order.
const SUPPORTED: BlockSection = {
  testId: 'proxy-blocks-supported',
  title: 'Blocks that use this proxy',
  groups: [
    { name: 'Network', blocks: ['HTTP'] },
    { name: 'Database', blocks: ['OpenSearch'] },
    {
      name: 'Kubernetes',
      blocks: [
        'K8s Connect',
        'K8s Get',
        'K8s Events',
        'K8s Logs',
        'K8s Top',
        'K8s Apply',
        'K8s Delete',
        'K8s Scale',
        'K8s Rollout',
        'K8s Exec',
        'K8s Script',
        'K8s Copy',
      ],
    },
    {
      name: 'Helm',
      blocks: ['Helm Install', 'Helm Upgrade', 'Helm Rollback', 'Helm Uninstall', 'Helm Test', 'Helm Status'],
    },
  ],
}
const UNSUPPORTED: BlockSection = {
  testId: 'proxy-blocks-unsupported',
  title: 'Blocks that do not use this proxy',
  groups: [{ name: 'System', blocks: ['Shell Script', 'Shell Exec', 'Python'] }],
}
const NOT_APPLICABLE: BlockSection = {
  testId: 'proxy-blocks-not-applicable',
  title: 'Not applicable',
  groups: [
    { name: 'Network', blocks: ['Ping', 'Netcat'] },
    {
      name: 'Remote',
      blocks: [
        'SSH Session Open',
        'SSH Session Exec',
        'SSH Session Script',
        'SSH Session Close',
        'SSH Tunnel Open',
        'SSH Tunnel Close',
        'SFTP',
      ],
    },
    { name: 'Database', blocks: ['SQL'] },
    { name: 'System', blocks: ['File I/O', 'Log'] },
    { name: 'Data', blocks: ['CSV', 'Excel', 'XML', 'JSON'] },
  ],
}
const GROUP_COLOR_TOKEN: Record<string, string> = {
  Network: '--color-blue-500',
  Remote: '--color-cyan-500',
  Database: '--color-purple-500',
  System: '--color-red-500',
  Kubernetes: '--color-sky-500',
  Helm: '--color-indigo-500',
  Data: '--color-emerald-500',
}
const BLOCK_COLUMNS = 4
const GROUP_NAME_COLUMN_PX = 132

/** The problems of a staged change: the frame's message for each bad value it holds. */
function problemsOf(change: ProxyChange): ProxyProblem[] {
  const problems: ProxyProblem[] = []
  if (change.host === INVALID_HOST) problems.push({ field: 'host', row: null, message: HOST_MESSAGE })
  for (const [index, entry] of (change.entries ?? []).entries()) {
    const bad = INVALID_ENTRIES.find((invalid) => invalid.address === entry.address)
    if (bad) problems.push({ field: 'entries', row: index + 1, message: bad.message })
  }
  return problems
}

/** Decorates the read, answers the check and refuses a save; nothing reaches the stored setting. */
async function stageProxy(page: Page): Promise<ProxyStage> {
  const stage: ProxyStage = { overlay: {}, checks: [], saves: 0 }
  await page.route(apiPathMatcher('/network/proxy'), async (route) => {
    const method = route.request().method()
    if (method === 'PATCH') {
      stage.saves += 1
      await route.abort()
      return
    }
    if (method !== 'GET') {
      await route.fallback()
      return
    }
    if (stage.hold) await stage.hold
    const response = await route.fetch()
    const stored = (await response.json()) as ProxySettings
    await route.fulfill({ response, json: { ...stored, ...stage.overlay } })
  })
  await page.route(apiPathMatcher('/network/proxy/validate'), async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    const change = route.request().postDataJSON() as ProxyChange
    stage.checks.push(change)
    await route.fulfill({
      status: 200,
      // The API is another origin for the page, so the answer carries the backend's CORS headers.
      headers: {
        'Access-Control-Allow-Origin': route.request().headers().origin ?? new URL(FRONTEND_URL).origin,
        'Access-Control-Allow-Credentials': 'true',
      },
      json: { problems: problemsOf(change) },
    })
  })
  return stage
}

/** A promise the spec settles by hand, to keep a read in flight. */
function gate(): { held: Promise<void>; release: () => void } {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return { held, release }
}

async function getJson<T>(request: APIRequestContext, route: string): Promise<T> {
  const response = await request.get(`${BACKEND_URL}${route}`)
  expect(response.status(), `GET ${route}`).toBe(200)
  return (await response.json()) as T
}

/** Every frame is staged over the stack's default setting on a WAVE host with no proxy variable. */
async function expectDefaultStored(request: APIRequestContext, when: string): Promise<void> {
  expect(await getJson<ProxySettings>(request, '/network/proxy'), `the stored proxy setting ${when}`).toEqual(
    DEFAULT_PROXY,
  )
}

function exactly(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

async function boxOf(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
}

const rightOf = (box: Box): number => box.x + box.width
const bottomOf = (box: Box): number => box.y + box.height
const middleOf = (box: Box): number => box.y + box.height / 2

function expectNear(actual: number, expected: number, what: string, tolerance = EDGE_TOLERANCE_PX): void {
  expect.soft(Math.abs(actual - expected), `${what}: ${actual}px, expected ${expected}px`).toBeLessThanOrEqual(tolerance)
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

async function themeOf(page: Page): Promise<Theme> {
  return (await page.locator('html').getAttribute('data-theme')) === 'dark' ? 'dark' : 'light'
}

/** Runs the frame's checks in the theme the page opened in, then in the other one. */
async function inBothThemes(page: Page, check: (theme: Theme) => Promise<void>): Promise<void> {
  const first = await themeOf(page)
  await test.step(`${first} theme`, () => check(first))
  const second = await toggleTheme(page)
  await test.step(`${second} theme`, () => check(second))
}

/** Takes the pointer off the page content, so no control is drawn hovered. */
async function restPointer(page: Page): Promise<void> {
  await page.mouse.move(0, 0)
}

function setupTab(page: Page): Locator {
  return page.getByTestId('network-proxy-setup-tab')
}

function blocksTab(page: Page): Locator {
  return page.getByTestId('network-proxy-blocks-tab')
}

function headerButton(tab: Locator, name: 'Cancel' | 'Save'): Locator {
  return tab.getByRole('button', { name, exact: true })
}

function useProxySwitch(tab: Locator): Locator {
  return tab.getByRole('switch', { name: USE_PROXY, exact: true })
}

function segmented(tab: Locator, name: string): Locator {
  return tab.getByRole('group', { name, exact: true })
}

function part(group: Locator, name: string): Locator {
  return group.getByRole('button', { name, exact: true })
}

/** The row a label heads: its label, an optional help line and the control at the right edge. */
function rowOf(tab: Locator, label: string): Locator {
  return tab.locator('label').filter({ hasText: exactly(label) }).locator('xpath=../../..')
}

function rowGroup(tab: Locator): Locator {
  return rowOf(tab, USE_PROXY).locator('xpath=..')
}

function entryRow(tab: Locator, row: number): { type: Locator; address: Locator; remove: Locator } {
  return {
    type: segmented(tab, `Entry ${row} type`),
    address: tab.locator(`input[name="proxy-entry-${row}"]`),
    remove: tab.getByRole('button', { name: `Remove entry ${row}`, exact: true }),
  }
}

/** The field's problem line, wherever its row puts it. */
function messageOf(tab: Locator, message: string): Locator {
  return tab.locator('[aria-live="polite"] p').filter({ hasText: exactly(message) })
}

async function openProxySetup(page: Page): Promise<Locator> {
  await page.goto('/settings/network/proxy/setup')
  const tab = setupTab(page)
  await expect(useProxySwitch(tab)).toBeVisible()
  await expect(tab.getByTestId('proxy-setup-skeleton')).toHaveCount(0)
  return tab
}

async function expectButtons(tab: Locator, enabled: { cancel: boolean; save: boolean }): Promise<void> {
  const states: Array<['Cancel' | 'Save', boolean]> = [
    ['Cancel', enabled.cancel],
    ['Save', enabled.save],
  ]
  for (const [name, on] of states) {
    const button = headerButton(tab, name)
    if (on) {
      await expect(button, `${name} is enabled`).toBeEnabled()
      await expect(button, `${name} is not faded`).toHaveCSS('opacity', '1')
    } else {
      await expect(button, `${name} is disabled`).toBeDisabled()
      await expect(button, `${name} is faded`).toHaveCSS('opacity', '0.5')
      await expect(button, `${name} shows the not-allowed cursor`).toHaveCSS('cursor', 'not-allowed')
    }
  }
}

/** NET-10: the title, Cancel then Save at the right end of its line and the one line under it. */
async function expectSetupHeader(page: Page, tab: Locator): Promise<void> {
  await expect(tab.getByRole('heading'), 'the page holds one heading').toHaveText([TITLE])
  const heading = tab.getByRole('heading', { level: 2, name: TITLE, exact: true })
  const line = heading.locator('xpath=..')
  await expect(line.getByRole('button')).toHaveText(['Cancel', 'Save'])
  await expect(headerButton(tab, 'Save').locator('svg'), 'Save carries the save icon').toHaveCount(1)
  await expect(headerButton(tab, 'Cancel').locator('svg'), 'Cancel carries no icon').toHaveCount(0)

  const subtitle = line.locator('xpath=following-sibling::p')
  await expect(subtitle).toHaveText(SUBTITLE)
  await expect(subtitle).toHaveCSS('font-size', '14px')
  await expect(subtitle).toHaveCSS('color', await tokenColor(page, '--muted-foreground'))

  const headingBox = await boxOf(heading)
  const cancel = await boxOf(headerButton(tab, 'Cancel'))
  const save = await boxOf(headerButton(tab, 'Save'))
  const group = await boxOf(rowGroup(tab))
  const subtitleBox = await boxOf(subtitle)
  for (const [name, box] of [
    ['Cancel', cancel],
    ['Save', save],
  ] as const) {
    expect
      .soft(Math.abs(middleOf(box) - middleOf(headingBox)), `${name} sits on the title's centerline`)
      .toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  }
  expect.soft(rightOf(cancel), 'Cancel comes before Save').toBeLessThanOrEqual(save.x)
  expectNear(rightOf(save), rightOf(group), 'Save ends the title line at the group edge')
  expectNear(headingBox.x, group.x, 'the title starts at the group edge')
  expect.soft(subtitleBox.y, 'the line sits under the title').toBeGreaterThanOrEqual(bottomOf(headingBox))
  expect.soft(bottomOf(subtitleBox), 'the line sits above the group').toBeLessThanOrEqual(group.y)
}

/** One bordered group whose rows are split by one hairline each. */
async function expectRowGroup(group: Locator, rows: number): Promise<void> {
  const borders = await group.evaluate((element) => {
    const px = (value: string): number => Number.parseFloat(value)
    const own = getComputedStyle(element)
    const children = [...element.children]
    return {
      frame: [own.borderTopWidth, own.borderRightWidth, own.borderBottomWidth, own.borderLeftWidth].map(px),
      hairlines: children
        .slice(1)
        .map(
          (row, index) =>
            px(getComputedStyle(row).borderTopWidth) + px(getComputedStyle(children[index]).borderBottomWidth),
        ),
    }
  })
  expect(borders.hairlines, 'one hairline between neighboring rows').toEqual(Array(rows - 1).fill(1))
  expect(borders.frame, 'the group has a 1px border on every side').toEqual([1, 1, 1, 1])
}

/** NET-11: the control's center sits on the center of the label, or of label + help. */
async function expectRowCentered(tab: Locator, label: string, control: Locator): Promise<void> {
  const row = rowOf(tab, label)
  const labelBox = await boxOf(row.locator('label'))
  const help = row.locator(':scope > div').first().locator('p')
  const textBottom = (await help.count()) > 0 ? bottomOf(await boxOf(help)) : bottomOf(labelBox)
  const offset = Math.abs(middleOf(await boxOf(control)) - (labelBox.y + textBottom) / 2)
  expect
    .soft(offset, `"${label}": the control is centered against its text (NET-11)`)
    .toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
}

/** Every control ends 12px inside the group's right border. */
async function expectSharedRightEdge(tab: Locator, controls: Locator[]): Promise<void> {
  const edge = rightOf(await boxOf(rowGroup(tab))) - 13
  for (const control of controls) {
    expectNear(rightOf(await boxOf(control)), edge, 'the control ends at the shared right edge')
  }
}

/** A two-part control: the pressed part filled primary with white text, the other one unfilled. */
async function expectSegmented(page: Page, group: Locator, parts: string[], pressed: string): Promise<void> {
  await expect(group.getByRole('button')).toHaveText(parts)
  const primary = await tokenColor(page, '--primary')
  for (const name of parts) {
    const button = part(group, name)
    if (name === pressed) {
      await expect(button).toHaveAttribute('aria-pressed', 'true')
      await expect.soft(button, `${name} is filled primary`).toHaveCSS('background-color', primary)
      await expect.soft(button, `${name} reads white`).toHaveCSS('color', WHITE)
    } else {
      await expect(button).toHaveAttribute('aria-pressed', 'false')
      await expect.soft(button, `${name} is not filled`).toHaveCSS('background-color', TRANSPARENT)
    }
  }
  const [first, second] = [await boxOf(part(group, parts[0])), await boxOf(part(group, parts[1]))]
  expectNear(rightOf(first), second.x, 'the two parts touch')
  expectNear(middleOf(first), middleOf(second), 'the two parts share one line')
}

/** NET-1, NET-10: Network > Proxy > Setup / Blocks, with one page active. */
async function expectProxyNav(page: Page, active: 'Setup' | 'Blocks'): Promise<void> {
  const nav = page.getByTestId('settings-sections')
  const network = nav.getByRole('button', { name: 'Network', exact: true })
  await expect(network).toHaveAttribute('aria-expanded', 'true')
  const pages = nav.getByRole('group', { name: 'Network', exact: true })
  await expect(pages.getByRole('button')).toHaveText(['SSH Hosts', 'Certificates', 'Proxy', 'Setup', 'Blocks'])

  const proxy = pages.getByRole('button', { name: 'Proxy', exact: true })
  await expect(proxy).toHaveAttribute('aria-expanded', 'true')
  await expect(proxy.locator('svg'), 'Proxy carries a chevron and no icon').toHaveCount(1)
  const proxyPages = pages.getByRole('group', { name: 'Proxy', exact: true })
  await expect(proxyPages.getByRole('button')).toHaveText(['Setup', 'Blocks'])
  await expect(proxyPages, 'the Proxy pages hang off their own left rule').toHaveCSS('border-left-width', '1px')

  const items = {
    Setup: page.getByTestId('settings-nav-network-proxy-setup'),
    Blocks: page.getByTestId('settings-nav-network-proxy-blocks'),
  }
  const other = active === 'Setup' ? 'Blocks' : 'Setup'
  await expect(items.Setup).toHaveText('Setup')
  await expect(items.Blocks).toHaveText('Blocks')
  await expect(nav.locator('[aria-current="page"]'), 'one menu item is active').toHaveText([active])
  await expect(items[active]).toHaveCSS('background-color', NAV_ACTIVE)
  await expect(items[active]).toHaveCSS('color', WHITE)
  await expect(items[other]).toHaveCSS('background-color', TRANSPARENT)

  const sshHosts = await boxOf(pages.getByRole('button', { name: 'SSH Hosts', exact: true }))
  const proxyBox = await boxOf(proxy)
  const setup = await boxOf(items.Setup)
  const blocks = await boxOf(items.Blocks)
  expect.soft(sshHosts.x, 'the Network pages are indented').toBeGreaterThan((await boxOf(network)).x)
  expectNear(proxyBox.x, sshHosts.x, 'Proxy lines up with the Network pages')
  expect.soft(setup.x, 'the Proxy pages are indented once more').toBeGreaterThan(proxyBox.x)
  expectNear(blocks.x, setup.x, 'Blocks lines up with Setup')
  expect.soft(blocks.y, 'Blocks sits under Setup').toBeGreaterThanOrEqual(bottomOf(setup))
}

/** Frame network-proxy-off. */
async function expectOffFrame(page: Page, tab: Locator): Promise<void> {
  await restPointer(page)
  await expectSetupHeader(page, tab)
  await expectButtons(tab, { cancel: false, save: false })
  await expect(tab.locator('label'), 'the group holds one row').toHaveText([USE_PROXY])
  await expectRowGroup(rowGroup(tab), 1)

  const row = rowOf(tab, USE_PROXY)
  const toggle = useProxySwitch(tab)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(row.locator('p'), 'Use a proxy has no help line').toHaveCount(0)
  await expect(toggle, 'no help line describes the switch').not.toHaveAttribute('aria-describedby')
  await expect(row.locator('label')).toHaveCSS('font-size', '14px')
  await expect(row.locator('label')).toHaveCSS('font-weight', '400')
  await expectRowCentered(tab, USE_PROXY, toggle)
  await expectSharedRightEdge(tab, [toggle])
  await expect(tab.getByRole('group'), 'no Source while the proxy is off').toHaveCount(0)
  await expect(tab.locator('input'), 'no field while the proxy is off').toHaveCount(0)
}

interface FactReading {
  label: string
  value: string
  lock: string
  lefts: number[]
  centers: number[]
  top: number
  bottom: number
  labelSize: string
  labelColor: string
  valueFont: string
  valueColor: string
}

/** Frame network-proxy-host: the Source row and the three lock-marked facts. */
async function expectHostFrame(page: Page, tab: Locator, values: string[]): Promise<void> {
  await restPointer(page)
  await expectSetupHeader(page, tab)
  await expectButtons(tab, { cancel: true, save: true })
  await expect(tab.locator('label')).toHaveText([USE_PROXY, SOURCE])
  await expectRowGroup(rowGroup(tab), 3)

  const toggle = useProxySwitch(tab)
  const source = segmented(tab, SOURCE)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect.soft(toggle, 'the switch is filled primary').toHaveCSS(
    'background-color',
    await tokenColor(page, '--primary'),
  )
  await expectSegmented(page, source, [HOST_SOURCE, CUSTOM_SOURCE], HOST_SOURCE)
  await expectRowCentered(tab, USE_PROXY, toggle)
  await expectRowCentered(tab, SOURCE, source)
  await expectSharedRightEdge(tab, [toggle, source])
  await expect(tab.locator('input'), 'no field while the WAVE host sets the proxy').toHaveCount(0)

  const valuesRow = rowGroup(tab).locator(':scope > div').nth(2)
  await expect(valuesRow.locator('label'), 'the values row has no label').toHaveCount(0)
  const group = await boxOf(rowGroup(tab))
  const rowBox = await boxOf(valuesRow)
  expectNear(rowBox.width, group.width - 2, 'the values row spans the group')

  const facts: FactReading[] = await valuesRow.locator(':scope > div > span').evaluateAll((items) =>
    items.map((item) => {
      const [label, lock, value] = [...item.children]
      const parts = [label, lock, value].map((element) => element.getBoundingClientRect())
      const labelStyle = getComputedStyle(label)
      const valueStyle = getComputedStyle(value)
      return {
        label: label.textContent ?? '',
        value: value.textContent ?? '',
        lock: lock.getAttribute('class') ?? '',
        lefts: parts.map((rect) => rect.left),
        centers: parts.map((rect) => rect.top + rect.height / 2),
        top: parts[0].top,
        bottom: parts[0].bottom,
        labelSize: labelStyle.fontSize,
        labelColor: labelStyle.color,
        valueFont: valueStyle.fontFamily,
        valueColor: valueStyle.color,
      }
    }),
  )
  expect(facts.map((fact) => fact.label)).toEqual(HOST_FACTS)
  expect(facts.map((fact) => fact.value)).toEqual(values)
  const muted = await tokenColor(page, '--muted-foreground')
  for (const [index, fact] of facts.entries()) {
    expect.soft(fact.lock, `${fact.label} carries a lock`).toMatch(/lucide-lock/)
    expect.soft(fact.labelSize, `${fact.label} is 12px`).toBe('12px')
    expect.soft(fact.labelColor, `${fact.label} is muted`).toBe(muted)
    expect.soft(fact.valueFont, `the ${fact.label} value is monospace`).toMatch(/mono/i)
    expect.soft(fact.valueColor, `the ${fact.label} value is not muted`).not.toBe(muted)
    expect
      .soft(Math.max(...fact.centers) - Math.min(...fact.centers), `${fact.label}: label, lock and value share one line`)
      .toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
    expect.soft(fact.lefts[1], `${fact.label}: the lock follows the label`).toBeGreaterThan(fact.lefts[0])
    expect.soft(fact.lefts[2], `${fact.label}: the value follows the lock`).toBeGreaterThan(fact.lefts[1])
    for (const column of [0, 1, 2]) {
      expectNear(fact.lefts[column], facts[0].lefts[column], `${fact.label}: column ${column + 1} lines up`, 0.5)
    }
    if (index > 0) {
      expect.soft(fact.top, `${fact.label} sits on its own line`).toBeGreaterThanOrEqual(facts[index - 1].bottom)
    }
  }
}

/** The masked stored-secret field: pencil, eight dots and a lock at the right end; no input. */
async function expectMaskedPassword(tab: Locator): Promise<void> {
  const row = rowOf(tab, 'Password')
  const field = row.getByRole('button', { name: 'Password: Edit protected value', exact: true })
  await expect(row.locator('input'), 'a stored password shows no input').toHaveCount(0)
  await expect(field, 'the Password label points at the masked field').toHaveAttribute(
    'id',
    (await row.locator('label').getAttribute('for')) ?? '',
  )
  await expect(field).toHaveAccessibleDescription(PASSWORD_HELP)
  await expect(field.locator('svg'), 'the field holds the pencil').toHaveCount(1)
  const dots = field.locator('span[aria-hidden="true"]')
  await expect(dots).toHaveText('•'.repeat(8))
  await expect(dots).toHaveCSS('font-family', /mono/i)
  const lock = row.locator('svg.lucide-lock')
  await expect(lock, 'one lock marks the stored password').toHaveCount(1)

  const fieldBox = await boxOf(field)
  const lockBox = await boxOf(lock)
  expectNear(fieldBox.width, 256, 'masked field width')
  expectNear(fieldBox.height, 40, 'masked field height')
  expect.soft((await boxOf(field.locator('svg'))).x, 'the pencil comes before the dots').toBeLessThan(
    (await boxOf(dots)).x,
  )
  expect.soft(lockBox.x, 'the lock sits after the dots').toBeGreaterThan(rightOf(await boxOf(dots)))
  expect.soft(rightOf(lockBox), 'the lock sits inside the field').toBeLessThan(rightOf(fieldBox))
  expect.soft(rightOf(fieldBox) - rightOf(lockBox), 'the lock sits at the right end').toBeLessThanOrEqual(16)
  expectNear(middleOf(lockBox), middleOf(fieldBox), 'the lock sits on the field centerline', CENTER_TOLERANCE_PX)

  const help = row.getByText(PASSWORD_HELP, { exact: true })
  await expect(help).toHaveCSS('font-size', '12px')
}

/** The address list: one line per entry, aligned columns, "Add" under the last row. */
async function expectAddressList(page: Page, tab: Locator, entries: ProxyEntry[]): Promise<void> {
  const listRow = rowOf(tab, LIST_MODE)
  await expect(listRow.locator('input'), 'the list sits inside the "Use the proxy for" row').toHaveCount(
    entries.length,
  )
  await expect(tab.locator('input[name^="proxy-entry-"]')).toHaveCount(entries.length)

  const boxes: Array<{ type: Box; address: Box; remove: Box }> = []
  for (const [index, entry] of entries.entries()) {
    const row = index + 1
    const { type, address, remove } = entryRow(tab, row)
    await expectSegmented(page, type, ['Exact', 'Regex'], entry.kind === 'exact' ? 'Exact' : 'Regex')
    await expect(address).toHaveValue(entry.address)
    await expect(address).toHaveAttribute('aria-label', `Entry ${row} address`)
    await expect(address).toHaveCSS('font-family', /mono/i)
    await expect(remove.locator('svg'), `entry ${row} has a trash icon`).toHaveCount(1)
    boxes.push({ type: await boxOf(type), address: await boxOf(address), remove: await boxOf(remove) })
  }
  for (const [index, box] of boxes.entries()) {
    const row = index + 1
    expect.soft(rightOf(box.type), `entry ${row}: the type comes before the address`).toBeLessThanOrEqual(box.address.x)
    expect.soft(rightOf(box.address), `entry ${row}: the address comes before the trash`).toBeLessThanOrEqual(
      box.remove.x,
    )
    expectNear(middleOf(box.type), middleOf(box.address), `entry ${row}: the type is on the address line`, 2)
    expectNear(middleOf(box.remove), middleOf(box.address), `entry ${row}: the trash is on the address line`, 2)
    expectNear(box.address.height, 40, `entry ${row}: address height`)
    expectNear(box.type.x, boxes[0].type.x, `entry ${row}: the type column lines up`)
    expectNear(box.address.x, boxes[0].address.x, `entry ${row}: the address column starts in line`)
    expectNear(rightOf(box.address), rightOf(boxes[0].address), `entry ${row}: the address column ends in line`)
    expectNear(rightOf(box.remove), rightOf(boxes[0].remove), `entry ${row}: the trash column lines up`)
    if (index > 0) {
      expect.soft(box.address.y, `entry ${row} sits under entry ${index}`).toBeGreaterThanOrEqual(
        bottomOf(boxes[index - 1].address),
      )
    }
  }

  const modeBox = await boxOf(segmented(tab, LIST_MODE))
  const add = listRow.getByRole('button', { name: 'Add entry', exact: true })
  const addBox = await boxOf(add)
  const last = boxes[boxes.length - 1]
  expect.soft(boxes[0].address.y, 'the list sits under the two-part choice').toBeGreaterThanOrEqual(bottomOf(modeBox))
  expect.soft(addBox.y, '"Add" sits under the last row').toBeGreaterThanOrEqual(bottomOf(last.address))
  expectNear(addBox.x, last.type.x, '"Add" starts at the list edge')
  expectNear(addBox.height, 36, '"Add" height')
  await expect(add).toBeEnabled()
  await expect.soft(add).toHaveCSS('font-size', '14px')
  await expect.soft(add).toHaveCSS('border-top-width', '1px')
  await expect.soft(add).toHaveCSS('background-color', TRANSPARENT)
}

/** The eight Custom rows of frames network-proxy-custom and network-proxy-custom-invalid. */
async function expectCustomRows(page: Page, tab: Locator, host: string, entries: ProxyEntry[]): Promise<void> {
  await expect(tab.locator('label')).toHaveText(CUSTOM_LABELS)
  await expectRowGroup(rowGroup(tab), CUSTOM_LABELS.length)

  const toggle = useProxySwitch(tab)
  const source = segmented(tab, SOURCE)
  const hostInput = tab.locator('input[name="proxy-host"]')
  const port = tab.locator('input[name="proxy-port"]')
  const username = tab.locator('input[name="proxy-username"]')
  const password = rowOf(tab, 'Password').getByRole('button', { name: 'Password: Edit protected value', exact: true })
  const listMode = segmented(tab, LIST_MODE)
  const local = tab.getByRole('switch', { name: LOCAL_ADDRESSES, exact: true })

  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expectSegmented(page, source, [HOST_SOURCE, CUSTOM_SOURCE], CUSTOM_SOURCE)
  await expect(tab.getByLabel('IP or Hostname', { exact: true })).toHaveAttribute('name', 'proxy-host')
  await expect(tab.getByLabel('Port', { exact: true })).toHaveAttribute('name', 'proxy-port')
  await expect(tab.getByLabel('Username', { exact: true })).toHaveAttribute('name', 'proxy-username')
  await expect(hostInput).toHaveValue(host)
  await expect(port).toHaveValue(String(CUSTOM_STORED.port))
  await expect(port).toHaveCSS('text-align', 'right')
  await expect(port).toHaveCSS('font-family', /mono/i)
  await expect(username).toHaveValue(String(CUSTOM_STORED.username))
  for (const [what, field, width] of [
    ['IP or Hostname', hostInput, 256],
    ['Port', port, 112],
    ['Username', username, 256],
  ] as const) {
    const box = await boxOf(field)
    expectNear(box.width, width, `${what} width`)
    expectNear(box.height, 40, `${what} height`)
  }
  await expectMaskedPassword(tab)
  await expectSegmented(page, listMode, [EXCEPT_MODE, ONLY_MODE], EXCEPT_MODE)
  await expect(local).toHaveAttribute('aria-checked', 'false')
  await expectAddressList(page, tab, entries)

  const controls: Array<[string, Locator]> = [
    [USE_PROXY, toggle],
    [SOURCE, source],
    ['IP or Hostname', hostInput],
    ['Port', port],
    ['Username', username],
    ['Password', password],
    [LIST_MODE, listMode],
    [LOCAL_ADDRESSES, local],
  ]
  for (const [label, control] of controls) await expectRowCentered(tab, label, control)
  await expectSharedRightEdge(tab, [
    ...controls.map(([, control]) => control),
    ...entries.map((_, index) => entryRow(tab, index + 1).remove),
  ])
  for (const label of [USE_PROXY, SOURCE, 'IP or Hostname', 'Port', 'Username', LIST_MODE, LOCAL_ADDRESSES]) {
    await expect(
      rowOf(tab, label).locator(':scope > div').first().locator('p'),
      `${label} has no help line`,
    ).toHaveCount(0)
  }
}

/** Frame network-proxy-custom: the whole page with the fourth row staged. */
async function expectCustomFrame(page: Page, tab: Locator): Promise<void> {
  await restPointer(page)
  await expect(page).toHaveURL(/\/settings\/network\/proxy\/setup$/)
  await expectProxyNav(page, 'Setup')
  await expectSetupHeader(page, tab)
  await expectButtons(tab, { cancel: true, save: true })
  await expectCustomRows(page, tab, String(CUSTOM_STORED.host), [...STORED_ENTRIES, FOURTH_ENTRY])
  await expect(tab.locator('[aria-live="polite"] p'), 'no field shows a message').toHaveCount(0)
  await expect(tab.locator('[aria-invalid="true"]'), 'no field is marked invalid').toHaveCount(0)
}

/** A marked field: the error border, `aria-invalid` and its message as the description. */
async function expectMarkedInvalid(page: Page, field: Locator, message: Locator, text: string): Promise<void> {
  const error = await tokenColor(page, '--color-error-text')
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription(text)
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect.soft(field, `the ${side} border is the error color`).toHaveCSS(`border-${side}-color`, error)
  }
  await expect(message).toHaveCSS('color', error)
  await expect(message).toHaveCSS('font-size', '12px')
  expect.soft((await boxOf(message)).y, 'the message sits under its field').toBeGreaterThanOrEqual(
    bottomOf(await boxOf(field)),
  )
}

/** Frame network-proxy-custom-invalid. */
async function expectInvalidFrame(page: Page, tab: Locator): Promise<void> {
  await restPointer(page)
  await expectSetupHeader(page, tab)
  await expectButtons(tab, { cancel: true, save: false })
  await expectCustomRows(page, tab, INVALID_HOST, INVALID_LIST)
  await expect(tab.locator('[aria-live="polite"] p'), 'one field and three list rows show a message').toHaveText([
    HOST_MESSAGE,
    ...INVALID_ENTRIES.map((entry) => entry.message),
  ])
  await expect(tab.locator('[aria-invalid="true"]'), 'four fields are marked invalid').toHaveCount(4)

  const hostInput = tab.locator('input[name="proxy-host"]')
  const hostMessage = messageOf(tab, HOST_MESSAGE)
  await expectMarkedInvalid(page, hostInput, hostMessage, HOST_MESSAGE)
  await expect(rowOf(tab, 'IP or Hostname').locator('p'), 'the message is in the IP or Hostname row').toHaveText([
    HOST_MESSAGE,
  ])
  expectNear(
    rightOf(await boxOf(hostMessage)),
    rightOf(await boxOf(hostInput)),
    'the message ends at the field edge',
  )

  const first = entryRow(tab, 1).address
  await expect(first, 'entry 1 is not marked').not.toHaveAttribute('aria-invalid')
  await expect.soft(first).not.toHaveCSS('border-top-color', await tokenColor(page, '--color-error-text'))
  for (const entry of INVALID_ENTRIES) {
    const { address } = entryRow(tab, entry.row)
    const message = messageOf(tab, entry.message)
    await expectMarkedInvalid(page, address, message, entry.message)
    expectNear((await boxOf(message)).x, (await boxOf(address)).x, `entry ${entry.row}: the message starts at the address edge`)
  }
  const last = INVALID_ENTRIES[INVALID_ENTRIES.length - 1]
  expect
    .soft((await boxOf(tab.getByRole('button', { name: 'Add entry', exact: true }))).y, '"Add" sits under the last message')
    .toBeGreaterThanOrEqual(bottomOf(await boxOf(messageOf(tab, last.message))))
}

interface RingReading {
  focusVisible: boolean
  style: string
  width: number
  offset: number
  color: string
  part: number[]
  clip: number[]
  fill: number[]
  ring: number[]
}

function luminance(rgb: number[]): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** The WCAG contrast ratio of two sRGB colors. */
function contrast(a: number[], b: number[]): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** The focused part's outline, its box against the group that clips it, and the colors as drawn. */
async function readRing(group: Locator, focused: Locator): Promise<RingReading> {
  const clipper = await group.elementHandle()
  return focused.evaluate((element, fieldset) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    // Paints the colors over white in order, as the page stacks them.
    const paint = (colors: string[]): number[] => {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, 1, 1)
      for (const color of colors) {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const fills: string[] = []
    for (let node: Element | null = element; node; node = node.parentElement) {
      fills.unshift(getComputedStyle(node).backgroundColor)
    }
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    const outer = (fieldset as Element).getBoundingClientRect()
    const frame = getComputedStyle(fieldset as Element)
    const px = (value: string): number => Number.parseFloat(value)
    return {
      focusVisible: element.matches(':focus-visible'),
      style: style.outlineStyle,
      width: px(style.outlineWidth),
      offset: px(style.outlineOffset),
      color: style.outlineColor,
      part: [box.left, box.top, box.right, box.bottom],
      clip: [
        outer.left + px(frame.borderLeftWidth),
        outer.top + px(frame.borderTopWidth),
        outer.right - px(frame.borderRightWidth),
        outer.bottom - px(frame.borderBottomWidth),
      ],
      fill: paint(fills),
      ring: paint([...fills, style.outlineColor]),
    }
  }, clipper)
}

/** The ring is drawn inside the part, whole on four sides, in `color`, and stands out from the fill. */
async function expectRing(group: Locator, focused: Locator, color: string, what: string): Promise<void> {
  await expect(focused, `${what}: the part has focus`).toBeFocused()
  const reading = await readRing(group, focused)
  expect(reading.focusVisible, `${what}: focus came from the keyboard`).toBe(true)
  expect.soft(reading.style, `${what}: outline style`).toBe('solid')
  expect.soft(reading.width, `${what}: outline width`).toBe(2)
  expect.soft(reading.offset, `${what}: outline offset`).toBe(-4)
  expect.soft(reading.color, `${what}: ring color`).toBe(color)

  // The outline's outer edge lies this far inside the part's own edge.
  const inset = -(reading.offset + reading.width)
  expect.soft(inset, `${what}: the ring is drawn inside the part`).toBeGreaterThanOrEqual(0)
  const [left, top, right, bottom] = reading.part
  const [clipLeft, clipTop, clipRight, clipBottom] = reading.clip
  expect.soft(left + inset, `${what}: the left side is not cut off`).toBeGreaterThanOrEqual(clipLeft)
  expect.soft(top + inset, `${what}: the top side is not cut off`).toBeGreaterThanOrEqual(clipTop)
  expect.soft(right - inset, `${what}: the right side is not cut off`).toBeLessThanOrEqual(clipRight)
  expect.soft(bottom - inset, `${what}: the bottom side is not cut off`).toBeLessThanOrEqual(clipBottom)
  const reach = -reading.offset * 2
  expect.soft(right - left, `${what}: the part is wide enough to hold the ring`).toBeGreaterThan(reach)
  expect.soft(bottom - top, `${what}: the part is tall enough to hold the ring`).toBeGreaterThan(reach)
  expect
    .soft(contrast(reading.ring, reading.fill), `${what}: the ring stands out from the fill behind it`)
    .toBeGreaterThanOrEqual(3)
}

/** Source: Tab onto the pressed part, then onto the unpressed one. */
async function expectSourceFocusRings(page: Page, tab: Locator, theme: Theme): Promise<void> {
  const source = segmented(tab, SOURCE)
  const pressed = part(source, HOST_SOURCE)
  const unpressed = part(source, CUSTOM_SOURCE)
  await expect(pressed).toHaveAttribute('aria-pressed', 'true')
  await expect(unpressed).toHaveAttribute('aria-pressed', 'false')

  await useProxySwitch(tab).focus()
  await expect(pressed, 'no ring on a part without focus').toHaveCSS('outline-style', 'none')
  await expect(unpressed, 'no ring on a part without focus').toHaveCSS('outline-style', 'none')

  await page.keyboard.press('Tab')
  await expectRing(source, pressed, WHITE, `${theme}, pressed part`)
  await expect(unpressed, 'the ring left the other part alone').toHaveCSS('outline-style', 'none')

  await page.keyboard.press('Tab')
  await expectRing(source, unpressed, await tokenColor(page, '--color-primary'), `${theme}, unpressed part`)
  await expect(pressed, 'the ring left the pressed part').toHaveCSS('outline-style', 'none')
  await expect(pressed, 'moving focus presses nothing').toHaveAttribute('aria-pressed', 'true')
}

interface BlockReading {
  name: string
  left: number
  top: number
  icon: number[]
  iconColor: string
  iconRight: number
  iconCenter: number
  nameLeft: number
  nameCenter: number
}

interface GroupReading {
  name: string
  nameLeft: number
  transform: string
  color: string
  blocks: BlockReading[]
}

async function readGroups(card: Locator): Promise<GroupReading[]> {
  return card.getByTestId('proxy-block-group').evaluateAll((groups) =>
    groups.map((group) => {
      const title = group.querySelector('[data-testid="proxy-block-group-name"]') as HTMLElement
      const titleStyle = getComputedStyle(title)
      return {
        name: title.textContent ?? '',
        nameLeft: title.getBoundingClientRect().left,
        transform: titleStyle.textTransform,
        color: titleStyle.color,
        blocks: [...group.querySelectorAll('[data-testid="proxy-block"]')].map((block) => {
          const icon = block.querySelector('svg') as SVGElement
          const label = block.querySelector('span') as HTMLElement
          const box = block.getBoundingClientRect()
          const iconBox = icon.getBoundingClientRect()
          const labelBox = label.getBoundingClientRect()
          return {
            name: label.textContent ?? '',
            left: box.left,
            top: box.top,
            icon: [iconBox.width, iconBox.height],
            iconColor: getComputedStyle(icon).color,
            iconRight: iconBox.right,
            iconCenter: iconBox.top + iconBox.height / 2,
            nameLeft: labelBox.left,
            nameCenter: labelBox.top + labelBox.height / 2,
          }
        }),
      }
    }),
  )
}

/** One section card: its header with the chevron and, while open, its groups in four aligned columns. */
async function expectSection(page: Page, tab: Locator, section: BlockSection, open: boolean): Promise<void> {
  const card = tab.getByTestId(section.testId)
  const header = card.getByRole('button', { name: section.title, exact: true })
  await expect(card.getByRole('heading', { level: 3 })).toHaveText(section.title)
  await expect(header).toHaveAttribute('aria-expanded', String(open))
  const chevron = header.locator('svg')
  await expect(chevron, 'one chevron in the header').toHaveCount(1)
  await expect(chevron).toHaveClass(open ? /lucide-chevron-down/ : /lucide-chevron-right/)
  await expect(header).toHaveCSS('font-size', '14px')
  await expect(header).toHaveCSS('font-weight', '600')
  await expect(header, 'a rule under the header only while open').toHaveCSS('border-bottom-width', open ? '1px' : '0px')
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect.soft(card, `the card has a ${side} border`).toHaveCSS(`border-${side}-width`, '1px')
  }
  const cardBox = await boxOf(card)
  const chevronBox = await boxOf(chevron)
  expectNear(rightOf(cardBox) - rightOf(chevronBox), 13, 'the chevron sits at the right end of the header')
  expectNear(middleOf(chevronBox), middleOf(await boxOf(header)), 'the chevron sits on the header centerline')

  const groups = await readGroups(card)
  if (!open) {
    expect(groups, 'a closed card lists nothing').toEqual([])
    expectNear(cardBox.height, (await boxOf(header)).height + 2, 'a closed card is its header alone')
    return
  }
  expect(
    groups.map((group) => group.name),
    `${section.title}: the palette's groups in order`,
  ).toEqual(section.groups.map((group) => group.name))
  const widest = groups.reduce((a, b) => (b.blocks.length > a.blocks.length ? b : a))
  const pitch = widest.blocks.length > 1 ? widest.blocks[1].left - widest.blocks[0].left : 0
  for (const [index, group] of groups.entries()) {
    const color = await tokenColor(page, GROUP_COLOR_TOKEN[group.name])
    expect(
      group.blocks.map((block) => block.name),
      `${group.name}: the blocks in the palette's order`,
    ).toEqual(section.groups[index].blocks)
    expect.soft(group.transform, `${group.name} reads in capitals`).toBe('uppercase')
    expect.soft(group.color, `${group.name} reads in its color`).toBe(color)
    expectNear(group.nameLeft, groups[0].nameLeft, `${group.name}: the name column lines up`)
    expectNear(
      group.blocks[0].left - group.nameLeft,
      GROUP_NAME_COLUMN_PX,
      `${group.name}: the blocks start after the name column`,
    )
    for (const [position, block] of group.blocks.entries()) {
      const column = position % BLOCK_COLUMNS
      const line = Math.floor(position / BLOCK_COLUMNS)
      const lineStart = group.blocks[line * BLOCK_COLUMNS]
      expect.soft(block.icon, `${block.name}: a 20px icon`).toEqual([20, 20])
      expect.soft(block.iconColor, `${block.name}: the icon is in the group color`).toBe(color)
      expect.soft(block.iconRight, `${block.name}: the icon comes before the name`).toBeLessThanOrEqual(block.nameLeft)
      expectNear(block.iconCenter, block.nameCenter, `${block.name}: icon and name share one line`, 2)
      expectNear(block.left, group.blocks[0].left + column * pitch, `${block.name}: column ${column + 1}`)
      expectNear(block.top, lineStart.top, `${block.name}: line ${line + 1}`)
      if (line > 0) {
        expect
          .soft(block.top, `${block.name} sits under the line above`)
          .toBeGreaterThan(group.blocks[(line - 1) * BLOCK_COLUMNS].top)
      }
    }
  }
}

/** Frames network-proxy-blocks and network-proxy-blocks-open: the page with the named cards open. */
async function expectBlocksFrame(page: Page, open: { supported: boolean; notApplicable: boolean }): Promise<void> {
  await restPointer(page)
  const tab = blocksTab(page)
  await expect(page).toHaveURL(/\/settings\/network\/proxy\/blocks$/)
  await expectProxyNav(page, 'Blocks')

  await expect(tab.getByRole('heading', { level: 2 }), 'the title stands alone').toHaveText(['Proxy Blocks'])
  await expect(tab.getByRole('heading', { level: 3 })).toHaveText([
    SUPPORTED.title,
    UNSUPPORTED.title,
    NOT_APPLICABLE.title,
  ])
  await expect(tab.locator('p'), 'no line under the title').toHaveCount(0)
  await expect(tab.getByRole('button'), 'the three headers are the only buttons').toHaveCount(3)
  await expect(tab.locator('input')).toHaveCount(0)

  await expectSection(page, tab, SUPPORTED, open.supported)
  await expectSection(page, tab, UNSUPPORTED, true)
  await expectSection(page, tab, NOT_APPLICABLE, open.notApplicable)

  const cards = [
    await boxOf(tab.getByTestId(SUPPORTED.testId)),
    await boxOf(tab.getByTestId(UNSUPPORTED.testId)),
    await boxOf(tab.getByTestId(NOT_APPLICABLE.testId)),
  ]
  for (const [index, card] of cards.entries()) {
    expectNear(card.x, cards[0].x, 'the cards share one left edge')
    expectNear(card.width, cards[0].width, 'the cards share one width')
    if (index > 0) {
      expect.soft(card.y, 'the cards are stacked').toBeGreaterThanOrEqual(bottomOf(cards[index - 1]))
    }
  }
}

function blockCount(section: BlockSection): number {
  return section.groups.reduce((total, group) => total + group.blocks.length, 0)
}

let stage: ProxyStage

test.describe('V-NET-03: Settings > Network > Proxy', () => {
  // The whole-page frames are drawn at this scale.
  test.use({ viewport: { width: 1396, height: 900 } })

  test.beforeEach(async ({ page, request }) => {
    await expectDefaultStored(request, 'before the test')
    stage = await stageProxy(page)
  })

  test.afterEach(async ({ request }) => {
    expect(stage.saves, 'a visual spec never saves the proxy setting').toBe(0)
    await expectDefaultStored(request, 'after the test')
  })

  test('frame network-proxy-off: the line under the title, one row, faded Cancel and Save', async ({ page }) => {
    const tab = await openProxySetup(page)

    await inBothThemes(page, async () => {
      await expectOffFrame(page, tab)
    })
    expect(stage.checks, 'a clean page asks no check').toEqual([])
  })

  test('frame network-proxy-host: three lock-marked values in aligned columns, the password masked', async ({
    page,
  }) => {
    stage.overlay = {
      host_values: { https_proxy: MASKED_ADDRESS, http_proxy: MASKED_ADDRESS, no_proxy: NO_PROXY_VALUE },
    }
    const tab = await openProxySetup(page)
    await expectButtons(tab, { cancel: false, save: false })

    await test.step('the switch stages the frame', async () => {
      await useProxySwitch(tab).click()
      await expectButtons(tab, { cancel: true, save: true })
      expect(stage.checks.at(-1), 'the check is asked about the switch alone').toEqual({ enabled: true })
    })

    await inBothThemes(page, async () => {
      await expectHostFrame(page, tab, [MASKED_ADDRESS, MASKED_ADDRESS, NO_PROXY_VALUE])
    })

    await test.step('2. the password of a proxy address reads as eight asterisks', async () => {
      const values = rowGroup(tab).locator(':scope > div').nth(2).locator('span.font-mono')
      await expect(values).toHaveText([MASKED_ADDRESS_SHAPE, MASKED_ADDRESS_SHAPE, NO_PROXY_VALUE])
      await expect(values.filter({ hasText: /:\*{4}@/ }), 'the mask is not the four asterisks of the frame').toHaveCount(
        0,
      )
    })

    await test.step('Cancel returns to the off frame', async () => {
      await headerButton(tab, 'Cancel').click()
      await expect(useProxySwitch(tab)).toHaveAttribute('aria-checked', 'false')
      await expect(tab.locator('label')).toHaveText([USE_PROXY])
      await expectButtons(tab, { cancel: false, save: false })
    })
  })

  test('frame network-proxy-host on a WAVE host with no proxy variable: each value reads "Not set"', async ({
    page,
  }) => {
    const tab = await openProxySetup(page)
    await useProxySwitch(tab).click()
    await expectButtons(tab, { cancel: true, save: true })

    await inBothThemes(page, async () => {
      await expectHostFrame(page, tab, [NOT_SET, NOT_SET, NOT_SET])
    })
  })

  test('frame network-proxy-custom: the whole page, the eight rows and the address list with a staged fourth row', async ({
    page,
  }) => {
    stage.overlay = CUSTOM_STORED
    const tab = await openProxySetup(page)

    await test.step('the stored state is clean and holds three rows', async () => {
      await expectButtons(tab, { cancel: false, save: false })
      await expect(tab.locator('input[name^="proxy-entry-"]')).toHaveCount(STORED_ENTRIES.length)
      expect(stage.checks, 'a clean page asks no check').toEqual([])
    })

    await test.step('3. the fourth row is added in the page', async () => {
      await tab.getByRole('button', { name: 'Add entry', exact: true }).click()
      const fourth = entryRow(tab, 4)
      await expect(fourth.address, 'a new row starts empty').toHaveValue('')
      await expect(part(fourth.type, 'Exact'), 'a new row starts as Exact').toHaveAttribute('aria-pressed', 'true')
      await part(fourth.type, 'Regex').click()
      await fourth.address.fill(FOURTH_ENTRY.address)
      await expectButtons(tab, { cancel: true, save: true })
      await expect
        .poll(() => stage.checks.at(-1), { message: 'the check is asked about the list alone' })
        .toEqual({ entries: [...STORED_ENTRIES, FOURTH_ENTRY] })
    })

    await inBothThemes(page, async () => {
      await expectCustomFrame(page, tab)
    })

    await test.step('4. handles: Port keeps digits only, five at most (one number rule)', async () => {
      const port = tab.locator('input[name="proxy-port"]')
      // A whole text past five digits is refused, and the port keeps what it held.
      await port.fill('65535999')
      await expect(port).toHaveValue(String(CUSTOM_STORED.port))
      await port.fill('65535')
      await expect(port).toHaveValue('65535')
      // A digit typed in front of five digits changes nothing.
      await port.press('Home')
      await port.pressSequentially('9')
      await expect(port).toHaveValue('65535')
      // Typed key by key, each letter is refused and the digits stay.
      await port.selectText()
      await port.pressSequentially('31a2b8')
      await expect(port).toHaveValue('3128')
    })

    await test.step('4. Cancel brings the three stored rows back', async () => {
      await headerButton(tab, 'Cancel').click()
      await expect(tab.locator('input[name^="proxy-entry-"]')).toHaveCount(STORED_ENTRIES.length)
      for (const [index, entry] of STORED_ENTRIES.entries()) {
        await expect(entryRow(tab, index + 1).address).toHaveValue(entry.address)
      }
      await expect(tab.locator('input[name="proxy-port"]')).toHaveValue(String(CUSTOM_STORED.port))
      await expectButtons(tab, { cancel: false, save: false })
      await expectMaskedPassword(tab)
    })
  })

  test('frame network-proxy-custom-invalid: the error border and message under one field and three list rows, Save faded', async ({
    page,
  }) => {
    stage.overlay = CUSTOM_STORED
    const tab = await openProxySetup(page)
    const hostRow = rowOf(tab, 'IP or Hostname')
    const hostInput = tab.locator('input[name="proxy-host"]')

    await test.step('the bad list rows are typed in the page', async () => {
      await tab.getByRole('button', { name: 'Add entry', exact: true }).click()
      await part(entryRow(tab, 4).type, 'Regex').click()
      for (const entry of INVALID_ENTRIES) await entryRow(tab, entry.row).address.fill(entry.address)
      for (const entry of INVALID_ENTRIES) await expect(messageOf(tab, entry.message)).toBeVisible()
      await expect(hostInput, 'IP or Hostname is still unmarked').not.toHaveAttribute('aria-invalid')
    })

    await test.step('5. the IP or Hostname message arrives without moving the label, the field or the focus', async () => {
      const liveRegion = hostRow.locator('[aria-live="polite"]')
      await expect(liveRegion, 'the live region is there before the message').toHaveCount(1)
      await expect(liveRegion).toHaveText('')
      const place = async (): Promise<number[]> => {
        const row = await boxOf(hostRow)
        const label = await boxOf(hostRow.locator('label'))
        const field = await boxOf(hostInput)
        return [label.x - row.x, label.y - row.y, field.x - row.x, field.y - row.y]
      }
      const before = await place()
      await hostInput.fill(INVALID_HOST)
      await expect(messageOf(tab, HOST_MESSAGE)).toBeVisible()
      await expect(liveRegion, 'the message is inside the live region').toHaveText(HOST_MESSAGE)
      await expect(hostInput, 'the field keeps focus').toBeFocused()
      const after = await place()
      for (const [index, what] of ['label x', 'label y', 'field x', 'field y'].entries()) {
        expectNear(after[index], before[index], `${what} stays put when the message appears`, 0.5)
      }
      await expect
        .poll(() => stage.checks.at(-1), { message: 'the check is asked about the two staged fields' })
        .toEqual({ host: INVALID_HOST, entries: INVALID_LIST })
    })

    await inBothThemes(page, async () => {
      await expectInvalidFrame(page, tab)
    })

    await test.step('5. a corrected IP or Hostname loses its mark; Save stays off for the list', async () => {
      await hostInput.fill(String(CUSTOM_STORED.host))
      await expect(messageOf(tab, HOST_MESSAGE)).toHaveCount(0)
      await expect(hostInput).not.toHaveAttribute('aria-invalid')
      await expect(tab.locator('[aria-invalid="true"]')).toHaveCount(INVALID_ENTRIES.length)
      await expectButtons(tab, { cancel: true, save: false })
      await headerButton(tab, 'Cancel').click()
      await expect(tab.locator('[aria-live="polite"] p')).toHaveCount(0)
      await expectButtons(tab, { cancel: false, save: false })
    })
  })

  test('Source: the keyboard focus ring sits inside the part, whole and visible, pressed and unpressed', async ({
    page,
  }) => {
    const tab = await openProxySetup(page)
    await useProxySwitch(tab).focus()
    await page.keyboard.press('Space')
    await expect(useProxySwitch(tab)).toHaveAttribute('aria-checked', 'true')
    await expectButtons(tab, { cancel: true, save: true })

    await inBothThemes(page, async (theme) => {
      await expectSourceFocusRings(page, tab, theme)
    })
  })

  test('frames network-proxy-blocks and network-proxy-blocks-open: the title alone and three cards of palette groups', async ({
    page,
    request,
  }) => {
    const lists = await getJson<ProxyBlocks>(request, '/network/proxy/blocks')
    await page.goto('/settings/network/proxy/blocks')
    const tab = blocksTab(page)
    await expect(tab.getByTestId(SUPPORTED.testId)).toBeVisible()
    await expect(tab.getByTestId('proxy-blocks-skeleton')).toHaveCount(0)

    await test.step('7. every block the backend lists shows in its section', async () => {
      expect(lists.supported).toHaveLength(blockCount(SUPPORTED))
      expect(lists.unsupported).toHaveLength(blockCount(UNSUPPORTED))
      expect(lists.not_applicable).toHaveLength(blockCount(NOT_APPLICABLE))
      await expect(tab.getByTestId(SUPPORTED.testId).getByTestId('proxy-block')).toHaveCount(lists.supported.length)
      await expect(tab.getByTestId(UNSUPPORTED.testId).getByTestId('proxy-block')).toHaveCount(
        lists.unsupported.length,
      )
    })

    await test.step('7. frame network-proxy-blocks', async () => {
      await inBothThemes(page, async () => {
        await expectBlocksFrame(page, { supported: true, notApplicable: false })
      })
    })

    await test.step('8. frame network-proxy-blocks-open', async () => {
      await tab.getByRole('button', { name: SUPPORTED.title, exact: true }).click()
      await tab.getByRole('button', { name: NOT_APPLICABLE.title, exact: true }).click()
      await expect(tab.getByTestId(NOT_APPLICABLE.testId).getByTestId('proxy-block')).toHaveCount(
        lists.not_applicable.length,
      )
      await inBothThemes(page, async () => {
        await expectBlocksFrame(page, { supported: false, notApplicable: true })
      })
    })
  })

  test('while a first read is in flight each page shows its title over a skeleton, with no Cancel and no Save', async ({
    page,
  }) => {
    const setupRead = gate()
    const blocksRead = gate()
    stage.hold = setupRead.held
    await page.route(apiPathMatcher('/network/proxy/blocks'), async (route) => {
      await blocksRead.held
      await route.fallback()
    })

    await test.step('9. Proxy Setup', async () => {
      await page.goto('/settings/network/proxy/setup')
      const tab = setupTab(page)
      const skeleton = tab.getByTestId('proxy-setup-skeleton')
      await expect(skeleton).toBeVisible()
      await expect(skeleton).toHaveAttribute('aria-busy', 'true')
      await expect(skeleton.locator(':scope > div'), 'one row is drawn').toHaveCount(1)
      await expect(tab.getByRole('heading')).toHaveText([TITLE])
      await expect(tab.getByText(SUBTITLE, { exact: true })).toBeVisible()
      await expect(tab.getByRole('button'), 'no Cancel and no Save').toHaveCount(0)
      await expect(tab.getByRole('switch')).toHaveCount(0)

      setupRead.release()
      await expect(skeleton).toHaveCount(0)
      await expect(useProxySwitch(tab)).toHaveAttribute('aria-checked', 'false')
      await expectButtons(tab, { cancel: false, save: false })
    })

    await test.step('9. Proxy Blocks', async () => {
      await page.getByTestId('settings-nav-network-proxy-blocks').click()
      const tab = blocksTab(page)
      const skeleton = tab.getByTestId('proxy-blocks-skeleton')
      await expect(skeleton).toBeVisible()
      await expect(skeleton).toHaveAttribute('aria-busy', 'true')
      await expect(skeleton.locator(':scope > div'), 'one row is drawn').toHaveCount(1)
      await expect(tab.getByRole('heading')).toHaveText(['Proxy Blocks'])
      await expect(tab.getByRole('button')).toHaveCount(0)

      blocksRead.release()
      await expect(skeleton).toHaveCount(0)
      await expect(tab.getByRole('heading', { level: 3 })).toHaveCount(3)
    })
  })

  test('Proxy Blocks: a block name that is cut shows the whole name on hover, a name that fits has no tooltip', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/settings/network/proxy/blocks')
    const tab = blocksTab(page)
    await tab.getByRole('button', { name: NOT_APPLICABLE.title, exact: true }).click()
    const names = tab.getByTestId('proxy-block-name')
    await expect(names.first()).toBeVisible()

    const read = await names.evaluateAll((entries) =>
      entries.map((entry) => {
        const text = entry.querySelector('span') as HTMLElement
        return { name: entry.textContent ?? '', cut: text.scrollWidth - text.clientWidth > 1 }
      }),
    )
    const cut = read.find((entry) => entry.cut)
    const whole = read.find((entry) => !entry.cut)
    if (!cut || !whole) throw new Error(`this width needs one cut name and one whole name: ${JSON.stringify(read)}`)
    const cutName = names.filter({ hasText: exactly(cut.name) })
    const wholeName = names.filter({ hasText: exactly(whole.name) })

    await expect(wholeName, 'a name that fits is not a tooltip trigger').not.toHaveAttribute('data-state')
    await cutName.hover()
    const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
    await expect(tooltip.locator('[role="tooltip"]')).toHaveText(cut.name)
  })

  test('the Settings menu with Network and Proxy open scrolls on a short window, and its last entry opens', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1396, height: 560 })
    await openProxySetup(page)
    const menu = page.getByTestId('settings-nav')

    const room = await menu.evaluate((element) => ({ rows: element.scrollHeight, shown: element.clientHeight }))
    expect(room.rows, 'the open menu is taller than the window leaves it').toBeGreaterThan(room.shown)
    await expect(menu).toHaveCSS('overflow-y', 'auto')

    const about = page.getByTestId('settings-nav-about')
    await about.scrollIntoViewIfNeeded()
    await expect(about).toBeInViewport({ ratio: 1 })
    await about.click()
    await expect(page).toHaveURL(/\/settings\/about$/)
  })

  test('Source: an unpressed part shows a hover state, in both themes', async ({ page }) => {
    const tab = await openProxySetup(page)
    await useProxySwitch(tab).click()
    const unpressed = part(segmented(tab, SOURCE), CUSTOM_SOURCE)
    await expect(unpressed).toHaveAttribute('aria-pressed', 'false')

    await inBothThemes(page, async () => {
      await restPointer(page)
      await expect(unpressed).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const atRest = await unpressed.evaluate((element) => getComputedStyle(element).color)

      await unpressed.hover()
      await expect(unpressed).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(unpressed).not.toHaveCSS('color', atRest)
      await expect(unpressed, 'hovering presses nothing').toHaveAttribute('aria-pressed', 'false')
    })
  })
})
