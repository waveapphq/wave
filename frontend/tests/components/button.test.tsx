/**
 * Button Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Button component following design system specifications.
 *
 * Button specifications:
 * - Display: inline-flex with center alignment
 * - Gap: 8px between icon and text
 * - Font weight: 600 (semibold)
 * - Border radius: 6px (rounded-md) per design system
 * - Variants: primary, secondary, ghost, danger
 * - Sizes: sm (32px height), md (40px height), lg (48px height)
 * - States: default, hover, disabled
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'

describe('Button Component', () => {
  describe('Rendering', () => {
    it('renders button with text content', () => {
      render(<Button>Click me</Button>)
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
    })

    it('renders button with children', () => {
      render(
        <Button>
          <span data-testid="icon">Icon</span>
          Text
        </Button>
      )
      expect(screen.getByTestId('icon')).toBeInTheDocument()
      expect(screen.getByRole('button')).toHaveTextContent('Text')
    })

    it('renders as button element by default', () => {
      render(<Button>Button</Button>)
      expect(screen.getByRole('button').tagName).toBe('BUTTON')
    })

    it('renders as anchor when asChild is used with Link', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      )
      expect(screen.getByRole('link')).toHaveAttribute('href', '/test')
    })
  })

  describe('Variants', () => {
    it('applies primary variant styles by default', () => {
      render(<Button>Primary</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-primary')
    })

    it('applies secondary variant styles', () => {
      render(<Button variant="secondary">Secondary</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-secondary')
    })

    it('applies ghost variant styles', () => {
      render(<Button variant="ghost">Ghost</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-ghost')
    })

    it('applies danger variant styles', () => {
      render(<Button variant="danger">Danger</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-danger')
    })
  })

  describe('Sizes', () => {
    it('applies small size styles (height: 32px)', () => {
      render(<Button size="sm">Small</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-sm')
    })

    it('applies medium size styles by default (height: 40px)', () => {
      render(<Button>Medium</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-md')
    })

    it('applies large size styles (height: 48px)', () => {
      render(<Button size="lg">Large</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-lg')
    })

    it('draws a 32px square icon button for the 32px field rows', () => {
      render(<Button size="icon-sm" aria-label="Browse" />)
      const button = screen.getByRole('button', { name: 'Browse' })
      expect(button).toHaveClass('h-8', 'w-8', 'p-0')
      expect(button).not.toHaveClass('h-9')
    })
  })

  describe('Design System Compliance', () => {
    it('has inline-flex display', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('inline-flex')
    })

    it('centers content with items-center', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('items-center')
    })

    it('centers content with justify-center', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('justify-center')
    })

    it('applies gap-2 (8px) between icon and text', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('gap-2')
    })

    it('applies semibold font weight (600)', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('font-semibold')
    })

    it('applies rounded-md border radius (6px)', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('rounded-md')
    })

    it('applies transition for smooth state changes', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('transition-[background-color,border-color,box-shadow,opacity,transform]')
    })

    it('shows focus ring on focus-visible', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('focus-visible:ring-2')
    })
  })

  describe('States', () => {
    it('is enabled by default', () => {
      render(<Button>Enabled</Button>)
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('can be disabled', () => {
      render(<Button disabled>Disabled</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('applies disabled styles when disabled', () => {
      render(<Button disabled>Disabled</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('disabled')
    })

    it('shows loading state with spinner', () => {
      render(<Button loading>Loading</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('button-spinner')).toBeInTheDocument()
    })

    it('is disabled while loading', () => {
      render(<Button loading>Loading</Button>)
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('maintains width while loading', () => {
      render(<Button loading>Loading Button Text</Button>)
      const button = screen.getByRole('button')
      // Text should be hidden but button width maintained
      expect(button.querySelector('[data-loading-text]')).toHaveClass('invisible')
    })
  })

  describe('Interactions', () => {
    it('calls onClick handler when clicked', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<Button onClick={handleClick}>Click</Button>)
      await user.click(screen.getByRole('button'))

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('does not call onClick when disabled', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <Button disabled onClick={handleClick}>
          Click
        </Button>
      )
      await user.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('does not call onClick when loading', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <Button loading onClick={handleClick}>
          Click
        </Button>
      )
      await user.click(screen.getByRole('button'))

      expect(handleClick).not.toHaveBeenCalled()
    })

    it('can be focused with keyboard', async () => {
      const user = userEvent.setup()
      render(<Button>Focus</Button>)

      await user.tab()
      expect(screen.getByRole('button')).toHaveFocus()
    })

    it('cannot be focused when disabled', async () => {
      const user = userEvent.setup()
      render(<Button disabled>Disabled</Button>)

      await user.tab()
      expect(screen.getByRole('button')).not.toHaveFocus()
    })

    it('triggers onClick on Enter key press', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<Button onClick={handleClick}>Press</Button>)
      screen.getByRole('button').focus()
      await user.keyboard('{Enter}')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('triggers onClick on Space key press', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(<Button onClick={handleClick}>Press</Button>)
      screen.getByRole('button').focus()
      await user.keyboard(' ')

      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Accessibility', () => {
    it('has accessible name from children', () => {
      render(<Button>Accessible Button</Button>)
      expect(screen.getByRole('button', { name: 'Accessible Button' })).toBeInTheDocument()
    })

    it('supports aria-label', () => {
      render(<Button aria-label="Custom Label">Button</Button>)
      expect(screen.getByRole('button', { name: 'Custom Label' })).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Button aria-describedby="description">Button</Button>
          <span id="description">Description text</span>
        </>
      )
      expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', 'description')
    })

    it('has type="button" by default to prevent form submission', () => {
      render(<Button>Button</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('can override type attribute', () => {
      render(<Button type="submit">Submit</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('indicates loading state to screen readers', () => {
      render(<Button loading>Loading</Button>)
      expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
    })

    it('does not indicate loading when not loading', () => {
      render(<Button>Not Loading</Button>)
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
    })
  })

  describe('Icons', () => {
    it('renders left icon before text', () => {
      render(
        <Button leftIcon={<span data-testid="left-icon">L</span>}>
          Text
        </Button>
      )
      const button = screen.getByRole('button')
      const leftIcon = screen.getByTestId('left-icon')
      expect(button).toContainElement(leftIcon)
      expect(button.innerHTML.indexOf('left-icon')).toBeLessThan(button.innerHTML.indexOf('Text'))
    })

    it('renders right icon after text', () => {
      render(
        <Button rightIcon={<span data-testid="right-icon">R</span>}>
          Text
        </Button>
      )
      const button = screen.getByRole('button')
      const rightIcon = screen.getByTestId('right-icon')
      expect(button).toContainElement(rightIcon)
      expect(button.innerHTML.indexOf('Text')).toBeLessThan(button.innerHTML.indexOf('right-icon'))
    })

    it('renders both left and right icons', () => {
      render(
        <Button
          leftIcon={<span data-testid="left-icon">L</span>}
          rightIcon={<span data-testid="right-icon">R</span>}
        >
          Text
        </Button>
      )
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })

    it('hides icons when loading', () => {
      render(
        <Button
          loading
          leftIcon={<span data-testid="left-icon">L</span>}
          rightIcon={<span data-testid="right-icon">R</span>}
        >
          Text
        </Button>
      )
      expect(screen.getByTestId('left-icon')).toHaveClass('invisible')
      expect(screen.getByTestId('right-icon')).toHaveClass('invisible')
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<Button className="custom-class">Button</Button>)
      expect(screen.getByRole('button')).toHaveClass('custom-class')
    })

    it('merges className with variant classes', () => {
      render(<Button variant="secondary" className="custom-class">Button</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveClass('btn-secondary')
      expect(button).toHaveClass('custom-class')
    })

    it('forwards ref to button element', () => {
      const ref = vi.fn()
      render(<Button ref={ref}>Button</Button>)
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement)
    })

    it('passes through additional HTML attributes', () => {
      render(<Button data-custom="value" id="custom-id">Button</Button>)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('data-custom', 'value')
      expect(button).toHaveAttribute('id', 'custom-id')
    })
  })

  describe('Animation and Transitions', () => {
    it('applies duration-150 for default transition speed', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('duration-150')
    })

    it('applies ease timing function', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('ease-out')
    })

    it('respects reduced-motion preference', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('motion-reduce:transition-none')
    })

    it('applies motion-reduce:duration-0 for reduced motion', () => {
      render(<Button>Label</Button>)
      expect(screen.getByRole('button')).toHaveClass('motion-reduce:duration-0')
    })
  })

  describe('Full Width', () => {
    it('applies full width when fullWidth prop is true', () => {
      render(<Button fullWidth>Full Width</Button>)
      expect(screen.getByRole('button')).toHaveClass('w-full')
    })

    it('does not apply full width by default', () => {
      render(<Button>Normal Width</Button>)
      expect(screen.getByRole('button')).not.toHaveClass('w-full')
    })
  })
})
