/**
 * V-NET-SSH-FUNCTIONAL: Settings > Network > SSH Hosts, proven by real SSH runs
 * Design Decisions: NET-1, NET-2, NET-3, NET-4
 * REQ: REQ-4.5.14, REQ-4.7.16, REQ-4.7.17
 *
 * Every Settings change goes through the page (trash, Mass Action, Add Hosts by Detect from host
 * and by Paste lines, Lock, Default block action, Save, Cancel) and its effect is proven by a real
 * SSH Session Open run against the sshd services (`SSH_TARGET_HOST` on `SSH_MAIN_PORT`, and on
 * `SSH_NO_SFTP_PORT`, which the stack never trusts) and by `GET /network/ssh-hosts`. The policy
 * is also read from the stack's own config file and the hosts from `<data>/network/ssh_hosts.yaml`
 * (paths from `GET /server/status`). The network settings are reset and the stack's trusted hosts
 * re-seeded before and after every test.
 *
 * Pass Criteria:
 * 1. SSH-1: with the `SSH_MAIN_PORT` row trashed and saved, a Strict run is refused with exactly
 *    `SSH host key verification failed for {host}:{port}: the host is not in WAVE's trusted hosts
 *    list and the host key policy is 'strict'. Add it in Settings > Network > SSH Hosts` (run failed,
 *    Block failed, no Connected line); Detect from host on that port shows one ED25519 row with
 *    the host key's fingerprint, checked; Add stages it with Added "Unsaved"; Save stores it and
 *    the row shows the stored Added date; the same Strict run then connects (one hop, run passed).
 * 2. SSH-2: a trashed row comes back on Cancel (table and API, same id); Save and Cancel are
 *    disabled again; a Strict run still connects.
 * 3. SSH-3: Mass Action, the row's checkbox, "1 selected", the red Delete, then Save removes only
 *    that row (API keeps the other two); a Strict run is refused with the exact strict text; the
 *    host's line pasted back is checked, Add stages it as "Unsaved", Save stores it with its Added
 *    date, and the Strict run connects.
 * 4. SSH-4: Paste lines with a comment, a bad line and three key lines shows exactly
 *    `Line 2: not a known_hosts line` under the table; the new host's row is checked and can be
 *    unchecked and checked again; the trusted host reads "Already trusted" (muted) and the wrong key
 *    "Key changed" in the error color, both with disabled checkboxes; Add stages only the new host
 *    and Cancel drops it (nothing stored).
 * 5. SSH-5: Detect on a closed port shows exactly `Could not reach {host}:{port}: Connection refused`
 *    under the Host row, no rows, Add disabled; nothing is staged.
 * 6. SSH-6: an Accept New run to the untrusted port connects, and the reloaded page lists that port
 *    with today's Added date, the API `added` value formatted as the page formats dates.
 * 7. SSH-7: a pasted line for the untrusted port with the wrong key is staged, an Accept New run
 *    started through the API trusts the real key meanwhile, and Save shows the failure toast "Could
 *    Not Save SSH Hosts" with exactly `{host} port {port} already has a trusted ED25519 key; remove
 *    it before adding another`; the staged row stays and nothing is written.
 * 8. SSH-8: Lock on turns the default select from Accept New to Strict with Accept New disabled;
 *    after Save the reloaded page still shows that; an Accept New run to the untrusted port is
 *    refused with exactly the lock text (`... and trusted hosts are locked. Add it in Settings >
 *    Network > SSH Hosts`) and the API holds no entry for that port.
 * 9. SSH-9: Default block action Strict + Save: a newly dropped SSH Session Open shows Host Key
 *    Verification `strict` while a saved Accept New block keeps `accept-new`; Disabled + Save: a
 *    newly dropped block shows `disabled`.
 * 10. SSH-10: a network reset puts a saved Strict default back to Disabled (page, API and the
 *    stack's config file); a block dropped from the palette shows Host Key Verification `disabled`
 *    and is stored with it; given the untrusted port and the stack account it connects, and
 *    neither the API nor the page lists that port afterwards.
 * 11. SSH-11: Default block action Strict + Save writes `default_block_action: strict` into the
 *    stack's config file and nothing before Save; Lock on + Save writes `lock_trusted_hosts: true`;
 *    the trusted hosts file holds `hosts` and no `policy` key.
 * 12. SSH-12: with `<data>/network` read-only, Save of Strict plus a pasted host answers 500 with
 *    the failure toast "Could Not Save SSH Hosts" carrying the API's message; the config file still
 *    holds `default_block_action: disabled`, the trusted hosts file is unchanged, the select keeps
 *    Strict and the table keeps the "Unsaved" row; with the folder writable again the same Save
 *    stores the policy and the host.
 * 13. SSH-13: with `<data>/network/ssh_hosts.yaml` unreadable, a Strict run and an Accept New run
 *    fail before connecting with exactly `WAVE's trusted SSH hosts list {path} cannot be read:
 *    [Errno 13] Permission denied: '{path}'` and a Disabled run connects; the list holds what it
 *    held.
 */

import { createHash } from 'crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  NETCAT_CLOSED_PORT,
  SSH_MAIN_PORT,
  SSH_NO_FWD_PORT,
  SSH_NO_SFTP_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
} from '../../helpers/config'
import { dragPaletteItemToCanvas, expandPalette } from '../../helpers/canvas'
import { configSection, stackPaths, withMode } from '../../helpers/config-file'
import { enumTrigger, numberInput } from '../../helpers/config-sheet'
import { readFixture } from '../../helpers/element-types'
import { importFixtureTest, importValidateAndNavigate } from '../../helpers/fixture-import'
import { validateTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRunAnyVerdict, runTrackedTest, startRun } from '../../helpers/k8s-run'
import {
  escapeRegExp,
  expectConsoleLine,
  formatEntries,
  getLogEntries,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  resetNetworkSettings,
  SSH_HOST_KEY,
  STACK_TRUSTED_HOSTS,
  WRONG_HOST_KEY,
} from '../../helpers/network-settings'
import { setStringParam } from '../../helpers/param-config'
import { dropBelow, edgeOnCanvas, LANE_VIEWPORT, openLaneCanvas } from '../canvas-lanes/lanes-helpers'
import {
  closeConfig,
  deleteTest,
  expandGroup,
  openConfig,
  persistedValues,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'

// ---------------------------------------------------------------------------
// Targets and exact texts
// ---------------------------------------------------------------------------

const HOST = SSH_TARGET_HOST
const MAIN_PORT = Number(SSH_MAIN_PORT)
const NEW_PORT = Number(SSH_NO_SFTP_PORT)
const NO_FWD_PORT = Number(SSH_NO_FWD_PORT)
// The WAVE host's own loopback, where nothing listens on this port.
const CLOSED_HOST = '127.0.0.1'
const CLOSED_PORT = Number(NETCAT_CLOSED_PORT)

const strictRefusal = (port: number): string =>
  `SSH host key verification failed for ${HOST}:${port}: the host is not in WAVE's trusted hosts list ` +
  `and the host key policy is 'strict'. Add it in Settings > Network > SSH Hosts`
const lockRefusal = (port: number): string =>
  `SSH host key verification failed for ${HOST}:${port}: the host is not in WAVE's trusted hosts list ` +
  `and trusted hosts are locked. Add it in Settings > Network > SSH Hosts`
const unreadableList = (file: string): string =>
  `WAVE's trusted SSH hosts list ${file} cannot be read: [Errno 13] Permission denied: '${file}'`
const CONFLICT = `${HOST} port ${NEW_PORT} already has a trusted ED25519 key; remove it before adding another`
const SAVE_FAILED_TITLE = 'Could Not Save SSH Hosts'
const BAD_LINE_ERROR = 'Line 2: not a known_hosts line'
const CLOSED_ERROR = `Could not reach ${CLOSED_HOST}:${CLOSED_PORT}: Connection refused`
const CONNECTED = new RegExp(
  `^Connected to ${escapeRegExp(HOST)} \\(session ssh_session_[0-9a-f]{12}, 1 hop\\)( - SSH-2\\.0-.+)?$`,
)

/** `SHA256:` and the unpadded base64 digest of the key blob, as ssh-keygen prints it. */
function fingerprintOf(key: string): string {
  const blob = Buffer.from(key.split(' ')[1], 'base64')
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`
}

const HOST_FINGERPRINT = fingerprintOf(SSH_HOST_KEY)
const WRONG_FINGERPRINT = fingerprintOf(WRONG_HOST_KEY)

// ---------------------------------------------------------------------------
// Fixtures and runs
// ---------------------------------------------------------------------------

interface RunKind {
  file: string
  port: number
  /** The run's own console prefix. */
  prefix: string
  /** The SSH Session Open block's Name, which the failure line names (EXEC-26). */
  name: string
}

const STRICT_RUN: RunKind = {
  file: 'fixture-strict.json',
  port: MAIN_PORT,
  prefix: 'strict',
  name: 'Strict open',
}
const ACCEPT_NEW_RUN: RunKind = {
  file: 'fixture-accept-new.json',
  port: NEW_PORT,
  prefix: 'accept-new',
  name: 'Accept New open',
}
const DISABLED_RUN: RunKind = {
  file: 'fixture-disabled.json',
  port: NEW_PORT,
  prefix: 'disabled',
  name: 'Disabled open',
}

const NODE = { open: 'open', log: 'log-open', close: 'close', done: 'log-done' } as const

// `fixture-placed.json`: Start, then one Log with a free exit for the block the test drops.
const PLACED = { file: 'fixture-placed.json', anchor: 'log-start', line: 'placed-start' } as const

const created: string[] = []

function loadFixture(kind: RunKind): Record<string, unknown> {
  const fixture = readFixture(__dirname, kind.file)
  const open = fixture.workflow.nodes.find((node: { id: string }) => node.id === NODE.open)
  open.data.config.values.port = kind.port
  return fixture
}

interface CanvasRun {
  verdict: string | null
  entries: LogEntry[]
  text: string
}

/** Import the fixture, validate it (zero errors), open it on the canvas and run it to the end. */
async function runOnCanvas(page: Page, kind: RunKind, marker: string): Promise<CanvasRun> {
  const testId = await importValidateAndNavigate(page, loadFixture(kind), { injectSsh: true })
  created.push(testId)
  const status = await startRun(page)
  const { verdict } = await finishRunAnyVerdict(page, status, marker, 60_000)
  const entries = await getLogEntries(page)
  return { verdict, entries, text: formatEntries(entries) }
}

async function runConnects(page: Page, kind: RunKind): Promise<void> {
  const run = await runOnCanvas(page, kind, `${kind.prefix}-done`)
  expect(run.verdict, run.text).toBe('passed')
  expect(
    run.entries.some((entry) => entry.level === 'INFO' && CONNECTED.test(entry.message)),
    `the console must carry the Connected line.\n${run.text}`,
  ).toBe(true)
  expectConsoleLine(run.entries, 'INFO', `${kind.prefix} connected=True hops=1`)
  expectConsoleLine(run.entries, 'INFO', `${kind.prefix}-done closed=1`)
  for (const id of Object.values(NODE)) await expectNodeStatus(page, id, 'success')
}

async function runIsRefused(page: Page, kind: RunKind, refusal: string): Promise<void> {
  const run = await runOnCanvas(page, kind, refusal)
  expect(run.verdict, run.text).toBe('failed')
  expectConsoleLine(run.entries, 'ERROR', `Block '${kind.name}' failed: ${refusal}`)
  expect(
    run.entries.filter((entry) => entry.message.startsWith('Connected to')),
    `the refused block never connected.\n${run.text}`,
  ).toEqual([])
  await expectNodeStatus(page, NODE.open, 'failed')
  for (const id of [NODE.log, NODE.close, NODE.done]) {
    await expect(page.getByTestId(`workflow-node-${id}`)).not.toHaveAttribute('data-execution-status', 'success')
  }
}

// ---------------------------------------------------------------------------
// The trusted hosts as the API reads them back
// ---------------------------------------------------------------------------

interface TrustedHost {
  id: string
  host: string
  port: number
  key_type: string
  fingerprint: string
  added: string
}

interface SshHostsView {
  policy: { lock_trusted_hosts: boolean; default_block_action: string }
  hosts: TrustedHost[]
}

async function readSshHosts(request: APIRequestContext): Promise<SshHostsView> {
  const response = await request.get(`${BACKEND_URL}/network/ssh-hosts`)
  expect(response.ok(), `GET /network/ssh-hosts answered ${response.status()}`).toBeTruthy()
  return (await response.json()) as SshHostsView
}

function entriesFor(view: SshHostsView, host: string, port: number): TrustedHost[] {
  return view.hosts.filter((entry) => entry.host === host && entry.port === port)
}

// ---------------------------------------------------------------------------
// The policy in the stack's config file, the hosts in the data folder (REQ-4.7.17)
// ---------------------------------------------------------------------------

interface StackFiles {
  configFile: string
  networkFolder: string
  hostsFile: string
}

async function stackFiles(request: APIRequestContext): Promise<StackFiles> {
  const { configFile, dataFolder } = await stackPaths(request)
  const networkFolder = path.join(dataFolder, 'network')
  return { configFile, networkFolder, hostsFile: path.join(networkFolder, 'ssh_hosts.yaml') }
}

const policyLinesOf = (lock: boolean, action: string): string[] => [
  `    lock_trusted_hosts: ${lock}`,
  `    default_block_action: ${action}`,
]

/** The two `network.ssh_hosts` value lines as the config file holds them. */
function policyLines(configFile: string): string[] {
  return configSection(configFile, 'network')
    .split('\n')
    .filter((line) => /^\s+(lock_trusted_hosts|default_block_action):/.test(line))
}

/** The top-level keys of a YAML file written as a block mapping. */
function topLevelKeys(file: string): string[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .flatMap((line) => /^([A-Za-z_][\w-]*):/.exec(line)?.[1] ?? [])
}

// ---------------------------------------------------------------------------
// The SSH Hosts page
// ---------------------------------------------------------------------------

const SSH_HOSTS_PATH = '/settings/network/ssh-hosts'

const sshHostsTab = (page: Page): Locator => page.getByTestId('network-ssh-hosts-tab')
const pageButton = (page: Page, name: 'Save' | 'Cancel'): Locator =>
  sshHostsTab(page).getByRole('button', { name, exact: true })
const hostsTable = (page: Page): Locator => page.getByTestId('trusted-hosts-table')
const hostRows = (page: Page): Locator => hostsTable(page).getByTestId('host-row')
const lockSwitch = (page: Page): Locator => sshHostsTab(page).getByRole('switch', { name: 'Lock trusted hosts' })
const actionSelect = (page: Page): Locator =>
  sshHostsTab(page).getByRole('combobox', { name: 'Default block action' })

function hostRow(page: Page, host: string, port: number): Locator {
  return hostRows(page)
    .filter({ has: page.getByRole('cell', { name: host, exact: true }) })
    .filter({ has: page.getByRole('cell', { name: String(port), exact: true }) })
}

// Columns outside selection mode: Host, Port, Key type, Fingerprint, Added, trash.
const fingerprintCell = (row: Locator): Locator => row.getByRole('cell').nth(3)
const addedCell = (row: Locator): Locator => row.getByRole('cell').nth(4)

async function openSshHostsPage(page: Page, rows: number): Promise<void> {
  await page.goto(SSH_HOSTS_PATH)
  // Save appears once the first read has loaded (NET-1).
  await expect(pageButton(page, 'Save')).toBeVisible({ timeout: 15_000 })
  await expect(pageButton(page, 'Save')).toBeDisabled()
  await expect(pageButton(page, 'Cancel')).toBeDisabled()
  await expect(hostRows(page)).toHaveCount(rows)
}

async function savePage(page: Page): Promise<void> {
  const save = pageButton(page, 'Save')
  await expect(save).toBeEnabled()
  const written = page.waitForResponse(
    (response) => response.url().endsWith('/network/ssh-hosts') && response.request().method() === 'PATCH',
  )
  await save.click()
  const response = await written
  expect(response.status(), `PATCH /network/ssh-hosts answered ${await response.text()}`).toBe(200)
  await expect(save).toBeDisabled()
  await expect(pageButton(page, 'Cancel')).toBeDisabled()
}

async function chooseDefaultAction(page: Page, label: string): Promise<void> {
  await actionSelect(page).click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(actionSelect(page)).toHaveText(label)
}

async function trashRow(page: Page, host: string, port: number): Promise<void> {
  await hostRow(page, host, port).getByRole('button', { name: `Remove ${host}`, exact: true }).click()
  await expect(hostRow(page, host, port)).toHaveCount(0)
}

/** The Added date as the page renders it: the Time Zone setting's day, then its zone. */
async function shownDate(page: Page, iso: string): Promise<string> {
  return page.evaluate((value) => {
    const date = new Date(value)
    const utc = localStorage.getItem('wave.timezone') === 'utc'
    const day = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      ...(utc ? { timeZone: 'UTC' } : {}),
    }).format(date)
    const zone = utc
      ? 'UTC'
      : new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
          .formatToParts(date)
          .find((part) => part.type === 'timeZoneName')?.value
    return `${day} ${zone}`
  }, iso)
}

/** One stored entry for the host with the host key, and its row shows the stored Added date. */
async function expectSavedHostKey(page: Page, host: string, port: number): Promise<void> {
  const [stored, ...more] = entriesFor(await readSshHosts(page.request), host, port)
  expect(more, 'one entry for the host').toEqual([])
  expect(stored).toMatchObject({ key_type: 'ED25519', fingerprint: HOST_FINGERPRINT })
  await expect(addedCell(hostRow(page, host, port))).toHaveText(await shownDate(page, stored.added))
}

// ---------------------------------------------------------------------------
// The Add Hosts dialog (NET-4)
// ---------------------------------------------------------------------------

const addHostsDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Add Hosts' })
const keyRows = (dialog: Locator): Locator => dialog.getByTestId('key-row')
const dialogAdd = (dialog: Locator): Locator => dialog.getByTestId('edit-dialog-save')
const dialogErrors = (dialog: Locator): Locator => dialog.locator('p.text-error')

async function openAddHosts(page: Page): Promise<Locator> {
  await hostsTable(page).getByRole('button', { name: 'Add hosts', exact: true }).first().click()
  const dialog = addHostsDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Detect from host', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(dialogAdd(dialog)).toHaveText('Add')
  await expect(dialogAdd(dialog)).toBeDisabled()
  return dialog
}

async function detect(dialog: Locator, host: string, port: number): Promise<void> {
  await dialog.getByLabel('Host', { exact: true }).fill(host)
  await dialog.getByLabel('Port', { exact: true }).fill(String(port))
  await dialog.getByRole('button', { name: 'Detect', exact: true }).click()
}

async function pasteLines(page: Page, dialog: Locator, lines: string[]): Promise<void> {
  await dialog.getByRole('button', { name: 'Paste lines', exact: true }).click()
  await dialog.locator('.cm-content').click()
  await page.keyboard.insertText(lines.join('\n'))
}

async function addAndClose(dialog: Locator): Promise<void> {
  await expect(dialogAdd(dialog)).toBeEnabled()
  await dialogAdd(dialog).click()
  await expect(dialog).toBeHidden()
}

async function expectStaged(page: Page, host: string, port: number, fingerprint: string): Promise<void> {
  const row = hostRow(page, host, port)
  await expect(row).toHaveCount(1)
  await expect(fingerprintCell(row)).toHaveText(fingerprint)
  const unsaved = addedCell(row).getByText('Unsaved', { exact: true })
  await expect(unsaved).toBeVisible()
  await expect(unsaved).toHaveClass(/\btext-muted-foreground\b/)
  await expect(pageButton(page, 'Save')).toBeEnabled()
  await expect(pageButton(page, 'Cancel')).toBeEnabled()
}

// ---------------------------------------------------------------------------
// The SSH Session Open config sheet
// ---------------------------------------------------------------------------

async function workflowNodeIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node.getAttribute('data-testid') ?? '').replace('workflow-node-', '')),
    )
}

const SSH_SESSION_OPEN = { term: 'SSH Session Open', testId: 'palette-item-ssh-session-open' }

/** Drop an SSH Session Open from the palette and return the id of the block the drop made. */
async function dropSshSessionOpen(page: Page): Promise<string> {
  await expandPalette(page)
  const canvasBox = await page.getByTestId('workflow-canvas').boundingBox()
  expect(canvasBox, 'the canvas is laid out').toBeTruthy()
  const before = new Set(await workflowNodeIds(page))
  await dragPaletteItemToCanvas(page, SSH_SESSION_OPEN, {
    x: canvasBox!.width * 0.8,
    y: canvasBox!.height * 0.3,
  })
  const added = (await workflowNodeIds(page)).filter((id) => !before.has(id))
  expect(added, 'one SSH Session Open block was dropped').toHaveLength(1)
  return added[0]
}

async function expectHostKeyVerification(page: Page, nodeId: string, value: string): Promise<void> {
  const sheet = await openConfig(page, nodeId)
  await expandGroup(sheet, 'Advanced')
  await expect(enumTrigger(sheet, 'host_key_verification')).toHaveText(value)
  await closeConfig(sheet)
}

/** Point an open SSH Session Open sheet at `port` with the stack account, and apply it. */
async function fillConnection(page: Page, sheet: Locator, port: number): Promise<void> {
  await setStringParam(sheet, page, 'host', HOST)
  // Typed key by key: the first key replaces the gray default (FIELD-2).
  const box = numberInput(sheet, 'port')
  await box.click()
  await box.press('ControlOrMeta+a')
  await box.pressSequentially(String(port))
  await expect(box).toHaveValue(String(port))
  await setStringParam(sheet, page, 'username', SSH_STACK_USER)
  await setStringParam(sheet, page, 'password', SSH_STACK_PASSWORD)
  await saveConfig(sheet)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('V-NET-SSH-FUNCTIONAL: trusted SSH hosts built in Settings, proven by real SSH runs', () => {
  test.beforeEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test('SSH-1: a Strict block is refused before the host is trusted and connects after Detect, Add and Save', async ({
    page,
  }) => {
    await test.step('the seeded row is trashed and saved, so the host is no longer trusted', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await trashRow(page, HOST, MAIN_PORT)
      await savePage(page)
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length - 1)
      expect(entriesFor(await readSshHosts(page.request), HOST, MAIN_PORT)).toEqual([])
    })

    await test.step('a Strict run is refused with the exact strict text', async () => {
      await runIsRefused(page, STRICT_RUN, strictRefusal(MAIN_PORT))
    })

    await test.step('Detect from host finds the ED25519 key, checked; Add stages it as Unsaved', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length - 1)
      const dialog = await openAddHosts(page)
      await detect(dialog, HOST, MAIN_PORT)
      const rows = keyRows(dialog)
      await expect(rows).toHaveCount(1)
      await expect(rows.first().getByRole('cell').nth(1)).toHaveText('ED25519')
      await expect(rows.first().getByRole('cell').nth(2)).toHaveText(HOST_FINGERPRINT)
      const checkbox = rows.first().getByTestId('row-checkbox')
      await expect(checkbox).toBeEnabled()
      await expect(checkbox).toBeChecked()
      await expect(dialogErrors(dialog)).toHaveCount(0)
      await addAndClose(dialog)
      await expectStaged(page, HOST, MAIN_PORT, HOST_FINGERPRINT)
      expect(entriesFor(await readSshHosts(page.request), HOST, MAIN_PORT), 'nothing stored before Save').toEqual([])
    })

    await test.step('Save stores the host and the row shows its Added date', async () => {
      await savePage(page)
      await expectSavedHostKey(page, HOST, MAIN_PORT)
    })

    await test.step('the same Strict run now connects', async () => {
      await runConnects(page, STRICT_RUN)
    })
  })

  test('SSH-2: a trashed row comes back on Cancel and Strict still connects', async ({ page }) => {
    const seeded = entriesFor(await readSshHosts(page.request), HOST, MAIN_PORT)
    expect(seeded, 'the stack trusts the main host').toHaveLength(1)

    await test.step('trash stages the removal; Cancel brings the row back', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await trashRow(page, HOST, MAIN_PORT)
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length - 1)
      await expect(pageButton(page, 'Save')).toBeEnabled()
      await expect(pageButton(page, 'Cancel')).toBeEnabled()
      await pageButton(page, 'Cancel').click()
      await expect(hostRow(page, HOST, MAIN_PORT)).toHaveCount(1)
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length)
      await expect(pageButton(page, 'Save')).toBeDisabled()
      await expect(pageButton(page, 'Cancel')).toBeDisabled()
      expect(entriesFor(await readSshHosts(page.request), HOST, MAIN_PORT)).toEqual(seeded)
    })

    await test.step('a Strict run still connects', async () => {
      await runConnects(page, STRICT_RUN)
    })
  })

  test('SSH-3: Mass Action Delete and Save remove the host and Strict is refused; Paste lines and Save trust it again', async ({
    page,
  }) => {
    await test.step('Mass Action selects the row and the red Delete stages its removal', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await hostsTable(page)
        .getByRole('button', { name: 'Mass Action - click to enter selection mode', exact: true })
        .click()
      await hostRow(page, HOST, MAIN_PORT).getByTestId('row-checkbox').click()
      const counter = page.getByTestId('selection-counter')
      await expect(counter).toHaveText('1 selected')
      await counter.click()
      const remove = page.getByTestId('bulk-action-delete')
      await expect(remove).toHaveText('Delete')
      await expect(remove).toHaveClass(/\btext-error\b/)
      await remove.click()
      await expect(hostRow(page, HOST, MAIN_PORT)).toHaveCount(0)
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length - 1)
    })

    await test.step('Save removes only that host', async () => {
      await savePage(page)
      const view = await readSshHosts(page.request)
      expect(entriesFor(view, HOST, MAIN_PORT)).toEqual([])
      expect(entriesFor(view, HOST, NO_FWD_PORT), 'the other seeded host stays').toHaveLength(1)
      expect(view.hosts).toHaveLength(STACK_TRUSTED_HOSTS.length - 1)
    })

    await test.step('a Strict run is refused with the exact strict text', async () => {
      await runIsRefused(page, STRICT_RUN, strictRefusal(MAIN_PORT))
    })

    await test.step('Paste lines and Save trust the host again; the Strict run connects', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length - 1)
      const dialog = await openAddHosts(page)
      await pasteLines(page, dialog, [`[${HOST}]:${MAIN_PORT} ${SSH_HOST_KEY}`])
      await expect(keyRows(dialog)).toHaveCount(1)
      await expect(keyRows(dialog).first().getByTestId('row-checkbox')).toBeChecked()
      await addAndClose(dialog)
      await expectStaged(page, HOST, MAIN_PORT, HOST_FINGERPRINT)
      expect(entriesFor(await readSshHosts(page.request), HOST, MAIN_PORT), 'nothing stored before Save').toEqual([])
      await savePage(page)
      await expectSavedHostKey(page, HOST, MAIN_PORT)
      await runConnects(page, STRICT_RUN)
    })
  })

  test('SSH-4: Paste lines reports the bad line, keeps good rows checkable and marks known keys', async ({
    page,
  }) => {
    const dialog = await test.step('the pasted lines are read', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      const opened = await openAddHosts(page)
      await pasteLines(page, opened, [
        '# keys for the lab hosts',
        'HostName ci-02.lab.internal',
        `[${HOST}]:${NEW_PORT} ${SSH_HOST_KEY}`,
        `[${HOST}]:${MAIN_PORT} ${SSH_HOST_KEY}`,
        `[${HOST}]:${MAIN_PORT} ${WRONG_HOST_KEY}`,
      ])
      await expect(keyRows(opened)).toHaveCount(3)
      return opened
    })

    const [fresh, trusted, changed] = [0, 1, 2].map((index) => keyRows(dialog).nth(index))

    await test.step('the bad line is reported under the table', async () => {
      await expect(dialogErrors(dialog)).toHaveText([BAD_LINE_ERROR])
      const table = await dialog.getByRole('table').last().boundingBox()
      const error = await dialogErrors(dialog).first().boundingBox()
      expect(error!.y, 'the line error sits under the table').toBeGreaterThanOrEqual(table!.y + table!.height)
    })

    await test.step('the new host row is checked and checkable', async () => {
      await expect(fresh.getByRole('cell').nth(1)).toHaveText(HOST)
      await expect(fresh.getByRole('cell').nth(2)).toHaveText('ED25519')
      await expect(fresh.getByRole('cell').nth(3)).toHaveText(HOST_FINGERPRINT)
      const checkbox = fresh.getByTestId('row-checkbox')
      await expect(checkbox).toBeEnabled()
      await expect(checkbox).toBeChecked()
      await expect(dialogAdd(dialog)).toBeEnabled()
      await checkbox.click()
      await expect(checkbox).not.toBeChecked()
      await expect(dialogAdd(dialog), 'Add needs a checked row').toBeDisabled()
      await checkbox.click()
      await expect(checkbox).toBeChecked()
      await expect(dialogAdd(dialog)).toBeEnabled()
    })

    await test.step('the trusted key reads Already trusted (muted), the wrong key Key changed (error color)', async () => {
      const errorColor = await dialogErrors(dialog)
        .first()
        .evaluate((element) => getComputedStyle(element).color)

      const trustedMarker = trusted.getByText('Already trusted', { exact: true })
      await expect(trustedMarker).toHaveClass(/\btext-muted-foreground\b/)
      expect(await trustedMarker.evaluate((element) => getComputedStyle(element).color)).not.toBe(errorColor)

      const changedMarker = changed.getByText('Key changed', { exact: true })
      await expect(changed.getByRole('cell').nth(3)).toContainText(WRONG_FINGERPRINT)
      await expect(changedMarker).toHaveClass(/\btext-error\b/)
      await expect(changedMarker).toHaveCSS('color', errorColor)

      for (const row of [trusted, changed]) {
        const checkbox = row.getByTestId('row-checkbox')
        await expect(checkbox).toBeDisabled()
        await expect(checkbox).not.toBeChecked()
        await expect(checkbox).toHaveClass(/\bopacity-50\b/)
        await expect(checkbox).toHaveClass(/\bcursor-not-allowed\b/)
      }
    })

    await test.step('Add stages only the new host; Cancel drops it and nothing is stored', async () => {
      await addAndClose(dialog)
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length + 1)
      await expectStaged(page, HOST, NEW_PORT, HOST_FINGERPRINT)
      const main = hostRow(page, HOST, MAIN_PORT)
      await expect(main, 'the changed key was not added').toHaveCount(1)
      await expect(fingerprintCell(main)).toHaveText(HOST_FINGERPRINT)
      await pageButton(page, 'Cancel').click()
      await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length)
      await expect(hostRow(page, HOST, NEW_PORT)).toHaveCount(0)
      const view = await readSshHosts(page.request)
      expect(entriesFor(view, HOST, NEW_PORT)).toEqual([])
      expect(view.hosts).toHaveLength(STACK_TRUSTED_HOSTS.length)
    })
  })

  test('SSH-5: Detect on a closed port shows the reach failure under the Host row', async ({ page }) => {
    await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
    const dialog = await openAddHosts(page)
    await detect(dialog, CLOSED_HOST, CLOSED_PORT)

    const error = dialogErrors(dialog)
    await expect(error).toHaveText([CLOSED_ERROR])
    const hostInput = await dialog.getByLabel('Host', { exact: true }).boundingBox()
    const errorBox = await error.first().boundingBox()
    expect(errorBox!.y, 'the failure sits under the Host row').toBeGreaterThanOrEqual(hostInput!.y + hostInput!.height)
    await expect(keyRows(dialog)).toHaveCount(0)
    await expect(dialogAdd(dialog)).toBeDisabled()

    await dialog.getByTestId('edit-dialog-cancel').click()
    await expect(dialog).toBeHidden()
    await expect(hostRows(page)).toHaveCount(STACK_TRUSTED_HOSTS.length)
    await expect(pageButton(page, 'Save')).toBeDisabled()
  })

  test("SSH-6: an Accept New block trusts the new host and the page lists it with today's Added date", async ({
    page,
  }) => {
    await test.step('the host is not trusted yet', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await expect(hostRow(page, HOST, NEW_PORT)).toHaveCount(0)
      expect(entriesFor(await readSshHosts(page.request), HOST, NEW_PORT)).toEqual([])
    })

    await test.step('an Accept New run connects', async () => {
      await runConnects(page, ACCEPT_NEW_RUN)
    })

    await test.step("the reloaded page lists the host with today's Added date", async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length + 1)
      const [stored, ...more] = entriesFor(await readSshHosts(page.request), HOST, NEW_PORT)
      expect(more, 'one entry for the host').toEqual([])
      expect(stored).toMatchObject({ key_type: 'ED25519', fingerprint: HOST_FINGERPRINT })
      expect(stored.added.slice(0, 10), 'added today (UTC)').toBe(new Date().toISOString().slice(0, 10))
      const row = hostRow(page, HOST, NEW_PORT)
      await expect(row.getByRole('cell').nth(2)).toHaveText('ED25519')
      await expect(fingerprintCell(row)).toHaveText(HOST_FINGERPRINT)
      const shown = await shownDate(page, stored.added)
      expect(shown, 'the stored date is today in the page format').toBe(
        await shownDate(page, new Date().toISOString()),
      )
      await expect(addedCell(row)).toHaveText(shown)
    })
  })

  test('SSH-7: Save is refused with 409 when a block trusted the host while the page held another key', async ({
    page,
  }) => {
    await test.step('a pasted line with the wrong key is staged while the host is unknown', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      const dialog = await openAddHosts(page)
      await pasteLines(page, dialog, [`[${HOST}]:${NEW_PORT} ${WRONG_HOST_KEY}`])
      await expect(keyRows(dialog)).toHaveCount(1)
      await expect(keyRows(dialog).first().getByTestId('row-checkbox')).toBeChecked()
      await addAndClose(dialog)
      await expectStaged(page, HOST, NEW_PORT, WRONG_FINGERPRINT)
      expect(entriesFor(await readSshHosts(page.request), HOST, NEW_PORT)).toEqual([])
    })

    await test.step('an Accept New run started through the API trusts the real key meanwhile', async () => {
      const testId = await importFixtureTest(page, loadFixture(ACCEPT_NEW_RUN), { injectSsh: true })
      created.push(testId)
      const run = await runTrackedTest(page.request, testId, 60_000)
      const logs = await page.request.get(`${BACKEND_URL}/executions/${run.executionId}/logs?limit=1000`)
      expect(logs.ok(), `GET /executions/{id}/logs answered ${logs.status()}`).toBeTruthy()
      const entries = ((await logs.json()).data?.entries ?? []) as LogEntry[]
      const text = formatEntries(entries)
      expect(run.verdict, text).toBe('passed')
      expect(entries.some((entry) => CONNECTED.test(entry.message)), `Connected line.\n${text}`).toBe(true)
      expectConsoleLine(entries, 'INFO', `${ACCEPT_NEW_RUN.prefix} connected=True hops=1`)
      const [stored, ...more] = entriesFor(await readSshHosts(page.request), HOST, NEW_PORT)
      expect(more).toEqual([])
      expect(stored.fingerprint).toBe(HOST_FINGERPRINT)
    })

    await test.step('Save shows the conflict toast and keeps the staged row', async () => {
      const save = pageButton(page, 'Save')
      const written = page.waitForResponse(
        (response) => response.url().endsWith('/network/ssh-hosts') && response.request().method() === 'PATCH',
      )
      await save.click()
      expect((await written).status()).toBe(409)
      const toast = page.locator('[data-toast]').filter({ hasText: SAVE_FAILED_TITLE })
      await expect(toast).toBeVisible()
      await expect(toast.locator('div.font-semibold')).toHaveText(SAVE_FAILED_TITLE)
      await expect(toast.locator('div.text-sm').first()).toHaveText(CONFLICT)
      await expectStaged(page, HOST, NEW_PORT, WRONG_FINGERPRINT)
      const [stored, ...more] = entriesFor(await readSshHosts(page.request), HOST, NEW_PORT)
      expect(more, 'nothing was written').toEqual([])
      expect(stored.fingerprint).toBe(HOST_FINGERPRINT)
    })
  })

  test('SSH-8: Lock turns the default to Strict and an Accept New block is refused with the lock text', async ({
    page,
  }) => {
    const expectLocked = async (): Promise<void> => {
      await expect(lockSwitch(page)).toBeChecked()
      await expect(actionSelect(page)).toHaveText('Strict')
      await actionSelect(page).click()
      const options = page.getByRole('listbox').getByRole('option')
      await expect(options).toHaveText(['Strict', 'Accept New', 'Disabled'])
      await expect(options.filter({ hasText: 'Accept New' })).toBeDisabled()
      await expect(options.filter({ hasText: 'Strict' })).toBeEnabled()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('listbox')).toHaveCount(0)
    }

    await test.step('Lock on changes Accept New to Strict and disables Accept New (NET-2)', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await expect(lockSwitch(page)).not.toBeChecked()
      await chooseDefaultAction(page, 'Accept New')
      await lockSwitch(page).click()
      await expectLocked()
    })

    await test.step('Save stores Lock and Strict; the reloaded page shows them', async () => {
      await savePage(page)
      expect((await readSshHosts(page.request)).policy).toEqual({
        lock_trusted_hosts: true,
        default_block_action: 'strict',
      })
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await expectLocked()
    })

    await test.step('an Accept New run to an unknown host is refused with the lock text and adds nothing', async () => {
      await runIsRefused(page, ACCEPT_NEW_RUN, lockRefusal(NEW_PORT))
      const view = await readSshHosts(page.request)
      expect(entriesFor(view, HOST, NEW_PORT)).toEqual([])
      expect(view.hosts).toHaveLength(STACK_TRUSTED_HOSTS.length)
    })
  })

  test('SSH-9: a newly placed SSH Session Open takes the default block action; an existing block keeps its own', async ({
    page,
  }) => {
    await test.step('Default block action Strict is saved', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await chooseDefaultAction(page, 'Strict')
      await savePage(page)
      expect((await readSshHosts(page.request)).policy.default_block_action).toBe('strict')
    })

    await test.step('a dropped block shows strict; the saved Accept New block keeps accept-new', async () => {
      const testId = await importValidateAndNavigate(page, loadFixture(ACCEPT_NEW_RUN), { injectSsh: true })
      created.push(testId)
      const dropped = await dropSshSessionOpen(page)
      await expectHostKeyVerification(page, dropped, 'strict')
      await expectHostKeyVerification(page, NODE.open, 'accept-new')
    })

    await test.step('Default block action Disabled is saved', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await chooseDefaultAction(page, 'Disabled')
      await savePage(page)
      expect((await readSshHosts(page.request)).policy.default_block_action).toBe('disabled')
    })

    await test.step('a dropped block shows disabled', async () => {
      const testId = await importValidateAndNavigate(page, loadFixture(ACCEPT_NEW_RUN), { injectSsh: true })
      created.push(testId)
      const dropped = await dropSshSessionOpen(page)
      await expectHostKeyVerification(page, dropped, 'disabled')
      await expectHostKeyVerification(page, NODE.open, 'accept-new')
    })
  })

  test('SSH-10: after a reset the default is Disabled; a newly placed block connects to an unknown host and trusts nothing', async ({
    page,
  }) => {
    await page.setViewportSize(LANE_VIEWPORT)
    const files = await stackFiles(page.request)

    await test.step('a saved Strict default is back to Disabled after the network reset', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await chooseDefaultAction(page, 'Strict')
      await savePage(page)
      expect(policyLines(files.configFile)).toEqual(policyLinesOf(false, 'strict'))

      await resetNetworkSettings(BACKEND_URL)
      expect((await readSshHosts(page.request)).policy).toEqual({
        lock_trusted_hosts: false,
        default_block_action: 'disabled',
      })
      expect(policyLines(files.configFile), 'the reset writes the defaults to the config file').toEqual(
        policyLinesOf(false, 'disabled'),
      )
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await expect(lockSwitch(page)).not.toBeChecked()
      await expect(actionSelect(page)).toHaveText('Disabled')
    })

    const { testId, placed } = await test.step(
      'a block dropped from the palette shows Host Key Verification disabled and is stored with it',
      async () => {
        const id = await importFixtureTest(page, readFixture(__dirname, PLACED.file))
        created.push(id)
        await openLaneCanvas(page, id)
        const dropped = await dropBelow(page, PLACED.anchor, null, SSH_SESSION_OPEN)
        await expect(edgeOnCanvas(page, PLACED.anchor, dropped), 'the drop links the new block').toHaveCount(1)

        const sheet = await openConfig(page, dropped)
        await expandGroup(sheet, 'Advanced')
        await expect(enumTrigger(sheet, 'host_key_verification')).toHaveText('disabled')
        await fillConnection(page, sheet, NEW_PORT)
        await saveWorkbench(page)
        expect((await persistedValues(page.request, id))[dropped]).toMatchObject({
          host: HOST,
          port: NEW_PORT,
          username: SSH_STACK_USER,
          host_key_verification: 'disabled',
        })
        return { testId: id, placed: dropped }
      },
    )

    await test.step('the placed block connects to the untrusted port', async () => {
      const validation = await validateTest(page.request, testId, 'run')
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])
      const status = await startRun(page)
      const { verdict } = await finishRunAnyVerdict(page, status, 'Connected to', 60_000)
      const entries = await getLogEntries(page)
      const text = formatEntries(entries)
      expect(verdict, text).toBe('passed')
      expectConsoleLine(entries, 'INFO', PLACED.line)
      expect(
        entries.some((entry) => entry.level === 'INFO' && CONNECTED.test(entry.message)),
        `the console must carry the Connected line.\n${text}`,
      ).toBe(true)
      await expectNodeStatus(page, placed, 'success')
    })

    await test.step('the Trusted SSH Hosts table gains no row', async () => {
      const view = await readSshHosts(page.request)
      expect(entriesFor(view, HOST, NEW_PORT)).toEqual([])
      expect(view.hosts).toHaveLength(STACK_TRUSTED_HOSTS.length)
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await expect(hostRow(page, HOST, NEW_PORT)).toHaveCount(0)
    })
  })

  test('SSH-11: the policy is saved to the config file and never to the trusted hosts file', async ({ page }) => {
    const files = await stackFiles(page.request)

    await test.step('Default block action Strict reaches the config file on Save, not before', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await chooseDefaultAction(page, 'Strict')
      expect(policyLines(files.configFile), 'nothing is written before Save').toEqual(
        policyLinesOf(false, 'disabled'),
      )
      await savePage(page)
      expect(policyLines(files.configFile)).toEqual(policyLinesOf(false, 'strict'))
      expect(topLevelKeys(files.hostsFile), 'the trusted hosts file holds the hosts and no policy').toEqual(['hosts'])
    })

    await test.step('Lock on reaches the config file on Save', async () => {
      await lockSwitch(page).click()
      await expect(lockSwitch(page)).toBeChecked()
      await savePage(page)
      expect(policyLines(files.configFile)).toEqual(policyLinesOf(true, 'strict'))
      expect(topLevelKeys(files.hostsFile), 'the trusted hosts file holds the hosts and no policy').toEqual(['hosts'])
      expect((await readSshHosts(page.request)).policy).toEqual({
        lock_trusted_hosts: true,
        default_block_action: 'strict',
      })
    })
  })

  test('SSH-12: a Save that cannot write the trusted hosts file changes nothing, and stores both once it can', async ({
    page,
  }) => {
    const files = await stackFiles(page.request)
    const hostsBefore = fs.readFileSync(files.hostsFile, 'utf-8')
    const folderBefore = fs.readdirSync(files.networkFolder).sort()

    await test.step('Strict and a pasted host are staged', async () => {
      await openSshHostsPage(page, STACK_TRUSTED_HOSTS.length)
      await chooseDefaultAction(page, 'Strict')
      const dialog = await openAddHosts(page)
      await pasteLines(page, dialog, [`[${HOST}]:${NEW_PORT} ${SSH_HOST_KEY}`])
      await expect(keyRows(dialog)).toHaveCount(1)
      await expect(keyRows(dialog).first().getByTestId('row-checkbox')).toBeChecked()
      await addAndClose(dialog)
      await expectStaged(page, HOST, NEW_PORT, HOST_FINGERPRINT)
    })

    await test.step('with the network folder read-only, Save shows the failure toast', async () => {
      await withMode(files.networkFolder, 0o555, async () => {
        const written = page.waitForResponse(
          (response) => response.url().endsWith('/network/ssh-hosts') && response.request().method() === 'PATCH',
        )
        await pageButton(page, 'Save').click()
        const response = await written
        expect(response.status(), await response.text()).toBe(500)
        const message = (await response.json()).error.message as string
        test.info().annotations.push({ type: 'save failure message', description: message })
        const toast = page.locator('[data-toast]').filter({ hasText: SAVE_FAILED_TITLE })
        await expect(toast).toBeVisible()
        await expect(toast.locator('div.font-semibold')).toHaveText(SAVE_FAILED_TITLE)
        await expect(toast.locator('div.text-sm').first()).toHaveText(message)
      })
    })

    await test.step('neither file changed and the page keeps the staged changes', async () => {
      expect(policyLines(files.configFile), 'the config file still holds the previous default action').toEqual(
        policyLinesOf(false, 'disabled'),
      )
      expect(fs.readFileSync(files.hostsFile, 'utf-8'), 'the trusted hosts file is unchanged').toBe(hostsBefore)
      expect(fs.readdirSync(files.networkFolder).sort(), 'no file is left behind').toEqual(folderBefore)
      const view = await readSshHosts(page.request)
      expect(view.policy).toEqual({ lock_trusted_hosts: false, default_block_action: 'disabled' })
      expect(entriesFor(view, HOST, NEW_PORT)).toEqual([])
      await expect(actionSelect(page)).toHaveText('Strict')
      await expectStaged(page, HOST, NEW_PORT, HOST_FINGERPRINT)
    })

    await test.step('with the folder writable again, the same Save stores the policy and the host', async () => {
      await savePage(page)
      expect(policyLines(files.configFile)).toEqual(policyLinesOf(false, 'strict'))
      expect(topLevelKeys(files.hostsFile), 'the trusted hosts file holds the hosts and no policy').toEqual(['hosts'])
      await expectSavedHostKey(page, HOST, NEW_PORT)
    })
  })

  test('SSH-13: an unreadable trusted hosts list stops Strict and Accept New blocks before they connect; a Disabled block connects', async ({
    page,
  }) => {
    const files = await stackFiles(page.request)
    const refusal = unreadableList(files.hostsFile)

    await withMode(files.hostsFile, 0o000, async () => {
      await test.step('a Strict run fails before connecting with the exact read failure', async () => {
        await runIsRefused(page, STRICT_RUN, refusal)
      })

      await test.step('an Accept New run fails before connecting with the same text', async () => {
        await runIsRefused(page, ACCEPT_NEW_RUN, refusal)
      })

      await test.step('a Disabled run connects', async () => {
        await runConnects(page, DISABLED_RUN)
      })
    })

    await test.step('the readable list holds what it held', async () => {
      const view = await readSshHosts(page.request)
      expect(view.hosts).toHaveLength(STACK_TRUSTED_HOSTS.length)
      expect(entriesFor(view, HOST, NEW_PORT)).toEqual([])
    })
  })
})
