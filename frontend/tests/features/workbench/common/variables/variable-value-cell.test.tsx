/**
 * VariableValueCell tests.
 *
 * The single shared per-row value editor in STRUCTURED value space, generalized
 * from the profile parameter-row's value machinery so element-config parameters
 * AND entity-scope variable tables share one family:
 *   - integer / float / boolean (not secret): inline shared ScalarEditBody
 *   - string + array / map / table (not secret): a ValueField Edit-preview button
 *     opening the shared "Edit value" sheet
 *   - a secret holding a value: one uniform masked clear-and-edit affordance whose
 *     "Edit Protected Value?" confirm clears the value (onClearSecretValue) then
 *     re-enters the type-appropriate editor (inline scalar / sheet)
 *   - the floating sheet, the two secret-confirm dialogs and the capture-phase ESC
 *     all live here; the host adapts its stored shape at the edge (onChange).
 *
 * The shared bodies + sheet are mocked to stand-ins so this file covers the CELL's
 * orchestration (which affordance renders, what the sheet receives, save routing,
 * the secret clear-and-edit flow, ESC); each body / the sheet has its own file.
 *
 * REQ-3.1.3.1: Variable scoping (entity-scope value editing)
 * REQ-3.1.3.11: Variable Manager UI panel (one family behind every value surface)
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import { VariableValueCell } from '@/features/workbench/common/variables/variable-value-cell'
import type { VariableType } from '@/lib/variable-types'

// Tooltip (wrapping the masked-secret button) reads the viewport hook.
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({ isTouchDevice: false, width: 1024, height: 768, breakpoint: 'lg' }),
}))

// Inline scalar body stand-in: emits a typed value through onChange.
vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ({ value, type, onChange, blank }: any) => (
    <div data-testid="scalar-edit-body" data-type={type} data-value={String(value)} data-blank={blank ?? ''}>
      <button data-testid="scalar-emit-int" onClick={() => onChange(42)}>int</button>
      <button data-testid="scalar-emit-true" onClick={() => onChange(true)}>true</button>
    </div>
  ),
}))

// The shared "Edit value" sheet stand-in: exposes its props + a save/save-template
// /close so the cell's open + save(value, isTemplate) routing can be asserted.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  return {
    ValueEditorSheet: ({ type, value, isTemplate, allowTemplate, availableVariables, captureEsc, onSave, onClose }: any) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-type={type}
          data-value={JSON.stringify(value)}
          data-is-template={String(isTemplate)}
          data-allow-template={String(allowTemplate)}
          data-available-count={String((availableVariables ?? []).length)}
          data-capture-esc={String(!!captureEsc)}
        >
          <button data-testid="sheet-save" onClick={() => onSave('sheet-value', false)}>Save</button>
          <button data-testid="sheet-save-template" onClick={() => onSave('tmpl-value', true)}>SaveTemplate</button>
          <button data-testid="sheet-close" onClick={onClose}>Close</button>
        </div>,
        document.body,
      ),
  }
})

interface CellOverrides {
  type?: VariableType
  value?: unknown
  secret?: boolean
  disabled?: boolean
  availableVariables?: unknown[]
  allowTemplate?: boolean
  isTemplate?: boolean
  onChange?: (value: unknown, isTemplate: boolean) => void
  onClearSecretValue?: () => void
  blank?: 'refuse' | 'unset'
}

function renderCell(overrides: CellOverrides = {}) {
  const onChange = vi.fn(overrides.onChange)
  const onClearSecretValue = vi.fn(overrides.onClearSecretValue)
  const result = render(
    <VariableValueCell
      label="retries"
      type={overrides.type ?? 'string'}
      value={overrides.value ?? ''}
      secret={overrides.secret ?? false}
      disabled={overrides.disabled ?? false}
      availableVariables={(overrides.availableVariables ?? []) as never}
      allowTemplate={overrides.allowTemplate ?? true}
      isTemplate={overrides.isTemplate ?? false}
      onChange={onChange}
      onClearSecretValue={onClearSecretValue}
      blank={overrides.blank}
    />,
  )
  return { ...result, onChange, onClearSecretValue }
}

// A host that drops the stored secret when asked, as every real host of the cell does.
function ClearingHost({ type, stored }: Readonly<{ type: VariableType; stored: unknown }>) {
  const [value, setValue] = useState<unknown>(stored)
  return (
    <>
      <input aria-label="Name" />
      <div data-testid="value-cell">
        <VariableValueCell
          label="token"
          type={type}
          value={value}
          secret
          availableVariables={[]}
          onChange={setValue}
          onClearSecretValue={() => setValue('')}
        />
      </div>
    </>
  )
}

/** Opens "Edit Protected Value?" from the masked control, then gives the answer. */
function askAndAnswer(answer: RegExp): void {
  fireEvent.click(screen.getByLabelText('Edit protected value'))
  fireEvent.click(screen.getByRole('button', { name: answer }))
  // The question hands focus on a moment after it has gone.
  act(() => {
    vi.advanceTimersByTime(10)
  })
}

/** The ValueField Edit-preview button, found by its value-preview accessible name. */
function editButton(name: RegExp | string): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('VariableValueCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // --------------------------------------------------------------------------
  // Inline scalar bodies (integer / float / boolean, not secret)
  // --------------------------------------------------------------------------
  describe('inline scalar bodies', () => {
    it.each(['integer', 'float', 'boolean'] as const)(
      'renders the shared ScalarEditBody inline for %s',
      (type) => {
        renderCell({ type, value: type === 'boolean' ? true : '7' })
        expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-type', type)
      },
    )

    it('routes a scalar edit through onChange as a literal (isTemplate=false)', () => {
      const { onChange } = renderCell({ type: 'integer', value: '7' })
      fireEvent.click(screen.getByTestId('scalar-emit-int'))
      expect(onChange).toHaveBeenCalledWith(42, false)
    })

    it('routes a boolean edit through onChange as a literal', () => {
      const { onChange } = renderCell({ type: 'boolean', value: false })
      fireEvent.click(screen.getByTestId('scalar-emit-true'))
      expect(onChange).toHaveBeenCalledWith(true, false)
    })

    it('hands the inline body what a cleared number box stands for', () => {
      renderCell({ type: 'integer', value: '', blank: 'unset' })
      expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-blank', 'unset')
    })

    it('does not open the sheet for a scalar type', () => {
      renderCell({ type: 'integer', value: '7' })
      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Edit-value sheet (string + array / map / table)
  // --------------------------------------------------------------------------
  describe('Edit-value sheet', () => {
    it('does not mount the sheet until the Edit button is clicked', () => {
      renderCell({ type: 'string', value: 'db.local' })
      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    })

    it('opens a string value in the sheet', () => {
      renderCell({ type: 'string', value: 'db.local' })
      fireEvent.click(editButton(/db\.local/))
      expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'string')
    })

    it.each(['array', 'map', 'table'] as const)('opens a %s value in the shared complex sheet', (type) => {
      const value = type === 'map' ? { k: 'v' } : [{ a: '1' }]
      renderCell({ type, value })
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', type)
    })

    it('passes the structured value straight through to the sheet (host adapts at the edge)', () => {
      renderCell({ type: 'array', value: ['a', 'b'] })
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-value', '["a","b"]')
    })

    it('threads allowTemplate / isTemplate / availableVariables to the sheet', () => {
      renderCell({
        type: 'string',
        value: 'Hi {{ name }}',
        allowTemplate: true,
        isTemplate: true,
        availableVariables: [{ name: 'name' }, { name: 'age' }],
      })
      fireEvent.click(screen.getByRole('button'))
      const sheet = screen.getByTestId('value-editor-sheet')
      expect(sheet).toHaveAttribute('data-allow-template', 'true')
      expect(sheet).toHaveAttribute('data-is-template', 'true')
      expect(sheet).toHaveAttribute('data-available-count', '2')
    })

    it('passes allowTemplate=false for literal-only consumers (profiles / entity-scope)', () => {
      renderCell({ type: 'string', value: 'x', allowTemplate: false })
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-allow-template', 'false')
    })

    it('routes a literal sheet save to onChange(value, false)', () => {
      const { onChange } = renderCell({ type: 'string', value: 'db.local' })
      fireEvent.click(editButton(/db\.local/))
      fireEvent.click(screen.getByTestId('sheet-save'))
      expect(onChange).toHaveBeenCalledWith('sheet-value', false, undefined)
    })

    it('routes a template sheet save to onChange(value, true)', () => {
      const { onChange } = renderCell({ type: 'string', value: 'x', allowTemplate: true })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByTestId('sheet-save-template'))
      expect(onChange).toHaveBeenCalledWith('tmpl-value', true, undefined)
    })

    it('keeps the sheet open on save until Close (PYRUN-20)', () => {
      renderCell({ type: 'string', value: 'x' })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByTestId('sheet-save'))
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('sheet-close'))
      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    })

    it('closes the sheet on Cancel/close without calling onChange', () => {
      const { onChange } = renderCell({ type: 'string', value: 'x' })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByTestId('sheet-close'))
      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('disables the Edit button when disabled', () => {
      renderCell({ type: 'string', value: 'x', disabled: true })
      expect(screen.getByRole('button')).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Uniform masked secret affordance + clear-and-edit
  // --------------------------------------------------------------------------
  describe('masked secret affordance', () => {
    it('renders the uniform masked affordance for a secret string with a value', () => {
      renderCell({ type: 'string', value: 'secret', secret: true })
      expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    })

    it('renders the masked affordance for a secret complex value', () => {
      renderCell({ type: 'array', value: ['a'], secret: true })
      expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
    })

    it('shows the Edit button (not masked) for a secret string with no value', () => {
      renderCell({ type: 'string', value: '', secret: true })
      expect(editButton('Edit…')).toBeInTheDocument()
      expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    })

    it('opens the "Edit Protected Value?" confirm when the masked affordance is clicked', () => {
      renderCell({ type: 'string', value: 'secret', secret: true })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    })

    it('cancels the confirm without clearing the value', () => {
      const { onClearSecretValue } = renderCell({ type: 'string', value: 'secret', secret: true })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
      expect(onClearSecretValue).not.toHaveBeenCalled()
    })

    it('clears the value then opens the sheet for a secret string on confirm', () => {
      const { onClearSecretValue } = renderCell({ type: 'string', value: 'secret', secret: true })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
      expect(onClearSecretValue).toHaveBeenCalledTimes(1)
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    })

    it('clears then edits a secret integer inline (no sheet) on confirm', () => {
      const { onClearSecretValue } = renderCell({ type: 'integer', value: '42', secret: true })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
      expect(onClearSecretValue).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
      expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    })

    it('never masks a secret boolean (inline scalar)', () => {
      renderCell({ type: 'boolean', value: true, secret: true })
      expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
      expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Keyboard focus after "Edit Protected Value?"
  // --------------------------------------------------------------------------
  describe('keyboard focus after the confirm', () => {
    it.each(['string', 'integer'] as const)(
      'puts focus back on the masked control of a secret %s after Cancel',
      (type) => {
        render(<ClearingHost type={type} stored={type === 'integer' ? '42' : 'secret'} />)

        askAndAnswer(/cancel/i)

        expect(screen.getByLabelText('Edit protected value')).toHaveFocus()
      },
    )

    it('puts focus back on the masked control after Escape', () => {
      render(<ClearingHost type="string" stored="secret" />)
      fireEvent.click(screen.getByLabelText('Edit protected value'))

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
      act(() => {
        vi.advanceTimersByTime(10)
      })

      expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Edit protected value')).toHaveFocus()
    })

    it('puts focus in the inline editor of a secret integer after "Delete & Edit"', () => {
      render(<ClearingHost type="integer" stored="42" />)

      askAndAnswer(/delete.*edit/i)

      expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
      expect(screen.getByTestId('scalar-edit-body')).toContainElement(
        document.activeElement as HTMLElement,
      )
    })

    it('puts focus on the Edit control of a secret string after "Delete & Edit", then opens its sheet', () => {
      render(<ClearingHost type="string" stored="secret" />)

      askAndAnswer(/delete.*edit/i)

      expect(editButton('Edit…')).toHaveFocus()
      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      expect(editButton('Edit…')).toHaveFocus()
    })

    it('never puts focus in another field of the row', () => {
      render(<ClearingHost type="string" stored="secret" />)
      screen.getByRole('textbox', { name: 'Name' }).focus()

      askAndAnswer(/delete.*edit/i)

      expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveFocus()
      expect(screen.getByTestId('value-cell')).toContainElement(document.activeElement as HTMLElement)
    })
  })

  // --------------------------------------------------------------------------
  // Capture-phase ESC closes the floating sheet (not the surrounding dialog)
  // --------------------------------------------------------------------------
  describe('sheet ESC handling', () => {
    it('delegates capture-phase ESC to the sheet via captureEsc (guarded close lives there)', () => {
      renderCell({ type: 'string', value: 'x' })
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-capture-esc', 'true')
    })

    it('ignores a non-Escape key while the sheet is open', () => {
      renderCell({ type: 'string', value: 'x' })
      fireEvent.click(screen.getByRole('button'))
      fireEvent.keyDown(document, { key: 'a' })
      expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    })
  })
})
