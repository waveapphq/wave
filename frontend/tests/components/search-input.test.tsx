/**
 * SearchInput Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for SearchInput composite component following design system specifications.
 *
 * SearchInput is a composite component that combines:
 * - Search icon (left)
 * - Text input with search type
 * - Clear button (when has value)
 * - Optional loading state
 *
 * This addresses REQ-5.2.1.6 requirement for:
 * "Composite components... search inputs with clear actions"
 */

import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchInput } from '@/components/ui/search-input'

describe('SearchInput Component', () => {
  describe('Rendering', () => {
    it('renders search input element', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('renders with type="search"', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveAttribute('type', 'search')
    })

    it('applies base search input class', () => {
      render(<SearchInput data-testid="search" />)
      expect(screen.getByTestId('search')).toHaveClass('search-input')
    })

    it('renders search icon on the left', () => {
      render(<SearchInput />)
      expect(document.querySelector('[data-search-icon]')).toBeInTheDocument()
    })
  })

  describe('Placeholder', () => {
    it('displays default placeholder "Search…"', () => {
      render(<SearchInput />)
      expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
    })

    it('displays custom placeholder when provided', () => {
      render(<SearchInput placeholder="Search tests…" />)
      expect(screen.getByPlaceholderText('Search tests…')).toBeInTheDocument()
    })
  })

  describe('Clear Button', () => {
    it('does not show clear button when input is empty', () => {
      render(<SearchInput />)
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
    })

    it('shows clear button when input has value', () => {
      render(<SearchInput defaultValue="test query" />)
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument()
    })

    it('clears input value when clear button is clicked', async () => {
      const user = userEvent.setup()

      render(<SearchInput defaultValue="test query" />)
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(screen.getByRole('searchbox')).toHaveValue('')
    })

    it('hides clear button after clearing', async () => {
      const user = userEvent.setup()

      render(<SearchInput defaultValue="test" />)
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
    })

    it('focuses input after clearing', async () => {
      const user = userEvent.setup()

      render(<SearchInput defaultValue="test" />)
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(screen.getByRole('searchbox')).toHaveFocus()
    })

    it('calls onClear callback when provided', async () => {
      const user = userEvent.setup()
      const handleClear = vi.fn()

      render(<SearchInput defaultValue="test" onClear={handleClear} />)
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(handleClear).toHaveBeenCalledTimes(1)
    })

    it('calls onChange with empty value when cleared', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(<SearchInput defaultValue="test" onChange={handleChange} />)
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(handleChange).toHaveBeenCalled()
    })
  })

  describe('Design System Compliance', () => {
    it('applies full width by default', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveClass('w-full')
    })

    it('applies rounded border radius (4px per design system)', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveClass('rounded')
    })

    it('applies left padding for search icon', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveClass('pl-10')
    })

    it('applies right padding for clear button', () => {
      render(<SearchInput defaultValue="test" />)
      expect(screen.getByRole('searchbox')).toHaveClass('pr-10')
    })

    it('applies default height', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveClass('h-10')
    })
  })

  describe('Search Icon', () => {
    it('positions search icon on the left', () => {
      const { container } = render(<SearchInput />)
      const iconWrapper = container.querySelector('[data-search-icon]')
      expect(iconWrapper).toHaveClass('left-3')
    })

    it('applies muted color to search icon', () => {
      const { container } = render(<SearchInput />)
      const iconWrapper = container.querySelector('[data-search-icon]')
      expect(iconWrapper).toHaveClass('text-muted')
    })

    it('centers search icon vertically', () => {
      const { container } = render(<SearchInput />)
      const iconWrapper = container.querySelector('[data-search-icon]')
      expect(iconWrapper).toHaveClass('top-1/2')
    })
  })

  describe('Loading State', () => {
    it('shows loading spinner when loading prop is true', () => {
      render(<SearchInput loading />)
      expect(document.querySelector('[data-loading-spinner]')).toBeInTheDocument()
    })

    it('hides clear button when loading', () => {
      render(<SearchInput defaultValue="test" loading />)
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
    })

    it('applies spin animation to loading indicator', () => {
      render(<SearchInput loading />)
      const spinner = document.querySelector('[data-loading-spinner]')
      expect(spinner).toHaveClass('animate-spin')
    })
  })

  describe('Debounce', () => {
    it('supports debounced search callback', () => {
      vi.useFakeTimers()
      const handleSearch = vi.fn()

      render(<SearchInput onSearch={handleSearch} debounceMs={300} />)
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } })

      expect(handleSearch).not.toHaveBeenCalled()

      vi.advanceTimersByTime(300)

      expect(handleSearch).toHaveBeenCalledWith('test')

      vi.useRealTimers()
    })

    it('cancels previous debounced call on new input', () => {
      vi.useFakeTimers()
      const handleSearch = vi.fn()

      render(<SearchInput onSearch={handleSearch} debounceMs={300} />)
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'te' } })

      vi.advanceTimersByTime(200)

      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } })

      vi.advanceTimersByTime(300)

      expect(handleSearch).toHaveBeenCalledTimes(1)
      expect(handleSearch).toHaveBeenCalledWith('test')

      vi.useRealTimers()
    })
  })

  describe('Controlled Component', () => {
    it('accepts value prop for controlled input', () => {
      render(<SearchInput value="controlled" onChange={() => {}} />)
      expect(screen.getByRole('searchbox')).toHaveValue('controlled')
    })

    it('calls onChange when input value changes', () => {
      const handleChange = vi.fn()

      render(<SearchInput value="" onChange={handleChange} />)
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } })

      expect(handleChange).toHaveBeenCalled()
    })
  })

  describe('Keyboard Shortcuts', () => {
    it('clears input when Escape is pressed', () => {
      render(<SearchInput defaultValue="test" />)
      const input = screen.getByRole('searchbox')
      input.focus()
      fireEvent.keyDown(input, { key: 'Escape' })

      expect(input).toHaveValue('')
    })

    it('submits search on Enter key', () => {
      const handleSubmit = vi.fn()

      render(<SearchInput defaultValue="test" onSubmit={handleSubmit} />)
      const input = screen.getByRole('searchbox')
      input.focus()
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(handleSubmit).toHaveBeenCalledWith('test')
    })

    it('prevents form submission on Enter when preventSubmit is true', () => {
      const handleSubmit = vi.fn()

      render(
        <form onSubmit={handleSubmit}>
          <SearchInput defaultValue="test" preventSubmit />
        </form>
      )

      const input = screen.getByRole('searchbox')
      input.focus()
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(handleSubmit).not.toHaveBeenCalled()
    })
  })

  describe('Disabled State', () => {
    it('disables input when disabled prop is true', () => {
      render(<SearchInput disabled />)
      expect(screen.getByRole('searchbox')).toBeDisabled()
    })

    it('hides clear button when disabled', () => {
      render(<SearchInput defaultValue="test" disabled />)
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
    })

    it('applies disabled styling', () => {
      render(<SearchInput disabled />)
      expect(screen.getByRole('searchbox')).toHaveClass('input-disabled')
    })
  })

  describe('Accessibility', () => {
    it('has accessible label when aria-label is provided', () => {
      render(<SearchInput aria-label="Search tests" />)
      expect(screen.getByRole('searchbox', { name: 'Search tests' })).toBeInTheDocument()
    })

    it('associates with external label via id', () => {
      render(
        <>
          <label htmlFor="search-input">Search</label>
          <SearchInput id="search-input" />
        </>
      )
      expect(screen.getByLabelText('Search')).toBeInTheDocument()
    })

    it('clear button has accessible label', () => {
      render(<SearchInput defaultValue="test" />)
      expect(screen.getByRole('button', { name: /clear/i })).toHaveAttribute(
        'aria-label',
        'Clear search'
      )
    })

    it('sets aria-busy when loading', () => {
      render(<SearchInput loading data-testid="search" />)
      expect(screen.getByTestId('search')).toHaveAttribute('aria-busy', 'true')
    })
  })

  describe('Custom Styling', () => {
    it('accepts additional className', () => {
      render(<SearchInput className="custom-class" data-testid="wrapper" />)
      expect(screen.getByTestId('wrapper')).toHaveClass('custom-class')
    })

    it('accepts inputClassName for input element', () => {
      render(<SearchInput inputClassName="custom-input" />)
      expect(screen.getByRole('searchbox')).toHaveClass('custom-input')
    })

    it('forwards ref to input element', () => {
      const ref = vi.fn()
      render(<SearchInput ref={ref} />)
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement)
    })
  })

  describe('Size Variants', () => {
    it('applies small size', () => {
      render(<SearchInput size="sm" />)
      // h-9 matches filter button heights for visual consistency
      expect(screen.getByRole('searchbox')).toHaveClass('h-9')
    })

    it('applies medium size by default', () => {
      render(<SearchInput />)
      expect(screen.getByRole('searchbox')).toHaveClass('h-10')
    })

    it('applies large size', () => {
      render(<SearchInput size="lg" />)
      expect(screen.getByRole('searchbox')).toHaveClass('h-12')
    })
  })

  describe('Ref Handling', () => {
    it('accepts ref object for SearchInput', () => {
      const inputRef = createRef<HTMLInputElement>()

      render(<SearchInput ref={inputRef} />)

      expect(inputRef.current).toBeInstanceOf(HTMLInputElement)
      expect(inputRef.current).toHaveAttribute('type', 'search')
    })

    it('accepts function ref for SearchInput', () => {
      const refCallback = vi.fn()

      render(<SearchInput ref={refCallback} />)

      expect(refCallback).toHaveBeenCalledWith(expect.any(HTMLInputElement))
    })
  })

  describe('Submit Handling', () => {
    it('calls onSubmit when Enter is pressed', async () => {
      const user = userEvent.setup()
      const handleSubmit = vi.fn()

      render(<SearchInput defaultValue="test query" onSubmit={handleSubmit} />)

      const input = screen.getByRole('searchbox')
      await user.click(input)
      await user.keyboard('{Enter}')

      expect(handleSubmit).toHaveBeenCalledWith('test query')
    })

    it('calls onKeyDown callback when key is pressed', async () => {
      const user = userEvent.setup()
      const handleKeyDown = vi.fn()

      render(<SearchInput onKeyDown={handleKeyDown} />)

      const input = screen.getByRole('searchbox')
      await user.click(input)
      await user.keyboard('a')

      expect(handleKeyDown).toHaveBeenCalled()
    })
  })

  describe('Inner Test Ids and Labels', () => {
    it('stamps inputTestId on the input and clearTestId on the clear button', () => {
      render(
        <SearchInput
          inputTestId="palette-search-input"
          clearTestId="palette-search-clear"
          defaultValue="http"
        />
      )

      expect(screen.getByTestId('palette-search-input')).toBe(
        screen.getByRole('searchbox')
      )
      expect(screen.getByTestId('palette-search-clear')).toBe(
        screen.getByRole('button', { name: 'Clear search' })
      )
    })

    it('renames the clear button when clearLabel is given', () => {
      render(<SearchInput clearLabel="Clear filter" defaultValue="api" />)

      expect(
        screen.getByRole('button', { name: 'Clear filter' })
      ).toBeInTheDocument()
    })

    it('renders the compact xs height', () => {
      render(<SearchInput size="xs" />)

      expect(screen.getByRole('searchbox')).toHaveClass('h-8', 'leading-8')
    })
  })
})
