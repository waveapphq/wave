/**
 * CanvasActionBar - session-ownership mirror lock (SESS-1..4).
 *
 * While another holder owns the workbench draft, every editing affordance is
 * disabled regardless of its own enabling state: Save (dirty), Edit (editing a
 * test), Undo/Redo (history available), and the Run/Debug launchers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar'

function renderBar(props: Record<string, unknown> = {}) {
  return render(
    <>
      <CanvasActionBar
        isDirty
        canUndo
        canRedo
        isEditingTest
        selectedEnvironment="env-1"
        availableEnvironments={[{ id: 'env-1', name: 'Development' }]}
        {...props}
      />
    </>
  )
}

describe('CanvasActionBar - editingLocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps every editing control enabled when unlocked', () => {
    renderBar({ editingLocked: false })

    expect(screen.getByTestId('toolbar-save-button')).toBeEnabled()
    expect(screen.getByTestId('toolbar-edit-button')).toBeEnabled()
    expect(screen.getByTestId('toolbar-undo-button')).toBeEnabled()
    expect(screen.getByTestId('toolbar-redo-button')).toBeEnabled()
    expect(screen.getByTestId('run-button')).toBeEnabled()
    expect(screen.getByTestId('debug-button')).toBeEnabled()
    expect(screen.getByTestId('environment-selector')).toBeEnabled()
    expect(screen.getByTestId('debug-options-gear')).toBeEnabled()
  })

  it('disables Save, Edit, Undo, Redo, Run, Debug, env selector, and debug options when locked', () => {
    renderBar({ editingLocked: true })

    expect(screen.getByTestId('toolbar-save-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-edit-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-undo-button')).toBeDisabled()
    expect(screen.getByTestId('toolbar-redo-button')).toBeDisabled()
    expect(screen.getByTestId('run-button')).toBeDisabled()
    expect(screen.getByTestId('debug-button')).toBeDisabled()
    expect(screen.getByTestId('environment-selector')).toBeDisabled()
    expect(screen.getByTestId('debug-options-gear')).toBeDisabled()
  })
})
