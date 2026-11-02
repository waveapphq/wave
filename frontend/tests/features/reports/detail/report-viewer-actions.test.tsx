/**
 * ReportViewerActions Tests
 *
 * Header action buttons (RVIEW-1): Download JSON downloads the existing
 * artifact immediately; Export HTML runs the ensureReport orchestration
 * for the html format, disables the button with an "Exporting…" label
 * while in flight, downloads the produced artifact, and surfaces
 * failures as an error toast carrying the backend message.
 *
 * Module: frontend/src/features/reports/detail/report-viewer-actions.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastContainer, ToastProvider } from '@/components/ui/toast'

vi.mock('@/features/reports/api/reports', () => ({
  ensureReport: vi.fn(),
  fetchReportJson: vi.fn(),
}))

vi.mock('@/features/reports/api/download', () => ({
  downloadReportArtifact: vi.fn(),
}))

import { ensureReport } from '@/features/reports/api/reports'
import { downloadReportArtifact } from '@/features/reports/api/download'
import { ReportViewerActions } from '@/features/reports/detail/report-viewer-actions'

function renderActions(props: Partial<Parameters<typeof ReportViewerActions>[0]> = {}) {
  return render(
    <ToastProvider>
      <ReportViewerActions
        executionId="exec-1"
        jsonArtifactId="dir-1/report.v1.json"
        {...props}
      />
      <ToastContainer />
    </ToastProvider>,
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReportViewerActions - Download JSON', () => {
  it('downloads the existing JSON artifact with a report fallback filename', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadReportArtifact).mockResolvedValue(undefined as never)
    renderActions()

    await user.click(screen.getByTestId('download-json-btn'))

    await waitFor(() => {
      expect(downloadReportArtifact).toHaveBeenCalledWith(
        'dir-1/report.v1.json',
        'report-exec-1.json',
      )
    })
    expect(ensureReport).not.toHaveBeenCalled()
  })

  it('is disabled when no JSON artifact id is available yet', () => {
    renderActions({ jsonArtifactId: null })

    expect(screen.getByTestId('download-json-btn')).toBeDisabled()
  })
})

describe('ReportViewerActions - Export HTML', () => {
  it('ensures the html report and downloads the produced artifact', async () => {
    const user = userEvent.setup()
    vi.mocked(ensureReport).mockResolvedValue({ artifactId: 'dir-1/report.v1.html' } as never)
    vi.mocked(downloadReportArtifact).mockResolvedValue(undefined as never)
    renderActions()

    await user.click(screen.getByTestId('export-html-btn'))

    await waitFor(() => {
      expect(ensureReport).toHaveBeenCalledWith('exec-1', 'html', expect.any(Object))
    })
    await waitFor(() => {
      expect(downloadReportArtifact).toHaveBeenCalledWith(
        'dir-1/report.v1.html',
        'report-exec-1.html',
      )
    })
  })

  it('disables the button and shows "Exporting…" while the export is in flight', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ artifactId: string }>()
    vi.mocked(ensureReport).mockReturnValue(pending.promise as never)
    renderActions()

    await user.click(screen.getByTestId('export-html-btn'))

    const button = screen.getByTestId('export-html-btn')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Exporting…')

    pending.resolve({ artifactId: 'dir-1/report.v1.html' })
    await waitFor(() => {
      expect(screen.getByTestId('export-html-btn')).toBeEnabled()
    })
    expect(screen.getByTestId('export-html-btn')).toHaveTextContent('Export HTML')
  })

  it('shows the export progress when ensure reports ticks', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ artifactId: string }>()
    let onProgress: ((p: { processed: number; total: number }) => void) | undefined
    vi.mocked(ensureReport).mockImplementation(((
      _id: string,
      _format: string,
      opts: { onProgress?: (p: { processed: number; total: number }) => void },
    ) => {
      onProgress = opts.onProgress
      return pending.promise
    }) as never)
    renderActions()

    await user.click(screen.getByTestId('export-html-btn'))
    await waitFor(() => {
      expect(onProgress).toBeDefined()
    })
    act(() => {
      onProgress!({ processed: 2, total: 5 })
    })

    await waitFor(() => {
      expect(screen.getByTestId('export-html-btn')).toHaveTextContent('2/5')
    })
    await act(async () => {
      pending.resolve({ artifactId: 'dir-1/report.v1.html' })
    })
  })

  it('surfaces an export failure as an error toast with the backend message and restores the button', async () => {
    const user = userEvent.setup()
    vi.mocked(ensureReport).mockRejectedValue(
      Object.assign(new Error('model build exploded'), { kind: 'job-failed' }),
    )
    renderActions()

    await user.click(screen.getByTestId('export-html-btn'))

    expect(await screen.findByText(/model build exploded/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('export-html-btn')).toBeEnabled()
    })
    expect(downloadReportArtifact).not.toHaveBeenCalled()
  })
})
