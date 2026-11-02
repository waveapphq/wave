/**
 * SettingsPage Component
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * REQ-5.2.1.42: Settings and preferences screen (user preferences, system configuration)
 *
 * Two-column layout with section navigation and content:
 * - SETTINGS-1: Two-column: section nav (240px) + content
 * - SETTINGS-2: Sections: General, Environments, Variables, Network (SSH Hosts, Certificates, Proxy Setup, Proxy Blocks), MCP Server, WAVE Server, Backup, About
 * - SETTINGS-4: "Settings" above section nav
 * - SETTINGS-5: One divider line in the theme border color
 * - SETTINGS-14: General: Logging, Time Zone, Secret Masking
 */

import { cn } from '@/lib/utils'
import { SettingsNav, type SettingsSection } from '@/features/settings/components/settings-nav'
import { AboutTab } from '@/features/settings/components/about-tab'
import { BackupRestoreTab } from '@/features/settings/components/backup-restore-tab/tab'
import { SystemVariablesTab } from '@/features/settings/components/global-variables-tab'
import type { McpSettings, McpStatus } from '@/features/settings/api/mcp'
import type { ServerStatus } from '@/features/settings/api/sessions'
import type { SystemInfo } from '@/features/settings/api/system-info'
import type { McpSaveConfirmation, McpStagedSettings } from './mcp-server-tab'
import type { PageReadStatus } from '@/features/settings/container/use-activation-read'
import type { UseGeneralSettingsResult } from '@/features/settings/container/use-general-settings'
import type { UsePeriodicBackupResult } from '@/features/settings/container/use-periodic-backup'
import type { UseSshHostsResult } from '@/features/settings/container/use-ssh-hosts'
import type { UseCertificatesResult } from '@/features/settings/container/use-certificates'
import type { UseProxySettingsResult } from '@/features/settings/container/use-proxy-settings'
import type { UseProxyBlocksResult } from '@/features/settings/container/use-proxy-blocks'
import type { OnChangeFn, SortingState, VisibilityState } from '@tanstack/react-table'
import type { EnvironmentListItem } from '@/features/settings/components/environments-columns'
import type { PageInfo } from '@/components/shared/tables/table-utils'
import { GeneralTab } from './general-tab'
import { EnvironmentsTab } from './environments-tab'
import { McpServerTab } from './mcp-server-tab'
import { WaveServerTab } from './wave-server-tab'
import { NetworkSshHostsTab } from '@/features/settings/page/network-ssh-hosts-tab'
import { NetworkCertificatesTab } from '@/features/settings/page/network-certificates-tab'
import { NetworkProxySetupTab } from '@/features/settings/page/network-proxy-setup-tab'
import { NetworkProxyBlocksTab } from '@/features/settings/page/network-proxy-blocks-tab'

export type { SettingsSection } from '@/features/settings/components/settings-nav'

const NOOP = (): void => {}

export interface SettingsPageProps {
  environments: EnvironmentListItem[]
  environmentsPageInfo: PageInfo
  environmentsLoading: boolean
  /** False until the first environments read has finished. */
  environmentsSettled: boolean
  environmentsError?: string
  environmentsSorting?: SortingState
  onEnvironmentsSortingChange?: OnChangeFn<SortingState>
  environmentsColumnVisibility?: VisibilityState
  onEnvironmentsColumnVisibilityChange?: OnChangeFn<VisibilityState>
  environmentsVisibleColumns?: string[]
  onEnvironmentsColumnToggle?: (columnId: string, visible: boolean) => void
  environmentsSearchQuery?: string
  environmentsTagsFilter?: string[]
  allEnvironmentTags?: string[]
  systemInfo?: SystemInfo
  systemInfoLoading: boolean
  systemInfoError?: string
  // General and the Backup schedule; the container provides each page's state.
  general: UseGeneralSettingsResult
  periodicBackup: UsePeriodicBackupResult
  mcpSettings?: McpSettings
  mcpStatus?: McpStatus
  mcpReadStatus: PageReadStatus
  mcpError?: string
  mcpStatusError?: string
  mcpStaged: McpStagedSettings
  mcpDirty: boolean
  mcpSaving: boolean
  mcpConfirmation?: McpSaveConfirmation
  onMcpStageChange: (field: keyof McpStagedSettings, value: string | boolean) => void
  onMcpCancel: () => void
  onMcpSave: () => void
  onMcpConfirmSave: () => void
  onMcpDismissConfirmation: () => void
  onMcpDisconnectSession: (sessionId: string) => void
  onMcpRetry: () => void
  /** Session to highlight in the MCP tab (workbench "See connection" deep-link). */
  mcpTargetSessionId?: string
  // WAVE Server section (browser-session roster); container provides these when active.
  serverStatus?: ServerStatus
  serverLoading?: boolean
  serverError?: string
  onServerRetry?: () => void
  onServerDisconnect?: (sessionId: string) => void
  onServerDisconnectOthers?: () => void
  onServerDisconnectAll?: () => void
  /** Session to highlight in the WAVE Server tab (person "See connection" deep-link). */
  serverTargetSessionId?: string
  // Network pages; the container provides each page's state.
  sshHosts?: UseSshHostsResult
  certificates?: UseCertificatesResult
  proxy?: UseProxySettingsResult
  proxyBlocks?: UseProxyBlocksResult
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onCreateEnvironment: () => void
  onEditEnvironment: (id: string) => void
  onDeleteEnvironment: (id: string) => void
  onDuplicateEnvironment: (id: string) => void
  onEnvironmentsPageChange: (page: number) => void
  onEnvironmentsPageSizeChange: (pageSize: number) => void
  onEnvironmentsSearch: (query: string) => void
  onEnvironmentsTagsFilterChange?: (tags: string[]) => void
  onEnvironmentsRetry: () => void
  onSystemInfoRetry: () => void
  // Export/Import
  onExportEnvironment?: (id: string) => void
  onImport?: () => void
  // Selection / bulk actions
  selectedIds?: string[]
  selectionModeActive?: boolean
  onBulkExport?: () => void
  onBulkDuplicate?: () => void
  onBulkDelete?: () => void
  onEnterSelectionMode?: () => void
  onExitSelectionMode?: () => void
  onSelectionChange?: (ids: string[]) => void
  className?: string
}

export function SettingsPage({
  environments,
  environmentsPageInfo,
  environmentsLoading,
  environmentsSettled,
  environmentsError,
  environmentsSorting,
  onEnvironmentsSortingChange,
  environmentsColumnVisibility,
  onEnvironmentsColumnVisibilityChange,
  environmentsVisibleColumns,
  onEnvironmentsColumnToggle,
  environmentsSearchQuery,
  environmentsTagsFilter,
  allEnvironmentTags,
  systemInfo,
  systemInfoLoading,
  systemInfoError,
  general,
  periodicBackup,
  mcpSettings,
  mcpStatus,
  mcpReadStatus,
  mcpError,
  mcpStatusError,
  mcpStaged,
  mcpDirty,
  mcpSaving,
  mcpConfirmation,
  onMcpStageChange,
  onMcpCancel,
  onMcpSave,
  onMcpConfirmSave,
  onMcpDismissConfirmation,
  onMcpDisconnectSession,
  onMcpRetry,
  mcpTargetSessionId,
  serverStatus,
  serverLoading,
  serverError,
  onServerRetry,
  onServerDisconnect,
  onServerDisconnectOthers,
  onServerDisconnectAll,
  serverTargetSessionId,
  sshHosts,
  certificates,
  proxy,
  proxyBlocks,
  activeSection,
  onSectionChange,
  onCreateEnvironment,
  onEditEnvironment,
  onDeleteEnvironment,
  onDuplicateEnvironment,
  onEnvironmentsPageChange,
  onEnvironmentsPageSizeChange,
  onEnvironmentsSearch,
  onEnvironmentsTagsFilterChange,
  onEnvironmentsRetry,
  onSystemInfoRetry,
  onExportEnvironment,
  onImport,
  selectedIds,
  selectionModeActive,
  onBulkExport,
  onBulkDuplicate,
  onBulkDelete,
  onEnterSelectionMode,
  onExitSelectionMode,
  onSelectionChange,
  className,
}: Readonly<SettingsPageProps>) {
  const generalPending = activeSection === 'general' && general.status === 'pending'
  const isLoading = environmentsLoading || systemInfoLoading || generalPending

  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return <GeneralTab general={general} />

      case 'environments':
        return (
          <EnvironmentsTab
            environments={environments}
            pageInfo={environmentsPageInfo}
            loading={environmentsLoading}
            settled={environmentsSettled}
            error={environmentsError}
            sorting={environmentsSorting}
            onSortingChange={onEnvironmentsSortingChange}
            columnVisibility={environmentsColumnVisibility}
            onColumnVisibilityChange={onEnvironmentsColumnVisibilityChange}
            visibleColumns={environmentsVisibleColumns}
            onColumnToggle={onEnvironmentsColumnToggle}
            searchQuery={environmentsSearchQuery}
            tagsFilter={environmentsTagsFilter}
            allTags={allEnvironmentTags}
            onEdit={onEditEnvironment}
            onDelete={onDeleteEnvironment}
            onDuplicate={onDuplicateEnvironment}
            onExport={onExportEnvironment}
            onCreate={onCreateEnvironment}
            onImport={onImport}
            onPageChange={onEnvironmentsPageChange}
            onPageSizeChange={onEnvironmentsPageSizeChange}
            onSearch={onEnvironmentsSearch}
            onTagsFilterChange={onEnvironmentsTagsFilterChange}
            onRetry={onEnvironmentsRetry}
            selectedIds={selectedIds}
            selectionModeActive={selectionModeActive}
            onBulkExport={onBulkExport}
            onBulkDuplicate={onBulkDuplicate}
            onBulkDelete={onBulkDelete}
            onEnterSelectionMode={onEnterSelectionMode}
            onExitSelectionMode={onExitSelectionMode}
            onSelectionChange={onSelectionChange}
          />
        )

      case 'variables':
        return <SystemVariablesTab />

      case 'network-ssh-hosts':
        return sshHosts && <NetworkSshHostsTab sshHosts={sshHosts} />

      case 'network-certificates':
        return certificates && <NetworkCertificatesTab certificates={certificates} />

      case 'network-proxy-setup':
        return proxy && <NetworkProxySetupTab proxy={proxy} />

      case 'network-proxy-blocks':
        return proxyBlocks && <NetworkProxyBlocksTab blocks={proxyBlocks} />

      case 'mcp':
        return (
          <McpServerTab
            settings={mcpSettings}
            status={mcpStatus}
            readStatus={mcpReadStatus}
            error={mcpError}
            statusError={mcpStatusError}
            staged={mcpStaged}
            dirty={mcpDirty}
            saving={mcpSaving}
            confirmation={mcpConfirmation}
            onStageChange={onMcpStageChange}
            onCancel={onMcpCancel}
            onSave={onMcpSave}
            onConfirmSave={onMcpConfirmSave}
            onDismissConfirmation={onMcpDismissConfirmation}
            onDisconnectSession={onMcpDisconnectSession}
            onRetry={onMcpRetry}
            targetSessionId={mcpTargetSessionId}
          />
        )

      case 'server':
        return (
          <WaveServerTab
            status={serverStatus}
            loading={serverLoading ?? false}
            error={serverError}
            onRetry={onServerRetry ?? NOOP}
            onDisconnect={onServerDisconnect ?? NOOP}
            onDisconnectOthers={onServerDisconnectOthers ?? NOOP}
            onDisconnectAll={onServerDisconnectAll ?? NOOP}
            targetSessionId={serverTargetSessionId}
          />
        )

      case 'backup':
        return <BackupRestoreTab periodicBackup={periodicBackup} />

      case 'about':
        return (
          <AboutTab
            systemInfo={systemInfo}
            loading={systemInfoLoading}
            error={systemInfoError}
            onRetry={onSystemInfoRetry}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      data-testid="settings-page"
      aria-busy={isLoading}
      className={cn('h-full overflow-hidden flex flex-col', className)}
    >
      {/* Page Title */}
      <div className="px-6 py-4 border-b">
        <h1 className="text-2xl font-semibold">Settings</h1>
      </div>

      {/* Two-Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Navigation Column */}
        <nav
          data-testid="settings-nav"
          aria-label="Settings sections"
          className="w-60 flex-shrink-0 overflow-y-auto p-4"
        >
          <SettingsNav
            activeSection={activeSection}
            onSectionChange={onSectionChange}
          />
        </nav>

        {/* SETTINGS-5: the one line between the columns, in the theme border color. */}
        <div data-testid="settings-divider" className="shrink-0 border-r" aria-hidden="true" />

        {/* Content Column */}
        <div
          data-testid="settings-content"
          className="flex-1 overflow-y-auto p-6"
        >
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
