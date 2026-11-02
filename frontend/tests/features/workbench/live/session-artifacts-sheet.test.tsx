/**
 * SessionArtifactsSheet - the floating workbench sheet listing the live
 * session's artifact files (ARTIF-15 / ARTIF-16,
 * wireframe session-artifacts-sheet-{light,dark}).
 *
 * Module: frontend/src/features/workbench/live/session-artifacts-sheet.tsx
 *
 * Renders through the real DraggableSheet shell (data-testid
 * "session-artifacts-sheet", ariaLabel "Session Artifacts", ESC closes).
 * Rows reuse the promoted shared FileRow: name, folder subtitle for
 * nested paths, size, download + delete. Delete buttons are hidden for
 * tracked sessions. Header meta shows "{N} files - {total size}";
 * the footer pins the temporary-lifecycle note; the empty state explains
 * where files come from.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

const fileRowSpy = vi.hoisted(() => vi.fn())

vi.mock('@/components/shared/file-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/file-row')>()
  const { createElement } = await import('react')
  const Actual = actual.FileRow
  return {
    ...actual,
    FileRow: (props: Parameters<typeof Actual>[0]) => {
      fileRowSpy(props)
      return createElement(Actual, props)
    },
  }
})

import { SessionArtifactsSheet } from '@/features/workbench/live/session-artifacts-sheet'

const THREE_ITEMS = [
  { path: 'report.json', size_bytes: 12288, created_at: '2026-07-02T10:00:00+00:00' },
  { path: 'output/data.json', size_bytes: 4403, created_at: '2026-07-02T10:00:01+00:00' },
  { path: 'logs/run.log', size_bytes: 1024, created_at: '2026-07-02T10:00:02+00:00' },
]
const THREE_ITEMS_TOTAL = 12288 + 4403 + 1024 // 17715 -> "17.3 KB"

function renderSheet(props: Partial<ComponentProps<typeof SessionArtifactsSheet>> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    onDownload: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    <SessionArtifactsSheet
      open
      items={THREE_ITEMS}
      count={THREE_ITEMS.length}
      totalBytes={THREE_ITEMS_TOTAL}
      isTracked={false}
      running={false}
      pollError={null}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe('SessionArtifactsSheet - shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    renderSheet({ open: false })

    expect(screen.queryByTestId('session-artifacts-sheet')).not.toBeInTheDocument()
  })

  it('renders the floating sheet with its accessible name and title', () => {
    renderSheet()

    const sheet = screen.getByTestId('session-artifacts-sheet')
    expect(sheet).toHaveAttribute('aria-label', 'Session Artifacts')
    expect(within(sheet).getByText('Session Artifacts')).toBeInTheDocument()
  })

  it('closes via ESC (DraggableSheet built-in)', () => {
    const handlers = renderSheet()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('SessionArtifactsSheet - populated state (ARTIF-15)', () => {
  it('shows the header meta "{N} files - {total size}"', () => {
    renderSheet()

    expect(screen.getByText('3 files - 17.3 KB')).toBeInTheDocument()
  })

  it('renders one row per artifact with name and size', () => {
    renderSheet()

    expect(screen.getByText('report.json')).toBeInTheDocument()
    expect(screen.getByText('data.json')).toBeInTheDocument()
    expect(screen.getByText('run.log')).toBeInTheDocument()
    expect(screen.getByText('12.0 KB')).toBeInTheDocument()
    expect(screen.getByText('4.3 KB')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()
  })

  it('shows a folder subtitle only for nested paths', () => {
    renderSheet()

    const subtitles = screen.getAllByTestId('artifact-file-subtitle')
    const texts = subtitles.map((el) => el.textContent)
    expect(texts).toContain('output')
    expect(texts).toContain('logs')
    // The root-level report.json has no subtitle row.
    expect(subtitles).toHaveLength(2)
  })

  it('shows the temporary-lifecycle footer note', () => {
    renderSheet()

    expect(
      screen.getByText(
        'Session artifacts are temporary - they are deleted when the session is reset, replaced, or closed.'
      )
    ).toBeInTheDocument()
  })

  it('calls onDownload with the item path', async () => {
    const user = userEvent.setup()
    const handlers = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Download data.json' }))

    expect(handlers.onDownload).toHaveBeenCalledWith('output/data.json')
  })

  it('asks before deleting and reports the path only on confirm', async () => {
    const user = userEvent.setup()
    const handlers = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Delete report.json' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Delete "report.json"?')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(handlers.onDelete).toHaveBeenCalledWith('report.json')
  })

  it('keeps the file when the delete is canceled', async () => {
    const user = userEvent.setup()
    const handlers = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Delete report.json' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handlers.onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('closes from the header action', async () => {
    const user = userEvent.setup()
    const handlers = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onRefresh from the header refresh action', async () => {
    const user = userEvent.setup()
    const handlers = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Refresh artifacts' }))

    expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('SessionArtifactsSheet - tracked session', () => {
  it('hides every per-row delete button but keeps downloads', () => {
    renderSheet({ isTracked: true })

    expect(screen.queryByRole('button', { name: /^delete /i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download report.json' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download data.json' })).toBeInTheDocument()
  })
})

describe('SessionArtifactsSheet - empty state', () => {
  it('shows the empty-state copy and hides the header meta', () => {
    renderSheet({ items: [], count: 0, totalBytes: 0 })

    expect(screen.getByText('No artifacts in this session yet')).toBeInTheDocument()
    expect(
      screen.getByText('Files written by plugins during a run appear here.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/0 files/)).not.toBeInTheDocument()
  })

  it('renders no artifact rows when empty', () => {
    renderSheet({ items: [], count: 0, totalBytes: 0 })

    expect(screen.queryByTestId('file-row')).not.toBeInTheDocument()
  })
})

describe('SessionArtifactsSheet - poll failure notice (LIST-26)', () => {
  it('renders the stale notice beside the data when a poll tick failed', () => {
    renderSheet({ pollError: 'HTTP 500' })

    const notice = screen.getByTestId('session-artifacts-refresh-error')
    expect(notice).toHaveAttribute('role', 'alert')
    expect(notice).toHaveTextContent('HTTP 500 (showing the last known state)')
    // The last known list stays on screen beside the notice.
    expect(screen.getByText('report.json')).toBeInTheDocument()
  })

  it('renders no stale notice while ticks succeed', () => {
    renderSheet()

    expect(screen.queryByTestId('session-artifacts-refresh-error')).not.toBeInTheDocument()
  })

  it('shows the stale notice even when the last known list is empty', () => {
    renderSheet({ items: [], count: 0, totalBytes: 0, pollError: 'boom' })

    expect(screen.getByTestId('session-artifacts-refresh-error')).toHaveTextContent(
      'boom (showing the last known state)'
    )
    expect(screen.getByText('No artifacts in this session yet')).toBeInTheDocument()
  })
})

describe('SessionArtifactsSheet - copy path on every row', () => {
  beforeEach(() => {
    fileRowSpy.mockClear()
  })

  it('gives each row the artifact reference of its full session path', () => {
    renderSheet()

    expect(fileRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report.json', copyPath: 'artifact://report.json' }),
    )
    expect(fileRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'data.json', copyPath: 'artifact://output/data.json' }),
    )
  })

  it('renders Copy path before Download on a row', () => {
    renderSheet()

    const copy = screen.getByRole('button', { name: 'Copy path of data.json' })
    const download = screen.getByRole('button', { name: 'Download data.json' })

    expect(copy).toHaveAttribute('data-testid', 'copy-path-button')
    expect(
      Boolean(copy.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })

  it('keeps Copy path on a tracked session, where delete is hidden', () => {
    renderSheet({ isTracked: true })

    expect(screen.getByRole('button', { name: 'Copy path of report.json' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^delete /i })).not.toBeInTheDocument()
  })

  it('renders the shared file row under its renamed test id', () => {
    renderSheet()

    expect(screen.getAllByTestId('file-row')).toHaveLength(3)
    expect(screen.queryByTestId('artifact-file-row')).not.toBeInTheDocument()
  })
})
