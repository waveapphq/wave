/**
 * SettingsPage Component Tests
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * REQ-5.2.1.42: Settings and preferences screen (user preferences, system configuration)
 *
 * V-SET-01: Settings page with all tabs
 *
 * Tests for SettingsPage component per design decisions:
 * - SETTINGS-1: Two-column: section nav (240px) + content
 * - SETTINGS-2: Sections: General, Environments, Variables, Network (SSH Hosts, Certificates), MCP Server, WAVE Server, Backup, About
 * - SETTINGS-3: Selected: $blue10 bg, white text
 * - SETTINGS-4: "Settings" above section nav
 * - SETTINGS-5: One divider line in the theme border color
 * - SETTINGS-14: General: Logging, Time Zone, Secret Masking
 * - SETTINGS-16: About: version, build, support links
 *
 * Route Configuration:
 * - /settings -> default to General
 * - /settings/general
 * - /settings/environments
 * - /settings/about
 *
 * Component: frontend/src/features/settings/page/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import {
  SettingsPage,
  type SettingsPageProps,
  type SettingsSection,
} from '@/features/settings/page/page'
import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import type { McpStagedSettings } from '@/features/settings/page/mcp-server-tab'

type UseGeneralSettingsResult = SettingsPageProps['general']
type UsePeriodicBackupResult = SettingsPageProps['periodicBackup']

// Mock SystemVariablesTab since it has its own dedicated test file
vi.mock('@/features/settings/components/global-variables-tab', () => ({
  SystemVariablesTab: () => <div data-testid="system-variables-tab">System Variables Mock</div>,
}))

// GeneralTab, BackupRestoreTab and McpServerTab have their own dedicated test
// files; each spy captures the props the page hands down so the wiring is asserted here.
const { generalTabSpy, backupTabSpy, mcpTabSpy } = vi.hoisted(() => ({
  generalTabSpy: vi.fn(),
  backupTabSpy: vi.fn(),
  mcpTabSpy: vi.fn(),
}))
vi.mock('@/features/settings/page/general-tab', () => ({
  GeneralTab: (props: Record<string, unknown>) => {
    generalTabSpy(props)
    return <div data-testid="general-tab">General Mock</div>
  },
}))
vi.mock('@/features/settings/components/backup-restore-tab/tab', () => ({
  BackupRestoreTab: (props: Record<string, unknown>) => {
    backupTabSpy(props)
    return <div data-testid="backup-tab">Backup Restore Mock</div>
  },
}))
vi.mock('@/features/settings/page/mcp-server-tab', () => ({
  McpServerTab: (props: Record<string, unknown>) => {
    mcpTabSpy(props)
    return <div data-testid="mcp-server-tab">MCP Server Mock</div>
  },
}))

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironments = [
  {
    id: 'env-1',
    name: 'Production',
    description: 'Production environment',
    tags: ['production', 'critical'],
    usage: 5,
    createdAt: '2025-01-10T10:00:00Z',
    updatedAt: '2025-01-15T14:30:00Z',
  },
  {
    id: 'env-2',
    name: 'Staging',
    description: 'Staging environment for testing',
    tags: ['staging'],
    usage: 3,
    createdAt: '2025-01-11T08:00:00Z',
    updatedAt: '2025-01-14T16:00:00Z',
  },
  {
    id: 'env-3',
    name: 'Development',
    description: null,
    tags: [],
    usage: 0,
    createdAt: '2025-01-12T09:00:00Z',
    updatedAt: '2025-01-12T09:00:00Z',
  },
]

const mockSystemInfo = {
  version: '1.2.3',
  build: 'a1b2c3d4',
  buildDate: '2025-01-15T10:00:00Z',
  support: {
    documentationUrl: 'https://docs.example.com',
    issuesUrl: 'https://github.com/example/wave/issues',
    contactEmail: 'support@example.com',
  },
  runtime: {
    pythonVersion: '3.12.1',
    os: 'Linux',
    osVersion: '5.15.0-160-generic',
  },
}

const mockPageInfo = {
  currentPage: 1,
  pageSize: 20,
  totalItems: 3,
  totalPages: 1,
}

const mockMcpSettings: McpSettings = {
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

const mockMcpStatus: McpStatus = {
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

const mockMcpStaged: McpStagedSettings = {
  enabled: false,
  until_restart: false,
  port: '8765',
  bind: 'local',
  auth_enabled: false,
  auth_username: '',
  auth_password: '',
}

const mockGeneral: UseGeneralSettingsResult = {
  status: 'loaded',
  logLevel: 'INFO',
  staged: {
    logLevel: 'INFO',
    timezone: 'local',
    masking: {
      runOutput: false,
      testVariables: false,
      sharedVariables: false,
      credentialInputs: false,
    },
  },
  dirty: false,
  saving: false,
  stageLogLevel: vi.fn(),
  stageTimezone: vi.fn(),
  stageMasking: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}

const mockPeriodicBackup: UsePeriodicBackupResult = {
  status: 'loaded',
  staged: {
    enabled: false,
    cron: '',
    entity_types: ['tests', 'environments', 'profiles', 'suites'],
    max_backups: 5,
    save_directory: '~/wave-backups',
    format: 'yaml',
    compression_method: 'deflate',
    compression_level: 6,
    secrets: 'mask',
  },
  dirty: false,
  saving: false,
  stage: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderWithRouter(
  ui: React.ReactElement,
  { route = '/settings' }: { route?: string } = {}
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/settings/*" element={ui} />
      </Routes>
    </MemoryRouter>
  )
}

function renderSettingsPage(props: Partial<SettingsPageProps> = {}, route = '/settings') {
  const defaultProps: SettingsPageProps = {
    environments: mockEnvironments,
    environmentsPageInfo: mockPageInfo,
    environmentsLoading: false,
    environmentsSettled: true,
    environmentsError: undefined,
    systemInfo: mockSystemInfo,
    systemInfoLoading: false,
    systemInfoError: undefined,
    general: mockGeneral,
    periodicBackup: mockPeriodicBackup,
    activeSection: 'environments',
    onSectionChange: vi.fn(),
    onCreateEnvironment: vi.fn(),
    onEditEnvironment: vi.fn(),
    onDeleteEnvironment: vi.fn(),
    onDuplicateEnvironment: vi.fn(),
    onEnvironmentsPageChange: vi.fn(),
    onEnvironmentsPageSizeChange: vi.fn(),
    onEnvironmentsSearch: vi.fn(),
    onEnvironmentsSortingChange: vi.fn(),
    onEnvironmentsRetry: vi.fn(),
    onSystemInfoRetry: vi.fn(),
    mcpSettings: mockMcpSettings,
    mcpStatus: mockMcpStatus,
    mcpReadStatus: 'loaded',
    mcpError: undefined,
    mcpStatusError: undefined,
    mcpStaged: mockMcpStaged,
    mcpDirty: false,
    mcpSaving: false,
    mcpConfirmation: undefined,
    onMcpStageChange: vi.fn(),
    onMcpCancel: vi.fn(),
    onMcpSave: vi.fn(),
    onMcpConfirmSave: vi.fn(),
    onMcpDismissConfirmation: vi.fn(),
    onMcpDisconnectSession: vi.fn(),
    onMcpRetry: vi.fn(),
    ...props,
  }
  return { ...renderWithRouter(<SettingsPage {...defaultProps} />, { route }), props: defaultProps }
}

// ============================================================================
// Tests
// ============================================================================

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Page Structure (SETTINGS-1, SETTINGS-4)', () => {
    it('renders page container with correct testid', () => {
      renderSettingsPage()
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
    })

    it('renders page title h1 (SETTINGS-4)', () => {
      renderSettingsPage()
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    })

    it('renders two-column layout (SETTINGS-1)', () => {
      renderSettingsPage()
      expect(screen.getByTestId('settings-nav')).toBeInTheDocument()
      expect(screen.getByTestId('settings-content')).toBeInTheDocument()
    })

    it('renders vertical divider between columns (SETTINGS-5)', () => {
      renderSettingsPage()
      expect(screen.getByTestId('settings-divider')).toBeInTheDocument()
    })

    it('draws the divider as the one line between the columns, in the theme border color (SETTINGS-5)', () => {
      renderSettingsPage()

      const divider = screen.getByTestId('settings-divider')
      expect(divider).toHaveClass('border-r')
      expect(divider).not.toHaveAttribute('style')
      expect(screen.getByTestId('settings-nav')).not.toHaveClass('border-r')
    })

    it('nav column has approximately 240px width', () => {
      renderSettingsPage()
      const navColumn = screen.getByTestId('settings-nav')
      expect(navColumn).toHaveClass('w-60') // Tailwind w-60 = 240px
    })

    it('nav column scrolls when the window is shorter than its rows', () => {
      renderSettingsPage()
      expect(screen.getByTestId('settings-nav')).toHaveClass('overflow-y-auto')
    })

    it('content column fills remaining space', () => {
      renderSettingsPage()
      const contentColumn = screen.getByTestId('settings-content')
      expect(contentColumn).toHaveClass('flex-1')
    })
  })

  describe('Section Navigation (SETTINGS-2, SETTINGS-3)', () => {
    it('renders all section nav items', () => {
      renderSettingsPage()
      const nav = screen.getByTestId('settings-sections')

      expect(within(nav).getByRole('button', { name: /General/i })).toBeInTheDocument()
      expect(within(nav).getByRole('button', { name: /Environments/i })).toBeInTheDocument()
      expect(within(nav).getByRole('button', { name: /Variables/i })).toBeInTheDocument()
      expect(within(nav).getByRole('button', { name: /About/i })).toBeInTheDocument()
      expect(within(nav).queryByRole('button', { name: /Integrations/i })).not.toBeInTheDocument()
    })

    it('highlights active section with primary color (SETTINGS-3)', () => {
      renderSettingsPage({ activeSection: 'environments' })
      const environmentsNav = screen.getByRole('button', { name: /Environments/i })
      // Uses inline style for $blue10 per SETTINGS-3
      expect(environmentsNav).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(environmentsNav).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('inactive sections have default styling', () => {
      renderSettingsPage({ activeSection: 'environments' })
      const generalNav = screen.getByRole('button', { name: /General/i })
      // Inactive sections don't have inline background/color styles
      expect(generalNav).not.toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
    })

    it('calls onSectionChange when nav item is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsPage({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /General/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('general')
    })

    it('navigates to correct section URL on click', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsPage({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /About/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('about')
    })
  })

  describe('Default Section', () => {
    it('defaults to Environments section when visiting /settings', () => {
      renderSettingsPage({ activeSection: 'environments' })
      expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
    })
  })

  describe('General Tab (REQ-3.7.2.6, SETTINGS-14)', () => {
    it('displays general tab when section is active', () => {
      renderSettingsPage({ activeSection: 'general' })
      expect(screen.getByTestId('general-tab')).toBeInTheDocument()
    })

    it('does not display general tab when another section is active', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      expect(generalTabSpy).not.toHaveBeenCalled()
    })

    it('hands the general result to the General tab, and nothing else', () => {
      renderSettingsPage({ activeSection: 'general' })

      const tabProps = generalTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.general).toBe(mockGeneral)
      expect(Object.keys(tabProps)).toEqual(['general'])
    })

    it('hands a pending general result through unchanged', () => {
      const pending: UseGeneralSettingsResult = { ...mockGeneral, status: 'pending', logLevel: undefined }
      renderSettingsPage({ activeSection: 'general', general: pending })

      const tabProps = generalTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.general).toBe(pending)
    })

    it('hands a failed general result through unchanged', () => {
      const failed: UseGeneralSettingsResult = {
        ...mockGeneral,
        status: 'failed',
        error: 'Admin API is not enabled on this server',
        logLevel: undefined,
      }
      renderSettingsPage({ activeSection: 'general', general: failed })

      const tabProps = generalTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.general).toBe(failed)
    })

    it('hands a staged, saving general result through unchanged', () => {
      const staged: UseGeneralSettingsResult = {
        ...mockGeneral,
        staged: { ...mockGeneral.staged, logLevel: 'DEBUG', timezone: 'utc' },
        dirty: true,
        saving: true,
      }
      renderSettingsPage({ activeSection: 'general', general: staged })

      const tabProps = generalTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.general).toBe(staged)
    })
  })

  describe('Environments Tab (SETTINGS-6 through SETTINGS-13)', () => {
    it('displays environments table when section is active', () => {
      renderSettingsPage({ activeSection: 'environments' })
      expect(screen.getByTestId('environments-table')).toBeInTheDocument()
    })

    it('displays section subtitle (SETTINGS-7)', () => {
      renderSettingsPage({ activeSection: 'environments' })
      expect(
        screen.getByText(/Manage environment names used across profiles/i)
      ).toBeInTheDocument()
    })

    it('displays "+ New Environment" button (SETTINGS-8)', () => {
      renderSettingsPage({ activeSection: 'environments' })
      expect(screen.getByRole('button', { name: /New Environment/i })).toBeInTheDocument()
    })

    it('calls onCreateEnvironment when New Environment is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleCreate = vi.fn()

      renderSettingsPage({ activeSection: 'environments', onCreateEnvironment: handleCreate })
      await user.click(screen.getByRole('button', { name: /New Environment/i }))

      expect(handleCreate).toHaveBeenCalledTimes(1)
    })

    it('displays search input for filtering environments', () => {
      renderSettingsPage({ activeSection: 'environments' })
      expect(screen.getByPlaceholderText(/Search environments/i)).toBeInTheDocument()
    })

    it('calls onEnvironmentsSearch when search input changes (after debounce)', async () => {
      vi.useFakeTimers()
      const handleSearch = vi.fn()

      renderSettingsPage({ activeSection: 'environments', onEnvironmentsSearch: handleSearch })
      const searchInput = screen.getByPlaceholderText(/Search environments/i)
      fireEvent.change(searchInput, { target: { value: 'prod' } })

      // Should not be called immediately (debounced)
      expect(handleSearch).not.toHaveBeenCalled()

      // Advance timers past debounce delay - wrap in act() to handle state updates
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(handleSearch).toHaveBeenCalledWith('prod')
      vi.useRealTimers()
    })

    it('debounces search input to avoid excessive API calls', async () => {
      vi.useFakeTimers()
      const handleSearch = vi.fn()

      renderSettingsPage({ activeSection: 'environments', onEnvironmentsSearch: handleSearch })
      const searchInput = screen.getByPlaceholderText(/Search environments/i)

      // Type quickly - multiple changes
      fireEvent.change(searchInput, { target: { value: 'p' } })
      vi.advanceTimersByTime(100)
      fireEvent.change(searchInput, { target: { value: 'pr' } })
      vi.advanceTimersByTime(100)
      fireEvent.change(searchInput, { target: { value: 'pro' } })
      vi.advanceTimersByTime(100)
      fireEvent.change(searchInput, { target: { value: 'prod' } })

      // Should not have called yet
      expect(handleSearch).not.toHaveBeenCalled()

      // Advance past debounce - wrap in act() to handle state updates
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Should only call once with final value
      expect(handleSearch).toHaveBeenCalledTimes(1)
      expect(handleSearch).toHaveBeenCalledWith('prod')
      vi.useRealTimers()
    })

    it('clears search input when clear button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSearch = vi.fn()

      renderSettingsPage({ activeSection: 'environments', onEnvironmentsSearch: handleSearch })
      const searchInput = screen.getByPlaceholderText(/Search environments/i)

      // Type something to show the clear button
      await user.type(searchInput, 'test')

      // Find and click the clear button
      const clearButton = screen.getByRole('button', { name: /Clear search/i })
      await user.click(clearButton)

      // Should call search with empty string
      expect(handleSearch).toHaveBeenCalledWith('')
    })

    it('displays loading state for environments', () => {
      renderSettingsPage({
        activeSection: 'environments',
        environmentsLoading: true,
        environments: [],
      })
      // Skeleton rows come from the shared DataTableSkeleton (mirrors suites,
      // regressions, profiles, tests).
      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
    })

    it('displays error state for environments', () => {
      renderSettingsPage({
        activeSection: 'environments',
        environmentsError: 'Failed to load environments',
      })
      expect(screen.getByTestId('environments-error')).toBeInTheDocument()
      expect(screen.getByText(/Failed to load environments/i)).toBeInTheDocument()
    })

    it('displays retry button on error', () => {
      renderSettingsPage({
        activeSection: 'environments',
        environmentsError: 'Failed to load environments',
      })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
    })

    it('calls onEnvironmentsRetry when retry is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderSettingsPage({
        activeSection: 'environments',
        environmentsError: 'Failed to load environments',
        onEnvironmentsRetry: handleRetry,
      })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('displays empty state when no environments', () => {
      renderSettingsPage({ activeSection: 'environments', environments: [] })
      expect(screen.getByTestId('environments-empty')).toBeInTheDocument()
    })

    it('empty state shows call to action to create first environment', () => {
      renderSettingsPage({ activeSection: 'environments', environments: [] })
      expect(
        screen.getByRole('button', { name: /Create your first environment/i })
      ).toBeInTheDocument()
    })

    it('empty state with search shows "No environments match your filters"', () => {
      renderSettingsPage({
        activeSection: 'environments',
        environments: [],
        environmentsSearchQuery: 'nonexistent',
      })
      expect(screen.getByText(/No environments match your filters/i)).toBeInTheDocument()
      // CTA button should not be shown when there's a search query
      expect(
        screen.queryByRole('button', { name: /Create your first environment/i })
      ).not.toBeInTheDocument()
    })
  })

  describe('Variables Tab', () => {
    it('displays variables tab when section is active', () => {
      renderSettingsPage({ activeSection: 'variables' })
      expect(screen.getByTestId('system-variables-tab')).toBeInTheDocument()
    })

    it('does not display variables tab when another section is active', () => {
      renderSettingsPage({ activeSection: 'general' })
      expect(screen.queryByTestId('system-variables-tab')).not.toBeInTheDocument()
    })
  })

  describe('Backup Tab', () => {
    it('displays backup tab when section is active', () => {
      renderSettingsPage({ activeSection: 'backup' })
      expect(screen.getByTestId('backup-tab')).toBeInTheDocument()
    })

    it('does not display backup tab when another section is active', () => {
      renderSettingsPage({ activeSection: 'general' })
      expect(screen.queryByTestId('backup-tab')).not.toBeInTheDocument()
      expect(backupTabSpy).not.toHaveBeenCalled()
    })

    it('hands the periodicBackup result to the Backup tab, and nothing else', () => {
      renderSettingsPage({ activeSection: 'backup' })

      const tabProps = backupTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.periodicBackup).toBe(mockPeriodicBackup)
      expect(Object.keys(tabProps)).toEqual(['periodicBackup'])
    })

    it('hands a staged periodicBackup result through unchanged', () => {
      const staged: UsePeriodicBackupResult = {
        ...mockPeriodicBackup,
        staged: { ...mockPeriodicBackup.staged, enabled: true, cron: '0 2 * * *' },
        dirty: true,
      }
      renderSettingsPage({ activeSection: 'backup', periodicBackup: staged })

      const tabProps = backupTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.periodicBackup).toBe(staged)
    })
  })

  describe('WAVE Server Tab (REQ-5.2.7.15)', () => {
    it('displays the WAVE Server tab when section is active', () => {
      renderSettingsPage({ activeSection: 'server' })
      expect(screen.getByTestId('wave-server-tab')).toBeInTheDocument()
    })

    it('does not display the WAVE Server tab when another section is active', () => {
      renderSettingsPage({ activeSection: 'general' })
      expect(screen.queryByTestId('wave-server-tab')).not.toBeInTheDocument()
    })
  })

  describe('MCP Server Tab (REQ-5.2.7.1, REQ-5.2.7.14)', () => {
    it('displays mcp server tab when section is active', () => {
      renderSettingsPage({ activeSection: 'mcp' })
      expect(screen.getByTestId('mcp-server-tab')).toBeInTheDocument()
    })

    it('does not display mcp server tab when another section is active', () => {
      renderSettingsPage({ activeSection: 'general' })
      expect(screen.queryByTestId('mcp-server-tab')).not.toBeInTheDocument()
    })

    it('threads the mcp props through to the tab', () => {
      const { props } = renderSettingsPage({ activeSection: 'mcp' })

      expect(mcpTabSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: mockMcpSettings,
          status: mockMcpStatus,
          readStatus: 'loaded',
          staged: mockMcpStaged,
          dirty: false,
          saving: false,
          onStageChange: props.onMcpStageChange,
          onCancel: props.onMcpCancel,
          onSave: props.onMcpSave,
          onConfirmSave: props.onMcpConfirmSave,
          onDismissConfirmation: props.onMcpDismissConfirmation,
          onDisconnectSession: props.onMcpDisconnectSession,
          onRetry: props.onMcpRetry,
        }),
      )
      const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.error).toBeUndefined()
      expect(tabProps.statusError).toBeUndefined()
      expect(tabProps.confirmation).toBeUndefined()
    })

    it('threads a staged, saving page with an open confirmation through to the tab', () => {
      const confirmation = { restart: true, exposure: true }
      renderSettingsPage({
        activeSection: 'mcp',
        mcpDirty: true,
        mcpSaving: true,
        mcpConfirmation: confirmation,
      })

      const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.dirty).toBe(true)
      expect(tabProps.saving).toBe(true)
      expect(tabProps.confirmation).toBe(confirmation)
    })

    it.each(['pending', 'loaded', 'failed'] as const)(
      'threads the %s first-read state through as readStatus',
      (mcpReadStatus) => {
        renderSettingsPage({ activeSection: 'mcp', mcpReadStatus })

        const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
        expect(tabProps.readStatus).toBe(mcpReadStatus)
      },
    )

    it('threads the first-read failure as error and the poll failure as statusError', () => {
      renderSettingsPage({
        activeSection: 'mcp',
        mcpReadStatus: 'failed',
        mcpError: 'MCP settings are unavailable',
        mcpStatusError: 'The MCP status cannot be read',
      })

      const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.error).toBe('MCP settings are unavailable')
      expect(tabProps.statusError).toBe('The MCP status cannot be read')
    })

    it('threads the session to highlight through to the tab', () => {
      renderSettingsPage({ activeSection: 'mcp', mcpTargetSessionId: 'sess-2' })

      const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps.targetSessionId).toBe('sess-2')
    })

    it('gives the tab none of the replaced props', () => {
      renderSettingsPage({ activeSection: 'mcp' })

      const tabProps = mcpTabSpy.mock.lastCall?.[0] as Record<string, unknown>
      expect(tabProps).toHaveProperty('readStatus')
      expect(tabProps).not.toHaveProperty('loading')
      expect(tabProps).not.toHaveProperty('onToggleEnabled')
      expect(tabProps).not.toHaveProperty('onCancelStaged')
      expect(tabProps).not.toHaveProperty('onApplyStaged')
    })
  })

  describe('About Tab (SETTINGS-16)', () => {
    it('displays about section with system info', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.getByTestId('about-tab')).toBeInTheDocument()
    })

    it('displays application version', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
    })

    it('displays build identifier', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.getByText(/a1b2c3d4/)).toBeInTheDocument()
    })

    it('displays support links', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.getByRole('link', { name: /Documentation/i })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /Report an Issue/i })).toBeInTheDocument()
    })

    it('support links have correct href attributes', () => {
      renderSettingsPage({ activeSection: 'about' })
      expect(screen.getByRole('link', { name: /Documentation/i })).toHaveAttribute(
        'href',
        'https://docs.example.com'
      )
      expect(screen.getByRole('link', { name: /Report an Issue/i })).toHaveAttribute(
        'href',
        'https://github.com/example/wave/issues'
      )
    })

    it('displays loading state for system info', () => {
      renderSettingsPage({
        activeSection: 'about',
        systemInfoLoading: true,
        systemInfo: undefined,
      })
      expect(screen.getByTestId('about-loading')).toBeInTheDocument()
    })

    it('displays error state for system info', () => {
      renderSettingsPage({
        activeSection: 'about',
        systemInfoError: 'Failed to load system info',
        systemInfo: undefined,
      })
      expect(screen.getByTestId('about-error')).toBeInTheDocument()
      expect(screen.getByText(/Failed to load system info/i)).toBeInTheDocument()
    })

    it('displays retry button on error', () => {
      renderSettingsPage({
        activeSection: 'about',
        systemInfoError: 'Failed to load system info',
        systemInfo: undefined,
      })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
    })

    it('calls onSystemInfoRetry when retry is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderSettingsPage({
        activeSection: 'about',
        systemInfoError: 'Failed to load system info',
        systemInfo: undefined,
        onSystemInfoRetry: handleRetry,
      })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })
  })

  describe('URL-Based Navigation', () => {
    it('activates General tab from /settings/general URL', () => {
      renderSettingsPage({ activeSection: 'general' }, '/settings/general')
      expect(screen.getByTestId('general-tab')).toBeInTheDocument()
    })

    it('activates Environments tab from /settings/environments URL', () => {
      renderSettingsPage({ activeSection: 'environments' }, '/settings/environments')
      expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
    })

    it('activates About tab from /settings/about URL', () => {
      renderSettingsPage({ activeSection: 'about' }, '/settings/about')
      expect(screen.getByTestId('about-tab')).toBeInTheDocument()
    })
  })

  describe('Viewport-Filling Layout', () => {
    it('page container fills viewport height', () => {
      renderSettingsPage()
      const page = screen.getByTestId('settings-page')
      expect(page).toHaveClass('h-full')
    })

    it('page container has overflow hidden for content scrolling', () => {
      renderSettingsPage()
      const page = screen.getByTestId('settings-page')
      expect(page).toHaveClass('overflow-hidden')
    })

    it('content area scrolls independently', () => {
      renderSettingsPage()
      const content = screen.getByTestId('settings-content')
      expect(content).toHaveClass('overflow-y-auto')
    })
  })

  describe('Accessibility', () => {
    it('page has accessible heading structure', () => {
      renderSettingsPage({ activeSection: 'about' })
      // Page has h1 title and section content has h2 headings
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2, name: 'About WAVE' })).toBeInTheDocument()
    })

    it('navigation has nav role', () => {
      renderSettingsPage()
      expect(screen.getByRole('navigation', { name: /Settings/i })).toBeInTheDocument()
    })

    it('section nav items are keyboard accessible', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsPage({ onSectionChange: handleSectionChange })
      const generalNav = screen.getByRole('button', { name: /General/i })

      generalNav.focus()
      await user.keyboard('{Enter}')

      expect(handleSectionChange).toHaveBeenCalledWith('general')
    })

    it('active section has aria-current', () => {
      renderSettingsPage({ activeSection: 'environments' })
      const environmentsNav = screen.getByRole('button', { name: /Environments/i })
      expect(environmentsNav).toHaveAttribute('aria-current', 'page')
    })

    it('inactive sections do not have aria-current', () => {
      renderSettingsPage({ activeSection: 'environments' })
      const generalNav = screen.getByRole('button', { name: /General/i })
      expect(generalNav).not.toHaveAttribute('aria-current')
    })

    it('loading state has aria-busy', () => {
      renderSettingsPage({ activeSection: 'environments', environmentsLoading: true })
      const page = screen.getByTestId('settings-page')
      expect(page).toHaveAttribute('aria-busy', 'true')
    })

    it('is busy while the General first read is pending', () => {
      renderSettingsPage({
        activeSection: 'general',
        general: { ...mockGeneral, status: 'pending', logLevel: undefined },
      })
      expect(screen.getByTestId('settings-page')).toHaveAttribute('aria-busy', 'true')
    })

    it('is not busy once the General read loaded', () => {
      renderSettingsPage({ activeSection: 'general', general: { ...mockGeneral, status: 'loaded' } })
      expect(screen.getByTestId('settings-page')).not.toHaveAttribute('aria-busy', 'true')
    })

    it('is not busy once the General read failed', () => {
      renderSettingsPage({
        activeSection: 'general',
        general: {
          ...mockGeneral,
          status: 'failed',
          error: 'Admin API is not enabled on this server',
          logLevel: undefined,
        },
      })
      expect(screen.getByTestId('settings-page')).not.toHaveAttribute('aria-busy', 'true')
    })

    it('stops being busy when the pending General read answers', () => {
      const pending = { ...mockGeneral, status: 'pending' as const, logLevel: undefined }
      const { rerender, props } = renderSettingsPage({ activeSection: 'general', general: pending })
      expect(screen.getByTestId('settings-page')).toHaveAttribute('aria-busy', 'true')

      rerender(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/settings/*" element={<SettingsPage {...props} general={mockGeneral} />} />
          </Routes>
        </MemoryRouter>,
      )

      expect(screen.getByTestId('settings-page')).not.toHaveAttribute('aria-busy', 'true')
    })

    it('is not busy on another section while General has not been read yet', () => {
      renderSettingsPage({
        activeSection: 'environments',
        general: { ...mockGeneral, status: 'pending', logLevel: undefined },
      })
      expect(screen.getByTestId('settings-page')).not.toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Unknown Section Handling', () => {
    it('renders nothing for unknown section (default case)', () => {
      // Cast to any to test the default switch case with invalid section
      const unknownSection = 'unknown-section' as SettingsSection
      renderSettingsPage({ activeSection: unknownSection })

      // Should render page structure but no tab content
      expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      // None of the known tabs should be present
      expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      expect(screen.queryByTestId('environments-tab')).not.toBeInTheDocument()
      expect(screen.queryByTestId('about-tab')).not.toBeInTheDocument()
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderSettingsPage({ className: 'custom-settings' })
      expect(container.querySelector('.custom-settings')).toBeInTheDocument()
    })
  })

  describe('Environments Tags Filter', () => {
    it('removes tag when clicking already selected tag', async () => {
      const handleTagsChange = vi.fn()
      renderSettingsPage({
        activeSection: 'environments',
        environmentsTagsFilter: ['production'],
        allEnvironmentTags: ['production', 'staging', 'critical'],
        onEnvironmentsTagsFilterChange: handleTagsChange,
      })

      // Open tags filter
      const tagsButton = screen.getByTestId('filter-tags')
      await act(async () => {
        fireEvent.click(tagsButton)
      })

      // Wait for dialog
      const dialog = await screen.findByRole('dialog')

      // Click production tag (already selected, so should be removed)
      const productionItem = within(dialog).getByText('production')
      await act(async () => {
        fireEvent.click(productionItem)
      })

      // Should call with empty array (tag removed)
      expect(handleTagsChange).toHaveBeenCalledWith([])
    })

    it('filters tags when searching in tag popover', async () => {
      renderSettingsPage({
        activeSection: 'environments',
        environmentsTagsFilter: [],
        allEnvironmentTags: ['production', 'staging', 'critical'],
        onEnvironmentsTagsFilterChange: vi.fn(),
      })

      // Open tags filter
      const tagsButton = screen.getByTestId('filter-tags')
      await act(async () => {
        fireEvent.click(tagsButton)
      })

      // Wait for dialog and search input
      const dialog = await screen.findByRole('dialog')
      const searchInput = within(dialog).getByPlaceholderText('Search tags…')

      // Type to search
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: 'prod' } })
      })

      // Only production should be visible
      expect(within(dialog).getByText('production')).toBeInTheDocument()
      expect(within(dialog).queryByText('staging')).not.toBeInTheDocument()
      expect(within(dialog).queryByText('critical')).not.toBeInTheDocument()
    })

    it('clears all filters when Clear Filters button is clicked', async () => {
      const handleSearch = vi.fn()
      const handleTagsChange = vi.fn()

      renderSettingsPage({
        activeSection: 'environments',
        environmentsSearchQuery: 'test',
        environmentsTagsFilter: ['production'],
        allEnvironmentTags: ['production', 'staging'],
        onEnvironmentsSearch: handleSearch,
        onEnvironmentsTagsFilterChange: handleTagsChange,
      })

      // Find and click Clear Filters button
      const clearButton = screen.getByRole('button', { name: /Clear Filters/i })
      await act(async () => {
        fireEvent.click(clearButton)
      })

      // Should clear search
      expect(handleSearch).toHaveBeenCalledWith('')
      // Should clear tags
      expect(handleTagsChange).toHaveBeenCalledWith([])
    })

    it('does nothing when tag clicked without onTagsFilterChange handler', async () => {
      renderSettingsPage({
        activeSection: 'environments',
        environmentsTagsFilter: [],
        allEnvironmentTags: ['production', 'staging'],
        // NO onEnvironmentsTagsFilterChange provided
      })

      // Open tags filter
      const tagsButton = screen.getByTestId('filter-tags')
      await act(async () => {
        fireEvent.click(tagsButton)
      })

      // Wait for dialog
      const dialog = await screen.findByRole('dialog')

      // Click production tag - should not throw or call anything
      const productionItem = within(dialog).getByText('production')
      await act(async () => {
        fireEvent.click(productionItem)
      })

      // Nothing should happen (no handler to call), component should still be stable
      expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
    })
  })
})
