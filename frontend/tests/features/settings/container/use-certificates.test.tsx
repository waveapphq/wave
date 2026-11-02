/**
 * useCertificates Hook Tests
 *
 * REQ-4.5.16: the Certificates page state - both reads in parallel,
 * staged public source / additions / removals, one change set on Save, Cancel.
 *
 * Module under test: frontend/src/features/settings/container/use-certificates.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/settings/api/certificates', () => ({
  fetchCertificates: vi.fn(),
  fetchBuiltInCertificates: vi.fn(),
  saveCertificates: vi.fn(),
  parseCertificateText: vi.fn(),
  parseCertificateFile: vi.fn(),
  fetchCertificateDetail: vi.fn(),
}))

import {
  fetchBuiltInCertificates,
  fetchCertificates,
  saveCertificates,
  type CertificateDetail,
  type CertificateRow,
  type CertificateSettings,
  type CertificatesView,
  type ParsedCertificate,
} from '@/features/settings/api/certificates'
import { useCertificates } from '@/features/settings/container/use-certificates'

const mockFetchCertificates = vi.mocked(fetchCertificates)
const mockFetchBuiltIn = vi.mocked(fetchBuiltInCertificates)
const mockSaveCertificates = vi.mocked(saveCertificates)

// ============================================================================
// Fixtures
// ============================================================================

const ID_LAB = '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b'
const ID_CORP = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const ID_PARTNER = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
const ID_ISRG = '96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6'

const SETTINGS: CertificateSettings = {
  public_source: 'builtin',
  builtin: { label: 'June 2026', count: 146 },
  host_store: { path: '/etc/ssl/certs/ca-certificates.crt', count: 140, last_changed: '2026-09-12' },
}

const CERT_LAB: CertificateRow = {
  id: ID_LAB,
  name: 'Lab Root CA',
  organization: 'Lab Infrastructure',
  type: 'Root',
  expires: '2031-04-01',
}

const CERT_CORP: CertificateRow = {
  id: ID_CORP,
  name: 'Corp Issuing CA 2',
  organization: 'Example Corp',
  type: 'Intermediate',
  expires: '2029-11-30',
}

const BUILTIN: CertificateRow[] = [
  {
    id: ID_ISRG,
    name: 'ISRG Root X1',
    organization: 'Internet Security Research Group',
    type: 'Root',
    expires: '2035-06-04',
  },
]

const SAVED_VIEW: CertificatesView = { settings: SETTINGS, additional: [CERT_LAB, CERT_CORP] }

const PARTNER_PEM =
  '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQpartner\n-----END CERTIFICATE-----'

const PARTNER_DETAIL: CertificateDetail = {
  id: ID_PARTNER,
  name: 'Partner Issuing CA',
  subject: 'CN=Partner Issuing CA, O=Partner Ltd',
  issuer: 'CN=Partner Root CA, O=Partner Ltd',
  type: 'Intermediate',
  path_length: 0,
  valid_from: '2026-01-15 00:00:00 UTC',
  valid_to: '2028-01-15 00:00:00 UTC',
  status: 'valid',
  days_to_expiry: 470,
  sha256_fingerprint: 'B9:4D:27:B9:93:4D:3E:08:A5:2E:52:D7:DA:7D:AB:FA:C4:84:EF:E3:7A:53:80:EE:90:88:F7:AC:E2:EF:CD:E9',
  serial_number: '42:0B:6B:99:42:DD:4F:1B',
  key: 'EC P-256',
  signature_algorithm: 'ECDSA with SHA-256',
  key_usage: ['Certificate sign', 'CRL sign'],
  subject_key_id: '1F:2E:3D:4C:5B:6A',
  authority_key_id: '6A:5B:4C:3D:2E:1F',
  pem: PARTNER_PEM,
}

const PARSED_PARTNER: ParsedCertificate = {
  id: ID_PARTNER,
  name: 'Partner Issuing CA',
  type: 'Intermediate',
  expires: '2028-01-15',
  expired: false,
  pem: PARTNER_PEM,
  detail: PARTNER_DETAIL,
}

const LAB_PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQlab\n-----END CERTIFICATE-----'

const PARSED_LAB: ParsedCertificate = {
  id: ID_LAB,
  name: CERT_LAB.name,
  type: CERT_LAB.type,
  expires: CERT_LAB.expires,
  expired: false,
  pem: LAB_PEM,
  detail: { ...PARTNER_DETAIL, id: ID_LAB, name: CERT_LAB.name, type: 'Root', pem: LAB_PEM },
}

const READ_FAILURE =
  "WAVE's additional certificates /srv/wave/data/network/certificates.yaml cannot be read: [Errno 13] Permission denied"

const NO_STORE_MESSAGE =
  'No certificate store found on this WAVE host: looked in /etc/ssl/certs/ca-certificates.crt, /etc/pki/tls/certs/ca-bundle.crt, /etc/ssl/ca-bundle.pem, /etc/pki/tls/cacert.pem, /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem, /etc/ssl/cert.pem'

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================================
// Utilities
// ============================================================================

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderCertificates(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useCertificates(isActive), {
    initialProps: { active },
  })
}

async function renderLoaded() {
  const view = renderCertificates(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  return view
}

function sortedIds(rows: { id: string }[]): string[] {
  return rows.map((row) => row.id).sort()
}

// ============================================================================
// Tests
// ============================================================================

describe('useCertificates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCertificates.mockResolvedValue(SAVED_VIEW)
    mockFetchBuiltIn.mockResolvedValue(BUILTIN)
    mockSaveCertificates.mockResolvedValue(SAVED_VIEW)
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderCertificates(false)
      await flush()

      expect(mockFetchCertificates).not.toHaveBeenCalled()
      expect(mockFetchBuiltIn).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
    })

    it('starts both reads before either resolves, then is loaded with the saved state', async () => {
      const certificates = deferred<CertificatesView>()
      const builtin = deferred<CertificateRow[]>()
      mockFetchCertificates.mockReturnValueOnce(certificates.promise)
      mockFetchBuiltIn.mockReturnValueOnce(builtin.promise)

      const { result } = renderCertificates(true)
      await flush()

      expect(mockFetchCertificates).toHaveBeenCalledTimes(1)
      expect(mockFetchBuiltIn).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        builtin.resolve(BUILTIN)
      })
      await flush()
      expect(result.current.status).toBe('pending')

      await act(async () => {
        certificates.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.settings).toEqual(SETTINGS)
      expect(result.current.publicSource).toBe('builtin')
      expect(result.current.builtin).toEqual(BUILTIN)
      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_CORP].sort())
      expect(result.current.additional.find((row) => row.id === ID_LAB)).toEqual(CERT_LAB)
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('reads once the page turns active and not again while it stays active', async () => {
      const view = renderCertificates(false)
      await flush()

      view.rerender({ active: true })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchCertificates).toHaveBeenCalledTimes(1)
      expect(mockFetchBuiltIn).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
    })

    it('is failed with the message of the certificates read', async () => {
      mockFetchCertificates.mockRejectedValueOnce(apiError(READ_FAILURE, 500))

      const { result } = renderCertificates(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
    })

    it('is failed with the message of the built-in read', async () => {
      mockFetchBuiltIn.mockRejectedValueOnce(apiError('Network error', 0))

      const { result } = renderCertificates(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe('Network error')
    })

    it('retry reads both again: pending, then loaded', async () => {
      mockFetchCertificates.mockRejectedValueOnce(apiError(READ_FAILURE, 500))
      const { result } = renderCertificates(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const certificates = deferred<CertificatesView>()
      mockFetchCertificates.mockReturnValueOnce(certificates.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchCertificates).toHaveBeenCalledTimes(2)
      expect(mockFetchBuiltIn).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        certificates.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.settings).toEqual(SETTINGS)
    })

    it('reads again when a clean page turns active again', async () => {
      const view = await renderLoaded()
      mockFetchCertificates.mockResolvedValueOnce({ settings: SETTINGS, additional: [CERT_CORP] })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchCertificates).toHaveBeenCalledTimes(2)
      expect(mockFetchBuiltIn).toHaveBeenCalledTimes(2)
      expect(view.result.current.additional).toEqual([CERT_CORP])
    })

    it('keeps the staged state and does not read when a dirty page turns active again', async () => {
      const view = await renderLoaded()
      act(() => {
        view.result.current.setPublicSource('host')
        view.result.current.addCertificates([PARSED_PARTNER])
      })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchCertificates).toHaveBeenCalledTimes(1)
      expect(mockFetchBuiltIn).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.publicSource).toBe('host')
      expect(sortedIds(view.result.current.additional)).toEqual([ID_LAB, ID_CORP, ID_PARTNER].sort())
    })
  })

  describe('staged state', () => {
    it('setPublicSource stages the source and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setPublicSource('host')
      })

      expect(result.current.publicSource).toBe('host')
      expect(result.current.settings).toEqual(SETTINGS)
      expect(result.current.dirty).toBe(true)
    })

    it('is clean again when the staged source returns to the saved one', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPublicSource('host')
      })

      act(() => {
        result.current.setPublicSource('builtin')
      })

      expect(result.current.dirty).toBe(false)
    })

    it('adds a staged row keyed by its SHA-256 id carrying the PEM and the detail', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.addCertificates([PARSED_PARTNER])
      })

      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_CORP, ID_PARTNER].sort())
      expect(result.current.additional.find((row) => row.id === ID_PARTNER)).toMatchObject({
        id: ID_PARTNER,
        name: 'Partner Issuing CA',
        type: 'Intermediate',
        expires: '2028-01-15',
        staged: true,
        pem: PARTNER_PEM,
        detail: PARTNER_DETAIL,
      })
      expect(result.current.dirty).toBe(true)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('does not duplicate an id that is already staged', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.addCertificates([PARSED_PARTNER, PARSED_PARTNER])
      })
      act(() => {
        result.current.addCertificates([PARSED_PARTNER])
      })

      expect(result.current.additional.filter((row) => row.id === ID_PARTNER)).toHaveLength(1)
    })

    it('removes a saved row from the view and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.removeCertificates([ID_LAB])
      })

      expect(result.current.additional).toEqual([CERT_CORP])
      expect(result.current.dirty).toBe(true)
    })

    it('removes several rows at once', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.removeCertificates([ID_LAB, ID_CORP])
      })

      expect(result.current.additional).toEqual([])
      expect(result.current.dirty).toBe(true)
    })

    it('removing a staged row drops the addition and leaves the page clean when nothing else changed', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.addCertificates([PARSED_PARTNER])
      })

      act(() => {
        result.current.removeCertificates([ID_PARTNER])
      })

      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_CORP].sort())
      expect(result.current.dirty).toBe(false)
    })

    it('shows a removed saved certificate once when it is added back', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.removeCertificates([ID_LAB])
      })

      act(() => {
        result.current.addCertificates([PARSED_LAB])
      })

      expect(result.current.additional.filter((row) => row.id === ID_LAB)).toHaveLength(1)
    })
  })

  describe('save', () => {
    it('sends one change set with the source, the added PEMs and the removed saved ids', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPublicSource('host')
        result.current.addCertificates([PARSED_PARTNER])
        result.current.removeCertificates([ID_CORP])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveCertificates).toHaveBeenCalledTimes(1)
      expect(mockSaveCertificates.mock.calls[0][0]).toStrictEqual({
        public_source: 'host',
        add: [PARTNER_PEM],
        remove: [ID_CORP],
      })
    })

    it('leaves the source out when it is unchanged and sends only removed saved ids', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.addCertificates([PARSED_PARTNER])
      })
      act(() => {
        result.current.removeCertificates([ID_LAB, ID_PARTNER])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(mockSaveCertificates.mock.calls[0][0]).toStrictEqual({
        add: [],
        remove: [ID_LAB],
      })
    })

    it('is saving while the request is in flight', async () => {
      const write = deferred<CertificatesView>()
      mockSaveCertificates.mockReturnValueOnce(write.promise)
      const { result } = await renderLoaded()
      act(() => {
        result.current.addCertificates([PARSED_PARTNER])
      })

      await act(async () => {
        result.current.save()
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve(SAVED_VIEW)
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the response the new baseline and clears the staged state', async () => {
      const partnerRow: CertificateRow = {
        id: ID_PARTNER,
        name: 'Partner Issuing CA',
        organization: 'Partner Ltd',
        type: 'Intermediate',
        expires: '2028-01-15',
      }
      const response: CertificatesView = {
        settings: { ...SETTINGS, public_source: 'host' },
        additional: [CERT_LAB, partnerRow],
      }
      mockSaveCertificates.mockResolvedValueOnce(response)
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPublicSource('host')
        result.current.addCertificates([PARSED_PARTNER])
        result.current.removeCertificates([ID_CORP])
      })

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(result.current.settings).toEqual(response.settings)
      expect(result.current.publicSource).toBe('host')
      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_PARTNER].sort())
      expect(result.current.additional.find((row) => row.id === ID_PARTNER)).toEqual(partnerRow)
      expect(result.current.builtin).toEqual(BUILTIN)
      expect(toastError).not.toHaveBeenCalled()

      act(() => {
        result.current.cancel()
      })
      expect(result.current.publicSource).toBe('host')
      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_PARTNER].sort())
    })

    it('on a failure shows the failure toast with the exact message and keeps the staged state', async () => {
      mockSaveCertificates.mockRejectedValueOnce(apiError(NO_STORE_MESSAGE, 400))
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPublicSource('host')
        result.current.addCertificates([PARSED_PARTNER])
        result.current.removeCertificates([ID_CORP])
      })
      const stagedBefore = result.current.additional

      await act(async () => {
        result.current.save()
      })
      await flush()

      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(NO_STORE_MESSAGE, 'Could Not Save Certificates')
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.publicSource).toBe('host')
      expect(result.current.settings).toEqual(SETTINGS)
      expect(result.current.additional).toEqual(stagedBefore)
      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_PARTNER].sort())
      expect(mockFetchCertificates).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancel', () => {
    it('restores the saved source and rows', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.setPublicSource('host')
        result.current.addCertificates([PARSED_PARTNER])
        result.current.removeCertificates([ID_LAB])
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.publicSource).toBe('builtin')
      expect(sortedIds(result.current.additional)).toEqual([ID_LAB, ID_CORP].sort())
      expect(result.current.additional.some((row) => row.staged)).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(mockSaveCertificates).not.toHaveBeenCalled()
    })
  })
})
