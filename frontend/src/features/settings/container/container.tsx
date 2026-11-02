/**
 * Settings Container
 *
 * REQ-3.7.2.6: Log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * REQ-5.2.1.42: Settings and preferences screen
 *
 * Settings page with data fetching and state management.
 */

import { useCallback, useEffect, type ReactNode } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { SettingsPage as SettingsPageComponent } from '@/features/settings/page/page'
import { EnvironmentForm } from '@/features/settings/components/environment-form'
import { ExportDialog } from '@/components/shared/dialogs/export-dialog'
import { ImportDialog } from '@/components/shared/dialogs/import-dialog'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { UnsavedChangesNavigationGuard } from '@/components/shared/unsaved-changes-navigation-guard'
import { useFailureToast } from '@/hooks/use-failure-toast'
import { validateEnvironmentImport, importEnvironments } from '@/features/settings/api/environments/import-export'
import {
  isNetworkSection,
  isProxySection,
  type SettingsSection,
} from '@/features/settings/components/settings-nav'
import { useEnvironmentsState } from './use-environments-state'
import { useGeneralSettings } from './use-general-settings'
import { useMcpSettings } from './use-mcp-settings'
import { usePeriodicBackup } from './use-periodic-backup'
import { useServerSessions } from './use-server-sessions'
import { useSystemInfo } from './use-system-info'
import { useSshHosts } from '@/features/settings/container/use-ssh-hosts'
import { useCertificates } from '@/features/settings/container/use-certificates'
import { useProxySettings } from '@/features/settings/container/use-proxy-settings'
import { useProxyBlocks } from '@/features/settings/container/use-proxy-blocks'

interface GuardedPage {
  dirty: boolean
  saving: boolean
  save: () => void
  cancel: () => void
  confirming?: boolean
}

type GuardedSection =
  | 'general'
  | 'network-ssh-hosts'
  | 'network-certificates'
  | 'network-proxy-setup'
  | 'mcp'
  | 'backup'

type GuardedPages = Record<GuardedSection, GuardedPage>

const NOOP = (): void => {}
const UNGUARDED: GuardedPage = { dirty: false, saving: false, save: NOOP, cancel: NOOP }

/** The staged page the unsaved-changes guard follows; a section without staged edits holds nothing (NET-1). */
function guardedPage(section: SettingsSection, pages: GuardedPages): GuardedPage {
  switch (section) {
    case 'general':
    case 'network-ssh-hosts':
    case 'network-certificates':
    case 'network-proxy-setup':
    case 'mcp':
    case 'backup':
      return pages[section]
    default:
      return UNGUARDED
  }
}

/** /settings for General, /settings/network/{page} or /settings/network/proxy/{page} for a Network page, /settings/{section} otherwise. */
function settingsPath(section: SettingsSection): string {
  if (section === 'general') return '/settings'
  if (isProxySection(section)) {
    return `/settings/network/proxy/${section.slice('network-proxy-'.length)}`
  }
  if (isNetworkSection(section)) return `/settings/network/${section.slice('network-'.length)}`
  return `/settings/${section}`
}

function sectionFromPath(path: string): SettingsSection {
  if (path.includes('/settings/network/certificates')) return 'network-certificates'
  if (path.includes('/settings/network/proxy/blocks')) return 'network-proxy-blocks'
  // The bare Proxy path opens Setup, as the bare Network path opens SSH Hosts.
  if (path.includes('/settings/network/proxy')) return 'network-proxy-setup'
  if (path.includes('/settings/network')) return 'network-ssh-hosts'
  if (path.includes('/settings/environments')) return 'environments'
  if (path.includes('/settings/variables')) return 'variables'
  if (path.includes('/settings/mcp')) return 'mcp'
  if (path.includes('/settings/server')) return 'server'
  if (path.includes('/settings/backup')) return 'backup'
  if (path.includes('/settings/about')) return 'about'
  return 'general'
}

/**
 * SettingsPage - Connected settings page with state management
 */
export function SettingsContainer(): ReactNode {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  // Workbench "See connection" deep-link: /settings/mcp?session=<id> (assistant)
  // or /settings/server?session=<id> (person). One shared query param.
  const targetSessionId = searchParams.get('session') ?? undefined

  // The URL alone picks the section, so a navigation the unsaved-changes guard holds back never switches the page.
  const activeSection = sectionFromPath(location.pathname)

  // Each section reads only while it is showing, so an unseen section cannot block the page.
  const envState = useEnvironmentsState(activeSection === 'environments')
  const sysState = useSystemInfo()
  const serverState = useServerSessions(activeSection === 'server')
  // The staged pages run on every render; one with staged edits is left only through Save or Discard (SETTINGS-18).
  const general = useGeneralSettings(activeSection === 'general')
  const sshHosts = useSshHosts(activeSection === 'network-ssh-hosts')
  const certificates = useCertificates(activeSection === 'network-certificates')
  const proxy = useProxySettings(activeSection === 'network-proxy-setup')
  // Proxy Blocks only reads, so it holds nothing to save and joins no guard.
  const proxyBlocks = useProxyBlocks(activeSection === 'network-proxy-blocks')
  const mcpState = useMcpSettings(activeSection === 'mcp')
  const periodicBackup = usePeriodicBackup(activeSection === 'backup')
  const guarded = guardedPage(activeSection, {
    general,
    'network-ssh-hosts': sshHosts,
    'network-certificates': certificates,
    'network-proxy-setup': proxy,
    // Save goes through the page's own confirmation (MCP-5, MCP-6).
    mcp: {
      dirty: mcpState.dirty,
      saving: mcpState.saving,
      save: mcpState.requestSave,
      cancel: mcpState.cancel,
      confirming: mcpState.confirmation !== undefined,
    },
    backup: periodicBackup,
  })

  // Each section's reads report on the section itself; a rejection that got
  // past them has nowhere else to show, so it lands in a toast.
  const { report, run } = useFailureToast('Something Went Wrong')

  // Load data on mount and section change
  useEffect(() => {
    if (activeSection === 'environments') {
      envState.loadEnvironments().catch(report)
    } else if (activeSection === 'about') {
      sysState.loadSystemInfo().catch(report)
    }
  }, [activeSection, envState.loadEnvironments, report, sysState.loadSystemInfo])

  // Handlers
  const handleSectionChange = useCallback(
    (section: SettingsSection) => {
      navigate(settingsPath(section))
    },
    [navigate]
  )

  return (
    <>
      <UnsavedChangesNavigationGuard
        dirty={guarded.dirty}
        saving={guarded.saving}
        onSave={guarded.save}
        onDiscard={guarded.cancel}
        confirming={guarded.confirming}
      />
      <SettingsPageComponent
        environments={envState.environments}
        environmentsPageInfo={envState.environmentsPageInfo}
        environmentsLoading={envState.environmentsLoading}
        environmentsSettled={envState.environmentsSettled}
        environmentsError={envState.environmentsError}
        environmentsSorting={envState.environmentsSorting}
        onEnvironmentsSortingChange={envState.handleEnvironmentsSortingChange}
        environmentsSearchQuery={envState.environmentsSearchQuery}
        environmentsTagsFilter={envState.environmentsTagsFilter}
        allEnvironmentTags={envState.allEnvironmentTags}
        systemInfo={sysState.systemInfo}
        systemInfoLoading={sysState.systemInfoLoading}
        systemInfoError={sysState.systemInfoError}
        general={general}
        periodicBackup={periodicBackup}
        mcpSettings={mcpState.settings}
        mcpStatus={mcpState.status}
        mcpReadStatus={mcpState.readStatus}
        mcpError={mcpState.error}
        mcpStatusError={mcpState.statusError}
        mcpStaged={mcpState.staged}
        mcpDirty={mcpState.dirty}
        mcpSaving={mcpState.saving}
        mcpConfirmation={mcpState.confirmation}
        onMcpStageChange={mcpState.stageChange}
        onMcpCancel={mcpState.cancel}
        onMcpSave={mcpState.requestSave}
        onMcpConfirmSave={mcpState.confirmSave}
        onMcpDismissConfirmation={mcpState.dismissConfirmation}
        onMcpDisconnectSession={mcpState.disconnectSession}
        onMcpRetry={mcpState.retry}
        mcpTargetSessionId={targetSessionId}
        serverStatus={serverState.status}
        serverLoading={serverState.loading}
        serverError={serverState.error}
        onServerRetry={run(serverState.retry)}
        onServerDisconnect={run(serverState.disconnect)}
        onServerDisconnectOthers={run(serverState.disconnectOthers)}
        onServerDisconnectAll={run(serverState.disconnectAll)}
        serverTargetSessionId={targetSessionId}
        sshHosts={sshHosts}
        certificates={certificates}
        proxy={proxy}
        proxyBlocks={proxyBlocks}
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        onCreateEnvironment={envState.handleCreateEnvironment}
        onEditEnvironment={envState.handleEditEnvironment}
        onDeleteEnvironment={envState.handleDeleteEnvironment}
        onDuplicateEnvironment={run(envState.handleDuplicateEnvironment)}
        onEnvironmentsPageChange={envState.handleEnvironmentsPageChange}
        onEnvironmentsPageSizeChange={envState.handleEnvironmentsPageSizeChange}
        onEnvironmentsSearch={envState.handleEnvironmentsSearch}
        onEnvironmentsTagsFilterChange={envState.handleEnvironmentsTagsFilterChange}
        environmentsColumnVisibility={envState.columnVisibility}
        onEnvironmentsColumnVisibilityChange={envState.handleColumnVisibilityChange}
        environmentsVisibleColumns={envState.visibleColumns}
        onEnvironmentsColumnToggle={envState.handleColumnToggle}
        onEnvironmentsRetry={run(envState.loadEnvironments)}
        onSystemInfoRetry={run(sysState.loadSystemInfo)}
        onExportEnvironment={envState.handleExportEnvironment}
        onImport={envState.handleImportOpen}
        selectedIds={envState.selectedIds}
        selectionModeActive={envState.selectionModeActive}
        onBulkExport={envState.handleBulkExport}
        onBulkDuplicate={run(envState.handleBulkDuplicate)}
        onBulkDelete={run(envState.handleBulkDelete)}
        onEnterSelectionMode={envState.handleEnterSelectionMode}
        onExitSelectionMode={envState.handleExitSelectionMode}
        onSelectionChange={envState.handleSelectionChange}
      />

      {/* Environment Form Dialog */}
      <EnvironmentForm
        open={envState.formOpen}
        mode={envState.formMode}
        environment={envState.formEnvironment}
        allTags={envState.allEnvironmentTags}
        onClose={() => envState.setFormOpen(false)}
        onSubmit={run(envState.handleFormSubmit)}
        loading={envState.formLoading}
        error={envState.formError}
      />

      {/* Export Dialog */}
      <ExportDialog
        open={envState.exportDialogOpen}
        onOpenChange={envState.setExportDialogOpen}
        entityIds={envState.exportEnvIds}
        entityNames={envState.exportEnvNames}
        entityLabel="Environment"
        hasSecrets={false}
        onExport={run(envState.handleExportAction)}
        loading={envState.exportLoading}
      />

      {/* Import Dialog */}
      <ImportDialog
        open={envState.importDialogOpen}
        onOpenChange={envState.setImportDialogOpen}
        entityLabel="Environment"
        onValidate={validateEnvironmentImport}
        onImport={importEnvironments}
        onImportComplete={envState.handleImportComplete}
      />

      {/* Delete Environment Confirmation */}
      {envState.envToDelete && (
        (() => {
          const env = envState.envToDelete
          const inUse = env.usage > 0
          const profileWord = env.usage === 1 ? 'profile' : 'profiles'
          const description = inUse
            ? `This environment is currently used by ${env.usage} ${profileWord}. Deleting it will permanently remove the per-environment values stored in those profiles. This cannot be undone.`
            : `This will permanently delete the "${env.name}" environment. This cannot be undone.`
          return (
            <ConfirmationDialog
              isOpen
              variant="delete"
              title={`Delete environment "${env.name}"?`}
              description={description}
              itemName={env.name}
              requireConfirmation={inUse ? env.name : undefined}
              isLoading={envState.deleteLoading}
              onClose={envState.cancelDeleteEnvironment}
              onConfirm={run(envState.confirmDeleteEnvironment)}
            />
          )
        })()
      )}
    </>
  )
}
