/**
 * Settings > Network > Proxy > Blocks (REQ-4.7.14, NET-10): which blocks use the proxy,
 * which do not and which it does not apply to. Read-only.
 */

import { ProxyBlockLists } from '@/features/settings/components/network/proxy-block-lists'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import type { UseProxyBlocksResult } from '@/features/settings/container/use-proxy-blocks'

const PAGE_CLASS = 'space-y-4'
const TITLE = 'Proxy Blocks'
const SKELETON_ROWS = ['section'] as const

export interface NetworkProxyBlocksTabProps {
  blocks: UseProxyBlocksResult
}

export function NetworkProxyBlocksTab({ blocks: read }: Readonly<NetworkProxyBlocksTabProps>) {
  if (read.status === 'failed') {
    return (
      <div data-testid="network-proxy-blocks-tab" className={PAGE_CLASS}>
        <SettingsSectionHeader title={TITLE} />
        <SectionError message={read.error ?? ''} onRetry={read.retry} />
      </div>
    )
  }

  const { blocks } = read
  return (
    <div data-testid="network-proxy-blocks-tab" className={PAGE_CLASS}>
      <SettingsSectionHeader title={TITLE} />
      {read.status === 'loaded' && blocks !== undefined ? (
        <ProxyBlockLists blocks={blocks} />
      ) : (
        <SettingsRowGroup.Skeleton
          data-testid="proxy-blocks-skeleton"
          rows={SKELETON_ROWS}
          help={false}
          controlClassName="h-4 w-4"
        />
      )}
    </div>
  )
}
