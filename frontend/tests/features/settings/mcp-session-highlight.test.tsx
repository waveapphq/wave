/**
 * MCP Session Highlight.
 *
 * The workbench "See connection" affordance deep-links to the MCP Server
 * settings tab, which highlights, chips, and scrolls to the connection it
 * points at. Two surfaces:
 *   - McpServerTab.targetSessionId marks the matching session row.
 *   - SettingsContainer reads ?session=<id> and threads it down that chain.
 *
 * Components under test:
 *   frontend/src/features/settings/page/mcp-server-tab.tsx
 *   frontend/src/features/settings/container/container.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import { McpServerTab, type McpServerTabProps } from '@/features/settings/page/mcp-server-tab'
import { SettingsContainer } from '@/features/settings/container/container'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'

// ============================================================================
// Route-harness mocks (mirrors settings-container.test.tsx) so the real
// SettingsContainer -> SettingsPage -> McpServerTab tree renders with no live
// fetch. McpServerTab itself is deliberately NOT mocked - the highlight logic
// under test lives inside it.
// ============================================================================

vi.mock('@/features/settings/api/environments/crud', () => ({
  fetchEnvironments: vi.fn(),
  fetchEnvironmentsTags: vi.fn().mockResolvedValue([]),
  createEnvironment: vi.fn(),
  updateEnvironment: vi.fn(),
  deleteEnvironment: vi.fn(),
  duplicateEnvironment: vi.fn(),
}))
vi.mock('@/features/settings/api/environments/import-export', () => ({
  exportEnvironment: vi.fn(),
  exportEnvironments: vi.fn(),
  validateEnvironmentImport: vi.fn(),
  importEnvironments: vi.fn(),
}))
vi.mock('@/lib/download-blob', () => ({ downloadBlob: vi.fn() }))
vi.mock('@/features/settings/api/system-info', () => ({ fetchSystemInfo: vi.fn() }))
vi.mock('@/features/settings/api/admin', () => ({
  fetchLogLevel: vi.fn(),
  setLogLevel: vi.fn(),
  fetchMaskingSettings: vi.fn(),
  setMaskingSettings: vi.fn(),
}))
vi.mock('@/features/settings/components/global-variables-tab', () => ({
  SystemVariablesTab: () => <div data-testid="system-variables-tab" />,
}))
vi.mock('@/features/settings/components/backup-restore-tab/tab', () => ({
  BackupRestoreTab: () => <div data-testid="backup-tab" />,
}))
vi.mock('@/features/settings/api/backup', () => ({
  getSchedule: vi.fn(),
  updateSchedule: vi.fn(),
}))
vi.mock('@/features/settings/api/password-strength', () => ({ scorePassword: vi.fn() }))

const { mockFetchMcpSettings, mockUpdateMcpSettings, mockFetchMcpStatus, mockDisconnectMcpSession } =
  vi.hoisted(() => ({
    mockFetchMcpSettings: vi.fn(),
    mockUpdateMcpSettings: vi.fn(),
    mockFetchMcpStatus: vi.fn(),
    mockDisconnectMcpSession: vi.fn(),
  }))
vi.mock('@/features/settings/api/mcp', () => ({
  fetchMcpSettings: mockFetchMcpSettings,
  updateMcpSettings: mockUpdateMcpSettings,
  fetchMcpStatus: mockFetchMcpStatus,
  disconnectMcpSession: mockDisconnectMcpSession,
}))

// ============================================================================
// Fixtures (two connected sessions: sess-1, sess-2)
// ============================================================================

const mcpSettings: McpSettings = {
  enabled: true,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password_set: false,
  running: true,
  server_port: 8000,
}

const runningStatus: McpStatus = {
  running: true,
  enabled: true,
  until_restart_active: false,
  port: 8765,
  bind: 'local',
  urls: ['http://127.0.0.1:8765/mcp'],
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
  ],
  last_error: null,
}

const defaultStaged = {
  enabled: true,
  until_restart: false,
  port: '8765',
  bind: 'local' as const,
  auth_enabled: false,
  auth_username: '',
  auth_password: '',
}

const scrollIntoView = () => vi.mocked(Element.prototype.scrollIntoView)

// ============================================================================
// Tests
// ============================================================================

describe('MCP session highlight', () => {
  describe('McpServerTab targetSessionId', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    function renderTab(overrides: Partial<McpServerTabProps> = {}, targetSessionId?: string) {
      const props: McpServerTabProps = {
        settings: mcpSettings,
        status: runningStatus,
        readStatus: 'loaded',
        error: undefined,
        staged: defaultStaged,
        dirty: false,
        saving: false,
        onStageChange: vi.fn(),
        onCancel: vi.fn(),
        onSave: vi.fn(),
        onConfirmSave: vi.fn(),
        onDismissConfirmation: vi.fn(),
        onDisconnectSession: vi.fn(),
        onRetry: vi.fn(),
        ...overrides,
      }
      return render(<McpServerTab {...props} targetSessionId={targetSessionId} />)
    }

    it('renders a testid-addressable row for every session', () => {
      renderTab()

      expect(screen.getByTestId('mcp-session-row-sess-1')).toBeInTheDocument()
      expect(screen.getByTestId('mcp-session-row-sess-2')).toBeInTheDocument()
    })

    it('highlights the target row, shows the chip, and scrolls it into view', () => {
      renderTab({}, 'sess-2')

      const target = screen.getByTestId('mcp-session-row-sess-2')
      expect(target).toHaveAttribute('data-highlighted', 'true')
      expect(within(target).getByText('From your workbench')).toBeInTheDocument()

      const other = screen.getByTestId('mcp-session-row-sess-1')
      expect(other).not.toHaveAttribute('data-highlighted', 'true')
      expect(within(other).queryByText('From your workbench')).not.toBeInTheDocument()

      expect(scrollIntoView()).toHaveBeenCalled()
    })

    it('follows the target id to the first session', () => {
      renderTab({}, 'sess-1')

      const target = screen.getByTestId('mcp-session-row-sess-1')
      expect(target).toHaveAttribute('data-highlighted', 'true')
      expect(within(target).getByText('From your workbench')).toBeInTheDocument()

      expect(screen.getByTestId('mcp-session-row-sess-2')).not.toHaveAttribute(
        'data-highlighted',
        'true',
      )
      expect(scrollIntoView()).toHaveBeenCalled()
    })

    it('highlights nothing and renders no chip without a target session', () => {
      renderTab()

      expect(screen.getByTestId('mcp-session-row-sess-1')).not.toHaveAttribute(
        'data-highlighted',
        'true',
      )
      expect(screen.getByTestId('mcp-session-row-sess-2')).not.toHaveAttribute(
        'data-highlighted',
        'true',
      )
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()
      expect(scrollIntoView()).not.toHaveBeenCalled()
    })

    it('highlights nothing when the target session is not connected', () => {
      renderTab({}, 'sess-ghost')

      expect(screen.getByTestId('mcp-session-row-sess-1')).not.toHaveAttribute(
        'data-highlighted',
        'true',
      )
      expect(screen.getByTestId('mcp-session-row-sess-2')).not.toHaveAttribute(
        'data-highlighted',
        'true',
      )
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()
      expect(scrollIntoView()).not.toHaveBeenCalled()
    })
  })

  describe('SettingsContainer ?session param', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockFetchMcpSettings.mockResolvedValue(mcpSettings)
      mockFetchMcpStatus.mockResolvedValue(runningStatus)
    })

    function renderContainer(route: string) {
      const router = createMemoryRouter([{ path: '/settings/*', element: <SettingsContainer /> }], {
        initialEntries: [route],
      })
      return render(
        <ToastProvider>
          <RouterProvider router={router} />
          <ToastContainer />
        </ToastProvider>,
      )
    }

    it('highlights the session named in the ?session query param', async () => {
      renderContainer('/settings/mcp?session=sess-2')

      const row = await screen.findByTestId('mcp-session-row-sess-2')
      expect(row).toHaveAttribute('data-highlighted', 'true')
      expect(within(row).getByText('From your workbench')).toBeInTheDocument()
    })

    it('highlights no session when the ?session param is absent', async () => {
      renderContainer('/settings/mcp')

      const row = await screen.findByTestId('mcp-session-row-sess-2')
      expect(row).not.toHaveAttribute('data-highlighted', 'true')
      expect(screen.queryByText('From your workbench')).not.toBeInTheDocument()
    })
  })
})
