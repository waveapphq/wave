/**
 * Tests for KindChangeConfirmDialog, the confirm a Kind change asks before it clears the value (VMGR-108).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KindChangeConfirmDialog } from '@/features/workbench/common/variables/variable-inspect-modal/kind-change-confirm-dialog'
import type { VariableCreateKind } from '@/features/workbench/common/variables/variable-inspect-modal/use-inspect-create'
import type { VariableType } from '@/lib/variable-types'

function renderDialog(prevKind: VariableCreateKind, nextKind: VariableCreateKind, type: VariableType, currentLength = 1) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <KindChangeConfirmDialog
      open
      prevKind={prevKind}
      nextKind={nextKind}
      type={type}
      currentLength={currentLength}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
  return { onConfirm, onCancel }
}

describe('KindChangeConfirmDialog', () => {
  it('names the change in its title', () => {
    renderDialog('expression', 'literal', 'integer')
    expect(screen.getByRole('heading', { name: 'Change variable kind?' })).toBeInTheDocument()
  })

  it.each([
    ['expression', 'literal', 'integer', 1, 'Changing kind to literal will clear the existing expression. This cannot be undone.'],
    ['template', 'literal', 'string', 1, 'Changing kind to literal will clear the existing template. This cannot be undone.'],
    ['literal', 'expression', 'integer', 1, 'Changing kind to expression will clear 1 existing integer value. This cannot be undone.'],
    ['literal', 'expression', 'array', 3, 'Changing kind to expression will clear 3 existing array entries. This cannot be undone.'],
    ['literal', 'template', 'string', 1, 'Changing kind to template will clear 1 existing string value. This cannot be undone.'],
  ] as const)('from %s to %s on a %s value says what it clears', (prevKind, nextKind, type, length, text) => {
    renderDialog(prevKind, nextKind, type, length)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('confirms with "Change kind"', async () => {
    const user = userEvent.setup()
    const { onConfirm } = renderDialog('expression', 'literal', 'integer')
    await user.click(screen.getByRole('button', { name: 'Change kind' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels with "Cancel" and changes nothing', async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderDialog('expression', 'literal', 'integer')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
