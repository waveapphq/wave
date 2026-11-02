/**
 * TestDataUploadRow - the row one file owns while it arrives, and after it did
 * not (TDATA-14, TDATA-17).
 *
 * Module: frontend/src/features/workbench/common/testdata/testdata-upload-row.tsx
 *
 * A short upload shows a spinner and nothing else, so a small file does not
 * flash a progress bar. Once a file has been going for three seconds its row
 * shows how far it got, how long the server says it has left, and a Cancel that
 * ends that file alone. Neither figure is worked out here: both come off the
 * row, so every session watching shows the same ones. A file that did not land
 * keeps its row with the reason and the way back - the same bytes, or a file the
 * person picks - until it is dismissed. A file somebody stopped leaves an amber
 * row with a Dismiss and nothing else.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { TestDataUploadRow } from '@/features/workbench/common/testdata/testdata-upload-row'
import type { TestDataUpload } from '@/features/workbench/common/testdata/use-testdata'

const START = new Date('2026-09-07T10:00:00.000Z').getTime()
const REFUSED = 'Storing big.bin would leave less than 1 GB free'

function upload(overrides: Partial<TestDataUpload> = {}): TestDataUpload {
  return {
    id: 'u1',
    name: 'big.bin',
    folder: '',
    path: 'big.bin',
    loaded: 0,
    total: 10_000_000,
    eta: null,
    startedAt: START,
    status: 'uploading',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  }
}

function interrupted(overrides: Partial<TestDataUpload> = {}): TestDataUpload {
  return upload({
    status: 'interrupted',
    failure: REFUSED,
    retry: vi.fn(),
    cancel: null,
    ...overrides,
  })
}

function canceled(overrides: Partial<TestDataUpload> = {}): TestDataUpload {
  return upload({ status: 'canceled', cancel: null, ...overrides })
}

function row(name: string): HTMLElement {
  return screen.getByTestId(`testdata-upload-${name}`)
}

function chooseInput(name: string): HTMLInputElement {
  return screen.getByTestId(`testdata-choose-input-${name}`) as HTMLInputElement
}

function pickedFile(name: string): File {
  return new File(['x'], name, { type: 'application/octet-stream' })
}

/** Render one row, or several, as the tree does: at a depth, on a shared clock. */
function renderRows(uploads: TestDataUpload[], elapsedMs = 0): void {
  render(
    <>
      {uploads.map((upload) => (
        <TestDataUploadRow key={upload.id} upload={upload} indent={1} now={START + elapsedMs} />
      ))}
    </>
  )
}

describe('TestDataUploadRow - the first three seconds', () => {
  it('shows a spinner and no progress detail', () => {
    renderRows([upload()])

    expect(screen.getByLabelText('Uploading big.bin')).toBeInTheDocument()
    expect(screen.queryByTestId('testdata-upload-percent')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-upload-eta')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel upload of big.bin' })).not.toBeInTheDocument()
  })

  it('names the file being uploaded', () => {
    renderRows([upload()])

    expect(row('big.bin')).toHaveTextContent('big.bin')
    expect(row('big.bin')).toHaveAttribute('data-upload-status', 'uploading')
  })

  it('still shows only the spinner half a second before the third', () => {
    renderRows([upload()], 2_500)

    expect(screen.queryByTestId('testdata-upload-percent')).not.toBeInTheDocument()
  })

  it('lines the row up with the entries in the same folder', () => {
    renderRows([upload()])

    expect(row('big.bin')).toHaveStyle({ paddingLeft: '2.25rem' })
    expect(row('big.bin')).toHaveAttribute('data-upload-folder', '')
  })
})

describe('TestDataUploadRow - from three seconds on', () => {
  it('shows how far the file got, from the count the server keeps', () => {
    renderRows([upload({ loaded: 2_500_000 })], 3_000)

    expect(screen.getByTestId('testdata-upload-percent')).toHaveTextContent('25%')
  })

  it('shows the time left the server worked out, and never works one out itself', () => {
    renderRows([upload({ loaded: 2_500_000, eta: 9 })], 3_000)

    expect(screen.getByTestId('testdata-upload-eta')).toHaveTextContent('9s left')
  })

  it('says it is still being worked out while the server has no figure', () => {
    renderRows([upload({ loaded: 2_500_000 })], 3_000)

    expect(screen.getByTestId('testdata-upload-eta')).toHaveTextContent('Estimating')
  })

  it('shows nothing sent for a size the server does not know', () => {
    renderRows([upload({ total: 0 })], 3_000)

    expect(screen.getByTestId('testdata-upload-percent')).toHaveTextContent('0%')
    expect(screen.getByTestId('testdata-upload-eta')).toHaveTextContent('Estimating')
  })

  it('names each progress bar after its file', () => {
    const one = upload({ id: 'u1', name: 'big.bin', loaded: 1 })
    const two = upload({ id: 'u2', name: 'users.csv', loaded: 1 })
    renderRows([one, two], 3_000)

    expect(
      within(row('big.bin')).getByRole('progressbar', { name: 'Upload progress of big.bin' })
    ).toBeInTheDocument()
    expect(
      within(row('users.csv')).getByRole('progressbar', { name: 'Upload progress of users.csv' })
    ).toBeInTheDocument()
  })

  it('offers Cancel for that file alone', () => {
    const one = upload({ id: 'u1', name: 'big.bin' })
    const two = upload({ id: 'u2', name: 'users.csv' })
    renderRows([one, two], 3_000)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload of big.bin' }))

    expect(one.cancel).toHaveBeenCalledTimes(1)
    expect(two.cancel).not.toHaveBeenCalled()
  })

  it('offers no Cancel where this session may not stop the upload', () => {
    renderRows([upload({ cancel: null, loaded: 1 })], 3_000)

    expect(screen.getByTestId('testdata-upload-percent')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel upload of big.bin' })).not.toBeInTheDocument()
  })

  it('keeps each file on its own clock', () => {
    const older = upload({ id: 'u1', name: 'big.bin', loaded: 1 })
    const newer = upload({ id: 'u2', name: 'users.csv', startedAt: START + 2_000, loaded: 1 })
    renderRows([older, newer], 3_000)

    expect(within(row('big.bin')).getByTestId('testdata-upload-percent')).toBeInTheDocument()
    expect(within(row('users.csv')).queryByTestId('testdata-upload-percent')).toBeNull()
  })
})

describe('TestDataUploadRow - a file that did not land', () => {
  it('keeps the row and shows the reason', () => {
    renderRows([interrupted()])

    expect(row('big.bin')).toHaveTextContent(REFUSED)
    expect(row('big.bin')).toHaveAttribute('data-upload-status', 'interrupted')
  })

  it('offers Dismiss instead of Cancel, and no progress', () => {
    const failed = interrupted()
    renderRows([failed], 5_000)

    expect(screen.queryByTestId('testdata-upload-percent')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Uploading big.bin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel upload of big.bin' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss big.bin' }))

    expect(failed.dismiss).toHaveBeenCalledTimes(1)
  })

  it('offers Retry while this tab still holds the bytes', () => {
    const failed = interrupted()
    renderRows([failed])

    fireEvent.click(screen.getByRole('button', { name: 'Retry big.bin' }))

    expect(failed.retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Choose file for big.bin' })).not.toBeInTheDocument()
  })

  it('offers no Retry where the row carries none', () => {
    renderRows([interrupted({ retry: null })])

    expect(screen.queryByRole('button', { name: 'Retry big.bin' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss big.bin' })).toBeInTheDocument()
  })

  it('offers Choose file where this tab no longer holds the bytes', () => {
    renderRows([interrupted({ retry: null, chooseFile: vi.fn() })])

    expect(screen.getByRole('button', { name: 'Choose file for big.bin' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry big.bin' })).not.toBeInTheDocument()
  })

  it('opens the hidden input from the Choose file button', () => {
    renderRows([interrupted({ retry: null, chooseFile: vi.fn() })])
    const click = vi.spyOn(chooseInput('big.bin'), 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Choose file for big.bin' }))

    expect(click).toHaveBeenCalledTimes(1)
  })

  it('reports the file the user picked and clears the input', () => {
    const chooseFile = vi.fn()
    renderRows([interrupted({ retry: null, chooseFile })])
    const input = chooseInput('big.bin')

    fireEvent.change(input, { target: { files: [pickedFile('big.bin')] } })

    expect(chooseFile).toHaveBeenCalledTimes(1)
    expect(chooseFile.mock.calls[0][0]).toBeInstanceOf(File)
    expect(input.value).toBe('')
  })

  it('reports nothing when the picker closes with no file', () => {
    const chooseFile = vi.fn()
    renderRows([interrupted({ retry: null, chooseFile })])

    fireEvent.change(chooseInput('big.bin'), { target: { files: [] } })

    expect(chooseFile).not.toHaveBeenCalled()
  })

  it('leaves the files still running alone', () => {
    const failed = interrupted({ id: 'u1', name: 'big.bin' })
    const running = upload({ id: 'u2', name: 'users.csv', loaded: 5_000_000 })
    renderRows([failed, running], 3_000)

    expect(within(row('users.csv')).getByTestId('testdata-upload-percent')).toHaveTextContent('50%')
    expect(within(row('big.bin')).queryByTestId('testdata-upload-percent')).toBeNull()
  })
})

describe('TestDataUploadRow - a file somebody stopped', () => {
  it('says it was canceled, with no progress and no Cancel', () => {
    renderRows([canceled({ loaded: 2_500_000 })], 5_000)

    expect(within(row('big.bin')).getByText('Canceled')).toBeInTheDocument()
    expect(row('big.bin')).toHaveAttribute('data-upload-status', 'canceled')
    expect(screen.queryByTestId('testdata-upload-percent')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-upload-eta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Uploading big.bin')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel upload of big.bin' })).not.toBeInTheDocument()
  })

  it('carries a Dismiss and nothing else', () => {
    const stopped = canceled()
    renderRows([stopped])

    expect(screen.queryByRole('button', { name: 'Retry big.bin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose file for big.bin' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss big.bin' }))

    expect(stopped.dismiss).toHaveBeenCalledTimes(1)
  })
})
