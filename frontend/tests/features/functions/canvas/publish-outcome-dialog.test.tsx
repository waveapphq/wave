/**
 * PublishOutcomeDialog - the three-option publish confirmation (CANVAS-219..222).
 *
 * Offered when the user publishes an edit-mode draft. Three actions:
 *   - Cancel (ghost)
 *   - Publish and keep Old (secondary) -> publish to library, leave this
 *     instance on its source version, discard the draft.
 *   - Publish and set New (primary) -> publish and re-pin this instance to the
 *     new version.
 * Identical in draft and saved-Test modes; carries NO save-status line
 * (CANVAS-221). Uses AlertDialog semantics: ESC and backdrop do NOT dismiss.
 *
 * Pure component (no API).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PublishOutcomeDialog } from '@/features/functions/canvas/publish-outcome-dialog'

function renderDialog(overrides: Partial<Parameters<typeof PublishOutcomeDialog>[0]> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    functionName: 'Greet User',
    sourceVersion: '1.0.0',
    targetVersion: '1.0.1',
    pending: false,
    error: null as string | null,
    onSetNew: vi.fn(),
    onKeepOld: vi.fn(),
    ...overrides,
  }
  render(<PublishOutcomeDialog {...props} />)
  return props
}

describe('PublishOutcomeDialog - structure', () => {
  it('renders the title "Publish a new version?"', () => {
    renderDialog()
    expect(screen.getByText(/publish a new version\?/i)).toBeInTheDocument()
  })

  it('renders the version transition (name, source, target)', () => {
    renderDialog()
    // Source muted, target accented; both rendered as v<x> -> v<y>.
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument()
    expect(screen.getByText(/v1\.0\.1/)).toBeInTheDocument()
    expect(screen.getByText(/Greet User/)).toBeInTheDocument()
  })

  it('renders all three footer actions', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish and keep old/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish and set new/i })).toBeInTheDocument()
  })

  it('does NOT render a save-status line (CANVAS-221)', () => {
    renderDialog()
    expect(screen.queryByText(/sav(e|ed|ing)/i)).toBeNull()
  })

  it('uses alertdialog semantics', () => {
    renderDialog()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('PublishOutcomeDialog - actions', () => {
  it('fires onSetNew when "Publish and set New" is clicked', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: /publish and set new/i }))
    expect(props.onSetNew).toHaveBeenCalledTimes(1)
    expect(props.onKeepOld).not.toHaveBeenCalled()
  })

  it('fires onKeepOld when "Publish and keep Old" is clicked', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: /publish and keep old/i }))
    expect(props.onKeepOld).toHaveBeenCalledTimes(1)
    expect(props.onSetNew).not.toHaveBeenCalled()
  })

  it('fires onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('PublishOutcomeDialog - no-ESC / no-backdrop dismiss', () => {
  it('does not dismiss on Escape (explicit choice required)', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.keyboard('{Escape}')
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

describe('PublishOutcomeDialog - pending state', () => {
  it('disables Cancel while a choice is pending', () => {
    renderDialog({ pending: true })
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
  })

  it('marks the dialog busy while pending', () => {
    renderDialog({ pending: true })
    // The chosen publish actions are not dismissable/clickable again mid-flight.
    const setNew = screen.getByRole('button', { name: /publish and set new/i })
    const keepOld = screen.getByRole('button', { name: /publish and keep old/i })
    expect(setNew.getAttribute('aria-busy') === 'true' || setNew.hasAttribute('disabled')).toBe(true)
    expect(keepOld.hasAttribute('disabled')).toBe(true)
  })
})

describe('PublishOutcomeDialog - error state', () => {
  it('renders an inline error row above the footer', () => {
    renderDialog({ error: 'Target version already exists in the library' })
    expect(screen.getByText(/target version already exists in the library/i)).toBeInTheDocument()
  })

  it('re-enables the actions to retry after an error', () => {
    renderDialog({ error: 'boom', pending: false })
    expect(screen.getByRole('button', { name: /publish and set new/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /^cancel$/i })).not.toBeDisabled()
  })
})
