/**
 * ParameterRow - declared numeric bounds (PING-17, PING-18, FIELDERR-1, FIELDERR-3).
 *
 * A literal outside a row's declared bounds is messaged on the field itself, named by
 * the row's label, and reported up as a save-blocking error. An expression and a
 * blank row are never range-checked, and nothing is clamped.
 *
 * Design Reference: REQ-3.4.2.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const countParam = {
  name: 'count',
  label: 'Count',
  type: 'integer' as const,
  required: false,
  defaultValue: 4,
  minimum: 1,
  maximum: 1000,
}

const intervalParam = {
  name: 'interval',
  label: 'Interval (seconds)',
  type: 'float' as const,
  required: false,
  defaultValue: 1,
  minimum: 0.2,
}

const minRepliesParam = {
  name: 'min_replies',
  label: 'Minimum replies',
  type: 'integer' as const,
  required: false,
  defaultValue: 1,
  minimum: 1,
  maximumField: { field: 'count', message: 'Minimum replies cannot exceed Count' },
}

const allParameters = [countParam, intervalParam, minRepliesParam]

const defaultRowProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: [] as { name: string; type: string }[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
  allParameters,
}

function renderRow(props: React.ComponentProps<typeof ParameterRow>) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...props} />
      </tbody>
    </table>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParameterRow declared numeric bounds (PING-17)', () => {
  it('messages a literal above the highest allowed value', () => {
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 50000,
      allValues: { count: 50000 },
    })
    expect(screen.getByRole('alert').textContent).toBe('Count must be between 1 and 1000')
  })

  it('messages a literal below the lowest allowed value', () => {
    renderRow({
      ...defaultRowProps,
      parameter: intervalParam,
      value: 0.1,
      allValues: { interval: 0.1 },
    })
    expect(screen.getByRole('alert').textContent).toBe('Interval (seconds) must be at least 0.2')
  })

  it('outlines the offending input red', () => {
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 50000,
      allValues: { count: 50000 },
    })
    expect(screen.getByTestId('param-input-count')).toHaveAttribute('aria-invalid', 'true')
  })

  it('messages it eagerly, with validation off', () => {
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 50000,
      allValues: { count: 50000 },
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('reports the bound up as a save-blocking error', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 50000,
      allValues: { count: 50000 },
      onValidationChange,
    })
    expect(onValidationChange).toHaveBeenCalledWith('count', 'Count must be between 1 and 1000')
  })

  it('clears the save-blocking error once the value is back inside the range', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 4,
      allValues: { count: 4 },
      onValidationChange,
    })
    expect(onValidationChange).toHaveBeenCalledWith('count', null)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the value the author typed, clamping nothing', () => {
    const onChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 50000,
      allValues: { count: 50000 },
      onChange,
    })
    expect(screen.getByTestId('param-input-count')).toHaveValue('50000')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('range-checks nothing while the row holds an expression', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: '{{ vars.count }}',
      allValues: { count: '{{ vars.count }}' },
      expressionFields: ['count'],
      onValidationChange,
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith('count', null)
  })

  it('range-checks nothing while the row is blank', () => {
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: '',
      allValues: { count: '' },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ParameterRow bound naming another row (PING-18)', () => {
  it("carries the rule's own message once the value passes the row it names", () => {
    renderRow({
      ...defaultRowProps,
      parameter: minRepliesParam,
      value: 10,
      allValues: { count: 4, min_replies: 10 },
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Minimum replies cannot exceed Count')
  })

  it('reports it up as a save-blocking error', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: minRepliesParam,
      value: 10,
      allValues: { count: 4, min_replies: 10 },
      onValidationChange,
    })
    expect(onValidationChange).toHaveBeenCalledWith(
      'min_replies',
      'Minimum replies cannot exceed Count',
    )
  })

  it('stays quiet while the value sits at or below the row it names', () => {
    renderRow({
      ...defaultRowProps,
      parameter: minRepliesParam,
      value: 4,
      allValues: { count: 4, min_replies: 4 },
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

const portParam = {
  name: 'port',
  label: 'Port',
  type: 'integer' as const,
  required: false,
  minimum: 1,
  maximum: 65535,
}

const timeoutParam = {
  name: 'timeout',
  label: 'Timeout',
  type: 'integer' as const,
  required: false,
  defaultValue: 300,
  minimum: 1,
}

const unlabeledParam = {
  name: 'retries',
  type: 'integer' as const,
  required: false,
  minimum: 1,
  maximum: 10,
}

describe('ParameterRow range message on the field (FIELDERR-1, FIELDERR-3)', () => {
  it('names the row by its label when a port is out of range', () => {
    renderRow({
      ...defaultRowProps,
      parameter: portParam,
      value: 70000,
      allValues: { port: 70000 },
      allParameters: [portParam],
    })
    expect(screen.getByTestId('param-error-port').textContent).toBe(
      'Port must be between 1 and 65535',
    )
  })

  it('names only the lowest bound when a timeout is below it', () => {
    renderRow({
      ...defaultRowProps,
      parameter: timeoutParam,
      value: 0,
      allValues: { timeout: 0 },
      allParameters: [timeoutParam],
    })
    expect(screen.getByTestId('param-error-timeout').textContent).toBe(
      'Timeout must be at least 1',
    )
  })

  it('falls back to the wire name on a row with no label', () => {
    renderRow({
      ...defaultRowProps,
      parameter: unlabeledParam,
      value: 99,
      allValues: { retries: 99 },
      allParameters: [unlabeledParam],
    })
    expect(screen.getByTestId('param-error-retries').textContent).toBe(
      'retries must be between 1 and 10',
    )
  })

  it('makes the message the accessible description of the input', () => {
    renderRow({
      ...defaultRowProps,
      parameter: portParam,
      value: 70000,
      allValues: { port: 70000 },
      allParameters: [portParam],
    })
    const input = screen.getByTestId('param-input-port')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Port must be between 1 and 65535')
  })

  it('carries the error test id on the alert', () => {
    renderRow({
      ...defaultRowProps,
      parameter: portParam,
      value: 70000,
      allValues: { port: 70000 },
      allParameters: [portParam],
    })
    expect(screen.getByRole('alert')).toBe(screen.getByTestId('param-error-port'))
  })

  it('shows it at once, before the field was ever focused or left', () => {
    renderRow({
      ...defaultRowProps,
      parameter: timeoutParam,
      value: 0,
      allValues: { timeout: 0 },
      allParameters: [timeoutParam],
    })
    expect(screen.getByTestId('param-input-timeout')).not.toHaveFocus()
    expect(screen.getByTestId('param-error-timeout').textContent).toBe(
      'Timeout must be at least 1',
    )
  })

  it('reports the label-named message up as the save-blocking error', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: portParam,
      value: 70000,
      allValues: { port: 70000 },
      allParameters: [portParam],
      onValidationChange,
    })
    expect(onValidationChange).toHaveBeenCalledWith('port', 'Port must be between 1 and 65535')
  })

  it('shows no message and no description for a port inside the range', () => {
    renderRow({
      ...defaultRowProps,
      parameter: portParam,
      value: 5432,
      allValues: { port: 5432 },
      allParameters: [portParam],
    })
    expect(screen.queryByTestId('param-error-port')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-port')).not.toHaveAccessibleDescription()
  })
})

// A literal number keeps the one number rule on the row (REQ-3.1.3.14).
describe('ParameterRow - the number rule', () => {
  it.each([
    ['abc', 'Enter a valid integer value'],
    ['12345678901234567890', 'Maximum 19 digits'],
  ])('messages a stored Count of %j and blocks Save', (stored, message) => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: stored,
      allValues: { count: stored },
      onValidationChange,
    })
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(onValidationChange).toHaveBeenLastCalledWith('count', message)
  })

  it('messages unfinished text typed into the box and blocks Save until it is a number', () => {
    const onValidationChange = vi.fn()
    renderRow({
      ...defaultRowProps,
      parameter: intervalParam,
      value: '1',
      allValues: { interval: '1' },
      onValidationChange,
    })
    fireEvent.change(screen.getByTestId('param-input-interval'), { target: { value: '1.' } })
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid float value')
    expect(onValidationChange).toHaveBeenLastCalledWith('interval', 'Enter a valid float value')
  })

  it('compares a value with its bound exactly', () => {
    renderRow({
      ...defaultRowProps,
      parameter: intervalParam,
      value: '0.19999999999999999999',
      allValues: { interval: '0.19999999999999999999' },
    })
    expect(screen.getByRole('alert').textContent).toBe('Interval (seconds) must be at least 0.2')
  })

  it('checks no number rule on an expression', () => {
    renderRow({
      ...defaultRowProps,
      parameter: countParam,
      value: 'count + 1',
      allValues: { count: 'count + 1' },
      expressionFields: ['count'],
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
