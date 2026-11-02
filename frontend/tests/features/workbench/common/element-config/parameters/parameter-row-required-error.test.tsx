/**
 * ParameterRow - the required-empty message (FIELDERR-1, FIELDERR-3, SHRUN-13).
 *
 * An empty required row shows `{Label} is required` at once - as the sheet opens and the
 * moment a value is emptied - and reports the save-blocking error from the start.
 *
 * Design Reference: REQ-3.4.2.2
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The "Edit value" sheet is heavy (CodeMirror); these tests only need the row's
// validation surface, so stub it out (mirrors parameter-row-string-kind).
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const requiredStringParam = {
  name: 'host',
  label: 'Host',
  type: 'string' as const,
  required: true,
}

const requiredIntegerParam = {
  name: 'count',
  label: 'Count',
  type: 'integer' as const,
  required: true,
}

const failPatternParam = {
  name: 'fail_pattern',
  label: 'Fail pattern',
  type: 'string' as const,
  required: false,
  requiredWhenAll: [
    { field: 'stop_on_pattern', values: ['true'] },
    { field: 'pass_pattern', values: [''] },
  ],
  requiredMessage: 'Set a pass pattern, a fail pattern or both',
}

const conditionalRowWithoutMessage = {
  name: 'username',
  label: 'Username',
  type: 'string' as const,
  required: false,
  requiredWhenAll: [{ field: 'auth_type', values: ['basic'] }],
}

const defaultRowProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: [] as { name: string; type: string }[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

type RowProps = React.ComponentProps<typeof ParameterRow>

/** Wrap ParameterRow in a table (it renders <tr>). */
function renderRow(props: RowProps) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...props} />
      </tbody>
    </table>,
  )
}

/** A required integer row that keeps what the author types, as the config sheet does. */
function StatefulCountRow({
  initialValue,
  onValidationChange,
}: Readonly<{
  initialValue: unknown
  onValidationChange: (name: string, error: string | null) => void
}>) {
  const [value, setValue] = useState<unknown>(initialValue)
  return (
    <table>
      <tbody>
        <ParameterRow
          {...defaultRowProps}
          parameter={requiredIntegerParam}
          value={value}
          onChange={setValue}
          onValidationChange={onValidationChange}
        />
      </tbody>
    </table>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParameterRow eager required error', () => {
  it('shows the required-field message eagerly without any touch/blur', () => {
    renderRow({
      ...defaultRowProps,
      parameter: requiredStringParam,
      value: '',
    })
    expect(screen.getByRole('alert').textContent).toBe('Host is required')
  })

  it('outlines a required-empty integer input red (aria-invalid) eagerly', () => {
    renderRow({
      ...defaultRowProps,
      parameter: requiredIntegerParam,
      value: '',
    })
    expect(screen.getByTestId('param-input-count')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows no error eagerly once the required field has a value', () => {
    renderRow({
      ...defaultRowProps,
      parameter: requiredStringParam,
      value: 'example.com',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ParameterRow at-least-one message (SHRUN-13)', () => {
  it('renders the message as soon as both patterns are empty, with validation off', () => {
    renderRow({
      ...defaultRowProps,
      parameter: failPatternParam,
      value: '',
      allValues: { stop_on_pattern: true, pass_pattern: '' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      /^Set a pass pattern, a fail pattern or both$/,
    )
  })

  it('shows the label message at once on a conditionally required row with no message of its own', () => {
    renderRow({
      ...defaultRowProps,
      parameter: conditionalRowWithoutMessage,
      value: '',
      allValues: { auth_type: 'basic' },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/^Username is required$/)
  })
})

describe('ParameterRow required message at once (FIELDERR-3)', () => {
  it('shows the message as the row opens and blocks Save from the start', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: requiredStringParam,
      value: '',
      onValidationChange,
    })
    const message = screen.getByTestId('param-error-host')
    expect(message.textContent).toBe('Host is required')
    expect(message).toHaveAttribute('role', 'alert')
    const control = screen.getByRole('textbox', { name: 'Host' })
    // The one value field is a text box: it is marked invalid and described by the message.
    expect(control).toHaveAttribute('aria-invalid', 'true')
    // The box holds empty text, which a screen reader hears after the error.
    expect(control).toHaveAccessibleDescription('Host is required empty string')
    expect(onValidationChange).toHaveBeenCalledWith('host', 'Host is required')
  })

  it('shows the message on an integer row as it opens', () => {
    renderRow({
      ...defaultRowProps,
      parameter: requiredIntegerParam,
      value: '',
    })

    const message = screen.getByTestId('param-error-count')
    expect(message.textContent).toBe('Count is required')
    const input = screen.getByTestId('param-input-count')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Count is required')
  })

  it('hangs the message in the value cell, never in the label cell', () => {
    renderRow({
      ...defaultRowProps,
      parameter: requiredStringParam,
      value: '',
    })

    const message = screen.getByTestId('param-error-host')
    const valueCell = screen.getByRole('textbox', { name: 'Host' }).closest('td') as HTMLElement
    const labelCell = within(screen.getByTestId('param-row-host'))
      .getByText('Host')
      .closest('td') as HTMLElement
    expect(valueCell).toContainElement(message)
    expect(labelCell).not.toContainElement(message)
  })

  it('clears the message once a value is typed', async () => {
    const user = userEvent.setup()
    const onValidationChange = vi.fn()
    render(<StatefulCountRow initialValue="" onValidationChange={onValidationChange} />)
    expect(screen.getByTestId('param-error-count')).toBeInTheDocument()

    await user.type(screen.getByTestId('param-input-count'), '3')

    expect(screen.queryByTestId('param-error-count')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-count')).not.toHaveAttribute('aria-invalid', 'true')
    expect(onValidationChange).toHaveBeenLastCalledWith('count', null)
  })

  it('shows the message the moment the value is emptied, while the field still has focus', async () => {
    const user = userEvent.setup()
    render(<StatefulCountRow initialValue={5} onValidationChange={vi.fn()} />)
    expect(screen.queryByTestId('param-error-count')).not.toBeInTheDocument()

    await user.clear(screen.getByTestId('param-input-count'))

    expect(screen.getByTestId('param-input-count')).toHaveFocus()
    expect(screen.getByTestId('param-error-count').textContent).toBe('Count is required')
  })
})
