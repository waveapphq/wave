/**
 * WAVE Host's Store summary: the store WAVE reads, as lock-marked facts (NET-6).
 */

import type { CertificateSettings } from '@/features/settings/api/certificates'
import { ReadOnlyFact } from '@/features/settings/components/read-only-fact'

export interface HostStoreSummaryProps {
  store: CertificateSettings['host_store']
}

export function HostStoreSummary({ store }: Readonly<HostStoreSummaryProps>) {
  return (
    <div className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
      {store.path === null ? (
        <p>No certificate store found on this WAVE host</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <ReadOnlyFact label="Store" value={store.path} />
          <ReadOnlyFact label="Certificates" value={String(store.count)} />
          {store.last_changed !== null && <ReadOnlyFact label="Last changed" value={store.last_changed} />}
        </div>
      )}
    </div>
  )
}
