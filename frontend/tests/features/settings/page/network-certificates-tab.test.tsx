// REQ-4.5.16 Certificates page (NET-5..NET-9)
vi.mock('@/features/settings/api/certificates', () => ({
  fetchCertificates: vi.fn(),
  fetchBuiltInCertificates: vi.fn(),
  saveCertificates: vi.fn(),
  parseCertificateText: vi.fn(),
  parseCertificateFile: vi.fn(),
  fetchCertificateDetail: vi.fn(),
}))

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(true),
}))

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  fetchCertificateDetail,
  parseCertificateFile,
  parseCertificateText,
  type CertificateDetail,
  type CertificateRow,
  type CertificateSettings,
  type ParsedCertificate,
} from '@/features/settings/api/certificates'
import type { UseCertificatesResult } from '@/features/settings/container/use-certificates'
import { NetworkCertificatesTab } from '@/features/settings/page/network-certificates-tab'

type StagedRow = UseCertificatesResult['additional'][number]

// ============================================================================
// Fixtures
// ============================================================================

const NOT_FOUND = 'No certificate store found on this WAVE host'
const STORE_PATH = '/srv/wave/certs/ca-certificates.crt'
const LOAD_ERROR =
  "WAVE's additional certificates /srv/wave/data/network/certificates.yaml cannot be read: Permission denied"

function pemOf(name: string): string {
  return `-----BEGIN CERTIFICATE-----\nMIIB${name.replaceAll(' ', '')}\n-----END CERTIFICATE-----\n`
}

function hexId(pair: string): string {
  return pair.repeat(32)
}

function detailOf(row: CertificateRow, subject: string): CertificateDetail {
  return {
    id: row.id,
    name: row.name,
    subject,
    issuer: subject,
    type: row.type,
    path_length: null,
    valid_from: '2021-03-01 00:00:00 UTC',
    valid_to: `${row.expires} 00:00:00 UTC`,
    status: 'valid',
    days_to_expiry: 900,
    sha256_fingerprint: 'AA:BB:CC:DD:EE:FF',
    serial_number: '01:02:03:04',
    key: 'RSA 4096',
    signature_algorithm: 'SHA-256 with RSA',
    key_usage: ['Certificate sign', 'CRL sign'],
    subject_key_id: null,
    authority_key_id: null,
    pem: pemOf(row.name),
  }
}

const SETTINGS: CertificateSettings = {
  public_source: 'builtin',
  builtin: { label: 'June 2026', count: 146 },
  host_store: { path: STORE_PATH, count: 140, last_changed: '2026-08-12' },
}
const SETTINGS_NO_STORE: CertificateSettings = {
  ...SETTINGS,
  host_store: { path: null, count: 0, last_changed: null },
}

const ISRG: CertificateRow = {
  id: hexId('b1'),
  name: 'ISRG Root X1',
  organization: 'Internet Security Research Group',
  type: 'Root',
  expires: '2035-06-04',
}
const AMAZON: CertificateRow = {
  id: hexId('b2'),
  name: 'Amazon Root CA 1',
  organization: 'Amazon',
  type: 'Root',
  expires: '2038-01-17',
}

const SAVED_ROOT: StagedRow = {
  id: hexId('c1'),
  name: 'Corp Root CA 2031',
  organization: 'Corp',
  type: 'Root',
  expires: '2031-03-01',
}
const SAVED_ISSUING: StagedRow = {
  id: hexId('c2'),
  name: 'Corp Issuing CA 2',
  organization: 'Corp',
  type: 'Intermediate',
  expires: '2028-06-30',
}
const STAGED_LAB_ROW: CertificateRow = {
  id: hexId('c3'),
  name: 'Lab Test CA',
  organization: 'Lab',
  type: 'Root',
  expires: '2027-01-15',
}
const STAGED_LAB_DETAIL = detailOf(STAGED_LAB_ROW, 'CN=Lab Test CA, O=Lab, staged')
const STAGED_LAB: StagedRow = {
  ...STAGED_LAB_ROW,
  staged: true,
  pem: STAGED_LAB_DETAIL.pem,
  detail: STAGED_LAB_DETAIL,
}

const SAVED_ROWS: StagedRow[] = [SAVED_ROOT, SAVED_ISSUING]
const WITH_STAGED: StagedRow[] = [SAVED_ROOT, SAVED_ISSUING, STAGED_LAB]

const SAVED_ROOT_DETAIL = detailOf(SAVED_ROOT, 'CN=Corp Root CA 2031, O=Corp, fetched')
const ISRG_DETAIL = detailOf(ISRG, 'CN=ISRG Root X1, O=Internet Security Research Group')

const NEW_ROW: CertificateRow = {
  id: hexId('d1'),
  name: 'Corp Issuing CA 3',
  organization: 'Corp',
  type: 'Intermediate',
  expires: '2030-09-30',
}
const PARSED_NEW: ParsedCertificate = {
  id: NEW_ROW.id,
  name: NEW_ROW.name,
  type: NEW_ROW.type,
  expires: NEW_ROW.expires,
  expired: false,
  pem: pemOf(NEW_ROW.name),
  detail: detailOf(NEW_ROW, 'CN=Corp Issuing CA 3, O=Corp'),
}
const PARSED_DUPLICATE: ParsedCertificate = {
  id: SAVED_ROOT.id,
  name: SAVED_ROOT.name,
  type: SAVED_ROOT.type,
  expires: SAVED_ROOT.expires,
  expired: false,
  pem: pemOf(SAVED_ROOT.name),
  detail: SAVED_ROOT_DETAIL,
}

function makeCertificates(overrides: Partial<UseCertificatesResult> = {}): UseCertificatesResult {
  return {
    status: 'loaded',
    settings: SETTINGS,
    publicSource: 'builtin',
    builtin: [ISRG, AMAZON],
    additional: SAVED_ROWS,
    dirty: false,
    saving: false,
    setPublicSource: vi.fn(),
    addCertificates: vi.fn(),
    removeCertificates: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function renderTab(overrides: Partial<UseCertificatesResult> = {}) {
  const certificates = makeCertificates(overrides)
  render(<NetworkCertificatesTab certificates={certificates} />)
  return certificates
}

const builtinRadio = () => screen.getByRole('radio', { name: /WAVE's built-in list/ })
const hostRadio = () => screen.getByRole('radio', { name: /This WAVE host's store/ })

// The smallest ancestor of the "Public Certificate Authorities" heading that holds Save; nesting depth is not pinned.
function publicAuthoritiesHeader(): HTMLElement {
  let node = screen.getByRole('heading', { name: 'Public Certificate Authorities' }).parentElement
  while (node && !within(node).queryByRole('button', { name: 'Save' })) {
    node = node.parentElement
  }
  if (!node) throw new Error('No Save button around the "Public Certificate Authorities" heading')
  return node
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// Tests
// ============================================================================

describe('NetworkCertificatesTab', () => {
  describe('Layout', () => {
    it('heads the page with Public Certificate Authorities and its Cancel and Save', () => {
      renderTab()
      expect(screen.getByRole('heading', { name: 'Public Certificate Authorities' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('has no "Certificates" heading', () => {
      renderTab()
      expect(screen.queryByRole('heading', { name: 'Certificates' })).not.toBeInTheDocument()
    })

    it('puts Cancel and Save in the "Public Certificate Authorities" header, apart from the cards and the tables', () => {
      renderTab()

      const header = publicAuthoritiesHeader()
      expect(within(header).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(within(header).queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(within(header).queryByRole('heading', { name: 'Built-in Authorities' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('heading', { name: 'Additional Certificates' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('table')).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
    })

    it('shows the source cards and the Additional Certificates section', () => {
      renderTab()
      expect(
        screen.getByRole('radiogroup', { name: 'Public Certificate Authorities' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Additional Certificates' })).toBeInTheDocument()
    })

    it('fills the built-in card from the settings label and count', () => {
      renderTab()
      expect(screen.getByText("Mozilla's public list, June 2026, 146 authorities.")).toBeInTheDocument()
    })
  })

  describe('First read pending', () => {
    it('shows the title only, with no Cancel or Save', () => {
      renderTab({ status: 'pending' })
      expect(screen.getByRole('heading', { name: 'Public Certificate Authorities' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('has no "Certificates" heading', () => {
      renderTab({ status: 'pending' })
      expect(screen.queryByRole('heading', { name: 'Certificates' })).not.toBeInTheDocument()
    })

    it('shows card skeletons in place of the cards', () => {
      renderTab({ status: 'pending' })
      expect(screen.getByTestId('public-authorities-skeleton')).toBeInTheDocument()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    })

    it('shows table skeletons and no rows', () => {
      renderTab({ status: 'pending' })
      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('ISRG Root X1')).not.toBeInTheDocument()
      expect(screen.queryByText('Corp Root CA 2031')).not.toBeInTheDocument()
    })
  })

  describe('First read failed', () => {
    it("shows the section error with the API's message", () => {
      renderTab({ status: 'failed', error: LOAD_ERROR })
      expect(screen.getByRole('alert')).toHaveTextContent(LOAD_ERROR)
    })

    it('replaces the page body', () => {
      renderTab({ status: 'failed', error: LOAD_ERROR })
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Additional Certificates' })).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('keeps the "Public Certificate Authorities" title alone, with no Cancel or Save', () => {
      renderTab({ status: 'failed', error: LOAD_ERROR })
      const headings = screen.queryAllByRole('heading').map((heading) => heading.textContent?.trim())
      expect(headings).toEqual(['Public Certificate Authorities'])
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('puts the section error under the title, with the API reason and Try Again', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ status: 'failed', error: LOAD_ERROR })
      const alert = screen.getByRole('alert')
      expect(
        follows(screen.getByRole('heading', { name: 'Public Certificate Authorities' }), alert),
      ).toBe(true)
      expect(within(alert).getByText(LOAD_ERROR)).toBeInTheDocument()
      await user.click(within(alert).getByRole('button', { name: 'Try Again' }))
      expect(certificates.retry).toHaveBeenCalledTimes(1)
    })

    it('Try Again calls retry', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ status: 'failed', error: LOAD_ERROR })
      await user.click(screen.getByRole('button', { name: 'Try Again' }))
      expect(certificates.retry).toHaveBeenCalledTimes(1)
    })

    it('still offers Try Again when the read failed without a reason', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ status: 'failed', error: undefined })
      expect(screen.getByRole('alert')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try Again' }))
      expect(certificates.retry).toHaveBeenCalledTimes(1)
    })
  })

  describe('Source builtin', () => {
    it('checks the built-in card', () => {
      renderTab({ publicSource: 'builtin' })
      expect(builtinRadio()).toBeChecked()
      expect(hostRadio()).not.toBeChecked()
    })

    it('shows the Built-in Authorities table with its search', () => {
      renderTab({ publicSource: 'builtin' })
      expect(screen.getByRole('heading', { name: 'Built-in Authorities' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Search authorities…')).toBeInTheDocument()
      expect(screen.getByText('ISRG Root X1')).toBeInTheDocument()
      expect(screen.getByText('Amazon Root CA 1')).toBeInTheDocument()
    })

    it("hides the WAVE Host's Store summary", () => {
      renderTab({ publicSource: 'builtin' })
      expect(screen.queryByRole('heading', { name: "WAVE Host's Store" })).not.toBeInTheDocument()
      expect(screen.queryByText(STORE_PATH)).not.toBeInTheDocument()
    })

    it('follows the staged choice, not the saved one', () => {
      renderTab({ settings: { ...SETTINGS, public_source: 'host' }, publicSource: 'builtin', dirty: true })
      expect(builtinRadio()).toBeChecked()
      expect(screen.getByRole('heading', { name: 'Built-in Authorities' })).toBeInTheDocument()
    })
  })

  describe('Source host', () => {
    it('checks the host store card', () => {
      renderTab({ publicSource: 'host' })
      expect(hostRadio()).toBeChecked()
      expect(builtinRadio()).not.toBeChecked()
    })

    it("shows the WAVE Host's Store summary with its three facts", () => {
      renderTab({ publicSource: 'host' })
      expect(screen.getByRole('heading', { name: "WAVE Host's Store" })).toBeInTheDocument()
      expect(screen.getByText(STORE_PATH)).toBeInTheDocument()
      expect(screen.getByText('140')).toBeInTheDocument()
      expect(screen.getByText('2026-08-12')).toBeInTheDocument()
    })

    it('hides the Built-in Authorities table', () => {
      renderTab({ publicSource: 'host' })
      expect(screen.queryByRole('heading', { name: 'Built-in Authorities' })).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText('Search authorities…')).not.toBeInTheDocument()
      expect(screen.queryByText('ISRG Root X1')).not.toBeInTheDocument()
    })

    it('follows the staged choice, not the saved one', () => {
      renderTab({ settings: { ...SETTINGS, public_source: 'builtin' }, publicSource: 'host', dirty: true })
      expect(hostRadio()).toBeChecked()
      expect(screen.getByRole('heading', { name: "WAVE Host's Store" })).toBeInTheDocument()
    })
  })

  describe('Host store not found', () => {
    it('disables the host store card and shows the not-found line', () => {
      renderTab({ settings: SETTINGS_NO_STORE, publicSource: 'builtin' })
      expect(hostRadio()).toBeDisabled()
      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Built-in Authorities' })).toBeInTheDocument()
    })

    it('shows the not-found line on the card and in the summary when host is chosen', () => {
      renderTab({ settings: SETTINGS_NO_STORE, publicSource: 'host' })
      expect(screen.getAllByText(NOT_FOUND)).toHaveLength(2)
      expect(screen.queryByText('Last changed')).not.toBeInTheDocument()
    })
  })

  describe('Choosing a source', () => {
    it('calls setPublicSource with host when the host store card is chosen', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ publicSource: 'builtin' })
      await user.click(hostRadio())
      expect(certificates.setPublicSource).toHaveBeenCalledWith('host')
    })

    it('calls setPublicSource with builtin when the built-in card is chosen', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ publicSource: 'host' })
      await user.click(builtinRadio())
      expect(certificates.setPublicSource).toHaveBeenCalledWith('builtin')
    })
  })

  describe('Header actions', () => {
    it('disables Save and Cancel while nothing is staged', () => {
      renderTab({ dirty: false })
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('enables Save and Cancel once something is staged', () => {
      renderTab({ dirty: true })
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })

    it('Save calls save', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ dirty: true })
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(certificates.save).toHaveBeenCalledTimes(1)
    })

    it('Cancel calls cancel', async () => {
      const user = userEvent.setup()
      const certificates = renderTab({ dirty: true })
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(certificates.cancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('Saving', () => {
    it('shows Save busy and disables Cancel and Save', () => {
      renderTab({ dirty: true, saving: true })
      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toHaveAttribute('aria-busy', 'true')
      expect(save).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('disables both source cards', () => {
      renderTab({ dirty: true, saving: true })
      expect(builtinRadio()).toBeDisabled()
      expect(hostRadio()).toBeDisabled()
    })

    it('disables Add certificate, Mass Action and the trash buttons', () => {
      renderTab({ additional: WITH_STAGED, dirty: true, saving: true })
      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /Mass Action/ })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove Corp Root CA 2031' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove Lab Test CA' })).toBeDisabled()
    })
  })

  describe('Additional Certificates', () => {
    it('lists saved and staged rows alike', () => {
      renderTab({ additional: WITH_STAGED, dirty: true })
      expect(screen.getByRole('button', { name: 'View Corp Root CA 2031' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'View Lab Test CA' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Search certificates…')).toBeInTheDocument()
      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
    })

    it('trash calls removeCertificates with the row id and opens no dialog', async () => {
      const user = userEvent.setup()
      const certificates = renderTab()
      await user.click(screen.getByRole('button', { name: 'Remove Corp Issuing CA 2' }))
      expect(certificates.removeCertificates).toHaveBeenCalledWith([SAVED_ISSUING.id])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('Mass Action Delete calls removeCertificates with the selected ids', async () => {
      const user = userEvent.setup()
      const certificates = renderTab()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Corp Issuing CA 2' }))
      await user.click(screen.getByRole('button', { name: '2 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
      expect(certificates.removeCertificates).toHaveBeenCalledTimes(1)
      const ids = vi.mocked(certificates.removeCertificates).mock.calls[0][0]
      expect([...ids].sort()).toEqual([SAVED_ROOT.id, SAVED_ISSUING.id].sort())
    })

    it('shows the empty state with Add certificate when there are none', () => {
      renderTab({ additional: [] })
      expect(screen.getByText('No additional certificates')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Add certificate' }).length).toBeGreaterThan(0)
    })
  })

  describe('Certificate dialog (NET-9)', () => {
    it('eye on a saved row opens the dialog that fetches the certificate by id', async () => {
      vi.mocked(fetchCertificateDetail).mockResolvedValue(SAVED_ROOT_DETAIL)
      const user = userEvent.setup()
      renderTab()
      await user.click(screen.getByRole('button', { name: 'View Corp Root CA 2031' }))
      const dialog = await screen.findByRole('dialog', { name: 'Corp Root CA 2031' })
      expect(fetchCertificateDetail).toHaveBeenCalledWith(SAVED_ROOT.id)
      expect(await within(dialog).findAllByText(SAVED_ROOT_DETAIL.subject)).not.toHaveLength(0)
    })

    it('eye on a staged row opens the dialog with the staged detail and no fetch', async () => {
      const user = userEvent.setup()
      renderTab({ additional: WITH_STAGED, dirty: true })
      await user.click(screen.getByRole('button', { name: 'View Lab Test CA' }))
      const dialog = await screen.findByRole('dialog', { name: 'Lab Test CA' })
      expect(within(dialog).getAllByText(STAGED_LAB_DETAIL.subject)).not.toHaveLength(0)
      expect(fetchCertificateDetail).not.toHaveBeenCalled()
    })

    it('eye on a built-in row opens the dialog that fetches the certificate by id', async () => {
      vi.mocked(fetchCertificateDetail).mockResolvedValue(ISRG_DETAIL)
      const user = userEvent.setup()
      renderTab({ publicSource: 'builtin' })
      await user.click(screen.getByRole('button', { name: 'View ISRG Root X1' }))
      expect(await screen.findByRole('dialog', { name: 'ISRG Root X1' })).toBeInTheDocument()
      expect(fetchCertificateDetail).toHaveBeenCalledWith(ISRG.id)
    })

    it('Close dismisses the dialog', async () => {
      const user = userEvent.setup()
      renderTab({ additional: WITH_STAGED, dirty: true })
      await user.click(screen.getByRole('button', { name: 'View Lab Test CA' }))
      const dialog = await screen.findByRole('dialog', { name: 'Lab Test CA' })
      const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' })
      await user.click(closeButtons[closeButtons.length - 1])
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('Add Certificate dialog (NET-8)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    async function openAddDialog(user: ReturnType<typeof userEvent.setup>, which: 'first' | 'last' = 'first') {
      const buttons = screen.getAllByRole('button', { name: 'Add certificate' })
      await user.click(which === 'first' ? buttons[0] : buttons[buttons.length - 1])
      return screen.findByRole('dialog', { name: 'Add Certificate' })
    }

    async function pastePem(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, pem: string) {
      await user.click(within(dialog).getByRole('textbox', { name: 'Certificate PEM' }))
      await user.paste(pem)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
    }

    it('Add certificate opens the Add Certificate dialog', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderTab()
      const dialog = await openAddDialog(user)
      expect(within(dialog).getByRole('textbox', { name: 'Certificate PEM' })).toBeInTheDocument()
    })

    it("the empty state's Add certificate opens the dialog too", async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderTab({ additional: [] })
      expect(await openAddDialog(user, 'last')).toBeInTheDocument()
    })

    it('Add hands the parsed certificates to addCertificates and closes', async () => {
      vi.mocked(parseCertificateText).mockResolvedValue({ certificates: [PARSED_NEW], errors: [] })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const certificates = renderTab()
      const dialog = await openAddDialog(user)
      await pastePem(user, dialog, PARSED_NEW.pem)

      expect(parseCertificateText).toHaveBeenCalled()
      const add = within(dialog).getByRole('button', { name: 'Add' })
      await waitFor(() => expect(add).toBeEnabled())
      await user.click(add)

      await waitFor(() => {
        expect(certificates.addCertificates).toHaveBeenCalledWith([PARSED_NEW])
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Add Certificate' })).not.toBeInTheDocument()
      })
      expect(parseCertificateFile).not.toHaveBeenCalled()
    })

    it('marks a certificate already in the table as "Already added"', async () => {
      vi.mocked(parseCertificateText).mockResolvedValue({ certificates: [PARSED_DUPLICATE], errors: [] })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const certificates = renderTab()
      const dialog = await openAddDialog(user)
      await pastePem(user, dialog, PARSED_DUPLICATE.pem)

      expect(await within(dialog).findByText('Already added')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
      expect(certificates.addCertificates).not.toHaveBeenCalled()
    })

    it('lets a certificate removed in this session be added again', async () => {
      vi.mocked(parseCertificateText).mockResolvedValue({ certificates: [PARSED_DUPLICATE], errors: [] })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const certificates = renderTab({ additional: [SAVED_ISSUING], dirty: true })
      const dialog = await openAddDialog(user)
      await pastePem(user, dialog, PARSED_DUPLICATE.pem)

      const add = within(dialog).getByRole('button', { name: 'Add' })
      await waitFor(() => expect(add).toBeEnabled())
      expect(within(dialog).queryByText('Already added')).not.toBeInTheDocument()
      await user.click(add)
      await waitFor(() => {
        expect(certificates.addCertificates).toHaveBeenCalledWith([PARSED_DUPLICATE])
      })
    })

    it('Cancel closes the dialog and stages nothing', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const certificates = renderTab()
      const dialog = await openAddDialog(user)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Add Certificate' })).not.toBeInTheDocument()
      })
      expect(certificates.addCertificates).not.toHaveBeenCalled()
    })
  })
})
