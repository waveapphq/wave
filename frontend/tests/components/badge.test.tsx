/**
 * Badge Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Badge component following design system specifications.
 *
 * Badge specifications:
 * - Display: inline-flex with center alignment
 * - Padding: 4px vertical, 10px horizontal (py-1 px-2.5)
 * - Font size: 12px (text-xs)
 * - Font weight: 600 (font-semibold)
 * - Border radius: 100px (rounded-full)
 * - Variants: default, primary, success, warning, error
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'

describe('Badge Component', () => {
  describe('Rendering', () => {
    it('renders badge with text content', () => {
      render(<Badge>Status</Badge>)
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('renders as span element by default', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge').tagName).toBe('SPAN')
    })

    it('renders children correctly', () => {
      render(
        <Badge>
          <span data-testid="icon">*</span>
          Text
        </Badge>
      )
      expect(screen.getByTestId('icon')).toBeInTheDocument()
      expect(screen.getByText('Text')).toBeInTheDocument()
    })

    it('applies base badge class', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge')
    })
  })

  describe('Variants', () => {
    it('applies default variant styles by default', () => {
      render(<Badge data-testid="badge">Default</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-default')
    })

    it('applies primary variant styles', () => {
      render(<Badge variant="primary" data-testid="badge">Primary</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-primary')
    })

    it('applies success variant styles', () => {
      render(<Badge variant="success" data-testid="badge">Success</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-success')
    })

    it('applies warning variant styles', () => {
      render(<Badge variant="warning" data-testid="badge">Warning</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-warning')
    })

    it('applies error variant styles', () => {
      render(<Badge variant="error" data-testid="badge">Error</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-error')
    })

    it('applies info variant styles', () => {
      render(<Badge variant="info" data-testid="badge">Info</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('badge-info')
    })
  })


  describe('Design System Compliance', () => {
    it('has inline-flex display for proper alignment', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('inline-flex')
    })

    it('centers content with items-center', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('items-center')
    })

    it('applies pill shape border radius (rounded-full)', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('rounded-full')
    })

    it('applies semibold font weight', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('font-semibold')
    })

    it('applies text-xs font size (12px)', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('text-xs')
    })

    it('applies vertical padding (4px / py-1)', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('py-1')
    })

    it('applies horizontal padding (10px / px-2.5)', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('px-2.5')
    })
  })

  describe('With Icon', () => {
    it('renders with left icon', () => {
      render(
        <Badge leftIcon={<span data-testid="left-icon">L</span>}>
          Label
        </Badge>
      )
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    })

    it('positions left icon before text', () => {
      render(
        <Badge leftIcon={<span data-testid="left-icon">L</span>} data-testid="badge">
          Text
        </Badge>
      )
      const badge = screen.getByTestId('badge')
      const icon = screen.getByTestId('left-icon')
      expect(badge).toContainElement(icon)
      expect(badge.innerHTML.indexOf('left-icon')).toBeLessThan(badge.innerHTML.indexOf('Text'))
    })

    it('renders with right icon', () => {
      render(
        <Badge rightIcon={<span data-testid="right-icon">R</span>}>
          Label
        </Badge>
      )
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })

    it('positions right icon after text', () => {
      render(
        <Badge rightIcon={<span data-testid="right-icon">R</span>} data-testid="badge">
          Text
        </Badge>
      )
      const badge = screen.getByTestId('badge')
      const icon = screen.getByTestId('right-icon')
      expect(badge).toContainElement(icon)
      expect(badge.innerHTML.indexOf('Text')).toBeLessThan(badge.innerHTML.indexOf('right-icon'))
    })

    it('renders with both left and right icons', () => {
      render(
        <Badge
          leftIcon={<span data-testid="left-icon">L</span>}
          rightIcon={<span data-testid="right-icon">R</span>}
        >
          Label
        </Badge>
      )
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })

    it('applies gap between icon and text', () => {
      render(
        <Badge leftIcon={<span>*</span>} data-testid="badge">
          Label
        </Badge>
      )
      expect(screen.getByTestId('badge')).toHaveClass('gap-1')
    })
  })

  describe('Dot Indicator', () => {
    it('renders dot indicator when dot prop is true', () => {
      render(<Badge dot data-testid="badge">Status</Badge>)
      const badge = screen.getByTestId('badge')
      const dot = badge.querySelector('[data-badge-dot]')
      expect(dot).toBeInTheDocument()
    })

    it('dot inherits variant color', () => {
      render(<Badge dot variant="success" data-testid="badge">Active</Badge>)
      const badge = screen.getByTestId('badge')
      const dot = badge.querySelector('[data-badge-dot]')
      expect(dot).toHaveClass('bg-success')
    })

    it('does not render dot by default', () => {
      render(<Badge data-testid="badge">Status</Badge>)
      const badge = screen.getByTestId('badge')
      const dot = badge.querySelector('[data-badge-dot]')
      expect(dot).not.toBeInTheDocument()
    })
  })

  describe('Removable Badge', () => {
    it('shows remove button when onRemove is provided', () => {
      const handleRemove = vi.fn()
      render(<Badge onRemove={handleRemove}>Removable</Badge>)
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('calls onRemove when remove button is clicked', async () => {
      const handleRemove = vi.fn()
      const userEventModule = await import('@testing-library/user-event')
      const user = userEventModule.default.setup()

      render(<Badge onRemove={handleRemove}>Removable</Badge>)
      await user.click(screen.getByRole('button', { name: /remove/i }))

      expect(handleRemove).toHaveBeenCalledTimes(1)
    })

    it('does not show remove button when onRemove is not provided', () => {
      render(<Badge>Not Removable</Badge>)
      expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument()
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<Badge className="custom-class" data-testid="badge">Label</Badge>)
      expect(screen.getByTestId('badge')).toHaveClass('custom-class')
    })

    it('merges className with variant classes', () => {
      render(
        <Badge variant="success" className="custom-class" data-testid="badge">
          Label
        </Badge>
      )
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveClass('badge-success')
      expect(badge).toHaveClass('custom-class')
    })

    it('forwards ref to span element', () => {
      const ref = vi.fn()
      render(<Badge ref={ref}>Label</Badge>)
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLSpanElement)
    })

    it('passes through additional HTML attributes', () => {
      render(<Badge data-custom="value" id="custom-id" data-testid="badge">Label</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).toHaveAttribute('data-custom', 'value')
      expect(badge).toHaveAttribute('id', 'custom-id')
    })
  })

  describe('Accessibility', () => {
    it('has no implicit role by default (decorative badge)', () => {
      render(<Badge data-testid="badge">Label</Badge>)
      const badge = screen.getByTestId('badge')
      expect(badge).not.toHaveAttribute('role')
    })

    it('supports role="status" for status indicators', () => {
      render(<Badge role="status" data-testid="badge">Active</Badge>)
      expect(screen.getByTestId('badge')).toHaveAttribute('role', 'status')
    })

    it('remove button has accessible label', () => {
      render(<Badge onRemove={() => {}}>Tag</Badge>)
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
    })

    it('remove button includes badge text in accessible name', () => {
      render(<Badge onRemove={() => {}}>Important Tag</Badge>)
      const removeButton = screen.getByRole('button')
      expect(removeButton).toHaveAttribute('aria-label', expect.stringContaining('Important Tag'))
    })
  })

  describe('All Variants', () => {
    const variants = ['default', 'primary', 'success', 'warning', 'error', 'info'] as const

    variants.forEach((variant) => {
      it(`renders ${variant} variant correctly`, () => {
        render(
          <Badge variant={variant} data-testid="badge">
            Label
          </Badge>
        )
        const badge = screen.getByTestId('badge')
        expect(badge).toHaveClass(`badge-${variant}`)
      })
    })
  })

  describe('Children Types', () => {
    it('renders number children correctly', () => {
      render(
        <Badge data-testid="badge" onRemove={() => {}}>
          {42}
        </Badge>
      )
      expect(screen.getByText('42')).toBeInTheDocument()
      // Remove button should have accessible label with number converted to string
      expect(screen.getByRole('button', { name: /remove 42/i })).toBeInTheDocument()
    })

    it('renders array children correctly for accessible label', () => {
      render(
        <Badge data-testid="badge" onRemove={() => {}}>
          {['Tag', ' ', 'Name']}
        </Badge>
      )
      expect(screen.getByRole('button', { name: /remove tag name/i })).toBeInTheDocument()
    })
  })
})
