/**
 * Artifact delete flow - type-to-confirm, single + bulk, in-progress guard
 *
 * Modules:
 *   frontend/src/features/artifacts/components/artifacts-row-actions.tsx
 *   frontend/src/features/artifacts/components/artifacts-bulk-actions.tsx
 *
 * Landing-list rows expose a chevron (open drill) + kebab (Download .zip,
 * Delete artifacts). Mass actions expose Download (.zip) + Delete artifacts -
 * no "view". Every destructive delete (single or bulk) is gated behind the
 * shared ConfirmationDialog's type-to-confirm input. An in-progress execution's
 * delete is disabled (the backend 409s on it).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArtifactsRowActions } from '@/features/artifacts/components/artifacts-row-actions'
import { ArtifactsBulkActions } from '@/features/artifacts/components/artifacts-bulk-actions'
import type { ExecutionArtifactSummary } from '@/features/artifacts/api/types'

function makeSummary(extra: Partial<ExecutionArtifactSummary> = {}): ExecutionArtifactSummary {
  return {
    execution_id: 'exec-1',
    name: 'nightly-run',
    entity_type: 'regression',
    status: 'passed',
    finished_at: '2026-06-09T12:30:00Z',
    artifact_count: 3,
    total_size_bytes: 4096,
    ...extra,
  }
}

/** Drive the shared ConfirmationDialog type-to-confirm gate inside `dialog`. */
async function passTypeToConfirm(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  const input = within(dialog).getByLabelText(/to confirm/i)
  const confirmButton = within(dialog).getByRole('button', { name: /^delete/i })
  expect(confirmButton).toBeDisabled()
  const label = input.getAttribute('aria-label') ?? ''
  const phrase = label.replace(/^type\s+/i, '').replace(/\s+to confirm$/i, '')
  await user.type(input, phrase)
  expect(confirmButton).toBeEnabled()
  await user.click(confirmButton)
}

describe('ArtifactsRowActions', () => {
  function renderRow(props: Partial<React.ComponentProps<typeof ArtifactsRowActions>> = {}) {
    const handlers = { onOpen: vi.fn(), onDownloadZip: vi.fn(), onDelete: vi.fn() }
    render(<ArtifactsRowActions execution={makeSummary()} {...handlers} {...props} />)
    return handlers
  }

  it('opens the drill via the chevron', async () => {
    const user = userEvent.setup()
    const execution = makeSummary()
    const handlers = renderRow({ execution })

    await user.click(screen.getByRole('button', { name: /open/i }))

    expect(handlers.onOpen).toHaveBeenCalledWith(execution)
  })

  it('kebab menu offers Download .zip and Delete artifacts, but no view', async () => {
    const user = userEvent.setup()
    renderRow()

    await user.click(screen.getByRole('button', { name: /more actions/i }))

    expect(screen.getByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete artifacts/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /view|open/i })).not.toBeInTheDocument()
  })

  it('Download .zip calls onDownloadZip with the execution', async () => {
    const user = userEvent.setup()
    const execution = makeSummary()
    const handlers = renderRow({ execution })

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    expect(handlers.onDownloadZip).toHaveBeenCalledWith(execution)
  })

  it('Delete artifacts requires type-to-confirm before onDelete fires', async () => {
    const user = userEvent.setup()
    const execution = makeSummary()
    const handlers = renderRow({ execution })

    await user.click(screen.getByRole('button', { name: /more actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))

    const dialog = screen.getByRole('alertdialog')
    await passTypeToConfirm(user, dialog)

    expect(handlers.onDelete).toHaveBeenCalledWith(execution)
  })

  it('disables Delete artifacts for an in-progress execution', async () => {
    const user = userEvent.setup()
    renderRow({ execution: makeSummary({ status: 'running' }) })

    await user.click(screen.getByRole('button', { name: /more actions/i }))

    expect(screen.getByRole('menuitem', { name: /delete artifacts/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

describe('ArtifactsBulkActions', () => {
  function renderBulk(props: Partial<React.ComponentProps<typeof ArtifactsBulkActions>> = {}) {
    const handlers = {
      onDownloadZip: vi.fn(),
      onDelete: vi.fn(),
      onEnterSelectionMode: vi.fn(),
      onExitSelectionMode: vi.fn(),
    }
    render(
      <ArtifactsBulkActions
        selectedCount={2}
        totalCount={5}
        selectedSizeBytes={0}
        selectionModeActive
        {...handlers}
        {...props}
      />,
    )
    return handlers
  }

  it('enters selection mode from the Mass Action button', async () => {
    const user = userEvent.setup()
    const handlers = renderBulk({ selectionModeActive: false })

    await user.click(screen.getByRole('button', { name: /mass action/i }))

    expect(handlers.onEnterSelectionMode).toHaveBeenCalled()
  })

  it('labels the selection with count-of-total and the selected size', () => {
    renderBulk({ selectedCount: 3, totalCount: 12, selectedSizeBytes: 5 * 1024 * 1024 })

    const counter = screen.getByTestId('selection-counter')
    expect(counter).toHaveTextContent('3 of 12')
    expect(counter).toHaveTextContent('5.0 MB')
  })

  it('mass menu offers Download (.zip) and Delete artifacts, but no view', async () => {
    const user = userEvent.setup()
    renderBulk()

    await user.click(screen.getByTestId('selection-counter'))

    expect(screen.getByRole('menuitem', { name: /download/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /delete artifacts/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /view/i })).not.toBeInTheDocument()
  })

  it('mass Download calls onDownloadZip', async () => {
    const user = userEvent.setup()
    const handlers = renderBulk()

    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /download/i }))

    expect(handlers.onDownloadZip).toHaveBeenCalled()
  })

  it('mass Delete artifacts requires type-to-confirm before onDelete fires', async () => {
    const user = userEvent.setup()
    const handlers = renderBulk()

    await user.click(screen.getByTestId('selection-counter'))
    await user.click(screen.getByRole('menuitem', { name: /delete artifacts/i }))

    const dialog = screen.getByRole('alertdialog')
    await passTypeToConfirm(user, dialog)

    expect(handlers.onDelete).toHaveBeenCalled()
  })
})
