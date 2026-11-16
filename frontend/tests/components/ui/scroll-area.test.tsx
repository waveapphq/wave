/**
 * ScrollArea Component Tests
 *
 * Tests for the shadcn ScrollArea and ScrollBar wrappers around @radix-ui/react-scroll-area.
 *
 * Component: frontend/src/components/ui/scroll-area.tsx
 */

import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

describe('ScrollArea', () => {
  it('renders its children inside the viewport and merges the caller class', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <ScrollArea ref={ref} className="h-40" data-testid="scroll-root" type="always">
        <p>Scrollable content</p>
      </ScrollArea>
    )

    const root = screen.getByTestId('scroll-root')
    expect(ref.current).toBe(root)
    expect(root).toHaveClass('relative', 'overflow-hidden', 'h-40')
    const viewport = root.querySelector('[data-radix-scroll-area-viewport]')
    expect(viewport).not.toBeNull()
    expect(viewport).toContainElement(screen.getByText('Scrollable content'))
  })

  it('renders the default scrollbar vertically', () => {
    render(
      <ScrollArea type="always">
        <p>Content</p>
      </ScrollArea>
    )

    const scrollbar = document.querySelector('[data-orientation="vertical"]')
    expect(scrollbar).not.toBeNull()
    expect(scrollbar).toHaveClass('h-full', 'w-2.5', 'border-l')
  })
})

describe('ScrollBar', () => {
  it('renders a horizontal scrollbar with the horizontal classes', () => {
    render(
      <ScrollArea type="always">
        <p>Wide content</p>
        <ScrollBar orientation="horizontal" className="extra-bar" />
      </ScrollArea>
    )

    const scrollbar = document.querySelector('[data-orientation="horizontal"]')
    expect(scrollbar).not.toBeNull()
    expect(scrollbar).toHaveClass('h-2.5', 'flex-col', 'border-t', 'extra-bar')
    expect(scrollbar).not.toHaveClass('w-2.5')
  })
})
