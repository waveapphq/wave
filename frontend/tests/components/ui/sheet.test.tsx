/**
 * Sheet Component Tests
 *
 * Tests for the shadcn Sheet wrappers around @radix-ui/react-dialog: the overlay,
 * the close button, the side variants and the header and footer layout parts.
 *
 * Component: frontend/src/components/ui/sheet.tsx
 */

import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

describe('Sheet', () => {
  it('opens from its trigger with an overlay and a close button on the right side', async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Open sheet</SheetTrigger>
        <SheetContent data-testid="sheet-content">
          <SheetHeader data-testid="sheet-header">
            <SheetTitle>Sheet title</SheetTitle>
            <SheetDescription>Sheet description</SheetDescription>
          </SheetHeader>
          <SheetFooter data-testid="sheet-footer">
            <SheetClose>Done</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )

    expect(screen.queryByTestId('sheet-content')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open sheet' }))

    const content = await screen.findByTestId('sheet-content')
    expect(content).toHaveClass('right-0', 'border-l')
    expect(document.querySelector('.bg-black\\/80')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.getByTestId('sheet-header')).toHaveClass('flex', 'flex-col', 'space-y-2')
    expect(screen.getByTestId('sheet-footer')).toHaveClass('flex', 'flex-col-reverse')
    expect(screen.getByText('Sheet title')).toHaveClass('text-lg', 'font-semibold')
    expect(screen.getByText('Sheet description')).toHaveClass('text-sm', 'text-muted-foreground')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByTestId('sheet-content')).toBeNull()
    })
  })

  it('closes from its built-in close button', async () => {
    const user = userEvent.setup()
    render(
      <Sheet defaultOpen>
        <SheetContent data-testid="sheet-content">
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByTestId('sheet-content')).toBeNull()
    })
  })

  it('renders without overlay or close button when overlay is false', () => {
    render(
      <Sheet open modal={false}>
        <SheetContent overlay={false} side="left" data-testid="sheet-content">
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    const content = screen.getByTestId('sheet-content')
    expect(content).toHaveClass('left-0', 'border-r')
    expect(document.querySelector('.bg-black\\/80')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it.each([
    ['top', 'top-0'],
    ['bottom', 'bottom-0'],
  ] as const)('applies the %s side classes', (side, expectedClass) => {
    render(
      <Sheet open>
        <SheetContent side={side} data-testid="sheet-content">
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByTestId('sheet-content')).toHaveClass(expectedClass)
  })

  it('forwards refs and merges caller classes on every part', () => {
    const contentRef = createRef<HTMLDivElement>()
    const titleRef = createRef<HTMLHeadingElement>()
    const descriptionRef = createRef<HTMLParagraphElement>()
    render(
      <Sheet open>
        <SheetContent ref={contentRef} className="custom-content">
          <SheetHeader className="custom-header" data-testid="sheet-header">
            <SheetTitle ref={titleRef} className="custom-title">Title</SheetTitle>
            <SheetDescription ref={descriptionRef} className="custom-description">
              Description
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="custom-footer" data-testid="sheet-footer" />
        </SheetContent>
      </Sheet>
    )

    expect(contentRef.current).toHaveClass('custom-content')
    expect(titleRef.current).toHaveClass('custom-title')
    expect(descriptionRef.current).toHaveClass('custom-description')
    expect(screen.getByTestId('sheet-header')).toHaveClass('custom-header')
    expect(screen.getByTestId('sheet-footer')).toHaveClass('custom-footer')
  })
})
