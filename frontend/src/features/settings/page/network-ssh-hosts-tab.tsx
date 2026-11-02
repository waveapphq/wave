/**
 * Settings > Network > SSH Hosts (REQ-4.5.14, NET-1..NET-4): the host key policy and
 * WAVE's trusted hosts list, every edit staged until Save.
 */

import { useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import { HostKeyPolicySection } from '@/features/settings/components/network/host-key-policy-section'
import { TrustedHostsTable } from '@/features/settings/components/network/trusted-hosts-table'
import { AddHostsDialog } from '@/features/settings/components/network/add-hosts-dialog'
import type { UseSshHostsResult } from '@/features/settings/container/use-ssh-hosts'

// Same viewport-filling frame as the list pages: the table takes the rest and its pagination sits at the bottom.
const PAGE_CLASS = 'flex h-full flex-col gap-6 overflow-hidden'
const POLICY_TITLE = 'Host Key Policy'
const SKELETON_ROWS = ['lock', 'default-action'] as const

export interface NetworkSshHostsTabProps {
  sshHosts: UseSshHostsResult
}

export function NetworkSshHostsTab({ sshHosts }: Readonly<NetworkSshHostsTabProps>) {
  const [addOpen, setAddOpen] = useState(false)

  if (sshHosts.status === 'failed') {
    return (
      <div data-testid="network-ssh-hosts-tab" className={PAGE_CLASS}>
        <SettingsSectionHeader title={POLICY_TITLE} />
        <SectionError message={sshHosts.error ?? ''} onRetry={sshHosts.retry} />
      </div>
    )
  }

  const loaded = sshHosts.status === 'loaded'
  return (
    <div data-testid="network-ssh-hosts-tab" className={PAGE_CLASS}>
      <section className="space-y-4">
        {/* Cancel and Save appear once the first read has loaded. */}
        <SettingsSectionHeader
          title={POLICY_TITLE}
          dirty={sshHosts.dirty}
          saving={sshHosts.saving}
          onCancel={loaded ? sshHosts.cancel : undefined}
          onSave={loaded ? sshHosts.save : undefined}
        />
        {loaded ? (
          <HostKeyPolicySection
            policy={sshHosts.policy}
            onChange={sshHosts.setPolicy}
            disabled={sshHosts.saving}
          />
        ) : (
          <SettingsRowGroup.Skeleton
            data-testid="host-key-policy-skeleton"
            rows={SKELETON_ROWS}
            help
            controlClassName="h-9 w-52"
          />
        )}
      </section>
      <Separator />
      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <SettingsSectionHeader title="Trusted SSH Hosts" />
        <TrustedHostsTable
          hosts={sshHosts.hosts}
          loading={!loaded}
          disabled={!loaded || sshHosts.saving}
          onAdd={() => setAddOpen(true)}
          onRemove={sshHosts.removeHosts}
        />
      </section>
      <AddHostsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        stagedHosts={sshHosts.hosts}
        onAdd={sshHosts.addHosts}
      />
    </div>
  )
}
