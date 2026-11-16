/**
 * Dialog Component Tests
 *
 * Tests for the shadcn Dialog wrappers around @radix-ui/react-dialog: the close
 * button, the floating sheet host, and the outside-click and Escape guards.
 *
 * Component: frontend/src/components/ui/dialog.tsx
 */

import { createRef, useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

type ContentProps = ComponentProps<typeof DialogContent>

function OpenDialog({
  onOpenChange,
  ...contentProps
}: Readonly<Partial<ContentProps> & { onOpenChange?: (open: boolean) => void }>) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        setOpen(next)
      }}
    >
      <DialogContent data-testid="dialog-content" {...contentProps}>
        <DialogTitle>Dialog title</DialogTitle>
        <DialogDescription>Dialog description</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

/** Radix arms its outside-pointer listener on the next tick after the dialog mounts. */
async function waitForOutsideListener() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function appendOutsideElement(className?: string) {
  const element = document.createElement('div')
  if (className) element.className = className
  element.dataset.outside = ''
  document.body.append(element)
  return element
}

describe('Dialog', () => {
  afterEach(() => {
    for (const element of document.querySelectorAll('[data-outside]')) element.remove()
  })

  it('opens from its trigger with the layout parts and a close button', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Open dialog</DialogTrigger>
        <DialogContent data-testid="dialog-content">
          <DialogHeader data-testid="dialog-header">
            <DialogTitle>Dialog title</DialogTitle>
            <DialogDescription>Dialog description</DialogDescription>
          </DialogHeader>
          <DialogFooter data-testid="dialog-footer">
            <DialogClose>Done</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )

    await user.click(screen.getByRole('button', { name: 'Open dialog' }))

    const content = await screen.findByTestId('dialog-content')
    expect(content).toHaveAttribute('aria-modal', 'true')
    expect(content).toHaveClass('fixed', 'left-[50%]', 'top-[50%]')
    expect(screen.getByTestId('dialog-header')).toHaveClass('flex', 'flex-col', 'space-y-1.5')
    expect(screen.getByTestId('dialog-footer')).toHaveClass('flex', 'flex-col-reverse')
    expect(screen.getByText('Dialog title')).toHaveClass('text-lg', 'font-semibold')
    expect(screen.getByText('Dialog description')).toHaveClass('text-sm', 'text-muted-foreground')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByTestId('dialog-content')).toBeNull()
    })
  })

  it('closes from its built-in close button', async () => {
    const user = userEvent.setup()
    render(<OpenDialog />)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByTestId('dialog-content')).toBeNull()
    })
  })

  it('hides the close button when hideCloseButton is set', () => {
    render(<OpenDialog hideCloseButton />)

    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('forwards refs and merges caller classes on every part', () => {
    const contentRef = createRef<HTMLDivElement>()
    const titleRef = createRef<HTMLHeadingElement>()
    const descriptionRef = createRef<HTMLParagraphElement>()
    render(
      <Dialog open>
        <DialogContent ref={contentRef} className="custom-content">
          <DialogHeader className="custom-header" data-testid="dialog-header">
            <DialogTitle ref={titleRef} className="custom-title">Title</DialogTitle>
            <DialogDescription ref={descriptionRef} className="custom-description">
              Description
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="custom-footer" data-testid="dialog-footer" />
        </DialogContent>
      </Dialog>
    )

    expect(contentRef.current).toHaveClass('custom-content')
    expect(titleRef.current).toHaveClass('custom-title')
    expect(descriptionRef.current).toHaveClass('custom-description')
    expect(screen.getByTestId('dialog-header')).toHaveClass('custom-header')
    expect(screen.getByTestId('dialog-footer')).toHaveClass('custom-footer')
  })

  describe('floating sheet host', () => {
    it('centers the box with flex and hosts a sheet layer inside the dialog', () => {
      render(<OpenDialog floatingSheet className="custom-box" />)

      const content = screen.getByTestId('dialog-content')
      expect(content).toHaveAttribute('aria-modal', 'true')
      expect(content).toHaveClass('fixed', 'inset-0', 'flex', 'items-center', 'justify-center')
      expect(content).not.toHaveClass('custom-box')
      expect(content.querySelector('[data-sheet-layer]')).not.toBeNull()

      const box = screen.getByText('Dialog title').parentElement
      expect(box).toHaveClass('relative', 'grid', 'custom-box')
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })
  })

  describe('pointer down outside', () => {
    it('closes and calls the caller handler on a plain outside element', async () => {
      const onPointerDownOutside = vi.fn()
      const onOpenChange = vi.fn()
      render(<OpenDialog onPointerDownOutside={onPointerDownOutside} onOpenChange={onOpenChange} />)
      await waitForOutsideListener()

      const outside = appendOutsideElement()
      fireEvent.pointerDown(outside)

      expect(onPointerDownOutside).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
      await waitFor(() => {
        expect(screen.queryByTestId('dialog-content')).toBeNull()
      })
    })

    it('closes without a caller handler', async () => {
      const onOpenChange = vi.fn()
      render(<OpenDialog onOpenChange={onOpenChange} />)
      await waitForOutsideListener()

      const outside = appendOutsideElement()
      fireEvent.pointerDown(outside)

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('stays open when the press lands on a CodeMirror tooltip', async () => {
      const onPointerDownOutside = vi.fn()
      const onOpenChange = vi.fn()
      render(<OpenDialog onPointerDownOutside={onPointerDownOutside} onOpenChange={onOpenChange} />)
      await waitForOutsideListener()

      const tooltip = appendOutsideElement('cm-tooltip')
      const option = document.createElement('span')
      tooltip.append(option)
      fireEvent.pointerDown(option)

      expect(onPointerDownOutside).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    })

    it('stays open when preventCloseOnClickOutside is set', async () => {
      const onPointerDownOutside = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <OpenDialog
          preventCloseOnClickOutside
          onPointerDownOutside={onPointerDownOutside}
          onOpenChange={onOpenChange}
        />
      )
      await waitForOutsideListener()

      const outside = appendOutsideElement()
      fireEvent.pointerDown(outside)

      expect(onPointerDownOutside).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    })
  })

  describe('Escape key', () => {
    it('closes and calls the caller handler', async () => {
      const user = userEvent.setup()
      const onEscapeKeyDown = vi.fn()
      const onOpenChange = vi.fn()
      render(<OpenDialog onEscapeKeyDown={onEscapeKeyDown} onOpenChange={onOpenChange} />)

      await user.keyboard('{Escape}')

      expect(onEscapeKeyDown).toHaveBeenCalledTimes(1)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('closes without a caller handler', async () => {
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      render(<OpenDialog onOpenChange={onOpenChange} />)

      await user.keyboard('{Escape}')

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('stays open when preventCloseOnEscape is set and still calls the caller handler', async () => {
      const user = userEvent.setup()
      const onEscapeKeyDown = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <OpenDialog
          preventCloseOnEscape
          onEscapeKeyDown={onEscapeKeyDown}
          onOpenChange={onOpenChange}
        />
      )

      await user.keyboard('{Escape}')

      expect(onEscapeKeyDown).toHaveBeenCalledTimes(1)
      expect(onEscapeKeyDown.mock.calls[0][0].defaultPrevented).toBe(true)
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    })
  })
})
