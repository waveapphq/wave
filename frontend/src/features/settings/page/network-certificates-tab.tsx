/**
 * Settings > Network > Certificates (REQ-4.5.16; NET-5..NET-9): the public
 * authorities choice, the built-in list or the WAVE host's store, and the
 * staged Additional Certificates, written together on Save.
 */

import { useCallback, useMemo, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import type { CertificateDetail, StagedCertificateRow } from '@/features/settings/api/certificates'
import { AddCertificateDialog } from '@/features/settings/components/network/add-certificate-dialog'
import { AdditionalCertificatesTable } from '@/features/settings/components/network/additional-certificates-table'
import { BuiltInAuthoritiesTable } from '@/features/settings/components/network/built-in-authorities-table'
import { CertificateDialog } from '@/features/settings/components/network/certificate-dialog'
import { HostStoreSummary } from '@/features/settings/components/network/host-store-summary'
import {
  PublicAuthoritiesChoice,
  PublicAuthoritiesSkeleton,
} from '@/features/settings/components/network/public-authorities-choice'
import { SectionError } from '@/features/settings/components/section-error'
import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'
import type { UseCertificatesResult } from '@/features/settings/container/use-certificates'

const PAGE_TITLE = 'Public Certificate Authorities'
const SECTION_TITLE_CLASS = 'mb-4 text-lg font-semibold'

export interface NetworkCertificatesTabProps {
  certificates: UseCertificatesResult
}

/** The certificate the detail dialog shows; a staged row carries its detail. */
interface Viewing {
  id: string
  name?: string
  detail?: CertificateDetail
}

export function NetworkCertificatesTab({ certificates }: Readonly<NetworkCertificatesTabProps>) {
  const {
    status,
    error,
    settings,
    publicSource,
    builtin,
    additional,
    dirty,
    saving,
    setPublicSource,
    addCertificates,
    removeCertificates,
    cancel,
    save,
    retry,
  } = certificates
  const [addOpen, setAddOpen] = useState(false)
  const [viewing, setViewing] = useState<Viewing | null>(null)

  const stagedIds = useMemo(() => new Set(additional.map((row) => row.id)), [additional])

  const viewBuiltIn = useCallback(
    (id: string) => setViewing({ id, name: builtin.find((row) => row.id === id)?.name }),
    [builtin],
  )
  const viewAdditional = useCallback(
    (row: StagedCertificateRow) => setViewing({ id: row.id, name: row.name, detail: row.detail }),
    [],
  )
  const openAdd = useCallback(() => setAddOpen(true), [])

  if (status === 'failed') {
    return (
      <div data-testid="network-certificates-tab" className="space-y-6">
        <SettingsSectionHeader title={PAGE_TITLE} />
        <SectionError message={error ?? ''} onRetry={retry} />
      </div>
    )
  }

  const pending = status === 'pending'

  return (
    <div data-testid="network-certificates-tab" className="space-y-6">
      <section className="space-y-4">
        {pending ? (
          <SettingsSectionHeader title={PAGE_TITLE} />
        ) : (
          <SettingsSectionHeader title={PAGE_TITLE} dirty={dirty} saving={saving} onCancel={cancel} onSave={save} />
        )}
        {pending ? (
          <PublicAuthoritiesSkeleton />
        ) : (
          <PublicAuthoritiesChoice
            value={publicSource}
            builtin={settings.builtin}
            hostStoreFound={settings.host_store.path !== null}
            onChange={setPublicSource}
            disabled={saving}
          />
        )}
      </section>

      <Separator />

      {publicSource === 'builtin' ? (
        <section>
          <h2 className={SECTION_TITLE_CLASS}>Built-in Authorities</h2>
          <BuiltInAuthoritiesTable certificates={builtin} loading={pending} onView={viewBuiltIn} />
        </section>
      ) : (
        <section>
          <h2 className={SECTION_TITLE_CLASS}>WAVE Host&apos;s Store</h2>
          <HostStoreSummary store={settings.host_store} />
        </section>
      )}

      <Separator />

      <section>
        <h2 className={SECTION_TITLE_CLASS}>Additional Certificates</h2>
        <AdditionalCertificatesTable
          certificates={additional}
          loading={pending}
          onAdd={openAdd}
          onView={viewAdditional}
          onRemove={removeCertificates}
          disabled={saving || pending}
        />
      </section>

      <AddCertificateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        stagedIds={stagedIds}
        onAdd={addCertificates}
      />
      <CertificateDialog
        certificateId={viewing?.id ?? null}
        detail={viewing?.detail}
        name={viewing?.name}
        onClose={() => setViewing(null)}
      />
    </div>
  )
}
