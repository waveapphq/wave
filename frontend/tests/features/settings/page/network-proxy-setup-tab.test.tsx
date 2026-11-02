/**
 * NetworkProxySetupTab Component Tests
 *
 * REQ-4.7.14 / REQ-4.7.16 / REQ-5.2.1.42 (NET-10): the Proxy Setup page driven
 * through a UseProxySettingsResult prop - the first read pending and failed, the
 * proxy off, the WAVE host's settings, Custom with its rows, the stored and the
 * typed password, staging, Cancel and Save, the check messages and saving.
 *
 * Component under test: frontend/src/features/settings/page/network-proxy-setup-tab.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ProxyEntry, ProxyProblem, ProxySettings } from '@/features/settings/api/proxy'
import type {
  ProxyStaged,
  UseProxySettingsResult,
} from '@/features/settings/container/use-proxy-settings'
import { NetworkProxySetupTab } from '@/features/settings/page/network-proxy-setup-tab'

type Proxy = UseProxySettingsResult

const PAGE = 'network-proxy-setup-tab'
const SKELETON = 'proxy-setup-skeleton'

const TITLE = 'Proxy Setup'
const TITLE_LINE =
  'For web requests (HTTP and HTTPS) made from the WAVE host. Your browser and blocks on a remote host do not use it.'
const SEALED_HELP = 'Stored sealed; shown write-only like other credentials.'
const SOURCE_HOST = "WAVE host's settings"
const SOURCE_CUSTOM = 'Custom'
const MODE_EXCEPT = 'All addresses except the list'
const MODE_ONLY = 'Only the addresses in the list'
const LOCAL_LABEL = 'Use the proxy for local addresses too'
const NOT_SET = 'Not set'
const CONFIRM_TITLE = 'Edit Protected Value?'

const CUSTOM_LABELS = [
  'Use a proxy',
  'Source',
  'IP or Hostname',
  'Port',
  'Username',
  'Password',
  'Use the proxy for',
  LOCAL_LABEL,
]

const HOST_NOT_AN_ADDRESS =
  'IP or Hostname must be an IP address or a host name, with no protocol and no port'
const PORT_REQUIRED = 'Port is required when the source is Custom'
const PORT_RANGE = 'Port must be a whole number from 1 to 65535'
const USERNAME_REQUIRED = 'Username is required when a proxy password is set'
const SECRET_TOO_LONG = 'Password must be 255 characters or fewer'
const TRAILING_SLASH = 'Remove everything after the host and port'
const SAME_ADDRESS = 'The same address as entry 1'
const BAD_PATTERN =
  'Not a valid regular expression: missing ), unterminated subpattern at position 15'
const LIST_EMPTY = 'Add at least one address, or choose "All addresses except the list"'
const LIST_TOO_LONG = 'The address list holds at most 100 entries'
const HOST_HAS_NO_PROXY =
  'This WAVE host has no HTTPS_PROXY or HTTP_PROXY set: choose Custom or turn the proxy off'

const LOAD_ERROR = 'Failed to fetch'
const TYPED_VALUE = 'hunter2'

const HOST_VALUES: ProxySettings['host_values'] = {
  https_proxy: 'http://svc-wave:********@proxy.corp.example:3128',
  http_proxy: 'http://proxy.corp.example:8080',
  no_proxy: '.corp.example,localhost',
}

const REGISTRY: ProxyEntry = { kind: 'exact', address: 'https://registry.corp.example' }
const CLUSTER: ProxyEntry = { kind: 'regex', address: String.raw`\.cluster\.local(:\d+)?$` }
const NEW_ROW: ProxyEntry = { kind: 'exact', address: '' }

const SAVED_OFF: ProxySettings = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password_set: false,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
  host_values: HOST_VALUES,
}

const SAVED_HOST: ProxySettings = { ...SAVED_OFF, enabled: true }

const SAVED_CUSTOM: ProxySettings = {
  ...SAVED_OFF,
  enabled: true,
  source: 'custom',
  host: 'proxy.corp.example',
  port: 3128,
  username: 'svc-wave',
  password_set: true,
  entries: [REGISTRY, CLUSTER],
}

const SAVED_CUSTOM_NO_SECRET: ProxySettings = { ...SAVED_CUSTOM, password_set: false }

function stagedFrom(settings: ProxySettings): ProxyStaged {
  return {
    enabled: settings.enabled,
    source: settings.source,
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: undefined,
    list_mode: settings.list_mode,
    entries: settings.entries,
    proxy_local_addresses: settings.proxy_local_addresses,
  }
}

function makeProxy(overrides: Partial<Proxy> = {}): Proxy {
  return {
    status: 'loaded',
    settings: SAVED_CUSTOM,
    staged: stagedFrom(SAVED_CUSTOM),
    dirty: false,
    saving: false,
    problems: [],
    checking: false,
    stage: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

// A loaded page over the given saved settings, with staged edits on top of them.
function loadedProxy(
  settings: ProxySettings,
  edits: Partial<ProxyStaged> = {},
  rest: Partial<Proxy> = {},
): Proxy {
  return makeProxy({ settings, staged: { ...stagedFrom(settings), ...edits }, ...rest })
}

function pendingProxy(): Proxy {
  return makeProxy({ status: 'pending', settings: undefined, staged: stagedFrom(SAVED_OFF) })
}

function failedProxy(): Proxy {
  return makeProxy({
    status: 'failed',
    error: LOAD_ERROR,
    settings: undefined,
    staged: stagedFrom(SAVED_OFF),
  })
}

function problem(
  field: ProxyProblem['field'],
  message: string,
  row: number | null = null,
): ProxyProblem {
  return { field, row, message }
}

function manyEntries(count: number): ProxyEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'exact' as const,
    address: `https://host-${index + 1}.corp.example`,
  }))
}

function renderTab(proxy: Proxy = makeProxy()) {
  const view = render(<NetworkProxySetupTab proxy={proxy} />)
  return { proxy, rerender: view.rerender }
}

function page(): HTMLElement {
  return screen.getByTestId(PAGE)
}

function title(): HTMLElement {
  return screen.getByRole('heading', { name: TITLE })
}

function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Cancel' })
}

function useProxySwitch(): HTMLElement {
  return screen.getByRole('switch', { name: 'Use a proxy' })
}

function sourceGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Source' })
}

function sourceSegment(label: string): HTMLElement {
  return within(sourceGroup()).getByRole('button', { name: label })
}

function hostInput(): HTMLElement {
  return screen.getByRole('textbox', { name: 'IP or Hostname' })
}

function portInput(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Port' })
}

function usernameInput(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Username' })
}

// The control the "Password" row label points at: the masked field or the input being typed in.
function secretControl(): HTMLElement {
  return screen.getByLabelText('Password')
}

function maskedField(): HTMLElement {
  return screen.getByRole('button', { name: 'Password: Edit protected value' })
}

function modeSegment(label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

// The "Use the proxy for" control: the group that holds its two options.
function modeGroup(): HTMLElement {
  const group = modeSegment(MODE_EXCEPT).closest('fieldset')
  if (group === null) throw new Error('The "Use the proxy for" options sit in no group')
  return group
}

function localSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: LOCAL_LABEL })
}

function entryType(row: number): HTMLElement {
  return screen.getByRole('group', { name: `Entry ${row} type` })
}

function entrySegment(row: number, label: 'Exact' | 'Regex'): HTMLElement {
  return within(entryType(row)).getByRole('button', { name: label })
}

function entryAddress(row: number): HTMLElement {
  return screen.getByRole('textbox', { name: `Entry ${row} address` })
}

function entryRemove(row: number): HTMLElement {
  return screen.getByRole('button', { name: `Remove entry ${row}` })
}

function addButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Add entry' })
}

// Every row label of the page, top to bottom.
function rowLabels(): string[] {
  return Array.from(page().querySelectorAll('label'), (label) => label.textContent?.trim() ?? '')
}

// The texts of the elements a control's aria-describedby points at.
function descriptionsOf(control: HTMLElement): string[] {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
}

function expectInOrder(nodes: readonly Node[]): void {
  for (let index = 1; index < nodes.length; index++) {
    const position = nodes[index - 1].compareDocumentPosition(nodes[index])
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
}

// Each text must show after the one before it, so the list is the reading order.
function expectTextSequence(container: HTMLElement, texts: readonly string[]): void {
  const all = container.textContent ?? ''
  let from = 0
  for (const text of texts) {
    const at = all.indexOf(text, from)
    expect(at, `"${text}" after offset ${from} of "${all}"`).toBeGreaterThanOrEqual(0)
    from = at + text.length
  }
}

// The text the page shows after the given element, outside it.
function textAfter(element: Element): string {
  const walker = document.createTreeWalker(page(), NodeFilter.SHOW_TEXT)
  let text = ''
  while (walker.nextNode()) {
    const node = walker.currentNode
    const follows = element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING
    if (follows && !element.contains(node)) text += node.textContent ?? ''
  }
  return text.trim()
}

function expectNoCustomRows(): void {
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  expect(screen.queryByText(SEALED_HELP)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: MODE_EXCEPT })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: MODE_ONLY })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: LOCAL_LABEL })).not.toBeInTheDocument()
}

function expectNoHostValues(): void {
  expect(screen.queryByText('HTTPS_PROXY')).not.toBeInTheDocument()
  expect(screen.queryByText('HTTP_PROXY')).not.toBeInTheDocument()
  expect(screen.queryByText('NO_PROXY')).not.toBeInTheDocument()
}

describe('NetworkProxySetupTab', () => {
  describe('First read pending', () => {
    it('shows the title with no Cancel and no Save', () => {
      renderTab(pendingProxy())

      expect(title()).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(within(page()).queryAllByRole('button')).toHaveLength(0)
    })

    it('shows the line under the title', () => {
      renderTab(pendingProxy())

      expectInOrder([title(), screen.getByText(TITLE_LINE), screen.getByTestId(SKELETON)])
    })

    it('shows one skeleton row in place of the card', () => {
      renderTab(pendingProxy())

      const skeleton = screen.getByTestId(SKELETON)
      expect(skeleton).toHaveAttribute('aria-busy', 'true')
      expect(skeleton.children).toHaveLength(1)
      expect(skeleton.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
    })

    it('shows no row and no read failure', () => {
      renderTab(pendingProxy())

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(rowLabels()).toEqual([])
    })
  })

  describe('First read failed', () => {
    it('shows the title alone, with no Cancel and no Save', () => {
      renderTab(failedProxy())

      expect(title()).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      const names = within(page())
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())
      expect(names).toEqual(['Try Again'])
    })

    it('shows the reason of the failure under the heading', () => {
      renderTab(failedProxy())

      const alert = screen.getByRole('alert')
      expect(within(alert).getByText(LOAD_ERROR)).toBeInTheDocument()
      expect(within(alert).getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
      expectInOrder([title(), alert])
    })

    it('"Try Again" calls retry', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(failedProxy())

      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(proxy.retry).toHaveBeenCalledTimes(1)
    })

    it('shows no line under the title', () => {
      renderTab(failedProxy())

      expect(screen.queryByText(TITLE_LINE)).not.toBeInTheDocument()
    })

    it('shows no card and no skeleton', () => {
      renderTab(failedProxy())

      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByTestId(SKELETON)).not.toBeInTheDocument()
      expect(rowLabels()).toEqual([])
    })

    it('still offers "Try Again" when the failure carries no reason', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab({ ...failedProxy(), error: undefined })

      expect(screen.getByRole('alert')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(proxy.retry).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })
  })

  describe('Title', () => {
    it.each([
      { state: 'off', proxy: () => loadedProxy(SAVED_OFF) },
      { state: "on with the WAVE host's settings", proxy: () => loadedProxy(SAVED_HOST) },
      { state: 'on with Custom', proxy: () => loadedProxy(SAVED_CUSTOM) },
    ])('shows the title and the exact line under it while $state', ({ proxy }) => {
      renderTab(proxy())

      expect(screen.getAllByRole('heading')).toHaveLength(1)
      expect(screen.getAllByText(TITLE_LINE)).toHaveLength(1)
      expectInOrder([title(), screen.getByText(TITLE_LINE), useProxySwitch()])
    })

    it('carries no skeleton and no read failure once loaded', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(screen.queryByTestId(SKELETON)).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('Off', () => {
    it('shows only "Use a proxy", switched off', () => {
      renderTab(loadedProxy(SAVED_OFF))

      expect(rowLabels()).toEqual(['Use a proxy'])
      expect(screen.getAllByRole('switch')).toHaveLength(1)
      expect(useProxySwitch()).not.toBeChecked()
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expectNoHostValues()
      expectNoCustomRows()
    })

    it('gives "Use a proxy" no help line', () => {
      renderTab(loadedProxy(SAVED_OFF))

      expect(useProxySwitch()).not.toHaveAttribute('aria-describedby')
    })

    it('shows only "Use a proxy" when a saved Custom proxy is staged off', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { enabled: false }, { dirty: true }))

      expect(rowLabels()).toEqual(['Use a proxy'])
      expect(useProxySwitch()).not.toBeChecked()
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expectNoCustomRows()
    })

    it('shows Source once a saved-off proxy is staged on', () => {
      renderTab(loadedProxy(SAVED_OFF, { enabled: true }, { dirty: true }))

      expect(useProxySwitch()).toBeChecked()
      expect(rowLabels()).toEqual(['Use a proxy', 'Source'])
    })
  })

  describe("On with the WAVE host's settings", () => {
    it('shows "Use a proxy" on and Source, and no other row', () => {
      renderTab(loadedProxy(SAVED_HOST))

      expect(rowLabels()).toEqual(['Use a proxy', 'Source'])
      expect(useProxySwitch()).toBeChecked()
      expect(screen.getAllByRole('switch')).toHaveLength(1)
    })

    it('offers the two sources in order with "WAVE host\'s settings" pressed', () => {
      renderTab(loadedProxy(SAVED_HOST))

      const segments = within(sourceGroup()).getAllByRole('button')
      expect(segments.map((button) => button.textContent)).toEqual([SOURCE_HOST, SOURCE_CUSTOM])
      expect(sourceSegment(SOURCE_HOST)).toHaveAttribute('aria-pressed', 'true')
      expect(sourceSegment(SOURCE_CUSTOM)).toHaveAttribute('aria-pressed', 'false')
    })

    it("shows the WAVE host's three values in order under Source", () => {
      renderTab(loadedProxy(SAVED_HOST))

      expectInOrder([sourceGroup(), screen.getByText('HTTPS_PROXY')])
      expectTextSequence(page(), [
        'Source',
        'HTTPS_PROXY',
        'http://svc-wave:********@proxy.corp.example:3128',
        'HTTP_PROXY',
        'http://proxy.corp.example:8080',
        'NO_PROXY',
        '.corp.example,localhost',
      ])
    })

    it('reads "Not set" for a variable the WAVE host does not set', () => {
      const host_values = { ...HOST_VALUES, http_proxy: null }
      renderTab(loadedProxy({ ...SAVED_HOST, host_values }))

      expect(screen.getAllByText(NOT_SET)).toHaveLength(1)
      expectTextSequence(page(), ['HTTP_PROXY', NOT_SET, 'NO_PROXY', '.corp.example,localhost'])
    })

    it('shows no Custom row', () => {
      renderTab(loadedProxy(SAVED_HOST))

      expectNoCustomRows()
    })

    it("shows the WAVE host's values when a saved Custom proxy is staged to them", () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { source: 'host' }, { dirty: true }))

      expect(rowLabels()).toEqual(['Use a proxy', 'Source'])
      expect(sourceSegment(SOURCE_HOST)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('HTTPS_PROXY')).toBeInTheDocument()
      expectNoCustomRows()
    })
  })

  describe('On with Custom', () => {
    it('shows the rows in order with their exact labels', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(rowLabels()).toEqual(CUSTOM_LABELS)
    })

    it('presses "Custom" in Source', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(sourceSegment(SOURCE_CUSTOM)).toHaveAttribute('aria-pressed', 'true')
      expect(sourceSegment(SOURCE_HOST)).toHaveAttribute('aria-pressed', 'false')
    })

    it("shows none of the WAVE host's values", () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expectNoHostValues()
    })

    it('shows the staged address, port and username', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(hostInput()).toHaveValue('proxy.corp.example')
      expect(portInput()).toHaveValue('3128')
      expect(usernameInput()).toHaveValue('svc-wave')
    })

    it('shows an empty Port while no port is staged', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { port: null }, { dirty: true }))

      expect(portInput()).toHaveValue('')
    })

    it('builds Port as a text input with the numeric keyboard', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(portInput()).toHaveAttribute('type', 'text')
      expect(portInput()).toHaveAttribute('inputmode', 'numeric')
    })

    it('turns off autocomplete and spell check on IP or Hostname and Username', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      for (const input of [hostInput(), usernameInput()]) {
        expect(input).toHaveAttribute('autocomplete', 'off')
        expect(input).toHaveAttribute('spellcheck', 'false')
      }
    })

    it('shows the Password help text and links it to the field', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(screen.getAllByText(SEALED_HELP)).toHaveLength(1)
      expect(descriptionsOf(secretControl())).toContain(SEALED_HELP)
    })

    it('offers the two "Use the proxy for" options in order', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      const segments = within(modeGroup()).getAllByRole('button')
      expect(segments.map((button) => button.textContent)).toEqual([MODE_EXCEPT, MODE_ONLY])
    })

    it('presses "All addresses except the list" for the except mode', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(modeSegment(MODE_EXCEPT)).toHaveAttribute('aria-pressed', 'true')
      expect(modeSegment(MODE_ONLY)).toHaveAttribute('aria-pressed', 'false')
    })

    it('presses "Only the addresses in the list" for the only mode', () => {
      renderTab(loadedProxy({ ...SAVED_CUSTOM, list_mode: 'only' }))

      expect(modeSegment(MODE_ONLY)).toHaveAttribute('aria-pressed', 'true')
      expect(modeSegment(MODE_EXCEPT)).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows the address list with one row per staged entry', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(entryAddress(1)).toHaveValue(REGISTRY.address)
      expect(entrySegment(1, 'Exact')).toHaveAttribute('aria-pressed', 'true')
      expect(entryAddress(2)).toHaveValue(CLUSTER.address)
      expect(entrySegment(2, 'Regex')).toHaveAttribute('aria-pressed', 'true')
      expect(entryRemove(1)).toBeInTheDocument()
      expect(entryRemove(2)).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Entry 3 address' })).not.toBeInTheDocument()
    })

    it('puts the list and "Add" between "Use the proxy for" and the local-addresses switch', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expectInOrder([
        secretControl(),
        modeSegment(MODE_ONLY),
        entryType(1),
        entryRemove(2),
        addButton(),
        localSwitch(),
      ])
    })

    it('shows only "Add" for an empty list', () => {
      renderTab(loadedProxy({ ...SAVED_CUSTOM, entries: [] }))

      expect(addButton()).toBeEnabled()
      expect(screen.queryByRole('textbox', { name: 'Entry 1 address' })).not.toBeInTheDocument()
      expectInOrder([modeSegment(MODE_ONLY), addButton(), localSwitch()])
    })

    it('disables "Add" at 100 rows', () => {
      renderTab(loadedProxy({ ...SAVED_CUSTOM, entries: manyEntries(100) }))

      // A role query reads every control of a long list; the text finds the same button at once.
      const add = screen.getByText('Add').closest('button')
      expect(add).not.toBeNull()
      expect(add).toBeDisabled()
    })

    it('shows the local-addresses switch off', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(localSwitch()).not.toBeChecked()
    })

    it('shows the local-addresses switch on when it is staged on', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { proxy_local_addresses: true }, { dirty: true }))

      expect(localSwitch()).toBeChecked()
    })

    it('shows the Custom rows when the saved WAVE host source is staged to Custom', () => {
      renderTab(loadedProxy(SAVED_HOST, { source: 'custom' }, { dirty: true }))

      expect(rowLabels()).toEqual(CUSTOM_LABELS)
      expect(hostInput()).toHaveValue('')
      expect(portInput()).toHaveValue('')
      expectNoHostValues()
    })
  })

  describe('Password', () => {
    it('shows a stored password masked', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(secretControl()).toBe(maskedField())
      expect(page().querySelector('input[type="password"]')).toBeNull()
    })

    it('links the help text to the masked field', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(descriptionsOf(maskedField())).toContain(SEALED_HELP)
    })

    it('asks before editing when the masked field is clicked', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(maskedField())

      const dialog = await screen.findByRole('dialog', { name: CONFIRM_TITLE })
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Delete & Edit' })).toBeInTheDocument()
      expect(proxy.stage).not.toHaveBeenCalled()
    })

    it('leaves the masked field as it was when the confirm is canceled', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(maskedField())
      const dialog = await screen.findByRole('dialog', { name: CONFIRM_TITLE })
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(proxy.stage).not.toHaveBeenCalled()
      expect(proxy.cancel).not.toHaveBeenCalled()
      expect(secretControl()).toBe(maskedField())
    })

    it('"Delete & Edit" stages the password as an empty text', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(maskedField())
      const dialog = await screen.findByRole('dialog', { name: CONFIRM_TITLE })
      await user.click(within(dialog).getByRole('button', { name: 'Delete & Edit' }))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('password', '')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('shows an empty hidden input once the stored password is staged empty', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { password: '' }, { dirty: true }))

      expect(screen.queryByRole('button', { name: 'Password: Edit protected value' })).not.toBeInTheDocument()
      expect(secretControl()).toHaveAttribute('type', 'password')
      expect(secretControl()).toHaveValue('')
      expect(descriptionsOf(secretControl())).toContain(SEALED_HELP)
    })

    it('shows an empty hidden input when no password is stored', () => {
      renderTab(loadedProxy(SAVED_CUSTOM_NO_SECRET))

      expect(screen.queryByRole('button', { name: 'Password: Edit protected value' })).not.toBeInTheDocument()
      expect(secretControl()).toHaveAttribute('type', 'password')
      expect(secretControl()).toHaveValue('')
    })

    it('keeps a typed password hidden at first', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { password: TYPED_VALUE }, { dirty: true }))

      expect(screen.queryByRole('button', { name: 'Password: Edit protected value' })).not.toBeInTheDocument()
      expect(secretControl()).toHaveAttribute('type', 'password')
      expect(secretControl()).toHaveValue(TYPED_VALUE)
    })

    it('shows and hides a typed password with the eye toggle', async () => {
      const user = userEvent.setup()
      renderTab(loadedProxy(SAVED_CUSTOM, { password: TYPED_VALUE }, { dirty: true }))

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(secretControl()).toHaveAttribute('type', 'text')
      expect(secretControl()).toHaveValue(TYPED_VALUE)

      await user.click(screen.getByRole('button', { name: 'Hide password' }))
      expect(secretControl()).toHaveAttribute('type', 'password')
    })

    it.each([
      { state: 'emptied for typing', staged: '' },
      { state: 'typed', staged: TYPED_VALUE },
    ])('masks the saved password again once a password $state is no longer staged', ({ staged }) => {
      const { rerender } = renderTab(loadedProxy(SAVED_CUSTOM, { password: staged }, { dirty: true }))
      expect(screen.queryByRole('button', { name: 'Password: Edit protected value' })).not.toBeInTheDocument()

      rerender(<NetworkProxySetupTab proxy={loadedProxy(SAVED_CUSTOM)} />)

      expect(secretControl()).toBe(maskedField())
      expect(page().querySelector('input[type="password"]')).toBeNull()
    })

    it('masks a new password once it is saved', () => {
      const { rerender } = renderTab(
        loadedProxy(SAVED_CUSTOM_NO_SECRET, { password: TYPED_VALUE }, { dirty: true }),
      )
      expect(secretControl()).toHaveValue(TYPED_VALUE)

      rerender(<NetworkProxySetupTab proxy={loadedProxy(SAVED_CUSTOM)} />)

      expect(secretControl()).toBe(maskedField())
      const shown = Array.from(page().querySelectorAll('input'), (input) => input.value)
      expect(shown).not.toContain(TYPED_VALUE)
    })
  })

  describe('Staging', () => {
    it('turning "Use a proxy" on stages enabled as true', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_OFF))

      await user.click(useProxySwitch())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('enabled', true)
    })

    it('turning "Use a proxy" off stages enabled as false', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(useProxySwitch())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('enabled', false)
    })

    it('pressing "Custom" stages the source as custom', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_HOST))

      await user.click(sourceSegment(SOURCE_CUSTOM))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('source', 'custom')
    })

    it('pressing "WAVE host\'s settings" stages the source as host', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(sourceSegment(SOURCE_HOST))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('source', 'host')
    })

    it('typing in IP or Hostname stages the host text', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(hostInput(), 'x')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('host', 'proxy.corp.examplex')
    })

    it('typing a digit in Port stages the port as a number', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(portInput(), '8')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('port', 31288)
    })

    it('typing the first digit into an empty Port stages a number', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { port: null }, { dirty: true }))

      await user.type(portInput(), '8')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('port', 8)
    })

    it('emptying Port stages the port as null', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.clear(portInput())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('port', null)
    })

    it('does not take a character that is not a digit into Port', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(portInput(), 'x')

      // Staging the unchanged port again is fine; anything else is not.
      for (const call of vi.mocked(proxy.stage).mock.calls) {
        expect(call).toEqual(['port', 3128])
      }
      expect(portInput()).toHaveValue('3128')
    })

    it('does not take a character that is not a digit into an empty Port', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { port: null }, { dirty: true }))

      await user.type(portInput(), '-')

      for (const call of vi.mocked(proxy.stage).mock.calls) {
        expect(call).toEqual(['port', null])
      }
      expect(portInput()).toHaveValue('')
    })

    it('never changes digits already typed when a sixth goes in front (REQ-3.1.3.14)', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { port: 65535 }, { dirty: true }))

      await user.type(portInput(), '{Home}9')

      expect(proxy.stage).not.toHaveBeenCalled()
      expect(portInput()).toHaveValue('65535')
    })

    it('stages a port typed with a leading zero as its exact digits', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { port: 0 }, { dirty: true }))

      await user.type(portInput(), '8')

      expect(proxy.stage).toHaveBeenLastCalledWith('port', '08')
    })

    it('does not take a sixth digit into Port', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { port: 31288 }, { dirty: true }))

      await user.type(portInput(), '9')

      // Staging the unchanged port again is fine; anything else is not.
      for (const call of vi.mocked(proxy.stage).mock.calls) {
        expect(call).toEqual(['port', 31288])
      }
      expect(portInput()).toHaveValue('31288')
    })

    it('typing in Username stages the username text', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(usernameInput(), '2')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('username', 'svc-wave2')
    })

    it('typing a password stages the password text', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM_NO_SECRET))

      await user.type(secretControl(), 'h')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('password', 'h')
    })

    it('typing after "Delete & Edit" stages the password text', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM, { password: '' }, { dirty: true }))

      await user.type(secretControl(), 'h')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('password', 'h')
    })

    it('pressing "Only the addresses in the list" stages the list mode as only', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(modeSegment(MODE_ONLY))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('list_mode', 'only')
    })

    it('pressing "All addresses except the list" stages the list mode as except', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy({ ...SAVED_CUSTOM, list_mode: 'only' }))

      await user.click(modeSegment(MODE_EXCEPT))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('list_mode', 'except')
    })

    it('"Add" stages the whole list with a new Exact row', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(addButton())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('entries', [REGISTRY, CLUSTER, NEW_ROW])
    })

    it('pressing the other kind of a row stages the whole list with that kind', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(entrySegment(1, 'Regex'))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('entries', [{ ...REGISTRY, kind: 'regex' }, CLUSTER])
    })

    it('typing in a row address stages the whole list with that address', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(entryAddress(1), '/')

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('entries', [
        { ...REGISTRY, address: `${REGISTRY.address}/` },
        CLUSTER,
      ])
    })

    it('removing a row stages the whole list without it', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(entryRemove(1))

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('entries', [CLUSTER])
    })

    it('turning the local-addresses switch on stages it as true', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.click(localSwitch())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('proxy_local_addresses', true)
    })

    it('turning the local-addresses switch off stages it as false', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy({ ...SAVED_CUSTOM, proxy_local_addresses: true }))

      await user.click(localSwitch())

      expect(proxy.stage).toHaveBeenCalledTimes(1)
      expect(proxy.stage).toHaveBeenCalledWith('proxy_local_addresses', false)
    })

    it('staging saves nothing and cancels nothing', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(loadedProxy(SAVED_CUSTOM))

      await user.type(hostInput(), 'x')
      await user.click(localSwitch())

      expect(proxy.save).not.toHaveBeenCalled()
      expect(proxy.cancel).not.toHaveBeenCalled()
    })
  })

  describe('Cancel and Save', () => {
    it.each([
      { state: 'off', proxy: () => loadedProxy(SAVED_OFF) },
      { state: "on with the WAVE host's settings", proxy: () => loadedProxy(SAVED_HOST) },
      { state: 'on with Custom', proxy: () => loadedProxy(SAVED_CUSTOM) },
    ])('are both disabled while nothing changed and the proxy is $state', ({ proxy }) => {
      renderTab(proxy())

      expect(cancelButton()).toBeDisabled()
      expect(saveButton()).toBeDisabled()
      expect(saveButton()).not.toHaveAttribute('aria-busy')
    })

    it('sit before the first row', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expectInOrder([cancelButton(), saveButton(), useProxySwitch()])
    })

    it('are both enabled once something changed', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2.corp.example' }, { dirty: true }))

      expect(cancelButton()).toBeEnabled()
      expect(saveButton()).toBeEnabled()
      expect(saveButton()).not.toHaveAttribute('aria-busy')
    })

    it('Save calls save', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(
        loadedProxy(SAVED_CUSTOM, { host: 'proxy-2.corp.example' }, { dirty: true }),
      )

      await user.click(saveButton())

      expect(proxy.save).toHaveBeenCalledTimes(1)
      expect(proxy.cancel).not.toHaveBeenCalled()
    })

    it('Cancel calls cancel', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(
        loadedProxy(SAVED_CUSTOM, { host: 'proxy-2.corp.example' }, { dirty: true }),
      )

      await user.click(cancelButton())

      expect(proxy.cancel).toHaveBeenCalledTimes(1)
      expect(proxy.save).not.toHaveBeenCalled()
    })
  })

  describe('Check while typing', () => {
    describe('A check is pending', () => {
      it('disables Save and leaves Cancel enabled', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, checking: true }))

        expect(saveButton()).toBeDisabled()
        expect(saveButton()).not.toHaveAttribute('aria-busy')
        expect(cancelButton()).toBeEnabled()
      })

      it('leaves every control enabled', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, checking: true }))

        expect(useProxySwitch()).toBeEnabled()
        expect(sourceSegment(SOURCE_HOST)).toBeEnabled()
        expect(hostInput()).toBeEnabled()
        expect(portInput()).toBeEnabled()
        expect(entryAddress(1)).toBeEnabled()
        expect(addButton()).toBeEnabled()
      })

      it('shows no message of its own', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, checking: true }))

        expect(hostInput()).not.toHaveAttribute('aria-invalid', 'true')
        expect(screen.queryByText(HOST_NOT_AN_ADDRESS)).not.toBeInTheDocument()
      })

      it('keeps the messages it holds until the answer arrives', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { host: 'http://proxy-2' },
            { dirty: true, checking: true, problems: [problem('host', HOST_NOT_AN_ADDRESS)] },
          ),
        )

        expect(descriptionsOf(hostInput())).toContain(HOST_NOT_AN_ADDRESS)
        expect(hostInput()).toHaveAttribute('aria-invalid', 'true')
        expect(saveButton()).toBeDisabled()
      })
    })

    describe('A field is not valid', () => {
      const cases = [
        {
          name: 'IP or Hostname',
          edits: { host: 'http://proxy.corp.example' },
          found: problem('host', HOST_NOT_AN_ADDRESS),
          control: hostInput,
          next: portInput,
        },
        {
          name: 'Port',
          edits: { port: null },
          found: problem('port', PORT_REQUIRED),
          control: portInput,
          next: usernameInput,
        },
        {
          name: 'Username',
          edits: { username: '', password: TYPED_VALUE },
          found: problem('username', USERNAME_REQUIRED),
          control: usernameInput,
          next: secretControl,
        },
      ] satisfies {
        name: string
        edits: Partial<ProxyStaged>
        found: ProxyProblem
        control: () => HTMLElement
        next: () => HTMLElement
      }[]

      it.each(cases)('marks $name as not valid', ({ edits, found, control }) => {
        renderTab(loadedProxy(SAVED_CUSTOM, edits, { dirty: true, problems: [found] }))

        expect(control()).toHaveAttribute('aria-invalid', 'true')
      })

      it.each(cases)('points $name at its message', ({ edits, found, control }) => {
        renderTab(loadedProxy(SAVED_CUSTOM, edits, { dirty: true, problems: [found] }))

        expect(descriptionsOf(control())).toContain(found.message)
      })

      it.each(cases)('shows the message under $name', ({ edits, found, control, next }) => {
        renderTab(loadedProxy(SAVED_CUSTOM, edits, { dirty: true, problems: [found] }))

        expect(screen.getAllByText(found.message)).toHaveLength(1)
        expectInOrder([control(), screen.getByText(found.message), next()])
      })

      it.each(cases)('disables Save and leaves Cancel enabled for $name', ({ edits, found }) => {
        renderTab(loadedProxy(SAVED_CUSTOM, edits, { dirty: true, problems: [found] }))

        expect(saveButton()).toBeDisabled()
        expect(saveButton()).not.toHaveAttribute('aria-busy')
        expect(cancelButton()).toBeEnabled()
      })

      it('marks only the field the problem names', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { host: 'http://proxy.corp.example' },
            { dirty: true, problems: [problem('host', HOST_NOT_AN_ADDRESS)] },
          ),
        )

        expect(portInput()).not.toHaveAttribute('aria-invalid', 'true')
        expect(usernameInput()).not.toHaveAttribute('aria-invalid', 'true')
        expect(entryAddress(1)).not.toHaveAttribute('aria-invalid', 'true')
        expect(entryAddress(2)).not.toHaveAttribute('aria-invalid', 'true')
      })

      it('shows the range message of Port under Port', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { port: 70000 },
            { dirty: true, problems: [problem('port', PORT_RANGE)] },
          ),
        )

        expect(portInput()).toHaveValue('70000')
        expect(portInput()).toHaveAttribute('aria-invalid', 'true')
        expect(descriptionsOf(portInput())).toContain(PORT_RANGE)
      })

      it('shows the message of Password under it, beside the help text link', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { password: TYPED_VALUE },
            { dirty: true, problems: [problem('password', SECRET_TOO_LONG)] },
          ),
        )

        expect(descriptionsOf(secretControl())).toContain(SECRET_TOO_LONG)
        expect(descriptionsOf(secretControl())).toContain(SEALED_HELP)
        expectInOrder([
          secretControl(),
          screen.getByText(SECRET_TOO_LONG),
          modeSegment(MODE_EXCEPT),
        ])
        expect(saveButton()).toBeDisabled()
      })

      it('does not announce a message as an alert', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { host: 'http://proxy.corp.example' },
            { dirty: true, problems: [problem('host', HOST_NOT_AN_ADDRESS)] },
          ),
        )

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    describe('A list row is not valid', () => {
      const rowProblem = problem('entries', TRAILING_SLASH, 2)

      it('marks the address of that row and points it at the message', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, {}, { dirty: true, problems: [rowProblem] }))

        expect(entryAddress(2)).toHaveAttribute('aria-invalid', 'true')
        expect(descriptionsOf(entryAddress(2))).toContain(TRAILING_SLASH)
      })

      it('shows the message under the address of that row', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, {}, { dirty: true, problems: [rowProblem] }))

        expect(screen.getAllByText(TRAILING_SLASH)).toHaveLength(1)
        expectInOrder([entryAddress(2), screen.getByText(TRAILING_SLASH), addButton()])
      })

      it('leaves the other row and the fields unmarked', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, {}, { dirty: true, problems: [rowProblem] }))

        expect(entryAddress(1)).not.toHaveAttribute('aria-invalid', 'true')
        expect(entryAddress(1)).not.toHaveAttribute('aria-describedby')
        expect(hostInput()).not.toHaveAttribute('aria-invalid', 'true')
      })

      it('disables Save and leaves Cancel enabled', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, {}, { dirty: true, problems: [rowProblem] }))

        expect(saveButton()).toBeDisabled()
        expect(cancelButton()).toBeEnabled()
      })

      it('does not announce the message as an alert', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, {}, { dirty: true, problems: [rowProblem] }))

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })
    })

    describe('A message is read out when it appears', () => {
      const fieldProblem = problem('host', HOST_NOT_AN_ADDRESS)
      const rowProblem = problem('entries', TRAILING_SLASH, 2)
      const listProblem = problem('entries', LIST_EMPTY)
      const sourceProblem = problem('source', HOST_HAS_NO_PROXY)

      // The live region that holds a message; a screen reader speaks what changes inside it.
      function liveRegionOf(message: string): HTMLElement {
        const region = screen.getByText(message).closest<HTMLElement>('[aria-live]')
        if (!region) throw new Error(`"${message}" is in no live region`)
        return region
      }

      it.each([
        { name: 'a field', found: fieldProblem },
        { name: 'a list row', found: rowProblem },
        { name: 'the address list', found: listProblem },
        { name: 'Source', found: sourceProblem },
      ])('puts the message of $name in a polite region the page already had', ({ found }) => {
        const edits = { host: 'http://proxy.corp.example' }
        const { rerender } = renderTab(loadedProxy(SAVED_CUSTOM, edits, { dirty: true, checking: true }))
        const regionsBefore = Array.from(document.querySelectorAll('[aria-live="polite"]'))

        rerender(
          <NetworkProxySetupTab
            proxy={loadedProxy(SAVED_CUSTOM, edits, { dirty: true, problems: [found] })}
          />,
        )

        const region = liveRegionOf(found.message)
        expect(region).toHaveAttribute('aria-live', 'polite')
        expect(regionsBefore).toContain(region)
        expect(region.textContent).toBe(found.message)
      })

      it('reads a field message once, not again on every key typed while the check runs', () => {
        const typed = (host: string, checking: boolean) =>
          loadedProxy(SAVED_CUSTOM, { host }, { dirty: true, checking, problems: [fieldProblem] })
        const { rerender } = renderTab(typed('http://proxy', false))
        const changes = new MutationObserver(() => {})
        changes.observe(liveRegionOf(HOST_NOT_AN_ADDRESS), {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        })

        rerender(<NetworkProxySetupTab proxy={typed('http://proxy.', true)} />)
        rerender(<NetworkProxySetupTab proxy={typed('http://proxy.c', true)} />)
        rerender(<NetworkProxySetupTab proxy={typed('http://proxy.c', false)} />)

        expect(hostInput()).toHaveValue('http://proxy.c')
        expect(changes.takeRecords()).toEqual([])
        changes.disconnect()
      })

      it('reads a list row message once, not again on every key typed in that row', () => {
        const typed = (address: string) =>
          loadedProxy(
            SAVED_CUSTOM,
            { entries: [REGISTRY, { kind: 'exact', address }] },
            { dirty: true, checking: true, problems: [rowProblem] },
          )
        const { rerender } = renderTab(typed('https://registry.corp.example/'))
        const changes = new MutationObserver(() => {})
        changes.observe(liveRegionOf(TRAILING_SLASH), {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        })

        rerender(<NetworkProxySetupTab proxy={typed('https://registry.corp.example/v')} />)
        rerender(<NetworkProxySetupTab proxy={typed('https://registry.corp.example/v2')} />)

        expect(entryAddress(2)).toHaveValue('https://registry.corp.example/v2')
        expect(changes.takeRecords()).toEqual([])
        changes.disconnect()
      })
    })

    describe('Several problems at once', () => {
      const entries: ProxyEntry[] = [
        REGISTRY,
        { kind: 'exact', address: 'https://registry.corp.example/' },
        { kind: 'exact', address: 'HTTPS://Registry.corp.example:443' },
        { kind: 'regex', address: String.raw`\.cluster\.local(:\d+` },
      ]
      const problems: ProxyProblem[] = [
        problem('host', HOST_NOT_AN_ADDRESS),
        problem('entries', TRAILING_SLASH, 2),
        problem('entries', SAME_ADDRESS, 3),
        problem('entries', BAD_PATTERN, 4),
      ]

      function renderInvalid() {
        return renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { host: 'http://proxy.corp.example', entries },
            { dirty: true, problems },
          ),
        )
      }

      it('shows every message under its own field or row', () => {
        renderInvalid()

        expect(descriptionsOf(hostInput())).toContain(HOST_NOT_AN_ADDRESS)
        expect(descriptionsOf(entryAddress(2))).toContain(TRAILING_SLASH)
        expect(descriptionsOf(entryAddress(3))).toContain(SAME_ADDRESS)
        expect(descriptionsOf(entryAddress(4))).toContain(BAD_PATTERN)
        expectInOrder([
          hostInput(),
          screen.getByText(HOST_NOT_AN_ADDRESS),
          portInput(),
          entryAddress(2),
          screen.getByText(TRAILING_SLASH),
          entryAddress(3),
          screen.getByText(SAME_ADDRESS),
          entryAddress(4),
          screen.getByText(BAD_PATTERN),
          addButton(),
        ])
      })

      it('marks the named field and rows and no other', () => {
        renderInvalid()

        for (const control of [hostInput(), entryAddress(2), entryAddress(3), entryAddress(4)]) {
          expect(control).toHaveAttribute('aria-invalid', 'true')
        }
        for (const control of [portInput(), usernameInput(), entryAddress(1)]) {
          expect(control).not.toHaveAttribute('aria-invalid', 'true')
        }
      })

      it('disables Save and leaves Cancel enabled', () => {
        renderInvalid()

        expect(saveButton()).toBeDisabled()
        expect(cancelButton()).toBeEnabled()
      })
    })

    describe('The list as a whole is not valid', () => {
      it('shows the message under "Use the proxy for", above the list', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            {},
            { dirty: true, problems: [problem('entries', LIST_TOO_LONG)] },
          ),
        )

        expect(screen.getAllByText(LIST_TOO_LONG)).toHaveLength(1)
        expectInOrder([
          modeSegment(MODE_ONLY),
          screen.getByText(LIST_TOO_LONG),
          entryType(1),
          addButton(),
        ])
      })

      it('points the "Use the proxy for" control at the message', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            {},
            { dirty: true, problems: [problem('entries', LIST_TOO_LONG)] },
          ),
        )

        expect(descriptionsOf(modeGroup())).toContain(LIST_TOO_LONG)
      })

      it('marks no row of the list', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            {},
            { dirty: true, problems: [problem('entries', LIST_TOO_LONG)] },
          ),
        )

        for (const row of [1, 2]) {
          expect(entryAddress(row)).not.toHaveAttribute('aria-invalid', 'true')
          expect(descriptionsOf(entryAddress(row))).not.toContain(LIST_TOO_LONG)
        }
      })

      it('shows the message above "Add" when the only mode has an empty list', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { list_mode: 'only', entries: [] },
            { dirty: true, problems: [problem('entries', LIST_EMPTY)] },
          ),
        )

        expect(screen.getAllByText(LIST_EMPTY)).toHaveLength(1)
        expect(descriptionsOf(modeGroup())).toContain(LIST_EMPTY)
        expectInOrder([modeSegment(MODE_ONLY), screen.getByText(LIST_EMPTY), addButton()])
      })

      it('disables Save and leaves Cancel enabled', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { list_mode: 'only', entries: [] },
            { dirty: true, problems: [problem('entries', LIST_EMPTY)] },
          ),
        )

        expect(saveButton()).toBeDisabled()
        expect(cancelButton()).toBeEnabled()
      })

      it('shows a row message and the list message each in its place', () => {
        renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            {},
            {
              dirty: true,
              problems: [problem('entries', LIST_TOO_LONG), problem('entries', TRAILING_SLASH, 1)],
            },
          ),
        )

        expectInOrder([
          modeSegment(MODE_ONLY),
          screen.getByText(LIST_TOO_LONG),
          entryAddress(1),
          screen.getByText(TRAILING_SLASH),
          entryType(2),
        ])
        expect(descriptionsOf(entryAddress(1))).toContain(TRAILING_SLASH)
        expect(descriptionsOf(entryAddress(1))).not.toContain(LIST_TOO_LONG)
      })
    })

    describe('The source is not valid', () => {
      const noHostProxy: ProxySettings = {
        ...SAVED_OFF,
        host_values: { https_proxy: null, http_proxy: null, no_proxy: null },
      }

      function renderNoHostProxy() {
        return renderTab(
          loadedProxy(
            noHostProxy,
            { enabled: true },
            { dirty: true, problems: [problem('source', HOST_HAS_NO_PROXY)] },
          ),
        )
      }

      it('shows the message under the Source row', () => {
        renderNoHostProxy()

        expect(screen.getAllByText(HOST_HAS_NO_PROXY)).toHaveLength(1)
        expectInOrder([
          sourceSegment(SOURCE_CUSTOM),
          screen.getByText(HOST_HAS_NO_PROXY),
          screen.getByText('HTTPS_PROXY'),
        ])
      })

      it('points the Source control at the message', () => {
        renderNoHostProxy()

        expect(descriptionsOf(sourceGroup())).toContain(HOST_HAS_NO_PROXY)
      })

      it('disables Save and leaves Cancel enabled', () => {
        renderNoHostProxy()

        expect(saveButton()).toBeDisabled()
        expect(cancelButton()).toBeEnabled()
      })

      it('leaves both sources usable', () => {
        renderNoHostProxy()

        expect(sourceSegment(SOURCE_HOST)).toBeEnabled()
        expect(sourceSegment(SOURCE_CUSTOM)).toBeEnabled()
      })
    })

    describe('No problem', () => {
      it('shows no message and enables Save when the check found nothing or could not be reached', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2.corp.example' }, { dirty: true }))

        for (const control of [hostInput(), portInput(), usernameInput(), entryAddress(1)]) {
          expect(control).not.toHaveAttribute('aria-invalid', 'true')
        }
        expect(saveButton()).toBeEnabled()
        expect(cancelButton()).toBeEnabled()
      })

      it('shows no range message of its own for a port past 65535', () => {
        renderTab(loadedProxy(SAVED_CUSTOM, { port: 70000 }, { dirty: true }))

        expect(portInput()).toHaveValue('70000')
        expect(portInput()).not.toHaveAttribute('aria-invalid', 'true')
        expect(screen.queryByText(PORT_RANGE)).not.toBeInTheDocument()
        expect(saveButton()).toBeEnabled()
      })

      it('drops the message and the mark and enables Save once the problem is corrected', () => {
        const { rerender } = renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            { host: 'http://proxy.corp.example' },
            { dirty: true, problems: [problem('host', HOST_NOT_AN_ADDRESS)] },
          ),
        )
        expect(saveButton()).toBeDisabled()

        rerender(
          <NetworkProxySetupTab
            proxy={loadedProxy(SAVED_CUSTOM, { host: 'proxy-2.corp.example' }, { dirty: true })}
          />,
        )

        expect(screen.queryByText(HOST_NOT_AN_ADDRESS)).not.toBeInTheDocument()
        expect(hostInput()).not.toHaveAttribute('aria-invalid', 'true')
        expect(saveButton()).toBeEnabled()
      })

      it('drops the message of a list row once the row is corrected', () => {
        const { rerender } = renderTab(
          loadedProxy(
            SAVED_CUSTOM,
            {},
            { dirty: true, problems: [problem('entries', TRAILING_SLASH, 2)] },
          ),
        )
        expect(entryAddress(2)).toHaveAttribute('aria-invalid', 'true')

        rerender(<NetworkProxySetupTab proxy={loadedProxy(SAVED_CUSTOM, {}, { dirty: true })} />)

        expect(screen.queryByText(TRAILING_SLASH)).not.toBeInTheDocument()
        expect(entryAddress(2)).not.toHaveAttribute('aria-invalid', 'true')
        expect(saveButton()).toBeEnabled()
      })
    })
  })

  describe('Saving', () => {
    it('shows Save busy and disables Cancel and Save', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, saving: true }))

      expect(saveButton()).toHaveAttribute('aria-busy', 'true')
      expect(saveButton()).toBeDisabled()
      expect(cancelButton()).toBeDisabled()
    })

    it('disables every Custom control, Source and the list included', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, saving: true }))

      const controls = [
        useProxySwitch(),
        sourceSegment(SOURCE_HOST),
        sourceSegment(SOURCE_CUSTOM),
        hostInput(),
        portInput(),
        usernameInput(),
        secretControl(),
        modeSegment(MODE_EXCEPT),
        modeSegment(MODE_ONLY),
        entrySegment(1, 'Exact'),
        entrySegment(1, 'Regex'),
        entryAddress(1),
        entryRemove(1),
        entrySegment(2, 'Exact'),
        entrySegment(2, 'Regex'),
        entryAddress(2),
        entryRemove(2),
        addButton(),
        localSwitch(),
      ]
      for (const control of controls) {
        expect(control).toBeDisabled()
      }
    })

    it('disables a password being typed', () => {
      renderTab(
        loadedProxy(SAVED_CUSTOM, { password: TYPED_VALUE }, { dirty: true, saving: true }),
      )

      expect(secretControl()).toHaveAttribute('type', 'password')
      expect(secretControl()).toBeDisabled()
    })

    it("disables the switch and Source on the WAVE host's settings", () => {
      renderTab(loadedProxy(SAVED_OFF, { enabled: true }, { dirty: true, saving: true }))

      expect(useProxySwitch()).toBeDisabled()
      expect(sourceSegment(SOURCE_HOST)).toBeDisabled()
      expect(sourceSegment(SOURCE_CUSTOM)).toBeDisabled()
    })

    it('disables the switch of a proxy being saved off', () => {
      renderTab(loadedProxy(SAVED_CUSTOM, { enabled: false }, { dirty: true, saving: true }))

      expect(useProxySwitch()).toBeDisabled()
    })

    it('stages nothing while it saves', async () => {
      const user = userEvent.setup()
      const { proxy } = renderTab(
        loadedProxy(SAVED_CUSTOM, { host: 'proxy-2' }, { dirty: true, saving: true }),
      )

      await user.click(useProxySwitch())
      await user.click(sourceSegment(SOURCE_HOST))
      await user.click(addButton())

      expect(proxy.stage).not.toHaveBeenCalled()
      expect(proxy.save).not.toHaveBeenCalled()
      expect(proxy.cancel).not.toHaveBeenCalled()
    })
  })

  describe('Nothing under the card', () => {
    it('shows no text after "Use a proxy" while the proxy is off', () => {
      renderTab(loadedProxy(SAVED_OFF))

      expect(textAfter(useProxySwitch())).toBe('')
    })

    it("shows no text after the WAVE host's values", () => {
      renderTab(loadedProxy(SAVED_HOST))

      expect(textAfter(screen.getByText('.corp.example,localhost'))).toBe('')
    })

    it('shows no text after the local-addresses switch on Custom', () => {
      renderTab(loadedProxy(SAVED_CUSTOM))

      expect(textAfter(localSwitch())).toBe('')
    })
  })

  describe('Focus order', () => {
    it('goes Cancel, Save, Use a proxy, Source, then the Custom inputs top to bottom', async () => {
      const user = userEvent.setup()
      renderTab(
        loadedProxy(
          { ...SAVED_CUSTOM_NO_SECRET, entries: [REGISTRY] },
          { host: 'proxy-2.corp.example' },
          { dirty: true },
        ),
      )
      const stops = new Map<Element, string>([
        [cancelButton(), 'Cancel'],
        [saveButton(), 'Save'],
        [useProxySwitch(), 'Use a proxy'],
        [sourceSegment(SOURCE_HOST), 'Source'],
        [sourceSegment(SOURCE_CUSTOM), 'Source'],
        [hostInput(), 'IP or Hostname'],
        [portInput(), 'Port'],
        [usernameInput(), 'Username'],
        [secretControl(), 'Password'],
        [modeSegment(MODE_EXCEPT), 'Use the proxy for'],
        [modeSegment(MODE_ONLY), 'Use the proxy for'],
        [entrySegment(1, 'Exact'), 'Entry 1 type'],
        [entrySegment(1, 'Regex'), 'Entry 1 type'],
        [entryAddress(1), 'Entry 1 address'],
        [entryRemove(1), 'Remove entry 1'],
        [addButton(), 'Add'],
        [localSwitch(), LOCAL_LABEL],
      ])

      const visited: string[] = []
      for (let step = 0; step < 40; step++) {
        await user.tab()
        const focused = document.activeElement
        if (focused === null || focused === document.body) break
        const stop = stops.get(focused)
        if (stop !== undefined && visited.at(-1) !== stop) visited.push(stop)
      }

      expect(visited).toEqual([
        'Cancel',
        'Save',
        'Use a proxy',
        'Source',
        'IP or Hostname',
        'Port',
        'Username',
        'Password',
        'Use the proxy for',
        'Entry 1 type',
        'Entry 1 address',
        'Remove entry 1',
        'Add',
        LOCAL_LABEL,
      ])
    })
  })
})
