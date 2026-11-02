/**
 * RadioGroup Component Tests
 *
 * Tests for the shadcn RadioGroup wrapper around @radix-ui/react-radio-group.
 *
 * Component: frontend/src/components/ui/radio-group.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

describe('RadioGroup', () => {
  it('renders radio items', () => {
    render(
      <RadioGroup defaultValue="a">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
          <Label htmlFor="r1">Option A</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
          <Label htmlFor="r2">Option B</Label>
        </div>
      </RadioGroup>
    )

    expect(screen.getByTestId('radio-a')).toBeInTheDocument()
    expect(screen.getByTestId('radio-b')).toBeInTheDocument()
  })

  it('selects item on click', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    const handleChange = vi.fn()
    render(
      <RadioGroup defaultValue="a" onValueChange={handleChange}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
          <Label htmlFor="r1">Option A</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
          <Label htmlFor="r2">Option B</Label>
        </div>
      </RadioGroup>
    )

    await user.click(screen.getByTestId('radio-b'))
    expect(handleChange).toHaveBeenCalledWith('b')
  })

  it('shows visual indicator for selected item', () => {
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
        <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
      </RadioGroup>
    )

    // The selected item should have data-state="checked"
    expect(screen.getByTestId('radio-a')).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('radio-b')).toHaveAttribute('data-state', 'unchecked')
  })

  it('supports disabled state', () => {
    render(
      <RadioGroup defaultValue="a" disabled>
        <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
        <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
      </RadioGroup>
    )

    expect(screen.getByTestId('radio-a')).toBeDisabled()
    expect(screen.getByTestId('radio-b')).toBeDisabled()
  })

  it('uses default value', () => {
    render(
      <RadioGroup defaultValue="b">
        <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
        <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
      </RadioGroup>
    )

    expect(screen.getByTestId('radio-b')).toHaveAttribute('data-state', 'checked')
  })

  it('radio items have correct role for keyboard navigation', () => {
    render(
      <RadioGroup defaultValue="a">
        <RadioGroupItem value="a" id="r1" data-testid="radio-a" />
        <RadioGroupItem value="b" id="r2" data-testid="radio-b" />
      </RadioGroup>
    )

    // Radix radio items use native radio role for keyboard accessibility
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toHaveAttribute('value', 'a')
    expect(radios[1]).toHaveAttribute('value', 'b')
  })
})
