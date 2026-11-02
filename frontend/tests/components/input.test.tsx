/**
 * Input Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Input component following design system specifications.
 *
 * Input specifications:
 * - Height: 40px (h-10) for md size
 * - Padding: 8px vertical, 12px horizontal (px-3)
 * - Font size: 14px (text-sm)
 * - Border radius, border, focus ring, background: provided by .input CSS class
 * - States: default, hover, focus, error, disabled
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '@/components/ui/input'

describe('Input Component', () => {
  describe('Rendering', () => {
    it('renders input element', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('renders with placeholder', () => {
      render(<Input placeholder="Enter text" />)
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
    })

    it('renders with initial value', () => {
      render(<Input defaultValue="Initial value" />)
      expect(screen.getByRole('textbox')).toHaveValue('Initial value')
    })

    it('renders as controlled input', () => {
      const handleChange = vi.fn()
      render(<Input value="Controlled" onChange={handleChange} />)
      expect(screen.getByRole('textbox')).toHaveValue('Controlled')
    })
  })


  describe('Design System Compliance', () => {
    it('applies base input class', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('input')
    })

    it('applies default height of 40px (h-10)', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('h-10')
    })

    it('applies full width by default', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('w-full')
    })

    it('applies horizontal padding (px-3 / 12px)', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('px-3')
    })

    it('applies text-sm font size (14px)', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('text-sm')
    })

    it('provides border, border-radius, focus ring, and background via .input CSS class', () => {
      render(<Input />)
      // The .input CSS class (index.css) provides: border-radius 4px, 1px solid border,
      // focus ring via box-shadow, and background-color - no Tailwind utilities needed
      expect(screen.getByRole('textbox')).toHaveClass('input')
    })

    it('applies transition for smooth state changes', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveClass('transition-[border-color,box-shadow]')
    })
  })

  describe('States', () => {
    it('is enabled by default', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).not.toBeDisabled()
    })

    it('can be disabled', () => {
      render(<Input disabled />)
      expect(screen.getByRole('textbox')).toBeDisabled()
    })

    it('applies disabled styles when disabled', () => {
      render(<Input disabled />)
      expect(screen.getByRole('textbox')).toHaveClass('input-disabled')
    })

    it('can be read-only', () => {
      render(<Input readOnly />)
      expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    })

    it('applies error state styles', () => {
      render(<Input error />)
      expect(screen.getByRole('textbox')).toHaveClass('input-error')
    })

    it('applies error state with aria-invalid', () => {
      render(<Input error />)
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('Interactions', () => {
    it('calls onChange handler when value changes', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(<Input onChange={handleChange} />)
      await user.type(screen.getByRole('textbox'), 'test')

      expect(handleChange).toHaveBeenCalled()
    })

    it('calls onBlur handler when input loses focus', async () => {
      const user = userEvent.setup()
      const handleBlur = vi.fn()

      render(<Input onBlur={handleBlur} />)
      await user.click(screen.getByRole('textbox'))
      await user.tab()

      expect(handleBlur).toHaveBeenCalled()
    })

    it('calls onFocus handler when input gains focus', async () => {
      const user = userEvent.setup()
      const handleFocus = vi.fn()

      render(<Input onFocus={handleFocus} />)
      await user.click(screen.getByRole('textbox'))

      expect(handleFocus).toHaveBeenCalled()
    })

    it('can be focused with keyboard', async () => {
      const user = userEvent.setup()
      render(<Input />)

      await user.tab()
      expect(screen.getByRole('textbox')).toHaveFocus()
    })

    it('cannot be focused when disabled', async () => {
      const user = userEvent.setup()
      render(<Input disabled />)

      await user.tab()
      expect(screen.getByRole('textbox')).not.toHaveFocus()
    })

    it('does not allow typing when disabled', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(<Input disabled onChange={handleChange} />)
      const input = screen.getByRole('textbox')
      await user.type(input, 'test')

      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('Input Types', () => {
    it('defaults to text type', () => {
      render(<Input />)
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text')
    })

    it('supports email type', () => {
      render(<Input type="email" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email')
    })

    it('supports password type', () => {
      render(<Input type="password" />)
      // Password inputs don't have textbox role
      expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
    })

    it('supports number type', () => {
      render(<Input type="number" />)
      expect(screen.getByRole('spinbutton')).toHaveAttribute('type', 'number')
    })

    it('supports search type', () => {
      render(<Input type="search" />)
      expect(screen.getByRole('searchbox')).toHaveAttribute('type', 'search')
    })

    it('supports tel type', () => {
      render(<Input type="tel" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'tel')
    })

    it('supports url type', () => {
      render(<Input type="url" />)
      expect(screen.getByRole('textbox')).toHaveAttribute('type', 'url')
    })
  })

  describe('Accessibility', () => {
    it('supports aria-label', () => {
      render(<Input aria-label="Search input" />)
      expect(screen.getByRole('textbox', { name: 'Search input' })).toBeInTheDocument()
    })

    it('supports aria-describedby', () => {
      render(
        <>
          <Input aria-describedby="hint" />
          <span id="hint">Helpful hint</span>
        </>
      )
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby', 'hint')
    })

    it('associates with label via id', () => {
      render(
        <>
          <label htmlFor="test-input">Label</label>
          <Input id="test-input" />
        </>
      )
      expect(screen.getByLabelText('Label')).toBeInTheDocument()
    })

    it('marks required inputs with aria-required', () => {
      render(<Input required />)
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true')
    })

    it('associates error message with input', () => {
      render(<Input error errorMessage="Invalid input" />)
      const input = screen.getByRole('textbox')
      const errorId = input.getAttribute('aria-describedby')
      expect(errorId).toBeTruthy()
      expect(document.getElementById(errorId!)).toHaveTextContent('Invalid input')
    })
  })

  describe('Icons and Addons', () => {
    it('renders left icon', () => {
      render(<Input leftIcon={<span data-testid="left-icon">L</span>} />)
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
    })

    it('renders right icon', () => {
      render(<Input rightIcon={<span data-testid="right-icon">R</span>} />)
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })

    it('renders both left and right icons', () => {
      render(
        <Input
          leftIcon={<span data-testid="left-icon">L</span>}
          rightIcon={<span data-testid="right-icon">R</span>}
        />
      )
      expect(screen.getByTestId('left-icon')).toBeInTheDocument()
      expect(screen.getByTestId('right-icon')).toBeInTheDocument()
    })

    it('renders prefix text', () => {
      render(<Input prefix="$" />)
      expect(screen.getByText('$')).toBeInTheDocument()
    })

    it('renders suffix text', () => {
      render(<Input suffix=".00" />)
      expect(screen.getByText('.00')).toBeInTheDocument()
    })

    it('adds padding when icons are present', () => {
      render(<Input leftIcon={<span>L</span>} />)
      expect(screen.getByRole('textbox')).toHaveClass('pl-10')
    })
  })

  describe('Error Message', () => {
    it('does not render error message when no error', () => {
      render(<Input errorMessage="Error text" />)
      expect(screen.queryByText('Error text')).not.toBeInTheDocument()
    })

    it('renders error message when error is true', () => {
      render(<Input error errorMessage="Error text" />)
      expect(screen.getByText('Error text')).toBeInTheDocument()
    })

    it('applies error message styling', () => {
      render(<Input error errorMessage="Error text" />)
      expect(screen.getByText('Error text')).toHaveClass('text-error')
    })
  })

  describe('Helper Text', () => {
    it('renders helper text', () => {
      render(<Input helperText="Helper text" />)
      expect(screen.getByText('Helper text')).toBeInTheDocument()
    })

    it('shows error message over helper text when both present', () => {
      render(<Input error errorMessage="Error" helperText="Helper" />)
      expect(screen.getByText('Error')).toBeInTheDocument()
      expect(screen.queryByText('Helper')).not.toBeInTheDocument()
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<Input className="custom-class" />)
      expect(screen.getByRole('textbox')).toHaveClass('custom-class')
    })

    it('applies wrapper className', () => {
      const { container } = render(<Input wrapperClassName="wrapper-class" />)
      expect(container.firstChild).toHaveClass('wrapper-class')
    })

    it('forwards ref to input element', () => {
      const ref = vi.fn()
      render(<Input ref={ref} />)
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement)
    })

    it('passes through additional HTML attributes', () => {
      render(<Input data-custom="value" autoComplete="off" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('data-custom', 'value')
      expect(input).toHaveAttribute('autocomplete', 'off')
    })
  })

  describe('Controlled vs Uncontrolled', () => {
    it('works as uncontrolled input with defaultValue', async () => {
      const user = userEvent.setup()
      render(<Input defaultValue="initial" />)

      const input = screen.getByRole('textbox')
      await user.clear(input)
      await user.type(input, 'changed')

      expect(input).toHaveValue('changed')
    })

    it('works as controlled input', async () => {
      const handleChange = vi.fn()
      const { rerender } = render(<Input value="initial" onChange={handleChange} />)

      expect(screen.getByRole('textbox')).toHaveValue('initial')

      rerender(<Input value="updated" onChange={handleChange} />)
      expect(screen.getByRole('textbox')).toHaveValue('updated')
    })
  })

  describe('Max Length', () => {
    it('respects maxLength attribute', async () => {
      const user = userEvent.setup()
      render(<Input maxLength={5} />)

      const input = screen.getByRole('textbox')
      await user.type(input, '1234567890')

      expect(input).toHaveValue('12345')
    })

    it('shows character count when showCount is true', () => {
      render(<Input maxLength={10} showCount defaultValue="Hello" />)
      expect(screen.getByText('5/10')).toBeInTheDocument()
    })
  })

  describe('Clear Button', () => {
    it('shows clear button when clearable and has value', () => {
      render(<Input clearable defaultValue="test" />)

      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    })

    it('does not show clear button when empty', () => {
      render(<Input clearable />)
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
    })

    it('clears input when clear button is clicked', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()
      render(<Input clearable defaultValue="test" onChange={handleChange} />)

      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(screen.getByRole('textbox')).toHaveValue('')
    })

    it('focuses input after clearing', async () => {
      const user = userEvent.setup()
      render(<Input clearable defaultValue="test" />)

      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(screen.getByRole('textbox')).toHaveFocus()
    })
  })
})
