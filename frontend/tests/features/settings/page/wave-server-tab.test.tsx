/**
 * WaveServerTab Component Tests
 *
 * REQ-5.2.7.15.
 *
 * Presentational contract for the WAVE Server settings section: loading
 * skeleton, two read-only server cards (frontend + backend, no editable
 * port/bind), the backend card's live session count, the browser-session
 * roster with the "You" self marker and the deep-link highlight, one-click
 * per-row Disconnect, and the confirmation-gated Disconnect Others / All.
 * Wording is pinned to the approved wireframes.
 *
 * The Backend Server card carries the lock-marked, copyable Data folder fact
 * (WSRV-10, REQ-4.7.13) with the Config file fact under it (WSRV-11,
 * REQ-4.7.15), and a failed first read renders through the shared SectionError.
 *
 * Component under test:
 * frontend/src/features/settings/page/wave-server-tab.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ServerStatus } from '@/features/settings/api/sessions'
import { WaveServerTab, type WaveServerTabProps } from '@/features/settings/page/wave-server-tab'
import { copyText } from '@/lib/clipboard'
import { rememberOwnSession } from '@/lib/session-identity'

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
}))

const sectionErrorSpy = vi.hoisted(() => vi.fn())

vi.mock('@/features/settings/components/section-error', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/components/section-error')>()
  sectionErrorSpy.mockImplementation(actual.SectionError)
  return { ...actual, SectionError: sectionErrorSpy }
})

// ============================================================================
// Fixtures (own session + one other; ports/urls carry no digit "2" so the
// backend card's session count is unambiguous)
// ============================================================================

const OWN_ID = 'sess-own'
const OTHER_ID = 'sess-other'
const DATA_FOLDER = '/srv/wave/data'
const CONFIG_FILE = '/srv/wave/config/config.yaml'

const serverStatus: ServerStatus = {
  frontend: {
    running: true,
    urls: ['http://localhost:3000'],
    port: 3000,
    bind: 'local',
  },
  backend: {
    running: true,
    urls: ['http://localhost:8000'],
    port: 8000,
    bind: 'local',
  },
  session_count: 2,
  sessions: [
    {
      session_id: OWN_ID,
      client: 'Chrome (macOS)',
      ip: '127.0.0.1',
      connected_at: '2026-07-25T14:00:02Z',
      last_activity: '2026-07-25T14:02:31Z',
    },
    {
      session_id: OTHER_ID,
      client: 'Firefox (Windows)',
      ip: '10.0.0.9',
      connected_at: '2026-07-25T13:41:19Z',
      last_activity: '2026-07-25T13:58:00Z',
    },
  ],
  active_session_id: null,
  watching_session_ids: [],
  data_folder: DATA_FOLDER,
  config_file: CONFIG_FILE,
}

// ============================================================================
// Render helper
// ============================================================================

function renderTab(props: Partial<WaveServerTabProps> = {}) {
  const defaultProps: WaveServerTabProps = {
    status: serverStatus,
    loading: false,
    onDisconnect: vi.fn(),
    onDisconnectOthers: vi.fn(),
    onDisconnectAll: vi.fn(),
    onRetry: vi.fn(),
    ...props,
  }
  return { ...render(<WaveServerTab {...defaultProps} />), props: defaultProps }
}

// ============================================================================
// Tests
// ============================================================================

describe('WaveServerTab', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    vi.clearAllMocks()
    // The own-session marker reads the browser's minted session ids from
    // localStorage; seed just this browser's own row (OWN_ID), not OTHER_ID.
    localStorage.clear()
    rememberOwnSession(OWN_ID)
  })

  describe('Loading state', () => {
    it('shows the skeleton and no roster on first load', () => {
      renderTab({ status: undefined, loading: true })

      expect(screen.getByTestId('wave-server-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('server-sessions-section')).not.toBeInTheDocument()
      expect(screen.queryByTestId(`server-session-row-${OWN_ID}`)).not.toBeInTheDocument()
    })
  })

  describe('Failed status read', () => {
    it('names the failure instead of spinning forever', () => {
      renderTab({ status: undefined, loading: false, error: 'Server status unavailable' })

      expect(screen.getByTestId('wave-server-error')).toHaveTextContent(
        'Server status unavailable',
      )
      expect(screen.queryByTestId('wave-server-loading')).not.toBeInTheDocument()
    })

    it('retries the read from the error state', async () => {
      const user = userEvent.setup()
      const onRetry = vi.fn()
      renderTab({ status: undefined, loading: false, error: 'Server status unavailable', onRetry })

      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(onRetry).toHaveBeenCalledTimes(1)
    })

    it('renders the failure through the shared SectionError', () => {
      const onRetry = vi.fn()
      renderTab({ status: undefined, loading: false, error: 'Server status unavailable', onRetry })

      const call = sectionErrorSpy.mock.calls.find(
        ([props]) => (props as Record<string, unknown>)['data-testid'] === 'wave-server-error',
      )
      expect(call?.[0]).toMatchObject({ message: 'Server status unavailable', onRetry })
    })

    it('shows the same content as before: an alert with the icon, the reason and Try Again', () => {
      renderTab({ status: undefined, loading: false, error: 'Server status unavailable' })

      const error = screen.getByTestId('wave-server-error')
      expect(error).toHaveAttribute('role', 'alert')
      expect(error).toHaveTextContent('Server status unavailable')
      expect(error.querySelector('svg.lucide-circle-alert')).toBeInTheDocument()
      expect(within(error).getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
      expect(screen.queryByTestId('server-card-backend')).not.toBeInTheDocument()
    })

    it('does not render the section error once the status has loaded', () => {
      renderTab({ error: 'poll failed' })

      expect(screen.queryByTestId('wave-server-error')).not.toBeInTheDocument()
      expect(
        sectionErrorSpy.mock.calls.some(
          ([props]) => (props as Record<string, unknown>)['data-testid'] === 'wave-server-error',
        ),
      ).toBe(false)
    })

    it('keeps the roster and says so when a refresh fails', () => {
      renderTab({ error: 'poll failed' })

      expect(screen.getByTestId('wave-server-stale')).toHaveTextContent(
        'poll failed (showing the last known state)',
      )
      expect(screen.getByTestId('server-sessions-section')).toBeInTheDocument()
    })
  })

  describe('Loaded structure', () => {
    it('renders the tab, both server cards, and the sessions section', () => {
      renderTab()

      expect(screen.getByTestId('wave-server-tab')).toBeInTheDocument()
      expect(screen.getByTestId('server-card-frontend')).toBeInTheDocument()
      expect(screen.getByTestId('server-card-backend')).toBeInTheDocument()
      expect(screen.getByTestId('server-sessions-section')).toBeInTheDocument()
    })

    it('shows the connected session count on the backend card', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      expect(within(backendCard).getByText(/\b2\b/)).toBeInTheDocument()
    })
  })

  describe('Server fact card branches', () => {
    it('shows Stopped when a server is not running', () => {
      renderTab({
        status: { ...serverStatus, frontend: { ...serverStatus.frontend, running: false } },
      })

      const frontendCard = screen.getByTestId('server-card-frontend')
      expect(within(frontendCard).getByText('Stopped')).toBeInTheDocument()
    })

    it('uses the singular "session" for a single connected session', () => {
      renderTab({ status: { ...serverStatus, session_count: 1 } })

      const backendCard = screen.getByTestId('server-card-backend')
      expect(within(backendCard).getByText(/\b1 session\b/)).toBeInTheDocument()
    })

    it('renders an unmapped bind value verbatim', () => {
      renderTab({
        status: { ...serverStatus, frontend: { ...serverStatus.frontend, bind: 'restricted' } },
      })

      const frontendCard = screen.getByTestId('server-card-frontend')
      expect(within(frontendCard).getByText('restricted')).toBeInTheDocument()
    })
  })

  describe('Read-only server cards', () => {
    it('renders no editable port/bind controls on either card', () => {
      renderTab()

      const frontendCard = screen.getByTestId('server-card-frontend')
      const backendCard = screen.getByTestId('server-card-backend')

      expect(within(frontendCard).queryByRole('textbox')).toBeNull()
      expect(within(frontendCard).queryByRole('combobox')).toBeNull()
      expect(within(backendCard).queryByRole('textbox')).toBeNull()
      expect(within(backendCard).queryByRole('combobox')).toBeNull()
    })
  })

  describe('Data folder fact (WSRV-10, REQ-4.7.13)', () => {
    it('shows a "Data folder" fact with the absolute path on the Backend Server card', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      const fact = within(backendCard).getByTestId('server-data-folder')
      expect(fact).toHaveTextContent('Data folder')
      expect(within(fact).getByText(DATA_FOLDER)).toHaveClass('font-mono')
    })

    it('marks the Data folder fact with a lock hidden from assistive tech', () => {
      renderTab()

      const fact = screen.getByTestId('server-data-folder')
      const lock = fact.querySelector('svg.lucide-lock')
      expect(lock).toBeInTheDocument()
      expect(lock).toHaveAttribute('aria-hidden', 'true')
    })

    it('places the Data folder fact under Port and Bind scope', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      const bindScope = within(backendCard).getByText('Bind scope')
      const port = within(backendCard).getByText('Port')
      const fact = within(backendCard).getByTestId('server-data-folder')
      expect(port.compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(
        bindScope.compareDocumentPosition(fact) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(fact).not.toContainElement(port)
      expect(fact).not.toContainElement(bindScope)
    })

    it('renders the Data folder read-only, with no editable control', () => {
      renderTab()

      const fact = screen.getByTestId('server-data-folder')
      expect(within(fact).queryByRole('textbox')).toBeNull()
      expect(within(fact).queryByRole('combobox')).toBeNull()
    })

    it('copies the data folder path from its copy button', async () => {
      renderTab()

      const fact = screen.getByTestId('server-data-folder')
      await act(async () => {
        fireEvent.click(within(fact).getByRole('button', { name: 'Copy Data folder' }))
      })

      expect(copyText).toHaveBeenCalledTimes(1)
      expect(copyText).toHaveBeenCalledWith(DATA_FOLDER)
    })

    it('gives Port and Bind scope no copy button', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      const copyNames = within(backendCard)
        .getAllByRole('button', { name: /^Copy / })
        .map((b) => b.getAttribute('aria-label'))
      expect(copyNames).toEqual([
        'Copy http://localhost:8000',
        'Copy Data folder',
        'Copy Config file',
      ])
    })

    it('shows no Data folder fact on the Frontend Server card', () => {
      renderTab()

      const frontendCard = screen.getByTestId('server-card-frontend')
      expect(within(frontendCard).queryByText('Data folder')).not.toBeInTheDocument()
      expect(within(frontendCard).queryByText(DATA_FOLDER)).not.toBeInTheDocument()
    })
  })

  describe('Config file fact (WSRV-11, REQ-4.7.15)', () => {
    it('shows a "Config file" fact with the absolute path on the Backend Server card', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      const fact = within(backendCard).getByTestId('server-config-file')
      expect(fact).toHaveTextContent('Config file')
      expect(within(fact).getByText(CONFIG_FILE)).toHaveClass('font-mono')
    })

    it('shows the path the server reported, whatever it is', () => {
      const customPath = '/srv/wave-lab/settings/lab.yaml'
      renderTab({ status: { ...serverStatus, config_file: customPath } })

      const fact = screen.getByTestId('server-config-file')
      expect(within(fact).getByText(customPath)).toBeInTheDocument()
      expect(within(fact).queryByText(CONFIG_FILE)).not.toBeInTheDocument()
    })

    it('keeps the config file path out of the Data folder fact and the other way round', () => {
      renderTab()

      expect(screen.getByTestId('server-data-folder')).not.toHaveTextContent(CONFIG_FILE)
      expect(screen.getByTestId('server-config-file')).not.toHaveTextContent(DATA_FOLDER)
    })

    it('marks the Config file fact with a lock hidden from assistive tech', () => {
      renderTab()

      const fact = screen.getByTestId('server-config-file')
      const lock = fact.querySelector('svg.lucide-lock')
      expect(lock).toBeInTheDocument()
      expect(lock).toHaveAttribute('aria-hidden', 'true')
    })

    it('places the Config file fact directly under the Data folder fact', () => {
      renderTab()

      const backendCard = screen.getByTestId('server-card-backend')
      const dataFolder = within(backendCard).getByTestId('server-data-folder')
      const configFile = within(backendCard).getByTestId('server-config-file')
      expect(
        dataFolder.compareDocumentPosition(configFile) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(dataFolder).not.toContainElement(configFile)
      expect(configFile).not.toContainElement(dataFolder)

      const lockedFacts = Array.from(backendCard.querySelectorAll('svg.lucide-lock')).map(
        (lock) => lock.parentElement?.getAttribute('data-testid') ?? null,
      )
      expect(lockedFacts.slice(-2)).toEqual(['server-data-folder', 'server-config-file'])
    })

    it('renders the Config file read-only, with no editable control', () => {
      renderTab()

      const fact = screen.getByTestId('server-config-file')
      expect(within(fact).queryByRole('textbox')).toBeNull()
      expect(within(fact).queryByRole('combobox')).toBeNull()
    })

    it('copies the config file path from its copy button', async () => {
      renderTab()

      const fact = screen.getByTestId('server-config-file')
      await act(async () => {
        fireEvent.click(within(fact).getByRole('button', { name: 'Copy Config file' }))
      })

      expect(copyText).toHaveBeenCalledTimes(1)
      expect(copyText).toHaveBeenCalledWith(CONFIG_FILE)
    })

    it('shows no Config file fact on the Frontend Server card', () => {
      renderTab()

      const frontendCard = screen.getByTestId('server-card-frontend')
      expect(within(frontendCard).queryByText('Config file')).not.toBeInTheDocument()
      expect(within(frontendCard).queryByText(CONFIG_FILE)).not.toBeInTheDocument()
      expect(screen.getAllByTestId('server-config-file')).toHaveLength(1)
    })
  })

  describe('Sessions roster', () => {
    it('renders one testid-addressable row per session with its client', () => {
      renderTab()

      const ownRow = screen.getByTestId(`server-session-row-${OWN_ID}`)
      const otherRow = screen.getByTestId(`server-session-row-${OTHER_ID}`)

      expect(within(ownRow).getByText('Chrome (macOS)')).toBeInTheDocument()
      expect(within(otherRow).getByText('Firefox (Windows)')).toBeInTheDocument()
    })

    it('marks the own session with a "You" badge and no other', () => {
      renderTab()

      const ownRow = screen.getByTestId(`server-session-row-${OWN_ID}`)
      const otherRow = screen.getByTestId(`server-session-row-${OTHER_ID}`)

      expect(within(ownRow).getByText('You')).toBeInTheDocument()
      expect(within(otherRow).queryByText('You')).not.toBeInTheDocument()
    })

    it('shows an empty-state message and no rows when no session is connected', () => {
      renderTab({ status: { ...serverStatus, session_count: 0, sessions: [] } })

      expect(screen.getByText('No connected sessions.')).toBeInTheDocument()
      expect(screen.queryByTestId(`server-session-row-${OWN_ID}`)).not.toBeInTheDocument()
      expect(screen.queryByTestId(`server-session-row-${OTHER_ID}`)).not.toBeInTheDocument()
    })
  })

  describe('Per-row disconnect (confirmation)', () => {
    it('confirms first, then calls onDisconnect with the row session id', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      const otherRow = screen.getByTestId(`server-session-row-${OTHER_ID}`)
      await user.click(within(otherRow).getByRole('button', { name: 'Disconnect' }))

      const dialog = await screen.findByRole('alertdialog')
      expect(props.onDisconnect).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))

      expect(props.onDisconnect).toHaveBeenCalledWith(OTHER_ID)
    })

    it('canceling the row disconnect never calls onDisconnect', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      const otherRow = screen.getByTestId(`server-session-row-${OTHER_ID}`)
      await user.click(within(otherRow).getByRole('button', { name: 'Disconnect' }))

      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(props.onDisconnect).not.toHaveBeenCalled()
    })

    it('warns it is your own session when disconnecting your own row', async () => {
      const user = userEvent.setup()
      renderTab()

      const ownRow = screen.getByTestId(`server-session-row-${OWN_ID}`)
      await user.click(within(ownRow).getByRole('button', { name: 'Disconnect' }))

      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(/your own session/i)).toBeInTheDocument()
    })
  })

  describe('Bulk disconnect confirmation', () => {
    it('Disconnect Others confirms first, then calls onDisconnectOthers', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByTestId('server-disconnect-others'))

      const dialog = await screen.findByRole('alertdialog')
      expect(props.onDisconnectOthers).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: /Disconnect Others/ }))

      expect(props.onDisconnectOthers).toHaveBeenCalledTimes(1)
      expect(props.onDisconnectAll).not.toHaveBeenCalled()
    })

    it('Disconnect All confirms first, then calls onDisconnectAll', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByTestId('server-disconnect-all'))

      const dialog = await screen.findByRole('alertdialog')
      expect(props.onDisconnectAll).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: /Disconnect All/ }))

      expect(props.onDisconnectAll).toHaveBeenCalledTimes(1)
      expect(props.onDisconnectOthers).not.toHaveBeenCalled()
    })

    it('canceling the Disconnect Others dialog never calls the handler', async () => {
      const user = userEvent.setup()
      const { props } = renderTab()

      await user.click(screen.getByTestId('server-disconnect-others'))
      const dialog = await screen.findByRole('alertdialog')

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(props.onDisconnectOthers).not.toHaveBeenCalled()
    })
  })

  describe('Target session highlight', () => {
    it('rings the targeted row and scrolls it into view, with no legacy chip', () => {
      renderTab({ targetSessionId: OTHER_ID })

      const target = screen.getByTestId(`server-session-row-${OTHER_ID}`)
      expect(target).toHaveAttribute('data-highlighted', 'true')
      // The confusing "From your workbench" chip is gone; role pills convey state.
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()

      const ownRow = screen.getByTestId(`server-session-row-${OWN_ID}`)
      expect(ownRow).not.toHaveAttribute('data-highlighted')

      expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    })

    it('highlights nothing without a target session', () => {
      renderTab()

      expect(screen.getByTestId(`server-session-row-${OWN_ID}`)).not.toHaveAttribute(
        'data-highlighted',
      )
      expect(screen.getByTestId(`server-session-row-${OTHER_ID}`)).not.toHaveAttribute(
        'data-highlighted',
      )
    })
  })

  describe('Active / Watching role pills', () => {
    it('marks the holder Active and the mirrors Watching', () => {
      renderTab({
        status: {
          ...serverStatus,
          active_session_id: OTHER_ID,
          watching_session_ids: [OWN_ID],
        },
      })

      const activeRow = screen.getByTestId(`server-session-row-${OTHER_ID}`)
      const watchingRow = screen.getByTestId(`server-session-row-${OWN_ID}`)

      expect(within(activeRow).getByText('Active')).toBeInTheDocument()
      expect(within(watchingRow).getByText('Watching')).toBeInTheDocument()
    })

    it('shows no role pill for a session that is neither holding nor watching', () => {
      renderTab({
        status: { ...serverStatus, active_session_id: null, watching_session_ids: [] },
      })

      const row = screen.getByTestId(`server-session-row-${OTHER_ID}`)
      expect(within(row).queryByText('Active')).not.toBeInTheDocument()
      expect(within(row).queryByText('Watching')).not.toBeInTheDocument()
    })
  })
})
