/**
 * SessionRow Component Tests.
 *
 * Presentational session row promoted from the MCP Server tab and shared by
 * both the MCP Sessions list (tone 'violet') and the WAVE Server roster (tone
 * 'indigo'). No API mocks - the row is pure presentation driven by props.
 *
 * Component under test:
 *   frontend/src/features/settings/components/session-row.tsx
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SessionRow, type SessionRowProps } from '@/features/settings/components/session-row'

// ============================================================================
// Render helper
// ============================================================================

function renderRow(props: Partial<SessionRowProps> = {}) {
  const defaultProps: SessionRowProps = {
    sessionId: 'sess-1',
    client: 'Chrome (macOS)',
    ip: '10.0.0.5',
    connectedAt: '2026-07-25T14:00:02Z',
    lastActivity: '2026-07-25T14:02:31Z',
    mode: 'utc',
    onDisconnect: vi.fn(),
    testidPrefix: 'mcp-session-row',
    ...props,
  }
  return { ...render(<SessionRow {...defaultProps} />), props: defaultProps }
}

// ============================================================================
// Tests
// ============================================================================

describe('SessionRow', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Content and disconnect', () => {
    it('renders the client, ip, and a Disconnect button', () => {
      renderRow()

      expect(screen.getByText('Chrome (macOS)')).toBeInTheDocument()
      expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    })

    it('keeps the client name and the address out of page translation', () => {
      renderRow()

      expect(screen.getByText('Chrome (macOS)')).toHaveAttribute('translate', 'no')
      expect(screen.getByText('10.0.0.5')).toHaveAttribute('translate', 'no')
    })

    it('calls onDisconnect with the session id when Disconnect is clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderRow({ sessionId: 'sess-42' })

      await user.click(screen.getByRole('button', { name: 'Disconnect' }))

      expect(props.onDisconnect).toHaveBeenCalledWith('sess-42')
    })
  })

  describe('Row testid prefix', () => {
    it.each(['mcp-session-row', 'server-session-row'])(
      'uses %s as the row testid prefix',
      (prefix) => {
        renderRow({ testidPrefix: prefix, sessionId: 'abc' })

        expect(screen.getByTestId(`${prefix}-abc`)).toBeInTheDocument()
      },
    )
  })

  describe('Highlighted state', () => {
    it('highlighted with a label: sets data-highlighted and shows the chip', () => {
      renderRow({ highlighted: true, highlightLabel: 'From your workbench' })

      const row = screen.getByTestId('mcp-session-row-sess-1')
      expect(row).toHaveAttribute('data-highlighted', 'true')
      expect(screen.getByText('From your workbench')).toBeInTheDocument()
    })

    it('highlighted without a label: rings the row but shows no chip', () => {
      renderRow({ highlighted: true })

      const row = screen.getByTestId('mcp-session-row-sess-1')
      expect(row).toHaveAttribute('data-highlighted', 'true')
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()
    })

    it('not highlighted: no chip and no data-highlighted attribute', () => {
      renderRow({ highlighted: false, highlightLabel: 'From your workbench' })

      const row = screen.getByTestId('mcp-session-row-sess-1')
      expect(row).not.toHaveAttribute('data-highlighted')
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()
    })
  })

  describe('Role pill', () => {
    it('role "active": renders the Active pill', () => {
      renderRow({ role: 'active' })

      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.queryByText('Watching')).not.toBeInTheDocument()
    })

    it('role "watching": renders the Watching pill', () => {
      renderRow({ role: 'watching' })

      expect(screen.getByText('Watching')).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('no role: renders neither pill', () => {
      renderRow()

      expect(screen.queryByText('Active')).not.toBeInTheDocument()
      expect(screen.queryByText('Watching')).not.toBeInTheDocument()
    })
  })

  describe('Self marker', () => {
    it('isSelf: renders the You marker', () => {
      renderRow({ isSelf: true })

      expect(screen.getByText('You')).toBeInTheDocument()
    })

    it('not self: no You marker', () => {
      renderRow({ isSelf: false })

      expect(screen.queryByText('You')).not.toBeInTheDocument()
    })
  })

  describe('Connected and active meta', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('renders the relative active time derived from lastActivity', () => {
      const now = new Date('2026-07-25T14:05:00Z')
      vi.setSystemTime(now)
      const lastActivity = new Date(now.getTime() - 5 * 60_000).toISOString()

      renderRow({ lastActivity })

      const row = screen.getByTestId('mcp-session-row-sess-1')
      expect(row).toHaveTextContent('Connected')
      expect(row).toHaveTextContent('active 5 min ago')
    })
  })
})
