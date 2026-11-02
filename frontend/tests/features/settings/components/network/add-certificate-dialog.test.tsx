/**
 * Add Certificate dialog (NET-8, REQ-4.5.16): pasted or chosen PEM is parsed
 * into a preview table; Add hands the checked certificates to the page.
 *
 * Component: frontend/src/features/settings/components/network/add-certificate-dialog.tsx
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddCertificateDialog } from '@/features/settings/components/network/add-certificate-dialog'
import {
  parseCertificateFile,
  parseCertificateText,
  type CertificateParse,
  type ParsedCertificate,
} from '@/features/settings/api/certificates'

vi.mock('@/features/settings/api/certificates', () => ({
  parseCertificateText: vi.fn(),
  parseCertificateFile: vi.fn(),
}))

const PARSE_DEBOUNCE_MS = 300

const ISSUING_2_ID = '3f'.repeat(32)
const ROOT_ID = '9b'.repeat(32)
const LAB_ID = 'c4'.repeat(32)
const ISSUING_1_ID = '7e'.repeat(32)

const PRIVATE_KEY_MESSAGE = 'The text contains a private key; paste certificates only'
const NO_CERTIFICATE_MESSAGE = 'No certificate found'
const BAD_FILE_MESSAGE = 'leaf.bin is not a PEM or DER certificate file'

function pemFor(seed: string): string {
  return `-----BEGIN CERTIFICATE-----\nMIIFlTCCA32gAwIBAgIQ${seed}\n-----END CERTIFICATE-----`
}

function makeCertificate(fields: {
  id: string
  name: string
  type: ParsedCertificate['type']
  expires: string
  expired?: boolean
}): ParsedCertificate {
  const expired = fields.expired ?? false
  const pem = pemFor(fields.id.slice(0, 12))
  return {
    id: fields.id,
    name: fields.name,
    type: fields.type,
    expires: fields.expires,
    expired,
    pem,
    detail: {
      id: fields.id,
      name: fields.name,
      subject: `CN=${fields.name}, O=Corp Example Inc., C=US`,
      issuer: 'CN=Corp Root CA, O=Corp Example Inc., C=US',
      type: fields.type,
      path_length: fields.type === 'Root' ? null : 0,
      valid_from: '2024-07-01 00:00:00 UTC',
      valid_to: `${fields.expires} 23:59:59 UTC`,
      status: expired ? 'expired' : 'valid',
      days_to_expiry: expired ? -275 : 600,
      sha256_fingerprint: '3F:9A:C2:71:0B:E4:58:D6:1A:97:2C:FE:40:83:B5:6D',
      serial_number: '4A:1F:0C:93:7E:22:5B:D1',
      key: 'RSA 4096',
      signature_algorithm: 'SHA-256 with RSA',
      key_usage: ['Certificate sign', 'CRL sign'],
      subject_key_id: '8C:21:5E:F0:3A:97:D4:6B',
      authority_key_id: '51:B7:0E:9C:24:F6:83:AD',
      pem,
    },
  }
}

const ISSUING_2 = makeCertificate({
  id: ISSUING_2_ID,
  name: 'Corp Issuing CA 2',
  type: 'Intermediate',
  expires: '2028-06-30',
})
const ROOT = makeCertificate({ id: ROOT_ID, name: 'Corp Root CA', type: 'Root', expires: '2035-03-01' })
const LAB = makeCertificate({
  id: LAB_ID,
  name: 'Lab Test CA 2019',
  type: 'Root',
  expires: '2024-12-31',
  expired: true,
})
const ISSUING_1 = makeCertificate({
  id: ISSUING_1_ID,
  name: 'Corp Issuing CA 1',
  type: 'Intermediate',
  expires: '2027-06-30',
})

const PASTED_TEXT = [ISSUING_2.pem, ROOT.pem, LAB.pem, ISSUING_1.pem].join('\n')

function parsed(
  certificates: ParsedCertificate[],
  errors: CertificateParse['errors'] = [],
): CertificateParse {
  return { certificates, errors }
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

type DialogProps = Parameters<typeof AddCertificateDialog>[0]

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    stagedIds: new Set<string>(),
    onAdd: vi.fn(),
    ...overrides,
  }
  const view = render(<AddCertificateDialog {...props} />)
  return { ...view, props }
}

function pemArea(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Certificate PEM' })
}

function addButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Add' })
}

function dropZone(): HTMLElement {
  return screen.getByRole('button', { name: /Click or drop file here/ })
}

function fileInput(): HTMLInputElement {
  const input = screen.getByRole('dialog').querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('The dialog has no file input')
  return input
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`No table row holds ${name}`)
  return row
}

function rowCheckbox(name: string): HTMLElement {
  return within(rowOf(name)).getByRole('checkbox')
}

function follows(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

function typePem(text: string): void {
  fireEvent.change(pemArea(), { target: { value: text } })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function pasteAndParse(text: string, result: CertificateParse): Promise<void> {
  vi.mocked(parseCertificateText).mockResolvedValueOnce(result)
  typePem(text)
  await advance(PARSE_DEBOUNCE_MS)
}

async function chooseFile(file: File): Promise<void> {
  await act(async () => {
    fireEvent.change(fileInput(), { target: { files: [file] } })
    await vi.advanceTimersByTimeAsync(0)
  })
}

function pemFile(name: string, text: string): File {
  return new File([text], name, { type: 'application/x-pem-file' })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(parseCertificateText).mockReset()
  vi.mocked(parseCertificateFile).mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AddCertificateDialog - opened (NET-8)', () => {
  it('is titled "Add Certificate" with no description', () => {
    renderDialog()

    const dialog = screen.getByRole('dialog', { name: 'Add Certificate' })
    expect(dialog).not.toHaveAttribute('aria-describedby')
  })

  it('starts with an empty PEM text area that has focus', () => {
    renderDialog()

    expect(pemArea()).toHaveValue('')
    expect(pemArea()).toHaveFocus()
  })

  it('names the PEM text area "pem"', () => {
    renderDialog()

    expect(pemArea()).toHaveAttribute('name', 'pem')
  })

  it('shows the compact drop zone with the accepted file types', () => {
    renderDialog()

    expect(dropZone()).toHaveTextContent('Click or drop file here')
    expect(dropZone()).toHaveTextContent('.pem, .crt, or .cer')
    const accepted = (fileInput().getAttribute('accept') ?? '').split(',').map((type) => type.trim())
    expect(accepted).toEqual(expect.arrayContaining(['.pem', '.crt', '.cer']))
  })

  it('opens the file picker when the drop zone is clicked', () => {
    renderDialog()
    const pickerClick = vi.spyOn(fileInput(), 'click').mockImplementation(() => {})

    fireEvent.click(dropZone())

    expect(pickerClick).toHaveBeenCalledTimes(1)
  })

  it('shows no table, no error and a disabled Add', () => {
    renderDialog()

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('has no corner close button', () => {
    renderDialog()

    expect(
      within(screen.getByRole('dialog')).queryByRole('button', { name: 'Close' }),
    ).not.toBeInTheDocument()
  })

  it('sends no parse request before anything is typed', async () => {
    renderDialog()

    await advance(PARSE_DEBOUNCE_MS * 3)

    expect(parseCertificateText).not.toHaveBeenCalled()
    expect(parseCertificateFile).not.toHaveBeenCalled()
  })
})

describe('AddCertificateDialog - debounced parse', () => {
  it('sends one parse request 300 ms after the last change', async () => {
    renderDialog()
    vi.mocked(parseCertificateText).mockResolvedValue(parsed([ROOT]))

    typePem(ISSUING_2.pem)
    await advance(PARSE_DEBOUNCE_MS - 1)
    typePem(PASTED_TEXT)
    await advance(PARSE_DEBOUNCE_MS - 1)

    expect(parseCertificateText).not.toHaveBeenCalled()

    await advance(1)

    expect(parseCertificateText).toHaveBeenCalledTimes(1)
    expect(parseCertificateText).toHaveBeenCalledWith(PASTED_TEXT)
  })

  it('keeps the previous rows and disables Add while the next parse is pending', async () => {
    renderDialog()
    await pasteAndParse(ROOT.pem, parsed([ROOT]))
    expect(addButton()).toBeEnabled()

    typePem(PASTED_TEXT)

    expect(rowOf('Corp Root CA')).toBeInTheDocument()
    expect(addButton()).toBeDisabled()

    const inFlight = deferred<CertificateParse>()
    vi.mocked(parseCertificateText).mockReturnValueOnce(inFlight.promise)
    await advance(PARSE_DEBOUNCE_MS)

    expect(parseCertificateText).toHaveBeenLastCalledWith(PASTED_TEXT)
    expect(rowOf('Corp Root CA')).toBeInTheDocument()
    expect(addButton()).toBeDisabled()

    await act(async () => {
      inFlight.resolve(parsed([ISSUING_2, ROOT]))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(rowOf('Corp Issuing CA 2')).toBeInTheDocument()
    expect(rowCheckbox('Corp Issuing CA 2')).toBeChecked()
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('keeps the previous errors while the next parse is pending', async () => {
    renderDialog()
    await pasteAndParse('not a certificate', parsed([], [{ index: null, message: NO_CERTIFICATE_MESSAGE }]))

    typePem(ROOT.pem)

    expect(screen.getByText(NO_CERTIFICATE_MESSAGE)).toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('clears the preview without a request when the text is emptied', async () => {
    renderDialog()
    await pasteAndParse(ROOT.pem, parsed([ROOT]))

    typePem('')
    await advance(PARSE_DEBOUNCE_MS * 2)

    expect(parseCertificateText).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })
})

describe('AddCertificateDialog - parsed preview', () => {
  it('lists every certificate under Name, Type and Expires, checked', async () => {
    renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ISSUING_2, ROOT, LAB, ISSUING_1]))

    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Type/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Expires/ })).toBeInTheDocument()

    const issuing = rowOf('Corp Issuing CA 2')
    expect(within(issuing).getByText('Intermediate')).toBeInTheDocument()
    expect(within(issuing).getByText('2028-06-30')).toBeInTheDocument()
    const root = rowOf('Corp Root CA')
    expect(within(root).getByText('Root')).toBeInTheDocument()
    expect(within(root).getByText('2035-03-01')).toBeInTheDocument()

    for (const name of ['Corp Issuing CA 2', 'Corp Root CA', 'Lab Test CA 2019', 'Corp Issuing CA 1']) {
      expect(rowCheckbox(name)).toBeChecked()
    }
    expect(addButton()).toBeEnabled()
  })

  it('gives Type 128px and Expires 184px and leaves the rest to Name', async () => {
    renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ROOT]))

    expect(screen.getByRole('columnheader', { name: /Type/ })).toHaveClass('w-32')
    expect(screen.getByRole('columnheader', { name: /Expires/ })).toHaveClass('w-46')
    expect(screen.getByRole('columnheader', { name: /Name/ }).className).not.toMatch(/\bw-/)
  })

  it('shows the error "Expired" badge after the date and keeps the row checked and allowed', async () => {
    renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ROOT, LAB]))

    const lab = rowOf('Lab Test CA 2019')
    const date = within(lab).getByText('2024-12-31')
    const badge = within(lab).getByText('Expired')
    expect(badge).toHaveClass('badge-error')
    expect(follows(date, badge)).toBe(true)

    const checkbox = within(lab).getByRole('checkbox')
    expect(checkbox).toBeChecked()
    expect(checkbox).not.toHaveAttribute('aria-disabled', 'true')
    expect(within(rowOf('Corp Root CA')).queryByText('Expired')).not.toBeInTheDocument()
    expect(addButton()).toBeEnabled()
  })

  it('marks a certificate already staged "Already added" after its name, unchecked and disabled', async () => {
    renderDialog({ stagedIds: new Set([ISSUING_1_ID]) })
    await pasteAndParse(PASTED_TEXT, parsed([ISSUING_2, ROOT, ISSUING_1]))

    const staged = rowOf('Corp Issuing CA 1')
    const name = within(staged).getByText('Corp Issuing CA 1')
    const marker = within(staged).getByText('Already added')
    expect(follows(name, marker)).toBe(true)

    const checkbox = within(staged).getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAttribute('aria-disabled', 'true')
    expect(checkbox).toHaveAccessibleName(/Corp Issuing CA 1.*Already added/)

    expect(within(rowOf('Corp Root CA')).queryByText('Already added')).not.toBeInTheDocument()
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('ignores clicks on an "Already added" row and its checkbox', async () => {
    renderDialog({ stagedIds: new Set([ISSUING_1_ID]) })
    await pasteAndParse(PASTED_TEXT, parsed([ROOT, ISSUING_1]))

    fireEvent.click(rowCheckbox('Corp Issuing CA 1'))
    fireEvent.click(screen.getByText('Corp Issuing CA 1'))

    expect(rowCheckbox('Corp Issuing CA 1')).not.toBeChecked()
  })

  it('skips "Already added" rows when everything is selected again', async () => {
    renderDialog({ stagedIds: new Set([ISSUING_1_ID]) })
    await pasteAndParse(PASTED_TEXT, parsed([ISSUING_2, ROOT, ISSUING_1]))
    const selectAll = screen.getByRole('checkbox', { name: 'Select all' })

    fireEvent.click(selectAll)

    expect(rowCheckbox('Corp Issuing CA 2')).not.toBeChecked()
    expect(rowCheckbox('Corp Root CA')).not.toBeChecked()
    expect(addButton()).toBeDisabled()

    fireEvent.click(selectAll)

    expect(rowCheckbox('Corp Issuing CA 2')).toBeChecked()
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(rowCheckbox('Corp Issuing CA 1')).not.toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('disables Add when every row is "Already added"', async () => {
    renderDialog({ stagedIds: new Set([ROOT_ID, ISSUING_1_ID]) })
    await pasteAndParse(PASTED_TEXT, parsed([ROOT, ISSUING_1]))

    for (const name of ['Corp Root CA', 'Corp Issuing CA 1']) {
      expect(within(rowOf(name)).getByText('Already added')).toBeInTheDocument()
      expect(rowCheckbox(name)).not.toBeChecked()
      expect(rowCheckbox(name)).toHaveAttribute('aria-disabled', 'true')
    }
    expect(addButton()).toBeDisabled()
  })

  it('disables Add once every row is unchecked', async () => {
    renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ISSUING_2, ROOT]))

    fireEvent.click(rowCheckbox('Corp Issuing CA 2'))
    expect(addButton()).toBeEnabled()

    fireEvent.click(rowCheckbox('Corp Root CA'))
    expect(addButton()).toBeDisabled()
  })
})

describe('AddCertificateDialog - errors (section 2.5 messages)', () => {
  it('lists each error verbatim under the table with the good rows still shown', async () => {
    renderDialog()
    await pasteAndParse(
      PASTED_TEXT,
      parsed(
        [ROOT],
        [
          { index: 2, message: 'Certificate 2: not a CA certificate' },
          { index: 3, message: 'Certificate 3: not a valid certificate' },
        ],
      ),
    )

    const notCa = screen.getByText('Certificate 2: not a CA certificate')
    const invalid = screen.getByText('Certificate 3: not a valid certificate')
    expect(follows(screen.getByRole('table'), notCa)).toBe(true)
    expect(follows(notCa, invalid)).toBe(true)
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('announces the error lines in one polite live region', async () => {
    renderDialog()
    await pasteAndParse(
      PASTED_TEXT,
      parsed(
        [ROOT],
        [
          { index: 2, message: 'Certificate 2: not a CA certificate' },
          { index: 3, message: 'Certificate 3: not a valid certificate' },
        ],
      ),
    )

    const region = screen.getByText('Certificate 2: not a CA certificate').closest('[aria-live="polite"]')
    expect(region).not.toBeNull()
    expect(screen.getByText('Certificate 3: not a valid certificate').closest('[aria-live="polite"]')).toBe(
      region,
    )
  })

  it('refuses text holding a private key: message, no table, Add disabled', async () => {
    renderDialog()
    await pasteAndParse(
      `${ROOT.pem}\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----`,
      parsed([], [{ index: null, message: PRIVATE_KEY_MESSAGE }]),
    )

    expect(screen.getByText(PRIVATE_KEY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('says "No certificate found" for text without a certificate block', async () => {
    renderDialog()
    await pasteAndParse('hello world', parsed([], [{ index: null, message: NO_CERTIFICATE_MESSAGE }]))

    expect(screen.getByText(NO_CERTIFICATE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })

  it('shows the API message when the parse request fails', async () => {
    renderDialog()
    vi.mocked(parseCertificateText).mockRejectedValueOnce(new Error('Service Unavailable'))

    typePem(PASTED_TEXT)
    await advance(PARSE_DEBOUNCE_MS)

    expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })
})

describe('AddCertificateDialog - chosen file', () => {
  it('parses a chosen file once and replaces the text with the returned PEM', async () => {
    renderDialog()
    const zone = dropZone()
    const file = pemFile('corp-chain.pem', PASTED_TEXT)
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(parsed([ISSUING_2, ROOT]))

    await chooseFile(file)

    expect(parseCertificateFile).toHaveBeenCalledTimes(1)
    expect(parseCertificateFile).toHaveBeenCalledWith(file)
    expect(pemArea()).toHaveValue(`${ISSUING_2.pem}\n${ROOT.pem}`)
    expect(zone).toHaveTextContent('corp-chain.pem')
    expect(rowCheckbox('Corp Issuing CA 2')).toBeChecked()
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(addButton()).toBeEnabled()
  })

  it('sends no text parse request for the PEM a file put in the text area', async () => {
    renderDialog()
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(parsed([ROOT]))

    await chooseFile(pemFile('root.crt', ROOT.pem))
    await advance(PARSE_DEBOUNCE_MS * 3)

    expect(parseCertificateText).not.toHaveBeenCalled()
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
  })

  it('parses the text again once it is edited after a file', async () => {
    renderDialog()
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(parsed([ROOT]))
    await chooseFile(pemFile('root.crt', ROOT.pem))

    const edited = `${ROOT.pem}\n${ISSUING_2.pem}`
    await pasteAndParse(edited, parsed([ROOT, ISSUING_2]))

    expect(parseCertificateText).toHaveBeenCalledTimes(1)
    expect(parseCertificateText).toHaveBeenCalledWith(edited)
    expect(rowCheckbox('Corp Issuing CA 2')).toBeChecked()
  })

  it('shows the errors the file response carries beside its rows', async () => {
    renderDialog()
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(
      parsed([ROOT], [{ index: 2, message: 'Certificate 2: not a CA certificate' }]),
    )

    await chooseFile(pemFile('bundle.pem', PASTED_TEXT))

    expect(rowCheckbox('Corp Root CA')).toBeChecked()
    expect(screen.getByText('Certificate 2: not a CA certificate')).toBeInTheDocument()
  })

  it('parses a dropped file the same way', async () => {
    renderDialog()
    const file = pemFile('dropped.cer', ROOT.pem)
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(parsed([ROOT]))

    await act(async () => {
      fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } })
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(parseCertificateFile).toHaveBeenCalledWith(file)
    expect(pemArea()).toHaveValue(ROOT.pem)
    expect(rowCheckbox('Corp Root CA')).toBeChecked()
  })

  it('keeps the text, names the file and shows the message for a bad file', async () => {
    renderDialog()
    await pasteAndParse(ROOT.pem, parsed([ROOT]))
    const zone = dropZone()
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(
      parsed([], [{ index: null, message: BAD_FILE_MESSAGE }]),
    )

    await chooseFile(new File([new Uint8Array([0x7f, 0x45, 0x4c, 0x46])], 'leaf.bin'))

    expect(pemArea()).toHaveValue(ROOT.pem)
    expect(zone).toHaveTextContent('leaf.bin')
    expect(screen.getByText(BAD_FILE_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    expect(parseCertificateText).toHaveBeenCalledTimes(1)
  })

  it('ignores a file response that arrives after the text was edited', async () => {
    renderDialog()
    const inFlight = deferred<CertificateParse>()
    vi.mocked(parseCertificateFile).mockReturnValueOnce(inFlight.promise)
    await chooseFile(pemFile('root.crt', ROOT.pem))

    await pasteAndParse(ISSUING_2.pem, parsed([ISSUING_2]))
    await act(async () => {
      inFlight.resolve(parsed([ROOT]))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(pemArea()).toHaveValue(ISSUING_2.pem)
    expect(rowCheckbox('Corp Issuing CA 2')).toBeChecked()
    expect(screen.queryByText('Corp Root CA')).not.toBeInTheDocument()
    expect(dropZone()).not.toHaveTextContent('root.crt')
  })

  it('shows the API message when the file request fails', async () => {
    renderDialog()
    vi.mocked(parseCertificateFile).mockRejectedValueOnce(new Error('Payload Too Large'))

    await chooseFile(pemFile('huge.pem', PASTED_TEXT))

    expect(screen.getByText('Payload Too Large')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
  })
})

describe('AddCertificateDialog - Add, Cancel and Esc', () => {
  it('hands onAdd the checked certificates in table order and closes', async () => {
    const { props } = renderDialog({ stagedIds: new Set([ISSUING_1_ID]) })
    await pasteAndParse(PASTED_TEXT, parsed([ISSUING_2, ROOT, LAB, ISSUING_1]))
    fireEvent.click(rowCheckbox('Corp Root CA'))

    await act(async () => {
      fireEvent.click(addButton())
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(props.onAdd).toHaveBeenCalledTimes(1)
    expect(props.onAdd).toHaveBeenCalledWith([ISSUING_2, LAB])
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Cancel without staging anything or asking', async () => {
    const { props } = renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ROOT]))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onAdd).not.toHaveBeenCalled()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('closes on Esc without staging anything', async () => {
    const { props } = renderDialog()
    await pasteAndParse(PASTED_TEXT, parsed([ROOT]))

    fireEvent.keyDown(pemArea(), { key: 'Escape' })

    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(props.onAdd).not.toHaveBeenCalled()
  })

  it('opens fresh after being closed', async () => {
    const { props, rerender } = renderDialog()
    vi.mocked(parseCertificateFile).mockResolvedValueOnce(parsed([ROOT]))
    await chooseFile(pemFile('root.crt', ROOT.pem))
    expect(rowCheckbox('Corp Root CA')).toBeChecked()

    rerender(<AddCertificateDialog {...props} open={false} />)
    rerender(<AddCertificateDialog {...props} open />)
    await advance(PARSE_DEBOUNCE_MS * 2)

    expect(pemArea()).toHaveValue('')
    expect(dropZone()).not.toHaveTextContent('root.crt')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(addButton()).toBeDisabled()
    expect(parseCertificateText).not.toHaveBeenCalled()
  })
})
