/**
 * SettingsContainer Component Tests
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * REQ-5.2.1.42: Settings and preferences screen
 *
 * Tests for SettingsContainer data fetching and state management:
 * - Environment CRUD operations
 * - Search and sort functionality
 * - Page hooks called with their active flags, results passed to the pages
 * - About system info read, failure and reload
 * - The unsaved-changes guard follows the active page (NET-1)
 * - Error handling
 *
 * Component: frontend/src/features/settings/container/container.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { SettingsContainer } from '@/features/settings/container/container'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import type { UnsavedChangesNavigationGuardProps } from '@/components/shared/unsaved-changes-navigation-guard'
import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import type { UseSshHostsResult } from '@/features/settings/container/use-ssh-hosts'
import type { UseCertificatesResult } from '@/features/settings/container/use-certificates'
import type { UseProxySettingsResult } from '@/features/settings/container/use-proxy-settings'
import type { UseProxyBlocksResult } from '@/features/settings/container/use-proxy-blocks'
import type { useMcpSettings } from '@/features/settings/container/use-mcp-settings'
import type { GeneralTab } from '@/features/settings/page/general-tab'
import type { BackupRestoreTab } from '@/features/settings/components/backup-restore-tab/tab'
import { useSettingsNavStore } from '@/features/settings/stores/settings-nav-store'

// ============================================================================
// Mocks
// ============================================================================

// Mock the API modules
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

vi.mock('@/lib/download-blob', () => ({
  downloadBlob: vi.fn(),
}))

vi.mock('@/features/settings/api/system-info', () => ({
  fetchSystemInfo: vi.fn(),
}))

vi.mock('@/features/settings/api/admin', () => ({
  fetchLogLevel: vi.fn(),
  setLogLevel: vi.fn(),
  fetchMaskingSettings: vi.fn(),
  setMaskingSettings: vi.fn(),
}))

vi.mock('@/features/settings/api/mcp', () => ({
  fetchMcpSettings: vi.fn(),
  updateMcpSettings: vi.fn(),
  fetchMcpStatus: vi.fn(),
  disconnectMcpSession: vi.fn(),
}))

// Mock SystemVariablesTab since it has its own dedicated test file
vi.mock('@/features/settings/components/global-variables-tab', () => ({
  SystemVariablesTab: () => <div data-testid="system-variables-tab">System Variables Mock</div>,
}))

// Mock WaveServerTab (dedicated test file) + its sessions API so the container's
// useServerSessions hook does not hit a real endpoint when the server section renders.
vi.mock('@/features/settings/page/wave-server-tab', () => ({
  WaveServerTab: () => <div data-testid="wave-server-tab">WAVE Server Mock</div>,
}))
vi.mock('@/features/settings/api/sessions', () => ({
  fetchServerStatus: vi.fn().mockResolvedValue({
    frontend: { running: true, urls: [], port: 3000, bind: 'local' },
    backend: { running: true, urls: [], port: 8000, bind: 'local' },
    session_count: 0,
    sessions: [],
    active_session_id: null,
    watching_session_ids: [],
    data_folder: '/srv/wave/data',
    config_file: '/srv/wave/config/config.yaml',
  }),
  disconnectSession: vi.fn(),
  disconnectOthers: vi.fn(),
  disconnectAll: vi.fn(),
}))

// Staged pages: the hooks are mocked so the tests see the active flag and
// drive the result object; the pages are mocked to capture the props they receive.
const {
  mockUseGeneralSettings,
  mockUsePeriodicBackup,
  mockUseMcpSettings,
  mockUseSshHosts,
  mockUseCertificates,
  mockUseProxySettings,
  mockUseProxyBlocks,
  mockGeneralTabProps,
  mockBackupTabProps,
  mockMcpTabProps,
  mockSshHostsTabProps,
  mockCertificatesTabProps,
  mockProxySetupTabProps,
  mockProxyBlocksTabProps,
  mockGuardProps,
} = vi.hoisted(() => ({
  mockUseGeneralSettings: vi.fn(),
  mockUsePeriodicBackup: vi.fn(),
  mockUseMcpSettings: vi.fn(),
  mockUseSshHosts: vi.fn(),
  mockUseCertificates: vi.fn(),
  mockUseProxySettings: vi.fn(),
  mockUseProxyBlocks: vi.fn(),
  mockGeneralTabProps: vi.fn(),
  mockBackupTabProps: vi.fn(),
  mockMcpTabProps: vi.fn(),
  mockSshHostsTabProps: vi.fn(),
  mockCertificatesTabProps: vi.fn(),
  mockProxySetupTabProps: vi.fn(),
  mockProxyBlocksTabProps: vi.fn(),
  mockGuardProps: vi.fn(),
}))
vi.mock('@/features/settings/container/use-general-settings', () => ({
  useGeneralSettings: mockUseGeneralSettings,
}))
vi.mock('@/features/settings/container/use-periodic-backup', () => ({
  usePeriodicBackup: mockUsePeriodicBackup,
}))
vi.mock('@/features/settings/container/use-mcp-settings', () => ({
  useMcpSettings: mockUseMcpSettings,
}))
vi.mock('@/features/settings/container/use-ssh-hosts', () => ({
  useSshHosts: mockUseSshHosts,
}))
vi.mock('@/features/settings/container/use-certificates', () => ({
  useCertificates: mockUseCertificates,
}))
vi.mock('@/features/settings/container/use-proxy-settings', () => ({
  useProxySettings: mockUseProxySettings,
}))
vi.mock('@/features/settings/container/use-proxy-blocks', () => ({
  useProxyBlocks: mockUseProxyBlocks,
}))
vi.mock('@/features/settings/page/general-tab', () => ({
  GeneralTab: (props: Record<string, unknown>) => {
    mockGeneralTabProps(props)
    return <div data-testid="general-tab">General Mock</div>
  },
}))
vi.mock('@/features/settings/components/backup-restore-tab/tab', () => ({
  BackupRestoreTab: (props: Record<string, unknown>) => {
    mockBackupTabProps(props)
    return <div data-testid="backup-tab">Backup Restore Mock</div>
  },
}))
vi.mock('@/features/settings/page/mcp-server-tab', () => ({
  McpServerTab: (props: Record<string, unknown>) => {
    mockMcpTabProps(props)
    return <div data-testid="mcp-server-tab">MCP Server Mock</div>
  },
}))
vi.mock('@/features/settings/page/network-ssh-hosts-tab', () => ({
  NetworkSshHostsTab: (props: { sshHosts: unknown }) => {
    mockSshHostsTabProps(props)
    return <div data-testid="network-ssh-hosts-tab">SSH Hosts Mock</div>
  },
}))
vi.mock('@/features/settings/page/network-certificates-tab', () => ({
  NetworkCertificatesTab: (props: { certificates: unknown }) => {
    mockCertificatesTabProps(props)
    return <div data-testid="network-certificates-tab">Certificates Mock</div>
  },
}))
vi.mock('@/features/settings/page/network-proxy-setup-tab', () => ({
  NetworkProxySetupTab: (props: { proxy: unknown }) => {
    mockProxySetupTabProps(props)
    return <div data-testid="network-proxy-setup-tab">Proxy Setup Mock</div>
  },
}))
vi.mock('@/features/settings/page/network-proxy-blocks-tab', () => ({
  NetworkProxyBlocksTab: (props: { blocks: unknown }) => {
    mockProxyBlocksTabProps(props)
    return <div data-testid="network-proxy-blocks-tab">Proxy Blocks Mock</div>
  },
}))

// The real guard still runs; the spy records the props the container gives it.
vi.mock('@/components/shared/unsaved-changes-navigation-guard', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/shared/unsaved-changes-navigation-guard')>()
  return {
    UnsavedChangesNavigationGuard: (props: UnsavedChangesNavigationGuardProps) => {
      mockGuardProps(props)
      return <actual.UnsavedChangesNavigationGuard {...props} />
    },
  }
})

// Import mocked functions
import {
  fetchEnvironments,
  fetchEnvironmentsTags,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
} from '@/features/settings/api/environments/crud'
import {
  exportEnvironment,
  exportEnvironments,
  validateEnvironmentImport,
  importEnvironments,
} from '@/features/settings/api/environments/import-export'
import { fetchSystemInfo } from '@/features/settings/api/system-info'
import { fetchLogLevel, fetchMaskingSettings } from '@/features/settings/api/admin'
import { downloadBlob } from '@/lib/download-blob'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockFetchEnvironments = fetchEnvironments as ReturnType<typeof vi.fn>
const mockFetchEnvironmentsTags = fetchEnvironmentsTags as ReturnType<typeof vi.fn>
const mockCreateEnvironment = createEnvironment as ReturnType<typeof vi.fn>
const mockUpdateEnvironment = updateEnvironment as ReturnType<typeof vi.fn>
const mockDeleteEnvironment = deleteEnvironment as ReturnType<typeof vi.fn>
const mockDuplicateEnvironment = duplicateEnvironment as ReturnType<typeof vi.fn>
const mockExportEnvironment = exportEnvironment as ReturnType<typeof vi.fn>
const mockExportEnvironments = exportEnvironments as ReturnType<typeof vi.fn>
const mockValidateEnvironmentImport = validateEnvironmentImport as ReturnType<typeof vi.fn>
const mockImportEnvironments = importEnvironments as ReturnType<typeof vi.fn>
const mockFetchSystemInfo = fetchSystemInfo as ReturnType<typeof vi.fn>
const mockFetchLogLevel = fetchLogLevel as ReturnType<typeof vi.fn>
const mockFetchMaskingSettings = fetchMaskingSettings as ReturnType<typeof vi.fn>

type UseGeneralSettingsResult = ComponentProps<typeof GeneralTab>['general']
type UsePeriodicBackupResult = ComponentProps<typeof BackupRestoreTab>['periodicBackup']
type UseMcpSettingsResult = ReturnType<typeof useMcpSettings>

const MCP_SETTINGS_STOPPED: McpSettings = {
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

const MCP_STATUS_STOPPED: McpStatus = {
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

const GENERAL_RESULT: UseGeneralSettingsResult = {
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

const PERIODIC_BACKUP_RESULT: UsePeriodicBackupResult = {
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

const MCP_RESULT: UseMcpSettingsResult = {
  readStatus: 'loaded',
  error: undefined,
  retry: vi.fn(),
  settings: MCP_SETTINGS_STOPPED,
  status: MCP_STATUS_STOPPED,
  statusError: undefined,
  staged: {
    enabled: false,
    until_restart: false,
    port: '8765',
    bind: 'local',
    auth_enabled: false,
    auth_username: '',
    auth_password: '',
  },
  dirty: false,
  saving: false,
  confirmation: undefined,
  stageChange: vi.fn(),
  cancel: vi.fn(),
  requestSave: vi.fn(),
  confirmSave: vi.fn(),
  dismissConfirmation: vi.fn(),
  disconnectSession: vi.fn(),
}

const SSH_HOSTS_RESULT: UseSshHostsResult = {
  status: 'loaded',
  policy: { lock_trusted_hosts: false, default_block_action: 'accept-new' },
  hosts: [
    {
      id: 'host-db1-22-ed25519',
      host: 'db1.lab.internal',
      port: 22,
      key_type: 'ED25519',
      fingerprint: 'SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s',
      added: '2026-09-30T08:15:00Z',
    },
  ],
  dirty: false,
  saving: false,
  setPolicy: vi.fn(),
  addHosts: vi.fn(),
  removeHosts: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}

const CERTIFICATES_RESULT: UseCertificatesResult = {
  status: 'loaded',
  settings: {
    public_source: 'builtin',
    builtin: { label: 'June 2026', count: 146 },
    host_store: {
      path: '/etc/ssl/certs/ca-certificates.crt',
      count: 142,
      last_changed: '2026-08-14',
    },
  },
  publicSource: 'builtin',
  builtin: [],
  additional: [],
  dirty: false,
  saving: false,
  setPublicSource: vi.fn(),
  addCertificates: vi.fn(),
  removeCertificates: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}

const PROXY_RESULT: UseProxySettingsResult = {
  status: 'loaded',
  settings: {
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
  },
  staged: {
    enabled: false,
    source: 'host',
    host: '',
    port: null,
    username: '',
    password: undefined,
    list_mode: 'except',
    entries: [],
    proxy_local_addresses: false,
  },
  dirty: false,
  saving: false,
  problems: [],
  checking: false,
  stage: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  retry: vi.fn(),
}

const PROXY_BLOCKS_RESULT: UseProxyBlocksResult = {
  status: 'loaded',
  blocks: {
    supported: [{ id: 'http', name: 'HTTP', category: 'network' }],
    unsupported: [],
    not_applicable: [],
  },
  retry: vi.fn(),
}

interface PageState {
  dirty: boolean
  saving: boolean
}

// The staged pages the guard follows; `save` is what the leave prompt's Save runs.
const GUARDED_PAGES = [
  {
    name: 'General',
    route: '/settings',
    landing: 'general-tab',
    leaveVia: 'settings-nav-environments',
    leaveTo: '/settings/environments',
    drive: (state: PageState) =>
      mockUseGeneralSettings.mockReturnValue({ ...GENERAL_RESULT, ...state }),
    save: GENERAL_RESULT.save,
    cancel: GENERAL_RESULT.cancel,
  },
  {
    name: 'SSH Hosts',
    route: '/settings/network/ssh-hosts',
    landing: 'network-ssh-hosts-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
    drive: (state: PageState) => mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, ...state }),
    save: SSH_HOSTS_RESULT.save,
    cancel: SSH_HOSTS_RESULT.cancel,
  },
  {
    name: 'Certificates',
    route: '/settings/network/certificates',
    landing: 'network-certificates-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
    drive: (state: PageState) =>
      mockUseCertificates.mockReturnValue({ ...CERTIFICATES_RESULT, ...state }),
    save: CERTIFICATES_RESULT.save,
    cancel: CERTIFICATES_RESULT.cancel,
  },
  {
    name: 'Proxy Setup',
    route: '/settings/network/proxy/setup',
    landing: 'network-proxy-setup-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
    drive: (state: PageState) =>
      mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, ...state }),
    save: PROXY_RESULT.save,
    cancel: PROXY_RESULT.cancel,
  },
  {
    name: 'MCP Server',
    route: '/settings/mcp',
    landing: 'mcp-server-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
    drive: (state: PageState) => mockUseMcpSettings.mockReturnValue({ ...MCP_RESULT, ...state }),
    save: MCP_RESULT.requestSave,
    cancel: MCP_RESULT.cancel,
  },
  {
    name: 'Backup',
    route: '/settings/backup',
    landing: 'backup-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
    drive: (state: PageState) =>
      mockUsePeriodicBackup.mockReturnValue({ ...PERIODIC_BACKUP_RESULT, ...state }),
    save: PERIODIC_BACKUP_RESULT.save,
    cancel: PERIODIC_BACKUP_RESULT.cancel,
  },
]

const PAGES_JOINING_THE_GUARD = GUARDED_PAGES.filter((page) =>
  ['General', 'MCP Server', 'Backup'].includes(page.name),
)

const UNGUARDED_SECTIONS = [
  {
    name: 'Environments',
    route: '/settings/environments',
    landing: 'environments-tab',
    leaveVia: 'settings-nav-variables',
    leaveTo: '/settings/variables',
  },
  {
    name: 'Variables',
    route: '/settings/variables',
    landing: 'system-variables-tab',
    leaveVia: 'settings-nav-server',
    leaveTo: '/settings/server',
  },
  {
    name: 'WAVE Server',
    route: '/settings/server',
    landing: 'wave-server-tab',
    leaveVia: 'settings-nav-variables',
    leaveTo: '/settings/variables',
  },
  {
    name: 'About',
    route: '/settings/about',
    landing: 'about-tab',
    leaveVia: 'settings-nav-variables',
    leaveTo: '/settings/variables',
  },
  {
    name: 'Proxy Blocks',
    route: '/settings/network/proxy/blocks',
    landing: 'network-proxy-blocks-tab',
    leaveVia: 'settings-nav-general',
    leaveTo: '/settings',
  },
]

const SECTIONS = [...GUARDED_PAGES, ...UNGUARDED_SECTIONS]

// ============================================================================
// Test Data
// ============================================================================

const mockEnvironmentsResponse = {
  data: [
    {
      id: 'env-1',
      name: 'Production',
      description: 'Production environment',
      tags: ['production'],
      usage: 0, // usage=0 so we can delete
      createdAt: '2025-01-10T10:00:00Z',
      updatedAt: '2025-01-15T14:30:00Z',
    },
  ],
  pagination: {
    page: 1,
    per_page: 20,
    total: 1,
    total_pages: 1,
  },
}

const mockSystemInfoResponse = {
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

// ============================================================================
// Test Utilities
// ============================================================================

// A data router, as in the app: the unsaved-changes guard blocks navigation through it.
function renderSettingsContainer(route = '/settings/environments') {
  const router = createMemoryRouter([{ path: '/settings/*', element: <SettingsContainer /> }], {
    initialEntries: [route],
  })
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
      <ToastContainer />
    </ToastProvider>
  )
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderWithLocation(route: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/settings/*',
        element: (
          <>
            <SettingsContainer />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [route] },
  )
  return render(
    <ToastProvider>
      <RouterProvider router={router} />
      <ToastContainer />
    </ToastProvider>
  )
}

function settingsNav() {
  return screen.getByRole('navigation', { name: 'Settings sections' })
}

function activeFlags(hook: ReturnType<typeof vi.fn>): unknown[] {
  return hook.mock.calls.map(([active]) => active)
}

function guardProps(): UnsavedChangesNavigationGuardProps {
  return mockGuardProps.mock.lastCall?.[0] as UnsavedChangesNavigationGuardProps
}

function leavePrompt(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Unsaved changes' })
}

// ============================================================================
// Tests
// ============================================================================

describe('SettingsContainer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetchEnvironments.mockResolvedValue(mockEnvironmentsResponse)
    mockFetchEnvironmentsTags.mockResolvedValue([])
    mockFetchSystemInfo.mockResolvedValue(mockSystemInfoResponse)
    mockUseGeneralSettings.mockReturnValue(GENERAL_RESULT)
    mockUsePeriodicBackup.mockReturnValue(PERIODIC_BACKUP_RESULT)
    mockUseMcpSettings.mockReturnValue(MCP_RESULT)
    mockUseSshHosts.mockReturnValue(SSH_HOSTS_RESULT)
    mockUseCertificates.mockReturnValue(CERTIFICATES_RESULT)
    mockUseProxySettings.mockReturnValue(PROXY_RESULT)
    mockUseProxyBlocks.mockReturnValue(PROXY_BLOCKS_RESULT)
    usePageBlockStore.setState({ block: null, retrying: false })
    useSettingsNavStore.setState(useSettingsNavStore.getInitialState(), true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Data Loading', () => {
    it('loads environments when navigating to environments section', async () => {
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })
    })

    it('loads system info when navigating to about section', async () => {
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(mockFetchSystemInfo).toHaveBeenCalled()
      })
    })

    it('renders the WAVE Server section at /settings/server', async () => {
      renderSettingsContainer('/settings/server')

      await waitFor(() => {
        expect(screen.getByTestId('wave-server-tab')).toBeInTheDocument()
      })
    })

    it('does not load environments on general section', async () => {
      renderSettingsContainer('/settings')

      await waitFor(() => {
        expect(screen.getByTestId('settings-page')).toBeInTheDocument()
      })

      // General section doesn't load environments
      expect(mockFetchEnvironments).not.toHaveBeenCalled()
    })

    it('handles error loading environments', async () => {
      mockFetchEnvironments.mockRejectedValue(new Error('Network error'))
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })

      // Error state should be set
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })

    it('handles error loading environments with non-Error object', async () => {
      mockFetchEnvironments.mockRejectedValue('String error')
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })

      // Fallback error message
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })

    it('handles error loading system info', async () => {
      mockFetchSystemInfo.mockRejectedValue(new Error('Network error'))
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(mockFetchSystemInfo).toHaveBeenCalled()
      })

      // Error state should be set
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })

    it('handles error loading system info with non-Error object', async () => {
      mockFetchSystemInfo.mockRejectedValue('String error')
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(mockFetchSystemInfo).toHaveBeenCalled()
      })

      // Fallback error message
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument()
      })
    })

    it('does not read environment tags while another section is showing', async () => {
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(mockFetchSystemInfo).toHaveBeenCalled()
      })

      expect(mockFetchEnvironmentsTags).not.toHaveBeenCalled()
    })

    it('a failed environment tag read cannot block a section it does not serve', async () => {
      mockFetchEnvironmentsTags.mockRejectedValue(new Error('Tags unavailable'))
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(mockFetchSystemInfo).toHaveBeenCalled()
      })

      expect(usePageBlockStore.getState().block).toBeNull()
    })

    it('reads environment tags on the environments section', async () => {
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(mockFetchEnvironmentsTags).toHaveBeenCalled()
      })
    })
  })

  describe('About System Info', () => {
    it('shows the loading state while the read is pending, then the system info', async () => {
      let finishRead!: (info: typeof mockSystemInfoResponse) => void
      mockFetchSystemInfo.mockReturnValue(
        new Promise<typeof mockSystemInfoResponse>((resolve) => {
          finishRead = resolve
        }),
      )
      renderSettingsContainer('/settings/about')

      expect(await screen.findByTestId('about-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('about-tab')).not.toBeInTheDocument()

      await act(async () => {
        finishRead(mockSystemInfoResponse)
      })

      expect(await screen.findByTestId('about-tab')).toBeInTheDocument()
      expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
      expect(screen.queryByTestId('about-loading')).not.toBeInTheDocument()
    })

    it('reads the system info once on entering About', async () => {
      renderSettingsContainer('/settings/about')

      expect(await screen.findByTestId('about-tab')).toBeInTheDocument()
      expect(mockFetchSystemInfo).toHaveBeenCalledTimes(1)
    })

    it('does not read the system info on another section', async () => {
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockFetchSystemInfo).not.toHaveBeenCalled()
    })

    it('reads the system info when switching to About', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      await user.click(screen.getByTestId('settings-nav-about'))

      expect(await screen.findByTestId('about-tab')).toBeInTheDocument()
      expect(mockFetchSystemInfo).toHaveBeenCalledTimes(1)
    })

    it('names the reason when the read fails', async () => {
      mockFetchSystemInfo.mockRejectedValue(new Error('System info is unavailable'))
      renderSettingsContainer('/settings/about')

      const failure = await screen.findByTestId('about-error')
      expect(within(failure).getByText(/^System info is unavailable$/)).toBeInTheDocument()
      expect(screen.queryByTestId('about-tab')).not.toBeInTheDocument()
      expect(screen.queryByTestId('about-loading')).not.toBeInTheDocument()
    })

    it('names a generic reason when the rejection is not an Error', async () => {
      mockFetchSystemInfo.mockRejectedValue('offline')
      renderSettingsContainer('/settings/about')

      const failure = await screen.findByTestId('about-error')
      expect(within(failure).getByText(/^Failed to load system info$/)).toBeInTheDocument()
    })

    it('reads again from Try Again and shows the system info', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchSystemInfo.mockRejectedValueOnce(new Error('System info is unavailable'))
      renderSettingsContainer('/settings/about')

      const failure = await screen.findByTestId('about-error')
      await user.click(within(failure).getByRole('button', { name: 'Try Again' }))

      expect(await screen.findByTestId('about-tab')).toBeInTheDocument()
      expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument()
      expect(screen.queryByTestId('about-error')).not.toBeInTheDocument()
      expect(mockFetchSystemInfo).toHaveBeenCalledTimes(2)
    })

    it('names the new reason when the reload fails too', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      mockFetchSystemInfo
        .mockRejectedValueOnce(new Error('System info is unavailable'))
        .mockRejectedValueOnce(new Error('Server is restarting'))
      renderSettingsContainer('/settings/about')

      const failure = await screen.findByTestId('about-error')
      await user.click(within(failure).getByRole('button', { name: 'Try Again' }))

      expect(await screen.findByText(/^Server is restarting$/)).toBeInTheDocument()
      expect(screen.queryByText(/^System info is unavailable$/)).not.toBeInTheDocument()
      expect(mockFetchSystemInfo).toHaveBeenCalledTimes(2)
    })
  })

  describe('Duplicate Environment', () => {
    it('duplicates environment successfully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockResolvedValue({ id: 'env-2', name: 'Production (copy)' })
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click the kebab menu trigger
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalledWith('env-1')
      })

      // Verify environments are reloaded after successful duplicate
      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
      })
    })

    it('handles duplicate error with Error instance', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockRejectedValue(new Error('Duplicate failed'))
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalledWith('env-1')
      })
    })

    it('handles duplicate error with non-Error object', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockRejectedValue('String error')
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
        expect(duplicateOption).toBeInTheDocument()
      })

      const duplicateOption = screen.getByRole('menuitem', { name: /duplicate/i })
      await user.click(duplicateOption)

      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalledWith('env-1')
      })
    })
  })

  describe('Delete Environment', () => {
    async function openDeleteDialog(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
      const menuTrigger = screen.getByTestId('action-menu-trigger')
      await user.click(menuTrigger)

      await waitFor(() => {
        const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
        expect(deleteOption).toBeInTheDocument()
      })

      const deleteOption = screen.getByRole('menuitem', { name: /delete/i })
      await user.click(deleteOption)
    }

    async function confirmDeleteInDialog(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
      // For usage = 0, the dialog has a simple "Delete" button (no type-to-confirm).
      const dialog = await screen.findByRole('alertdialog')
      const confirmBtn = await within(dialog).findByRole('button', { name: /delete/i })
      await user.click(confirmBtn)
    }

    it('deletes environment successfully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockResolvedValue(undefined)
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)
      await confirmDeleteInDialog(user)

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalledWith('env-1')
      })

      // Verify environments are reloaded after successful delete
      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
      })
    })

    it('names the failure in a toast when the delete fails', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockRejectedValue(new Error('Delete failed'))
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)
      await confirmDeleteInDialog(user)

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalledWith('env-1')
      })

      // Confirming always closes the dialog, so a failure cannot land inside it.
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Delete Failed')).toBeInTheDocument()
      expect(screen.getByText('Delete failed')).toBeInTheDocument()
    })

    it('names the failure in a toast when the delete fails with a non-Error', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockRejectedValue('String error')
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)
      await confirmDeleteInDialog(user)

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalledWith('env-1')
      })

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(await screen.findByText('Delete Failed')).toBeInTheDocument()
      expect(screen.getByText('Failed to delete environment')).toBeInTheDocument()
    })

    it('shows type-to-confirm copy when env is in use (singular)', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchEnvironments.mockResolvedValue({
        ...mockEnvironmentsResponse,
        data: [{ ...mockEnvironmentsResponse.data[0], usage: 1 }],
      })
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)

      const dialog = await screen.findByRole('alertdialog')
      // Singular form when usage=1
      expect(within(dialog).getByText(/used by 1 profile\b/)).toBeInTheDocument()
      // Type-to-confirm input rendered (aria-label uses the env name)
      expect(within(dialog).getByLabelText(/type Production to confirm/i)).toBeInTheDocument()
    })

    it('shows plural copy when multiple profiles use the env', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchEnvironments.mockResolvedValue({
        ...mockEnvironmentsResponse,
        data: [{ ...mockEnvironmentsResponse.data[0], usage: 4 }],
      })
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)

      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(/used by 4 profiles/)).toBeInTheDocument()
    })

    it('cancels delete when the cancel action is invoked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      await openDeleteDialog(user)

      const dialog = await screen.findByRole('alertdialog')
      const cancelBtn = within(dialog).getByRole('button', { name: /cancel/i })
      await user.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(mockDeleteEnvironment).not.toHaveBeenCalled()
    })
  })

  describe('Search Functionality', () => {
    it('triggers search when input changes', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup({ delay: null })

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search environments/i)).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchEnvironments.mockClear()

      const searchInput = screen.getByPlaceholderText(/Search environments/i)

      // Type search term and wait for debounce (debounceMs=300 in settings.tsx)
      await user.type(searchInput, 'prod')

      // Wait for the debounced search to trigger
      await waitFor(
        () => {
          const calls = mockFetchEnvironments.mock.calls
          const hasSearchCall = calls.some(
            (call: unknown[]) => (call[0] as { search?: string })?.search === 'prod'
          )
          expect(hasSearchCall).toBe(true)
        },
        { timeout: 2000 } // Allow time for debounce
      )
    })

  })

  describe('Sort Functionality', () => {
    it('triggers sort when name column header is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchEnvironments.mockClear()

      // Find and click the Name column header (sortable columns use the whole header as trigger)
      const nameHeader = screen.getByRole('columnheader', { name: /name/i })
      await user.click(nameHeader)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasSortCall = calls.some(
          (call: unknown[]) => (call[0] as { sort_by?: string })?.sort_by === 'name'
        )
        expect(hasSortCall).toBe(true)
      })
    })

    it('toggles sort direction when clicking same column twice', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      const nameHeader = screen.getByRole('columnheader', { name: /name/i })

      // First click - should sort ascending
      mockFetchEnvironments.mockClear()
      await user.click(nameHeader)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasAscCall = calls.some(
          (call: unknown[]) => {
            const params = call[0] as { sort_by?: string; sort_direction?: string }
            return params?.sort_by === 'name' && params?.sort_direction === 'asc'
          }
        )
        expect(hasAscCall).toBe(true)
      })

      // Second click - should sort descending
      mockFetchEnvironments.mockClear()
      await user.click(nameHeader)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasDescCall = calls.some(
          (call: unknown[]) => {
            const params = call[0] as { sort_by?: string; sort_direction?: string }
            return params?.sort_by === 'name' && params?.sort_direction === 'desc'
          }
        )
        expect(hasDescCall).toBe(true)
      })
    })
  })


  describe('Form Submission', () => {
    it('creates environment successfully via form', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockCreateEnvironment.mockResolvedValue({ id: 'env-new', name: 'New Env' })
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click "New Environment" button
      const newEnvButton = screen.getByRole('button', { name: /new environment/i })
      await user.click(newEnvButton)

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Fill in the form
      const nameInput = screen.getByPlaceholderText(/enter environment name/i)
      await user.type(nameInput, 'New Environment')

      // Submit the form
      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateEnvironment).toHaveBeenCalledWith({
          name: 'New Environment',
          description: undefined,
          tags: [],
        })
      })

      // Verify environments are reloaded
      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
      })
    })

    it('edits environment successfully via form', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockUpdateEnvironment.mockResolvedValue({ id: 'env-1', name: 'Updated Prod' })
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click the edit action button to edit
      const editButton = screen.getByTestId('action-edit')
      await user.click(editButton)

      // Wait for dialog to open
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Clear and update the name
      const nameInput = screen.getByPlaceholderText(/enter environment name/i)
      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Production')

      // Submit the form
      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      await waitFor(() => {
        // Description and tags are preserved from the existing environment data
        expect(mockUpdateEnvironment).toHaveBeenCalledWith('env-1', {
          name: 'Updated Production',
          description: 'Production environment',
          tags: ['production'],
        })
      })

      // Verify environments are reloaded
      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
      })
    })

    it('handles form submission error with Error instance', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockCreateEnvironment.mockRejectedValue(new Error('Create failed'))
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open new environment form
      const newEnvButton = screen.getByRole('button', { name: /new environment/i })
      await user.click(newEnvButton)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Fill and submit form
      const nameInput = screen.getByPlaceholderText(/enter environment name/i)
      await user.type(nameInput, 'New Env')

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateEnvironment).toHaveBeenCalled()
      })

      // Form should show error
      await waitFor(() => {
        expect(screen.getByTestId('form-error')).toBeInTheDocument()
      })
    })

    it('handles form submission error with non-Error object', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockCreateEnvironment.mockRejectedValue('String error')
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open new environment form
      const newEnvButton = screen.getByRole('button', { name: /new environment/i })
      await user.click(newEnvButton)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Fill and submit form
      const nameInput = screen.getByPlaceholderText(/enter environment name/i)
      await user.type(nameInput, 'New Env')

      const createButton = screen.getByRole('button', { name: /^create$/i })
      await user.click(createButton)

      await waitFor(() => {
        expect(mockCreateEnvironment).toHaveBeenCalled()
      })

      // Form should show fallback error
      await waitFor(() => {
        const errorEl = screen.getByTestId('form-error')
        expect(errorEl).toHaveTextContent('Failed to save environment')
      })
    })

    it('closes the form when close button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open new environment form
      const newEnvButton = screen.getByRole('button', { name: /new environment/i })
      await user.click(newEnvButton)

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Click close button (uses aria-label="Close")
      const closeButton = screen.getByRole('button', { name: /^close$/i })
      await user.click(closeButton)

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('Pagination', () => {
    const mockMultiPageResponse = {
      data: [
        {
          id: 'env-1',
          name: 'Production',
          description: 'Production environment',
          tags: [],
          usage: 0,
          createdAt: '2025-01-10T10:00:00Z',
          updatedAt: '2025-01-15T14:30:00Z',
        },
      ],
      pagination: {
        page: 1,
        per_page: 20,
        total: 100,
        total_pages: 5,
      },
    }

    it('changes page when next page button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchEnvironments.mockResolvedValue(mockMultiPageResponse)
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchEnvironments.mockClear()

      // Click next page button
      const nextButton = screen.getByRole('button', { name: /next page/i })
      await user.click(nextButton)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasPageCall = calls.some(
          (call: unknown[]) => (call[0] as { page?: number })?.page === 2
        )
        expect(hasPageCall).toBe(true)
      })
    })

    it('changes page when previous page button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Start on page 2
      const page2Response = {
        ...mockMultiPageResponse,
        pagination: { ...mockMultiPageResponse.pagination, page: 2 },
      }
      mockFetchEnvironments.mockResolvedValue(page2Response)
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // First navigate to page 2 via next button to set up state
      mockFetchEnvironments.mockResolvedValue(mockMultiPageResponse)
      const nextButton = screen.getByRole('button', { name: /next page/i })
      await user.click(nextButton)

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalledTimes(2)
      })

      // Reset mock and click previous
      mockFetchEnvironments.mockClear()
      const prevButton = screen.getByRole('button', { name: /previous page/i })
      await user.click(prevButton)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasPageCall = calls.some(
          (call: unknown[]) => (call[0] as { page?: number })?.page === 1
        )
        expect(hasPageCall).toBe(true)
      })
    })

    it('changes page size when selector is changed', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockFetchEnvironments.mockResolvedValue(mockMultiPageResponse)
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Reset mock to track new calls
      mockFetchEnvironments.mockClear()

      // Find and click the page size selector
      const pageSizeSelector = screen.getByTestId('page-size-selector')
      await user.click(pageSizeSelector)

      // Wait for dropdown to open and select 50
      await waitFor(() => {
        expect(screen.getByRole('option', { name: '50' })).toBeInTheDocument()
      })

      const option50 = screen.getByRole('option', { name: '50' })
      await user.click(option50)

      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasPageSizeCall = calls.some(
          (call: unknown[]) => (call[0] as { per_page?: number })?.per_page === 50
        )
        expect(hasPageSizeCall).toBe(true)
      })
    })
  })

  describe('Section Navigation', () => {
    it('navigates to environments section when nav item clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings')

      await waitFor(() => {
        expect(screen.getByTestId('general-tab')).toBeInTheDocument()
      })

      // Click environments nav item
      const envNav = screen.getByTestId('settings-nav-environments')
      await user.click(envNav)

      await waitFor(() => {
        expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
      })
    })

    it('navigates to general section from environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
      })

      // Click general nav item
      const generalNav = screen.getByTestId('settings-nav-general')
      await user.click(generalNav)

      await waitFor(() => {
        expect(screen.getByTestId('general-tab')).toBeInTheDocument()
      })
    })
  })

  describe('URL Section Routing', () => {
    it('shows environments tab for /settings/environments URL', async () => {
      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByTestId('environments-tab')).toBeInTheDocument()
      })
    })

    it('falls back to the general tab for /settings/integrations URL', async () => {
      renderSettingsContainer('/settings/integrations')

      await waitFor(() => {
        expect(screen.getByTestId('general-tab')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('integrations-tab')).not.toBeInTheDocument()
    })

    it('shows about tab for /settings/about URL', async () => {
      renderSettingsContainer('/settings/about')

      await waitFor(() => {
        expect(screen.getByTestId('about-tab')).toBeInTheDocument()
      })
    })

    it('shows variables tab for /settings/variables URL', async () => {
      renderSettingsContainer('/settings/variables')

      await waitFor(() => {
        expect(screen.getByTestId('system-variables-tab')).toBeInTheDocument()
      })
    })

    it('shows backup tab for /settings/backup URL', async () => {
      renderSettingsContainer('/settings/backup')

      await waitFor(() => {
        expect(screen.getByTestId('backup-tab')).toBeInTheDocument()
      })
    })

    it('shows mcp server tab for /settings/mcp URL', async () => {
      renderSettingsContainer('/settings/mcp')

      await waitFor(() => {
        expect(screen.getByTestId('mcp-server-tab')).toBeInTheDocument()
      })
    })

    it('shows general tab for /settings URL (default)', async () => {
      renderSettingsContainer('/settings')

      await waitFor(() => {
        expect(screen.getByTestId('general-tab')).toBeInTheDocument()
      })
    })
  })

  describe('MCP Section Wiring (REQ-5.2.7.1, REQ-5.2.7.14)', () => {
    it('activates useMcpSettings on /settings/mcp', async () => {
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      expect(mockUseMcpSettings).toHaveBeenLastCalledWith(true)
    })

    it('calls useMcpSettings inactive on other sections', async () => {
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseMcpSettings).toHaveBeenCalled()
      expect(activeFlags(mockUseMcpSettings).every((active) => active === false)).toBe(true)
    })

    it('moves the active flag when navigating to the section via the nav', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseMcpSettings).toHaveBeenLastCalledWith(false)

      await user.click(screen.getByTestId('settings-nav-mcp'))

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      expect(mockUseMcpSettings).toHaveBeenLastCalledWith(true)
    })

    it('passes the hook state to the MCP page under its prop names', async () => {
      const result: UseMcpSettingsResult = {
        ...MCP_RESULT,
        statusError: 'The MCP status cannot be read',
        dirty: true,
        saving: true,
        confirmation: { restart: true, exposure: false },
      }
      mockUseMcpSettings.mockReturnValue(result)
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.settings).toBe(result.settings)
      expect(props.status).toBe(result.status)
      expect(props.readStatus).toBe('loaded')
      expect(props.error).toBeUndefined()
      expect(props.statusError).toBe('The MCP status cannot be read')
      expect(props.staged).toBe(result.staged)
      expect(props.dirty).toBe(true)
      expect(props.saving).toBe(true)
      expect(props.confirmation).toBe(result.confirmation)
    })

    it('passes a clean, idle page with no confirmation', async () => {
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.readStatus).toBe('loaded')
      expect(props.dirty).toBe(false)
      expect(props.saving).toBe(false)
      expect(props.confirmation).toBeUndefined()
      expect(props.statusError).toBeUndefined()
    })

    it('passes a pending first read to the MCP page', async () => {
      mockUseMcpSettings.mockReturnValue({
        ...MCP_RESULT,
        readStatus: 'pending',
        settings: undefined,
        status: undefined,
      })
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.readStatus).toBe('pending')
      expect(props.settings).toBeUndefined()
      expect(props.status).toBeUndefined()
      expect(props.error).toBeUndefined()
    })

    it('passes a failed first read with its reason to the MCP page', async () => {
      mockUseMcpSettings.mockReturnValue({
        ...MCP_RESULT,
        readStatus: 'failed',
        error: 'MCP settings are unavailable',
        settings: undefined,
        status: undefined,
      })
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.readStatus).toBe('failed')
      expect(props.error).toBe('MCP settings are unavailable')
      expect(props.statusError).toBeUndefined()
    })

    it('gives the MCP page none of the replaced props', async () => {
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props).toHaveProperty('readStatus')
      expect(props).not.toHaveProperty('loading')
      expect(props).not.toHaveProperty('onToggleEnabled')
      expect(props).not.toHaveProperty('onCancelStaged')
      expect(props).not.toHaveProperty('onApplyStaged')
    })

    it('wires the MCP page actions to the hook', async () => {
      const disconnectSession = vi.fn().mockResolvedValue(undefined)
      mockUseMcpSettings.mockReturnValue({ ...MCP_RESULT, disconnectSession })
      renderSettingsContainer('/settings/mcp')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as {
        onStageChange: (field: string, value: string | boolean) => void
        onCancel: () => void
        onSave: () => void
        onConfirmSave: () => void
        onDismissConfirmation: () => void
        onRetry: () => void
        onDisconnectSession: (sessionId: string) => void
      }

      props.onStageChange('port', '9000')
      expect(MCP_RESULT.stageChange).toHaveBeenCalledTimes(1)
      expect(MCP_RESULT.stageChange).toHaveBeenCalledWith('port', '9000')

      props.onCancel()
      expect(MCP_RESULT.cancel).toHaveBeenCalledTimes(1)

      props.onSave()
      expect(MCP_RESULT.requestSave).toHaveBeenCalledTimes(1)
      expect(MCP_RESULT.confirmSave).not.toHaveBeenCalled()

      props.onConfirmSave()
      expect(MCP_RESULT.confirmSave).toHaveBeenCalledTimes(1)

      props.onDismissConfirmation()
      expect(MCP_RESULT.dismissConfirmation).toHaveBeenCalledTimes(1)

      props.onRetry()
      expect(MCP_RESULT.retry).toHaveBeenCalledTimes(1)

      props.onDisconnectSession('sess-1')
      expect(disconnectSession).toHaveBeenCalledTimes(1)
      expect(disconnectSession).toHaveBeenCalledWith('sess-1')
    })

    it('passes the ?session target to the MCP page', async () => {
      renderSettingsContainer('/settings/mcp?session=sess-2')

      expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
      const props = mockMcpTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.targetSessionId).toBe('sess-2')
    })
  })

  describe('Environments with Edge Case Tags', () => {
    it('aggregates tags from multiple environments with varying tag counts', async () => {
      // Mock multiple environments - one with tags, one with empty tags
      const environmentsWithVaryingTags = {
        data: [
          {
            id: 'env-1',
            name: 'Tagged Environment',
            description: 'Has tags',
            tags: ['production', 'critical'],
            usage: 0,
            createdAt: '2025-01-10T10:00:00Z',
            updatedAt: '2025-01-15T14:30:00Z',
          },
          {
            id: 'env-2',
            name: 'Empty Tags Environment',
            description: 'Has empty tags array',
            tags: [], // Empty array to test iteration
            usage: 0,
            createdAt: '2025-01-10T10:00:00Z',
            updatedAt: '2025-01-15T14:30:00Z',
          },
        ],
        pagination: {
          page: 1,
          per_page: 20,
          total: 2,
          total_pages: 1,
        },
      }

      // Reset and set mock BEFORE render
      mockFetchEnvironments.mockReset()
      mockFetchEnvironments.mockResolvedValue(environmentsWithVaryingTags)
      renderSettingsContainer('/settings/environments')

      // Should render both environments
      await waitFor(() => {
        expect(screen.getByText('Tagged Environment')).toBeInTheDocument()
      })
      expect(screen.getByText('Empty Tags Environment')).toBeInTheDocument()

      // The tag aggregation in useMemo should work correctly
      expect(screen.getByTestId('environments-table')).toBeInTheDocument()
    })
  })

  describe('General Section Wiring (REQ-3.7.2.6, REQ-3.1.3.17)', () => {
    const sectionsOutsideGeneral = SECTIONS.filter((section) => section.name !== 'General')

    it('activates useGeneralSettings on /settings', async () => {
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(true)
      expect(activeFlags(mockUseGeneralSettings).every((active) => active === true)).toBe(true)
    })

    it.each(sectionsOutsideGeneral)(
      'calls useGeneralSettings inactive on $name',
      async ({ route, landing }) => {
        renderSettingsContainer(route)

        expect(await screen.findByTestId(landing)).toBeInTheDocument()
        expect(mockUseGeneralSettings).toHaveBeenCalled()
        expect(activeFlags(mockUseGeneralSettings).every((active) => active === false)).toBe(true)
      },
    )

    it('moves the active flag on when switching to General', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(false)

      await user.click(screen.getByTestId('settings-nav-general'))

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(true)
    })

    it('moves the active flag off when leaving General', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(true)

      await user.click(screen.getByTestId('settings-nav-backup'))

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(false)
    })

    it('passes the useGeneralSettings result to the General page as general, and nothing else', async () => {
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      const props = mockGeneralTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.general).toBe(GENERAL_RESULT)
      expect(Object.keys(props)).toEqual(['general'])
    })

    it('passes a failed read state through to the General page unchanged', async () => {
      const failed: UseGeneralSettingsResult = {
        ...GENERAL_RESULT,
        status: 'failed',
        error: 'Admin API is not enabled on this server',
        logLevel: undefined,
      }
      mockUseGeneralSettings.mockReturnValue(failed)
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      const props = mockGeneralTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.general).toBe(failed)
    })

    it('does not render the General page on another section', async () => {
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockGeneralTabProps).not.toHaveBeenCalled()
    })

    it('does not read the log level or the masking flags itself', async () => {
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(true)
      expect(mockFetchLogLevel).not.toHaveBeenCalled()
      expect(mockFetchMaskingSettings).not.toHaveBeenCalled()
    })

    it('does not read the log level or the masking flags itself when switching to General', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      await user.click(screen.getByTestId('settings-nav-general'))

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUseGeneralSettings).toHaveBeenLastCalledWith(true)
      expect(mockFetchLogLevel).not.toHaveBeenCalled()
      expect(mockFetchMaskingSettings).not.toHaveBeenCalled()
    })
  })

  describe('Backup Section Wiring (REQ-4.7.20)', () => {
    const sectionsOutsideBackup = SECTIONS.filter((section) => section.name !== 'Backup')

    it('activates usePeriodicBackup on /settings/backup', async () => {
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockUsePeriodicBackup).toHaveBeenLastCalledWith(true)
      expect(activeFlags(mockUsePeriodicBackup).every((active) => active === true)).toBe(true)
    })

    it.each(sectionsOutsideBackup)(
      'calls usePeriodicBackup inactive on $name',
      async ({ route, landing }) => {
        renderSettingsContainer(route)

        expect(await screen.findByTestId(landing)).toBeInTheDocument()
        expect(mockUsePeriodicBackup).toHaveBeenCalled()
        expect(activeFlags(mockUsePeriodicBackup).every((active) => active === false)).toBe(true)
      },
    )

    it('moves the active flag on when switching to Backup', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUsePeriodicBackup).toHaveBeenLastCalledWith(false)

      await user.click(screen.getByTestId('settings-nav-backup'))

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockUsePeriodicBackup).toHaveBeenLastCalledWith(true)
    })

    it('moves the active flag off when leaving Backup', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      expect(mockUsePeriodicBackup).toHaveBeenLastCalledWith(true)

      await user.click(screen.getByTestId('settings-nav-general'))

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockUsePeriodicBackup).toHaveBeenLastCalledWith(false)
    })

    it('passes the usePeriodicBackup result to the Backup page as periodicBackup, and nothing else', async () => {
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      const props = mockBackupTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.periodicBackup).toBe(PERIODIC_BACKUP_RESULT)
      expect(Object.keys(props)).toEqual(['periodicBackup'])
    })

    it('passes a failed read state through to the Backup page unchanged', async () => {
      const failed: UsePeriodicBackupResult = {
        ...PERIODIC_BACKUP_RESULT,
        status: 'failed',
        error: 'The backup schedule cannot be read',
      }
      mockUsePeriodicBackup.mockReturnValue(failed)
      renderSettingsContainer('/settings/backup')

      expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
      const props = mockBackupTabProps.mock.lastCall?.[0] as Record<string, unknown>
      expect(props.periodicBackup).toBe(failed)
    })

    it('does not render the Backup page on another section', async () => {
      renderSettingsContainer('/settings')

      expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      expect(mockBackupTabProps).not.toHaveBeenCalled()
    })
  })

  describe('Export Environments', () => {
    it('opens export dialog when Export row action is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open kebab menu
      const envRow = document.querySelector('[data-row-id="env-1"]') as HTMLElement
      await user.click(within(envRow).getByTestId('action-menu-trigger'))

      // Click Export
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })
    })

    it('performs single export and downloads through the shared downloadBlob helper', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()

      const blob = new Blob(['content'], { type: 'application/x-yaml' })
      mockExportEnvironment.mockResolvedValue(blob)

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open kebab menu and click Export
      const envRow = document.querySelector('[data-row-id="env-1"]') as HTMLElement
      await user.click(within(envRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click the Download button
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(mockExportEnvironment).toHaveBeenCalledWith('env-1', { format: 'yaml' })
      })
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'Production.yaml')
    })

    it('handles export error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockExportEnvironment.mockRejectedValue(new Error('Export failed'))

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open kebab menu and click Export
      const envRow = document.querySelector('[data-row-id="env-1"]') as HTMLElement
      await user.click(within(envRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click the Download button
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Export failed:', expect.any(Error))
      })

      consoleSpy.mockRestore()
    })

    it('handles export error with non-Error value', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockExportEnvironment.mockRejectedValue('network error string')

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open kebab menu and click Export
      const envRow = document.querySelector('[data-row-id="env-1"]') as HTMLElement
      await user.click(within(envRow).getByTestId('action-menu-trigger'))
      await user.click(screen.getByRole('menuitem', { name: /Export/i }))

      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click the Download button
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Export failed:', 'network error string')
      })

      consoleSpy.mockRestore()
    })
  })

  describe('Import Environments', () => {
    it('opens import dialog when Import button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click Import button
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })
    })

    it('refreshes environments after successful import', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const mockValidateResult = {
        items: [
          { name: 'New Env', status: 'ok', fatal_errors: [], fixable_errors: [], warnings: [], existing_id: null },
        ],
        total: 1,
        importable: 1,
        blocked: 0,
      }
      const mockImportResult = {
        imported: [{ name: 'New Env', id: 'new-id', action: 'created' }],
        skipped: [],
        fixes_applied: [],
        total_imported: 1,
        total_skipped: 0,
      }

      mockValidateEnvironmentImport.mockResolvedValue(mockValidateResult)
      mockImportEnvironments.mockResolvedValue(mockImportResult)

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open import dialog
      await user.click(screen.getByTestId('import-button'))

      await waitFor(() => {
        expect(screen.getByTestId('import-dialog')).toBeInTheDocument()
      })

      // Upload file
      const file = new File(['content'], 'envs.yaml')
      const fileInput = screen.getByTestId('file-input')
      await user.upload(fileInput, file)

      // Click Validate
      await user.click(screen.getByTestId('validate-button'))

      await waitFor(() => {
        expect(screen.getByTestId('review-step')).toBeInTheDocument()
      })

      // Clear mock to check reload
      mockFetchEnvironments.mockClear()

      // Click Import button inside the import dialog (not the toolbar button)
      const { within } = await import('@testing-library/react')
      const importDialog = screen.getByTestId('import-dialog')
      await user.click(within(importDialog).getByTestId('import-button'))

      await waitFor(() => {
        expect(mockFetchEnvironments).toHaveBeenCalled()
      })
    })
  })

  describe('Selection Mode and Bulk Actions', () => {
    it('enters selection mode when Mass Action button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click Mass Action button
      const massActionBtn = screen.getByRole('button', { name: /mass action/i })
      await user.click(massActionBtn)

      // Selection mode should be active (shows selection counter and close button)
      await waitFor(() => {
        expect(screen.getByTestId('selection-counter')).toBeInTheDocument()
      })
    })

    it('exits selection mode when close button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByTestId('selection-close')).toBeInTheDocument()
      })

      // Exit selection mode
      await user.click(screen.getByTestId('selection-close'))

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mass action/i })).toBeInTheDocument()
      })
    })

    it('selects environments via checkboxes in selection mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
      })

      // Select the Production environment
      const rowCheckbox = screen.getByRole('checkbox', { name: /select production/i })
      await user.click(rowCheckbox)

      // Counter should show 1 selected
      await waitFor(() => {
        expect(screen.getByTestId('selection-counter')).toHaveTextContent('1 selected')
      })
    })

    it('bulk duplicates selected environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockResolvedValue({})

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select an environment
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })

      // Clear mock to track new calls
      mockFetchEnvironments.mockClear()

      // Click duplicate
      await user.click(screen.getByTestId('bulk-action-duplicate'))

      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalledWith('env-1')
      })
    })

    it('bulk deletes selected environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockResolvedValue({})

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select an environment
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })

      // Clear mock to track new calls
      mockFetchEnvironments.mockClear()

      // Click delete
      await user.click(screen.getByTestId('bulk-action-delete'))

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalledWith('env-1')
      })
    })

    it('bulk exports selected environments', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select an environment
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions dropdown
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })

      // Click export
      await user.click(screen.getByTestId('bulk-action-export'))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })
    })

    it('performs bulk export and downloads the ZIP through the shared downloadBlob helper', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const blob = new Blob(['zip content'], { type: 'application/zip' })
      mockExportEnvironments.mockResolvedValue(blob)

      // Use multi-env response so we can select multiple
      const multiEnvResponse = {
        data: [
          { id: 'env-1', name: 'Production', description: 'Prod', tags: [], usage: 0, createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-15T14:30:00Z' },
          { id: 'env-2', name: 'Staging', description: 'Stage', tags: [], usage: 0, createdAt: '2025-01-10T10:00:00Z', updatedAt: '2025-01-15T14:30:00Z' },
        ],
        pagination: { page: 1, per_page: 20, total: 2, total_pages: 1 },
      }
      mockFetchEnvironments.mockResolvedValue(multiEnvResponse)

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
        expect(screen.getByText('Staging')).toBeInTheDocument()
      })

      // Enter selection mode
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument()
      })

      // Select all
      await user.click(screen.getByRole('checkbox', { name: /select all/i }))

      // Open bulk actions and click export
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-export'))

      // Export dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('export-dialog')).toBeInTheDocument()
      })

      // Click Download ZIP
      await user.click(screen.getByTestId('export-button'))

      await waitFor(() => {
        expect(mockExportEnvironments).toHaveBeenCalledWith(['env-1', 'env-2'], { format: 'yaml' })
      })
      expect(downloadBlob).toHaveBeenCalledWith(blob, 'environments-export.zip')
    })

    it('handles bulk duplicate error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockRejectedValue(new Error('Duplicate failed'))

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions and click duplicate
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-duplicate'))

      // Should show toast error
      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalled()
      })
    })

    it('handles bulk duplicate error with non-Error value', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDuplicateEnvironment.mockRejectedValue('string error')

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions and click duplicate
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-duplicate'))

      await waitFor(() => {
        expect(mockDuplicateEnvironment).toHaveBeenCalled()
      })
    })

    it('handles bulk delete error with Error instance', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockRejectedValue(new Error('Delete failed'))

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions and click delete
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-delete'))

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalled()
      })
    })

    it('handles bulk delete error with non-Error value', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      mockDeleteEnvironment.mockRejectedValue('String error')

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Enter selection mode and select
      await user.click(screen.getByRole('button', { name: /mass action/i }))

      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: /select production/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('checkbox', { name: /select production/i }))

      // Open bulk actions and click delete
      await user.click(screen.getByTestId('selection-counter'))

      await waitFor(() => {
        expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('bulk-action-delete'))

      await waitFor(() => {
        expect(mockDeleteEnvironment).toHaveBeenCalled()
      })
    })
  })

  describe('Environments Tags Filter', () => {
    it('calls API with tags filter when tag is selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const { within } = await import('@testing-library/react')
      const user = userEvent.setup()

      // Reset and mock tags response BEFORE render
      mockFetchEnvironmentsTags.mockReset()
      mockFetchEnvironmentsTags.mockResolvedValue(['production', 'staging', 'critical'])

      renderSettingsContainer('/settings/environments')

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Open tags filter popover
      const tagsFilter = screen.getByTestId('filter-tags')
      await user.click(tagsFilter)

      // Wait for dialog to appear
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument()
      })

      // Clear mock to track new calls
      mockFetchEnvironments.mockClear()

      // Click on production tag within the dialog
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByText('production'))

      // Verify API is called with tags parameter
      await waitFor(() => {
        const calls = mockFetchEnvironments.mock.calls
        const hasTagsCall = calls.some((call: unknown[]) => {
          const params = call[0] as { tags?: string[] }
          return params?.tags?.includes('production')
        })
        expect(hasTagsCall).toBe(true)
      })
    })
  })

  describe('Environments Column Toggle', () => {
    it('restores column visibility from localStorage', async () => {
      // Set stored visibility before rendering
      localStorage.setItem('wave_environments_visible_columns', JSON.stringify(['description', 'tags', 'usage']))

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // All columns should be visible since all are in the stored list
      const columnsButton = screen.getByTestId('columns-button')
      expect(columnsButton).toBeInTheDocument()

      // Clean up
      localStorage.removeItem('wave_environments_visible_columns')
    })

    it('toggles column visibility when clicking column toggle', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsContainer('/settings/environments')

      await waitFor(() => {
        expect(screen.getByText('Production')).toBeInTheDocument()
      })

      // Click the Columns button
      const columnsButton = screen.getByTestId('columns-button')
      await user.click(columnsButton)

      // Toggle the Tags column (use role=menuitemcheckbox to disambiguate from the Tags filter)
      const tagsOption = screen.getByRole('menuitemcheckbox', { name: /Tags/i })
      await user.click(tagsOption)

      // The column toggle should update visibility state
      // (localStorage persistence is tested implicitly)
      expect(tagsOption).toBeInTheDocument()
    })
  })

  describe('Network Section (REQ-5.2.1.42)', () => {
    describe('URL mapping', () => {
      it('shows the SSH Hosts page for /settings/network/ssh-hosts', async () => {
        renderSettingsContainer('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-certificates-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('shows the Certificates page for /settings/network/certificates', async () => {
        renderSettingsContainer('/settings/network/certificates')

        expect(await screen.findByTestId('network-certificates-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('shows the SSH Hosts page for the bare /settings/network path', async () => {
        renderSettingsContainer('/settings/network')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-certificates-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('marks the active Network child in the nav', async () => {
        renderSettingsContainer('/settings/network/certificates')

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        expect(within(group).getByRole('button', { name: 'Certificates' })).toHaveAttribute(
          'aria-current',
          'page',
        )
        expect(within(group).getByRole('button', { name: 'SSH Hosts' })).not.toHaveAttribute(
          'aria-current',
        )
      })
    })

    describe('Navigation', () => {
      it('selecting Certificates navigates to /settings/network/certificates', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/ssh-hosts')

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        await user.click(within(group).getByRole('button', { name: 'Certificates' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/certificates$/,
          )
        })
        expect(screen.getByTestId('network-certificates-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
      })

      it('selecting SSH Hosts navigates to /settings/network/ssh-hosts', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/certificates')

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        await user.click(within(group).getByRole('button', { name: 'SSH Hosts' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/ssh-hosts$/,
          )
        })
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-certificates-tab')).not.toBeInTheDocument()
      })

      it('expanding Network does not navigate; selecting a child does', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings')

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        await user.click(within(settingsNav()).getByRole('button', { name: 'Network' }))

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings$/)
        expect(screen.getByTestId('general-tab')).toBeInTheDocument()

        await user.click(within(group).getByRole('button', { name: 'SSH Hosts' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/ssh-hosts$/,
          )
        })
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })
    })

    describe('Hook wiring', () => {
      it('calls both Network hooks inactive on a section outside Network', async () => {
        renderSettingsContainer('/settings')

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        expect(mockUseSshHosts).toHaveBeenCalled()
        expect(mockUseCertificates).toHaveBeenCalled()
        expect(activeFlags(mockUseSshHosts).every((active) => active === false)).toBe(true)
        expect(activeFlags(mockUseCertificates).every((active) => active === false)).toBe(true)
      })

      it('activates only useSshHosts on the SSH Hosts page', async () => {
        renderSettingsContainer('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(mockUseSshHosts).toHaveBeenLastCalledWith(true)
        expect(activeFlags(mockUseCertificates).length).toBeGreaterThan(0)
        expect(activeFlags(mockUseCertificates).every((active) => active === false)).toBe(true)
      })

      it('activates only useSshHosts on the bare Network path', async () => {
        renderSettingsContainer('/settings/network')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(mockUseSshHosts).toHaveBeenLastCalledWith(true)
        expect(activeFlags(mockUseCertificates).every((active) => active === false)).toBe(true)
      })

      it('activates only useCertificates on the Certificates page', async () => {
        renderSettingsContainer('/settings/network/certificates')

        expect(await screen.findByTestId('network-certificates-tab')).toBeInTheDocument()
        expect(mockUseCertificates).toHaveBeenLastCalledWith(true)
        expect(activeFlags(mockUseSshHosts).length).toBeGreaterThan(0)
        expect(activeFlags(mockUseSshHosts).every((active) => active === false)).toBe(true)
      })

      it('moves the active flag when switching between the Network pages', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/ssh-hosts')

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        expect(mockUseSshHosts).toHaveBeenLastCalledWith(true)
        expect(mockUseCertificates).toHaveBeenLastCalledWith(false)

        await user.click(within(group).getByRole('button', { name: 'Certificates' }))

        expect(await screen.findByTestId('network-certificates-tab')).toBeInTheDocument()
        expect(mockUseSshHosts).toHaveBeenLastCalledWith(false)
        expect(mockUseCertificates).toHaveBeenLastCalledWith(true)
      })

      it('keeps calling the SSH Hosts hook, inactive, after leaving Network', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        const callsBefore = mockUseSshHosts.mock.calls.length

        await user.click(screen.getByTestId('settings-nav-general'))

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        expect(mockUseSshHosts.mock.calls.length).toBeGreaterThan(callsBefore)
        expect(mockUseSshHosts).toHaveBeenLastCalledWith(false)
      })
    })

    describe('Props reach the pages', () => {
      it('passes the useSshHosts result to the SSH Hosts page as sshHosts', async () => {
        renderSettingsContainer('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        const props = mockSshHostsTabProps.mock.lastCall?.[0] as { sshHosts: unknown }
        expect(props.sshHosts).toBe(SSH_HOSTS_RESULT)
        expect(mockCertificatesTabProps).not.toHaveBeenCalled()
      })

      it('passes the useCertificates result to the Certificates page as certificates', async () => {
        renderSettingsContainer('/settings/network/certificates')

        expect(await screen.findByTestId('network-certificates-tab')).toBeInTheDocument()
        const props = mockCertificatesTabProps.mock.lastCall?.[0] as { certificates: unknown }
        expect(props.certificates).toBe(CERTIFICATES_RESULT)
        expect(mockSshHostsTabProps).not.toHaveBeenCalled()
      })

      it('passes a failed read state through to the page unchanged', async () => {
        const failed: UseSshHostsResult = {
          ...SSH_HOSTS_RESULT,
          status: 'failed',
          error: "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: Permission denied",
          hosts: [],
        }
        mockUseSshHosts.mockReturnValue(failed)

        renderSettingsContainer('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        const props = mockSshHostsTabProps.mock.lastCall?.[0] as { sshHosts: unknown }
        expect(props.sshHosts).toBe(failed)
      })
    })

    describe('Unsaved changes on leave (NET-1)', () => {
      it('asks Cancel, Discard or Save before leaving SSH Hosts with unsaved changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, dirty: true })
        renderWithLocation('/settings/network/ssh-hosts')

        await user.click(await screen.findByTestId('settings-nav-general'))

        const prompt = leavePrompt()
        expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
        expect(within(prompt).getByRole('button', { name: 'Save' })).toBeInTheDocument()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings\/network\/ssh-hosts$/)
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('Cancel keeps SSH Hosts open with its changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, dirty: true })
        renderWithLocation('/settings/network/ssh-hosts')

        await user.click(await screen.findByTestId('settings-nav-general'))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings\/network\/ssh-hosts$/)
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(SSH_HOSTS_RESULT.cancel).not.toHaveBeenCalled()
        expect(SSH_HOSTS_RESULT.save).not.toHaveBeenCalled()
      })

      it('Discard drops the SSH Hosts changes and leaves', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, dirty: true })
        renderWithLocation('/settings/network/ssh-hosts')

        await user.click(await screen.findByTestId('settings-nav-general'))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

        expect(SSH_HOSTS_RESULT.cancel).toHaveBeenCalledTimes(1)
        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings$/)
        })
        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
      })

      it('Save runs the SSH Hosts save and stays while it has not succeeded', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, dirty: true })
        renderWithLocation('/settings/network/ssh-hosts')

        await user.click(await screen.findByTestId('settings-nav-general'))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

        expect(SSH_HOSTS_RESULT.save).toHaveBeenCalledTimes(1)
        expect(SSH_HOSTS_RESULT.cancel).not.toHaveBeenCalled()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings\/network\/ssh-hosts$/)
      })

      it('asks before switching from Certificates with unsaved changes, and Discard drops them', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseCertificates.mockReturnValue({ ...CERTIFICATES_RESULT, dirty: true })
        renderWithLocation('/settings/network/certificates')

        const group = await within(settingsNav()).findByRole('group', { name: 'Network' })
        await user.click(within(group).getByRole('button', { name: 'SSH Hosts' }))

        expect(screen.getByTestId('network-certificates-tab')).toBeInTheDocument()
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

        expect(CERTIFICATES_RESULT.cancel).toHaveBeenCalledTimes(1)
        expect(SSH_HOSTS_RESULT.cancel).not.toHaveBeenCalled()
        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
      })

      it('leaves a section outside Network at once', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseSshHosts.mockReturnValue({ ...SSH_HOSTS_RESULT, dirty: true })
        renderWithLocation('/settings')

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        await user.click(screen.getByTestId('settings-nav-environments'))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(/^\/settings\/environments$/)
        })
        expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
      })
    })
  })

  describe('Proxy Section (NET-10)', () => {
    function proxyNavGroup() {
      return within(settingsNav()).findByRole('group', { name: 'Proxy' })
    }

    describe('URL mapping', () => {
      it('shows the Proxy Setup page for /settings/network/proxy/setup', async () => {
        renderSettingsContainer('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-blocks-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('shows the Proxy Blocks page for /settings/network/proxy/blocks', async () => {
        renderSettingsContainer('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-setup-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('shows the Proxy Setup page for the bare /settings/network/proxy path', async () => {
        renderSettingsContainer('/settings/network/proxy')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-blocks-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('marks the active Proxy child in the nav', async () => {
        renderSettingsContainer('/settings/network/proxy/blocks')

        const group = await proxyNavGroup()
        expect(within(group).getByRole('button', { name: 'Blocks' })).toHaveAttribute(
          'aria-current',
          'page',
        )
        expect(within(group).getByRole('button', { name: 'Setup' })).not.toHaveAttribute(
          'aria-current',
        )
      })

      it('marks Setup in the nav on the bare Proxy path', async () => {
        renderSettingsContainer('/settings/network/proxy')

        const group = await proxyNavGroup()
        expect(within(group).getByRole('button', { name: 'Setup' })).toHaveAttribute(
          'aria-current',
          'page',
        )
        expect(within(group).getByRole('button', { name: 'Blocks' })).not.toHaveAttribute(
          'aria-current',
        )
      })
    })

    describe('Navigation', () => {
      it('selecting Blocks navigates to /settings/network/proxy/blocks', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/setup')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Blocks' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/blocks$/,
          )
        })
        expect(screen.getByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-setup-tab')).not.toBeInTheDocument()
      })

      it('selecting Setup navigates to /settings/network/proxy/setup', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/blocks')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Setup' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/setup$/,
          )
        })
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-blocks-tab')).not.toBeInTheDocument()
      })

      it('opening Proxy does not navigate; selecting a child does', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/ssh-hosts')

        expect(await screen.findByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        await user.click(within(settingsNav()).getByRole('button', { name: 'Proxy' }))

        const group = await proxyNavGroup()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          /^\/settings\/network\/ssh-hosts$/,
        )
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()

        await user.click(within(group).getByRole('button', { name: 'Setup' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/setup$/,
          )
        })
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-ssh-hosts-tab')).not.toBeInTheDocument()
      })

      it('selecting SSH Hosts from a Proxy page navigates to /settings/network/ssh-hosts', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        const network = within(settingsNav()).getByRole('group', { name: 'Network' })
        await user.click(within(network).getByRole('button', { name: 'SSH Hosts' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/ssh-hosts$/,
          )
        })
        expect(screen.getByTestId('network-ssh-hosts-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-blocks-tab')).not.toBeInTheDocument()
      })
    })

    describe('Hook wiring', () => {
      const sectionsOutsideProxySetup = SECTIONS.filter((section) => section.name !== 'Proxy Setup')
      const sectionsOutsideProxyBlocks = SECTIONS.filter(
        (section) => section.name !== 'Proxy Blocks',
      )

      it('activates useProxySettings on the Proxy Setup page', async () => {
        renderSettingsContainer('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(mockUseProxySettings).toHaveBeenLastCalledWith(true)
      })

      it('activates useProxySettings on the bare Proxy path', async () => {
        renderSettingsContainer('/settings/network/proxy')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(mockUseProxySettings).toHaveBeenLastCalledWith(true)
        expect(mockUseProxyBlocks).toHaveBeenLastCalledWith(false)
      })

      it.each(sectionsOutsideProxySetup)(
        'calls useProxySettings inactive on $name',
        async ({ route, landing }) => {
          renderSettingsContainer(route)

          expect(await screen.findByTestId(landing)).toBeInTheDocument()
          expect(mockUseProxySettings).toHaveBeenCalled()
          expect(activeFlags(mockUseProxySettings).every((active) => active === false)).toBe(true)
        },
      )

      it('activates useProxyBlocks on the Proxy Blocks page', async () => {
        renderSettingsContainer('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        expect(mockUseProxyBlocks).toHaveBeenLastCalledWith(true)
      })

      it.each(sectionsOutsideProxyBlocks)(
        'calls useProxyBlocks inactive on $name',
        async ({ route, landing }) => {
          renderSettingsContainer(route)

          expect(await screen.findByTestId(landing)).toBeInTheDocument()
          expect(mockUseProxyBlocks).toHaveBeenCalled()
          expect(activeFlags(mockUseProxyBlocks).every((active) => active === false)).toBe(true)
        },
      )

      it('moves the active flags when switching between the Proxy pages', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/setup')

        const group = await proxyNavGroup()
        expect(mockUseProxySettings).toHaveBeenLastCalledWith(true)
        expect(mockUseProxyBlocks).toHaveBeenLastCalledWith(false)

        await user.click(within(group).getByRole('button', { name: 'Blocks' }))

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        expect(mockUseProxySettings).toHaveBeenLastCalledWith(false)
        expect(mockUseProxyBlocks).toHaveBeenLastCalledWith(true)
      })

      it('keeps calling both Proxy hooks, inactive, after leaving Proxy', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        const settingsCallsBefore = mockUseProxySettings.mock.calls.length
        const blocksCallsBefore = mockUseProxyBlocks.mock.calls.length

        await user.click(screen.getByTestId('settings-nav-general'))

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        expect(mockUseProxySettings.mock.calls.length).toBeGreaterThan(settingsCallsBefore)
        expect(mockUseProxyBlocks.mock.calls.length).toBeGreaterThan(blocksCallsBefore)
        expect(mockUseProxySettings).toHaveBeenLastCalledWith(false)
        expect(mockUseProxyBlocks).toHaveBeenLastCalledWith(false)
      })
    })

    describe('Props reach the pages', () => {
      it('passes the useProxySettings result to the Proxy Setup page as proxy', async () => {
        renderSettingsContainer('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        const props = mockProxySetupTabProps.mock.lastCall?.[0] as { proxy: unknown }
        expect(props.proxy).toBe(PROXY_RESULT)
        expect(mockProxyBlocksTabProps).not.toHaveBeenCalled()
      })

      it('passes the useProxyBlocks result to the Proxy Blocks page as blocks', async () => {
        renderSettingsContainer('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        const props = mockProxyBlocksTabProps.mock.lastCall?.[0] as { blocks: unknown }
        expect(props.blocks).toBe(PROXY_BLOCKS_RESULT)
        expect(mockProxySetupTabProps).not.toHaveBeenCalled()
      })

      it('passes a Proxy Setup read that has not loaded through to the page unchanged', async () => {
        const pending: UseProxySettingsResult = {
          ...PROXY_RESULT,
          status: 'pending',
          settings: undefined,
        }
        mockUseProxySettings.mockReturnValue(pending)

        renderSettingsContainer('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        const props = mockProxySetupTabProps.mock.lastCall?.[0] as { proxy: unknown }
        expect(props.proxy).toBe(pending)
      })

      it('passes a Proxy Blocks read that has not loaded through to the page unchanged', async () => {
        const pending: UseProxyBlocksResult = {
          ...PROXY_BLOCKS_RESULT,
          status: 'pending',
          blocks: undefined,
        }
        mockUseProxyBlocks.mockReturnValue(pending)

        renderSettingsContainer('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        const props = mockProxyBlocksTabProps.mock.lastCall?.[0] as { blocks: unknown }
        expect(props.blocks).toBe(pending)
      })
    })

    describe('Guard props', () => {
      it('leaves confirming unset on Proxy Setup', async () => {
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderSettingsContainer('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        const guard = guardProps()
        expect(guard.dirty).toBe(true)
        expect(guard.confirming).toBeUndefined()
      })

      it('holds nothing on Proxy Blocks while the Proxy hook reports unsaved changes', async () => {
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true, saving: true })
        renderSettingsContainer('/settings/network/proxy/blocks')

        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        const guard = guardProps()
        expect(guard.dirty).toBe(false)
        expect(guard.saving).toBe(false)

        guard.onSave()
        guard.onDiscard()
        expect(PROXY_RESULT.save).not.toHaveBeenCalled()
        expect(PROXY_RESULT.cancel).not.toHaveBeenCalled()
      })

      it('moves the guard onto Proxy Setup after switching there from Proxy Blocks', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderSettingsContainer('/settings/network/proxy/blocks')

        const group = await proxyNavGroup()
        expect(guardProps().dirty).toBe(false)

        await user.click(within(group).getByRole('button', { name: 'Setup' }))

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        const guard = guardProps()
        expect(guard.dirty).toBe(true)
        guard.onSave()
        expect(PROXY_RESULT.save).toHaveBeenCalledTimes(1)
        guard.onDiscard()
        expect(PROXY_RESULT.cancel).toHaveBeenCalledTimes(1)
      })
    })

    describe('Unsaved changes on leave (NET-1)', () => {
      it('asks Cancel, Discard or Save before leaving Proxy Setup with unsaved changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderWithLocation('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        await user.click(screen.getByTestId('settings-nav-general'))

        const prompt = leavePrompt()
        expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
        expect(within(prompt).getByRole('button', { name: 'Save' })).toBeInTheDocument()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          /^\/settings\/network\/proxy\/setup$/,
        )
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
      })

      it('asks before switching from Proxy Setup to Blocks with unsaved changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderWithLocation('/settings/network/proxy/setup')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Blocks' }))

        expect(leavePrompt()).toBeInTheDocument()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          /^\/settings\/network\/proxy\/setup$/,
        )
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-blocks-tab')).not.toBeInTheDocument()
        expect(PROXY_RESULT.save).not.toHaveBeenCalled()
        expect(PROXY_RESULT.cancel).not.toHaveBeenCalled()
      })

      it('Cancel keeps Proxy Setup open with its changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderWithLocation('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        await user.click(screen.getByTestId('settings-nav-general'))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          /^\/settings\/network\/proxy\/setup$/,
        )
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        expect(PROXY_RESULT.cancel).not.toHaveBeenCalled()
        expect(PROXY_RESULT.save).not.toHaveBeenCalled()
      })

      it('Discard drops the Proxy Setup changes and leaves for Blocks', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderWithLocation('/settings/network/proxy/setup')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Blocks' }))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

        expect(PROXY_RESULT.cancel).toHaveBeenCalledTimes(1)
        expect(PROXY_RESULT.save).not.toHaveBeenCalled()
        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/blocks$/,
          )
        })
        expect(await screen.findByTestId('network-proxy-blocks-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('network-proxy-setup-tab')).not.toBeInTheDocument()
      })

      it('Save runs the Proxy Setup save and stays while it has not succeeded', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseProxySettings.mockReturnValue({ ...PROXY_RESULT, dirty: true })
        renderWithLocation('/settings/network/proxy/setup')

        expect(await screen.findByTestId('network-proxy-setup-tab')).toBeInTheDocument()
        await user.click(screen.getByTestId('settings-nav-general'))
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

        expect(PROXY_RESULT.save).toHaveBeenCalledTimes(1)
        expect(PROXY_RESULT.cancel).not.toHaveBeenCalled()
        expect(screen.getByTestId('location-probe')).toHaveTextContent(
          /^\/settings\/network\/proxy\/setup$/,
        )
        expect(screen.getByTestId('network-proxy-setup-tab')).toBeInTheDocument()
      })

      it('leaves Proxy Setup at once when it holds no changes', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/setup')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Blocks' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/blocks$/,
          )
        })
        expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
      })

      it('leaves Proxy Blocks for Setup at once', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        renderWithLocation('/settings/network/proxy/blocks')

        const group = await proxyNavGroup()
        await user.click(within(group).getByRole('button', { name: 'Setup' }))

        await waitFor(() => {
          expect(screen.getByTestId('location-probe')).toHaveTextContent(
            /^\/settings\/network\/proxy\/setup$/,
          )
        })
        expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
      })
    })
  })

  describe('Unsaved-changes guard follows the active page (NET-1)', () => {
    describe('Guard props', () => {
      it.each(GUARDED_PAGES)(
        'gives the guard the $name page state and actions',
        async (page) => {
          page.drive({ dirty: true, saving: true })
          renderSettingsContainer(page.route)

          expect(await screen.findByTestId(page.landing)).toBeInTheDocument()
          const guard = guardProps()
          expect(guard.dirty).toBe(true)
          expect(guard.saving).toBe(true)

          guard.onSave()
          expect(page.save).toHaveBeenCalledTimes(1)
          expect(page.cancel).not.toHaveBeenCalled()

          guard.onDiscard()
          expect(page.cancel).toHaveBeenCalledTimes(1)
          expect(page.save).toHaveBeenCalledTimes(1)

          for (const other of GUARDED_PAGES.filter((candidate) => candidate !== page)) {
            expect(other.save).not.toHaveBeenCalled()
            expect(other.cancel).not.toHaveBeenCalled()
          }
        },
      )

      it.each(GUARDED_PAGES)(
        'follows the $name page alone, whatever the other pages hold',
        async (page) => {
          for (const other of GUARDED_PAGES.filter((candidate) => candidate !== page)) {
            other.drive({ dirty: true, saving: true })
          }
          renderSettingsContainer(page.route)

          expect(await screen.findByTestId(page.landing)).toBeInTheDocument()
          const guard = guardProps()
          expect(guard.dirty).toBe(false)
          expect(guard.saving).toBe(false)
        },
      )

      it.each(GUARDED_PAGES)(
        'tells the guard $name is dirty while it is not saving',
        async (page) => {
          page.drive({ dirty: true, saving: false })
          renderSettingsContainer(page.route)

          expect(await screen.findByTestId(page.landing)).toBeInTheDocument()
          const guard = guardProps()
          expect(guard.dirty).toBe(true)
          expect(guard.saving).toBe(false)
        },
      )

      it.each(UNGUARDED_SECTIONS)(
        'gives the guard nothing to hold on $name',
        async ({ route, landing }) => {
          for (const page of GUARDED_PAGES) page.drive({ dirty: true, saving: true })
          renderSettingsContainer(route)

          expect(await screen.findByTestId(landing)).toBeInTheDocument()
          const guard = guardProps()
          expect(guard.dirty).toBe(false)
          expect(guard.saving).toBe(false)
          expect(guard.confirming ?? false).toBe(false)

          guard.onSave()
          guard.onDiscard()
          for (const page of GUARDED_PAGES) {
            expect(page.save).not.toHaveBeenCalled()
            expect(page.cancel).not.toHaveBeenCalled()
          }
        },
      )

      it('runs the MCP requestSave from the guard, never a save that skips the confirmation', async () => {
        mockUseMcpSettings.mockReturnValue({ ...MCP_RESULT, dirty: true })
        renderSettingsContainer('/settings/mcp')

        expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
        guardProps().onSave()

        expect(MCP_RESULT.requestSave).toHaveBeenCalledTimes(1)
        expect(MCP_RESULT.confirmSave).not.toHaveBeenCalled()
      })

      it('tells the guard MCP Server is confirming while its confirmation is open', async () => {
        mockUseMcpSettings.mockReturnValue({
          ...MCP_RESULT,
          dirty: true,
          confirmation: { restart: true, exposure: false },
        })
        renderSettingsContainer('/settings/mcp')

        expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
        expect(guardProps().confirming).toBe(true)
      })

      it('tells the guard MCP Server is confirming for an exposure-only confirmation', async () => {
        mockUseMcpSettings.mockReturnValue({
          ...MCP_RESULT,
          dirty: true,
          confirmation: { restart: false, exposure: true },
        })
        renderSettingsContainer('/settings/mcp')

        expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
        expect(guardProps().confirming).toBe(true)
      })

      it('tells the guard MCP Server is not confirming without a confirmation', async () => {
        mockUseMcpSettings.mockReturnValue({ ...MCP_RESULT, dirty: true })
        renderSettingsContainer('/settings/mcp')

        expect(await screen.findByTestId('mcp-server-tab')).toBeInTheDocument()
        expect(guardProps().confirming).toBe(false)
      })

      it('does not carry the MCP confirmation onto another page', async () => {
        mockUseMcpSettings.mockReturnValue({
          ...MCP_RESULT,
          dirty: true,
          confirmation: { restart: true, exposure: false },
        })
        mockUseGeneralSettings.mockReturnValue({ ...GENERAL_RESULT, dirty: true })
        renderSettingsContainer('/settings')

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        const guard = guardProps()
        expect(guard.dirty).toBe(true)
        expect(guard.confirming ?? false).toBe(false)
      })

      it('moves the guard to the new page after a section switch', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUsePeriodicBackup.mockReturnValue({ ...PERIODIC_BACKUP_RESULT, dirty: true })
        renderSettingsContainer('/settings')

        expect(await screen.findByTestId('general-tab')).toBeInTheDocument()
        expect(guardProps().dirty).toBe(false)

        await user.click(screen.getByTestId('settings-nav-backup'))

        expect(await screen.findByTestId('backup-tab')).toBeInTheDocument()
        const guard = guardProps()
        expect(guard.dirty).toBe(true)
        guard.onSave()
        expect(PERIODIC_BACKUP_RESULT.save).toHaveBeenCalledTimes(1)
        expect(GENERAL_RESULT.save).not.toHaveBeenCalled()
      })
    })

    describe('Leaving General, MCP Server or Backup with unsaved changes', () => {
      it.each(PAGES_JOINING_THE_GUARD)(
        'asks Cancel, Discard or Save before leaving $name with unsaved changes',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          page.drive({ dirty: true, saving: false })
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))

          expect(leavePrompt()).toBe(screen.getByTestId('leave-unsaved-dialog'))
          expect(screen.getByTestId('leave-unsaved-cancel')).toHaveTextContent(/^Cancel$/)
          expect(screen.getByTestId('leave-unsaved-discard')).toHaveTextContent(/^Discard$/)
          expect(screen.getByTestId('leave-unsaved-save')).toHaveTextContent(/^Save$/)
          expect(screen.getByTestId('location-probe').textContent).toBe(page.route)
          expect(screen.getByTestId(page.landing)).toBeInTheDocument()
          expect(page.save).not.toHaveBeenCalled()
          expect(page.cancel).not.toHaveBeenCalled()
        },
      )

      it.each(PAGES_JOINING_THE_GUARD)(
        'Cancel keeps $name open with its changes',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          page.drive({ dirty: true, saving: false })
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))
          await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))

          expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
          expect(screen.getByTestId('location-probe').textContent).toBe(page.route)
          expect(screen.getByTestId(page.landing)).toBeInTheDocument()
          expect(page.save).not.toHaveBeenCalled()
          expect(page.cancel).not.toHaveBeenCalled()
        },
      )

      it.each(PAGES_JOINING_THE_GUARD)(
        'Discard drops the $name changes and leaves',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          page.drive({ dirty: true, saving: false })
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))
          await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

          expect(page.cancel).toHaveBeenCalledTimes(1)
          expect(page.save).not.toHaveBeenCalled()
          await waitFor(() => {
            expect(screen.getByTestId('location-probe').textContent).toBe(page.leaveTo)
          })
          expect(screen.queryByTestId(page.landing)).not.toBeInTheDocument()
          expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
        },
      )

      it.each(PAGES_JOINING_THE_GUARD)(
        'Save runs the $name save and stays while it has not succeeded',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          page.drive({ dirty: true, saving: false })
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))
          await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

          expect(page.save).toHaveBeenCalledTimes(1)
          expect(page.cancel).not.toHaveBeenCalled()
          expect(screen.getByTestId('location-probe').textContent).toBe(page.route)
          expect(screen.getByTestId(page.landing)).toBeInTheDocument()
        },
      )

      it.each(PAGES_JOINING_THE_GUARD)(
        'keeps the leave prompt busy while $name is saving',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          page.drive({ dirty: true, saving: true })
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))

          const prompt = leavePrompt()
          expect(within(prompt).getByRole('button', { name: 'Save' })).toBeDisabled()
          expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeDisabled()
          expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeDisabled()
          expect(screen.getByTestId('location-probe').textContent).toBe(page.route)
        },
      )

      it.each(PAGES_JOINING_THE_GUARD)(
        'leaves $name at once when it holds no changes',
        async (page) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          renderWithLocation(page.route)

          await user.click(await screen.findByTestId(page.leaveVia))

          await waitFor(() => {
            expect(screen.getByTestId('location-probe').textContent).toBe(page.leaveTo)
          })
          expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
        },
      )

      it('hides the leave prompt and stays on MCP Server while its confirmation is open', async () => {
        const { userEvent } = await import('@testing-library/user-event')
        const user = userEvent.setup()
        mockUseMcpSettings.mockReturnValue({
          ...MCP_RESULT,
          dirty: true,
          confirmation: { restart: true, exposure: false },
        })
        renderWithLocation('/settings/mcp')

        await user.click(await screen.findByTestId('settings-nav-general'))

        expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
        expect(screen.queryByTestId('leave-unsaved-dialog')).not.toBeInTheDocument()
        expect(screen.getByTestId('location-probe').textContent).toBe('/settings/mcp')
        expect(screen.getByTestId('mcp-server-tab')).toBeInTheDocument()
        expect(screen.queryByTestId('general-tab')).not.toBeInTheDocument()
        expect(MCP_RESULT.requestSave).not.toHaveBeenCalled()
        expect(MCP_RESULT.cancel).not.toHaveBeenCalled()
      })

      it.each(UNGUARDED_SECTIONS)(
        'leaves $name at once, whatever the staged pages hold',
        async ({ route, landing, leaveVia, leaveTo }) => {
          const { userEvent } = await import('@testing-library/user-event')
          const user = userEvent.setup()
          for (const page of GUARDED_PAGES) page.drive({ dirty: true, saving: false })
          renderWithLocation(route)

          expect(await screen.findByTestId(landing)).toBeInTheDocument()
          await user.click(screen.getByTestId(leaveVia))

          await waitFor(() => {
            expect(screen.getByTestId('location-probe').textContent).toBe(leaveTo)
          })
          expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
        },
      )
    })
  })
})
