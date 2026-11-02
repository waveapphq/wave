/**
 * McpServerTab Component Tests
 *
 * REQ-5.2.7.1, REQ-5.2.7.14, REQ-4.7.16 (MCP-1..MCP-9, SETTINGS-18, NET-11).
 *
 * Presentational contract for the whole MCP Server page: the first-read
 * states, status bar states, staged enablement rows with Active cues, the
 * staged Endpoint group, Cancel and Save on the "MCP Server" heading line,
 * the Save confirmation drawn from the page state, the stored password behind
 * the masked clear-and-edit field with its strength score, the rows on the
 * shared settings row, sessions with Disconnect, and the scrollable
 * activity feed. Wording is pinned to the approved wireframes.
 *
 * Component under test: frontend/src/features/settings/page/mcp-server-tab.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { scorePassword } = vi.hoisted(() => ({ scorePassword: vi.fn() }))
const sectionErrorSpy = vi.hoisted(() => vi.fn())

vi.mock('@/features/settings/api/password-strength', () => ({ scorePassword }))

vi.mock('@/features/settings/components/section-error', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/components/section-error')>()
  sectionErrorSpy.mockImplementation(actual.SectionError)
  return { ...actual, SectionError: sectionErrorSpy }
})

import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import { McpServerTab, type McpServerTabProps } from '@/features/settings/page/mcp-server-tab'

// ============================================================================
// Mock Data
// ============================================================================

const stoppedSettings: McpSettings = {
  enabled: false,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password_set: false,
  running: false,
  server_port: 8000,
}

const stoppedStatus: McpStatus = {
  running: false,
  enabled: false,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  urls: [],
  connected_clients: 0,
  sessions: [],
  recent_activity: [],
  last_error: null,
}

const runningStatus: McpStatus = {
  running: true,
  enabled: true,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  urls: ['http://127.0.0.1:8765/mcp', 'http://192.0.2.20:8765/mcp'],
  connected_clients: 2,
  sessions: [
    {
      session_id: 'sess-1',
      client: 'claude-code',
      client_version: '2.1.0',
      ip: '127.0.0.1',
      connected_at: '2026-07-16T14:00:02Z',
      last_activity: '2026-07-16T14:02:31Z',
    },
    {
      session_id: 'sess-2',
      client: 'mcp-inspector',
      client_version: '0.9.1',
      ip: '192.0.2.14',
      connected_at: '2026-07-16T13:41:19Z',
      last_activity: '2026-07-16T13:58:00Z',
    },
  ],
  recent_activity: [
    { timestamp: '2026-07-16T14:02:31Z', client: 'claude-code', tool: 'start_execution' },
    { timestamp: '2026-07-16T14:02:18Z', client: 'claude-code', tool: 'get_test' },
    { timestamp: '2026-07-16T14:01:03Z', client: 'mcp-inspector', tool: 'get_failure_report' },
  ],
  last_error: null,
}

const runningSettings: McpSettings = { ...stoppedSettings, enabled: true, running: true }

const defaultStaged = {
  enabled: false,
  until_restart: false,
  port: '8765',
  bind: 'local' as const,
  auth_enabled: false,
  auth_username: '',
  auth_password: '',
}

const runningStaged = { ...defaultStaged, enabled: true }

function typedPassword(password: string, username = 'wave') {
  return {
    ...defaultStaged,
    auth_enabled: true,
    auth_username: username,
    auth_password: password,
  }
}

type Staged = McpServerTabProps['staged']

const storedSettings: McpSettings = {
  ...stoppedSettings,
  auth_enabled: true,
  auth_username: 'wave',
  auth_password_set: true,
}

// The staged password stays undefined until the user touches the field.
const untouchedStaged: Staged = {
  ...defaultStaged,
  auth_enabled: true,
  auth_username: 'wave',
  auth_password: undefined,
}

// "Delete & Edit" with nothing typed yet stages the empty password.
const emptiedStaged: Staged = { ...untouchedStaged, auth_password: '' }

const replacedStaged: Staged = { ...untouchedStaged, auth_password: 'hunter2' }

const PAGE_DESCRIPTION =
  'Let AI assistants connect to WAVE as ordinary clients over the Model Context Protocol. ' +
  'Assistants use the same services, validation, and secret masking as the web UI; their ' +
  'runs are tracked in Executions.'

const ENABLEMENT_SUBTITLE = 'Turn the MCP endpoint on or off without restarting the WAVE server.'
const ENDPOINT_SUBTITLE = 'Where the MCP server listens and how clients must authenticate.'

const PERSISTENT_HELP = 'Persistent: the endpoint stays enabled across WAVE restarts.'
const UNTIL_RESTART_HELP = 'Turns off automatically the next time the WAVE server restarts.'
const PORT_HELP = 'The port the MCP endpoint listens on.'
const BIND_HELP = 'Local only keeps the endpoint reachable solely from this machine.'
const AUTH_HELP = 'Clients must send HTTP Basic credentials with every request.'
const PASSWORD_HELP = 'Stored sealed; shown write-only like other credentials.'

const CONFIRM_TITLE = 'Save MCP server changes?'
const RESTART_SENTENCE =
  'The MCP server restarts with the new configuration. Connected assistants are ' +
  'disconnected and must reconnect. The main WAVE server and running executions ' +
  'are not affected.'
const EXPOSURE_WARNING =
  'Bind scope changes to Network: any machine that can reach this server can contact the ' +
  'endpoint. Require authentication to control who may act through WAVE.'

const LOAD_ERROR = 'Network error'

const EDIT_CONFIRM_TITLE = 'Edit Protected Value?'
const EDIT_CONFIRM_BODY =
  'Editing will permanently delete the existing protected value. You will need to enter a ' +
  'new value. This action cannot be undone.'
const PASSWORD_REQUIRED = 'Password is required when authentication is enabled'
const PASSWORD_DOTS = '••••••••'
const PORT_RANGE_ERROR = 'Port must be between 1024 and 65535'

// ============================================================================
// Render helper
// ============================================================================

function makeProps(props: Partial<McpServerTabProps> = {}): McpServerTabProps {
  return {
    settings: stoppedSettings,
    status: stoppedStatus,
    readStatus: 'loaded',
    error: undefined,
    statusError: undefined,
    staged: defaultStaged,
    dirty: false,
    saving: false,
    confirmation: undefined,
    onStageChange: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    onConfirmSave: vi.fn(),
    onDismissConfirmation: vi.fn(),
    onDisconnectSession: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
}

function renderTab(props: Partial<McpServerTabProps> = {}) {
  const defaultProps = makeProps(props)
  return { ...render(<McpServerTab {...defaultProps} />), props: defaultProps }
}

// The smallest ancestor of the "MCP Server" heading that holds Save; nesting depth is not pinned.
function pageHeader(): HTMLElement {
  let node = screen.getByRole('heading', { name: 'MCP Server' }).parentElement
  while (node && !within(node).queryByRole('button', { name: 'Save' })) {
    node = node.parentElement
  }
  if (!node) throw new Error('No Save button around the "MCP Server" heading')
  return node
}

function saveButton(): HTMLElement {
  return within(pageHeader()).getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return within(pageHeader()).getByRole('button', { name: 'Cancel' })
}

// The smallest ancestor of a control that also holds its help line: the settings row.
function rowOf(control: HTMLElement, help: string): HTMLElement {
  let node = control.parentElement
  while (node && !within(node).queryByText(help)) {
    node = node.parentElement
  }
  if (!node) throw new Error(`No row holds "${help}"`)
  return node
}

function passwordInput(): HTMLElement {
  return screen.getByLabelText('Password')
}

function strengthMeter(): HTMLElement {
  return screen.getByRole('meter', { name: 'Password strength' })
}

function queryStrengthMeter(): HTMLElement | null {
  return screen.queryByRole('meter', { name: 'Password strength' })
}

// The smallest ancestor of the Password input that also holds the score: the control's column.
function passwordColumn(): HTMLElement {
  const score = strengthMeter()
  let node = passwordInput().parentElement
  while (node && !node.contains(score)) {
    node = node.parentElement
  }
  if (!node) throw new Error('The Password input and the strength score share no column')
  return node
}

// What a sighted user reads: every text node outside the screen reader meter.
function visibleText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  copy.querySelectorAll('meter').forEach((meter) => meter.remove())
  return (copy.textContent ?? '').trim()
}

function saveDialog(): HTMLElement {
  return screen.getByRole('alertdialog', { name: CONFIRM_TITLE })
}

function buttonLabels(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '')
}

function flattened(element: HTMLElement): string {
  return (element.textContent ?? '').replaceAll(/\s+/g, ' ').trim()
}

// The stored state of the Password row: a button under the row's label, never an input.
function maskedPassword(): HTMLElement {
  return screen.getByLabelText('Password', { selector: 'button' })
}

function queryMaskedPassword(): HTMLElement | null {
  return screen.queryByLabelText('Password', { selector: 'button' })
}

// The typing state of the Password row.
function passwordField(): HTMLElement {
  return screen.getByLabelText('Password', { selector: 'input' })
}

function queryPasswordField(): HTMLElement | null {
  return screen.queryByLabelText('Password', { selector: 'input' })
}

function editConfirm(): HTMLElement {
  return screen.getByRole('dialog', { name: EDIT_CONFIRM_TITLE })
}

function queryEditConfirm(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: EDIT_CONFIRM_TITLE })
}

// The eye toggle of a typed password, under either of its two names.
function eyeButtons(): HTMLElement[] {
  return [
    ...screen.queryAllByRole('button', { name: 'Show password' }),
    ...screen.queryAllByRole('button', { name: 'Hide password' }),
  ]
}

// The elements a control names in aria-describedby, in order.
function describers(control: HTMLElement): HTMLElement[] {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element !== null)
}

function descriptions(control: HTMLElement): string[] {
  return describers(control).map((element) => (element.textContent ?? '').trim())
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function lastSectionErrorProps(): Record<string, unknown> | undefined {
  return sectionErrorSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

interface SettingsRow {
  label: string
  help?: string
  control: () => HTMLElement
}

const SETTINGS_ROWS: readonly SettingsRow[] = [
  {
    label: 'Enable MCP server',
    help: PERSISTENT_HELP,
    control: () => screen.getByRole('switch', { name: 'Enable MCP server' }),
  },
  {
    label: 'Enable until restart',
    help: UNTIL_RESTART_HELP,
    control: () => screen.getByRole('switch', { name: 'Enable until restart' }),
  },
  { label: 'Port', help: PORT_HELP, control: () => screen.getByRole('textbox', { name: 'Port' }) },
  {
    label: 'Bind scope',
    help: BIND_HELP,
    control: () => screen.getByRole('combobox', { name: 'Bind scope' }),
  },
  {
    label: 'Require authentication',
    help: AUTH_HELP,
    control: () => screen.getByRole('switch', { name: 'Require authentication' }),
  },
  { label: 'Username', control: () => screen.getByRole('textbox', { name: 'Username' }) },
  { label: 'Password', help: PASSWORD_HELP, control: () => screen.getByLabelText('Password') },
]

const ROWS_WITH_HELP = SETTINGS_ROWS.filter(
  (row): row is SettingsRow & { help: string } => row.help !== undefined,
)

// Advances fake time, then lets the score request settle.
async function elapse(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
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

// ============================================================================
// Tests
// ============================================================================

describe('McpServerTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    scorePassword.mockReset()
    // Never answers outside the strength tests, so no score lands after a test has moved on.
    scorePassword.mockReturnValue(new Promise(() => {}))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Section structure (MCP-1)', () => {
    it('renders the tab with its heading and section order', () => {
      renderTab()

      expect(screen.getByTestId('mcp-server-tab')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'MCP Server' })).toBeInTheDocument()
      const headings = screen
        .getAllByRole('heading')
        .map((heading) => heading.textContent)
      expect(headings).toEqual([
        'MCP Server',
        'Enablement',
        'Endpoint',
        'Sessions',
        'Recent Activity',
      ])
    })

    it('keeps the page description under the heading line', () => {
      renderTab()

      expect(screen.getByText(PAGE_DESCRIPTION)).toBeInTheDocument()
    })
  })

  describe('First read pending', () => {
    it('shows skeletons on first load', () => {
      renderTab({ settings: undefined, status: undefined, readStatus: 'pending' })

      expect(screen.getByTestId('mcp-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('mcp-status-bar')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Enablement' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Endpoint' })).not.toBeInTheDocument()
    })

    it('shows the "MCP Server" heading with its title only, with no Cancel or Save', () => {
      renderTab({ settings: undefined, status: undefined, readStatus: 'pending' })

      const heading = screen.getByRole('heading', { name: 'MCP Server' })
      expect(heading.parentElement).not.toBeNull()
      expect(within(heading.parentElement as HTMLElement).queryAllByRole('button')).toHaveLength(0)
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('shows skeletons and no Cancel or Save while a later read is pending', () => {
      renderTab({ readStatus: 'pending' })

      expect(screen.getByTestId('mcp-loading')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })
  })

  describe('First read failed', () => {
    it('shows an inline error with Try Again wired to onRetry', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: LOAD_ERROR,
      })

      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent(LOAD_ERROR)

      await user.click(screen.getByRole('button', { name: 'Try Again' }))
      expect(props.onRetry).toHaveBeenCalledTimes(1)
    })

    it('shows the "MCP Server" heading with no Cancel or Save', () => {
      renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: LOAD_ERROR,
      })

      expect(screen.getByRole('heading', { name: 'MCP Server' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('shows the error in place of the sections and the skeletons', () => {
      renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: LOAD_ERROR,
      })

      expect(screen.queryByTestId('mcp-loading')).not.toBeInTheDocument()
      expect(screen.queryByTestId('mcp-status-bar')).not.toBeInTheDocument()
      expect(screen.queryByTestId('mcp-status-stale')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Enablement' })).not.toBeInTheDocument()
    })

    it('shows the error with Try Again and no Cancel or Save when a later read fails', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ readStatus: 'failed', error: LOAD_ERROR })

      expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR)
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Try Again' }))
      expect(props.onRetry).toHaveBeenCalledTimes(1)
    })

    it('renders the failure through SectionError with the API reason and onRetry', () => {
      const { props } = renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: LOAD_ERROR,
      })

      expect(lastSectionErrorProps()).toMatchObject({
        message: LOAD_ERROR,
        onRetry: props.onRetry,
      })
    })

    it('hands SectionError an empty reason when the failure carries none', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: undefined,
      })

      expect(lastSectionErrorProps()).toMatchObject({ message: '' })

      await user.click(screen.getByRole('button', { name: 'Try Again' }))
      expect(props.onRetry).toHaveBeenCalledTimes(1)
    })

    it('keeps the "MCP Server" heading and the page description above the error', () => {
      renderTab({
        settings: undefined,
        status: undefined,
        readStatus: 'failed',
        error: LOAD_ERROR,
      })

      const heading = screen.getByRole('heading', { name: 'MCP Server' })
      const description = screen.getByText(PAGE_DESCRIPTION)
      const alert = screen.getByRole('alert')
      expect(follows(heading, description)).toBe(true)
      expect(follows(description, alert)).toBe(true)
      expect(within(alert).getByText(LOAD_ERROR)).toBeInTheDocument()
      expect(buttonLabels(alert)).toEqual(['Try Again'])
    })
  })

  describe('A status poll failed', () => {
    it('names a failed status read above the last known state', () => {
      renderTab({ statusError: 'Status read failed' })

      const stale = screen.getByTestId('mcp-status-stale')
      expect(stale).toHaveTextContent('Status read failed (showing the last known state)')
      // The loaded sections stay on screen; the failure only annotates them.
      expect(screen.getByTestId('mcp-status-bar')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Enablement' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
    })

    it('puts the note before the status bar', () => {
      renderTab({ statusError: 'Status read failed' })

      const stale = screen.getByTestId('mcp-status-stale')
      const bar = screen.getByTestId('mcp-status-bar')
      expect(stale.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps Cancel and Save working on the staged page', () => {
      renderTab({
        statusError: 'Status read failed',
        dirty: true,
        staged: { ...defaultStaged, port: '9001' },
      })

      expect(saveButton()).toBeEnabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('shows no staleness line while every read is healthy', () => {
      renderTab()

      expect(screen.queryByTestId('mcp-status-stale')).not.toBeInTheDocument()
    })
  })

  describe('Header Cancel and Save (MCP-4, SETTINGS-18)', () => {
    it('puts Cancel then Save on the "MCP Server" heading line, apart from the sections', () => {
      renderTab()

      const header = pageHeader()
      const cancel = within(header).getByRole('button', { name: 'Cancel' })
      const save = within(header).getByRole('button', { name: 'Save' })
      expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(within(header).queryByText(PAGE_DESCRIPTION)).not.toBeInTheDocument()
      expect(within(header).queryByRole('heading', { name: 'Enablement' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('heading', { name: 'Endpoint' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('switch')).not.toBeInTheDocument()
      expect(within(header).queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('has exactly one Cancel and one Save on the page', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
    })

    it('has no footer bar: no Apply button and no mcp-endpoint- test id', () => {
      const { container } = renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()
      expect(screen.queryByTestId('mcp-endpoint-cancel')).not.toBeInTheDocument()
      expect(screen.queryByTestId('mcp-endpoint-apply')).not.toBeInTheDocument()
      expect(container.querySelectorAll('[data-testid^="mcp-endpoint-"]')).toHaveLength(0)
    })

    it('both buttons are disabled until dirty', () => {
      renderTab({ dirty: false })

      expect(cancelButton()).toBeDisabled()
      expect(saveButton()).toBeDisabled()
    })

    it('both buttons enable when an endpoint field is staged', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      expect(cancelButton()).toBeEnabled()
      expect(saveButton()).toBeEnabled()
    })

    it('both buttons enable when only an enablement mode is staged', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, enabled: true } })

      expect(cancelButton()).toBeEnabled()
      expect(saveButton()).toBeEnabled()
    })

    it('Save calls onSave', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      await user.click(saveButton())

      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onCancel).not.toHaveBeenCalled()
      expect(props.onConfirmSave).not.toHaveBeenCalled()
    })

    it('Cancel calls onCancel', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      await user.click(cancelButton())

      expect(props.onCancel).toHaveBeenCalledTimes(1)
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('saving: shows Save busy and disables Cancel and Save', () => {
      renderTab({ dirty: true, saving: true, staged: { ...defaultStaged, port: '9001' } })

      expect(saveButton()).toHaveAttribute('aria-busy', 'true')
      expect(saveButton()).toBeDisabled()
      expect(cancelButton()).toBeDisabled()
    })

    it('saving: a click on the busy Save does not call onSave again', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        dirty: true,
        saving: true,
        staged: { ...defaultStaged, port: '9001' },
      })

      await user.click(saveButton())

      expect(props.onSave).not.toHaveBeenCalled()
    })
  })

  describe('Saving (SETTINGS-18)', () => {
    const savingProps = {
      dirty: true,
      saving: true,
      staged: {
        ...defaultStaged,
        enabled: true,
        port: '9001',
        auth_enabled: true,
        auth_username: 'wave',
      },
    }

    it('disables the two Enablement switches', () => {
      renderTab(savingProps)

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Enable until restart' })).toBeDisabled()
    })

    it('disables every Endpoint input', () => {
      renderTab(savingProps)

      expect(screen.getByRole('textbox', { name: 'Port' })).toBeDisabled()
      expect(screen.getByTestId('mcp-bind-select')).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Require authentication' })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'Username' })).toBeDisabled()
      expect(passwordInput()).toBeDisabled()
    })

    it('keeps the staged values on screen while they are disabled', () => {
      renderTab(savingProps)

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'Port' })).toHaveValue('9001')
      expect(screen.getByRole('switch', { name: 'Require authentication' })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('wave')
    })

    it('a click on a disabled switch stages nothing', async () => {
      const user = userEvent.setup()
      const { props } = renderTab(savingProps)

      await user.click(screen.getByRole('switch', { name: 'Enable until restart' }))
      await user.click(screen.getByRole('switch', { name: 'Require authentication' }))

      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it('enables every control again once the save has ended', () => {
      const { rerender, props } = renderTab(savingProps)

      rerender(<McpServerTab {...props} saving={false} />)

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).toBeEnabled()
      expect(screen.getByRole('switch', { name: 'Enable until restart' })).toBeEnabled()
      expect(screen.getByRole('textbox', { name: 'Port' })).toBeEnabled()
      expect(screen.getByTestId('mcp-bind-select')).toBeEnabled()
      expect(screen.getByRole('switch', { name: 'Require authentication' })).toBeEnabled()
      expect(screen.getByRole('textbox', { name: 'Username' })).toBeEnabled()
      expect(passwordInput()).toBeEnabled()
    })
  })

  describe('Status bar (MCP-2)', () => {
    it('running: shows Running, every reachable address with a copy button, and client meta', () => {
      renderTab({ status: runningStatus })

      const bar = screen.getByTestId('mcp-status-bar')
      expect(within(bar).getByText('Running')).toBeInTheDocument()
      expect(within(bar).getByText('http://127.0.0.1:8765/mcp')).toBeInTheDocument()
      expect(within(bar).getByText('http://192.0.2.20:8765/mcp')).toBeInTheDocument()
      expect(
        within(bar).getByRole('button', { name: 'Copy http://127.0.0.1:8765/mcp' }),
      ).toBeInTheDocument()
      expect(
        within(bar).getByRole('button', { name: 'Copy http://192.0.2.20:8765/mcp' }),
      ).toBeInTheDocument()
      expect(within(bar).getByText('2 clients connected')).toBeInTheDocument()
      expect(within(bar).getByText(/Last activity/)).toBeInTheDocument()
    })

    it('running: keeps each address out of page translation', () => {
      renderTab({ status: runningStatus })

      const bar = within(screen.getByTestId('mcp-status-bar'))
      for (const url of runningStatus.urls) {
        expect(bar.getByText(url)).toHaveAttribute('translate', 'no')
      }
    })

    it('shows singular "client" when exactly one client is connected', () => {
      renderTab({ status: { ...runningStatus, connected_clients: 1 } })

      const bar = screen.getByTestId('mcp-status-bar')
      expect(within(bar).getByText('1 client connected')).toBeInTheDocument()
    })

    it('omits the last-activity meta when there is no activity', () => {
      renderTab({ status: { ...runningStatus, recent_activity: [] } })

      const bar = screen.getByTestId('mcp-status-bar')
      expect(within(bar).queryByText(/Last activity/)).not.toBeInTheDocument()
    })

    it('stopped: shows Stopped with the disabled message and no URL', () => {
      renderTab({ status: stoppedStatus })

      const bar = screen.getByTestId('mcp-status-bar')
      expect(within(bar).getByText('Stopped')).toBeInTheDocument()
      expect(within(bar).getByText('The MCP endpoint is disabled.')).toBeInTheDocument()
      expect(within(bar).queryByText(/http:\/\//)).not.toBeInTheDocument()
      expect(
        within(bar).queryByRole('button', { name: /^Copy http/ }),
      ).not.toBeInTheDocument()
    })

    it('stopped with last_error: surfaces the error text', () => {
      renderTab({
        status: { ...stoppedStatus, last_error: 'Port 8765 is already in use' },
      })

      const bar = screen.getByTestId('mcp-status-bar')
      expect(within(bar).getByText('Stopped')).toBeInTheDocument()
      expect(within(bar).getByText(/Port 8765 is already in use/)).toBeInTheDocument()
    })

    it('copies an address and flips its own button to a transient check state', async () => {
      const user = userEvent.setup()
      // spyOn AFTER setup(): user-event replaces navigator.clipboard with a
      // getter-only stub, so assigning a mock clipboard would throw (see
      // about-tab.test.tsx for the same pattern).
      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockResolvedValue(undefined)

      renderTab({ status: runningStatus })

      await user.click(screen.getByRole('button', { name: 'Copy http://127.0.0.1:8765/mcp' }))

      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:8765/mcp')
      const check = await screen.findByTestId('mcp-copy-success')
      expect(
        screen.getByRole('button', { name: 'Copy http://127.0.0.1:8765/mcp' }),
      ).toContainElement(check)
      writeText.mockRestore()
    })

    it('copying a second address moves the check to that row', async () => {
      const user = userEvent.setup()
      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockResolvedValue(undefined)

      renderTab({ status: runningStatus })

      await user.click(screen.getByRole('button', { name: 'Copy http://127.0.0.1:8765/mcp' }))
      await user.click(
        screen.getByRole('button', { name: 'Copy http://192.0.2.20:8765/mcp' }),
      )

      expect(writeText).toHaveBeenLastCalledWith('http://192.0.2.20:8765/mcp')
      const checks = await screen.findAllByTestId('mcp-copy-success')
      expect(checks).toHaveLength(1)
      expect(
        screen.getByRole('button', { name: 'Copy http://192.0.2.20:8765/mcp' }),
      ).toContainElement(checks[0])
      writeText.mockRestore()
    })

    it('silently fails when the clipboard write rejects', async () => {
      const user = userEvent.setup()
      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockRejectedValue(new Error('Clipboard failed'))

      renderTab({ status: runningStatus })

      await user.click(screen.getByRole('button', { name: 'Copy http://127.0.0.1:8765/mcp' }))

      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:8765/mcp')
      expect(screen.queryByTestId('mcp-copy-success')).not.toBeInTheDocument()
      writeText.mockRestore()
    })
  })

  describe('Enablement rows (MCP-3)', () => {
    it('renders both rows with wireframe copy and switches off by default', () => {
      renderTab()

      expect(screen.getByText('Enable MCP server')).toBeInTheDocument()
      expect(
        screen.getByText('Persistent: the endpoint stays enabled across WAVE restarts.'),
      ).toBeInTheDocument()
      expect(screen.getByText('Enable until restart')).toBeInTheDocument()
      expect(
        screen.getByText('Turns off automatically the next time the WAVE server restarts.'),
      ).toBeInTheDocument()

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).not.toBeChecked()
      expect(screen.getByRole('switch', { name: 'Enable until restart' })).not.toBeChecked()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('shows the Enablement subtitle', () => {
      renderTab()

      expect(screen.getByText(ENABLEMENT_SUBTITLE)).toBeInTheDocument()
      expect(screen.queryByText(/Changes apply immediately/)).not.toBeInTheDocument()
    })

    it('persistent on: switch checked with the green Active cue', () => {
      renderTab({ settings: runningSettings, staged: runningStaged })

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).toBeChecked()
      expect(screen.getByTestId('mcp-persistent-active')).toHaveTextContent('Active')
      expect(screen.queryByTestId('mcp-until-restart-active')).not.toBeInTheDocument()
    })

    it('until-restart on: its switch checked with the Active cue', () => {
      renderTab({
        settings: { ...stoppedSettings, until_restart_active: true, running: true },
        staged: { ...defaultStaged, until_restart: true },
      })

      expect(screen.getByRole('switch', { name: 'Enable until restart' })).toBeChecked()
      expect(screen.getByTestId('mcp-until-restart-active')).toHaveTextContent('Active')
      expect(screen.queryByTestId('mcp-persistent-active')).not.toBeInTheDocument()
    })

    it('a staged mode shows on its switch while the Active cue waits for Save', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, enabled: true } })

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).toBeChecked()
      expect(screen.getByRole('switch', { name: 'Enable until restart' })).not.toBeChecked()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('the Active cue stays on the saved mode while the other mode is staged', () => {
      renderTab({
        settings: runningSettings,
        dirty: true,
        staged: { ...defaultStaged, enabled: false, until_restart: true },
      })

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).not.toBeChecked()
      expect(screen.getByRole('switch', { name: 'Enable until restart' })).toBeChecked()
      expect(screen.getByTestId('mcp-persistent-active')).toHaveTextContent('Active')
      expect(screen.queryByTestId('mcp-until-restart-active')).not.toBeInTheDocument()
    })

    it('the Active cue stays on a saved mode that is staged off', () => {
      renderTab({ settings: runningSettings, dirty: true, staged: defaultStaged })

      expect(screen.getByRole('switch', { name: 'Enable MCP server' })).not.toBeChecked()
      expect(screen.getByTestId('mcp-persistent-active')).toHaveTextContent('Active')
    })

    it('toggling the persistent row stages enabled on', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByRole('switch', { name: 'Enable MCP server' }))

      expect(props.onStageChange).toHaveBeenCalledTimes(1)
      expect(props.onStageChange).toHaveBeenCalledWith('enabled', true)
    })

    it('toggling the until-restart row stages until_restart on', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByRole('switch', { name: 'Enable until restart' }))

      expect(props.onStageChange).toHaveBeenCalledTimes(1)
      expect(props.onStageChange).toHaveBeenCalledWith('until_restart', true)
    })

    it('toggling an on-row stages it off', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ settings: runningSettings, staged: runningStaged })

      await user.click(screen.getByRole('switch', { name: 'Enable MCP server' }))

      expect(props.onStageChange).toHaveBeenCalledWith('enabled', false)
    })

    it('toggling a mode never saves', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByRole('switch', { name: 'Enable MCP server' }))
      await user.click(screen.getByRole('switch', { name: 'Enable until restart' }))

      expect(props.onSave).not.toHaveBeenCalled()
      expect(props.onConfirmSave).not.toHaveBeenCalled()
    })

    it.each([
      ['Enable MCP server', PERSISTENT_HELP],
      ['Enable until restart', UNTIL_RESTART_HELP],
    ])('centers the "%s" switch against its label and help line (NET-11)', (name, help) => {
      renderTab()

      const row = rowOf(screen.getByRole('switch', { name }), help)
      expect(row).toHaveClass('items-center')
      expect(row).not.toHaveClass('items-start')
    })
  })

  describe('Endpoint group (MCP-4)', () => {
    it('renders the staged field values', () => {
      renderTab({
        staged: { ...defaultStaged, port: '9001', auth_enabled: true, auth_username: 'wave' },
      })

      const port = screen.getByRole('textbox', { name: 'Port' })
      expect(port).toHaveValue('9001')
      expect(port).toHaveAttribute('inputmode', 'numeric')
      expect(screen.getByTestId('mcp-bind-select')).toHaveTextContent(/Local only/)
      expect(screen.getByRole('switch', { name: 'Require authentication' })).toBeChecked()
      expect(screen.getByRole('textbox', { name: 'Username' })).toHaveValue('wave')
    })

    it('editing the port stages the change', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.type(screen.getByRole('textbox', { name: 'Port' }), '1')

      expect(props.onStageChange).toHaveBeenCalledWith('port', '87651')
    })

    it('toggling Require authentication stages auth_enabled', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByRole('switch', { name: 'Require authentication' }))

      expect(props.onStageChange).toHaveBeenCalledWith('auth_enabled', true)
    })

    it('selecting the Network bind option stages the change', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByTestId('mcp-bind-select'))
      await user.click(screen.getByRole('option', { name: 'Network' }))

      expect(props.onStageChange).toHaveBeenCalledWith('bind', 'network')
    })

    it('typing a username stages the change', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ staged: { ...defaultStaged, auth_enabled: true } })

      await user.type(screen.getByRole('textbox', { name: 'Username' }), 'w')

      expect(props.onStageChange).toHaveBeenCalledWith('auth_username', 'w')
    })

    it('auth rows are visually disabled when authentication is off', () => {
      renderTab({ staged: { ...defaultStaged, auth_enabled: false } })

      const usernameRow = screen.getByTestId('mcp-auth-username-row')
      const passwordRow = screen.getByTestId('mcp-auth-password-row')
      expect(usernameRow.className).toContain('opacity-50')
      expect(usernameRow.className).toContain('cursor-not-allowed')
      expect(passwordRow.className).toContain('opacity-50')
      expect(passwordRow.className).toContain('cursor-not-allowed')
      expect(screen.getByRole('textbox', { name: 'Username' })).toBeDisabled()
      expect(screen.getByLabelText('Password')).toBeDisabled()
    })

    it('auth rows are editable when authentication is on', () => {
      renderTab({ staged: { ...defaultStaged, auth_enabled: true } })

      expect(screen.getByRole('textbox', { name: 'Username' })).toBeEnabled()
      expect(screen.getByLabelText('Password')).toBeEnabled()
    })

    it('password is write-only: a saved password shows masked, never an input or a value', () => {
      renderTab({ settings: storedSettings, staged: untouchedStaged })

      const masked = maskedPassword()
      expect(masked).toHaveAttribute('id', 'mcp-password-input')
      expect(masked).toHaveAccessibleName('Password: Edit protected value')
      expect(masked).toBeEnabled()
      expect(queryPasswordField()).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(PASSWORD_DOTS)).not.toBeInTheDocument()
      expect(eyeButtons()).toHaveLength(0)
      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(queryEditConfirm()).not.toBeInTheDocument()
    })

    it('typing a password stages a replacement', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ staged: { ...defaultStaged, auth_enabled: true } })

      await user.type(screen.getByLabelText('Password'), 'n')

      expect(props.onStageChange).toHaveBeenCalledWith('auth_password', 'n')
    })

    it('shows the Endpoint subtitle', () => {
      renderTab()

      expect(screen.getByText(ENDPOINT_SUBTITLE)).toBeInTheDocument()
      expect(screen.queryByText(/Edits are staged/)).not.toBeInTheDocument()
    })

    it('has no note under the Endpoint group', () => {
      renderTab()

      expect(screen.queryByText(/Apply confirms first/)).not.toBeInTheDocument()
      expect(screen.queryByText(/adds an exposure warning/)).not.toBeInTheDocument()
      expect(screen.getByTestId('mcp-server-tab')).not.toHaveTextContent(/\bApply\b/)
    })

    it('centers the Require authentication switch against its label and help line (NET-11)', () => {
      renderTab()

      const row = rowOf(screen.getByRole('switch', { name: 'Require authentication' }), AUTH_HELP)
      expect(row).toHaveClass('items-center')
      expect(row).not.toHaveClass('items-start')
    })

    it('centers the Port and Bind scope controls against their label and help line (NET-11)', () => {
      renderTab()

      const portRow = rowOf(screen.getByRole('textbox', { name: 'Port' }), PORT_HELP)
      const bindRow = rowOf(screen.getByTestId('mcp-bind-select'), BIND_HELP)
      expect(portRow).toHaveClass('items-center')
      expect(bindRow).toHaveClass('items-center')
    })
  })

  describe('Port validation as soon as a port is staged', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('drops a key the number rule refuses in the port field (REQ-3.1.3.14)', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.type(screen.getByRole('textbox', { name: 'Port' }), 'x')
      await user.type(screen.getByRole('textbox', { name: 'Port' }), '{Home}-')

      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it('stages a digit typed into the port field', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.type(screen.getByRole('textbox', { name: 'Port' }), '0')

      expect(props.onStageChange).toHaveBeenCalledWith('port', '87650')
    })

    it.each(['', '80', '1023', '65536', '99999', '0000065536', '12345678901234567890'])(
      'port %j shows the range error and disables Save',
      (port) => {
        renderTab({ dirty: true, staged: { ...defaultStaged, port } })

        expect(screen.getByTestId('mcp-port-error')).toHaveTextContent(
          'Port must be between 1024 and 65535',
        )
        expect(screen.getByRole('textbox', { name: 'Port' })).toHaveAttribute(
          'aria-invalid',
          'true',
        )
        expect(saveButton()).toBeDisabled()
        expect(saveButton()).not.toHaveAttribute('aria-busy')
      },
    )

    it("rejects WAVE's own UI port immediately", () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '3000' } })

      expect(screen.getByTestId('mcp-port-error')).toHaveTextContent(
        'Port 3000 is used by WAVE itself',
      )
      expect(saveButton()).toBeDisabled()
    })

    it("rejects the WAVE API's serving port immediately", () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '8000' } })

      expect(screen.getByTestId('mcp-port-error')).toHaveTextContent(
        'Port 8000 is used by WAVE itself',
      )
      expect(saveButton()).toBeDisabled()
    })

    it('rejects the configured API port immediately', () => {
      vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8123')
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '8123' } })

      expect(screen.getByTestId('mcp-port-error')).toHaveTextContent(
        'Port 8123 is used by WAVE itself',
      )
      expect(saveButton()).toBeDisabled()
    })

    it('a valid staged port shows no error', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '9001' } })

      expect(screen.queryByTestId('mcp-port-error')).not.toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
    })

    it('Cancel stays enabled while the staged port is invalid', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, port: '80' } })

      expect(saveButton()).toBeDisabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('an invalid port blocks Save even when an enablement mode is staged with it', () => {
      renderTab({ dirty: true, staged: { ...defaultStaged, enabled: true, port: '80' } })

      expect(saveButton()).toBeDisabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('a click on Save does nothing while the port is invalid', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ dirty: true, staged: { ...defaultStaged, port: '80' } })

      await user.click(saveButton())

      expect(props.onSave).not.toHaveBeenCalled()
    })
  })

  describe('Password reveal for a staged value only', () => {
    it('shows no reveal affordance when nothing is staged', () => {
      renderTab({ staged: { ...defaultStaged, auth_enabled: true } })

      expect(
        screen.queryByRole('button', { name: 'Show password' }),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    })

    it('reveals and hides a staged replacement', async () => {
      const user = userEvent.setup()
      renderTab({
        dirty: true,
        staged: { ...defaultStaged, auth_enabled: true, auth_password: 'hunter2' },
      })

      const input = screen.getByLabelText('Password')
      expect(input).toHaveAttribute('type', 'password')

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(input).toHaveAttribute('type', 'text')

      await user.click(screen.getByRole('button', { name: 'Hide password' }))
      expect(input).toHaveAttribute('type', 'password')
    })

    it('clearing the field resets the reveal to hidden', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        dirty: true,
        staged: { ...defaultStaged, auth_enabled: true, auth_password: 'h' },
      })

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')

      await user.type(screen.getByLabelText('Password'), '{backspace}')

      expect(props.onStageChange).toHaveBeenCalledWith('auth_password', '')
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    })

    it('a password typed after Save or Cancel emptied the field starts hidden', async () => {
      const user = userEvent.setup()
      const withPassword = { ...defaultStaged, auth_enabled: true, auth_password: 'hunter2' }
      const { rerender, props } = renderTab({ dirty: true, staged: withPassword })
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')

      rerender(
        <McpServerTab {...props} dirty={false} staged={{ ...withPassword, auth_password: '' }} />,
      )
      rerender(<McpServerTab {...props} staged={{ ...withPassword, auth_password: 'n' }} />)

      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
    })

    it('shows no reveal affordance while authentication is off', () => {
      renderTab({
        staged: { ...defaultStaged, auth_enabled: false, auth_password: 'hunter2' },
      })

      expect(
        screen.queryByRole('button', { name: 'Show password' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Stored password behind the masked field (MCP-7)', () => {
    const stored: Partial<McpServerTabProps> = { settings: storedSettings, staged: untouchedStaged }

    it('a click on the masked control asks "Edit Protected Value?" and stages nothing yet', async () => {
      const user = userEvent.setup()
      const { props } = renderTab(stored)

      await user.click(maskedPassword())

      const confirm = editConfirm()
      expect(confirm).toHaveAccessibleDescription(EDIT_CONFIRM_BODY)
      expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(within(confirm).getByRole('button', { name: 'Delete & Edit' })).toBeInTheDocument()
      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it('Cancel on the confirm leaves the password masked and stages nothing', async () => {
      const user = userEvent.setup()
      const { props } = renderTab(stored)

      await user.click(maskedPassword())
      await user.click(within(editConfirm()).getByRole('button', { name: 'Cancel' }))

      expect(queryEditConfirm()).not.toBeInTheDocument()
      expect(maskedPassword()).toHaveAttribute('id', 'mcp-password-input')
      expect(queryPasswordField()).not.toBeInTheDocument()
      expect(props.onStageChange).not.toHaveBeenCalled()
      expect(props.onCancel).not.toHaveBeenCalled()
    })

    it('"Delete & Edit" stages the empty password and nothing else', async () => {
      const user = userEvent.setup()
      const { props } = renderTab(stored)

      await user.click(maskedPassword())
      await user.click(within(editConfirm()).getByRole('button', { name: 'Delete & Edit' }))

      expect(props.onStageChange).toHaveBeenCalledTimes(1)
      expect(props.onStageChange).toHaveBeenCalledWith('auth_password', '')
      expect(queryEditConfirm()).not.toBeInTheDocument()
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('shows an empty password input under the same id once the empty password is staged', async () => {
      const user = userEvent.setup()
      const { rerender, props } = renderTab(stored)
      await user.click(maskedPassword())
      await user.click(within(editConfirm()).getByRole('button', { name: 'Delete & Edit' }))

      rerender(<McpServerTab {...props} dirty staged={emptiedStaged} />)

      const input = passwordField()
      expect(input).toHaveAttribute('id', 'mcp-password-input')
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveValue('')
      expect(input).toBeEnabled()
      expect(queryMaskedPassword()).not.toBeInTheDocument()
    })

    it('an emptied stored password shows no dots placeholder, no eye and no strength score', () => {
      renderTab({ settings: storedSettings, dirty: true, staged: emptiedStaged })

      const input = passwordField()
      expect(input).toHaveAttribute('id', 'mcp-password-input')
      expect(input).toHaveValue('')
      expect(screen.queryByPlaceholderText(PASSWORD_DOTS)).not.toBeInTheDocument()
      expect(queryMaskedPassword()).not.toBeInTheDocument()
      expect(eyeButtons()).toHaveLength(0)
      expect(queryStrengthMeter()).not.toBeInTheDocument()
    })

    it('typing into the emptied field stages the typed text', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ settings: storedSettings, dirty: true, staged: emptiedStaged })

      await user.type(passwordField(), 'n')

      expect(props.onStageChange).toHaveBeenCalledTimes(1)
      expect(props.onStageChange).toHaveBeenCalledWith('auth_password', 'n')
    })

    it('a replacement typed over a stored password shows in the input, with the eye', async () => {
      const user = userEvent.setup()
      renderTab({ settings: storedSettings, dirty: true, staged: replacedStaged })

      const input = passwordField()
      expect(input).toHaveAttribute('id', 'mcp-password-input')
      expect(input).toHaveValue('hunter2')
      expect(input).toHaveAttribute('type', 'password')
      expect(queryMaskedPassword()).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(input).toHaveAttribute('type', 'text')

      await user.click(screen.getByRole('button', { name: 'Hide password' }))
      expect(input).toHaveAttribute('type', 'password')
    })

    it.each([
      ['a typed replacement', replacedStaged],
      ['"Delete & Edit" with nothing typed', emptiedStaged],
    ])('Cancel on the page after %s brings the masked control back', (_change, staged) => {
      const { rerender, props } = renderTab({ settings: storedSettings, dirty: true, staged })
      expect(passwordField()).toBeInTheDocument()

      rerender(<McpServerTab {...props} dirty={false} staged={untouchedStaged} />)

      expect(maskedPassword()).toHaveAttribute('id', 'mcp-password-input')
      expect(queryPasswordField()).not.toBeInTheDocument()
      expect(eyeButtons()).toHaveLength(0)
    })

    it('a new password shows masked once its save has landed', () => {
      const { rerender, props } = renderTab({ dirty: true, staged: replacedStaged })
      expect(passwordField()).toHaveValue('hunter2')

      rerender(
        <McpServerTab {...props} settings={storedSettings} dirty={false} staged={untouchedStaged} />,
      )

      expect(maskedPassword()).toHaveAttribute('id', 'mcp-password-input')
      expect(queryPasswordField()).not.toBeInTheDocument()
    })

    it('the masked control is disabled while authentication is off, and a click asks nothing', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: { ...storedSettings, auth_enabled: false },
        staged: { ...untouchedStaged, auth_enabled: false },
      })

      const masked = maskedPassword()
      expect(masked).toBeDisabled()
      expect(screen.getByTestId('mcp-auth-password-row')).toHaveClass(
        'opacity-50',
        'cursor-not-allowed',
      )

      await user.click(masked)

      expect(queryEditConfirm()).not.toBeInTheDocument()
      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it('the masked control is disabled while a save runs, and a click asks nothing', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: storedSettings,
        dirty: true,
        saving: true,
        staged: { ...untouchedStaged, port: '9001' },
      })

      const masked = maskedPassword()
      expect(masked).toBeDisabled()

      await user.click(masked)

      expect(queryEditConfirm()).not.toBeInTheDocument()
      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it.each([
      ['on', true],
      ['off', false],
    ])(
      'Save with the stored password emptied calls onSave while authentication is %s',
      async (_state, authEnabled) => {
        const user = userEvent.setup()
        const { props } = renderTab({
          settings: storedSettings,
          dirty: true,
          staged: { ...emptiedStaged, auth_enabled: authEnabled },
        })

        expect(saveButton()).toBeEnabled()
        await user.click(saveButton())

        expect(props.onSave).toHaveBeenCalledTimes(1)
        expect(props.onStageChange).not.toHaveBeenCalled()
        expect(screen.queryByText(PASSWORD_REQUIRED)).not.toBeInTheDocument()
      },
    )
  })

  describe('No stored password (MCP-7)', () => {
    it('shows the empty password input from the start, with no masked control', () => {
      renderTab({ staged: untouchedStaged })

      const input = passwordField()
      expect(input).toHaveAttribute('id', 'mcp-password-input')
      expect(input).toHaveAttribute('type', 'password')
      expect(input).toHaveValue('')
      expect(input).toBeEnabled()
      expect(queryMaskedPassword()).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(PASSWORD_DOTS)).not.toBeInTheDocument()
      expect(eyeButtons()).toHaveLength(0)
    })

    it('a click on the input asks nothing', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ staged: untouchedStaged })

      await user.click(passwordField())

      expect(queryEditConfirm()).not.toBeInTheDocument()
      expect(props.onStageChange).not.toHaveBeenCalled()
    })

    it('typing stages the typed text', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ staged: untouchedStaged })

      await user.type(passwordField(), 'n')

      expect(props.onStageChange).toHaveBeenCalledTimes(1)
      expect(props.onStageChange).toHaveBeenCalledWith('auth_password', 'n')
    })

    it('a password typed after Cancel cleared the staged one starts hidden', async () => {
      const user = userEvent.setup()
      const { rerender, props } = renderTab({ dirty: true, staged: replacedStaged })
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(passwordField()).toHaveAttribute('type', 'text')

      rerender(<McpServerTab {...props} dirty={false} staged={untouchedStaged} />)
      rerender(<McpServerTab {...props} staged={{ ...untouchedStaged, auth_password: 'n' }} />)

      expect(passwordField()).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
    })
  })

  describe('Password eye on a disabled field', () => {
    it('shows no eye while a save runs', () => {
      renderTab({ dirty: true, saving: true, staged: replacedStaged })

      expect(passwordField()).toBeDisabled()
      expect(passwordField()).toHaveValue('hunter2')
      expect(eyeButtons()).toHaveLength(0)
    })

    it('drops the eye the moment a save starts and brings it back when the save ends', () => {
      const { rerender, props } = renderTab({ dirty: true, staged: replacedStaged })
      expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()

      rerender(<McpServerTab {...props} saving />)
      expect(eyeButtons()).toHaveLength(0)

      rerender(<McpServerTab {...props} saving={false} />)
      expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument()
    })

    it('drops the eye of a shown password too when a save starts', async () => {
      const user = userEvent.setup()
      const { rerender, props } = renderTab({ dirty: true, staged: replacedStaged })
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()

      rerender(<McpServerTab {...props} saving />)

      expect(eyeButtons()).toHaveLength(0)
    })

    it('shows no eye over a stored password while authentication is off', () => {
      renderTab({
        settings: storedSettings,
        dirty: true,
        staged: { ...replacedStaged, auth_enabled: false },
      })

      expect(passwordField()).toBeDisabled()
      expect(eyeButtons()).toHaveLength(0)
    })
  })

  describe('Rows on the shared settings row (MCP-4, NET-11)', () => {
    const authOn: Partial<McpServerTabProps> = { staged: { ...defaultStaged, auth_enabled: true } }

    it.each(SETTINGS_ROWS)('$label is the label of its control', ({ label, control }) => {
      renderTab(authOn)

      const target = control()
      expect(target.id).not.toBe('')
      expect(screen.getByText(label, { selector: 'label' })).toHaveAttribute('for', target.id)
    })

    it.each(ROWS_WITH_HELP)('the help line of $label describes its control', ({ help, control }) => {
      renderTab(authOn)

      expect(descriptions(control())).toContain(help)
    })

    it('the Password label and help line follow the masked control of a stored password', () => {
      renderTab({ settings: storedSettings, staged: untouchedStaged })

      const masked = maskedPassword()
      expect(screen.getByText('Password', { selector: 'label' })).toHaveAttribute(
        'for',
        'mcp-password-input',
      )
      expect(masked).toHaveAttribute('id', 'mcp-password-input')
      expect(descriptions(masked)).toContain(PASSWORD_HELP)
    })

    it('keeps the ids of the Port, Username and Password controls', () => {
      renderTab(authOn)

      expect(screen.getByRole('textbox', { name: 'Port' })).toHaveAttribute('id', 'mcp-port-input')
      expect(screen.getByRole('textbox', { name: 'Username' })).toHaveAttribute(
        'id',
        'mcp-username-input',
      )
      expect(passwordField()).toHaveAttribute('id', 'mcp-password-input')
    })

    it('keeps the login row test ids on the rows that hold the label and the control', () => {
      renderTab(authOn)

      const usernameRow = screen.getByTestId('mcp-auth-username-row')
      const passwordRow = screen.getByTestId('mcp-auth-password-row')
      expect(usernameRow).toContainElement(screen.getByRole('textbox', { name: 'Username' }))
      expect(usernameRow).toContainElement(screen.getByText('Username', { selector: 'label' }))
      expect(usernameRow).not.toContainElement(passwordField())
      expect(passwordRow).toContainElement(passwordField())
      expect(passwordRow).toContainElement(screen.getByText('Password', { selector: 'label' }))
      expect(passwordRow).toContainElement(screen.getByText(PASSWORD_HELP))
    })

    it('keeps Bind scope a select: the labeled trigger carries mcp-bind-select and stages a choice', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      const trigger = screen.getByRole('combobox', { name: 'Bind scope' })
      expect(trigger).toBe(screen.getByTestId('mcp-bind-select'))

      await user.click(trigger)
      await user.click(screen.getByRole('option', { name: 'Network' }))

      expect(props.onStageChange).toHaveBeenCalledWith('bind', 'network')
    })

    it.each([
      ['Enable MCP server', PERSISTENT_HELP, 'mcp-persistent-active', runningSettings],
      [
        'Enable until restart',
        UNTIL_RESTART_HELP,
        'mcp-until-restart-active',
        { ...stoppedSettings, until_restart_active: true, running: true },
      ],
    ])('keeps the Active cue of "%s" in its row', (name, help, testId, settings) => {
      renderTab({ settings })

      expect(rowOf(screen.getByRole('switch', { name }), help)).toContainElement(
        screen.getByTestId(testId),
      )
    })

    it('does not mute the login rows while authentication is on', () => {
      renderTab(authOn)

      for (const testId of ['mcp-auth-username-row', 'mcp-auth-password-row']) {
        const row = screen.getByTestId(testId)
        expect(row).not.toHaveClass('opacity-50')
        expect(row).not.toHaveClass('cursor-not-allowed')
      }
    })

    it('mutes the two login rows and no other row while authentication is off', () => {
      renderTab({ staged: { ...defaultStaged, auth_enabled: false } })

      for (const testId of ['mcp-auth-username-row', 'mcp-auth-password-row']) {
        expect(screen.getByTestId(testId)).toHaveClass('opacity-50', 'cursor-not-allowed')
      }
      const otherRows = SETTINGS_ROWS.filter(
        (row) => row.label !== 'Username' && row.label !== 'Password',
      )
      expect(otherRows).toHaveLength(5)
      for (const row of otherRows) {
        const control = row.control()
        expect(control.closest('.opacity-50')).toBeNull()
        expect(control.closest('.cursor-not-allowed')).toBeNull()
      }
    })

    it.each([
      ['80', PORT_RANGE_ERROR],
      ['3000', 'Port 3000 is used by WAVE itself'],
    ])(
      'port %s: the Port input is invalid and names the row message beside its help line',
      (port, message) => {
        renderTab({ dirty: true, staged: { ...defaultStaged, port } })

        const input = screen.getByRole('textbox', { name: 'Port' })
        expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(descriptions(input)).toContain(message)
        expect(descriptions(input)).toContain(PORT_HELP)
        expect(describers(input)).toContain(screen.getByTestId('mcp-port-error'))
      },
    )

    it('the Port message goes when the value is valid again', () => {
      const { rerender, props } = renderTab({
        dirty: true,
        staged: { ...defaultStaged, port: '80' },
      })
      expect(descriptions(screen.getByRole('textbox', { name: 'Port' }))).toContain(
        PORT_RANGE_ERROR,
      )

      rerender(<McpServerTab {...props} staged={{ ...defaultStaged, port: '9001' }} />)

      const input = screen.getByRole('textbox', { name: 'Port' })
      expect(input).not.toHaveAttribute('aria-invalid', 'true')
      expect(descriptions(input)).toEqual([PORT_HELP])
      expect(screen.queryByText(PORT_RANGE_ERROR)).not.toBeInTheDocument()
    })

    it('reads the Port message out when it appears: it lands in a polite region the page already had', () => {
      const { rerender, props } = renderTab({
        dirty: true,
        staged: { ...defaultStaged, port: '9001' },
      })
      const regionsBefore = Array.from(document.querySelectorAll('[aria-live="polite"]'))

      rerender(<McpServerTab {...props} staged={{ ...defaultStaged, port: '80' }} />)

      const region = screen.getByTestId('mcp-port-error').closest('[aria-live]')
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(regionsBefore).toContain(region)
      expect(screen.queryByTestId('mcp-port-error')).not.toHaveAttribute('role')
    })

    it('reads the Port message out once, not again on every digit typed', () => {
      const { rerender, props } = renderTab({
        dirty: true,
        staged: { ...defaultStaged, port: '8' },
      })
      const region = screen.getByTestId('mcp-port-error').closest('[aria-live]') as HTMLElement
      const changes = new MutationObserver(() => {})
      changes.observe(region, { attributes: true, characterData: true, childList: true, subtree: true })

      rerender(<McpServerTab {...props} staged={{ ...defaultStaged, port: '80' }} />)
      rerender(<McpServerTab {...props} staged={{ ...defaultStaged, port: '808' }} />)
      expect(changes.takeRecords()).toEqual([])

      rerender(<McpServerTab {...props} staged={{ ...defaultStaged, port: '8000' }} />)
      expect(changes.takeRecords().length).toBeGreaterThan(0)
      expect(region).toHaveTextContent('Port 8000 is used by WAVE itself')
      changes.disconnect()
    })
  })

  describe('Strength score and the stored password (MCP-7)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      scorePassword.mockResolvedValue({ score: 1, label: 'Weak' })
    })

    it('asks for no score while the stored password is untouched', async () => {
      renderTab({ settings: storedSettings, staged: untouchedStaged })

      await elapse(1000)

      expect(maskedPassword()).toBeInTheDocument()
      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).not.toHaveBeenCalled()
    })

    it('asks for no score while no password is stored and none is typed', async () => {
      renderTab({ staged: untouchedStaged })

      await elapse(1000)

      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).not.toHaveBeenCalled()
    })

    it('asks for no score after "Delete & Edit" until a password is typed', async () => {
      renderTab({ settings: storedSettings, dirty: true, staged: emptiedStaged })

      await elapse(1000)

      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).not.toHaveBeenCalled()
    })

    it('scores a replacement typed over a stored password, under the field', async () => {
      renderTab({ settings: storedSettings, dirty: true, staged: replacedStaged })

      await elapse(300)

      expect(scorePassword).toHaveBeenCalledTimes(1)
      expect(scorePassword).toHaveBeenCalledWith('hunter2', ['wave'])
      const score = strengthMeter()
      expect(score).toHaveAttribute('aria-valuetext', 'Weak')
      expect(follows(passwordField(), score)).toBe(true)
      expect(screen.getByTestId('mcp-auth-password-row')).toContainElement(score)
    })

    it('keeps the score under the id mcp-password-strength, named by the Password input', async () => {
      renderTab({ dirty: true, staged: typedPassword('hunter2') })

      await elapse(300)

      const holder = document.getElementById('mcp-password-strength')
      expect(holder).toContainElement(strengthMeter())
      expect(describers(passwordField())).toContain(holder)
    })

    it('drops the score when Cancel brings the stored password back', async () => {
      const { rerender, props } = renderTab({
        settings: storedSettings,
        dirty: true,
        staged: replacedStaged,
      })
      await elapse(300)
      expect(strengthMeter()).toBeInTheDocument()

      rerender(<McpServerTab {...props} dirty={false} staged={untouchedStaged} />)
      await elapse(1000)

      expect(maskedPassword()).toBeInTheDocument()
      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).toHaveBeenCalledTimes(1)
    })
  })

  describe('Strength score (MCP-7)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      scorePassword.mockResolvedValue({ score: 1, label: 'Weak' })
    })

    it('is hidden until a password is typed', async () => {
      renderTab({ staged: typedPassword('') })

      await elapse(1000)

      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).not.toHaveBeenCalled()
    })

    it('asks for the score 300 ms after the password stops changing, with the staged username', async () => {
      renderTab({ dirty: true, staged: typedPassword('hunter2') })

      await elapse(299)
      expect(scorePassword).not.toHaveBeenCalled()
      expect(queryStrengthMeter()).not.toBeInTheDocument()

      await elapse(1)

      expect(scorePassword).toHaveBeenCalledTimes(1)
      expect(scorePassword).toHaveBeenCalledWith('hunter2', ['wave'])
    })

    it('shows the label word after the debounce', async () => {
      scorePassword.mockResolvedValue({ score: 1, label: 'Weak' })
      renderTab({ dirty: true, staged: typedPassword('hunter2') })

      await elapse(300)

      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Weak')
      expect(screen.getByTestId('mcp-auth-password-row')).toContainElement(strengthMeter())
    })

    it.each([
      [0, 'Very weak'],
      [1, 'Weak'],
      [2, 'Fair'],
      [3, 'Strong'],
      [4, 'Very strong'],
    ])('score %i shows "%s" and nothing else under the input', async (score, label) => {
      scorePassword.mockResolvedValue({ score, label })
      renderTab({ dirty: true, staged: typedPassword('hunter2') })

      await elapse(300)

      expect(strengthMeter()).toHaveAttribute('aria-valuetext', label)
      expect(visibleText(passwordColumn())).toBe(label)
    })

    it('scores only the last text when the password changes inside the wait', async () => {
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter') })
      await elapse(200)

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2')} />)
      await elapse(299)
      expect(scorePassword).not.toHaveBeenCalled()

      await elapse(1)

      expect(scorePassword).toHaveBeenCalledTimes(1)
      expect(scorePassword).toHaveBeenCalledWith('hunter2', ['wave'])
    })

    it('keeps the previous score on screen while a newer password is scored', async () => {
      const next = deferred<{ score: number; label: string }>()
      scorePassword.mockResolvedValueOnce({ score: 1, label: 'Weak' })
      scorePassword.mockReturnValueOnce(next.promise)
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)
      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Weak')

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2-blue-kettle')} />)
      await elapse(300)
      expect(scorePassword).toHaveBeenCalledTimes(2)
      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Weak')

      await act(async () => {
        next.resolve({ score: 4, label: 'Very strong' })
      })
      await elapse(0)

      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Very strong')
    })

    it('ignores the answer for an older password', async () => {
      const first = deferred<{ score: number; label: string }>()
      scorePassword.mockReturnValueOnce(first.promise)
      scorePassword.mockResolvedValueOnce({ score: 4, label: 'Very strong' })
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2-blue-kettle')} />)
      await elapse(300)
      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Very strong')

      await act(async () => {
        first.resolve({ score: 1, label: 'Weak' })
      })
      await elapse(0)

      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Very strong')
    })

    it('hides when the score request fails and leaves Save enabled', async () => {
      scorePassword.mockRejectedValue(new Error('Internal Server Error'))
      renderTab({ dirty: true, staged: typedPassword('hunter2') })

      await elapse(300)

      expect(scorePassword).toHaveBeenCalledTimes(1)
      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument()
      expect(saveButton()).toBeEnabled()
    })

    it('hides the previous score when the next request fails', async () => {
      scorePassword.mockResolvedValueOnce({ score: 1, label: 'Weak' })
      scorePassword.mockRejectedValueOnce(new Error('Internal Server Error'))
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)
      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Weak')

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2-blue-kettle')} />)
      await elapse(300)

      expect(scorePassword).toHaveBeenCalledTimes(2)
      expect(queryStrengthMeter()).not.toBeInTheDocument()
    })

    it('never disables Save, even for the weakest score', async () => {
      scorePassword.mockResolvedValue({ score: 0, label: 'Very weak' })
      renderTab({ dirty: true, staged: typedPassword('password') })
      expect(saveButton()).toBeEnabled()

      await elapse(300)

      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Very weak')
      expect(saveButton()).toBeEnabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('hides again once the password is cleared', async () => {
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)
      expect(strengthMeter()).toBeInTheDocument()

      rerender(<McpServerTab {...props} dirty={false} staged={typedPassword('')} />)
      await elapse(1000)

      expect(queryStrengthMeter()).not.toBeInTheDocument()
      expect(scorePassword).toHaveBeenCalledTimes(1)
    })

    it('does not ask again when only the username changes', async () => {
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2', 'wave') })
      await elapse(300)
      expect(scorePassword).toHaveBeenCalledTimes(1)

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2', 'ops')} />)
      await elapse(1000)

      expect(scorePassword).toHaveBeenCalledTimes(1)
      expect(strengthMeter()).toHaveAttribute('aria-valuetext', 'Weak')
    })

    it('scores the next password with the username staged by then', async () => {
      const { rerender, props } = renderTab({ dirty: true, staged: typedPassword('hunter2', 'wave') })
      await elapse(300)

      rerender(<McpServerTab {...props} staged={typedPassword('hunter2', 'ops')} />)
      await elapse(300)
      rerender(<McpServerTab {...props} staged={typedPassword('hunter22', 'ops')} />)
      await elapse(300)

      expect(scorePassword).toHaveBeenCalledTimes(2)
      expect(scorePassword).toHaveBeenLastCalledWith('hunter22', ['ops'])
    })

    it('hangs the score under the Password input, in the control column, apart from the label', async () => {
      renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)

      const row = screen.getByTestId('mcp-auth-password-row')
      const column = passwordColumn()
      expect(row).toContainElement(column)
      expect(column).not.toBe(row)
      expect(within(column).queryByText('Password', { selector: 'label' })).not.toBeInTheDocument()
      expect(within(column).queryByText(PASSWORD_HELP)).not.toBeInTheDocument()
      expect(
        passwordInput().compareDocumentPosition(strengthMeter()) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('leaves the Password label and its help where they are when the score appears', async () => {
      const { rerender, props } = renderTab({ staged: typedPassword('') })
      const label = () => screen.getByText('Password', { selector: 'label' })
      const help = () => screen.getByText(PASSWORD_HELP)
      const snapshot = () => ({
        row: screen.getByTestId('mcp-auth-password-row').className,
        label: label().outerHTML,
        help: help().outerHTML,
        labelParent: label().parentElement?.className,
        helpParent: help().parentElement?.className,
      })
      const before = snapshot()

      rerender(<McpServerTab {...props} dirty staged={typedPassword('hunter2')} />)
      await elapse(300)

      expect(strengthMeter()).toBeInTheDocument()
      expect(snapshot()).toEqual(before)
      expect(label().parentElement).not.toContainElement(strengthMeter())
      expect(help().parentElement).not.toContainElement(strengthMeter())
    })

    it('points the Password input at the score through aria-describedby', async () => {
      renderTab({ dirty: true, staged: typedPassword('hunter2') })
      await elapse(300)

      const score = strengthMeter()
      const described = (passwordInput().getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id))
        .filter((element): element is HTMLElement => element !== null)
      const conveysScore = described.some(
        (element) =>
          element === score || element.contains(score) || (element.textContent ?? '').includes('Weak'),
      )
      expect(conveysScore).toBe(true)
    })
  })

  describe('Save confirmation (MCP-5, MCP-6)', () => {
    const stagedPort = { ...runningStaged, port: '9001' }
    const restart = { restart: true, exposure: false }
    const restartAndExposure = { restart: true, exposure: true }
    const exposure = { restart: false, exposure: true }

    it('shows no dialog without a confirmation', () => {
      renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
      })

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('Save on a running endpoint calls onSave and opens no dialog by itself', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
      })

      await user.click(saveButton())

      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onConfirmSave).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('Save with the bind widened to Network calls onSave and opens no dialog by itself', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        status: stoppedStatus,
        dirty: true,
        staged: { ...defaultStaged, bind: 'network' },
      })

      await user.click(saveButton())

      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(props.onConfirmSave).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('disabling a running endpoint saves without a dialog', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: { ...runningStaged, enabled: false },
      })

      await user.click(saveButton())

      expect(props.onSave).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('restart: the title, the restart sentence, Cancel and Save and restart', () => {
      renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
        confirmation: restart,
      })

      const dialog = saveDialog()
      expect(within(dialog).getByText(CONFIRM_TITLE)).toBeInTheDocument()
      expect(within(dialog).getByText(RESTART_SENTENCE)).toBeInTheDocument()
      expect(within(dialog).queryByTestId('mcp-exposure-warning')).not.toBeInTheDocument()
      expect(within(dialog).queryByText(/Bind scope changes to/)).not.toBeInTheDocument()
      expect(buttonLabels(dialog)).toEqual(['Cancel', 'Save and restart'])
    })

    it('restart and exposure: the warning joins the restart sentence in the same dialog', () => {
      renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: { ...runningStaged, bind: 'network' },
        confirmation: restartAndExposure,
      })

      expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
      const dialog = saveDialog()
      expect(within(dialog).getByText(RESTART_SENTENCE)).toBeInTheDocument()
      expect(flattened(within(dialog).getByTestId('mcp-exposure-warning'))).toBe(EXPOSURE_WARNING)
      expect(buttonLabels(dialog)).toEqual(['Cancel', 'Save and restart'])
    })

    it('exposure on a stopped endpoint: the warning alone, Cancel and Save', () => {
      renderTab({
        status: stoppedStatus,
        dirty: true,
        staged: { ...defaultStaged, bind: 'network' },
        confirmation: exposure,
      })

      const dialog = saveDialog()
      expect(flattened(within(dialog).getByTestId('mcp-exposure-warning'))).toBe(EXPOSURE_WARNING)
      expect(within(dialog).queryByText(RESTART_SENTENCE)).not.toBeInTheDocument()
      expect(dialog).not.toHaveTextContent(/restarts with the new configuration/)
      expect(buttonLabels(dialog)).toEqual(['Cancel', 'Save'])
    })

    it('exposure on a running endpoint that the Save turns off: the warning alone, Cancel and Save', () => {
      renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: { ...runningStaged, enabled: false, bind: 'network' },
        confirmation: exposure,
      })

      const dialog = saveDialog()
      expect(flattened(within(dialog).getByTestId('mcp-exposure-warning'))).toBe(EXPOSURE_WARNING)
      expect(within(dialog).queryByText(RESTART_SENTENCE)).not.toBeInTheDocument()
      expect(dialog).not.toHaveTextContent(/restarts with the new configuration/)
      expect(buttonLabels(dialog)).toEqual(['Cancel', 'Save'])
    })

    it.each([
      ['restart', restart],
      ['restart and exposure', restartAndExposure],
      ['exposure', exposure],
    ])('%s: the dialog no longer says Apply', (_name, confirmation) => {
      renderTab({ dirty: true, staged: stagedPort, confirmation })

      const dialog = saveDialog()
      expect(dialog).not.toHaveTextContent(/Apply/)
      expect(screen.queryByText('Apply endpoint changes?')).not.toBeInTheDocument()
    })

    it('Save and restart calls onConfirmSave', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
        confirmation: restart,
      })

      await user.click(within(saveDialog()).getByRole('button', { name: 'Save and restart' }))

      expect(props.onConfirmSave).toHaveBeenCalledTimes(1)
      expect(props.onSave).not.toHaveBeenCalled()
      expect(props.onCancel).not.toHaveBeenCalled()
    })

    it('the exposure-only Save calls onConfirmSave', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        status: stoppedStatus,
        dirty: true,
        staged: { ...defaultStaged, bind: 'network' },
        confirmation: exposure,
      })

      await user.click(within(saveDialog()).getByRole('button', { name: 'Save' }))

      expect(props.onConfirmSave).toHaveBeenCalledTimes(1)
      expect(props.onSave).not.toHaveBeenCalled()
    })

    it('Cancel calls onDismissConfirmation and never saves', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
        confirmation: restart,
      })

      await user.click(within(saveDialog()).getByRole('button', { name: 'Cancel' }))

      expect(props.onDismissConfirmation).toHaveBeenCalledTimes(1)
      expect(props.onConfirmSave).not.toHaveBeenCalled()
      expect(props.onSave).not.toHaveBeenCalled()
      expect(props.onCancel).not.toHaveBeenCalled()
    })

    it('closes once the confirmation is cleared', () => {
      const { rerender, props } = renderTab({
        settings: runningSettings,
        status: runningStatus,
        dirty: true,
        staged: stagedPort,
        confirmation: restart,
      })
      expect(saveDialog()).toBeInTheDocument()

      rerender(<McpServerTab {...props} confirmation={undefined} />)

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  describe('Sessions (MCP-8)', () => {
    it('renders one row per session with client, ip, and Disconnect', () => {
      renderTab({ status: runningStatus })

      const section = screen.getByTestId('mcp-sessions-section')
      expect(within(section).getByText('claude-code')).toBeInTheDocument()
      expect(within(section).getByText('127.0.0.1')).toBeInTheDocument()
      expect(within(section).getByText('mcp-inspector')).toBeInTheDocument()
      expect(within(section).getByText('192.0.2.14')).toBeInTheDocument()
      expect(within(section).getAllByRole('button', { name: 'Disconnect' })).toHaveLength(2)
    })

    it('Disconnect calls onDisconnectSession with the session id', async () => {
      const user = userEvent.setup()
      const { props } = renderTab({ status: runningStatus })

      const section = screen.getByTestId('mcp-sessions-section')
      await user.click(within(section).getAllByRole('button', { name: 'Disconnect' })[0])

      expect(props.onDisconnectSession).toHaveBeenCalledWith('sess-1')
    })

    it('shows the empty state without sessions', () => {
      renderTab({ status: stoppedStatus })

      expect(screen.getByText('No connected clients.')).toBeInTheDocument()
    })
  })

  describe('Recent Activity (MCP-9)', () => {
    it('renders the scrollable feed with client and tool per row', () => {
      renderTab({ status: runningStatus })

      const feed = screen.getByTestId('mcp-activity-feed')
      expect(feed.className).toContain('overflow-y-auto')
      expect(within(feed).getByText('start_execution')).toBeInTheDocument()
      expect(within(feed).getByText('get_test')).toBeInTheDocument()
      expect(within(feed).getByText('get_failure_report')).toBeInTheDocument()
      expect(within(feed).getAllByText('claude-code').length).toBeGreaterThanOrEqual(2)
    })

    it('keeps the client and tool names out of page translation', () => {
      renderTab({ status: runningStatus })

      const feed = within(screen.getByTestId('mcp-activity-feed'))
      expect(feed.getByText('get_failure_report')).toHaveAttribute('translate', 'no')
      expect(feed.getByText('mcp-inspector')).toHaveAttribute('translate', 'no')
    })

    it('shows the empty state without activity', () => {
      renderTab({ status: { ...runningStatus, recent_activity: [] } })

      expect(screen.getByText('No activity yet.')).toBeInTheDocument()
    })
  })
})
