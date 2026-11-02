/**
 * useCertificates Hook (REQ-4.5.16)
 *
 * Drives the Certificates page: reads the settings and the built-in list together
 * on activation while clean, stages the public source, additions and removals,
 * and writes them as one change set on Save.
 */

import { useCallback, useMemo, useState } from 'react'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  fetchBuiltInCertificates,
  fetchCertificates,
  saveCertificates,
  type CertificateDetail,
  type CertificateRow,
  type CertificateSettings,
  type CertificatesChange,
  type CertificatesView,
  type ParsedCertificate,
  type PublicSource,
  type StagedCertificateRow,
} from '@/features/settings/api/certificates'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'

export interface UseCertificatesResult {
  status: PageReadStatus
  error?: string
  settings: CertificateSettings
  publicSource: PublicSource
  builtin: CertificateRow[]
  additional: StagedCertificateRow[]
  dirty: boolean
  saving: boolean
  setPublicSource: (value: PublicSource) => void
  addCertificates: (list: ParsedCertificate[]) => void
  removeCertificates: (ids: string[]) => void
  cancel: () => void
  save: () => void
  retry: () => void
}

type StagedAddition = StagedCertificateRow & { staged: true; pem: string; detail: CertificateDetail }

const DEFAULT_SETTINGS: CertificateSettings = {
  public_source: 'builtin',
  builtin: { label: '', count: 0 },
  host_store: { path: null, count: 0, last_changed: null },
}
const NO_ROWS: CertificateRow[] = []
const NO_ADDITIONS: StagedAddition[] = []
const NO_IDS: ReadonlySet<string> = new Set()

/** Both reads are primary: either failing fails the page. */
function readPage(): Promise<[CertificatesView, CertificateRow[]]> {
  return Promise.all([fetchCertificates(), fetchBuiltInCertificates()])
}

// A parse result names no organization; the Additional Certificates table shows none.
function toStagedRow({ id, name, type, expires, pem, detail }: ParsedCertificate): StagedAddition {
  return { id, name, organization: '', type, expires, staged: true, pem, detail }
}

export function useCertificates(active: boolean): UseCertificatesResult {
  const { report } = useFailureToast('Could Not Save Certificates')

  const [saved, setSaved] = useState<CertificatesView | undefined>()
  const [builtin, setBuiltin] = useState<CertificateRow[]>(NO_ROWS)
  const [stagedSource, setStagedSource] = useState<PublicSource | undefined>()
  const [additions, setAdditions] = useState<StagedAddition[]>(NO_ADDITIONS)
  const [removed, setRemoved] = useState<ReadonlySet<string>>(NO_IDS)
  const [saving, setSaving] = useState(false)

  const settings = saved?.settings ?? DEFAULT_SETTINGS
  const savedRows = saved?.additional ?? NO_ROWS
  const publicSource = stagedSource ?? settings.public_source
  const dirty = publicSource !== settings.public_source || additions.length > 0 || removed.size > 0

  const savedIds = useMemo(() => new Set(savedRows.map((row) => row.id)), [savedRows])

  const additional = useMemo(
    () => [...savedRows.filter((row) => !removed.has(row.id)), ...additions],
    [savedRows, additions, removed],
  )

  const applyView = useCallback((view: CertificatesView) => {
    setSaved(view)
    setStagedSource(undefined)
    setAdditions(NO_ADDITIONS)
    setRemoved(NO_IDS)
  }, [])

  const applyRead = useCallback(
    ([view, rows]: [CertificatesView, CertificateRow[]]) => {
      applyView(view)
      setBuiltin(rows)
    },
    [applyView],
  )
  const { status, error, retry } = useActivationRead(active, dirty, readPage, applyRead)

  const addCertificates = useCallback(
    (list: ParsedCertificate[]) => {
      // Adding back a removed saved certificate undoes the removal.
      const restored = new Set(list.filter((parsed) => savedIds.has(parsed.id)).map((parsed) => parsed.id))
      if (restored.size > 0) {
        setRemoved((prev) => new Set([...prev].filter((id) => !restored.has(id))))
      }
      setAdditions((prev) => {
        const present = new Set(prev.map((row) => row.id))
        const next = [...prev]
        for (const parsed of list) {
          if (savedIds.has(parsed.id) || present.has(parsed.id)) continue
          present.add(parsed.id)
          next.push(toStagedRow(parsed))
        }
        return next
      })
    },
    [savedIds],
  )

  const removeCertificates = useCallback(
    (ids: string[]) => {
      const targets = new Set(ids)
      setAdditions((prev) => prev.filter((row) => !targets.has(row.id)))
      setRemoved((prev) => new Set([...prev, ...ids.filter((id) => savedIds.has(id))]))
    },
    [savedIds],
  )

  const cancel = useCallback(() => {
    setStagedSource(undefined)
    setAdditions(NO_ADDITIONS)
    setRemoved(NO_IDS)
  }, [])

  const save = useCallback(() => {
    const change: CertificatesChange = {
      add: additions.map((row) => row.pem),
      remove: [...removed],
    }
    if (publicSource !== settings.public_source) change.public_source = publicSource
    setSaving(true)
    saveCertificates(change).then(
      (view) => {
        setSaving(false)
        applyView(view)
      },
      (err: unknown) => {
        setSaving(false)
        report(err)
      },
    )
  }, [additions, removed, publicSource, settings.public_source, applyView, report])

  return {
    status,
    error,
    settings,
    publicSource,
    builtin,
    additional,
    dirty,
    saving,
    setPublicSource: setStagedSource,
    addCertificates,
    removeCertificates,
    cancel,
    save,
    retry,
  }
}
