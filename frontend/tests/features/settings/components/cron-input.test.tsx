/**
 * CronInput Component Tests
 *
 * Tests for the cron expression input component:
 * - Renders input field
 * - Validates cron expressions
 * - Shows human-readable description
 * - Reports validation state to parent
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CronInput, type CronInputProps } from '@/features/settings/components/cron-input'

// ============================================================================
// Test Utilities
// ============================================================================

function renderCronInput(props: Partial<CronInputProps> = {}) {
  const defaultProps: CronInputProps = {
    value: '',
    onChange: vi.fn(),
    ...props,
  }
  return {
    ...render(<CronInput {...defaultProps} />),
    onChange: defaultProps.onChange as ReturnType<typeof vi.fn>,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CronInput', () => {
  describe('Structure', () => {
    it('renders input field', () => {
      renderCronInput()
      expect(screen.getByTestId('cron-input')).toBeInTheDocument()
    })

    it('renders with provided value', () => {
      renderCronInput({ value: '0 2 * * *' })
      const input = screen.getByTestId('cron-input') as HTMLInputElement
      expect(input.value).toBe('0 2 * * *')
    })

    it('renders label', () => {
      renderCronInput()
      expect(screen.getByText(/cron/i)).toBeInTheDocument()
    })

    it('is a named code field with no autofill and no spellcheck', () => {
      renderCronInput()
      const input = screen.getByLabelText('Cron Expression')
      expect(input).toBe(screen.getByTestId('cron-input'))
      expect(input).toHaveAttribute('name', 'cron')
      expect(input).toHaveAttribute('autocomplete', 'off')
      expect(input).toHaveAttribute('spellcheck', 'false')
    })
  })

  describe('Input', () => {
    it('calls onChange when value changes', async () => {
      const user = userEvent.setup()
      const { onChange } = renderCronInput({ value: '' })

      const input = screen.getByTestId('cron-input')
      await user.clear(input)
      await user.type(input, '0 3 * * *')
      expect(onChange).toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    it('shows human-readable description for valid cron', () => {
      renderCronInput({ value: '0 2 * * *' })
      const description = screen.getByTestId('cron-description')
      expect(description).toBeInTheDocument()
      expect(description.textContent).toBeTruthy()
    })

    it.each([
      ['shows error for invalid cron expression', 'invalid cron'],
      ['shows error when a cron field does not match any valid pattern', 'abc * * * *'],
      ['shows error for cron field with special characters', '* * * * @invalid'],
    ])('%s', (_name, value) => {
      renderCronInput({ value })
      expect(screen.getByTestId('cron-error')).toBeInTheDocument()
    })

    it('shows no error for empty value', () => {
      renderCronInput({ value: '' })
      expect(screen.queryByTestId('cron-error')).not.toBeInTheDocument()
    })

    it('validates five-field cron expressions', () => {
      renderCronInput({ value: '*/5 * * * *' })
      expect(screen.queryByTestId('cron-error')).not.toBeInTheDocument()
      expect(screen.getByTestId('cron-description')).toBeInTheDocument()
    })

    it('ties the description to the field and leaves it valid', () => {
      renderCronInput({ value: '0 2 * * *' })
      const input = screen.getByTestId('cron-input')
      expect(input).toHaveAttribute('aria-invalid', 'false')
      expect(input).toHaveAccessibleDescription(screen.getByTestId('cron-description').textContent ?? '')
    })

    it('marks the field invalid and ties the error to it', () => {
      renderCronInput({ value: 'invalid cron' })
      const input = screen.getByTestId('cron-input')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription(
        'Invalid cron expression. Use 5-field format: minute hour day month weekday',
      )
    })

    it('describes an empty field by nothing', () => {
      renderCronInput({ value: '' })
      const input = screen.getByTestId('cron-input')
      expect(input).toHaveAttribute('aria-invalid', 'false')
      expect(input).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('Cron Description', () => {
    it.each([
      ['describes every N hours pattern', '* */2 * * *', 'Every 2 hours'],
      ['describes at minute N when only minute is specified', '30 * * * *', 'At minute 30'],
      [
        'describes every minute when both minute and hour are wildcards',
        '* * * * *',
        'Every minute',
      ],
      ['includes day of month in description', '0 2 15 * *', 'At 02:00 on day 15'],
      ['includes month in description', '0 2 * 6 *', 'At 02:00 in month 6'],
      ['includes named weekday for numeric day of week (0-6)', '0 2 * * 1', 'At 02:00 on Monday'],
      [
        'includes raw weekday value for out-of-range day of week',
        '0 2 * * 7',
        'At 02:00 on weekday 7',
      ],
    ])('%s', (_name, value, expected) => {
      renderCronInput({ value })
      const desc = screen.getByTestId('cron-description')
      expect(desc.textContent).toBe(expected)
    })
  })

  describe('Disabled State', () => {
    it('can be disabled', () => {
      renderCronInput({ disabled: true })
      const input = screen.getByTestId('cron-input') as HTMLInputElement
      expect(input).toBeDisabled()
    })
  })
})
