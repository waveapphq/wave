/**
 * Certificates API Client (REQ-4.5.16)
 *
 * The public certificate authorities choice, WAVE's additional certificates
 * and the built-in list. Every write is the one PATCH change set; parse writes
 * nothing. Plain payloads (rawResponse); errors propagate unchanged.
 */

import { apiClient } from '@/lib/api'
import { postUpload } from '@/lib/api/upload'

// ============================================================================
// Types
// ============================================================================

export type PublicSource = 'builtin' | 'host'

export type CertificateType = 'Root' | 'Intermediate'

export interface CertificateSettings {
  public_source: PublicSource
  /** `label` is the bundled list's date, for example "June 2026". */
  builtin: { label: string; count: number }
  /** `path` is null when no store exists on this WAVE host. */
  host_store: { path: string | null; count: number; last_changed: string | null }
}

export interface CertificateRow {
  /** SHA-256 hex, lowercase, no colons. */
  id: string
  name: string
  organization: string
  type: CertificateType
  /** YYYY-MM-DD. */
  expires: string
}

export interface CertificatesView {
  settings: CertificateSettings
  additional: CertificateRow[]
}

export type CertificateStatus = 'valid' | 'expiring' | 'expired'

export interface CertificateDetail {
  id: string
  name: string
  subject: string
  issuer: string
  type: CertificateType
  path_length: number | null
  /** YYYY-MM-DD HH:MM:SS UTC. */
  valid_from: string
  valid_to: string
  status: CertificateStatus
  days_to_expiry: number
  /** Colon-separated uppercase hex. */
  sha256_fingerprint: string
  serial_number: string
  key: string
  signature_algorithm: string
  key_usage: string[]
  subject_key_id: string | null
  authority_key_id: string | null
  pem: string
}

export interface ParsedCertificate {
  id: string
  name: string
  type: CertificateType
  expires: string
  expired: boolean
  pem: string
  detail: CertificateDetail
}

/** A row of the Additional Certificates table; a staged addition also carries its PEM and detail. */
export type StagedCertificateRow = CertificateRow & {
  staged?: true
  pem?: string
  detail?: CertificateDetail
}

export interface CertificateParseError {
  /** The certificate's number in the input, or null for a whole-input problem. */
  index: number | null
  message: string
}

export interface CertificateParse {
  certificates: ParsedCertificate[]
  errors: CertificateParseError[]
}

export interface CertificatesChange {
  public_source?: PublicSource
  /** One PEM certificate each. */
  add: string[]
  remove: string[]
}

const PARSE_FAILED = 'Could not read the certificate file'

// ============================================================================
// API Functions
// ============================================================================

export async function fetchCertificates(): Promise<CertificatesView> {
  const response = await apiClient.get<CertificatesView>('/network/certificates', {
    rawResponse: true,
  })
  return response.data
}

export async function saveCertificates(change: CertificatesChange): Promise<CertificatesView> {
  const response = await apiClient.patch<CertificatesView>('/network/certificates', change, {
    rawResponse: true,
  })
  return response.data
}

export async function parseCertificateText(text: string): Promise<CertificateParse> {
  const response = await apiClient.post<CertificateParse>(
    '/network/certificates/parse',
    { text },
    { rawResponse: true },
  )
  return response.data
}

export async function parseCertificateFile(file: File): Promise<CertificateParse> {
  const formData = new FormData()
  formData.append('file', file)
  return postUpload<CertificateParse>('/network/certificates/parse', formData, PARSE_FAILED, {
    rawResponse: true,
  })
}

export async function fetchBuiltInCertificates(): Promise<CertificateRow[]> {
  const response = await apiClient.get<{ certificates: CertificateRow[] }>(
    '/network/certificates/builtin',
    { rawResponse: true },
  )
  return response.data.certificates
}

export async function fetchCertificateDetail(id: string): Promise<CertificateDetail> {
  const response = await apiClient.get<CertificateDetail>(
    `/network/certificates/${encodeURIComponent(id)}`,
    { rawResponse: true },
  )
  return response.data
}
