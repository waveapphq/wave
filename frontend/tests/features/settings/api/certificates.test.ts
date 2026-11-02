/**
 * Certificates API client (REQ-4.5.16, REQ-5.2.1.42).
 *
 * Module: frontend/src/features/settings/api/certificates.ts
 *
 * JSON calls go through apiClient with rawResponse; the file parse goes
 * through the shared multipart helper. Errors propagate unchanged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type {
  CertificateDetail,
  CertificateParse,
  CertificateRow,
  CertificatesView,
} from '@/features/settings/api/certificates'
import {
  fetchBuiltInCertificates,
  fetchCertificateDetail,
  fetchCertificates,
  parseCertificateFile,
  parseCertificateText,
  saveCertificates,
} from '@/features/settings/api/certificates'
import { apiClient } from '@/lib/api'
import { postUpload } from '@/lib/api/upload'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    getConfig: vi.fn(() => ({ baseUrl: 'http://localhost:8000' })),
  },
  getApiBaseUrl: vi.fn(() => 'http://localhost:8000'),
}))

vi.mock('@/lib/api/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/upload')>()),
  postUpload: vi.fn(),
}))

// ============================================================================
// Fixtures
// ============================================================================

const LAB_ROOT_ID = '6f3c9d0be7a1c45f2b8e90d1a4c7e3f5b2d8a9c0e1f4b7a3d6c9e2f5a8b1c4d7'

const LAB_ROOT_PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIBszCCAVmgAwIBAgIUQ2xhYlJvb3RDQTIwMjYwMDAxMAoGCCqGSM49BAMCMC8x',
  'LTArBgNVBAMMJExhYiBSb290IENBIDIwMjYgLSBXQVZFIEVuZ2luZWVyaW5nMB4X',
  '-----END CERTIFICATE-----',
].join('\n')

const LAB_ROOT_ROW: CertificateRow = {
  id: LAB_ROOT_ID,
  name: 'Lab Root CA 2026',
  organization: 'WAVE Engineering',
  type: 'Root',
  expires: '2036-03-01',
}

const BUILTIN_ROWS: CertificateRow[] = [
  {
    id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    name: 'ISRG Root X1',
    organization: 'Internet Security Research Group',
    type: 'Root',
    expires: '2035-06-04',
  },
  {
    id: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
    name: 'DigiCert Global Root G2',
    organization: 'DigiCert Inc',
    type: 'Root',
    expires: '2038-01-15',
  },
]

const VIEW: CertificatesView = {
  settings: {
    public_source: 'builtin',
    builtin: { label: 'June 2026', count: 146 },
    host_store: {
      path: '/etc/ssl/certs/ca-certificates.crt',
      count: 142,
      last_changed: '2026-08-14',
    },
  },
  additional: [LAB_ROOT_ROW],
}

const LAB_ROOT_DETAIL: CertificateDetail = {
  id: LAB_ROOT_ID,
  name: 'Lab Root CA 2026',
  subject: 'CN=Lab Root CA 2026, O=WAVE Engineering',
  issuer: 'CN=Lab Root CA 2026, O=WAVE Engineering',
  type: 'Root',
  path_length: null,
  valid_from: '2026-03-01 00:00:00 UTC',
  valid_to: '2036-03-01 00:00:00 UTC',
  status: 'valid',
  days_to_expiry: 3437,
  sha256_fingerprint:
    '6F:3C:9D:0B:E7:A1:C4:5F:2B:8E:90:D1:A4:C7:E3:F5:B2:D8:A9:C0:E1:F4:B7:A3:D6:C9:E2:F5:A8:B1:C4:D7',
  serial_number: '43:6C:61:62:52:6F:6F:74',
  key: 'EC P-256',
  signature_algorithm: 'ECDSA with SHA-256',
  key_usage: ['Certificate sign', 'CRL sign'],
  subject_key_id: '1A:2B:3C:4D:5E:6F:70:81:92:A3:B4:C5:D6:E7:F8:09:1A:2B:3C:4D',
  authority_key_id: null,
  pem: LAB_ROOT_PEM,
}

const PARSE_RESULT: CertificateParse = {
  certificates: [
    {
      id: LAB_ROOT_ID,
      name: 'Lab Root CA 2026',
      type: 'Root',
      expires: '2036-03-01',
      expired: false,
      pem: LAB_ROOT_PEM,
      detail: LAB_ROOT_DETAIL,
    },
  ],
  errors: [{ index: 2, message: 'Certificate 2: not a CA certificate' }],
}

function envelope<T>(data: T) {
  return { data, meta: { requestId: '' }, status: 200 }
}

function createMockApiError(status: number, message: string) {
  return Object.assign(new Error(message), {
    type: 'server',
    status,
    isRetryable: false,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('Certificates API', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('fetchCertificates', () => {
    it('reads the settings and the additional certificates from GET /network/certificates', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(VIEW))

      const result = await fetchCertificates()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/certificates', { rawResponse: true })
      expect(result).toEqual(VIEW)
    })

    it('propagates the unreadable-store error unchanged', async () => {
      const apiError = createMockApiError(
        500,
        "WAVE's additional certificates /srv/wave/data/network/certificates.yaml cannot be read: Permission denied",
      )
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchCertificates()).rejects.toBe(apiError)
    })
  })

  describe('saveCertificates', () => {
    it('PATCHes the whole change set to /network/certificates and resolves the saved view', async () => {
      const saved: CertificatesView = {
        ...VIEW,
        settings: { ...VIEW.settings, public_source: 'host' },
        additional: [],
      }
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(saved))

      const result = await saveCertificates({
        public_source: 'host',
        add: [LAB_ROOT_PEM],
        remove: [LAB_ROOT_ID],
      })

      expect(apiClient.patch).toHaveBeenCalledTimes(1)
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/network/certificates',
        { public_source: 'host', add: [LAB_ROOT_PEM], remove: [LAB_ROOT_ID] },
        { rawResponse: true },
      )
      expect(result).toEqual(saved)
    })

    it('sends no public_source key when the source did not change', async () => {
      vi.mocked(apiClient.patch).mockResolvedValue(envelope(VIEW))

      await saveCertificates({ add: [LAB_ROOT_PEM], remove: [] })

      const body = vi.mocked(apiClient.patch).mock.calls[0][1] as Record<string, unknown>
      expect(body).toStrictEqual({ add: [LAB_ROOT_PEM], remove: [] })
      expect('public_source' in body).toBe(false)
    })

    it('propagates the missing host store refusal (400) unchanged', async () => {
      const apiError = createMockApiError(
        400,
        'No certificate store found on this WAVE host: looked in /etc/ssl/certs/ca-certificates.crt, /etc/pki/tls/certs/ca-bundle.crt',
      )
      vi.mocked(apiClient.patch).mockRejectedValue(apiError)

      await expect(saveCertificates({ public_source: 'host', add: [], remove: [] })).rejects.toBe(
        apiError,
      )
      await expect(
        saveCertificates({ public_source: 'host', add: [], remove: [] }),
      ).rejects.toThrow(
        /^No certificate store found on this WAVE host: looked in \/etc\/ssl\/certs\/ca-certificates\.crt, \/etc\/pki\/tls\/certs\/ca-bundle\.crt$/,
      )
    })
  })

  describe('parseCertificateText', () => {
    it('POSTs the pasted text as JSON to /network/certificates/parse', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(envelope(PARSE_RESULT))

      const result = await parseCertificateText(LAB_ROOT_PEM)

      expect(apiClient.post).toHaveBeenCalledTimes(1)
      expect(apiClient.post).toHaveBeenCalledWith(
        '/network/certificates/parse',
        { text: LAB_ROOT_PEM },
        { rawResponse: true },
      )
      expect(result).toEqual(PARSE_RESULT)
      expect(postUpload).not.toHaveBeenCalled()
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = new TypeError('Failed to fetch')
      vi.mocked(apiClient.post).mockRejectedValue(apiError)

      await expect(parseCertificateText(LAB_ROOT_PEM)).rejects.toBe(apiError)
    })
  })

  describe('parseCertificateFile', () => {
    const pemFile = new File([LAB_ROOT_PEM], 'lab-root.pem', { type: 'application/x-pem-file' })

    it('POSTs the file as the one multipart field "file" through the upload helper', async () => {
      vi.mocked(postUpload).mockResolvedValue(PARSE_RESULT)

      const result = await parseCertificateFile(pemFile)

      expect(postUpload).toHaveBeenCalledTimes(1)
      const [path, form, fallback, options] = vi.mocked(postUpload).mock.calls[0]
      expect(path).toBe('/network/certificates/parse')
      expect(form).toBeInstanceOf(FormData)
      expect([...form.keys()]).toEqual(['file'])
      expect(form.getAll('file')).toEqual([pemFile])
      expect(fallback).toEqual(expect.any(String))
      expect(options).toEqual(expect.objectContaining({ rawResponse: true }))
      expect(result).toEqual(PARSE_RESULT)
      expect(apiClient.post).not.toHaveBeenCalled()
    })

    it('resolves the not-a-certificate answer as a normal result', async () => {
      const notCertificate: CertificateParse = {
        certificates: [],
        errors: [{ index: null, message: 'notes.txt is not a PEM or DER certificate file' }],
      }
      vi.mocked(postUpload).mockResolvedValue(notCertificate)

      await expect(
        parseCertificateFile(new File(['hello'], 'notes.txt', { type: 'text/plain' })),
      ).resolves.toEqual(notCertificate)
    })

    it('propagates upload errors unchanged', async () => {
      const apiError = createMockApiError(
        400,
        'Send the text as JSON or the file as multipart/form-data',
      )
      vi.mocked(postUpload).mockRejectedValue(apiError)

      await expect(parseCertificateFile(pemFile)).rejects.toBe(apiError)
    })
  })

  describe('fetchBuiltInCertificates', () => {
    it('reads GET /network/certificates/builtin and resolves the certificates array', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope({ certificates: BUILTIN_ROWS }))

      const result = await fetchBuiltInCertificates()

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith('/network/certificates/builtin', {
        rawResponse: true,
      })
      expect(result).toEqual(BUILTIN_ROWS)
    })

    it('propagates apiClient errors unchanged', async () => {
      const apiError = createMockApiError(503, 'Service Unavailable')
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchBuiltInCertificates()).rejects.toBe(apiError)
    })
  })

  describe('fetchCertificateDetail', () => {
    it('reads GET /network/certificates/{id}', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(LAB_ROOT_DETAIL))

      const result = await fetchCertificateDetail(LAB_ROOT_ID)

      expect(apiClient.get).toHaveBeenCalledTimes(1)
      expect(apiClient.get).toHaveBeenCalledWith(`/network/certificates/${LAB_ROOT_ID}`, {
        rawResponse: true,
      })
      expect(result).toEqual(LAB_ROOT_DETAIL)
    })

    it('URL-encodes the id as one path segment', async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope(LAB_ROOT_DETAIL))

      await fetchCertificateDetail('lab root/2026?x#y')

      expect(apiClient.get).toHaveBeenCalledWith(
        '/network/certificates/lab%20root%2F2026%3Fx%23y',
        { rawResponse: true },
      )
    })

    it('propagates the not-found error (404) unchanged', async () => {
      const apiError = createMockApiError(404, "Certificate with ID 'ffff' not found")
      vi.mocked(apiClient.get).mockRejectedValue(apiError)

      await expect(fetchCertificateDetail('ffff')).rejects.toBe(apiError)
      await expect(fetchCertificateDetail('ffff')).rejects.toThrow(
        /^Certificate with ID 'ffff' not found$/,
      )
    })
  })
})
