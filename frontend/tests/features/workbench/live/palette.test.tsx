/**
 * LivePalette modal lifecycle: opening the Functions Library mounts the
 * modal in the open state; closing flips the state back. The handlers
 * exercised here are the open/close callbacks that own the modal state.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/common/palette', () => ({
  PalettePanel: ({ onOpenFunctionLibrary }: { onOpenFunctionLibrary?: () => void }) => (
    <button
      type="button"
      data-testid="mock-palette-open-trigger"
      onClick={() => onOpenFunctionLibrary?.()}
    >
      Open
    </button>
  ),
}))

vi.mock('@/features/functions/library/functions-library-modal', () => ({
  FunctionsLibraryModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="mock-functions-modal">
        <button type="button" data-testid="mock-modal-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}))

vi.mock('@/components/shared/draggable-sheet', () => ({
  refocusSheet: vi.fn(),
}))

import { refocusSheet } from '@/components/shared/draggable-sheet'
import { LivePalette } from '@/features/workbench/live/palette'

describe('LivePalette - Functions Library modal lifecycle', () => {
  it('mounts the modal as closed initially', () => {
    render(<LivePalette />)
    expect(screen.queryByTestId('mock-functions-modal')).not.toBeInTheDocument()
  })

  it('opens the modal when PalettePanel invokes onOpenFunctionLibrary', async () => {
    const user = userEvent.setup()
    render(<LivePalette />)
    await user.click(screen.getByTestId('mock-palette-open-trigger'))
    expect(screen.getByTestId('mock-functions-modal')).toBeInTheDocument()
  })

  it('closes the modal when the modal invokes onClose', async () => {
    const user = userEvent.setup()
    render(<LivePalette />)
    await user.click(screen.getByTestId('mock-palette-open-trigger'))
    expect(screen.getByTestId('mock-functions-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('mock-modal-close'))
    expect(screen.queryByTestId('mock-functions-modal')).not.toBeInTheDocument()
  })

  it('re-triggering the open while the library is open raises + pulses it (refocusSheet)', async () => {
    const user = userEvent.setup()
    vi.mocked(refocusSheet).mockClear()
    render(<LivePalette />)
    await user.click(screen.getByTestId('mock-palette-open-trigger'))
    expect(refocusSheet).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('mock-palette-open-trigger'))

    expect(refocusSheet).toHaveBeenCalledTimes(1)
    expect(refocusSheet).toHaveBeenCalledWith('functions-library')
    // Still exactly one open modal - no duplicate mount.
    expect(screen.getAllByTestId('mock-functions-modal')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('mock-modal-close'))
  })
})
