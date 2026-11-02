/**
 * The question asked before an action takes away a row whose editor is open.
 *
 * An editor with unsaved changes stops the action until the answer comes: Keep
 * Editing leaves the row exactly as it was, Close lets the action through and
 * the unsaved text goes with the row. A clean editor never stops anything, and
 * Save is never offered - the row is going either way.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

import {
  ChildEditorsProvider,
  useChildEditor,
  useChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'

function Editor({ label, hasChanges }: Readonly<{ label: string; hasChanges: boolean }>) {
  useChildEditor({ label, hasChanges, cannotBeSaved: false, apply: () => {} })
  return null
}

function Rows({ onRemove, rows }: Readonly<{ onRemove: (label: string) => void; rows: string[] }>) {
  const guard = useRowRemovalGuard()
  return (
    <>
      {rows.map((label) => (
        <button key={label} data-testid={`remove-${label}`} onClick={() => guard.request([label], () => onRemove(label))}>
          remove {label}
        </button>
      ))}
      <RowRemovalQuestion guard={guard} />
    </>
  )
}

function renderRows({
  dirtyEditor = 'Script',
  rows = ['Script', 'Interpreter'],
}: { dirtyEditor?: string | null; rows?: string[] } = {}) {
  const onRemove = vi.fn()
  function Parent() {
    const scope = useChildEditorScope()
    return (
      <ChildEditorsProvider scope={scope}>
        {dirtyEditor !== null && <Editor label={dirtyEditor} hasChanges />}
        <Editor label="Arguments 1" hasChanges={false} />
        <Rows rows={rows} onRemove={onRemove} />
      </ChildEditorsProvider>
    )
  }
  render(<Parent />)
  return { onRemove }
}

describe('useRowRemovalGuard', () => {
  it('takes the row away at once while its editor has no unsaved changes', () => {
    const { onRemove } = renderRows({ rows: ['Arguments 1'] })

    fireEvent.click(screen.getByTestId('remove-Arguments 1'))

    expect(onRemove).toHaveBeenCalledExactlyOnceWith('Arguments 1')
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('takes the row away at once while no editor of it is open', () => {
    const { onRemove } = renderRows({ rows: ['Working Directory'] })

    fireEvent.click(screen.getByTestId('remove-Working Directory'))

    expect(onRemove).toHaveBeenCalledExactlyOnceWith('Working Directory')
  })

  it('asks Keep Editing or Close while its editor has unsaved changes', () => {
    const { onRemove } = renderRows()

    fireEvent.click(screen.getByTestId('remove-Script'))

    expect(onRemove).not.toHaveBeenCalled()
    const dialog = screen.getByTestId('unsaved-changes-dialog')
    expect(
      within(dialog)
        .getAllByRole('button')
        .filter((button) => button.dataset.testid !== undefined)
        .map((button) => button.textContent),
    ).toEqual(['Keep Editing', 'Close'])
  })

  it('leaves the row exactly as it was on Keep Editing', () => {
    const { onRemove } = renderRows()
    fireEvent.click(screen.getByTestId('remove-Script'))

    fireEvent.click(screen.getByTestId('unsaved-keep-editing'))

    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('lets the action through on Close', () => {
    const { onRemove } = renderRows()
    fireEvent.click(screen.getByTestId('remove-Script'))

    fireEvent.click(screen.getByTestId('unsaved-close'))

    expect(onRemove).toHaveBeenCalledExactlyOnceWith('Script')
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })

  it('asks nothing outside a parent', () => {
    const onRemove = vi.fn()
    render(<Rows rows={['Script']} onRemove={onRemove} />)

    fireEvent.click(screen.getByTestId('remove-Script'))

    expect(onRemove).toHaveBeenCalledExactlyOnceWith('Script')
  })
})
