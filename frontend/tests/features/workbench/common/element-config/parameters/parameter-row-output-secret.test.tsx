/**
 * ParameterRow output Secret column (SECUI-3 / SECUI-4)
 *
 * The Output Variables table gains a Secret column: checking it marks the
 * bound output variable secret. Input parameters never carry a secret flag
 * (secret is a property of a variable, not an input parameter), so the
 * column is output-mode only. The output ParameterRow threads a per-output
 * `secret` flag + `onSecretChange`.
 *
 * REQ: REQ-3.1.3.5
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock(
  '@/features/workbench/common/element-config/outputs/output-binding-combobox',
  () => ({
    OutputBindingCombobox: ({
      value,
      onChange,
    }: {
      value: string
      onChange: (v: string) => void
    }) =>
      React.createElement('input', {
        'data-testid': 'mock-output-binding',
        value: value ?? '',
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
      }),
  }),
)

vi.mock(
  '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet',
  () => ({
    ValueEditorSheet: () => React.createElement('div', { 'data-testid': 'value-editor-sheet' }),
  }),
)

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

function outputParam(overrides: Partial<Parameter> = {}): Parameter {
  return {
    name: 'token_out',
    label: 'Token',
    type: 'string',
    required: false,
    ...overrides,
  }
}

const defaultRowProps = {
  mode: 'output' as const,
  parameter: outputParam(),
  value: 'captured_token',
  onChange: vi.fn(),
  availableVariables: [] as never[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
  secret: false,
  onSecretChange: vi.fn(),
}

function renderRow(props: Record<string, unknown> = {}) {
  const merged = { ...defaultRowProps, ...props }
  return {
    ...render(
      React.createElement(
        'table',
        null,
        React.createElement(
          'tbody',
          null,
          React.createElement(ParameterRow as React.FC<typeof merged>, merged),
        ),
      ),
    ),
    props: merged,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParameterRow output Secret column (SECUI-3/4)', () => {
  it('renders a Secret checkbox for an output row', () => {
    renderRow()

    expect(screen.getByTestId('output-secret-token_out')).toBeInTheDocument()
  })

  it('reflects the secret prop as checked', () => {
    renderRow({ secret: true })

    expect(screen.getByTestId('output-secret-token_out')).toBeChecked()
  })

  it('is unchecked when the output is not secret', () => {
    renderRow({ secret: false })

    expect(screen.getByTestId('output-secret-token_out')).not.toBeChecked()
  })

  it('calls onSecretChange(true) when checked', () => {
    const onSecretChange = vi.fn()
    renderRow({ secret: false, onSecretChange })

    fireEvent.click(screen.getByTestId('output-secret-token_out'))

    expect(onSecretChange).toHaveBeenCalledWith(true)
  })

  it('calls onSecretChange(false) when unchecked', () => {
    const onSecretChange = vi.fn()
    renderRow({ secret: true, onSecretChange })

    fireEvent.click(screen.getByTestId('output-secret-token_out'))

    expect(onSecretChange).toHaveBeenCalledWith(false)
  })

  it('allows marking a boolean output secret (all outputs are equal)', () => {
    const onSecretChange = vi.fn()
    renderRow({ parameter: outputParam({ type: 'boolean' }), onSecretChange })

    const checkbox = screen.getByTestId('output-secret-token_out')
    expect(checkbox).toBeEnabled()
    fireEvent.click(checkbox)
    expect(onSecretChange).toHaveBeenCalledWith(true)
  })

  it('does not render a Secret checkbox in input mode (secret is not an input-param property)', () => {
    renderRow({ mode: 'input' })

    expect(screen.queryByTestId('output-secret-token_out')).not.toBeInTheDocument()
  })
})
