/**
 * Separator Component Tests
 *
 * Tests for the Separator component orientation handling.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Separator } from '@/components/ui/separator'

describe('Separator', () => {
  it('renders horizontal separator by default', () => {
    const { container } = render(<Separator />)
    const separator = container.firstChild as HTMLElement
    expect(separator).toHaveClass('h-[1px]')
    expect(separator).toHaveClass('w-full')
  })

  it('renders vertical separator when orientation is vertical', () => {
    const { container } = render(<Separator orientation="vertical" />)
    const separator = container.firstChild as HTMLElement
    expect(separator).toHaveClass('h-full')
    expect(separator).toHaveClass('w-[1px]')
  })

  it('applies custom className', () => {
    const { container } = render(<Separator className="my-custom-class" />)
    const separator = container.firstChild as HTMLElement
    expect(separator).toHaveClass('my-custom-class')
  })

  it('forwards ref to underlying element', () => {
    const ref = { current: null }
    render(<Separator ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLElement)
  })
})
