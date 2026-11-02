/**
 * The {x} entry slot of the list and map editors: the expression box drawn as the one 32px row box,
 * and its full editor opened by the host's expand or by Ctrl+E (FIELD-1).
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/common/element-config/expressions/expression-editor-modal', () => ({
  ExpressionEditorModal: ({
    open,
    onOpenChange,
    title,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title?: string
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null,
}))

import { makeExpressionEditor } from '@/features/workbench/common/element-config/expressions/expression-entry-editor'
import { MapEditBody } from '@/components/shared/variable-bodies/map-edit-body'
import { ArrayEditBody } from '@/components/shared/variable-bodies/array-edit-body'

const entryEditor = makeExpressionEditor([])

function Host({ onOpenChange }: Readonly<{ onOpenChange?: (open: boolean) => void }>) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Expand
      </button>
      {entryEditor({
        value: 'base_host',
        onChange: vi.fn(),
        ariaLabel: 'Entry 1 value',
        testId: 'map-expr-value-1',
        editorOpen: open,
        onEditorOpenChange: (next) => {
          setOpen(next)
          onOpenChange?.(next)
        },
      })}
    </>
  )
}

async function pressCtrlE(user: ReturnType<typeof userEvent.setup>, testId: string) {
  await user.click(screen.getByTestId(testId).querySelector('.cm-content') as HTMLElement)
  await user.keyboard('{Control>}e{/Control}')
}

describe('makeExpressionEditor - the {x} entry box', () => {
  it('draws the expression box in the 32px row tuning', () => {
    render(<Host />)
    const slot = screen.getByTestId('map-expr-value-1')
    expect(slot).toHaveClass('min-w-0', '[&_.cm-content]:!py-1', '[&_.cm-scroller]:!leading-[22px]')
    expect(slot.querySelector('[data-testid="param-input-map-expr-value-1"] .cm-content')).not.toBeNull()
  })

  it("opens the full editor when the host opens it, named by the entry's label", async () => {
    const user = userEvent.setup()
    render(<Host />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('dialog', { name: 'Edit Entry 1 value' })).toBeInTheDocument()
  })

  it('reports Ctrl+E and Close to the host', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Host onOpenChange={onOpenChange} />)
    await pressCtrlE(user, 'map-expr-value-1')
    expect(onOpenChange).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('dialog', { name: 'Edit Entry 1 value' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps its own open state for a host that gives none (Parts)', async () => {
    const user = userEvent.setup()
    render(
      <>
        {entryEditor({ value: 'run_id', onChange: vi.fn(), ariaLabel: 'Part 0 value', testId: 'part-expr-value-0' })}
      </>,
    )
    await pressCtrlE(user, 'part-expr-value-0')
    expect(screen.getByRole('dialog', { name: 'Edit Part 0 value' })).toBeInTheDocument()
  })
})

describe('makeExpressionEditor - in the map and list editors (FIELD-1)', () => {
  it("opens an {x} map entry's full editor from its expand", async () => {
    const user = userEvent.setup()
    render(
      <MapEditBody
        value={{ Accept: 'text/plain', Authorization: 'token' }}
        types={{ Accept: 'string', Authorization: 'string' }}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
        expressionEditor={entryEditor}
        expressionKeys={new Set(['Authorization'])}
      />,
    )
    await user.click(screen.getByTestId('map-expand-1'))
    expect(screen.getByRole('dialog', { name: 'Edit Entry 1 value' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("opens an {x} list item's full editor from its expand", async () => {
    const user = userEvent.setup()
    render(
      <ArrayEditBody
        value={['web-1', 'backup_host']}
        types={['string', 'string']}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        stringValuesOnly
        expressionEditor={entryEditor}
        expressionIndices={new Set([1])}
      />,
    )
    await user.click(screen.getByTestId('array-expand-1'))
    expect(screen.getByRole('dialog', { name: 'Edit Item 1 value' })).toBeInTheDocument()
  })
})
