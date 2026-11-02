/**
 * Deleting a Variable Setter row whose value editor is open.
 *
 * Unsaved text in the row's editor asks first: Keep Editing leaves the row
 * exactly as it was, Close deletes it and drops the text with it. A clean
 * editor is deleted away silently, and a row that stays keeps its own editor.
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

vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: () => <div data-testid="expression-field" />,
}))

import { VariableSetterEditor } from '@/features/workbench/common/variables/variable-setter-editor'
import { ChildEditorParent } from '../../../../utils/child-editor-parent'

function renderSetter() {
  const onVariablesChange = vi.fn()
  render(
    <ChildEditorParent>
      <VariableSetterEditor
        variables={{ greeting: 'hello', farewell: 'bye' }}
        expressionKeys={[]}
        templateKeys={[]}
        secretKeys={[]}
        variableTypes={{ greeting: 'string', farewell: 'string' }}
        availableVariables={[]}
        onVariablesChange={onVariablesChange}
        onExpressionKeysChange={vi.fn()}
        onTemplateKeysChange={vi.fn()}
        onSecretKeysChange={vi.fn()}
        onTypesChange={vi.fn()}
        onValidChange={vi.fn()}
      />
    </ChildEditorParent>,
  )
  return { onVariablesChange }
}

async function editGreeting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('varset-edit-value-0'))
  const editor = screen.getByTestId('value-editor-sheet')
  await user.click(within(editor).getByTestId('scalar-edit-body-change'))
}

const deleteRow = (index: number) => screen.getByTestId(`varset-delete-${index}`)

describe('VariableSetterEditor - a row the editor takes away', () => {
  it('asks Keep Editing or Close while the row editor holds unsaved text', async () => {
    const user = userEvent.setup()
    const { onVariablesChange } = renderSetter()
    await editGreeting(user)

    await user.click(deleteRow(0))

    expect(
      within(screen.getByTestId('unsaved-changes-dialog'))
        .getAllByRole('button')
        .filter((button) => button.dataset.testid !== undefined)
        .map((button) => button.textContent),
    ).toEqual(['Keep Editing', 'Close'])
    expect(onVariablesChange).not.toHaveBeenCalled()
  })

  it('leaves the row and its editor as they were on Keep Editing', async () => {
    const user = userEvent.setup()
    renderSetter()
    await editGreeting(user)
    await user.click(deleteRow(0))

    await user.click(screen.getByTestId('unsaved-keep-editing'))

    expect(screen.getByTestId('varset-delete-1')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('deletes the row and closes its editor on Close', async () => {
    const user = userEvent.setup()
    renderSetter()
    await editGreeting(user)
    await user.click(deleteRow(0))

    await user.click(screen.getByTestId('unsaved-close'))

    expect(screen.queryByTestId('varset-delete-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('deletes at once while the row editor holds no unsaved text', async () => {
    const user = userEvent.setup()
    renderSetter()
    await user.click(screen.getByTestId('varset-edit-value-0'))

    await user.click(deleteRow(0))

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('varset-delete-1')).not.toBeInTheDocument()
  })

  it('keeps the editor of a row that stays when an earlier row goes', async () => {
    const user = userEvent.setup()
    renderSetter()
    await user.click(screen.getByTestId('varset-edit-value-1'))

    await user.click(deleteRow(0))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('keeps the editor of a row that stays when a later row goes', async () => {
    const user = userEvent.setup()
    renderSetter()
    await user.click(screen.getByTestId('varset-edit-value-0'))

    await user.click(deleteRow(1))

    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })
})
