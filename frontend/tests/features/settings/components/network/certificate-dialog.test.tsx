/**
 * Certificate dialog (NET-9, REQ-4.5.16): read-only certificate detail, fetched
 * by id for saved rows or rendered from a given detail for staged rows.
 *
 * Component: frontend/src/features/settings/components/network/certificate-dialog.tsx
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CertificateDialog } from '@/features/settings/components/network/certificate-dialog'
import { fetchCertificateDetail, type CertificateDetail } from '@/features/settings/api/certificates'
import { copyText } from '@/lib/clipboard'

vi.mock('@/features/settings/api/certificates', () => ({
  fetchCertificateDetail: vi.fn(),
}))

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn(),
}))

const CERTIFICATE_ID = '3f9ac2710be458d61a972cfe4083b56de1079c34ab5f12d866c04e917b28f3a5'
const OTHER_ID = '9b'.repeat(32)
const NOT_FOUND_MESSAGE = `Certificate with ID '${CERTIFICATE_ID}' not found`

const DETAIL: CertificateDetail = {
  id: CERTIFICATE_ID,
  name: 'Corp Issuing CA 2',
  subject: 'CN=Corp Issuing CA 2, O=Corp Example Inc., C=US',
  issuer: 'CN=Corp Root CA 2031, O=Corp Example Inc., C=US',
  type: 'Intermediate',
  path_length: 0,
  valid_from: '2025-07-01 00:00:00 UTC',
  valid_to: '2028-06-30 23:59:59 UTC',
  status: 'valid',
  days_to_expiry: 637,
  sha256_fingerprint:
    '3F:9A:C2:71:0B:E4:58:D6:1A:97:2C:FE:40:83:B5:6D:E1:07:9C:34:AB:5F:12:D8:66:C0:4E:91:7B:28:F3:A5',
  serial_number: '4A:1F:0C:93:7E:22:5B:D1:08:6E:3C:F4:91:A7:20:5D',
  key: 'RSA 4096',
  signature_algorithm: 'SHA-256 with RSA',
  key_usage: ['Certificate sign', 'CRL sign'],
  subject_key_id: '8C:21:5E:F0:3A:97:D4:6B:12:C8:7F:E3:05:9A:B1:44:6D:2E:F8:C3',
  authority_key_id: '51:B7:0E:9C:24:F6:83:AD:1F:6A:C9:72:E5:38:0B:D4:97:4C:A6:1E',
  pem: [
    '-----BEGIN CERTIFICATE-----',
    'MIIFlTCCA32gAwIBAgIQSh8Mk34iW9EIbjz0kacgXTANBgkqhkiG9w0BAQsFADBH',
    'shuTkmWtYRkGlCqrWYmLnoXgyjUjRvuro7Bucmer+2SfWj6dJNuTAEfYzu2bU/80',
    '-----END CERTIFICATE-----',
  ].join('\n'),
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

type DialogProps = Parameters<typeof CertificateDialog>[0]

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = { certificateId: CERTIFICATE_ID, onClose: vi.fn(), ...overrides }
  const view = render(<CertificateDialog {...props} />)
  return { ...view, props }
}

function squash(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, '')
}

// Matches the smallest element showing the value, even when it is split across lines or spans.
function showing(value: string) {
  const target = squash(value)
  return (content: string, element: Element | null): boolean => {
    if (!element) return false
    if (squash(content) === target) return true
    if (squash(element.textContent) !== target) return false
    return !Array.from(element.children).some((child) => squash(child.textContent) === target)
  }
}

function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function expectField(dialog: HTMLElement, label: string, value: string): void {
  const labelElement = within(dialog).getByText(label)
  const valueElement = within(dialog).getByText(showing(value))
  expect(follows(labelElement, valueElement)).toBe(true)
}

function expectEveryField(dialog: HTMLElement): void {
  expectField(dialog, 'Subject', DETAIL.subject)
  expectField(dialog, 'Issuer', DETAIL.issuer)
  expectField(dialog, 'Type', 'Intermediate')
  expectField(dialog, 'Path length', '0')
  expectField(dialog, 'Valid from', DETAIL.valid_from)
  expectField(dialog, 'Valid to', DETAIL.valid_to)
  expectField(dialog, 'SHA-256 fingerprint', DETAIL.sha256_fingerprint)
  expectField(dialog, 'Serial number', DETAIL.serial_number)
  expectField(dialog, 'Key', 'RSA 4096')
  expectField(dialog, 'Signature algorithm', 'SHA-256 with RSA')
  expectField(dialog, 'Key usage', 'Certificate sign, CRL sign')
  expectField(dialog, 'Subject Key ID', DETAIL.subject_key_id as string)
  expectField(dialog, 'Authority Key ID', DETAIL.authority_key_id as string)
  expectField(dialog, 'PEM', DETAIL.pem)
}

beforeEach(() => {
  vi.mocked(fetchCertificateDetail).mockReset()
  vi.mocked(copyText).mockReset()
  vi.mocked(copyText).mockResolvedValue(true)
})

describe('CertificateDialog - closed', () => {
  it('renders nothing without an id or a detail', () => {
    renderDialog({ certificateId: null })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetchCertificateDetail).not.toHaveBeenCalled()
  })
})

describe('CertificateDialog - saved row fetched by id (NET-9)', () => {
  it('fetches the detail once and shows field skeletons while loading', () => {
    vi.mocked(fetchCertificateDetail).mockReturnValue(deferred<CertificateDetail>().promise)

    renderDialog()

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('certificate-detail-loading')).toBeInTheDocument()
    expect(screen.queryByText(DETAIL.subject)).not.toBeInTheDocument()
    expect(fetchCertificateDetail).toHaveBeenCalledTimes(1)
    expect(fetchCertificateDetail).toHaveBeenCalledWith(CERTIFICATE_ID)
  })

  it('shows every field once the detail arrives, titled by the certificate name', async () => {
    vi.mocked(fetchCertificateDetail).mockResolvedValue(DETAIL)

    renderDialog()

    expect(await screen.findByRole('heading', { name: 'Corp Issuing CA 2' })).toBeInTheDocument()
    expect(screen.queryByTestId('certificate-detail-loading')).not.toBeInTheDocument()
    expectEveryField(screen.getByRole('dialog'))
    expect(fetchCertificateDetail).toHaveBeenCalledTimes(1)
  })

  it('shows the API message and a Retry when the fetch fails', async () => {
    vi.mocked(fetchCertificateDetail).mockRejectedValue(new Error(NOT_FOUND_MESSAGE))

    renderDialog()

    expect(await screen.findByText(NOT_FOUND_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('certificate-detail-loading')).not.toBeInTheDocument()
  })

  it('fetches again on Retry, showing skeletons and then the fields', async () => {
    vi.mocked(fetchCertificateDetail).mockRejectedValueOnce(new Error(NOT_FOUND_MESSAGE))
    renderDialog()
    const retry = await screen.findByRole('button', { name: 'Retry' })
    const second = deferred<CertificateDetail>()
    vi.mocked(fetchCertificateDetail).mockReturnValueOnce(second.promise)

    fireEvent.click(retry)

    expect(fetchCertificateDetail).toHaveBeenCalledTimes(2)
    expect(fetchCertificateDetail).toHaveBeenLastCalledWith(CERTIFICATE_ID)
    expect(screen.getByTestId('certificate-detail-loading')).toBeInTheDocument()
    expect(screen.queryByText(NOT_FOUND_MESSAGE)).not.toBeInTheDocument()

    await act(async () => {
      second.resolve(DETAIL)
    })

    expect(screen.getByRole('heading', { name: 'Corp Issuing CA 2' })).toBeInTheDocument()
    expectEveryField(screen.getByRole('dialog'))
  })

  it('fetches the new id when opened for another certificate', async () => {
    vi.mocked(fetchCertificateDetail).mockResolvedValue(DETAIL)
    const { props, rerender } = renderDialog()
    await screen.findByRole('heading', { name: 'Corp Issuing CA 2' })

    rerender(<CertificateDialog {...props} certificateId={null} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    vi.mocked(fetchCertificateDetail).mockResolvedValue({ ...DETAIL, id: OTHER_ID, name: 'Corp Root CA' })
    rerender(<CertificateDialog {...props} certificateId={OTHER_ID} />)

    expect(await screen.findByRole('heading', { name: 'Corp Root CA' })).toBeInTheDocument()
    expect(fetchCertificateDetail).toHaveBeenCalledTimes(2)
    expect(fetchCertificateDetail).toHaveBeenLastCalledWith(OTHER_ID)
  })
})

describe('CertificateDialog - given detail (staged row)', () => {
  it('renders the detail at once and never fetches', () => {
    renderDialog({ detail: DETAIL })

    expect(screen.getByRole('heading', { name: 'Corp Issuing CA 2' })).toBeInTheDocument()
    expect(screen.queryByTestId('certificate-detail-loading')).not.toBeInTheDocument()
    expectEveryField(screen.getByRole('dialog'))
    expect(fetchCertificateDetail).not.toHaveBeenCalled()
  })

  it('keeps the mono values and the PEM out of page translation', () => {
    renderDialog({ detail: DETAIL })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(DETAIL.serial_number)).toHaveAttribute('translate', 'no')
    expect(within(dialog).getByText(DETAIL.subject_key_id as string)).toHaveAttribute('translate', 'no')
    expect(within(dialog).getByText(DETAIL.pem.split('\n')[1], { exact: false })).toHaveAttribute('translate', 'no')
    expect(within(dialog).getByText(DETAIL.subject)).not.toHaveAttribute('translate')
  })

  it('puts focus on the title', () => {
    renderDialog({ detail: DETAIL })

    expect(screen.getByRole('heading', { name: 'Corp Issuing CA 2' })).toHaveFocus()
  })
})

describe('CertificateDialog - status badge after Valid to', () => {
  it.each([
    { status: 'valid', days: 637, text: 'Valid', variant: 'badge-success' },
    { status: 'expiring', days: 12, text: 'Expires in 12 days', variant: 'badge-warning' },
    { status: 'expired', days: -3, text: 'Expired', variant: 'badge-error' },
  ] as const)('shows the $variant badge for $status', ({ status, days, text, variant }) => {
    renderDialog({ detail: { ...DETAIL, status, days_to_expiry: days } })

    const dialog = screen.getByRole('dialog')
    const badge = within(dialog).getByText(text)
    expect(badge).toHaveClass(variant)
    expect(follows(within(dialog).getByText(DETAIL.valid_to), badge)).toBe(true)
  })

  it('shows one status badge only', () => {
    renderDialog({ detail: { ...DETAIL, status: 'expiring', days_to_expiry: 12 } })

    expect(screen.queryByText('Valid')).not.toBeInTheDocument()
    expect(screen.queryByText('Expired')).not.toBeInTheDocument()
  })
})

describe('CertificateDialog - copy buttons', () => {
  it('copies the SHA-256 fingerprint and announces "Copied"', async () => {
    renderDialog({ detail: DETAIL })
    const button = screen.getByRole('button', { name: 'Copy SHA-256 fingerprint' })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(copyText).toHaveBeenCalledWith(DETAIL.sha256_fingerprint)
    expect(button).toHaveTextContent('Copied')
  })

  it('copies the PEM from its "Copy" button and announces "Copied"', async () => {
    renderDialog({ detail: DETAIL })
    const button = screen.getByRole('button', { name: 'Copy' })

    await act(async () => {
      fireEvent.click(button)
    })

    expect(copyText).toHaveBeenCalledWith(DETAIL.pem)
    expect(button).toHaveTextContent('Copied')
  })
})

describe('CertificateDialog - closing', () => {
  it('offers a corner X and a footer Close, both named "Close"', () => {
    renderDialog({ detail: DETAIL })

    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })).toHaveLength(2)
  })

  it.each([0, 1])('calls onClose once from Close button %i', (index) => {
    const { props } = renderDialog({ detail: DETAIL })

    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[index])

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Esc', () => {
    const { props } = renderDialog({ detail: DETAIL })

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CertificateDialog - self-issued and absent values', () => {
  it('shows the full issuer name for a self-issued certificate', () => {
    renderDialog({ detail: { ...DETAIL, issuer: DETAIL.subject } })

    const dialog = screen.getByRole('dialog')
    const [subject, issuer] = within(dialog).getAllByText(DETAIL.subject)
    expect(follows(within(dialog).getByText('Subject'), subject)).toBe(true)
    expect(follows(within(dialog).getByText('Issuer'), issuer)).toBe(true)
  })

  it('reads "Unlimited" for a certificate without a path length', () => {
    renderDialog({ detail: { ...DETAIL, path_length: null } })

    expectField(screen.getByRole('dialog'), 'Path length', 'Unlimited')
  })

  it('reads "None" for an empty key usage and missing key IDs', () => {
    renderDialog({ detail: { ...DETAIL, key_usage: [], subject_key_id: null, authority_key_id: null } })

    const dialog = screen.getByRole('dialog')
    for (const label of ['Key usage', 'Subject Key ID', 'Authority Key ID']) {
      expect(within(dialog).getByText(label).nextElementSibling).toHaveTextContent(/^None$/)
    }
  })

  it('says "Expires in 1 day" with one day left', () => {
    renderDialog({ detail: { ...DETAIL, status: 'expiring', days_to_expiry: 1 } })

    expect(within(screen.getByRole('dialog')).getByText('Expires in 1 day')).toHaveClass('badge-warning')
  })
})

describe('CertificateDialog - title while loading', () => {
  it('titles the dialog by the given row name until the detail arrives', () => {
    vi.mocked(fetchCertificateDetail).mockReturnValue(deferred<CertificateDetail>().promise)

    renderDialog({ name: 'Corp Issuing CA 2' })

    expect(screen.getByRole('heading', { name: 'Corp Issuing CA 2' })).toBeInTheDocument()
    expect(screen.getByTestId('certificate-detail-loading')).toBeInTheDocument()
  })

  it('keeps a certificate name title out of page translation', () => {
    vi.mocked(fetchCertificateDetail).mockReturnValue(deferred<CertificateDetail>().promise)

    renderDialog({ name: 'Corp Issuing CA 2' })

    expect(screen.getByRole('heading', { name: 'Corp Issuing CA 2' })).toHaveAttribute('translate', 'no')
  })

  it('leaves the "Certificate" fallback title translatable', () => {
    vi.mocked(fetchCertificateDetail).mockReturnValue(deferred<CertificateDetail>().promise)

    renderDialog()

    expect(screen.getByRole('heading', { name: 'Certificate' })).not.toHaveAttribute('translate')
  })
})
