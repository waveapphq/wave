/**
 * ParameterRow Component Tests
 *
 * Tests for the ParameterRow component which renders a row in the
 * profile parameters table with name, type, secret, value, and actions.
 * A wrong value carries its message under the field (FIELDERR-1, REQ-4.7.5).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ParameterRow } from '@/features/profiles/components/profile-form-modal/parameter-row'
import type { Parameter } from '@/features/profiles/components/profile-form-modal/types'

// Mock the viewport hook used by Tooltip
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({ isTouchDevice: false, width: 1024, height: 768, breakpoint: 'lg' }),
}))

// The shared "Edit value" sheet mounted by the row for string + complex
// values - a stand-in exposing its props/wiring so the row's orchestration
// (which type opens, allowTemplate, save routing) can be asserted. sheet-save
// emits a scalar/string value; sheet-save-rows emits table row-objects.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  return {
    ValueEditorSheet: ({ type, value, allowTemplate, allowedFormats, captureEsc, elementTypes, onSave, onClose }: any) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-allowed-formats={JSON.stringify(allowedFormats ?? null)}
          data-type={type}
          data-value={String(value)}
          data-allow-template={String(allowTemplate)}
          data-capture-esc={String(!!captureEsc)}
          data-element-types={JSON.stringify(elementTypes ?? null)}
        >
          <button data-testid="sheet-save" onClick={() => onSave('sheet-value', false)}>Save</button>
          <button
            data-testid="sheet-save-typed"
            onClick={() => onSave({ n: '16', zip: '02134' }, false, [], { n: 'integer', zip: 'string' })}
          >
            SaveTyped
          </button>
          <button
            data-testid="sheet-save-rows"
            onClick={() => onSave([{ host: 'h', port: 1 }], false)}
          >
            SaveRows
          </button>
          <button
            data-testid="sheet-save-stored-table"
            onClick={() =>
              onSave(
                {
                  columns: [
                    { name: 'host', type: 'string' },
                    { name: 'port', type: 'integer' },
                  ],
                  rows: [['h', 1], ['g', 2]],
                },
                false,
              )
            }
          >
            SaveStoredTable
          </button>
          <button
            data-testid="sheet-save-stored-empty-table"
            onClick={() => onSave({ columns: [{ name: 'zone', type: 'string' }], rows: [] }, false)}
          >
            SaveStoredEmptyTable
          </button>
          <button data-testid="sheet-close" onClick={onClose}>Close</button>
        </div>,
        document.body
      ),
  }
})

// The value-error cases need the real numeric input, so they switch the stub off.
const scalarBody = vi.hoisted(() => ({ real: false }))

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/variable-bodies/scalar-edit-body')>()
  return {
    ScalarEditBody: (props: any) =>
      scalarBody.real ? (
        <actual.ScalarEditBody {...props} />
      ) : (
        <div data-testid="scalar-edit-body" data-type={props.type} data-value={String(props.value)}>
          <button data-testid="scalar-emit-int" onClick={() => props.onChange(42)}>int</button>
          <button data-testid="scalar-emit-true" onClick={() => props.onChange(true)}>true</button>
          <button data-testid="scalar-emit-false" onClick={() => props.onChange(false)}>false</button>
        </div>
      ),
  }
})

// ============================================================================
// Helpers
// ============================================================================

function makeParameter(overrides: Partial<Parameter> = {}): Parameter {
  return {
    id: 'param-1',
    name: 'test-param',
    type: 'string',
    secret: false,
    values: { 'env-1': 'value-1' },
    ...overrides,
  }
}

interface RenderRowProps {
  parameter?: Parameter
  environmentId?: string
  plainText?: boolean
  disabled?: boolean
  valueError?: string | null
  onUpdate?: ReturnType<typeof vi.fn>
  onUpdateValue?: ReturnType<typeof vi.fn>
  onDelete?: ReturnType<typeof vi.fn>
}

function renderRow(props: RenderRowProps = {}) {
  const {
    parameter = makeParameter(),
    environmentId = 'env-1',
    plainText,
    disabled = false,
    valueError,
    onUpdate = vi.fn(),
    onUpdateValue = vi.fn(),
    onDelete = vi.fn(),
  } = props

  const result = render(
    <table>
      <tbody>
        <ParameterRow
          parameter={parameter}
          environmentId={environmentId}
          plainText={plainText}
          disabled={disabled}
          valueError={valueError}
          onUpdate={onUpdate}
          onUpdateValue={onUpdateValue}
          onDelete={onDelete}
        />
      </tbody>
    </table>
  )

  return { ...result, onUpdate, onUpdateValue, onDelete, parameter }
}

// ============================================================================
// Tests
// ============================================================================

describe('ParameterRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('renders parameter name input', () => {
      renderRow()
      expect(screen.getByRole('textbox', { name: 'Parameter name' })).toBeInTheDocument()
      expect(screen.getByDisplayValue('test-param')).toBeInTheDocument()
    })

    it('renders type select with all WAVE types', () => {
      renderRow()
      const select = screen.getByRole('combobox', { name: 'Parameter type' })
      expect(select).toBeInTheDocument()
      expect(select).toHaveValue('string')
    })

    it('renders secret checkbox', () => {
      renderRow()
      expect(screen.getByRole('checkbox', { name: 'Mark as secret' })).toBeInTheDocument()
    })

    it('renders delete button', () => {
      renderRow()
      expect(screen.getByRole('button', { name: 'Delete parameter' })).toBeInTheDocument()
    })

    it('renders data-parameter-id attribute on the row', () => {
      const { container } = renderRow({ parameter: makeParameter({ id: 'my-param' }) })
      const row = container.querySelector('tr[data-parameter-id="my-param"]')
      expect(row).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Name editing
  // --------------------------------------------------------------------------
  describe('Name editing', () => {
    it('calls onUpdate with new name when changed', () => {
      const onUpdate = vi.fn()
      renderRow({ onUpdate })
      fireEvent.change(screen.getByRole('textbox', { name: 'Parameter name' }), {
        target: { value: 'new-name' },
      })
      expect(onUpdate).toHaveBeenCalledWith('param-1', { name: 'new-name' })
    })

    it('disables name input when disabled', () => {
      renderRow({ disabled: true })
      expect(screen.getByRole('textbox', { name: 'Parameter name' })).toBeDisabled()
    })

    it('marks an empty name invalid and describes the field by its message', () => {
      renderRow({ parameter: makeParameter({ name: '' }) })
      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAccessibleDescription(/^Name is required$/)
    })

    it('describes a valid name by nothing', () => {
      renderRow({ parameter: makeParameter({ name: 'port' }) })
      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      expect(nameInput).not.toHaveAttribute('aria-invalid')
      expect(nameInput).not.toHaveAttribute('aria-describedby')
    })
  })

  // --------------------------------------------------------------------------
  // Type selection
  // --------------------------------------------------------------------------
  describe('Type selection', () => {
    it('calls onUpdate with new type when changed', () => {
      const onUpdate = vi.fn()
      renderRow({ onUpdate })
      fireEvent.change(screen.getByRole('combobox', { name: 'Parameter type' }), {
        target: { value: 'integer' },
      })
      expect(onUpdate).toHaveBeenCalledWith('param-1', { type: 'integer' })
    })

    it('disables type select when disabled', () => {
      renderRow({ disabled: true })
      expect(screen.getByRole('combobox', { name: 'Parameter type' })).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Secret checkbox
  // --------------------------------------------------------------------------
  describe('Secret checkbox', () => {
    it('is unchecked when parameter.secret is false', () => {
      renderRow({ parameter: makeParameter({ secret: false }) })
      expect(screen.getByRole('checkbox', { name: 'Mark as secret' })).not.toBeChecked()
    })

    it('is checked when parameter.secret is true', () => {
      renderRow({ parameter: makeParameter({ secret: true }) })
      expect(screen.getByRole('checkbox', { name: 'Mark as secret' })).toBeChecked()
    })

    it('sets secret to true when checking (no values exist)', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: false, values: {} }),
        onUpdate,
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(onUpdate).toHaveBeenCalledWith('param-1', { secret: true })
    })

    it('sets secret to true when checking (values exist)', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: false, values: { 'env-1': 'val' } }),
        onUpdate,
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(onUpdate).toHaveBeenCalledWith('param-1', { secret: true })
    })

    it('shows confirmation dialog when unchecking secret with values', () => {
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': 'has-value' } }),
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.getByText('Remove Secret Protection?')).toBeInTheDocument()
    })

    it('does not show dialog when unchecking secret without values', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: {} }),
        onUpdate,
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.queryByText('Remove Secret Protection?')).not.toBeInTheDocument()
      expect(onUpdate).toHaveBeenCalledWith('param-1', { secret: false })
    })

    // Whitespace is a value the backend seals, so un-securing it drops a stored value.
    it('shows the confirmation when unchecking a secret holding only whitespace', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': '  ' } }),
        onUpdate,
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.getByText('Remove Secret Protection?')).toBeInTheDocument()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('does not show dialog when unchecking a secret whose values are all empty', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': '', 'env-2': '' } }),
        onUpdate,
      })
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.queryByText('Remove Secret Protection?')).not.toBeInTheDocument()
      expect(onUpdate).toHaveBeenCalledWith('param-1', { secret: false })
    })

    it('clears value and removes secret on confirm', () => {
      const onUpdate = vi.fn()
      const onUpdateValue = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': 'secret-val' } }),
        onUpdate,
        onUpdateValue,
      })

      // Open dialog
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.getByText('Remove Secret Protection?')).toBeInTheDocument()

      // Confirm
      fireEvent.click(screen.getByRole('button', { name: /remove/i }))
      expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
      expect(onUpdate).toHaveBeenCalledWith('param-1', { secret: false })
    })

    it('empties the value of every environment on confirm, not only the one on screen', () => {
      const onUpdate = vi.fn()
      const onUpdateValue = vi.fn()
      renderRow({
        parameter: makeParameter({
          secret: true,
          values: { 'env-1': 'secret-val', 'env-2': 'other-secret', 'env-3': '' },
          elementTypes: { 'env-2': ['string'] },
        }),
        onUpdate,
        onUpdateValue,
      })

      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      fireEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
      expect(onUpdate).toHaveBeenCalledWith('param-1', {
        secret: false,
        values: { 'env-1': '', 'env-2': '', 'env-3': '' },
        elementTypes: undefined,
      })
    })

    it('asks before removing protection when only another environment holds a value', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': '', 'env-2': 'other-secret' } }),
        onUpdate,
      })

      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))
      expect(screen.getByText('Remove Secret Protection?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /remove/i }))

      expect(onUpdate).toHaveBeenCalledWith('param-1', {
        secret: false,
        values: { 'env-1': '', 'env-2': '' },
        elementTypes: undefined,
      })
    })

    it('closes dialog on cancel without changing anything', () => {
      const onUpdate = vi.fn()
      renderRow({
        parameter: makeParameter({ secret: true, values: { 'env-1': 'secret-val' } }),
        onUpdate,
      })

      // Open dialog
      fireEvent.click(screen.getByRole('checkbox', { name: 'Mark as secret' }))

      // Cancel
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(screen.queryByText('Remove Secret Protection?')).not.toBeInTheDocument()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('is disabled for Boolean type and says why through the shared tooltip', () => {
      renderRow({ parameter: makeParameter({ type: 'boolean' }) })
      const checkbox = screen.getByRole('checkbox', { name: 'Mark as secret' })
      expect(checkbox).toBeDisabled()
      expect(checkbox).not.toHaveAttribute('title')
      // A disabled input emits no pointer events, so the hint hangs off the
      // wrapper the shared tooltip triggers from.
      fireEvent.focus(checkbox.parentElement as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Secret not available for Boolean type'
      )
    })

    it('names the action through the shared tooltip when not Boolean type', () => {
      renderRow({ parameter: makeParameter({ type: 'string' }) })
      const checkbox = screen.getByRole('checkbox', { name: 'Mark as secret' })
      expect(checkbox).not.toHaveAttribute('title')
      fireEvent.focus(checkbox)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Mark as secret'
      )
    })

    it('is disabled when component is disabled', () => {
      renderRow({ disabled: true })
      expect(screen.getByRole('checkbox', { name: 'Mark as secret' })).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------
  describe('Delete', () => {
    it('calls onDelete when delete button clicked', () => {
      const onDelete = vi.fn()
      renderRow({ onDelete })
      fireEvent.click(screen.getByRole('button', { name: 'Delete parameter' }))
      expect(onDelete).toHaveBeenCalledWith('param-1')
    })

    it('disables delete button when disabled', () => {
      renderRow({ disabled: true })
      expect(screen.getByRole('button', { name: 'Delete parameter' })).toBeDisabled()
    })
  })

  // --------------------------------------------------------------------------
  // Edit Secret Value
  // --------------------------------------------------------------------------
  describe('Edit Secret Value', () => {
    it('shows edit secret confirmation when edit protected value clicked', () => {
      renderRow({
        parameter: makeParameter({
          type: 'string',
          secret: true,
          values: { 'env-1': '********' },
        }),
      })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    })

    it('cancels edit secret dialog', () => {
      renderRow({
        parameter: makeParameter({
          type: 'string',
          secret: true,
          values: { 'env-1': '********' },
        }),
      })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    })

    it('clears value and enters editing mode for String type on confirm', () => {
      const onUpdateValue = vi.fn()
      renderRow({
        parameter: makeParameter({
          type: 'string',
          secret: true,
          values: { 'env-1': '********' },
        }),
        onUpdateValue,
      })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
      expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
    })

    it('enters editing mode for Number type (String/Number path)', () => {
      const onUpdateValue = vi.fn()
      renderRow({
        parameter: makeParameter({
          type: 'integer',
          secret: true,
          values: { 'env-1': '********' },
        }),
        onUpdateValue,
      })
      fireEvent.click(screen.getByLabelText('Edit protected value'))
      fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
      expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
    })
  })

  // ==========================================================================
  // Shared Field Primitives Migration
  //
  // Parameter names are profile-internal keys (not entity names), so they get
  // <TextField> (single-line overflow contract, no maxLength cap).
  // ==========================================================================

  describe('adopts shared field primitives', () => {
    it('parameter name cell renders as the TextField primitive (TEXTAREA tag, rows=1)', () => {
      renderRow()

      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      expect(nameInput.tagName).toBe('TEXTAREA')
      expect(nameInput).toHaveAttribute('rows', '1')
    })

    it('parameter name cell carries the single-line overflow contract', () => {
      renderRow()

      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      expect(nameInput.className).toContain('whitespace-pre')
      expect(nameInput.className).toContain('overflow-x-auto')
    })

    it('parameter name caps at MAX_VARIABLE_NAME_LENGTH (Python identifier, max 64)', async () => {
      const { MAX_VARIABLE_NAME_LENGTH } = await import(
        '@/lib/field-constraints'
      )
      renderRow()

      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      expect(nameInput).toHaveAttribute('maxLength', String(MAX_VARIABLE_NAME_LENGTH))
    })
  })

  // ==========================================================================
  // Value-editor migration: inline ScalarEditBody (int/float/boolean), the
  // shared "Edit value" sheet (string + array/map/table) opened via an Edit
  // button, a uniform masked secret affordance, and per-row trash delete.
  // Mirrors the Variable Setter. The shared bodies/sheet are mocked above.
  // ==========================================================================
  describe('value-editor migration', () => {
    describe('inline scalar bodies (integer / float / boolean)', () => {
      it('renders the shared ScalarEditBody inline for an integer parameter', () => {
        renderRow({ parameter: makeParameter({ type: 'integer', values: { 'env-1': '7' } }) })
        const body = screen.getByTestId('scalar-edit-body')
        expect(body).toBeInTheDocument()
        expect(body).toHaveAttribute('data-type', 'integer')
      })

      it('renders the shared ScalarEditBody inline for a float parameter', () => {
        renderRow({ parameter: makeParameter({ type: 'float', values: { 'env-1': '1.5' } }) })
        expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-type', 'float')
      })

      it('renders the shared ScalarEditBody inline for a boolean parameter', () => {
        renderRow({ parameter: makeParameter({ type: 'boolean', values: { 'env-1': 'true' } }) })
        expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-type', 'boolean')
      })

      it('writes an integer edit back to onUpdateValue as a string', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'integer', values: { 'env-1': '7' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId('scalar-emit-int'))
        expect(onUpdateValue).toHaveBeenCalledWith('param-1', '42', undefined)
      })

      it('writes a boolean edit back to onUpdateValue as "true"/"false"', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'boolean', values: { 'env-1': 'false' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId('scalar-emit-true'))
        expect(onUpdateValue).toHaveBeenCalledWith('param-1', 'true', undefined)
      })
    })

    describe('Edit-value sheet (string + complex)', () => {
      it('does not mount the sheet until the Edit button is clicked', () => {
        renderRow({
          parameter: makeParameter({ type: 'string', values: { 'env-1': 'db.local' } }),
        })
        expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
      })

      it('opens a string value in the sheet with allowTemplate=false', () => {
        renderRow({
          parameter: makeParameter({ type: 'string', values: { 'env-1': 'db.local' } }),
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        const sheet = screen.getByTestId('value-editor-sheet')
        expect(sheet).toHaveAttribute('data-type', 'string')
        expect(sheet).toHaveAttribute('data-allow-template', 'false')
      })

      it('opens an array value in the shared complex sheet (allowTemplate=false)', () => {
        renderRow({
          parameter: makeParameter({ type: 'array', values: { 'env-1': '["a","b"]' } }),
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        const sheet = screen.getByTestId('value-editor-sheet')
        expect(sheet).toHaveAttribute('data-type', 'array')
        expect(sheet).toHaveAttribute('data-allow-template', 'false')
      })

      it('opens a map value in the shared complex sheet', () => {
        renderRow({
          parameter: makeParameter({ type: 'map', values: { 'env-1': '{"k":"v"}' } }),
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'map')
      })

      it('opens a table value in the shared complex sheet', () => {
        renderRow({
          parameter: makeParameter({
            type: 'table',
            values: { 'env-1': '{"headers":["a"],"rows":[]}' },
          }),
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'table')
      })

      it('routes a sheet save to onUpdateValue for the current parameter', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'string', values: { 'env-1': 'db.local' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save'))
        expect(onUpdateValue).toHaveBeenCalledWith('param-1', 'sheet-value', undefined)
      })
    })

    describe('uniform masked secret affordance', () => {
      it('shows a single "Edit protected value" affordance for a secret array', () => {
        renderRow({
          parameter: makeParameter({ type: 'array', secret: true, values: { 'env-1': '********' } }),
        })
        expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
        expect(screen.queryByLabelText('Edit protected array')).not.toBeInTheDocument()
      })

      it('shows the uniform "Edit protected value" affordance for a secret table', () => {
        renderRow({
          parameter: makeParameter({
            type: 'table',
            secret: true,
            values: { 'env-1': '********' },
          }),
        })
        expect(screen.getByLabelText('Edit protected value')).toBeInTheDocument()
      })

      // Masking is write-only ONLY for a STORED secret (the masked
      // placeholder from get_profile, or a sealed envelope). A value typed this
      // session or revealed as plaintext is not the stored form, so it stays
      // visible and editable - never dropped into clear-and-retype.
      it('does NOT mask a freshly typed (non-stored) secret string value', () => {
        renderRow({
          parameter: makeParameter({
            type: 'string',
            secret: true,
            values: { 'env-1': 'just-typed-plaintext' },
          }),
        })
        expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
        expect(screen.getByTestId(/^param-edit-value/)).toBeInTheDocument()
      })

      it('does NOT mask a revealed plaintext secret (shared unmask on)', () => {
        renderRow({
          parameter: makeParameter({
            type: 'string',
            secret: true,
            values: { 'env-1': 'revealed-plaintext' },
          }),
        })
        expect(screen.queryByLabelText('Edit protected value')).not.toBeInTheDocument()
      })
    })

    describe('secret clear-and-edit opens the sheet', () => {
      it('clears the value then opens the sheet after confirming for a string secret', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({
            type: 'string',
            secret: true,
            values: { 'env-1': '********' },
          }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByLabelText('Edit protected value'))
        fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
        expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      })

      it('clears then edits a secret float inline (no sheet)', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'float', secret: true, values: { 'env-1': '********' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByLabelText('Edit protected value'))
        fireEvent.click(screen.getByRole('button', { name: /delete.*edit/i }))
        expect(onUpdateValue).toHaveBeenCalledWith('param-1', '')
        expect(screen.getByTestId('scalar-edit-body')).toHaveAttribute('data-type', 'float')
        expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
      })
    })

    describe('table sheet save', () => {
      it('saves edited table rows back as the { headers, rows } shape', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({
            type: 'table',
            values: { 'env-1': '{"headers":["host","port"],"rows":[["db",1]]}' },
          }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save-rows'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ headers: ['host', 'port'], rows: [['h', 1]] }),
          undefined,
        )
      })

      it('keeps the original columns when the table is emptied', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({
            type: 'table',
            values: { 'env-1': '{"headers":["a","b"],"rows":[["1","2"]]}' },
          }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ headers: ['a', 'b'], rows: [] }),
          undefined,
        )
      })

      it('saves a table stored with its column types as the { headers, rows } shape', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({
            type: 'table',
            values: { 'env-1': '{"headers":["host","port"],"rows":[["db",1]]}' },
          }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save-stored-table'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ headers: ['host', 'port'], rows: [['h', 1], ['g', 2]] }),
          undefined,
        )
      })

      it('keeps the columns of a table stored with its column types and no rows', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({
            type: 'table',
            values: { 'env-1': '{"headers":["a","b"],"rows":[["1","2"]]}' },
          }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save-stored-empty-table'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ headers: ['zone'], rows: [] }),
          undefined,
        )
      })

      it('falls back to no columns for a non-dict stored table value', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'table', values: { 'env-1': '[]' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ headers: [], rows: [] }),
          undefined,
        )
      })
    })

    describe('element types (REQ-3.1.3.19)', () => {
      it('opens the map sheet on the environment\'s element types', () => {
        renderRow({
          parameter: makeParameter({
            type: 'map',
            values: { 'env-1': '{"n":"16"}' },
            elementTypes: { 'env-1': { n: 'integer' }, 'env-2': { n: 'string' } },
          }),
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute(
          'data-element-types',
          JSON.stringify({ n: 'integer' }),
        )
      })

      it('routes a typed map save with its element types', () => {
        const onUpdateValue = vi.fn()
        renderRow({
          parameter: makeParameter({ type: 'map', values: { 'env-1': '{}' } }),
          onUpdateValue,
        })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.click(screen.getByTestId('sheet-save-typed'))
        expect(onUpdateValue).toHaveBeenCalledWith(
          'param-1',
          JSON.stringify({ n: '16', zip: '02134' }),
          { n: 'integer', zip: 'string' },
        )
      })
    })

    describe('sheet ESC handling', () => {
      it('delegates capture-phase ESC to the sheet via captureEsc (guarded close lives there)', () => {
        renderRow({ parameter: makeParameter({ type: 'string', values: { 'env-1': 'x' } }) })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-capture-esc', 'true')
      })

      it('ignores a non-Escape key while the sheet is open', () => {
        renderRow({ parameter: makeParameter({ type: 'string', values: { 'env-1': 'x' } }) })
        fireEvent.click(screen.getByTestId(/^param-edit-value/))
        fireEvent.keyDown(document, { key: 'a' })
        expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
      })
    })
  })

  // --------------------------------------------------------------------------
  // Value error (FIELDERR-1)
  // --------------------------------------------------------------------------
  describe('Value error', () => {
    const PORT_MESSAGE = 'port must be between 1 and 65535'
    const port = makeParameter({ id: 'param-port', name: 'port', type: 'integer', values: { 'env-1': '70000' } })

    beforeEach(() => {
      scalarBody.real = true
    })

    afterEach(() => {
      scalarBody.real = false
    })

    it('shows the message under the value with its test id and role', () => {
      renderRow({ parameter: port, valueError: PORT_MESSAGE })
      const message = screen.getByTestId('param-value-error-param-port')
      expect(message.textContent).toBe(PORT_MESSAGE)
      expect(message).toHaveAttribute('role', 'alert')
    })

    it('hangs the message in the value cell', () => {
      renderRow({ parameter: port, valueError: PORT_MESSAGE })
      const valueCell = screen.getByTestId('scalar-edit-input').closest('td') as HTMLElement
      expect(valueCell).toContainElement(screen.getByTestId('param-value-error-param-port'))
    })

    it('marks the integer input invalid and describes it by the message', () => {
      renderRow({ parameter: port, valueError: PORT_MESSAGE })
      const input = screen.getByTestId('scalar-edit-input')
      expect(input).toHaveValue('70000')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription(PORT_MESSAGE)
    })

    it('shows nothing and marks nothing when the error is null', () => {
      renderRow({ parameter: port, valueError: null })
      expect(screen.queryByTestId('param-value-error-param-port')).not.toBeInTheDocument()
      const input = screen.getByTestId('scalar-edit-input')
      expect(input).not.toHaveAttribute('aria-invalid', 'true')
      expect(input).not.toHaveAccessibleDescription()
    })

    it('shows nothing and marks nothing when no error is passed', () => {
      renderRow({ parameter: port })
      expect(screen.queryByTestId('param-value-error-param-port')).not.toBeInTheDocument()
      expect(screen.getByTestId('scalar-edit-input')).not.toHaveAttribute('aria-invalid', 'true')
    })
  })

  // --------------------------------------------------------------------------
  // A cleared number is not provided (K8SPROF-6)
  // --------------------------------------------------------------------------
  describe('Cleared number', () => {
    beforeEach(() => {
      scalarBody.real = true
    })

    afterEach(() => {
      scalarBody.real = false
    })

    it.each(['integer', 'float'] as const)('stores a cleared %s value as empty, never zero', (type) => {
      const parameter = makeParameter({ id: 'param-port', name: 'port', type, values: { 'env-1': '5432' } })
      const { onUpdateValue } = renderRow({ parameter })
      fireEvent.change(screen.getByTestId('scalar-edit-input'), { target: { value: '' } })
      expect(onUpdateValue).toHaveBeenLastCalledWith('param-port', '', undefined)
    })

    it('opens an unprovided number as an empty box', () => {
      const parameter = makeParameter({ id: 'param-port', name: 'port', type: 'integer', values: { 'env-1': '' } })
      renderRow({ parameter })
      expect(screen.getByTestId('scalar-edit-input')).toHaveValue('')
    })
  })
})

describe('ParameterRow - plain-text values', () => {
  const allowedFormats = () => screen.getByTestId('value-editor-sheet').getAttribute('data-allowed-formats')

  it('opens a plain-text field editor locked to plain, so it offers no format', () => {
    renderRow({ plainText: true })
    fireEvent.click(screen.getByTestId(/^param-edit-value/))
    expect(allowedFormats()).toBe('["plain"]')
  })

  it('opens a secret field editor locked to plain', () => {
    renderRow({ parameter: makeParameter({ secret: true, values: { 'env-1': '' } }) })
    fireEvent.click(screen.getByTestId(/^param-edit-value/))
    expect(allowedFormats()).toBe('["plain"]')
  })

  it('leaves every format open for any other string', () => {
    renderRow()
    fireEvent.click(screen.getByTestId(/^param-edit-value/))
    expect(allowedFormats()).toBe('null')
  })
})

describe('ParameterRow - form control names', () => {
  it('gives the name field, the type select and the secret checkbox a name attribute', () => {
    renderRow()

    expect(screen.getByLabelText('Parameter name')).toHaveAttribute('name', 'parameter-name')
    expect(screen.getByLabelText('Parameter type')).toHaveAttribute('name', 'parameter-type')
    expect(screen.getByLabelText('Mark as secret')).toHaveAttribute('name', 'parameter-secret')
  })
})
