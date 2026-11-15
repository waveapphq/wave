/**
 * ParameterRow output row: the Assign to box holds the name of the variable the output writes, never a
 * value of the output's type, so none of the input value checks apply to it. The only error line under
 * an output row is the binding error the window hands it.
 *
 * REQ-3.1.3.6; CANVAS-131, CANVAS-212
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

type RowProps = React.ComponentProps<typeof ParameterRow>

const STATUS_CODE: Parameter = { name: 'status_code', label: 'Status Code', type: 'integer', required: false }
const ELAPSED: Parameter = { name: 'elapsed', label: 'Elapsed', type: 'float', required: false }

const baseProps = {
  mode: 'output' as const,
  onChange: vi.fn(),
  availableVariables: [] as { name: string; type: string }[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

function renderRow(props: Partial<RowProps> & Pick<RowProps, 'parameter' | 'value'>) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...baseProps} {...props} />
      </tbody>
    </table>,
  )
}

describe('ParameterRow output row: the Assign to box holds a variable name', () => {
  it('shows no error line under an integer output bound to a name', () => {
    renderRow({ parameter: STATUS_CODE, value: 'scode' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Assign Status Code to' })).not.toHaveAttribute('aria-invalid')
  })

  it('shows no error line under a float output bound to a name', () => {
    renderRow({ parameter: ELAPSED, value: 'took' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Assign Elapsed to' })).not.toHaveAttribute('aria-invalid')
  })

  it('shows no required line under a required output left unbound', () => {
    renderRow({ parameter: { ...STATUS_CODE, required: true }, value: '' })

    expect(screen.queryByText('Status Code is required')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no URL line under an output named url bound to a name', () => {
    renderRow({ parameter: { name: 'url', label: 'URL', type: 'string', required: false }, value: 'final_url' })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports no save-blocking error for an output bound to a name', () => {
    const onValidationChange = vi.fn()
    renderRow({ parameter: STATUS_CODE, value: 'scode', onValidationChange })

    expect(onValidationChange).toHaveBeenCalledWith('status_code', null)
    expect(onValidationChange).not.toHaveBeenCalledWith('status_code', expect.any(String))
  })

  it("shows the window's binding error under the output row as its only error line", () => {
    const message = 'Type mismatch: "label" is string, expected integer'
    renderRow({ parameter: STATUS_CODE, value: 'label', fieldError: message })

    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toBe(message)
    expect(screen.getByTestId('field-error-status_code')).toBe(alerts[0])
    const box = screen.getByRole('combobox', { name: 'Assign Status Code to' })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(message)
  })

  it('shows the empty box hint in the gray of a not-set default (FIELD-2)', () => {
    renderRow({ parameter: STATUS_CODE, value: '' })

    const box = screen.getByRole('combobox', { name: 'Assign Status Code to' })
    expect(box).toHaveAttribute('placeholder', 'variable_name')
    expect(box).toHaveClass('placeholder:text-[color:var(--color-text-muted)]')
    expect(box).not.toHaveClass('placeholder:text-muted-foreground')
  })

  it('keeps the number rule on an integer input row holding the same text', () => {
    renderRow({ mode: 'input', parameter: STATUS_CODE, value: 'scode' })

    expect(screen.getByTestId('param-error-status_code')).toHaveTextContent(/^Enter a valid integer value$/)
  })
})
