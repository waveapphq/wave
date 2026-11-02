/**
 * FormatPicker Component Tests
 *
 * Tests for the shared YAML/JSON format radio group.
 *
 * Component: frontend/src/components/shared/dialogs/format-picker.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormatPicker, type FormatPickerProps } from '@/components/shared/dialogs/format-picker'

function renderFormatPicker(props: Partial<FormatPickerProps> = {}) {
  const defaultProps: FormatPickerProps = {
    value: 'yaml',
    onChange: vi.fn(),
    ...props,
  }
  return { ...render(<FormatPicker {...defaultProps} />), onChange: defaultProps.onChange }
}

describe('FormatPicker', () => {
  it('renders Format label', () => {
    renderFormatPicker()
    expect(screen.getByText('Format')).toBeInTheDocument()
  })

  it('renders YAML and JSON options', () => {
    renderFormatPicker()
    expect(screen.getByText('YAML')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
  })

  it('checks YAML when value is yaml', () => {
    renderFormatPicker({ value: 'yaml' })
    expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('format-json')).toHaveAttribute('data-state', 'unchecked')
  })

  it('checks JSON when value is json', () => {
    renderFormatPicker({ value: 'json' })
    expect(screen.getByTestId('format-json')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('format-yaml')).toHaveAttribute('data-state', 'unchecked')
  })

  it('calls onChange when selecting a format', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderFormatPicker({ value: 'yaml', onChange })
    await user.click(screen.getByTestId('format-json'))

    expect(onChange).toHaveBeenCalledWith('json')
  })

  it('renders format-picker test id on RadioGroup', () => {
    renderFormatPicker()
    expect(screen.getByTestId('format-picker')).toBeInTheDocument()
  })
})
