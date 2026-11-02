/**
 * V-NET-PAGES-FUNCTIONAL: Settings > Network page frame, Cancel and Save, the leave prompt and the Network and Proxy groups
 * Design Decisions: NET-1, NET-3, NET-10, SHELL-9, SETTINGS-1, SETTINGS-2, LIST-2
 * REQ: REQ-4.5.14, REQ-4.5.16, REQ-4.7.14, REQ-4.7.16, REQ-5.2.1.42, REQ-5.2.1.50
 *
 * Pass Criteria:
 * 1. On SSH Hosts and Certificates the app nav is visible, the window does not scroll (the document is as
 *    tall as the viewport), the scrolling part of the Settings content column scrolls on its own, and the
 *    Settings section list keeps its place while it does.
 * 2. At 1440x900 and 1440x640 with enough hosts to page, the SSH Hosts pagination sits as far from the
 *    bottom of the viewport as the /tests pagination does, and the hosts table body scrolls inside the page.
 * 3. On SSH Hosts, Certificates and Proxy Setup, freshly loaded: Cancel and Save are disabled and faded;
 *    one staged change enables both; Cancel disables both and restores the saved state; Save disables both
 *    and the change persists on reload. On Proxy Setup the change is a Custom proxy with an address and a
 *    port, and the saved proxy reads back over GET /network/proxy.
 * 4. With one staged change, another Settings section, an app nav item and browser Back each open
 *    "Unsaved changes" (Cancel, Discard, Save) while the page and URL stay; Cancel keeps the change;
 *    Discard drops it and arrives at the target; Save stores it and arrives at the target. A clean page
 *    leaves at once. Proxy Setup asks the same way when left for another Settings section and when left
 *    for Proxy Blocks, the page next to it in the Proxy group.
 * 5. The Network group and the Proxy group inside it keep the user's open or closed state across
 *    sections, across leaving Settings and across a page reload, for the browser session.
 */

import { generateKeyPairSync } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, CA_CERT_PEM, HTTP_TARGET_HOST, PROXY_PORT } from '../../helpers/config'
import { resetNetworkSettings } from '../../helpers/network-settings'

// ============================================================================
// API
// ============================================================================

interface TrustedHostRow {
  id: string
  host: string
}

interface SshHostsView {
  policy: { lock_trusted_hosts: boolean; default_block_action: string }
  hosts: TrustedHostRow[]
}

interface CertificateRow {
  id: string
  name: string
}

interface CertificatesView {
  additional: CertificateRow[]
}

interface ProxyView {
  enabled: boolean
  source: 'host' | 'custom'
  host: string
  port: number | null
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text}`)
  return (text ? JSON.parse(text) : undefined) as T
}

function sshString(data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([length, data])
}

/** A fresh ED25519 public key in OpenSSH form ("ssh-ed25519 <base64>"). */
function newEd25519Key(): string {
  const der = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' })
  const raw = der.subarray(der.length - 32)
  const blob = Buffer.concat([sshString(Buffer.from('ssh-ed25519')), sshString(raw)])
  return `ssh-ed25519 ${blob.toString('base64')}`
}

async function trustHosts(hosts: string[]): Promise<SshHostsView> {
  const add = hosts.map((host) => ({ host, port: 22, key_type: 'ED25519', key: newEd25519Key() }))
  return api<SshHostsView>('PATCH', '/network/ssh-hosts', { add })
}

/** Enough hosts that the 10-row table pages. */
async function trustManyHosts(): Promise<number> {
  const names = Array.from({ length: 30 }, (_, i) => `net-pages-${String(i + 1).padStart(2, '0')}.example.test`)
  const view = await trustHosts(names)
  return view.hosts.length
}

async function createListedTest(): Promise<string> {
  const body = await api<{ data?: { id: string }; id?: string }>('POST', '/tests', {
    name: `V-NET-PAGES pagination ${Date.now()}`,
    version: '1.0.0',
    description: 'Gives /tests a row so its pagination shows',
    workflow: { nodes: [], edges: [] },
    variables: {},
  })
  const id = body.data?.id ?? body.id
  if (!id) throw new Error('POST /tests returned no id')
  return id
}

// ============================================================================
// Page model
// ============================================================================

interface NetworkPage {
  title: string
  path: string
  navTestId: string
  /** The page's menu item sits in the Proxy group inside Network (NET-10). */
  inProxyGroup?: boolean
  tab(page: Page): Locator
  waitLoaded(page: Page): Promise<void>
}

const SSH_HOSTS: NetworkPage = {
  title: 'SSH Hosts',
  path: '/settings/network/ssh-hosts',
  navTestId: 'settings-nav-network-ssh-hosts',
  tab: (page) => page.getByTestId('network-ssh-hosts-tab'),
  waitLoaded: async (page) => {
    await expect(lockSwitch(page)).toBeVisible()
    await expect(hostsTable(page).getByTestId('pagination-item-count')).toBeVisible()
  },
}

const CERTIFICATES: NetworkPage = {
  title: 'Certificates',
  path: '/settings/network/certificates',
  navTestId: 'settings-nav-network-certificates',
  tab: (page) => page.getByTestId('network-certificates-tab'),
  waitLoaded: async (page) => {
    await expect(
      page.getByRole('radiogroup', { name: 'Public Certificate Authorities', exact: true }),
    ).toBeVisible()
    await expect(page.getByTestId('public-authorities-skeleton')).toHaveCount(0)
  },
}

const PROXY_SETUP: NetworkPage = {
  title: 'Proxy Setup',
  path: '/settings/network/proxy/setup',
  navTestId: 'settings-nav-network-proxy-setup',
  inProxyGroup: true,
  tab: (page) => page.getByTestId('network-proxy-setup-tab'),
  waitLoaded: async (page) => {
    await expect(useProxySwitch(page)).toBeVisible()
    await expect(page.getByTestId('proxy-setup-skeleton')).toHaveCount(0)
  },
}

const PROXY_BLOCKS_PATH = '/settings/network/proxy/blocks'

const lockSwitch = (page: Page) =>
  SSH_HOSTS.tab(page).getByRole('switch', { name: 'Lock trusted hosts', exact: true })
const hostsTable = (page: Page) => page.getByTestId('trusted-hosts-table')
const additionalTable = (page: Page) => page.getByTestId('additional-certificates-table')
const useProxySwitch = (page: Page) =>
  PROXY_SETUP.tab(page).getByRole('switch', { name: 'Use a proxy', exact: true })
const customSource = (page: Page) =>
  PROXY_SETUP.tab(page)
    .getByRole('group', { name: 'Source', exact: true })
    .getByRole('button', { name: 'Custom', exact: true })
const proxyHostInput = (page: Page) => PROXY_SETUP.tab(page).locator('input[name="proxy-host"]')
const proxyPortInput = (page: Page) => PROXY_SETUP.tab(page).locator('input[name="proxy-port"]')
const sidebar = (page: Page) => page.getByTestId('sidebar')
const sidebarLink = (page: Page, name: string) =>
  sidebar(page).getByRole('link', { name, exact: true })
const sectionList = (page: Page) => page.getByTestId('settings-sections')
const networkTrigger = (page: Page) =>
  sectionList(page).getByRole('button', { name: 'Network', exact: true })
const proxyTrigger = (page: Page) =>
  sectionList(page)
    .getByRole('group', { name: 'Network', exact: true })
    .getByRole('button', { name: 'Proxy', exact: true })
const leaveDialog = (page: Page) => page.getByTestId('leave-unsaved-dialog')

function urlOf(path: string): RegExp {
  return new RegExp(`${path.replace(/\//g, '\\/')}$`)
}

function headerActions(page: Page, target: NetworkPage) {
  const tab = target.tab(page)
  return {
    cancel: tab.getByRole('button', { name: 'Cancel', exact: true }),
    save: tab.getByRole('button', { name: 'Save', exact: true }),
  }
}

async function expectActionsDisabled(page: Page, target: NetworkPage): Promise<void> {
  for (const button of Object.values(headerActions(page, target))) {
    await expect(button).toBeDisabled()
    await expect(button).toHaveCSS('opacity', '0.5')
  }
}

async function expectActionsEnabled(page: Page, target: NetworkPage): Promise<void> {
  for (const button of Object.values(headerActions(page, target))) {
    await expect(button).toBeEnabled()
    await expect(button).toHaveCSS('opacity', '1')
  }
}

async function expandGroup(trigger: Locator): Promise<void> {
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
}

/** Opens the menu groups that hold the page's item, then clicks it. */
async function openFromMenu(page: Page, target: NetworkPage): Promise<void> {
  await expandGroup(networkTrigger(page))
  if (target.inProxyGroup) await expandGroup(proxyTrigger(page))
  await page.getByTestId(target.navTestId).click()
  await expect(page).toHaveURL(urlOf(target.path))
  await target.waitLoaded(page)
}

/** Lands on General by URL, then opens the page in-app, so browser Back has General behind it. */
async function openFromGeneral(page: Page, target: NetworkPage): Promise<void> {
  await page.goto('/settings')
  await expect(page.getByTestId('settings-nav-general')).toHaveAttribute('aria-current', 'page')
  await openFromMenu(page, target)
}

/** Back to the page in-app from wherever the last exit landed. */
async function returnInApp(page: Page, target: NetworkPage): Promise<void> {
  if (!/\/settings(\/|$)/.test(new URL(page.url()).pathname)) {
    await sidebarLink(page, 'Settings').click()
    await expect(page).toHaveURL(/\/settings$/)
  }
  await openFromMenu(page, target)
}

// ============================================================================
// Staged changes
// ============================================================================

interface StagedChange {
  /** One staged edit through the page's own controls. */
  stage(page: Page): Promise<void>
  /** The page shows the edit, staged or saved. */
  expectShown(page: Page): Promise<void>
  /** The page shows the saved state without the edit. */
  expectNotShown(page: Page): Promise<void>
  /** The saved settings, read back through the API, hold the edit. */
  isSaved(): Promise<boolean>
}

interface ChangeKind {
  title: string
  target: NetworkPage
  prepare(): Promise<StagedChange>
}

const LOCK_ON: ChangeKind = {
  title: 'Lock trusted hosts on',
  target: SSH_HOSTS,
  prepare: async () => ({
    stage: async (page) => {
      await lockSwitch(page).click()
      await expect(lockSwitch(page)).toBeChecked()
    },
    expectShown: async (page) => expect(lockSwitch(page)).toBeChecked(),
    expectNotShown: async (page) => expect(lockSwitch(page)).not.toBeChecked(),
    isSaved: async () =>
      (await api<SshHostsView['policy']>('GET', '/network/ssh-hosts/policy')).lock_trusted_hosts,
  }),
}

const HOST_REMOVED: ChangeKind = {
  title: 'a trusted host removed',
  target: SSH_HOSTS,
  prepare: async () => {
    const host = 'net-pages-staged.example.test'
    const view = await trustHosts([host])
    const saved = view.hosts.find((row) => row.host === host)
    if (!saved) throw new Error(`${host} missing after PATCH /network/ssh-hosts`)
    const row = (page: Page) => hostsTable(page).locator(`[data-row-id="${saved.id}"]`)
    return {
      stage: async (page) => {
        await hostsTable(page).getByRole('button', { name: `Remove ${host}`, exact: true }).click()
        await expect(row(page)).toHaveCount(0)
      },
      expectShown: async (page) => expect(row(page)).toHaveCount(0),
      expectNotShown: async (page) => expect(row(page)).toBeVisible(),
      isSaved: async () =>
        !(await api<SshHostsView>('GET', '/network/ssh-hosts')).hosts.some((h) => h.id === saved.id),
    }
  },
}

const CERTIFICATE_REMOVED: ChangeKind = {
  title: 'an additional certificate removed',
  target: CERTIFICATES,
  prepare: async () => {
    const view = await api<CertificatesView>('PATCH', '/network/certificates', { add: [CA_CERT_PEM], remove: [] })
    expect(view.additional, 'one seeded additional certificate').toHaveLength(1)
    const [saved] = view.additional
    const row = (page: Page) => additionalTable(page).locator(`[data-row-id="${saved.id}"]`)
    return {
      stage: async (page) => {
        await additionalTable(page).getByRole('button', { name: `Remove ${saved.name}`, exact: true }).click()
        await expect(row(page)).toHaveCount(0)
      },
      expectShown: async (page) => expect(row(page)).toHaveCount(0),
      expectNotShown: async (page) => expect(row(page)).toBeVisible(),
      isSaved: async () =>
        !(await api<CertificatesView>('GET', '/network/certificates')).additional.some((c) => c.id === saved.id),
    }
  },
}

const PROXY_CUSTOM: ChangeKind = {
  title: 'a Custom proxy with an address and a port',
  target: PROXY_SETUP,
  prepare: async () => ({
    stage: async (page) => {
      await useProxySwitch(page).click()
      await customSource(page).click()
      await proxyHostInput(page).fill(HTTP_TARGET_HOST)
      await proxyPortInput(page).fill(PROXY_PORT)
      // Save is offered once the backend has checked the staged proxy (REQ-4.7.14).
      await expect(headerActions(page, PROXY_SETUP).save).toBeEnabled()
    },
    expectShown: async (page) => {
      await expect(useProxySwitch(page)).toBeChecked()
      await expect(customSource(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(proxyHostInput(page)).toHaveValue(HTTP_TARGET_HOST)
      await expect(proxyPortInput(page)).toHaveValue(PROXY_PORT)
    },
    expectNotShown: async (page) => {
      await expect(useProxySwitch(page)).not.toBeChecked()
      await expect(proxyHostInput(page)).toHaveCount(0)
    },
    isSaved: async () => {
      const proxy = await api<ProxyView>('GET', '/network/proxy')
      return (
        proxy.enabled &&
        proxy.source === 'custom' &&
        proxy.host === HTTP_TARGET_HOST &&
        proxy.port === Number(PROXY_PORT)
      )
    },
  }),
}

// ============================================================================
// Exits
// ============================================================================

interface Exit {
  title: string
  target: RegExp
  leave(page: Page): Promise<void>
  /** The page the target shows, checked beside its URL. */
  shows?(page: Page): Locator
}

const SECTION_EXIT: Exit = {
  title: 'another Settings section',
  target: /\/settings$/,
  leave: (page) => page.getByTestId('settings-nav-general').click(),
}

const EXITS: Exit[] = [
  SECTION_EXIT,
  {
    title: 'an app nav item',
    target: /\/dashboard$/,
    leave: (page) => sidebarLink(page, 'Dashboard').click(),
  },
  {
    title: 'browser Back',
    target: /\/settings$/,
    leave: (page) => page.evaluate(() => window.history.back()),
  },
]

/** Proxy Blocks sits beside Proxy Setup in the Proxy group and holds nothing to save (NET-10). */
const PROXY_BLOCKS_EXIT: Exit = {
  title: 'the Proxy Blocks page',
  target: urlOf(PROXY_BLOCKS_PATH),
  leave: (page) => page.getByTestId('settings-nav-network-proxy-blocks').click(),
  shows: (page) => page.getByTestId('network-proxy-blocks-tab'),
}

interface LeaveCase {
  kind: ChangeKind
  exits: Exit[]
}

const LEAVE_CASES: LeaveCase[] = [
  { kind: LOCK_ON, exits: EXITS },
  { kind: CERTIFICATE_REMOVED, exits: EXITS },
  { kind: PROXY_CUSTOM, exits: [SECTION_EXIT, PROXY_BLOCKS_EXIT] },
]

/** The exit's target is showing and no prompt is left. */
async function expectArrived(page: Page, exit: Exit): Promise<void> {
  await expect(page).toHaveURL(exit.target)
  await expect(leaveDialog(page)).toHaveCount(0)
  if (exit.shows) await expect(exit.shows(page)).toBeVisible()
}

// ============================================================================
// Menu groups
// ============================================================================

interface MenuGroup {
  title: string
  /** A page of the group: showing it opens the group. */
  page: NetworkPage
  trigger(page: Page): Locator
}

const MENU_GROUPS: MenuGroup[] = [
  { title: 'Network', page: SSH_HOSTS, trigger: networkTrigger },
  { title: 'Proxy', page: PROXY_SETUP, trigger: proxyTrigger },
]

/** The leave prompt is up, the page and its URL stayed, and it offers exactly Cancel, Discard and Save. */
async function expectLeavePrompt(page: Page, target: NetworkPage): Promise<Locator> {
  const dialog = leaveDialog(page)
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible()
  await expect(dialog.getByTestId('leave-unsaved-cancel')).toHaveText('Cancel')
  await expect(dialog.getByTestId('leave-unsaved-discard')).toHaveText('Discard')
  await expect(dialog.getByTestId('leave-unsaved-save')).toHaveText('Save')
  await expect(page).toHaveURL(urlOf(target.path))
  await expect(target.tab(page)).toBeVisible()
  return dialog
}

// ============================================================================
// Scrolling
// ============================================================================

interface WindowMetrics {
  documentHeight: number
  viewportHeight: number
  scrollY: number
}

function windowMetrics(page: Page): Promise<WindowMetrics> {
  return page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    scrollY: window.scrollY,
  }))
}

async function expectWindowStill(page: Page): Promise<void> {
  const metrics = await windowMetrics(page)
  expect(metrics.documentHeight, 'document height equals the viewport').toBe(metrics.viewportHeight)
  expect(metrics.scrollY, 'the window never scrolled').toBe(0)
}

/** The hosts table's own scroll box: the element that holds the table and its sticky header. */
const hostsTableBody = (page: Page) =>
  hostsTable(page).getByRole('table', { name: 'Hosts', exact: true }).locator('xpath=..')

function scrollTop(target: Locator): Promise<number> {
  return target.evaluate((el) => el.scrollTop)
}

async function expectOverflows(target: Locator, what: string): Promise<void> {
  const { scrollHeight, clientHeight } = await target.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(scrollHeight, `${what} holds more than it shows`).toBeGreaterThan(clientHeight)
}

/** Wheel over the area, then expect the area alone to have scrolled while the given boxes kept their place. */
async function wheelScrolls(page: Page, area: Locator, scroller: Locator, still: Locator[]): Promise<void> {
  const before = await Promise.all(still.map((box) => box.boundingBox()))
  expect(await scrollTop(scroller)).toBe(0)
  const box = await area.boundingBox()
  if (!box) throw new Error('scroll area has no box')
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120))
  await page.mouse.wheel(0, 400)
  await expect.poll(() => scrollTop(scroller)).toBeGreaterThan(0)
  await expectWindowStill(page)
  const after = await Promise.all(still.map((locator) => locator.boundingBox()))
  expect(after).toEqual(before)
}

async function gapBelow(page: Page, target: Locator): Promise<number> {
  const box = await target.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error('no box or viewport to measure')
  return viewport.height - (box.y + box.height)
}

// ============================================================================
// Tests
// ============================================================================

test.describe('V-NET-PAGES-FUNCTIONAL: Settings > Network pages', () => {
  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.describe('1. the app shell holds both Network pages', () => {
    test('SSH Hosts: app nav shown, window still, the hosts table scrolls inside the content column', async ({ page }) => {
      await trustManyHosts()
      await page.goto(SSH_HOSTS.path)
      await SSH_HOSTS.waitLoaded(page)

      await expect(sidebar(page)).toBeVisible()
      await expect(sidebarLink(page, 'Dashboard')).toBeVisible()
      await expectWindowStill(page)

      const body = hostsTableBody(page)
      await expectOverflows(body, 'the hosts table body')
      await expect(page.getByTestId('settings-content').getByRole('table', { name: 'Hosts', exact: true })).toBeVisible()
      await wheelScrolls(page, body, body, [sectionList(page), hostsTable(page).getByTestId('pagination')])
    })

    test('Certificates: app nav shown, window still, the content column scrolls on its own', async ({ page }) => {
      await page.goto(CERTIFICATES.path)
      await CERTIFICATES.waitLoaded(page)

      await expect(sidebar(page)).toBeVisible()
      await expect(sidebarLink(page, 'Dashboard')).toBeVisible()
      await expectWindowStill(page)

      const column = page.getByTestId('settings-content')
      await expectOverflows(column, 'the Settings content column')
      const choice = page.getByRole('radiogroup', { name: 'Public Certificate Authorities', exact: true })
      await wheelScrolls(page, choice, column, [sectionList(page)])
    })
  })

  test('2. the SSH Hosts pagination sits where the /tests pagination does, at 1440x900 and 1440x640', async ({ page }) => {
    const total = await trustManyHosts()
    const testId = await createListedTest()
    try {
      for (const height of [900, 640]) {
        await page.setViewportSize({ width: 1440, height })

        await page.goto('/tests')
        const testsPagination = page.getByTestId('tests-table').getByTestId('pagination')
        await expect(testsPagination.getByTestId('pagination-item-count')).toBeVisible()
        const testsGap = await gapBelow(page, testsPagination)

        await page.goto(SSH_HOSTS.path)
        await SSH_HOSTS.waitLoaded(page)
        const pagination = hostsTable(page).getByTestId('pagination')
        await expect(pagination.getByTestId('pagination-item-count')).toHaveText(`Showing 1-10 of ${total} hosts`)
        const hostsGap = await gapBelow(page, pagination)

        expect(testsGap, `/tests pagination is inside the ${height}px viewport`).toBeGreaterThanOrEqual(0)
        expect(
          Math.abs(hostsGap - testsGap),
          `at 1440x${height} SSH Hosts pagination is ${hostsGap}px above the bottom, /tests is ${testsGap}px`,
        ).toBeLessThanOrEqual(1)

        const body = hostsTableBody(page)
        await expectOverflows(body, `the hosts table body at 1440x${height}`)
        await wheelScrolls(page, body, body, [pagination, sectionList(page)])
      }
    } finally {
      await api('DELETE', `/tests/${testId}`)
    }
  })

  for (const kind of [LOCK_ON, HOST_REMOVED, CERTIFICATE_REMOVED, PROXY_CUSTOM]) {
    test(`3. ${kind.target.title} (${kind.title}): Cancel and Save stay disabled until a change, and after Cancel or Save`, async ({ page }) => {
      const target = kind.target
      const change = await kind.prepare()
      await page.goto(target.path)
      await target.waitLoaded(page)
      await change.expectNotShown(page)
      await expectActionsDisabled(page, target)

      await change.stage(page)
      await expectActionsEnabled(page, target)

      await headerActions(page, target).cancel.click()
      await expectActionsDisabled(page, target)
      await change.expectNotShown(page)
      expect(await change.isSaved()).toBe(false)

      await change.stage(page)
      await expectActionsEnabled(page, target)
      await headerActions(page, target).save.click()
      await expectActionsDisabled(page, target)
      await change.expectShown(page)
      await expect.poll(() => change.isSaved()).toBe(true)

      await page.reload()
      await target.waitLoaded(page)
      await change.expectShown(page)
      await expectActionsDisabled(page, target)
    })
  }

  for (const { kind, exits } of LEAVE_CASES) {
    const target = kind.target
    for (const exit of exits) {
      test(`4. ${target.title}: ${exit.title} with a staged change asks first; Cancel keeps, Discard drops, Save stores`, async ({ page }) => {
        const change = await kind.prepare()
        await openFromGeneral(page, target)
        await change.expectNotShown(page)
        await change.stage(page)

        await exit.leave(page)
        let dialog = await expectLeavePrompt(page, target)
        await dialog.getByTestId('leave-unsaved-cancel').click()
        await expect(leaveDialog(page)).toHaveCount(0)
        await expect(page).toHaveURL(urlOf(target.path))
        await change.expectShown(page)
        await expectActionsEnabled(page, target)

        await exit.leave(page)
        dialog = await expectLeavePrompt(page, target)
        await dialog.getByTestId('leave-unsaved-discard').click()
        await expectArrived(page, exit)
        expect(await change.isSaved()).toBe(false)
        await returnInApp(page, target)
        await change.expectNotShown(page)
        await expectActionsDisabled(page, target)

        await change.stage(page)
        await exit.leave(page)
        dialog = await expectLeavePrompt(page, target)
        await dialog.getByTestId('leave-unsaved-save').click()
        await expectArrived(page, exit)
        await expect.poll(() => change.isSaved()).toBe(true)

        await page.goto(target.path)
        await target.waitLoaded(page)
        await change.expectShown(page)
        await expectActionsDisabled(page, target)
      })
    }

    test(`4. ${target.title}: a clean page leaves at once by every exit`, async ({ page }) => {
      await openFromGeneral(page, target)
      await expectActionsDisabled(page, target)
      for (const exit of exits) {
        await exit.leave(page)
        await expectArrived(page, exit)
        await returnInApp(page, target)
      }
    })
  }

  for (const group of MENU_GROUPS) {
    test(`5. the ${group.title} group stays as the user left it for the browser session`, async ({ page }) => {
      const trigger = group.trigger(page)
      const item = page.getByTestId(group.page.navTestId)
      const expectOpen = async () => {
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        await expect(item).toBeVisible()
      }
      const expectClosed = async () => {
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await expect(item).toBeHidden()
      }
      const leaveSettingsAndReturn = async () => {
        await sidebarLink(page, 'Dashboard').click()
        await expect(page).toHaveURL(/\/dashboard$/)
        await sidebarLink(page, 'Settings').click()
        await expect(page).toHaveURL(/\/settings$/)
      }
      const reloadOnGeneral = async () => {
        await page.reload()
        await expect(page.getByTestId('settings-nav-general')).toHaveAttribute('aria-current', 'page')
      }

      await page.goto(group.page.path)
      await group.page.waitLoaded(page)
      await expectOpen()

      await page.getByTestId('settings-nav-mcp').click()
      await expect(page).toHaveURL(/\/settings\/mcp$/)
      await expectOpen()

      await trigger.click()
      await expectClosed()
      await leaveSettingsAndReturn()
      await expectClosed()
      await reloadOnGeneral()
      await expectClosed()

      await trigger.click()
      await expectOpen()
      await leaveSettingsAndReturn()
      await expectOpen()
      await reloadOnGeneral()
      await expectOpen()
    })
  }
})
