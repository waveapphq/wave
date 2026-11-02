/**
 * Tests for the expanded-palette bottom buttons.
 *
 * The expanded palette renders two bottom buttons:
 *   1. "New Function" (top, cyan) - a drag handle; a plain click is inert
 *      and only pops the hint tooltip.
 *   2. "Function Lib" (bottom, indigo) - opens the Functions Library modal
 *      via `onOpenFunctionLibrary`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'

import { PaletteExpanded } from '@/features/workbench/common/palette/palette-expanded'

function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>
}

function renderExpanded(
  overrides: Partial<{
    onOpenFunctionLibrary: () => void
    onCollapse: () => void
  }> = {},
) {
  const props = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    onOpenFunctionLibrary: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  }
  render(<PaletteExpanded {...props} />, { wrapper: Wrapper })
  return props
}

describe('PaletteExpanded bottom buttons', () => {
  it('renders the "New Function" label beside its plus icon', () => {
    renderExpanded()
    expect(screen.getByText('New Function')).toBeInTheDocument()
    expect(screen.queryByText('+ New Function')).not.toBeInTheDocument()
  })

  it('renders the renamed "Function Lib" label', () => {
    renderExpanded()
    expect(screen.getByText('Function Lib')).toBeInTheDocument()
  })

  it('does NOT render the legacy "New Block" or "Block Library" labels', () => {
    renderExpanded()
    expect(screen.queryByText('New Block')).not.toBeInTheDocument()
    expect(screen.queryByText('Block Library')).not.toBeInTheDocument()
  })

  it('makes the "New Function" button a draggable affordance', () => {
    renderExpanded()
    const newFnButton = screen.getByText('New Function').closest('button, [draggable]')
    expect(newFnButton).not.toBeNull()
    expect(newFnButton!.getAttribute('draggable')).toBe('true')
  })

  it('invokes onOpenFunctionLibrary when the "Function Lib" button is clicked', async () => {
    const user = userEvent.setup()
    const props = renderExpanded()
    await user.click(screen.getByText('Function Lib'))
    expect(props.onOpenFunctionLibrary).toHaveBeenCalledTimes(1)
  })

  it('does NOT invoke onOpenFunctionLibrary when the "New Function" button is clicked', async () => {
    const user = userEvent.setup()
    const props = renderExpanded()
    await user.click(screen.getByText('New Function'))
    expect(props.onOpenFunctionLibrary).not.toHaveBeenCalled()
  })

  it('addresses both bottom buttons by their stable testids', () => {
    renderExpanded()
    expect(screen.getByTestId('palette-new-block-button')).toBeInTheDocument()
    expect(screen.getByTestId('palette-blocks-library-button')).toBeInTheDocument()
  })
})
