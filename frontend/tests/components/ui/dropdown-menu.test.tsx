/**
 * DropdownMenu Component Tests (shadcn/radix)
 *
 * Tests for the shadcn DropdownMenu components including the new DropdownMenuCheckboxItem.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'

describe('DropdownMenuCheckboxItem', () => {
  it('renders checkbox item with label', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false}>
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox')).toBeInTheDocument()
    })

    expect(screen.getByText('Show Hidden')).toBeInTheDocument()
  })

  it('shows check icon when checked', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={true}>
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      const checkbox = screen.getByRole('menuitemcheckbox')
      expect(checkbox).toHaveAttribute('aria-checked', 'true')
    })

    // Check icon should be present (via ItemIndicator)
    expect(screen.getByRole('menuitemcheckbox').querySelector('svg')).toBeInTheDocument()
  })

  it('hides check icon when not checked', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false}>
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      const checkbox = screen.getByRole('menuitemcheckbox')
      expect(checkbox).toHaveAttribute('aria-checked', 'false')
    })
  })

  it('calls onCheckedChange when clicked', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={false}
            onCheckedChange={handleChange}
          >
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('menuitemcheckbox'))

    expect(handleChange).toHaveBeenCalledWith(true)
  })

  it('applies custom className', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={false}
            className="custom-class"
            data-testid="checkbox-item"
          >
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByTestId('checkbox-item')).toHaveClass('custom-class')
    })
  })

  it('applies default styling', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={false}
            data-testid="checkbox-item"
          >
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      const item = screen.getByTestId('checkbox-item')
      expect(item).toHaveClass('relative')
      expect(item).toHaveClass('flex')
      expect(item).toHaveClass('cursor-default')
      expect(item).toHaveClass('select-none')
      expect(item).toHaveClass('items-center')
      expect(item).toHaveClass('rounded-sm')
    })
  })

  it('supports disabled state', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={false}
            disabled
            onCheckedChange={handleChange}
          >
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox')).toBeInTheDocument()
    })

    // Try to click disabled item
    await user.click(screen.getByRole('menuitemcheckbox'))

    // onCheckedChange should not be called for disabled items
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('forwards ref correctly', async () => {
    const user = userEvent.setup()
    const ref = { current: null as HTMLDivElement | null }

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false} ref={ref}>
            Show Hidden
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(ref.current).toBeInstanceOf(HTMLDivElement)
    })
  })
})

describe('DropdownMenuLabel', () => {
  it('renders label text', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Section Title</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByText('Section Title')).toBeInTheDocument()
    })
  })

  it('applies default styling', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel data-testid="label">Actions</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      const label = screen.getByTestId('label')
      expect(label).toHaveClass('px-2')
      expect(label).toHaveClass('py-1.5')
      expect(label).toHaveClass('text-xs')
      expect(label).toHaveClass('font-medium')
    })
  })

  it('applies inset styling when inset prop is true', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel data-testid="label" inset>
            Inset Label
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      const label = screen.getByTestId('label')
      expect(label).toHaveClass('pl-8')
    })
  })

  it('applies custom className', async () => {
    const user = userEvent.setup()

    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel data-testid="label" className="custom-class">
            Custom Label
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await user.click(screen.getByText('Open'))

    await waitFor(() => {
      expect(screen.getByTestId('label')).toHaveClass('custom-class')
    })
  })
})
