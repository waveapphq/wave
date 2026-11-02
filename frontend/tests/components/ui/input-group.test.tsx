// REQ-5.2.1.6 (FIELD-1): the shadcn Input Group that holds the icons inside the one value field.

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'

function renderFieldWithAddons() {
  const onReset = vi.fn()
  render(
    <InputGroup data-testid="group">
      <input data-slot="input-group-control" aria-label="Region" />
      <InputGroupAddon data-testid="left-addon">
        <span data-testid="clock-text">clock</span>
      </InputGroupAddon>
      <InputGroupAddon align="inline-end" data-testid="right-addon">
        <button type="button" aria-label="Reset to default" onClick={onReset}>
          <svg data-testid="reset-glyph" />
        </button>
      </InputGroupAddon>
    </InputGroup>,
  )
  return { onReset, input: screen.getByRole('textbox', { name: 'Region' }) }
}

describe('InputGroup', () => {
  it('is a plain box marked with the input-group slot', () => {
    render(<InputGroup data-testid="group" />)
    const group = screen.getByTestId('group')
    expect(group).not.toHaveAttribute('role')
    expect(group).toHaveAttribute('data-slot', 'input-group')
  })

  it('adds the caller className to its own classes', () => {
    render(<InputGroup data-testid="group" className="extra-class" />)
    expect(screen.getByTestId('group')).toHaveClass('relative', 'flex', 'extra-class')
  })

  it('renders its children', () => {
    renderFieldWithAddons()
    const group = screen.getByTestId('group')
    expect(group).toContainElement(screen.getByRole('textbox', { name: 'Region' }))
    expect(group).toContainElement(screen.getByTestId('right-addon'))
  })
})

describe('InputGroupAddon', () => {
  it('is a plain box marked with the addon slot, aligned inline-start by default', () => {
    render(<InputGroupAddon data-testid="addon" />)
    const addon = screen.getByTestId('addon')
    expect(addon).not.toHaveAttribute('role')
    expect(addon).toHaveAttribute('data-slot', 'input-group-addon')
    expect(addon).toHaveAttribute('data-align', 'inline-start')
  })

  it.each(['inline-start', 'inline-end', 'block-start', 'block-end'] as const)(
    'carries the %s alignment',
    (align) => {
      render(<InputGroupAddon data-testid="addon" align={align} />)
      expect(screen.getByTestId('addon')).toHaveAttribute('data-align', align)
    },
  )

  it('adds the caller className to its own classes', () => {
    render(<InputGroupAddon data-testid="addon" className="extra-class" />)
    expect(screen.getByTestId('addon')).toHaveClass('flex', 'extra-class')
  })

  it('leaves focus alone when a button inside the addon is clicked, and the button acts', () => {
    const { input, onReset } = renderFieldWithAddons()
    fireEvent.click(screen.getByTestId('reset-glyph'))
    expect(input).not.toHaveFocus()
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
