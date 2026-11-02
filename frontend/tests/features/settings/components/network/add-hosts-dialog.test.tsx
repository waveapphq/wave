/**
 * AddHostsDialog - Detect from host and Paste lines, previewed and marked against the
 * page's staged hosts before Add stages them (NET-4).
 *
 * REQ-4.5.14
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorView } from '@codemirror/view'
import type { ComponentProps } from 'react'

const api = vi.hoisted(() => ({
  detectHostKeys: vi.fn(),
  parseHostLines: vi.fn(),
}))

vi.mock('@/features/settings/api/ssh-hosts', () => api)

import { AddHostsDialog } from '@/features/settings/components/network/add-hosts-dialog'
import type { DetectedHostKey, HostLinesParse } from '@/features/settings/api/ssh-hosts'

type DialogProps = ComponentProps<typeof AddHostsDialog>
type StagedHost = DialogProps['stagedHosts'][number]
type KeyType = StagedHost['key_type']
type ParsedEntry = HostLinesParse['entries'][number]
type User = ReturnType<typeof userEvent.setup>

const HOST = 'db-01.lab.internal'

const ED_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBcGwPpN+g0nuNnXXsAYsqGn9EMGEp11+JX4KtqKXY7x'
const EC_KEY =
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEFSq9N+LDnWSMq62ac8F'
const RSA_KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDo88LBhZ370V1FpgnNWl77hoXdAPnF+EL7dDJhbnDIm'
const OTHER_ED_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHk2vUq0xMfa9rQ1o3D2c7bZp0tR8wWbYx4cZ1nLm5Qe'

const FP_ED = 'SHA256:VHBwr4mXARtZpMsuC2M4HpEQxIv8wbSWaGQ0X2eEI1I'
const FP_EC = 'SHA256:BDLrgS1R03zoG0EBYmXFdRkwDoIfvamOIBvHM1cuRe8'
const FP_RSA = 'SHA256:l92zIj80bEPole9Po9burZ5B+oPFVD8NhHHQ1oqnHKo'
const FP_OTHER = 'SHA256:1JafXpDWpQjl03itCyfqKC0jah6s+rmuQ2vCkXbN0aE'

const DETECTED: DetectedHostKey[] = [
  { host: HOST, port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
  { host: HOST, port: 22, key_type: 'ECDSA', key: EC_KEY, fingerprint: FP_EC },
  { host: HOST, port: 22, key_type: 'RSA', key: RSA_KEY, fingerprint: FP_RSA },
]

function entry(
  hostNames: string[],
  keyType: KeyType,
  key: string,
  fingerprint: string,
  port = 22,
): ParsedEntry {
  return { host_names: hostNames, port, key_type: keyType, key, fingerprint }
}

const JUMP_ENTRY = entry(['jump-02', '10.20.4.40'], 'ED25519', ED_KEY, FP_ED)
const ETL_ENTRY = entry(['etl-02.corp.example'], 'ECDSA', EC_KEY, FP_EC)
const FILES_ENTRY = entry(['files.corp.example'], 'RSA', RSA_KEY, FP_RSA)

const PASTE_TEXT = [
  `jump-02,10.20.4.40 ${ED_KEY}`,
  `etl-02.corp.example ${EC_KEY}`,
  'HostName ci-02.lab.internal',
  `files.corp.example ${RSA_KEY}`,
].join('\n')

const PARSED: HostLinesParse = {
  entries: [JUMP_ENTRY, ETL_ENTRY, FILES_ENTRY],
  errors: [{ line: 3, message: 'not a known_hosts line' }],
}

const BAD_LINE_3 = 'Line 3: not a known_hosts line'

/** known_hosts text for the given entries; the parse itself is mocked. */
function linesFor(entries: ParsedEntry[]): string {
  return entries
    .map((item) => {
      const names = item.host_names.map((name: string) => (item.port === 22 ? name : `[${name}]:${item.port}`))
      return `${names.join(',')} ${item.key}`
    })
    .join('\n')
}

let savedSeq = 0

/** A saved trusted host as the page view carries it: a fingerprint, never the key. */
function savedHost(host: string, port: number, keyType: KeyType, fingerprint: string): StagedHost {
  savedSeq += 1
  return {
    id: `saved-${savedSeq}`,
    host,
    port,
    key_type: keyType,
    fingerprint,
    added: '2026-09-30T08:15:00Z',
  }
}

function apiError(status: number, message: string): Error {
  return Object.assign(new Error(message), { type: 'server', status, isRetryable: false })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderDialog(props: Partial<DialogProps> = {}) {
  const onOpenChange = vi.fn()
  const onAdd = vi.fn()
  const allProps: DialogProps = { open: true, onOpenChange, stagedHosts: [], onAdd, ...props }
  const utils = render(<AddHostsDialog {...allProps} />)
  const rerenderWith = (next: Partial<DialogProps>) =>
    utils.rerender(<AddHostsDialog {...allProps} {...next} />)
  return { ...utils, onOpenChange, onAdd, rerenderWith }
}

const hostInput = () => screen.getByLabelText('Host')
const portInput = () => screen.getByLabelText('Port')
const detectButton = () => screen.getByRole('button', { name: 'Detect' })
const addButton = () => screen.getByRole('button', { name: 'Add' })
const modeGroup = () => screen.getByRole('group', { name: 'Add hosts by' })
const modeButton = (name: 'Detect from host' | 'Paste lines') =>
  within(modeGroup()).getByRole('button', { name })
const editor = () => screen.getByRole('textbox', { name: 'Host key lines' })

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table'))
    .getAllByRole('row')
    .filter((row) => row.closest('tbody') !== null)
}

function headerLabels(): string[] {
  return within(screen.getByRole('table'))
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.trim() ?? '')
    .filter((label) => label !== '')
}

const rowFor = (name: RegExp) => screen.getByRole('row', { name })
const rowCheckbox = (row: HTMLElement) => within(row).getByRole('checkbox')

function liveRegionOf(element: HTMLElement): Element | null {
  return element.closest('[aria-live="polite"]')
}

/** The text when it is rendered outside any hidden subtree, else null. */
function shownText(text: string): HTMLElement | null {
  const element = screen.queryByText(text)
  return element && element.closest('[hidden]') === null ? element : null
}

async function typeHost(user: User, host = HOST) {
  await user.type(hostInput(), host)
}

async function setPort(user: User, port: string) {
  await user.clear(portInput())
  if (port !== '') await user.type(portInput(), port)
}

async function detect(user: User, host = HOST) {
  await typeHost(user, host)
  await user.click(detectButton())
  await screen.findByRole('table')
}

async function openPaste(user: User) {
  await user.click(modeButton('Paste lines'))
}

function setPasteText(text: string) {
  const view = EditorView.findFromDOM(editor())
  if (!view) throw new Error('the paste editor has no view')
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function settleParse() {
  await advance(300)
  await act(async () => {})
}

async function pasteAndParse(user: User, parse: HostLinesParse, text = linesFor(parse.entries)) {
  api.parseHostLines.mockResolvedValueOnce(parse)
  await openPaste(user)
  setPasteText(text)
  await settleParse()
}

beforeEach(() => {
  api.detectHostKeys.mockReset()
  api.parseHostLines.mockReset()
  api.detectHostKeys.mockResolvedValue(DETECTED)
  api.parseHostLines.mockResolvedValue(PARSED)
})

describe('AddHostsDialog - opened', () => {
  it('renders nothing while closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is titled "Add Hosts" with no description and no corner close button', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'Add Hosts' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('opens in "Detect from host" inside the "Add hosts by" group', () => {
    renderDialog()

    expect(modeButton('Detect from host')).toHaveAttribute('aria-pressed', 'true')
    expect(modeButton('Paste lines')).toHaveAttribute('aria-pressed', 'false')
  })

  it('focuses an empty Host with Port 22, Detect and Add disabled', async () => {
    renderDialog()

    await waitFor(() => expect(hostInput()).toHaveFocus())
    expect(hostInput()).toHaveValue('')
    expect(portInput()).toHaveDisplayValue('22')
    expect(detectButton()).toBeDisabled()
    expect(addButton()).toBeDisabled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(api.detectHostKeys).not.toHaveBeenCalled()
    expect(api.parseHostLines).not.toHaveBeenCalled()
  })

  it('names Host and Port and keeps the browser from filling or spell-checking them', () => {
    renderDialog()

    expect(hostInput()).toHaveAttribute('name', 'host')
    expect(hostInput()).toHaveAttribute('autocomplete', 'off')
    expect(hostInput()).toHaveAttribute('spellcheck', 'false')
    expect(portInput()).toHaveAttribute('name', 'port')
    expect(portInput()).toHaveAttribute('autocomplete', 'off')
    expect(portInput()).toHaveAttribute('inputmode', 'numeric')
  })
})

describe('AddHostsDialog - Detect enablement', () => {
  it('enables Detect once Host is typed', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeHost(user)

    expect(detectButton()).toBeEnabled()
    expect(addButton()).toBeDisabled()
  })

  it('keeps Detect disabled while Host is only spaces', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeHost(user, '   ')

    expect(detectButton()).toBeDisabled()
  })

  it.each([
    ['22.5', '225'],
    ['-1', '1'],
    ['2a2', '22'],
  ])('drops a key the number rule refuses in Port: %j reads %j (REQ-3.1.3.14)', async (typed, shown) => {
    const user = userEvent.setup()
    renderDialog()

    await setPort(user, typed)

    expect(portInput()).toHaveValue(shown)
  })

  it.each(['', '0', '65536', '0000065536', 'abc'])(
    'keeps Detect disabled for Port "%s"',
    async (port) => {
      const user = userEvent.setup()
      renderDialog()
      await typeHost(user)

      await setPort(user, port)

      expect(detectButton()).toBeDisabled()
    },
  )

  it.each(['1', '2222', '65535'])('enables Detect for Port "%s"', async (port) => {
    const user = userEvent.setup()
    renderDialog()
    await typeHost(user)

    await setPort(user, port)

    expect(detectButton()).toBeEnabled()
  })
})

describe('AddHostsDialog - Detect running', () => {
  it('asks for the host keys of the typed host and port', async () => {
    const user = userEvent.setup()
    renderDialog()
    await typeHost(user)
    await setPort(user, '2222')

    await user.click(detectButton())

    expect(api.detectHostKeys).toHaveBeenCalledTimes(1)
    expect(api.detectHostKeys).toHaveBeenCalledWith(HOST, 2222)
  })

  it('marks Detect busy and disables Host, Port, Detect and Add until the answer', async () => {
    const user = userEvent.setup()
    const pending = deferred<DetectedHostKey[]>()
    api.detectHostKeys.mockReturnValueOnce(pending.promise)
    renderDialog()
    await typeHost(user)

    await user.click(detectButton())

    expect(detectButton()).toHaveAttribute('aria-busy', 'true')
    expect(detectButton()).toBeDisabled()
    expect(hostInput()).toBeDisabled()
    expect(portInput()).toBeDisabled()
    expect(addButton()).toBeDisabled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await act(async () => pending.resolve(DETECTED))

    expect(detectButton()).not.toHaveAttribute('aria-busy', 'true')
    expect(detectButton()).toBeEnabled()
    expect(hostInput()).toBeEnabled()
    expect(portInput()).toBeEnabled()
  })
})

describe('AddHostsDialog - Detect failed', () => {
  it.each([
    'Could not reach db-01.lab.internal:22: Connection refused',
    'Timed out after 10 seconds reaching db-01.lab.internal:22',
    'db-01.lab.internal:22 did not answer as an SSH server',
    'db-01.lab.internal:22 offered no ED25519, ECDSA or RSA host key',
  ])('shows "%s" verbatim under the Host row', async (message) => {
    const user = userEvent.setup()
    api.detectHostKeys.mockRejectedValueOnce(apiError(400, message))
    renderDialog()
    await typeHost(user)

    await user.click(detectButton())

    const line = await screen.findByText(message)
    expect(liveRegionOf(line)).not.toBeNull()
    expect(hostInput().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    expect(hostInput()).toBeEnabled()
    expect(portInput()).toBeEnabled()
    expect(detectButton()).toBeEnabled()
  })

  it('clears the error when Host is edited', async () => {
    const user = userEvent.setup()
    const message = 'Could not reach db-01.lab.internal:22: Connection refused'
    api.detectHostKeys.mockRejectedValueOnce(apiError(400, message))
    renderDialog()
    await typeHost(user)
    await user.click(detectButton())
    await screen.findByText(message)

    await user.type(hostInput(), 'x')

    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('clears the error when Port is edited', async () => {
    const user = userEvent.setup()
    const message = 'Timed out after 10 seconds reaching db-01.lab.internal:22'
    api.detectHostKeys.mockRejectedValueOnce(apiError(400, message))
    renderDialog()
    await typeHost(user)
    await user.click(detectButton())
    await screen.findByText(message)

    await setPort(user, '2222')

    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
})

describe('AddHostsDialog - Detect succeeded', () => {
  it('lists the keys with Key type and Fingerprint only, in the order returned', async () => {
    const user = userEvent.setup()
    renderDialog()

    await detect(user)

    expect(headerLabels()).toEqual(['Key type', 'Fingerprint'])
    expect(bodyRows()).toHaveLength(3)
    expect(bodyRows().map((row) => within(row).getByText(/^(ED25519|ECDSA|RSA)$/).textContent)).toEqual([
      'ED25519',
      'ECDSA',
      'RSA',
    ])
    expect(screen.getByText(FP_ED)).toBeInTheDocument()
  })

  it('checks every row and enables Add', async () => {
    const user = userEvent.setup()
    renderDialog()

    await detect(user)

    for (const row of bodyRows()) {
      expect(rowCheckbox(row)).toBeChecked()
    }
    expect(addButton()).toBeEnabled()
  })

  it('disables Add once no row is checked and enables it again for one', async () => {
    const user = userEvent.setup()
    renderDialog()
    await detect(user)

    for (const row of bodyRows()) {
      await user.click(rowCheckbox(row))
    }
    expect(addButton()).toBeDisabled()

    await user.click(rowCheckbox(rowFor(/ECDSA/)))
    expect(addButton()).toBeEnabled()
  })

  it('clears the result when Host is edited', async () => {
    const user = userEvent.setup()
    renderDialog()
    await detect(user)

    await user.type(hostInput(), 'x')

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('clears the result when Port is edited', async () => {
    const user = userEvent.setup()
    renderDialog()
    await detect(user)

    await setPort(user, '2222')

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })
})

describe('AddHostsDialog - Detect markers', () => {
  it('marks an exact staged key "Already trusted" and a different staged key "Key changed"', async () => {
    const user = userEvent.setup()
    renderDialog({
      stagedHosts: [
        savedHost(HOST, 22, 'RSA', FP_RSA),
        savedHost(HOST, 22, 'ECDSA', FP_OTHER),
      ],
    })

    await detect(user)

    const trusted = rowFor(/Already trusted/)
    const changed = rowFor(/Key changed/)
    expect(trusted).toHaveTextContent('RSA')
    expect(changed).toHaveTextContent('ECDSA')
    expect(rowCheckbox(trusted)).toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(trusted)).not.toBeChecked()
    expect(rowCheckbox(changed)).toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(changed)).not.toBeChecked()
    expect(rowCheckbox(rowFor(/ED25519/))).toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('marks against a staged unsaved row as well', async () => {
    const user = userEvent.setup()
    const unsaved: StagedHost = {
      ...savedHost(HOST, 22, 'ED25519', FP_ED),
      id: 'staged-1',
      added: null,
      staged: true,
      key: ED_KEY,
    }
    renderDialog({ stagedHosts: [unsaved] })

    await detect(user)

    expect(rowFor(/Already trusted/)).toHaveTextContent('ED25519')
  })

  it('does not mark a key trusted for the same host on another port', async () => {
    const user = userEvent.setup()
    renderDialog({ stagedHosts: [savedHost(HOST, 2222, 'RSA', FP_OTHER)] })

    await detect(user)

    expect(screen.queryByText('Key changed')).not.toBeInTheDocument()
    expect(screen.queryByText('Already trusted')).not.toBeInTheDocument()
    expect(rowCheckbox(rowFor(/RSA/))).toBeChecked()
  })

  it('checks no row and disables Add when every row is marked', async () => {
    const user = userEvent.setup()
    renderDialog({
      stagedHosts: [
        savedHost(HOST, 22, 'ED25519', FP_ED),
        savedHost(HOST, 22, 'ECDSA', FP_EC),
        savedHost(HOST, 22, 'RSA', FP_OTHER),
      ],
    })

    await detect(user)

    expect(bodyRows()).toHaveLength(3)
    for (const row of bodyRows()) {
      expect(rowCheckbox(row)).toHaveAttribute('aria-disabled', 'true')
      expect(rowCheckbox(row)).not.toBeChecked()
    }
    expect(addButton()).toBeDisabled()
  })
})

describe('AddHostsDialog - Paste lines', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the focused, line-numbered "Host key lines" editor with Add disabled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await openPaste(user)

    expect(modeButton('Paste lines')).toHaveAttribute('aria-pressed', 'true')
    expect(modeButton('Detect from host')).toHaveAttribute('aria-pressed', 'false')
    expect(editor()).toHaveFocus()
    const lineNumbers = Array.from(document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')).map(
      (cell) => cell.textContent,
    )
    expect(lineNumbers).toContain('1')
    expect(screen.queryByRole('textbox', { name: 'Host' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    await advance(1000)
    expect(api.parseHostLines).not.toHaveBeenCalled()
  })

  it('reads the text once, 300 ms after the last change', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()
    await openPaste(user)

    setPasteText('jump-02,10.20.4.40 ssh-ed25519')
    await advance(150)
    setPasteText(PASTE_TEXT)
    await advance(299)
    expect(api.parseHostLines).not.toHaveBeenCalled()

    await advance(1)
    expect(api.parseHostLines).toHaveBeenCalledTimes(1)
    expect(api.parseHostLines).toHaveBeenCalledWith(PASTE_TEXT)

    await advance(1000)
    expect(api.parseHostLines).toHaveBeenCalledTimes(1)
  })

  it('lists the good rows with Host, Key type and Fingerprint, all checked, and enables Add', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    expect(headerLabels()).toEqual(['Host', 'Key type', 'Fingerprint'])
    expect(bodyRows()).toHaveLength(3)
    expect(within(bodyRows()[0]).getByText('jump-02, 10.20.4.40')).toBeInTheDocument()
    expect(within(bodyRows()[1]).getByText('etl-02.corp.example')).toBeInTheDocument()
    expect(within(bodyRows()[2]).getByText('files.corp.example')).toBeInTheDocument()
    for (const row of bodyRows()) {
      expect(rowCheckbox(row)).toBeChecked()
    }
    expect(addButton()).toBeEnabled()
  })

  it('lists each bad line as "Line {n}: {reason}" beside the good rows', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    const line = screen.getByText(BAD_LINE_3)
    expect(liveRegionOf(line)).not.toBeNull()
    expect(bodyRows()).toHaveLength(3)
    expect(addButton()).toBeEnabled()
  })

  it('keeps every bad line in one polite live region', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(user, {
      entries: [JUMP_ENTRY],
      errors: [
        { line: 2, message: 'hashed host name, run ssh-keyscan without -H and paste again' },
        { line: 5, message: 'unsupported key type ssh-dss' },
      ],
    })

    const hashed = screen.getByText(
      'Line 2: hashed host name, run ssh-keyscan without -H and paste again',
    )
    const unsupported = screen.getByText('Line 5: unsupported key type ssh-dss')
    expect(liveRegionOf(hashed)).not.toBeNull()
    expect(liveRegionOf(hashed)).toBe(liveRegionOf(unsupported))
  })

  it('shows only the bad lines, no table and Add disabled when no line is good', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(
      user,
      {
        entries: [],
        errors: [
          { line: 1, message: 'not a known_hosts line' },
          { line: 2, message: '@cert-authority and @revoked lines are not supported' },
        ],
      },
      'HostName ci-02.lab.internal\n@cert-authority *.lab.internal ssh-ed25519 AAAA',
    )

    expect(screen.getByText('Line 1: not a known_hosts line')).toBeInTheDocument()
    expect(
      screen.getByText('Line 2: @cert-authority and @revoked lines are not supported'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('keeps the previous result and disables Add while the next text is read', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const next = deferred<HostLinesParse>()
    renderDialog()
    await pasteAndParse(user, PARSED, PASTE_TEXT)
    api.parseHostLines.mockReturnValueOnce(next.promise)

    setPasteText(`${PASTE_TEXT}\nbastion-01 ${OTHER_ED_KEY}`)

    expect(bodyRows()).toHaveLength(3)
    expect(screen.getByText(BAD_LINE_3)).toBeInTheDocument()
    expect(addButton()).toBeDisabled()

    await advance(300)
    expect(api.parseHostLines).toHaveBeenCalledTimes(2)
    expect(bodyRows()).toHaveLength(3)
    expect(screen.getByText(BAD_LINE_3)).toBeInTheDocument()
    expect(addButton()).toBeDisabled()

    await act(async () =>
      next.resolve({
        entries: [...PARSED.entries, entry(['bastion-01'], 'ED25519', OTHER_ED_KEY, FP_OTHER)],
        errors: PARSED.errors,
      }),
    )

    expect(bodyRows()).toHaveLength(4)
    for (const row of bodyRows()) {
      expect(rowCheckbox(row)).toBeChecked()
    }
    expect(addButton()).toBeEnabled()
  })

  it('ignores the answer for text that has changed since', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const older = deferred<HostLinesParse>()
    const newer = deferred<HostLinesParse>()
    api.parseHostLines.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    renderDialog()
    await openPaste(user)

    setPasteText(`etl-02.corp.example ${EC_KEY}`)
    await advance(300)
    setPasteText(`files.corp.example ${RSA_KEY}`)
    await advance(300)
    await act(async () => newer.resolve({ entries: [FILES_ENTRY], errors: [] }))
    await act(async () => older.resolve({ entries: [ETL_ENTRY], errors: [] }))

    expect(bodyRows()).toHaveLength(1)
    expect(screen.getByText('files.corp.example')).toBeInTheDocument()
    expect(screen.queryByText('etl-02.corp.example')).not.toBeInTheDocument()
  })

  it('shows the API message, no table and Add disabled when reading fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()
    await pasteAndParse(user, PARSED, PASTE_TEXT)
    api.parseHostLines.mockRejectedValueOnce(apiError(500, 'Internal Server Error'))

    setPasteText(`${PASTE_TEXT}\n`)
    await settleParse()

    const message = screen.getByText('Internal Server Error')
    expect(liveRegionOf(message)).not.toBeNull()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(BAD_LINE_3)).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('clears the result and reads nothing when the text is emptied', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()
    await pasteAndParse(user, PARSED, PASTE_TEXT)

    setPasteText('')
    await settleParse()

    expect(api.parseHostLines).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(BAD_LINE_3)).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })
})

describe('AddHostsDialog - Paste markers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks a row "Already trusted" when every name already has this exact key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({
      stagedHosts: [
        savedHost('jump-02', 22, 'ED25519', FP_ED),
        savedHost('10.20.4.40', 22, 'ED25519', FP_ED),
      ],
    })

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    const trusted = rowFor(/Already trusted/)
    expect(trusted).toHaveTextContent('jump-02, 10.20.4.40')
    expect(rowCheckbox(trusted)).toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(trusted)).not.toBeChecked()
    expect(rowCheckbox(rowFor(/etl-02/))).toBeChecked()
  })

  it('marks a row "Key changed" when any of its names has the same port and key type with another key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({ stagedHosts: [savedHost('10.20.4.40', 22, 'ED25519', FP_OTHER)] })

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    const changed = rowFor(/Key changed/)
    expect(changed).toHaveTextContent('jump-02, 10.20.4.40')
    expect(rowCheckbox(changed)).toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(changed)).not.toBeChecked()
  })

  it('keeps a row checkable when only some of its names are already trusted', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({ stagedHosts: [savedHost('jump-02', 22, 'ED25519', FP_ED)] })

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    const partial = rowFor(/jump-02/)
    expect(within(partial).queryByText('Already trusted')).not.toBeInTheDocument()
    expect(rowCheckbox(partial)).not.toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(partial)).toBeChecked()
  })

  it('does not mark a staged key on another port or of another key type', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({
      stagedHosts: [
        savedHost('files.corp.example', 2222, 'RSA', FP_OTHER),
        savedHost('files.corp.example', 22, 'ED25519', FP_OTHER),
      ],
    })

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    expect(screen.queryByText('Key changed')).not.toBeInTheDocument()
    expect(screen.queryByText('Already trusted')).not.toBeInTheDocument()
    expect(rowCheckbox(rowFor(/files\.corp\.example/))).toBeChecked()
  })

  it('compares a bracketed line on its own port', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({ stagedHosts: [savedHost('files.corp.example', 2222, 'RSA', FP_OTHER)] })

    await pasteAndParse(user, {
      entries: [entry(['files.corp.example'], 'RSA', RSA_KEY, FP_RSA, 2222)],
      errors: [],
    })

    expect(rowFor(/Key changed/)).toHaveTextContent('files.corp.example')
  })

  it('marks a later row "Key changed" against an earlier row of the same paste', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(user, {
      entries: [
        entry(['bastion-01'], 'ED25519', ED_KEY, FP_ED),
        entry(['bastion-01'], 'ED25519', OTHER_ED_KEY, FP_OTHER),
      ],
      errors: [],
    })

    const [first, second] = bodyRows()
    expect(within(first).queryByText('Key changed')).not.toBeInTheDocument()
    expect(rowCheckbox(first)).toBeChecked()
    expect(within(second).getByText('Key changed')).toBeInTheDocument()
    expect(rowCheckbox(second)).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks a later row "Already trusted" when an earlier row of the same paste covers every name', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()

    await pasteAndParse(user, {
      entries: [JUMP_ENTRY, entry(['jump-02'], 'ED25519', ED_KEY, FP_ED)],
      errors: [],
    })

    const [first, second] = bodyRows()
    expect(rowCheckbox(first)).toBeChecked()
    expect(within(second).getByText('Already trusted')).toBeInTheDocument()
    expect(rowCheckbox(second)).not.toBeChecked()
  })

  it('checks no row and disables Add when every row is marked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog({
      stagedHosts: [
        savedHost('jump-02', 22, 'ED25519', FP_ED),
        savedHost('10.20.4.40', 22, 'ED25519', FP_ED),
        savedHost('etl-02.corp.example', 22, 'ECDSA', FP_EC),
        savedHost('files.corp.example', 22, 'RSA', FP_OTHER),
      ],
    })

    await pasteAndParse(user, PARSED, PASTE_TEXT)

    expect(bodyRows()).toHaveLength(3)
    for (const row of bodyRows()) {
      expect(rowCheckbox(row)).toHaveAttribute('aria-disabled', 'true')
      expect(rowCheckbox(row)).not.toBeChecked()
    }
    expect(addButton()).toBeDisabled()
  })
})

describe('AddHostsDialog - mode switch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps each mode input and result while the dialog is open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()
    await detect(user)
    await pasteAndParse(user, PARSED, PASTE_TEXT)
    expect(headerLabels()).toEqual(['Host', 'Key type', 'Fingerprint'])

    await user.click(modeButton('Detect from host'))

    expect(modeButton('Detect from host')).toHaveAttribute('aria-pressed', 'true')
    expect(hostInput()).toHaveValue(HOST)
    expect(headerLabels()).toEqual(['Key type', 'Fingerprint'])
    expect(bodyRows()).toHaveLength(3)
    expect(shownText(BAD_LINE_3)).toBeNull()

    await user.click(modeButton('Paste lines'))

    const view = EditorView.findFromDOM(editor())
    expect(view?.state.doc.toString()).toBe(PASTE_TEXT)
    expect(headerLabels()).toEqual(['Host', 'Key type', 'Fingerprint'])
    expect(screen.getByText('jump-02, 10.20.4.40')).toBeInTheDocument()
    expect(screen.getByText(BAD_LINE_3)).toBeInTheDocument()
    await advance(1000)
    expect(api.parseHostLines).toHaveBeenCalledTimes(1)
    expect(api.detectHostKeys).toHaveBeenCalledTimes(1)
  })

  it('shows only the visible mode error', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const message = 'db-01.lab.internal:22 did not answer as an SSH server'
    api.detectHostKeys.mockRejectedValueOnce(apiError(400, message))
    renderDialog()
    await typeHost(user)
    await user.click(detectButton())
    await screen.findByText(message)

    await openPaste(user)
    expect(shownText(message)).toBeNull()

    await user.click(modeButton('Detect from host'))
    expect(shownText(message)).not.toBeNull()
  })

  it('follows the visible mode checked rows for Add', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderDialog()
    await pasteAndParse(user, PARSED, PASTE_TEXT)
    expect(addButton()).toBeEnabled()

    await user.click(modeButton('Detect from host'))
    expect(addButton()).toBeDisabled()

    await user.click(modeButton('Paste lines'))
    expect(addButton()).toBeEnabled()
  })
})

describe('AddHostsDialog - Add, Cancel and Esc', () => {
  it('hands one entry per checked detected key, with the fingerprint it showed, then closes', async () => {
    const user = userEvent.setup()
    const { onAdd, onOpenChange } = renderDialog()
    await detect(user)
    await user.click(rowCheckbox(rowFor(/ECDSA/)))

    await user.click(addButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith([
      { host: HOST, port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
      { host: HOST, port: 22, key_type: 'RSA', key: RSA_KEY, fingerprint: FP_RSA },
    ])
    expect(onAdd.mock.invocationCallOrder[0]).toBeLessThan(onOpenChange.mock.invocationCallOrder[0])
  })

  it('leaves marked detected keys out of Add', async () => {
    const user = userEvent.setup()
    const { onAdd, onOpenChange } = renderDialog({
      stagedHosts: [savedHost(HOST, 22, 'RSA', FP_RSA), savedHost(HOST, 22, 'ECDSA', FP_OTHER)],
    })
    await detect(user)

    await user.click(addButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onAdd).toHaveBeenCalledWith([
      { host: HOST, port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
    ])
  })

  describe('from pasted lines', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it("hands one entry per name of every checked row, each with the row's fingerprint, then closes", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { onAdd, onOpenChange } = renderDialog()
      await pasteAndParse(user, PARSED, PASTE_TEXT)

      await user.click(addButton())

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onAdd).toHaveBeenCalledTimes(1)
      expect(onAdd).toHaveBeenCalledWith([
        { host: 'jump-02', port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
        { host: '10.20.4.40', port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
        { host: 'etl-02.corp.example', port: 22, key_type: 'ECDSA', key: EC_KEY, fingerprint: FP_EC },
        { host: 'files.corp.example', port: 22, key_type: 'RSA', key: RSA_KEY, fingerprint: FP_RSA },
      ])
    })

    it('skips the names already trusted with that key and the unchecked rows', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { onAdd, onOpenChange } = renderDialog({
        stagedHosts: [savedHost('jump-02', 22, 'ED25519', FP_ED)],
      })
      await pasteAndParse(user, PARSED, PASTE_TEXT)
      await user.click(rowCheckbox(rowFor(/etl-02/)))

      await user.click(addButton())

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onAdd).toHaveBeenCalledWith([
        { host: '10.20.4.40', port: 22, key_type: 'ED25519', key: ED_KEY, fingerprint: FP_ED },
        { host: 'files.corp.example', port: 22, key_type: 'RSA', key: RSA_KEY, fingerprint: FP_RSA },
      ])
    })

    it('keeps the port of a bracketed line in its entries', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { onAdd, onOpenChange } = renderDialog()
      await pasteAndParse(user, {
        entries: [entry(['files.corp.example'], 'RSA', RSA_KEY, FP_RSA, 2222)],
        errors: [],
      })

      await user.click(addButton())

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(onAdd).toHaveBeenCalledWith([
        { host: 'files.corp.example', port: 2222, key_type: 'RSA', key: RSA_KEY, fingerprint: FP_RSA },
      ])
    })
  })

  it('closes on Cancel and stages nothing', async () => {
    const user = userEvent.setup()
    const { onAdd, onOpenChange } = renderDialog()
    await detect(user)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('closes on Esc and stages nothing', async () => {
    const user = userEvent.setup()
    const { onAdd, onOpenChange } = renderDialog()
    await detect(user)
    await user.click(hostInput())

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('opens fresh in "Detect from host" each time', async () => {
    vi.useFakeTimers()
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const { rerenderWith } = renderDialog()
      await detect(user)
      await setPort(user, '2222')
      await pasteAndParse(user, PARSED, PASTE_TEXT)

      rerenderWith({ open: false })
      rerenderWith({ open: true })

      expect(modeButton('Detect from host')).toHaveAttribute('aria-pressed', 'true')
      expect(hostInput()).toHaveValue('')
      expect(portInput()).toHaveDisplayValue('22')
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(addButton()).toBeDisabled()

      await openPaste(user)
      const view = EditorView.findFromDOM(editor())
      expect(view?.state.doc.toString()).toBe('')
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByText(BAD_LINE_3)).not.toBeInTheDocument()
      expect(addButton()).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })
})
