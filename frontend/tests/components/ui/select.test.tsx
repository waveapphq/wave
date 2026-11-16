/**
 * Select Component Tests
 *
 * Tests for the shadcn Select wrappers around @radix-ui/react-select, with the
 * custom SelectItem that mirrors the stored choice into aria-selected.
 *
 * Component: frontend/src/components/ui/select.tsx
 */

import { createRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function OpenSelect({ initialValue }: Readonly<{ initialValue: string }>) {
  const [value, setValue] = useState(initialValue)
  return (
    <Select open value={value} onValueChange={setValue}>
      <SelectTrigger aria-label="Fruit">
        <SelectValue />
      </SelectTrigger>
      <SelectContent data-testid="select-content">
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
      </SelectContent>
    </Select>
  )
}

describe('Select', () => {
  it('opens from its trigger and picks an item', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger aria-label="Fruit" className="custom-trigger">
          <SelectValue placeholder="Pick a fruit" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel className="custom-label">Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectSeparator className="custom-separator" data-testid="select-separator" />
            <SelectItem value="banana">Banana</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    )

    const trigger = screen.getByRole('combobox', { name: 'Fruit' })
    expect(trigger).toHaveClass('flex', 'h-9', 'custom-trigger')
    expect(trigger).toHaveTextContent('Pick a fruit')

    await user.click(trigger)

    expect(await screen.findByText('Fruits')).toHaveClass('px-2', 'font-semibold', 'custom-label')
    expect(screen.getByTestId('select-separator')).toHaveClass('h-px', 'bg-muted', 'custom-separator')

    await user.click(screen.getByRole('option', { name: 'Banana' }))

    expect(onValueChange).toHaveBeenCalledWith('banana')
    await waitFor(() => {
      expect(trigger).toHaveTextContent('Banana')
    })
  })

  it('positions the content as a popper by default', () => {
    render(<OpenSelect initialValue="apple" />)

    const content = screen.getByTestId('select-content')
    expect(content).toHaveClass('data-[side=bottom]:translate-y-1')
    const viewport = content.querySelector('[data-radix-select-viewport]')
    expect(viewport).toHaveClass('p-1', 'h-[var(--radix-select-trigger-height)]')
  })

  it('leaves out the popper offsets for item-aligned content', () => {
    render(
      <Select open value="apple">
        <SelectTrigger aria-label="Fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="item-aligned" data-testid="select-content">
          <SelectItem value="apple">Apple</SelectItem>
        </SelectContent>
      </Select>
    )

    const content = screen.getByTestId('select-content')
    expect(content).not.toHaveClass('data-[side=bottom]:translate-y-1')
    const viewport = content.querySelector('[data-radix-select-viewport]')
    expect(viewport).toHaveClass('p-1')
    expect(viewport).not.toHaveClass('h-[var(--radix-select-trigger-height)]')
  })
})

describe('SelectItem aria-selected', () => {
  it('marks the stored choice selected and follows a new choice', async () => {
    const user = userEvent.setup()
    render(<OpenSelect initialValue="apple" />)

    const apple = screen.getByRole('option', { name: 'Apple' })
    const banana = screen.getByRole('option', { name: 'Banana' })
    await waitFor(() => {
      expect(apple).toHaveAttribute('aria-selected', 'true')
    })
    expect(banana).toHaveAttribute('aria-selected', 'false')

    await user.click(banana)

    await waitFor(() => {
      expect(banana).toHaveAttribute('aria-selected', 'true')
    })
    expect(apple).toHaveAttribute('aria-selected', 'false')
  })

  it('forwards an object ref to the item element', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Select open value="apple">
        <SelectTrigger aria-label="Fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem ref={ref} value="apple" className="custom-item">
            Apple
          </SelectItem>
        </SelectContent>
      </Select>
    )

    expect(ref.current).toBe(screen.getByRole('option', { name: 'Apple' }))
    expect(ref.current).toHaveClass('relative', 'flex', 'custom-item')
  })

  it('forwards a callback ref to the item element', () => {
    const ref = vi.fn()
    render(
      <Select open value="apple">
        <SelectTrigger aria-label="Fruit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem ref={ref} value="apple">
            Apple
          </SelectItem>
        </SelectContent>
      </Select>
    )

    expect(ref).toHaveBeenCalledWith(screen.getByRole('option', { name: 'Apple' }))
  })
})
