/** Variable rows are <fieldset> groups that are never disabled. */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineVariableRow } from '@/features/workbench/common/variables/variable-manager-content/variable-row-inline'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { INLINE_VARIABLE_ROW_HEIGHT } from '@/features/workbench/common/variables/variable-manager-content/types'

const ORIGINAL_ROW_CLASSES = [
  'group',
  'flex',
  'flex-col',
  'gap-1',
  'px-3',
  'py-2',
  'hover:bg-muted/50',
  'border-b',
  'border-border/50',
  'transition-colors',
  'overflow-hidden',
]

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return { id: 'var-1', name: 'my_var', value: 'hello', type: 'string', ...overrides }
}

function renderRow(variable: Variable = createVariable(), onEdit = vi.fn()) {
  render(
    <InlineVariableRow
      variable={variable}
      runtimeValue={undefined}
      hasRuntimeValue={false}
      viewMode="runtime"
      onToggleViewMode={vi.fn()}
      isExpressionExecutionLocked={false}
      readOnly={false}
      onExpand={vi.fn()}
      onEdit={onEdit}
      onDelete={vi.fn()}
    />,
  )
  return { onEdit }
}

describe('InlineVariableRow native element', () => {
  it('renders the row as a fieldset with the group role and its name', () => {
    renderRow()

    const row = screen.getByRole('group', { name: 'Variable my_var' })
    expect(row.tagName).toBe('FIELDSET')
    expect(row).toBe(screen.getByTestId('variable-row-var-1'))
  })

  it('drops the explicit role attribute, adds min-w-0 and keeps every other class and the row height', () => {
    renderRow()

    const row = screen.getByTestId('variable-row-var-1')
    expect(row).not.toHaveAttribute('role')
    expect(row).toHaveAttribute('aria-label', 'Variable my_var')
    expect(row).toHaveClass('min-w-0', ...ORIGINAL_ROW_CLASSES)
    expect(row.style.height).toBe(`${INLINE_VARIABLE_ROW_HEIGHT}px`)
  })

  it('is never a disabled fieldset, so its action buttons stay enabled and clickable', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderRow()

    const row = screen.getByRole('group', { name: 'Variable my_var' })
    expect(row.tagName).toBe('FIELDSET')
    expect(row).not.toHaveAttribute('disabled')
    const edit = within(row).getByRole('button', { name: 'Edit my_var' })
    expect(edit).toBeEnabled()
    await user.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('keeps the same name for a secret variable row', () => {
    renderRow(createVariable({ id: 'var-s', name: 'api_key', isSecret: true }))

    const row = screen.getByRole('group', { name: 'Variable api_key' })
    expect(row.tagName).toBe('FIELDSET')
  })
})
