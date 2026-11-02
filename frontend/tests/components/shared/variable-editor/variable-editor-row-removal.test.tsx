/**
 * Deleting a variable row whose value editor is open, in the shared grid the
 * suite, regression and system variable dialogs render.
 *
 * Unsaved text in the row's editor asks first: Keep Editing leaves the row
 * exactly as it was, Close deletes it and drops the text with it.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ({ onChange }: { onChange: (value: unknown) => void }) => (
    <div data-testid="scalar-edit-body">
      <button data-testid="scalar-edit-body-change" onClick={() => onChange('typed')}>
        change
      </button>
    </div>
  ),
}))

import { VariableEditor } from '@/components/shared/variable-editor/variable-editor'
import { EntityVariableValueCell } from '@/features/workbench/common/variables/entity-variable-value-cell'
import type { VariableRow } from '@/lib/variable-types'
import { ChildEditorParent } from '../../../utils/child-editor-parent'

const ROWS: VariableRow[] = [
  { id: 'r1', name: 'base_url', type: 'string', secret: false, value: 'http://lab' },
  { id: 'r2', name: 'timeout', type: 'string', secret: false, value: '30' },
]

function renderGrid() {
  const onChange = vi.fn()
  function Grid() {
    return (
      <ChildEditorParent>
        <VariableEditor
          rows={ROWS}
          onChange={onChange}
          renderValueCell={(row) => (
            <EntityVariableValueCell row={row} rows={ROWS} onRowsChange={onChange} />
          )}
        />
      </ChildEditorParent>
    )
  }
  render(<Grid />)
  return { onChange }
}

const deleteRow = (index: number) => screen.getAllByTestId('variable-delete-btn')[index]

async function editFirstValue(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('entity-var-edit-r1'))
  const editor = screen.getByTestId('value-editor-sheet')
  await user.click(within(editor).getByTestId('scalar-edit-body-change'))
}

describe('VariableEditor - a row the grid takes away', () => {
  it('asks Keep Editing or Close while the row editor holds unsaved text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await editFirstValue(user)
    onChange.mockClear()

    await user.click(deleteRow(0))

    expect(
      within(screen.getByTestId('unsaved-changes-dialog'))
        .getAllByRole('button')
        .filter((button) => button.dataset.testid !== undefined)
        .map((button) => button.textContent),
    ).toEqual(['Keep Editing', 'Close'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves the row exactly as it was on Keep Editing', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await editFirstValue(user)
    onChange.mockClear()
    await user.click(deleteRow(0))

    await user.click(screen.getByTestId('unsaved-keep-editing'))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('deletes the row on Close', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await editFirstValue(user)
    onChange.mockClear()
    await user.click(deleteRow(0))

    await user.click(screen.getByTestId('unsaved-close'))

    expect(onChange).toHaveBeenCalledExactlyOnceWith([ROWS[1]])
  })

  it('deletes at once while the row editor holds no unsaved text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGrid()
    await user.click(screen.getByTestId('entity-var-edit-r1'))

    await user.click(deleteRow(0))

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledExactlyOnceWith([ROWS[1]])
  })
})
